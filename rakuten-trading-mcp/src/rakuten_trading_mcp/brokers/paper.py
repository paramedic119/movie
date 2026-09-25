"""ペーパートレード（模擬売買）。状態は JSON ファイルに保存する。

約定ルール（単純化）:
- 買い: 売気配（無ければ現在値）が指値以下なら、その価格で全数量約定。成行は売気配/現在値で約定。
- 売り: 買気配（無ければ現在値）が指値以上なら、その価格で全数量約定。
- 未約定の注文は、口座や注文一覧を照会したときに最新の株価で再判定する。当日中に約定しなければ失効。
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ..market_hours import CLOSE_TIME, OPEN_TIME
from ..models import (
    ACTIVE_STATUSES,
    JST,
    AccountSnapshot,
    Bar,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Quote,
    Side,
    now_jst,
)
from .bars import DailyBarData
from .base import Broker, BrokerError, MarketData


def _order_from_dict(d: dict[str, Any]) -> Order:
    return Order(
        **{
            **d,
            "side": Side(d["side"]),
            "order_type": OrderType(d["order_type"]),
            "status": OrderStatus(d["status"]),
        }
    )


class PaperBroker(Broker):
    name = "paper"
    live = False

    def __init__(
        self,
        market_data: MarketData,
        state_path: Path,
        initial_cash: float,
        commission_jpy: float = 0.0,
        clock: Callable[[], datetime] = now_jst,
    ):
        super().__init__(market_data)
        self._path = state_path
        self._commission = commission_jpy
        self._clock = clock
        self._lock = threading.RLock()
        if state_path.exists():
            self._state = json.loads(state_path.read_text(encoding="utf-8"))
        else:
            self._state = {"cash": float(initial_cash), "positions": {}, "orders": [], "seq": 0, "realized_pnl": 0.0}
            self._save()

    # ---- 永続化 ----
    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)

    def _orders(self) -> list[Order]:
        return [_order_from_dict(d) for d in self._state["orders"]]

    def _store(self, order: Order) -> None:
        data = asdict(order)
        for i, d in enumerate(self._state["orders"]):
            if d["order_id"] == order.order_id:
                self._state["orders"][i] = data
                break
        else:
            self._state["orders"].append(data)

    # ---- 約定処理 ----
    def _today(self) -> str:
        return self._clock().astimezone(JST).date().isoformat()

    def _refresh(self) -> None:
        """前日以前の未約定注文を失効させ、当日の未約定注文を最新価格で再判定する。"""
        today = self._today()
        changed = False
        for order in self._orders():
            if order.status is not OrderStatus.OPEN:
                continue
            if order.created_at[:10] < today:
                order.status = OrderStatus.EXPIRED
                order.message = "当日中に約定しなかったため失効（模擬）"
                self._store(order)
                changed = True
                continue
            try:
                quote = self.market_data.get_quote(order.symbol)
            except BrokerError:
                continue
            if self._try_fill(order, quote):
                self._store(order)
                changed = True
        if changed:
            self._save()

    @staticmethod
    def _fill_price(order: Order, q: Quote) -> float | None:
        if order.side is Side.BUY:
            price = q.ask or q.last
            if price is None:
                return None
            if order.order_type is OrderType.MARKET or price <= (order.limit_price or 0):
                return price
            return None
        price = q.bid or q.last
        if price is None:
            return None
        if order.order_type is OrderType.MARKET or price >= (order.limit_price or float("inf")):
            return price
        return None

    def _try_fill(self, order: Order, quote: Quote) -> bool:
        price = self._fill_price(order, quote)
        if price is None:
            return False
        self._apply_fill(order, price, "約定（模擬）")
        return True

    def _apply_fill(self, order: Order, price: float, message: str) -> None:
        qty = order.quantity
        positions = self._state["positions"]
        pos = positions.get(order.symbol, {"quantity": 0, "avg_price": 0.0})
        if order.side is Side.BUY:
            self._state["cash"] -= qty * price + self._commission
            total = pos["quantity"] + qty
            pos["avg_price"] = (pos["quantity"] * pos["avg_price"] + qty * price) / total
            pos["quantity"] = total
            positions[order.symbol] = pos
        else:
            self._state["cash"] += qty * price - self._commission
            self._state["realized_pnl"] += (price - pos["avg_price"]) * qty - self._commission
            pos["quantity"] -= qty
            if pos["quantity"] <= 0:
                positions.pop(order.symbol, None)
            else:
                positions[order.symbol] = pos
        order.status = OrderStatus.FILLED
        order.filled_quantity = qty
        order.avg_fill_price = price
        order.message = message

    def _on_placed(self, order: Order, quote: Quote) -> None:
        """発注直後の処理。気配値で判定できるものはその場で約定させる。"""
        self._try_fill(order, quote)

    def all_orders(self) -> list[Order]:
        """模擬口座のすべての注文（成績の集計用）。"""
        with self._lock:
            self._refresh()
            return self._orders()

    def _reserved_cash(self) -> float:
        return sum(
            o.remaining_quantity * (o.limit_price or 0)
            for o in self._orders()
            if o.side is Side.BUY and o.status is OrderStatus.OPEN
        )

    # ---- Broker インターフェース ----
    def get_account(self) -> AccountSnapshot:
        with self._lock:
            self._refresh()
            cash = self._state["cash"]
            equity = cash
            positions = []
            for symbol, p in sorted(self._state["positions"].items()):
                try:
                    quote = self.market_data.get_quote(symbol)
                    market_price, name = quote.reference_price(), quote.name
                except BrokerError:
                    market_price, name = None, None
                qty, avg = p["quantity"], p["avg_price"]
                positions.append(
                    Position(
                        symbol=symbol,
                        quantity=qty,
                        avg_price=round(avg, 2),
                        name=name,
                        market_price=market_price,
                        unrealized_pnl=round((market_price - avg) * qty, 1) if market_price else None,
                    )
                )
                equity += qty * (market_price or avg)
            return AccountSnapshot(
                cash_available=round(cash - self._reserved_cash(), 1),
                positions=positions,
                equity=round(equity, 1),
                raw={"cash": round(cash, 1), "realized_pnl": round(self._state["realized_pnl"], 1)},
            )

    def list_orders(self) -> list[Order]:
        with self._lock:
            self._refresh()
            today = self._today()
            return [o for o in self._orders() if o.created_at[:10] == today or o.status in ACTIVE_STATUSES]

    def place_order(self, request: OrderRequest) -> Order:
        with self._lock:
            self._refresh()
            quote = self.market_data.get_quote(request.symbol)
            now = self._clock().astimezone(JST)
            self._state["seq"] += 1
            order = Order(
                order_id=f"P{now:%Y%m%d}-{self._state['seq']:04d}",
                symbol=request.symbol,
                side=request.side,
                quantity=request.quantity,
                order_type=request.order_type,
                limit_price=request.limit_price,
                status=OrderStatus.OPEN,
                created_at=now.isoformat(timespec="seconds"),
            )
            reject = self._broker_side_check(request, quote)
            if reject:
                order.status, order.message = OrderStatus.REJECTED, reject
            else:
                self._on_placed(order, quote)
            self._store(order)
            self._save()
            return order

    def _broker_side_check(self, request: OrderRequest, quote: Quote) -> str | None:
        """実際の証券会社と同様に、余力・保有数量が足りない注文は受け付けない。"""
        if request.side is Side.BUY:
            price = request.limit_price if request.order_type is OrderType.LIMIT else (quote.ask or quote.last)
            if not price:
                return "価格が取得できないため受付できません（模擬）"
            available = self._state["cash"] - self._reserved_cash()
            if request.quantity * price + self._commission > available:
                return f"買付余力不足（必要 {request.quantity * price:,.0f}円 / 余力 {available:,.0f}円）"
            return None
        held = self._state["positions"].get(request.symbol, {}).get("quantity", 0)
        committed = sum(
            o.remaining_quantity
            for o in self._orders()
            if o.symbol == request.symbol and o.side is Side.SELL and o.status is OrderStatus.OPEN
        )
        if request.quantity > held - committed:
            return f"売却可能数量不足（保有 {held}株 / 発注中 {committed}株）"
        return None

    def cancel_order(self, order_id: str) -> Order:
        with self._lock:
            self._refresh()
            order = next((o for o in self._orders() if o.order_id == order_id), None)
            if order is None:
                raise BrokerError(f"注文 {order_id} が見つかりません")
            if order.status is not OrderStatus.OPEN:
                raise BrokerError(f"注文 {order_id} は状態が {order.status} のため取消できません")
            order.status = OrderStatus.CANCELLED
            order.message = "取消（模擬）"
            self._store(order)
            self._save()
            return order


class DailyBarPaperBroker(PaperBroker):
    """日足（四本値）で約定を判定する模擬売買。リアルタイムの株価が無い環境（Linux など）向け。

    どの日の足で判定するか:
    - 大引け後・休日に出した注文は翌営業日の足、平日の大引け前に出した注文はその日の足。
    - その足が確定する（大引け後にデータが入る）まで、注文は未約定のまま待つ。
    約定価格（簡易モデル）:
    - 寄り付き前に出した注文（前日の大引け後・休日を含む）: 買いの指値は、始値が指値以下なら始値、安値が指値以下なら指値。
      売りの指値は、始値が指値以上なら始値、高値が指値以上なら指値。成行は始値。
    - 取引時間中に出した注文: 寄り付きの値段では買えないので、指値に届いていれば指値（その日の値幅の中に収める）。
      成行は終値。どちらも実際より不利になりうる、控えめな見積もり。
    - 指値に届かなければ失効（本日中の注文）。
    """

    market_data: DailyBarData

    def _on_placed(self, order: Order, quote: Quote) -> None:
        order.message = "日足で約定を判定します（大引け前の注文はその日、大引け後・休日の注文は翌営業日の足）"

    @staticmethod
    def _bar_fill_price(order: Order, bar: Bar, intraday: bool) -> float | None:
        close = bar.close
        open_ = bar.open if bar.open is not None else close
        high = bar.high if bar.high is not None else max(open_, close)
        low = bar.low if bar.low is not None else min(open_, close)
        if order.order_type is OrderType.MARKET:
            return close if intraday else open_
        limit = order.limit_price or 0.0
        if order.side is Side.BUY:
            if low > limit:
                return None
            return min(limit, high) if intraday else min(limit, open_)
        if high < limit:
            return None
        return max(limit, low) if intraday else max(limit, open_)

    def _refresh(self) -> None:
        changed = False
        for order in self._orders():
            if order.status is not OrderStatus.OPEN:
                continue
            created = datetime.fromisoformat(order.created_at).astimezone(JST)
            same_day = created.weekday() < 5 and created.time() < CLOSE_TIME
            try:
                bar = self.market_data.first_bar_after(order.symbol, created.date(), inclusive=same_day)
            except BrokerError:
                continue  # その銘柄の日足が読めなければ、未約定のまま次の機会に判定する
            if bar is None:
                continue
            intraday = same_day and created.time() >= OPEN_TIME and bar.date == created.date().isoformat()
            price = self._bar_fill_price(order, bar, intraday)
            if price is None:
                order.status = OrderStatus.EXPIRED
                order.message = f"{bar.date} の値動きでは指値に届かず失効（模擬・本日中の注文）"
            else:
                self._apply_fill(order, price, f"{bar.date} の日足で約定（模擬）")
            self._store(order)
            changed = True
        if changed:
            self._save()

    def list_orders(self) -> list[Order]:
        with self._lock:
            self._refresh()
            since = (self._clock().astimezone(JST).date() - timedelta(days=7)).isoformat()
            return [o for o in self._orders() if o.created_at[:10] >= since or o.status in ACTIVE_STATUSES]
