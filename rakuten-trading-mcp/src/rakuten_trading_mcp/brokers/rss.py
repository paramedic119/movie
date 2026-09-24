"""マーケットスピード II RSS（楽天証券の Excel アドイン）経由で株価取得・発注を行う。

前提:
- Windows + Excel + マーケットスピード II（ログイン済み）+ RSS アドインが「接続」状態
- RSS の発注機能が使える状態（「マーケットスピード II RSS の利用に関する確認書兼同意書」への同意、
  取引暗証番号などの注文設定）
- 設定 rss.workbook のブック（既定 mcp_bridge.xlsx）を、同じ Excel で開いておく。
  このブックに作業用シート（MCP_*）を作り、RSS 関数を書き込んで値を読む。

注意: 公式オンラインヘルプ等の公開情報に基づいて実装したが、実際の楽天証券口座での動作確認はまだ。
関数の引数・一覧の列見出しが想定と違う場合は、設定（[rss.*]）で調整できるようにしてある。
まず `python -m rakuten_trading_mcp check` で読み取り結果を確認し、paper モード（market_data = "rss"）から始めること。
"""

from __future__ import annotations

import sys
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypeVar

from ..config import RssSettings
from ..models import (
    AccountSnapshot,
    Bar,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Quote,
    Side,
    normalize_symbol,
    now_jst,
)
from .base import Broker, BrokerError, MarketData

T = TypeVar("T")

# ---- RSS 発注関数のコード値（公式オンラインヘルプ「注文」より） ----
ORDER_FUNCTION = "RssStockOrder_v"  # 国内株式 現物注文（VBA 用。発注トリガー引数なし）
CANCEL_FUNCTION = "RssCancelOrder_v"  # 取消注文（発注ID, 注文番号）
SIDE_CODES = {Side.SELL: "1", Side.BUY: "3"}  # 売買区分 1:売 3:買
ORDER_KIND_NORMAL = "0"  # 注文区分 0:通常注文（逆指値は非対応）
PRICE_KIND = {OrderType.MARKET: "0", OrderType.LIMIT: "1"}  # 価格区分 0:成行 1:指値
EXEC_CONDITION_TODAY = "1"  # 執行条件 1:本日中

MARKET_SHEET = "MCP_Market"
CHART_SHEET = "MCP_Chart"
LIST_SHEETS = {
    "positions": "MCP_Positions",
    "capacity": "MCP_Capacity",
    "orders": "MCP_Orders",
    "order_ids": "MCP_OrderIDs",
}
# 一覧の見出し行を見つけるための列（config の columns のキー）
LIST_HEADER_KEYS = {"positions": "symbol", "orders": "order_no", "order_ids": "order_id"}

# Excel がセル編集中などで COM 呼び出しを受け付けないときのエラー
_RETRYABLE_HRESULTS = {-2147418111, -2147417846}  # RPC_E_CALL_REJECTED, RPC_E_SERVERCALL_RETRYLATER


def _com_init() -> None:
    import pythoncom

    pythoncom.CoInitialize()


def _retryable(error: Exception) -> bool:
    return getattr(error, "hresult", None) in _RETRYABLE_HRESULTS


def _clean(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, str):
        return value.strip()
    return value


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and (value.strip() in ("", "-") or "取得中" in value))


def _num(value: Any) -> float | None:
    if _blank(value) or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    try:
        return float(str(value).replace(",", "").replace("円", "").replace("株", ""))
    except ValueError:
        return None


def _pick(row: dict[str, Any], candidates: list[str]) -> Any:
    for name in candidates:
        if name in row and not _blank(row[name]):
            return row[name]
    return None


def _as_rows(values: Any) -> list[list[Any]]:
    """Range.Value の戻り値（スカラー or タプルのタプル）を 2 次元リストにする。"""
    if values is None:
        return []
    if not isinstance(values, tuple):
        return [[values]]
    return [list(r) if isinstance(r, tuple) else [r] for r in values]


def _parse_table(grid: list[list[Any]], header_candidates: list[str]) -> list[dict[str, Any]]:
    """見出し候補を含む最初の行を見出しとみなし、その下の行を dict のリストにする。"""
    wanted = set(header_candidates)
    for i, row in enumerate(grid):
        header = [str(h).strip() if h is not None else "" for h in row]
        if wanted.intersection(header):
            out = []
            for data in grid[i + 1 :]:
                if all(_blank(v) for v in data):
                    break
                out.append({h: _clean(v) for h, v in zip(header, data, strict=False) if h})
            return out
    return []


