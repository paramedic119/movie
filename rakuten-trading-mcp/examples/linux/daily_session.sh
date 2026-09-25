#!/usr/bin/env bash
# Linux で、日足（J-Quants）を使った模擬売買を毎営業日の夕方に無人で回す例。
#
#   1. J-Quants API から最新の日足を取得（fetch）
#   2. Claude Code をヘッドレスで起動し、daily_prompt.md の手順で売買を判断させる
#      （注文は翌営業日の日足で約定を判定。翌日の fetch で結果がわかる）
#
# 使い方:
#   examples/linux/daily_session.sh <init で作ったフォルダ>
#
# 前提:
#   - おまかせ設定を作ってある（ヘッドレスでは確認ダイアログを出せないため）:
#       python -m rakuten_trading_mcp init --dir ~/trading --market-data csv --delegate --budget 300000 --symbols 7203,6758
#   - J-Quants の API キーを、環境変数 JQUANTS_API_KEY か ~/.config/jquants/api_key（chmod 600）に置いてある
#     （日々の模擬売買には当日の日足が要るので有料プラン。無料プランは 12 週間遅れなので replay.sh を使う）
#   - Claude Code（claude コマンド）にログイン済み
#
# 定期実行（どちらか）:
#   cron（PC の時刻が日本時間のとき）:
#     30 18 * * 1-5  $HOME/rakuten-trading-mcp/examples/linux/daily_session.sh $HOME/trading
#   systemd のユーザータイマー: README の「Linux で動かす」を参照

set -euo pipefail

DIR="$(cd "${1:?init で作ったフォルダを指定してください}" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"  # cron から起動したときも claude を見つけられるように

# MCP サーバーと同じ Python（init を実行した仮想環境）を使う
PY="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["mcpServers"]["rakuten"]["command"])' "$DIR/.mcp.json")"

KEY_FILE="$HOME/.config/jquants/api_key"
FETCH_ARGS=()
if [ -z "${JQUANTS_API_KEY:-}" ] && [ -f "$KEY_FILE" ]; then
    FETCH_ARGS=(--api-key-file "$KEY_FILE")
fi

LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M)"

# 日足の取得に失敗したら、古い株価のまま判断させないよう Claude は起動しない
if ! "$PY" -m rakuten_trading_mcp --config "$DIR/config.toml" fetch ${FETCH_ARGS[@]+"${FETCH_ARGS[@]}"} \
    >"$LOG_DIR/fetch-$STAMP.log" 2>&1; then
    echo "日足の取得に失敗しました: $LOG_DIR/fetch-$STAMP.log" >&2
    exit 1
fi

# 使ってよいツールだけを許可する。Web 検索など外部情報のツールは、
# ページに仕込まれた指示で判断が歪められるおそれがあるので無人運用では許可しない。
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
)

cd "$DIR"
claude -p "$(cat "$HERE/daily_prompt.md")" \
    --mcp-config "$DIR/.mcp.json" \
    --strict-mcp-config \
    --allowedTools "${TOOLS[@]}" \
    --max-turns 40 \
    --output-format json \
    >"$LOG_DIR/session-$STAMP.json"
