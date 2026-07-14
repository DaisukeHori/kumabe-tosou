# module-contracts.md v2.8 追加差分 (07-contracts-delta)

- 版: v1.9 (2026-07-14: issue #101 帳票メール送付 — D1 sales 行に document_emails を追加、§4.10
  zEmailActivityPayload を to/document_id/doc_no/version/provider_message_id 追加で拡張し J7 Phase 2 を
  outbound のみ段階解禁 (inbound は引き続き KMB-E604)。00-overview §3.3 に KMB-E644/E645 を追加登録)。
  旧: v1.8 (2026-07-11: 最終整合 — D1 sales 行の所有テーブルに print_tokens / pdf_render_lock / document_revision_stagings (02-sales v1.1 §2.3.2 新設) と bucket branding-assets (D5 v1.2) を追記、§7.5 の「refusal→E403」を KMB-E821 一本化 (04-telephony v1.1 §9) に是正)。旧: v1.7 (2026-07-11: 02-sales v1.1 レビュー反映と対 — D8 CrmFacade に **getDealRefs (batch)** 追加 + DealRef/CustomerRef に **address** 追加 (Δs4 完結: listDocuments 50 件/頁の N+1 解消と billing_address 複製の源)、§4.10 zDocumentEventActivityPayload.event に **'payment_recorded'** 追加 (Δs5 — 'paid' は完済到達に限定)、§4.11 DocumentTotals コメントの tax.ts パス訂正 + D8 createDraftQuoteFromEstimate の「仮単価 = セル price_max」を 06 §5.4 T1 参照に訂正 (Δs6))。旧: v1.6 (2026-07-11: 04-telephony v1.1 レビュー反映と対 — §4.13 webhook 契約の route 共通則注記 (契約キー pick + 欠落 null 補完)・D8 CrmFacade.relinkActivity 追加 (通話の付け替え/解除で activity_links を張り替える経路 — 01-crm へ実装意味論の反映要)・§7.5 の created:true ガード廃止 (createTask は常に実行 — DB 冪等が担う))。旧: v1.5 (2026-07-11: 01-crm v1.1 レビュー反映と対 — D8/§7.9 の冪等 index を非部分一意へ是正 (PostgREST on_conflict 制約)・appendActivity の created:false 時 links 補完・createTask title 安定性の前提条件・zDealInput コメントの noop 縮退注記)。旧: v1.4 (2026-07-11: D7 4.12 grade_key/size_key の空文字禁止 min(1) — 03-scheduling v1.1 レビュー反映と対)。旧: v1.3 (2026-07-11: D5 の site_settings RLS を 00-overview §3.1.2c (0021) と統一 — site_settings_public_select 改名 + admin_select 併設)。旧: v1.2 (2026-07-11: レビュー指摘反映 — site_settings anon 可読キーの許可リスト化・角印 private 化 (D5)、matchCustomerByPhone の E601 是正・read メソッド昇格・SettingsFacade.get ctx (D8)、§7.5 順序是正 (activity 先行→createTask)、zDealInput.stage 作成 3 値制限、型 alias 網羅、normalizeJpPhoneToE164 完全仕様 ほか。詳細は末尾更新履歴)
- 旧版: v1.1 (2026-07-11: 統合裁定 — 並列執筆された各モジュール書の契約差分申請 (04 Δ1〜Δ3 / 02 Δs1〜Δs3 / 01 E608・createCustomer ctx / 06 factor 30 ほか) と openIssue を一括裁定し反映。裁定の全記録は末尾「裁定記録」) / v1.0 (2026-07-11)
- 作成: Fable 5 (設計サブエージェント)。v1.1 統合裁定: Fable 5 (統合裁定サブエージェント)。v1.2 レビュー反映: Fable 5 (レビュー反映サブエージェント)
- 位置づけ: **docs/module-contracts.md (v2.7) への追加差分の完全本文**。CRM スイート (00-overview.md / 01〜06) の契約変更はすべて本書に集約する。モジュール設計者は module-contracts.md を直接編集しない (裁定 J10 — 並列衝突防止)。統合作業者は本書の D0〜D10 を指定位置にコピペ適用し、v2.8 として 1 回コミットする。
- 適用の前提: module-contracts.md が v2.7 (2026-07-10) であること。v2.7 以外なら適用前に本書を rebase する。

## 適用手順 (統合作業者向け)

| 差分 | 適用先 (module-contracts.md) | 操作 |
|---|---|---|
| D0 | ヘッダ (L3 の前) | 版行を追加 |
| D1 | §1 所有マトリクス表 | 行を追加 + settings/pricing 行を置換 |
| D2 | §2 依存方向 | 図とルールに追記 |
| D3 | §3 派生規則 | 末尾に追記 |
| D4 | §4.1 共通スカラー | コードブロック末尾に追記 |
| D5 | §4.2 SETTINGS_SCHEMAS | スキーマ追加 + map 置換 + anon 可読キー許可リスト注記 |
| D6 | §4.8 zEstimateInput | 1 行置換 |
| D7 | §4 末尾 | §4.10〜§4.13 を新設 |
| D8 | §5 末尾 | facade 4 本追加 + AiProvidersFacade/SettingsFacade/CrmFacade の ctx 注記 + §5 拡張規約の文言置換 |
| D9 | §6 イベント表 | 行を追加 |
| D10 | §7 末尾 | §7.5〜§7.9 を新設 |

