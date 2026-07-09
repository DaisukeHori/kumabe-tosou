# AI スタジオ v2 — リサーチ統合裁定 (設計の確定入力)

- 生成: 2026-07-10 ai-studio-v2-research Workflow (9 論点 → 統合)
- 論点別全文: 本ディレクトリの各 .md

# AI 機能拡張 — 設計書執筆のための確定入力 (9 論点統合)

対象リポジトリ: `/Users/horidaisuke/projects/kumabe-tosou`
canonical 文書との関係: 本書は **docs/design/cms-ai-pipeline.md (v3.0) と docs/module-contracts.md への追補設計の確定入力**。DDL・状態・画面は設計書側、モジュール境界・契約は契約書側に反映する。

---

## 1. 実現可能性マトリクス

| # | 機能 | 判定 | 根拠 (リサーチ結果より) |
|---|---|---|---|
| 1 | 文言候補生成 | **possible** | 既存 `ai-studio/internal/claude.ts` の標準形 (claude-opus-4-8 / structured outputs / streaming / cache_control) をそのまま流用可。サイト全文 MD + prompt caching でキャッシュ時 $0.04〜0.07/回。CHI 研究の裏付けで短文 3 候補が最適。 |
| 2 | 画像生成カスケード | **possible** | OpenAI `gpt-image-2` (images/edits: 入力最大 16 枚・n=1〜10) + Gemini `gemini-3.1-flash-image` (Interactions API: 参照 14 枚・`previous_interaction_id` でマルチターン編集)。両社とも「参照画像→生成→再編集」の系譜が API レベルで成立。ただし非同期ジョブ + IPM キュー制御が必須 (OpenAI Tier1 = 5 images/min、生成最大 2 分 > Vercel タイムアウト)。 |
| 3 | SNS 画像投稿 | **possible (要修正)** | 骨格は実装済みだが **X は v1.1 media upload が 2025-06-09 に sunset 済みで現在必ず失敗中** (worker の catch により「画像なし投稿」で顕在化)。v2 simple upload 移行 + `media.write` scope + 再認可で復旧。IG はコンテナ方式・公開 URL・JPEG 前提が現行仕様と完全一致、Graph v25.0 更新等の小改修のみ。 |
| 4 | note 投稿 | **partial** | 公式 API は存在しない (公式ヘルプ明記)。現行の半自動 (`manual_required`) が正。上限は「非公式 API による下書き作成 + 手動公開」で、Cookie 手動供給 (~30 日毎、reCAPTCHA v3 により無人更新不可) + 年数回の破壊的変更追従が恒常コスト。**自動公開は blocked** (BAN リスク中〜高 + 構造的に無人化不可)。 |
| 5 | マルチプロバイダキー管理 | **possible** (CLI トークン部分は **blocked**) | 3 社とも models list API が無料・トークン消費ゼロの疎通確認手段。Vault + RPC (`vault_upsert_secret`/`vault_read_secret`) 基盤は実装済みで流用可。**CLI OAuth トークン流用は 3 社とも ToS 違反 + サーバー側遮断 + BAN 実績ありで設計から除外**。 |
| 6 | 料金ダッシュボード | **possible** | 3 社とも usage を返す (キャッシュ/thinking の意味論が 3 社 3 様 → 正規化層必須)。生 usage 保存 + TS レート表 (effective_from 付き micro-USD) で導出。既存 `ai_runs.token_usage` は本方式と整合済み。DALL·E 3 / Imagen は usage 無しの枚数課金 → 呼び出し側記録。 |
| 7 | (補助基盤) ページスクショ | **possible** | puppeteer-core + @sparticuz/chromium が Vercel 公式サポート (テンプレートあり)。日本語は自サイトの self-host webfont で描画されるためフォント問題は軽微。運用制約: /tmp 蓄積 (Fluid Compute)・レスポンス 4.5MB 上限 (→ Storage 保存必須)・16,384px テクスチャ上限。 |

---

## 2. 採用方式の裁定 (論点ごと)

