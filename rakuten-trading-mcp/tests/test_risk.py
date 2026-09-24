from datetime import datetime, timedelta

import pytest

from rakuten_trading_mcp.audit import DailyStats
from rakuten_trading_mcp.models import (
    JST,
    AccountSnapshot,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Quote,
    Side,
)
from rakuten_trading_mcp.risk import RiskManager

QUOTE = Quote(symbol="7203", name="トヨタ自動車", last=2850, prev_close=2830, bid=2849, ask=2851)
ACCOUNT = AccountSnapshot(
    cash_available=1_000_000, positions=[Position(symbol="7203", quantity=100, avg_price=2800)], equity=1_280_000
)


def buy(qty=100, price=2850.0, symbol="7203", order_type=OrderType.LIMIT):
    return OrderRequest(symbol=symbol, side=Side.BUY, quantity=qty, order_type=order_type, limit_price=price)


def sell(qty=100, price=2850.0):
    return OrderRequest(symbol="7203", side=Side.SELL, quantity=qty, order_type=OrderType.LIMIT, limit_price=price)


@pytest.fixture
def risk(risk_settings, tmp_path, clock):
    return RiskManager(risk_settings, tmp_path, clock)


def test_reasonable_limit_order_is_allowed(risk):
    d = risk.evaluate(buy(), QUOTE, ACCOUNT, DailyStats())
    assert d.allowed, d.violations
    assert d.notional_jpy == 285_000
    assert d.reference_price == 2850


@pytest.mark.parametrize(
    ("req", "fragment"),
    [
        (buy(qty=150), "100 株単位"),
        (buy(qty=0), "100 株単位"),
        (buy(symbol="9984"), "許可リスト"),
        (buy(price=3000), "離れています"),
        (buy(price=None), "limit_price"),
        (buy(order_type=OrderType.MARKET, price=None), "成行注文は無効"),
        (buy(qty=200), "1 注文の上限"),  # 570,000円 > 500,000円
        (sell(qty=200), "売却可能数量"),
    ],
)
def test_violations(risk, req, fragment):
    d = risk.evaluate(req, QUOTE, ACCOUNT, DailyStats())
    assert not d.allowed
    assert any(fragment in v for v in d.violations), d.violations


def test_daily_buy_value_limit(risk):
    d = risk.evaluate(buy(), QUOTE, ACCOUNT, DailyStats(buy_value_jpy=800_000))
    assert any("本日の買付金額" in v for v in d.violations)


def test_insufficient_cash(risk):
    poor = AccountSnapshot(cash_available=100_000, positions=[], equity=100_000)
    d = risk.evaluate(buy(), QUOTE, poor, DailyStats())
    assert any("買付余力" in v for v in d.violations)


def test_unknown_cash_is_a_warning_not_a_violation(risk):
    unknown = AccountSnapshot(cash_available=None, positions=[], equity=None)
    d = risk.evaluate(buy(), QUOTE, unknown, DailyStats())
    assert d.allowed
    assert any("買付余力" in w for w in d.warnings)


def test_position_limit(risk):
    big = AccountSnapshot(cash_available=5_000_000, positions=[Position(symbol="7203", quantity=200, avg_price=2800)])
    d = risk.evaluate(buy(), QUOTE, big, DailyStats())  # 保有 570,000 + 285,000 > 800,000
    assert any("1 銘柄の上限" in v for v in d.violations)


def test_open_sell_orders_reduce_sellable_quantity(risk):
    open_sell = Order(
        "P1", "7203", Side.SELL, 100, OrderType.LIMIT, 2900, OrderStatus.OPEN, "2026-09-24T09:30:00+09:00"
    )
    d = risk.evaluate(sell(), QUOTE, ACCOUNT, DailyStats(), [open_sell])
    assert any("売却可能数量" in v for v in d.violations)


def test_market_closed(risk, clock):
    clock.now = datetime(2026, 9, 24, 20, 0, tzinfo=JST)
    assert any("取引時間外" in v for v in risk.evaluate(buy(), QUOTE, ACCOUNT, DailyStats()).violations)
    clock.now = datetime(2026, 9, 26, 10, 0, tzinfo=JST)  # 土曜
    assert any("取引時間外" in v for v in risk.evaluate(buy(), QUOTE, ACCOUNT, DailyStats()).violations)


def test_configured_holiday(risk, risk_settings, clock):
    risk_settings.market_holidays = ["2026-09-24"]
    assert any("取引時間外" in v for v in risk.evaluate(buy(), QUOTE, ACCOUNT, DailyStats()).violations)


def test_kill_switch(risk):
    risk.kill_switch_path.touch()
    d = risk.evaluate(buy(), QUOTE, ACCOUNT, DailyStats())
    assert any("キルスイッチ" in v for v in d.violations)


def test_order_count_and_interval(risk, clock):
    stats = DailyStats(orders_placed=5)
    assert any("発注回数" in v for v in risk.evaluate(buy(), QUOTE, ACCOUNT, stats).violations)
    stats = DailyStats(orders_placed=1, last_order_at=clock.now - timedelta(seconds=10))
    assert any("秒しか経っていません" in v for v in risk.evaluate(buy(), QUOTE, ACCOUNT, stats).violations)


def test_daily_loss_blocks_buys_but_not_sells(risk):
    stats = DailyStats(day_start_equity=1_400_000)  # 現在 1,280,000 → 12万円の損失
    assert any("評価損失" in v for v in risk.evaluate(buy(), QUOTE, ACCOUNT, stats).violations)
    assert risk.evaluate(sell(), QUOTE, ACCOUNT, stats).allowed


def test_missing_price_is_rejected(risk):
    d = risk.evaluate(buy(), Quote(symbol="7203"), ACCOUNT, DailyStats())
    assert any("基準価格" in v for v in d.violations)


def test_cancel_limit(risk):
    assert risk.evaluate_cancel(DailyStats(cancels=9)) == []
    assert risk.evaluate_cancel(DailyStats(cancels=10))
