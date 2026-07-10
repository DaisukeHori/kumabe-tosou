# モジュール契約書 (canonical)

- 版: v2.7 (2026-07-10: Wave B 実装反映 — PageMediaFacade に buildSiteContextMd (P2)・依存方向に page-media→content 追加 (P2)・DistributionFacade に saveNoteSessionCookie/createNoteDraft + note_draft 列 (P6)・AiProvidersFacade に generateImageCascade/markImageSelected/getImageGenerationBreadcrumb/cleanupAiDraftMedia (P3))
- 旧版: v2.6 (2026-07-10: Codex R2 反映 — zRunStage/zRunStatus に image_generation を実追加 (v2.5 はヘッダ宣言のみで enum 未更新だった)・MediaFacade に createFromBytes 追加 (生成画像のサーバ内保存、BLOCKER-5)。ai-providers §1 は ai-studio-v2.md v1.2 が canonical)
- 旧版: v2.5 (2026-07-10: ai-providers モジュール新設 (ai-studio-v2.md v1.1) — テーブル 5 本所有・E407〜E409・AI SDK 直 import 禁止・ai_runs に image_generation stage・zOpsLimits に AI 予算)
- 旧版: v2.4 (2026-07-10: page_text テーブルを page-media 所有に追加、PageMediaFacade にテキストスロット 4 メソッド追加 — visual-text-editor.md v1.0)
- 旧版: v2.3 (2026-07-09: page-media モジュール新設を §1/§5 に反映 / ContentFacade にビジュアルエディタ用 CAS メソッド 4 件を追加 / KMB-E107〜E109 の所有を明記)
- 旧版: v2.1 (価格契約を行列モデル v2 に改訂 — Wave 0 実装で legacy 実構造との乖離が判明したため。zEstimateInput は size_key 必須・数量値引き自動適用・レンジ結果に変更)
- 旧版: v2.0 (Codex 外部レビュー反映: worker 実行面を Next.js に統一 / lease 型 stage 実行 / draft 単位予約 / at-least-once 配信モデル / IG 接続シーケンス / ai-studio facade 増補)
- 作成日: 2026-07-07
- 位置づけ: **本書がモジュール境界・値契約 (Zod)・facade・イベント・依存方向・エラーコード所有・テーブル所有・結合シーケンスの canonical**。実装 (`src/modules/**`) が本書と乖離した場合は本書を正とし、変更は本書を先に更新する。
- DDL の canonical は `docs/design/cms-ai-pipeline.md` §2 (相互参照。テーブル定義はあちら、値契約はこちら)。

---

## 1. モジュール分割・所有マトリクス

| モジュール | 責務 | 所有テーブル | 所有エラーコード | 公開 facade |
|---|---|---|---|---|
| `platform` | 認証・管理者判定・共通 Result 型・エラー定義 | profiles | KMB-E2xx, KMB-E9xx | `requireAdmin()`, `isAdmin()` |
| `content` | works / posts / voices の CRUD・公開制御・slug | works, work_images, posts, voices | KMB-E101〜E103, E108, E109 (共有検証は platform 定義・content 主使用) | ContentFacade |
| `media` | 画像/メディアの保管・変換・参照管理 | media (+Storage bucket: media) | KMB-E3xx (E301, E302) | MediaFacade |
| `pricing` | 価格グレード/オプション・見積り計算 | price_grades, price_options | (E101/E103 を共用) | PricingFacade |
| `inquiry` | お問い合わせ受付・管理・レート制限 | contact_inquiries, rate_limits | E105 (+E101 を共用) | InquiryFacade |
| `settings` | サイト設定 (会社情報/ヒーロー/SEO/運用上限) | site_settings | (E101/E103 を共用) | SettingsFacade |
| `page-media` | 公開ページの装飾/ヒーロー画像・テキストスロット (visual-media-editor.md / visual-text-editor.md が親設計) | page_media, page_text (+view page_media_resolved) | KMB-E107 (E108/E109 は content 所有) | PageMediaFacade |
| `ai-providers` | 全 AI 呼び出しの単一入口 (キー管理/モデル検知/ルーティング/usage 記録/予算ガード) — ai-studio-v2.md が親設計 | ai_provider_keys, ai_usage_log, ai_image_generations, ai_image_generation_sources, ai_budget_months | KMB-E407, E408, E409 | AiProvidersFacade |
| `ai-studio` | 音声入力・文字起こし・整文・要旨抽出・リサーチ・チャネル別生成・レビュー (AI 呼び出しは ai-providers 経由) | ai_sources, ai_runs, channel_drafts, draft_revisions (+Storage bucket: audio) | KMB-E303, E401〜E406 | AiStudioFacade |
| `distribution` | 配信予約・SNS API 実行・チャネル接続・文体プロファイル | channel_posts, channel_accounts, style_profiles | KMB-E5xx | DistributionFacade |
| `site-public` | 公開サイトの表示 (App Router ページ群) | **所有テーブルなし** (read 専用) | なし | なし (他 facade の消費者) |

規則:
- テーブルへの直接クエリは**所有モジュールの repository のみ**。他モジュールは facade 経由。
- エラーコードの新設は所有モジュールの契約変更として本書を先に更新。

---

## 2. 依存方向ルール

```
site-public ──→ content / media / pricing / settings / inquiry (read facade のみ)
admin UI    ──→ 各モジュール facade
ai-studio   ──→ ai-providers (全 AI 呼び出し) / media (画像候補参照) / settings (BRAND 情報) / platform
ai-providers──→ platform (Vault RPC・Result) / media (生成画像の保存は facade 経由)
ai-studio   ──→ content は「blog post 作成」1 点のみ (ContentFacade.createBlogPostFromDraft)
distribution──→ ai-studio (承認済み draft の read) / content (site_blog 公開) / media (IG 用 JPEG URL) / settings (課金ガード上限)
page-media  ──→ content (buildSiteContextMd の公開 works/posts タイトル参照。2026-07-10 P2) / platform
すべて      ──→ platform (認証・Result・エラー定義)
```

