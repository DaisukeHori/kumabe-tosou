# gemini-image [possible]

**推奨**: Interactions API (@google/genai v2.10+) + gemini-3.1-flash-image (GA) を標準採用。1K $0.067/枚で 4K・Search grounding・マルチターン編集 (previous_interaction_id) まで対応し CMS 用途に最適。大量サムネのみ gemini-3.1-flash-lite-image ($0.034/枚) に落とし、複数枚は並列リクエストで実装。gemini-3.1-flash-lite-image というモデルは実在する。

## リスク
- 複数枚生成の公式パラメータ (candidateCount / number_of_images) が画像モデルで非対応 — N 枚必要なら並列 N リクエスト設計が必須でコストも N 倍
- generateContent が Legacy 化 (廃止日未定)。新規実装は Interactions API + @google/genai v2.10+ 必須だが、2026-05 に breaking change 実施済みの若い API のため今後もスキーマ変更リスクあり
- 画像生成モデルは API 無料枠なし (pricing ページ記載) — 開発/Preview 環境含め全リクエスト課金。CMS のプレビュー多用で費用が積む
- gemini-3.1-flash-lite-image の thinking_level 対応はドキュメント間で記述揺れ — 実装前に実キーで実測確認が必要
- models.list に画像モデルが列挙されるか・supportedGenerationMethods の値は一次情報で未確認 — 動的モデル検出に依存する設計は避け、ハードコード+設定差し替えにすべき
- Thinking はオフにできない (minimal が下限) かつ thinking トークンは課金対象 — コスト見積りに含める必要
- Google Search grounding は flash-lite-image で使えない — grounding 前提の機能を作るなら flash-image 以上に固定
- preview 系モデル ID (gemini-3.1-flash-image-preview 等) は 2026-06-25 にシャットダウン済み — 古い記事のコード例をコピーすると 404 になる

---

# Gemini 画像生成 API 調査結果 (2026-07 時点 / Gemini API・API キー前提)

## 1. モデルラインナップ — 「gemini-3.1-flash-lite-image」は実在する