| 論点 | 裁定 | 補足 |
|---|---|---|
| **note-posting** | **半自動 (現行) を正として維持**。下書き自動化 (非公式 API・公開は手動) は「ユーザー承認が必要なリスク付きオプション」として別フェーズ切り出し | 採用時も (a) Cookie 手動供給 UI、(b) 失敗時の半自動フォールバック、(c) Vercel 外ワーカー不要な API 直叩き方式 (Playwright 不採用)、を必須条件とする。自動公開は不採用確定 |
| **openai-image** | **gpt-image-2 一択** (他は 2026 年内に全滅)。新規生成 = `images/generations`、レタッチ/参照 1〜4 枚生成 = `images/edits`。**非同期ジョブ + プロバイダ別直列キュー (IPM 制御) + base64 → Supabase Storage 保存** | 品質デフォルトは medium ($0.053/枚) を提案 (high は $0.211/枚、堀さん判断)。透明背景は非対応 (§4)。組織認証が前提 (§4) |
| **gemini-image** | **Interactions API (@google/genai v2.10+ 固定) + gemini-3.1-flash-image (GA)** を標準。大量サムネ用に flash-lite-image ($0.034/枚) を設定切替可能に。複数枚 = 並列 N リクエスト (candidateCount 非対応)。**モデル ID はハードコード + settings 差し替え** (models.list 動的検出に依存しない) | マルチターン編集は `previous_interaction_id` を系譜テーブルに保存して引き継ぐ。preview 系 ID は shutdown 済みなので使用禁止 |
| **models-discovery** | **3 社 models list でキー疎通確認 + モデル列挙を兼ねる** (全て無料)。結果を DB キャッシュ (TTL 24h)。画像生成対応判別 = Anthropic: 常に false / Gemini: `predict` メソッド + `-image`/`imagen-` 名前規約 / OpenAI: ID allowlist のハイブリッド | 判定意味論: OpenAI 403 は「無効」ではなく「models 読取スコープ無し」→ `limited` 表示。**疎通 OK ≠ クォータ有** を UI に明記 (insufficient_quota は生成時にしか判明しない)。Anthropic のみ count_tokens (公式に無料明記) で deep probe 可 |
| **cli-token-reuse** | **不採用 (blocked 確定)**。3 社とも ToS 違反明文化 (2026-02) + サーバー側実効遮断 + BAN 実績 (Google は有料 Ultra 含む返金なし大量凍結)。**正規 API キー (Vault/env) のみ**を使う | 代替 = 従量課金の受容。ユーザー承認事項として月次予算 + ops_limits ガードをセットで提示 (§4) |
| **fullpage-screenshot** | **puppeteer-core + @sparticuz/chromium 自前実装** (Node runtime, メモリ 2GB+, maxDuration 60s+, バージョン exact pin)。**ScreenshotProvider インターフェースでアダプタ化**し、不安定化時に ScreenshotOne ($17/2,000 枚) へ差し替え可能に | 必須要件: /tmp 前後クリーンアップ + 同時実行 1 の排他 + `prefers-reduced-motion: reduce` エミュレート + `document.fonts.ready` 待ち + PNG は Storage 保存で URL 返却 (4.5MB 上限回避)。16,384px 超は sharp 分割結合 (実装時に最長ページ実測して分岐要否決定) |
| **sns-image-posting** | **X: `POST api.x.com/2/media/upload` (simple, multipart binary, ≤5MB) へ移行 + OAuth scope に `media.write` 追加 + 既存接続の再認可**。チャンク実装は動画対応まで見送り。**IG: Graph v25.0 更新 + publish 前 `status_code` チェック + JPEG レンディションにアスペクト比 4:5〜1.91:1 正規化 + max width 1440** | X 修正は「新機能」ではなく**現在進行形の障害修正**として最優先。billing guard の単価前提 (pay-per-use $0.015、URL 付き $0.20) の確認込み |
| **llm-usage-tracking** | **生 usage (トークン数/枚数) を一次データとして DB 保存、金額は TS 定数レート表 (model_id × unit × micro-USD、effective_from 付き) からの導出値**。プロバイダ別 usage 正規化層を 1 モジュールに集約。週次 CI で LiteLLM JSON と突合し乖離通知 | 既存 `estimated_cost_cents` (X 課金ガード) は現行維持、AI 側は micro-USD 整数で別管理。Sonnet 5 の 2026-09-01 値上げが確定しているため effective_from は必須スキーマ |
| **text-suggestion-ux** | **claude-opus-4-8 標準形流用**。コンテキスト = system(BRAND + untrusted_content_policy) → サイト全文 MD (JSON エンコード・決定的シリアライズ・cache_control) → 対象フィールド + 指示。**短文 = 方向性の異なる 3 候補を配列ストリーミング (要素完成ごと SSE push)、長文 = 1 候補 + diff 表示** (既存 diff パッケージ)。トリガは明示ボタンのみ。ツール無し + structured outputs + HITL 採用 | v1 はスクショ添付なし (MD のみ)。スクショはフェーズ V で選択式オプション化。実装前に count_tokens でサイト全文 MD 実測 (新トークナイザで日本語 ~30% 増) |

