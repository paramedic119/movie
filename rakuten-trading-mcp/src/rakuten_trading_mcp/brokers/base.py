"""証券会社（またはその模擬）との接続部分の共通インターフェース。

ここのメソッドは同期（ブロッキング）で、サーバー側がワーカースレッドから呼ぶ。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import AccountSnapshot, Bar, Order, OrderRequest, Quote

CHART_INTERVALS = ("1M", "5M", "10M", "15M", "30M", "60M", "D", "W", "M")


class BrokerError(Exception):
    """証券会社側・RSS 連携側のエラー（メッセージはそのまま Claude に返す）。"""


class MarketData(ABC):
    @abstractmethod
    def get_quote(self, symbol: str) -> Quote: ...

    def get_price_history(self, symbol: str, interval: str, count: int) -> list[Bar]:
        raise BrokerError("このデータソースは価格履歴に対応していません")

    def close(self) -> None:  # noqa: B027  後片付けが必要なデータソースだけ上書きする
        pass


class Broker(ABC):
    name: str
    live: bool

    def __init__(self, market_data: MarketData):
        self.market_data = market_data

    @abstractmethod
    def get_account(self) -> AccountSnapshot: ...

    @abstractmethod
    def list_orders(self) -> list[Order]: ...

    @abstractmethod
    def place_order(self, request: OrderRequest) -> Order: ...

    @abstractmethod
    def cancel_order(self, order_id: str) -> Order: ...

    def close(self) -> None:
        self.market_data.close()
