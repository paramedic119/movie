"""運用予算（Claude に任せる金額）の台帳。

考え方:
- 予算の対象は許可銘柄（risk.allowed_symbols）だけ。予算を始めた時点で持っていた株は「あなたの持ち分」として
  基準に記録し、Claude は売れない。
- 口座の保有数量が前回見たときから増減していたら、Claude の注文が約定したものとして台帳に反映する。
  その銘柄に Claude の注文が無かった増減は、あなた自身の売買として基準の方を動かす。
- 約定価格は、証券会社の約定単価が取れればそれを、取れなければ Claude の注文の指値（買いは高め・売りは安めに
  見積もる＝安全側）を使う。
- 買える残り = 予算 − 保有株の取得原価 − 未約定の買い注文の拘束額（損失はここから差し引き、利益は
  reinvest_profits = true のときだけ上乗せ）。
- 確定損益 + 含み損益 が −max_loss_jpy 以下になったら、新規の買いを止める（売りはできる）。

予算の金額は設定ファイルでしか変えられず、Claude が自分で増やすことはできない。
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import BudgetSettings
from .models import ACTIVE_STATUSES, JST, AccountSnapshot, Order, Position, Side, now_jst

# 監査ログのうち「Claude の注文」とみなすイベント（送信時エラーも出た可能性があるので含める）
CLAUDE_ORDER_EVENTS = frozenset({"order_placed", "order_error"})


def _order_key(entry: dict[str, Any]) -> str:
    return str(entry.get("token") or entry.get("order_id") or entry.get("ts"))


@dataclass
class BudgetHolding:
    symbol: str
    quantity: int
    avg_cost: float
    cost_jpy: float
    market_price: float | None = None
    unrealized_pnl_jpy: float | None = None


@dataclass
class BudgetStatus:
    amount_jpy: float
    invested_jpy: float  # Claude が保有している株の取得原価
    reserved_jpy: float  # 未約定の買い注文の拘束額
    remaining_jpy: float  # これから新たに買える金額
    realized_pnl_jpy: float
    unrealized_pnl_jpy: float
    total_pnl_jpy: float
    max_loss_jpy: float
    loss_limit_reached: bool
    reinvest_profits: bool
    started_at: str
    holdings: list[BudgetHolding] = field(default_factory=list)

    @property
    def value_jpy(self) -> float:
        """予算の評価額（予算 + 確定損益 + 含み損益）。日次損失の判定に使う。"""
        return self.amount_jpy + self.total_pnl_jpy

    def holding(self, symbol: str) -> BudgetHolding | None:
        return next((h for h in self.holdings if h.symbol == symbol), None)


class BudgetLedger:
    def __init__(
        self,
        settings: BudgetSettings,
        symbols: Iterable[str],
        path: Path,
        clock: Callable[[], datetime] = now_jst,
    ):
        self.s = settings
        self.symbols = list(symbols)
        self.path = path
        self._clock = clock
        if path.exists():
            self.state: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.state = {
                "started_at": clock().isoformat(timespec="seconds"),
                "baseline": {},  # 予算開始（または銘柄の追加）時点で持っていた数量＝あなたの持ち分
                "last_seen": {},  # 前回確認したときの実際の保有数量
                "last_seen_date": clock().astimezone(JST).date().isoformat(),
                "holdings": {},  # Claude の持ち分 {銘柄: {"quantity": 株数, "cost": 取得原価の合計}}
                "realized_pnl": 0.0,
                "attributed": {},  # 注文ごとに、約定として数えた数量
            }

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    @property
    def since_date(self) -> str:
        """この日以降の Claude の注文が、次の照合で約定の候補になる。"""
        return self.state["last_seen_date"]

    # ---- 照合 ----
    def reconcile(
        self, account: AccountSnapshot, orders: list[Order], claude_orders: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """実際の保有数量の増減を台帳に反映し、検出した約定を返す。

        claude_orders は監査ログの Claude の注文（order_placed 等）で、前回の照合日以降のもの。
        """
        st = self.state
        if not account.positions_known:
            return []  # 保有一覧を読めなかったときは、誤った差分を記録しないよう何もしない
        before = json.dumps(st, sort_keys=True)
        fills: list[dict[str, Any]] = []
        for symbol in self.symbols:
            position = account.position(symbol)
            actual = position.quantity if position else 0
            if symbol not in st["last_seen"]:
                st["baseline"][symbol] = actual
                st["last_seen"][symbol] = actual
                continue
            delta = actual - st["last_seen"][symbol]
            if delta > 0:
                fills.extend(self._on_increase(symbol, delta, position, orders, claude_orders))
            elif delta < 0:
                fills.extend(self._on_decrease(symbol, -delta, position, orders, claude_orders))
            st["last_seen"][symbol] = actual
        st["last_seen_date"] = self._clock().astimezone(JST).date().isoformat()
        # 照合の対象から外れた（前回の照合日より前の）注文の割り当て記録は捨てる
        live_keys = {_order_key(e) for e in claude_orders}
        st["attributed"] = {k: v for k, v in st.get("attributed", {}).items() if k in live_keys}
        if json.dumps(st, sort_keys=True) != before:
            self._save()
        return fills

    def _claude_orders(self, claude_orders: list[dict[str, Any]], symbol: str, side: Side) -> list[dict[str, Any]]:
        return [e for e in claude_orders if e.get("symbol") == symbol and e.get("side") == side.value]

    def _allocate(self, mine: list[dict[str, Any]], qty: int) -> list[tuple[dict[str, Any], int]]:
        """Claude の注文のうち、まだ約定として数えていない数量に qty を古い順に割り当てる。

        同じ注文を 2 回数えたり、あなた自身の売買を Claude の注文の約定と取り違えたりしないため。
        戻り値は (注文, 割り当てた数量) のリスト。
        """
        used = self.state.setdefault("attributed", {})
        left = qty
        out = []
        for e in mine:
            key = _order_key(e)
            take = min(int(e.get("quantity") or 0) - used.get(key, 0), left)
            if take > 0:
                used[key] = used.get(key, 0) + take
                left -= take
                out.append((e, take))
        return out

    @staticmethod
    def _price(allocations: list[tuple[dict[str, Any], int]], orders: list[Order], fallback: float) -> float:
        """割り当てた注文ごとの約定価格の加重平均。

        証券会社の約定単価が取れればそれを使い、取れなければ注文の指値で見積もる
        （買いは指値以下、売りは指値以上で約定するので、どちらも予算を少なめに見積もる側になる）。
        """
        total = value = 0.0
        for e, q in allocations:
            ids = {str(x) for x in (e.get("order_id"), e.get("broker_order_no")) if x}
            fill = next((o.avg_fill_price for o in orders if o.avg_fill_price and o.order_id in ids), None)
            price = fill or (float(e["limit_price"]) if e.get("limit_price") else fallback)
            total += q
            value += q * price
        return value / total if total else fallback

    def _on_increase(
        self,
        symbol: str,
        qty: int,
        position: Position | None,
        orders: list[Order],
        claude_orders: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        st = self.state
        allocations = self._allocate(self._claude_orders(claude_orders, symbol, Side.BUY), qty)
        claude_qty = sum(q for _, q in allocations)
        if qty > claude_qty:
            st["baseline"][symbol] = st["baseline"].get(symbol, 0) + qty - claude_qty  # あなた自身の買い
        if claude_qty <= 0:
            return []
        fallback = (position.market_price or position.avg_price or 0.0) if position else 0.0
        price = self._price(allocations, orders, fallback)
        h = st["holdings"].setdefault(symbol, {"quantity": 0, "cost": 0.0})
        h["quantity"] += claude_qty
        h["cost"] += claude_qty * price
        return [{"symbol": symbol, "side": "buy", "quantity": claude_qty, "price": price}]

    def _on_decrease(
        self,
        symbol: str,
        qty: int,
        position: Position | None,
        orders: list[Order],
        claude_orders: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        st = self.state
        h = st["holdings"].get(symbol)
        own = h["quantity"] if h else 0
        allocations = self._allocate(self._claude_orders(claude_orders, symbol, Side.SELL), min(qty, own))
        claude_qty = sum(q for _, q in allocations)
        user_qty = qty - claude_qty
        # Claude の注文によらない減少は、まずあなたの持ち分から減らす。足りなければ Claude の持ち分が減ったとみなす
        from_baseline = min(user_qty, st["baseline"].get(symbol, 0))
        st["baseline"][symbol] = st["baseline"].get(symbol, 0) - from_baseline
        forced = min(user_qty - from_baseline, own - claude_qty)
        fills = []
        for q, price in (
            (claude_qty, self._price(allocations, orders, self._market(position, h))),
            (forced, self._market(position, h)),
        ):
            if q <= 0 or not h:
                continue
            avg = h["cost"] / h["quantity"]
            pnl = (price - avg) * q
            st["realized_pnl"] += pnl
            h["quantity"] -= q
            h["cost"] -= avg * q
            fills.append({"symbol": symbol, "side": "sell", "quantity": q, "price": price, "realized_pnl": pnl})
        if h and h["quantity"] <= 0:
            del st["holdings"][symbol]
        return fills

    @staticmethod
    def _market(position: Position | None, h: dict[str, Any] | None) -> float:
        if position and position.market_price:
            return position.market_price
        return h["cost"] / h["quantity"] if h and h["quantity"] else 0.0

    # ---- 状態 ----
    def claude_quantity(self, symbol: str) -> int:
        h = self.state["holdings"].get(symbol)
        return h["quantity"] if h else 0

    def status(self, account: AccountSnapshot, orders: Iterable[Order]) -> BudgetStatus:
        holdings = []
        invested = unrealized = 0.0
        for symbol, h in sorted(self.state["holdings"].items()):
            avg = h["cost"] / h["quantity"]
            position = account.position(symbol)
            market = position.market_price if position else None
            pnl = (market - avg) * h["quantity"] if market else None
            invested += h["cost"]
            unrealized += pnl or 0.0
            holdings.append(
                BudgetHolding(
                    symbol=symbol,
                    quantity=h["quantity"],
                    avg_cost=round(avg, 2),
                    cost_jpy=round(h["cost"], 1),
                    market_price=market,
                    unrealized_pnl_jpy=None if pnl is None else round(pnl, 1),
                )
            )
        reserved = sum(
            o.remaining_quantity * (o.limit_price or o.avg_fill_price or 0.0)
            for o in orders
            if o.side is Side.BUY and o.status in ACTIVE_STATUSES and o.symbol in self.symbols
        )
        realized = self.state["realized_pnl"]
        capacity = self.s.amount_jpy + (realized if self.s.reinvest_profits else min(realized, 0.0))
        total = realized + unrealized
        return BudgetStatus(
            amount_jpy=self.s.amount_jpy,
            invested_jpy=round(invested, 1),
            reserved_jpy=round(reserved, 1),
            remaining_jpy=round(max(0.0, capacity - invested - reserved), 1),
            realized_pnl_jpy=round(realized, 1),
            unrealized_pnl_jpy=round(unrealized, 1),
            total_pnl_jpy=round(total, 1),
            max_loss_jpy=self.s.max_loss_jpy,
            loss_limit_reached=self.s.max_loss_jpy > 0 and total <= -self.s.max_loss_jpy,
            reinvest_profits=self.s.reinvest_profits,
            started_at=self.state["started_at"],
            holdings=holdings,
        )