禁止:
- 循環依存一切禁止 (`content → ai-studio` 等の逆流禁止)。
- `internal/**` の跨モジュール import 禁止。
- **AI SDK (`@anthropic-ai/sdk` / `openai` / `@google/genai`) の直 import は ai-providers/internal のみ** (ESLint 強制。usage 記録の単一入口を破らない)。
- site-public から書き込み系 facade の import 禁止 (contact フォームの INSERT のみ InquiryFacade.submit を例外許可)。

機械的強制: ESLint `no-restricted-imports` で `src/modules/*/internal/**` と repository の跨モジュール import をエラーにする (Phase 1a で設定)。

---

## 3. ディレクトリ構成と canonical 配置

```
src/modules/<module>/
  contracts.ts    … Zod スキーマ + 型 (本書 §4 と 1:1 対応。乖離したら本書が正)
  facade.ts       … 公開インターフェース (他モジュールが import してよい唯一のファイル)
  repository.ts   … 所有テーブルへの DB アクセス
  internal/**     … 内部実装 (跨モジュール import 禁止)
```

派生規則 (すべて contracts.ts が単一ソース):
- **Claude structured outputs 用 JSON Schema**: zod v4 ネイティブの **`z.toJSONSchema()`** で contracts.ts から生成し、`@anthropic-ai/sdk` の json-schema ヘルパで output_format 化。手書き JSON Schema 禁止。(※ 当初指定の `zod-to-json-schema` は zod v4 非対応で空スキーマを生成することが Wave2-E で実証されたため差し替え)
- **フォームバリデーション**: admin UI は同じ Zod を react-hook-form resolver で使用。
- **DB check 制約との対応**: enum/status/非負など**構造的制約のみ** DDL にも定義し、一致を結合テスト (`contracts-ddl-parity.test.ts`) で検証。文字数上限・regex 等の値制約は **Zod が唯一の正** (DDL に重複定義しない — 二重管理の乖離防止。Codex 指摘で方針確定)。

---

## 4. 値契約 (Zod) — canonical 定義

以下が全 JSONB カラム・API ペイロード・AI 生成物の**型の正**。実装は `src/modules/<module>/contracts.ts` に本節をそのまま写経し、乖離時は本節を正とする。

### 4.1 共通スカラー (platform/contracts.ts)

```ts
import { z } from "zod";

/** NFC 正規化 + 制御文字 (改行タブ除く) 除去。全テキスト入力に適用 */
const nfc = (s: string) => s.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export const zSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "小文字英数とハイフンのみ").min(3).max(80);
export const zTitle = z.string().transform(nfc).pipe(z.string().min(1).max(120));
export const zExcerpt = z.string().transform(nfc).pipe(z.string().max(300));
export const zMarkdown = z.string().transform(nfc).pipe(z.string().max(100_000));
export const zShortText = (max: number) => z.string().transform(nfc).pipe(z.string().min(1).max(max));
export const zMediaId = z.string().uuid();
export const zIsoDatetime = z.string().datetime({ offset: true }); // API 境界。DB は timestamptz (UTC)
export const zChannel = z.enum(["site_blog", "note", "x", "instagram"]);

/** モジュール境界の戻り値。例外は境界を越えない */
export type Result<T> = { ok: true; value: T } | { ok: false; code: KmbErrorCode; detail?: string };
export type KmbErrorCode = `KMB-E${number}`; // 実体は platform/errors.ts の as const 一覧 (設計書 §9 と 1:1)
```

### 4.2 settings.value (settings/contracts.ts)

`site_settings.key` ごとにスキーマを固定する discriminated map:

```ts
export const zCompanySettings = z.object({
  name: zShortText(50),
  representative: zShortText(30),
  address: zShortText(120),
  tel: z.string().regex(/^0\d{1,4}-\d{1,4}-\d{3,4}$/).nullable(),
  email: z.string().email().max(120).nullable(),
  founded: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/).nullable(), // 'YYYY' or 'YYYY-MM'
  business_hours: z.string().max(100).nullable(),
}).strict();

export const zHeroSettings = z.object({
  // media_id は 2026-07-09 に削除 (visual-media-editor.md §1 BLOCKER-1: hero 画像は
  // page_media スロット 'home.hero' に一本化。migration 0013 が既存行から除去)
  heading: zShortText(40),
  subheading: z.string().max(80),
  cta_label: zShortText(20),
  cta_href: z.string().regex(/^\/[a-z0-9\-/]*$/), // 内部パスのみ (外部 URL 禁止)
}).strict();

export const zSeoDefaults = z.object({
  title_template: z.string().max(60).refine(s => s.includes("%s"), "%s 必須"),
  description: z.string().min(50).max(160),
  og_media_id: zMediaId,
}).strict();

export const zOpsLimits = z.object({
  x_monthly_post_limit: z.number().int().min(0).max(1000), // 課金ガード (設計書 §8.2)。初期値 100
  ai_monthly_budget_micro_usd: z.number().int().min(0),    // AI 従量課金の月次上限 (µUSD 整数)。既定 50_000_000 = $50 (ai-studio-v2.md §1)
  ai_monthly_image_limit: z.number().int().min(0).max(10_000), // 画像生成の月次枚数上限。既定 200
}).strict();

export const zNotificationSettings = z.object({
  inquiry_to: z.string().email().max(120),   // 問い合わせ通知メールの宛先。/admin/settings で変更可。
                                             // bootstrap-admin が管理者メールで初期化 (設計書 §6.3)。
                                             // キー不存在時は送信スキップ + E902 ログ (問い合わせ保存は成功)
  on_publish_failure: z.boolean(),           // 2d〜: 配信失敗・トークン失効もメール通知するか
}).strict();

export const SETTINGS_SCHEMAS = {
  company: zCompanySettings,
  hero: zHeroSettings,
  seo_defaults: zSeoDefaults,
  ops_limits: zOpsLimits,
  notifications: zNotificationSettings,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
```