---

## 3. アーキテクチャ骨子

### 3.1 新モジュール構成 (module-contracts.md §1/§2 への追補)

新設 3 モジュール + 既存 2 モジュール拡張:

```
【新設】
ai-providers  … プロバイダキー管理・models discovery・クライアント解決
ai-usage      … AI 利用量/コスト記録・レート表・ダッシュボード集計
image-studio  … 画像生成カスケード (系譜管理・非同期キュー)

【拡張】
ai-studio     … 文言候補生成 (facade メソッド追加。パイプラインとは独立の軽量経路)
media         … internal/screenshot.ts (ScreenshotProvider アダプタ) + captureSiteSnapshot facade
distribution  … X v2 media upload 移行 / IG v25.0 (内部修正のみ、境界変更なし)
```

依存方向 (既存ルール準拠、循環なし):

```
ai-studio    ──→ ai-providers (キー/クライアント解決) / ai-usage (記録) / media / settings / platform  ※既存依存に追加
image-studio ──→ ai-providers / ai-usage / media (参照画像・成果物保存) / settings (上限) / platform
distribution ──→ ai-usage (X 実績の記録は任意。課金ガードは現行 billing.ts のまま)
media        ──→ platform のみ (screenshot は internal)
ai-providers ──→ platform のみ
ai-usage     ──→ platform のみ
admin UI     ──→ 各 facade
逆流禁止: ai-providers / ai-usage は他の AI モジュールを import しない (最下層ユーティリティ)
```

SNS 画像との接続: image-studio の成果物は media レコードとして保存されるため、既存の `channel_drafts.content.media_ids` → distribution 経路が**無改修でそのまま使える** (worker は media_id しか見ない)。

### 3.2 キー管理 (ai-providers)

**Vault 保存** — 既存規約 (§3.6、vault-names.ts パターン) を踏襲:

```
ai_provider_anthropic  … JSON {"api_key": "..."}
ai_provider_openai     … JSON {"api_key": "...", "org_id": "..."(任意)}
ai_provider_gemini     … JSON {"api_key": "..."}
```

**テーブル** (channel_accounts と同型の設計):

```sql
create table ai_provider_accounts (
  provider text primary key check (provider in ('anthropic','openai','gemini')),
  auth_status text not null default 'disconnected'
    check (auth_status in ('disconnected','connected','limited','error')),
    -- limited = 疎通は返るが models 読取不可 (OpenAI restricted key 403) 等
  vault_secret_name text,
  models_cache jsonb not null default '[]',   -- [{id, display_name, capabilities:{image_gen:boolean,...}}]
  models_cached_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  meta jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
```