def _labeled_value(grid: list[list[Any]], labels: list[str]) -> float | None:
    """「項目名 | 値」形式（横並び・縦並びどちらでも）の表から、ラベルに対応する数値を探す。"""
    for label in labels:
        for r, row in enumerate(grid):
            for c, cell in enumerate(row):
                if isinstance(cell, str) and cell.strip() == label:
                    right = _num(row[c + 1]) if c + 1 < len(row) else None
                    if right is not None:
                        return right
                    below = _num(grid[r + 1][c]) if r + 1 < len(grid) and c < len(grid[r + 1]) else None
                    if below is not None:
                        return below
    return None


class RssSession:
    """Excel への COM 接続。COM はスレッドに縛られるため、すべての呼び出しを専用スレッド 1 本で直列に実行する。"""

    def __init__(self, settings: RssSettings):
        if sys.platform != "win32":
            raise BrokerError("RSS 連携は Windows（Excel + マーケットスピード II RSS）でのみ動作します")
        self.s = settings
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rss-com", initializer=_com_init)
        self._app: Any = None

    def call(self, fn: Callable[..., T], *args: Any, retry: bool = True) -> T:
        return self._executor.submit(self._invoke, fn, args, retry).result()

    def _invoke(self, fn: Callable[..., T], args: tuple[Any, ...], retry: bool) -> T:
        import pywintypes

        attempts = 20 if retry else 1
        for attempt in range(attempts):
            try:
                return fn(*args)
            except pywintypes.com_error as e:
                if _retryable(e) and attempt + 1 < attempts:
                    time.sleep(0.5)
                    continue
                if not _retryable(e):
                    self._app = None  # Excel が再起動された等。次回は接続し直す
                raise BrokerError(f"Excel（RSS）との通信に失敗しました: {e}") from e
        raise AssertionError("unreachable")

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    # ---- 以下は COM スレッド内でのみ呼ぶ ----
    def app(self) -> Any:
        if self._app is None:
            import win32com.client

            try:
                self._app = win32com.client.GetActiveObject("Excel.Application")
            except Exception as e:
                raise BrokerError("起動中の Excel が見つかりません。Excel を起動して RSS を接続してください") from e
        return self._app

    def sheet(self, name: str) -> Any:
        try:
            wb = self.app().Workbooks(self.s.workbook)
        except Exception as e:
            if _retryable(e):
                raise
            raise BrokerError(f"RSS 接続中の Excel でブック「{self.s.workbook}」を開いてください") from e
        try:
            return wb.Worksheets(name)
        except Exception as e:
            if _retryable(e):
                raise
            ws = wb.Worksheets.Add(After=wb.Worksheets(wb.Worksheets.Count))
            ws.Name = name
            return ws

    @staticmethod
    def set_formula(cell: Any, formula: str) -> None:
        try:
            cell.Formula2 = formula  # Excel 365: 配列を返す関数をスピルさせる
        except Exception:
            cell.Formula = formula

    def run(self, function: str, *args: Any) -> Any:
        return self.app().Run(function, *args)

    def blank_argument(self) -> Any:
        if self.s.blank_argument == "empty":
            return ""
        import pythoncom

        return pythoncom.Missing

    def poll(self, read: Callable[[], T], ready: Callable[[T], bool], timeout: float) -> T:
        deadline = time.monotonic() + timeout
        while True:
            value = read()
            if ready(value) or time.monotonic() >= deadline:
                return value
            time.sleep(0.2)

    def read_grid(self, ws: Any) -> list[list[Any]]:
        return _as_rows(ws.UsedRange.Value)

    def wait_for_table(
        self, ws: Any, header_candidates: list[str], min_rows: int, timeout: float
    ) -> list[dict[str, Any]]:
        """表が min_rows 行以上になるか、行数が 0.6 秒ほど変わらなくなるまで待って読む。"""
        deadline = time.monotonic() + timeout
        last_len, stable = -1, 0
        rows: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            rows = _parse_table(self.read_grid(ws), header_candidates)
            if len(rows) >= min_rows:
                return rows
            stable = stable + 1 if len(rows) == last_len else 0
            if stable >= 3 and (rows or last_len == 0):
                return rows
            last_len = len(rows)
            time.sleep(0.2)
        return rows