### 4.3 ai-studio の生成物 (ai-studio/contracts.ts)

```ts
/** stage 1.5 整文出力 (Claude structured output) */
export const zCleanedTranscript = z.object({
  cleaned_text: z.string().min(1).max(50_000),
  corrections: z.array(z.object({
    from: z.string().max(100),
    to: z.string().max(100),
    reason: z.enum(["filler", "punctuation", "term", "mishear"]),
  })).max(200),
  meaning_preserved: z.boolean(), // false → KMB-E406 (raw のまま人間修正へ)
}).strict();

/** stage 2 要旨抽出出力。claims が差分表示 §10 の「AI 追加事実」判定の基礎 */
export const zClaim = z.object({
  text: z.string().min(1).max(500),
  source: z.enum(["speech", "research", "inference"]),
  research_url: z.string().url().nullable(),
}).strict().refine(c => c.source !== "research" || c.research_url !== null,
  "research 由来は URL 必須");

export const zBrief = z.object({
  theme: zShortText(200),
  topics: z.array(z.string().max(100)).min(1).max(10),
  audience: z.string().max(200),
  keywords: z.array(z.string().max(50)).max(20),
  claims: z.array(zClaim).max(50),
}).strict();
// → ai_runs.brief

/** stage 3 リサーチ出力 */
export const zResearchNotes = z.object({
  facts: z.array(z.object({
    text: z.string().max(500),
    url: z.string().url(),
    accessed_at: zIsoDatetime,
  })).max(20),
  corrections: z.array(z.object({
    original: z.string().max(300),
    suggestion: z.string().max(300),
    reason: z.string().max(300),
    url: z.string().url().nullable(),
  })).max(10),
}).strict();
// → ai_runs.research_notes

/** Claude API usage 記録 */
export const zTokenUsage = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_read_input_tokens: z.number().int().min(0),
  cache_creation_input_tokens: z.number().int().min(0),
  web_search_requests: z.number().int().min(0).default(0),
}).strict();
// → ai_runs.token_usage (stage 別合算)
```

### 4.4 channel_drafts.content — チャネル別コンテンツ (ai-studio/contracts.ts)

```ts
export const zSiteBlogContent = z.object({
  title: zTitle,
  excerpt: zExcerpt.pipe(z.string().min(1)),
  body_md: zMarkdown.pipe(z.string().min(100)),
  suggested_slug: zSlug,
  cover_media_id: zMediaId.nullable(),
}).strict();

export const zNoteContent = z.object({
  title: zTitle,
  body_md: z.string().max(50_000).min(100),
  hashtags: z.array(z.string().regex(/^[^\s#]{1,30}$/)).max(5),
}).strict();

/**
 * X の字数は重み付き (半角1/全角2/URL23固定/上限280 = 全角換算140)。
 * 自作実装は禁止 — 公式 `twitter-text` の parseTweet().weightedLength を薄く包んだ
 * weightedTweetLength() (platform/text.ts) を使う (X 公式推奨。Codex 指摘で自作案から変更)。
 */
export const zXTweet = z.object({
  text: z.string().min(1).refine(t => weightedTweetLength(t) <= 280, "重み付き 280 超過"),
  media_id: zMediaId.nullable(),
}).strict();
export const zXContent = z.object({
  thread: z.array(zXTweet).min(1).max(5),
}).strict();

export const zInstagramContent = z.object({
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().regex(/^[^\s#]{1,30}$/)).min(5).max(15),
  media_ids: z.array(zMediaId).min(1).max(10), // JPEG レンディション存在チェックは配信時 (E502)
}).strict();

export const CHANNEL_CONTENT_SCHEMAS = {
  site_blog: zSiteBlogContent,
  note: zNoteContent,
  x: zXContent,
  instagram: zInstagramContent,
} as const;

/**
 * Claude 生成呼び出しの出力契約 (structured outputs の元)。
 * content と claims を同時出力させ、content → channel_drafts.content、
 * claims → channel_drafts.claims に分離保存する。
 * CHANNEL_CONTENT_SCHEMAS 単体は claims を含まない (.strict() のため混入不可 — Codex 指摘で分離を明確化)。
 */
export const zChannelDraftOutput = (channel: Channel) => z.object({
  content: CHANNEL_CONTENT_SCHEMAS[channel],
  claims: z.array(zClaim).max(50),
}).strict();
```

### 4.5 distribution の外部参照・メタ (distribution/contracts.ts)

```ts
/** channel_posts.external_id (X はスレッド途中失敗の再開情報を含む JSON) */
export const zXExternalRef = z.object({
  tweet_ids: z.array(z.string().regex(/^\d+$/)),
  last_completed_index: z.number().int().min(-1), // -1 = 未投稿
}).strict();
// instagram: media id 文字列 / site_blog: posts.id (uuid) / note: 手動入力 URL

/** channel_accounts.meta (トークン本体は含まない — Vault のみ) */
export const zXAccountMeta = z.object({
  user_id: z.string(),
  username: z.string().max(50),
  token_expires_at: zIsoDatetime,
}).strict();

export const zInstagramAccountMeta = z.object({
  ig_business_account_id: z.string(),
  facebook_page_id: z.string(),
  username: z.string().max(50),
  token_expires_at: zIsoDatetime,
}).strict();

export const zNoteAccountMeta = z.object({
  profile_url: z.string().url().nullable(),
}).strict();
```

### 4.6 SSE イベント (/api/ai/runs/[id]/stream)