**キー解決の優先順位** (facade `resolveApiKey(provider)`):
1. Vault (管理画面から登録されたキー)
2. 環境変数 fallback (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` ← .env.example に追加)
3. どちらも無ければ graceful degradation (既存パターン: 該当機能カードを無効表示、KMB-E4xx 系エラーコード新設)

**接続テスト** (facade `testConnection(provider)`):
- 実体 = models list 呼び出し (3 社とも無料・トークン消費ゼロ)。認証ヘッダは OpenAI: Bearer / Anthropic: x-api-key + anthropic-version / Gemini: x-goog-api-key
- 200 → `connected` + models_cache 更新 (TTL 24h、モデルセレクタの供給源)
- OpenAI 403 → `limited` (無効と断定しない)、401 → `error` (ただし「クレジット枯渇でも 401 の場合あり」を UI 注記)
- 画像生成対応フラグ: Anthropic = 常に false / Gemini = `predict` + 名前規約 / OpenAI = allowlist (`gpt-image-*`) — 判定ロジックは ai-providers/internal に一元化
- UI に「疎通 OK はクォータ有を保証しない」を常設表示

### 3.3 料金記録 (ai-usage)

```sql
create table ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  provider text not null check (provider in ('anthropic','openai','gemini')),
  model_id text not null,
  feature text not null check (feature in
    ('pipeline_stage','text_suggestion','image_generation','transcription','screenshot_analysis')),
  ref_table text, ref_id uuid,              -- ai_runs.id / image_generations.id / request_group_id 等
  raw_usage jsonb not null,                 -- プロバイダ応答の usage をそのまま保存 (一次データ)
  normalized jsonb not null,                -- 正規化層の出力 (下記契約)
  cost_micro_usd bigint not null,           -- 導出値 (1 USD = 1,000,000)
  rate_snapshot jsonb not null,             -- 計算に使った単価スナップショット
  created_at timestamptz not null default now()
);
```

- **normalized 契約** (Zod, ai-usage/contracts.ts): `{input_tokens, cached_read_tokens, cache_write_tokens, output_tokens, thinking_tokens, images, audio_seconds, web_searches}` — 3 社の意味論差 (Anthropic: input はキャッシュ別建て / OpenAI・Gemini: 込みで引き算 / thinking の計上位置 3 様、Gemini のみ `candidates + thoughts` 加算) を **internal/normalize.ts 1 ファイルに集約**。ここ以外で生 usage を解釈することを契約で禁止
- **レート表**: `ai-usage/internal/rates.ts` — `{model_id, unit, micro_usd_per_unit, effective_from}` の TS 定数配列 (DB 化は過剰)。Sonnet 5 の 9/1 改定を初期データに含める。既存 `pricing` モジュール (塗装料金) との名前衝突回避のため必ず ai-usage 内に置く
- **更新検知**: 週次 GitHub Actions で LiteLLM JSON をフェッチ → 突合 → 乖離時に Issue 起票 (公式値との一致は検証済み)
- **既存との整合**: `ai_runs.token_usage` (jsonb) は互換のため残し、書き込み時に ai_usage_events へも記録 (二重書きだが一次データは ai_usage_events 側)。`transcribe.ts` は現在 usage 未記録 → 記録追加。X 課金ガード (`billing.ts` の cents) は**現行維持**し、ダッシュボードは ai_usage_events 集計 + distribution facade の X 実績を合算表示
- **ガード**: `site_settings.ops_limits` に `ai_monthly_budget_micro_usd` と `image_monthly_count_limit` を追加。超過時は新規 AI 実行を KMB-E4xx で拒否 (既存 X ガードと同パターン)

### 3.4 画像生成カスケードのデータモデル (image-studio)

**1 行 = 1 出力画像**とし、系譜は画像→画像の親子で表現:

```sql
create table image_generations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references image_generations(id),   -- 系譜の親画像 (NULL = ルート世代)
  root_id uuid references image_generations(id),     -- 系譜ルート (ツリー表示の索引。ルート行は自分自身)
  request_group_id uuid not null,                    -- 同一 API リクエスト由来 (OpenAI n>1 / Gemini 並列 N 発)
  provider text not null check (provider in ('openai','gemini')),
  model_id text not null,
  kind text not null check (kind in ('generate','edit','variation')),
  prompt text not null,
  params jsonb not null default '{}',                -- size/quality/aspect_ratio/image_size/thinking_level 等
  source_media_ids uuid[] not null default '{}',     -- アップロード参照画像 (media)。親画像は parent_id で表現
  provider_interaction_id text,                      -- Gemini interactions の id (子生成が previous_interaction_id に使う)
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
  error_code text,
  lease_expires_at timestamptz,                      -- §7.6 の lease 意味論を流用
  attempts int not null default 0,
  output_media_id uuid references media(id),         -- 成果物 (base64 → Storage 保存後に media 化)
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- **系譜の意味論**: 「レタッチ」= parent_id + kind='edit' (OpenAI: 親の output を images/edits の入力に再送 / Gemini: provider_interaction_id を previous_interaction_id で参照し再送不要)。「参照画像から新規」= parent_id NULL + source_media_ids + kind='generate'。「バリエーション」= 同一 request_group_id の兄弟
- **非同期キュー**: 既存の pg_cron → `/api/jobs/*` (shared secret) → worker CAS 取得パターンを流用。**プロバイダ別に同時実行 1 の直列処理**で IPM (OpenAI Tier1 = 5/min) を吸収。429 は指数バックオフ + attempts 3 で failed。UI は SSE ではなくポーリング (生成最大 2 分・進捗 delta が無いため)
- **usage 記録**: succeeded 時に ai_usage_events へ (ref_id = request_group_id)。OpenAI はレスポンス usage の実測トークンで事後確定 (事前見積りは近似)。Gemini は 1 リクエスト 1 画像で単価固定に近い

### 3.5 スクショ基盤 (media/internal/screenshot.ts)

