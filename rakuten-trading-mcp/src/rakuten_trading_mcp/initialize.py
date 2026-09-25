"""`python -m rakuten_trading_mcp init`: Claude Code から使うための設定一式を作る。

作るもの（--dir のフォルダ。既定は今いるフォルダ）:
- config.toml             サーバーの設定（予算・リスク上限など）
- quotes.sample.json      模擬売買用のサンプル株価（--market-data static のとき）
- .mcp.json               Claude Code がこのフォルダで起動したときに使う MCP サーバーの定義
- .claude/settings.local.json  ツールの事前許可（--delegate なら発注・取消も確認なしで実行できる）
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import date
from importlib import resources
from pathlib import Path
from typing import Any

from .config import CONFIG_ENV_VAR, LIVE_ENV_VAR, ConfigError, load_settings
from .models import normalize_symbol

SERVER_NAME = "rakuten"
READ_TOOLS = (
    "get_status",
    "get_quote",
    "get_price_history",
    "get_account",
    "list_orders",
    "get_journal",
    "preview_order",
)
TRADE_TOOLS = ("place_order", "cancel_order")
REPLAY_TOOLS = ("get_report", "advance_day")  # 模擬売買の成績と、リプレイを進めるツール（実際の発注はしない）
DEFAULT_SYMBOLS = ("7203", "6758", "9432", "8306")
MARKET_DATA = ("static", "rss", "csv")
DATA_DIR = "data"
REPLAY_DATA_DIR = "data-replay"  # リプレイの記録は通常の模擬売買と混ざらないよう別のフォルダに置く

# 東証の休場日（土日と 12/31〜1/3 は自動で休場扱い）。毎年更新すること。
HOLIDAYS_2026 = (
    "2026-01-12",
    "2026-02-11",
    "2026-02-23",
    "2026-03-20",
    "2026-04-29",
    "2026-05-04",
    "2026-05-05",
    "2026-05-06",
    "2026-07-20",
    "2026-08-11",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-10-12",
    "2026-11-03",
    "2026-11-23",
)


def tool_rule(tool: str) -> str:
    return f"mcp__{SERVER_NAME}__{tool}"


@dataclass
class InitOptions:
    directory: Path
    delegate: bool = False
    budget: int | None = None
    max_loss: int | None = None
    symbols: tuple[str, ...] | None = None  # 省略時は DEFAULT_SYMBOLS（live では省略不可）
    live: bool = False
    market_data: str | None = None  # 省略時は static（--replay のときは csv）
    replay: str | None = None  # "開始日:終了日"（YYYY-MM-DD:YYYY-MM-DD）
    force: bool = False

    @property
    def data_dir(self) -> str:
        return REPLAY_DATA_DIR if self.replay else DATA_DIR


def parse_replay(text: str) -> tuple[date, date]:
    try:
        start_text, end_text = text.split(":")
        start, end = date.fromisoformat(start_text.strip()), date.fromisoformat(end_text.strip())
    except ValueError as e:
        raise ConfigError(
            f"--replay は 開始日:終了日（例: 2026-04-01:2026-06-30）の形で指定してください: {text!r}"
        ) from e
    if start > end:
        raise ConfigError("--replay の開始日は終了日以前にしてください")
    return start, end


def _toml_list(items: tuple[str, ...] | None) -> str:
    items = items or ()
    return "[" + ", ".join(f'"{x}"' for x in items) + "]"


def render_config(o: InitOptions) -> str:
    # 日本株は 100 株単位なので、1 注文の上限が小さすぎると値がさ株（例: 7203 は 100 株で約 28 万円）を買えない。
    # 予算があるときは予算そのものを上限の目安にし、実際の上限は予算の残りで効かせる。
    if o.budget:
        max_loss = o.max_loss if o.max_loss is not None else o.budget // 5
        limits = {
            "max_order": o.budget,
            "max_daily_buy": o.budget,
            "max_position": o.budget,
            "max_daily_loss": max_loss // 2,
        }
    else:
        max_loss = o.max_loss if o.max_loss is not None else 20_000
        limits = {"max_order": 300_000, "max_daily_buy": 500_000, "max_position": 500_000, "max_daily_loss": 30_000}
    holidays = ",\n  ".join(f'"{d}"' for d in HOLIDAYS_2026)
    # 取引時間外の注文を止めるのは、翌営業日に思わぬ値段で約定しうる実際の注文（live / RSS の株価）のとき。
    # サンプル株価はいつでも試せるように、日足（csv）は大引け後に判断して翌営業日の足で約定させる使い方なので止めない。
    enforce_market_hours = o.live or o.market_data == "rss"
    if o.replay:
        start, end = parse_replay(o.replay)
        replay_section = f"""