```ts
/** run の stage。整文 (cleaning) は run 開始前の /api/ai/clean で完結するため含まない。
 *  image_generation は SNS 画像生成 (ai-studio-v2.md §7、P4) で drafting 完了後に走る任意ステージ
 *  (X/IG 以外の run では skip)。P4 で ai_runs.status CHECK 制約に 'image_generation' を追加する
 *  マイグレーションが必要 (現行 code は 3 stage、契約が先行)。 */
export const zRunStage = z.enum(["extracting", "researching", "drafting", "image_generation"]);
export const zRunStatus = z.enum([
  "pending", "extracting", "researching", "drafting", "image_generation",
  "ready_for_review", "completed", "failed", "cancelled",
]); // ai_runs.status の check 制約と 1:1 (image_generation は P4 マイグレーションで追加)

export const zRunProgressEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"), // 接続/再接続直後: DB 上の現在状態を一括送信
    run_status: zRunStatus,
    completed_drafts: z.array(z.object({ channel: zChannel, draft_id: z.string().uuid() })),
  }),
  z.object({
    type: z.literal("stage"),
    stage: zRunStage,
    status: z.enum(["start", "done", "failed"]),
    error_code: z.string().nullable(),
  }),
  z.object({
    type: z.literal("draft_delta"), // drafting 中の逐次テキスト
    channel: zChannel,
    delta: z.string(),
  }),
  z.object({ type: z.literal("completed") }),
]);
```

### 4.7 API リクエスト契約 (Route Handlers)

エンドポイント一覧・認可・エラー対応は設計書 §3.5 が正。ペイロード型は以下:

```ts
export const zTranscribeReq = z.object({ source_id: z.string().uuid() }).strict();
export const zCleanReq = z.object({ source_id: z.string().uuid() }).strict();
export const zStartRunReq = z.object({
  source_id: z.string().uuid(),
  channels: z.array(zChannel).min(1),
  research: z.boolean(),
}).strict();
export const zRegenerateReq = z.object({
  instruction: z.string().min(1).max(2000), // 修正指示
}).strict();
/**
 * 1 draft = 1 channel (channel_drafts の unique(run_id, channel)) のため、
 * 予約は channel ではなく draft 単位で指定する (Codex 指摘で契約破綻を修正)。
 * channel は draft から導出し、channel_posts.channel は draft と一致することを trigger で検証。
 */
export const zScheduleReq = z.object({
  entries: z.array(z.object({
    draft_id: z.string().uuid(),
    scheduled_at: zIsoDatetime.nullable(),
    // 過去日時は「即時」に丸める。note チャネルの draft は null 必須 (即 manual_required)、
    // それ以外のチャネルは null 禁止 — repository が draft.channel を見て検証 (KMB-E101)
  })).min(1).max(8),
}).strict();

export const zCreateSourceReq = z.object({
  input_type: z.enum(["audio", "text"]),
  raw_text: z.string().max(50_000).nullable(), // input_type='text' のとき必須 (refine)
  audio_storage_path: z.string().max(500).nullable(), // input_type='audio' のとき必須 — アップロード済み音声の紐付け (Wave2-E で追加)
}).strict();

export const zCreateUploadUrlReq = z.object({
  kind: z.enum(["audio", "media"]),
  filename: z.string().max(200),
  content_type: z.string().max(100),
  size_bytes: z.number().int().min(1),
}).strict(); // kind 別サイズ上限 (audio 50MB / media 10MB) を refine で検証

export const zConfirmCleanReq = z.object({
  source_id: z.string().uuid(),
  final_text: z.string().min(1).max(50_000), // 人間修正後の確定テキスト (整文の確定操作)
}).strict();

export const zEditDraftReq = z.object({
  content: z.unknown(), // draft.channel を DB から引いた後 CHANNEL_CONTENT_SCHEMAS[channel] で二段階 parse
}).strict();
export const zRevalidateReq = z.object({ tags: z.array(z.string()).min(1).max(20) }).strict();
```

### 4.8 CRUD エンティティ入力契約

admin の Server Actions / フォームの入力型。DB 行そのものの型は repository が DDL から保証するため定義せず、**外部から入ってくる値**だけを契約化する。

