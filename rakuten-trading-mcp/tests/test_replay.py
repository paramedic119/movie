"""日足 CSV での模擬売買を、init で作った設定から MCP 経由で通す（Linux で使う流れ）。

- リプレイ: 過去の期間を 1 日ずつ早送りし、注文は翌営業日の足で約定、最後に成績を出す
- 日々の模擬売買: 大引け後に発注し、翌営業日の足が取得されたら約定
"""

import json
from datetime import datetime

import pytest
from conftest import FakeClock, write_csv
from mcp import Client

from rakuten_trading_mcp.brokers.base import BrokerError
from rakuten_trading_mcp.config import load_settings
from rakuten_trading_mcp.initialize import InitOptions, run_init
from rakuten_trading_mcp.models import JST
from rakuten_trading_mcp.server import TradingApp, build_server

pytestmark = pytest.mark.anyio
REASON = "25日移動平均の上で推移し、前日比でも上昇。100株だけ買う"
PERIOD = "2026-04-01:2026-04-07"

# (日付, 始値, 高値, 安値, 終値)。04-01 は水曜、04-04/05 は週末。6758 は 04-03 の足が無い（売買停止などの想定）
BARS = {
    "7203": [
        ("2026-03-30", 2800, 2820, 2780, 2800),
        ("2026-03-31", 2800, 2830, 2790, 2810),
        ("2026-04-01", 2810, 2850, 2800, 2840),
        ("2026-04-02", 2830, 2870, 2820, 2860),
        ("2026-04-03", 2870, 2900, 2860, 2890),
        ("2026-04-06", 2900, 2950, 2890, 2940),
        ("2026-04-07", 2950, 2960, 2900, 2920),
        ("2026-04-08", 2900, 2910, 2800, 2810),  # 期間の後の足。最後まで見えてはいけない
    ],
    "6758": [
        ("2026-03-31", 3500, 3520, 3480, 3500),
        ("2026-04-01", 3500, 3530, 3490, 3510),
        ("2026-04-02", 3510, 3530, 3490, 3520),
        ("2026-04-06", 3530, 3560, 3520, 3550),
        ("2026-04-07", 3550, 3580, 3540, 3570),
    ],
}


def setup_dir(directory, replay=PERIOD, **options):
    run_init(
        InitOptions(
            directory=directory,
            delegate=True,
            budget=1_000_000,
            symbols=("7203", "6758"),
            replay=replay,
            market_data="csv",
            force=True,
            **options,
        )
    )
    for symbol, rows in BARS.items():
        write_csv(directory / "prices", symbol, rows)
    return directory


def make_app(directory, clock=None):
    settings = load_settings(directory / "config.toml", environ={})
    return TradingApp(settings) if clock is None else TradingApp(settings, clock=clock)


async def tool(client, name, **args):
    result = await client.call_tool(name, args)
    assert not result.is_error, result.content
    return result.structured_content or json.loads(result.content[0].text)


async def order(client, side, price, symbol="7203"):
    preview = await tool(
        client, "preview_order", symbol=symbol, side=side, quantity=100, limit_price=price, reason=REASON
    )
    assert preview["accepted"], preview
    placed = await tool(client, "place_order", confirmation_token=preview["confirmation_token"])
    assert placed["placed"], placed
    return placed["order"]


def updates(result):
    return [(u["symbol"], u["side"], u["status"], u.get("avg_fill_price")) for u in result["order_updates"]]


