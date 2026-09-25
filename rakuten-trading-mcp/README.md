# rakuten-trading-mcp

楽天証券の口座を MCP（Model Context Protocol）でつなぎ、Claude が日本株（現物）を売買できるようにする実験的な MCP サーバーです。

- 楽天証券には公式の発注 API がないため、公式の自動発注手段である **マーケットスピード II RSS（Excel アドイン）を Python から操作**します。
- 最初は**模擬売買（paper）**で動きます。実際に発注する `live` モードは、設定と環境変数の二重の切り替えが必要です。
- 使い方は 2 通りです。
  - **確認モード**（既定）: Claude が注文を出すたびに確認ダイアログが出て、あなたが承認したものだけが発注されます。
  - **おまかせモード**: 確認なしで Claude が発注します。**予算（Claude に任せる金額）**と損失上限を決めて、その範囲で売買させます。
- どちらのモードでも、金額・回数・銘柄・価格の乖離・取引時間などの制限はサーバー側で必ずかかります。

考え方や他の方法との比較は [docs/DESIGN.md](docs/DESIGN.md) にまとめています。

> [!WARNING]
> - 投資の判断と損失はすべて利用者の責任です。Claude は相場を予測できるわけではなく、誤った判断をすることがあります。
> - RSS との接続部分（`brokers/rss.py`）は楽天証券の公開ドキュメントに基づいて実装しましたが、**実際の口座での動作確認はまだです**。下の「楽天証券につなぐ手順」のとおり、段階を踏んで確認してから使ってください。
> - このリポジトリの内容は投資助言ではありません。

## しくみ

```
Claude Code / Claude Desktop（あなたの PC 上で動かす）
   │ MCP（stdio）
   ▼
rakuten-trading-mcp ── リスクチェック / 予算 / 承認ダイアログ / 監査ログ
   │ paper: 模擬口座（JSON）       live: COM（pywin32）
   ▼                               ▼
サンプル株価 or RSS の株価        Excel + マーケットスピード II RSS → 楽天証券
```

すべて同じ Windows PC 上で動かします（paper + サンプル株価なら macOS / Linux でも動きます）。

## ツール

| ツール | 内容 |
|---|---|
| `get_status` | モード・承認方式・取引時間か・リスク上限・本日の残り枠・予算の状況 |
| `get_quote` | 現在値・前日終値・四本値・出来高・最良気配 |
| `get_price_history` | ローソク足（1分足〜月足） |
| `get_account` | 買付余力・保有銘柄・評価損益（予算が有効なら Claude の持ち分も） |
| `list_orders` | 本日の注文・未約定の注文 |
| `preview_order` | リスクチェックして確認トークンを発行（発注はしない）。売買の根拠 `reason` が必須 |
| `place_order` | 確認トークンの注文を発注（確認モードでは承認ダイアログつき） |
| `cancel_order` | 未約定の注文を取り消す |
| `get_journal` | 監査ログ（判断理由つき） |

## クイックスタート（模擬売買・どの OS でも）

Python 3.11 以上と Claude Code が必要です。

```powershell
cd rakuten-trading-mcp
python -m venv .venv
.venv\Scripts\activate            # macOS / Linux: source .venv/bin/activate
pip install -e .
python -m rakuten_trading_mcp init
python -m rakuten_trading_mcp --config config.toml check
claude
```

`init` がこのフォルダに設定一式（`config.toml`、サンプル株価、Claude Code 用の `.mcp.json` と `.claude/settings.local.json`）を作ります。`check` は発注せずに、株価と口座の読み取りだけを確認するコマンドです。

Claude Code が起動したら、例えばこう話しかけます。

> get_status を確認してから、7203 の株価と日足 60 本を見て、買うべきか判断して。買うなら 100 株の指値で。

Claude が注文を出そうとすると、注文内容と Claude の判断理由が書かれた確認ダイアログが出ます。承認したときだけ発注されます。

## おまかせモード（確認なし）と予算