```ts
// content/contracts.ts
export const zWorkInput = z.object({
  slug: zSlug,
  title: zTitle,
  category: zShortText(30),
  body: zMarkdown,
  process_note: z.string().max(200).nullable(),
  cover_media_id: zMediaId.nullable(),
  image_ids: z.array(zMediaId).max(20), // work_images へ展開。配列順 = sort_order
  sort_order: z.number().int().min(0).max(9999),
}).strict();

export const zPostInput = z.object({
  slug: zSlug,
  kind: z.enum(["reading", "news", "blog"]),
  title: zTitle,
  excerpt: zExcerpt,
  body: zMarkdown,
  cover_media_id: zMediaId.nullable(),
}).strict();

export const zVoiceInput = z.object({
  customer_initial: z.string().regex(/^[A-Z]\.[A-Z]$/, "例: K.T"),
  region: zShortText(20),
  rating: z.number().int().min(1).max(5),
  body: zShortText(2000),
  item: z.string().max(100).nullable(),
  photo_media_id: zMediaId.nullable(),
  sort_order: z.number().int().min(0).max(9999),
}).strict();

/** 公開/アーカイブ等の状態遷移操作 (§4.1 の遷移図のガードは repository 側で二重検証) */
export const zStatusTransition = z.object({
  to: z.enum(["draft", "review", "published", "archived"]),
  published_at: zIsoDatetime.nullable(), // published への遷移時のみ指定可 (未来 = 予約公開)
}).strict();

// pricing/contracts.ts — v2 (2026-07-08 改訂)
// legacy の実価格構造 = グレード × サイズ行列 (各セルが価格レンジ) + 数量自動値引き
// + 特急倍率 + XL は個別見積もり。単一 base_price モデルでは表現不能と Wave 0 で
// 判明したため行列モデルへ再設計 (設計書 §2.2 migration 0007 と 1:1)。
export const zPriceGradeInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/),
  label: zShortText(30),
  description: z.string().max(300),         // base_price は v2 で廃止
  sort_order: z.number().int().min(0).max(9999),
  is_active: z.boolean(),
}).strict();

export const zPriceSizeClassInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,10}$/), // 's' | 'm' | 'l' | 'xl'
  label: zShortText(30),                      // '〜120mm' 等
  max_mm: z.number().int().positive().nullable(), // null = 上限なし (xl)
  quote_only: z.boolean(),                    // true = 個別見積もり (金額を持たない)
  sort_order: z.number().int().min(0).max(9999),
}).strict();

export const zPriceMatrixCellInput = z.object({
  grade_key: z.string(),
  size_key: z.string(),
  price_min: z.number().int().min(0).max(10_000_000),
  price_max: z.number().int().min(0).max(10_000_000),
}).strict().refine(c => c.price_max >= c.price_min, "price_max は price_min 以上");

export const zQuantityTierInput = z.object({
  min_qty: z.number().int().min(2).max(9999),
  discount_rate: z.number().gt(0).lt(1),      // 0.15 = 15% 引き。quantity から自動適用
  label: zShortText(30),                      // '10個以上 -15%'
}).strict();

export const zPriceOptionInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/), // 'express' 等の任意選択オプション
  label: zShortText(30),
  kind: z.enum(["multiplier", "fixed"]),
  value: z.number().positive(),
  sort_order: z.number().int().min(0).max(9999),
  is_active: z.boolean(),
}).strict().refine(
  o => o.kind === "multiplier" ? o.value <= 100 : (Number.isInteger(o.value) && o.value <= 1_000_000),
  "multiplier は 100 以下 / fixed は整数円 100 万以下",
);

export const zEstimateInput = z.object({
  grade_key: z.string(),
  size_key: z.string(),
  quantity: z.number().int().min(1).max(999),
  option_keys: z.array(z.string()).max(10),   // 'express' 等。数量値引きは含めない (自動適用)
}).strict();

export const zEstimateResult = z.object({
  quote_only: z.boolean(),                    // true = 個別見積もり (total_min/max は 0)
  total_min: z.number().int().min(0),
  total_max: z.number().int().min(0),
  applied_tier: z.string().nullable(),        // 自動適用された数量値引きの label
  breakdown: z.array(z.object({ label: z.string(), factor: z.string() })), // '×0.85' '+50%' 等の表示用
}).strict();

// inquiry/contracts.ts — 公開フォーム (anon が触る唯一の書き込み入力)
export const zInquiryInput = z.object({
  name: zShortText(50),
  email: z.string().email().max(120),
  tel: z.string().regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/).nullable(),
  inquiry_type: z.enum(["construction", "estimate", "material", "other"]),
  item: z.string().max(100).nullable(),
  body: zShortText(5000).pipe(z.string().min(10)),
  privacy_agreed: z.literal(true), // 同意なし送信は型レベルで不可
}).strict();

// media/contracts.ts
export const zMediaPatch = z.object({
  alt: z.string().max(200),
  tags: z.array(z.string().max(30)).max(10),
  is_placeholder: z.boolean(),
}).partial().strict();

// distribution/contracts.ts
export const zScheduleEntry = z.object({
  draft_id: z.string().uuid(),
  scheduled_at: zIsoDatetime.nullable(), // §4.7 zScheduleReq と同一要素型 (note は null 必須)
}).strict();

export const zStyleProfileInput = z.object({
  tone_instructions: zShortText(2000),
  format_rules: zShortText(2000),
  example_output: z.string().max(10_000).nullable(),
}).strict();
```

### 4.9 facade 補助型

§5 のシグネチャで使う型。Zod が必要なのは外部入力のみで、読み取りビュー型は TypeScript type として定義 (DB 出力の正しさは repository + DDL が保証):

```ts
export const zPagination = z.object({
  cursor: z.string().nullable(),           // keyset カーソル (created_at + id を base64)
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export type Pagination = z.infer<typeof zPagination>;
export type Paged<T> = { items: T[]; next_cursor: string | null };

// 読み取りビュー型 (contracts.ts に type で定義。外部 API 応答に載せる場合のみ Zod 化する)
export type ContentKind = "work" | "voice" | PostKind;   export type PostKind = "reading" | "news" | "blog";
export type PublishedItem<K extends ContentKind> = /* kind 別の公開表示用射影 */ …;
export type MediaItem = { id: string; url: string; alt: string; width: number; height: number; tags: string[]; is_placeholder: boolean };
export type ApprovedDraft = { draft_id: string; channel: Channel; content: ChannelContent; approved_at: string };
export type PriceTable = {
  grades: PriceGrade[];
  sizes: PriceSizeClass[];
  matrix: PriceMatrixCell[];
  tiers: QuantityTier[];
  options: PriceOption[];
}; // v2: shop シミュレータと admin 価格画面の共通データ形
export type InquiryInput = z.infer<typeof zInquiryInput>;
export type EstimateInput = z.infer<typeof zEstimateInput>;  export type EstimateResult = z.infer<typeof zEstimateResult>;
export type ScheduleEntry = z.infer<typeof zScheduleEntry>;
```

---

## 5. facade インターフェース (主要シグネチャ)

戻り値はすべて `Result<T>` (§4.1)。例外をモジュール境界から漏らさない。

**拡張規約 (2026-07-08 追記)**: 本節のシグネチャは「モジュール間契約として不変の主要メソッド」。各 facade は、自モジュールの admin UI が必要とする **CRUD 拡張メソッドを追加してよい** (ESLint 境界により admin 画面から repository を直接呼べないため)。拡張は facade.ts 内に「契約外拡張」コメントで明示し、**他モジュールから拡張メソッドを呼ぶことは禁止** (呼ぶ必要が生じたら本節へ昇格させる)。Wave 1 で settings/inquiry/media/content/pricing に追加済み。