async def test_replay_end_to_end(tmp_path):
    app = make_app(setup_dir(tmp_path))
    async with Client(build_server(app)) as client:
        status = await tool(client, "get_status")
        assert status["now"] == "2026-04-01T15:30:00+09:00" and status["market_open"]
        assert status["replay"] | {"enabled": True} == {
            "enabled": True,
            "current_date": "2026-04-01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-07",
            "day": 1,
            "total_days": 5,
            "remaining_days": 4,
            "finished": False,
        }
        history = await tool(client, "get_price_history", symbol="7203", interval="D", count=60)
        assert [b["date"] for b in history["bars"]] == ["2026-03-30", "2026-03-31", "2026-04-01"]
        assert (await tool(client, "get_quote", symbol="7203"))["last"] == 2840

        # 同じ日に 2 件。時計が止まっているので、発注間隔の制限では止めない
        assert (await order(client, "buy", 2845))["status"] == "open"
        await order(client, "buy", 3495, symbol="6758")

        day2 = await tool(client, "advance_day")
        assert day2["replay"]["current_date"] == "2026-04-02"
        assert sorted(updates(day2)) == [("6758", "buy", "filled", 3495), ("7203", "buy", "filled", 2830)]
        assert day2["budget"]["invested_jpy"] == 283_000 + 349_500
        assert day2["budget"]["unrealized_pnl_jpy"] == (2860 - 2830) * 100 + (3520 - 3495) * 100

        await order(client, "sell", 2920)  # 04-03 の高値 2900 に届かない
        day3 = await tool(client, "advance_day")
        assert updates(day3) == [("7203", "sell", "expired", None)]

        await order(client, "sell", 2880)
        day4 = await tool(client, "advance_day")
        assert updates(day4) == [("7203", "sell", "filled", 2900)]  # 04-06 の始値
        assert day4["budget"]["realized_pnl_jpy"] == (2900 - 2830) * 100  # 失効した注文の指値では計算しない

        day5 = await tool(client, "advance_day")
        assert day5["replay"]["remaining_days"] == 0
        last = await tool(
            client, "preview_order", symbol="6758", side="sell", quantity=100, limit_price=3570, reason=REASON
        )
        assert not last["accepted"] and "最終日" in last["violations"][0]

        end = await tool(client, "advance_day")
        assert end["finished"] and end["report"]["replay"]["finished"]

        report = await tool(client, "get_report")
        assert report["period"] == "2026-04-01 〜 2026-04-07"
        assert [p["date"] for p in report["equity_series"]] == [
            "2026-04-01",
            "2026-04-02",
            "2026-04-03",
            "2026-04-06",
            "2026-04-07",
        ]
        # 予算の評価額 = 予算 + 確定損益 7,000 + 6758 の含み損益 (3570 - 3495) * 100
        assert [p["equity"] for p in report["equity_series"]] == [1_000_000, 1_005_500, 1_008_500, 1_012_500, 1_014_500]
        assert report["start_equity"] == 1_000_000 and report["current_equity"] == 1_014_500
        assert report["return_pct"] == 1.45 and report["max_drawdown_pct"] == 0
        assert report["filled_orders"] == {"buy": 2, "sell": 1}
        assert report["buy_and_hold_pct"] == {"7203": 2.82, "6758": 1.71}

        history = await tool(client, "get_price_history", symbol="7203", interval="D", count=60)
        assert history["bars"][-1]["date"] == "2026-04-07"


async def test_daily_loss_limit_counts_the_days_move(tmp_path):
    """リプレイでも日次の損失上限は「前日の大引け時点」からの損失で判定する。"""
    setup_dir(tmp_path)
    write_csv(
        tmp_path / "prices",
        "7203",
        [
            ("2026-04-01", 2810, 2850, 2800, 2840),
            ("2026-04-02", 2830, 2870, 2820, 2860),
            ("2026-04-03", 2850, 2860, 2700, 2720),  # 大きく下げた日
            ("2026-04-06", 2720, 2750, 2700, 2740),
        ],
    )
    config = tmp_path / "config.toml"
    text = config.read_text(encoding="utf-8")
    config.write_text(text.replace("max_daily_loss_jpy = 100000", "max_daily_loss_jpy = 5000"), encoding="utf-8")
    async with Client(build_server(make_app(tmp_path))) as client:
        await order(client, "buy", 2845)
        await tool(client, "advance_day")  # 04-02 に 2,830 円で約定。終値 2,860 円
        await tool(client, "advance_day")  # 04-03 は 2,720 円まで下落: 前日比 −14,000 円
        preview = await tool(
            client, "preview_order", symbol="6758", side="buy", quantity=100, limit_price=3520, reason=REASON
        )
        assert not preview["accepted"]
        assert any("本日の評価損失が上限" in v for v in preview["violations"])