[replay]
# 過去の日足で 1 日ずつ早送りする模擬売買。advance_day で次の取引日に進む。
# 別の期間で始め直すときは {REPLAY_DATA_DIR} フォルダを削除する（期間の違う記録が残っていると起動しない）
enabled = true
start_date = "{start}"
end_date = "{end}"
"""
    else:
        replay_section = ""
    return f"""\
# rakuten-trading-mcp の設定（`python -m rakuten_trading_mcp init` で作成）。
# 全項目の説明は examples/config.example.toml を参照。未知のキーはエラーになる（書き間違い防止）。

# "paper" = 模擬売買 / "live" = 楽天証券に実際に発注（環境変数 {LIVE_ENV_VAR}=yes も必要）
mode = "{"live" if o.live else "paper"}"

# "elicit" = 発注前に確認ダイアログで承認する / "client" = 確認なしで Claude に任せる（おまかせ）
approval_mode = "{"client" if o.delegate else "elicit"}"

data_dir = "{o.data_dir}"
confirmation_ttl_seconds = 180

[risk]
# Claude が売買してよい銘柄（予算の対象もこの銘柄だけ）
allowed_symbols = {_toml_list(o.symbols)}
max_order_value_jpy = {limits["max_order"]}          # 1 注文の上限
max_daily_buy_value_jpy = {limits["max_daily_buy"]}      # 1 日の買付合計の上限
max_position_value_jpy = {limits["max_position"]}       # 1 銘柄の保有額の上限
max_daily_orders = 10
max_daily_cancels = 10
max_price_deviation_pct = 3.0          # 指値と現在値の乖離の上限（%）
min_seconds_between_orders = 30
max_daily_loss_jpy = {limits["max_daily_loss"]}           # 1 日の損失がこれを超えたら新規の買いを止める
allow_market_orders = false
# 取引時間外の注文を受け付けない。実際の注文（live）と RSS の株価では true。サンプル株価（いつでも試せるように）と
# 日足（大引け後に判断し、翌営業日の足で約定を判定する使い方）では false
enforce_market_hours = {"true" if enforce_market_hours else "false"}
market_holidays = [
  {holidays},
]

[budget]
# Claude に任せる金額。保有株の取得原価 + 未約定の買い注文 がこの額を超える買いはできない。
# 予算を始める前から持っている株はあなたの持ち分として扱い、Claude は売らない。
enabled = {"true" if o.budget else "false"}
amount_jpy = {o.budget or 100_000}
max_loss_jpy = {max_loss}              # 予算全体の損失（確定 + 含み）がこれに達したら新規の買いを止める
reinvest_profits = false               # true にすると、確定した利益の分だけ買える額が増える