```ts
// content/facade.ts
export interface ContentFacade {
  createBlogPostFromDraft(input: BlogPostContent & { source_run_id: string }): Promise<Result<{ post_id: string; slug: string }>>;
  // BlogPostContent は content 側に定義する構造的同型 (zSiteBlogContent と同形)。
  // ai-studio の型を import すると依存方向 §2 に逆流するため独立定義 (Wave 0 実装で確定)
  publish(kind: PostKind | "work" | "voice", id: string, publishedAt?: Date): Promise<Result<void>>;
  listPublished<K extends ContentKind>(kind: K, page: Pagination): Promise<Result<Paged<PublishedItem<K>>>>;
  getBySlug<K extends ContentKind>(kind: K, slug: string): Promise<Result<PublishedItem<K> | null>>;

  // ビジュアル画像エディタ用 (visual-media-editor.md §6 で追加、2026-07-09)。
  // old_media_id は CAS の楽観排他期待値 (is not distinct from 意味論)。0 行更新 = KMB-E109。
  // revalidate は呼び出し側 Server Action の責務 (visual-media-editor.md §5.5b で一元管理)。
  setWorkCover(workId: string, oldMediaId: string | null, newMediaId: string | null): Promise<Result<void>>;
  setVoicePhoto(voiceId: string, oldMediaId: string | null, newMediaId: string | null): Promise<Result<void>>;
  setPostCover(postId: string, oldMediaId: string | null, newMediaId: string | null): Promise<Result<void>>;
  setWorkImage(workId: string, oldMediaId: string, newMediaId: string | null): Promise<Result<void>>;
  // ↑ work_images 1 行の atomic 置換 (RPC replace_work_image、migration 0013)。E108=重複 / E109=対象なし
}

// page-media/facade.ts (visual-media-editor.md §6 が canonical。2026-07-09 新設)
export interface PageMediaFacade {
  resolveAll(): Promise<Result<ResolvedSlots>>;      // 公開 SSR 用。unstable_cache tag "page_media"。ResolvedSlots は Record (JSON-safe、Map 禁止)
  resolveAllFresh(): Promise<Result<ResolvedSlots>>; // /edit プレビュー用 (キャッシュ非経由)
  listForAdmin(route?: string): Promise<Result<PageSlotState[]>>;
  setSlot(slotKey: string, mediaId: string | null): Promise<Result<void>>;   // registry 外 slot_key は KMB-E107
  setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>>;

  // テキストスロット (visual-text-editor.md §3。2026-07-10 追加。page_text 所有)
  resolveAllTexts(): Promise<Result<ResolvedTexts>>;      // Record (JSON-safe)。tag "page_text"
  resolveAllTextsFresh(): Promise<Result<ResolvedTexts>>;
  listTextsForAdmin(route?: string): Promise<Result<PageTextState[]>>;
  setText(slotKey: string, text: string | null): Promise<Result<void>>; // null = 既定に戻す (行削除)。maxLen/kind 違反は E101

  // AI 文言候補/画像生成のサイト文脈 (ai-studio-v2.md §3。2026-07-10 P2)。
  // TEXT/SLOT レジストリ現況 + 対象ページ + content の公開 works/posts タイトルを
  // JSON 決定的シリアライズ (untrusted policy)。対象スロットを <<<編集対象>>> でマーク
  buildSiteContextMd(input: { routeKey?: string; targetSlotKey?: string }): Promise<Result<string>>;
}

// media/facade.ts
export interface MediaFacade {
  getPublicUrl(mediaId: string): Result<string>;
  getJpegRenditionUrl(mediaId: string): Promise<Result<string>>; // IG 用。未生成なら生成
  listByTags(tags: string[]): Promise<Result<MediaItem[]>>;      // ai-studio の画像候補提案用
  assertDeletable(mediaId: string): Promise<Result<void>>;        // 参照ゼロ検証 (E301)
  // サーバ内生成画像 (AI 画像生成) の保存。バイナリ→Storage サーバサイド upload→media 行 insert。
  // completeUpload (クライアント署名 URL 経路) の行 insert ロジックを共有する (ai-studio-v2.md §4/BLOCKER-5)。
  createFromBytes(input: {
    bytes: Uint8Array; contentType: string;
    alt?: string; credit?: string; tags: string[]; isPlaceholder?: boolean;
  }): Promise<Result<{ id: string; storagePath: string }>>;
}

// ai-studio/facade.ts
export interface AiStudioFacade {
  createSource(input: CreateSourceInput): Promise<Result<{ source_id: string }>>;
  createAudioUploadUrl(req: CreateUploadUrlInput): Promise<Result<{ upload_url: string; storage_path: string }>>;
  confirmCleanedText(sourceId: string, finalText: string): Promise<Result<void>>; // 整文の人間確定 (stage 1.5)
  startRun(sourceId: string, channels: Channel[], research: boolean): Promise<Result<{ run_id: string }>>;
  advanceRun(runId: string): Promise<Result<{ status: RunStatus }>>; // 1 呼び出し = 1 stage (lease 取得込み、§7.1)
  editDraft(draftId: string, content: unknown): Promise<Result<{ revision: number }>>; // human revision を積む
  approveDraft(draftId: string): Promise<Result<void>>;
  rejectDraft(draftId: string): Promise<Result<void>>;
  getApprovedDraft(draftId: string): Promise<Result<ApprovedDraft>>; // distribution 専用。approved 以外は拒否
}

// distribution/facade.ts
export interface DistributionFacade {
  getStyleProfiles(): Promise<Result<Record<Channel, StyleProfile>>>;
  // ai-studio の draft 生成は本メソッドの結果を **app 層 (route handler) が取得して
  // AiStudioFacade に引数で渡す** 合成パターンで使う (ai-studio → distribution の
  // 依存を作らないため。Wave2-E で暫定ハードコードになっている箇所の正式解 — Wave 3 で配線)
  schedulePosts(entries: ScheduleEntry[]): Promise<Result<{ post_ids: string[] }>>; // entry = {draft_id, scheduled_at|null}
  cancel(postId: string): Promise<Result<void>>;
  markNotePublished(postId: string, externalUrl: string): Promise<Result<void>>;
  getMonthlyXPostCount(): Promise<Result<number>>; // 課金ガード用

  // note 下書き自動化 (ai-studio-v2.md §8。2026-07-10 P6。オプトイン)。
  // channel_posts に note_draft_status ('none'|'creating'|'created'|'unknown'|'failed') /
  // note_draft_url を追加 (migration 0016)。ChannelPostView にも両列を surface。
  saveNoteSessionCookie(cookie: string): Promise<Result<void>>; // Vault 保存 (secret 名 sns_note_session_cookie)。UI は保存日時のみ表示
  createNoteDraft(postId: string): Promise<Result<{ status: NoteDraftStatus; url: string | null }>>; // 下書き作成まで (公開しない)。unknown/creating は次回照合で重複防止、failed(401)は E409+通知
}

// settings/facade.ts
export interface SettingsFacade {
  get<K extends SettingsKey>(key: K): Promise<Result<SettingsValue<K>>>;
  update<K extends SettingsKey>(key: K, value: SettingsValue<K>, expectedUpdatedAt: Date): Promise<Result<void>>; // 楽観排他 E103
}

// inquiry/facade.ts
export interface InquiryFacade {
  submit(input: InquiryInput): Promise<Result<{ id: string }>>;
  // site-public から呼べる唯一の書き込み。DB 保存成功後に Resend で通知メール
  // (ベストエフォート — 送信失敗は KMB-E902 をログ記録するのみで Result は成功のまま。
  //  宛先は settings 'notifications'.inquiry_to、RESEND_API_KEY は Vercel env)
  updateStatus(id: string, status: InquiryStatus): Promise<Result<void>>;
}

// ai-providers/facade.ts (ai-studio-v2.md §1 が canonical。2026-07-10 新設)
export interface AiProvidersFacade {
  listKeys(): Promise<Result<AiKeyMeta[]>>;
  saveKey(input: SaveKeyInput): Promise<Result<{ id: string }>>;
  deleteKey(id: string): Promise<Result<void>>;
  testKey(id: string): Promise<Result<KeyTestResult>>;
  setKeyPriority(id: string, priority: number): Promise<Result<void>>;
  setEnabledModels(id: string, models: string[], defaultModel: string | null): Promise<Result<void>>;
  listAvailableModels(kind: "text" | "image"): Promise<Result<DetectedModel[]>>;
  generateText(req: GenerateTextReq): Promise<Result<TextResult>>;       // 予算予約 (E407) + usage 記録込み
  generateImages(req: GenerateImageReq): Promise<Result<ImageResult>>;   // 同上。n=1..4
  transcribe(req: TranscribeReq): Promise<Result<TranscribeResult>>;     // 既存 gpt-4o-transcribe 経路の移行先
  getUsageSummary(range: { from: string; to: string }): Promise<Result<UsageSummary>>;

  // 画像生成カスケード (ai-studio-v2.md §4。2026-07-10 P3)。生成画像は MediaFacade.createFromBytes で
  // media 保存し ai_image_generations に 1 行 1 画像で系譜記録 (root_id 自己参照、parent_id 連鎖)。
  generateImageCascade(req: GenerateImageCascadeReq): Promise<Result<ImageCascadeResult>>; // parentId 指定で系譜継承。参照画像上限 4 枚は E101
  markImageSelected(generationId: string): Promise<Result<void>>;                          // is_selected=true (Picker「これを使う」)
  getImageGenerationBreadcrumb(generationId: string): Promise<Result<ImageGenerationNode[]>>; // root→…→現在
  cleanupAiDraftMedia(): Promise<Result<{ deleted: number }>>;                              // cron 用。ai_draft_cleanup_run RPC (tags ai-draft ∧ is_selected=false ∧ 参照ゼロ ∧ 7日経過)
}
// ai_runs の stage 'image_generation' は §4.6 zRunStage/zRunStatus に反映済み (P4 でコード追随)

// pricing/facade.ts
export interface PricingFacade {
  getActivePriceTable(): Promise<Result<PriceTable>>;
  estimate(input: EstimateInput): Result<EstimateResult>; // 純関数。shop シミュレータと admin プレビューで共用
}
```

