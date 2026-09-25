"""MCP サーバー本体（Claude から呼ばれるツールの定義）。

このモジュールでは `from __future__ import annotations` を使わないこと。
place_order の承認パラメータ `Annotated[..., Resolve(order_approval)]` はクロージャ内の関数を参照しており、
注釈が文字列のままだと SDK が Resolve を認識できず、承認結果が「モデルが渡す引数」になってしまう。
（起動時に verify_approval_is_server_side() でも確認している）
"""

import logging
from collections.abc import Callable
from datetime import date, datetime
from functools import partial
from typing import Annotated, Any, Literal, TypeVar

import anyio
import anyio.to_thread
from mcp.server.mcpserver import AcceptedElicitation, Context, Elicit, ElicitationResult, MCPServer, Resolve
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from . import __version__
from .audit import AuditLog
from .brokers import CHART_INTERVALS, Broker, BrokerError, make_runtime
from .budget import CLAUDE_ORDER_EVENTS, BudgetLedger, BudgetStatus
from .config import Settings
from .market_hours import SESSION_TEXT
from .models import (
    JST,
    AccountSnapshot,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Side,
    normalize_symbol,
    now_jst,
    to_dict,
)
from .pending import PendingOrder, PendingOrderStore
from .replay import ReplayClock
from .risk import RiskManager

log = logging.getLogger(__name__)
T = TypeVar("T")

INSTRUCTIONS = """\
楽天証券の口座（またはペーパートレード）で日本株の現物を売買するためのツールです。
- 最初に get_status でモード（paper / live）、取引時間か、リスク上限と本日の残り枠を確認してください。
- 発注は必ず preview_order → place_order の 2 段階です。preview_order の reason には、
  根拠となったデータ（価格・指標・ニュース等）と売買の意図を具体的に書いてください。監査ログに残ります。
- リスク制限で拒否されたら、数量の分割や銘柄の付け替えなどで制限を回避しようとせず、その旨をユーザーに報告してください。
- 予算（get_status の budget）が有効なときは、その残り（remaining_jpy）の範囲で売買してください。
  予算で買った株（budget.holdings）だけが売却の対象で、予算の金額は設定ファイルでしか変えられません。
- 過去の判断は get_journal で振り返れます。
"""

CONFIRM_MODE_NOTE = """\
- 発注のたびにユーザーが確認ダイアログで承認します。live モードでは実際のお金が動くので、
  確信が持てない場合は発注せず、提案にとどめてユーザーの判断を仰いでください。
"""

DELEGATE_MODE_NOTE = """\
- おまかせモードです。ユーザーの確認なしで発注されます。ユーザーから任された方針・ルールの範囲でだけ売買し、
  当てはまらない・迷う・データが足りないときは発注しないでください（何もしないのも正しい選択です）。
  live モードでは実際のお金が動きます。
"""


REPLAY_NOTE = """\
- リプレイ（過去の相場の早送り）中です。「今」は get_status の replay.current_date の大引け後で、
  その日の終値までが見えています。売買を決めたら advance_day で次の取引日へ進めてください
  （出した注文は、進めた日の日足で約定を判定します）。最終日まで進んだら get_report で成績を報告してください。
"""


def instructions_for(settings: Settings) -> str:
    text = INSTRUCTIONS + (DELEGATE_MODE_NOTE if settings.approval_mode == "client" else CONFIRM_MODE_NOTE)
    return text + (REPLAY_NOTE if settings.replay.enabled else "")


class OrderApproval(BaseModel):
    """確認ダイアログ（MCP elicitation）でユーザーに入力してもらう内容。"""

    confirm: bool = Field(
        default=False,
        title="この注文を発注する",
        description="内容を確認し、発注してよければオンにしてください",
    )