class RssMarketData(MarketData):
    def __init__(self, session: RssSession):
        self.session = session
        self.s = session.s
        self._items = list(self.s.market_items.items())
        self._rows: OrderedDict[str, int] = OrderedDict()  # 銘柄 → MCP_Market シートの行（COM スレッドのみ）

    def close(self) -> None:
        self.session.close()

    def get_quote(self, symbol: str) -> Quote:
        return self.session.call(self._get_quote, symbol)

    def _row_for(self, ws: Any, symbol: str) -> int:
        if symbol in self._rows and str(ws.Cells(self._rows[symbol], 1).Value or "").lstrip("'") != symbol:
            self._rows.clear()  # Excel の再起動などでシートが作り直された。書き直す
        if not self._rows:
            ws.Cells.ClearContents()
            headers = ["銘柄コード", *(item for _, item in self._items)]
            ws.Range(ws.Cells(1, 1), ws.Cells(1, len(headers))).Value = tuple(headers)
        if symbol in self._rows:
            self._rows.move_to_end(symbol)
            return self._rows[symbol]
        if len(self._rows) >= self.s.max_market_rows:
            _, row = self._rows.popitem(last=False)  # 一番使っていない行を使い回す（RSS の関数数上限対策）
        else:
            row = len(self._rows) + 2
        code = symbol + self.s.symbol_suffix
        ws.Cells(row, 1).Value = "'" + symbol
        for j, (_, item) in enumerate(self._items):
            self.session.set_formula(ws.Cells(row, 2 + j), f'=RssMarket("{code}","{item}")')
        self._rows[symbol] = row
        return row

    def _get_quote(self, symbol: str) -> Quote:
        ws = self.session.sheet(MARKET_SHEET)
        row = self._row_for(ws, symbol)
        rng = ws.Range(ws.Cells(row, 2), ws.Cells(row, 1 + len(self._items)))
        values = self.session.poll(
            lambda: _as_rows(rng.Value)[0],
            lambda vals: any(not _blank(v) for v in vals),
            self.s.calc_timeout_seconds,
        )
        if all(_blank(v) for v in values):
            raise BrokerError(
                f"RSS から {symbol} の株価を取得できませんでした（RSS 未接続・銘柄コード誤り・タイムアウトのいずれか）"
            )
        data = {field: _clean(v) for (field, _), v in zip(self._items, values, strict=False)}
        name = data.get("name")
        return Quote(
            symbol=symbol,
            name=None if _blank(name) else str(name),
            last=_num(data.get("last")),
            prev_close=_num(data.get("prev_close")),
            open=_num(data.get("open")),
            high=_num(data.get("high")),
            low=_num(data.get("low")),
            volume=_num(data.get("volume")),
            bid=_num(data.get("bid")),
            ask=_num(data.get("ask")),
            time=None if _blank(data.get("time")) else str(data.get("time")),
            source="rss",
        )

    def get_price_history(self, symbol: str, interval: str, count: int) -> list[Bar]:
        return self.session.call(self._get_price_history, symbol, interval, count)

    def _get_price_history(self, symbol: str, interval: str, count: int) -> list[Bar]:
        ws = self.session.sheet(CHART_SHEET)
        ws.Cells.ClearContents()
        formula = self.s.chart_formula.format(code=symbol + self.s.symbol_suffix, interval=interval, count=count)
        self.session.set_formula(ws.Range("A1"), formula)
        cols = self.s.columns
        rows = self.session.wait_for_table(ws, cols["chart_date"], count, self.s.calc_timeout_seconds)
        bars = [
            Bar(
                date=str(_pick(r, cols["chart_date"])),
                time=None if _pick(r, cols["chart_time"]) is None else str(_pick(r, cols["chart_time"])),
                open=_num(_pick(r, cols["chart_open"])),
                high=_num(_pick(r, cols["chart_high"])),
                low=_num(_pick(r, cols["chart_low"])),
                close=_num(_pick(r, cols["chart_close"])),
                volume=_num(_pick(r, cols["chart_volume"])),
            )
            for r in rows
            if _pick(r, cols["chart_date"]) is not None
        ]
        # RSS は新しい順に並ぶことがあるので古い順にそろえる
        bars.sort(key=lambda b: (b.date, b.time or ""))
        return bars[-count:]