確認ダイアログを出さずに Claude に売買を任せるときは、**予算**を決めて `init` し直します。

```powershell
python -m rakuten_trading_mcp init --delegate --budget 300000 --symbols 7203,6758,9432 --force
claude
```

> 予算 30 万円で、get_status の予算の範囲で売買して。方針は examples/session_prompt.md のとおり。

- `--delegate`: 確認ダイアログを出さない設定（`approval_mode = "client"`）にし、Claude Code で発注・取消のツールを事前に許可します（`.claude/settings.local.json`）。
- `--budget 300000`: Claude に任せる金額です。
- `--symbols`: Claude が売買してよい銘柄。予算の対象もこの銘柄だけです。
- `--max-loss`: 予算全体の損失上限（省略時は予算の 20%。30 万円なら 6 万円）。

予算のルール（サーバー側で強制され、Claude が変えることはできません）:

| ルール | 例（予算 30 万円） |
|---|---|
| 買えるのは「予算 − Claude が持っている株の取得原価 − 未約定の買い注文」まで | 7203 を 100 株（28.5 万円）持っていたら、あと 1.5 万円分しか買えない |
| 売ると、その分の取得原価が予算に戻る | 損をして売った場合は、損失の分だけ買える額が減る（`reinvest_profits = true` なら利益の分だけ増える） |
| 損失（確定 + 含み）が上限に達したら新規の買いを止める | 損益が −6 万円になったら買い停止。売りはできる |
| Claude が売れるのは、予算で買った株だけ | 予算を始める前から持っている株は「あなたの持ち分」として扱い、売らない |
| 予算の金額は `config.toml` でしか変えられない | 会話で「100 万円に増やして」と言っても変わらない |

予算の状況（残り・保有・損益）は `get_status` の `budget` で確認できます。

**開いている間ずっと任せる**: Claude Code の `/loop` で定期的に判断させられます。

```
/loop 30m examples/session_prompt.md の手順で、予算の範囲で売買を判断して
```

**外出先から見る・話しかける**: PC のこのフォルダで `claude remote-control` を実行すると、その会話がスマホの Claude アプリにも表示されます。

**止めるとき**: `data` フォルダに `STOP` という名前のファイルを置くと、消すまで新規の発注をすべて止めます（キルスイッチ）。確認モードに戻すには `--delegate` を付けずに `init --force` をやり直します。

> [!CAUTION]
> おまかせモードでは、Claude の判断だけで発注されます。まず模擬売買（paper）で数日〜数週間動かし、`get_journal` で判断の中身を確認してから、実弾（live）は少額で始めてください。実弾でおまかせにするには予算の設定が必須です。

## 楽天証券（RSS）につなぐ手順（Windows）

1. **RSS を使える状態にする**
   - マーケットスピード II と マーケットスピード II RSS をインストールし、マーケットスピード II にログイン、Excel の RSS タブで「接続」する。
   - 発注機能を使うには「マーケットスピード II RSS の利用に関する確認書兼同意書」への同意と、注文機能の設定（取引暗証番号など）が必要です。公式オンラインヘルプ「注文機能利用時の設定」を参照してください。
2. **作業用ブックを開く**: 空のブックを `mcp_bridge.xlsx` という名前で保存し、RSS が接続された同じ Excel で開いておく（Excel は 1 つだけ起動）。サーバーがこのブックに `MCP_*` シートを作り、RSS 関数を書き込みます。
3. **本物の株価で模擬売買する**: `init --market-data rss --force`（おまかせなら `--delegate --budget ...` も）で作り直し、`check` を実行。
   - 株価が取れること、`MCP_Positions` などの一覧シートの**列見出し**を確認する。想定と違う場合は `config.toml` に `[rss.columns]` を書いて直す（例: `quantity = ["保有数量"]`）。
   - しばらくこの状態で Claude に模擬売買させ、判断の傾向を見る。
