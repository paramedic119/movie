# 平日の決まった時刻に、Windows のタスクスケジューラから Claude Code をヘッドレスで実行する例（無人運用）。
#
# 前提:
#   - config.toml で approval_mode = "client"（ヘッドレス実行では確認ダイアログを出せず、elicit だと発注されない）
#   - リスク上限を対話型のときより小さくしておく
#   - live / paper+rss の場合は Excel + マーケットスピード II RSS を起動・接続しておく
#   - Claude Code（claude コマンド）にログイン済み
#
# タスクスケジューラの「操作」の設定例:
#   プログラム: powershell.exe
#   引数:       -NoProfile -ExecutionPolicy Bypass -File C:\trading\rakuten-trading-mcp\examples\scheduled_session.ps1
#   トリガー:   平日 9:30 / 13:00 / 14:30 など

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $here "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("session-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".json")

$prompt = Get-Content -Raw -Encoding UTF8 (Join-Path $here "session_prompt.md")

# 使ってよいツールだけを許可する。Web 検索などの外部情報のツールは、
# ページに仕込まれた指示で判断が歪められるおそれがあるので無人運用では許可しない。
$tools = @(
    "mcp__rakuten__get_status",
    "mcp__rakuten__get_quote",
    "mcp__rakuten__get_price_history",
    "mcp__rakuten__get_account",
    "mcp__rakuten__list_orders",
    "mcp__rakuten__preview_order",
    "mcp__rakuten__place_order",
    "mcp__rakuten__cancel_order",
    "mcp__rakuten__get_journal"
)

claude -p $prompt `
    --mcp-config (Join-Path $here "mcp.json") `
    --strict-mcp-config `
    --allowedTools $tools `
    --max-turns 30 `
    --output-format json |
    Out-File -Encoding utf8 $log