class RssBroker(Broker):
    name = "rakuten-rss"
    live = True

    def __init__(self, session: RssSession, data_dir: Path):
        super().__init__(RssMarketData(session))
        self.session = session
        self.s = session.s
        self._id_path = data_dir / "rss_order_id.txt"
        self._id_lock = threading.Lock()

    def _next_order_id(self) -> int:
        """RSS の発注IDは Excel を再起動するまで再利用できないので、ファイルに保存して単調増加させる。"""
        with self._id_lock:
            self._id_path.parent.mkdir(parents=True, exist_ok=True)
            current = int(self._id_path.read_text()) if self._id_path.exists() else self.s.first_order_id - 1
            self._id_path.write_text(str(current + 1))
            return current + 1

    # ---- 一覧の読み取り（COM スレッド） ----
    def _list_sheet(self, kind: str) -> Any:
        ws = self.session.sheet(LIST_SHEETS[kind])
        if self.s.auto_setup_sheets and not ws.Range("A1").Formula:
            self.session.set_formula(ws.Range("A1"), self.s.formulas[kind])
        return ws

    def _read_table(self, kind: str) -> list[dict[str, Any]]:
        ws = self._list_sheet(kind)
        header = self.s.columns[LIST_HEADER_KEYS[kind]]
        return self.session.wait_for_table(ws, header, 10**9, min(self.s.calc_timeout_seconds, 3.0))

    def _read_capacity(self) -> tuple[float | None, list[list[Any]]]:
        ws = self._list_sheet("capacity")
        grid = self.session.poll(
            lambda: self.session.read_grid(ws), lambda g: len(g) > 1, min(self.s.calc_timeout_seconds, 3.0)
        )
        return _labeled_value(grid, self.s.columns["cash_available"]), grid

    # ---- Broker インターフェース ----
    def get_account(self) -> AccountSnapshot:
        cols = self.s.columns
        rows = self.session.call(self._read_table, "positions")
        cash, capacity_grid = self.session.call(self._read_capacity)
        positions = []
        for r in rows:
            raw_symbol, qty = _pick(r, cols["symbol"]), _num(_pick(r, cols["quantity"]))
            if raw_symbol is None or qty is None:
                continue
            try:
                symbol = normalize_symbol(str(raw_symbol))
            except ValueError:
                continue
            positions.append(
                Position(
                    symbol=symbol,
                    quantity=int(qty),
                    avg_price=_num(_pick(r, cols["avg_price"])),
                    name=_pick(r, cols["name"]),
                    market_price=_num(_pick(r, cols["market_price"])),
                    unrealized_pnl=_num(_pick(r, cols["unrealized_pnl"])),
                    raw=r,
                )
            )
        # 評価額の合計は RSS から確実に取れないため None（日次損失チェックは行われない）
        capacity = [[_clean(v) for v in row] for row in capacity_grid[:20]]
        return AccountSnapshot(cash_available=cash, positions=positions, equity=None, raw={"capacity": capacity})

    def list_orders(self) -> list[Order]:
        cols = self.s.columns
        orders = []
        for r in self.session.call(self._read_table, "orders"):
            order_no, raw_symbol = _pick(r, cols["order_no"]), _pick(r, cols["symbol"])
            if order_no is None or raw_symbol is None:
                continue
            try:
                symbol = normalize_symbol(str(raw_symbol))
            except ValueError:
                continue
            side_text = str(_pick(r, cols["side"]) or "")
            status_text = str(_pick(r, cols["order_status"]) or "")
            qty = int(_num(_pick(r, cols["order_quantity"])) or 0)
            filled = int(_num(_pick(r, cols["filled_quantity"])) or 0)
            price = _num(_pick(r, cols["order_price"]))
            orders.append(
                Order(
                    order_id=str(order_no),
                    symbol=symbol,
                    side=Side.SELL if "売" in side_text else Side.BUY,
                    quantity=qty,
                    order_type=OrderType.LIMIT if price else OrderType.MARKET,
                    limit_price=price,
                    status=_status_from_text(status_text, qty, filled),
                    created_at="",
                    filled_quantity=filled,
                    broker_order_no=str(order_no),
                    message=status_text or None,
                    raw=r,
                )
            )
        return orders

    def _find_order_id_row(self, order_id: int) -> dict[str, Any] | None:
        ws = self._list_sheet("order_ids")
        cols = self.s.columns

        def read() -> dict[str, Any] | None:
            for r in _parse_table(self.session.read_grid(ws), cols["order_id"]):
                if _num(_pick(r, cols["order_id"])) == order_id:
                    return r
            return None

        return self.session.poll(read, lambda r: r is not None, self.s.order_result_timeout_seconds)

    def place_order(self, request: OrderRequest) -> Order:
        order_id = self._next_order_id()
        blank = self.session.call(self.session.blank_argument)
        if request.order_type is OrderType.LIMIT:
            assert request.limit_price is not None
            price: Any = f"{request.limit_price:.4f}".rstrip("0").rstrip(".")
        else:
            price = blank
        args = (
            order_id,  # 発注ID
            request.symbol + self.s.symbol_suffix,  # 銘柄コード
            SIDE_CODES[request.side],  # 売買区分
            ORDER_KIND_NORMAL,  # 注文区分
            str(self.s.sor),  # SOR区分
            str(request.quantity),  # 注文数量
            PRICE_KIND[request.order_type],  # 価格区分
            price,  # 注文価格
            EXEC_CONDITION_TODAY,  # 執行条件
            blank,  # 注文期限（本日中なので省略）
            self.s.account_type,  # 口座区分
        )
        # 発注は二重送信を避けるため自動リトライしない
        result = self.session.call(self.session.run, ORDER_FUNCTION, *args, retry=False)
        order = Order(
            order_id=str(order_id),
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            order_type=request.order_type,
            limit_price=request.limit_price,
            status=OrderStatus.SUBMITTED,
            created_at=now_jst().isoformat(timespec="seconds"),
            message=f"{ORDER_FUNCTION} の戻り値: {_clean(result)!r}",
        )
        row = self.session.call(self._find_order_id_row, order_id)
        if row is None:
            order.message += "（発注結果を RssOrderIDList で確認できませんでした。注文一覧で状態を確認してください）"
            return order
        cols = self.s.columns
        order.raw = row
        order_no = _pick(row, cols["order_no"])
        result_text = str(_pick(row, cols["order_result"]) or "")
        if order_no is not None:
            order.broker_order_no = str(order_no)
        if any(word in result_text for word in ("エラー", "失敗", "不可")):
            order.status = OrderStatus.REJECTED
        order.message += f" / 発注結果: {result_text or '（空）'}"
        return order

    def cancel_order(self, order_id: str) -> Order:
        """order_id は注文番号（list_orders の order_id）か、このサーバーが発注したときの発注ID。"""
        orders = self.list_orders()
        known = next((o for o in orders if o.broker_order_no == order_id), None)
        if known is None and order_id.isdigit():
            row = self.session.call(self._find_order_id_row, int(order_id))
            order_no = _pick(row, self.s.columns["order_no"]) if row else None
            known = next((o for o in orders if o.broker_order_no == str(order_no)), None)
        if known is None:
            raise BrokerError(f"注文 {order_id} が注文一覧（RssOrderList）に見つかりません")
        order_no = known.broker_order_no
        if known.status not in (OrderStatus.OPEN, OrderStatus.UNKNOWN, OrderStatus.SUBMITTED):
            raise BrokerError(f"注文 {order_no} は状態が {known.status}（{known.message}）のため取消できません")
        cancel_id = self._next_order_id()
        result = self.session.call(self.session.run, CANCEL_FUNCTION, cancel_id, order_no, retry=False)
        known.status = OrderStatus.SUBMITTED
        known.message = (
            f"取消を送信しました（取消の発注ID {cancel_id}）。{CANCEL_FUNCTION} の戻り値: {_clean(result)!r}"
        )
        return known

    def _preview_sheet(self, kind: str) -> list[list[Any]]:
        ws = self._list_sheet(kind)
        grid = self.session.poll(lambda: self.session.read_grid(ws), lambda g: len(g) > 1, 3.0)
        return [[_clean(v) for v in row] for row in grid[:4]]

    def diagnose(self) -> dict[str, Any]:
        """check コマンド用: 発注はせず、一覧シートの先頭数行を読んで列見出しを確認できるようにする。"""
        out: dict[str, Any] = {}
        for kind, sheet in LIST_SHEETS.items():
            try:
                out[sheet] = self.session.call(self._preview_sheet, kind)
            except BrokerError as e:
                out[sheet] = f"エラー: {e}"
        return out


def _status_from_text(text: str, quantity: int, filled: int) -> OrderStatus:
    if "取消" in text:
        return OrderStatus.CANCELLED
    if "失効" in text:
        return OrderStatus.EXPIRED
    if quantity and filled >= quantity:
        return OrderStatus.FILLED
    if any(w in text for w in ("受付", "注文中", "執行中", "待機", "一部約定")):
        return OrderStatus.OPEN
    return OrderStatus.UNKNOWN
