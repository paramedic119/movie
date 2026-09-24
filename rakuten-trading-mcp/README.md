# rakuten-trading-mcp

楽天証券の口座を MCP（Model Context Protocol）でつなぎ、Claude が日本株（現物）を売買できるようにする実験的な MCP サーバーです。

- 楽天証券には公式の発注 API がないため、公式の自動発注手段である **マーケットスピード II RSS（Excel アドイン）を Python から操作**します。
- 最初は**模擬売買（paper）**で動きます。実際に発注する `live` モードは、設定と環境変数の二重の切り替えが必要です。
- 発注は必ず **プレビュー → 人間の承認 → 発注** の流れで、金額・回数・銘柄・価格乖離・取引時間などの制限をサーバー側で強制します。

考え方や他の方法との比較は [docs/DESIGN.md](docs/DESIGN.md) にまとめています。

> [!WARNING]
> - 投資の判断と損失はすべて利用者の責任です。Claude は相場を予測できるわけではなく、誤った判断をすることがあります。
> - RSS との接続部分（`brokers/rss.py`）は楽天証券の公開ドキュメントに基づいて実装しましたが、**実際の口座での動作確認はまだです**。下の「楽天証券につなぐ手順」のとおり、段階を踏んで確認してから使ってください。
> - このリポジトリの内容は投資助言ではありません。

## しくみ

```
Claude Desktop / Claude Code
   │ MCP（stdio）
   ▼
rakuten-trading-mcp ── リスクチェック / 承認ダイアログ / 監査ログ
   │ paper: 模擬口座（JSON）       live: COM（pywin32）
   ▼                               ▼
サンプル株価 or RSS の株価        Excel + マーケットスピード II RSS → 楽天証券
```

すべて同じ Windows PC 上で動かします（paper + サンプル株価なら macOS / Linux でも動きます）。

## ツール

| ツール | 内容 |
|---|---|
| `get_status` | モード・承認方式・取引時間か・リスク上限・本日の残り枠 |
| `get_quote` | 現在値・前日終値・四本値・出来高・最良気配 |
| `get_price_history` | ローソク足（1分足〜月足） |
| `get_account` | 買付余力・保有銘柄・評価損益 |
| `list_orders` | 本日の注文・未約定の注文 |
| `preview_order` | リスクチェックして確認トークンを発行（発注はしない）。売買の根拠 `reason` が必須 |
| `place_order` | 確認トークンの注文を発注（承認ダイアログつき） |
| `cancel_order` | 未約定の注文を取り消す |
| `get_journal` | 監査ログ（判断理由つき） |

## クイックスタート（模擬売買・どの OS でも）

Python 3.11 以上が必要です。

```powershell
cd rakuten-trading-mcp
python -m venv .venv
.venv\Scripts\activate            # macOS / Linux: source .venv/bin/activate
pip install -e .
copy examples\config.example.toml config.toml
copy examples\quotes.sample.json quotes.sample.json
python -m rakuten_trading_mcp --config config.toml check
```

`check` は発注せずに、設定・株価・口座の読み取りだけを確認するコマンドです。

### Claude Code に登録する

```powershell
claude mcp add --transport stdio --scope user rakuten `
  --env RAKUTEN_MCP_CONFIG=C:\trading\rakuten-trading-mcp\config.toml `
  -- C:\trading\rakuten-trading-mcp\.venv\Scripts\python.exe -m rakuten_trading_mcp
```

パスは自分の環境に合わせてください。Claude Code は承認ダイアログ（MCP elicitation）に対応しているので、既定の `approval_mode = "elicit"` のまま使えます。

### Claude Desktop に登録する

設定 → 開発者 → 構成を編集 で開く `claude_desktop_config.json` に、[examples/claude_desktop_config.json](examples/claude_desktop_config.json) の内容を追加して再起動します。

Claude Desktop が確認ダイアログに対応していない場合、`elicit` モードでは `place_order` がエラーになり発注されません（安全側に止まります）。その場合は Claude Code を使うか、`approval_mode = "client"` にして、ツール実行の許可ダイアログで**「1回だけ許可」**を選んで承認してください（`place_order` を「常に許可」にしないこと）。

### 話しかけてみる

> get_status を確認してから、7203 の株価と日足 60 本を見て、買うべきか意見をちょうだい。買うなら 100 株の指値でプレビューまで。

プレビューのあと Claude が `place_order` を呼ぶと、注文内容と Claude の判断理由が書かれた確認ダイアログが出ます。承認したときだけ発注されます。

