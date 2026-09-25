"""コマンドライン入口。

python -m rakuten_trading_mcp [--config config.toml]          # MCP サーバーを stdio で起動（Claude から起動される）
python -m rakuten_trading_mcp [--config config.toml] check    # 発注せずに接続状態・株価・口座の読み取りを確認
python -m rakuten_trading_mcp init [--delegate] [--budget N]  # Claude Code 用の設定一式を作る
python -m rakuten_trading_mcp [--config config.toml] fetch    # J-Quants API から日足を取得して CSV に保存
"""

from __future__ import annotations

import argparse
import json
import logging
import os
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
    try:
        app = TradingApp(settings)
    except BrokerError as e:
        _dump("起動エラー", str(e))
        return 1
    if app.replay is not None:
        _dump("リプレイ", app.replay.info())
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


def run_fetch(settings: Settings, args: argparse.Namespace) -> int:
    from datetime import date, timedelta

    from .brokers.bars import read_bars
    from .brokers.base import BrokerError
    from .jquants import API_KEY_ENV, JQuantsError, update_csv
    from .models import JST, normalize_symbol, now_jst

    api_key = os.environ.get(API_KEY_ENV, "").strip()
    if not api_key and args.api_key_file:
        try:
            api_key = Path(args.api_key_file).expanduser().read_text(encoding="utf-8").strip()
        except OSError as e:
            print(f"API キーのファイルを読めません: {e}", file=sys.stderr)
            return 2
    if not api_key:
        print(
            f"J-Quants の API キーを環境変数 {API_KEY_ENV} に設定してください（J-Quants のダッシュボードで発行）。",
            file=sys.stderr,
        )
        return 2
    try:
        symbols = (
            [normalize_symbol(x) for x in args.symbols.split(",")] if args.symbols else settings.risk.allowed_symbols
        )
    except ValueError as e:
        print(f"設定エラー: {e}", file=sys.stderr)
        return 2
    if not symbols:
        print("取得する銘柄がありません。--symbols か risk.allowed_symbols で指定してください。", file=sys.stderr)
        return 2
    if settings.paper.market_data != "csv":
        print("注意: paper.market_data が csv ではないので、取得した日足は模擬売買には使われません。", file=sys.stderr)
    today = now_jst().astimezone(JST).date()
    replay = settings.replay
    try:
        start_arg = date.fromisoformat(args.from_) if args.from_ else None
        end = (
            date.fromisoformat(args.to)
            if args.to
            else (date.fromisoformat(replay.end_date) if replay.enabled else today)
        )
    except ValueError:
        print("--from / --to は YYYY-MM-DD 形式で指定してください", file=sys.stderr)
        return 2
    directory = Path(settings.paper.bars_dir)
    ok = True
    for symbol in symbols:
        if start_arg is not None:
            start = start_arg
        elif replay.enabled:
            start = date.fromisoformat(replay.start_date) - timedelta(days=150)  # 移動平均などに使う前の期間も取る
        else:
            path = directory / f"{symbol}.csv"
            try:
                existing = read_bars(path) if path.exists() else []
            except (BrokerError, ValueError) as e:
                ok = False
                print(f"{symbol}: 既存の {path} を読めません（消してから取り直してください）: {e}", file=sys.stderr)
                continue
            start = (
                date.fromisoformat(existing[-1].date) + timedelta(days=1) if existing else today - timedelta(days=400)
            )
        if start > end:
            print(f"{symbol}: 取得済み（{end} まで）")
            continue
        try:
            added, first, last = update_csv(directory, symbol, start, end, api_key)
        except JQuantsError as e:
            ok = False
            print(f"{symbol}: エラー: {e}", file=sys.stderr)
            continue
        print(f"{symbol}: {added} 日分を追加（{first} 〜 {last}） → {directory / (symbol + '.csv')}")
        if last and not replay.enabled and (today - date.fromisoformat(last)).days > 7:
            print(f"  注意: 最新の日足が {last} です（無料プランは 12 週間遅れ）。", file=sys.stderr)
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
        replay=args.replay,
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
        "--market-data",
        choices=["static", "rss", "csv"],
        help="模擬売買で使う株価: static=サンプル（既定）/ rss=楽天 RSS（Windows）/ csv=J-Quants などの日足（Linux 可）",
    )
    init.add_argument(
        "--replay",
        metavar="開始日:終了日",
        help="過去の日足で早送りする模擬売買（例: 2026-04-01:2026-06-30）。csv を使う",
    )
    init.add_argument("--force", action="store_true", help="既存の config.toml と quotes.sample.json を作り直す")
    fetch = sub.add_parser(
        "fetch", help="J-Quants API から日足を取得して CSV に保存する（API キーは環境変数 JQUANTS_API_KEY）"
    )
    fetch.add_argument("--symbols", help="銘柄（カンマ区切り。省略時は risk.allowed_symbols）")
    fetch.add_argument("--from", dest="from_", metavar="YYYY-MM-DD", help="取得開始日（省略時は続きから）")
    fetch.add_argument("--to", metavar="YYYY-MM-DD", help="取得終了日（省略時は今日。リプレイ中は終了日）")
    fetch.add_argument("--api-key-file", help="API キーを書いたファイル（環境変数が無いとき）")
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
    if args.command == "fetch":
        return run_fetch(settings, args)

    from .server import TradingApp, build_server, verify_approval_is_server_side

    try:
        app = TradingApp(settings)
    except BrokerError as e:
        print(f"起動できません: {e}", file=sys.stderr)
        return 2
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
