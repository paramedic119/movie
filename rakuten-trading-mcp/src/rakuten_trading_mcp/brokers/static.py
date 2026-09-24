"""JSON ファイル（または dict）から株価を返す、動作確認用のデータソース。

ファイルは更新されるたびに読み直すので、手で価格を書き換えて約定の動きを試せる。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..models import Bar, Quote
from .base import BrokerError, MarketData

_QUOTE_FIELDS = ("name", "last", "prev_close", "open", "high", "low", "volume", "bid", "ask", "time")


class StaticMarketData(MarketData):
    def __init__(self, source: Path | dict[str, Any]):
        self._path = source if isinstance(source, Path) else None
        self._data: dict[str, Any] = {} if isinstance(source, Path) else source
        self._mtime: float | None = None

    def _load(self) -> dict[str, Any]:
        if self._path is not None:
            try:
                mtime = self._path.stat().st_mtime
            except FileNotFoundError as e:
                raise BrokerError(f"株価ファイルが見つかりません: {self._path}") from e
            if mtime != self._mtime:
                self._data = json.loads(self._path.read_text(encoding="utf-8"))
                self._mtime = mtime
        return self._data

    def set_quote(self, symbol: str, **fields: Any) -> None:
        """テスト用: 価格を更新する（dict を渡して作った場合のみ）。"""
        self._data.setdefault(symbol, {}).update(fields)

    def get_quote(self, symbol: str) -> Quote:
        item = self._load().get(symbol)
        if item is None:
            raise BrokerError(f"銘柄 {symbol} の株価データがありません（{self._path or 'static data'}）")
        return Quote(symbol=symbol, source="static", **{k: item.get(k) for k in _QUOTE_FIELDS})

    def get_price_history(self, symbol: str, interval: str, count: int) -> list[Bar]:
        if interval != "D":
            raise BrokerError("静的データソースは日足（D）のみ対応しています")
        rows = (self._load().get(symbol) or {}).get("history") or []
        return [
            Bar(
                date=r["date"],
                time=None,
                open=r.get("open"),
                high=r.get("high"),
                low=r.get("low"),
                close=r.get("close"),
                volume=r.get("volume"),
            )
            for r in rows[-count:]
        ]