## 楽天証券（RSS）につなぐ手順（Windows）

1. **RSS を使える状態にする**
   - マーケットスピード II と マーケットスピード II RSS をインストールし、マーケットスピード II にログイン、Excel の RSS タブで「接続」する。
   - 発注機能を使うには「マーケットスピード II RSS の利用に関する確認書兼同意書」への同意と、注文機能の設定（取引暗証番号など）が必要です。公式オンラインヘルプ「注文機能利用時の設定」を参照してください。
2. **作業用ブックを開く**: 空のブックを `mcp_bridge.xlsx` という名前で保存し、RSS が接続された同じ Excel で開いておく（Excel は 1 つだけ起動）。サーバーがこのブックに `MCP_*` シートを作り、RSS 関数を書き込みます。
3. **本物の株価で模擬売買する**: `config.toml` の `[paper] market_data = "rss"` にして `check` を実行。
   - 株価が取れること、`MCP_Positions` などの一覧シートの**列見出し**を確認する。想定と違う場合は `[rss.columns]` で直す（例: `quantity = ["保有数量"]`）。
   - しばらくこの状態で Claude に模擬売買させ、判断の傾向を見る。
4. **少額で実際に発注してみる**
   - `mode = "live"` にし、MCP の設定の `env` に `"RAKUTEN_MCP_LIVE": "yes"` を追加する（二重確認）。
   - 上限をごく小さくする（例: `allowed_symbols` を低位株 1 銘柄、`max_order_value_jpy = 20000`）。
   - 約定しにくい指値（現在値より 2% ほど下の買い）で 1 回発注し、`list_orders` で注文番号が取れること、`cancel_order` で取り消せることを確認する。楽天証券の画面でも注文と取消を確認する。
   - 口座区分（`rss.account_type`）のコード値は必ず公式ヘルプで確認してから使う。
5. **少額で運用開始**: `get_journal` や `data/audit/*.jsonl` で Claude の判断を振り返りながら、ルールと上限を調整する。

## 安全装置

- **承認**: `approval_mode = "elicit"`（既定）では、承認の結果がツールの引数ではなくクライアントからサーバーに直接届くので、Claude が自分で承認することはできません。
- **確認トークン**: 1 回限り・180 秒で失効。同じ注文が二重に出ません。
- **リスク制限**: 許可銘柄、1 注文・1 日・1 銘柄の金額上限、指値の乖離（既定 ±3%）、成行禁止、発注回数・取消回数・発注間隔、日次の評価損上限（現状は paper のみ）、取引時間、保有数を超える売りの禁止。承認後の発注直前にも再チェックします。
- **キルスイッチ**: `data/STOP` というファイルを置くと、消すまで新規発注をすべて拒否します。
- **監査ログ**: `data/audit/YYYY-MM-DD.jsonl` に、プレビュー・拒否・発注・取消を判断理由つきで記録。回数・金額の上限はこのログから集計するので、再起動してもリセットされません。
- **設定ミス対策**: 設定ファイルの未知のキーはエラー。`live` は環境変数 `RAKUTEN_MCP_LIVE=yes` がないと起動しません。

## 無人で定期実行する

[examples/scheduled_session.ps1](examples/scheduled_session.ps1) を Windows のタスクスケジューラから平日の決まった時刻に実行すると、Claude Code がヘッドレスで [examples/session_prompt.md](examples/session_prompt.md) のルールに従って売買します（MCP の設定は [examples/mcp.json](examples/mcp.json)）。

- ヘッドレス実行では確認ダイアログが出せないので `approval_mode = "client"` にし、`--allowedTools` で使えるツールを限定します。
- 上限は対話型よりさらに小さく。Web 検索など外部情報のツールは許可しないことをおすすめします。
- Claude は呼ばれたときしか動かないので、損切りを Claude の巡回に頼らないでください。

## 設定

[examples/config.example.toml](examples/config.example.toml) にすべての項目とコメントがあります。東証の祝日（`risk.market_holidays`）は毎年更新してください。

## 開発

```bash
pip install -e ".[dev]"
python -m pytest
```

テストは Excel なしで動きます（RSS 部分は偽の Excel で、発注関数に渡す引数の順番・コード値や一覧の読み取りを確認）。MCP の旧プロトコル（2025-11-25）と新プロトコル（2026-07-28）の両方で、承認ダイアログを含む発注フローを確認しています。
