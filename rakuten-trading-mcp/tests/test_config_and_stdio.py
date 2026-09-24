import sys
from pathlib import Path

import pytest
from mcp import Client, StdioServerParameters

from rakuten_trading_mcp.config import ConfigError, load_settings

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def write_config(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "config.toml"
    path.write_text(body, encoding="utf-8")
    return path


def test_example_config_loads():
    s = load_settings(EXAMPLES / "config.example.toml", environ={})
    assert s.mode == "paper" and s.approval_mode == "elicit"
    assert s.data_dir == (EXAMPLES / "data").resolve()
    assert Path(s.paper.static_quotes_file) == (EXAMPLES / "quotes.sample.json").resolve()
    assert s.risk.allowed_symbols == ["7203", "6758", "9432", "8306"]


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ("[risk]\nmax_order_value = 1\n", "不明な設定"),  # 書き間違い（正しくは max_order_value_jpy）
        ('mode = "live"\n', "RAKUTEN_MCP_LIVE"),
        ('approval_mode = "auto"\n', "approval_mode"),
        ('[risk]\nallowed_symbols = ["toyota"]\n', "銘柄コード"),
        ('[rss.columns]\nfoo = ["x"]\n', "不明なキー"),
    ],
)
def test_invalid_configs_are_rejected(tmp_path, body, fragment):
    with pytest.raises(ConfigError, match=fragment):
        load_settings(write_config(tmp_path, body), environ={})


def test_live_mode_requires_env_var(tmp_path):
    path = write_config(tmp_path, 'mode = "live"\n')
    assert load_settings(path, environ={"RAKUTEN_MCP_LIVE": "yes"}).is_live


@pytest.mark.anyio
async def test_stdio_server_process(tmp_path):
    """実際に `python -m rakuten_trading_mcp` を子プロセスで起動し、stdio 経由でツールを呼ぶ。"""
    quotes = (EXAMPLES / "quotes.sample.json").as_posix()
    config = write_config(
        tmp_path,
        f'data_dir = "data"\n[paper]\nstatic_quotes_file = "{quotes}"\n[risk]\nallowed_symbols = ["7203"]\n',
    )
    params = StdioServerParameters(command=sys.executable, args=["-m", "rakuten_trading_mcp", "--config", str(config)])
    async with Client(params) as client:
        names = {t.name for t in (await client.list_tools()).tools}
        assert {"get_status", "preview_order", "place_order", "cancel_order"} <= names
        status = await client.call_tool("get_status", {})
        assert status.structured_content["mode"] == "paper"
        quote = await client.call_tool("get_quote", {"symbol": "7203.T"})
        assert quote.structured_content["last"] == 2850
    assert (tmp_path / "data" / "audit").is_dir()
