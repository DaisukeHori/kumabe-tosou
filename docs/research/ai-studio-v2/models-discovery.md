# models-discovery [possible]

**推奨**: 3 社ともサーバサイドから models list API (OpenAI: Bearer / Anthropic: x-api-key+anthropic-version / Gemini: x-goog-api-key) を叩いてキー疎通確認とモデル列挙を兼ね (全て無料・トークン消費ゼロ)、結果を Supabase にキャッシュ。画像生成対応判別は Anthropic=常に非対応、Gemini=predict メソッド+"-image"/"imagen-" 名前規約、OpenAI=ID allowlist のハイブリッド方式を採用する。

## リスク
- OpenAI /v1/models は能力メタデータを一切返さないため、画像生成モデル判別は ID 命名規約 (gpt-image-*, dall-e-*) のハードコード頼りになり、新モデル追加時に allowlist 更新が必要 (将来破綻リスク)
- Gemini ネイティブ画像生成モデル (gemini-2.5-flash-image 等) は supportedGenerationMethods が通常テキストモデルと同じ generateContent のため API メタデータでは判別不可。名前規約判定が必要 (Imagen 系のみ predict で判別可)
- OpenAI ではキー有効 ≠ クォータ有: insufficient_quota (429) は生成時にしか判明せず、クレジット枯渇では invalid_api_key と同形式の 401 が返ることもあり、疎通確認の成功を生成可能と誤表示するリスク
- OpenAI 制限付き (Restricted/Project) キーは api.model.read スコープが無いと /v1/models が 403 になるため、403 を即『無効キー』と判定すると誤判定する
- Anthropic には画像生成モデルが存在しない (capabilities.image_input は Vision 入力の判別のみ)。CMS の画像生成プロバイダ候補から外す必要がある
- Gemini API は v1beta が主エンドポイントでありスキーマ変更リスクが残る。また Anthropic の max_input_tokens/max_tokens/capabilities は 2026-03 追加の比較的新しいフィールド
- Gemini countTokens の無償性は一次情報で未確認 (models.list の無償性は課金対象操作でないことから確実)

---

# models-discovery 調査結果 (2026-07 時点・一次情報ベース)

## 1. OpenAI — GET /v1/models