4. **少額で実際に発注してみる**
   - `init --live --symbols 9432 --force`（確認モード）で作り直す。`.mcp.json` に `RAKUTEN_MCP_LIVE=yes` が入ります。
   - 上限をごく小さくする（`config.toml` の `max_order_value_jpy = 20000` など）。
   - 約定しにくい指値（現在値より 2% ほど下の買い）で 1 回発注し、`list_orders` で注文番号が取れること、`cancel_order` で取り消せることを確認する。楽天証券の画面でも注文と取消を確認する。
   - 口座区分（`rss.account_type`）のコード値は必ず公式ヘルプで確認してから使う。
5. **少額で運用開始**: 確認モードで慣れてから、おまかせにするなら `init --live --delegate --budget 50000 --symbols ... --force`。`get_journal` や `data/audit/*.jsonl` で Claude の判断を振り返りながら、ルールと上限を調整する。

### Claude Desktop で使う場合

設定 → 開発者 → 構成を編集 で開く `claude_desktop_config.json` に、[examples/claude_desktop_config.json](examples/claude_desktop_config.json) の内容（パスは自分の環境に合わせる）を追加して再起動します。Claude Desktop が確認ダイアログに対応していない場合、確認モードでは `place_order` がエラーになり発注されません（安全側に止まります）。おまかせ設定やツールの事前許可は Claude Code 向けに作っているので、Claude Code での利用をおすすめします。

## 安全装置

- **承認**: 確認モード（`approval_mode = "elicit"`）では、承認の結果がツールの引数ではなくクライアントからサーバーに直接届くので、Claude が自分で承認することはできません。
- **予算**: おまかせでも、予算の残り・損失上限・自分の持ち分以外は売らない、をサーバーが強制します。実弾でおまかせにするには予算の設定が必須です。
- **確認トークン**: 1 回限り・180 秒で失効。同じ注文が二重に出ません。
- **リスク制限**: 許可銘柄、1 注文・1 日・1 銘柄の金額上限、指値の乖離（既定 ±3%）、成行禁止、発注回数・取消回数・発注間隔、日次の損失上限、取引時間、保有数を超える売りの禁止。承認後の発注直前にも再チェックします。並列に呼ばれてもチェックをすり抜けないよう直列化しています。
- **キルスイッチ**: `data/STOP` というファイルを置くと、消すまで新規発注をすべて拒否します。
- **監査ログ**: `data/audit/YYYY-MM-DD.jsonl` に、プレビュー・拒否・発注・取消・予算の約定を判断理由つきで記録。回数・金額の上限はこのログから集計するので、再起動してもリセットされません。
- **設定ミス対策**: 設定ファイルの未知のキーはエラー。`live` は環境変数 `RAKUTEN_MCP_LIVE=yes` がないと起動しません。

## 無人で定期実行する

Claude Code を開いておかなくても、Windows のタスクスケジューラから平日の決まった時刻に [examples/scheduled_session.ps1](examples/scheduled_session.ps1) を実行すれば、Claude Code がヘッドレスで [examples/session_prompt.md](examples/session_prompt.md) の手順に従って売買します。事前に `init --delegate --budget ...` で設定を作っておいてください。

- 上限は対話型よりさらに小さく。Web 検索など外部情報のツールは許可しないことをおすすめします（ページに仕込まれた指示で判断が歪められるおそれがあるため）。
- Claude は呼ばれたときしか動かないので、損切りを Claude の巡回に頼らないでください。

## 設定

`init` が作る `config.toml` に主な項目があります。すべての項目とコメントは [examples/config.example.toml](examples/config.example.toml) を見てください。東証の祝日（`risk.market_holidays`）は毎年更新してください。

## 開発

```bash
pip install -e ".[dev]"
python -m pytest
```

テストは Excel なしで動きます（RSS 部分は偽の Excel で、発注関数に渡す引数の順番・コード値や一覧の読み取りを確認）。MCP の旧プロトコル（2025-11-25）と新プロトコル（2026-07-28）の両方で、承認ダイアログを含む発注フローと、予算つきのおまかせ発注を確認しています。
