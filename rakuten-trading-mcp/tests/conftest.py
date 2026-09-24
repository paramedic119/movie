from datetime import datetime, timedelta

import pytest

from rakuten_trading_mcp.brokers.paper import PaperBroker
from rakuten_trading_mcp.brokers.static import StaticMarketData
from rakuten_trading_mcp.config import RiskSettings, Settings
from rakuten_trading_mcp.models import JST
from rakuten_trading_mcp.server import TradingApp


class FakeClock:
    def __init__(self, now: datetime):
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def clock():
    return FakeClock(datetime(2026, 9, 24, 10, 0, tzinfo=JST))  # 木曜 10:00（立会時間中）


@pytest.fixture
def market():
    return StaticMarketData(
        {
            "7203": {"name": "トヨタ自動車", "last": 2850, "prev_close": 2830, "bid": 2849, "ask": 2851},
            "6758": {"name": "ソニーグループ", "last": 3500, "prev_close": 3480, "bid": 3499, "ask": 3501},
            "9432": {"name": "日本電信電話", "last": 150, "prev_close": 151, "bid": 149.9, "ask": 150.1},
        }
    )


@pytest.fixture
def risk_settings():
    return RiskSettings(
        allowed_symbols=["7203", "6758"],
        max_order_value_jpy=500_000,
        max_daily_buy_value_jpy=1_000_000,
        max_position_value_jpy=800_000,
        max_daily_orders=5,
        min_seconds_between_orders=30,
        max_daily_loss_jpy=50_000,
    )


@pytest.fixture
def settings(tmp_path, risk_settings):
    return Settings(data_dir=tmp_path / "data", risk=risk_settings)


@pytest.fixture
def broker(settings, market, clock):
    return PaperBroker(market, settings.data_dir / "paper.json", initial_cash=1_000_000, clock=clock)


@pytest.fixture
def app(settings, broker, clock):
    return TradingApp(settings, broker=broker, clock=clock)