[paper]
initial_cash_jpy = 1000000
# "static" = サンプル株価 / "rss" = マーケットスピード II RSS の株価（Windows）
# "csv" = 日足 CSV（`fetch` で J-Quants から取得。Linux でも使える）
market_data = "{o.market_data}"
static_quotes_file = "quotes.sample.json"
bars_dir = "prices"                    # 日足 CSV の置き場所（<銘柄コード>.csv）
{replay_section}"""


def _write_json_merged(path: Path, update: dict[str, Any]) -> None:
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data.update(update)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_mcp_json(o: InitOptions, config_path: Path) -> Path:
    path = o.directory / ".mcp.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    servers = dict(existing.get("mcpServers", {}))
    env = {CONFIG_ENV_VAR: str(config_path)}
    if o.live:
        env[LIVE_ENV_VAR] = "yes"
    servers[SERVER_NAME] = {
        "type": "stdio",
        "command": sys.executable,
        "args": ["-m", "rakuten_trading_mcp"],
        "env": env,
    }
    _write_json_merged(path, {"mcpServers": servers})
    return path


def write_claude_settings(o: InitOptions) -> Path:
    """.claude/settings.local.json に、このサーバーの承認とツールの事前許可を追記する（既存の設定は残す）。"""
    path = o.directory / ".claude" / "settings.local.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    permissions = dict(data.get("permissions", {}))
    trade_rules = {tool_rule(t) for t in TRADE_TOOLS}
    allow = [r for r in permissions.get("allow", []) if o.delegate or r not in trade_rules]
    extra = REPLAY_TOOLS if not o.live else ()
    for tool in READ_TOOLS + extra + (TRADE_TOOLS if o.delegate else ()):
        if tool_rule(tool) not in allow:
            allow.append(tool_rule(tool))
    permissions["allow"] = allow
    enabled = list(data.get("enabledMcpjsonServers", []))
    if SERVER_NAME not in enabled:
        enabled.append(SERVER_NAME)
    _write_json_merged(path, {"permissions": permissions, "enabledMcpjsonServers": enabled})
    return path


def run_init(o: InitOptions) -> list[Path]:
    """設定一式を作り、作成・更新したファイルを返す。"""
    o.market_data = o.market_data or ("csv" if o.replay else "static")
    if o.market_data not in MARKET_DATA:
        raise ConfigError(f"--market-data は {', '.join(MARKET_DATA)} のいずれかにしてください")
    if o.replay:
        if o.live:
            raise ConfigError("--replay（過去の相場での模擬売買）と --live は同時に使えません")
        if o.market_data != "csv":
            raise ConfigError("--replay は日足データ（--market-data csv）で動きます")
        parse_replay(o.replay)
    if o.live and o.delegate and not o.budget:
        raise ConfigError("live のおまかせ（--live --delegate）には --budget（Claude に任せる金額）が必要です")
    if o.budget is not None and o.budget <= 0:
        raise ConfigError("--budget は正の金額にしてください")
    if o.max_loss is not None and o.max_loss < 0:
        raise ConfigError("--max-loss は 0 以上にしてください（0 で損失上限なし）")
    if o.symbols is None:
        if o.live:
            raise ConfigError("live では --symbols で Claude に任せる銘柄を明示してください（例: --symbols 7203,9432）")
        o.symbols = DEFAULT_SYMBOLS
    try:
        o.symbols = tuple(normalize_symbol(s) for s in o.symbols)
    except ValueError as e:
        raise ConfigError(str(e)) from e
    if not o.symbols:
        raise ConfigError("--symbols に 1 つ以上の銘柄コードを指定してください")

    o.directory.mkdir(parents=True, exist_ok=True)
    config_path = (o.directory / "config.toml").resolve()
    if config_path.exists() and not o.force:
        raise ConfigError(f"{config_path} は既にあります。作り直すときは --force を付けてください")
    # 一時ファイルに書いて読み込めることを確かめてから置き換える（live は環境変数の確認も含めて）
    tmp = config_path.with_suffix(".toml.tmp")
    tmp.write_text(render_config(o), encoding="utf-8")
    try:
        load_settings(tmp, environ={LIVE_ENV_VAR: "yes"} if o.live else {})
    except ConfigError:
        tmp.unlink()
        raise
    os.replace(tmp, config_path)

    written = [config_path]
    quotes = o.directory / "quotes.sample.json"
    if o.market_data == "static" and (not quotes.exists() or o.force):
        with resources.as_file(resources.files("rakuten_trading_mcp") / "samples" / "quotes.sample.json") as src:
            shutil.copyfile(src, quotes)
        written.append(quotes)
    written.append(write_mcp_json(o, config_path))
    written.append(write_claude_settings(o))
    return written


def next_steps(o: InitOptions) -> str:
    config = o.directory / "config.toml"
    lines = ["次の手順:"]
    step = 1
    if o.market_data == "csv" and not o.live:
        lines += [
            f"  {step}. J-Quants（https://jpx-jquants.com/）に登録して API キーを発行し、環境変数 JQUANTS_API_KEY に設定する",
            "     （キーは設定ファイルやチャットに書かない。例: ~/.bashrc などで export する）",
            f"  {step + 1}. 日足を取得する: {sys.executable} -m rakuten_trading_mcp --config {config} fetch",
        ]
        if not o.replay:
            lines.append(
                "     以後は毎営業日の夕方（大引け後）に同じコマンドで最新の日足を追加する（無料プランは 12 週間遅れ）"
            )
        step += 2
    lines += [
        f"  {step}. このフォルダで Claude Code を起動する: claude",
        "     （スマホなど別の端末からも話しかけるなら: claude remote-control）",
    ]
    if o.replay:
        lines += [
            f"  {step + 1}. 「リプレイを最終日まで進めながら売買して、最後に get_report で成績を報告して」のように話しかける",
            "     長い期間は examples/linux/replay.sh で数日ずつ区切って無人で進められます（--delegate で作った設定が必要）",
        ]
    else:
        lines += [
            f"  {step + 1}. 「get_status を確認して、予算の範囲で売買して」のように話しかける",
            "     開いている間ずっと任せるなら: /loop 30m 予算の範囲で売買を判断して",
        ]
    if o.delegate:
        lines.append("  おまかせモード: 注文の確認ダイアログは出ません。発注・取消も確認なしで実行されます。")
    else:
        lines.append(
            "  確認モード: 発注のたびに確認ダイアログが出ます（おまかせにするなら --delegate を付けて作り直す）。"
        )
    lines.append(f"  緊急停止: {o.data_dir} フォルダに STOP という名前のファイルを置くと、新規の発注をすべて止めます。")
    if o.live:
        lines.append(
            "  ⚠ live モードです。実際のお金で発注されます。Excel と マーケットスピード II RSS を接続しておいてください。"
        )
    return "\n".join(lines)
