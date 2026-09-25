"""日足 CSV（<銘柄コード>.csv）を読むデータソース。Windows や楽天証券の口座がなくても使える。

CSV は `python -m rakuten_trading_mcp fetch`（J-Quants API）で作るか、手元のデータを同じ形式で置く。
見出しは英語（Date,Open,High,Low,Close,Volume）でも日本語（日付,始値,高値,安値,終値,出来高）でもよい。

「今」（clock）までに確定した足だけを見せる（当日の足は大引け後から）。リプレイで未来の株価を見てしまわないため。
"""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from datetime import date, datetime, timedelta
from pathlib import Path

from ..market_hours import CLOSE_TIME
from ..models import JST, Bar, Quote, now_jst
from .base import BrokerError, MarketData

CSV_HEADER = ["Date", "Open", "High", "Low", "Close", "Volume"]
_ALIASES = {
    "date": ("date", "日付"),
    "open": ("open", "始値"),
    "high": ("high", "高値"),
    "low": ("low", "安値"),
    "close": ("close", "終値"),
    "volume": ("volume", "出来高"),
}


def parse_date(text: str) -> date:
    text = text.strip().replace("/", "-")
    if len(text) == 8 and text.isdigit():
        text = f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return date.fromisoformat(text[:10])


def _num(text: str | None) -> float | None:
    if text is None or not text.strip():
        return None
    return float(text.replace(",", ""))


def read_bars(path: Path) -> list[Bar]:
    """CSV を日付順の Bar のリストにする（終値の無い日は除く）。"""
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        columns = {}
        for key, names in _ALIASES.items():
            found = next((c for c in reader.fieldnames or [] if c.strip().lower() in names), None)
            if found is None and key != "volume":
                raise BrokerError(f"{path.name} に「{names[0]} / {names[1]}」の列がありません")
            columns[key] = found
        bars = {}
        for row in reader:
            close = _num(row[columns["close"]])
            if close is None:
                continue
            d = parse_date(row[columns["date"]])
            bars[d] = Bar(
                date=d.isoformat(),
                time=None,
                open=_num(row[columns["open"]]),
                high=_num(row[columns["high"]]),
                low=_num(row[columns["low"]]),
                close=close,
                volume=_num(row[columns["volume"]]) if columns["volume"] else None,
            )
    return [bars[d] for d in sorted(bars)]


def write_bars(path: Path, bars: Iterable[Bar]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        for b in sorted(bars, key=lambda b: b.date):
            writer.writerow([b.date, b.open, b.high, b.low, b.close, b.volume])
    tmp.replace(path)


class DailyBarData(MarketData):
    def __init__(self, directory: Path, clock: Callable[[], datetime] = now_jst, max_age_days: int | None = None):
        """max_age_days: 最新の足がこれより古いと株価を返さない（古い株価で発注しないため）。リプレイでは None。"""
        self.directory = directory
        self.clock = clock
        self.max_age_days = max_age_days
        self._cache: dict[str, tuple[float, list[Bar]]] = {}

    def _path(self, symbol: str) -> Path:
        return self.directory / f"{symbol}.csv"

    def all_bars(self, symbol: str) -> list[Bar]:
        path = self._path(symbol)
        try:
            mtime = path.stat().st_mtime
        except FileNotFoundError as e:
            raise BrokerError(
                f"銘柄 {symbol} の日足データ（{path}）がありません。"
                "`python -m rakuten_trading_mcp --config config.toml fetch` で取得してください"
            ) from e
        cached = self._cache.get(symbol)
        if cached is None or cached[0] != mtime:
            self._cache[symbol] = (mtime, read_bars(path))
        return self._cache[symbol][1]

    def today(self) -> date:
        return self.clock().astimezone(JST).date()

    def visible_bars(self, symbol: str) -> list[Bar]:
        """「今」までに確定した足。当日の足は大引け後から見える（未来の足は見せない）。"""
        now = self.clock().astimezone(JST)
        last_day = now.date() if now.time() >= CLOSE_TIME else now.date() - timedelta(days=1)
        return [b for b in self.all_bars(symbol) if b.date <= last_day.isoformat()]

    def get_quote(self, symbol: str) -> Quote:
        bars = self.visible_bars(symbol)
        if not bars:
            raise BrokerError(f"銘柄 {symbol} の {self.today()} 以前の日足がありません")
        last = bars[-1]
        age = (self.today() - date.fromisoformat(last.date)).days
        if self.max_age_days is not None and age > self.max_age_days:
            raise BrokerError(
                f"銘柄 {symbol} の日足が {last.date} までしかありません（{age} 日前）。古い株価では発注できないので、"
                "`python -m rakuten_trading_mcp --config config.toml fetch` で更新してください"
                "（J-Quants の無料プランは 12 週間遅れなので、日々の模擬売買には有料プランが必要。無料プランならリプレイを使う）"
            )
        return Quote(
            symbol=symbol,
            last=last.close,
            prev_close=bars[-2].close if len(bars) > 1 else None,
            open=last.open,
            high=last.high,
            low=last.low,
            volume=last.volume,
            time=f"{last.date} 終値（日足）",
            source="daily-bars",
        )

    def get_price_history(self, symbol: str, interval: str, count: int) -> list[Bar]:
        if interval != "D":
            raise BrokerError("日足データなので interval は D（日足）だけ使えます")
        return self.visible_bars(symbol)[-count:]

    def first_bar_after(self, symbol: str, day: date, inclusive: bool) -> Bar | None:
        """day より後（inclusive なら day を含む）の最初の足。まだ「今日」に届いていなければ None。"""
        start = day.isoformat()
        for b in self.visible_bars(symbol):
            if b.date > start or (inclusive and b.date == start):
                return b
        return None

    def trading_dates(self, symbols: Iterable[str], start: date, end: date) -> list[date]:
        """期間内に、どれかの銘柄の足がある日（リプレイで進める日付）。"""
        days = set()
        for symbol in symbols:
            for b in self.all_bars(symbol):
                d = date.fromisoformat(b.date)
                if start <= d <= end:
                    days.add(d)
        return sorted(days)
