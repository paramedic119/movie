"""サーバー内で共通に使うデータ型。"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Any

# 日本の取引所は夏時間が無いので固定オフセットで十分（Windows で tzdata 不要にするため）。
JST = timezone(timedelta(hours=9), "JST")


def now_jst() -> datetime:
    return datetime.now(JST)


# 東証の銘柄コード: 4桁数字、または 2024年以降の英字入りコード（例: 130A）。
_SYMBOL_RE = re.compile(r"^([0-9][0-9A-Z]{3})(?:\.T)?$")


def normalize_symbol(raw: str) -> str:
    """'7203' / '7203.T' / '130a' などを '7203' / '130A' 形式にそろえる。"""
    m = _SYMBOL_RE.match(raw.strip().upper())
    if not m:
        raise ValueError(f"銘柄コードの形式が不正です: {raw!r}（例: 7203, 7203.T, 130A）")
    return m.group(1)


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"

    @property
    def label(self) -> str:
        return "買い" if self is Side.BUY else "売り"


class OrderType(StrEnum):
    LIMIT = "limit"
    MARKET = "market"

    @property
    def label(self) -> str:
        return "指値" if self is OrderType.LIMIT else "成行"


class OrderStatus(StrEnum):
    OPEN = "open"  # 発注済み・未約定
    FILLED = "filled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    REJECTED = "rejected"
    SUBMITTED = "submitted"  # 証券会社へ送信済みだが状態を確認できていない（RSS）
    UNKNOWN = "unknown"


ACTIVE_STATUSES = frozenset({OrderStatus.OPEN, OrderStatus.SUBMITTED, OrderStatus.UNKNOWN})


@dataclass
class Quote:
    symbol: str
    name: str | None = None
    last: float | None = None
    prev_close: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None
    bid: float | None = None
    ask: float | None = None
    time: str | None = None
    source: str = ""

    def reference_price(self) -> float | None:
        """リスク判定に使う基準価格（現在値。寄り前などで無ければ前日終値）。"""
        return self.last or self.prev_close or None


@dataclass
class Bar:
    date: str
    time: str | None
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float | None


@dataclass
class Position:
    symbol: str
    quantity: int
    avg_price: float | None = None
    name: str | None = None
    market_price: float | None = None
    unrealized_pnl: float | None = None
    raw: dict[str, Any] | None = None


@dataclass
class AccountSnapshot:
    cash_available: float | None  # 現物買付余力（取得できない場合は None）
    positions: list[Position] = field(default_factory=list)
    equity: float | None = None  # 現金 + 保有株評価額（取得できる場合）
    raw: dict[str, Any] | None = None

    def position(self, symbol: str) -> Position | None:
        return next((p for p in self.positions if p.symbol == symbol), None)


@dataclass
class OrderRequest:
    symbol: str
    side: Side
    quantity: int
    order_type: OrderType
    limit_price: float | None = None

    def describe(self) -> str:
        price = f"{self.limit_price:,.1f}円" if self.order_type is OrderType.LIMIT else ""
        return f"{self.side.label} {self.symbol} {self.quantity:,}株 {self.order_type.label}{price}"


@dataclass
class Order:
    order_id: str
    symbol: str
    side: Side
    quantity: int
    order_type: OrderType
    limit_price: float | None
    status: OrderStatus
    created_at: str
    filled_quantity: int = 0
    avg_fill_price: float | None = None
    broker_order_no: str | None = None
    message: str | None = None
    raw: dict[str, Any] | None = None

    @property
    def remaining_quantity(self) -> int:
        return self.quantity - self.filled_quantity


def to_dict(obj: Any) -> Any:
    """dataclass（とそのリスト）を JSON 化しやすい dict に変換する。None の項目は省く。"""
    if isinstance(obj, list):
        return [to_dict(o) for o in obj]
    return {k: v for k, v in asdict(obj).items() if v is not None}
