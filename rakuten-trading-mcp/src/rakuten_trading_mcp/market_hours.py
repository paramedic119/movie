"""東証の立会時間の判定。

祝日は設定（risk.market_holidays）で与える。年末年始（12/31〜1/3）と土日はコード側で休場扱い。
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, time

from .models import JST

# 2024年11月5日から大引けは 15:30。
SESSIONS: tuple[tuple[time, time], ...] = ((time(9, 0), time(11, 30)), (time(12, 30), time(15, 30)))
SESSION_TEXT = "平日 9:00-11:30 / 12:30-15:30（東証）"
_YEAR_END_HOLIDAYS = {(12, 31), (1, 1), (1, 2), (1, 3)}


def is_trading_day(now: datetime, holidays: Iterable[str] = ()) -> bool:
    local = now.astimezone(JST)
    if local.weekday() >= 5 or (local.month, local.day) in _YEAR_END_HOLIDAYS:
        return False
    return local.strftime("%Y-%m-%d") not in set(holidays)


def is_market_open(now: datetime, holidays: Iterable[str] = ()) -> bool:
    if not is_trading_day(now, holidays):
        return False
    t = now.astimezone(JST).time()
    return any(start <= t < end for start, end in SESSIONS)
