"""J-Quants API からの日足取得（fetch コマンド）を、手元で立てた疑似 API サーバーで確かめる。"""

import json
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from rakuten_trading_mcp.__main__ import main
from rakuten_trading_mcp.brokers.bars import read_bars
from rakuten_trading_mcp.initialize import InitOptions, run_init
from rakuten_trading_mcp.jquants import JQuantsError, fetch_daily_bars, update_csv

API_KEY = "test-key-for-fake-server"


def row(day, o, h, lo, c, adjusted=None):
    r = {"Date": day, "Code": "72030", "O": o, "H": h, "L": lo, "C": c, "Vo": 1_000_000.0, "Va": 1.0}
    if adjusted is not None:
        ao, ah, al, ac = adjusted
        r |= {"AdjFactor": 1.0, "AdjO": ao, "AdjH": ah, "AdjL": al, "AdjC": ac, "AdjVo": 2_000_000.0}
    return r


ROWS = [
    row("2026-03-31", 2800.0, 2830.0, 2790.0, 2810.0, adjusted=(2800.0, 2830.0, 2790.0, 2810.0)),
    row("2026-04-01", 5620.0, 5700.0, 5600.0, 5680.0, adjusted=(2810.0, 2850.0, 2800.0, 2840.0)),  # 分割前の値
    row("2026-04-02", None, None, None, None, adjusted=(None, None, None, None)),  # 売買なし
    row("2026-04-03", 2870.0, 2900.0, 2860.0, 2890.0),  # 調整済みの値が無い
]


class FakeJQuants:
    """/v2/equities/bars/daily だけを持つ疑似サーバー。2 行ずつページ分割して返す。"""

    def __init__(self):
        self.requests: list[dict] = []
        self.rate_limited = 0
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, body, headers=()):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                for k, v in headers:
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                url = urlparse(self.path)
                params = {k: v[0] for k, v in parse_qs(url.query).items()}
                fake.requests.append({"path": url.path, "params": params, "key": self.headers.get("x-api-key")})
                if url.path != "/v2/equities/bars/daily":
                    return self._send(404, {"message": "not found"})
                if self.headers.get("x-api-key") != API_KEY:
                    return self._send(401, {"message": "The incoming token is invalid or expired."})
                if fake.rate_limited > 0:
                    fake.rate_limited -= 1
                    return self._send(429, {"message": "Too Many Requests"}, [("Retry-After", "0")])
                start, end = params["from"], params["to"]
                matched = [
                    r
                    for r in ROWS
                    if r["Code"].startswith(params["code"]) and start <= r["Date"].replace("-", "") <= end
                ]
                offset = int(params.get("pagination_key", 0))
                body = {"data": matched[offset : offset + 2]}
                if offset + 2 < len(matched):
                    body["pagination_key"] = str(offset + 2)
                return self._send(200, body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}/v2"


