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
from datetime import datetime
from pathlib import Path
from typing import Any

from ..models import (
    ACTIVE_STATUSES,
    JST,
    AccountSnapshot,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Quote,
    Side,
    now_jst,
)
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
        order.message = "約定（模擬）"
        return True

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
                self._try_fill(order, quote)
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