適用後チェックリスト: (1) 本書・00-overview **§2.2 (依存図)**・§3・各モジュール設計書 DDL の一致 (2) エラーコード追加は 00-overview §3.3 と 1:1 (3) `eslint.config.mjs` MODULES 追記 (D2 注記) が同一 PR に含まれる (4) `contracts-ddl-parity.test.ts` の追随対象 (D7 の enum 群) を Issue に列挙 — 導出定義にできない独立定義 (zSimEstimateSnapshot ↔ pricing 側) は contracts テストで構造一致を検証 (5) **site_settings の anon 可読キー許可リスト migration (D5 注記) が M0 帯と同一フェーズ/PR に含まれること** (invoice_issuer/telephony キー追加が anon 全行 SELECT のまま先行してはならない)。

---

## D0. ヘッダ版行 (先頭の版リストに追加)

```
- 版: v2.8 (2026-07-11: CRM スイート追加 — crm/sales/scheduling/telephony の 4 モジュール新設 (00-overview.md §2)、
  ExecutionContext と AI facade のバックグラウンド実行契約 (同 §3.1、裁定 J2)、activities タイムライン・ハブ統合契約 (同 §3.2.3)、
  共通スカラー (E.164/JPY/税区分/書類番号)、SETTINGS_SCHEMAS に analytics/branding/invoice_issuer/business_hours/work_capacity/telephony、
  KMB-E6xx/E7xx/E8xx 帯の割当 (E608/E807 含む — 個別 canonical は 00-overview §3.3)、zEstimateInput.quantity max 1000 是正 (裁定 J6)、
  site_settings anon SELECT の公開キー許可リスト化 (D5 注記 — 非公開キーは admin/service のみ読取))
```

---

## D1. §1 所有マトリクスへの行追加・置換

**追加する行 (site-public 行の上に挿入)**:

