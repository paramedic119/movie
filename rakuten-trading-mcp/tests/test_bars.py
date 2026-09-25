"""日足 CSV での模擬売買（Linux 向け）: CSV の読み込み、確定前・未来の足を見せないこと、日足での約定判定。"""

from datetime import date, datetime

import pytest
from conftest import FakeClock, write_csv

from rakuten_trading_mcp.brokers.bars import DailyBarData, read_bars, write_bars
from rakuten_trading_mcp.brokers.base import BrokerError
from rakuten_trading_mcp.brokers.paper import DailyBarPaperBroker
from rakuten_trading_mcp.models import JST, Bar, Order, OrderRequest, OrderStatus, OrderType, Side

# 2026-04-01 は水曜。04-04/05 は週末
BARS_7203 = [
    ("2026-03-31", 2800, 2830, 2790, 2810),
    ("2026-04-01", 2810, 2850, 2800, 2840),
    ("2026-04-02", 2830, 2870, 2820, 2860),
    ("2026-04-03", 2870, 2900, 2860, 2890),
    ("2026-04-06", 2900, 2950, 2890, 2940),
]


def at(day, hour, minute=0):
    return datetime(2026, 4, day, hour, minute, tzinfo=JST)


@pytest.fixture
def prices(tmp_path):
    directory = tmp_path / "prices"
    write_csv(directory, "7203", BARS_7203)
    return directory


@pytest.fixture
def bar_clock():
    return FakeClock(at(1, 16))  # 水曜の大引け後


@pytest.fixture
def daily(prices, bar_clock):
    return DailyBarData(prices, clock=bar_clock)


@pytest.fixture
def daily_broker(tmp_path, daily, bar_clock):
    return DailyBarPaperBroker(daily, state_path=tmp_path / "paper.json", initial_cash=1_000_000, clock=bar_clock)


def limit(side, qty, price, symbol="7203"):
    return OrderRequest(symbol=symbol, side=side, quantity=qty, order_type=OrderType.LIMIT, limit_price=price)


# ---- CSV ----


def test_japanese_headers_bom_and_days_without_trades(tmp_path):
    path = tmp_path / "7203.csv"
    path.write_text(
        "﻿日付,始値,高値,安値,終値,出来高\n"
        '2026/04/02,2830,2870,2820,"2,860",1200000\n'
        "20260401,2810,2850,2800,2840,1000000\n"
        "2026-04-03,,,,,0\n",  # 売買が成立しなかった日
        encoding="utf-8",
    )
    bars = read_bars(path)
    assert [b.date for b in bars] == ["2026-04-01", "2026-04-02"]
    assert bars[1].close == 2860 and bars[1].volume == 1_200_000


def test_missing_column_is_reported(tmp_path):
    path = tmp_path / "7203.csv"
    path.write_text("Date,Close\n2026-04-01,2840\n", encoding="utf-8")
    with pytest.raises(BrokerError, match="始値"):
        read_bars(path)


def test_round_trip(tmp_path):
    bars = [Bar(date="2026-04-01", time=None, open=1.5, high=2, low=1, close=1.8, volume=None)]
    write_bars(tmp_path / "x.csv", bars)
    assert read_bars(tmp_path / "x.csv") == bars


# ---- 見える足 ----


def test_only_finished_bars_are_visible(daily, bar_clock):
    assert daily.visible_bars("7203")[-1].date == "2026-04-01"
    quote = daily.get_quote("7203")
    assert (quote.last, quote.prev_close, quote.source) == (2840, 2810, "daily-bars")

    bar_clock.now = at(2, 10)  # 取引時間中は、その日の足はまだ確定していない
    assert daily.get_quote("7203").last == 2840
    bar_clock.now = at(2, 15, 30)
    assert daily.get_quote("7203").last == 2860
    assert [b.date for b in daily.get_price_history("7203", "D", 2)] == ["2026-04-01", "2026-04-02"]


def test_only_daily_interval(daily):
    with pytest.raises(BrokerError, match="D"):
        daily.get_price_history("7203", "5M", 10)


def test_missing_symbol_points_to_fetch(daily):
    with pytest.raises(BrokerError, match="fetch"):
        daily.get_quote("6758")


def test_stale_prices_are_refused(prices, bar_clock):
    """日々の模擬売買で古い株価のまま発注しないよう、最新の足が古すぎれば株価を返さない。"""
    data = DailyBarData(prices, clock=bar_clock, max_age_days=10)
    bar_clock.now = datetime(2026, 4, 16, 16, 0, tzinfo=JST)  # 最新の足（04-06）から 10 日
    assert data.get_quote("7203").last == 2940
    bar_clock.now = datetime(2026, 4, 17, 16, 0, tzinfo=JST)
    with pytest.raises(BrokerError, match="fetch"):
        data.get_quote("7203")
    assert len(data.get_price_history("7203", "D", 60)) == 5  # 分析用の過去の足は見られる


