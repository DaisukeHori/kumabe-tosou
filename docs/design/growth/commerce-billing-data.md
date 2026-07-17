# トラック詳細設計: 商務系(決済・会計・請求・CSV/データ入出力)

- track key: `commerce-billing-data`
- 対象: #130 決済リンク / #131 オンライン決済処理 / #134 未入金請求書の自動督促 / #135 会計ソフト連携(freee/MF) / #136 支払スケジュール(二段払い) / #137 CSV一括インポート/エクスポート / #150 定期スケジュールエクスポート / #146 データポータビリティ/削除請求
- 依存トラック: `intake-comms-foundation`(#134 の顧客宛メール送信が Track1 の送信基盤を前提。ただし現状でも sales には Resend 送信実装が存在するため、最悪単独でも成立する — §3.3)
- 前提: 1人工房。過剰設計禁止。担当者/ロール系は凍結。#100 メール統合(08-email.md v2 / emails・email_attachments / KMB-E840-859)とは重複させない — 本トラックの督促・支払リンクメールは既存の sales 送信台帳(document_emails)を拡張して使い、#100 完成後に送信実体を EmailFacade へ差し替え可能な形に留める。

---

## 1. v2 レポートの該当判定(根拠)

hubspot-gap-report-v2.md より(§2.6 コマース/請求・§2.7 オペレーション/データ基盤):

| # | 機能 | 現行 | 価値 | 規模 |
|---|---|---|---|---|
| 130 | 決済リンク | 無 | **高** — 顔の見えない遠隔 BtoC 取引でカード決済は標準期待。銀行振込オンリーは作家層の離脱要因 | M |
| 131 | オンライン決済処理 | 無(手動記録) | **高** — #130 と同根。EC 的な購買体験が全国受託の信頼装置 | M |
| 134 | 未入金請求書の顧客宛自動督促 | 無(内部ダイジェストのみ) | **高** — 集計ロジック・メール基盤とも既存。顧客宛送信を足すだけ | S |
| 135 | 会計ソフト連携 | 無 | **高** — 請求・入金の二重入力排除 | M |
| 136 | 支払スケジュール管理 | 無(入金複数記録は可) | 中 — ブリッジ生産の前受金/納品時残金の二段払い用途に縮小 | M |
| 137 | CSV一括インポート/エクスポート | 無(csv 文字列すら無し) | **高** — データ移行・バックアップ・税理士連携の基本。エクスポートは S | S〜M |
| 150 | 定期スケジュールエクスポート | 無 | 中 — #137 後は cron 追加のみ | S |
| 146 | データポータビリティ/削除請求 | 無 | 中 — 個人情報保護法の開示・削除請求への備え | M |

---

## 2. 現状調査(実コード。すべて確認済み・推測なし)

### 2.1 入金・請求の現行モデル(sales)

- **payments テーブル**: `supabase/migrations/20260711000026_sales_core.sql:221-231`。列は `document_id / paid_on / amount_jpy / method / memo / created_by / created_at`。`method` は **check (method in ('bank_transfer', 'cash', 'other'))`(:226)** — カード決済の語彙が無い。UPDATE grant なし(不変。訂正 = DELETE+再INSERT、:304)。消込トリガ `payments_apply`(:240-291)が残高超過拒否(KMB-E625)と documents.status paid⇔issued を維持。
- **documents テーブル**: 同 migration :17-63。`issue_date / transaction_date / valid_until(quote のみ)/ paid_at` はあるが **支払期限(due date)列が存在しない** — 督促(#134)・支払予定(#136)の土台が無い。voided ガード(:88-92)は入金記録がある invoice の取消を DB レベルで拒否。
- **契約**: `src/modules/sales/contracts.ts:82-88` `zPaymentInput`(method enum は DB check と 1:1)。`DocumentDetail.payments / balance_jpy`(:329-341)。`SalesDigest.unpaid_invoices`(:344-347)— 未消込請求の内部集計は実装済み。
- **facade**: `src/modules/sales/facade.ts:132-160` `SalesFacade`(recordPayment / issueDocument / createSignedPdfUrl 等)、:162-230 `SalesFacadeExtended`(deletePayment / getSalesDigest / markExpiredQuotes / sendDocumentByEmail)。`getSalesDigest(ctx?)` と `markExpiredQuotes(ctx)` は「ctx 都度渡し」方式(cron から service 文脈で呼ぶ設計、:200-206 コメント)。
- **入金 UI(R4a)**: `src/app/admin/documents/open-payment-flow.ts:1-50`(一覧行の「入金」→ PaymentDialog 起動の非同期制御・単体テスト可能な依存注入)/ `list-payment-context-action.ts:24-40`(balance_jpy・deal_updated_at を read 合成)。残高プリフィル済みの入金ダイアログが既にある。

### 2.2 メール送信・督促の既存資産

- **Resend 送信実体**: `src/modules/sales/internal/email.ts`(fromAddress は NEXT_PUBLIC_SITE_URL のホスト名から導出 :31-38、PDF 添付送信、E644 写像)。`src/lib/env.ts:38` RESEND_API_KEY(任意設定)+ `isResendConfigured()`(:108)。
- **送信台帳**: `supabase/migrations/20260714000036_sales_document_emails.sql:14-28` `document_emails`(追記専用・成功/失敗とも記録・issued_document_id で版を特定)。
- **日次ジョブ**: `supabase/migrations/20260711000024_crm_digest_cron.sql:28-39` — pg_cron `kmb-crm-digest-worker`(毎日 22:00 UTC = 朝 7:00 JST)→ net.http_post → `/api/jobs/crm-digest`。route は `src/app/api/jobs/crm-digest/route.ts`:32-39 で x-jobs-secret 検証 → `after()` で markExpiredQuotes → collectDigest → getSalesDigest 合成 → 送信。**「日次で未入金請求を列挙して何かする」枠組みは既に動いている**。
- **digest 純計算**: `src/modules/crm/internal/digest.ts:17-27` isDigestEmpty(sales 対応済み)。

### 2.3 CSV・Stripe・支払期限の不在(グレップ確認)

- `grep -ril csv src/` → **0 件**。`grep -rn stripe src/ package.json` → **0 件**。レポートの「csv 文字列すら無し」「手動記録のみ」判定は正しい。

### 2.4 顧客・設定・公開ページの流用元

- **顧客請求先/配送先(#113 実装済)**: `supabase/migrations/20260715000002_customers_billing_shipping.sql:22-24` customers.billing_info / shipping_info jsonb。CSV 入出力(#137)の列設計に含める。
- **settings レジストリ**: `src/modules/settings/contracts.ts:160-175` `SETTINGS_SCHEMAS`(company / invoice_issuer(:101 銀行口座・税丸め)/ notifications 等 11 キー)。新キー追加はここに 1 エントリ足す方式。anon 可読は許可リスト方式(module-contracts.md:350)なので新キーは既定で非公開 — 安全。
- **公開トークンページの前例**: `src/app/(print)/print/documents/[id]/page.tsx` + print_tokens ワンタイム消費(contracts.ts:349-361)。決済リンクの公開支払ページ(§3.2)はこの「route group + トークン検証」型を踏襲(ただし決済リンクは複数回アクセス可のため消費はしない)。
- **admin UI 共通小物**: `src/app/admin/_ui/`(page-header / data-table / status-badge / surface / underline-tabs / pill-toggle / notice-panel / jst-format 等)。新画面はこの語彙のみで組む。

### 2.5 エラーコードの空き番

- 割当済み(`docs/design/crm-suite/00-overview.md:419-432`): sales は E620-627(帳票)+ E640-645(PDF/メール)。**空き: E628-639, E646-649**。crm は E601-611 使用済 → **空き: E612-619**。
- **growth 統合の全体割当(00-統合設計.md が正)**: sales 空き枠のうち **E628-E631 は並行トラック sfa(電子署名)が使用**するため、本トラックは **E632-E639 + E646** を使う。crm 空き枠のうち E612 は sfa(紹介元)が使用するため、本トラックの匿名化系は **E613/E614**。
- E840-859 は #100 メールで予約済(使用禁止)。ただし**この予約は 08-email.md 由来の外部事実で、00-overview §3.3 の帯予約表(:456)には現時点で記載が無い** — dataio 帯追記時に E840-859 も併記すること。E860-879 は並行トラック outreach が取るため、**新モジュール dataio には E880-E899 を新設割当**(seo は E740-759)。module-contracts.md §「エラーコードの新設は所有モジュールの契約変更として本書を先に更新」に従い、実装 Issue の冒頭タスクに契約書改訂(07-contracts-delta 経由)を含める。

### 2.6 migration 採番

現行 39 本、`YYYYMMDD0000NN` の日付ベース(最新 20260715000002)。本設計の migration は実装日の日付で採番する(以下では `2026XXXX0000NN_名称.sql` と仮置き)。適用運用は docker 無し・本番適用後 execute_sql 検証(MEMORY.md 方針)。

---

## 3. 項目別設計

実装順序の骨格(依存順): **#136 → #130/#131 → #134**(請求・入金系。due_on と支払予定が決済リンク・督促の前提)/ **#137前半(エクスポート) → #135, #137後半(インポート), #150, #146**(データ入出力系。CSV 基盤が先)。2 系統は互いに独立で並行可。

### 3.1 #136 支払スケジュール管理(前受金/納品時残金の二段払い)+ 請求書支払期限

#### 目的(1人工房でどう効くか)
BtoB 試作・D2C の高額案件で「着手前に 50% 前受、納品時に残金」を請求書 1 枚で運用できる。現行でも部分入金の記録自体は可能(payments 複数行)だが、「いつ・いくら入る予定か」がどこにも無いため、督促(#134)も決済リンク(#130)も金額の根拠を持てない。due_on(支払期限)はこのトラック全体の土台。

#### スコープ / 非スコープ
- スコープ: documents.due_on 列(invoice のみ)/ 支払予定テーブル(最大 4 行、実用は 2 行 = 前受金+残金)/ 発行時の due_on 既定値(支払条件設定)/ 入金ダイアログの既定額を「次の未消込予定額」へ/ digest の unpaid_invoices に期日表示。
- 非スコープ: 工事型の三段払い UI 特化(予定行の追加で表現可能)/ 予定と入金の厳密な引当(FIFO みなし consumption のみ)/ 請求書の自動分割発行。

#### DDL 変更案 — `2026XXXX0000NN_sales_payment_schedule.sql`
```sql
alter table documents add column if not exists due_on date;         -- 支払期限 (invoice のみ)
alter table documents add constraint documents_due_on_invoice_only
  check (due_on is null or doc_type = 'invoice');

-- ★必須: 0026:145-154 は revoke all 後に「列挙した列のみ」の UPDATE grant を与えている。
--   due_on / dunning_paused_at (§3.3) を列挙に足さないと admin セッション (authenticated) からの
--   UPDATE が permission denied になる (freeze トリガは due_on を凍結しないので通過するが grant が壁):
grant update (due_on, dunning_paused_at) on documents to authenticated;
-- (dunning_paused_at 列の追加は §3.3 の migration だが、grant は各列追加と同一 migration 内で行う)

create table document_payment_schedules (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade, -- draft 削除に追従
  position int not null check (position >= 0),
  label text not null,                       -- '前受金' / '残金' など (max20 は Zod)
  due_on date not null,
  amount_jpy bigint not null check (amount_jpy > 0),
  created_at timestamptz not null default now(),
  unique (document_id, position)
);
-- RLS: 既存全 migration の教訓 (0026:142-144) どおり revoke 先行 + 明示 grant を必ず書く
--   (default privileges の ALL grant が残ると「UPDATE なし = 不変」の意図が無効化される):
alter table document_payment_schedules enable row level security;
revoke all on document_payment_schedules from anon, authenticated;
grant select, insert, delete on document_payment_schedules to authenticated;  -- UPDATE なし (置換 = 全削除+再挿入)
-- + admin 3 ポリシー (select/insert/delete、is_admin())
-- Σamount = documents.total_jpy の検証は facade (E637)。DB trigger は張らない (過剰設計回避。
-- 発行後の total 凍結 (E624) 済みのため、issued 中の予定置換時に facade 検証で十分)。
```

#### 契約(sales — contracts.ts 追記)
```ts
export const zPaymentScheduleEntry = z.object({
  label: zShortText(20),                    // 既定プリセット: '前受金' / '残金'
  due_on: zDateOnly,
  amount_jpy: zJpyAmount.refine(v => v > 0),
}).strict();
export const zSetPaymentScheduleInput = z.object({
  entries: z.array(zPaymentScheduleEntry).min(1).max(4), // 空配列は setPaymentSchedule(null) で予定解除
}).strict();
```
- facade(SalesFacadeExtended 追記):
  - `setPaymentSchedule(documentId, input: SetPaymentScheduleInput | null, expectedUpdatedAt): Promise<Result<{updated_at: string}>>` — **issued(未完済)の invoice のみ**(E638)。**draft は対象外**とする: draft の total_jpy は保存ごとに再計算され document_save_draft RPC は schedules を再検証しないため、予定設定後の明細編集で Σentries=total(E637)が黙って崩れる。二段払いは発行後運用が主目的なので issued 限定が素直。Σentries ≠ total_jpy は **E637**。期日昇順でない場合も E637。置換は DELETE+INSERT。
  - `updateInvoiceDueOn(documentId, dueOn: string | null, expectedUpdatedAt)` — issued 後も変更可(支払条件の合意変更は実務で起きる。帳票面には印字しない列のため E624 の「内容凍結」に抵触しない — 凍結対象は明細・金額・宛名)。**書き込み経路**: 上記の列単位 UPDATE grant(due_on)により admin セッションの素の UPDATE で実行できる(grant を落とすと permission denied — M1 対応済み)。
  - `DocumentDetail` に `due_on: string | null` と `schedule: Array<{position; label; due_on; amount_jpy; settled_jpy}>` を追加。`settled_jpy` は Σ入金を position 昇順に FIFO 充当した派生値(facade 算出・保存しない)。
- 発行時既定: `issueDocument` 内で invoice かつ due_on null なら `issue_date + billing.payment_terms_days`(§設定)で補完。**機構の注意**: documents への実書き込みは security definer RPC `document_save_draft`(0026:310-381、7 引数固定 — その UPDATE 文に due_on は無い)経由のため、発行時補完は (a) finalize/issue 系 RPC に due_on 引数を追加して RPC 内で書く、または (b) issueDocument の成功後に上記 grant 済みの列 UPDATE を 1 回発行する、のいずれかで実装する(C1 の DDL タスクに明記。既定は (b) — RPC 改訂を避け最小差分)。
- settings 新キー `billing`(SETTINGS_SCHEMAS 追記):
```ts
export const zBillingSettings = z.object({
  payment_terms_days: z.number().int().min(0).max(180), // 既定 30
  deposit_default_percent: z.number().int().min(0).max(100), // 前受金既定比率 (UI プリセット用。0 = 使わない)
}).strict();
```
- エラーコード: **E637**(支払予定が不正: 合計不一致/期日順序/行数)、**E638**(支払予定・期限を変更できない状態: draft/完済/void/quote 等)。00-overview §3.3 と module-contracts の帯表更新が先(E632-E636 は §3.2 決済系 — sfa の E628-E631 とは統合割当で分離済み)。

#### 画面・UI(既存語彙)
- 請求書詳細(`admin/documents/[id]`)に Surface「支払予定」セクション: 予定行テーブル(label / 期日 / 金額 / 消込状況 StatusBadge)+「二段払いにする」ボタン(deposit_default_percent で 前受金/残金 を自動プリフィル)。draft 編集画面には due_on フィールド追加。
- PaymentDialog: 既定額を「残高」から「次の未消込予定額(予定が無ければ残高)」へ。list-payment-context-action.ts の ListPaymentContext に `next_scheduled_amount_jpy: number | null` を足すだけ(open-payment-flow.ts の制御は不変)。
- 一覧(documents-table): 期日超過の invoice に StatusBadge「期日超過」(JST 比較は _ui/jst-format.ts の語彙)。

#### ジョブ・自動化
なし(#134 が消費する)。ただし `SalesDigest.unpaid_invoices` に `due_on / next_due_on` を追加し、朝のダイジェストが期日ベースで並ぶようにする。

#### 受入基準
- [ ] invoice 発行時、due_on 未指定なら issue_date + payment_terms_days が自動設定される
- [ ] 「二段払いにする」で前受金/残金の 2 行が total と一致する金額で生成され、Σ不一致の手動編集は E637 で拒否される
- [ ] 前受金の入金記録後、PaymentDialog の既定額が残金の予定額になる
- [ ] draft・完済済み invoice への setPaymentSchedule が E638 で拒否される(予定は issued 未完済のみ)
- [ ] admin セッションから due_on が更新できる(列 grant の実効性 — permission denied にならない)
- [ ] quote/order/delivery に due_on を設定しようとすると DB check + facade 双方で拒否される
- [ ] 朝ダイジェストの未入金一覧に期日が表示され、期日超過が先頭に来る

#### テスト方針
- 単体(node): FIFO 充当(settled_jpy)の純関数、Σ検証・期日順序の Zod/facade ガード、発行時 due_on 補完(JST 境界)。
- 契約 parity: zPaymentScheduleEntry ↔ DDL check(amount>0)の 1:1。
- 手動 E2E: 発行→予定設定→前受金入金→残金入金→paid 遷移(payments_apply トリガとの整合)。

---

### 3.2 #130 決済リンク + #131 オンライン決済処理(Stripe)

一体で設計する(#131 は #130 の裏面)。

#### 目的
遠隔 BtoC(造形作家・ガレキ)で「請求書 PDF + 銀行振込」だけだと決済ハードルが高い。請求書からワンクリックで発行できる支払 URL をメールに貼り、顧客はカードで支払い、入金は webhook で自動記録・自動消込される。1人工房にとっては「入金確認と消込作業の消滅」+「振込待ちの日数短縮」。

#### プロバイダ選定と方式
- **Stripe**(実装資産・ドキュメント・日本のカード対応で事実上一択。手数料 3.6%)。npm 依存 `stripe` を新規追加(このトラック唯一の新規依存)。
- Stripe の静的 Payment Links ではなく **自前トークン URL `/pay/[token]` → アクセス時に Checkout Session を都度生成してリダイレクト**する方式を採る。理由: (a) Checkout Session の URL は 24h で失効するがメールに貼る URL は失効させたくない、(b) クリック時点の残高で金額を確定できる(先に一部振込があっても二重請求にならない)、(c) 支払済みリンクを開いたら「お支払い済みです」を出せる。print_tokens の公開トークンページ前例(§2.4)と同型(ただし再アクセス可)。

#### DDL 変更案 — `2026XXXX0000NN_sales_payment_links.sql`
```sql
create table payment_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),   -- invoice のみ (facade 検証 E632)
  token text not null unique,                           -- 32byte random base64url (推測不能。HMAC 不要 — DB 照合)
  kind text not null default 'balance'
    check (kind in ('balance', 'schedule', 'fixed')),   -- 残高全額 / 支払予定行 / 固定額
  schedule_position int,                                -- kind='schedule' のとき対象行
  fixed_amount_jpy bigint check (fixed_amount_jpy is null or fixed_amount_jpy > 0),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'completed')),
  stripe_last_session_id text,                          -- 直近に生成した Checkout Session (診断用)
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index payment_links_document_idx on payment_links (document_id);

alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('bank_transfer', 'cash', 'other', 'card'));
alter table payments add column if not exists stripe_payment_intent_id text unique; -- webhook 冪等キー
-- RLS: revoke 先行 + 明示 grant (0026:142-144 の教訓を踏襲):
alter table payment_links enable row level security;
revoke all on payment_links from anon, authenticated;
grant select, insert on payment_links to authenticated;
grant update (status, disabled_at) on payment_links to authenticated;  -- delete なし
-- + admin ポリシー。公開ページは service ロールで token 照合 (anon への grant はしない — API route 経由)。
```

#### 契約(sales)
```ts
export const zCreatePaymentLinkInput = z.object({
  document_id: z.string().uuid(),
  kind: z.enum(["balance", "schedule", "fixed"]),
  schedule_position: z.number().int().min(0).nullable(),
  fixed_amount_jpy: zJpyAmount.refine(v => v > 0).nullable(),
}).strict();
export const zOnlinePaymentEvent = z.object({          // webhook → recordOnlinePayment の入力
  payment_link_id: z.string().uuid(),
  stripe_payment_intent_id: z.string().min(1).max(200),
  amount_jpy: zJpyAmount.refine(v => v > 0),
  paid_at: z.string().datetime(),
}).strict();
```
- facade(SalesFacadeExtended 追記):
  - `createPaymentLink(input, expectedUpdatedAt): Result<{payment_link_id; url}>` — invoice issued かつ残高 > 0 のみ(**E632**)。isStripeConfigured() false は **E636**。url = `${NEXT_PUBLIC_SITE_URL}/pay/${token}`。
  - `disablePaymentLink(paymentLinkId): Result<void>`。
  - `resolvePaymentLinkView(token): Result<PaymentLinkView>` — 公開ページ用(doc_no / billing_name / 支払額(クリック時残高 or 予定額)/ status)。無効・失効・支払済みは **E635**(公開ページは業務エラー文言に変換)。
  - `createCheckoutSessionForLink(token): Result<{redirect_url}>` — Stripe API 失敗は **E633**。金額はこの時点の残高と kind から確定し `min(指定額, 現在残高)` でクランプ(先行振込との競合で残高超過にしない)。metadata に payment_link_id / document_id / amount_jpy を積む。**JPY はゼロデシマル通貨 — Stripe の `unit_amount` へは amount_jpy を 1:1 で渡す(×100 すると 100 倍請求になる既知の落とし穴。実装ノート必須)**。
  - `recordOnlinePayment(input: OnlinePaymentEvent, ctx: ExecutionContext): Result<{payment_id; invoice_paid}>` — **service 文脈専用**(getSalesDigest と同じ ctx 都度渡し方式 — facade.ts:200-206 の前例)。内部で payments INSERT(method='card', stripe_payment_intent_id)。unique 衝突 = 重複 webhook → **ok として冪等スキップ**(エラーにしない)。残高超過は既存トリガ E625 がそのまま防ぐ。完済時は payments_apply トリガが paid 遷移(既存機構を素通しで流用)。手動入金 UI の zPaymentInput は**変更しない**(card は webhook 専用経路)。
- Stripe webhook route: `src/app/api/payments/stripe-webhook/route.ts` — 署名検証(STRIPE_WEBHOOK_SECRET、stripe SDK constructEvent。失敗 403 **E634** — telephony webhook の src/lib/telephony-signature.ts と同じ「モジュール非所属の共有インフラ + route 側責務」の構図)。`checkout.session.completed` のみ処理。処理は同期(入金 1 件の INSERT のみ — after() 不要)。
- env 追加(src/lib/env.ts の RESEND_API_KEY:38 と同じ任意設定パターン): `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` + `isStripeConfigured()`。
- エラーコード: **E632**(リンク生成対象不正)/ **E633**(Stripe API 失敗)/ **E634**(webhook 署名不正)/ **E635**(リンク無効・支払済み)/ **E636**(Stripe 未設定)。

#### 画面・UI
- 請求書詳細に「決済リンク」Surface: 生成ボタン(kind 選択 = 残高全額 / 前受金行 / 残金行)→ 生成済みリンク一覧(URL コピー / 無効化 / StatusBadge active・completed)。isStripeConfigured() false のときは notice-panel で「Stripe 未設定(環境変数)」を表示しボタン無効。
- sendDocumentByEmail のメール本文編集画面に「決済リンクを挿入」ボタン(生成済み active リンクの URL を本文へ挿入 — 送信実体は既存 #101 のまま)。
- 公開支払ページ `src/app/pay/[token]/page.tsx`(+ `/pay/[token]/complete`): noindex。doc_no・宛名・金額・「カードで支払う」ボタンのみの単票。管理画面テーマではなく公開サイトの最小スタイル。**公開ルート要件**: middleware の matcher は /admin,/edit 限定(src/middleware.ts:44-46)のため /pay は素通り(admin セッション不要)— 既存 anon shop/contact ルートと同列であることを実装時に確認する(1 行の smoke で足りる)。
- 一覧の入金列: method='card' の入金は PaymentDialog 経由でなく webhook 由来である旨を詳細の入金履歴に表示(memo に 'Stripe' 自動記入)。

#### ジョブ・自動化
なし(webhook 駆動)。取りこぼし対策として、朝の crm-digest の unpaid_invoices は Stripe と独立に「DB 上の残高」だけを見るため、webhook 欠落があっても翌朝の目視で気付ける(追加実装不要 — 既存 digest がそのままセーフティネットになる)。

#### 受入基準
- [ ] issued の請求書から決済リンクを生成し URL をコピーできる(draft/quote/完済は E632)
- [ ] /pay/[token] で金額・宛名が表示され、Stripe Checkout でテストカード決済が完走する
- [ ] checkout.session.completed 受信で payments に method='card' の行が入り、完済なら status が paid になる
- [ ] 同一 payment_intent の webhook 再送で入金が二重記録されない
- [ ] 一部振込済みの請求書のリンクを開くと、クリック時点の残高が請求される
- [ ] 支払済みリンクを開くと「お支払い済み」表示になる(E635 の公開文言)
- [ ] テストカード決済の請求額が円で 1:1(¥5,000 の請求が ¥500,000 にならない — ゼロデシマル検証)
- [ ] STRIPE_* 未設定環境では生成ボタンが無効で、既存機能に一切影響しない
- [ ] webhook 署名不正が 403 で拒否される

#### テスト方針
- 単体: 金額確定ロジック(kind × 残高クランプ)、token 生成の形式、webhook ペイロード→zOnlinePaymentEvent 写像。
- route テスト: 署名不正 403 / 重複イベント 200(冪等)。Stripe SDK はモック。
- 手動 E2E: Stripe テストモードで決済→消込→paid 遷移→deletePayment で復帰(既存トリガとの整合)。

---

### 3.3 #134 未入金請求書の顧客宛自動督促

#### 目的
遠隔取引では督促こそ心理コストが最大の業務。集計(SalesDigest.unpaid_invoices)・送信(internal/email.ts + document_emails)・日次起動(crm-digest cron)が全部既存なので、「期日超過の請求書に、決めた日数で、決めた文面を、顧客へ送る」配線だけを足す。

#### スコープ / 非スコープ
- スコープ: 期日(#136 の due_on / 支払予定行)基準の段階督促(最大 3 段、既定 [期日+3日, +10日])/ 請求書 PDF 再添付 + 決済リンク挿入 / 送信台帳記録 / 請求書単位の督促停止 / 自己 CC。
- 非スコープ: SMS・電話督促 / 法的措置文面 / 顧客単位の恒久オプトアウト(1人工房では請求書単位停止で足りる)/ #100 メール統合の受信箱連携(統合後に document_emails → emails への移送は #100 側の課題)。

#### DDL 変更案 — `2026XXXX0000NN_sales_invoice_reminders.sql`
```sql
create table invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  step_days int not null,                       -- 期日から何日後の段か (設定snapshot)
  due_on date not null,                         -- 判定に使った期日 (invoice due_on or 予定行)
  document_email_id uuid references document_emails(id), -- 実送信 (failed でも記録)
  status text not null check (status in ('sent', 'failed', 'skipped_no_email')),
  created_at timestamptz not null default now(),
  unique (document_id, due_on, step_days)       -- 同一期日×段は 1 回だけ (冪等キー)
);
alter table documents add column if not exists dunning_paused_at timestamptz; -- null = 督促有効
alter table document_emails add column if not exists kind text not null default 'manual'
  check (kind in ('manual', 'reminder'));