- `ScreenshotProvider` インターフェース: `SelfHostedChromiumProvider` (puppeteer-core + @sparticuz/chromium、exact pin) を初期実装、`ScreenshotOneProvider` を差し替え候補として型のみ定義
- facade: `MediaFacade.captureSiteSnapshot(path, opts)` → PNG を Storage 保存 → media レコード返却 (依存方向は media → platform のみで既存準拠)
- 実装要件 (すべて必須): /tmp 前後クリーンアップ / モジュールスコープ排他 (同時 1) / reduced-motion エミュレート / fonts.ready + networkidle 待ち / Storage 経由 URL 返却 / 撮影ルートに Node runtime + メモリ 2GB+ + maxDuration 60s+ 指定

---

## 4. ユーザー (堀さん) に判断を仰ぐべきリスク項目

1. **【裁定の追認】CLI トークン流用の不採用** — 3 社とも ToS 違反 + BAN 実績 (Google は有料 Ultra 含む返金なし凍結) のため設計から除外し、正規 API キー従量課金とした。**AI 機能の月次予算上限 (ops_limits ガード値) の設定値**を決めてほしい。
2. **note 下書き自動化をやるか** — 半自動維持 (リスクゼロ) か、非公式 API 下書き自動化 (公開は手動) か。後者は (a) ~30 日毎の Cookie 手動再供給が恒常運用になる、(b) 規約包括条項による予告なしアカウント停止 + 売上金没収リスク (下書きのみなら低〜中)、(c) 年数回の破壊的変更で突然停止し半自動へフォールバック、を受容する判断。
3. **スクショ方式のコスト構造** — 自前 Chromium (ランニングほぼ 0、ただし /tmp・バージョン整合の運用リスクと実装 1 日) vs ScreenshotOne (無料 100 枚/月 → $17/月、安定) vs フェーズ V ごと見送り (文言候補は MD のみで成立)。
4. **画像生成のデフォルト品質と月次上限** — gpt-image-2 は medium $0.053/枚 / high $0.211/枚。デフォルト medium + 明示切替を提案。`image_monthly_count_limit` の値も要決定。Gemini は開発/プレビュー含め全リクエスト課金 (無料枠なし)。
5. **OpenAI 組織認証 (Organization Verification)** — gpt-image-2 利用の前提条件で未認証だと 403。**堀さんの Platform 管理画面操作が必須** (Claude 側で代行不可)。あわせて Usage Tier 確認 (Tier1 = 5 images/min)。
6. **X の課金プラン確認** — 接続アカウントが legacy Basic か pay-per-use ($0.015/post、**URL 含む post は $0.20/post と 13 倍**) かで billing guard の単価前提が変わる。Developer Console での確認 + URL 付き投稿を続けるかの運用判断。
7. **X 再認可の操作** — `media.write` scope 追加後、既存の X 接続で OAuth フローを再実行しないと media upload が 403 になる (管理画面からの 1 回操作)。
8. **文言候補のモデル選択** — 品質最優先方針どおり Opus 4.8 継続を提案 (キャッシュ時 $0.04〜0.07/回)。コスト/レイテンシ優先なら同一コードパスで Sonnet 5 切替可 (ただし導入価格は 8/31 まで、9/1 から $3/$15)。
9. **透明背景 PNG の要件有無** — gpt-image-2 は transparent 非対応。要件があるなら「背景除去の後処理」を追加設計する (退役予定の gpt-image-1.5 依存は不採用)。

---

## 5. 段階分割案 (常に動く状態を保つ順序)

各フェーズ完了時点で main は完全動作。依存順 = フェーズ番号。