---

## 6. ドメインイベント

Next.js プロセス内は**同期呼び出し + revalidateTag** (イベントバスは導入しない — 単一管理者・低頻度のため過剰)。配信 worker も **Next.js Route Handler (/api/jobs/publish)** に置き、facade を同一プロセスで呼ぶ (**Deno Edge Function は不採用** — Next.js の facade/モジュール境界を跨げないため。Codex 指摘で実行面を統一)。pg_cron は毎分の起床信号のみ担当。

| イベント (論理名) | 発生源 | 反応 | 伝達方式 |
|---|---|---|---|
| content.published | content facade (publish) | `revalidateTag(kind)` + sitemap タグ再検証 | 同期 (Server Action 内) |
| content.scheduled_publish_due | pg_cron (毎分) | `/api/revalidate` を secret 付き POST | HTTP webhook |
| draft.approved | ai-studio (レビュー承認) | UI が DistributionFacade.schedulePosts へ誘導 (自動配信はしない — 人間が予約操作) | 同期 |
| channel_post.due | pg_cron (毎分) → /api/jobs/publish 起床 | worker (Next.js) が scheduled を CAS 取得して配信。202 即応 + after() で本体実行 | HTTP (shared secret) + DB |
| channel_post.published (site_blog) | worker (Next.js 内) | ContentFacade.createBlogPostFromDraft → revalidateTag (同一プロセスのため直接呼び出し) | 同期 |
| channel_post.failed / 結果不明 / token expired | worker | failed or manual_required (E506) + channel_accounts.auth_status 更新 + ダッシュボードバッジ | DB 書き込みのみ |
| media.replaced (実写差し替え) | media facade | 参照元コンテンツのタグを一括 revalidate | 同期 |
| inquiry.received | inquiry facade (submit) | Resend 通知メール (ベストエフォート、失敗は E902 ログのみ) + ダッシュボードバッジ | 同期 |

