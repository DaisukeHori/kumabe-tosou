# トラック詳細設計: 商談データ精度向上 (key=sfa-deal-hygiene)

- 設計担当: Fable / 設計日: 2026-07-18
- 含む項目: #66 見積オンライン承諾+電子署名(高) / #71 失注理由カテゴリ+集計(高) / #89 停滞案件アラート(高) / #80 紹介元トラッキング(高) / #67 電子契約 BtoB基本契約・NDA縮小(中・#66と同一署名基盤)
- 依存トラック: intake-comms-foundation(署名依頼メール・アラート配信のメール基盤。ただし本設計は既存 Resend 直送パターンで自己完結可能な形にし、#100 メール統合 (08-email.md v2) とは**テーブル・エラーコード帯 (E840-859) を一切共有しない**)
- 規約: docs/module-contracts.md v2.9。エラーコード新設は本書先行更新 (module-contracts.md:56-57)

---

## 0. 現状調査 (実コード根拠。すべて file:line)

### 0.1 v2 ギャップレポートの判定 (hubspot-gap-report-v2.md)

| 行 | 項目 | 現行判定 |
|---|---|---|
| L141 | #66 見積のオンライン承諾+電子署名 | 無 (admin 手動記録)。「対面が一切ない遠隔取引では、オンライン承諾が唯一の意思決定接点。証跡も残る」 |
| L143 | #67 電子契約 | 無。「工事請負契約は無い。BtoB ブリッジ生産の基本契約・NDA 用途に縮小。件数は少ない」 |
| L140 | #71 失注理由の定型カテゴリ | 一部 (自由記述のみ)。「価格/納期/対応材料外/数量の分析がグレード・価格戦略に直結」 |
| L139 | #89 停滞案件アラート | 無。「既存日次ダイジェストへの追加で済む」(L322: S 規模判定) |
| L138 | #80 紹介元トラッキング | 無 (leadSource に値なし)。「造形コミュニティは作家同士の紹介・X 上の言及で仕事が回る」 |

### 0.2 crm モジュール (失注・停滞・紹介の土台)

- **deals DDL**: `supabase/migrations/20260711000023_crm_core.sql:68-103`。`lost_reason text` (L81, 自由記述のみ・カテゴリ列なし)、`deals_lost_requires_reason` check (L88: `stage <> 'lost' or lost_reason is not null`)、`source` は 5 値 enum `('form','simulator','phone','manual','migration')` (L82)。紹介系の列は無い。
- **終端ステージガード**: 同 migration L108-121 の `deals_guard_terminal_stage()` trigger。`20260714000036_crm_deal_reopen.sql` で GUC `kmb.crm_reopen_unlock` バイパス付きに置換済み (再開 RPC `crm_reopen_deal` 専用)。
- **失注の唯一の経路**: `src/modules/crm/facade.ts:1404` — `{ stage: "lost", lost_reason: parsed.data.reason }`。入力は `zMarkDealLostInput = { reason: zShortText(200) }` (`src/modules/crm/contracts.ts:397-401`)。`updateDealStage(to='lost')` は常に KMB-E602 (contracts.ts:77 コメント)。
- **再開**: `zReopenDealInput` (contracts.ts:408-414、#102)。
- **customers DDL**: `crm_core.sql:35-53`。`source` 5 値 enum (L46)、紹介列なし。`customers_custom_fields` (`20260715000001_customers_custom_fields.sql:20-30`) で `custom_fields jsonb` 追加済み+`crm_merge_customers` RPC を「勝者の空欄のみ敗者から補完」方式で全文差し替えする前例あり (同 L33-45)。**ただし当該 RPC の現行本体は `20260715000002_customers_billing_shipping.sql:45-128` による再置換版**で、billing_info/shipping_info のブロック coalesce (L105-106) が追加済み — §5.3 の全文差し替えは必ずこの 000002 版を基準にする (000001 版を基準にコピーすると #113 のマージ補完が静かに退行する)。
- **活動タイムライン**: `activities` / `activity_links` (`crm_core.sql:126-180`)。`activity_links` は deal_id 列+`activity_links_deal_uniq (deal_id, activity_id)` index (L176-177) を持ち、**案件ごとの最終活動日時は `activity_links.deal_id → activities.occurred_at` の max で導出可能** (専用列は不要)。
- **日次ダイジェスト**: `CrmDigest` 型 = `overdue_tasks / today_tasks / awaiting_leads / sales{expiring_quotes, unpaid_invoices}` (`src/modules/crm/contracts.ts:599-608`)。`collectDigest` は `facade.ts:1851`、本文レンダラは `src/modules/crm/internal/notify.ts` (L53-70 に「■ 期限接近の見積」「■ 未消込の請求書」のセクション形式)。cron は `20260711000024_crm_digest_cron.sql` (JST 07:00) → `src/app/api/jobs/crm-digest/route.ts` (markExpiredQuotes → collectDigest → getSalesDigest 事後マージ → isDigestEmpty 判定 → sendDailyDigest)。**「route (app 層) が両 facade を合成する。crm→sales 依存は作らない」の裁定が route コメントに明記されている** — 本トラックの digest 拡張もこの形を踏襲する。
- **DealListItem / DealDetail**: `contracts.ts:529-550`。`lost_reason` は DealDetail のみ (L547)。
- **admin UI**: `/admin/deals/[id]/DealHeaderActions.tsx:18-46` — 「失注にする」→ `LostReasonDialog` → `markDealLostAction`。共通小物は `src/app/admin/_ui/` (data-table / underline-tabs / meter-bar / status-badge / entity-picker / notice-panel ほか)。

### 0.3 sales モジュール (承諾・署名の土台)

- **documents DDL**: `20260711000026_sales_core.sql:17-56`。`status` check に **`accepted` / `declined` / `expired` が既にある** (L21)、`deal_id not null` (L22)、`valid_until` (L30, quote のみ)、`status_reason` (L43)。発行後凍結 trigger (L76-125) は status 系列を凍結対象外にしている。
- **手動承諾**: `salesFacade.acceptQuote / declineQuote` (`src/modules/sales/facade.ts:1600-1662`) — doc_type='quote' ガード → `canTransition` → `updateDocumentStatusWithCas` → `recordDocumentEventActivity(ctx, doc, 'accepted', '見積承諾')` で deal タイムラインに document_event を記録。admin UI からの配線は `src/app/admin/documents/actions.ts:414-439` と `documents/[id]/document-detail.tsx:130-149,293`。**つまり「承諾」の状態機械・活動記録は実装済み。無いのは「顧客自身がオンラインで承諾する経路と証跡」だけ。**
- **公開トークン基盤**: `src/modules/sales/internal/print-token.ts` — トークン文字列 `${document_id}.${exp}.${hmac}` (HMAC-SHA256, `PRINT_TOKEN_SECRET`)、TTL 300 秒・**ワンタイム消費** (L21-31)、`timingSafeEqual` 比較 (L163-171)、失敗理由は一律 E642 で detail を返さない (L141-145)。公開ページは route group `(print)` の `src/app/(print)/print/documents/[id]/page.tsx` (`force-dynamic` L41 / `robots noindex` L44、middleware 保護対象外 — トークンのみが認可)。**承諾リンクは「数日〜数週間有効・閲覧は何度でも・確定操作だけ一回」なので print_tokens とは寿命・消費モデルが異なる = 別テーブルが必要**。
- **帳票メール送付**: `document_emails` 追記専用台帳 (`20260714000036_sales_document_emails.sql`) + `sendDocumentByEmail` (facade.ts:224-227) + `src/modules/sales/internal/email.ts` (Resend 直送、`fromAddress()` L30)。`isResendConfigured()` は `src/lib/env.ts:108-109`。
- **SalesDigest**: `getSalesDigest(ctx?)` (facade.ts:201)、`markExpiredQuotes(ctx)` (facade.ts:204) — crm-digest route から service 文脈で呼ばれる。

### 0.4 エラーコード帯の使用状況 (grep 全数調査)

- crm (E601-619): **E601〜E611 使用済み → 空きは E612〜E619**。
- sales (E620-649): **E620〜E627, E640〜E645 使用済み → 空きは E628〜E639, E646〜E649**。
- E840-859 は #100 メール予約済 — 本トラックでは一切使わない。
- module-contracts.md:34-57 (所有表・「エラーコード新設は本書を先に更新」)。

### 0.5 migration 採番の現状

最新は `20260715000001_customers_custom_fields.sql` / `20260715000002_customers_billing_shipping.sql`。命名は「実装日 `YYYYMMDD` + 同日連番 `0000NN` + snake 名」。本設計の採番は実装日で読み替える前提のプレースホルダ `2026XXXX0000NN` で示す。

---

## 1. #66 見積のオンライン承諾+電子署名 (高 / M)

### 1.1 目的 (1人工房でどう効くか)

隈部塗装は郵送受託・全国対応で**顧客と一度も対面しない**。現状の「承諾」は顧客から DM/メールで返事をもらい熊部さんが admin で `acceptQuote` を手動記録する二度手間で、しかも「いつ・誰が・どの版の見積に」承諾したかの証跡が残らない (残るのは admin の操作記録のみ)。見積 PDF に承諾リンクを添えて送り、顧客がスマホで記名+同意 1 タップで確定 → documents.status が自動で accepted になり、熊部さんには通知が届く。言った言わないの防止 (BtoB 試作で特に効く) と、承諾までのリードタイム短縮の両方を 1 本で取る。

### 1.2 スコープ / 非スコープ

- スコープ: 承諾リンクの発行・失効・取消 / 公開承諾ページ (見積表示+記名+同意+承諾 or 辞退) / 証跡 (記名・日時・IP・UA・対象版) / 承諾時の documents.status 自動遷移+活動記録 / 熊部さんへの即時メール通知 / 日次ダイジェストに「承諾待ちの見積」セクション。
- **非スコープ (設計判断)**: クラウドサイン/DocuSign 等の**外部電子署名ベンダー連携はしない**。v2 レポートは「同一ベンダー連携」表現だが、月額コスト+API 複雑度が 1 人工房に過剰で、見積承諾・NDA 用途は「電子サイン (同意記録型)」で法的にも実務上も足りる (当事者型の簡易電子サイン。立会人型の第三者証明は不要な取引規模)。手書きサイン画像・PDF への署名欄焼き込みもしない (証跡行+確認メールが正)。決済 (#130)・受注後の自動工程作成もしない。deal stage の自動前進もしない (1 案件複数見積がありうるため、通知を受けた熊部さんが手動で進める — 誤爆防止優先)。
- #67 と共有する基盤 (テーブル・トークン・公開 route 骨格) は本項で作る。

### 1.3 DDL 変更案 — `2026XXXX000001_sales_signature_requests.sql`

sales 所有テーブルを 1 本新設。#67 (契約) と共用するため kind 列を持つ (module-contracts.md:47 の sales 所有テーブル一覧へ追記が先)。

```sql
create table signature_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quote_acceptance', 'contract')),
  -- kind='quote_acceptance': 対象見積 (版で固定)
  document_id uuid references documents(id) on delete restrict,
  issued_document_id uuid references issued_documents(id) on delete restrict, -- 承諾対象の版を固定
  -- kind='contract' (#67): 契約 PDF と相手先
  contract_title text,
  contract_storage_path text,             -- bucket 'contracts' 内のパス
  customer_id uuid references customers(id) on delete restrict,  -- 参照 FK のみ (crm 所有は不変)
  company_id uuid references companies(id) on delete restrict,
  -- トークン (print_tokens と異なり長寿命・閲覧非消費。確定操作のみが status を落とす)
  token_hash text not null unique,        -- sha256(トークン全文) hex。print-token.ts hashPrintToken と同方式
  expires_at timestamptz not null,
  -- 状態。expired は列挙に持たない (expires_at 超過を読取時に導出 — 失効ジョブ不要の設計)
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  -- 証跡 (電子サイン)
  signed_name text,                       -- 打鍵記名 (承諾時必須 — facade 検証)
  signer_email text,                      -- 控え送付先 (任意)
  signer_comment text,
  decline_reason text,
  client_ip text,
  client_user_agent text,
  decided_at timestamptz,                 -- accepted/declined 確定日時
  -- 依頼メール送信結果 (document_emails は PDF 送付台帳のため流用しない — 本行に持つ)
  request_email_to text,
  request_email_sent_at timestamptz,
  request_email_error text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sigreq_quote_shape check (
    kind <> 'quote_acceptance'
    or (document_id is not null and issued_document_id is not null
        and contract_title is null and contract_storage_path is null)),
  constraint sigreq_contract_shape check (
    kind <> 'contract'
    or (contract_title is not null and contract_storage_path is not null
        and document_id is null and issued_document_id is null
        and num_nonnulls(customer_id, company_id) >= 1)),
  constraint sigreq_decided_shape check (
    (status in ('accepted', 'declined')) = (decided_at is not null)),
  constraint sigreq_accept_has_name check (status <> 'accepted' or signed_name is not null)
);
create trigger handle_updated_at before update on signature_requests
  for each row execute function extensions.moddatetime(updated_at);
create index sigreq_document_idx on signature_requests (document_id, created_at desc)
  where document_id is not null;
create index sigreq_pending_idx on signature_requests (status, expires_at) where status = 'pending';

alter table signature_requests enable row level security;
-- 公開ページは facade が service client で読む (print_tokens と同じ「revoke 先行 + admin のみ」規約)
create policy sigreq_admin_select on signature_requests for select using (public.is_admin());
create policy sigreq_admin_insert on signature_requests for insert with check (public.is_admin());
create policy sigreq_admin_update on signature_requests for update
  using (public.is_admin()) with check (public.is_admin());
-- DELETE ポリシーなし (証跡テーブル — 取消は status='revoked')
revoke all on signature_requests from anon, authenticated;
grant select, insert, update on signature_requests to authenticated;
```

補足: 同一見積に pending を複数作らせない一意制約は張らない (再送・期限延長 = 旧リンク revoke → 新規発行の運用。facade が発行時に既存 pending を自動 revoke する — DB 制約より単純)。

### 1.4 トークン設計 (internal/signature-token.ts 新設)

`print-token.ts` の関数群を**流用しつつドメイン分離**する:

- トークン文字列: `${signature_request_id}.${exp}.${hmac}`、`hmac = HMAC-SHA256("sig." + id + "." + exp, PRINT_TOKEN_SECRET)`。**先頭に `"sig."` を混ぜて print token と HMAC 入力空間を分離** (同一 secret 共用で env 追加なし。`computePrintTokenHmac` と衝突しない)。
- `exp` = `expires_at` の unix 秒 (既定: 見積の `valid_until` 23:59 JST、無ければ発行から 14 日。admin が発行時に変更可、上限 60 日)。
- 検証: 形式 → exp → `timingSafeEqual` → DB (`token_hash` 一致 + status/expires 判定)。**閲覧では消費しない** (print_tokens との本質差)。失敗は一律 KMB-E629・detail なし (E642 と同じ思想 — print-token.ts:141-145)。
- 確定 (承諾/辞退) は `update ... where id = ? and status = 'pending' returning` の CAS で 1 回だけ通す。

### 1.5 契約 (Zod / facade / エラーコード)

`src/modules/sales/contracts.ts` 追加:

```ts
export const SIGNATURE_REQUEST_KINDS = ["quote_acceptance", "contract"] as const;

export const zCreateQuoteAcceptanceInput = z.object({
  document_id: z.string().uuid(),
  expires_on: zDateOnly.nullable(),          // null = valid_until または +14日 (facade 既定)
  request_email_to: z.string().email().max(120).nullable(), // null = リンクのみ発行 (DM/LINE 貼付運用)
}).strict();

export const zAcceptSignatureInput = z.object({
  signed_name: zShortText(80),               // 記名必須
  agree: z.literal(true),                    // 同意チェック必須 (E630)
  signer_email: z.string().email().max(120).nullable(),
  signer_comment: z.string().max(2000).nullable(),
}).strict();

export const zDeclineSignatureInput = z.object({
  reason: z.string().max(2000).nullable(),
}).strict();

export type SignatureRequestListItem = {
  id: string; kind: "quote_acceptance" | "contract";
  status: "pending" | "accepted" | "declined" | "revoked" | "expired"; // expired は導出値
  expires_at: string; decided_at: string | null; signed_name: string | null;
  request_email_to: string | null; request_email_sent_at: string | null;
  created_at: string;
};
```

`SalesFacadeExtended` 追加 (契約外拡張の流儀 — facade.ts:162-228 と同型):

```ts
/** 発行: 見積が issued であること (draft=E621, voided 等=E623)。既存 pending は自動 revoke。
 *  request_email_to があれば Resend で署名依頼メール送信 (isResendConfigured 早期判定 E644、
 *  失敗しても発行自体は成功 — request_email_error に記録)。戻り値の url を admin がコピー可能。 */
createQuoteAcceptanceRequest(input: CreateQuoteAcceptanceInput):
  Promise<Result<{ signature_request_id: string; url: string; expires_at: string }>>;
/** 公開ページ用: トークン検証 (非消費) + 見積ビュー + 依頼状態。**表示は本リクエストが固定した
 *  issued_document_id の content_snapshot を描画する (現行版ではない) — 「見た版 = 承諾する版 =
 *  証跡の版」を常に一致させる**。resolvePrintView の読取部を版指定で内部共用。
 *  無効/期限切れ/取消済みは E629 (detail なし)。 */
resolveSignatureRequestView(token: string):
  Promise<Result<{ request: SignatureRequestListItem; view: ResolvedPrintView | null }>>;
/** 公開ページからの確定。トークン再検証 → **版固定の enforce: 対象 document の現行版
 *  (documents.current_version に対応する issued_documents 行) が本リクエストの issued_document_id
 *  と一致しなければ E628 で拒否し、当該 signature_request を自動 revoke する**
 *  (訂正発行後に顧客が旧版を承諾できてしまう穴を構造的に塞ぐ) → CAS(pending→accepted) →
 *  acceptQuote と同じ状態遷移 (canTransition + updateDocumentStatusWithCas を service 文脈で) →
 *  recordDocumentEventActivity('accepted') → 管理者通知メール + 控えメール (best effort)。 */
acceptQuoteBySignature(token: string, input: AcceptSignatureInput, meta: { ip: string | null; userAgent: string | null }):
  Promise<Result<{ decided_at: string }>>;
declineQuoteBySignature(token: string, input: DeclineSignatureInput, meta: { ip: string | null; userAgent: string | null }):
  Promise<Result<{ decided_at: string }>>;
/** admin 操作: 取消 (pending のみ。それ以外 E628) / 一覧 */
revokeSignatureRequest(signatureRequestId: string, expectedUpdatedAt: string): Promise<Result<void>>;
listSignatureRequests(filter: { document_id?: string; kind?: SignatureRequestKind; status?: string }):
  Promise<Result<SignatureRequestListItem[]>>;
```

- 確定時の documents 側 CAS: 公開ページは `expectedUpdatedAt` を持たないため、facade 内で現在の `updated_at` を読んで `updateDocumentStatusWithCas` に渡す (見積が既に declined/expired 等で `canTransition` 不可なら **E628** を返し、signature_requests 行は pending のまま残す — 管理者が状況を確認して revoke する)。
- **訂正発行時の自動 revoke**: `reviseAndReissueDocument` は status='issued' のまま `current_version` を前進させる (issued_documents は append — `20260711000027` L20) ため、**訂正発行の成功パスに「同一見積の pending な signature_requests を自動 revoke するフック」を追加する** (§1.3 補足の「発行時に既存 pending を自動 revoke」と同じ思想を訂正発行にも適用)。旧リンクを開いた顧客には無効表示 (E629 相当) になり、承諾には新リンクの再発行が必要になる。
- **エラーコード新設 (sales 帯の空き E628-631 を使用。module-contracts.md 先行更新)**:
  - `KMB-E628` 署名リクエスト状態不正 (pending でない / 対象見積が承諾可能状態でない)
  - `KMB-E629` 署名トークン無効 (形式/期限/取消/不一致 — 一律・detail なし)
  - `KMB-E630` 署名入力不正 (記名なし・同意なし)
  - (`KMB-E631` は #67 で契約ファイル系に使用 — §2)
- `SalesDigest` 拡張: `pending_acceptances: Array<{ document_id; doc_no; billing_name; expires_at; sent_at }>` を追加し、`getSalesDigest` で `status='pending' and expires_at > now()` を列挙。crm 側 `CrmDigest.sales` 型 (contracts.ts:599-608) にも同構造を複製 (「sales/contracts.ts が正、構造だけ複製」の既存流儀 L591-598)。notify.ts に「■ 承諾待ちの見積」セクション追加。**`isDigestEmpty` (crm/internal/digest.ts:16-27) の salesEmpty 判定に pending_acceptances を必ず追加する** — 現行は expiring_quotes/unpaid_invoices のみのため、追加しないと「承諾待ちだけが非空の朝」にダイジェスト送信がスキップされる。**失効ジョブは作らない** (expired は読取導出 — cron/route 変更ゼロ)。

### 1.6 画面・UI

- **公開ページ**: route group `(accept)` 新設、`src/app/(accept)/accept/[id]/page.tsx?token=...`。(print) と同じ chrome なし・`force-dynamic`・`robots noindex`・middleware 対象外 (print page.tsx:41-44 の前例)。構成: 見積シート表示 (DocumentSheet を `_components` から流用 or 簡易サマリ+「PDF を確認」) → 記名入力 + 「見積内容に同意し、発注を承諾します」チェック → [承諾する] / [辞退する (理由任意)]。確定後は完了画面 (証跡: 記名・日時を表示) + signer_email があれば控えメール。無効トークンは `notFound()` (print page と同じ倒し方)。Server Action 内でトークン再検証 (URL 直叩き対策)。IP は `headers()` の x-forwarded-for 先頭、UA は user-agent。
- **admin**: `/admin/documents/[id]` (document-detail.tsx) に「オンライン承諾」カード追加 — 発行済み quote のみ表示。中身: [承諾リンクを発行] (期限・送付先メール任意) → 発行済みならリンクコピー / 状態バッジ (承諾待ち・期限・承諾済み {記名・日時}) / [リンクを取り消す]。既存 `status-badge` / `notice-panel` / `surface` を流用。手動 `acceptQuote` ボタン (L293) は残す (電話承諾の記録用)。
- 承諾確定 → 熊部さんへ即時メール「見積 {doc_no} が {記名} 様により承諾されました」 (sendDailyDigest の宛先解決と同じ settings 経由。internal/email.ts の Resend パターン流用)。

### 1.7 受入基準

- [ ] 発行済み見積から承諾リンクを発行でき、URL コピーとメール送信の両方が選べる (メール未設定環境ではリンクのみ発行が成功する)
- [ ] リンク先で見積内容が閲覧でき、記名+同意チェックなしでは承諾ボタンが確定しない (E630)
- [ ] 承諾確定で documents.status='accepted' になり、deal タイムラインに document_event(accepted) が載り、管理者へ通知メールが飛ぶ
- [ ] 同一リンクの 2 回目の確定操作は E628、期限切れ/取消済みリンクの閲覧は 404 相当 (詳細を漏らさない)
- [ ] 辞退確定で documents.status='declined' + status_reason に理由が入る
- [ ] 証跡 (記名・日時・IP・UA・対象版 issued_document_id) が signature_requests に残り、admin から参照できる
- [ ] 日次ダイジェストに「承諾待ちの見積」が件数付きで出る (0 件なら出ない)
- [ ] 再発行すると旧リンクは revoked になり無効化される
- [ ] **承諾対象版が固定される**: リンク送付後に訂正発行すると pending リンクは自動 revoke され、仮に revoke 前に確定を試みても版不一致は E628 で拒否される。公開ページに表示されるのは常に固定版 (issued_document_id) のスナップショット

### 1.8 テスト方針

- 単体: `tests/sales-signature-token.test.ts` — トークン生成/検証の純関数 (`tests/sales-print-token.test.ts` の前例踏襲)。HMAC ドメイン分離 (print トークンを accept 側に食わせて必ず拒否) を必須ケースに。
- 単体: 状態遷移 (pending→accepted/declined/revoked、expired 導出、二重確定 CAS)。
- 結合: docker なし運用 (MEMORY: feedback-crm-db-harness) — migration 本番適用後に execute_sql で check 制約 4 本 (shape/decided/name) を違反 INSERT で検証。公開ページは Vercel preview で手動 E2E (発行→スマホ承諾→admin 反映→ダイジェスト)。

---

## 2. #67 電子契約 — BtoB 基本契約書/NDA 用途に縮小 (中 / S-M)

### 2.1 目的

BtoB 試作・D2C の継続取引で先方から求められる基本契約書・NDA を、紙+郵送や PDF メール往復ではなく #66 と同じ「リンク+記名同意」で締結する。件数は年数件 — 専用ベンダー契約 (月額) を回避しつつ、締結記録を CRM (会社/顧客タイムライン) に資産化する。

### 2.2 スコープ / 非スコープ

- スコープ: 契約 PDF のアップロード → 署名リクエスト発行 (kind='contract') → 公開ページで PDF 閲覧+記名同意 → 締結記録+タイムライン記録+控えメール。admin 一覧。
- 非スコープ: 契約書テンプレートエンジン・条項編集・複数者順次署名 (相手 1 名のみ)・更新期限リマインド・PDF への署名焼き込み。**#66 の基盤 (テーブル・トークン・公開 route・確定フロー) を再利用し、新規基盤は Storage バケットのみ**。

### 2.3 DDL — `2026XXXX000002_sales_contracts_bucket.sql`

- テーブル追加なし (§1.3 の `signature_requests` kind='contract' を使用)。
- Storage バケット `contracts` 新設 (private・service のみ書込。`issued-documents` バケットの RLS 前例踏襲)。module-contracts.md:47 の sales 行 「+Storage bucket」 に `contracts` を追記。

### 2.4 契約 (Zod / facade)

```ts
export const zCreateContractSignatureInput = z.object({
  contract_title: zShortText(120),           // 例「秘密保持契約書 (NDA)」
  media_upload_path: z.string().max(300),    // 事前アップロード済み contracts バケットパス
  customer_id: z.string().uuid().nullable(),
  company_id: z.string().uuid().nullable(),
  expires_on: zDateOnly.nullable(),          // null = +30 日
  request_email_to: z.string().email().max(120).nullable(),
}).strict().refine(v => v.customer_id !== null || v.company_id !== null,
  "相手先 (顧客か会社) が必要です (KMB-E631)");
```

- `SalesFacadeExtended` 追加: `createContractSignatureRequest(input)` / 確定・閲覧・取消・一覧は §1.5 のメソッドを kind 分岐で共用 (`resolveSignatureRequestView` は kind='contract' のとき `view: null` + 契約 PDF の署名付き URL を返す形に拡張: `contract: { title; pdf_url } | null`)。
- 締結確定時: `crmFacade.appendActivity` に **既存 `system` type** (`activities` check 済み — crm_core.sql:128-131) で「契約締結: {title}」を customer/company リンク付きで記録 (新 activity_type は増やさない — 過剰設計回避。payload は zSystemActivityPayload の範囲で)。
- **エラーコード**: `KMB-E631` 契約リクエスト入力不正 (相手先なし / storage パス不在)。他は #66 の E628-630 を共用。
- アップロード経路: 既存 `/api/upload-url` は platform facade (requireAdmin) ゲートの汎用ルートだが、`zCreateUploadUrlReq.kind` は `audio|media` のみ・バケットは `audio|media-originals` ハードコード (route.ts:37) のため**そのままでは使えない**。**platform 契約の kind enum に `'contract'` を追加し、当ルートの bucket 分岐に contracts を足す方式を採る**(fulfillment トラックが同 enum に `'attachment'` を追加するのと同一箇所 — 実装が同時期なら enum 拡張を 1 コミットにまとめる。00-統合設計.md 横断事項参照)。「media 基盤の流用」という表現は不正確のため用いない。

### 2.5 画面・UI

- `/admin/contracts` 新設 (小さな 1 ページ): data-table 一覧 (タイトル / 相手先 / 状態バッジ / 期限 / 締結日) + 「契約を送る」ダイアログ (タイトル・PDF アップロード・相手先 entity-picker・期限・送付先)。行操作: リンクコピー / 取消 / 締結記録の閲覧。サイドナビは「帳票」の隣に置く (nav-badges 追加はしない — 件数極少)。
- 公開ページは §1.6 の `(accept)` route を共用 (kind='contract' なら PDF ビューア+記名同意)。

### 2.6 受入基準

- [ ] PDF をアップロードして契約リンクを発行・送付できる
- [ ] 相手はログインなしで PDF を閲覧し、記名+同意で締結できる。証跡が残る
- [ ] 締結が相手先 (会社/顧客) のタイムラインに記録される
- [ ] 期限切れ・取消済みリンクは閲覧不可 (詳細を漏らさない)
- [ ] 見積承諾 (#66) の一覧と契約の一覧が kind で分離されて見える

### 2.7 テスト方針

- #66 のトークン/状態テストを kind='contract' ケースに拡張 (shape check 制約の違反 INSERT 検証を含む)。PDF 閲覧 URL は署名付き URL の期限内取得のみ単体検証。E2E は手動 (件数が少ない機能に自動 E2E は過剰)。

---

## 3. #71 失注理由の定型カテゴリ+集計 (高 / S)

### 3.1 目的

現状の失注理由は自由記述のみ (`deals.lost_reason` — crm_core.sql:81) で集計不能。「価格で負けたのか、納期か、対応材料外か、ロット数か」が分類できれば、グレード表 (simulator の grade×size×qty) と価格改定・対応材料拡充の投資判断に直結する。1 人工房では「感覚では価格負けだと思っていたが実は納期だった」の類の思い込み訂正が唯一の営業改善手段。

### 3.2 スコープ / 非スコープ

- スコープ: 失注カテゴリ列 (定型 enum) + 失注ダイアログの入力拡張 + 期間集計 facade + admin 分析表示。
- 非スコープ: カテゴリの DB マスタ管理 UI (**コード定数が正** — 1 人工房でマスタ画面は過剰。変更はデプロイで良い)、旧データの遡及分類 (null のまま「未分類」表示)、勝敗分析 (win 率) の高度化。

### 3.3 DDL — `2026XXXX000003_crm_deal_lost_category.sql`

```sql
alter table deals add column if not exists lost_reason_category text
  check (lost_reason_category is null or lost_reason_category in (
    'price', 'lead_time', 'material_incompatible', 'quantity',
    'quality_concern', 'competitor', 'no_response', 'customer_cancelled', 'other'));
comment on column deals.lost_reason_category is
  '失注定型カテゴリ (#71)。ラベルの正は crm/contracts.ts LOST_REASON_CATEGORIES。旧データは null=未分類';
-- 既存 check (deals_lost_requires_reason — crm_core.sql:88) は維持:
-- 新経路では category 必須 + 自由記述は任意になるため、facade が
-- lost_reason へ「自由記述 or カテゴリラベル」を必ず書き込み check を満たす (§3.4)。DDL 変更は列追加のみ
```

check 制約を書き換えない判断: `deals_lost_requires_reason` を required-category 型に差し替えると旧行 (category null) の UPDATE が全て落ちる地雷になる。列追加のみ+アプリ層で必須化が最小リスク。

### 3.4 契約 (Zod / facade)

`src/modules/crm/contracts.ts`:

```ts
export const LOST_REASON_CATEGORIES = {
  price:                 "価格",
  lead_time:             "納期",
  material_incompatible: "対応材料外",
  quantity:              "数量・ロット",
  quality_concern:       "仕上げ・品質不安",
  competitor:            "他社決定",
  no_response:           "音信不通",
  customer_cancelled:    "企画中止・自己都合",
  other:                 "その他",
} as const;
export type LostReasonCategory = keyof typeof LOST_REASON_CATEGORIES;

// zMarkDealLostInput v2 (後方互換を捨てて strict 差し替え)。markDealLostAction の呼び出しは
// **2 箇所**: DealHeaderActions.tsx:38 (案件詳細ヘッダ) と deals-kanban.tsx:97 (カンバンの
// lost 列ドロップ → handleMarkLost)。共用 LostReasonDialog (lost-reason-dialog.tsx) の
// onConfirm 署名を (category: LostReasonCategory, reason: string | null) に変更し、
// 両呼び元と kanban 側 handleMarkLost を必ず追随させる (片方だけ直すとカンバン失注が E101 で壊れる)
export const zMarkDealLostInput = z.object({
  category: z.enum(Object.keys(LOST_REASON_CATEGORIES) as [LostReasonCategory, ...LostReasonCategory[]]),
  reason: zShortText(200).nullable(),   // 自由記述は補足に降格 (category='other' のときのみ必須 — refine)
}).strict().refine(v => v.category !== "other" || (v.reason !== null && v.reason.trim().length > 0),
  "「その他」は補足の入力が必要です");

export type LostReasonStats = {
  from: string; to: string;
  total_lost: number; total_lost_jpy: number;
  by_category: Array<{ category: LostReasonCategory | null; label: string;
    count: number; amount_jpy: number }>;   // null = 未分類 (旧データ)
};
```

- `markDealLost` 実装変更 (facade.ts:1404 周辺): `lost_reason_category` を保存し、`lost_reason` には `reason ?? LOST_REASON_CATEGORIES[category]` を書く (既存 DB check を必ず満たす)。activity タイトルにカテゴリラベルを含める (「失注 (価格)」)。
- facade 追加: `getLostReasonStats(filter: { from: zDateOnly; to: zDateOnly }): Promise<Result<LostReasonStats>>` — `stage='lost' and updated_at between` の group by。件数が少ない工房規模では index 追加不要 (`deals_stage_idx` — crm_core.sql:99 で足りる)。
- `DealDetail` に `lost_reason_category` 追加 (contracts.ts:544-550)。
- **新エラーコードなし** (入力不正は既存 E101、対象不正は既存 E602/E603 で足りる)。

### 3.5 画面・UI

- `LostReasonDialog` (src/app/admin/deals/lost-reason-dialog.tsx) をカテゴリ選択 (pill-toggle or select) + 補足自由記述 (other のみ必須) に変更。**このダイアログは案件詳細ヘッダとカンバン lost 列ドロップの両方から使われる共用コンポーネント** — onConfirm 署名変更に伴い `deals-kanban.tsx:97` の handleMarkLost も改修し、カンバン経由の失注でもカテゴリ選択が必須になることを I-1 スコープに含める。
- `/admin/deals` に「分析」タブ追加 (underline-tabs — 既存一覧/カンバンの並び)。中身: 期間セレクタ (今月/四半期/全期間) + カテゴリ別の件数・金額バーリスト (`meter-bar.tsx` 流用)。#80 の紹介ランキング (§5.5) と同居させ「分析」タブ 1 枚に集約。
- 案件詳細の失注表示 (DealStageSummary 周辺) にカテゴリバッジ追加。

### 3.6 受入基準

- [ ] 失注操作でカテゴリ選択が必須になり、「その他」のみ自由記述必須
- [ ] 旧失注案件 (カテゴリ null) が「未分類」として集計・表示される
- [ ] 分析タブでカテゴリ別の件数と金額 (amount_jpy 合計) が期間指定で見える
- [ ] DB 直 UPDATE 等の迂回でも既存 `deals_lost_requires_reason` check が破れない (lost_reason 書込は維持)
- [ ] 失注→再開 (#102) してもカテゴリ・理由は履歴として列に残る (現行 lost_reason の扱いと同一)

### 3.7 テスト方針

- 単体: zMarkDealLostInput の refine (other+空補足拒否)、lost_reason 合成規則 (reason null → カテゴリラベルが入る)。
- 集計: getLostReasonStats の group/合計をシード済みデータで検証 (execute_sql)。UI は手動確認。

---

## 4. #89 停滞案件アラート (高 / S)

### 4.1 目的

郵送受託は「見積を送って返事待ち」「写真を送って確認待ち」の**待ち状態が構造的に多い**。1 人で製作しながらだと追客が飛ぶ。毎朝 7 時の既存ダイジェスト (20260711000024 — JST 07:00) に「動きが止まっている案件」を並べ、見積往復の途切れ=静かな失注を防ぐ。

### 4.2 スコープ / 非スコープ

- スコープ: 停滞判定 (最終活動からの経過日数、ステージ別しきい値) / CrmDigest への 1 セクション追加 / 案件一覧への最終活動日時列+停滞バッジ。
- 非スコープ: 新テーブル・新 cron (**既存 collectDigest 拡張のみ**)、しきい値の設定 UI (コード定数 — 1 人工房)、リアルタイム/プッシュ通知、自動フォローメール送信 (#100 域)。

### 4.3 DDL

**なし**。最終活動は `activity_links (deal_id) → activities.occurred_at` の max で導出 (crm_core.sql:157-175 の既存 index で十分。工房規模の件数では lateral join で問題ない)。活動が 1 件もない案件は `deals.created_at` を最終活動とみなす。

### 4.4 契約 (Zod / facade)

`src/modules/crm/contracts.ts`:

```ts
/** 停滞しきい値 (日)。コード定数が正 (設定 UI は作らない)。won 系は物理工程が
 *  scheduling の work_blocks で管理されるため対象外とし、商談中 3 ステージのみ見る */
export const DEAL_STALL_THRESHOLDS: Partial<Record<DealStage, number>> = {
  inquiry: 3,        // 相談に 3 日返事していない
  estimating: 5,     // 見積作成に 5 日かかっている
  quote_sent: 7,     // 見積送付後 7 日返事がない
};

export type StalledDealItem = {
  deal_id: string; title: string; customer_name: string;
  stage: DealStage; last_activity_at: string; idle_days: number;
};

export type CrmDigest = {
  // 既存 4 フィールド (contracts.ts:599-608) + 追加:
  stalled_deals: StalledDealItem[];   // idle_days 降順、上限 20 件
  ...
};
```

- `collectDigest` (facade.ts:1851) に停滞収集を追加。`isDigestEmpty` (internal/digest.ts:16) の判定対象にも追加。
- `notify.ts` に「■ 停滞している案件 (N 件)」セクション追加 — `- {title} {customer_name} 様 ({stage ラベル}のまま {idle_days} 日)` 形式 (L53-70 の既存セクションと同型)。行末に admin 案件 URL。
- `DealListItem` に `last_activity_at: string | null` を追加し `listDeals` で導出列として返す (一覧の停滞バッジ用)。カンバン (DealKanbanColumn — contracts.ts:553-557) は既存 DealListItem を包含するため自動で載る。
- **新エラーコードなし** (読み取り専用集計)。

### 4.5 画面・UI

- `/admin/deals` 一覧: 「最終活動」列追加 + しきい値超過行に `status-badge` (「停滞 N 日」/ amber 系トークン)。カンバンカードにも同バッジ。
- ダッシュボードの CrmDashboardKpi は変更しない (KPI 追加は nav-badges/R6 の設計を乱すため見送り — ダイジェストと一覧バッジで十分)。

### 4.6 受入基準

- [ ] quote_sent のまま 7 日以上活動がない案件が翌朝のダイジェストに載る
- [ ] 活動 (note 追記・帳票発行・通話等) があると last_activity_at が更新され停滞から外れる
- [ ] 活動が 1 件もない新規案件は created_at 起点で判定される
- [ ] paid / lost / won 系 (ordered 以降) の案件は停滞対象にならない
- [ ] 停滞 0 件かつ他セクションも空ならダイジェスト送信自体がスキップされる (isDigestEmpty 既存挙動の維持)
- [ ] 一覧・カンバンに「停滞 N 日」バッジが出る

### 4.7 テスト方針

- 単体: 停滞判定の純関数 (しきい値表 × stage × 経過日数、JST 日数計算は internal/jst.ts 流用)。
- digest: collectDigest の停滞クエリを、シードした activities/activity_links で検証 (execute_sql)。notify 本文は既存 digest テストの形式に節を足す。

---

## 5. #80 紹介元 (リファラル) トラッキング (高 / S)

### 5.1 目的

造形コミュニティは作家同士の紹介と X 上の言及で仕事が回る。「誰の紹介か」を顧客に紐付けて資産化すると、(a) 紹介してくれる作家 (ハブ人材) が誰か分かり優遇・お礼の判断ができる、(b) 紹介経由の成約率・金額が見え、広告よりコミュニティ投資が効くことを数字で確認できる。#18 (UTM/流入元 — 別トラック) が「どのチャネルから来たか」を見るのに対し、本項は「**どの人から来たか**」を見る。責務が重ならないよう本項は人物参照 (customers 自己 FK) に限定する。

### 5.2 スコープ / 非スコープ

- スコープ: customers への紹介元 2 列 (紹介者 FK + 経緯メモ) / 顧客フォーム・詳細の紹介 UI / マージ RPC の補完統合 / 紹介ランキング集計。
- 非スコープ: 紹介報酬・クーポン管理、deal 単位の紹介元 (顧客単位で持てば案件は顧客経由で辿れる — 二重管理を避ける)、#18 の UTM/チャネル計測、紹介リンク (トラッキング URL) 発行。

### 5.3 DDL — `2026XXXX000004_crm_customer_referral.sql`

```sql
alter table customers
  add column if not exists referrer_customer_id uuid references customers(id) on delete set null,
  add column if not exists referral_note text;
alter table customers drop constraint if exists customers_no_self_referral;
alter table customers add constraint customers_no_self_referral
  check (referrer_customer_id is null or referrer_customer_id <> id);
comment on column customers.referrer_customer_id is
  '紹介元の顧客 (#80)。自己参照禁止は check、循環 (A→B→A) は禁止しない (実務上ありうる相互紹介)';
create index customers_referrer_idx on customers (referrer_customer_id)
  where referrer_customer_id is not null;

-- crm_merge_customers 全文差し替え (**基準は現行本体 = 20260715000002_customers_billing_shipping.sql:45-128**。
--   billing_info/shipping_info/custom_fields の既存 coalesce を全て保持したまま追記する —
--   000001 版を基準にすると #113 のブロック補完が退行する):
--   winner.referrer_customer_id が null なら loser の値を採用 (referral_note も同様)。
--   さらに「他の顧客の referrer_customer_id = loser」の行を winner へ付け替える UPDATE を追加
--   (merged_into 終端辿り (§6.4) と同じ思想 — 紹介実績がマージで消えない)。
--   ただし付け替えの結果 自己参照になる行 (winner 自身が loser の紹介だった等) は null に倒す。
```

### 5.4 契約 (Zod / facade)

```ts
// zCustomerInput / zCustomerUpdateInput (contracts.ts:43-57) に追加:
referrer_customer_id: z.string().uuid().nullable(),
referral_note: z.string().max(500).nullable(),
// .refine は付けない (自己参照は id 未確定の create 時に判定不能 — repository/DB check + E612 翻訳)

export type ReferralStats = {
  referrers: Array<{
    customer_id: string; name: string;
    referred_count: number;          // 紹介した顧客数
    won_deal_count: number;          // 紹介先顧客の won (ordered 以降到達) 案件数
    paid_amount_jpy: number;         // 紹介先顧客の paid 案件 amount_jpy 合計
  }>;  // referred_count 降順、上限 50
};
```

- facade: `getReferralStats(): Promise<Result<ReferralStats>>` (読み取り専用集計)、`CustomerDetail` に `referrer: { id; name } | null / referral_note / referred_customers: Array<{ id; name }>` を追加。
- update 時の自己参照・存在しない紹介元は **`KMB-E612` (紹介元不正)** に翻訳 (crm 帯の次の空き番号。module-contracts.md 先行更新)。DB check `customers_no_self_referral` 違反もここへ翻訳。
- won 判定は `DEAL_STAGE_REGISTRY.isWon` (contracts.ts:29-41) が正 — SQL 側にステージ集合を複製する場合は registry 由来の定数をバインドして渡す (registry の SQL 複製禁止は crm_deal_reopen migration の設計判断と同旨)。

### 5.5 画面・UI

- 顧客フォーム (customers/new, customers/[id] の編集シート): 「紹介元」entity-picker (顧客検索 — `_ui/entity-picker.tsx` 流用) + 経緯メモ 1 行 (「X の @xxx 経由」「イベントで○○さんから」)。
- 顧客詳細: 「紹介」カード — 紹介元リンク / この顧客が紹介した顧客リスト (referred_customers)。
- `/admin/deals` の「分析」タブ (§3.5 と同居) に「紹介ランキング」表: 紹介者名 / 紹介数 / 成約数 / 入金合計。data-table 流用。
- inquiry 取込 (intake) は変更しない — 紹介は取込後に熊部さんが会話で知る情報のため手入力で足りる (フォーム項目追加は intake-comms-foundation / #18 側の判断に委ねる)。

### 5.6 受入基準

- [ ] 顧客に紹介元顧客と経緯メモを設定・変更・解除できる
- [ ] 自分自身を紹介元に選べない (E612)
- [ ] 顧客マージで紹介情報が消えない (winner 空欄補完 + 紹介先の付け替え + 自己参照化の無害化)
- [ ] 分析タブで紹介者ごとの紹介数・成約数・入金合計が見える
- [ ] 紹介元に設定された顧客を削除/アーカイブしても参照が壊れない (on delete set null)

### 5.7 テスト方針

- 単体: Zod 入力、E612 翻訳。
- RPC: crm_merge_customers 差し替えの 3 ケース (空欄補完 / 紹介先付け替え / 自己参照化 null 倒し) を execute_sql で検証 (20260715000001 のとき検証した観点構成を踏襲)。
- 集計: getReferralStats をシードデータで検証。

---

## 6. 横断事項

### 6.1 エラーコード新設まとめ (実装前に module-contracts.md 改訂が先)

| コード | モジュール | 意味 |
|---|---|---|
| KMB-E612 | crm (空き E612-619 の先頭) | 紹介元不正 (自己参照/不存在) |
| KMB-E628 | sales (空き E628-639 の先頭) | 署名リクエスト状態不正 |
| KMB-E629 | sales | 署名トークン無効 (一律・detail なし) |
| KMB-E630 | sales | 署名入力不正 (記名/同意) |
| KMB-E631 | sales | 契約リクエスト入力不正 (#67) |

※ growth 統合の全体割当 (00-統合設計.md) で確定済み: crm 帯は E612=本トラック紹介元 / E613-E614=commerce (匿名化系) / E615-E616=x-community (親子案件・クラファン)。sales 帯は E628-E631=本トラック / E632-E639+E646=commerce (決済・督促・仕訳)。この表が正 — 再採番不要。

### 6.2 migration 採番 (実装日読み替え。適用順は依存どおり)

1. `2026XXXX000001_sales_signature_requests.sql` (#66)
2. `2026XXXX000002_sales_contracts_bucket.sql` (#67 — 1 の後)
3. `2026XXXX000003_crm_deal_lost_category.sql` (#71 — 独立)
4. `2026XXXX000004_crm_customer_referral.sql` (#80 — 独立)
5. #89 は migration なし

### 6.3 #100 (メール統合) との競合回避

- 新テーブルは `signature_requests` のみで、#100 予約の `emails` / `email_attachments` と無関係。E840-859 は不使用。
- 署名依頼・承諾通知・控えメールは sales/internal/email.ts (Resend 直送) の**送信パターン流用** (新規メール基盤は作らない)。#100 M2 以降で送信経路が emailFacade に一本化される際は、他の Resend 直送箇所と同時に移行する (本設計では送信結果を signature_requests 行に持つため、移行時も台帳競合が起きない)。
- 停滞アラートは既存 digest メールへの追記のみ (新規送信経路なし)。

### 6.4 1 人工房ガード (過剰設計の明示的排除)

担当者/承認フロー/権限ロールは一切追加しない。カテゴリ・しきい値はコード定数。外部署名ベンダー・Webhook・失効 cron・設定画面を作らない。新規画面は `/admin/contracts` の 1 枚と公開 `(accept)` の 1 route のみ。

---

## 7. Issue 分割案 (1 Issue = 1 PR)

| # | タイトル案 | 含む項目 | 依存 | 規模 |
|---|---|---|---|---|
| I-1 | crm: 失注理由の定型カテゴリ+案件「分析」タブ (migration+markDealLost v2+集計) | #71 | なし | **S** |
| I-2 | crm: 停滞案件アラート — 日次ダイジェスト拡張+一覧の最終活動列 | #89 | なし (I-1 と並列可) | **S** |
| I-3 | crm: 紹介元トラッキング — customers 2 列+マージ統合+紹介ランキング | #80 | I-1 (「分析」タブの土台に相乗り。タブ自体を I-3 先行で作るなら依存解消可) | **S-M** |
| I-4 | sales: 電子署名基盤+見積オンライン承諾 (signature_requests+公開 accept ページ+承諾待ちダイジェスト) | #66 | intake-comms-foundation (署名依頼メール。Resend 直送 fallback で先行着手可) | **L** |
| I-5 | sales: 電子契約 (BtoB 基本契約/NDA) — kind='contract' 拡張+/admin/contracts+contracts バケット | #67 | I-4 | **M** |

- 推奨着手順: I-1 → I-2 → I-3 (crm 小粒 3 連、即日効果) と並行して I-4 → I-5 (sales 系)。
- 各 Issue の PR チェックリストに「module-contracts.md・DDL・contracts.ts の 3 点一致」(module-contracts.md:1865) と、新設エラーコードの本書先行更新を含めること。
- I-4 は内部をさらに割るなら「(a) テーブル+トークン+facade / (b) 公開ページ+admin カード+digest」の 2 PR も可だが、(a) 単体では検証可能な業務価値が無いため 1 PR を推奨。
