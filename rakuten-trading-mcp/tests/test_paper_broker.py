from datetime import datetime

import pytest

from rakuten_trading_mcp.brokers.base import BrokerError
from rakuten_trading_mcp.brokers.paper import PaperBroker
from rakuten_trading_mcp.models import JST, OrderRequest, OrderStatus, OrderType, Side


def limit(side, qty, price, symbol="7203"):
    return OrderRequest(symbol=symbol, side=side, quantity=qty, order_type=OrderType.LIMIT, limit_price=price)


def test_marketable_buy_fills_at_ask(broker):
    order = broker.place_order(limit(Side.BUY, 100, 2860))
    assert order.status is OrderStatus.FILLED
    assert order.avg_fill_price == 2851
    account = broker.get_account()
    assert account.cash_available == 1_000_000 - 285_100
    assert account.position("7203").quantity == 100
    assert account.equity == 1_000_000 - 285_100 + 100 * 2850


def test_resting_order_fills_when_price_moves(broker, market):
    order = broker.place_order(limit(Side.BUY, 100, 2800))
    assert order.status is OrderStatus.OPEN
    # 指値分の現金は拘束される
    assert broker.get_account().cash_available == 1_000_000 - 280_000
    market.set_quote("7203", last=2795, ask=2796, bid=2794)
    [o] = broker.list_orders()
    assert o.status is OrderStatus.FILLED
    assert o.avg_fill_price == 2796


def test_sell_realizes_pnl_and_removes_position(broker, market):
    broker.place_order(limit(Side.BUY, 100, 2860))
    market.set_quote("7203", last=2950, bid=2949, ask=2951)
    order = broker.place_order(limit(Side.SELL, 100, 2940))
    assert order.status is OrderStatus.FILLED
    account = broker.get_account()
    assert account.position("7203") is None
    assert account.raw["realized_pnl"] == (2949 - 2851) * 100


def test_broker_rejects_oversell_and_overspend(broker):
    assert broker.place_order(limit(Side.SELL, 100, 2850)).status is OrderStatus.REJECTED
    assert broker.place_order(limit(Side.BUY, 200, 3510, symbol="6758")).status is OrderStatus.FILLED  # 700,200円
    rejected = broker.place_order(limit(Side.BUY, 200, 2860))  # 572,000円 > 残り 299,800円
    assert rejected.status is OrderStatus.REJECTED
    assert "買付余力不足" in rejected.message


def test_cancel(broker):
    order = broker.place_order(limit(Side.BUY, 100, 2800))
    assert broker.cancel_order(order.order_id).status is OrderStatus.CANCELLED
    with pytest.raises(BrokerError):
        broker.cancel_order(order.order_id)
    with pytest.raises(BrokerError):
        broker.cancel_order("P-unknown")


def test_open_orders_expire_next_day(broker, clock):
    order = broker.place_order(limit(Side.BUY, 100, 2800))
    clock.now = datetime(2026, 9, 25, 9, 0, tzinfo=JST)
    # 前日の注文は失効し、一覧（当日分と有効な注文）から外れる。現金の拘束も解除される
    assert all(o.order_id != order.order_id for o in broker.list_orders())
    assert broker.get_account().cash_available == 1_000_000


def test_state_persists_across_instances(broker, settings, market, clock):
    broker.place_order(limit(Side.BUY, 100, 2860))
    again = PaperBroker(market, settings.data_dir / "paper.json", initial_cash=0, clock=clock)
    assert again.get_account().position("7203").quantity == 100