class TradingApp:
    """サーバーの状態一式（設定・ブローカー・リスク管理・監査ログ・確認待ち注文）。"""

    def __init__(self, settings: Settings, broker: Broker | None = None, clock: Callable[[], datetime] = now_jst):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.settings = settings
        self.replay: ReplayClock | None = None
        if broker is None:
            broker, clock, self.replay = make_runtime(settings, clock)
        self.broker = broker
        self.clock = clock
        self.audit = AuditLog(settings.data_dir / "audit", clock)
        self.risk = RiskManager(settings.risk, settings.data_dir, clock, simulated=self.replay is not None)
        self.pending = PendingOrderStore(settings.confirmation_ttl_seconds, clock)
        self.budget = (
            BudgetLedger(settings.budget, settings.risk.allowed_symbols, settings.data_dir / "budget.json", clock)
            if settings.budget.enabled
            else None
        )

    @property
    def equity_kind(self) -> str:
        """日次損失の基準にする評価額（予算があれば予算の評価額、なければ口座の評価額）。"""
        return "budget" if self.budget is not None else "account"

    @property
    def mode_label(self) -> str:
        return "LIVE（実際の注文）" if self.settings.is_live else "PAPER（模擬売買）"

    def approval_message(self, p: PendingOrder) -> str:
        # MCP 2026-07-28 以降は再試行のたびに同じ文面である必要があるので、確認待ち注文の内容だけから作る。
        r = p.request
        price = f" {r.limit_price:,.1f}円" if r.order_type is OrderType.LIMIT and r.limit_price else ""
        name = f"（{p.name}）" if p.name else ""
        return "\n".join(
            [
                f"【{self.mode_label}】注文の確認",
                f"{r.side.label} {r.symbol}{name} {r.quantity:,}株 {r.order_type.label}{price}",
                f"概算金額: {p.notional_jpy:,.0f}円 / 基準価格: {p.reference_price:,.1f}円（プレビュー時点）",
                f"Claude の判断理由: {p.reason}",
                "発注してよければ「この注文を発注する」をオンにして承認してください。",
            ]
        )


def _symbol(raw: str) -> str:
    try:
        return normalize_symbol(raw)
    except ValueError as e:
        raise ToolError(str(e)) from e


def _budget_dict(b: BudgetStatus) -> dict[str, Any]:
    return {"enabled": True, **to_dict(b), "value_jpy": round(b.value_jpy, 1)}


def _order_fields(req: OrderRequest) -> dict[str, Any]:
    return {
        "symbol": req.symbol,
        "side": req.side.value,
        "quantity": req.quantity,
        "order_type": req.order_type.value,
        "limit_price": req.limit_price,
    }


