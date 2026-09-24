"""MCP クライアントからツールを呼び、発注フロー全体（確認ダイアログ含む）を確認する。

MCP のプロトコル版によって確認ダイアログ（elicitation）の運ばれ方が違うので、
旧方式（legacy: サーバーからクライアントへのリクエスト）と新方式（auto: 2026-07-28 以降の input_required）の両方で試す。
"""

import json

import anyio
import mcp_types as types
import pytest
from mcp import Client

from rakuten_trading_mcp.server import TradingApp, build_server, verify_approval_is_server_side

pytestmark = pytest.mark.anyio
PROTOCOLS = ["legacy", "auto"]
REASON = "25日移動平均を上抜け、出来高も増加。押し目で100株だけ試し買い"


def elicitation(action="accept", confirm=True, seen=None):
    async def callback(context, params):
        if seen is not None:
            seen.append(params.message)
        if action != "accept":
            return types.ElicitResult(action=action)
        return types.ElicitResult(action="accept", content={"confirm": confirm})

    return callback


def data(result: types.CallToolResult) -> dict:
    assert not result.is_error, result.content
    if result.structured_content is not None:
        return result.structured_content
    return json.loads(result.content[0].text)


def error_text(result: types.CallToolResult) -> str:
    assert result.is_error
    return result.content[0].text


async def preview(client, **overrides):
    args = {"symbol": "7203", "side": "buy", "quantity": 100, "limit_price": 2855, "reason": REASON} | overrides
    return data(await client.call_tool("preview_order", args))


async def test_approval_is_not_a_model_argument(app):
    mcp = build_server(app)
    await verify_approval_is_server_side(mcp)
    [tool] = [t for t in await mcp.list_tools() if t.name == "place_order"]
    assert set(tool.input_schema["properties"]) == {"confirmation_token"}


@pytest.mark.parametrize("protocol", PROTOCOLS)
async def test_order_is_placed_only_after_user_approves(app, protocol):
    seen: list[str] = []
    async with Client(build_server(app), mode=protocol, elicitation_callback=elicitation(seen=seen)) as client:
        status = data(await client.call_tool("get_status", {}))
        assert status["mode"] == "paper" and status["market_open"]

        p = await preview(client)
        assert p["accepted"], p
        assert p["estimated_value_jpy"] == 285_500

        placed = data(await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]}))
        assert placed["placed"]
        assert placed["order"]["status"] == "filled"

        account = data(await client.call_tool("get_account", {}))
        assert account["positions"][0]["symbol"] == "7203"

        # 同じトークンは二度と使えない
        again = await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]})
        assert "無効か期限切れ" in error_text(again)

    assert len(seen) == 1
    assert "買い 7203（トヨタ自動車） 100株 指値 2,855.0円" in seen[0]
    assert REASON in seen[0]
    events = [e["event"] for e in app.audit.entries()]
    assert events == ["equity_snapshot", "preview_ok", "order_placed"]
    placed_entry = app.audit.entries()[-1]
    assert placed_entry["reason"] == REASON and placed_entry["approved_via"] == "elicit"


@pytest.mark.parametrize("protocol", PROTOCOLS)
@pytest.mark.parametrize(("action", "confirm"), [("decline", True), ("cancel", True), ("accept", False)])
async def test_nothing_is_placed_without_approval(app, protocol, action, confirm):
    callback = elicitation(action=action, confirm=confirm)
    async with Client(build_server(app), mode=protocol, elicitation_callback=callback) as client:
        p = await preview(client)
        result = data(await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]}))
        assert result["placed"] is False
        orders = data(await client.call_tool("list_orders", {}))
        assert orders["orders"] == []
        # 拒否されたトークンは使い捨て
        retry = await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]})
        assert retry.is_error
    assert app.audit.entries()[-1]["event"] == "approval_declined"


@pytest.mark.parametrize("protocol", PROTOCOLS)
async def test_client_without_elicitation_cannot_place_in_elicit_mode(app, protocol):
    async with Client(build_server(app), mode=protocol) as client:
        p = await preview(client)
        result = await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]})
        assert "elicitation" in error_text(result)
        assert data(await client.call_tool("list_orders", {}))["orders"] == []


