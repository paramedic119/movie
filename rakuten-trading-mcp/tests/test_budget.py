import pytest

from rakuten_trading_mcp.audit import DailyStats
from rakuten_trading_mcp.budget import BudgetLedger
from rakuten_trading_mcp.config import BudgetSettings
from rakuten_trading_mcp.models import AccountSnapshot, OrderRequest, OrderType, Position, Quote, Side
from rakuten_trading_mcp.risk import RiskManager

SYMBOLS = ["7203", "6758"]


def claude_order(token, side, qty, price, symbol="7203", order_id=None):
    """監査ログの order_placed イベント相当。"""
    return {
        "event": "order_placed",
        "token": token,
        "symbol": symbol,
        "side": side,
        "quantity": qty,
        "limit_price": price,
        "order_id": order_id,
    }


def account(qty, market_price=2850.0, symbol="7203"):
    positions = [Position(symbol=symbol, quantity=qty, market_price=market_price)] if qty else []
    return AccountSnapshot(cash_available=1_000_000, positions=positions)


def limit(side, qty, price, symbol="7203"):
    return OrderRequest(symbol=symbol, side=side, quantity=qty, order_type=OrderType.LIMIT, limit_price=price)


@pytest.fixture
def budget_settings():
    return BudgetSettings(enabled=True, amount_jpy=300_000, max_loss_jpy=20_000)


@pytest.fixture
def ledger(budget_settings, tmp_path, clock):
    return BudgetLedger(budget_settings, SYMBOLS, tmp_path / "budget.json", clock)


def test_claude_buy_uses_budget(ledger, broker):
    ledger.reconcile(broker.get_account(), [], [])  # 予算開始時点の保有（0株）を基準にする
    order = broker.place_order(limit(Side.BUY, 100, 2860))  # 売気配 2,851円で約定
    events = [claude_order("t1", "buy", 100, 2860, order_id=order.order_id)]
    fills = ledger.reconcile(broker.get_account(), broker.list_orders(), events)
    assert fills == [{"symbol": "7203", "side": "buy", "quantity": 100, "price": 2851.0}]
    status = ledger.status(broker.get_account(), broker.list_orders())
    assert status.invested_jpy == 285_100
    assert status.remaining_jpy == 300_000 - 285_100
    assert status.holding("7203").quantity == 100


def test_open_buy_orders_are_reserved(ledger, broker):
    ledger.reconcile(broker.get_account(), [], [])
    broker.place_order(limit(Side.BUY, 100, 2800))  # 約定せずに残る
    status = ledger.status(broker.get_account(), broker.list_orders())
    assert status.reserved_jpy == 280_000
    assert status.remaining_jpy == 20_000


@pytest.mark.parametrize(("reinvest", "remaining"), [(False, 300_000), (True, 309_800)])
def test_sell_realizes_pnl_and_frees_budget(budget_settings, tmp_path, clock, broker, market, reinvest, remaining):
    budget_settings.reinvest_profits = reinvest
    ledger = BudgetLedger(budget_settings, SYMBOLS, tmp_path / "budget.json", clock)
    ledger.reconcile(broker.get_account(), [], [])
    buy = broker.place_order(limit(Side.BUY, 100, 2860))
    orders = [claude_order("t1", "buy", 100, 2860, order_id=buy.order_id)]
    ledger.reconcile(broker.get_account(), broker.list_orders(), orders)
    market.set_quote("7203", last=2950, bid=2949, ask=2951)
    sell = broker.place_order(limit(Side.SELL, 100, 2940))  # 買気配 2,949円で約定
    orders.append(claude_order("t2", "sell", 100, 2940, order_id=sell.order_id))
    fills = ledger.reconcile(broker.get_account(), broker.list_orders(), orders)
    assert fills[0]["realized_pnl"] == pytest.approx((2949 - 2851) * 100)
    status = ledger.status(broker.get_account(), broker.list_orders())
    assert status.holdings == []
    assert status.realized_pnl_jpy == 9_800
    assert status.remaining_jpy == remaining


def test_loss_limit(ledger):
    ledger.reconcile(account(0), [], [])
    ledger.reconcile(account(100, 2851), [], [claude_order("t1", "buy", 100, 2851)])
    status = ledger.status(account(100, market_price=2600), [])
    assert status.unrealized_pnl_jpy == (2600 - 2851) * 100
    assert status.loss_limit_reached
    assert status.value_jpy == 300_000 - 25_100


def test_existing_holdings_are_yours(ledger):
    ledger.reconcile(account(200), [], [])  # 予算開始前から 200 株持っている
    assert ledger.state["baseline"]["7203"] == 200
    assert ledger.status(account(200), []).holdings == []


def test_manual_trades_are_not_attributed_to_claude(ledger):
    ledger.reconcile(account(0), [], [])
    ledger.reconcile(account(100), [], [])  # Claude の注文なしで増えた → あなた自身の買い
    assert ledger.state["baseline"]["7203"] == 100
    assert ledger.claude_quantity("7203") == 0

    orders = [claude_order("t1", "buy", 100, 2860)]
    ledger.reconcile(account(200), [], orders)  # Claude の買いが約定（約定単価が取れないので指値で見積もる）
    assert ledger.claude_quantity("7203") == 100
    assert ledger.state["holdings"]["7203"]["cost"] == 286_000
    ledger.reconcile(account(200), [], orders)  # 変化なし
    ledger.reconcile(account(300), [], orders)  # 同じ日にあなたが手で 100 株買った（Claude の注文は数え済み）
    assert ledger.claude_quantity("7203") == 100
    assert ledger.state["baseline"]["7203"] == 200

    ledger.reconcile(account(100), [], orders)  # あなたが手で 200 株売った（Claude の売り注文はない）
    assert ledger.claude_quantity("7203") == 100
    assert ledger.state["baseline"]["7203"] == 0