-- RLS: revoke 先行 + 明示 grant (0026 の教訓):
alter table invoice_reminders enable row level security;
revoke all on invoice_reminders from anon, authenticated;
grant select on invoice_reminders to authenticated;   -- INSERT は service のみ (追記専用)
-- + admin select ポリシー。dunning_paused_at の列 UPDATE grant は §3.1 の grant 文でまとめて付与。
```

#### 契約(sales)
- settings `billing` キーに追記:
```ts
dunning: z.object({
  enabled: z.boolean(),                                  // 既定 false (設定して初めて送る)
  steps: z.array(z.number().int().min(1).max(90)).min(1).max(3), // 期日超過後の日数。既定 [3, 10]
  cc_self: z.boolean(),                                  // 自分に CC (既定 true)
  subject_template: zShortText(200),                     // {{doc_no}} {{billing_name}} {{balance}} {{due_on}} {{payment_link_url}}
  body_template: z.string().max(5000),
}).strict()
```
- facade: `runInvoiceReminders(ctx: ExecutionContext): Result<{sent: number; skipped: number; failed: number}>` — service 専用・ctx 都度渡し(markExpiredQuotes と同型)。手順:
  1. dunning.enabled false なら即 ok(sent 0)。isResendConfigured() false は **E644** ではなく ok + skipped(cron を落とさない。route が warn ログ)。
  2. 未完済 issued invoice を列挙 → 期日(支払予定があれば各未消込予定行の due_on、無ければ documents.due_on。null は対象外)ごとに `今日(JST) >= due_on + step` を満たす最小 step を選ぶ。
  3. dunning_paused_at 非 null は skip。invoice_reminders の unique に既存行があれば skip(冪等)。
  4. 宛先解決: deal → customer.email(CrmFacade.getDealRefs バッチ — DocumentListItem.deal_title 解決と同じ定石)。無ければ直近の document_emails.to_email。両方無ければ status='skipped_no_email' で記録(朝ダイジェストで可視化)。
  5. 文面: テンプレート展開(純関数 internal/dunning.ts — 単体テスト対象)。active な決済リンクがあれば {{payment_link_url}} に挿入、無ければその行ごと削除(#130 未設定でも成立)。
  6. 送信: 既存 sendDocumentByEmail の内部実装(PDF 添付 + document_emails INSERT)を kind='reminder' で再利用。**現行の sendDocumentByEmail / insertDocumentEmail は kind 引数を持たない(kind 列は本設計で新設)ため、kind を repository INSERT まで通す小改修が必要**(既定 'manual' で既存呼び出しは無改修)。成功時 appendActivity('email', outbound)。
  7. invoice_reminders に結果 INSERT。
- エラーコード: **E639**(督促実行の前提不正 — enabled なのに billing 設定が壊れている等。個別送信失敗は E644 を document_emails.error_detail に記録して続行し、facade は failed カウントで返す — 1 件の失敗で全体を止めない)。

#### 画面・UI
- 設定ハブ(R4b で確立した settings ハブ)に「請求・督促」タブ: zBillingSettings のフォーム(支払条件・督促 ON/OFF・段数・テンプレート編集 + プレースホルダ説明の notice-panel)。
- 請求書詳細: 「督促」Surface — 送信履歴(invoice_reminders + document_emails join)/ pill-toggle「この請求書の督促を停止」(dunning_paused_at)。
- 朝ダイジェストメールに「今朝送った督促 n 件 / 宛先不明で送れなかった n 件」を追記(isDigestEmpty の判定には含めない — 送信済み通知だけで朝メールを発火させない)。

#### ジョブ・自動化
- crm-digest route(`src/app/api/jobs/crm-digest/route.ts`)の after() に `salesFacade.runInvoiceReminders({mode:'service'})` を追加。**配置の注意**: after() 内には collectDigest 失敗(:52-55)と isDigestEmpty(:68-70)の早期 return があるため、**字義どおり「末尾」に置くと督促がダイジェスト収集の成否に結合してスキップされる。督促は早期 return に依存しない独立の try/catch ブロックとして、digest 処理の前後いずれでも必ず実行される位置に置く**(markExpiredQuotes と同じ「失敗しても他を止めない」方針)。**新規 cron 不要** — 朝 7:00 JST の既存ジョブに同乗。

#### 受入基準
- [ ] 期日+3日の未完済請求書に督促メールが 1 通だけ送られる(翌日再実行でも重複しない)
- [ ] 二段払いの前受金だけ期日超過の場合、前受金行を対象にした督促になる(残金は期日前なら送らない)
- [ ] 督促停止トグルで以後送信されず、解除で次の段から再開する
- [ ] 顧客 email 不明時は skipped_no_email で台帳に残り、朝ダイジェストに出る
- [ ] dunning.enabled=false(既定)では一切送信されない
- [ ] 決済リンク未設定環境ではリンク行が消えた文面で送られる
- [ ] 送信成功が案件タイムライン(activities)に載る

#### テスト方針
- 単体: 段選定(JST 日付境界・複数予定行・unique 冪等)、テンプレート展開(リンク有無)、宛先解決の優先順位。
- route: crm-digest route に runInvoiceReminders 失敗を注入しても digest 送信が完走すること。
- 手動: 本番適用後、テスト顧客の期日を過去にして 1 サイクル観察(MEMORY の execute_sql 検証運用)。

---

### 3.4 #135 会計ソフト連携(freee / マネーフォワード)

#### 目的
請求発行と入金記録は本システムが正。会計ソフトへの転記(売掛計上・入金消込)を CSV で機械化し、二重入力を消す。1人工房では **OAuth API 連携は過剰設計** — freee・MF とも「取込用 CSV インポート」が公式にあるため、まず各ソフトのインポート形式で吐く。将来 freee API を足す場合もこの仕訳生成関数がそのまま入力になる。

#### スコープ / 非スコープ
- スコープ: 期間指定で (a) 発行済み請求書 → 売上計上仕訳、(b) 入金 → 消込仕訳 を freee(取引インポート形式)/ MF会計(仕訳帳インポート形式)の CSV で出力。勘定科目・税区分マッピングの設定。カード入金の決済手数料行(任意)。
- 非スコープ: freee/MF API(OAuth)接続 / 経費・仕入側 / 消費税申告区分の網羅(標準10%・免税の 2 形態のみ — invoice_issuer.registration_number null = 免税モードが既存概念 `src/modules/settings/contracts.ts:103`)。

#### DDL 変更案
**なし**(読み取り専用エクスポート)。settings 新キーのみ:
```ts
export const zAccountingSettings = z.object({
  software: z.enum(["freee", "mf"]),                  // 既定の出力形式
  account_sales: zShortText(30),                      // 既定 '売上高'
  account_receivable: zShortText(30),                 // 既定 '売掛金'
  account_deposit: zShortText(30),                    // 既定 '普通預金'
  account_fee: zShortText(30),                        // 既定 '支払手数料' (カード手数料行を出す場合)
  tax_class_sales: zShortText(30),                    // 既定 '課税売上10%' (免税は '対象外')
  include_card_fee_rows: z.boolean(),                 // 既定 false (Stripe 手数料は月次明細で入れる運用も可)
}).strict();
```

#### 契約(sales)
- 仕訳生成は純関数 `src/modules/sales/internal/journal.ts`(単体テストの主戦場):
```ts
export type JournalEntry = {
  date: string; debit_account: string; credit_account: string;
  amount_jpy: number; tax_class: string; counterparty: string; memo: string; ref_doc_no: string;
};
buildIssueEntries(issuedInvoices, settings): JournalEntry[]   // 売掛金 / 売上高
buildPaymentEntries(payments, settings): JournalEntry[]       // 普通預金(現金) / 売掛金 (+手数料行)
toFreeeCsv(entries): string          // freee「取引インポート」列順
toMfJournalCsv(entries): string      // MF会計「仕訳帳インポート」列順
```
  ※ 両ソフトの列ヘッダは頻繁には変わらないが、**実装時に最新の公式ヘルプの列仕様を確認して確定する**(設計書では列名を仮確定しない — ハルシネーション防止)。CSV 文字列化は #137 の共有 util(§3.5 `src/lib/csv.ts`)を使う。
- facade: `exportAccountingCsv(input: {format: 'freee'|'mf'; date_from; date_to; target: 'issues'|'payments'|'both'}): Result<{filename: string; csv: string}>` — 0 件は ok(空 CSV + UI で「0 件」表示)。生成失敗は **E646**。データ源は既存 read(issued_documents の期間検索 + payments の期間検索 — repository に読み取り 2 クエリ追加)。
- 出力エンコーディング: UTF-8 BOM 付き(freee/MF とも UTF-8 可・Excel 目視にも耐える)。

#### 画面・UI
- 帳票一覧(admin/documents)ヘッダに「会計CSV」ボタン → ダイアログ(形式 pill-toggle freee/MF、期間、対象)→ ダウンロード。
- 設定ハブ「請求・督促」タブ内に「会計連携」節(zAccountingSettings フォーム)。

#### ジョブ・自動化
なし(手動ダウンロード。#150 の週次スナップショットに仕訳 CSV を同梱する拡張は #150 側のオプション)。

#### 受入基準
- [ ] 期間内の発行済み請求書が 1 行 = 1 仕訳(売掛金/売上高)で出力される(voided は除外、訂正発行は最新版の金額)
- [ ] 期間内の入金が 1 行 = 1 仕訳(預金/売掛金)で出力され、method='card' で include_card_fee_rows=true なら手数料行が付く
- [ ] 免税モード(registration_number null)では税区分が '対象外' 系になる
- [ ] freee/MF 各形式のヘッダ行が公式インポート仕様と一致し、実ソフトへの取込テストが通る
- [ ] 0 件期間で空 CSV + UI 表示(エラーにならない)

#### テスト方針
- 単体: buildIssueEntries / buildPaymentEntries(免税分岐・手数料行・訂正発行版の扱い)、CSV エスケープ(カンマ・改行・引用符入り宛名)。
- 手動: freee・MF の無料プランに実 CSV を取込んで受理されることを確認(受入基準に含む)。

---

### 3.5 #137 CSV一括インポート/エクスポート(dataio モジュール新設)

#### 目的
バックアップ・税理士への提出・他ツールからの顧客移行・Excel での目視集計。現状 CSV 機構ゼロ(§2.3)。ここで作る CSV 基盤(生成・パース・列定義)が #135/#150/#146 の共通土台になる。

#### モジュール配置(module-contracts v2.9 整合)
- 新モジュール **`dataio`**(`src/modules/dataio/{contracts,facade,repository,internal/}`)。所有テーブル: `data_import_jobs`(+#150 で `export_snapshots`)。エラー帯: **KMB-E880-E899 を新設**(E840-859 の #100 予約を侵さず、E860-879 は並行トラック outreach が取るため — 00-統合設計.md の全体割当。module-contracts §1 の表と 00-overview §3.3 への追記が実装 Issue の先頭タスク)。
- **他モジュールの行を直接 SELECT しない**(nav-badges の count 例外は使えない — 行が要る)。代わりに各所有モジュールの facade に**エクスポート専用の契約外拡張 read** を 1 つずつ追加する:
  - crm: `listCustomersForExport(cursor)` / `listCompaniesForExport(cursor)` / `listDealsForExport(cursor)`(全列・1000 行/頁のキーセットカーソル)
  - sales: `listDocumentsForExport(cursor)`(ヘッダ+明細 flatten)/ `listPaymentsForExport(cursor)`
  - 書き込み(インポート)は既存 `CrmFacade.createCustomer / updateCustomer`(facade.ts:148, 185)を 1 行ずつ呼ぶ — 境界を跨ぐ生 INSERT はしない。
- CSV 文字列化/パースは **`src/lib/csv.ts`**(モジュール非所属の共有インフラ — telephony-signature.ts 前例): RFC 4180 準拠の escape/quote、BOM 付与、引用符・改行・カンマ対応の手書きパーサ(新規依存を増やさない。約 100 行 + 単体テストで固める。papaparse 導入は実装時の逃げ道として許容)。

#### スコープ / 非スコープ
- スコープ: エクスポート = customers / companies / deals / documents(+lines flatten)/ payments の 5 エンティティ、フィルタは期間のみ。インポート = **customers のみ**(移行需要の 9 割。email/tel での upsert 判定 + dry-run プレビュー)。
- 非スコープ: deals/documents のインポート(帳票は電帳法台帳と採番が絡むため CSV 復元しない)/ 添付・メディア / 非同期ジョブキュー(1人工房のデータ量では同期 Server Action で足りる。行上限で守る)。

#### DDL 変更案 — `2026XXXX0000NN_dataio_import_jobs.sql`
```sql
create table data_import_jobs (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('customers')),
  filename text not null,
  mode text not null check (mode in ('create_only', 'upsert')),
  total_rows int not null,
  created_rows int not null default 0,
  updated_rows int not null default 0,
  failed_rows int not null default 0,
  report jsonb not null default '[]',     -- 行番号ごとの結果 [{row, status, code?, message?}] (最大 1000)
  status text not null check (status in ('committed', 'failed')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
-- RLS: revoke 先行 + 明示 grant (0026 の教訓):
alter table data_import_jobs enable row level security;
revoke all on data_import_jobs from anon, authenticated;
grant select, insert on data_import_jobs to authenticated;  -- 追記専用の実行履歴 (UPDATE/DELETE なし)
-- + admin select/insert ポリシー。
```

#### 契約(dataio)
```ts
export const zExportEntity = z.enum(["customers", "companies", "deals", "documents", "payments"]);
export const zExportInput = z.object({
  entity: zExportEntity,
  date_from: zDateOnly.nullable(),        // created_at 基準 (null = 全期間)
  date_to: zDateOnly.nullable(),
}).strict();
export const zImportCustomersInput = z.object({
  filename: zShortText(120),
  mode: z.enum(["create_only", "upsert"]), // upsert キー: email 一致 → 同一顧客として update
  csv_text: z.string().max(2_000_000),     // ~2MB / 最大 1000 行 (超過 E882)
  dry_run: z.boolean(),
}).strict();
```
- 列定義は contracts に定数レジストリ `EXPORT_COLUMNS: Record<ExportEntity, Column[]>` として固定(ヘッダは日本語+機械キーの 2 行にしない — 1 行目 = 機械キー。再インポート互換を最優先)。customers の列(**#113 ブロックモデルの全 5 フィールド {postal_code, address, tel_e164, name, suffix} を billing/shipping 両方で欠損なく flatten する — バックアップ目的とラウンドトリップ受入の前提**): `name, kana, kind, lifecycle, email, tel, company_name, tags, notes, billing_postal_code, billing_address, billing_name, billing_suffix, billing_tel, shipping_postal_code, shipping_address, shipping_name, shipping_suffix, shipping_tel, custom_fields(JSON), created_at`。**company_name は customers に実列が無い(company_id FK の join 導出)ため、インポート時は「無視(参照情報)」と列定義に明記する** — 会社名→company_id の解決はしない(誤紐付け防止。会社付け替えは admin UI で行う)。importer は billing_info/shipping_info を再構築する際、**CSV に列が存在するフィールドのみ更新し、全列空なら null 化ではなく既存値保持**とする(欠損列による破壊的 update の防止)。
- facade:
  - `exportCsv(input: ExportInput): Result<{filename; csv}>` — facade 横断でカーソルを回して合成。生成失敗 **E886**。
  - `importCustomers(input): Result<ImportReport>` — 手順: パース(**E880** 構文 / **E881** ヘッダ不一致 / **E882** 行数超過)→ 行ごと Zod 検証 + email 重複判定 → dry_run なら報告のみ(行エラーは **E883** を code に持つ行別報告に集約 — facade 自体は ok で返す)→ commit は 1 行ずつ crm facade を呼び、失敗行はスキップして継続(部分失敗は報告 + status='committed'。全行失敗のみ **E884**)→ data_import_jobs INSERT。
- エラーコード新設(dataio 帯 E880-E899): **E880** パース失敗 / **E881** ヘッダ不一致 / **E882** サイズ・行数超過 / **E883** 行検証エラー(行別報告用)/ **E884** インポート全滅 / **E885** 未対応エンティティ / **E886** エクスポート生成失敗。

#### 画面・UI
- 設定ハブに「データ」タブ(`/admin/settings/data`): 
  - エクスポート節: エンティティ 5 枚のカード(Surface)+ 期間指定 → ダウンロード。
  - インポート節: 3 ステップウィザード(underline-tabs)— (1) ファイル選択 + モード選択 → (2) dry-run プレビュー(data-table で 行/判定/エラー表示、作成 n・更新 n・エラー n のサマリ)→ (3) 確定 → 結果。実行履歴テーブル(data_import_jobs)。
- 顧客一覧ヘッダにも「CSV」ショートカット(設定ハブの同機能への遷移リンクのみ — 実装二重化しない)。

#### ジョブ・自動化
なし(#150 が cron 化)。

#### 受入基準
- [ ] 5 エンティティすべてが 1 クリックで BOM 付き UTF-8 CSV としてダウンロードできる
- [ ] エクスポートした customers CSV を無編集で再インポート(dry-run)すると全行「更新(変更なし)」になる(ラウンドトリップ保証)
- [ ] 壊れた CSV(引用符不整合)が E880、列欠落が E881、1001 行が E882 で拒否される
- [ ] billing_tel / shipping_name / shipping_suffix / shipping_tel を含む #113 ブロック全フィールドが往復で保全される
- [ ] dry-run で作成/更新/エラーの行別プレビューが出て、確定まで一切書き込まれない
- [ ] 一部の行が不正でも他の行は取り込まれ、報告に行番号と理由が残る
- [ ] インポートが既存の作成時 dedup(crm)と矛盾しない(upsert は email 一致のみ。tel だけ一致は新規作成 + 既存の重複検知に委ねる)
- [ ] module-contracts.md に dataio(所有テーブル・E880-899)が追記されている

#### テスト方針
- 単体: csv.ts(RFC4180 往復・BOM・CRLF・セル内改行)、EXPORT_COLUMNS ↔ Zod のラウンドトリップ、インポート判定(create/update/error 分類)。
- 結合(手動): 本番適用後に自データでエクスポート→再インポート dry-run が全行無変更になること。

---

### 3.6 #150 定期スケジュールエクスポート

#### 目的
バックアップの自動化。「気付いたら 3 ヶ月分の顧客データが消えていた」を構造的に防ぐ。#137 の exportCsv をそのまま cron で回すだけ。

#### スコープ / 非スコープ
- スコープ: 週次で全 5 エンティティの CSV を private Storage バケットに保存、直近 8 世代保持、朝ダイジェストに結果 1 行、管理画面から署名 URL ダウンロード。
- 非スコープ: 外部ストレージ(S3/Drive)転送 / 頻度のユーザー編集 UI(週次固定。変えたくなったら settings に足す)。

#### DDL 変更案 — `2026XXXX0000NN_dataio_export_snapshots.sql`
```sql
create table export_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  storage_prefix text not null,            -- exports/{yyyy-MM-dd}/ 配下に entity 別 5 ファイル
  entity_counts jsonb not null,            -- {customers: n, ...}
  total_bytes bigint not null,
  status text not null check (status in ('done', 'failed')),
  error_detail text
);
-- Storage: private バケット 'exports' 新設 (issued-documents と同じ非公開 + 署名 URL 型)。
-- cron: 20260711000024 と同型の migration —
--   select cron.schedule('kmb-export-worker', '0 20 * * 6',  -- 日曜 5:00 JST
--     $$select public.trigger_export_worker();$$);  → net.http_post → /api/jobs/data-export
```

#### 契約・route
- facade(dataio): `runScheduledExport(ctx: ExecutionContext): Result<{snapshot_id; entity_counts}>` — 5 エンティティを exportCsv で生成 → Storage 保存 → 9 世代目以降を削除 → export_snapshots INSERT。失敗は **E887**。
- route `src/app/api/jobs/data-export/route.ts`: crm-digest route と同一骨格(x-jobs-secret / 202 + after() / maxDuration 60)。
- 朝ダイジェスト: 直近スナップショットが 8 日より古い or failed なら警告 1 行(digest 収集時に export_snapshots を 1 行 read — dataio facade の read を crm-digest route が合成する。既存の getSalesDigest 合成と同じ「app 層が両 facade を import」構図 route.ts:20-25)。

#### 画面・UI
- 設定ハブ「データ」タブに「自動バックアップ」節: スナップショット一覧(data-table: 日時 / 件数 / サイズ / StatusBadge)+ 各ファイルの署名 URL ダウンロード。

#### 受入基準
- [ ] 日曜朝に 5 ファイルが exports バケットに生成され、一覧からダウンロードできる
- [ ] 9 回目の実行で最古の世代が消える(8 世代保持)
- [ ] 失敗時に export_snapshots が failed で残り、翌朝ダイジェストに警告が出る
- [ ] 手動実行ボタン(管理画面)からも同一処理を起動できる

#### テスト方針
- 単体: 世代削除の選定ロジック、ファイル名/prefix 生成。
- route: secret 不正 401。手動実行→Storage 実体確認(本番 execute_sql + Storage 目視)。

---

### 3.7 #146 データポータビリティ/削除請求対応

#### 目的
個人情報保護法の開示請求(保有個人データの電磁的記録による提供)と利用停止・消去請求への実務対応。BtoC 主体の事業では「来たら数時間潰れる/対応を誤ると信用毀損」の類のイベントを 2 クリックにする。

#### 法的制約との整合(設計の要)
- **帳票(documents / issued_documents / payments)は消さない**: 電帳法・法人税法の保存義務(7 年)が消去請求に優先する(個情法上も「法令の遵守に必要な範囲」は消去義務の例外)。よって削除請求対応 = **顧客レコードの匿名化**であり、物理削除ではない。
- 開示 = #137 のエクスポート基盤を顧客 1 人にスコープして流用。

#### DDL 変更案 — `2026XXXX0000NN_crm_privacy_requests.sql`(crm 所有)
```sql
create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  kind text not null check (kind in ('export', 'anonymize')),
  status text not null check (status in ('done', 'failed')),
  note text,                                -- 請求の経緯メモ (電話/メール等)
  storage_path text,                        -- kind='export' の出力先 (exports バケット privacy/ 配下)
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
alter table customers add column if not exists anonymized_at timestamptz; -- null = 通常
-- RPC: crm_anonymize_customer(p_customer_id uuid, p_expected_updated_at timestamptz)
--   security definer。単一トランザクションで:
--   customers: name='削除済み顧客-'||left(id::text, 8), kana/email/tel_e164/notes null,
--     billing_info/shipping_info null (nullable のため可),
--     **custom_fields = '[]'::jsonb (空配列 — NOT NULL + check(jsonb_typeof='array') 制約
--     (20260715000001:21,28-29) があるため null は不可。null を書くと全顧客で実行時失敗する)**,
--     lifecycle='archived', anonymized_at=now()
--   activities (crm 所有): 当該顧客の案件に紐づく行の body を '[削除請求により匿名化]' に置換
--   ※ documents.billing_name は変更しない (発行済み帳票の記載は法定保存 — E624 とも整合)
```

#### 契約
- crm facade(帯 E612-619 の空きから。**E612 は sfa トラック(紹介元)が使用するため本トラックは E613/E614** — 00-統合設計.md の全体割当):
  - `anonymizeCustomer(customerId, expectedUpdatedAt): Result<void>` — 進行中案件(open deal)or 未完済請求がある顧客は **E613**(先に完了/回収してから)。匿名化済み顧客への update 系操作は **E614**(updateCustomer / mergeCustomers / createDeal 等の入口ガード)。
  - contact_inquiries(inquiry 所有)は customers への明示 FK を持つか実装時に確認し、**明示リンクがある行のみ** RPC の対象に含める(email/tel の曖昧一致での自動削除はしない — 誤爆防止。一致候補は UI に提示して手動対応)。
- dataio facade:
  - `exportPersonalData(customerId): Result<{filename; storage_path}>` — 顧客 1 件の JSON バンドル(customer 全列 + companies + deals + documents 要約(doc_no/種別/金額/日付)+ activities + document_emails 宛先履歴 + 通話メタ(telephony に契約外 read を 1 つ追加: `listCallsForCustomer`)。exports バケット privacy/ に保存し署名 URL 提示。対象不在は **E888**。
- privacy_requests への記録は両操作の facade 内で INSERT(操作証跡)。

#### 画面・UI
- 顧客詳細(R3b の顧客詳細)のオーバーフローメニューに「開示データを書き出す」「削除請求に対応(匿名化)」。
  - 匿名化は二段確認ダイアログ(顧客名の再入力式 — 不可逆操作の既存慣行が無ければ notice-panel で「元に戻せません・帳票は法定保存のため残ります」を明示)。
  - 匿名化済み顧客は一覧・詳細で StatusBadge「匿名化済み」+ 編集 UI 無効。
- 設定ハブ「データ」タブに privacy_requests の履歴一覧。

#### 受入基準
- [ ] 開示: 顧客 1 人の JSON バンドルが生成・ダウンロードでき、当該顧客以外のデータを含まない
- [ ] 匿名化: customers の PII 全列が消える(custom_fields は '[]'、billing/shipping_info は null)。名前が「削除済み顧客-XXXXXXXX」になる
- [ ] 発行済み請求書 PDF・台帳・入金記録は匿名化後も不変(電帳法整合)
- [ ] open な案件がある顧客の匿名化が E613 で拒否される
- [ ] 匿名化済み顧客への updateCustomer / merge が E614 で拒否される
- [ ] 両操作が privacy_requests に証跡として残る
- [ ] CSV 全量エクスポート(#137/#150)に匿名化後の値が出る(旧 PII が漏れない)

#### テスト方針
- 単体: E613 判定(open deal / 未完済請求の組合せ)、バンドル構築の対象スコープ(他顧客混入なし)。
- RPC: 本番適用後、テスト顧客で匿名化 → execute_sql で customers / activities / documents を検証(MEMORY の運用方針)。

---

## 4. エラーコード割当まとめ(契約書改訂が先 — module-contracts §1・00-overview §3.3)

| コード | 所有 | 意味 | 導入 Issue |
|---|---|---|---|
| KMB-E632 | sales | 決済リンク生成の対象不正(invoice issued・残高ありでない) | C2 |
| KMB-E633 | sales | Stripe API 呼び出し失敗 | C2 |
| KMB-E634 | sales | Stripe webhook 署名検証失敗 | C2 |
| KMB-E635 | sales | 決済リンク無効・失効・支払済み | C2 |
| KMB-E636 | sales | Stripe 未設定(STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET) | C2 |
| KMB-E637 | sales | 支払予定が不正(合計不一致・期日順序・行数) | C1 |
| KMB-E638 | sales | 支払予定・期限を変更できない帳票状態(draft/完済/void/quote) | C1 |
| KMB-E639 | sales | 督促実行の前提不正(設定破損等。個別送信失敗は E644 再利用) | C3 |
| KMB-E646 | sales | 仕訳エクスポート生成失敗 | C6 |
| KMB-E613 | crm | 匿名化不可(進行中案件・未完済請求あり) | C8 |
| KMB-E614 | crm | 匿名化済み顧客への書き込み操作 | C8 |
| KMB-E880〜E886 | dataio(新帯 E880-899) | §3.5 参照(パース/ヘッダ/超過/行検証/全滅/未対応/生成失敗) | C4/C5 |
| KMB-E887 | dataio | 定期エクスポート実行失敗 | C7 |
| KMB-E888 | dataio | 個人データ書き出し対象不明 | C8 |

※ sales E628-E631 は sfa トラック(電子署名)、crm E612 は sfa(紹介元)、crm E615-E616 は x-community(親子案件・クラファン)、E860-879 は intake(outreach)が使用 — 00-統合設計.md の全体割当表が正。

新設 settings キー: `billing`(C1 で新設・C3 で dunning 追記)/ `accounting`(C6)。env 追加: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`(C2、任意設定パターン)。新規 npm 依存: `stripe`(C2)のみ。

