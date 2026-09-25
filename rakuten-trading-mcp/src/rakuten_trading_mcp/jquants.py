"""J-Quants API（日本取引所グループ公式の個人向けデータ API）から日足を取得し、CSV に保存する。

- API キーは J-Quants のダッシュボードで発行し、環境変数 JQUANTS_API_KEY に入れる（設定ファイルやチャットには書かない）。
- 無料プランは 12 週間遅れのデータ、ライトプラン以上は当日の終値まで取れる（取引終了後に更新）。
- V2 API（/v2/equities/bars/daily、x-api-key ヘッダー）を使う。V1 は 2026 年 6 月に廃止済み。
- 株式分割・併合で過去と今の株価が不連続にならないよう、調整済みの四本値（AdjO など）があればそちらを使う。
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .brokers.bars import parse_date, read_bars, write_bars
from .models import Bar

API_BASE = "https://api.jquants.com/v2"
API_KEY_ENV = "JQUANTS_API_KEY"


class JQuantsError(Exception):
    pass


def api_base() -> str:
    return os.environ.get("JQUANTS_API_BASE", API_BASE).rstrip("/")


def _error_message(code: int, body: str) -> str:
    if code in (401, 403):
        return f"API キーが無効か、契約プランでは取得できない期間です（無料プランは 12 週間遅れ）: {body}"
    if code == 429:
        return "リクエスト数の上限に達しました。しばらく待ってから再実行してください"
    return f"J-Quants API のエラー（HTTP {code}）: {body}"


def _get_json(url: str, api_key: str, timeout: float, sleep: Callable[[float], None], retries: int = 3) -> dict:
    request = Request(url, headers={"x-api-key": api_key, "Accept": "application/json"})
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if e.code == 429 and attempt < retries:
                # 回数制限。Retry-After（秒）があれば従い、無ければ少し待ってやり直す
                try:
                    wait = float(e.headers.get("Retry-After") or 15)
                except ValueError:
                    wait = 15.0
                sleep(min(max(wait, 1.0), 120.0))
                continue
            raise JQuantsError(_error_message(e.code, body)) from e
        except URLError as e:
            raise JQuantsError(f"J-Quants API に接続できませんでした: {e.reason}") from e
    raise AssertionError("unreachable")


def _price(row: dict, name: str) -> float | None:
    """調整済みの値（AdjC など）があれば使い、無ければ調整前の値（C など）を使う。"""
    value = row.get("Adj" + name)
    return row.get(name) if value is None else value


def fetch_daily_bars(
    symbol: str,
    start: date,
    end: date,
    api_key: str,
    timeout: float = 30,
    sleep: Callable[[float], None] = time.sleep,
) -> list[Bar]:
    """銘柄の日足（四本値と出来高）を期間指定で取得する。ページ分割にも対応。"""
    params = {"code": symbol, "from": start.strftime("%Y%m%d"), "to": end.strftime("%Y%m%d")}
    rows: list[dict] = []
    while True:
        payload = _get_json(f"{api_base()}/equities/bars/daily?{urlencode(params)}", api_key, timeout, sleep)
        rows.extend(payload.get("data") or [])
        key = payload.get("pagination_key")
        if not key:
            break
        params["pagination_key"] = key
    bars = [
        Bar(
            date=parse_date(str(r["Date"])).isoformat(),
            time=None,
            open=_price(r, "O"),
            high=_price(r, "H"),
            low=_price(r, "L"),
            close=_price(r, "C"),  # type: ignore[arg-type]
            volume=_price(r, "Vo"),
        )
        for r in rows
        if _price(r, "C") is not None  # 売買が成立しなかった日は四本値が空
    ]
    return sorted(bars, key=lambda b: b.date)


def update_csv(
    directory: Path, symbol: str, start: date, end: date, api_key: str
) -> tuple[int, str | None, str | None]:
    """取得した日足を <銘柄>.csv にまとめる（同じ日付は新しい値で上書き）。追加行数と最初・最後の日付を返す。"""
    path = directory / f"{symbol}.csv"
    merged = {b.date: b for b in read_bars(path)} if path.exists() else {}
    fetched = fetch_daily_bars(symbol, start, end, api_key)
    added = sum(1 for b in fetched if b.date not in merged)
    merged.update({b.date: b for b in fetched})
    if merged:
        write_bars(path, merged.values())
    days = sorted(merged)
    return added, (days[0] if days else None), (days[-1] if days else None)
