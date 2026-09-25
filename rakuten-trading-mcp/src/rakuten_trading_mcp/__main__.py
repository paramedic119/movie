"""コマンドライン入口。

python -m rakuten_trading_mcp [--config config.toml]          # MCP サーバーを stdio で起動（Claude から起動される）
python -m rakuten_trading_mcp [--config config.toml] check    # 発注せずに接続状態・株価・口座の読み取りを確認
python -m rakuten_trading_mcp init [--delegate] [--budget N]  # Claude Code 用の設定一式を作る
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

import anyio

from .brokers import BrokerError
from .config import ConfigError, Settings, load_settings
from .models import to_dict


def _dump(title: str, value: Any) -> None:
    print(f"== {title} ==")
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def run_check(settings: Settings) -> int:
    from .server import TradingApp

    _dump(
        "設定",
        {
            "config": settings.config_path,
            "mode": settings.mode,
            "approval_mode": settings.approval_mode,
            "data_dir": settings.data_dir,
            "paper.market_data": settings.paper.market_data if not settings.is_live else None,
        },
    )
    app = TradingApp(settings)
    symbol = (settings.risk.allowed_symbols or ["7203"])[0]
    ok = True
    for title, fn in (
        (f"株価 {symbol}", lambda: to_dict(app.broker.market_data.get_quote(symbol))),
        ("口座", lambda: to_dict(app.broker.get_account())),
        ("注文一覧", lambda: to_dict(app.broker.list_orders())),
    ):
        try:
            _dump(title, fn())
        except BrokerError as e:
            ok = False
            _dump(title, f"エラー: {e}")
    diagnose = getattr(app.broker, "diagnose", None)
    if diagnose is not None:
        _dump("RSS 一覧シートの先頭（列見出しの確認用）", diagnose())
    app.broker.close()
    return 0 if ok else 1


def run_init_command(args: argparse.Namespace) -> int:
    from .initialize import InitOptions, next_steps, run_init

    options = InitOptions(
        directory=Path(args.dir).expanduser().resolve(),
        delegate=args.delegate,
        budget=args.budget,
        max_loss=args.max_loss,
        symbols=tuple(x for x in args.symbols.split(",") if x.strip()) if args.symbols else None,
        live=args.live,
        market_data=args.market_data,
        force=args.force,
    )
    try:
        written = run_init(options)
    except ConfigError as e:
        print(f"設定エラー: {e}", file=sys.stderr)
        return 2
    print("作成・更新したファイル:")
    for path in written:
        print(f"  {path}")
    print(next_steps(options))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rakuten-trading-mcp", description=__doc__)
    parser.add_argument("--config", help="設定ファイル（省略時は環境変数 RAKUTEN_MCP_CONFIG）")
    parser.set_defaults(command="serve")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="MCP サーバーを stdio で起動する（既定）")
    sub.add_parser("check", help="発注せずに、接続状態・株価・口座の読み取りを確認する")
    init = sub.add_parser("init", help="Claude Code 用の設定一式（config.toml, .mcp.json など）を作る")
    init.add_argument("--dir", default=".", help="作成先のフォルダ（既定: 今いるフォルダ）")
    init.add_argument(
        "--delegate",
        action="store_true",
        help="おまかせモード: 確認ダイアログなしで Claude が発注・取消できるようにする",
    )
    init.add_argument("--budget", type=int, help="Claude に任せる金額（円）。指定すると予算の管理を有効にする")
    init.add_argument("--max-loss", type=int, help="予算全体の損失上限（円）。既定は予算の 20%%")
    init.add_argument("--symbols", help="Claude が売買してよい銘柄（カンマ区切り。例: 7203,6758,9432）")
    init.add_argument("--live", action="store_true", help="実際に発注する live モードで作る（既定は模擬売買）")
    init.add_argument(
        "--market-data", choices=["static", "rss"], default="static", help="模擬売買で使う株価（rss は Windows のみ）"
    )
    init.add_argument("--force", action="store_true", help="既存の config.toml と quotes.sample.json を作り直す")
    args = parser.parse_args(argv)

    if args.command == "init":
        return run_init_command(args)

    # stdio の MCP サーバーは標準出力をプロトコルに使うので、ログは必ず標準エラーへ。
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        settings = load_settings(args.config)
    except ConfigError as e:
        print(f"設定エラー: {e}", file=sys.stderr)
        return 2

    if args.command == "check":
        return run_check(settings)

    from .server import TradingApp, build_server, verify_approval_is_server_side

    app = TradingApp(settings)
    mcp = build_server(app)
    anyio.run(verify_approval_is_server_side, mcp)
    logging.getLogger(__name__).info(
        "起動: mode=%s approval=%s data_dir=%s", settings.mode, settings.approval_mode, settings.data_dir
    )
    try:
        mcp.run("stdio")
    finally:
        app.broker.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