@pytest.mark.parametrize("protocol", PROTOCOLS)
async def test_client_approval_mode_skips_dialog(settings, broker, clock, protocol):
    settings.approval_mode = "client"
    app = TradingApp(settings, broker=broker, clock=clock)
    async with Client(build_server(app), mode=protocol) as client:
        p = await preview(client)
        placed = data(await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]}))
        assert placed["placed"]
    assert app.audit.entries()[-1]["approved_via"] == "client"


async def test_preview_rejection_returns_violations_without_token(app):
    async with Client(build_server(app), elicitation_callback=elicitation()) as client:
        p = await preview(client, symbol="9984")
        assert p["accepted"] is False
        assert "confirmation_token" not in p
        assert any("許可リスト" in v for v in p["violations"])
        short = await client.call_tool(
            "preview_order",
            {"symbol": "7203", "side": "buy", "quantity": 100, "limit_price": 2855, "reason": "なんとなく"},
        )
        assert "reason" in error_text(short)


async def test_risk_is_rechecked_when_placing(app, market):
    async with Client(build_server(app), elicitation_callback=elicitation()) as client:
        p = await preview(client)
        market.set_quote("7203", last=3000, ask=3001, bid=2999)  # 承認待ちの間に急騰
        result = data(await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]}))
        assert result["placed"] is False
        assert any("離れています" in v for v in result["violations"])


async def test_interval_and_daily_limits_survive_restart(app, settings, broker, clock):
    async with Client(build_server(app), elicitation_callback=elicitation()) as client:
        p = await preview(client)
        assert data(await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]}))["placed"]
        too_soon = await preview(client, symbol="6758", limit_price=3505)
        assert any("秒しか経っていません" in v for v in too_soon["violations"])

    clock.advance(31)
    restarted = TradingApp(settings, broker=broker, clock=clock)  # サーバー再起動を想定
    async with Client(build_server(restarted), elicitation_callback=elicitation()) as client:
        status = data(await client.call_tool("get_status", {}))
        assert status["today"]["orders_placed"] == 1
        assert status["today"]["buy_value_jpy"] == 285_500
        assert (await preview(client, symbol="6758", limit_price=3505))["accepted"]


async def test_kill_switch_blocks_new_orders(app, settings):
    (settings.data_dir / "STOP").touch()
    async with Client(build_server(app), elicitation_callback=elicitation()) as client:
        assert data(await client.call_tool("get_status", {}))["kill_switch_active"]
        p = await preview(client)
        assert any("キルスイッチ" in v for v in p["violations"])


async def test_cancel_and_journal(app):
    async with Client(build_server(app), elicitation_callback=elicitation()) as client:
        p = await preview(client, limit_price=2800)  # 売気配より下なので約定せず残る
        placed = data(await client.call_tool("place_order", {"confirmation_token": p["confirmation_token"]}))
        assert placed["order"]["status"] == "open"
        order_id = placed["order"]["order_id"]
        cancelled = data(await client.call_tool("cancel_order", {"order_id": order_id, "reason": "方針変更"}))
        assert cancelled["cancelled"]
        journal = data(await client.call_tool("get_journal", {}))
        assert [e["event"] for e in journal["entries"]][-2:] == ["order_placed", "cancel_requested"]


@pytest.mark.parametrize("protocol", PROTOCOLS)
async def test_parallel_orders_cannot_bypass_limits(settings, broker, clock, protocol):
    """Claude がツールを並列に呼んでも、発注間隔・日次上限のチェックをすり抜けない。"""
    settings.approval_mode = "client"
    app = TradingApp(settings, broker=broker, clock=clock)
    results = {}
    async with Client(build_server(app), mode=protocol) as client:
        a = await preview(client)
        b = await preview(client, symbol="6758", limit_price=3505)

        async def place(key, token):
            results[key] = data(await client.call_tool("place_order", {"confirmation_token": token}))

        async with anyio.create_task_group() as tg:
            tg.start_soon(place, "a", a["confirmation_token"])
            tg.start_soon(place, "b", b["confirmation_token"])
    assert sorted(r["placed"] for r in results.values()) == [False, True]
    blocked = next(r for r in results.values() if not r["placed"])
    assert any("秒しか経っていません" in v for v in blocked["violations"])