| モジュール | 責務 | 所有テーブル | 所有エラーコード | 公開 facade |
|---|---|---|---|---|
| `crm` | 顧客/会社/案件/活動タイムライン (全モジュール共通ハブ)/タスク/リード取込 — 01-crm.md が親設計 | customers, companies, deals, activities, activity_links, tasks | KMB-E601〜E619 | CrmFacade |
| `sales` | 見積/受注/納品/請求/入金消込・採番・税計算・帳票 PDF・電帳法台帳・帳票メール送付 — 02-sales.md が親設計 | documents, document_lines, payments, document_sequences, issued_documents, print_tokens, pdf_render_lock, document_revision_stagings (v1.8 追記 — 02-sales v1.1 §2.3.2 の service 専用補助 3 テーブル), document_emails (v1.9 追記 — issue #101、migration 20260714000036) (+Storage bucket: issued-documents, branding-assets) | KMB-E620〜E649 | SalesFacade |
| `scheduling` | 作業種別/工数テンプレート/作業ブロック/実績/キャパシティ/外部カレンダー双方向同期 — 03-scheduling.md が親設計 | work_types, work_templates, work_template_items, work_blocks, calendar_connections, calendar_event_links | KMB-E701〜E739 | SchedulingFacade |
| `telephony` | Twilio 発番設定/着信 webhook/録音/通話ジョブ (転写→議事録→タスク起票)/通話 UI — 04-telephony.md が親設計 | calls, call_recordings, call_jobs (+Storage bucket: call-audio) | KMB-E801〜E839 | TelephonyFacade |

**置換する行**:

| モジュール | 責務 | 所有テーブル | 所有エラーコード | 公開 facade |
|---|---|---|---|---|
| `settings` | サイト設定 (会社情報/ヒーロー/SEO/運用上限/通知/**GA4 計測/ブランディング/適格請求書発行者/営業時間/週間稼働/電話運用**) | site_settings | (E101/E103 を共用) | SettingsFacade |
| `pricing` | 価格グレード/オプション・見積り計算・**通販シミュレーター (公開 UI/リード接続は app 層合成 — §7.8)** | price_grades, price_options (+price_size_classes, price_matrix, price_quantity_tiers) | (E101/E103 を共用) | PricingFacade |

規則 (§1 末尾に追記):

- KMB-E6xx/E7xx/E8xx の個別割当 canonical は docs/design/crm-suite/00-overview.md §3.3。帯内の追加は本書改訂が先
- **activities への直接クエリは crm repository のみ**。他モジュールのタイムライン書き込みは `CrmFacade.appendActivity` に限る (§7.9 の統合契約)

---

## D2. §2 依存方向への追記

図に追加:

```
crm         ──→ platform / settings (notifications の read — digest 宛先)
sales       ──→ crm (appendActivity・顧客/案件参照) / settings (invoice_issuer・company の read — 発行者情報) / platform
scheduling  ──→ crm (appendActivity・案件参照) / settings (work_capacity の read) / platform
telephony   ──→ crm (顧客マッチ/タスク/appendActivity) / ai-providers (transcribe/generateText)
              / settings (business_hours・telephony の read — voice webhook 15 秒制約内の分岐) / platform
```

settings への上記依存はいずれも **`SettingsFacade.get` の read のみ** (v1.1 裁定: 04-telephony Δ1 / 02-sales Δs1 を採用し、crm (digest 宛先)・scheduling (キャパ設定) の同種 read も同時に明記 — ai-studio→settings と同型の read 依存で循環しない)。settings キーの**書込** (update) は各管理画面の Server Action (app 層) のみで、他モジュールの facade からは行わない。read はいずれも server 文脈 (session または service ctx — D8 の `get(key, ctx?)`) で行う: site_settings の anon SELECT は公開キー許可リストに限定される (D5 注記) ため、voice webhook 等の anon 起点 route からの business_hours/telephony read も facade を service ctx で呼ぶ。

v1.2 是正 2 点:

- **crm → ai-providers の辺は張らない** (v1.1 まで「将来の AI 補助。v1 実利用なし」として掲載していたが削除)。D8 の CrmFacade に ai-providers 呼び出しは存在せず、実利用のない辺は増やさない (pricing→crm を追加しない下記方針と同一)。AI 補助を実装する時点で本書改訂として追加する
- **sales → pricing の辺も張らない** (00-overview §2.2 に残る「pricing (見積原案の変換入力は app 層経由)」は本節へ追随改訂すること — 括弧書きどおり app 層経由であり、`createDraftQuoteFromEstimate` の入力 `SimEstimateSnapshot` は crm 所有契約 (§4.10) の import で足りる)。**00-overview §2.2 の依存図は本節が正**であり、同図に残る差分 (crm 行の ai-providers 辺・sales 行の pricing 辺) は本節に合わせて削除改訂する (settings read 4 本は 00 §2.2 に反映済みを実測確認 — 2026-07-11)

禁止に追加:

- **sales ⇄ scheduling の相互 import 禁止** — 受注明細→作業ブロック生成は app 層合成 (§7.7)
- **`twilio` SDK の直 import は telephony/internal のみ** (ESLint 強制)
- **`googleapis` / `@microsoft/microsoft-graph-client` の import 全面禁止** — カレンダー API は scheduling/internal の薄い fetch ラッパ (x-api.ts 前例) で実装
- pricing → crm の依存は追加しない (シミュレーター→リードは route handler の app 層合成 — 裁定 J10 の「facade 経由」を依存を増やさず満たす)

機械的強制の注記: `eslint.config.mjs` の `MODULES` 配列に `"crm", "sales", "scheduling", "telephony"` を追加する (v2.8 統合と同一 PR)。

---

## D3. §3 派生規則への追記 (末尾)

- **ExecutionContext (§4.1 追加分)**: service 文脈 (webhook / pg_cron worker) からの facade 実行は次の 3 形のいずれかによる (v1.2 明文化 — いずれも**必ず facade を経由**する。RLS bypass を repository 直呼びの言い訳にしない)。以下のいずれにも該当しないメソッドは admin セッション必須のまま:
  1. **ctx 引数型** — §5 の interface に `ctx?: ExecutionContext` が明記されたメソッド。省略時 `{ mode: "session" }` (cookie セッション、完全後方互換)
  2. **常時 service 型** — 呼び出し元が anon route に限られ mode 選択の余地がないメソッド (`intakeFromInquiry` / `intakeFromSimulator`)。ctx は取らず、interface コメントに「常に service 実行」と宣言する
  3. **facade 注入型** — facade 全体を service client で構築する `createXxxFacade(client)` ファクトリ経由 (`createDraftQuoteFromEstimate` — 02-sales §6.1。pricing の createPricingFacade 前例)

  契約外拡張メソッド (§5 拡張規約) も、app 層 route から service 文脈で呼ぶ場合は 1 の形で `ctx?: ExecutionContext` を取ってよい (markExpiredQuotes / getSalesDigest — D9。拡張規約の文言置換は D8 末尾)
- **JSONB discriminated map の追加**: `ACTIVITY_PAYLOAD_SCHEMAS` (§4.10) は SETTINGS_SCHEMAS / CHANNEL_CONTENT_SCHEMAS と同格の canonical map。activities.payload の読み書き両方で `ACTIVITY_PAYLOAD_SCHEMAS[activity_type].parse()` の二段階 parse を通す

---

## D4. §4.1 共通スカラーへの追記 (platform/contracts.ts)

コードブロック末尾に追加:

```ts
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

---

## D5. §4.2 SETTINGS_SCHEMAS への追加 (settings/contracts.ts)

zNotificationSettings の後に追加し、`SETTINGS_SCHEMAS` map を置換する:

```ts
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

実装フェーズの注記: analytics/branding = 05 フェーズ、invoice_issuer = sales フェーズ、business_hours・telephony = telephony フェーズ、work_capacity = scheduling フェーズで実装するが、**所有は settings・canonical は本節** (各書で再定義しない)。キー追加は DDL 不要。**新規キーは seed もバックフィルもしない** (v1.2 是正 — 既存規約の「バックフィル UPDATE」は 0013/0015 のような**既存キー行への列追加**の前例であり、本節の 6 キーは行が存在しない新規キーのため UPDATE は 0 行 no-op になる): 行は admin の初回保存 (settings/repository.ts `upsertSetting` の INSERT 経路 — 実装済み) で作成され、行なし時の `get()` E901 は各消費モジュールが既定値へ degrade する (04-telephony §6.1: business_hours 未設定 = 常に営業時間内・telephony 未設定 = 転送なし / 02-sales: E626 / 03-scheduling: work_capacity 未設定既定)。

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
- voice webhook (anon 起点 route) の business_hours/telephony read は `handleInboundCall` が持つ service ctx のクライアントで行う (`SettingsFacade.get(key, ctx?)` — D8 の ctx 追加)。04 Δ1 の成立条件は anon 全行 SELECT ではなく本経路に変更
- 00-overview §10 の migration 割当 (M0 = 0021/0022) に本 RLS 置換を追記すること (適用後チェックリスト (5))

---

## D6. §4.8 zEstimateInput の是正 (裁定 J6)

`zEstimateInput` の quantity 行を置換:

```ts
  quantity: z.number().int().min(1).max(1000), // v2.8: UI clamp (1..1000) と統一 (legacy 互換。旧 999 は不整合)
```

### D6-2. §4.9 PriceTable 型のドキュメント是正 (v1.3 — 裁定 #18)

module-contracts.md §4.9 の `PriceTable` 型のフィールド名 `sizes` / `tiers` は**実装と乖離した旧記述** (実装 `src/modules/pricing/contracts.ts` L151-157 は `size_classes` / `quantity_tiers` — `computeEstimate` (estimate.ts L19)・shop-simulator・admin 価格画面もすべて同名を参照、2026-07-11 実 Read)。ドキュメント側を実装準拠に置換する (**コード変更なし** — 実装のフィールド名改称は消費箇所全域へ波及するため行わない)。06-simulator §4.5 の設計コード (`formatGradeCardPrice`) はこの是正後の型に適合する:

```ts
export type PriceTable = {
  grades: PriceGrade[];
  size_classes: PriceSizeClass[];   // v2.8 是正: 旧記述 sizes は実装と乖離 (裁定 #18)
  matrix: PriceMatrixCell[];
  quantity_tiers: QuantityTier[];   // v2.8 是正: 旧記述 tiers は実装と乖離 (裁定 #18)
  options: PriceOption[];
}; // v2: shop シミュレータと admin 価格画面の共通データ形
```

---

## D7. §4 に新設する節 (§4.10〜§4.13)

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

/** J7 Phase 2 の段階的解禁 (v1.9 — issue #101): outbound (帳票のメール送付) のみ appendActivity が
 *  受け入れる。inbound (受信取込) は受信基盤が無いため引き続き KMB-E604 で拒否する
 *  (判定は crm/facade.ts appendActivity — 二段階 parse 後に payload.direction で判定)。 */
export const zEmailActivityPayload = z.object({
  direction: z.enum(["inbound", "outbound"]),
  subject: z.string().max(200),
  to: z.string().email().max(120).nullable(),
  document_id: z.string().uuid().nullable(),
  doc_no: zDocumentNo.nullable(),
  version: z.number().int().min(1).nullable(),
  provider_message_id: z.string().max(200).nullable(),
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
  email: zEmailActivityPayload,                 // J7 Phase 2 段階解禁 (outbound のみ挿入可。inbound は KMB-E604 — v1.9/#101)
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

/* ---------- 型 alias (v1.2 — D8 の facade シグネチャが参照する全型を z.infer で明示 export。
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

/** 跨モジュール read の最小射影 (v1.2 — D8 getCustomerRef/getDealRef の戻り値。
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

/* 型 alias (v1.2 — D8 参照分) */
export type DocumentStatus = z.infer<typeof zDocumentStatus>;
export type DocumentLineInput = z.infer<typeof zDocumentLineInput>;
export type TaxSummary = z.infer<typeof zTaxSummary>;
export type CreateDocumentInput = z.infer<typeof zCreateDocumentInput>;
export type PaymentInput = z.infer<typeof zPaymentInput>;

/** 税計算純関数の契約 (sales/tax.ts — モジュール直下。v1.7 訂正: admin UI のリアルタイム税プレビューが
 *  クライアント import するため internal/ 配下には置けない (ESLint MODULES 境界 — 02-sales §1.3)。
 *  単体テスト必須、裁定 J5/D4):
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

/* 型 alias (v1.2 — D8 参照分) */
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
  customer_name: string | null; // 解決は CrmFacade.getCustomerRef (merged 終端解決込み — D8。calls.customer_id の直 join 禁止)
  handling: z.infer<typeof zCallHandling> | null;
  duration_seconds: number | null;
  job_status: z.infer<typeof zCallJobStatus> | null;
  started_at: string;
};

/* 型 alias (v1.2 — D8 参照分) */
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

## D8. §5 facade インターフェース追加

§5 末尾に追加。戻り値はすべて `Result<T>`。`ctx?: ExecutionContext` を取るメソッドのみ service 文脈から呼べる (それ以外は admin セッション必須のまま)。

```ts
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
    // ドメイン変換して手動確認へ (01-crm P7/§6.1)。E823 は telephony 所有帯 (D1) であり crm は発しない
    // (v1.2 是正: 旧記述「KMB-E823 相当を…返す」は帯所有違反かつ 01-crm と矛盾 — 04-telephony §6.5.4-2 の
    //  分岐表記も「E601 受領 → E823 に変換して outcome='ambiguous'」に統一すること)
  // 跨モジュール read (v1.2 昇格 — D2 の「顧客/案件参照」の実現手段。戻り値は §4.10 の最小射影型。
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

**型 import 規約 (D8 注記)**: 跨モジュールの facade シグネチャで使う型 (`SimEstimateSnapshot` / `DocumentEventActivityPayload` 等) は、依存方向 §2 に沿う向きであれば所有モジュールの contracts.ts から import してよい (ESLint が制限するのは internal/** と repository のみ)。依存方向に反する参照は構造的同型を独立定義する (既存定石 — zSimEstimateSnapshot が実例)。

**既存 facade の変更 (置換)**:

```ts
// ai-providers/facade.ts — v2.8: 第 2 引数 ctx を追加 (省略時は現行挙動と完全一致 — 裁定 J2)。
// 他メソッド (listKeys / saveKey / ... / getUsageSummary) は session 専用のまま変更なし
generateText(req: GenerateTextReq, ctx?: ExecutionContext): Promise<Result<TextResult>>;
generateImages(req: GenerateImageReq, ctx?: ExecutionContext): Promise<Result<ImageResult>>;
transcribe(req: TranscribeReq, ctx?: ExecutionContext): Promise<Result<TranscribeResult>>;

// settings/facade.ts — v2.8: get に第 2 引数 ctx を追加 (省略時は現行挙動と完全一致)。
// anon 可読キーの許可リスト化 (D5 注記) 後、非公開キー (telephony/invoice_issuer/work_capacity 等) の
// service 文脈 read (voice webhook の business_hours/telephony、digest の notifications) はこの ctx で行う。
// update は session 専用のまま変更なし
get<K extends SettingsKey>(key: K, ctx?: ExecutionContext): Promise<Result<SettingsValue<K>>>;
```

**§5 拡張規約の文言置換 (v1.2 — D3 の 3 形式と整合させる)**: v2.7 §5 の一文

> 各 facade は、自モジュールの admin UI が必要とする **CRUD 拡張メソッドを追加してよい**

を次に置換する:

> 各 facade は、自モジュールの admin UI **または app 層 route** が必要とする **CRUD 拡張メソッドを追加してよい**。app 層 route から service 文脈で呼ぶ拡張メソッドは `ctx?: ExecutionContext` を取ってよい (§3 の 1 の形 — markExpiredQuotes / getSalesDigest が実例)

「他モジュールから拡張メソッドを呼ぶことは禁止 (呼ぶ必要が生じたら本節へ昇格させる)」は不変 (getCustomerRef/getDealRef の昇格が本規約の適用例)。

---

## D9. §6 ドメインイベント表への行追加

| イベント (論理名) | 発生源 | 反応 | 伝達方式 |
|---|---|---|---|
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

## D10. §7 結合シーケンス追加 (§7.5〜§7.9)

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
             → appendActivity('call', ref=calls.id) (created:false でも links 補完 — D8)
             → createTask(origin='ai_call', source_activity_id=activity_id)×N を**常に実行**
               (created フラグでスキップしない — 冪等は D8 の (source_activity_id, title) 一意が担う。
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
不変:     編集/削除は type='note' のみ (KMB-E605)。'email' は outbound のみ挿入可 (v1.9/#101 — inbound は KMB-E604)
発生源:   telephony('call') / sales('document_event') / scheduling('work_log') /
          app 層('form_submission','simulator_estimate') / crm 内部('task_event','system','note')
```

---

## 設計チェックリスト適合表 (本書分)

本書は契約差分文書であり、設計本体の必須 10 章は 00-overview.md §16 と各モジュール設計書が担う。

| チェック項目 | 本書での扱い |
|---|---|
| 業務シナリオ | 該当なし — 契約差分文書 (業務文脈は 00-overview §1 と各モジュール書の業務シナリオ章が正) |
| 認可マトリクス / ライフサイクル / 全データパターン / 印刷出力 / 移行受入基準 / 規模見積り / 状態意味論 / 差分表示 | 該当なし — 00-overview.md §5/§6/§7/§0.6/§14/§13/§6/§8 と 01〜06 が正 (本書は値契約・facade・イベント・シーケンスのみ) |
| テスト戦略 | 適用チェックリスト (冒頭) + parity テスト対象の明記 (D7 enum 群・DOC_NO_PREFIX) |
| エラーコード表 | 帯の所有のみ (D1)。個別割当 canonical は 00-overview.md §3.3 |
| モジュール契約 / 値契約 (Zod canonical) | 本書全体 (D1〜D10) — module-contracts.md v2.8 へ 1 回適用 |

## 裁定記録 (v1.1 — 並列執筆 6 書からの契約差分申請・openIssue の統合裁定)

裁定基準: 設計裁定 J1〜J12 / 依存方向 (下向き依存・循環の禁止) / 冪等性 / 最小変更。「採用」は本書の該当 § に反映済み。

| # | 申請元 | 内容 | 裁定 | 理由・反映箇所 |
|---|---|---|---|---|
| 1 | 01-crm §9 | KMB-E608 (顧客マージ不正) の帯内追加 | **採用** | マージ RPC (01 §6.4) に必須。帯 E601〜E619 内。00-overview §3.3 に登録済み (個別 canonical はあちら)。errors.ts 登録は #2-1 受入条件のまま |
| 2 | 04-telephony §1.5 Δ3 | KMB-E807 (通話ジョブの再実行対象外) の帯内追加 | **採用** | retryCallJob の failed 限定ガードに必須。帯 E801〜E819 内。00-overview §3.3 に登録済み |
| 3 | 01-crm §7.3 注 (04-telephony §6.5.4 と要すり合わせ) | `createCustomer` に `ctx?: ExecutionContext` を追加 | **採用** | telephony worker の linking が lead 顧客を作る経路は service 文脈。D8 規約「ctx を取るメソッドのみ service 可」に対する第 3 引数追加が最小変更 (既存 2 引数呼び出しは不変) → §D8 |
| 4 | 02-sales §17 Δs2 (01-crm §15.1 R3 の openIssue への回答) | document_event 等の多イベント型と冪等キー 3 つ組の衝突 → 実レコード ref + 合成 ref_table (`'documents/'+event`) 規約 | **採用** | issued/reissued/paid は実レコード (issued_documents/payments) の新 id、状態遷移 4 種 (accepted/declined/expired/voided) は状態機械上 1 回限りで合成 ref が正しい冪等単位。task_event の 01 §4.3 裁定 (created のみ ref 付き) とも両立。crm のタイムライン逆引きは未知 ref_table を安全に無視することを実装要件化 → §7.9 / §D7 注記 |
| 5 | 04-telephony §1.5 Δ1 | `telephony ──→ settings (read)` の依存追加 | **採用 (拡大適用)** | voice webhook 15 秒制約内で business_hours/telephony を read する最小構成 (app 層合成は D8 シグネチャ変更が必要で変更が大きい)。crm (notifications)・scheduling (work_capacity) にも同種 read が本文に既在のため、D2 に 4 モジュール分をまとめて明記し整合 → §D2 |
| 6 | 02-sales §1.2 ★注記 / §17 Δs1 | `sales ──→ settings (invoice_issuer・company の read)` の依存追加 | **採用** | issueDocument の発行者情報 read は D8 シグネチャ上 app 層合成で実現不能。ai-studio→settings と同型の read 依存で循環しない → §D2 |
| 7 | 04-telephony §1.5 Δ2 | SETTINGS_SCHEMAS に `telephony` キー (zTelephonySettings) 追加 | **採用** | 番号非依存設計 (J3 ★確認 1)・録音同意文言 (★確認 4) を admin 可変にする器。telephony は設定テーブルを所有しない (D1) ため settings 所有キーが正。完全定義を §D5 に転記 (canonical は本書、04 §3.2 は写し) |
| 8 | 01-crm §7.2 と 02-sales §6.2 の不一致 | crm-digest の sales read の形 (01 提案: listQuotesExpiringWithin / listUnpaidInvoices vs 02 定義: markExpiredQuotes / getSalesDigest) | **修正採用** | sales 所有の 02-sales 定義を正とし 01-crm §7.2 の提案シグネチャを破棄。**契約外拡張のまま D8 へ昇格しない** (呼び出し元は app 層 route であり他モジュールではない — §5 拡張規約適合)。`getSalesDigest` は service 文脈でも呼ばれるため `ctx?: ExecutionContext` を追加 (02 §6.2 是正) → §D9 注記 |
| 9 | 02-sales §17 Δs3 | digest route の配線所掌 (crm #2-2 vs sales #3s-4 の重複防止) | **採用** | 推奨どおり: route 骨格 = crm フェーズ / 配線有効化 = sales フェーズ → §D9 注記 (※申請時の「facade 存在チェックで skip」は v1.2 で「sales 未参照 + null 固定」に実現方法を確定 — D9 参照) |
| 10 | 04-telephony §15.1 R3 (01-crm への申し送り) | createTask の冪等化 (lease 失効跨ぎクラッシュの重複起票根絶) | **修正採用** | tasks に部分一意 index `(source_activity_id, title) where source_activity_id is not null` を追加し DB レベルで冪等化 (01-crm 0023)。申請案の `(origin, source_activity_id, title)` から origin を落とす (同一 activity 出所・同題 = 同一タスク)。手動タスク (source_activity_id NULL) は無影響 → §D8 注記 |
| 11 | 06-simulator §5 (発見事項) | zSimEstimateSnapshot.breakdown[].factor max 20 → 30 | **採用** | computeEstimate の breakdown 先頭要素は factor=size.label (max 30) — 現行 seed では収まるが契約不一致があり得る。実装側の防御的切り詰めは維持 → §D7 |
| 12 | 06-simulator §7.1 (openIssue) | intakeFromSimulator / createDraftQuoteFromEstimate の実行文脈 (anon route から呼ばれるのに ctx がない) | **採用 (注記)** | 両者は app 層合成の入口 = **常に service 実行** (crm: 内部 service client 生成 / sales: createSalesFacade(client) 注入)。呼び出し元に mode 選択の余地がないため ctx は追加しない。service key 未設定時は E901 degrade (問い合わせ保存は成立) → §D8 注記 |
| 13 | 06-simulator §4.2 (openIssue) | zSimulatorLeadReq の platform/crm への昇格 | **却下** | 単一 route とそのフォームのみが使う app 層ローカル契約。canonical 部品 (zSimEstimateSnapshot 等) の合成のみで新ドメイン型を発明していない。昇格は跨モジュール利用が生じた時点で |
| 14 | 05-site-settings §4.6 (openIssue) | SettingsFacade.getPublicValue / SITE_SETTINGS_CACHE_TAG の §5 昇格 | **却下** | 呼び出し元は app 層 ((site)/layout.tsx 等) のみ。getWithMeta と同格の「契約外拡張」で足りる (§5 拡張規約)。跨モジュール利用が生じたら昇格 |
| 15 | (裁定者起案 — 電話のみシミュレーターリード問題) | zInquiryInput の email 必須緩和 | **却下** | contact_inquiries.email は not null (migration 0001 実測 — 06 §4.2)、既存 contact フォームと要求水準を統一。電話のみのお客様は telephony チャネル (04) が受け皿 (J3/J7、06 §11 L3/R-S4)。緩和は DB 変更 + 通知/dedup への波及があり最小変更に反する。**zInquiryInput は v2.8 でも不変** |
| 16 | 06-simulator §12 (申し送り) | 02-sales データパターンに「シミュレーター由来の通常 draft」を追加 (備考印字の欠落なし検証) | **採用** | 02-sales §2.4 は XL (quote_only) のみ掲載だった → #21 として追加 (02-sales 反映済み) |
| 17 | 06-simulator §1 (openIssue) | ビルド時焼き付きリスクの横展開点検一覧を Phase 5 #5-3 受入に含める | **採用 (Issue 起票時に反映)** | 契約変更なし。親/子 Issue 作成段で #5-3 受入基準に転記する申し送りとして記録 |
| 18 (v1.3) | 06-simulator §4.5 (レビュー指摘: 設計コードが canonical に無い `size_classes` を参照) | module-contracts §4.9 `PriceTable` の `sizes`/`tiers` を `size_classes`/`quantity_tiers` に是正 | **採用 (ドキュメント側是正)** | 実装 (pricing/contracts.ts L151-157) と全消費箇所 (computeEstimate / shop-simulator / admin 価格画面) が `size_classes`/`quantity_tiers` — canonical の記載が旧く、ドキュメントを実装に合わせるのが最小変更 (コード改称は消費箇所全域へ波及)。→ §D6-2 |
| 19 (05 v1.1) | 05-site-settings §3.1/§5.3 (レビュー反映) | zBrandingSettings の favicon_media_id コメントのフォールバックパス表記を「既存 src/app/favicon.ico」→「既定 favicon (public/favicon.ico — 05 §5.3 の移設後パス)」に更新 | **採用** | 05 §5.3 の `git mv src/app/favicon.ico public/favicon.ico` (ファイル規約撤去) 後に旧表記が事実と乖離する。D5 は実装者が contracts.ts へ写経する canonical のため本書側を更新し、05 §3.1 の転記は更新後 D5 と完全一致とする → §D5 zBrandingSettings コメント |
| 20 (05 v1.1) | 05-site-settings §2.4 (レビュー反映) | D5 末尾の一般注記「既存規約: contracts 追加 + バックフィル UPDATE」の適用範囲を「既存キー行への必須フィールド追加」に限定 (新規行キーは seed もバックフィルもしない) | **採用 (v1.2 本文反映済みの追認)** | 0013/0015 のバックフィル前例は既存行への列追加ケース。D5 の 6 キーは行が存在しない新規キーで UPDATE は 0 行 no-op → §D5 実装フェーズ注記 (v1.2 是正) と 05 §2.4 は矛盾しない |
| 21 (05 v1.1) | 05-site-settings §2.5-4 (レビュー反映) | 02-sales への申し送り: migration 0028 の SQL ヘッダに「0035 適用済み環境では適用禁止 (0035 が 0028 を包含)」コメントを追加し、02-sales §2.3.3 に 05 §2.5 への相互参照を置く | **採用 (申し送り — 02-sales 反映は Issue 起票時)** (05 v1.2 で前提消滅・撤回) | 0035 は 0028 を包含する media 参照 3 点セットの全文置換。settings フェーズは sales と独立着手可のため 0035 先行があり得、逆時系列で 0028 を適用すると favicon 参照ガードが DROP+CREATE で消失し ai-draft favicon media の日次 cleanup 物理削除事故に至る (05 §2.5-4・§9 パターン 10)。事故検知は 05 受入 A1 (本番 pg_policies 実測) |
| 22 (02 v1.1) | 02-sales §17 Δs4 (レビュー反映 — v1.2 統合の残課題) | CrmFacade に batch 版 `getDealRefs(dealIds)` を追加し、CustomerRef / DealRef に `address` を追加 | **採用** | v1.2 の getDealRef (単数) だけでは listDocuments (keyset 50 件/頁) の deal_title 解決が N+1 になる。また DealRef に address が無く 02-sales の billing_address 複製 (§6.1) が実現不能だった。不在 id は結果から除外・空配列 ok([]) → §4.10 / §D8 |
| 23 (02 v1.1) | 02-sales §17 Δs5 (レビュー反映) | zDocumentEventActivityPayload.event に 'payment_recorded' (部分入金の記録) を追加し 'paid' を「完済到達」に限定 | **採用** | 旧仕様は部分入金にも event:'paid' を使い回しており、タイムライン・将来の集計が「請求書は完済済み」と誤認するリスク。実レコード ref (payments) の冪等単位は不変 → §4.10 / §7.9 |
| 24 (02 v1.1) | 02-sales §17 Δs6 (レビュー反映) | §4.11 DocumentTotals コメントの tax.ts パスを sales/tax.ts に訂正 + §D8 createDraftQuoteFromEstimate の「仮単価 = セル price_max」を 06-simulator §5.4 T1 参照に訂正 | **採用 (ドキュメント側是正)** | internal/tax.ts は ESLint MODULES 境界 (internal/** 外部 import 禁止) により admin UI のクライアント import (リアルタイム税プレビュー — 02-sales §8.3) が不可能で、02-sales §1.3 (モジュール直下) が正。「セル price_max」は snapshot にセル生値が無く実現不能な略記 (06 §5.4 T1 で解釈確定済み) → §4.11 / §D8 |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.9 | 2026-07-14 | issue #101 帳票メール送付 (PDF 添付方式): D1 sales 行の所有テーブルに **document_emails** を追加 (migration 20260714000036) / §4.10 `zEmailActivityPayload` に **to/document_id/doc_no/version/provider_message_id** を追加し J7 Phase 2 を **outbound のみ** 段階解禁 (inbound は引き続き KMB-E604 — crm/facade.ts appendActivity が payload.direction で判定) / 00-overview §3.3 に **KMB-E644 (送信失敗) / KMB-E645 (宛先不正)** を新規登録 |
| v1.8 | 2026-07-11 | 最終整合 (final-check 波及反映): D1 sales 行の所有テーブルに **print_tokens / pdf_render_lock / document_revision_stagings** を追記 (02-sales v1.1 §2.3.2 が新設した service 専用補助 3 テーブル — 申し送り漏れの是正) + Storage bucket に **branding-assets** を追記 (D5 v1.2 の角印 private 化で 0028 が作成) / §7.5 analyzing の「refusal→E403」を **refusal・max_tokens 打ち切り・parse 失敗いずれも KMB-E821** に是正 (04-telephony v1.1 §9 の一本化と同期) |
| v1.7 | 2026-07-11 | 02-sales v1.1 レビュー反映と対 (裁定 #22〜#24): D8 CrmFacade に **getDealRefs(dealIds) (batch)** を追加 + CustomerRef/DealRef に **address** を追加 (Δs4 完結 — listDocuments 50 件/頁の N+1 解消・billing_address 複製の源) / §4.10 zDocumentEventActivityPayload.event に **'payment_recorded'** を追加し 'paid' を完済到達に限定 (Δs5。§7.9 の実レコード ref 例示にも追記) / §4.11 DocumentTotals コメントの tax.ts パスを `sales/tax.ts` (モジュール直下) に訂正 + D8 createDraftQuoteFromEstimate コメントの「仮単価 = セル price_max」を 06-simulator §5.4 T1 参照に訂正 (Δs6) |
| v1.6 | 2026-07-11 | 04-telephony v1.1 レビュー反映と対: §4.13 telephony webhook 契約に **route 共通則** (署名検証後に契約キーのみ pick + 欠落キー null 補完 → parse。実 Twilio POST の余剰 10+ パラメータで .strict() が全滅する事故と、busy/no-answer の DialCallDuration 欠落を吸収) と From='anonymous' の意味論注記 / D8 CrmFacade に **relinkActivity(activityId, links, ctx?)** を追加 — activity_links の全置換 (links=[] で全解除)。appendActivity の冪等ヒットは links 補完のみで旧リンクを外せないため、通話の付け替え/解除 (04 §7.2) で誤マッチの旧顧客タイムライン残留を除去する経路 (実装意味論は 01-crm 所掌 — **要反映**) / §7.5 の「created:true のときのみ createTask」を廃止し**常に実行**へ是正 (appendActivity 成功後クラッシュでタスク恒久喪失する at-most-once 化の除去。冪等は (source_activity_id, title) 一意が担う。activity 先行順序は不変) |
| v1.5 | 2026-07-11 | 01-crm v1.1 レビュー反映と対: D8 appendActivity「created:false でも links を冪等補完」明記 (部分失敗の自己修復 — at-least-once) / D8 createTask・§7.9 の冪等 index を**非部分一意**に是正 (PostgREST の on_conflict は index_predicate を表現できず部分一意では 42P10 — 01-crm §2.2 v1.1 の設計原則に追随。NULLS DISTINCT で意味論不変) + createTask の title 安定性 (非決定生成は先に永続化) を前提条件化 / D7 zDealInput コメントに (lost,lost) noop 縮退の注記 (9×9 期待値は 01-crm §4.2 が正) |
| v1.4 | 2026-07-11 | 03-scheduling v1.1 レビュー反映と対: D7 §4.12 の zWorkTemplateInput / zGenerateBlocksInput.lines の grade_key・size_key に `.min(1)` を追加 (空文字禁止 — NULL ワイルドカードと '' が部分一意 index (coalesce) で衝突する一方、テンプレ解決カスケードでは別値になる不整合の契約レベル排除。UI は空欄選択を null へ正規化 — 03 §10.3) |
| v1.3 | 2026-07-11 | D5 注記の site_settings RLS を 00-overview §3.1.2c (0021 canonical DDL) と統一: 許可リストポリシー名を site_settings_public_select に変更し、**site_settings_admin_select (is_admin()) を併設** — 旧ポリシーが anon/authenticated 共用のため、許可リスト化のみでは admin セッションの非公開キー読取が失われる欠落の是正。あわせて 06-simulator レビュー由来の裁定 #18 (§D6-2: module-contracts §4.9 `PriceTable` の `sizes`/`tiers` → `size_classes`/`quantity_tiers` の実装準拠是正)、および 05-site-settings v1.1 レビュー反映由来の裁定 #19〜#21 (D5 favicon コメントの移設後パス更新 / バックフィル注記限定の追認 / 0028「0035 適用済み環境では適用禁止」の 02-sales 申し送り) を追加 |
| v1.2 | 2026-07-11 | レビュー指摘 20 件 (Codex 外部レビュー含む) の反映。**BLOCKER**: D5 site_settings anon SELECT の公開キー許可リスト化 (migration SQL 明記・M0 帯同一フェーズ必須をチェックリスト (5) 化・notify.ts の service 切替・角印を private バケット 'branding-assets' + 署名 URL に変更) / D2⇔00 §2.2 依存図の正を D2 に一本化。**MAJOR**: D8 matchCustomerByPhone を E601 返却に是正 (E823 は telephony 帯 — 04 §6.5.4-2 へ波及) / §7.5 linking を activity 先行 → created:true 時のみ createTask(source_activity_id) に是正 (00 §4.3 へ波及) / CrmFacade に getCustomerRef/getDealRef を昇格 (最小射影型 §4.10。02 Δs4 getDealBillingParties 統合・01 R4 充足) / zDealInput.stage を作成 3 値に制限 (won_at/lost_reason 不変条件の穴閉じ) / normalizeJpPhoneToE164 完全仕様 (+81 素通し・固定電話・null 規則) / D7 に D8 参照の全型 alias を明示 / D3 に service 実行 3 形式を明文化 + §5 拡張規約の文言置換を D8 末尾に転記。**MINOR**: D2 crm→ai-providers 辺と sales→pricing 辺の削除 / doc_no・amount_jpy・activity_type の導出定義化 / zDateOnly 実在日 refine / zDayHours open<close refine + 1 日 1 窓注記 / D5「バックフィル UPDATE」を初回保存 INSERT + E901 degrade に是正 / D9 digest 配線の実現方法確定 (sales 部分は未参照 + null 固定、存在チェック廃止) / zWorkBlockInput にペア + 順序 refine / SettingsFacade.get に ctx |
| v1.1 | 2026-07-11 | 統合裁定 17 件 (上表)。D2 settings read 依存 4 本 / D5 telephony キー / D7 factor 30・合成 ref 注記 / D8 createCustomer ctx・intake/createTask/createDraftQuoteFromEstimate 注記 / D9 digest 配線 / §7.9 合成 ref 規約。E608/E807 は 00-overview §3.3 に登録 |
| v1.0 | 2026-07-11 | 初版。module-contracts.md v2.7 → v2.8 差分 (crm/sales/scheduling/telephony 新設、ExecutionContext、activities ハブ、共通スカラー、SETTINGS_SCHEMAS 5 キー、facade 4 本 + AiProvidersFacade ctx、イベント/シーケンス追加、zEstimateInput 1000 是正) |
