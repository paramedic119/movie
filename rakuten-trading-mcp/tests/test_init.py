import json

import pytest
from mcp import Client, StdioServerParameters

from rakuten_trading_mcp.__main__ import main
from rakuten_trading_mcp.config import ConfigError, load_settings
from rakuten_trading_mcp.initialize import InitOptions, run_init, tool_rule


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_delegate_with_budget(tmp_path):
    assert main(["init", "--dir", str(tmp_path), "--delegate", "--budget", "300000", "--symbols", "7203,9432"]) == 0
    settings = load_settings(tmp_path / "config.toml", environ={})
    assert settings.mode == "paper" and settings.approval_mode == "client"
    assert settings.budget.enabled and settings.budget.amount_jpy == 300_000 and settings.budget.max_loss_jpy == 60_000
    assert settings.risk.allowed_symbols == ["7203", "9432"]
    assert (tmp_path / "quotes.sample.json").exists()

    server = read_json(tmp_path / ".mcp.json")["mcpServers"]["rakuten"]
    assert server["args"] == ["-m", "rakuten_trading_mcp"]
    assert server["env"] == {"RAKUTEN_MCP_CONFIG": str((tmp_path / "config.toml").resolve())}

    claude = read_json(tmp_path / ".claude" / "settings.local.json")
    assert tool_rule("place_order") in claude["permissions"]["allow"]
    assert claude["enabledMcpjsonServers"] == ["rakuten"]


def test_default_is_confirmation_mode(tmp_path):
    run_init(InitOptions(directory=tmp_path))
    settings = load_settings(tmp_path / "config.toml", environ={})
    assert settings.approval_mode == "elicit" and not settings.budget.enabled
    allow = read_json(tmp_path / ".claude" / "settings.local.json")["permissions"]["allow"]
    assert tool_rule("preview_order") in allow and tool_rule("place_order") not in allow


def test_existing_settings_are_merged_and_trading_rules_removed_when_not_delegating(tmp_path):
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    (claude_dir / "settings.local.json").write_text(
        json.dumps({"permissions": {"allow": ["Bash(git status)"]}, "model": "opus"}), encoding="utf-8"
    )
    (tmp_path / ".mcp.json").write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}}), encoding="utf-8")

    run_init(InitOptions(directory=tmp_path, delegate=True, budget=100_000))
    claude = read_json(claude_dir / "settings.local.json")
    assert claude["model"] == "opus" and "Bash(git status)" in claude["permissions"]["allow"]
    assert tool_rule("cancel_order") in claude["permissions"]["allow"]
    assert set(read_json(tmp_path / ".mcp.json")["mcpServers"]) == {"other", "rakuten"}

    run_init(InitOptions(directory=tmp_path, force=True))  # 確認モードに戻す
    allow = read_json(claude_dir / "settings.local.json")["permissions"]["allow"]
    assert tool_rule("place_order") not in allow and tool_rule("cancel_order") not in allow
    assert "Bash(git status)" in allow


def test_refuses_to_overwrite_config(tmp_path):
    run_init(InitOptions(directory=tmp_path))
    with pytest.raises(ConfigError, match="--force"):
        run_init(InitOptions(directory=tmp_path))


@pytest.mark.parametrize(
    ("options", "fragment"),
    [
        ({"live": True}, "--symbols"),
        ({"live": True, "delegate": True, "symbols": ("7203",)}, "--budget"),
        ({"budget": 0}, "--budget"),
        ({"budget": 100_000, "max_loss": -1}, "--max-loss"),
        ({"symbols": ("toyota",)}, "銘柄コード"),
        ({"market_data": "yahoo"}, "--market-data"),
        ({"replay": "2026-04-01"}, "開始日:終了日"),
        ({"replay": "2026-06-30:2026-04-01"}, "終了日以前"),
        ({"replay": "2026-04-01:2026-06-30", "market_data": "static"}, "csv"),
        ({"replay": "2026-04-01:2026-06-30", "live": True, "symbols": ("7203",)}, "--live"),
    ],
)
def test_invalid_options(tmp_path, options, fragment):
    with pytest.raises(ConfigError, match=fragment):
        run_init(InitOptions(directory=tmp_path, **options))


