# モジュール契約書 (canonical)

- 版: v2.9 (2026-07-17: 契約同期 (#19) — Wave1〜2 実装で入った facade 拡張・列追加を現行コードへ同期。
  ① AiStudioFacade.startRun に第 4 引数 `styleProfiles: StyleProfilesByChannel` を追加 (§5) — Issue #20 で
  DistributionFacade.getStyleProfiles() の結果を app 層 (POST /api/ai/runs) が取得し startRun に渡す合成パターンが
  配線済みになった実態を反映。ai_runs.style_profiles jsonb 列 (migration 20260714000036)、zChannelStyleProfile /
  zStyleProfilesByChannel を §4.3 に追加。DistributionFacade.getStyleProfiles の「Wave 3 で配線」注記を配線済みへ更新 (§5)。
  ② PricingFacade の admin 専用拡張 (getFullPriceTable / savePriceGrade / savePriceOption / replacePriceSizeClasses /
  replacePriceMatrix / replacePriceQuantityTiers) を §5 に「契約外拡張」として明示 (facade.ts の乖離注記を格上げ)。
  ③ rate_limits の app 層直アクセス経路 (contact/lead route が service client で読み書き — RateLimitFacade は未新設) を §1 に注記。
  なお ContentFacade.createBlogPostFromDraft の source_run_id・InquiryFacade.submit の Resend 通知内蔵・rate_limits の
  inquiry 所有は既に契約 (§5/§1) と一致しており本改訂での変更はなし — #19 起票時の乖離は v2.3〜v2.8 で解消済みを実測確認)
- 旧版: v2.8 (2026-07-11: CRM スイート追加 — crm/sales/scheduling/telephony の 4 モジュール新設 (00-overview.md §2)、
  ExecutionContext と AI facade のバックグラウンド実行契約 (同 §3.1、裁定 J2)、activities タイムライン・ハブ統合契約 (同 §3.2.3)、
  共通スカラー (E.164/JPY/税区分/書類番号)、SETTINGS_SCHEMAS に analytics/branding/invoice_issuer/business_hours/work_capacity/telephony、
  KMB-E6xx/E7xx/E8xx 帯の割当 (E608/E807 含む — 個別 canonical は 00-overview §3.3)、zEstimateInput.quantity max 1000 是正 (裁定 J6)、
  site_settings anon SELECT の公開キー許可リスト化 (§4.2 注記 — 非公開キーは admin/service のみ読取)。
  統合元: docs/design/crm-suite/07-contracts-delta.md v1.8 — 本文中の裁定 #番号・Δ 記号・v1.x 表記は同書の裁定記録/版歴を指す)
- 旧版: v2.7 (2026-07-10: Wave B 実装反映 — PageMediaFacade に buildSiteContextMd (P2)・依存方向に page-media→content 追加 (P2)・DistributionFacade に saveNoteSessionCookie/createNoteDraft + note_draft 列 (P6)・AiProvidersFacade に generateImageCascade/markImageSelected/getImageGenerationBreadcrumb/cleanupAiDraftMedia (P3))
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
| `pricing` | 価格グレード/オプション・見積り計算・**通販シミュレーター (公開 UI/リード接続は app 層合成 — §7.8)** | price_grades, price_options (+price_size_classes, price_matrix, price_quantity_tiers) | (E101/E103 を共用) | PricingFacade |
| `inquiry` | お問い合わせ受付・管理・レート制限 | contact_inquiries, rate_limits | E105 (+E101 を共用) | InquiryFacade |
| `settings` | サイト設定 (会社情報/ヒーロー/SEO/運用上限/通知/**GA4 計測/ブランディング/適格請求書発行者/営業時間/週間稼働/電話運用**) | site_settings | (E101/E103 を共用) | SettingsFacade |
| `page-media` | 公開ページの装飾/ヒーロー画像・テキストスロット (visual-media-editor.md / visual-text-editor.md が親設計) | page_media, page_text (+view page_media_resolved) | KMB-E107 (E108/E109 は content 所有) | PageMediaFacade |
| `ai-providers` | 全 AI 呼び出しの単一入口 (キー管理/モデル検知/ルーティング/usage 記録/予算ガード) — ai-studio-v2.md が親設計 | ai_provider_keys, ai_usage_log, ai_image_generations, ai_image_generation_sources, ai_budget_months | KMB-E407, E408, E409 | AiProvidersFacade |
| `ai-studio` | 音声入力・文字起こし・整文・要旨抽出・リサーチ・チャネル別生成・レビュー (AI 呼び出しは ai-providers 経由) | ai_sources, ai_runs, channel_drafts, draft_revisions (+Storage bucket: audio) | KMB-E303, E401〜E406 | AiStudioFacade |
| `distribution` | 配信予約・SNS API 実行・チャネル接続・文体プロファイル | channel_posts, channel_accounts, style_profiles | KMB-E5xx | DistributionFacade |
| `crm` | 顧客/会社/案件/活動タイムライン (全モジュール共通ハブ)/タスク/リード取込 — 01-crm.md が親設計 | customers, companies, deals, activities, activity_links, tasks | KMB-E601〜E619 | CrmFacade |
| `sales` | 見積/受注/納品/請求/入金消込・採番・税計算・帳票 PDF・電帳法台帳・帳票メール送付 — 02-sales.md が親設計 | documents, document_lines, payments, document_sequences, issued_documents, print_tokens, pdf_render_lock, document_revision_stagings (v1.8 追記 — 02-sales v1.1 §2.3.2 の service 専用補助 3 テーブル), document_emails (issue #101 追記 — 帳票メール送付の送信台帳。migration 20260714000036) (+Storage bucket: issued-documents, branding-assets) | KMB-E620〜E649 | SalesFacade |
| `scheduling` | 作業種別/工数テンプレート/作業ブロック/実績/キャパシティ/外部カレンダー双方向同期 — 03-scheduling.md が親設計 | work_types, work_templates, work_template_items, work_blocks, calendar_connections, calendar_event_links | KMB-E701〜E739 | SchedulingFacade |
| `telephony` | Twilio 発番設定/着信 webhook/録音/通話ジョブ (転写→議事録→タスク起票)/通話 UI — 04-telephony.md が親設計 | calls, call_recordings, call_jobs (+Storage bucket: call-audio) | KMB-E801〜E839 | TelephonyFacade |
| `site-public` | 公開サイトの表示 (App Router ページ群) | **所有テーブルなし** (read 専用) | なし | なし (他 facade の消費者) |
| `nav-badges` | 管理サイドナビの未対応件数バッジ用の**読み取り専用横断集計** (問い合わせ/通話/やること) — 管理画面リデザイン移行設計.md §6 の唯一の facade 追加例外 (#129 R6c) | **所有テーブルなし** (contact_inquiries / calls / tasks へ**行を引かない count のみ**発行。書込・行取得は各所有モジュール facade 経由) | KMB-E0xx (E001, E002 — 新設「0xx 横断集計」帯) | NavBadgesFacade |

規則:
- テーブルへの直接クエリは**所有モジュールの repository のみ**。他モジュールは facade 経由。
- **rate_limits は inquiry 所有だが、現行実装では facade を経ず app 層 (`src/components/contact/rate-limit.server.ts` — contact フォーム / POST /api/shop/lead リード) が service client で直接読み書きする** (v2.9 注記)。RLS が anon/authenticated ポリシーを持たない service 専用テーブルで、site-public 保護という inquiry 隣接の関心事だが RateLimitFacade は未新設 (contact INSERT を InquiryFacade.submit の例外とする §2 と同じ「公開サイトからの限定的直アクセス」枠)。facade 化が必要と判断された時点で本書を先に改訂する
- エラーコードの新設は所有モジュールの契約変更として本書を先に更新。
- KMB-E6xx/E7xx/E8xx の個別割当 canonical は docs/design/crm-suite/00-overview.md §3.3。帯内の追加は本書改訂が先
- **activities への直接クエリは crm repository のみ**。他モジュールのタイムライン書き込みは `CrmFacade.appendActivity` に限る (§7.9 の統合契約)

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
crm         ──→ platform / settings (notifications の read — digest 宛先)
sales       ──→ crm (appendActivity・顧客/案件参照) / settings (invoice_issuer・company の read — 発行者情報) / platform
scheduling  ──→ crm (appendActivity・案件参照) / settings (work_capacity の read) / platform
telephony   ──→ crm (顧客マッチ/タスク/appendActivity) / ai-providers (transcribe/generateText)
              / settings (business_hours・telephony の read — voice webhook 15 秒制約内の分岐) / platform
すべて      ──→ platform (認証・Result・エラー定義)
```

settings への上記依存 (crm/sales/scheduling/telephony) はいずれも **`SettingsFacade.get` の read のみ** (v1.1 裁定: 04-telephony Δ1 / 02-sales Δs1 を採用し、crm (digest 宛先)・scheduling (キャパ設定) の同種 read も同時に明記 — ai-studio→settings と同型の read 依存で循環しない)。settings キーの**書込** (update) は各管理画面の Server Action (app 層) のみで、他モジュールの facade からは行わない。read はいずれも server 文脈 (session または service ctx — §5 の `get(key, ctx?)`) で行う: site_settings の anon SELECT は公開キー許可リストに限定される (§4.2 注記) ため、voice webhook 等の anon 起点 route からの business_hours/telephony read も facade を service ctx で呼ぶ。

v1.2 是正 2 点:

- **crm → ai-providers の辺は張らない** (v1.1 まで「将来の AI 補助。v1 実利用なし」として掲載していたが削除)。§5 の CrmFacade に ai-providers 呼び出しは存在せず、実利用のない辺は増やさない (pricing→crm を追加しない下記方針と同一)。AI 補助を実装する時点で本書改訂として追加する
- **sales → pricing の辺も張らない** (00-overview §2.2 に残る「pricing (見積原案の変換入力は app 層経由)」は本節へ追随改訂すること — 括弧書きどおり app 層経由であり、`createDraftQuoteFromEstimate` の入力 `SimEstimateSnapshot` は crm 所有契約 (§4.10) の import で足りる)。**00-overview §2.2 の依存図は本節が正**であり、同図に残る差分 (crm 行の ai-providers 辺・sales 行の pricing 辺) は本節に合わせて削除改訂する (settings read 4 本は 00 §2.2 に反映済みを実測確認 — 2026-07-11)

禁止:
- 循環依存一切禁止 (`content → ai-studio` 等の逆流禁止)。
- `internal/**` の跨モジュール import 禁止。
- **AI SDK (`@anthropic-ai/sdk` / `openai` / `@google/genai`) の直 import は ai-providers/internal のみ** (ESLint 強制。usage 記録の単一入口を破らない)。
- site-public から書き込み系 facade の import 禁止 (contact フォームの INSERT のみ InquiryFacade.submit を例外許可)。
- **sales ⇄ scheduling の相互 import 禁止** — 受注明細→作業ブロック生成は app 層合成 (§7.7)
- **`twilio` SDK の直 import は telephony/internal のみ** (ESLint 強制)
- **`googleapis` / `@microsoft/microsoft-graph-client` の import 全面禁止** — カレンダー API は scheduling/internal の薄い fetch ラッパ (x-api.ts 前例) で実装
- pricing → crm の依存は追加しない (シミュレーター→リードは route handler の app 層合成 — 裁定 J10 の「facade 経由」を依存を増やさず満たす)

機械的強制: ESLint `no-restricted-imports` で `src/modules/*/internal/**` と repository の跨モジュール import をエラーにする (Phase 1a で設定)。v2.8: `eslint.config.mjs` の `MODULES` 配列に `"crm", "sales", "scheduling", "telephony"` を追加する (v2.8 統合と同一 PR)。

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
- **ExecutionContext (§4.1 追加分)**: service 文脈 (webhook / pg_cron worker) からの facade 実行は次の 3 形のいずれかによる (v1.2 明文化 — いずれも**必ず facade を経由**する。RLS bypass を repository 直呼びの言い訳にしない)。以下のいずれにも該当しないメソッドは admin セッション必須のまま:
  1. **ctx 引数型** — §5 の interface に `ctx?: ExecutionContext` が明記されたメソッド。省略時 `{ mode: "session" }` (cookie セッション、完全後方互換)
  2. **常時 service 型** — 呼び出し元が anon route に限られ mode 選択の余地がないメソッド (`intakeFromInquiry` / `intakeFromSimulator`)。ctx は取らず、interface コメントに「常に service 実行」と宣言する
  3. **facade 注入型** — facade 全体を service client で構築する `createXxxFacade(client)` ファクトリ経由 (`createDraftQuoteFromEstimate` — 02-sales §6.1。pricing の createPricingFacade 前例)

  契約外拡張メソッド (§5 拡張規約) も、app 層 route から service 文脈で呼ぶ場合は 1 の形で `ctx?: ExecutionContext` を取ってよい (markExpiredQuotes / getSalesDigest — §6 crm.digest.due 行が実例。§5 拡張規約に反映済み)
- **JSONB discriminated map の追加**: `ACTIVITY_PAYLOAD_SCHEMAS` (§4.10) は SETTINGS_SCHEMAS / CHANNEL_CONTENT_SCHEMAS と同格の canonical map。activities.payload の読み書き両方で `ACTIVITY_PAYLOAD_SCHEMAS[activity_type].parse()` の二段階 parse を通す

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

// ---------- v2.8 追加 (CRM スイート — 00-overview.md §3.1) ----------

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * facade 実行文脈 (M0 共通基盤 — 00-overview.md §3.1、裁定 J2)。
 * - 省略時 = { mode: "session" }: cookie セッション (admin ログイン)。現行挙動と完全一致。
 * - { mode: "service" }: webhook / pg_cron worker。DB アクセスは service_role client
 *   (client 省略時は facade 側が createSupabaseServiceClient() を生成。注入はテスト用途)。
 *   予算/採番/lease 系 RPC は is_admin_or_service() ガード (migration 0021) で通る。
 */
export type ExecutionContext =
  | { mode: "session" }
  | { mode: "service"; client?: SupabaseClient };

export const DEFAULT_EXECUTION_CONTEXT: ExecutionContext = { mode: "session" };

/** 電話番号 (E.164)。保存は常にこの形式。入力は normalizeJpPhoneToE164() (platform/text.ts — M0 で新設)
 *  で正規化してから parse する。正規化の完全仕様 (v1.2 — 本コメントが canonical。実装はまだ存在しない):
 *  ① 区切り文字 (ハイフン・空白・括弧、全角同等含む) を除去する
 *  ② '+' 始まりの入力は E.164 形式検証のみで素通しする (Twilio Voice webhook の From は既に '+81...' で届く —
 *     ここを国内形式前提で実装すると全着信が番号非通知扱いになり顧客マッチが全滅する)
 *  ③ '0[1-9]' 始まりの国内番号は市外局番の桁数に依存せず先頭 0 を除去して '+81' を付与する
 *     (総桁数 10〜11 桁を検証 — 固定電話 096/03/0965 等の 2〜5 桁市外局番も携帯 0X0 も同一規則)
 *  ④ 上記以外 ('anonymous'・空文字・検証不合格) は null を返す (= 番号非通知扱い)
 *  M0 の platform-scalars テスト (00-overview §9.2) の必須ケース:
 *  '+819012345678' 素通し / '096-XXX-XXXX'・'03-XXXX-XXXX' (固定) / '090-XXXX-XXXX' (携帯) / 'anonymous' → null */
export const zTelE164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "E.164 形式 (+81...)");

/** 帳票・売上金額 (円整数)。AI コストの µUSD と混在禁止 (既存規約) */
export const zJpyAmount = z.number().int().min(0).max(9_999_999_999);
/** 符号付き金額 (値引き行・調整行用) */
export const zJpySignedAmount = z.number().int().min(-9_999_999_999).max(9_999_999_999);

/** 消費税区分 (明細行が持つのは区分のみ。税額は書類×税率ごとに 1 回だけ計算 — 裁定 J5) */
export const zTaxCategory = z.enum(["standard_10", "reduced_8", "zero", "exempt"]);
export type TaxCategory = z.infer<typeof zTaxCategory>;
export const TAX_RATE_BY_CATEGORY: Record<TaxCategory, number> = {
  standard_10: 10,
  reduced_8: 8,
  zero: 0,
  exempt: 0,
};

/** 端数処理方式 (書類×税率ごと 1 回)。既定 floor (裁定 J5) */
export const zTaxRounding = z.enum(["floor", "round", "ceil"]);

/** 適格請求書発行事業者登録番号 (T+13桁)。null = 免税/未登録 → 区分記載様式に分岐 */
export const zInvoiceRegistrationNumber = z.string().regex(/^T\d{13}$/);

/** 書類番号 (document_number_next RPC — 00-overview.md §3.4 と 1:1)。
 *  Q=見積 / J=受注 / D=納品 / I=請求。連番 9999 超は桁が自然増加する */
export const zDocumentNo = z.string().regex(/^[QJDI]-\d{4}-\d{4,}$/);

/** JST 日付 (発行日・入金日・実施日・holidays)。DB は date 型、表示/入力とも Asia/Tokyo。
 *  v1.2: 実在日検証を追加 — 2026-02-31 等を KMB-E101 で拒否する
 *  (regex のみだと DB date 型で初めて落ちて生 DB エラー (E901 系) になる) */
export const zDateOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, "実在する日付 (YYYY-MM-DD)");
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

/** GA4 計測 (05-site-settings.md、裁定 J12)。measurement_id は秘匿でないため site_settings 可。
 *  null = 計測無効。タグ注入は (site)/layout.tsx のみ (admin/edit 除外) */
export const zAnalyticsSettings = z.object({
  ga4_measurement_id: z.string().regex(/^G-[A-Z0-9]{4,16}$/).nullable(),
}).strict();

/** ブランディング (favicon)。media 参照 3 点セット (media_admin_delete /
 *  media_reference_summary / ai_draft_cleanup_run) への追記は migration 0035 (05-site-settings.md) */
export const zBrandingSettings = z.object({
  favicon_media_id: zMediaId.nullable(), // null = 既定 favicon (public/favicon.ico — 05 §5.3 の移設後パス) にフォールバック
}).strict();

/** 適格請求書発行者情報 (02-sales.md、裁定 J5)。registration_number null = 免税モード
 *  (帳票は区分記載様式 + 「消費税相当額」表記に自動分岐 — どちらでも壊れない設計)。
 *  本キーは anon 不可読 (下記「anon 可読キーの許可リスト」— 銀行口座を含むため) */
export const zInvoiceIssuerSettings = z.object({
  issuer_name: zShortText(80),                       // 屋号/法人名 (帳票の発行者欄)
  registration_number: zInvoiceRegistrationNumber.nullable(),
  tax_rounding: zTaxRounding,                        // 既定 'floor'
  bank_account: z.object({
    bank_name: zShortText(40),
    branch_name: zShortText(40),
    account_type: z.enum(["ordinary", "checking"]),  // 普通/当座
    account_number: z.string().regex(/^\d{4,8}$/),
    account_holder_kana: zShortText(60),
  }).strict().nullable(),                            // null = 振込先欄を印字しない
  transfer_fee_note: z.string().max(100).nullable(), // 振込手数料負担文言 (請求書のみ印字)
  seal_storage_path: z.string().max(300).nullable(), // 角印画像 (任意。社名右に重ね合成)。
    // v1.2 是正 (旧 seal_media_id: zMediaId を廃止): media テーブルは anon 全行 SELECT +
    // media バケットは public (migration 0002/0003 実測) のため、media 参照だと社印画像が
    // 匿名取得可能になる (書類偽造の材料)。private バケット 'branding-assets' (public=false、
    // migration 0028 で作成 — 旧「media 参照 3 点セット追記」は不要となり 0028 の内容を置換) に
    // 保存し、PDF 生成 (/print) は server 側で署名 URL を解決する (02-sales §10.6 の
    // 「media の公開 URL を <img>」は本是正へ追随すること)
  quote_valid_days: z.number().int().min(1).max(180), // 見積有効期限の既定日数 (既定 30)
}).strict();

/** 構造化営業時間 (04-telephony.md の着信分岐 + 公開表示。裁定 J3/J12)。
 *  JST 前提。open/close は "HH:MM"。null = 終日休み。
 *  v1 制約: 1 日 1 窓のみ (昼休み等の複数窓分割は拡張章送り — 04-telephony §16 と同期)。
 *  v1.2: open < close の refine を追加 — close < open が保存できると 04 §6.2 の JST 判定
 *  (open <= now < close) で恒久的に時間外となり全通話が留守電へ落ちる静かな degrade になる */
const zDayHours = z.object({
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict().refine((h) => h.open < h.close, "open は close より前 (HH:MM 文字列比較で順序付く)").nullable();
export const zBusinessHoursSettings = z.object({
  mon: zDayHours, tue: zDayHours, wed: zDayHours, thu: zDayHours,
  fri: zDayHours, sat: zDayHours, sun: zDayHours,
  holidays: z.array(zDateOnly).max(200),             // 臨時休業日 (JST)
}).strict();

/** 週間稼働キャパシティ (03-scheduling.md、裁定 J8)。
 *  キャパ残 = weekly_hours − 配置済み拘束ブロック合計 */
export const zWorkCapacitySettings = z.object({
  weekly_hours: z.number().min(0).max(168),
}).strict();

/** 電話まわりの運用設定 (04-telephony.md §1.4 番号非依存設計 / 裁定 J3 ★確認 1・4。v1.1: Δ2 採用)。
 *  全フィールド null/既定で「未設定でも壊れない」: 番号未購入でも保存可、
 *  forward_to null = 全通話留守電、announcement text null = コード内既定文言 */
export const zTelephonySettings = z.object({
  phone_number_e164: zTelE164.nullable(),        // 購入した 050 番号 (表示・Phase 2 発信用)
  twilio_number_sid: z.string().max(64).nullable(), // 番号リソース SID (PN...)。運用記録用
  forward_to_e164: zTelE164.nullable(),          // 営業時間内の転送先 (熊部さん携帯)。null = 転送なし→留守電
  consent_announcement_enabled: z.boolean(),     // 録音同意アナウンス (既定 true — 裁定 J3)
  consent_announcement_text: z.string().max(300).nullable(), // null = 既定文言 (telephony/internal/twiml.ts の定数)
  in_hours_greeting_text: z.string().max(300).nullable(),    // 営業時間内・転送なし時の留守電導入文言
  after_hours_greeting_text: z.string().max(300).nullable(), // 時間外アナウンス文言
  voicemail_max_seconds: z.number().int().min(30).max(600),  // <Record maxLength>。既定 120
  delete_twilio_recording_after_download: z.boolean(),       // 既定 true (ストレージ課金停止 — ext-twilio §2.2)
  max_processing_minutes: z.number().int().min(1).max(60),   // AI 処理する録音長の上限。既定 30。超過は KMB-E822
}).strict();

export const SETTINGS_SCHEMAS = {
  company: zCompanySettings,
  hero: zHeroSettings,
  seo_defaults: zSeoDefaults,
  ops_limits: zOpsLimits,
  notifications: zNotificationSettings,
  analytics: zAnalyticsSettings,
  branding: zBrandingSettings,
  invoice_issuer: zInvoiceIssuerSettings,
  business_hours: zBusinessHoursSettings,
  work_capacity: zWorkCapacitySettings,
  telephony: zTelephonySettings,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
```

実装フェーズの注記 (v2.8): analytics/branding = 05 フェーズ、invoice_issuer = sales フェーズ、business_hours・telephony = telephony フェーズ、work_capacity = scheduling フェーズで実装するが、**所有は settings・canonical は本節** (各書で再定義しない)。キー追加は DDL 不要。**新規キーは seed もバックフィルもしない** (v1.2 是正 — 既存規約の「バックフィル UPDATE」は 0013/0015 のような**既存キー行への列追加**の前例であり、本節の 6 キーは行が存在しない新規キーのため UPDATE は 0 行 no-op になる): 行は admin の初回保存 (settings/repository.ts `upsertSetting` の INSERT 経路 — 実装済み) で作成され、行なし時の `get()` E901 は各消費モジュールが既定値へ degrade する (04-telephony §6.1: business_hours 未設定 = 常に営業時間内・telephony 未設定 = 転送なし / 02-sales: E626 / 03-scheduling: work_capacity 未設定既定)。

**anon 可読キーの許可リスト (v1.2 セキュリティ是正 — BLOCKER 対応)**: 現行 RLS (migration 20260708000002 L218-220) は `site_settings_anon_select ... using (true)` で**全行 anon SELECT 可** (「公開情報のみのため」の前提コメント付き) だが、本節が追加する invoice_issuer (銀行口座) / telephony (転送先個人携帯 = forward_to_e164) を置くと anon key (クライアント公開) の Supabase REST から匿名取得できてしまう (05-site-settings R8 がリスク登録していた事象そのもの)。**M0 帯の migration (0021 と同一フェーズ) で本ポリシーを公開キーの許可リストに置換する**:

```sql
drop policy site_settings_anon_select on site_settings;

create policy site_settings_public_select on site_settings
  for select
  using (key in ('company', 'hero', 'seo_defaults', 'analytics', 'branding', 'business_hours'));

create policy site_settings_admin_select on site_settings
  for select
  using (public.is_admin());
```

- 非公開キー (`ops_limits` / `notifications` / `invoice_issuer` / `work_capacity` / `telephony`) は admin セッションまたは service client のみ読取。**admin_select の併設は必須** — 旧ポリシーは anon/authenticated 共用 (`to` 句なし) のため、許可リスト化だけでは admin セッションの非公開キー読取 (設定画面) まで失われる。SQL は 00-overview §3.1.2c (0021 canonical DDL) と同一に保つ
- **既存 anon 読取の同時是正が必須**: `inquiry/internal/notify.ts` が notifications キーを public client で read している (実測) — 同フェーズで service client 読取へ切替 (通知メールが静かに止まる regression を防ぐ)
- voice webhook (anon 起点 route) の business_hours/telephony read は `handleInboundCall` が持つ service ctx のクライアントで行う (`SettingsFacade.get(key, ctx?)` — §5 の ctx 追加)。04 Δ1 の成立条件は anon 全行 SELECT ではなく本経路に変更
- 00-overview §10 の migration 割当 (M0 = 0021/0022) に本 RLS 置換を追記すること (07-contracts-delta.md 適用後チェックリスト (5))

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

/** v2.9 (Issue #20): チャネル別文体プロファイル。distribution/contracts.ts の StyleProfile と
 *  構造的同型を ai-studio 側に独立定義する (ai-studio → distribution の import は依存方向 §2 で
 *  禁止のため — フィールド変更時は distribution 側 StyleProfile も同期させること)。
 *  startRun の第 4 引数 (§5) として app 層 (POST /api/ai/runs) が DistributionFacade.getStyleProfiles()
 *  の結果を渡し、ai_runs.style_profiles jsonb 列 (migration 20260714000036) に確定保存する。 */
export const zChannelStyleProfile = z.object({
  tone_instructions: z.string(),
  format_rules: z.string(),
  example_output: z.string().nullable(),
}).strict();
export type ChannelStyleProfile = z.infer<typeof zChannelStyleProfile>;

/** 4 チャネル全件マップ (z.record + enum key で全キー必須の exhaustive。
 *  getStyleProfiles() が常に 4 チャネル全件を返す前提と一致)。→ ai_runs.style_profiles */
export const zStyleProfilesByChannel = z.record(zChannel, zChannelStyleProfile);
export type StyleProfilesByChannel = z.infer<typeof zStyleProfilesByChannel>;
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
  quantity: z.number().int().min(1).max(1000), // v2.8: UI clamp (1..1000) と統一 (legacy 互換。旧 999 は不整合)
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
  size_classes: PriceSizeClass[];   // v2.8 是正: 旧記述 sizes は実装と乖離 (裁定 #18)
  matrix: PriceMatrixCell[];
  quantity_tiers: QuantityTier[];   // v2.8 是正: 旧記述 tiers は実装と乖離 (裁定 #18)
  options: PriceOption[];
}; // v2: shop シミュレータと admin 価格画面の共通データ形
export type InquiryInput = z.infer<typeof zInquiryInput>;
export type EstimateInput = z.infer<typeof zEstimateInput>;  export type EstimateResult = z.infer<typeof zEstimateResult>;
export type ScheduleEntry = z.infer<typeof zScheduleEntry>;
```

### 4.10 crm の値契約 (crm/contracts.ts)

```ts
import { z } from "zod";
import {
  zDateOnly, zDocumentNo, zIsoDatetime, zJpyAmount, zShortText, zTelE164,
} from "@/modules/platform/contracts";

/** 顧客ライフサイクル・案件ステージ・タスク状態 (DDL check 制約と 1:1 — parity テスト対象) */
export const zCustomerLifecycle = z.enum(["lead", "customer", "archived"]);
export const zLeadSource = z.enum(["form", "simulator", "phone", "manual", "migration"]);
export const zDealStage = z.enum([
  "inquiry", "estimating", "quote_sent", "ordered",
  "in_production", "delivered", "invoiced", "paid", "lost",
]);
export type DealStage = z.infer<typeof zDealStage>;
export const zTaskStatus = z.enum(["open", "done", "cancelled"]);
export const zTaskOrigin = z.enum(["manual", "ai_call", "form", "system"]);

/** ステージ意味論 registry (probability/is_won/is_lost は DB に持たない — 00-overview §6.1) */
export const DEAL_STAGE_REGISTRY: Record<DealStage, {
  label: string; probability: number; isWon: boolean; isLost: boolean;
}> = {
  inquiry:       { label: "相談",     probability: 10,  isWon: false, isLost: false },
  estimating:    { label: "見積作成", probability: 30,  isWon: false, isLost: false },
  quote_sent:    { label: "見積送付", probability: 60,  isWon: false, isLost: false },
  ordered:       { label: "受注",     probability: 100, isWon: true,  isLost: false },
  in_production: { label: "製作中",   probability: 100, isWon: true,  isLost: false },
  delivered:     { label: "納品済み", probability: 100, isWon: true,  isLost: false },
  invoiced:      { label: "請求済み", probability: 100, isWon: true,  isLost: false },
  paid:          { label: "入金済み", probability: 100, isWon: true,  isLost: false },
  lost:          { label: "失注",     probability: 0,   isWon: false, isLost: true },
};

export const zCustomerInput = z.object({
  kind: z.enum(["person", "company_contact"]),
  name: zShortText(80),
  name_kana: z.string().max(120).nullable(),
  email: z.string().email().max(120).nullable(),
  tel_e164: zTelE164.nullable(),               // 入力は normalizeJpPhoneToE164() 済みを渡す
  company_id: z.string().uuid().nullable(),
  address: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
  lifecycle: zCustomerLifecycle,
  source: zLeadSource,
}).strict().refine(
  c => c.email !== null || c.tel_e164 !== null || c.source === "manual",
  "email か電話のどちらかが必要です (手動作成を除く — KMB-E607)",
);

export const zCompanyInput = z.object({
  name: zShortText(80),
  name_kana: z.string().max(120).nullable(),
  tel_e164: zTelE164.nullable(),
  address: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
}).strict();

export const zDealInput = z.object({
  title: zShortText(120),
  customer_id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  pipeline: z.literal("default"),              // v1 単一。拡張時は enum 化 + check 制約拡張
  stage: z.enum(["inquiry", "estimating", "quote_sent"]),
    // v1.2: 作成時は非 won・非 lost の 3 値のみ (zDealStage の部分集合) に制限。
    // 全 9 値を許すと createDeal (01-crm: 「stage は input のまま INSERT」) 経由で
    // (a) won 系直接作成 → won_at NULL のまま終端 (00-overview §6.1 の不変条件破り)、
    // (b) 'lost' 直接作成 → lost_reason なし (deals_lost_requires_reason check に未翻訳で衝突。
    //     'lost' は markDealLost 専用 — updateDealStage(to='lost') も常に E602。ただし from===to の
    //     縮退ケース (lost,lost) はガード順で noop ok — 01-crm v1.1 §4.2 の 9×9 マトリクスが正) の 2 穴が開く。
    // 既存データのスクリプト移行も stage='inquiry' でのみ deal を作る (01-crm §12.1) ため支障なし。
    // 進行は updateDealStage / markDealLost の専用経路のみ
  amount_jpy: zJpyAmount.nullable(),           // v1.2: インライン再定義を canonical スカラーの導出に変更
  expected_close_on: zDateOnly.nullable(),
  source: zLeadSource,
  notes: z.string().max(10_000).nullable(),
}).strict();

export const zTaskInput = z.object({
  title: zShortText(120),
  body: z.string().max(2000).nullable(),
  due_on: zDateOnly.nullable(),
  deal_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
  origin: zTaskOrigin,
  source_activity_id: z.string().uuid().nullable(),
}).strict();

/* ---------- activities タイムライン・ハブ (00-overview §3.2.3 の統合契約) ---------- */

export const zNoteActivityPayload = z.object({}).strict(); // 本文は activities.body

export const zCallActivityPayload = z.object({
  call_id: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),   // outbound は Phase 2 予約
  duration_seconds: z.number().int().min(0),
  has_recording: z.boolean(),
  summary: z.string().max(2000).nullable(),     // 議事録要約 (全文は call_jobs 側)
}).strict();

/** Phase 2 予約 (裁定 J7)。v1 では appendActivity が挿入を拒否する (KMB-E604) */
export const zEmailActivityPayload = z.object({
  direction: z.enum(["inbound", "outbound"]),
  subject: z.string().max(200),
}).strict();

export const zFormSubmissionActivityPayload = z.object({
  inquiry_id: z.string().uuid(),                // contact_inquiries.id (inquiry 所有のまま参照)
  inquiry_type: z.enum(["construction", "estimate", "material", "other"]),
  excerpt: z.string().max(300),
}).strict();

/** シミュレーター結果スナップショット。pricing の zEstimateInput/zEstimateResult の
 *  構造的同型 (import すると pricing→crm と循環するため独立定義 — 契約書 §2 の定石) */
export const zSimEstimateSnapshot = z.object({
  grade_key: z.string().max(30),
  grade_label: z.string().max(30),
  size_key: z.string().max(10),
  size_label: z.string().max(30),
  quantity: z.number().int().min(1).max(1000),
  option_keys: z.array(z.string().max(30)).max(10),
  quote_only: z.boolean(),
  total_min: z.number().int().min(0),
  total_max: z.number().int().min(0),
  applied_tier: z.string().max(30).nullable(),
  breakdown: z.array(z.object({
    label: z.string().max(50),
    factor: z.string().max(30), // v1.1: computeEstimate は factor に size.label (max 30) を入れるため 20→30 に是正 (06-simulator の発見)
  }).strict()).max(20),
}).strict();

export const zSimulatorEstimateActivityPayload = z.object({
  estimate: zSimEstimateSnapshot,
  price_note: z.string().max(200).nullable(),   // 適用時点の注記 (価格表版など)
}).strict();

export const zDocumentEventActivityPayload = z.object({
  document_id: z.string().uuid(),
  doc_type: z.enum(["quote", "order", "delivery", "invoice"]),
  doc_no: zDocumentNo,                          // v1.2: regex インライン再定義を canonical スカラー導出に変更 (IssuedDocumentRecord と同じ参照書式)
  event: z.enum(["issued", "reissued", "accepted", "declined", "expired", "paid", "payment_recorded", "voided"]),
    // v1.7 (02-sales Δs5): 'payment_recorded' = 部分入金の記録 (ref=payments 行)。'paid' は
    // 「この入金で完済到達」に限定 — 部分入金を完済と誤認する集計・表示を契約レベルで排除
  total_jpy: z.number().int(),
  version: z.number().int().min(1).nullable(),
}).strict();

export const zWorkLogActivityPayload = z.object({
  work_block_id: z.string().uuid(),
  work_type_key: z.string().max(30),
  work_type_label: z.string().max(30),
  planned_hours: z.number().min(0).max(999),
  actual_hours: z.number().min(0).max(999),
  performed_on: zDateOnly,
}).strict();

export const zTaskEventActivityPayload = z.object({
  task_id: z.string().uuid(),
  event: z.enum(["created", "completed", "cancelled"]),
  origin: zTaskOrigin,
}).strict();

export const zSystemActivityPayload = z.object({
  code: z.string().max(50),                     // 'lead.intake' / 'customer.merged' 等
  detail: z.string().max(500).nullable(),
}).strict();

/** activity_type の全列挙 (DB check 制約と 1:1。追加は本書改訂が先) */
export const ACTIVITY_PAYLOAD_SCHEMAS = {
  note: zNoteActivityPayload,
  call: zCallActivityPayload,
  email: zEmailActivityPayload,                 // Phase 2 予約 (v1 挿入禁止)
  form_submission: zFormSubmissionActivityPayload,
  simulator_estimate: zSimulatorEstimateActivityPayload,
  document_event: zDocumentEventActivityPayload,
  work_log: zWorkLogActivityPayload,
  task_event: zTaskEventActivityPayload,
  system: zSystemActivityPayload,
} as const;
export type ActivityType = keyof typeof ACTIVITY_PAYLOAD_SCHEMAS;
export type ActivityPayload<T extends ActivityType> = z.infer<(typeof ACTIVITY_PAYLOAD_SCHEMAS)[T]>;

/** appendActivity 入力 (二段階 parse: 外側 unknown で受け、type 確定後に map で parse)。
 *  冪等キー = (activity_type, ref_table, ref_id)。同一 ref の再送は既存行を返す。
 *  実レコードを生まない状態遷移イベントは ref_table='<所有テーブル>/'+event の合成 ref を使う (§7.9 — v1.1 Δs2) */
export const zAppendActivityInput = z.object({
  activity_type: z.enum(
    Object.keys(ACTIVITY_PAYLOAD_SCHEMAS) as [ActivityType, ...ActivityType[]],
  ), // v1.2: 文字列 enum の二重列挙を map キー導出に変更 (activity_type 追加時の片更新ドリフト防止)
  occurred_at: zIsoDatetime,                    // 業務時刻 (通話開始/発行日時)
  title: zShortText(120),
  body: z.string().max(10_000).nullable(),
  payload: z.unknown(),                         // ACTIVITY_PAYLOAD_SCHEMAS[activity_type] で二段階 parse
  ref_table: z.string().max(100).nullable(),
  ref_id: z.string().uuid().nullable(),
  links: z.array(z.object({
    customer_id: z.string().uuid().nullable(),
    company_id: z.string().uuid().nullable(),
    deal_id: z.string().uuid().nullable(),
  }).strict().refine(
    l => [l.customer_id, l.company_id, l.deal_id].filter(v => v !== null).length === 1,
    "リンク 1 行につき対象は厳密に 1 つ",
  )).min(1).max(6),
}).strict();

/* ---------- リード取込 ---------- */

export const zLeadContact = z.object({
  name: zShortText(80),
  email: z.string().email().max(120).nullable(),
  tel: z.string().max(20).nullable(),           // 生入力。facade 内で E.164 正規化
}).strict().refine(c => c.email !== null || c.tel !== null, "email か電話が必要 (KMB-E607)");

export const zIntakeFromInquiryInput = z.object({
  inquiry_id: z.string().uuid(),
  contact: zLeadContact,
  inquiry_type: z.enum(["construction", "estimate", "material", "other"]),
  body_excerpt: z.string().max(300),
}).strict();

export const zIntakeFromSimulatorInput = z.object({
  inquiry_id: z.string().uuid(),
  contact: zLeadContact,
  estimate: zSimEstimateSnapshot,
}).strict();

/* ---------- 型 alias (v1.2 — §5 の facade シグネチャが参照する全型を z.infer で明示 export。
 *  これがないと契約適用後に facade が型チェックできず、実装者が独自 alias を補って契約がずれる) ---------- */

export type CustomerLifecycle = z.infer<typeof zCustomerLifecycle>;
export type LeadSource = z.infer<typeof zLeadSource>;
export type TaskStatus = z.infer<typeof zTaskStatus>;
export type TaskOrigin = z.infer<typeof zTaskOrigin>;
export type CustomerInput = z.infer<typeof zCustomerInput>;
export type CompanyInput = z.infer<typeof zCompanyInput>;
export type DealInput = z.infer<typeof zDealInput>;
export type TaskInput = z.infer<typeof zTaskInput>;
export type AppendActivityInput = z.infer<typeof zAppendActivityInput>;
export type DocumentEventActivityPayload = z.infer<typeof zDocumentEventActivityPayload>;
export type SimEstimateSnapshot = z.infer<typeof zSimEstimateSnapshot>;
export type LeadContact = z.infer<typeof zLeadContact>;
export type IntakeFromInquiryInput = z.infer<typeof zIntakeFromInquiryInput>;
export type IntakeFromSimulatorInput = z.infer<typeof zIntakeFromSimulatorInput>;

/** 跨モジュール read の最小射影 (v1.2 — §5 getCustomerRef/getDealRef の戻り値。
 *  読み取りビュー型のため Zod 化しない (既存 §4.9 規約)。詳細ビュー (CustomerDetail/DealDetail) は
 *  01-crm §6.2 の契約外拡張のまま自モジュール専用 — 他モジュールは本射影のみ参照する */
export type CustomerRef = {
  customer_id: string;   // merged_into 終端解決済みの現行 id (旧 id で呼んでも解決後を返す)
  name: string;
  kind: "person" | "company_contact";
  company_id: string | null;
  tel_e164: string | null;
  email: string | null;
  address: string | null; // v1.7 追加 — 02-sales の billing_address 複製の源 (customers.address)
};
export type DealRef = {
  deal_id: string;
  title: string;
  stage: DealStage;
  updated_at: string;    // 楽観排他用の生文字列 (02-sales 7.1-2 のステージ提案適用が使用)
  customer: { customer_id: string; name: string; kind: "person" | "company_contact"; address: string | null }; // address は v1.7 追加
  company: { company_id: string; name: string; address: string | null } | null; // 宛名複製: company 非 null → '御中' / null → '様'。address は v1.7 追加 (billing_address 複製 — 02-sales §6.1)
};
```

### 4.11 sales の値契約 (sales/contracts.ts)

```ts
import { z } from "zod";
import {
  zDateOnly, zJpyAmount, zJpySignedAmount, zShortText, zTaxCategory,
} from "@/modules/platform/contracts";

export const zDocType = z.enum(["quote", "order", "delivery", "invoice"]);
export type DocType = z.infer<typeof zDocType>;
/** 書類番号プレフィクス (document_number_next RPC — 00-overview §3.4 と 1:1。parity テスト対象) */
export const DOC_NO_PREFIX: Record<DocType, string> = {
  quote: "Q", order: "J", delivery: "D", invoice: "I",
};

/** 書類状態 (種別ごとの許可状態・遷移は 02-sales.md §状態意味論が正。repository 二重検証) */
export const zDocumentStatus = z.enum([
  "draft", "issued", "accepted", "declined", "expired", "paid", "voided",
]);

/** 派生許可表 (KMB-E623 のガード)。quote→invoice 直行は小口向け許可 */
export const DERIVATION_RULES: ReadonlyArray<{ from: DocType; to: DocType }> = [
  { from: "quote", to: "order" },
  { from: "quote", to: "invoice" },
  { from: "order", to: "delivery" },
  { from: "delivery", to: "invoice" },
];

/** 明細行。税額カラムは持たない (書類×税率ごと 1 回丸め — 裁定 J5。DDL レベルでも列を作らない) */
export const zDocumentLineInput = z.object({
  description: zShortText(200),
  quantity: z.number().positive().max(99_999)
    .refine(q => Math.abs(q * 100 - Math.round(q * 100)) < 1e-6, "小数第 2 位まで"),
  unit: zShortText(10),                          // 個 / 式 / ㎡ / m / 缶 …
  unit_price_jpy: z.number().int().min(-10_000_000).max(10_000_000), // 負 = 値引き行 (リピート免除等)
  amount_jpy: zJpySignedAmount,                  // 既定 = round(quantity×unit_price)。編集可
  tax_category: zTaxCategory,
  work_type_key: z.string().regex(/^[a-z0-9_]{2,30}$/).nullable(), // scheduling ブロック生成ヒント (FK なし)
  source: z.object({                             // pricing 由来スナップショット (任意)
    grade_key: z.string().max(30),
    size_key: z.string().max(10),
    option_keys: z.array(z.string().max(30)).max(10),
  }).strict().nullable(),
}).strict();

/** 税率別集計 (書類レベルスナップショット。documents.tax_summary jsonb に保存) */
export const zTaxSummaryLine = z.object({
  tax_category: zTaxCategory,
  taxable_jpy: z.number().int(),                 // 税抜対象額 (値引き反映後)
  tax_jpy: z.number().int(),                     // この税率での消費税額 (書類で 1 回丸め)
}).strict();
export const zTaxSummary = z.array(zTaxSummaryLine).max(4);

export const zCreateDocumentInput = z.object({
  doc_type: zDocType,
  deal_id: z.string().uuid(),
  issue_date: zDateOnly.nullable(),              // null = 発行時に JST 今日
  valid_until: zDateOnly.nullable(),             // quote のみ (null = invoice_issuer.quote_valid_days から算出)
  site_name: zShortText(80).nullable(),          // 現場名 (塗装業慣行 — ext-hubspot B-11)
  site_address: z.string().max(200).nullable(),
  lines: z.array(zDocumentLineInput).min(1).max(100), // 発行時 0 行は KMB-E620
  notes: z.string().max(2000).nullable(),
}).strict();

export const zPaymentInput = z.object({
  document_id: z.string().uuid(),                // doc_type='invoice' の issued のみ (E621/E623)
  paid_on: zDateOnly,
  amount_jpy: zJpyAmount.refine(v => v > 0, "入金額は 1 円以上"),
  method: z.enum(["bank_transfer", "cash", "other"]),
  memo: z.string().max(200).nullable(),
}).strict();

/* 型 alias (v1.2 — §5 参照分) */
export type DocumentStatus = z.infer<typeof zDocumentStatus>;
export type DocumentLineInput = z.infer<typeof zDocumentLineInput>;
export type TaxSummary = z.infer<typeof zTaxSummary>;
export type CreateDocumentInput = z.infer<typeof zCreateDocumentInput>;
export type PaymentInput = z.infer<typeof zPaymentInput>;

/** 税計算純関数の契約 (sales/tax.ts — モジュール直下。v1.7 訂正: admin UI のリアルタイム税プレビューが
 *  クライアント import するため internal/ 配下には置けない (ESLint MODULES 境界 — 02-sales §1.3)。
 *  単体テスト必須、裁定 J5/§4.1):
 *  computeDocumentTotals(lines, rounding) は
 *  { subtotal_jpy, tax_summary: zTaxSummary, total_jpy } を返す。
 *  丸めは税率区分ごとに 1 回のみ。exempt/zero は tax_jpy=0 で集計行を残す */
export type DocumentTotals = {
  subtotal_jpy: number;
  tax_summary: z.infer<typeof zTaxSummary>;
  total_jpy: number;
};

/** 電帳法台帳 (issued_documents) の 1 行。append-only (UPDATE/DELETE なし)。
 *  訂正は新版の行が supersedes で旧版を参照する (旧行は書き換えない — 00-overview §4.4) */
export type IssuedDocumentRecord = {
  id: string;
  document_id: string;
  doc_no: string;              // zDocumentNo
  version: number;             // 1 始まり
  sha256: string;              // PDF の SHA-256 (hex)
  transaction_date: string;    // 取引年月日 (検索 3 項目)
  counterparty: string;        // 取引先 (検索 3 項目)
  total_jpy: number;           // 金額 (検索 3 項目)
  storage_path: string;        // documents/{document_id}/v{n}-{sha256 先頭8}.pdf
  supersedes: string | null;   // 置き換える旧版の issued_documents.id
  issued_at: string;
};
```

### 4.12 scheduling の値契約 (scheduling/contracts.ts)

```ts
import { z } from "zod";
import { zDateOnly, zIsoDatetime, zShortText } from "@/modules/platform/contracts";

export const zWorkTypeInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/),    // 'sanding' / 'primer' / 'painting' / 'drying' / 'inspection'
  label: zShortText(30),
  color: z.string().regex(/^#[0-9a-f]{6}$/),     // カレンダー表示色
  consumes_capacity: z.boolean(),                // false = 非拘束 (乾燥待ち — 裁定 J8)
  default_hours: z.number().min(0).max(999).nullable(),
  sort_order: z.number().int().min(0).max(9999),
  is_active: z.boolean(),
}).strict();

/** 標準工数テンプレート (grade×size → ブロックセット。見積明細からの原案生成に使用) */
export const zWorkTemplateInput = z.object({
  name: zShortText(50),
  grade_key: z.string().min(1).max(30).nullable(),  // pricing の key を文字列で参照 (FK なし)。
  size_key: z.string().min(1).max(10).nullable(),   // 空文字不可 (v1.4) — NULL ワイルドカードと '' の衝突防止:
                                                    // 部分一意 index (coalesce(key,'')) は NULL と '' を同一視する
                                                    // 一方、テンプレ解決カスケード (03 §7.1) では別値になるため
  is_active: z.boolean(),
  items: z.array(z.object({
    work_type_key: z.string().regex(/^[a-z0-9_]{2,30}$/),
    hours: z.number().min(0).max(999),
    sort_order: z.number().int().min(0).max(9999),
  }).strict()).min(1).max(30),
}).strict();

export const zWorkBlockStatus = z.enum(["backlog", "scheduled", "in_progress", "done", "cancelled"]);

export const zWorkBlockInput = z.object({
  deal_id: z.string().uuid().nullable(),
  work_type_id: z.string().uuid(),
  title: zShortText(80).nullable(),              // null = 種別ラベルから生成
  starts_at: zIsoDatetime.nullable(),            // null = 未配置 (backlog)
  ends_at: zIsoDatetime.nullable(),
  planned_hours: z.number().min(0).max(999),
  memo: z.string().max(1000).nullable(),
}).strict().refine(
  (v) => (v.starts_at === null) === (v.ends_at === null),
  "開始と終了は同時に指定するか、どちらも空にしてください (KMB-E701)",
).refine(
  (v) => v.starts_at === null || v.ends_at === null
    || new Date(v.starts_at).getTime() < new Date(v.ends_at).getTime(),
  "開始は終了より前である必要があります (KMB-E701)",
);
  // v1.2: ペア制約 + 順序の refine を追加 — zPlaceBlockInput (03-scheduling §3.2) と同型の
  // 「DB check + Zod refine の二重検証」(03 §5 一般原則) を createBlock 入力にも適用
  // (欠落時は矛盾入力が DB 制約違反として未翻訳のまま露出する)

/** 受注明細→ブロック原案生成 (app 層合成 — §7.7)。lines は SalesFacade から受け取る */
export const zGenerateBlocksInput = z.object({
  deal_id: z.string().uuid(),
  source_document_id: z.string().uuid(),
  lines: z.array(z.object({
    description: zShortText(200),
    work_type_key: z.string().max(30).nullable(),
    quantity: z.number().positive().max(99_999),
    grade_key: z.string().min(1).max(30).nullable(),  // 空文字不可 (v1.4 — zWorkTemplateInput と同一規則)
    size_key: z.string().min(1).max(10).nullable(),
  }).strict()).min(1).max(100),
}).strict();

export const zActualInput = z.object({
  actual_hours: z.number().min(0).max(999),
  performed_on: zDateOnly,
}).strict();

/* ---------- 外部カレンダー同期 (裁定 J4) ---------- */

export const zCalendarProvider = z.enum(["google", "microsoft"]);
export const zCalendarConnectionStatus = z.enum(["disconnected", "connected", "expired", "error"]);
export const zEventLinkSyncStatus = z.enum([
  "synced", "pending_push", "conflict", "orphaned", "deleted_externally",
]);

/** calendar_connections.meta (トークン実体は Vault のみ — calendar_google_oauth /
 *  calendar_microsoft_oauth。MSA の refresh token ローテーションは毎回上書き保存) */
export const zCalendarConnectionMeta = z.object({
  account_email: z.string().email().max(120),
  app_calendar_id: z.string().max(200).nullable(), // アプリ専用カレンダー (作成後に設定)
  token_expires_at: zIsoDatetime.nullable(),       // 非秘匿コピー (UI 表示用)
  sync_window_start: zDateOnly.nullable(),         // Graph ローリングウィンドウ
  sync_window_end: zDateOnly.nullable(),
}).strict();

export type CalendarSyncReport = {
  provider: z.infer<typeof zCalendarProvider>;
  pulled: number;      // 取り込んだ外部変更数 (エコー棄却後)
  echoes_rejected: number;
  pushed: number;      // 外部へ書き込んだブロック数
  conflicts: number;   // KMB-E721 相当 (再 pull 待ち)
  full_resync: boolean; // 410 (KMB-E722) でフル再同期を実施したか
};

export type WeeklyCapacity = {
  week_start: string;          // 月曜 (JST, zDateOnly)
  weekly_hours: number;        // settings 'work_capacity'
  booked_hours: number;        // 配置済み拘束ブロック合計 (consumes_capacity=true のみ)
  remaining_hours: number;     // = weekly_hours - booked_hours (負値あり得る)
};

/* 型 alias (v1.2 — §5 参照分) */
export type WorkTypeInput = z.infer<typeof zWorkTypeInput>;
export type WorkTemplateInput = z.infer<typeof zWorkTemplateInput>;
export type WorkBlockStatus = z.infer<typeof zWorkBlockStatus>;
export type WorkBlockInput = z.infer<typeof zWorkBlockInput>;
export type GenerateBlocksInput = z.infer<typeof zGenerateBlocksInput>;
export type ActualInput = z.infer<typeof zActualInput>;
export type CalendarProvider = z.infer<typeof zCalendarProvider>;
export type CalendarConnectionStatus = z.infer<typeof zCalendarConnectionStatus>;
export type EventLinkSyncStatus = z.infer<typeof zEventLinkSyncStatus>;
export type CalendarConnectionMeta = z.infer<typeof zCalendarConnectionMeta>;
```

### 4.13 telephony の値契約 (telephony/contracts.ts)

```ts
import { z } from "zod";
import { zShortText } from "@/modules/platform/contracts";

export const zCallDirection = z.enum(["inbound", "outbound"]); // outbound は Phase 2 予約
export const zCallHandling = z.enum(["forwarded", "voicemail", "after_hours_voicemail", "missed"]);
export const zCallJobStatus = z.enum([
  "pending", "downloading", "transcribing", "analyzing", "linking", "done", "failed",
]);

/** Twilio Voice webhook の受信契約 (application/x-www-form-urlencoded を parse した後の最小部分集合。
 *  署名検証 validateRequest は「全パラメータ変形なし」が必須のため route が生 params を保持し、
 *  本スキーマは検証後の業務利用分のみ)。
 *  route 共通則 (v1.6 — 04-telephony §6.1-5): 実 Twilio POST は AccountSid/ApiVersion/Direction/
 *  RecordingSource 等 10+ の未契約パラメータを含むため、署名検証後に**契約キーのみ pick + 欠落キーは
 *  null 補完**してから parse する (.strict() は pick 後の集合に対して有効。生 Record を直 parse すると
 *  unrecognized_keys で全 webhook が KMB-E803 になる)。zCallStatusWebhook / zDialResultWebhook
 *  (telephony 所有 — 04 §3.2) の欠落し得る数値フィールドは preprocess で undefined→null を吸収する */
export const zInboundCallWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  From: z.string().max(30).nullable(),           // 非通知は Twilio が 'anonymous' 等の文字列を送る —
                                                 // null になるのは route の欠落キー補完時のみ。
                                                 // 非通知判定・E.164 正規化は facade 内 (from_e164=null 化)
  To: z.string().max(30),
  CallStatus: z.string().max(30),
}).strict();

export const zRecordingWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  RecordingSid: z.string().min(10).max(64),
  RecordingUrl: z.string().url(),
  RecordingDuration: z.coerce.number().int().min(0),
  RecordingChannels: z.coerce.number().int().min(1).max(2),
}).strict();

/** 転写結果 (call_jobs.transcript jsonb)。デュアルチャネルは channel 0=相手 / 1=こちら */
export const zCallTranscript = z.object({
  segments: z.array(z.object({
    channel: z.number().int().min(0).max(1),
    index: z.number().int().min(0),
    text: z.string().max(50_000),
  }).strict()).max(200),
  full_text: z.string().max(200_000),
}).strict();

/** AI 議事録 (generateText + responseSchema の structured output。
 *  JSON Schema は z.toJSONSchema() で本スキーマから生成 — 手書き禁止) */
export const zCallMinutes = z.object({
  summary: z.string().min(1).max(2000),
  caller_intent: z.enum(["estimate_request", "order", "inquiry", "schedule", "complaint", "sales_call", "other"]),
  key_points: z.array(z.string().max(300)).max(20),
  customer_name_guess: z.string().max(60).nullable(),
  callback_required: z.boolean(),
  callback_note: z.string().max(300).nullable(),
}).strict();

export const zExtractedCallTask = z.object({
  title: zShortText(120),
  detail: z.string().max(1000).nullable(),
  due_hint: z.string().max(100).nullable(),      // 「明日中に折り返し」等。日付確定は admin
}).strict();

/** analyzing ステージの出力契約 (KMB-E821 の検証対象) */
export const zCallAnalysis = z.object({
  minutes: zCallMinutes,
  tasks: z.array(zExtractedCallTask).max(10),
}).strict();

export type CallListItem = {
  id: string;
  direction: z.infer<typeof zCallDirection>;
  from_e164: string | null;    // zTelE164 準拠 (非通知は null)
  customer_id: string | null;
  customer_name: string | null; // 解決は CrmFacade.getCustomerRef (merged 終端解決込み — §5。calls.customer_id の直 join 禁止)
  handling: z.infer<typeof zCallHandling> | null;
  duration_seconds: number | null;
  job_status: z.infer<typeof zCallJobStatus> | null;
  started_at: string;
};

/* 型 alias (v1.2 — §5 参照分) */
export type CallDirection = z.infer<typeof zCallDirection>;
export type CallHandling = z.infer<typeof zCallHandling>;
export type CallJobStatus = z.infer<typeof zCallJobStatus>;
export type InboundCallWebhook = z.infer<typeof zInboundCallWebhook>;
export type RecordingWebhook = z.infer<typeof zRecordingWebhook>;
export type CallTranscript = z.infer<typeof zCallTranscript>;
export type CallMinutes = z.infer<typeof zCallMinutes>;
export type ExtractedCallTask = z.infer<typeof zExtractedCallTask>;
export type CallAnalysis = z.infer<typeof zCallAnalysis>;
```

---

## 5. facade インターフェース (主要シグネチャ)

戻り値はすべて `Result<T>` (§4.1)。例外をモジュール境界から漏らさない。

**拡張規約 (2026-07-08 追記、v2.8 改訂)**: 本節のシグネチャは「モジュール間契約として不変の主要メソッド」。各 facade は、自モジュールの admin UI **または app 層 route** が必要とする **CRUD 拡張メソッドを追加してよい** (ESLint 境界により admin 画面から repository を直接呼べないため)。app 層 route から service 文脈で呼ぶ拡張メソッドは `ctx?: ExecutionContext` を取ってよい (§3 の 1 の形 — markExpiredQuotes / getSalesDigest が実例)。拡張は facade.ts 内に「契約外拡張」コメントで明示し、**他モジュールから拡張メソッドを呼ぶことは禁止** (呼ぶ必要が生じたら本節へ昇格させる — getCustomerRef/getDealRef の昇格が適用例)。Wave 1 で settings/inquiry/media/content/pricing に追加済み。

v2.8: `ctx?: ExecutionContext` を取るメソッドのみ service 文脈から呼べる (それ以外は admin セッション必須のまま — §3 の 3 形式)。

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
  // JSON 決定的シリアライズ (untrusted policy)。対象スロットを <<<編集対象>>> でマーク。
  // 戻り値 SiteContextResult.contextJson は既に決定的 JSON.stringify 済み。
  buildSiteContextMd(targetSlotKey: string): Promise<Result<SiteContextResult>>;
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
  // v2.9: 第 4 引数 styleProfiles を追加 (Issue #20)。ai-studio → distribution の import は依存方向 §2 で
  // 禁止のため、DistributionFacade.getStyleProfiles() (4 チャネル全件) を app 層 (POST /api/ai/runs) が取得し
  // startRun に渡す合成パターン。startRun 時点で ai_runs.style_profiles (jsonb、migration 20260714000036) に
  // 確定保存し、drafting ステージ再試行・regenerateDraft は run の生存期間中この値を使い続ける。
  // StyleProfilesByChannel は distribution の StyleProfile と構造的同型を ai-studio 側に独立定義 (§4.3、逆流回避)
  startRun(sourceId: string, channels: Channel[], research: boolean,
    styleProfiles: StyleProfilesByChannel): Promise<Result<{ run_id: string }>>;
  advanceRun(runId: string): Promise<Result<{ status: RunStatus }>>; // 1 呼び出し = 1 stage (lease 取得込み、§7.1)
  editDraft(draftId: string, content: unknown): Promise<Result<{ revision: number }>>; // human revision を積む
  approveDraft(draftId: string): Promise<Result<void>>;
  rejectDraft(draftId: string): Promise<Result<void>>;
  getApprovedDraft(draftId: string): Promise<Result<ApprovedDraft>>; // distribution 専用。approved 以外は拒否
}

// distribution/facade.ts
export interface DistributionFacade {
  getStyleProfiles(): Promise<Result<Record<Channel, StyleProfile>>>;
  // ai-studio の draft 生成は本メソッドの結果を **app 層 (route handler、POST /api/ai/runs) が取得して
  // AiStudioFacade.startRun に引数で渡す** 合成パターンで使う (ai-studio → distribution の
  // 依存を作らないため)。v2.9: Wave2-E の暫定ハードコード (旧 ai-studio/internal/prompts.ts の
  // DEFAULT_STYLE_PROFILES) は Issue #20 で解消済み — startRun の styleProfiles 引数へ配線し
  // ai_runs.style_profiles (jsonb) に確定保存する (未接続チャネルも既定文体で 4 チャネル全件を返す)
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
  // v2.8: get に第 2 引数 ctx を追加 (省略時は現行挙動と完全一致)。
  // anon 可読キーの許可リスト化 (§4.2 注記) 後、非公開キー (telephony/invoice_issuer/work_capacity 等) の
  // service 文脈 read (voice webhook の business_hours/telephony、digest の notifications) はこの ctx で行う。
  // update は session 専用のまま変更なし
  get<K extends SettingsKey>(key: K, ctx?: ExecutionContext): Promise<Result<SettingsValue<K>>>;
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
  // v2.8: 下 3 メソッドに第 2 引数 ctx を追加 (省略時は現行挙動と完全一致 — 裁定 J2)。
  // 他メソッド (listKeys / saveKey / ... / getUsageSummary) は session 専用のまま変更なし
  generateText(req: GenerateTextReq, ctx?: ExecutionContext): Promise<Result<TextResult>>;       // 予算予約 (E407) + usage 記録込み
  generateImages(req: GenerateImageReq, ctx?: ExecutionContext): Promise<Result<ImageResult>>;   // 同上。n=1..4
  transcribe(req: TranscribeReq, ctx?: ExecutionContext): Promise<Result<TranscribeResult>>;     // 既存 gpt-4o-transcribe 経路の移行先
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

  // ---- 契約外拡張 (admin — 拡張規約。/admin/prices の行列インライン編集に必須。v2.9 で §5 に明示) ----
  // 上記 2 メソッドはモジュール間契約として不変。以下は自モジュールの admin Server Action からのみ呼ぶ
  // (ESLint 境界で admin 画面から repository を直接呼べないため facade 経由。他モジュールからの呼び出しは禁止)。
  // 実装は createPricingFacade() ファクトリ経由 (getActivePriceTable で読んだ PriceTable を facade
  // インスタンスに閉じ込め estimate() が使う設計 — pricing/facade.ts の乖離注記を格上げ)。
  getFullPriceTable(): Promise<Result<PriceTable>>;                        // is_active に関わらず全件 (キャッシュ非経由)
  savePriceGrade(input: PriceGradeInput, id: string | null,
    expectedUpdatedAt: string | null): Promise<Result<{ id: string }>>;   // 楽観排他 E103
  savePriceOption(input: PriceOptionInput, id: string | null): Promise<Result<{ id: string }>>;
  replacePriceSizeClasses(input: PriceSizeClassInput[]): Promise<Result<void>>;
  replacePriceMatrix(input: PriceMatrixCellInput[]): Promise<Result<void>>;
  replacePriceQuantityTiers(input: QuantityTierInput[]): Promise<Result<void>>;
}

// ---------- v2.8 追加 facade (CRM スイート) ----------

// crm/facade.ts (01-crm.md が親設計。00-overview §3.2 が M0 契約)
export interface CrmFacade {
  // 取込 (app 層合成の入口 — §7.8)。anon route から呼ばれるため**常に service 実行**
  // (v1.1 裁定: 内部で service client を生成 — 01-crm §6.5。ctx 引数は取らない。
  //  SUPABASE_SERVICE_ROLE_KEY 未設定時は E901 で degrade し、問い合わせ保存のみ成立)
  intakeFromInquiry(input: IntakeFromInquiryInput): Promise<Result<{ customer_id: string; deal_id: string }>>;
  intakeFromSimulator(input: IntakeFromSimulatorInput): Promise<Result<{ customer_id: string; deal_id: string }>>;
  // 顧客
  createCustomer(input: CustomerInput, opts?: { force?: boolean }, ctx?: ExecutionContext):
    Promise<Result<{ customer_id: string }>>;
    // 重複候補あり + force なし → KMB-E601 (detail に候補 id 列挙)。
    // ctx は v1.1 追加 — telephony worker の linking が lead 顧客を作成する経路 (04-telephony §6.5.4)
  matchCustomerByPhone(telE164: string, ctx?: ExecutionContext): Promise<Result<{ customer_id: string } | null>>;
    // 0 件: ok(null) / 1 件: ok({customer_id}) (merged_into は終端まで解決)。
    // 複数一致は null 扱いにせず **KMB-E601 + detail に候補 id 列挙** を返す — telephony が KMB-E823 に
    // ドメイン変換して手動確認へ (01-crm P7/§6.1)。E823 は telephony 所有帯 (§1) であり crm は発しない
    // (v1.2 是正: 旧記述「KMB-E823 相当を…返す」は帯所有違反かつ 01-crm と矛盾 — 04-telephony §6.5.4-2 の
    //  分岐表記も「E601 受領 → E823 に変換して outcome='ambiguous'」に統一すること)
  // 跨モジュール read (v1.2 昇格 — §2 の「顧客/案件参照」の実現手段。戻り値は §4.10 の最小射影型。
  // 01-crm §6.2 の契約外拡張 getCustomer/getDeal (詳細ビュー) は他モジュール呼出禁止のまま別物)
  getCustomerRef(customerId: string, ctx?: ExecutionContext): Promise<Result<CustomerRef>>;
    // merged_into 終端解決込み (01-crm R4 — telephony 表示系の顧客名解決はここを通る)。不在 KMB-E603
  getDealRef(dealId: string, ctx?: ExecutionContext): Promise<Result<DealRef>>;
    // sales の宛名複製 (createDraftDocument — 02-sales §6.1。Δs4 の getDealBillingParties は本メソッドに統合) と
    // ステージ提案適用 (02-sales 7.1-2 が updated_at を使用) の入力。不在 KMB-E603
  getDealRefs(dealIds: string[], ctx?: ExecutionContext): Promise<Result<DealRef[]>>;
    // batch 版 (v1.7 — 02-sales Δs4 完結)。listDocuments (keyset 50 件/頁) の deal_title 解決を
    // 1 呼び出しで行い N+1 を回避 (02-sales §5.2)。不在 id は結果から除外 (エラーにしない —
    // 呼び出し側が id で突き合わせる)。空配列入力は ok([])
  // 案件
  createDeal(input: DealInput): Promise<Result<{ deal_id: string }>>;
  updateDealStage(dealId: string, to: DealStage, expectedUpdatedAt: string): Promise<Result<void>>;
    // 楽観排他は updated_at 生文字列 (既存規約)。不正遷移 KMB-E602
  // タイムライン・ハブ (他モジュールが activities に書く唯一の経路 — §7.9)
  appendActivity(input: AppendActivityInput, ctx?: ExecutionContext):
    Promise<Result<{ activity_id: string; created: boolean }>>;
    // 冪等: (activity_type, ref_table, ref_id) 一致は既存行 + created:false。
    // created:false でも links は冪等 INSERT で必ず補完する (activity 挿入後・links 挿入前の
    // クラッシュを再送で自己修復 — at-least-once。01-crm v1.1 §6.6)。
    // payload は ACTIVITY_PAYLOAD_SCHEMAS[type] で二段階 parse (不一致 KMB-E604)。
    // 'email' は v1 挿入禁止 (KMB-E604)
  relinkActivity(activityId: string, links: Array<{ customer_id: string | null;
    company_id: string | null; deal_id: string | null }>, ctx?: ExecutionContext): Promise<Result<void>>;
    // activity_links の**全置換** (activity 本体は不変。links=[] で全解除)。v1.6 追加 —
    // 用途は telephony の通話「付け替え/解除」のみ (04-telephony §7.2 linkCallToCustomer):
    // appendActivity の冪等ヒット (created:false) は links を「補完」するだけで旧リンクを外せず、
    // 誤マッチ修正後も通話が旧顧客のタイムラインに残り続けるため、その除去経路を契約化する。
    // 内部は crm repository の service 実行 (admin RLS の activity_links DELETE 制限「note のみ」は
    // 直接操作の制約 — 本メソッドは facade 経由の監査つき置換で、監査は 'system' activity
    // (code:'activity.relinked') の追記で補完。実装意味論は 01-crm 所掌 — 要反映)。
    // 各 link は 1 行 1 対象 (num_nonnulls=1 — §7.9)。不在 activity/顧客は KMB-E603
  // タスク
  createTask(input: TaskInput, ctx?: ExecutionContext): Promise<Result<{ task_id: string }>>;
    // 冪等 (v1.1): source_activity_id 非 NULL 時は (source_activity_id, title) の一意 index (01-crm 0023。
    // 非部分一意 — 01-crm v1.1 是正: PostgREST の on_conflict は部分一意 index の述語を表現できない。
    // NULLS DISTINCT により手動作成 (source_activity_id NULL) は同題でも衝突しない) —
    // 再送 (worker リトライ) は既存 task_id を返す。source_activity_id NULL (手動作成) は常に新規。
    // 前提条件: title は冪等キーの一部 — 非決定生成 (LLM 等) の title は先に永続化し、
    // リトライ間で同一に保つこと (01-crm v1.1 §6.1。04-telephony は analysis 確定後に呼ぶ確立手順)
  completeTask(taskId: string, expectedUpdatedAt: string): Promise<Result<void>>;
}

// sales/facade.ts (02-sales.md が親設計)
export interface SalesFacade {
  createDraftDocument(input: CreateDocumentInput): Promise<Result<{ document_id: string }>>;
  createDraftQuoteFromEstimate(input: { deal_id: string; estimate: SimEstimateSnapshot }):
    Promise<Result<{ document_id: string }>>;
    // breakdown → 明細スナップショット変換 (仮単価 = 数量値引き・オプション適用後 total_max の税抜換算 —
    // 意味論は 06-simulator §5.4 T1、具体式・文言は 02-sales §9.1 が正。備考にレンジ明記。
    // v1.7 訂正: 旧「セル price_max」は snapshot にセル生値が無く実現不能な略記だった)。
    // anon route (/api/shop/lead) から呼ばれるため service 実行 (v1.1 裁定: createSalesFacade(client) の
    // service client 注入 — 02-sales §6.1 注記。ctx 引数は取らない)
  deriveDocument(input: { source_document_id: string; to_type: DocType }):
    Promise<Result<{ document_id: string }>>;
    // DERIVATION_RULES 外は KMB-E623。明細は複製スナップショット (裁定 J5)
  issueDocument(documentId: string, expectedUpdatedAt: string):
    Promise<Result<{ doc_no: string; version: number; pdf_storage_path: string; event: DocumentEventActivityPayload }>>;
    // 採番 (document_number_next) → /print/documents/[id] を PDF 化 → issued-documents 保存
    // (upsert:false) → issued_documents 台帳 append → activity 'document_event' 追記。
    // 戻り値 event で app 層が CrmFacade.updateDealStage を呼ぶ (ステージ直接更新禁止 — §7.6)
  reissueDocument(documentId: string, expectedUpdatedAt: string):
    Promise<Result<{ version: number; pdf_storage_path: string }>>;  // 訂正 = 新版 (旧版は不変)
  recordPayment(input: PaymentInput):
    Promise<Result<{ payment_id: string; invoice_paid: boolean; event: DocumentEventActivityPayload }>>;
    // 残高超過 KMB-E625。invoice_paid=true で app 層が stage 'paid' を提案
  getDocumentLinesForBlocks(documentId: string): Promise<Result<Array<{
    description: string; work_type_key: string | null; quantity: number;
    grade_key: string | null; size_key: string | null;
  }>>>;
    // scheduling へ渡す用 (app 層合成 — §7.7)。scheduling からの直接呼び出しは禁止
  createSignedPdfUrl(documentId: string, version: number):
    Promise<Result<{ url: string; expires_at: string }>>;
}

// scheduling/facade.ts (03-scheduling.md が親設計)
export interface SchedulingFacade {
  generateBlocksFromLines(input: GenerateBlocksInput):
    Promise<Result<{ block_ids: string[]; skipped: Array<{ description: string; reason: string }> }>>;
    // テンプレート解決 (grade×size → work_template、行の work_type_key 優先)。全滅 KMB-E704
  placeBlock(blockId: string, startsAt: string, endsAt: string, expectedUpdatedAt: string):
    Promise<Result<void>>;   // 配置/移動。sync_status='pending_push' を立てる
  recordActual(blockId: string, input: ActualInput, expectedUpdatedAt: string):
    Promise<Result<void>>;   // 実績確定 + CrmFacade.appendActivity('work_log') (scheduling→crm 依存)
  getWeeklyCapacity(weekStart: string): Promise<Result<WeeklyCapacity>>;
    // 「今週あと N 時間受けられる」— 管理画面とダッシュボードに表示 (裁定 J8)
  runCalendarSync(ctx: ExecutionContext): Promise<Result<CalendarSyncReport[]>>;
    // /api/jobs/calendar-sync 専用 (service)。pull (syncToken/deltaLink) + push (pending_push)
    // + 自己エコー棄却 (etag/changeKey/last_written_hash)。410 → フル再同期 (KMB-E722)
  runCalendarMaintenance(ctx: ExecutionContext): Promise<Result<void>>;
    // 日次: トークン健全性 / Graph ローリングウィンドウ切り直し / 整合性検査
}

// telephony/facade.ts (04-telephony.md が親設計)
export interface TelephonyFacade {
  handleInboundCall(input: InboundCallWebhook, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
    // 15 秒制約 — 同期処理は calls UPSERT (call_sid 冪等) + settings 'business_hours' JST 分岐のみ。
    // 署名検証 (X-Twilio-Signature) は route 側の責務 (失敗 403 KMB-E801)
  handleCallStatus(input: { CallSid: string; CallStatus: string; CallDuration: number | null },
    ctx: ExecutionContext): Promise<Result<void>>;
  registerRecording(input: RecordingWebhook, ctx: ExecutionContext):
    Promise<Result<{ call_job_id: string }>>;   // call_recordings + call_jobs(pending) 作成 (冪等)
  advanceCallJob(callJobId: string, ctx: ExecutionContext):
    Promise<Result<{ status: CallJobStatus }>>;
    // 1 呼び出し = 1 ステージ (lease CAS RPC、00-overview §3.1.4 の複製規約)。
    // AI は aiProvidersFacade.transcribe/generateText を ctx {mode:'service'} で呼ぶ。
    // linking ステージで CrmFacade.matchCustomerByPhone / createTask / appendActivity('call')
  retryCallJob(callJobId: string): Promise<Result<void>>;  // failed → pending (admin 操作)
  createRecordingPlaybackUrl(recordingId: string): Promise<Result<{ url: string; expires_at: string }>>;
}
```

**型 import 規約 (v2.8 注記)**: 跨モジュールの facade シグネチャで使う型 (`SimEstimateSnapshot` / `DocumentEventActivityPayload` 等) は、依存方向 §2 に沿う向きであれば所有モジュールの contracts.ts から import してよい (ESLint が制限するのは internal/** と repository のみ)。依存方向に反する参照は構造的同型を独立定義する (既存定石 — zSimEstimateSnapshot が実例)。

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
| lead.intake (フォーム/シミュレーター) | /api/shop/lead・contact route (app 層) | InquiryFacade.submit → CrmFacade.intakeFrom* → (simulator のみ) SalesFacade.createDraftQuoteFromEstimate | 同期 (route 内。取込失敗は問い合わせ保存を巻き戻さない) |
| telephony.call.inbound | Twilio → /api/telephony/voice | calls UPSERT + TwiML 応答 (営業時間分岐/留守電) | HTTP (X-Twilio-Signature) |
| telephony.recording.ready | Twilio → /api/telephony/recording-status | call_recordings + call_jobs(pending) 作成 | HTTP (X-Twilio-Signature) |
| telephony.job.due | pg_cron (毎分) → /api/jobs/telephony | worker が lease CAS でステージ前進 (DL→転写→解析→CRM 連携) | HTTP (shared secret) + DB |
| calendar.sync.due | pg_cron (5 分) → /api/jobs/calendar-sync | 増分 pull + pending_push 送出 + エコー棄却 | HTTP (shared secret) + DB |
| calendar.maintenance.due | pg_cron (日次) → /api/jobs/calendar-maintenance | トークン健全性/ウィンドウ切り直し | HTTP (shared secret) |
| document.issued / payment.recorded | SalesFacade (issue/recordPayment) | activity 'document_event' 追記 + 戻り値 event で app 層が deal ステージ提案 | 同期 |
| block.actual_recorded | SchedulingFacade.recordActual | activity 'work_log' 追記 + 案件粗利再計算 | 同期 |
| crm.digest.due | pg_cron (日次) → /api/jobs/crm-digest | 期日超過タスク/有効期限接近見積/未消込請求の集計 + Resend 通知 (ベストエフォート E902)。sales 分は route の app 層合成で `salesFacade.markExpiredQuotes({mode:'service'})` → `getSalesDigest({mode:'service'})` (契約外拡張 — 呼び出し元は app 層 route で拡張規約適合)。**配線所掌 (v1.1 Δs3、v1.2 で実現方法を確定)**: crm フェーズの route 骨格は sales facade を一切 import/参照せず `CrmDigest.sales` を null 固定 (01-crm §7.2 の graceful degrade 型どおり — 旧「facade 存在チェックで skip」は M0 骨格 facade に拡張メソッドの型が存在せずビルドが壊れるため廃止。動的判定はしない)。sales フェーズ (#3s-4) が import + 上記 2 呼び出しを追加して配線を有効化する | HTTP (shared secret) |

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

### 7.5 着信 → 転写 → 議事録 → タイムライン → タスク (裁定 J2/J3)

```
着信 → POST /api/telephony/voice (署名検証 → 失敗 403 KMB-E801)
  → TelephonyFacade.handleInboundCall (service ctx): calls UPSERT (call_sid 冪等)
  → business_hours (JST) 分岐: 営業内 = 同意ガイダンス+<Dial record-from-answer-dual> /
    時間外 = 留守電 <Record>。TwiML を 15 秒以内に返す (重い処理禁止)
→ POST /api/telephony/recording-status → registerRecording (recording_sid 冪等) → call_jobs(pending)
→ pg_cron 毎分 → /api/jobs/telephony (x-jobs-secret, 202+after) → advanceCallJob (最大 2 件/起床):
  downloading → transcribing (25MB/15分 超はセグメント分割 → transcribe×N, {mode:'service'})
  → analyzing (generateText + responseSchema zCallAnalysis。refusal・max_tokens 打ち切り・parse 失敗
     → いずれも KMB-E821 — v1.8 是正: 旧「refusal→E403」は 04-telephony v1.1 §9 の E821 一本化と不一致)
  → linking (matchCustomerByPhone → 一致: 紐づけ / なし: lead 顧客作成 /
             複数: E601 受領 → KMB-E823 に変換して手動確認へ
             → appendActivity('call', ref=calls.id) (created:false でも links 補完 — §5)
             → createTask(origin='ai_call', source_activity_id=activity_id)×N を**常に実行**
               (created フラグでスキップしない — 冪等は §5 の (source_activity_id, title) 一意が担う。
               v1.6 是正 (04-telephony v1.1 と対): 旧「created:true のときのみ」は appendActivity
               成功後・createTask 完走前のクラッシュで残りタスクが恒久喪失する at-most-once 化。
               activity 先行の順序 (v1.2 是正 — source_activity_id の取得に必須) は不変。
               ambiguous/no_number はタスクのみ source_activity_id null で起票 (NULLS DISTINCT で
               冪等対象外 = commit 前クラッシュ再入の重複は残余リスク) — 04 §6.5.4-4)
  → done。各ステージ lease CAS (TTL 90s/heartbeat 20s/attempts≦3→failed KMB-E806、
  commit 成功時のみ attempts=0 リセット、RPC は #variable_conflict use_column 必須)
[異常] 予算超過 KMB-E407 → failed (admin が retryCallJob で翌月再実行可)
```

### 7.6 見積 → 受注 → 納品 → 請求 → 入金 (裁定 J5)

```
quote(draft) → issueDocument: 採番 Q-YYYY-#### → /print PDF → issued-documents (upsert:false)
  → issued_documents append (doc_no/version/sha256/取引年月日/取引先/金額)
  → activity 'document_event' → 戻り値 event → app 層: updateDealStage('quote_sent')
→ 承諾 → deriveDocument(quote→order): 明細複製スナップショット → issue (J-) → stage 'ordered'
→ deriveDocument(order→delivery) → issue (D-) → stage 'delivered'
→ deriveDocument(delivery→invoice) → issue (I-) → stage 'invoiced'
→ recordPayment×N → Σ入金 = total で invoice_paid=true → stage 'paid'。超過 KMB-E625
[規則] 派生は DERIVATION_RULES のみ (E623)。issued 後の明細変更は trigger 拒否 (E624)。
  税は書類×税率 1 回丸め (tax_rounding 設定)。訂正 = reissueDocument (新版 append、旧版不変)
```

### 7.7 受注確定 → 作業ブロック生成 (app 層合成 — sales ⇄ scheduling 相互依存禁止)

```
Server Action: SalesFacade.getDocumentLinesForBlocks(受注id)
  → SchedulingFacade.generateBlocksFromLines({deal_id, source_document_id, lines})
  → テンプレート解決 (行の work_type_key 優先 / grade×size → work_template フォールバック)
  → work_blocks (status='backlog', consumes_capacity は work_type から複製スナップショット)
  → 解決不能行は skipped で返却 (全滅時のみ KMB-E704)
→ /admin/calendar でドラッグ配置 or 自動提案 → placeBlock → sync_status='pending_push'
→ 次回 calendar.sync.due で外部カレンダー (アプリ専用) へ push
```

### 7.8 シミュレーター → リード + 見積原案 (裁定 J6)

```
公開 /shop → POST /api/shop/lead (anon, rate limit, zSimulatorLeadReq)
  1. InquiryFacade.submit          … 既存経路 (contact_inquiries 保存 + 通知)
  2. CrmFacade.intakeFromSimulator … 顧客 UPSERT (dedup) + deal(stage='inquiry',
     amount=total_max, source='simulator') + activity 'form_submission'/'simulator_estimate'
     (冪等キー = inquiry_id)
  3. SalesFacade.createDraftQuoteFromEstimate … 見積原案 (draft、採番しない)
[異常] 2/3 失敗は 1 を巻き戻さない (問い合わせは必ず残す)。E9xx ログ + admin 手動リード化
[注記] pricing モジュールは本フローに登場しない (公開 UI コンポーネント → route の app 層合成。
  pricing に crm import を追加しない)
```

### 7.9 activities タイムライン・ハブの統合契約 (全モジュール共通)

```
書き込み: CrmFacade.appendActivity(input, ctx?) のみ (直接 INSERT 禁止 — ESLint/RLS/レビューで強制)
冪等:     (activity_type, ref_table, ref_id) 一意 index (非部分 — NULLS DISTINCT で ref なし行は
          衝突しない。01-crm v1.1 §2.2: PostgREST は部分一意の on_conflict を表現できない)。
          再送は created:false — ただし links は再送でも冪等に補完される (欠損の自己修復)
合成 ref: 実レコードを生まない状態遷移イベントは ref_table='<所有テーブル>/'+event・ref_id=元レコード id
          (例 sales: 'documents/accepted'。状態機械上 1 帳票につき高々 1 回の遷移のみ — v1.1 Δs2 採用)。
          実レコードが生まれるイベントは実 id (例 issued/reissued → issued_documents / paid・payment_recorded → payments — v1.7)。
          タイムラインの ref 逆引きは**未知の ref_table 値を安全に無視** (リンクなし表示に degrade — crm 実装要件)
payload:  ACTIVITY_PAYLOAD_SCHEMAS[activity_type] で二段階 parse (KMB-E604)
リンク:   activity_links 1 行 = 厳密に 1 対象 (customer/company/deal)。複数対象は複数行
時刻:     occurred_at = 業務時刻 / created_at = 記録時刻。表示は occurred_at 降順 keyset
不変:     編集/削除は type='note' のみ (KMB-E605)。'email' は Phase 2 予約 (v1 挿入禁止)
発生源:   telephony('call') / sales('document_event') / scheduling('work_log') /
          app 層('form_submission','simulator_estimate') / crm 内部('task_event','system','note')
```

---

## 8. 契約変更手順

1. 本書 (該当 §) と設計書の関連節を**先に**更新。
2. `contracts.ts` / migration / 結合テスト (`contracts-ddl-parity.test.ts` 含む) を同一 PR で更新。
3. PR チェックリスト: 「本書・DDL・contracts.ts の 3 点一致」「エラーコード新設は所有モジュール確認」「facade シグネチャ変更は依存モジュールの影響列挙」。