def test_trading_dates_are_the_union_of_symbols(prices, daily):
    write_csv(prices, "6758", [("2026-04-01", 1, 1, 1, 1), ("2026-04-07", 1, 1, 1, 1)])
    dates = daily.trading_dates(["7203", "6758"], date(2026, 4, 1), date(2026, 4, 7))
    assert [d.isoformat() for d in dates] == [
        "2026-04-01",
        "2026-04-02",
        "2026-04-03",
        "2026-04-06",
        "2026-04-07",
    ]


# ---- 約定判定 ----


@pytest.mark.parametrize(
    ("side", "limit_price", "bar", "intraday", "expected"),
    [
        # 寄り付き前の注文: 始値で約定しうる
        (Side.BUY, 100, (98, 105, 95, 100), False, 98),
        (Side.BUY, 100, (102, 105, 99, 103), False, 100),
        (Side.BUY, 100, (102, 105, 101, 103), False, None),
        (Side.SELL, 100, (102, 105, 95, 100), False, 102),
        (Side.SELL, 100, (98, 101, 95, 99), False, 100),
        (Side.SELL, 100, (98, 99, 95, 97), False, None),
        # 取引時間中の注文: 始値では約定させず、指値（その日の値幅の中）で
        (Side.BUY, 100, (98, 105, 95, 100), True, 100),
        (Side.BUY, 100, (96, 99, 95, 97), True, 99),
        (Side.SELL, 100, (102, 105, 95, 100), True, 100),
        (Side.SELL, 100, (103, 105, 101, 104), True, 101),
        (Side.SELL, 100, (98, 99, 95, 97), True, None),
    ],
)
def test_fill_price_rules(side, limit_price, bar, intraday, expected):
    order = Order("P1", "7203", side, 100, OrderType.LIMIT, limit_price, OrderStatus.OPEN, "")
    o, h, lo, c = bar
    price = DailyBarPaperBroker._bar_fill_price(order, Bar("2026-04-02", None, o, h, lo, c, None), intraday)
    assert price == expected


def test_market_orders_fill_at_open_before_the_session_and_close_during_it():
    order = Order("P1", "7203", Side.BUY, 100, OrderType.MARKET, None, OrderStatus.OPEN, "")
    bar = Bar("2026-04-02", None, 98, 105, 95, 100, None)
    assert DailyBarPaperBroker._bar_fill_price(order, bar, intraday=False) == 98
    assert DailyBarPaperBroker._bar_fill_price(order, bar, intraday=True) == 100


def test_after_close_order_waits_for_the_next_bar(daily_broker, bar_clock):
    order = daily_broker.place_order(limit(Side.BUY, 100, 2845))  # 04-01 16:00 に発注
    assert order.status is OrderStatus.OPEN and "翌営業日" in order.message
    assert daily_broker.get_account().cash_available == 1_000_000 - 284_500  # 指値分を拘束

    bar_clock.now = at(2, 14)  # 翌日の足はまだ確定していない
    assert daily_broker.list_orders()[0].status is OrderStatus.OPEN

    bar_clock.now = at(2, 15, 30)
    [filled] = daily_broker.list_orders()
    assert filled.status is OrderStatus.FILLED and filled.avg_fill_price == 2830  # 04-02 の始値
    account = daily_broker.get_account()
    assert account.position("7203").quantity == 100
    assert account.equity == 1_000_000 - 283_000 + 100 * 2860


def test_unreached_limit_expires(daily_broker, bar_clock):
    daily_broker.place_order(limit(Side.BUY, 100, 2800))  # 04-02 の安値 2820 に届かない
    bar_clock.now = at(2, 18)
    [order] = daily_broker.list_orders()
    assert order.status is OrderStatus.EXPIRED and "2026-04-02" in order.message
    assert daily_broker.get_account().cash_available == 1_000_000


def test_intraday_order_uses_that_days_bar_without_the_open(daily_broker, bar_clock):
    bar_clock.now = at(2, 10)
    daily_broker.place_order(limit(Side.BUY, 100, 2850))  # 04-02 は始値 2830 だが、10:00 の注文には届かない値段
    bar_clock.now = at(2, 16)
    [order] = daily_broker.list_orders()
    assert order.status is OrderStatus.FILLED and order.avg_fill_price == 2850


def test_weekend_order_uses_mondays_bar(daily_broker, bar_clock):
    bar_clock.now = datetime(2026, 4, 4, 11, 0, tzinfo=JST)  # 土曜
    daily_broker.place_order(limit(Side.BUY, 100, 2950))
    bar_clock.now = at(6, 16)
    [order] = daily_broker.list_orders()
    assert order.status is OrderStatus.FILLED and order.avg_fill_price == 2900  # 月曜の始値
    assert "2026-04-06" in order.message