def test_live_delegation(tmp_path):
    run_init(InitOptions(directory=tmp_path, live=True, delegate=True, budget=50_000, symbols=("9432",)))
    env = read_json(tmp_path / ".mcp.json")["mcpServers"]["rakuten"]["env"]
    assert env["RAKUTEN_MCP_LIVE"] == "yes"
    settings = load_settings(tmp_path / "config.toml", environ={"RAKUTEN_MCP_LIVE": "yes"})
    assert settings.is_live and settings.budget.amount_jpy == 50_000
    assert settings.risk.max_order_value_jpy == 50_000


@pytest.mark.anyio
async def test_generated_mcp_json_starts_the_server(tmp_path):
    """init が作った .mcp.json の定義どおりにサーバーを起動できること。"""
    run_init(InitOptions(directory=tmp_path, delegate=True, budget=300_000))
    server = read_json(tmp_path / ".mcp.json")["mcpServers"]["rakuten"]
    params = StdioServerParameters(command=server["command"], args=server["args"], env=server["env"])
    async with Client(params) as client:
        status = (await client.call_tool("get_status", {})).structured_content
    assert status["approval_mode"] == "client"
    assert status["budget"]["enabled"] and status["budget"]["remaining_jpy"] == 300_000


def test_disabling_the_budget_loss_limit_disables_the_daily_one(tmp_path):
    run_init(InitOptions(directory=tmp_path, delegate=True, budget=100_000, max_loss=0))
    settings = load_settings(tmp_path / "config.toml", environ={})
    assert settings.budget.max_loss_jpy == 0 and settings.risk.max_daily_loss_jpy == 0


@pytest.mark.parametrize(("budget", "max_order"), [(None, 300_000), (300_000, 300_000)])
def test_default_limits_allow_one_lot_of_a_typical_large_cap(tmp_path, budget, max_order):
    """7203 を 100 株（約 28.5 万円）買える上限になっていること。"""
    run_init(InitOptions(directory=tmp_path, delegate=budget is not None, budget=budget))
    risk = load_settings(tmp_path / "config.toml", environ={}).risk
    assert risk.max_order_value_jpy == max_order and risk.max_position_value_jpy >= 285_500


@pytest.mark.parametrize(
    ("options", "enforced"),
    [
        ({}, False),
        ({"market_data": "csv"}, False),
        ({"market_data": "rss"}, True),
        ({"live": True, "symbols": ("9432",)}, True),
    ],
)
def test_market_hours_are_only_relaxed_for_sample_and_daily_prices(tmp_path, options, enforced):
    """サンプル株価はいつでも、日足は大引け後に判断して発注できる。RSS の株価や live では取引時間を守る。"""
    run_init(InitOptions(directory=tmp_path, **options))
    env = {"RAKUTEN_MCP_LIVE": "yes"} if options.get("live") else {}
    assert load_settings(tmp_path / "config.toml", environ=env).risk.enforce_market_hours is enforced


def test_replay_setup(tmp_path, capsys):
    args = ["init", "--dir", str(tmp_path), "--delegate", "--budget", "500000", "--symbols", "7203,6758"]
    assert main([*args, "--replay", "2026-04-01:2026-06-30"]) == 0
    out = capsys.readouterr().out
    assert "JQUANTS_API_KEY" in out and "fetch" in out and "data-replay フォルダに STOP" in out

    settings = load_settings(tmp_path / "config.toml", environ={})
    assert settings.paper.market_data == "csv" and settings.paper.bars_dir == str((tmp_path / "prices").resolve())
    assert settings.replay.enabled
    assert (settings.replay.start_date, settings.replay.end_date) == ("2026-04-01", "2026-06-30")
    assert settings.data_dir == (tmp_path / "data-replay").resolve()  # 通常の模擬売買の記録と混ぜない
    assert not (tmp_path / "quotes.sample.json").exists()
    allow = read_json(tmp_path / ".claude" / "settings.local.json")["permissions"]["allow"]
    assert {tool_rule("advance_day"), tool_rule("get_report"), tool_rule("place_order")} <= set(allow)


def test_daily_bars_setup(tmp_path):
    run_init(InitOptions(directory=tmp_path, market_data="csv"))
    settings = load_settings(tmp_path / "config.toml", environ={})
    assert settings.paper.market_data == "csv" and not settings.replay.enabled
    assert settings.data_dir == (tmp_path / "data").resolve()