def test_each_fill_is_priced_by_its_own_order(ledger, broker, market):
    """同じ日に同じ銘柄を 2 回買っても、それぞれの注文の約定単価で原価を積む。"""
    ledger.reconcile(broker.get_account(), [], [])
    first = broker.place_order(limit(Side.BUY, 100, 2860))  # 2,851円で約定
    events = [claude_order("t1", "buy", 100, 2860, order_id=first.order_id)]
    ledger.reconcile(broker.get_account(), broker.list_orders(), events)
    market.set_quote("7203", last=2900, bid=2899, ask=2901)
    second = broker.place_order(limit(Side.BUY, 100, 2910))  # 2,901円で約定
    events.append(claude_order("t2", "buy", 100, 2910, order_id=second.order_id))
    ledger.reconcile(broker.get_account(), broker.list_orders(), events)
    assert ledger.state["holdings"]["7203"] == {"quantity": 200, "cost": 285_100 + 290_100}


def test_fill_is_not_priced_by_an_earlier_cancelled_order(ledger, broker, market):
    """取り消した売り注文のあとに出し直した売りが約定したら、出し直した注文の約定単価で損益を計算する。"""
    ledger.reconcile(broker.get_account(), [], [])
    buy = broker.place_order(limit(Side.BUY, 100, 2860))  # 2,851円で約定
    events = [claude_order("t1", "buy", 100, 2860, order_id=buy.order_id)]
    ledger.reconcile(broker.get_account(), broker.list_orders(), events)
    first = broker.place_order(limit(Side.SELL, 100, 2950))  # 届かずに残る
    broker.cancel_order(first.order_id)
    second = broker.place_order(limit(Side.SELL, 100, 2840))  # 買気配 2,849円で約定
    events += [
        claude_order("t2", "sell", 100, 2950, order_id=first.order_id),
        claude_order("t3", "sell", 100, 2840, order_id=second.order_id),
    ]
    [fill] = ledger.reconcile(broker.get_account(), broker.list_orders(), events)
    assert fill["price"] == 2849 and fill["realized_pnl"] == pytest.approx((2849 - 2851) * 100)
    assert ledger.state["attributed"] == {"t1": 100, "t3": 100}


def test_fill_falls_back_to_ended_orders_when_fills_are_unreadable(ledger):
    """約定数量が読めず、注文が取消扱いに見えても、保有が増えたら Claude の買いとして予算に数える（安全側）。"""
    from rakuten_trading_mcp.models import Order, OrderStatus

    ledger.reconcile(account(0), [], [])
    cancelled = Order(
        order_id="100",
        symbol="7203",
        side=Side.BUY,
        quantity=100,
        order_type=OrderType.LIMIT,
        limit_price=2860,
        status=OrderStatus.CANCELLED,
        created_at="",
    )
    events = [claude_order("t1", "buy", 100, 2860, order_id="100")]
    [fill] = ledger.reconcile(account(100), [cancelled], events)
    assert fill["quantity"] == 100 and fill["price"] == 2860
    assert ledger.state["baseline"]["7203"] == 0


def test_unreadable_holdings_do_not_change_the_ledger(ledger):
    ledger.reconcile(account(0), [], [])
    ledger.reconcile(account(100, 2851), [], [claude_order("t1", "buy", 100, 2851)])
    unreadable = AccountSnapshot(cash_available=None, positions=[], positions_known=False)
    assert ledger.reconcile(unreadable, [], []) == []
    assert ledger.claude_quantity("7203") == 100
    assert ledger.state["last_seen"]["7203"] == 100


def test_state_persists(ledger, budget_settings, tmp_path, clock):
    ledger.reconcile(account(0), [], [])
    ledger.reconcile(account(100), [], [claude_order("t1", "buy", 100, 2860)])
    again = BudgetLedger(budget_settings, SYMBOLS, tmp_path / "budget.json", clock)
    assert again.claude_quantity("7203") == 100


QUOTE = Quote(symbol="7203", last=2850, prev_close=2830, bid=2849, ask=2851)


def test_risk_uses_budget(ledger, risk_settings, tmp_path, clock):
    risk = RiskManager(risk_settings, tmp_path, clock)
    ledger.reconcile(account(0), [], [])
    ledger.reconcile(account(100, 2851), [], [claude_order("t1", "buy", 100, 2851)])
    status = ledger.status(account(100), [])  # 残り 300,000 − 285,100 = 14,900円
    over = risk.evaluate(limit(Side.BUY, 100, 2850), QUOTE, account(100), DailyStats(), budget=status)
    assert any("予算の残り" in v for v in over.violations)
    assert risk.evaluate(limit(Side.SELL, 100, 2850), QUOTE, account(100), DailyStats(), budget=status).allowed
    too_many = risk.evaluate(limit(Side.SELL, 200, 2850), QUOTE, account(300), DailyStats(), budget=status)
    assert any("予算で買った" in v for v in too_many.violations)


def test_risk_blocks_buys_after_budget_loss(ledger, risk_settings, tmp_path, clock):
    risk = RiskManager(risk_settings, tmp_path, clock)
    ledger.reconcile(account(0), [], [])
    ledger.reconcile(account(100, 2851), [], [claude_order("t1", "buy", 100, 2851)])
    status = ledger.status(account(100, market_price=2600), [])
    quote = Quote(symbol="7203", last=2600, bid=2599, ask=2601)
    buy = risk.evaluate(limit(Side.BUY, 100, 2600), quote, account(100, 2600), DailyStats(), budget=status)
    assert any("損失上限" in v for v in buy.violations)
    assert risk.evaluate(limit(Side.SELL, 100, 2600), quote, account(100, 2600), DailyStats(), budget=status).allowed
