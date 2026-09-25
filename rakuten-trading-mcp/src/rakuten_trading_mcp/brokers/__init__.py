"""設定に応じてブローカー（模擬 or 楽天証券 RSS）と時計を組み立てる。"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from ..config import Settings
from ..models import now_jst
from .base import CHART_INTERVALS, Broker, BrokerError, MarketData
from .paper import PaperBroker
from .static import StaticMarketData

if TYPE_CHECKING:
    from ..replay import ReplayClock

__all__ = ["CHART_INTERVALS", "Broker", "BrokerError", "MarketData", "make_broker", "make_runtime"]

# 日々の模擬売買（リプレイ以外）で、最新の日足がこれより古ければ株価を返さない。年末年始や大型連休でも収まる日数。
MAX_BAR_AGE_DAYS = 10


def _check_data_dir(settings: Settings) -> None:
    """リプレイと通常の模擬売買の記録が同じ data_dir に混ざらないようにする（成績や口座が過去と今で混ざるため）。"""
    from ..replay import STATE_FILE

    data_dir = settings.data_dir
    is_replay_dir = (data_dir / STATE_FILE).exists()
    if settings.replay.enabled and not is_replay_dir:
        used = (data_dir / "paper_account.json").exists() or any((data_dir / "audit").glob("*.jsonl"))
        if used:
            raise BrokerError(
                f"{data_dir} には通常の模擬売買の記録があります。リプレイには別の data_dir を指定してください"
                "（`init --replay` で作った設定では data-replay）"
            )
    if not settings.replay.enabled and is_replay_dir:
        raise BrokerError(
            f"{data_dir} はリプレイの記録です（{STATE_FILE} あり）。通常の模擬売買には別の data_dir を指定してください"
        )


def make_runtime(
    settings: Settings, clock: Callable[[], datetime] = now_jst
) -> tuple[Broker, Callable[[], datetime], ReplayClock | None]:
    """ブローカーと、サーバー全体で使う時計を作る。リプレイのときは時計がリプレイ中の日付を指す。"""
    if settings.is_live:
        from .rss import RssBroker, RssSession

        return RssBroker(RssSession(settings.rss), settings.data_dir), clock, None

    _check_data_dir(settings)
    paper_args = {
        "state_path": settings.data_dir / "paper_account.json",
        "initial_cash": settings.paper.initial_cash_jpy,
        "commission_jpy": settings.paper.commission_jpy,
    }
    if settings.paper.market_data == "csv":
        from ..replay import STATE_FILE, ReplayClock
        from .bars import DailyBarData
        from .paper import DailyBarPaperBroker

        r = settings.replay
        data = DailyBarData(Path(settings.paper.bars_dir), clock=clock, max_age_days=MAX_BAR_AGE_DAYS)
        replay: ReplayClock | None = None
        if r.enabled:
            start, end = date.fromisoformat(r.start_date), date.fromisoformat(r.end_date)
            dates = data.trading_dates(settings.risk.allowed_symbols, start, end)
            replay = ReplayClock(dates, settings.data_dir / STATE_FILE, start, end)
            # 未来の足を見せない基準を、リプレイ中の日付にする。過去のデータなので古さのチェックはしない
            clock = data.clock = replay
            data.max_age_days = None
        return DailyBarPaperBroker(data, clock=clock, **paper_args), clock, replay

    if settings.paper.market_data == "rss":
        from .rss import RssMarketData, RssSession

        market_data: MarketData = RssMarketData(RssSession(settings.rss))
    else:
        market_data = StaticMarketData(Path(settings.paper.static_quotes_file))
    return PaperBroker(market_data, clock=clock, **paper_args), clock, None


def make_broker(settings: Settings, clock: Callable[[], datetime] = now_jst) -> Broker:
    return make_runtime(settings, clock)[0]
