"""設定ファイル（TOML）の読み込み。

安全に関わる設定の書き間違いを見逃さないよう、未知のキーはエラーにする。
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

from .models import normalize_symbol

MODES = ("paper", "live")
APPROVAL_MODES = ("elicit", "client")
LIVE_ENV_VAR = "RAKUTEN_MCP_LIVE"
CONFIG_ENV_VAR = "RAKUTEN_MCP_CONFIG"

# RssMarket の取得項目名。公式オンラインヘルプ「取得項目・銘柄コード一覧」と異なる場合は [rss.market_items] で上書きする。
DEFAULT_MARKET_ITEMS: dict[str, str] = {
    "name": "銘柄名称",
    "last": "現在値",
    "prev_close": "前日終値",
    "open": "始値",
    "high": "高値",
    "low": "安値",
    "volume": "出来高",
    "ask": "最良売気配値",
    "bid": "最良買気配値",
    "time": "現在値詳細時刻",
}

# 一覧系の RSS 関数。専用シートの A1 に書き込み、表として読み取る。
DEFAULT_LIST_FORMULAS: dict[str, str] = {
    "positions": "=RssPositionList()",
    "capacity": "=RssCapacityList()",
    "orders": "=RssOrderList()",
    "order_ids": "=RssOrderIDList()",
}

# {code} は "7203.T" のような RSS 形式の銘柄コード。ヘッダー行を省略すると全項目が出力される。
DEFAULT_CHART_FORMULA = '=RssChart(,"{code}","{interval}",{count})'

# 一覧の列見出しの候補（先に見つかったものを使う）。実際の見出しは `python -m rakuten_trading_mcp check` で確認できる。
DEFAULT_COLUMNS: dict[str, list[str]] = {
    "symbol": ["銘柄コード", "銘柄"],
    "name": ["銘柄名称", "銘柄名"],
    "quantity": ["保有数量", "数量", "保有株数", "残高数量"],
    "avg_price": ["平均取得価額", "平均取得単価", "取得単価", "取得価額"],
    "market_price": ["現在値", "時価"],
    "unrealized_pnl": ["評価損益額", "評価損益"],
    "market_value": ["評価額", "時価評価額"],
    "cash_available": ["現物買付可能額", "現物買付余力", "買付可能額", "買付余力"],
    "order_id": ["発注ID"],
    "order_no": ["注文番号"],
    "order_result": ["発注結果", "結果"],
    "side": ["売買区分", "売買"],
    "order_quantity": ["注文数量", "数量"],
    "filled_quantity": ["約定数量"],
    "filled_price": ["約定単価", "平均約定単価", "約定価格"],
    "order_price": ["注文単価", "注文価格"],
    "order_status": ["注文状況", "状態", "ステータス"],
    "chart_date": ["日付"],
    "chart_time": ["時刻"],
    "chart_open": ["始値"],
    "chart_high": ["高値"],
    "chart_low": ["安値"],
    "chart_close": ["終値"],
    "chart_volume": ["出来高"],
}


class ConfigError(Exception):
    pass


@dataclass
class RiskSettings:
    trading_enabled: bool = True
    kill_switch_file: str = "STOP"  # data_dir からの相対パス。存在する間は新規発注をすべて拒否
    allowed_symbols: list[str] = field(default_factory=list)  # 空なら全銘柄（非推奨）
    denied_symbols: list[str] = field(default_factory=list)
    lot_size: int = 100
    allow_market_orders: bool = False
    max_order_value_jpy: float = 100_000
    max_daily_buy_value_jpy: float = 300_000
    max_position_value_jpy: float = 300_000
    max_daily_orders: int = 10
    max_daily_cancels: int = 10
    max_price_deviation_pct: float = 3.0
    min_seconds_between_orders: float = 30
    max_daily_loss_jpy: float = 30_000  # 0 で無効
    enforce_market_hours: bool = True
    market_holidays: list[str] = field(default_factory=list)  # "YYYY-MM-DD"


@dataclass
class PaperSettings:
    initial_cash_jpy: float = 1_000_000
    market_data: str = "static"  # "static"（JSON ファイル）| "rss"（本物の株価で模擬売買）
    static_quotes_file: str = "quotes.json"
    commission_jpy: float = 0.0


@dataclass
class RssSettings:
    workbook: str = "mcp_bridge.xlsx"  # RSS が動いている Excel で開いておくブック名
    symbol_suffix: str = ".T"
    account_type: int = 0  # 口座区分（0: 特定 / 1: 一般 / 2: NISA …。公式ヘルプで要確認）
    sor: int = 0  # SOR区分（0: 通常 / 1: SOR）
    blank_argument: str = "missing"  # 省略引数の渡し方: "missing"（VBA の省略と同じ）| "empty"（空文字）
    calc_timeout_seconds: float = 10.0
    order_result_timeout_seconds: float = 15.0
    first_order_id: int = 1
    auto_setup_sheets: bool = True
    max_market_rows: int = 50
    market_items: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_MARKET_ITEMS))
    formulas: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_LIST_FORMULAS))
    chart_formula: str = DEFAULT_CHART_FORMULA
    columns: dict[str, list[str]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_COLUMNS.items()})


@dataclass
class BudgetSettings:
    """Claude に任せる運用予算。設定ファイルでしか変えられない（Claude が自分で増やすことはできない）。"""

    enabled: bool = False
    amount_jpy: float = 100_000  # 保有株の取得原価 + 未約定の買い注文 の合計の上限
    max_loss_jpy: float = 20_000  # 予算開始からの損失（確定 + 含み）がこれに達したら新規の買いを止める（0 で無効）
    reinvest_profits: bool = False  # 確定した利益の分だけ、買える額を増やすか


@dataclass
class Settings:
    mode: str = "paper"
    approval_mode: str = "elicit"
    data_dir: Path = Path("data")
    confirmation_ttl_seconds: int = 180
    risk: RiskSettings = field(default_factory=RiskSettings)
    budget: BudgetSettings = field(default_factory=BudgetSettings)
    paper: PaperSettings = field(default_factory=PaperSettings)
    rss: RssSettings = field(default_factory=RssSettings)
    config_path: Path | None = None

    @property
    def is_live(self) -> bool:
        return self.mode == "live"


def _build(cls: type, data: dict[str, Any], section: str, exclude: frozenset[str] = frozenset()) -> Any:
    known = {f.name for f in fields(cls)} - exclude
    unknown = sorted(set(data) - known)
    if unknown:
        raise ConfigError(f"[{section}] に不明な設定があります: {', '.join(unknown)}")
    return cls(**data)


def _merge_dict(defaults: dict[str, Any], override: dict[str, Any], section: str) -> dict[str, Any]:
    unknown = sorted(set(override) - set(defaults))
    if unknown:
        raise ConfigError(f"[{section}] に不明なキーがあります: {', '.join(unknown)}")
    return {**defaults, **override}


def load_settings(path: str | Path | None = None, *, environ: dict[str, str] | None = None) -> Settings:
    env = os.environ if environ is None else environ
    path = path or env.get(CONFIG_ENV_VAR)
    raw: dict[str, Any] = {}
    base_dir = Path.cwd()
    if path:
        config_path = Path(path).expanduser().resolve()
        if not config_path.is_file():
            raise ConfigError(f"設定ファイルが見つかりません: {config_path}")
        with config_path.open("rb") as f:
            raw = tomllib.load(f)
        base_dir = config_path.parent
    else:
        config_path = None

    risk_raw = dict(raw.pop("risk", {}))
    budget_raw = dict(raw.pop("budget", {}))
    paper_raw = dict(raw.pop("paper", {}))
    rss_raw = dict(raw.pop("rss", {}))

    rss_defaults = RssSettings()
    for key in ("market_items", "formulas", "columns"):
        if key in rss_raw:
            rss_raw[key] = _merge_dict(getattr(rss_defaults, key), rss_raw[key], f"rss.{key}")

    settings: Settings = _build(Settings, raw, "（トップレベル）", exclude=frozenset({"config_path"}))
    settings.risk = _build(RiskSettings, risk_raw, "risk")
    settings.budget = _build(BudgetSettings, budget_raw, "budget")
    settings.paper = _build(PaperSettings, paper_raw, "paper")
    settings.rss = _build(RssSettings, rss_raw, "rss")
    settings.config_path = config_path

    data_dir = Path(settings.data_dir).expanduser()
    settings.data_dir = data_dir if data_dir.is_absolute() else (base_dir / data_dir).resolve()
    quotes = Path(settings.paper.static_quotes_file).expanduser()
    settings.paper.static_quotes_file = str(quotes if quotes.is_absolute() else (base_dir / quotes).resolve())

    _validate(settings, env)
    return settings


def _validate(s: Settings, env: dict[str, str]) -> None:
    if s.mode not in MODES:
        raise ConfigError(f"mode は {MODES} のいずれかにしてください: {s.mode!r}")
    if s.approval_mode not in APPROVAL_MODES:
        raise ConfigError(f"approval_mode は {APPROVAL_MODES} のいずれかにしてください: {s.approval_mode!r}")
    if s.is_live and env.get(LIVE_ENV_VAR) != "yes":
        raise ConfigError(
            f"mode = 'live'（実際の発注）には環境変数 {LIVE_ENV_VAR}=yes も必要です。"
            "誤って実弾モードで起動しないための二重確認です。"
        )
    if s.paper.market_data not in ("static", "rss"):
        raise ConfigError("paper.market_data は 'static' か 'rss' にしてください")
    if s.rss.blank_argument not in ("missing", "empty"):
        raise ConfigError("rss.blank_argument は 'missing' か 'empty' にしてください")
    r = s.risk
    if r.lot_size <= 0 or r.max_daily_orders < 0 or r.max_daily_cancels < 0:
        raise ConfigError("risk.lot_size は正の数、回数制限は 0 以上にしてください")
    for name in ("max_order_value_jpy", "max_daily_buy_value_jpy", "max_position_value_jpy", "max_price_deviation_pct"):
        if getattr(r, name) <= 0:
            raise ConfigError(f"risk.{name} は正の数にしてください")
    try:
        r.allowed_symbols = [normalize_symbol(x) for x in r.allowed_symbols]
        r.denied_symbols = [normalize_symbol(x) for x in r.denied_symbols]
    except ValueError as e:
        raise ConfigError(f"risk の銘柄リスト: {e}") from e
    b = s.budget
    if b.enabled:
        if b.amount_jpy <= 0 or b.max_loss_jpy < 0:
            raise ConfigError("budget.amount_jpy は正の数、budget.max_loss_jpy は 0 以上にしてください")
        if not r.allowed_symbols:
            raise ConfigError(
                "予算（[budget]）を使うときは risk.allowed_symbols で Claude に任せる銘柄を指定してください。"
                "予算の対象はその銘柄だけになります"
            )
    if s.is_live and s.approval_mode == "client" and not b.enabled:
        raise ConfigError(
            "承認なし（approval_mode = 'client'）で live にするには、[budget] で予算を設定してください。"
            "Claude に任せる金額の上限を決めずに実弾で任せることはできません"
        )