async def test_replay_resumes_after_restart(tmp_path):
    setup_dir(tmp_path)
    async with Client(build_server(make_app(tmp_path))) as client:
        await tool(client, "advance_day")
    async with Client(build_server(make_app(tmp_path))) as client:
        assert (await tool(client, "get_status"))["replay"]["current_date"] == "2026-04-02"


def test_a_different_period_needs_a_fresh_data_dir(tmp_path):
    setup_dir(tmp_path)
    make_app(tmp_path)
    setup_dir(tmp_path, replay="2026-04-02:2026-04-07")
    with pytest.raises(BrokerError, match="別の期間"):
        make_app(tmp_path)


def test_replay_and_daily_records_do_not_mix(tmp_path):
    setup_dir(tmp_path)
    make_app(tmp_path)
    config = tmp_path / "config.toml"
    text = config.read_text(encoding="utf-8").replace('data_dir = "data-replay"', 'data_dir = "data"')
    config.write_text(text.replace("enabled = true\nstart_date", "enabled = false\nstart_date"), encoding="utf-8")
    make_app(tmp_path, clock=FakeClock(datetime(2026, 4, 8, 18, 0, tzinfo=JST)))  # 通常の模擬売買の記録を作る

    config.write_text(text, encoding="utf-8")  # リプレイの設定で、通常の記録がある data を指す
    with pytest.raises(BrokerError, match="通常の模擬売買の記録"):
        make_app(tmp_path)
    config.write_text(
        text.replace('data_dir = "data"', 'data_dir = "data-replay"').replace("enabled = true", "enabled = false"),
        encoding="utf-8",
    )
    with pytest.raises(BrokerError, match="リプレイの記録"):
        make_app(tmp_path)


def test_replay_without_data_points_to_fetch(tmp_path):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), replay=PERIOD))
    with pytest.raises(BrokerError, match="fetch"):
        make_app(tmp_path)


async def test_replay_tools_are_only_offered_where_they_apply(tmp_path, app):
    names = {t.name for t in (await build_server(app).list_tools())}
    assert "get_report" in names and "advance_day" not in names
    replay_names = {t.name for t in (await build_server(make_app(setup_dir(tmp_path))).list_tools())}
    assert {"get_report", "advance_day"} <= replay_names


async def test_daily_paper_trading_after_the_close(tmp_path):
    """日々の模擬売買: 夕方に日足を取得 → Claude が判断して発注 → 翌営業日の足を取得したら約定。"""
    setup_dir(tmp_path, replay=None)
    clock = FakeClock(datetime(2026, 4, 2, 18, 0, tzinfo=JST))
    async with Client(build_server(make_app(tmp_path, clock))) as client:
        status = await tool(client, "get_status")
        assert not status["replay"]["enabled"] and not status["market_open"]  # 時間外でも受け付ける設定
        assert (await tool(client, "get_quote", symbol="7203"))["last"] == 2860
        placed = await order(client, "buy", 2880)
        assert placed["status"] == "open"

        clock.now = datetime(2026, 4, 3, 18, 0, tzinfo=JST)
        [filled] = (await tool(client, "list_orders"))["orders"]
        assert filled["status"] == "filled" and filled["avg_fill_price"] == 2870  # 04-03 の始値
        account = await tool(client, "get_account")
        assert account["budget"]["holdings"][0]["quantity"] == 100

        clock.now = datetime(2026, 4, 20, 18, 0, tzinfo=JST)  # 日足の取得が止まったまま
        stale = await client.call_tool(
            "preview_order", {"symbol": "7203", "side": "buy", "quantity": 100, "limit_price": 2900, "reason": REASON}
        )
        assert stale.is_error and "fetch" in stale.content[0].text
