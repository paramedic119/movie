"""発注前のリスクチェック。

ここで 1 つでも違反があれば注文は出さない。Claude に何を言われても、このチェックはサーバー側で必ず実行される。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .audit import DailyStats
from .config import RiskSettings
from .market_hours import SESSION_TEXT, is_market_open
from .models import ACTIVE_STATUSES, AccountSnapshot, Order, OrderRequest, OrderType, Quote, Side, now_jst


@dataclass
class RiskDecision:
    violations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    reference_price: float | None = None
    notional_jpy: float | None = None

    @property
    def allowed(self) -> bool:
        return not self.violations


class RiskManager:
    def __init__(self, settings: RiskSettings, data_dir: Path, clock: Callable[[], datetime] = now_jst):
        self.s = settings
        self.kill_switch_path = data_dir / settings.kill_switch_file
        self._clock = clock

    def kill_switch_active(self) -> bool:
        return self.kill_switch_path.exists()

    def market_open(self) -> bool:
        return is_market_open(self._clock(), self.s.market_holidays)

    def symbol_violations(self, symbol: str) -> list[str]:
        """銘柄の許可/禁止リストだけの判定（株価を取りに行く前に弾くため）。"""
        v = []
        if self.s.allowed_symbols and symbol not in self.s.allowed_symbols:
            v.append(f"銘柄 {symbol} は許可リスト（risk.allowed_symbols）にありません")
        if symbol in self.s.denied_symbols:
            v.append(f"銘柄 {symbol} は禁止リスト（risk.denied_symbols）に入っています")
        return v

    def evaluate(
        self,
        req: OrderRequest,
        quote: Quote,
        account: AccountSnapshot,
        stats: DailyStats,
        open_orders: Iterable[Order] = (),
    ) -> RiskDecision:
        s = self.s
        d = RiskDecision()
        v, w = d.violations, d.warnings

        if not s.trading_enabled:
            v.append("設定で取引が無効になっています（risk.trading_enabled = false）")
        if self.kill_switch_active():
            v.append(
                f"キルスイッチが有効です（{self.kill_switch_path} が存在）。ファイルを削除するまで新規発注できません"
            )
        v.extend(self.symbol_violations(req.symbol))
        if req.quantity <= 0 or req.quantity % s.lot_size:
            v.append(f"数量は {s.lot_size} 株単位の正の数にしてください（指定: {req.quantity}）")
        if req.order_type is OrderType.MARKET and not s.allow_market_orders:
            v.append("成行注文は無効にしています（risk.allow_market_orders）。指値で発注してください")
        if req.order_type is OrderType.LIMIT and not (req.limit_price and req.limit_price > 0):
            v.append("指値注文には正の limit_price が必要です")
        if s.enforce_market_hours and not self.market_open():
            v.append(f"取引時間外です（{SESSION_TEXT}）。時間外の注文は翌営業日に執行されうるため受け付けません")

        ref = quote.reference_price()
        d.reference_price = ref
        if not ref or ref <= 0:
            v.append("基準価格（現在値/前日終値）を取得できないため、安全に発注できません")
        else:
            if req.order_type is OrderType.LIMIT and req.limit_price:
                deviation = abs(req.limit_price - ref) / ref * 100
                if deviation > s.max_price_deviation_pct:
                    v.append(
                        f"指値 {req.limit_price:,.1f}円 が基準価格 {ref:,.1f}円 から {deviation:.2f}% 離れています"
                        f"（上限 {s.max_price_deviation_pct}%）"
                    )
                unit_price = req.limit_price
            else:
                # 成行は不利な約定を見込んで上限いっぱいの価格で見積もる。
                unit_price = ref * (1 + s.max_price_deviation_pct / 100)
            notional = req.quantity * unit_price
            d.notional_jpy = round(notional, 1)

            if notional > s.max_order_value_jpy:
                v.append(f"注文金額 {notional:,.0f}円 が 1 注文の上限 {s.max_order_value_jpy:,.0f}円 を超えています")
            position = account.position(req.symbol)
            held = position.quantity if position else 0
            if req.side is Side.BUY:
                if stats.buy_value_jpy + notional > s.max_daily_buy_value_jpy:
                    v.append(
                        f"本日の買付金額が上限を超えます（本日 {stats.buy_value_jpy:,.0f}円 + 今回 {notional:,.0f}円"
                        f" > 上限 {s.max_daily_buy_value_jpy:,.0f}円）"
                    )
                if account.cash_available is None:
                    w.append("買付余力を取得できなかったため、余力チェックは証券会社側に任せます")
                elif notional > account.cash_available:
                    v.append(
                        f"買付余力が不足しています（必要 {notional:,.0f}円 / 余力 {account.cash_available:,.0f}円）"
                    )
                if held * ref + notional > s.max_position_value_jpy:
                    v.append(
                        f"発注後の {req.symbol} の保有額が 1 銘柄の上限 {s.max_position_value_jpy:,.0f}円 を超えます"
                        f"（保有 {held * ref:,.0f}円 + 今回 {notional:,.0f}円）"
                    )
            else:
                committed = sum(
                    o.remaining_quantity
                    for o in open_orders
                    if o.symbol == req.symbol and o.side is Side.SELL and o.status in ACTIVE_STATUSES
                )
                if req.quantity > held - committed:
                    v.append(
                        f"売却可能数量を超えています（保有 {held}株 − 発注中の売り {committed}株）。空売りには対応していません"
                    )

        if stats.orders_placed >= s.max_daily_orders:
            v.append(f"本日の発注回数が上限（{s.max_daily_orders}回）に達しました")
        if stats.last_order_at is not None:
            elapsed = (self._clock() - stats.last_order_at).total_seconds()
            if elapsed < s.min_seconds_between_orders:
                v.append(
                    f"前回の発注から {elapsed:.0f} 秒しか経っていません（最低 {s.min_seconds_between_orders:.0f} 秒あける設定）"
                )

        if s.max_daily_loss_jpy > 0:
            if stats.day_start_equity is not None and account.equity is not None:
                loss = stats.day_start_equity - account.equity
                if loss >= s.max_daily_loss_jpy and req.side is Side.BUY:
                    v.append(
                        f"本日の評価損失が上限に達したため新規の買いを停止しています"
                        f"（損失 {loss:,.0f}円 / 上限 {s.max_daily_loss_jpy:,.0f}円）。売りは可能です"
                    )
            else:
                w.append("評価額を取得できないため、日次損失の上限チェックは行っていません")
        return d

    def evaluate_cancel(self, stats: DailyStats) -> list[str]:
        if stats.cancels >= self.s.max_daily_cancels:
            return [
                f"本日の取消回数が上限（{self.s.max_daily_cancels}回）に達しました。見せ玉と誤解される取引を避けるための制限です"
            ]
        return []

    def limits(self) -> dict[str, object]:
        s = self.s
        return {
            "allowed_symbols": s.allowed_symbols or "（制限なし）",
            "lot_size": s.lot_size,
            "allow_market_orders": s.allow_market_orders,
            "max_order_value_jpy": s.max_order_value_jpy,
            "max_daily_buy_value_jpy": s.max_daily_buy_value_jpy,
            "max_position_value_jpy": s.max_position_value_jpy,
            "max_daily_orders": s.max_daily_orders,
            "max_daily_cancels": s.max_daily_cancels,
            "max_price_deviation_pct": s.max_price_deviation_pct,
            "min_seconds_between_orders": s.min_seconds_between_orders,
            "max_daily_loss_jpy": s.max_daily_loss_jpy or "（無効）",
            "enforce_market_hours": s.enforce_market_hours,
        }
