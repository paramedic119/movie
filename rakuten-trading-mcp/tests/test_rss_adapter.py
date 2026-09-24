"""RSS 連携部分のテスト（Excel の代わりに偽のセッションを使う）。

実機（Windows + Excel + マーケットスピード II RSS）なしで確認できるのは、
- 発注関数に渡す引数の順番とコード値
- 一覧シートの読み取り（見出しの検出・列名の候補・数値の変換）
- 発注IDの採番と永続化
まで。実際の RSS の挙動は README の手順で実機確認が必要。
"""

import re

import pytest

from rakuten_trading_mcp.brokers.base import BrokerError
from rakuten_trading_mcp.brokers.rss import (
    LIST_SHEETS,
    MARKET_SHEET,
    RssBroker,
    RssMarketData,
    RssSession,
    _labeled_value,
    _parse_table,
    _status_from_text,
)
from rakuten_trading_mcp.config import RssSettings
from rakuten_trading_mcp.models import OrderRequest, OrderStatus, OrderType, Side

MISSING = object()


class FakeCell:
    Formula = ""


class FakeSheet:
    def __init__(self):
        self.grid: list[list] = []
        self.a1 = FakeCell()

    def Range(self, address):
        assert address == "A1"
        return self.a1


class GridCell:
    def __init__(self, sheet, r, c):
        self.sheet, self.key = sheet, (r, c)

    @property
    def Value(self):
        return self.sheet.values.get(self.key)

    @Value.setter
    def Value(self, value):
        self.sheet.values[self.key] = value

    @property
    def Formula(self):
        return self.sheet.formulas.get(self.key, "")

    @Formula.setter
    def Formula(self, formula):
        self.sheet.formulas[self.key] = formula
        self.sheet.values[self.key] = self.sheet.evaluate(formula)


class GridRange:
    def __init__(self, sheet, a, b):
        (self.r1, self.c1), (self.r2, self.c2), self.sheet = a.key, b.key, sheet

    @property
    def Value(self):
        cols = range(self.c1, self.c2 + 1)
        return tuple(tuple(self.sheet.values.get((r, c)) for c in cols) for r in range(self.r1, self.r2 + 1))

    @Value.setter
    def Value(self, row):  # 1 行分の書き込みだけ対応
        for j, v in enumerate(row):
            self.sheet.values[(self.r1, self.c1 + j)] = v


class GridSheet:
    """セル単位で読み書きできる偽のワークシート。=RssMarket("コード","項目") を市場データの dict から計算する。"""

    def __init__(self, market):
        self.values, self.formulas, self.market = {}, {}, market
        sheet = self

        class _Cells:
            def __call__(self, r, c):
                return GridCell(sheet, r, c)

            def ClearContents(self):
                sheet.values.clear()
                sheet.formulas.clear()

        self.Cells = _Cells()

    def Range(self, a, b):
        return GridRange(self, a, b)

    def evaluate(self, formula):
        m = re.fullmatch(r'=RssMarket\("([^"]+)","([^"]+)"\)', formula)
        return self.market.get(m.group(1), {}).get(m.group(2)) if m else None


class FakeSession(RssSession):
    """COM を使わない RssSession。Run の呼び出しを記録し、RssOrderIDList の結果行を模擬する。"""

    def __init__(self, settings: RssSettings, order_result: str = "発注成功", market=None):
        self.s = settings
        self.sheets: dict[str, FakeSheet | GridSheet] = {MARKET_SHEET: GridSheet(market or {})}
        self.runs: list[tuple[str, tuple]] = []
        self.order_result = order_result
        self.sheet(LIST_SHEETS["order_ids"]).grid = [["発注ID", "関数名", "注文番号", "発注結果"]]

    def call(self, fn, *args, retry=True):
        return fn(*args)

    def sheet(self, name):
        return self.sheets.setdefault(name, FakeSheet())

    def set_formula(self, cell, formula):
        cell.Formula = formula

    def blank_argument(self):
        return MISSING

    def read_grid(self, ws):
        return ws.grid

    def run(self, function, *args):
        self.runs.append((function, args))
        if function == "RssStockOrder_v":
            order_id = args[0]
            self.sheet(LIST_SHEETS["order_ids"]).grid.append(
                [order_id, function, f"N{order_id:04d}", self.order_result]
            )
        return 0


@pytest.fixture
def rss_settings():
    return RssSettings(order_result_timeout_seconds=0.3, calc_timeout_seconds=0.3)


@pytest.fixture
def session(rss_settings):
    return FakeSession(rss_settings)


@pytest.fixture
def rss(session, tmp_path):
    return RssBroker(session, tmp_path)


def test_limit_buy_arguments(rss, session):
    order = rss.place_order(OrderRequest("7203", Side.BUY, 100, OrderType.LIMIT, 2850.5))
    function, args = session.runs[0]
    assert function == "RssStockOrder_v"
    # 発注ID, 銘柄コード, 売買区分(3:買), 注文区分(0:通常), SOR区分, 数量, 価格区分(1:指値), 価格, 執行条件(1:本日中), 注文期限(省略), 口座区分
    assert args == (1, "7203.T", "3", "0", "0", "100", "1", "2850.5", "1", MISSING, 0)
    assert order.status is OrderStatus.SUBMITTED
    assert order.order_id == "1" and order.broker_order_no == "N0001"
    # 一覧シートは自動で用意される
    assert session.sheet(LIST_SHEETS["order_ids"]).a1.Formula == "=RssOrderIDList()"


def test_sell_and_integer_price_format(rss, session):
    rss.place_order(OrderRequest("130A", Side.SELL, 200, OrderType.LIMIT, 1200.0))
    _, args = session.runs[0]
    assert args[1:8] == ("130A.T", "1", "0", "0", "200", "1", "1200")


