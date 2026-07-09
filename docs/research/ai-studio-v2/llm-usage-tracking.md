# llm-usage-tracking [possible]

**推奨**: 生 usage (トークン数/枚数) を DB 保存の一次データとし、コストは TS 定数レート表 (model_id × unit × micro-USD、effective_from 付き) からの導出値にする。プロバイダ別 usage 正規化層 (キャッシュ/thinking の意味論差を吸収) を 1 モジュールに集約し、週次 CI で LiteLLM JSON と突合して乖離通知。既存 estimated_cost_cents (X 課金ガード) はそのまま、LLM 側は micro-USD 整数で別管理。

## リスク
- キャッシュトークンの意味論が 3 社で異なる (Anthropic: input_tokens はキャッシュ別建て / OpenAI・Gemini: prompt に込みで内訳から引き算) — 共通換算層を作らず単純に input×単価すると二重/過少計上になる
- thinking トークンの計上位置が 3 社で異なる (OpenAI: completion_tokens 内 / Anthropic: output_tokens 込み / Gemini: thoughtsTokenCount 別枠) — Gemini だけ output 課金対象 = candidates + thoughts の加算が必要
- 料金改定が既に予定されている (Claude Sonnet 5: 2026-09-01 に $2/$10 → $3/$15) — effective date なしの単一値レート表だと 9 月に狂う
- cents 整数 (既存 estimated_cost_cents 方式) は画像 1 枚 $0.005〜0.039 などサブセント課金で丸め誤差が蓄積 — LLM/画像側は micro-USD 推奨
- DALL·E 3 と Imagen 4 はレスポンスに usage が無い枚数課金 — 呼び出し側での枚数記録が漏れると追跡不能
- OpenAI Chat Completions のストリーミングは stream_options.include_usage を指定しないと usage が一切返らない (実装漏れ頻出ポイント)
- gpt-image 系の per-image 単価は品質×解像度依存の近似値で、公式は出力トークン実測課金 — 固定単価テーブルで事前見積りすると実請求とズレる (usage の output_tokens で事後補正が必要)
- LiteLLM JSON はコミュニティ管理 — 新モデル追加直後は数日ラグや誤記の可能性があり、公式ページとの突合なしの盲信は危険
- platform.openai.com は bot ブロック (403) — スクレイピングベースの自動更新は developers.openai.com か LiteLLM 経由に限定される

---

# LLM 利用量・課金額トラッキング調査 (2026-07-10 時点)

すべて本日 WebFetch/WebSearch/curl で一次情報を実取得して確認済み。推測箇所は【推測】と明記。

---

## 1. 各社 API の usage フィールド仕様差

### OpenAI (出典: 公式 OpenAPI 仕様 https://github.com/openai/openai-openapi の openapi.yaml を実取得し schema 抽出)

| API | usage の形 | キャッシュ/推論トークン |
|---|---|---|
| Chat Completions (`CompletionUsage`) | `prompt_tokens` / `completion_tokens` / `total_tokens` | `prompt_tokens_details.cached_tokens`、`completion_tokens_details.reasoning_tokens` (+`audio_tokens`, `accepted/rejected_prediction_tokens`) |
| Responses API (`ResponseUsage`) | `input_tokens` / `output_tokens` / `total_tokens` (全フィールド required) | `input_tokens_details.cached_tokens` (required)、`output_tokens_details.reasoning_tokens` (required) |
| Images API (`ImagesUsage`) | `total_tokens` / `input_tokens` / `output_tokens` + `input_tokens_details.{text_tokens, image_tokens}` | **GPT image 系モデルのみ返る** (スキーマ記述: "For the GPT image models only")。DALL·E には usage なし |
| 音声書き起こし | `gpt-4o-transcribe`: `input_tokens` (`input_token_details.{text_tokens, audio_tokens}`) + `output_tokens` + `total_tokens`。`whisper-1` 等は `TranscriptTextUsageDuration` (`type: "duration"`、秒数) | — |