**[事実]** 公式リファレンス ([List models](https://developers.openai.com/api/reference/resources/models/methods/list)) より:

- **エンドポイント**: `GET https://api.openai.com/v1/models` / 単一取得は `GET /v1/models/{model}` ([Retrieve model](https://developers.openai.com/api/reference/resources/models/methods/retrieve))
- **認証**: `Authorization: Bearer $OPENAI_API_KEY` ヘッダのみ
- **ページネーション**: なし (全モデルを 1 レスポンスで返す。`object: "list"` + `data[]`)
- **返却メタデータ**: `id` / `object: "model"` / `created` (Unix 秒) / `owned_by` の **4 フィールドのみ**

```json
{ "object": "list", "data": [
  { "id": "gpt-image-1", "object": "model", "created": 1686935002, "owned_by": "openai" }
]}
```

**[事実] 画像生成対応の判別は API からは不可能。** レスポンスにコンテキスト長・モダリティ・能力情報は一切含まれない (公式リファレンスで確認)。能力情報の公開は [ユーザーからの機能要望](https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117) が出ている段階で未実装。

**→ 実装方針 (設計判断)**: 画像生成モデルは **ID 命名規約の allowlist/プレフィックス判定** (`gpt-image-*`, `dall-e-*`) でフィルタするしかない。一覧との突合 (「allowlist にあり、かつ /v1/models に現れるもの」) で「キーが使えるモデル」を出す構成が現実的。

**[注意・事実]** 制限付き (Restricted) API キー / プロジェクトキーでは `/v1/models` の呼び出しに `api.model.read` スコープが必要で、欠けると 403 になる ([Assign API Key Permissions](https://help.openai.com/en/articles/8867743-assign-api-key-permissions), [RBAC guide](https://platform.openai.com/docs/guides/rbac), [事例](https://community.openai.com/t/missing-scopes-model-request-on-restricted-api-key/1371602))。つまり「生成はできるが models 列挙は 403」というキーがあり得る。

---

## 2. Anthropic — GET /v1/models

**[事実]** 公式リファレンス ([List Models](https://platform.claude.com/docs/en/api/models-list)) より:

- **エンドポイント**: `GET https://api.anthropic.com/v1/models` / 単一取得 `GET /v1/models/{model_id}`
- **認証ヘッダ**: `x-api-key: $ANTHROPIC_API_KEY` + `anthropic-version: 2023-06-01` (必須)
- **ページネーション**: カーソル方式。`limit` (デフォルト 20、1〜1000)、`after_id` / `before_id`。レスポンスに `first_id` / `last_id` / `has_more`。新しいモデルが先頭
- **返却メタデータ** (ModelInfo):
  - `id`, `display_name`, `created_at` (RFC3339), `type: "model"`
  - `max_input_tokens` (コンテキスト長), `max_tokens` (出力上限)
  - `capabilities` — 各リーフに `{supported: boolean}`:
    - `image_input` (**画像入力=Vision 対応**), `pdf_input`
    - `structured_outputs`, `batch`, `citations`, `code_execution`
    - `thinking.types.{adaptive,enabled}`, `effort.{low,medium,high,xhigh,max}`
    - `context_management.{clear_tool_uses_20250919, clear_thinking_20251015, compact_20260112}`

```bash
curl https://api.anthropic.com/v1/models \
  -H 'anthropic-version: 2023-06-01' -H "x-api-key: $ANTHROPIC_API_KEY"
```

**[事実] Anthropic に画像「生成」モデルは存在しない。** `capabilities.image_input` はあくまで画像を入力できるか (Vision) の判別。CMS の画像生成プロバイダ候補としては Anthropic は対象外で、テキスト生成専用として扱うべき。

**[事実・補足]** SDK では `client.models.list()` (自動ページネーション) / `client.models.retrieve(id)`。Models API は第一者 API (api.anthropic.com) と Claude Platform on AWS のみ提供で、Bedrock/Vertex では提供されない (Anthropic 公式プラットフォーム対応表・claude-api スキル同梱資料より)。

---

## 3. Google Gemini — models.list

**[事実]** 公式リファレンス ([Models | Gemini API](https://ai.google.dev/api/models)) より:

- **エンドポイント**: `GET https://generativelanguage.googleapis.com/v1beta/models` / 単一取得 `GET /v1beta/models/{model}` (`name` は `models/gemini-2.0-flash` 形式)
- **認証**: `x-goog-api-key: YOUR_API_KEY` ヘッダ、または `?key=$GEMINI_API_KEY` クエリパラメータ ([API key docs](https://ai.google.dev/gemini-api/docs/api-key))。公式はクライアント側へのキー埋め込みを禁止し、バックエンドプロキシ経由を推奨
- **ページネーション**: `pageSize` (デフォルト 50、最大 1000) + `pageToken`。レスポンスに `nextPageToken`
- **返却メタデータ** (Model リソース): `name`, `baseModelId`, `version`, `displayName`, `description`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods` (string[]), `temperature`, `maxTemperature`, `topP`, `topK`, `thinking` (boolean)

**画像生成対応の判別 — [事実+実測]**:
- **Imagen 系**は `supportedGenerationMethods: ["predict"]` を返す (実測例: `models/imagen-3.0-generate-002` → `["predict"]`、[実レスポンス gist](https://gist.github.com/DF-wu/72ec3a7c2ff3247fc33b3eda07e048d0)、predict エンドポイント自体は [公式](https://ai.google.dev/api/models) に記載)。Veo 系は `predictLongRunning`
- **Gemini ネイティブ画像生成** (例: `gemini-2.0-flash-exp-image-generation`、実測で `["generateContent", "countTokens", "bidiGenerateContent"]`) は **通常のテキストモデルと同じ `generateContent` しか出ず、メソッドでは区別できない**。Model リソースに出力モダリティのフィールドは存在しない
- **→ 実装方針 (設計判断)**: `predict` を含む → Imagen 系画像生成、加えてモデル名の `-image` サフィックス / `imagen-` プレフィックス判定 (例: `gemini-2.5-flash-image` = Nano Banana) を併用するハイブリッド判定が必要

---

## 4. API キー有効性テスト (最小コスト疎通確認) のベストプラクティス

**[事実] 3 社とも「モデル一覧 API」がトークン消費ゼロ・無料の疎通確認手段**として使える:

| プロバイダ | 疎通エンドポイント | 成功 | 失敗 (無効キー) | コスト |
|---|---|---|---|---|
| OpenAI | `GET /v1/models` + `Authorization: Bearer` | 200 | 401 `invalid_api_key` ([Error codes](https://developers.openai.com/api/docs/guides/error-codes)) | 無料 |
| Anthropic | `GET /v1/models` + `x-api-key` + `anthropic-version` | 200 | 401 `authentication_error` | 無料 |
| Gemini | `GET /v1beta/models` + `x-goog-api-key` | 200 | 400/403 (INVALID_ARGUMENT / PERMISSION_DENIED) | 無料 |

**より深い検証 (推論能力まで確認したい場合)**:
- **Anthropic**: `POST /v1/messages/count_tokens` — 公式に「**Token counting is free to use**」と明記、レート制限も生成とは独立 (Start tier 2,000 RPM) ([Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting))。モデル指定込みで検証できる最良の無料プローブ
- **Gemini**: `models/{model}:countTokens` エンドポイントが同様に存在 (無償と一般に案内されているが、料金明記の一次情報は今回未確認 — 使う場合は要確認)
- **OpenAI**: 無料の生成プローブは存在しない。生成まで確認するなら `max_output_tokens` を最小にした安価モデル (例: gpt-*-mini/nano) への 1 リクエスト (実費数銭以下) が必要

**[注意] キー有効 ≠ 利用可能** (OpenAI で顕著):
- クレジット枯渇・未払いブロックでも `invalid_api_key` と同一形式の 401 が返るケースがある ([Incorrect API key provided](https://help.openai.com/en/articles/6882433-incorrect-api-key-provided), [community](https://community.openai.com/t/401-incorrect-api-key-provided/603609))
- クォータ不足 (`insufficient_quota` 429) は **生成呼び出し時にしか判明しない**。models 列挙の成功をもって「生成可能」と表示しない設計にすること
- OpenAI 制限付きキーは前述の通り `/v1/models` 自体が 403 になり得るため、「403 = 無効キー」と断定しない (生成スコープのみのキーがあり得る)

**CMS (Next.js 15 + Supabase + Vercel) への適用推奨**:
1. キーは必ずサーバ側 (Route Handler / Server Action) から呼ぶ。Gemini 公式もクライアント埋め込みを明示的に禁止
2. キー登録時: models list を叩いて 200 なら「疎通 OK」バッジ、結果 (モデル一覧 + capabilities) を Supabase にキャッシュ (TTL 数時間〜1 日) し、UI のモデルセレクタに使う
3. 画像生成対応フラグは: Anthropic = 常に false (生成モデル無し) / Gemini = `predict` メソッド or 名前規約 / OpenAI = ID allowlist、の 3 方式併用

## 出典一覧
- OpenAI List models: https://developers.openai.com/api/reference/resources/models/methods/list
- OpenAI Retrieve model: https://developers.openai.com/api/reference/resources/models/methods/retrieve
- OpenAI Error codes: https://developers.openai.com/api/docs/guides/error-codes
- OpenAI キー権限: https://help.openai.com/en/articles/8867743-assign-api-key-permissions / https://platform.openai.com/docs/guides/rbac
- OpenAI 401 と課金の関係: https://help.openai.com/en/articles/6882433-incorrect-api-key-provided
- OpenAI capabilities 非公開 (要望スレ): https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117
- Anthropic List Models: https://platform.claude.com/docs/en/api/models-list
- Anthropic Token counting (無料明記): https://platform.claude.com/docs/en/build-with-claude/token-counting
- Gemini Models API: https://ai.google.dev/api/models
- Gemini API key 認証: https://ai.google.dev/gemini-api/docs/api-key
- Gemini models.list 実レスポンス (supportedGenerationMethods 実測): https://gist.github.com/DF-wu/72ec3a7c2ff3247fc33b3eda07e048d0
