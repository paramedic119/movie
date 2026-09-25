"""リプレイ（過去の日足で 1 日ずつ早送りする模擬売買）の時計。

「今」はリプレイ中の取引日の大引け後（15:30）。その日の終値までが見えていて、ここで出した注文は
翌営業日の日足で約定を判定する。どこまで進めたかは data_dir/replay.json に保存するので、再起動しても続きから。
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .brokers.base import BrokerError
from .market_hours import CLOSE_TIME
from .models import JST

STATE_FILE = "replay.json"


class ReplayClock:
    def __init__(self, dates: list[date], state_path: Path, start: date, end: date):
        if not dates:
            raise BrokerError(
                f"リプレイ期間（{start}〜{end}）の日足がありません。"
                "`python -m rakuten_trading_mcp --config config.toml fetch` でデータを取得してから始めてください"
            )
        self.dates = dates
        self.path = state_path
        self.period = (start.isoformat(), end.isoformat())
        self.index = 0
        self.finished = False
        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            saved = (state.get("start_date"), state.get("end_date"))
            if saved != self.period:
                raise BrokerError(
                    f"{state_path.parent} には別の期間（{saved[0]}〜{saved[1]}）のリプレイの記録があります。"
                    "新しい期間で始めるときは、このフォルダを削除するか、設定の data_dir を別のフォルダにしてください"
                )
            if state.get("current"):
                # データを取り直して日付の並びが変わっていても、保存した日以降の最初の取引日から続ける
                current = date.fromisoformat(state["current"])
                self.index = next((i for i, d in enumerate(dates) if d >= current), len(dates) - 1)
            self.finished = bool(state.get("finished"))
        self._save()

    def __call__(self) -> datetime:
        return datetime.combine(self.current, CLOSE_TIME, JST)

    @property
    def current(self) -> date:
        return self.dates[self.index]

    @property
    def remaining_days(self) -> int:
        return len(self.dates) - 1 - self.index

    def advance(self) -> date | None:
        """次の取引日へ進める。最終日なら終了の印を付けて None を返す。"""
        if self.index + 1 >= len(self.dates):
            self.finished = True
            self._save()
            return None
        self.index += 1
        self._save()
        return self.current

    def _save(self) -> None:
        state = {
            "start_date": self.period[0],
            "end_date": self.period[1],
            "current": self.current.isoformat(),
            "finished": self.finished,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)

    def info(self) -> dict[str, Any]:
        return {
            "current_date": self.current.isoformat(),
            "start_date": self.dates[0].isoformat(),
            "end_date": self.dates[-1].isoformat(),
            "day": self.index + 1,
            "total_days": len(self.dates),
            "remaining_days": self.remaining_days,
            "finished": self.finished,
        }