@pytest.fixture
def api(monkeypatch):
    fake = FakeJQuants()
    thread = threading.Thread(target=fake.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    thread.start()
    monkeypatch.setenv("JQUANTS_API_BASE", fake.base)
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    yield fake
    fake.server.shutdown()
    fake.server.server_close()


def test_fetch_follows_pages_and_prefers_adjusted_prices(api):
    bars = fetch_daily_bars("7203", date(2026, 3, 31), date(2026, 4, 3), API_KEY)
    assert [(b.date, b.open, b.close) for b in bars] == [
        ("2026-03-31", 2800, 2810),
        ("2026-04-01", 2810, 2840),  # 分割を調整した値
        ("2026-04-03", 2870, 2890),  # 調整済みの値が無ければ元の値
    ]
    assert bars[1].volume == 2_000_000
    assert [r["params"].get("pagination_key") for r in api.requests] == [None, "2"]
    assert api.requests[0]["params"] == {"code": "7203", "from": "20260331", "to": "20260403"}
    assert {r["key"] for r in api.requests} == {API_KEY}


def test_invalid_key(api):
    with pytest.raises(JQuantsError, match="API キー"):
        fetch_daily_bars("7203", date(2026, 3, 31), date(2026, 4, 3), "wrong-key")


def test_rate_limit_is_retried_then_reported(api):
    waits: list[float] = []
    api.rate_limited = 1
    assert len(fetch_daily_bars("7203", date(2026, 3, 31), date(2026, 3, 31), API_KEY, sleep=waits.append)) == 1
    assert waits == [1.0]
    api.rate_limited = 10
    with pytest.raises(JQuantsError, match="上限"):
        fetch_daily_bars("7203", date(2026, 3, 31), date(2026, 3, 31), API_KEY, sleep=waits.append)
    assert len(waits) == 1 + 3


def test_update_csv_merges_with_existing_rows(api, tmp_path):
    assert update_csv(tmp_path, "7203", date(2026, 3, 31), date(2026, 4, 1), API_KEY) == (2, "2026-03-31", "2026-04-01")
    assert update_csv(tmp_path, "7203", date(2026, 4, 1), date(2026, 4, 3), API_KEY) == (1, "2026-03-31", "2026-04-03")
    assert [b.date for b in read_bars(tmp_path / "7203.csv")] == ["2026-03-31", "2026-04-01", "2026-04-03"]


def test_fetch_command_continues_from_the_last_day(api, tmp_path, monkeypatch, capsys):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), market_data="csv"))
    monkeypatch.setenv("JQUANTS_API_KEY", API_KEY)
    config = str(tmp_path / "config.toml")
    assert main(["--config", config, "fetch", "--from", "2026-03-31", "--to", "2026-04-01"]) == 0
    assert main(["--config", config, "fetch", "--to", "2026-04-03"]) == 0
    assert api.requests[-1]["params"]["from"] == "20260402"  # 取得済みの翌日から
    assert main(["--config", config, "fetch", "--to", "2026-04-03"]) == 0
    out = capsys.readouterr().out
    assert "7203: 2 日分を追加" in out and "取得済み" in out
    assert len(read_bars(tmp_path / "prices" / "7203.csv")) == 3


def test_fetch_for_replay_includes_earlier_days_for_indicators(api, tmp_path, monkeypatch):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), replay="2026-04-01:2026-04-03"))
    monkeypatch.setenv("JQUANTS_API_KEY", API_KEY)
    assert main(["--config", str(tmp_path / "config.toml"), "fetch"]) == 0
    params = api.requests[0]["params"]
    assert (params["from"], params["to"]) == ("20251102", "20260403")  # 開始日の 150 日前から


def test_fetch_needs_an_api_key(tmp_path, monkeypatch, capsys):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), market_data="csv"))
    monkeypatch.delenv("JQUANTS_API_KEY", raising=False)
    assert main(["--config", str(tmp_path / "config.toml"), "fetch"]) == 2
    assert "JQUANTS_API_KEY" in capsys.readouterr().err


def test_fetch_reports_api_errors(api, tmp_path, monkeypatch, capsys):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), market_data="csv"))
    monkeypatch.setenv("JQUANTS_API_KEY", "wrong-key")
    assert main(["--config", str(tmp_path / "config.toml"), "fetch", "--from", "2026-03-31", "--to", "2026-04-03"]) == 1
    assert "API キー" in capsys.readouterr().err
    assert not (tmp_path / "prices" / "7203.csv").exists()


def test_fetch_rejects_a_bad_date(tmp_path, monkeypatch, capsys):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), market_data="csv"))
    monkeypatch.setenv("JQUANTS_API_KEY", API_KEY)
    assert main(["--config", str(tmp_path / "config.toml"), "fetch", "--from", "2026/04/01"]) == 2
    assert "YYYY-MM-DD" in capsys.readouterr().err


def test_fetch_reports_an_unreadable_key_file(tmp_path, monkeypatch, capsys):
    run_init(InitOptions(directory=tmp_path, symbols=("7203",), market_data="csv"))
    monkeypatch.delenv("JQUANTS_API_KEY", raising=False)
    args = ["--config", str(tmp_path / "config.toml"), "fetch", "--api-key-file", str(tmp_path / "missing")]
    assert main(args) == 2
    assert "読めません" in capsys.readouterr().err
