"""preview_order で作った「確認待ち注文」の保管。

確認トークンは 1 回だけ使え、期限（既定 180 秒）を過ぎると無効になる。同じ注文が二重に出ることを防ぐ。
"""

from __future__ import annotations

import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from .models import OrderRequest, now_jst


@dataclass(frozen=True)
class PendingOrder:
    token: str
    request: OrderRequest
    reason: str
    reference_price: float
    notional_jpy: float
    created_at: datetime
    expires_at: datetime
    name: str | None = None  # 銘柄名（確認ダイアログ用）


class PendingOrderStore:
    def __init__(self, ttl_seconds: int, clock: Callable[[], datetime] = now_jst):
        self._ttl = timedelta(seconds=ttl_seconds)
        self._clock = clock
        self._items: dict[str, PendingOrder] = {}
        self._lock = threading.Lock()

    def add(
        self, request: OrderRequest, reason: str, reference_price: float, notional_jpy: float, name: str | None = None
    ) -> PendingOrder:
        now = self._clock()
        pending = PendingOrder(
            token=secrets.token_hex(4),
            request=request,
            reason=reason,
            reference_price=reference_price,
            notional_jpy=notional_jpy,
            created_at=now,
            expires_at=now + self._ttl,
            name=name,
        )
        with self._lock:
            self._purge(now)
            self._items[pending.token] = pending
        return pending

    def peek(self, token: str) -> PendingOrder | None:
        with self._lock:
            self._purge(self._clock())
            return self._items.get(token)

    def take(self, token: str) -> PendingOrder | None:
        with self._lock:
            self._purge(self._clock())
            return self._items.pop(token, None)

    def _purge(self, now: datetime) -> None:
        for token in [t for t, p in self._items.items() if p.expires_at <= now]:
            del self._items[token]