公式ドキュメント ([モデル一覧](https://ai.google.dev/gemini-api/docs/models)、[画像生成ガイド](https://ai.google.dev/gemini-api/docs/image-generation)) に載る Nano Banana ファミリーは 4 モデル:

| モデルID | 通称 | 状態 | 解像度 | 入力/出力トークン |
|---|---|---|---|---|
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | **GA (2026-06-30)** | 1K のみ・14 アスペクト比 | 65,536 / 4,096 |
| `gemini-3.1-flash-image` | Nano Banana 2 | **GA (2026-05-28)** | 0.5K/1K/2K/4K (1:4〜8:1 含む拡張比率) | 131,072 / 32,768 |
| `gemini-3-pro-image` | Nano Banana Pro | **GA (2026-05-28)** | 1K/2K/4K | 65,536 / 32,768 |
| `gemini-2.5-flash-image` | Nano Banana (旧) | レガシー・移行推奨 | 1024px 帯 | — |

- **`gemini-3.1-flash-lite-image` は実在** (事実)。[ai.google.dev モデルページ](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image) と [DeepMind モデルカード](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite-image/) の両方に GA 版として記載。sub-2 秒レイテンシ目標、テキスト生成比 2.7 倍高速の効率特化モデル ([DeepMind](https://deepmind.google/models/gemini-image/flash-lite/))。
- preview 版 (`gemini-3.1-flash-image-preview` / `gemini-3-pro-image-preview`) は **2026-06-25 にシャットダウン済み** ([changelog](https://ai.google.dev/gemini-api/docs/changelog))。GA 版 ID (サフィックスなし) を使う。
- `gemini-2.5-flash-image` の廃止日は現時点で明記なし (事実: モデル一覧ページに記載なし)。ただし公式が Lite への移行を推奨。

## 2. API 形態 — Interactions API が GA・推奨、generateContent は "Legacy"

- **[Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)** (`POST https://generativelanguage.googleapis.com/v1beta/interactions`) が 2026-06 時点で GA、新規プロジェクトの推奨 ([get-started](https://ai.google.dev/gemini-api/docs/get-started))。画像生成ドキュメントの正はこちら ([image-generation](https://ai.google.dev/gemini-api/docs/image-generation))。
- **generateContent は「Legacy」に格下げ** ([旧ドキュメント](https://ai.google.dev/gemini-api/docs/generate-content/image-generation))。廃止日は未定・4 画像モデル全てで引き続き動作 (事実)。ただし新機能は Interactions 側に乗る文言。
- JS SDK: **`@google/genai` v2.3.0 以降で `ai.interactions.create()` 対応、最新 v2.10.0** ([npm](https://www.npmjs.com/package/@google/genai))。Next.js 15 サーバー側 (Route Handler / Server Action) からそのまま利用可。
- 注意: 2026-05-26 に Interactions API の request/response スキーマの breaking change が発効済み ([changelog](https://ai.google.dev/gemini-api/docs/changelog)) → SDK を最新に固定すること。

リクエスト形式 (画像生成、[公式例](https://ai.google.dev/gemini-api/docs/image-generation)):
```js
const interaction = await ai.interactions.create({
  model: "gemini-3.1-flash-image",
  input: "プロンプト",
  response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "2K" },
  generation_config: { thinking_level: "minimal" },
  tools: [{ type: "google_search" }]  // 任意
});
```

## 3. 画像編集 (入力画像 + テキスト指示) — 対応

- `input` にテキストパートと画像パート (base64 + mime_type) を並べる。**参照画像は最大 14 枚** ([image-generation](https://ai.google.dev/gemini-api/docs/image-generation))。
- **マルチターン編集**は `previous_interaction_id` で前回結果を参照 (サーバー側で状態管理、画像の再送不要)。「画像を反復改良する推奨手段」と明記 (事実)。
- generateContent 経由でも `contents` に画像+テキストで従来通り可能 ([legacy doc](https://ai.google.dev/gemini-api/docs/generate-content/image-generation))。

## 4. 複数枚生成 — 公式パラメータは存在しない (重要)

- **`candidateCount` は画像生成モデルで非対応**。指定すると "Multiple candidates is not enabled for this model" / INVALID_ARGUMENT ([公式フォーラム](https://discuss.ai.google.dev/t/multiple-candidates-candidatecount-is-not-supported-for-image-generation-models/124694)、[python-genai #2347](https://github.com/googleapis/python-genai/issues/2347)、[#1534](https://github.com/googleapis/python-genai/issues/1534))。`number_of_images` 相当のパラメータも SDK でバリデーションエラー (事実)。
- 代替は 2 つ:
  1. **並列に N 回リクエスト** — 確実。コストは枚数分 (現実的な設計)。
  2. `gemini-3-pro-image` の **interleaved 出力** (1 応答にテキスト+複数画像を混在生成、ストーリー/ガイド用途) — ただし枚数の厳密制御はプロンプト頼みで不安定 (フォーラム報告、事実と区別: 安定性は伝聞)。

## 5. 料金 ([pricing](https://ai.google.dev/gemini-api/docs/pricing)、Standard / 1 枚あたり)

| モデル | 入力 | 画像出力 (1枚) | Batch |
|---|---|---|---|
| 3.1-flash-lite-image | $0.25/M tok | **1K ≈ $0.0336** | $0.0168 |
| 3.1-flash-image | $0.50/M tok | 0.5K $0.045 / **1K $0.067** / 2K $0.101 / 4K $0.151 | 半額 |
| 3-pro-image | $2.00/M tok + $0.0011/入力画像 | 1K-2K $0.134 / 4K $0.24 | 半額 |
| 2.5-flash-image | $0.30/M tok | $0.039 | $0.0195 |

- **無料枠: 4 モデルとも API では「なし」** (pricing ページ記載、事実)。
- **Thinking トークンはデフォルト有効かつ課金対象**。中間 thought image は課金されない (事実)。
- レート制限: 数値はドキュメント非公開、画像モデル専用指標 **IPM (images per minute)** が存在し tier 別値は [AI Studio](https://aistudio.google.com/rate-limit) で確認 ([rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits))。

## 6. Thinking / Google Search grounding のオンオフ

- **Thinking**: `generation_config.thinking_level` で `"minimal"` (デフォルト) / `"high"` を指定可能。**完全オフは不可** (「enabled by default and cannot be disabled」、[image-generation](https://ai.google.dev/gemini-api/docs/image-generation))。
  - ⚠️ 記述揺れあり: [flash-lite-image モデルページ](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image) は thinking (minimal/high) 対応と記載、一方 image-generation ガイドの一節は thinking_level を 3.1-flash-image の文脈で説明。モデルページ+[モデルカード](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite-image/) (Thinking/No-thinking 両評価あり) を優位として「Lite も対応」と判断するが、**実装時に実測確認を推奨** (ここは推測を含む)。
- **Google Search grounding**: `tools: [{type: "google_search"}]` の有無でオンオフ (デフォルトオフ)。対応マトリクス (事実):
  - `gemini-3-pro-image`: ✅ 対応
  - `gemini-3.1-flash-image`: ✅ 対応 + **image_search も指定可 (このモデル限定)** — `tools:[{type:"google_search", search_types:["web_search","image_search"]}]`
  - `gemini-3.1-flash-lite-image`: ❌ 非対応
- その他機能差: function calling は **Lite のみ対応** / structured outputs は **3-pro-image のみ対応** / Batch API は 3 系全て対応 (各モデルページ)。

## 7. models.list でのモデル列挙

- `GET /v1beta/models` (pageSize デフォルト 50・max 1000、`supportedGenerationMethods[]` フィールドあり) は健在 ([API リファレンス](https://ai.google.dev/api/models))。
- **画像生成モデルが models.list に列挙されるか、`supportedGenerationMethods` にどの値 (generateContent / interactions 系) が入るかは、一次情報での明示を発見できず** (事実: API リファレンスにもモデル一覧ページにも明記なし)。2025 年時点のダンプ ([例](https://gist.github.com/DF-wu/72ec3a7c2ff3247fc33b3eda07e048d0)) は古く 3 系画像モデルを含まない。
- → **設計上は models.list による動的検出に依存せず、モデル ID をハードコード + 設定で差し替え可能にする**のが安全 (これは推奨であり推測を含む)。実キー取得後に `curl "https://generativelanguage.googleapis.com/v1beta/models?key=..."` で 1 回実測して確定させること。

## 8. リポジトリ現状との関係

`/Users/horidaisuke/projects/kumabe-tosou/.env.example` の AI スタジオ節 (Phase 2a、設計書 §7) は現在 ANTHROPIC_API_KEY / OPENAI_API_KEY のみで **Gemini キーは未定義**。画像生成を組み込むなら `GEMINI_API_KEY` の追加と、未設定時 graceful degradation (既存パターン踏襲) が必要。コードベースに Gemini 統合は未存在 (grep 確認済み)。