---

## 5. Issue 分割案(1 Issue = 1 PR)

| # | タイトル案 | 含む項目 | 依存 | 規模 |
|---|---|---|---|---|
| C1 | feat(sales): 請求書の支払期限(due_on)と二段払い支払予定 | #136 | なし | **M** |
| C2 | feat(sales): Stripe 決済リンクと公開支払ページ・入金自動記録 | #130, #131 | C1(予定額リンク・残高確定) | **L** |
| C3 | feat(sales): 未入金請求書の顧客宛自動督促(crm-digest 同乗) | #134 | C1 必須 / C2 推奨(文面へのリンク挿入。無くても成立) | **M** |
| C4 | feat(dataio): dataio モジュール新設 + 5 エンティティ CSV エクスポート | #137(前半) | なし(C1-C3 と並行可) | **M** |
| C5 | feat(dataio): 顧客 CSV インポート(dry-run + upsert) | #137(後半) | C4 | **M** |
| C6 | feat(sales): freee/MF 取込形式の仕訳 CSV エクスポート | #135 | C4(csv util)・C1(決済期日列) | **M** |
| C7 | feat(dataio): 週次自動バックアップ(定期エクスポート) | #150 | C4 | **S** |
| C8 | feat(crm/dataio): 開示データ書き出しと削除請求対応(匿名化) | #146 | C4(エクスポート基盤) | **M** |

