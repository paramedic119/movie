"""設定に応じてブローカー（模擬 or 楽天証券 RSS）を組み立てる。"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from ..config import Settings
from ..models import now_jst
from .base import CHART_INTERVALS, Broker, BrokerError, MarketData
from .paper import PaperBroker
from .static import StaticMarketData

__all__ = ["CHART_INTERVALS", "Broker", "BrokerError", "MarketData", "make_broker"]


def make_broker(settings: Settings, clock: Callable[[], datetime] = now_jst) -> Broker:
    if settings.is_live:
        from .rss import RssBroker, RssSession

        return RssBroker(RssSession(settings.rss), settings.data_dir)

    if settings.paper.market_data == "rss":
        from .rss import RssMarketData, RssSession

        market_data: MarketData = RssMarketData(RssSession(settings.rss))
    else:
        market_data = StaticMarketData(Path(settings.paper.static_quotes_file))
    return PaperBroker(
        market_data,
        settings.data_dir / "paper_account.json",
        initial_cash=settings.paper.initial_cash_jpy,
        commission_jpy=settings.paper.commission_jpy,
        clock=clock,
    )
