"""監査ログ（JSON Lines、JST の日付ごとに 1 ファイル）。

発注回数・買付金額などの日次上限はこのログから毎回集計するので、サーバーを再起動してもリセットされない。
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .models import JST, now_jst

# 上限の集計に数えるイベント。送信時にエラーになった注文も「出たかもしれない」ので保守的に数える。
ORDER_EVENTS = frozenset({"order_placed", "order_error", "order_rejected"})
BUY_VALUE_EVENTS = frozenset({"order_placed", "order_error"})  # 証券会社に拒否された注文は金額に含めない
CANCEL_EVENTS = frozenset({"cancel_requested", "cancel_error"})


@dataclass
class DailyStats:
    orders_placed: int = 0
    buy_value_jpy: float = 0.0
    cancels: int = 0
    last_order_at: datetime | None = None
    day_start_equity: float | None = None


class AuditLog:
    def __init__(self, directory: Path, clock: Callable[[], datetime] = now_jst):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self._clock = clock
        self._lock = threading.Lock()

    def _path(self, day: date) -> Path:
        return self.directory / f"{day.isoformat()}.jsonl"

    def _today(self) -> date:
        return self._clock().astimezone(JST).date()

    def record(self, event: str, **data: Any) -> dict[str, Any]:
        now = self._clock().astimezone(JST)
        entry = {"ts": now.isoformat(timespec="seconds"), "event": event, **data}
        line = json.dumps(entry, ensure_ascii=False, default=str)
        with self._lock, self._path(now.date()).open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        return entry

    def entries(self, day: date | None = None) -> list[dict[str, Any]]:
        path = self._path(day or self._today())
        if not path.exists():
            return []
        out = []
        with self._lock, path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue  # 途中で切れた行は無視
        return out

    def events_since(self, start: str, events: frozenset[str], max_days: int = 14) -> list[dict[str, Any]]:
        """start（YYYY-MM-DD）から今日までの、指定したイベントを古い順に返す（最大 max_days 日分）。"""
        today = self._today()
        day = max(date.fromisoformat(start), today - timedelta(days=max_days))
        out: list[dict[str, Any]] = []
        while day <= today:
            out.extend(e for e in self.entries(day) if e.get("event") in events)
            day += timedelta(days=1)
        return out

    def daily_stats(self, day: date | None = None, equity_kind: str = "account") -> DailyStats:
        """equity_kind: 日次損失の基準にする評価額の種類（"account" = 口座 / "budget" = 予算）。"""
        stats = DailyStats()
        for e in self.entries(day):
            event = e.get("event")
            if event in ORDER_EVENTS:
                stats.orders_placed += 1
                if event in BUY_VALUE_EVENTS and e.get("side") == "buy":
                    stats.buy_value_jpy += float(e.get("notional_jpy") or 0)
                ts = datetime.fromisoformat(e["ts"])
                if stats.last_order_at is None or ts > stats.last_order_at:
                    stats.last_order_at = ts
            elif event in CANCEL_EVENTS:
                stats.cancels += 1
            elif (
                event == "equity_snapshot"
                and e.get("kind", "account") == equity_kind
                and stats.day_start_equity is None
            ):
                stats.day_start_equity = float(e["equity"])
        return stats

    def ensure_day_start_equity(self, equity: float | None, kind: str = "account") -> None:
        """その日最初に評価額を取得できたときに記録し、日次損失の基準にする。"""
        if equity is not None and self.daily_stats(equity_kind=kind).day_start_equity is None:
            self.record("equity_snapshot", equity=equity, kind=kind)