---

## 7. 結合シーケンス (正常系 + 主要異常系)

### 7.1 AI 実行 (stage 駆動 + SSE 観測)

実行は「**1 HTTP 呼び出し = 1 stage**」(advance) に分割し、SSE は観測専用 (Codex 指摘: 単一 Function で全 stage を実行する旧設計は maxDuration 超過・切断時に再開不能)。

```
admin UI → POST /api/ai/runs {source_id, channels, research}
  → ai_runs INSERT (status=pending) → {run_id}
admin UI → GET /api/ai/runs/{id}/stream (SSE, 観測専用)
         + POST /api/ai/runs/{id}/advance を completed/ready_for_review まで直列に自動連打
advance (1 回 = 1 stage):
  → lease 取得 (CAS): UPDATE ai_runs
       SET lease_expires_at = now()+'90 seconds', stage_attempts = stage_attempts+1
       WHERE id=? AND (lease_expires_at IS NULL OR lease_expires_at < now())
         AND status IN (実行可能状態)
     (0 行 = 他プロセスが lease 保持中 → 409 応答、UI は待って再試行)
  → stage 実行 (Claude streaming、delta を SSE へ中継。20 秒ごとに heartbeat で lease 延長)
  → 成果物 commit + status を次 stage へ + lease 解放を「同一トランザクション」で実行
[異常] 実行プロセスのクラッシュ → lease が自然失効 → 次の advance が同 stage を再実行
   (stage 成果物は (run_id, stage) キーの UPSERT で冪等 — 部分書き込みが残っても上書き)
[異常] stage_attempts > 3 → failed (KMB-E402)。再実行は新 run 作成 (immutable log)
[異常] SSE 切断 → 再接続で snapshot イベント復元。実行は advance が担うため停滞しない
```

### 7.2 予約投稿 (X の例)

整合性モデル: 外部 API への **exactly-once は原理的に保証不能** (成功応答受信前のクラッシュを判別できない)。**at-least-once + 人間照合**を正式モデルとする (Codex 指摘)。

```
pg_cron (毎分) → net.http_post → POST /api/jobs/publish (shared secret)
  → worker (Next.js Route Handler) は即 202 応答し after() で本体処理
      (pg_net の数秒 timeout・Edge Function の実行面問題に依存しない)
  → SELECT scheduled AND scheduled_at<=now() LIMIT 5
  → 各行: UPDATE status='publishing' WHERE id=? AND status='scheduled' (CAS; 0 行なら skip)
  → 課金ガード: 当月の estimated_cost_cents 合算 (published + publishing + scheduled 予定分)
      が ops_limits 上限超過 → E505 で failed
  → Vault からトークン取得 → 期限切れ間近なら refresh (advisory lock で単一実行、
      X の refresh token は使い捨てのため新 access+refresh を同一 TX で Vault 更新)
  → thread[i] を順に POST /2/tweets (in_reply_to 連結)。成功応答ごとに external_id JSON の
      tweet_ids / last_completed_index を即 UPDATE
  → 全件成功: status='published', published_at, external_url 記録
[異常] API がエラーを確定応答 → status='failed' + E504。手動リトライは last_completed_index+1 から
[異常] 応答不明 (timeout / 接続断 — 投稿されたか判別不能) → status='manual_required' + E506。
   自動再開禁止。admin が X 上の実投稿を目視確認し「投稿済み」or「未投稿 (scheduled へ戻す)」を選択
[異常] 401 → channel_accounts.auth_status='expired' + 当該チャネルの scheduled に警告フラグ
```

### 7.3 X OAuth 2.0 (PKCE) 接続

```
admin → GET /api/oauth/x/start (要 admin セッション)
  → code_verifier + state 生成 → 暗号化 httpOnly cookie (TTL 10 分) に保存
  → 302 → x.com/i/oauth2/authorize (scope: tweet.read tweet.write users.read offline.access)
x.com → GET /api/oauth/x/callback?code&state
  → state 照合 (不一致は E501) → code + verifier でトークン交換
  → Vault RPC (security definer, service role) で access+refresh 保存
  → channel_accounts UPSERT (auth_status='connected', meta=zXAccountMeta)
  → 302 → /admin/channels (接続済み表示)
```

### 7.4 Instagram (Meta) 接続

X と同粒度の実装契約 (Codex 指摘で追加):

```
admin → GET /api/oauth/meta/start (要 admin セッション)
  → state 生成 → 暗号化 httpOnly cookie (TTL 10 分) → 302 → facebook.com OAuth ダイアログ
      (scope: instagram_business_basic, instagram_business_content_publish, pages_show_list)
meta → GET /api/oauth/meta/callback?code&state
  → state 照合 → code → 短期トークン → 長期トークン (60 日) に交換
  → GET /me/accounts で Facebook ページ一覧 → /admin/channels でページ選択 UI
  → 選択ページの instagram_business_account を解決 → meta (zInstagramAccountMeta) に保存
  → Vault 保存 + channel_accounts UPSERT (auth_status='connected')
更新: worker が期限 7 日前に GET /refresh_access_token で延長。失敗 → auth_status='expired'
前提 (堀さん側の事前作業): Instagram プロアカウント化 + Facebook ページ紐付け + Meta App 作成。
自社アカウントのみの運用で App Review が省略可能かは Meta App 作成時に実機確認 (設計書 R2 —
必要と判明した場合、2c は X 先行で進め IG は審査完了後に有効化)
```

---

## 8. 契約変更手順

1. 本書 (該当 §) と設計書の関連節を**先に**更新。
2. `contracts.ts` / migration / 結合テスト (`contracts-ddl-parity.test.ts` 含む) を同一 PR で更新。
3. PR チェックリスト: 「本書・DDL・contracts.ts の 3 点一致」「エラーコード新設は所有モジュール確認」「facade シグネチャ変更は依存モジュールの影響列挙」。