**実装上の要注意点 (仕様から確認)**:
- Chat Completions のストリーミングでは `stream_options: {"include_usage": true}` を指定しないと usage が返らない (最終 chunk にのみ載る)。
- `prompt_tokens` は **cached_tokens を含む総数** (cached は内訳)。課金計算は `(prompt_tokens - cached_tokens) × input単価 + cached_tokens × cached単価 + completion_tokens × output単価`。
- `reasoning_tokens` は `completion_tokens` に含まれ output 単価で課金 (内訳表示用)。

### Anthropic (出典: claude-api スキル + https://platform.claude.com/docs/en/about-claude/pricing.md 実取得)

`usage` = `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` / `server_tool_use.web_search_requests` (+`service_tier`)。

- **OpenAI と決定的に違う点**: `input_tokens` は**非キャッシュ分のみ**。プロンプト総量 = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`。課金は各フィールド × 各単価をそのまま加算すればよい (OpenAI のような引き算不要)。
- cache write は 5m=1.25x / 1h=2x、cache read=0.1x (公式 pricing ページで確認)。
- web_search は $10/1,000 回で `web_search_requests` から算出。
- ストリーミングでは `message_delta` イベントに usage が載る (SDK の `finalMessage()` で確定値取得)。

### Gemini (出典: https://ai.google.dev/api/generate-content の UsageMetadata を実取得)

`usageMetadata` = `promptTokenCount` / `candidatesTokenCount` / `totalTokenCount` / `cachedContentTokenCount` / `thoughtsTokenCount` / `toolUsePromptTokenCount` + モダリティ別内訳 (`promptTokensDetails[]`, `candidatesTokensDetails[]`, `cacheTokensDetails[]`)。

- **`promptTokenCount` はキャッシュ分込みの実効プロンプト総数** (公式記述: "When cachedContent is set, this is still the total effective prompt size") — Anthropic 方式と逆で OpenAI 方式に近い。課金計算は `(promptTokenCount - cachedContentTokenCount) × input単価 + cachedContentTokenCount × cache単価`。
- **thinking トークンは `candidatesTokenCount` に含まれず `thoughtsTokenCount` として別枠**で返るが、課金は output 単価。output 課金対象 = `candidatesTokenCount + thoughtsTokenCount`。3 社で thinking の載る場所が全部違う (OpenAI=output内訳 / Anthropic=output_tokensに込み / Gemini=別フィールド) — **合算ロジックをプロバイダ別に分ける必要がある**。
- 画像等のモダリティ別トークンは `candidatesTokensDetails[]` (modality=IMAGE) で分離可能。

---

## 2. 料金レート (2026-07 時点、公式ページ実取得)

### Anthropic (https://platform.claude.com/docs/en/about-claude/pricing.md)
| モデル | Input | Output | Cache read | Cache write 5m/1h |
|---|---|---|---|---|
| claude-opus-4-8 (本プロジェクト採用) | $5/MTok | $25/MTok | $0.50/MTok | $6.25 / $10 |
| claude-sonnet-5 (〜2026-08-31 導入価格) | $2 → 9/1以降 $3 | $10 → $15 | $0.20 → $0.30 | $2.50/$4 → $3.75/$6 |
| claude-haiku-4-5 | $1 | $5 | $0.10 | $1.25/$2 |

Batch API 50% 引き。web search $10/1,000 検索。**Sonnet 5 の 2026-09-01 値上げが確定しているので、レート表に effective date の概念が必須**。画像生成 API は存在しない (pricing ページに項目なし、Messages API は画像入力のみ)。

### OpenAI (https://developers.openai.com/api/docs/pricing — 新公式ドメイン。WebFetch 可)
| モデル | Input | Cached input | Output |
|---|---|---|---|
| gpt-5.5 | $5.00 | $0.50 | $30.00 |
| gpt-5.4 | $2.50 | $0.25 | $15.00 |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 |
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 |

cached input は一律 input の 10%。`gpt-4o-transcribe` ≈ $0.006/分、`gpt-4o-mini-transcribe` ≈ $0.003/分 (設計書 §14 の試算と一致)。

### Gemini (https://ai.google.dev/gemini-api/docs/pricing)
| モデル | Input | Output |
|---|---|---|
| gemini-3.5-flash | $1.50/MTok | $9.00/MTok |
| gemini-3.1-pro-preview | $2.00 (≤200k) / $4.00 (>200k) | $12.00 / $18.00 |
| gemini-2.5-flash | $0.30 | $2.50 |
| gemini-2.5-flash-lite | $0.10 | $0.40 |

**Gemini は「プロンプト長 200k 超で単価が変わる」段階制**があり、レート表スキーマに閾値対応が必要 (Pro 系のみ)。

---

## 3. 画像生成の課金単位 (枚 vs トークン)

| プロバイダ/モデル | 課金単位 | 具体値 (出典) |
|---|---|---|
| OpenAI gpt-image-2 | **トークン課金** (text in $5/M, image in $8/M, image out $30/M) | per-image 近似: 1024² low $0.006 / medium $0.053 / high $0.211、1024×1536 & 1536×1024 low $0.005 / medium $0.041 / high $0.165 (公式 image-generation ガイド実取得) |
| OpenAI gpt-image-1.5 / 1 / 1-mini | トークン課金 (1.5: image out $32/M、mini: $8/M) | 出力トークン数は解像度×品質で決まる (272 tok = low 1024² 〜 6,240 tok = high 1024×1536)。ストリーミングの `partial_images` は**1 枚ごとに +100 image output tokens** |
| OpenAI DALL·E 3 (レガシー) | **枚数課金** | $0.04/枚 (standard 1024²、LiteLLM 表で確認)。usage フィールドが無いので**自前で枚数×単価を記録するしかない** |
| Google Imagen 4 | **枚数課金** | Fast $0.02 / Standard $0.04 / Ultra $0.06 per image (公式 pricing) |
| Google gemini-2.5-flash-image | トークン課金だが実質固定 | $0.039/枚 (1024² ≈ 1,290 tokens 固定、公式 pricing 明記) |
| Google gemini-3.1-flash-image (Nano Banana 2) | トークン課金 | output $60/M tok ≈ $0.045/0.5K 画像、$0.067/1K 画像 (公式 pricing 明記) |
| Anthropic | **画像生成なし** | — |

**設計含意**: 記録スキーマは「トークン数 (返る場合)」+「枚数・モデル・解像度・品質」の両方を保存するのが安全。トークン課金モデルは usage から正確に計算でき、枚数課金モデル (DALL·E 3, Imagen) は枚数×固定単価で計算する、という 2 系統になる。

---

## 4. 料金レート表の機械可読性と更新戦略

### 公式ソースの機械可読性 (実測)
- **OpenAI**: 公式の料金 API は無い。docs は developers.openai.com に移転しており WebFetch 可能な HTML (旧 platform.openai.com は bot ブロック 403)。
- **Anthropic**: 料金 API は無いが、**docs が `.md` サフィックスで Markdown として取得可能** (`https://platform.claude.com/docs/en/about-claude/pricing.md`) — 表がプレーン Markdown なのでパース容易 (本調査で実取得確認)。
- **Google**: ai.google.dev の pricing は HTML のみ。【推測 (公式 doc の存在は既知だが本調査では未実測)】Vertex AI 経由なら Cloud Billing Catalog API、Azure OpenAI なら Azure Retail Prices API が機械可読の公式 SKU 単価を返すが、Developer API (ai.google.dev) には該当なし。