def build_server(app: TradingApp) -> MCPServer:
    mcp = MCPServer(name="rakuten-trading", instructions=instructions_for(app.settings), version=__version__)
    read_only = ToolAnnotations(read_only_hint=True, open_world_hint=True)
    trading = ToolAnnotations(read_only_hint=False, destructive_hint=True, open_world_hint=True)
    order_lock = anyio.Lock()
    snapshot_lock = anyio.Lock()

    async def call(fn: Callable[..., T], *args: Any) -> T:
        """ブローカーの同期処理をワーカースレッドで実行し、BrokerError を Claude 向けのエラーにする。"""
        try:
            return await anyio.to_thread.run_sync(partial(fn, *args))
        except BrokerError as e:
            raise ToolError(str(e)) from e

    async def snapshot() -> tuple[AccountSnapshot, list[Order], BudgetStatus | None]:
        """口座と注文一覧を取得し、予算の台帳と突き合わせる。

        台帳は保有数量の差分で約定を検出するので、取得と照合は直列に行う（古い取得結果で照合しないように）。
        """
        async with snapshot_lock:
            account = await call(app.broker.get_account)
            orders = await call(app.broker.list_orders)
            if app.budget is None:
                app.audit.ensure_day_start_equity(account.equity, kind="account")
                return account, orders, None
            claude_orders = app.audit.events_since(app.budget.since_date, CLAUDE_ORDER_EVENTS)
            for fill in app.budget.reconcile(account, orders, claude_orders):
                app.audit.record("budget_fill", **fill)
            budget = app.budget.status(account, orders)
            app.audit.ensure_day_start_equity(budget.value_jpy, kind="budget")
            return account, orders, budget

    async def evaluate(req: OrderRequest):
        quote = await call(app.broker.market_data.get_quote, req.symbol)
        account, orders, budget = await snapshot()
        stats = app.audit.daily_stats(equity_kind=app.equity_kind)
        return quote, app.risk.evaluate(req, quote, account, stats, orders, budget), budget

    def rejected_preview(req: OrderRequest, reason: str, violations: list[str], warnings: list[str]) -> dict[str, Any]:
        app.audit.record("preview_rejected", **_order_fields(req), reason=reason, violations=violations)
        return {
            "accepted": False,
            "violations": violations,
            "warnings": warnings,
            "note": "リスク制限により受け付けませんでした。制限を回避する工夫はせず、この結果をユーザーに伝えてください。",
        }

    async def order_approval(confirmation_token: str, ctx: Context) -> OrderApproval | Elicit[OrderApproval]:
        """place_order の実行前に SDK が呼ぶ。承認方式が elicit ならユーザーに確認ダイアログを出す。"""
        pending = app.pending.peek(confirmation_token)
        if pending is None:
            raise ToolError("確認トークンが無効か期限切れです（使用済みを含む）。preview_order からやり直してください")
        if app.settings.approval_mode != "elicit":
            return OrderApproval(confirm=True)  # クライアント側のツール実行許可に承認を任せる設定
        caps = ctx.client_capabilities
        elicitation = caps.elicitation if caps is not None else None
        if elicitation is None or (elicitation.form is None and elicitation.url is not None):
            raise ToolError(
                "このクライアントは MCP の確認ダイアログ（elicitation）に対応していないため、"
                "approval_mode = 'elicit' では発注できません。注文は出していません。"
                "対応クライアント（Claude Code など）を使うか、設定で approval_mode = 'client' にして"
                "クライアントのツール実行許可で承認してください"
            )
        return Elicit(app.approval_message(pending), OrderApproval)

    @mcp.tool(annotations=read_only)
    async def get_status() -> dict[str, Any]:
        """モード（paper/live）、承認方式、取引時間中か、リスク上限、本日の発注回数・買付金額の残り枠を返す。最初に呼ぶこと。"""
        r = app.settings.risk
        budget = (await snapshot())[2] if app.budget is not None else None
        stats = app.audit.daily_stats(equity_kind=app.equity_kind)
        return {
            "mode": app.settings.mode,
            "mode_label": app.mode_label,
            "broker": app.broker.name,
            "approval_mode": app.settings.approval_mode,
            "now": app.clock().isoformat(timespec="seconds"),
            "market_open": app.risk.market_open(),
            "market_hours": SESSION_TEXT,
            "trading_enabled": r.trading_enabled,
            "kill_switch_active": app.risk.kill_switch_active(),
            "limits": app.risk.limits(),
            "today": {
                "orders_placed": stats.orders_placed,
                "remaining_orders": max(0, r.max_daily_orders - stats.orders_placed),
                "buy_value_jpy": stats.buy_value_jpy,
                "remaining_buy_value_jpy": max(0.0, r.max_daily_buy_value_jpy - stats.buy_value_jpy),
                "cancels": stats.cancels,
                "day_start_equity": stats.day_start_equity,
            },
            "budget": _budget_dict(budget) if budget is not None else {"enabled": False},
            "replay": {"enabled": True, **app.replay.info()} if app.replay is not None else {"enabled": False},
        }

    @mcp.tool(annotations=read_only)
    async def get_quote(symbol: str) -> dict[str, Any]:
        """銘柄の現在値・前日終値・始値/高値/安値・出来高・最良気配を返す。symbol は '7203' のような銘柄コード。"""
        return to_dict(await call(app.broker.market_data.get_quote, _symbol(symbol)))

    @mcp.tool(annotations=read_only)
    async def get_price_history(
        symbol: str,
        interval: Literal["1M", "5M", "10M", "15M", "30M", "60M", "D", "W", "M"] = "D",
        count: int = 60,
    ) -> dict[str, Any]:
        """ローソク足（始値・高値・安値・終値・出来高）を古い順に返す。interval: 1M/5M/…/60M=分足, D=日足, W=週足, M=月足。count は 1〜300。"""
        if interval not in CHART_INTERVALS:
            raise ToolError(f"interval は {CHART_INTERVALS} のいずれかにしてください")
        if not 1 <= count <= 300:
            raise ToolError("count は 1〜300 にしてください")
        sym = _symbol(symbol)
        bars = await call(app.broker.market_data.get_price_history, sym, interval, count)
        return {"symbol": sym, "interval": interval, "bars": to_dict(bars)}

    @mcp.tool(annotations=read_only)
    async def get_account() -> dict[str, Any]:
        """買付余力・保有銘柄（数量・平均取得単価・評価損益）・評価額合計を返す。"""
        account, _, budget = await snapshot()
        result = to_dict(account)
        if budget is not None:
            result["budget"] = _budget_dict(budget)
        return result

    @mcp.tool(annotations=read_only)
    async def list_orders() -> dict[str, Any]:
        """本日の注文と未約定の注文の一覧（状態・約定数量など）を返す。"""
        return {"orders": to_dict(await call(app.broker.list_orders))}

    @mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True))
    async def preview_order(
        symbol: str,
        side: Literal["buy", "sell"],
        quantity: int,
        reason: str,
        order_type: Literal["limit", "market"] = "limit",
        limit_price: float | None = None,
    ) -> dict[str, Any]:
        """注文をリスクチェックし、通れば確認トークンを返す（この時点では発注しない）。
        quantity は株数（通常 100 株単位）。reason には売買の根拠と意図を具体的に書く（監査ログに残る）。
        発注するには、ユーザーの意向を確認したうえで place_order に confirmation_token を渡す。"""
        if len(reason.strip()) < 10:
            raise ToolError("reason には売買の根拠と意図を具体的に書いてください（10 文字以上）")
        req = OrderRequest(
            symbol=_symbol(symbol),
            side=Side(side),
            quantity=quantity,
            order_type=OrderType(order_type),
            limit_price=limit_price if order_type == "limit" else None,
        )
        violations = app.risk.symbol_violations(req.symbol)  # 対象外の銘柄は株価を取りに行く前に弾く
        if app.replay is not None and app.replay.remaining_days == 0:
            violations.append(
                "リプレイの最終日です。これから出す注文は約定しないので、get_report で成績を確認してください"
            )
        if violations:
            return rejected_preview(req, reason, violations, [])
        quote, decision, budget = await evaluate(req)
        if not decision.allowed:
            return rejected_preview(req, reason, decision.violations, decision.warnings)
        assert decision.reference_price is not None and decision.notional_jpy is not None
        pending = app.pending.add(req, reason, decision.reference_price, decision.notional_jpy, name=quote.name)
        app.audit.record(
            "preview_ok", token=pending.token, **_order_fields(req), notional_jpy=decision.notional_jpy, reason=reason
        )
        approval = (
            "place_order を呼ぶとユーザーに確認ダイアログが表示され、承認された場合だけ発注されます。"
            if app.settings.approval_mode == "elicit"
            else "place_order を呼ぶと発注されます（承認はクライアントのツール実行許可に依存）。"
        )
        return {
            "accepted": True,
            "confirmation_token": pending.token,
            "expires_at": pending.expires_at.isoformat(timespec="seconds"),
            "mode": app.mode_label,
            "order": _order_fields(req) | {"name": quote.name},
            "estimated_value_jpy": decision.notional_jpy,
            "reference_price": decision.reference_price,
            "budget_remaining_jpy": budget.remaining_jpy if budget is not None else None,
            "warnings": decision.warnings,
            "next_step": approval,
        }

    @mcp.tool(annotations=trading)
    async def place_order(
        confirmation_token: str,
        approval: Annotated[ElicitationResult[OrderApproval], Resolve(order_approval)],
    ) -> dict[str, Any]:
        """preview_order で受け取った確認トークンの注文を発注する。トークンは 1 回限り・期限付き。
        承認方式が elicit の場合はユーザーに確認ダイアログが表示され、承認されたときだけ発注される。"""
        pending = app.pending.take(confirmation_token)
        if pending is None:
            raise ToolError("確認トークンが無効か期限切れです（使用済みを含む）。preview_order からやり直してください")
        req = pending.request
        if not (isinstance(approval, AcceptedElicitation) and approval.data.confirm):
            app.audit.record("approval_declined", token=pending.token, **_order_fields(req), reason=pending.reason)
            return {"placed": False, "message": "ユーザーが注文を承認しなかったため、発注していません。"}

        # チェックから記録までを直列化する。並列のツール呼び出しで日次上限や発注間隔をすり抜けないように。
        async with order_lock:
            # 承認を待つ間に価格や残り枠が変わっている可能性があるので、発注直前にもう一度チェックする。
            _, decision, _ = await evaluate(req)
            if not decision.allowed:
                app.audit.record(
                    "order_blocked", token=pending.token, **_order_fields(req), violations=decision.violations
                )
                return {"placed": False, "violations": decision.violations}

            base = {"token": pending.token, **_order_fields(req), "notional_jpy": decision.notional_jpy}
            # 発注から記録までの間に予算の照合が走ると、すぐ約定した分を「あなた自身の売買」と取り違えるので直列化する
            async with snapshot_lock:
                try:
                    order = await call(app.broker.place_order, req)
                except Exception as e:
                    app.audit.record("order_error", **base, reason=pending.reason, error=str(e))
                    raise
                event = "order_rejected" if order.status is OrderStatus.REJECTED else "order_placed"
                app.audit.record(
                    event,
                    **base,
                    order_id=order.order_id,
                    broker_order_no=order.broker_order_no,
                    status=order.status.value,
                    message=order.message,
                    reason=pending.reason,
                    approved_via=app.settings.approval_mode,
                )
        return {"placed": event == "order_placed", "mode": app.mode_label, "order": to_dict(order)}

    @mcp.tool(annotations=trading)
    async def cancel_order(order_id: str, reason: str) -> dict[str, Any]:
        """未約定の注文を取り消す。order_id は list_orders / place_order の結果にあるもの。"""
        async with order_lock:
            violations = app.risk.evaluate_cancel(app.audit.daily_stats())
            if violations:
                return {"cancelled": False, "violations": violations}
            try:
                order = await call(app.broker.cancel_order, order_id)
            except Exception as e:
                app.audit.record("cancel_error", order_id=order_id, reason=reason, error=str(e))
                raise
            app.audit.record("cancel_requested", order_id=order_id, reason=reason, status=order.status.value)
        return {"cancelled": order.status is OrderStatus.CANCELLED, "order": to_dict(order)}

    async def report() -> dict[str, Any]:
        account, _, budget = await snapshot()
        kind = app.equity_kind
        series: list[dict[str, Any]] = []
        for day in app.audit.days():
            # その日の評価額: リプレイは大引け時点（equity_close）、それ以外はその日最初に取得した値
            points = {"equity_close": [], "equity_snapshot": []}
            for e in app.audit.entries(day):
                if e.get("event") in points and e.get("kind", "account") == kind:
                    points[e["event"]].append(float(e["equity"]))
            values = points["equity_close"][-1:] or points["equity_snapshot"][:1]
            if values:
                series.append({"date": day.isoformat(), "equity": values[0]})
        current = budget.value_jpy if budget is not None else account.equity
        today = app.clock().astimezone(JST).date().isoformat()
        if current is not None:
            series = [p for p in series if p["date"] != today] + [{"date": today, "equity": round(current, 1)}]
        result: dict[str, Any] = {"basis": "予算の評価額" if kind == "budget" else "模擬口座の評価額"}
        if series:
            start, end = series[0]["equity"], series[-1]["equity"]
            peak, max_dd = start, 0.0
            for p in series:
                peak = max(peak, p["equity"])
                max_dd = min(max_dd, (p["equity"] - peak) / peak * 100 if peak else 0.0)
            result |= {
                "period": f"{series[0]['date']} 〜 {series[-1]['date']}",
                "start_equity": start,
                "current_equity": end,
                "return_pct": round((end / start - 1) * 100, 2) if start else None,
                "max_drawdown_pct": round(max_dd, 2),
                "equity_series": series[-250:],
            }
        all_orders = getattr(app.broker, "all_orders", None)
        if all_orders is not None:
            filled = [o for o in await call(all_orders) if o.status is OrderStatus.FILLED]
            result["filled_orders"] = {
                "buy": sum(o.side is Side.BUY for o in filled),
                "sell": sum(o.side is Side.SELL for o in filled),
            }
        market = app.broker.market_data
        if series and hasattr(market, "visible_bars"):
            # 同じ期間に各銘柄をただ持っていた場合の騰落率（比較用）
            holds = {}
            for symbol in app.settings.risk.allowed_symbols:
                try:
                    bars = [b for b in market.visible_bars(symbol) if b.date >= series[0]["date"]]
                except BrokerError:
                    continue
                if len(bars) >= 2 and bars[0].close:
                    holds[symbol] = round((bars[-1].close / bars[0].close - 1) * 100, 2)
            result["buy_and_hold_pct"] = holds
        if budget is not None:
            result["budget"] = _budget_dict(budget)
        if app.replay is not None:
            result["replay"] = app.replay.info()
        return result

    if not app.settings.is_live:

        @mcp.tool(annotations=read_only)
        async def get_report() -> dict[str, Any]:
            """模擬売買の成績（評価額の推移・騰落率・最大ドローダウン・約定数、各銘柄を持ち続けた場合との比較）を返す。"""
            return await report()

    if app.replay is not None:
        replay = app.replay

        @mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False))
        async def advance_day() -> dict[str, Any]:
            """リプレイを次の取引日に進める。出していた注文は、進めた日の日足で約定を判定する。"""
            async with order_lock:
                account, _, budget = await snapshot()  # 進める前の日の状態（予算の照合など）を確定させる
                closing = budget.value_jpy if budget is not None else account.equity
                if closing is not None:
                    app.audit.record("equity_close", equity=round(closing, 1), kind=app.equity_kind)
                before = {o.order_id: o.status for o in await call(app.broker.all_orders)}  # type: ignore[attr-defined]
                previous = replay.current
                new_date = replay.advance()
                if new_date is None:
                    return {
                        "finished": True,
                        "message": "リプレイ期間の最終日です。成績は get_report で確認できます。",
                        "report": await report(),
                    }
                app.audit.record("replay_advance", previous=previous.isoformat(), current=new_date.isoformat())
                # 日次の損失上限の基準は、実際の取引と同じく前日の大引け時点の評価額にする
                # （進めた日の値動きを含んだ後の値を基準にすると、その日の下落が損失として数えられない）
                app.audit.ensure_day_start_equity(closing, kind=app.equity_kind)
                account, _, budget = await snapshot()
                updates = [
                    to_dict(o)
                    for o in await call(app.broker.all_orders)  # type: ignore[attr-defined]
                    if before.get(o.order_id) is OrderStatus.OPEN and o.status is not OrderStatus.OPEN
                ]
            return {
                "finished": False,
                "replay": replay.info(),
                "order_updates": updates,
                "cash_available": account.cash_available,
                "equity": account.equity,
                "budget": _budget_dict(budget) if budget is not None else {"enabled": False},
            }

    @mcp.tool(annotations=read_only)
    async def get_journal(day: str | None = None) -> dict[str, Any]:
        """監査ログ（プレビュー・発注・拒否・取消と、その理由）を返す。day は 'YYYY-MM-DD'（省略時は今日）。"""
        try:
            d = date.fromisoformat(day) if day else None
        except ValueError as e:
            raise ToolError("day は YYYY-MM-DD 形式で指定してください") from e
        entries = app.audit.entries(d)
        day_label = (d or app.clock().astimezone(JST).date()).isoformat()
        return {"day": day_label, "entries": entries[-200:], "total": len(entries)}

    return mcp


async def verify_approval_is_server_side(mcp: MCPServer) -> None:
    """承認パラメータがモデルの入力になっていないことを確認する（なっていたら起動しない）。"""
    for tool in await mcp.list_tools():
        if tool.name == "place_order":
            props = (tool.input_schema or {}).get("properties", {})
            if set(props) != {"confirmation_token"}:
                raise RuntimeError(f"place_order の入力スキーマが想定外です: {sorted(props)}")
            return
    raise RuntimeError("place_order ツールが登録されていません")