- 並行レーン: [C1→C2→C3] と [C4→{C5, C6, C7, C8}] は独立。最速価値は C1+C3(督促)と C4(バックアップ)。
- 各 Issue 共通の先頭タスク: module-contracts.md / 00-overview §3.3 のエラーコード・所有テーブル追記(契約書が先の規約)。
- 各 Issue 共通の受入: `npm run lint`・`npx tsc --noEmit`・単体テスト green(CI は Vercel ビルドのみ — project-ci-quality-gates.md 前提)。migration は本番適用後 execute_sql 検証。

## 6. トラック横断のリスクと決め

1. **#100 メール統合との競合回避**: 督促・支払リンクの送信は document_emails(sales 所有)に閉じ、emails/email_attachments・E840-859 には触れない。#100 完了後の移送は #100 側 Issue。
2. **webhook と手動入金の競合**: 残高超過は既存 payments_apply トリガ(E625)が最終防衛。決済リンクはクリック時残高でクランプするため、通常運用で E625 には到達しない(到達したら Stripe 側返金の手動対応 — 非スコープと明記)。
3. **モジュール境界**: dataio は他モジュールの行を直接引かない。エクスポート用 read の契約外拡張を各所有 facade に足す方式で、nav-badges 型の例外を増殖させない。
4. **凍結原則との整合**: 担当者/ロール系は一切追加していない(created_by 記録のみ)。全機能が isAdmin 単一 boolean の現行権限モデルで動く。