| Phase | 内容 | 依存 | 動く状態の保ち方 |
|---|---|---|---|
| **I. X 画像投稿の障害修正** | x-api.ts の v2 simple upload 移行 (multipart binary、`data.id`) + `media.write` scope + 再認可導線。IG: v25.0 + status_code チェック + アスペクト比 4:5〜1.91:1 正規化 | なし (独立・**現在壊れているため最優先**) | distribution 内部修正のみ。契約・境界変更なし |
| **II. ai-providers + ai-usage 基盤** | キー管理テーブル + Vault 保存 + 接続テスト + models cache / usage 記録テーブル + 正規化層 + レート表 + 既存 ai_runs・transcribe への記録差し込み + 設定画面カード + 簡易コストダッシュボード | なし (I と並列可) | Vault 未登録時は env fallback で既存 AI パイプラインは無変更で動作。記録は追記型で non-breaking |
| **III. 文言候補生成 (MD のみ)** | ai-studio に suggest facade + サイト全文 MD の決定的シリアライズ + 3 候補配列 SSE + HITL 採用 UI + untrusted_content_policy | II (キー解決・usage 記録) | 既存パイプラインと独立の軽量経路。着手前に count_tokens で MD 実測 |
| **IV. 画像生成カスケード** | IV-a: image-studio モジュール + image_generations テーブル + 非同期ワーカー (pg_cron 流用) + OpenAI gpt-image-2 (generate/edit/variation) + カスケード UI。IV-b: Gemini 追加 (Interactions + previous_interaction_id、並列 N 枚) | II (+堀さん: OpenAI 組織認証) | 成果物は media 化するので既存 SNS 配信 (I 修正済み) に無改修で接続。IV-a 単独でも完結 |
| **V. スクショ基盤 + 適用** | media/internal/screenshot (アダプタ化) → 文言候補へのスクショ添付オプション + サイトスクショの SNS 画像利用 | III (適用先)、判断事項 3 | III は MD のみで完成済みのため、V は純増オプション |
| **VI. note 下書き自動化 (承認待ち)** | 非公式 API (text_notes 2 段階) + Cookie 手動供給 UI + 半自動フォールバック。実装時は DevTools 一次観測でエンドポイント再検証 (ネット上の情報にハルシネーション混入) | 判断事項 2 の承認が前提 | 失敗時は現行半自動へ自動フォールバックするため既存フローは常に生存 |

**着手前の必須手順** (メモリ規約): 各フェーズとも docs/module-contracts.md に新モジュールの境界・Zod 契約・facade シグネチャ・依存方向・テーブル所有・エラーコード所有を先に追記してから実装 (文書先行)。実装時に契約外の型・境界を発明しない。

---

## Blocked 項目
- CLI OAuth トークン流用 (Claude Code / Codex CLI / Gemini CLI): 3 社とも ToS 違反明文化 (2026-02) + サーバー側実効遮断 + BAN 実績あり。設計から除外し、正規 API キー (Vault/env) + 従量課金で代替
- note の完全自動公開 (無人運用): 公式 API 不存在 + reCAPTCHA v3 で自動ログイン不可 + Cookie ~30 日手動供給が必須のため構造的に無人化不可。上限は「非公式 API 下書き作成 + 手動公開」(それ自体もユーザー承認が必要なリスク付きオプション)
- Anthropic での画像生成: 画像生成モデルが存在しない (capabilities.image_input は Vision 入力のみ)。画像生成プロバイダ候補は OpenAI / Gemini の 2 社に確定
- gpt-image-2 の透明背景 PNG: background=transparent 非対応 (公式明記)。要件がある場合は背景除去の後処理を追加設計 (退役予定モデルへの依存は不採用)
- Gemini の複数枚一括生成パラメータ: candidateCount / number_of_images は画像モデル非対応。並列 N リクエストで代替 (コスト N 倍)

## 堀さんの判断が必要な項目
- AI 従量課金の月次予算上限 (ops_limits の ai_monthly_budget_micro_usd) の設定値 — CLI トークン不採用 (正規 API キー従量課金) の裁定の追認込み
- note 下書き自動化 (Phase VI) の実施可否 — Cookie ~30 日毎の手動再供給 + 規約包括条項による予告なしアカウント停止/売上金没収リスク (下書きのみなら低〜中) + 年数回の破壊的変更追従、の受容判断。デフォルト提案は半自動維持
- スクショ方式の選択 — 自前 Chromium (ランニング約 0 / 運用リスクあり) vs ScreenshotOne ($17/2,000 枚で安定) vs Phase V 自体の見送り (文言候補は MD のみで成立)
- 画像生成のデフォルト品質と月次枚数上限 — gpt-image-2 medium $0.053/枚 (提案デフォルト) vs high $0.211/枚。Gemini は無料枠なし (開発含め全課金)
- OpenAI 組織認証 (Organization Verification) の実施 — gpt-image-2 利用の前提。堀さんの Platform 管理画面操作が必須 (代行不可)。あわせて Usage Tier の確認
- X の課金プラン確認と URL 付き投稿の運用判断 — 接続アカウントが legacy Basic か pay-per-use かで billing guard 単価前提が変わる。pay-per-use は $0.015/post、URL 含む post は $0.20/post (13 倍)
- X の再認可操作 — media.write scope 追加後に管理画面から OAuth 再実行 (1 回、ユーザー操作)
- 文言候補のモデル — 品質最優先方針どおり Opus 4.8 継続 (提案) vs Sonnet 5 切替 (9/1 に $3/$15 へ値上げ確定)
- 透明背景 PNG の要件有無 — gpt-image-2 非対応のため、要件があれば背景除去後処理を設計に追加
