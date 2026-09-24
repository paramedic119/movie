"""コマンドライン入口。

python -m rakuten_trading_mcp [--config config.toml]          # MCP サーバーを stdio で起動（Claude から起動される）
python -m rakuten_trading_mcp [--config config.toml] check    # 発注せずに接続状態・株価・口座の読み取りを確認
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rakuten-trading-mcp", description=__doc__)
    parser.add_argument("--config", help="設定ファイル（省略時は環境変数 RAKUTEN_MCP_CONFIG）")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "check"])
    args = parser.parse_args(argv)
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