def test_market_order_leaves_price_blank(rss, session):
    rss.place_order(OrderRequest("7203", Side.BUY, 100, OrderType.MARKET))
    _, args = session.runs[0]
    assert args[6] == "0" and args[7] is MISSING


def test_rejected_result_is_reported(rss_settings, tmp_path):
    broker = RssBroker(FakeSession(rss_settings, order_result="エラー：買付余力が不足しています"), tmp_path)
    order = broker.place_order(OrderRequest("7203", Side.BUY, 100, OrderType.LIMIT, 2850))
    assert order.status is OrderStatus.REJECTED
    assert "余力" in order.message


def test_order_ids_are_unique_across_restarts(session, tmp_path):
    first = RssBroker(session, tmp_path)
    first.place_order(OrderRequest("7203", Side.BUY, 100, OrderType.LIMIT, 2850))
    second = RssBroker(session, tmp_path)  # サーバー再起動を想定
    second.place_order(OrderRequest("7203", Side.BUY, 100, OrderType.LIMIT, 2850))
    assert [args[0] for _, args in session.runs] == [1, 2]


def test_account_from_list_sheets(rss, session):
    session.sheet(LIST_SHEETS["positions"]).grid = [
        ["国内株式 現物保有一覧", None, None, None, None, None],  # 見出しの前に行があっても探せる
        ["銘柄コード", "銘柄名称", "保有数量", "平均取得価額", "現在値", "評価損益額"],
        ["7203", "トヨタ自動車", "100", "2,800", 2850.0, "5,000"],
        [None, None, None, None, None, None],
        ["注記", None, None, None, None, None],
    ]
    session.sheet(LIST_SHEETS["capacity"]).grid = [["口座区分", "特定"], ["現物買付可能額", 523_400.0]]
    account = rss.get_account()
    assert account.cash_available == 523_400
    [p] = account.positions
    assert (p.symbol, p.quantity, p.avg_price, p.market_price, p.unrealized_pnl) == ("7203", 100, 2800, 2850, 5000)
    assert account.equity is None  # RSS からは評価額合計を確実に取れないので日次損失チェックは行わない


def test_orders_and_cancel(rss, session):
    session.sheet(LIST_SHEETS["orders"]).grid = [
        ["注文番号", "銘柄コード", "売買区分", "注文数量", "約定数量", "注文単価", "注文状況"],
        ["N0001", "7203", "現物買", 100, 0, 2850, "受付済"],
        ["N0000", "6758", "現物売", 100, 100, 3500, "約定"],
    ]
    orders = {o.order_id: o for o in rss.list_orders()}
    assert orders["N0001"].status is OrderStatus.OPEN and orders["N0001"].side is Side.BUY
    assert orders["N0000"].status is OrderStatus.FILLED and orders["N0000"].side is Side.SELL

    # このサーバーの発注ID（"1"）でも、注文番号（"N0001"）でも取り消せる
    rss.place_order(OrderRequest("7203", Side.BUY, 100, OrderType.LIMIT, 2850))
    cancelled = rss.cancel_order("1")
    assert session.runs[-1] == ("RssCancelOrder_v", (2, "N0001"))
    assert cancelled.status is OrderStatus.SUBMITTED
    rss.cancel_order("N0001")
    assert session.runs[-1] == ("RssCancelOrder_v", (3, "N0001"))

    with pytest.raises(BrokerError, match="取消できません"):
        rss.cancel_order("N0000")  # 約定済み
    with pytest.raises(BrokerError, match="見つかりません"):
        rss.cancel_order("N9999")


MARKET = {
    "7203.T": {"銘柄名称": "トヨタ自動車", "現在値": 2850.0, "前日終値": "2,830", "始値": "", "最良売気配値": 2851.0},
    "6758.T": {"銘柄名称": "ソニーグループ", "現在値": 3500.0},
}


def test_quote_via_rssmarket(rss_settings):
    session = FakeSession(rss_settings, market=MARKET)
    quote = RssMarketData(session).get_quote("7203")
    assert (quote.name, quote.last, quote.prev_close, quote.open, quote.ask) == ("トヨタ自動車", 2850, 2830, None, 2851)
    assert quote.reference_price() == 2850
    ws = session.sheets[MARKET_SHEET]
    assert ws.values[(1, 1)] == "銘柄コード" and ws.values[(2, 1)] == "'7203"
    assert ws.formulas[(2, 3)] == '=RssMarket("7203.T","現在値")'


def test_quote_rows_are_reused_when_limit_reached(rss_settings):
    rss_settings.max_market_rows = 1
    session = FakeSession(rss_settings, market=MARKET)
    md = RssMarketData(session)
    md.get_quote("7203")
    assert md.get_quote("6758").last == 3500
    assert session.sheets[MARKET_SHEET].formulas[(2, 3)] == '=RssMarket("6758.T","現在値")'
    assert (3, 3) not in session.sheets[MARKET_SHEET].formulas


def test_unknown_symbol_quote_fails_cleanly(rss_settings):
    with pytest.raises(BrokerError, match="株価を取得できませんでした"):
        RssMarketData(FakeSession(rss_settings, market=MARKET)).get_quote("9999")


def test_helpers():
    grid = [["現物買付可能額"], [1_000_000.0]]
    assert _labeled_value(grid, ["現物買付可能額"]) == 1_000_000
    assert _parse_table([["x"], ["発注ID", "注文番号"], [1, "N1"]], ["発注ID"]) == [{"発注ID": 1, "注文番号": "N1"}]
    assert _status_from_text("取消済", 100, 0) is OrderStatus.CANCELLED
    assert _status_from_text("一部約定", 200, 100) is OrderStatus.OPEN
    assert _status_from_text("？", 100, 0) is OrderStatus.UNKNOWN