### コミュニティの機械可読レート表 (実測・検証済み)
1. **LiteLLM `model_prices_and_context_window.json`** (https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) — 2,941 モデル収録。本日取得し、`claude-opus-4-8` ($5/$25)、`claude-sonnet-5` ($2/$10 導入価格)、`gpt-5.4` ($2.5/$15)、`gemini-3.5-flash` ($1.5/$9) がすべて**公式値と一致することを確認**。`input_cost_per_token` / `output_cost_per_token` / `cache_read_input_token_cost` / `input_cost_per_image` / `mode` (chat / image_generation / audio_transcription) のキー構造。
2. **OpenRouter `/api/v1/models`** (認証不要、実測 340 モデル) — `pricing.prompt/completion/input_cache_read/input_cache_write` を文字列 USD/token で返す。cache write 1h 単価まで持つ。ただし OpenRouter 経由価格なので直叩き構成では参照用。

### 推奨更新戦略 (kumabe-tosou 規模: 月 $30〜60、モデル 2〜3 種)
1. **アプリ内レート表は TypeScript 定数モジュールで管理** (DB 化は過剰)。`{ model_id, unit ('input_token'|'output_token'|'cache_read'|'cache_write_5m'|'image'|'web_search'|'audio_minute'), micro_usd_per_unit, effective_from }` の配列。Sonnet 5 の 9/1 値上げのような**予定改定を effective_from で先に入れておける**形にする。
2. **生の usage (トークン数・枚数) を必ず DB に保存し、金額は導出値**とする。単価改定時に過去分を再計算でき、X 実測照合 (§8.2 と同じ運用) も可能。金額を保存する場合はその時点の単価スナップショットを併記。
3. **更新検知**: 週次 GH Actions で LiteLLM JSON をフェッチ → 自レート表の該当モデルと突合 → 乖離があれば Issue/通知 (この JSON が公式値と一致することは上記で検証済み)。Anthropic は `.md` 直パースでの照合も可。

