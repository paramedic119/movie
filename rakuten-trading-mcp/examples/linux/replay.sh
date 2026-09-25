#!/usr/bin/env bash
# 過去の相場での模擬売買（リプレイ）を、Claude Code のヘッドレス実行で最終日まで進める例。
# 1 回の実行で数日ずつ進め、終わるまで繰り返す（1 回の会話が長くなりすぎないように）。
#
# 使い方:
#   examples/linux/replay.sh <init --replay で作ったフォルダ> [1 回に進める日数（既定 5）]
#
# 前提:
#   - おまかせ設定でリプレイを作ってある（ヘッドレスでは確認ダイアログを出せないため）:
#       python -m rakuten_trading_mcp init --dir ~/replay --replay 2026-01-05:2026-03-31 --delegate --budget 300000 --symbols 7203,6758
#   - 日足を取得済み: python -m rakuten_trading_mcp --config ~/replay/config.toml fetch
#     （J-Quants の無料プランは 12 週間遅れなので、期間は 12 週間より前にする）
#   - Claude Code（claude コマンド）にログイン済み
#
# 途中で止めても、次に実行すれば続きから進む（進み具合は data-replay/replay.json）。

set -euo pipefail

DIR="$(cd "${1:?init --replay で作ったフォルダを指定してください}" && pwd)"
DAYS="${2:-5}"
MAX_RUNS="${MAX_RUNS:-100}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

PY="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["mcpServers"]["rakuten"]["command"])' "$DIR/.mcp.json")"
CONFIG="$DIR/config.toml"
STATE="$("$PY" -c 'import sys; from rakuten_trading_mcp.config import load_settings; print(load_settings(sys.argv[1]).data_dir / "replay.json")' "$CONFIG")"

finished() {
    "$PY" -c 'import json, sys; sys.exit(0 if json.load(open(sys.argv[1])).get("finished") else 1)' "$STATE"
}

TOOLS=(
    mcp__rakuten__get_status
    mcp__rakuten__get_quote
    mcp__rakuten__get_price_history
    mcp__rakuten__get_account
    mcp__rakuten__list_orders
    mcp__rakuten__preview_order
    mcp__rakuten__place_order
    mcp__rakuten__cancel_order
    mcp__rakuten__get_journal
    mcp__rakuten__get_report
    mcp__rakuten__advance_day
)

LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

# 設定と日足が揃っているか、発注せずに確かめる
if ! "$PY" -m rakuten_trading_mcp --config "$CONFIG" check >"$LOG_DIR/check.log" 2>&1; then
    echo "設定か日足に問題があります（fetch は済んでいますか）: $LOG_DIR/check.log" >&2
    exit 1
fi

PROMPT="$(cat "$HERE/replay_prompt.md")

今回の実行では、最大 ${DAYS} 営業日ぶん進めてください（advance_day を最大 ${DAYS} 回）。"

cd "$DIR"
for run in $(seq 1 "$MAX_RUNS"); do
    if finished; then
        echo "リプレイは最終日まで進みました。成績は Claude に get_report を頼むか、ログ（$LOG_DIR）を見てください。"
        exit 0
    fi
    log="$LOG_DIR/replay-$(date +%Y%m%d-%H%M%S)-$run.json"
    echo "[$run] $(date '+%H:%M:%S') 実行中... → $log"
    claude -p "$PROMPT" \
        --mcp-config "$DIR/.mcp.json" \
        --strict-mcp-config \
        --allowedTools "${TOOLS[@]}" \
        --max-turns $((DAYS * 15 + 10)) \
        --output-format json \
        >"$log"
done
echo "MAX_RUNS（$MAX_RUNS 回）に達したので止めました。続きは同じコマンドで再開できます。" >&2
exit 1
