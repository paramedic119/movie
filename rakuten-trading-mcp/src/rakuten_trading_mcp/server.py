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
from .brokers import CHART_INTERVALS, Broker, BrokerError, make_broker
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


def instructions_for(settings: Settings) -> str:
    return INSTRUCTIONS + (DELEGATE_MODE_NOTE if settings.approval_mode == "client" else CONFIRM_MODE_NOTE)


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
        self.clock = clock
        self.broker = broker if broker is not None else make_broker(settings, clock)
        self.audit = AuditLog(settings.data_dir / "audit", clock)
        self.risk = RiskManager(settings.risk, settings.data_dir, clock)
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