---

## 5. 既存実装との整合確認 (リポジトリ実読)

- **`src/modules/ai-studio/internal/claude.ts`** (62-68行): `toTokenUsage()` が Anthropic usage から `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `server_tool_use.web_search_requests` を抽出。**Anthropic の usage 仕様と 1:1 で正しい**。`contracts.ts` の zTokenUsage (91-97行) も同構造で、`ai_runs.token_usage` jsonb に stage 別合算で保存 (設計書 cms-ai-pipeline.md 330行)。**生トークン保存方式は本調査の推奨と整合。ただし金額換算は未実装** — 上記レート表を掛けるだけで月次コスト表示が作れる。
- **`src/modules/distribution/internal/billing.ts`**: `estimated_cost_cents` は **X (Twitter) 投稿課金専用** ($0.015/件、URL 付き $0.20/件) で LLM とは別系統。cents 整数 (Math.round) だが、LLM/画像はサブセント単位 ($0.006/枚など) が普通なので、**LLM コストに cents 整数を流用すると丸め誤差が蓄積する** → LLM 側は micro-USD 整数 (1 USD = 1,000,000) を推奨。X ガードの cents はそのまま維持でよい。
- **`src/modules/pricing/`** は塗装料金シミュレーション用で LLM 無関係。**LLM レート表を置く場合は名前衝突回避** (`ai-studio/internal/llm-rates.ts` 等) が必要。
- 設計書 §14 のコスト試算 (claude-opus-4-8 $5/$25、gpt-4o-transcribe $0.006/分) は**本日時点の公式値と一致** — 修正不要。
- 文字起こし (`transcribe.ts`, gpt-4o-transcribe): 現在 usage 未記録。レスポンスの `usage` (input_tokens に audio_tokens 内訳 / output_tokens) を token_usage と同様に保存可能 (OpenAPI 仕様で確認)。

---

## 出典 URL 一覧
- Anthropic 料金: https://platform.claude.com/docs/en/about-claude/pricing.md
- OpenAI OpenAPI 仕様 (usage スキーマ): https://github.com/openai/openai-openapi (openapi.yaml: CompletionUsage / ResponseUsage / ImagesUsage / TranscriptTextUsageDuration / ChatCompletionStreamOptions)
- OpenAI 料金: https://developers.openai.com/api/docs/pricing
- OpenAI 画像生成課金: https://developers.openai.com/api/docs/guides/image-generation
- Gemini UsageMetadata: https://ai.google.dev/api/generate-content
- Gemini 料金: https://ai.google.dev/gemini-api/docs/pricing
- LiteLLM レート表: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
- OpenRouter モデル API: https://openrouter.ai/api/v1/models
- 既存実装: /Users/horidaisuke/projects/kumabe-tosou/src/modules/ai-studio/internal/claude.ts, /Users/horidaisuke/projects/kumabe-tosou/src/modules/ai-studio/contracts.ts, /Users/horidaisuke/projects/kumabe-tosou/src/modules/distribution/internal/billing.ts, /Users/horidaisuke/projects/kumabe-tosou/docs/design/cms-ai-pipeline.md
