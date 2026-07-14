# 隈部塗装 CRM スイート — sales モジュール設計書 (02-sales)

- 版: v1.2 (2026-07-11: 07 §D5 v1.2 (角印 private 化) への追随 — seal_media_id 廃止 → seal_storage_path、migration 0028 を branding-assets バケット作成に内容置換 (media 参照 3 点セット置換の廃止)、§10.6 を署名 URL 解決に是正、§6.1 getDocumentLinesForBlocks の空文字→null 正規化注記。詳細は更新履歴)。旧: v1.1 (2026-07-11: レビュー指摘反映 — 取引年月日の分離 (transaction_date)・訂正発行の原子化 (staging→PDF→単一 RPC)・/print ワンタイム消費 (print_tokens)・PDF 生成のグローバル直列化 (pdf_render_lock)・revoke の authenticated 完全化・draft 保存の RPC 化・deal 'paid' 適用の確認化・入金済み invoice の void ガード (trigger)・Storage 不変 trigger・CrmFacade 読み取り契約 Δs4・payment_recorded イベント Δs5・WYSIWYG 主張の限定・シミュレーター変換の canonical 分担明記 (06 §5.4) ほか。詳細は更新履歴)
- 旧版: v1.0 (2026-07-11: 初版 — 設計裁定 J5/J9/J10 準拠)
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **sales モジュール (販売管理・帳票) の親設計**。所有テーブル (documents / document_lines / payments / issued_documents。document_sequences は所有のみで DDL は M0) の DDL・状態機械・帳票様式・印刷出力・電帳法保存・画面仕様の正。
- 姉妹文書 (canonical 分担):
  - [00-overview.md](./00-overview.md) — 全体アーキテクチャ・M0 共通基盤 (**§3.3 エラーコード全表 / §3.4 採番 RPC 0022 / §3.5 共通スカラー**)・モジュール割当 (§10)・認可総表 (§5) の正。本書は逸脱しない
  - [07-contracts-delta.md](./07-contracts-delta.md) — module-contracts.md v2.8 差分の正。**sales の値契約 (§4.11 zDocType / DOC_NO_PREFIX / zDocumentStatus / DERIVATION_RULES / zDocumentLineInput / zTaxSummary / zCreateDocumentInput / zPaymentInput / DocumentTotals / IssuedDocumentRecord) と facade 契約 (§D8 SalesFacade) は同書が canonical — 本書は参照のみで再定義しない**
  - [01-crm.md](./01-crm.md) — deals / activities の正 (documents.deal_id の参照先、document_event activity の書き込み先)
  - [03-scheduling.md](./03-scheduling.md) — 作業ブロック生成の正 (本書は `getDocumentLinesForBlocks` の供給契約のみ)
- 入力資料: 設計ブリーフ R4/R7、設計裁定 J5 (帳票)・J9 (エラーコード帯)・J10 (モジュール構成)、調査 ext-hubspot-invoice.md (HubSpot line item 方式 + 日本の帳票法要件 Part B)・gap-pdf.md (方式 A 確定)・db-schema.md・admin-ui-auth.md・design-conventions.md・simulator-archaeology.md
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提: migration 0001〜0020 適用済み + M0 (0021/0022) + crm (0023〜0025) 適用済みであること。**sales の migration 帯は 0026〜0028** (00-overview §10。帯は固定・未使用分は返上)

---

## 0. 業務シナリオ

熊部さん (塗装職人) の帳票まわりの一日を 4 部で描く。IT 用語は使わない。

### 0.1 見積を出す — 「下書きはもうできている」

朝、管理画面を開くと、昨夜シミュレーターから届いた相談に**見積書の下書きが付いている**。中身はお客さんが選んだグレードとサイズ、個数、概算金額。熊部さんは品名を「サフ研磨」「本塗装」など実際の工程に分け、数量と単価を直し、リピートのお客さんなら「段取り費免除」の行を足す。金額を打ち込むたび、消費税と合計は画面の下で勝手に計算し直される。よければ「発行」を押す。番号 (Q-2026-0012 のような通し番号) が付き、そのまま渡せる PDF ができあがる。控えは自動で保管されるので、ファイルサーバを探し回ることは二度とない。

### 0.2 受注する — 「書き直しゼロ」

お客さんから「お願いします」と返事が来た。見積書の画面で「受注にする」を押すだけで、見積の明細がそっくりそのまま**注文請書**に写る。書き直しはない。あとで価格表を改定しても、この案件の金額は変わらない — 発行した書類の中身は「その時の約束」として固定される。受注と同時に、案件は「受注」に進み、作業の段取り (研磨・下地・塗装…) の原案がカレンダー側に用意される。

### 0.3 納品して請求する — 「決まりごとは様式が面倒を見る」

検品が終わったら「納品書にする」、月末に「請求書にする」。それぞれ明細は引き継がれ、番号が付き、PDF になる。請求書にはインボイスの決まりごと — 登録番号、税率ごとの内訳、端数の丸め方 — が自動で正しく載る。もし登録番号をまだ持っていなくても、様式が自動で切り替わって「消費税相当額」表記になるので、どちらでも間違った書類は出ない。振込先と「振込手数料はご負担ください」の一文も請求書にだけ印字される。

### 0.4 入金を確認する — 「未回収が一目で消える」

数日後、通帳に入金があった。請求書の画面で金額と日付を記録すると、金額がぴったり揃った瞬間に請求書は「入金済み」になり、案件もボタンひとつの確認で「入金済み」にして完結する。半金だけ先に入ったなら残高が表示されたまま残る。金額を打ち間違えたら、その記録を消してもう一度入れ直せばいい。発行済みの書類そのものは 7 年間、誰にも書き換えられない形で保管され、「いつ・誰に・いくら」でいつでも探し出せる。

### 0.5 スコープ外 (sales v1 で扱わないもの)

| 項目 | 理由・扱い |
|---|---|
| 銀行 API 連携による自動消込 | **入金は手動記録のみ** (通帳/ネットバンキングを見て admin が記録)。口座 API・freee 等会計連携は将来検討 |
| 帳票のメール自動送付 | J7 (メール連携 v1 外)。PDF をダウンロードして手動送付。activity 'email' は Phase 2 予約 |
| 適格簡易請求書 (宛名なし様式) | ext-hubspot B-5。v1 は常にフル様式で統一 (通販もフル様式で交付して不利益なし)。拡張余地は §18 |
| 源泉徴収欄 | ext-hubspot B-7 — 塗装工事は所得税法 204 条の類型外で不要。欄自体を設けない |
| 会計仕訳・消費税申告計算 | 台帳 (issued_documents) が積上げ計算の根拠資料になるところまで (B-4)。申告はスコープ外 |
| 与信・入金督促の自動化 | 未消込一覧 + crm-digest の日次ダイジェスト表示まで |
| クレジットカード決済 | 既存どおり銀行振込前払い (00-overview §0.5) |

### 0.6 印刷出力

**該当あり — 本書 §10 が本プロジェクト初の印刷出力仕様の canonical**。見積書・注文請書・納品書・請求書の 4 書類 (紙面レイアウトは 3 系統) を方式 A (puppeteer-core + @sparticuz/chromium 147 の `page.pdf()`) で PDF 化する。詳細は §10。

---

## 1. モジュール定義と責務

### 1.1 責務・所有 (07-contracts-delta §D1 と 1:1)

| 項目 | 内容 |
|---|---|
| 責務 | 見積→受注→納品→請求→入金消込のドキュメントフロー / 書類採番 / 税計算 (書類×税率 1 回丸め、J5) / 帳票 PDF 生成 (方式 A) / 電帳法 append-only 台帳 / 見積明細→作業ブロック原案の供給契約 |
| 所有テーブル | documents, document_lines, payments, **document_sequences** (DDL/RPC は M0 migration 0022 — canonical は 00-overview §3.4。**本書は再定義しない**), issued_documents, print_tokens / pdf_render_lock / document_revision_stagings (v1.1 — service 専用補助 3 テーブル、§2.3.2) |
| 所有 Storage | bucket `issued-documents` (private) / bucket `branding-assets` (private — 角印画像。0028 で作成、07 §D5 v1.2) |
| 所有エラーコード | KMB-E620〜E649 (個別割当 canonical は 00-overview §3.3。recovery 文言の詳細は本書 §12) |
| 公開 facade | SalesFacade (契約メソッドは 07 §D8 が canonical。契約外拡張は本書 §6.2) |
| migration 帯 | **0026, 0027, 0028** |
| ナビ | `/admin/documents` 「帳票」 (M0 で nav-items.ts 追加済み) |

### 1.2 依存方向

```
sales ──→ crm      (CrmFacade.appendActivity / getDealRef / getDealRefs — 顧客・案件の read は契約メソッドのみ
                    (07 §D8 v1.2 で最小射影 DealRef として昇格・v1.7 で batch 版追加 — Δs4 §17)。
                    01-crm §6.2 の契約外拡張 getDeal / getCustomer は他モジュール呼出禁止のため使わない)
sales ──→ platform (requireAdmin / Result / 共通スカラー / errors)
sales ──→ settings (SettingsFacade.get('invoice_issuer') / ('company') の read のみ — D2 の承認範囲は get。
                    getWithMeta は settings の契約外拡張のため他モジュールから呼ばない。E626 変換は §5.4)  ★注記
app 層 ──→ sales + scheduling (受注→ブロック生成の合成 — 00-overview §4.1 / 07 §7.7)
app 層 ──→ sales + crm       (帳票イベント→案件ステージ提案 — 00-overview §2.3)
/api/shop/lead (app 層) ──→ sales.createDraftQuoteFromEstimate (シミュレーター→見積原案 — 07 §7.8)
```

**禁止 (再掲 + 本書の適用)**:

- **scheduling を import しない** (双方向禁止 — 07 §D2)。ブロック生成に必要な明細は `getDocumentLinesForBlocks` で app 層に渡すのみ
- pricing を import しない (見積原案の入力 `SimEstimateSnapshot` は crm/contracts.ts 所有の構造的同型を D8 の型 import 規約で受ける)
- deals.stage を直接 UPDATE しない (issueDocument / recordPayment の戻り値 event で app 層が `CrmFacade.updateDealStage` — 00-overview §6.2)
- activities への直接 INSERT 禁止 (`CrmFacade.appendActivity` のみ — 07 §7.9)

★注記 (契約書改訂事項) → **承認済み** (07-contracts-delta v1.1 裁定 #6 = Δs1): §D2 に「sales ──→ settings (invoice_issuer・company の read)」を追記済み (crm/scheduling/telephony の同種 read も同時に明記)。`issueDocument` は発行者情報 (settings 'invoice_issuer' + 'company') の read を必要とする (D8 のシグネチャに発行者引数がなく app 層合成では実現不能)。既存前例 (ai-studio→settings) と同型の read 依存であり循環しない。

### 1.3 ディレクトリ構成

```
src/modules/sales/
  contracts.ts    … 07 §4.11 の写経 + 本書 §5.2 の内部契約
  facade.ts       … SalesFacade (契約 8 メソッド + 契約外拡張 §6.2)
  repository.ts   … documents/document_lines/payments/issued_documents + 補助 3 テーブル
                    (print_tokens / pdf_render_lock / document_revision_stagings — v1.1) への
                    唯一の DB アクセス (document_number_next / document_save_draft /
                    document_finalize_issue 等 RPC 呼び出し含む)
  tax.ts          … computeDocumentTotals 純関数 (pricing/estimate.ts と同格の公開純関数ファイル。
                    admin UI のリアルタイム税プレビューがクライアントから import する — 副作用なし)
  internal/
    pdf.ts        … 方式 A PDF 生成 (Chromium launch 流用 + 同時実行 1 + /tmp クリーンアップ)
    print-token.ts … /print 用署名トークン生成・検証
    issuer.ts     … 発行者スナップショット合成 (settings 'company' + 'invoice_issuer')
    derive.ts     … 明細複製スナップショット・シミュレーター変換の純関数
    state.ts      … 状態遷移ガード (canTransition / 派生許可判定)
```

### 1.4 契約の canonical 分担 (再定義禁止一覧)

| 契約 | canonical | 本書での扱い |
|---|---|---|
| zDocType / DOC_NO_PREFIX / zDocumentStatus / DERIVATION_RULES / zDocumentLineInput / zTaxSummary(Line) / zCreateDocumentInput / zPaymentInput / DocumentTotals / IssuedDocumentRecord | 07-contracts-delta §4.11 | 参照のみ (写経実装) |
| SalesFacade 契約メソッド 8 本 | 07-contracts-delta §D8 | 参照 + エラー全列挙 (§6.1) |
| zJpyAmount / zJpySignedAmount / zTaxCategory / TAX_RATE_BY_CATEGORY / zTaxRounding / zInvoiceRegistrationNumber / zDocumentNo / zDateOnly / ExecutionContext | 00-overview §3.5 = 07 §D4 (platform) | 参照のみ |
| zInvoiceIssuerSettings (settings キー) | 07 §D5 (**所有は settings**。実装フェーズのみ sales) | 参照のみ。UI 統合は §8.6 |
| document_sequences DDL + document_number_next RPC | 00-overview §3.4 (M0 migration 0022) | 参照のみ。利用規約は §2.6-7 |
| zDocumentEventActivityPayload | 07 §4.10 (crm 所有) | 参照 (D8 の型 import 規約で import) |
| KMB-E620〜E649 の採番 | 00-overview §3.3 | recovery 文言詳細のみ本書 §12 |
| 本書 §5.2 の内部契約 (zIssuerSnapshot / zUpdateDraftDocumentInput / zReviseDocumentInput / zIssuedContentSnapshot / PrintToken 等) | **本書** | sales 内部のみ。他モジュールが必要になったら 07 改訂で昇格 |

---

## 2. データモデル (canonical DDL — migration 0026〜0028)

### 2.1 ER 概観

```
deals (crm 所有) ◄─── documents ◄─── document_lines (税額カラムなし — J5)
                        │  ▲ └─ source jsonb (pricing 由来スナップショット)
                        │  └─ source_document_id (派生元、自己参照)
                        ├──◄ payments        (invoice のみ。削除可 = 訂正)
                        └──◄ issued_documents (電帳法台帳。append-only、
                              version 連鎖: supersedes → 旧版行)
document_sequences (M0 0022) … RPC document_number_next 専用 (直接アクセス禁止)
Storage issued-documents      … documents/{document_id}/v{n}-{sha256 先頭8}.pdf (upsert:false、
                                UPDATE/DELETE は storage.objects trigger で全ロール拒否 — v1.1)
print_tokens / pdf_render_lock / document_revision_stagings (v1.1) … service 専用の補助テーブル
                                (印刷トークン消費 §7.3 / PDF 直列化 lease §7.4-1 / 訂正 staging §4.3-B)
```

設計原則:

1. **明細スナップショット複製** (J5 / ext-hubspot A-11): 派生 (`deriveDocument`) は document_lines を新 document の下へ複製する。価格マスタ・元帳票のその後の変更は波及しない
2. **税額は明細に持たない** (J5 / ext-hubspot B-3): document_lines に税額カラムは存在しない (構造的強制)。税は `computeDocumentTotals` が書類×税率ごとに 1 回だけ丸め、結果を documents.tax_summary (jsonb) にスナップショット保存
3. **発行後不変** (J5 / 電帳法): status が draft を離れたら内容列は trigger (E624) で凍結。訂正は §4.3 の 2 経路 (内容訂正 = 訂正 RPC + 新版発行 / 別書類 = void + 再派生) のみ
4. **台帳 append-only**: issued_documents は INSERT のみ (UPDATE/DELETE は RLS 不在 + revoke + **trigger で service_role さえ拒否**)。訂正の新版は新行の supersedes が旧行を参照する (旧行は書き換えない — 発注指示どおり)
5. 金額列は **bigint** (zJpyAmount の max 9,999,999,999 が int4 を超えるため。円整数、µUSD と混在禁止)
6. 跨モジュール FK は張ってよい (documents.deal_id → deals。posts.source_run_id 前例)。**コードアクセスは facade 経由**

### 2.2 migration 割当

| migration | 内容 | 依存 |
|---|---|---|
| `20260711000026_sales_documents.sql` | documents / document_lines / payments + RLS + 列 grant + trigger (凍結 E624 / 明細 draft ガード / 入金消込) + index + **RPC document_save_draft (v1.1 — draft 保存の原子化)** | 0021 (is_admin_or_service)、0022 (document_number_next)、0023 (deals) |
| `20260711000027_sales_issuance.sql` | issued_documents (append-only trigger 付き) + Storage bucket issued-documents (**storage.objects 不変 trigger — v1.1**) + **print_tokens / pdf_render_lock / document_revision_stagings (v1.1)** + RPC 3 本 (document_finalize_issue / document_append_version / document_apply_revision — 訂正は staging 起点の原子確定) | 0026 |
| `20260711000028_sales_branding_assets.sql` | private Storage bucket **branding-assets** の作成 (角印画像の保存先 — 07 §D5 v1.2。**v1.2 内容置換**: 旧「seal_media_id の media 参照 3 点セット置換」は seal_media_id 廃止 → seal_storage_path 化により不要。§2.3.3) | なし (Storage のみ) |

ファイル名の日付部は実装日の `YYYYMMDD` に読み替える (連番 000026〜000028 は固定)。

### 2.3 DDL 全文

#### 2.3.1 migration 0026 — documents / document_lines / payments

```sql
-- 20260711000026_sales_documents.sql
-- canonical: docs/design/crm-suite/02-sales.md §2.3.1 (裁定 J5)
-- 本 migration が追加するもの:
--   1. documents (帳票ヘッダ。4 種別×7 状態、発行後凍結 trigger、列単位 UPDATE grant)
--   2. document_lines (明細スナップショット。税額カラムなし — J5 の構造的強制)
--   3. payments (入金記録。消込 trigger が documents.status paid⇔issued を維持)
--   4. RPC document_save_draft (draft 保存の原子化 — v1.1)
-- 前提: 0021 (is_admin_or_service) / 0022 (document_number_next) / 0023 (deals) 適用済み
-- 設計判断の記録:
--   - 金額は bigint (zJpyAmount max 9,999,999,999 > int4)。値制約 (上限等) は Zod が正 (DDL は構造のみ)
--   - doc_no は draft で null、発行後は不変 (check + 凍結 trigger + 列 grant 除外の 3 重)
--   - payments に updated_at なし (不変。訂正 = DELETE + 再 INSERT — 00-overview §5.2)
--   - grant は必ず revoke all from anon, authenticated を先行 (v1.1 — default privileges の
--     テーブルレベル grant が残ると列単位 UPDATE grant が無効化される。0020/0022 の教訓の完全適用)

-- ---------- documents ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('quote', 'order', 'delivery', 'invoice')),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'accepted', 'declined', 'expired', 'paid', 'voided')),
  deal_id uuid not null references deals(id),
  source_document_id uuid references documents(id),  -- 派生元 (null = 起点)。on delete 制約なし (draft 削除時も系譜は残す → 参照先が draft 削除されるケースは派生規則上発生しない: 派生元は issued のみ)
  doc_no text unique,                                -- 発行時に document_number_next (M0 0022) で採番
  current_version int not null default 0 check (current_version >= 0),
  issue_date date,                                   -- JST 発行日 (書類の作成・交付日。取引年月日とは分離 — v1.1)
  transaction_date date,                             -- 取引年月日 (納品日/役務提供完了日 — v1.1。null = issue_date と同日扱い。
                                                     --   インボイス必須記載事項 2 と電帳法台帳 transaction_date の源。
                                                     --   「納品後、月末に請求」で発行日と取引日がずれるため issue_date と別列)
  valid_until date,                                  -- quote のみ (有効期限)
  billing_name text not null,                        -- 宛名スナップショット (作成時に deal の顧客/会社から複製、draft 中編集可)
  billing_suffix text not null default '様' check (billing_suffix in ('様', '御中')),
  billing_address text,
  site_name text,                                    -- 現場名 (塗装業慣行 — ext-hubspot B-11)
  site_address text,
  notes text,                                        -- 備考 (帳票に印字)
  tax_rounding text not null default 'floor' check (tax_rounding in ('floor', 'round', 'ceil')),
    -- 作成時に settings 'invoice_issuer'.tax_rounding を複製 (書類ごとに確定 — 設定変更が既存書類に波及しない)
  subtotal_jpy bigint not null default 0,            -- 税抜小計 (draft は保存ごと再計算、発行時に凍結)
  tax_summary jsonb not null default '[]',           -- zTaxSummary (書類×税率スナップショット — J5)
  total_jpy bigint not null default 0,               -- 税込合計
  issuer_snapshot jsonb,                             -- zIssuerSnapshot (発行時に settings から合成。draft は null)
  status_reason text,                                -- declined / voided の理由 (voided は必須 — facade 検証)
  issued_at timestamptz,                             -- 初回発行時刻 (以後不変)
  paid_at timestamptz,                               -- invoice 完済時刻 (payments trigger が維持)
  voided_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (doc_type = 'quote' or valid_until is null),
  check (status not in ('accepted', 'declined', 'expired') or doc_type = 'quote'),
  check (status <> 'paid' or doc_type = 'invoice'),
  check ((status = 'draft') = (doc_no is null)),
  check ((status = 'draft') = (issued_at is null)),
  check ((status = 'draft') = (current_version = 0)),
  check ((status = 'draft') = (issuer_snapshot is null))
);

comment on table documents is
  '帳票 (見積/受注/納品/請求)。派生は明細複製スナップショット、発行後は内容凍結 (KMB-E624)。canonical: 02-sales.md §2';
comment on column documents.tax_summary is
  '税率区分別の集計スナップショット (zTaxSummary)。消費税は書類×税率ごと 1 回丸め — 明細行に税額を持たない (裁定 J5)';
comment on column documents.current_version is
  '発行版番号 (0=未発行)。issued_documents (document_id, version) と 1:1。RPC のみが更新';

create index documents_deal_idx on documents (deal_id);
create index documents_type_status_idx on documents (doc_type, status);
create index documents_issue_date_idx on documents (issue_date desc);
create index documents_created_idx on documents (created_at desc, id desc); -- keyset 一覧

create trigger handle_updated_at before update on documents
  for each row execute function extensions.moddatetime(updated_at);

-- 発行後凍結 trigger (KMB-E624)。訂正は document_apply_revision (0027) が
-- transaction-local GUC 'kmb.sales_revision_unlock' を立てて通過する
create or replace function public.documents_freeze_after_issue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'draft' then
    return new; -- draft 中は自由 (発行遷移 draft→issued もここを通る)
  end if;
  if old.status = 'voided' then
    raise exception 'KMB-E621: 取消済みの帳票は変更できません';
  end if;
  -- 入金記録のある invoice の取消を DB レベルで拒否 (v1.1 — facade の入金 0 件チェックと
  -- 部分入金 INSERT の TOCTOU レース対策。payments_apply の FOR UPDATE と本 UPDATE の
  -- 行ロックが直列化するため、この判定は常に最新の payments を見る)
  if new.status = 'voided' and old.doc_type = 'invoice'
     and exists (select 1 from payments where document_id = new.id) then
    raise exception 'KMB-E621: 入金記録のある請求書は取消できません (先に入金記録を削除してください)';
  end if;
  if coalesce(current_setting('kmb.sales_revision_unlock', true), '') = 'on' then
    return new; -- 訂正 RPC 経由のみ (0027 document_apply_revision)
  end if;
  -- 凍結対象外 = status / status_reason / voided_at / paid_at / current_version / updated_at
  if new.doc_type is distinct from old.doc_type
     or new.deal_id is distinct from old.deal_id
     or new.source_document_id is distinct from old.source_document_id
     or new.doc_no is distinct from old.doc_no
     or new.issue_date is distinct from old.issue_date
     or new.transaction_date is distinct from old.transaction_date
     or new.valid_until is distinct from old.valid_until
     or new.billing_name is distinct from old.billing_name
     or new.billing_suffix is distinct from old.billing_suffix
     or new.billing_address is distinct from old.billing_address
     or new.site_name is distinct from old.site_name
     or new.site_address is distinct from old.site_address
     or new.notes is distinct from old.notes
     or new.tax_rounding is distinct from old.tax_rounding
     or new.subtotal_jpy is distinct from old.subtotal_jpy
     or new.tax_summary is distinct from old.tax_summary
     or new.total_jpy is distinct from old.total_jpy
     or new.issuer_snapshot is distinct from old.issuer_snapshot
     or new.issued_at is distinct from old.issued_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'KMB-E624: 発行済み帳票の内容は変更できません (訂正は新版発行で行ってください)';
  end if;
  return new;
end;
$$;

create trigger documents_freeze_after_issue before update on documents
  for each row execute function public.documents_freeze_after_issue();

-- RLS: admin データ分類 (0015 パターン: 4 ポリシー + 明示 revoke/grant)
alter table documents enable row level security;

create policy documents_admin_select on documents
  for select using (public.is_admin());
create policy documents_admin_insert on documents
  for insert with check (public.is_admin() and status = 'draft');
create policy documents_admin_update on documents
  for update using (public.is_admin()) with check (public.is_admin());
create policy documents_admin_delete on documents
  for delete using (public.is_admin() and status = 'draft'); -- 発行後の DELETE 不可 (7 年保存)

-- v1.1: authenticated も必ず revoke する。default privileges のテーブルレベル ALL grant が
-- 残ったままだと (grant は加算的なため) 下の列単位 UPDATE grant が制限として機能しない
-- (0020 の実証 + M0 0022 document_sequences と同パターン)
revoke all on documents from anon, authenticated;
grant select, insert, delete on documents to authenticated;
-- 列単位 UPDATE grant: 採番/版/発行スナップショット系 (doc_no, current_version, issuer_snapshot,
-- issued_at, paid_at) は session から書けない (RPC/trigger 専用 — 構造的強制。
-- 上の revoke により列外 UPDATE は permission denied になる)
grant update (status, status_reason, voided_at, issue_date, transaction_date, valid_until,
              billing_name, billing_suffix, billing_address,
              site_name, site_address, notes, tax_rounding,
              subtotal_jpy, tax_summary, total_jpy)
  on documents to authenticated;

-- ---------- document_lines ----------
-- 明細スナップショット。税額カラムは存在しない (裁定 J5 の DDL レベル強制。
-- contracts-ddl-parity テストが「tax を含む列名の不存在」を検証する — §13.2)
create table document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  position int not null check (position >= 0),
  description text not null,
  quantity numeric(8,2) not null check (quantity > 0),
  unit text not null,                                -- 個 / 式 / ㎡ / m / 缶 …
  unit_price_jpy bigint not null,                    -- 負 = 値引き行 (リピート免除等)
  amount_jpy bigint not null,                        -- 既定 = round(quantity × unit_price)。編集可 (税抜)
  tax_category text not null
    check (tax_category in ('standard_10', 'reduced_8', 'zero', 'exempt')),
  work_type_key text,                                -- scheduling ブロック生成ヒント (FK なし — 疎結合)
  source jsonb,                                      -- pricing 由来スナップショット {grade_key, size_key, option_keys} (nullable)
  created_at timestamptz not null default now(),
  unique (document_id, position)
);

comment on table document_lines is
  '帳票明細 (スナップショット)。税額カラムを持たない — 税は書類×税率ごと 1 回丸め (裁定 J5)。draft 保存は全行置換 (delete+insert)';

create index document_lines_document_idx on document_lines (document_id, position);

-- 親が draft のときのみ書き込み可 (発行後の明細不変 — KMB-E624)。
-- 訂正 RPC は GUC で通過。親 DELETE の cascade 中は親行が見えなくなるため素通し
create or replace function public.document_lines_draft_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from documents
    where id = coalesce(new.document_id, old.document_id);
  if v_status is null then
    return coalesce(new, old); -- 親 cascade 削除中
  end if;
  if v_status <> 'draft'
     and coalesce(current_setting('kmb.sales_revision_unlock', true), '') <> 'on' then
    raise exception 'KMB-E624: 発行済み帳票の明細は変更できません';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger document_lines_draft_guard
  before insert or update or delete on document_lines
  for each row execute function public.document_lines_draft_guard();

alter table document_lines enable row level security;
create policy document_lines_admin_select on document_lines
  for select using (public.is_admin());
create policy document_lines_admin_insert on document_lines
  for insert with check (public.is_admin());
create policy document_lines_admin_update on document_lines
  for update using (public.is_admin()) with check (public.is_admin());
create policy document_lines_admin_delete on document_lines
  for delete using (public.is_admin());
revoke all on document_lines from anon, authenticated; -- v1.1: revoke 先行の統一規約 (documents と同旨)
grant select, insert, update, delete on document_lines to authenticated;

-- ---------- payments ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id), -- invoice のみ (trigger 検証)。cascade なし (issued は削除不可)
  paid_on date not null,                              -- 入金日 (JST)
  amount_jpy bigint not null check (amount_jpy > 0),
  method text not null check (method in ('bank_transfer', 'cash', 'other')),
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

comment on table payments is
  '入金記録 (手動消込 — 銀行 API 連携はスコープ外)。不変 (訂正 = DELETE + 再 INSERT)。trigger が残高検証 (KMB-E625) と documents.status paid⇔issued を維持';

create index payments_document_idx on payments (document_id);
create index payments_paid_on_idx on payments (paid_on desc);

-- 消込 trigger: 親 invoice を FOR UPDATE で直列化し、残高超過拒否 + 完済/復帰の状態維持。
-- security definer — paid_at 列は session の UPDATE grant 外のため (documents の列 grant 参照)
create or replace function public.payments_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_sum bigint;
begin
  select * into v_doc from documents
    where id = coalesce(new.document_id, old.document_id)
    for update; -- 同時入金を直列化 (advisory lock 禁止 — pgbouncer)
  if not found then
    raise exception 'KMB-E623: 対象の請求書が見つかりません';
  end if;
  if v_doc.doc_type <> 'invoice' then
    raise exception 'KMB-E623: 入金は請求書 (invoice) にのみ記録できます';
  end if;

  if tg_op = 'INSERT' then
    if v_doc.status not in ('issued', 'paid') then
      raise exception 'KMB-E621: 発行済みの請求書にのみ入金を記録できます (現在: %)', v_doc.status;
    end if;
    select coalesce(sum(amount_jpy), 0) into v_sum
      from payments where document_id = new.document_id;
    if v_sum + new.amount_jpy > v_doc.total_jpy then
      raise exception 'KMB-E625: 入金合計が請求金額を超えます (残高 % 円)',
        v_doc.total_jpy - v_sum;
    end if;
    if v_sum + new.amount_jpy = v_doc.total_jpy then
      update documents set status = 'paid', paid_at = now()
        where id = new.document_id;
    end if;
    return new;
  else -- DELETE
    if v_doc.status = 'voided' then
      raise exception 'KMB-E621: 取消済みの請求書の入金記録は変更できません';
    end if;
    select coalesce(sum(amount_jpy), 0) into v_sum
      from payments where document_id = old.document_id and id <> old.id;
    if v_doc.status = 'paid' and v_sum < v_doc.total_jpy then
      update documents set status = 'issued', paid_at = null
        where id = old.document_id;
    end if;
    return old;
  end if;
end;
$$;

create trigger payments_apply before insert or delete on payments
  for each row execute function public.payments_apply();

alter table payments enable row level security;
create policy payments_admin_select on payments
  for select using (public.is_admin());
create policy payments_admin_insert on payments
  for insert with check (public.is_admin());
create policy payments_admin_delete on payments
  for delete using (public.is_admin());
-- v1.1: authenticated からも revoke 先行。これにより「UPDATE grant なし = 不変」が
-- permission denied として実際に強制される (revoke なしでは default privileges の UPDATE grant が
-- 残り、RLS ポリシー不在の 0 行更新で静かに素通りするだけだった)
revoke all on payments from anon, authenticated;
grant select, insert, delete on payments to authenticated; -- UPDATE grant なし (不変)

-- ---------- RPC: draft 保存 (CAS + ヘッダ + 明細全行置換の原子化 — v1.1) ----------
-- PostgREST 経由の複数ステートメント (delete → insert → update) は独立トランザクションで
-- 原子性がなく、(a) 明細置換が CAS 検証前に適用される楽観排他の破れ、(b) delete 成功後の
-- insert 失敗による明細全消失、が起き得るため RPC 化する。GUC 不要 (draft は凍結対象外)
create or replace function public.document_save_draft(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_header jsonb,      -- zUpdateDraftDocumentInput のヘッダ部 (lines を除く全キー必須で渡す)
  p_lines jsonb,       -- zDocumentLineInput[] (配列順 = position。RPC が ordinality で採番 — 契約に position は無い)
  p_subtotal_jpy bigint,
  p_tax_summary jsonb,
  p_total_jpy bigint
)
returns table (new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_save_draft requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'KMB-E624: 発行済み帳票の内容は変更できません (訂正は新版発行で行ってください)';
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;

  update documents set
    issue_date = (p_header->>'issue_date')::date,
    transaction_date = (p_header->>'transaction_date')::date,
    valid_until = (p_header->>'valid_until')::date,
    billing_name = p_header->>'billing_name',
    billing_suffix = p_header->>'billing_suffix',
    billing_address = p_header->>'billing_address',
    site_name = p_header->>'site_name',
    site_address = p_header->>'site_address',
    notes = p_header->>'notes',
    tax_rounding = p_header->>'tax_rounding',
    subtotal_jpy = p_subtotal_jpy,
    tax_summary = p_tax_summary,
    total_jpy = p_total_jpy
  where id = p_document_id;

  delete from document_lines where document_id = p_document_id;
  insert into document_lines
    (document_id, position, description, quantity, unit,
     unit_price_jpy, amount_jpy, tax_category, work_type_key, source)
  select
    p_document_id,
    (t.ord - 1)::int,
    t.elem->>'description',
    (t.elem->>'quantity')::numeric,
    t.elem->>'unit',
    (t.elem->>'unit_price_jpy')::bigint,
    (t.elem->>'amount_jpy')::bigint,
    t.elem->>'tax_category',
    t.elem->>'work_type_key',
    nullif(t.elem->'source', 'null'::jsonb)
  from jsonb_array_elements(p_lines) with ordinality as t(elem, ord);
  -- p_lines 0 件は許容 (quote_only 原案 — §2.4 パターン 5。発行時 E620 で止まる)

  return query select d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_save_draft(uuid, timestamptz, jsonb, jsonb, bigint, jsonb, bigint) from public, anon;
grant execute on function public.document_save_draft(uuid, timestamptz, jsonb, jsonb, bigint, jsonb, bigint) to authenticated;
```

#### 2.3.2 migration 0027 — issued_documents (電帳法台帳) + Storage + 発行系 RPC

```sql
-- 20260711000027_sales_issuance.sql
-- canonical: docs/design/crm-suite/02-sales.md §2.3.2 (裁定 J5 — 電帳法 append-only 台帳)
-- 本 migration が追加するもの:
--   1. issued_documents 台帳 (append-only: RLS 書込ポリシーなし + revoke + trigger で
--      service_role さえ UPDATE/DELETE 拒否。真実性の確保 — ext-hubspot B-12)
--   2. Storage bucket 'issued-documents' (private、ポリシーなし = service 専用 + 署名 URL 配布)
--      + storage.objects の不変 trigger (v1.1 — service_role の UPDATE/DELETE も構造的に拒否)
--   3. service 専用補助テーブル 3 種 (v1.1): print_tokens (ワンタイム消費 §7.3) /
--      pdf_render_lock (PDF 直列化 lease §7.4-1) / document_revision_stagings (訂正 staging §4.3-B)
--   4. RPC: document_finalize_issue / document_append_version / document_apply_revision
--      (発行・版追加・訂正の原子性を担保。#variable_conflict use_column 必須 — 0019 教訓)
-- 前提: 0026 適用済み

-- ---------- issued_documents ----------
create table issued_documents (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  doc_no text not null,                              -- zDocumentNo (Q/J/D/I-YYYY-NNNN)
  doc_type text not null check (doc_type in ('quote', 'order', 'delivery', 'invoice')),
  version int not null check (version >= 1),         -- 1 始まり。documents.current_version と 1:1
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), -- PDF の SHA-256 (hex)
  transaction_date date not null,                    -- 取引年月日 (電帳法 検索 3 項目 その 1)
  counterparty text not null,                        -- 取引先 (検索 3 項目 その 2) = billing_name
  total_jpy bigint not null,                         -- 金額 (検索 3 項目 その 3、税込)
  storage_path text not null unique,                 -- documents/{document_id}/v{n}-{sha256 先頭8}.pdf
  supersedes uuid references issued_documents(id),   -- 置き換える旧版の行 (v1 は null)。旧行は不変
  content_snapshot jsonb not null,                   -- zIssuedContentSnapshot (版差分表示 §11 + 積上げ計算根拠 B-4)
  issued_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (document_id, version)
);

comment on table issued_documents is
  '電帳法 発行控え台帳。append-only (UPDATE/DELETE は trigger で全ロール拒否)。訂正は新行の supersedes が旧行を参照。7 年保存 = 物理削除機能を持たない';
comment on column issued_documents.content_snapshot is
  '発行時点の帳票内容の完全スナップショット (zIssuedContentSnapshot — 02-sales.md §5.2)。版間差分表示 (§11) と消費税積上げ計算の根拠資料に使う';

create index issued_documents_search_idx
  on issued_documents (transaction_date, total_jpy);           -- 電帳法 検索 3 項目 (範囲)
create index issued_documents_counterparty_idx
  on issued_documents (counterparty);                          -- 取引先検索
create index issued_documents_doc_no_idx on issued_documents (doc_no);

-- append-only の物理強制 (service_role は RLS を bypass するため trigger で守る — gap-pdf §5)
create or replace function public.issued_documents_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'KMB-E627: issued_documents は append-only です (訂正は新版の追加で行う)';
end;
$$;

create trigger issued_documents_append_only
  before update or delete on issued_documents
  for each row execute function public.issued_documents_append_only();

alter table issued_documents enable row level security;
create policy issued_documents_admin_select on issued_documents
  for select using (public.is_admin());
-- INSERT/UPDATE/DELETE ポリシーは作らない (書込は下記 security definer RPC のみ)
revoke all on issued_documents from anon, authenticated; -- v1.1: revoke 先行の統一規約 (0026 と同旨)
grant select on issued_documents to authenticated;

-- ---------- Storage bucket ----------
insert into storage.buckets (id, name, public)
values ('issued-documents', 'issued-documents', false)
on conflict (id) do nothing;
-- ポリシーは一切作らない: 書込は service client (RLS bypass) + upsert:false 固定、
-- 閲覧は service が発行する署名 URL のみ (公開バケット列挙の教訓 0006 / call-audio と同分類)。
-- 00-overview §5.4 の「INSERT ポリシーのみ (UPDATE/DELETE を作らない)」の安全側解釈:
-- 直接アップロード経路を持たないため INSERT ポリシー自体も不要 — 禁止要件 (UPDATE/DELETE
-- ポリシーを作らない) は満たす。

-- 発行済み PDF の不変性を構造で強制 (v1.1): service_role は RLS を bypass するため、
-- 「ポリシーを作らない + upsert:false 規約」だけでは将来の service 経路・保守スクリプトの
-- 誤上書き/削除を防げない。issued_documents 台帳と同水準の trigger ガードを storage.objects に置く
create or replace function public.issued_documents_storage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(old.bucket_id, '') = 'issued-documents' then
    raise exception 'KMB-E627: issued-documents バケットのオブジェクトは変更・削除できません (電帳法 7 年不変保存)';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger issued_documents_storage_guard
  before update or delete on storage.objects
  for each row execute function public.issued_documents_storage_guard();
-- 適用注意: storage.objects への trigger 作成には storage スキーマの権限が必要。
-- supabase migration (postgres ロール) で失敗する場合は Studio SQL (supabase_storage_admin) で
-- 同文を適用し、適用済みであることを 14.2-1 の手順で確認する

-- ---------- print_tokens (印刷トークンのワンタイム消費 — v1.1、§7.3) ----------
create table print_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'), -- sha256(トークン全文) の hex
  document_id uuid not null references documents(id),
  purpose text not null check (purpose in ('pdf', 'preview')),       -- pdf = 発行/再出力/訂正の撮影用、preview = admin 印刷プレビュー
  payload jsonb,                                                     -- {doc_no} (発行フロー) / {staging_id} (訂正フロー)。null = 現 DB 値のみ描画
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table print_tokens is
  '/print 用トークンのワンタイム消費台帳 (v1.1 — 02-sales.md §7.3)。発行 = internal/print-token.ts、消費 = /print route (どちらも service client)。期限切れ行は発行時にベストエフォート掃除';
alter table print_tokens enable row level security;
revoke all on print_tokens from anon, authenticated; -- ポリシーなし + revoke = service 専用

-- ---------- pdf_render_lock (PDF 生成のグローバル直列化 lease — v1.1、§7.4-1) ----------
create table pdf_render_lock (
  id int primary key check (id = 1),                 -- singleton 行
  locked_until timestamptz not null default '-infinity',
  locked_by text
);
insert into pdf_render_lock (id) values (1);
comment on table pdf_render_lock is
  'PDF 生成の同時実行 1 (J5) をインスタンス横断で保証する lease (v1.1 — 02-sales.md §7.4-1)。advisory lock は pgbouncer のため使わない。クラッシュは locked_until 経過で自然回復';
alter table pdf_render_lock enable row level security;
revoke all on pdf_render_lock from anon, authenticated; -- service 専用

-- ---------- document_revision_stagings (訂正発行の staging — v1.1、§4.3-B) ----------
create table document_revision_stagings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  header jsonb not null,                             -- zReviseDocumentInput のヘッダ部 (lines を除く)
  lines jsonb not null,                              -- zDocumentLineInput[] (配列順 = position)
  subtotal_jpy bigint not null,
  tax_summary jsonb not null,
  total_jpy bigint not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
comment on table document_revision_stagings is
  '訂正発行の staging (v1.1 — 02-sales.md §4.3-B)。訂正内容を documents に書く前に隔離し、PDF 生成後に document_apply_revision が単一トランザクションで確定・削除する。孤児行 (PDF 失敗) は次回訂正時にベストエフォート掃除';
alter table document_revision_stagings enable row level security;
revoke all on document_revision_stagings from anon, authenticated; -- service 専用 (facade repository が service client で読み書き)

-- ---------- RPC: 発行の確定 (採番済み doc_no + PDF 保存済みの後、DB 状態を原子的に確定) ----------
create or replace function public.document_finalize_issue(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_doc_no text,
  p_issue_date date,
  p_subtotal_jpy bigint,
  p_tax_summary jsonb,
  p_total_jpy bigint,
  p_issuer_snapshot jsonb,
  p_sha256 text,
  p_storage_path text,
  p_counterparty text,
  p_content_snapshot jsonb
)
returns table (issued_document_id uuid, doc_version int, new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
  v_line_count int;
  v_ledger_id uuid;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_finalize_issue requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'KMB-E621: draft 以外は発行できません (現在: %)', v_doc.status;
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;
  select count(*) into v_line_count from document_lines where document_id = p_document_id;
  if v_line_count = 0 then
    raise exception 'KMB-E620: 明細が 0 行のため発行できません';
  end if;

  begin
    update documents set
      status = 'issued',
      doc_no = p_doc_no,
      issue_date = p_issue_date,
      issued_at = now(),
      current_version = 1,
      subtotal_jpy = p_subtotal_jpy,
      tax_summary = p_tax_summary,
      total_jpy = p_total_jpy,
      issuer_snapshot = p_issuer_snapshot
    where id = p_document_id;

    insert into issued_documents (
      document_id, doc_no, doc_type, version, sha256,
      transaction_date, counterparty, total_jpy, storage_path,
      supersedes, content_snapshot, created_by
    ) values (
      p_document_id, p_doc_no, v_doc.doc_type, 1, p_sha256,
      coalesce(v_doc.transaction_date, p_issue_date), -- v1.1: 取引年月日は transaction_date が正 (null = 発行日と同日)
      p_counterparty, p_total_jpy, p_storage_path,
      null, p_content_snapshot, auth.uid()
    ) returning id into v_ledger_id;
  exception when unique_violation then
    raise exception 'KMB-E622: 書類番号または保存パスが重複しました (%)', p_doc_no;
  end;

  return query
    select v_ledger_id, 1, d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_finalize_issue(uuid, timestamptz, text, date, bigint, jsonb, bigint, jsonb, text, text, text, jsonb) from public, anon;
grant execute on function public.document_finalize_issue(uuid, timestamptz, text, date, bigint, jsonb, bigint, jsonb, text, text, text, jsonb) to authenticated;

-- ---------- RPC: 版の追加 (再出力・訂正発行の台帳 append + current_version 前進) ----------
create or replace function public.document_append_version(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_sha256 text,
  p_storage_path text,
  p_counterparty text,
  p_content_snapshot jsonb
)
returns table (issued_document_id uuid, doc_version int, new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
  v_version int;
  v_supersedes uuid;
  v_ledger_id uuid;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_append_version requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status not in ('issued', 'accepted', 'paid') then
    raise exception 'KMB-E621: この状態の帳票は再発行できません (現在: %)', v_doc.status;
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;

  v_version := v_doc.current_version + 1;
  select id into v_supersedes from issued_documents
    where document_id = p_document_id and version = v_doc.current_version;
  if v_supersedes is null then
    raise exception 'KMB-E627: 台帳に現行版 (v%) が見つかりません', v_doc.current_version;
  end if;

  begin
    insert into issued_documents (
      document_id, doc_no, doc_type, version, sha256,
      transaction_date, counterparty, total_jpy, storage_path,
      supersedes, content_snapshot, created_by
    ) values (
      p_document_id, v_doc.doc_no, v_doc.doc_type, v_version, p_sha256,
      coalesce(v_doc.transaction_date, v_doc.issue_date), -- v1.1: 取引年月日の分離
      p_counterparty, v_doc.total_jpy, p_storage_path,
      v_supersedes, p_content_snapshot, auth.uid()
    ) returning id into v_ledger_id;
  exception when unique_violation then
    raise exception 'KMB-E627: 版番号または保存パスが重複しました (v%)', v_version;
  end;

  update documents set current_version = v_version where id = p_document_id;

  return query
    select v_ledger_id, v_version, d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_append_version(uuid, timestamptz, text, text, text, jsonb) from public, anon;
grant execute on function public.document_append_version(uuid, timestamptz, text, text, text, jsonb) to authenticated;

-- ---------- RPC: 訂正発行の原子確定 (凍結 trigger を GUC で通過する唯一の経路) ----------
-- v1.1: 旧 2 段階 (内容置換 RPC → PDF → append_version) は RPC 成功直後のプロセス死で
-- 「documents の内容 ≠ 台帳最新版」の乖離を電帳法保存対象で許容してしまうため廃止。
-- 訂正内容は document_revision_stagings に隔離し、staging 内容で PDF を生成・保存した後に
-- 本 RPC が documents 更新 + 明細置換 + 台帳 append + current_version 前進を
-- 単一トランザクションで確定する (§4.3-B)。途中失敗で残るのは staging 行と孤児 PDF のみで
-- documents/台帳は無傷 (再実行で回復 — 乖離状態が存在しない)
create or replace function public.document_apply_revision(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_staging_id uuid,   -- document_revision_stagings.id (facade が事前 INSERT — §4.3-B)
  p_sha256 text,       -- staging 内容で生成済みの PDF の SHA-256
  p_storage_path text,
  p_content_snapshot jsonb -- zIssuedContentSnapshot (facade が staging から合成)
)
returns table (issued_document_id uuid, doc_version int, new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
  v_staging document_revision_stagings%rowtype;
  v_payment_count int;
  v_version int;
  v_supersedes uuid;
  v_ledger_id uuid;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_apply_revision requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status not in ('issued', 'accepted') then
    raise exception 'KMB-E621: この状態の帳票は訂正できません (現在: %)', v_doc.status;
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;
  if v_doc.doc_type = 'invoice' then
    select count(*) into v_payment_count from payments where document_id = p_document_id;
    if v_payment_count > 0 then
      raise exception 'KMB-E621: 入金記録のある請求書は訂正できません (入金を削除するか、取消して再発行してください)';
    end if;
  end if;
  select * into v_staging from document_revision_stagings
    where id = p_staging_id and document_id = p_document_id;
  if not found then
    raise exception 'KMB-E621: 訂正内容 (staging) が見つかりません';
  end if;
  if jsonb_array_length(v_staging.lines) = 0 then
    raise exception 'KMB-E620: 明細が 0 行の訂正はできません';
  end if;

  v_version := v_doc.current_version + 1;
  select id into v_supersedes from issued_documents
    where document_id = p_document_id and version = v_doc.current_version;
  if v_supersedes is null then
    raise exception 'KMB-E627: 台帳に現行版 (v%) が見つかりません', v_doc.current_version;
  end if;

  -- transaction-local GUC: 本トランザクション内でのみ凍結 trigger を解除 (pgbouncer 安全)
  perform set_config('kmb.sales_revision_unlock', 'on', true);

  update documents set
    issue_date = (v_staging.header->>'issue_date')::date,
    transaction_date = (v_staging.header->>'transaction_date')::date,
    valid_until = (v_staging.header->>'valid_until')::date,
    billing_name = v_staging.header->>'billing_name',
    billing_suffix = v_staging.header->>'billing_suffix',
    billing_address = v_staging.header->>'billing_address',
    site_name = v_staging.header->>'site_name',
    site_address = v_staging.header->>'site_address',
    notes = v_staging.header->>'notes',
    subtotal_jpy = v_staging.subtotal_jpy,
    tax_summary = v_staging.tax_summary,
    total_jpy = v_staging.total_jpy,
    current_version = v_version
  where id = p_document_id;

  delete from document_lines where document_id = p_document_id;
  insert into document_lines
    (document_id, position, description, quantity, unit,
     unit_price_jpy, amount_jpy, tax_category, work_type_key, source)
  select
    p_document_id,
    (t.ord - 1)::int,  -- v1.1: 契約 (zDocumentLineInput) は position を持たないため ordinality で採番
    t.elem->>'description',
    (t.elem->>'quantity')::numeric,
    t.elem->>'unit',
    (t.elem->>'unit_price_jpy')::bigint,
    (t.elem->>'amount_jpy')::bigint,
    t.elem->>'tax_category',
    t.elem->>'work_type_key',
    nullif(t.elem->'source', 'null'::jsonb)
  from jsonb_array_elements(v_staging.lines) with ordinality as t(elem, ord);

  begin
    insert into issued_documents (
      document_id, doc_no, doc_type, version, sha256,
      transaction_date, counterparty, total_jpy, storage_path,
      supersedes, content_snapshot, created_by
    ) values (
      p_document_id, v_doc.doc_no, v_doc.doc_type, v_version, p_sha256,
      coalesce((v_staging.header->>'transaction_date')::date, (v_staging.header->>'issue_date')::date),
      v_staging.header->>'billing_name', v_staging.total_jpy, p_storage_path,
      v_supersedes, p_content_snapshot, auth.uid()
    ) returning id into v_ledger_id;
  exception when unique_violation then
    raise exception 'KMB-E627: 版番号または保存パスが重複しました (v%)', v_version;
  end;

  delete from document_revision_stagings where id = p_staging_id;

  return query
    select v_ledger_id, v_version, d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_apply_revision(uuid, timestamptz, uuid, text, text, jsonb) from public, anon;
grant execute on function public.document_apply_revision(uuid, timestamptz, uuid, text, text, jsonb) to authenticated;
```

#### 2.3.3 migration 0028 — 角印画像の private バケット branding-assets (07 §D5 v1.2)

**v1.2 内容置換**: 旧 0028 (invoice_issuer.seal_media_id の media 参照 3 点セット置換) は、07-contracts-delta §D5 v1.2 の角印 private 化 (`seal_media_id: zMediaId` 廃止 → `seal_storage_path: string`) により**全文を置換**した。理由 (D5 v1.2 と同一): media テーブルは anon 全行 SELECT + media バケットは public (migration 0002/0003 実測) のため、media 参照のままでは社印画像が匿名取得可能になる (書類偽造の材料)。角印は media を経由せず private バケットに保存し、読み出しは server 側の署名 URL 解決に限定する。media 参照 3 点セット (media_admin_delete / media_reference_summary / ai_draft_cleanup_run) を置換する migration は favicon 分の 0035 (05-site-settings §2.2) のみになった。

```sql
-- 20260711000028_sales_branding_assets.sql
-- canonical: docs/design/crm-suite/02-sales.md §2.3.3 (07-contracts-delta §D5 v1.2 —
--   invoice_issuer.seal_storage_path の保存先バケット)
-- 本 migration が行うこと: 角印画像用の private Storage bucket 'branding-assets' を作成する
-- 本 migration が行わないこと (v1.2 内容置換):
--   - 旧 0028 の media 参照 3 点セットへの seal_media_id 追記 — seal は media 参照ではなく
--     なったため不要 (3 点セットの置換は 0035 = favicon 分のみ)
--   - DDL 変更 (site_settings への key 追加は契約のみ — 既存規約)

insert into storage.buckets (id, name, public)
values ('branding-assets', 'branding-assets', false)
on conflict (id) do nothing;
-- ポリシーは一切作らない (private):
--   書込 = admin 設定タブ「請求書発行者」(§8.6) の Server Action が service client で upload
--   読出 = PDF 生成・/print 描画 (§10.6) が server 側で解決する署名 URL のみ
--   (公開バケット列挙の教訓 0006 / issued-documents・call-audio と同分類)。
-- issued-documents と異なり不変 trigger は置かない — 角印は差し替え・削除が正当な運用
-- (過去帳票の角印は PDF に焼き込み済みで issued-documents 台帳が不変保全する)
```

注記: documents.issuer_snapshot 内の seal_storage_path は発行時点の path の凍結値であり、オブジェクト削除・差し替えに対する参照ガードは置かない (設計判断 — 旧 v1.0/v1.1 の「3 点セット対象外」判断と同旨)。理由: 法的保存対象は生成済み PDF (角印は PDF に焼き込み済みで台帳に確定保存されている)。過去スナップショットが参照するオブジェクトが解決できない場合、再出力 (reissue) 時に角印を印字省略 + 警告表示で degrade する (§10.6)。

### 2.4 全データパターン (必須章⑤)

設計・テストで必ずカバーする現実パターン (00-overview §7 の sales 該当分 + sales 固有):

| # | パターン | 設計上の受け止め |
|---|---|---|
| 1 | 標準フロー quote→order→delivery→invoice→入金 | §4.3 派生許可表。各段で明細複製 |
| 2 | **quote→invoice 直行の小口** (00-overview パターン 8) | DERIVATION_RULES に明記 (07 §4.11)。E623 対象外 |
| 3 | **免税事業者モード** (registration_number null — パターン 9) | 区分記載様式 + 「消費税相当額」表記に自動分岐 (§10.5)。どちらでも壊れない |
| 4 | **リピート案件の値引き行** (パターン 10) | unit_price_jpy 負値 (「初回治具・段取り費 リピート免除」行)。定型行挿入 UI (§8.3) |
| 5 | **XL (quote_only=true) のシミュレーター送信** (パターン 12) | 明細 0 行 + notes メモのみの draft (§9.3)。発行は E620 で止まる (明細を人が書いてから) |
| 6 | 見積のみで終わる失注 (パターン 7) | quote は issued/declined のまま残置。PDF は 7 年保存継続 |
| 7 | 部分入金 → 完済 | payments 複数行。Σ=total で paid (trigger)。残高は詳細画面に常時表示 |
| 8 | 入金の打ち間違い訂正 | payments DELETE + 再 INSERT (§4.4)。paid→issued の自動復帰 |
| 9 | 過入金 | E625 拒否 (受け入れない。実過入金は実務上返金 or 次回相殺 — memo 運用) |
| 10 | 発行済み帳票の金額間違い | 訂正発行 (§4.3-B: revision RPC + 新版) または void + 再派生 (§4.3-C)。入金済みは void 不可 |
| 11 | 有効期限切れ見積 | crm-digest (日次) が issued→expired へ遷移 (§7.5)。期限後の遅れ承諾 expired→accepted 可 |
| 12 | 現場名あり / なし | site_name/site_address nullable。null なら帳票の現場欄を非印字 (§10.3) |
| 13 | 宛名 御中 / 様 | billing_suffix。法人 (company 紐づき deal) は作成時既定 '御中'、個人は '様' |
| 14 | 連番 9999 超 | lpad は切り詰めない (M0 0022)。zDocumentNo は `\d{4,}` で桁増加を許容 |
| 15 | 明細 40 行超 (2 ページ超 PDF) | §10.7 改ページ規則 + counter(pages) スモークテスト必須 (R4) |
| 16 | 採番後の発行失敗 (PDF 生成エラー) | doc_no は消費されるが draft のまま (欠番許容 — 00-overview §3.4)。再発行は新番号 |
| 17 | 角印なし / 振込先なし / 手数料文言なし | seal_storage_path・bank_account・transfer_fee_note すべて null 可 → 各欄を非印字 (§10) |
| 18 | 複数税率混在 (将来: 物販で reduced_8) | tax_summary は税率区分ごとに最大 4 行。exempt/zero も tax_jpy=0 で集計行を残す (07 §4.11) |
| 19 | 消費税ゼロの書類 (exempt のみ) | 税率別集計は「対象外 ¥N / 消費税 ¥0」を印字 (様式が崩れない) |
| 20 | webhook/操作リトライの二重発行 | finalize RPC の CAS (status='draft') + doc_no unique で 2 回目は E621/E622。activity は冪等 (ref) |
| 21 | **シミュレーター由来の通常 draft (S〜L、quote_only=false)** | §9.1 の 1 行集約 + 単価逆算 + notes 概算文言。備考 (シミュレーター内訳) が見積書様式 (§10) の備考欄に**欠落なく印字**されること (06-simulator 申し送り — 07-delta v1.1 裁定 #16)。参考パネルは §11.2 |
| 22 | **納品後の月末請求 (取引日 ≠ 発行日) — v1.1** | documents.transaction_date (§2.3.1)。invoice は納品日を取引年月日として印字 (§10.3) し台帳 transaction_date に保存。delivery→invoice 派生で自動引継ぎ (§4.4)。null なら issue_date と同日扱い |
| 23 | 合計 0 円の請求書 (全額値引き・exempt のみ) — v1.1 | 発行時ガードで E101 拒否 (§5.3)。payments は amount > 0 のみで 0 円 invoice は paid に到達できず未消込ダイジェストに恒久残留するため、発行自体を止める (請求不要なら発行しない) |
| 24 | **複数請求への一括振込** (顧客が請求書 A/B をまとめて振込) — v1.1 | v1 は請求書ごとに分割して記録し、memo に出所 (「I-2026-00xx 分と合算入金 ¥N のうち」等) を残す (§8.5)。入金実体と配賦の分離 (payment_receipts/allocations) は §18 の将来拡張 — 銀行明細 1:1 対応は銀行 API 連携 (§0.5 スコープ外) と同時に設計する |

### 2.5 JSONB カラム ↔ 型契約対応表

| カラム | canonical スキーマ | 備考 |
|---|---|---|
| documents.tax_summary | `zTaxSummary` (契約書 §4.11 = 07 §D7) | 書類×税率の集計スナップショット。読み書き両方で parse |
| documents.issuer_snapshot | `zIssuerSnapshot` (本書 §5.2) | 発行時に settings 'company' + 'invoice_issuer' から合成。draft は null |
| document_lines.source | `zDocumentLineInput.shape.source` (契約書 §4.11) | pricing 由来 {grade_key, size_key, option_keys}。nullable |
| issued_documents.content_snapshot | `zIssuedContentSnapshot` (本書 §5.2) | 発行時点の帳票内容全量。版差分 (§11) の入力 |
| print_tokens.payload | `zPrintTokenExtras` (本書 §5.2 — v1.1) | {doc_no} (発行フロー) / {staging_id} (訂正フロー)。nullable |
| document_revision_stagings.header / .lines | `zReviseDocumentInput` のヘッダ部 / `zDocumentLineInput[]` (v1.1) | 訂正 staging (§4.3-B)。apply_revision RPC が読む |

### 2.6 データ規約 (sales 固有)

1. 金額列は全て **bigint・円整数** (税抜/税込は列コメントで明示)。µUSD と混在禁止
2. 日付列 (issue_date / valid_until / paid_on / transaction_date) は **date 型・JST の日付** (zDateOnly)。timestamptz 列 (issued_at 等) は UTC 保存 + Asia/Tokyo 表示 (既存規約)
3. draft の明細保存は**全行置換** (delete + insert、position 0 始まり連番 — RPC が ordinality で採番)。行単位 PATCH はしない。**保存は RPC `document_save_draft` (§2.3.1) の単一トランザクション** (v1.1 — PostgREST の複数ステートメントでは CAS 迂回と部分失敗による明細消失が防げないため。/admin/prices の replace は「行単位 PATCH をしない」方針の前例であって方式は異なる — 実コードは差分 delete + upsert(onConflict)・CAS なし)。楽観排他は親 documents.updated_at の生文字列比較 1 本 (RPC 内で検証)
4. documents.subtotal_jpy / tax_summary / total_jpy は draft 保存のたびにサーバ側で `computeDocumentTotals` を再計算して保存 (クライアント計算値を信用しない)。発行時に最終再計算して凍結
5. description 等の文字列は既存規約どおり NFC 正規化 (zShortText 経由)
6. keyset ページネーションは (created_at, id) 降順・50 件/頁 (admin 既定)
7. **document_sequences へのアクセスは repository の `document_number_next` RPC 呼び出しのみ** (M0 0022 利用規約)。`p_year` は issue_date の **JST 年** を呼び出し側 (repository) が解決して渡す

---

## 3. 認可マトリクスと RLS (必須章①)

### 3.1 ロール定義

00-overview §5.1 のとおり (anon / admin / service / 将来 staff)。本書は sales 所有分の詳細のみ。

### 3.2 テーブル認可 (4 列。ポリシー全文は §2.3 DDL が正)

| テーブル | anon | admin | service | 将来 staff (方針) | 強制手段 |
|---|---|---|---|---|---|
| documents | ✗ (revoke) | SELECT / INSERT (draft のみ) / UPDATE (**列 grant 制限**: doc_no・current_version・issuer_snapshot・issued_at・paid_at は不可) / DELETE (draft のみ) | ○ (RLS bypass。ただし発行系書込は RPC 経由が規約) | R のみ | RLS 4 ポリシー + 列 grant + 凍結 trigger (E624) |
| document_lines | ✗ | SELECT/INSERT/UPDATE/DELETE (親 draft のみ — trigger) | ○ (同上) | R | RLS + draft ガード trigger |
| payments | ✗ | SELECT / INSERT / DELETE (UPDATE は grant 自体なし = 不変) | ○ | R | RLS + 消込 trigger (E625/E621) |
| document_sequences | ✗ | ✗ (RPC のみ) | RPC のみ | ✗ | M0 0022 (ポリシーなし + revoke) |
| issued_documents | ✗ | SELECT のみ | INSERT は RPC 経由のみ。**UPDATE/DELETE は trigger で service も拒否** | R | RLS (SELECT のみ) + append-only trigger (E627) |
| print_tokens / pdf_render_lock / document_revision_stagings (v1.1) | ✗ | ✗ (直接アクセス経路なし) | ○ (facade/route の service client のみ) | ✗ | RLS 有効 + ポリシーなし + revoke (anon, authenticated) |

RLS 有効化だけでは default privileges の grant が残る点 (0020 教訓) に対応し、全テーブルで **`revoke all from anon, authenticated` を先行**させてから必要な grant のみ再付与する (§2.3 — v1.1: anon のみの revoke ではテーブルレベル grant が残り、documents の列単位 UPDATE grant と payments の「UPDATE grant なし = 不変」が機能しない。列外 UPDATE の期待エラーは **permission denied**、0 行素通りではない)。

### 3.3 Storage / RPC 認可

| 対象 | anon | admin | service | 将来 staff |
|---|---|---|---|---|
| bucket `issued-documents` | ✗ | ✗ (直接アクセス経路なし。閲覧は署名 URL) | INSERT のみ (upsert:false 固定) + 署名 URL 発行。**UPDATE/DELETE は storage.objects trigger で service も拒否 (v1.1)** | 署名 URL 経由 R |
| bucket `branding-assets` (v1.2 — §2.3.3) | ✗ | ✗ (直接アクセス経路なし。設定タブのアップロード/プレビューは Server Action 経由) | INSERT/UPDATE/DELETE (角印の差し替え・削除は正当な運用) + 署名 URL 発行 | 署名 URL 経由 R |
| RPC document_number_next (M0) | ✗ | ○ (is_admin_or_service) | ○ | ✗ (staff 導入時に要裁定) |
| RPC document_save_draft / document_finalize_issue / document_append_version / document_apply_revision | ✗ | ○ (is_admin_or_service ガード) | ○ | ✗ (同上) |

### 3.4 API エンドポイント認可 (sales 追加分。00-overview §5.3 と 1:1)

| エンドポイント | Method | 認可 | リクエスト/応答 | 主エラー |
|---|---|---|---|---|
| `/print/documents/[id]` | GET | **署名付きワンタイムトークン** (`?token=` — §7.3。HMAC-SHA256 + print_tokens 消費、TTL 5 分・**1 回限り** — v1.1) | HTML (印刷専用ページ) | E642 (403) |
| `/api/documents/[id]/pdf` | GET | admin セッション (requireAdmin)。`?version=n` (省略時 current_version) | `{ url, expires_at }` (issued-documents の署名 URL、TTL 10 分) | E201/E202/E627 |
| Server Actions (§7.1 全部) | POST | 先頭 `requireAdmin()` + Zod parse (既存規約。works/actions.ts の歴史的例外は踏襲しない) | Result 変換 | §12 全表 |

`robots.ts` への `/print` disallow 追加は 05-site-settings.md の Issue に含まれる (00-overview §5.3)。middleware matcher は `/admin/:path*` のままで `/print` は**保護対象に含めない** (トークンが唯一の認可 — Chromium はセッションを持たないため)。

### 3.5 将来 staff 拡張差分 (J1)

00-overview §5.5 の共通骨子に従う。sales 固有の差分: staff は帳票 R のみ (発行・入金・訂正・取消は admin 専権)。RLS は `{table}_staff_select` を**追加** (置換しない)。発行系 RPC の `is_admin_or_service()` は staff を含まないため変更不要。

---

## 4. ライフサイクルと状態意味論 (必須章④⑨)

### 4.1 documents.status 状態機械

```
                                     ┌────────────► voided (終端)
                                     │ (発行後のみ。invoice は入金 0 件時のみ)
draft ──issue──► issued ─────────────┤
  │                │                 │
  │ (DELETE 可)    │ quote:          ├─► accepted ──────► voided
  │                ├─► declined (終端)│      ▲
  │                └─► expired ──────┼──────┘ (遅れ承諾)
  │                                  │
  └─(quote_only 原案は明細 0 行のまま滞留可 — 発行は E620 で阻止)
invoice のみ:      issued ◄──────► paid
                     (Σ入金=total で paid / 入金削除で issued に復帰 — trigger 維持)
```

### 4.2 状態 × 意味論表

| 状態 | 意味論 | 内容編集 | 遷移可能先 | 対象種別 |
|---|---|---|---|---|
| draft | 下書き。採番なし (doc_no null)・PDF なし・台帳なし | ○ (全項目) | issued (発行) / 物理 DELETE | 全種別 |
| issued | 発行済み。doc_no + PDF v1 + 台帳行あり。**内容凍結 (E624)** | ✗ (訂正 = §4.3-B/C) | quote: accepted/declined/expired/voided。order/delivery: voided。invoice: paid/voided | 全種別 |
| accepted | (quote) 顧客が承諾。派生 (→order/→invoice) の起点として有効 | ✗ | voided | quote |
| declined | (quote) 辞退。終端 | ✗ | — | quote |
| expired | (quote) 有効期限超過 (crm-digest が日次で issued→expired 遷移) | ✗ | accepted (遅れ承諾) / voided | quote |
| paid | (invoice) 完済 (Σ入金 = total)。paid_at 記録 | ✗ | issued (入金削除による自動復帰のみ) | invoice |
| voided | 取消。**完全終端 (status 含め一切更新不可 — 凍結 trigger)**。PDF/台帳は保存継続 (7 年) | ✗ | — | 全種別 (発行後のみ) |

遷移の実行主体: issue = `issueDocument` (RPC 経由)。accepted/declined/expired/voided = status 列の session UPDATE (facade の遷移ガード `canTransition` + 凍結 trigger の 2 重検証。**voided は加えて「入金記録のある invoice を拒否」する trigger ガードで 3 重** — v1.1、部分入金 INSERT との TOCTOU レース対策 §2.3.1)。paid⇔issued = payments trigger のみ (手動遷移禁止)。

### 4.3 訂正・取消の 3 経路 (J5 の意味論)

| 経路 | 対象 | 操作 | 結果 |
|---|---|---|---|
| A. 再出力 (内容同一) | issued/accepted/paid | `reissueDocument` (契約) | 同一内容で PDF を撮り直し version+1。台帳 append (supersedes)。用途: 保存失敗復旧・角印/レイアウト是正後の再出力 |
| B. 訂正発行 (内容変更) | issued/accepted (invoice は入金 0 件のみ) | `reviseAndReissueDocument` (拡張 §6.2) = 入力検証・税ガード → **staging INSERT (document_revision_stagings) → staging 内容で PDF 生成・Storage 保存 → `document_apply_revision` RPC が documents 更新 + 明細置換 + 台帳 append + version 前進を単一トランザクションで確定** (v1.1 — 乖離状態なし §4.5-4) | 明細・宛名・金額を差し替えて version+1。旧版の PDF/台帳行は不変のまま supersedes で参照。版間差分表示 (§11) の対象 |
| C. 取消 + 再作成 | 上記で扱えないもの (種別間違い・入金済み invoice・案件違い) | **入金済み invoice は先に入金記録を全削除して issued に戻す** (§4.5-1 の自動復帰。paid に voided 遷移はなく、voidDocument も入金 0 件を要求するため — v1.1 手順明記) → `voidDocument` (理由必須) → 必要なら派生元から再 derive | 旧帳票は voided で凍結・保存継続。新帳票は新 doc_no |

### 4.4 派生 (deriveDocument) の意味論

- 許可表は `DERIVATION_RULES` (07 §4.11 canonical): quote→order / quote→invoice / order→delivery / delivery→invoice。表外は **E623**
- 派生元の状態条件: **issued または accepted** (draft/declined/expired/voided/paid からは派生不可 — E623)。quote→order は accepted を推奨するが issued からも可 (口頭承諾の実務)
- 複製内容: document_lines 全行 (id 新規・position 維持・source/work_type_key 引継ぎ) + billing_* / site_* / notes / tax_rounding。issue_date/valid_until/doc_no/税集計は複製しない (新 draft で再計算)
- **transaction_date の引継ぎ (v1.1)**: delivery→invoice は派生元 delivery の issue_date (= 納品日) を transaction_date の初期値に設定 (「納品後、月末に請求」で取引年月日が自動で正しくなる — §2.4 パターン 22)。それ以外の派生は null (draft で編集可。null のまま発行 = issue_date と同日扱い)
- 派生先は常に **draft** (採番しない)。同一 source からの多重派生は許容 (例: 分割請求は将来要件 — v1 では UI 上警告のみ)
- deal との関係: 派生先の deal_id は派生元と同一 (変更不可)

### 4.5 入金 (payments) ライフサイクルと版 (issued_documents) の不変条件

1. payments は invoice の issued/paid にのみ INSERT 可 (trigger)。DELETE で残高不足になれば paid→issued 自動復帰。UPDATE 経路なし
2. issued_documents は INSERT のみ。**(document_id, version) は 1:1 で documents.current_version と一致** (append RPC が維持)
3. supersedes 連鎖: v1←v2←…←vN の単方向。**旧行の UPDATE は行わない** (superseded_by 方式は採らない — 00-overview §4.4)
4. 「documents の内容 ≠ 台帳最新版」の乖離は**構造的に発生しない** (v1.1): 訂正発行は staging → PDF → 単一 RPC 確定 (§4.3-B)、発行/再出力も「PDF 保存 → RPC 確定」の順で、documents と台帳の更新は常に同一トランザクション。RPC 前の失敗で残るのは staging 行と孤児 PDF のみ (どちらも台帳未参照で無害。staging は次回訂正時にベストエフォート掃除 — §2.3.2)。旧設計の「版の再発行が未完了」バッジと sha256 比較検出は廃止
5. won_at 等 deal 側の不変条件は 01-crm.md の管轄。sales は deal.stage を**読みもしない** (提案は戻り値 event を app 層が解釈)

### 4.6 deal ステージとの整合 (00-overview §6.2 の適用)

| sales イベント | app 層の提案遷移 | 備考 |
|---|---|---|
| quote issued | quote_sent | |
| order issued | ordered (won 確定) | 00-overview §4.1 の受注フロー |
| delivery issued | delivered | |
| invoice issued | invoiced | |
| recordPayment で invoice_paid=true | paid | **自動適用しない — 確認ダイアログ (§7.1-2、v1.1)**。paid は 01-crm §4.2 の「遷移一切不可の終端」で undo (paid→invoiced) が必ず E602 拒否されるため |
| voidDocument / declineQuote | 提案なし (手動判断) | 乖離はダッシュボード乖離バッジ |

適用方式は §7.1-2 (非終端ステージ = 自動適用 + トースト undo / **paid (終端) = 確認ダイアログ** — v1.1。E602 不正遷移はスキップ + 乖離バッジ)。

---

## 5. 値契約 (Zod) と税計算仕様

### 5.1 canonical の参照 (再定義しない)

07-contracts-delta §4.11 の全定義 (§1.4 の表参照) を `src/modules/sales/contracts.ts` に写経する。共通スカラーは platform/contracts.ts (07 §D4 追加分含む) を import。**as any / any 禁止。JSON Schema が必要になった場合 (AI 連携の将来拡張) は zod v4 `z.toJSONSchema()` のみ** (zod-to-json-schema 禁止)。

### 5.2 sales 内部契約 (本書 canonical — sales/contracts.ts に追加)

```ts
import { z } from "zod";
import {
  zDateOnly, zJpyAmount, zShortText,
  zInvoiceRegistrationNumber, zTaxCategory, zTaxRounding,
} from "@/modules/platform/contracts";
// v1.2: zMediaId import 削除 — seal_media_id 廃止 (07 §D5 v1.2) に伴い media 参照が消滅
import { zDocType, zDocumentLineInput, zDocumentNo, zTaxSummary } from "./contracts-canonical";
// ↑ 実装では同一ファイル内 (contracts.ts)。本書では canonical 群 (§5.1) との区別のため擬似的に分けて表記

/** 銀行口座 (zInvoiceIssuerSettings.bank_account と構造的同型 — 07 §D5。
 *  settings への contracts import を避けるための独立定義 (契約書 §2 の定石) */
export const zBankAccountSnapshot = z.object({
  bank_name: zShortText(40),
  branch_name: zShortText(40),
  account_type: z.enum(["ordinary", "checking"]),
  account_number: z.string().regex(/^\d{4,8}$/),
  account_holder_kana: zShortText(60),
}).strict();

/** 発行者スナップショット (documents.issuer_snapshot)。
 *  発行時に settings 'invoice_issuer' + 'company' (住所/電話) から合成し凍結 (internal/issuer.ts)。
 *  registration_number null = 免税モード → 区分記載様式に分岐 (§10.5) */
export const zIssuerSnapshot = z.object({
  issuer_name: zShortText(80),
  registration_number: zInvoiceRegistrationNumber.nullable(),
  address: z.string().max(200).nullable(),   // settings 'company' から
  tel: z.string().max(30).nullable(),        // 同上 (表示用生文字列のまま)
  email: z.string().email().max(120).nullable(),
  seal_storage_path: z.string().max(300).nullable(), // 角印 (branding-assets private バケット内 path の凍結値 —
                                             //   07 §D5 v1.2。§10.6。v1.2: 旧 seal_media_id (media 参照) を廃止)
  bank_account: zBankAccountSnapshot.nullable(),   // null = 振込先欄を非印字
  transfer_fee_note: z.string().max(100).nullable(), // 請求書のみ印字
}).strict();
export type IssuerSnapshot = z.infer<typeof zIssuerSnapshot>;

/** draft 更新入力 (updateDraftDocument)。zCreateDocumentInput (07 §4.11) との差 =
 *  宛名系を持つ (作成時は deal から自動複製、以後は編集可) + doc_type/deal_id は変更不可のため持たない */
export const zUpdateDraftDocumentInput = z.object({
  issue_date: zDateOnly.nullable(),          // null = 発行時に JST 今日
  transaction_date: zDateOnly.nullable(),    // 取引年月日 (納品日/役務提供完了日 — v1.1。null = issue_date と同日扱い §10.3)
  valid_until: zDateOnly.nullable(),         // quote 以外は null 必須 (refine)
  billing_name: zShortText(80),
  billing_suffix: z.enum(["様", "御中"]),
  billing_address: z.string().max(200).nullable(),
  site_name: zShortText(80).nullable(),
  site_address: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  tax_rounding: zTaxRounding,
  lines: z.array(zDocumentLineInput).min(0).max(100), // draft は 0 行許容 (quote_only 原案)。発行時 E620
}).strict();
export type UpdateDraftDocumentInput = z.infer<typeof zUpdateDraftDocumentInput>;

/** 訂正発行入力 (reviseAndReissueDocument)。tax_rounding は凍結 (丸め方式の変更は void + 再発行)。
 *  issue_date は非 null 必須 (台帳 transaction_date になるため) */
export const zReviseDocumentInput = z.object({
  issue_date: zDateOnly,
  transaction_date: zDateOnly.nullable(),    // v1.1 (zUpdateDraftDocumentInput と同義)
  valid_until: zDateOnly.nullable(),         // quote 以外は null 必須 (refine — v1.1。zUpdateDraftDocumentInput と同一。
                                             //   refine なしだと DB check 違反が KMB 未変換の生 E901 で表面化するため必須)
  billing_name: zShortText(80),
  billing_suffix: z.enum(["様", "御中"]),
  billing_address: z.string().max(200).nullable(),
  site_name: zShortText(80).nullable(),
  site_address: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  lines: z.array(zDocumentLineInput).min(1).max(100),
}).strict();
export type ReviseDocumentInput = z.infer<typeof zReviseDocumentInput>;

/** 台帳の内容スナップショット (issued_documents.content_snapshot)。版間差分 (§11) の入力 */
export const zIssuedContentSnapshot = z.object({
  doc_type: zDocType,
  doc_no: zDocumentNo,
  version: z.number().int().min(1),
  issue_date: zDateOnly,
  transaction_date: zDateOnly,               // 取引年月日 (発行時に null → issue_date で解決済みの確定値 — v1.1)
  valid_until: zDateOnly.nullable(),
  billing_name: zShortText(80),
  billing_suffix: z.enum(["様", "御中"]),
  billing_address: z.string().max(200).nullable(),
  site_name: z.string().max(80).nullable(),
  site_address: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
  tax_rounding: zTaxRounding,
  issuer: zIssuerSnapshot,
  lines: z.array(z.object({
    position: z.number().int().min(0),
    description: z.string().max(200),
    quantity: z.number().positive(),
    unit: z.string().max(10),
    unit_price_jpy: z.number().int(),
    amount_jpy: z.number().int(),
    tax_category: zTaxCategory,
  }).strict()).min(1).max(100),
  subtotal_jpy: z.number().int(),
  tax_summary: zTaxSummary,
  total_jpy: z.number().int(),
}).strict();
export type IssuedContentSnapshot = z.infer<typeof zIssuedContentSnapshot>;

/** 一覧フィルタ (listDocuments) */
export const zDocumentListFilter = z.object({
  doc_type: zDocType.nullable(),
  status: z.enum(["draft", "issued", "accepted", "declined", "expired", "paid", "voided"]).nullable(),
  deal_id: z.string().uuid().nullable(),
  q: z.string().max(80).nullable(),          // doc_no / billing_name 部分一致
}).strict();

/** 入金記録入力は zPaymentInput (07 §4.11 canonical) をそのまま使用 */

/* ---------- 読み取りビュー型 (Zod 化しない — DB 出力の正しさは repository + DDL が保証。既存規約 §4.9) ---------- */

export type DocumentListItem = {
  id: string;
  doc_type: z.infer<typeof zDocType>;
  status: string;
  doc_no: string | null;
  billing_name: string;
  deal_id: string;
  deal_title: string;               // crm 参照 (repository が deals を join せず、頁の deal_id をまとめて
                                    //   CrmFacade.getDealRefs (batch — Δs4 §17 / 07 §D8 v1.7) の 1 回の呼び出しで
                                    //   解決する — 50 件/頁の N+1 回避。契約外拡張 getDeal は使わない — §1.2)
  total_jpy: number;
  issue_date: string | null;
  created_at: string;
  updated_at: string;               // 楽観排他用 生文字列
};

export type DocumentDetail = {
  document: DocumentListItem & {
    source_document_id: string | null;
    current_version: number;
    valid_until: string | null;
    billing_suffix: "様" | "御中";
    billing_address: string | null;
    site_name: string | null;
    site_address: string | null;
    notes: string | null;
    tax_rounding: z.infer<typeof zTaxRounding>;
    subtotal_jpy: number;
    tax_summary: z.infer<typeof zTaxSummary>;
    issuer_snapshot: IssuerSnapshot | null;
    status_reason: string | null;
    issued_at: string | null;
    paid_at: string | null;
  };
  lines: Array<{
    id: string; position: number; description: string; quantity: number; unit: string;
    unit_price_jpy: number; amount_jpy: number;
    tax_category: z.infer<typeof zTaxCategory>;
    work_type_key: string | null;
    source: { grade_key: string; size_key: string; option_keys: string[] } | null;
  }>;
  payments: Array<{
    id: string; paid_on: string; amount_jpy: number;
    method: "bank_transfer" | "cash" | "other"; memo: string | null; created_at: string;
  }>;
  versions: Array<{
    issued_document_id: string; version: number; sha256: string; issued_at: string;
    supersedes: string | null; storage_path: string;
  }>;
  balance_jpy: number;              // invoice のみ意味を持つ (total − Σ入金)
  derivable_to: Array<z.infer<typeof zDocType>>; // DERIVATION_RULES × 現状態から算出
};

export type SalesDigest = {
  expiring_quotes: Array<{ document_id: string; doc_no: string; billing_name: string; valid_until: string; total_jpy: number }>; // 期限 7 日以内 + 超過済み (issued のみ)
  unpaid_invoices: Array<{ document_id: string; doc_no: string; billing_name: string; issue_date: string; total_jpy: number; paid_jpy: number; balance_jpy: number }>;
};

/* ---------- 印刷トークン (internal/print-token.ts) ---------- */

/** トークン文字列 = `${document_id}.${exp}.${hmacHex}`
 *  hmacHex = HMAC-SHA256(`${document_id}.${exp}`, PRINT_TOKEN_SECRET) の hex。
 *  exp = unix 秒 (発行から 300 秒)。検証は timingSafeEqual + print_tokens 消費 (§7.3 — v1.1 ワンタイム)。
 *  doc_no / staging_id は URL クエリでなく print_tokens.payload で渡す (v1.1 — 旧 ?doc_no= 連結は廃止) */
export type PrintTokenPayload = { document_id: string; exp: number };

/** print_tokens.payload (v1.1)。null = 現 DB 値のみ描画 */
export const zPrintTokenExtras = z.object({
  doc_no: zDocumentNo.optional(),            // 発行フロー中のみ (DB 未保存の番号を紙面へ — §6.1-5)
  staging_id: z.string().uuid().optional(),  // 訂正フロー中のみ (staging 内容で描画 — §4.3-B)
}).strict();
```

### 5.3 税計算仕様 (`sales/tax.ts` — 純関数、単体テスト必須。裁定 J5 / ブリーフ D4)

```ts
import type { z } from "zod";
import type { zTaxRounding } from "@/modules/platform/contracts";
import { TAX_RATE_BY_CATEGORY, type TaxCategory } from "@/modules/platform/contracts";
import type { DocumentTotals } from "./contracts"; // 07 §4.11 canonical

type TaxRounding = z.infer<typeof zTaxRounding>;
type LineForTax = { amount_jpy: number; tax_category: TaxCategory };

/** 丸め (数学的定義。floor = 負方向、ceil = 正方向、round = Math.round に一致)。
 *  注意 (v1.1): Math.round は負値で正方向に丸める (Math.round(-1.5) = -1) — 日本語の
 *  「四捨五入」(絶対値 0.5 切上げ → -2) とは負値で結果が割れるが、本関数は Math.round を
 *  正とする。発行時ガードで課税対象額は非負に強制されるため、負値丸めは draft プレビューで
 *  のみ発生し法的意味を持たない (単体テストは負値ケースの期待値を Math.round 準拠で fixture 固定 — §13.1) */
export function roundByMode(value: number, mode: TaxRounding): number;

/**
 * 書類合計の計算 (canonical アルゴリズム):
 * 1. subtotal_jpy = Σ lines.amount_jpy                       … 税抜。値引き行 (負値) 込み
 * 2. 税率区分 c ごと (standard_10 → reduced_8 → zero → exempt の固定順):
 *      taxable_c = Σ amount_jpy (tax_category = c)            … 値引き反映後の課税標準
 *      tax_c     = roundByMode(taxable_c × rate_c / 100, rounding) … ★丸めはここで 1 回だけ
 *    - 明細行に税額は存在しないため、行ごとの丸め合算は構造的に不可能 (J5 / 国税庁 Q&A: 行別
 *      端数処理の合算は不可 — ext-hubspot B-3)
 *    - 出現しない区分は集計行を出さない。zero/exempt は出現すれば tax_jpy=0 で集計行を残す
 * 3. total_jpy = subtotal_jpy + Σ tax_c                       … 税込合計
 */
export function computeDocumentTotals(
  lines: ReadonlyArray<LineForTax>,
  rounding: TaxRounding,
): DocumentTotals;
```

発行時ガード (facade 側、issueDocument / reviseAndReissue 共通):

- 各税率区分の taxable_c < 0 → **E101** (detail: 「値引きが課税対象額を超えています (区分: %)」)
- total_jpy < 0 → E101
- **doc_type='invoice' かつ total_jpy = 0 → E101** (v1.1 — 「請求金額が 0 円の請求書は発行できません」。payments は amount > 0 のみで 0 円 invoice は paid に到達できず未消込に恒久残留するため — §2.4 パターン 23。quote/order/delivery の 0 円は許容)
- lines 0 行 → **E620** (RPC でも二重検証)

税額の**印字**は §10.5。免税モード (issuer.registration_number null) でも**計算は同一** (総額は税込で揃える) — 表記だけ「消費税相当額」に変わる (ext-hubspot B-6)。

### 5.4 invoice_issuer 設定 (canonical は 07 §D5 — 参照のみ)

- Zod・キー所有は settings (07 §D5)。**実装フェーズが sales というだけで、settings/contracts.ts への追加 + /admin/settings のタブ追加として実装する** (§8.6)
- 未設定 (site_settings に 'invoice_issuer' 行なし、または issuer_name 空) のまま発行 → **E626** (発行ボタン自体を disabled + バナー誘導)
- **E626 判定の実装 (v1.1)**: 承認済み契約は `SettingsFacade.get` のみ (07 §D2 — getWithMeta は settings の契約外拡張で他モジュールから呼べない)。get('invoice_issuer') は行不存在時に E901 を返す実装 (settings/facade.ts 実測) のため、**internal/issuer.ts が invoice_issuer キーの get 失敗 (E901) を E626 に変換**する (未設定と読み取り障害を区別しない安全側 degrade — どちらでも発行を止めてバナー誘導が正)。issuer_name 空は Zod parse 後の値検査で E626
- quote_valid_days (既定 30): quote 発行時に valid_until が null なら `issue_date + quote_valid_days` を自動設定
- tax_rounding: **documents 作成時に複製** (§2.3.1)。設定変更は以後に作る帳票にのみ効く

---

## 6. facade 公開メソッド

### 6.1 契約メソッド (07 §D8 canonical) — 処理仕様とエラー全列挙

戻り値はすべて `Result<T>`。シグネチャは 07 §D8 を再掲 (変更禁止)。

#### createDraftDocument(input: CreateDocumentInput): Promise<Result<{ document_id: string }>>

deal を `CrmFacade.getDealRef(deal_id)` (契約メソッド — 07 §D8 v1.2 の最小射影 DealRef。Δs4 §17) で参照し宛名を複製 (DealRef.company 非 null → `company.name` + '御中' + company.address、null → `customer.name` + '様' + customer.address)。不在 = E603。01-crm §6.2 の契約外拡張 getDeal / getCustomer は他モジュール呼出禁止のため使わない (v1.1)。tax_rounding は settings 'invoice_issuer' から複製 (未設定時は既定 'floor')。lines を保存し totals を計算。
エラー: E101 (Zod) / E603 (deal 不在 — crm 帯のコードをそのまま透過) / E901 (DB)。

#### createDraftQuoteFromEstimate(input: { deal_id; estimate: SimEstimateSnapshot }): Promise<Result<{ document_id: string }>>

シミュレーター変換 (§9)。**service ctx 相当の経路 (/api/shop/lead) から呼ばれるため repository は service client を使用** (admin セッションなし)。※D8 に ctx 引数はないため、実装は「セッションが無ければ service client に fallback」ではなく、**呼び出し元 route が service client を注入した facade ファクトリを使う**: `createSalesFacade(client?: SupabaseClient)` — 省略時は createSupabaseServerClient()、指定時は全 repository 呼び出しにその client を引き回す (07 v1.1 裁定 #12 で確定)。**client 注入は本フェーズ新設の構造** — 既存 `createPricingFacade()` は「ファクトリ関数でインスタンスを作る」前例に過ぎず、引数注入は持たない (facade.ts:88 は引数なし・repository は createSupabaseServerClient() 直呼び。v1.0 の前例引用を訂正 — v1.1)。
エラー: E101 / E603 / E901。

#### deriveDocument(input: { source_document_id; to_type }): Promise<Result<{ document_id: string }>>

§4.4 の派生。エラー: **E623** (許可表外 / 派生元状態不正 / 派生元不在) / E101 / E901。

#### issueDocument(documentId, expectedUpdatedAt): Promise<Result<{ doc_no; version; pdf_storage_path; event: DocumentEventActivityPayload }>>

処理順序 (00-overview §4.4 と 1:1):

```
1. 前提検証: status='draft' (E621) / lines≥1 (E620) / settings invoice_issuer あり (E626)
   / PRINT_TOKEN_SECRET・SERVICE_ROLE_KEY 設定済み (E640 detail — degrade)
   / 税ガード (§5.3 → E101)
2. issuer_snapshot 合成 (internal/issuer.ts: settings 'company' + 'invoice_issuer')
3. issue_date 確定 (null → JST 今日)。quote は valid_until 補完 (§5.4)。
   **事前保存の CAS チェーン (v1.1)**: この事前保存 (document_save_draft) はクライアント提示の
   expectedUpdatedAt で CAS 実行し、以後の手順 (手順 7 の p_expected_updated_at) は
   **事前保存が返した新 updated_at** を使う (moddatetime で updated_at が進むため、
   付け替えないと手順 7 が常に E103 になる)
4. 採番: document_number_next(doc_type, issue_date の JST 年) — 失敗 E622。
   ★この時点で番号は消費される (以後の失敗は欠番として許容 — M0 §3.4)
5. PDF 生成 (§7.4): /print/documents/[id]?token=… を Chromium で page.pdf()
   — 同時実行中 E643 / 生成失敗 E640。※doc_no は print_tokens.payload {doc_no} で /print に渡す
   (§7.3 — DB 未保存のため。v1.1: 旧 ?doc_no= クエリは廃止)
6. sha256 計算 → Storage 保存 documents/{id}/v1-{sha256 先頭8}.pdf (upsert:false) — 失敗 E641
7. RPC document_finalize_issue — CAS 不一致 E103 / 状態 E621 / 0 行 E620 / 重複 E622。
   ここまで来て失敗した場合、Storage 上の孤児 PDF は無害 (台帳未登録 = 参照されない。再発行は別パス)
8. CrmFacade.appendActivity('document_event', ref_table='issued_documents', ref_id=台帳行id,
   payload: {document_id, doc_type, doc_no, event:'issued', total_jpy, version:1})
   — 冪等 (ref)。失敗しても発行は成立 (console.error KMB-E901 + ダッシュボード乖離バッジ)
9. 戻り値 event を返す → app 層が CrmFacade.updateDealStage を呼ぶ (§4.6。sales は deal.stage を書かない)
```

エラー全列挙: E620 / E621 / E622 / E626 / E640 / E641 / E643 / E101 / E103 / E901。

#### reissueDocument(documentId, expectedUpdatedAt): Promise<Result<{ version; pdf_storage_path }>>

§4.3-A (内容同一の再出力)。PDF 生成 → Storage 保存 → RPC document_append_version → appendActivity('document_event', event:'reissued', ref=新台帳行)。
エラー: E621 (状態不正) / E627 (台帳整合) / E640 / E641 / E643 / E103 / E901。

#### recordPayment(input: PaymentInput): Promise<Result<{ payment_id; invoice_paid; event }>>

payments INSERT (trigger が検証・消込 — §2.3.1)。invoice_paid = INSERT 後の status='paid'。appendActivity('document_event', **event: invoice_paid ? 'paid' : 'payment_recorded'** (v1.1 — Δs5 §17 で enum 追加。'paid' は「この入金で完済到達」に限定し、部分入金を完済と誤認する集計・表示を防ぐ), ref_table='payments', ref_id=payment_id, total_jpy=書類総額。title に入金額と残高)。
エラー: E621 (状態不正) / E623 (invoice 以外/不在) / E625 (残高超過) / E101 / E901。※trigger の raise は repository が KMB コード prefix をパースして Result に変換 (replace_work_image 前例)。

#### getDocumentLinesForBlocks(documentId): Promise<Result<Array<{ description; work_type_key; quantity; grade_key; size_key }>>>

**scheduling へ渡す用 (app 層合成 — 07 §7.7)。scheduling からの直接呼び出しは禁止**。対象は doc_type='order' の issued/accepted のみ (それ以外は E623 / draft は E621)。grade_key/size_key は lines.source から展開 (null 可)。**空文字は null に正規化して返す** (v1.2 — 07 §4.12 v1.4 の zGenerateBlocksInput `.min(1)` (空文字禁止) と整合: source 由来値は key 選択式のため通常空にならないが、正規化なしだと空文字 1 件で下流の generateBlocksFromLines が E101 全滅する。実装は `nullif(trim(値), '')` 相当)。work_type_key null の行もそのまま返す (テンプレート解決は scheduling の責務)。
エラー: E621 / E623 / E901。

#### createSignedPdfUrl(documentId, version): Promise<Result<{ url; expires_at }>>

台帳行 (document_id, version) を引き storage_path の署名 URL (TTL 10 分) を service client で発行。
エラー: E627 (版なし) / E641 (署名 URL 発行失敗) / E901。

### 6.2 契約外拡張メソッド (自モジュール admin UI 専用 — 契約書 L554 の拡張規約。他モジュールからの呼び出し禁止)

| メソッド | 概要 | 主エラー |
|---|---|---|
| `listDocuments(filter: DocumentListFilter, page: Pagination)` | keyset 一覧 (§5.2 DocumentListItem) | E101 |
| `getDocumentDetail(documentId)` | DocumentDetail (§5.2)。lines/payments/versions/balance/derivable_to を集約 | E621 (不在) |
| `updateDraftDocument(documentId, input: UpdateDraftDocumentInput, expectedUpdatedAt)` | draft 全置換保存 + totals 再計算 (**RPC document_save_draft — CAS + ヘッダ + 明細置換を単一トランザクション、v1.1 §2.6-3**) | E101 / E103 / E624 (非 draft — RPC 検証) |
| `deleteDraftDocument(documentId, expectedUpdatedAt)` | draft 物理削除 (RLS が draft 限定) | E103 / E621 |
| `acceptQuote(documentId, expectedUpdatedAt)` / `declineQuote(documentId, reason, expectedUpdatedAt)` | quote 遷移 (§4.2) + appendActivity(event:'accepted'/'declined', ref_table='documents/accepted' 等 — 下記注記) | E621 / E103 |
| `voidDocument(documentId, reason, expectedUpdatedAt)` | 取消 (理由必須)。invoice は入金 0 件のみ (E621 — facade 検証に加え **trigger が入金存在を再検証 (v1.1 §2.3.1 — 部分入金との TOCTOU ガード)**) + appendActivity(event:'voided') | E621 / E101 / E103 |
| `reviseAndReissueDocument(documentId, input: ReviseDocumentInput, expectedUpdatedAt)` | §4.3-B (v1.1 原子化)。Zod + 税ガード → staging INSERT → PDF (staging 描画) → Storage → RPC apply_revision (documents + 台帳 + version を単一トランザクション確定) → activity 'reissued'。冒頭で古い staging / 期限切れ print_tokens をベストエフォート掃除 | E620 / E621 / E101 / E103 / E640 / E641 / E643 / E627 |
| `deletePayment(paymentId)` | 入金訂正 (trigger が復帰処理) | E621 / E623 / E901 |
| `sendDocumentByEmail(documentId, input: SendDocumentEmailInput)` | §18 → 本編化 (issue #101)。帳票 PDF のメール添付送信。issued/accepted/paid のみ (draft は E621、voided/declined/expired は E623) → isResendConfigured 判定 (E644) → 版検索・PDF ダウンロード → Resend 送信 → document_emails へ結果 INSERT (成功/失敗いずれも) → 成功時のみ appendActivity('email', direction:'outbound') | E101 / E645 (宛先不正) / E621 / E623 / E627 / E640 / E641 / E644 |
| `getSalesDigest(ctx?: ExecutionContext)` | crm-digest worker (app 層 route) 用集計 (§5.2 SalesDigest)。digest route は `{mode:'service'}`、ダッシュボード (app 層) は省略 = session (07-delta v1.1 裁定 #8 で ctx 追加) | E901 |
| `markExpiredQuotes(ctx: ExecutionContext)` | quote issued かつ valid_until < JST 今日 → expired 一括遷移 + activity 'expired'。crm-digest route が service ctx で呼ぶ | E901 |
| `computeTotalsPreview(lines, rounding)` | `computeDocumentTotals` の facade 露出 (サーバ用。クライアントは sales/tax.ts を直接 import — pricing/estimate.ts 前例) | E101 |

**activity ref 規約 (sales 固有の注記) → 統合契約に昇格済み** (07-contracts-delta v1.1 裁定 #4 = Δs2 採用、07 §7.9 に転記): 台帳行・入金行という実レコードが生まれるイベント (issued/reissued/paid/**payment_recorded** — v1.1 Δs5) は `ref_table='issued_documents'/'payments'` + 実 id。実レコードを生まない状態遷移イベント (accepted/declined/expired/voided) は **`ref_table='documents/' + event`、`ref_id=document_id`** とする。状態機械上、各遷移は 1 帳票につき高々 1 回のため (§4.2)、この合成キーが正しい冪等単位になる。01-crm の逆引き実装 (ref_table でのテーブル名解決) が**未知の ref_table 値を安全に無視する** (リンクなし表示に degrade) ことも crm 実装要件 (01-crm #2-3 受入条件) として確定済み。

### 6.3 メソッド × エラーコード マトリクス (網羅表)

| メソッド | E101 | E103 | E620 | E621 | E622 | E623 | E624 | E625 | E626 | E627 | E640 | E641 | E642 | E643 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| createDraftDocument | ● | | | | | | | | | | | | | |
| createDraftQuoteFromEstimate | ● | | | | | | | | | | | | | |
| updateDraftDocument | ● | ● | | | | | ● | | | | | | | |
| deleteDraftDocument | | ● | | ● | | | | | | | | | | |
| deriveDocument | ● | | | | | ● | | | | | | | | |
| issueDocument | ● | ● | ● | ● | ● | | | | ● | | ● | ● | | ● |
| reissueDocument | | ● | | ● | | | | | | ● | ● | ● | | ● |
| reviseAndReissueDocument | ● | ● | ● | ● | | | | | | ● | ● | ● | | ● |
| acceptQuote / declineQuote | ● | ● | | ● | | | | | | | | | | |
| voidDocument | ● | ● | | ● | | | | | | | | | | |
| recordPayment | ● | | | ● | | ● | | ● | | | | | | |
| deletePayment | | | | ● | | ● | | | | | | | | |
| getDocumentLinesForBlocks | | | | ● | | ● | | | | | | | | |
| createSignedPdfUrl | | | | | | | | | | ● | | ● | | |
| (route) /print/documents/[id] | | | | | | | | | | | | | ● | |

(E201/E202/E901 は全メソッド共通のため省略。E642 は route 専用)

`sendDocumentByEmail` (issue #101) は上表の帳票発行系メソッドと直交する別軸のエラー帯 (E644/E645 —
帳票メール送付) を使うため、表の列には含めず §6.2 の行に列挙する。エラー全列挙:
E101(Zod・to 以外) / E645(宛先不正・未指定) / E621(draft) / E623(voided/declined/expired) /
E627(版なし・書類番号未確定) / E640(service client 生成失敗) / E641(PDF ダウンロード失敗) /
E644(Resend 未設定・送信失敗) / E901。

---

## 7. Server Actions・API route・ジョブ

### 7.1 Server Actions (`src/app/admin/documents/actions.ts`)

全 Action 共通: 先頭 `platformFacade.requireAdmin()` → Zod parse → facade → `revalidatePath("/admin/documents")` (+ 詳細パス)。エラーは Result → `{ error, success }` 変換 + toast (sonner)。

| Action | 入力 (Zod) | 処理 | 備考 |
|---|---|---|---|
| createDraftDocumentAction | zCreateDocumentInput | createDraftDocument → redirect 用 id 返却 | deal 詳細 (crm 画面) からも呼ばれる (app 層) |
| updateDraftDocumentAction | id + zUpdateDraftDocumentInput + expectedUpdatedAt | updateDraftDocument | Cmd+S |
| deleteDraftDocumentAction | id + expectedUpdatedAt | deleteDraftDocument | 確認ダイアログ |
| **issueDocumentAction** | id + expectedUpdatedAt | issueDocument → **成功時に deal ステージ自動適用** (下記 7.1-2) | `export const maxDuration = 60` (PDF 込み) |
| deriveDocumentAction | source_document_id + to_type | deriveDocument → 新 draft へ redirect | 「受注にする」等 |
| reissueDocumentAction | id + expectedUpdatedAt | reissueDocument | maxDuration 60 |
| reviseAndReissueDocumentAction | id + zReviseDocumentInput + expectedUpdatedAt | reviseAndReissueDocument | maxDuration 60 |
| acceptQuoteAction / declineQuoteAction / voidDocumentAction | id (+reason) + expectedUpdatedAt | 各遷移 | void は理由必須 (E101) |
| recordPaymentAction | zPaymentInput | recordPayment → invoice_paid=true なら deal 'paid' 提案適用 | |
| deletePaymentAction | payment_id | deletePayment | |
| createPdfUrlAction | id + version | createSignedPdfUrl | プレビュー/ダウンロード |

**7.1-2 deal ステージ提案の適用 (app 層合成 — 00-overview §2.3/§6.2)**: issueDocumentAction は facade 成功後、同 Action 内で (1) CrmFacade で deal を read → (2) §4.6 の提案遷移 (quote_sent / ordered / delivered / invoiced — いずれも**非終端**) を `CrmFacade.updateDealStage(dealId, to, dealUpdatedAt)` で**自動適用** → (3) 成功: トーストに「案件を『◯◯』にしました (元に戻す)」の undo 操作 (undo = 直前ステージへの後退。非終端間の後退は 01-crm §4.2 で自由) / E602 (不正遷移) または E103: スキップしてトースト情報表示 + 乖離バッジ (エラーにしない — 帳票操作自体は成立)。
**'paid' (終端) は自動適用しない (v1.1)**: 01-crm §4.2 で paid は「遷移一切不可の終端」(KMB-E602) であり、自動適用 + undo 方式では undo (paid→invoiced) が構造的に必ず失敗し、入金訂正 (§2.4 パターン 8) 後に案件が誤った終端に恒久固定される (管理画面から回復不能)。recordPaymentAction は invoice_paid=true のとき**確認ダイアログ**「案件を『入金済み』にしますか？ この操作は取り消せません (入金記録に訂正の可能性がある場合は後から適用できます)」を出し、確認時のみ updateDealStage(paid) を実行する (トーストに undo は付けない)。見送った場合はダッシュボードの乖離バッジが再誘導する。

### 7.2 ルート一覧 (sales 追加分)

| ルート | 種別 | 認可 | 内容 |
|---|---|---|---|
| `/admin/documents` | page (Server Component, force-dynamic) | middleware + facade | 帳票一覧 (§8.2) |
| `/admin/documents/new` | page | 同上 | 新規作成 (§8.3) |
| `/admin/documents/[id]` | page | 同上 | draft=編集 / issued 以降=詳細 (§8.3/8.4)。`export const maxDuration = 60` |
| `/print/documents/[id]` | page (route group `(print)` — サイト chrome/モーション CSS なし) | **署名トークンのみ** (§7.3) | 印刷専用紙面 (§10)。Chromium と admin プレビュー iframe が開く |
| `/api/documents/[id]/pdf` | Route Handler GET | requireAdmin | 署名 URL 発行 (§6.1) |

pg_cron ジョブ: **sales 所有のジョブはなし**。crm 帯の `kmb-crm-digest-worker` (00-overview §3.1.3) の route `/api/jobs/crm-digest` が app 層合成で `salesFacade.markExpiredQuotes({mode:'service'})` と `getSalesDigest({mode:'service'})` を呼ぶ (拡張メソッドだが**呼び出し元は app 層 route であり他モジュールではない** — 拡張規約に適合。route 骨格 = crm フェーズ・配線有効化 = sales フェーズ — 07-delta v1.1 裁定 #9)。

### 7.3 /print/documents/[id] — 署名トークン仕様 (internal/print-token.ts)

```
トークン: `${document_id}.${exp}.${hmac}` (J5「署名付き」— 形式は v1.0 と同一)
  exp  = 発行時刻 + 300 秒 (unix 秒)
  hmac = HMAC-SHA256(`${document_id}.${exp}`, env.PRINT_TOKEN_SECRET) の hex 64 桁
ワンタイム消費 (v1.1 — J5/00-overview §5.3 の「ワンタイム」を構造化。旧「実効ワンタイム
  (TTL 内再利用可)」は撤回):
  発行時に print_tokens (§2.3.2) へ INSERT — token_hash = sha256(トークン全文)、purpose、
  payload ({doc_no} / {staging_id} / null)、expires_at = exp
検証 (route 側、service client):
  1. 形式不正 / document_id 不一致 / exp < now → 403 + KMB-E642 (本文はコードのみ。詳細を返さない)
  2. hmac は node:crypto timingSafeEqual で比較 (タイミング攻撃対策 — DB を引く前の偽造遮断)
  3. `update print_tokens set consumed_at = now()
      where token_hash = $1 and consumed_at is null and expires_at > now()
      returning purpose, payload` — 0 行 (消費済み / 期限切れ / 未登録) → 403 + KMB-E642。
     URL がログ・ブラウザ履歴・Referer に漏れても再取得不能 (1 回で失効)
purpose: 'pdf' = issueDocument / reissue / revise の Chromium 撮影用 (payload {doc_no} または
  {staging_id})、'preview' = admin の印刷プレビュー (§8.3 — 開き直しは Server Action で再発行)
発行者: issueDocument 等の PDF 生成直前 (internal/pdf.ts) と、admin プレビュー用 Server Action
  (createPrintPreviewUrlAction)。TTL 5 分・用途ごと都度発行。期限切れ行は発行時にベストエフォート掃除
doc_no / 訂正内容の伝搬 (v1.1): URL クエリではなく print_tokens.payload で渡す (zPrintTokenExtras —
  §5.2)。旧 ?doc_no= クエリ + hmac 連結 (`${document_id}.${exp}.${doc_no}`) は廃止 — URL から
  可変値と改竄面を排除し、PrintTokenPayload 型と hmac 入力の 1:1 を保つ
env: PRINT_TOKEN_SECRET (src/lib/env.ts に optional で追加 + isPrintTokenSecretConfigured()。
  未設定時は発行系 UI を disabled + degrade バナー — 既存 env degrade 慣行)
```

route 実装: token 検証・消費後、repository (service client) で document + lines + issuer を読み、§10 の紙面を Server Component で描画。payload.staging_id があれば document_revision_stagings の内容でヘッダ・明細を置換描画 (§4.3-B — 訂正 PDF は DB 反映前の staging を写す)、payload.doc_no があれば未採番の番号を印字 (§6.1-5)。`robots: noindex` + `Cache-Control: no-store`。draft プレビュー時は「下書き (未発行)」の透かし (§10.2)。

### 7.4 PDF 生成 (internal/pdf.ts — 方式 A、gap-pdf 確定)

```
1. 排他 (v1.1 — グローバル直列化): pdf_render_lock (§2.3.2) の singleton 行を
   `update pdf_render_lock set locked_until = now() + interval '90 seconds', locked_by = {呼出識別子}
    where id = 1 and locked_until < now() returning id` の CAS で lease 取得 (service client)。
   0 行 = 他インスタンス実行中 → 即 E643 (リトライは UI 側のトースト誘導)。finally で
   `update ... set locked_until = now() where id = 1 and locked_by = {呼出識別子}` により返却
   (ベストエフォート — クラッシュ時も 90 秒で自然失効)。advisory lock は使わない (pgbouncer)。
   モジュールスコープの Promise チェーン (同一インスタンス内の直列化) は DB 往復を省く
   最適化として併用。※旧設計 (Promise チェーンのみ) は Vercel の複数インスタンス間で
   同時実行 1 (J5 の方式 A 条件) を保証できないため lease に置換
2. launch: 既存 src/lib/screenshot/capture.ts の launch 部を src/lib/screenshot/chromium.ts に
   共通化して流用 (puppeteer-core 24.43.1 + @sparticuz/chromium 147 exact pin、
   serverExternalPackages 登録済み)。**既存スクショの挙動不変がリファクタの受入条件**
3. page.goto(`${自オリジン}/print/documents/${id}?token=…`) — 自オリジン解決は既存スクショ基盤の
   SSRF ガード付き解決を流用。waitUntil: 'networkidle0' + `document.fonts.ready` 待ち (capture.ts:134 と同型)
4. page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
   — headerTemplate/footerTemplate は使わない (Chromium 147 の CSS page margin boxes — §10.2)
5. sha256 = createHash('sha256').update(buffer).digest('hex')
6. Storage 保存: service client、bucket 'issued-documents'、
   path `documents/{document_id}/v{n}-{sha256 先頭8}.pdf`、contentType 'application/pdf'、
   **upsert: false 固定** (capture.ts:163 は upsert:true のため流用時に必ず変更 — gap-pdf §5)
7. finally: page/browser close + /tmp クリーンアップ (fullpage-screenshot.md L54-56 の既知対策)
サイズ: 帳票 PDF は数百 KB 想定 (4.5MB 応答上限は Storage 保存のため無関係)
日本語: 印刷ルートはサイトの next/font (NotoSansJP webfont) をそのまま使用 — フォント配置作業ゼロ。
  **pdf-lib/fontkit 系を使わないため NotoSansJP 可変フォント (wght=Thin) 問題は構造的に発生しない**
  (reference-noto-sans-jp-variable-font の教訓は方式 B/C の罠 — 方式 A では該当なし。ブリーフ R4 注記への回答)
```

### 7.5 crm-digest との接続 (再掲整理)

| 処理 | 実行者 | sales の提供物 |
|---|---|---|
| 有効期限切れ quote の expired 遷移 | /api/jobs/crm-digest route (service ctx) | `markExpiredQuotes(ctx)` |
| 期限接近見積・未消込請求のダイジェスト | 同上 | `getSalesDigest({mode:'service'})` |
| ダッシュボード「未消込請求」バッジ | /admin (app 層) | 同上 (ctx 省略 = session) |

---

## 8. 管理画面 UI 仕様 (/admin/documents)

### 8.1 共通仕様

- admin 共通規約 (cms-ai-pipeline §5.1) を全面継承: `force-dynamic` / PageHeader + Surface / keyset 50 件 / URL クエリでフィルタ / 楽観排他 (updated_at 生文字列 hidden) / toast (sonner) + FieldError 併用 / `src/app/admin/_ui/` barrel 部品
- shadcn 追加部品 (M0 Issue で CLI 追加済み前提): `dropdown-menu` / `popover` / `calendar` / `date-picker` / `command`
- 金額表示は `¥12,345,678` (toLocaleString('ja-JP'))、入力は整数のみ

### 8.2 帳票一覧 (/admin/documents)

- 構成: PageHeader (タイトル「帳票」、description にキーボード操作説明) + 種別タブ (すべて/見積/受注/納品/請求 — URL `?type=`) + 状態フィルタ Badge リンク (`?status=`) + 検索 input (`?q=` 書類番号/宛名) + DataTableShell 一覧 + 「次の 50 件へ」
- 列: 書類番号 (draft は「下書き」Badge) / 種別 / 宛名 / 案件名 / 金額 (税込) / 状態 (StatusBadge — draft=灰, issued=青, accepted=緑, paid=緑, declined/expired=黄, voided=赤) / 発行日
- 行アクション (dropdown-menu): 開く / 複製して新規 (draft 作成) / PDF (issued 以降)
- キーボード: ↑↓ 行移動 / Enter 詳細へ / Esc 検索クリア / `/` 検索フォーカス

### 8.3 帳票編集 (draft) — /admin/documents/[id]

- 上段: ヘッダフォーム (宛名 billing_name + suffix Select / 宛先住所 / 現場名・現場住所 / 発行日 (date-picker、空=発行時の今日) / 有効期限 (quote のみ表示) / 端数処理 Select (floor/round/ceil) / 備考 textarea)
- 中段: **明細エディタ** (インライン編集テーブル): 品名 / 数量 (小数 2 位) / 単位 / 単価 (負値可) / 金額 (既定 = 数量×単価の自動計算、手動上書き可 — 上書き中は「手動」バッジ) / 税区分 Select / 作業種別ヒント (work_type_key — アクティブな work_types を label 表示する Select。候補は app 層 page.tsx が SchedulingFacade.listWorkTypes() から取得して props 渡し — §1.3。候補外の既存 key は「(不明: {key})」で値を保持。listWorkTypes 失敗時は生 Input へ fallback — Issue #97)
  - 行操作: 「行を追加」(Cmd+Enter) / 行削除 (行内ゴミ箱 or Cmd+Backspace) / 並べ替え (Alt+↑↓)
  - **定型行の挿入** (dropdown): 「初回治具・段取り費」/「リピートにつき段取り費免除 (値引き)」/「送料 (実費)」— J5 の標準項目。ラベルと既定単価はコード定数 (STANDARD_LINE_PRESETS、sales/contracts.ts)
  - シミュレーター由来 draft は上部に**参考パネル**: activity 'simulator_estimate' の入力スナップショット併記 (§11.2)
- 下段: **税集計プレビュー** (小計 / 税率区分別 対象額・消費税 / 合計 — `sales/tax.ts` をクライアント import してリアルタイム計算。保存時にサーバ再計算で確定) + 保存 (Cmd+S) + 「印刷プレビュー」(createPrintPreviewUrlAction → /print を新タブ。トークンは 1 回限り §7.3 — 開き直しはボタン再押下。頁番号・改ページの確認は新タブで Cmd+P — §10.8 v1.1) + **「発行」** (確認ダイアログ: 「番号を採番し PDF を確定保存します。発行後は内容を変更できません」) + 削除
- 発行成功: 詳細表示に切替 + トースト「Q-2026-0012 を発行しました / 案件を『見積送付』にしました (元に戻す)」
- キーボード: Cmd+S 保存 / Cmd+Enter 行追加 / Alt+↑↓ 行移動 / Esc ダイアログ閉じ / Tab は明細セルを論理順に横断

### 8.4 帳票詳細 (issued 以降) — 同ルートの状態分岐 (WorkForm の mode パターン。新規コンポーネント乱造禁止)

- ヘッダ: 書類番号 + StatusBadge + 宛名 + 金額 + 発行日 + (invoice) **残高表示** (総額 − Σ入金)
- 主アクション列 (状態と DERIVATION_RULES から活性制御 — derivable_to):
  - quote: 「承諾にする」「辞退にする (理由)」「受注にする (→order derive)」「請求書にする (→invoice 直行)」
  - order: 「納品書にする」+ **「作業ブロックを用意」** (app 層合成: getDocumentLinesForBlocks → SchedulingFacade.generateBlocksFromLines → 「N 件用意しました」トースト + /admin/calendar 誘導。skip 行は警告列挙、全滅 E704 は手動作成誘導 — 00-overview §4.1)
  - delivery: 「請求書にする」
  - invoice: 「入金を記録」(§8.5)
  - 共通: 「PDF を開く」(署名 URL) / 「再出力 (版+1)」/ 「訂正発行…」(§4.3-B の編集ダイアログ = §8.3 と同じ明細エディタを revision モードで再利用) / 「取消 (理由必須)」
- **版履歴**テーブル: v / 発行日時 / sha256 (先頭 8) / supersedes / PDF リンク / **「前の版と比較」** (§11.1 の差分ダイアログ)
- 入金履歴 (invoice): 入金日 / 金額 / 方法 / メモ / 削除ボタン。削除は確認ダイアログ「記録を削除して残高に戻します」
- 系譜パンくず: 派生元 → 本書類 → 派生先 (source_document_id 連鎖を辿るリンク)
- キーボード: ↑↓ 版/入金行移動 / Enter PDF 開く / Esc ダイアログ閉じ / Cmd+P 印刷プレビュー

### 8.5 入金記録ダイアログ

- 項目: 入金日 (date-picker、既定今日) / 金額 (既定 = 残高プリフィル) / 方法 (振込/現金/その他) / メモ (複数請求への一括振込を分割記録する場合は出所をここに — §2.4 パターン 24)
- 送信 → recordPaymentAction → 完済時: 「入金済みになりました」トースト + **案件ステージの確認ダイアログ** (§7.1-2 v1.1 — 『入金済み』は終端で取り消せないため undo トーストではなく明示確認) / 部分入金時: 「残高 ¥N」トースト
- E625 はダイアログ内にインラインエラー (残高を併記)

### 8.6 サイト設定「請求書発行者」タブ (settings 所有・sales フェーズ実装 — 07 §D5)

- /admin/settings に「請求書発行者」タブを追加 (SettingsTabs + submitSettingsForm 共通関数に乗せる — admin-ui-auth §4.4 パターン)
- 項目: 発行者名 (屋号/法人名) / 適格請求書発行事業者登録番号 (T+13 桁、**空可 — 空なら区分記載様式**の説明文を添える) / 端数処理 (既定 切捨て — ★裁定 J5 確認 7) / 振込先口座 (銀行名/支店/種別/番号/名義カナ — 「設定しない」トグルで null) / 振込手数料文言 (既定文例「恐れ入りますが振込手数料は貴社にてご負担願います」) / **角印画像** (branding-assets private バケットへの直接アップロード — 透過 PNG 推奨の説明。**MediaPicker / media ライブラリは使わない** (v1.2 — 07 §D5 v1.2): Server Action が service client で upload し seal_storage_path を保存、プレビューは署名 URL) / 見積有効期限の既定日数 (既定 30)
- 保存時: 既存の楽観排他 + Zod (canonical 07 §D5)。**Zod を settings/contracts.ts に追加するのは本フェーズだが定義は 07 §D5 の写経** (再発明しない)

### 8.7 キーボード操作チェックリスト (E2E 必須 — 全画面共通)

| キー | 一覧 | 編集 | 詳細 | ダイアログ |
|---|---|---|---|---|
| ↑↓ | 行移動 | 明細行移動 | 版/入金行移動 | — |
| Enter | 詳細へ | セル確定 | PDF 開く | 主ボタン |
| Esc | 検索クリア | セル編集解除 | — | 閉じる |
| Tab | フィルタ→表 | セル論理順 | アクション順 | フォーカストラップ |
| Cmd+S | — | 保存 | — | — |
| Cmd+Enter | — | 行追加 | — | 送信 |
| Alt+↑↓ | — | 行並べ替え | — | — |

---

## 9. シミュレーター → 見積原案の変換仕様 (createDraftQuoteFromEstimate)

入力: `SimEstimateSnapshot` (07 §4.10 crm 所有 — D8 の型 import 規約で import)。呼び出しは /api/shop/lead route の app 層合成のみ (07 §7.8。pricing はこのフローに登場しない)。

**canonical 分担 (v1.1)**: snapshot の入力意味論 (「仮単価 = セル price_max」の解釈 = 数量値引き・オプション適用後の total_max からの税抜換算、等) は **06-simulator §5.4 (T1〜T7) が正**。変換の具体式・丸め位置・description・notes の文言は**本節 §9.1 が正** (06 §5.4 T1/T2/T4 が本節へ委譲 — 06 v1.1 で旧独自文言・金額先行式・±2 円規定は撤回済み)。00-overview §4.2 / 07 §D8 コメントの「仮単価 = セル price_max」は略記であり 06 §5.4 T1 の解釈で読む。単体テストの canonical は `tests/sales-derive-snapshot.test.ts` (§13.1 — 06 T6 と 1:1)。

### 9.1 変換規則 (internal/derive.ts の純関数 — 単体テスト対象)

| snapshot | 変換先 |
|---|---|
| quote_only = false | 明細 1 行: description = `3Dプリント表面処理・塗装（{grade_label}／{size_label}）`、quantity = quantity、unit = '個'、**unit_price_jpy = round(total_max ÷ quantity ÷ 1.1)** (税込上限 → 税抜換算)、amount_jpy = round(unit_price × quantity)、tax_category = 'standard_10'、work_type_key = null、source = {grade_key, size_key, option_keys} |
| quote_only = true (XL — データパターン 5) | **明細 0 行**。notes に個別見積もりメモのみ |
| 共通 notes | `シミュレーター概算: 税込 ¥{total_min:,}〜¥{total_max:,}（{applied_tier ?? '数量スライドなし'}／{breakdown labels join '・'}）。上記単価は概算上限からの税抜換算です。正式なお見積もりで確定します。` |
| ヘッダ | doc_type='quote', status='draft', billing_name = 取込済み顧客名 (deal 経由), valid_until = null (発行時補完), tax_rounding = 設定複製 |

### 9.2 設計上の注意

- 税抜換算の丸め誤差 (round×2 段) は**概算目安として許容** (発行前に人が必ず単価を確定する前提。notes に明記)
- 明細は 1 行集約とし工程分解しない (シミュレーターは工程情報を持たない)。「一式」回避原則 (ext-hubspot B-11) は**発行前の人手工程分解**で満たす — 編集画面の定型行・work_type_key 補助 (§8.3) がその導線
- 失敗時 (E101/E603/E901) は問い合わせ保存 (InquiryFacade.submit) を**巻き戻さない** (00-overview §4.2)

---

## 10. 印刷出力仕様 (必須章⑥ — 本プロジェクト初の印刷出力 canonical)

方式 A (§7.4) で PDF 化する**紙面そのもの**の仕様。実装対象は /print/documents/[id] (§7.3) の Server Component + print.css。**画面プレビュー = 印刷ルートそのもの** (gap-pdf §7) — ただし WYSIWYG の保証範囲は **print メディア描画に限る** (v1.1 §10.8: @page margin box と改ページは screen 表示では評価されない)。

### 10.1 様式系統と対象書類 (4 書類 3 系統)

| 系統 | doc_type | タイトル | 挨拶文 (タイトル下 1 行、コード定数) | 金額ボックスのラベル | 系統固有欄 |
|---|---|---|---|---|---|
| S1 | quote | 御見積書 | 下記のとおりお見積り申し上げます。 | 御見積金額 | 有効期限 (valid_until) |
| S2 | order / delivery | 注文請書 / 納品書 | 下記のとおり、ご注文をお請けいたします。/ 下記のとおり納品いたしました。 | 御注文金額 / 合計金額 | なし |
| S3 | invoice | 請求書 | 下記のとおりご請求申し上げます。 | 御請求金額 | 振込先 + 振込手数料文言 (§10.4) |

共通骨格 (§10.2)・ヘッダ部 (§10.3)・明細/合計 (§10.4) は 3 系統で完全共通。系統差分は上表の文言と固有欄の有無のみ — **紙面コンポーネントは `<DocumentSheet>` 1 つで doc_type 分岐** (新規コンポーネント乱造禁止 — §8.4 と同じ規約)。

**適格請求書 6 記載事項 (ext-hubspot B-1) ↔ 紙面欄の対応 (canonical)**:

| # | 記載事項 | 紙面の欄 | データ源 |
|---|---|---|---|
| 1 | 発行者の氏名または名称 + 登録番号 | 発行者ブロック (右上 — §10.3) | issuer_snapshot.issuer_name / registration_number |
| 2 | 取引年月日 | **取引日欄** (S3 は発行日と別欄 — v1.1 §10.3。S1/S2 は発行日欄が兼ねる) | transaction_date (null → issue_date と同日扱い)。台帳 transaction_date と同値 |
| 3 | 取引内容 (軽減税率対象はその旨) | 明細の品名列 (+reduced_8 行の「※」— §10.4) | document_lines.description / tax_category |
| 4 | 税率ごとに区分した対価の額 (税抜) + 適用税率 | 税率別集計欄 (§10.4) | tax_summary[].taxable_jpy + 区分ラベル |
| 5 | 税率ごとに区分した消費税額等 | 同欄 | tax_summary[].tax_jpy |
| 6 | 交付を受ける事業者の氏名または名称 | 宛名ブロック (左上 — §10.3) | billing_name + billing_suffix |

注記: 見積書は取引年月日確定前のためインボイスとしない実務 (B-11) だが、欄構成は 4 書類共通とする (害なし・実装とテストの 1 本化)。納品書・請求書はどちらも単独で 6 記載事項を満たす (複数書類の組み合わせ充足 — B-1 補足 — には依存しない設計)。

### 10.2 共通紙面骨格 (A4 縦・margin boxes・counter(pages))

- 用紙: **A4 縦** 固定。`page.pdf({ format:'A4', preferCSSPageSize:true })` (§7.4-4) と `@page { size: A4 }` の二重指定 (**CSS 側が正**)
- 余白: 上 16mm / 左右 14mm / 下 18mm (下余白は頁番号 margin box 用) → 本文幅 182mm
- フォント: サイトの next/font NotoSansJP (§7.4 — 配置作業ゼロ)。本文 9.5pt / タイトル 16pt / 金額ボックス 13pt。数値列は `font-variant-numeric: tabular-nums` (桁揃え)
- 配色: モノクロ基調 (罫線 #333 / 補助文字 #666)。printBackground:true だが背景は見出し帯の淡色 (#f5f5f5) まで

```css
/* print.css の骨格 (実装はこの構造を維持すること) */
@page {
  size: A4 portrait;
  margin: 16mm 14mm 18mm 14mm;
  @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #666; }
}
/* 継続ヘッダ: 2 ページ目以降にのみ「{書類名} {doc_no}（続き）」を出す */
@page { @top-right { content: "請求書 I-2026-0031（続き）"; font-size: 8pt; color: #666; } }
@page :first { @top-right { content: none; } }

table.lines thead { display: table-header-group; } /* 改ページ後の列見出し再描画 (§10.7-1) */
table.lines tr    { break-inside: avoid; }         /* 行の不可分 (§10.7-2) */
.totals-block     { break-inside: avoid; }         /* 小計送り (§10.7-3) */
```

- **動的 margin box**: margin box の content にランタイム値を渡す標準手段がない (string-set は Chromium 未対応) ため、紙面コンポーネントが `@page` ルールを含む `<style>` を**サーバ側で文字列生成**して埋め込む。埋め込み値は書類名 (コード定数) と doc_no のみで、doc_no は zDocumentNo 検証済み (`[QJDI0-9-]` に閉じる) — CSS injection の余地なし
- `@page :first` の margin box 抑止が page.pdf() で効かない場合 (§13.4 スモークで検出) は**全ページ共通の継続ヘッダで妥協** (1 ページ目にも doc_no が小さく重複するだけで実害なし)。counter(pages) 自体の不動作は headerTemplate 代替へフォールバック (00-overview §15 R4)
- **透かし (§7.3 の draft プレビュー)**: status='draft' かつ発行フロー外 (print_tokens.payload に doc_no なし = purpose 'preview' — v1.1) のとき、「下書き(未発行)」を紙面中央に対角 45°・opacity 0.08・約 26mm で全ページ固定表示 (`position: fixed`)。発行フロー中のアクセス (payload.doc_no あり) は確定 PDF の撮影なので透かしなし
- **版番号は紙面に印字しない** (設計判断): 再出力 (§4.3-A) は「同一内容の再出力」であり、紙面に版を刷ると内容が変わって自己矛盾する。版の同定は台帳 (version / sha256 / storage_path) が担う — 電帳法上の根拠も台帳側 (§2.3.2)

### 10.3 ヘッダ部 (紙面上段) の配置

```
┌──────────────────── 本文幅 182mm ────────────────────┐
│                     御 見 積 書                (タイトル・中央)│
│ No. Q-2026-0012                    発行日: 2026年7月11日 (右)│
│                                                          │
│ [宛名ブロック 左・幅〜95mm]     [発行者ブロック 右・幅〜70mm]  │
│  大分 太郎 様 (下線・11pt)       隈部塗装        ⊂角印⊃    │
│  大分県豊後高田市…               登録番号: T1234567890123   │
│                                  住所 / TEL / email        │
│ 現場: ○○様邸 (site_name)／大分県…(site_address)            │
│ 挨拶文 1 行 (§10.1)                                        │
│ ┃ 御見積金額  ¥168,300（税込） ┃  (金額ボックス・太罫・左寄せ) │
│ 有効期限: 2026年8月10日 (S1 のみ)                            │
└──────────────────────────────────────────────────────────┘
```

配置と非印字規則 (「欄ごと消す」— データパターン 12/17 の適用):

| 欄 | データ源 | 非印字条件・特記 |
|---|---|---|
| No. | doc_no (issued 以降 = DB / 発行フロー中 = print_tokens.payload の doc_no — §7.3 v1.1) | draft プレビューは「No. (未採番)」 |
| 発行日 | issue_date (「YYYY年M月D日」西暦表記) | draft かつ null → 「発行日: (発行時の日付)」 |
| 取引日 (v1.1) | transaction_date (null → issue_date と同日のため**行非印字** — 発行日欄が兼ねる) | **S3 (請求書) のみ**発行日の直下に「取引日: YYYY年M月D日」を印字 (納品後の月末請求で発行日と取引日がずれるケース — 記載事項 2 / §2.4 パターン 22)。S1/S2 は欄自体なし |
| 宛名 | billing_name + billing_suffix (様/御中) | なし (必須。記載事項 6) |
| 宛先住所 | billing_address | null → 行非印字 |
| 現場 | site_name / site_address | 両方 null → 行ごと非印字 (パターン 12)。片方のみなら印字 |
| 発行者名 | issuer_snapshot.issuer_name | なし (E626 が発行前に保証) |
| 登録番号 | issuer_snapshot.registration_number | null → 行非印字 (§10.5 免税分岐) |
| 発行者 住所/TEL/email | issuer_snapshot.address / tel / email | null の項目のみ非印字 |
| 角印 | issuer_snapshot.seal_storage_path (branding-assets — v1.2) | §10.6 |
| 金額ボックス | total_jpy (税込) + 系統別ラベル (§10.1) | なし |
| 有効期限 | valid_until (「YYYY年M月D日」) | S1 以外は欄自体なし。S1 で null (draft プレビュー) → 行非印字 |

- **発行フローの整合 (§6.1-3 の明確化)**: /print は **DB の値のみ**を描画する (訂正フローの staging 描画 §7.3 を除く)。発行フロー中に確定する issue_date (null → JST 今日) と valid_until 補完 (§5.4) は、**PDF 生成 (§6.1-5) より前に draft へ保存する** (transaction_date 含め session の UPDATE grant 内 — §2.3.1。事前保存の CAS チェーンは §6.1-3)。DB に保存できないのは doc_no だけで、これは print_tokens.payload {doc_no} として渡す (§7.3 — v1.1)
- issuer 欄のデータ源: issued 以降 = documents.issuer_snapshot (凍結値)。draft プレビューと発行フロー中 = internal/issuer.ts が settings から合成した現在値 (発行時にこの値がそのまま凍結される — 紙面と凍結値の一致を保証)

### 10.4 明細表・税率別集計・合計欄

明細表 (table.lines) の列構成:

| 列 | 幅 | 揃え | 内容 |
|---|---|---|---|
| No. | 10mm | 右 | position + 1 |
| 品名 | 残り (〜94mm) | 左 | description (折返し許容)。reduced_8 行は先頭に「※」 |
| 数量 | 16mm | 右 | quantity (小数 2 位まで・末尾 0 除去: `12` / `3.5`) |
| 単位 | 12mm | 中央 | unit |
| 単価 | 24mm | 右 | unit_price_jpy。負値は「▲12,000」(値引きの商慣行表記。画面 UI は −12,000 のまま — 紙面のみ) |
| 金額 | 26mm | 右 | amount_jpy (税抜)。負値は同上 |

- 明細最終行の直後に**「以下余白」行** (中央・#666) を必ず印字 — 「続きがあるか」の曖昧さと末尾追記を防ぐ。flow 内に置くだけで最終ページ判定が不要 (§10.7-4 の代替手段の一部)
- 明細 0 行 (quote_only 原案の draft プレビューのみ — パターン 5) は明細表を出さず「(明細未入力)」1 行。発行済みは常に 1 行以上 (E620)

合計欄 (.totals-block — 明細表直下・右寄せ幅〜80mm):

```
小計（税抜）                 ¥153,000
10%対象 ¥153,000   消費税 ¥15,300     ← tax_summary を standard_10 → reduced_8 → zero → exempt の固定順 (§5.3)
合計（税込）                 ¥168,300
```

- 税率別集計行のラベル (紙面コンポーネント内の定数): standard_10「10%対象」/ reduced_8「8%対象(軽減税率)」/ zero「0%対象」/ exempt「対象外」。金額 = taxable_jpy (税抜)、税額 = tax_jpy。出現しない区分は行なし、zero/exempt は出現すれば税額 ¥0 のまま行を残す (パターン 19 — 様式が崩れない)
- reduced_8 行が 1 つでもあれば合計欄直下に「※印は軽減税率(8%)対象品目」の注記 1 行 (記載事項 3)
- 「消費税」ラベルは免税モードで「消費税相当額」に変わる (§10.5)
- 金額は全欄 `¥` + 3 桁区切り (toLocaleString('ja-JP'))

合計欄の下段 (左・全幅):

| ブロック | 印字条件 |
|---|---|
| 備考 (notes) | notes 非 null。改行保持 (white-space: pre-wrap)・枠付き |
| 振込先 (S3 のみ) | issuer_snapshot.bank_account 非 null → 「お振込先: {bank_name} {branch_name} {普通/当座} {account_number} {account_holder_kana}」(B-9)。null → 欄ごと非印字 (パターン 17) |
| 振込手数料文言 (S3 のみ) | issuer_snapshot.transfer_fee_note 非 null → 振込先の直下に 1 行。null → 非印字 |

### 10.5 適格/区分記載の様式分岐 (issuer_snapshot.registration_number 基準)

| 項目 | 適格モード (T+13 桁あり) | 免税モード (null) — 区分記載様式 (ext-hubspot B-6) |
|---|---|---|
| 登録番号行 (§10.3) | 「登録番号: T1234567890123」を印字 | 行ごと非印字 |
| 税額ラベル (§10.4) | 「消費税」 | **「消費税相当額」** |
| 「適格請求書」等の断り書き | 印字しない (記載事項を満たせば書類名を問わず適格請求書 — B-1 補足。断り文言は不要) | 印字しない |
| 税計算 | 同一 (§5.3 — 分岐は**表記のみ**。総額は税込で不変) | 同一 |

- 分岐は書類種別に依存しない (4 書類共通規則)。判定は **issuer_snapshot の凍結値** — 免税→課税転換 (T 番号を後から設定) しても発行済み書類は旧様式のまま (発行時点の事実として正しい)、以後の発行から適格様式になる (§16 R5)
- 適格簡易請求書 (宛名なし様式) は v1 で作らない (§0.5)。拡張余地は §18

### 10.6 角印合成

- issuer_snapshot.seal_storage_path → **/print の Server Component が server 側で解決した署名 URL** (branding-assets private バケット、service client、TTL 5 分 — 描画時間内で十分) を `<img>` に埋め、発行者名の右肩に**絶対配置で約 1/3 重ねて**合成 (B-10 の商慣行)。寸法 18×18mm 固定 (アスペクト比維持・object-fit: contain)。**v1.2 是正 (07 §D5 v1.2 追随): 旧「media の公開 URL を `<img>`」は廃止** — media は anon 全行 SELECT + public バケットのため社印画像が匿名取得可能だった (書類偽造の材料)
- 透過 PNG 推奨 (§8.6 の設定 UI に説明あり)。非透過画像の救済に `mix-blend-mode: multiply` (白地が社名文字を隠さない)
- 非印字条件: seal_storage_path null → 印字なし (発行者ブロックの幅・位置は変えない)。**オブジェクト解決失敗 (削除・差し替え済み等 — §2.3.3 注記) → 角印を印字省略して発行/再出力は続行** (角印は法的要件ではない — B-10)。省略が起きた場合 facade は Result の detail に警告を載せ、詳細画面に「角印なしで出力されました」を表示 — reissue (§4.3-A) で画像再設定後に回復
- 画像の読み込み完了は page.goto の `networkidle0` (§7.4-3) が待つ。読込エラー時は img を非表示にする最小 inline script のみ許可 (紙面で唯一の JS — §10.8)

### 10.7 明細の改ページ規則

1. **列見出しの再描画**: `thead { display: table-header-group }` — 明細が改ページされたら次ページ先頭に列見出しが自動で再描画される (Chromium 標準挙動。§13.4 スモーク対象)
2. **行の不可分**: `tr { break-inside: avoid }` — 1 明細行 (品名折返し 2〜3 行を含む) の途中で切らない。description は max 200 字 (Zod) のため 1 行が 1 ページを超えることは構造的にない
3. **小計送り**: 合計欄 + 備考 + 振込先ブロックは `break-inside: avoid` の一体ブロック。明細最終行の直後に収まらなければ**ブロックごと次ページへ送る** (合計欄の途中で割らない)。合計ブロック単独のページになっても margin box (頁番号 + 継続ヘッダ) が書類の同一性を担保する
4. **金額の繰越行 (前頁繰越/次頁繰越) は設けない** (設計判断): 消費税は書類×税率で 1 回丸め (J5) であり、頁小計は独立した検算値にならない。繰越額の算出には紙面高さのサーバ側シミュレーション (行高固定化) が必要になり、CSS 改ページとの二重管理は事故源。代替 — (a) 頁番号「n / N」(§10.2)、(b) 2 ページ目以降の継続ヘッダ「{書類名} {doc_no}（続き）」、(c) 「以下余白」終端行 (§10.4) — で追跡性・完全性の要件は満たせる
5. **総頁数の解決**: counter(pages) が N を正しく解決することが 2 ページ超スモークテスト (§13.4) の主検証点 (gap-pdf §8 の残不確実性)。不備検出時のフォールバックは §10.2

### 10.8 実装構成

```
src/app/(print)/print/documents/[id]/page.tsx … token 検証 (§7.3) → repository (service client) read
                                                 → <DocumentSheet …/> 描画
src/app/(print)/print/documents/print.css      … §10.2〜10.7 の紙面 CSS (このルート専用 —
                                                 globals.css のモーション/テーマ変数に依存しない)
src/modules/sales/internal/pdf.ts               … §7.4 (紙面には関与しない)
```

- 紙面は **Server Component のみ・クライアント JS なし** (§10.6 の img onerror 最小 script を除く)。フォントは next/font NotoSansJP を (print) ルートでも適用
- 紙面は screen メディアでもそのまま表示されるが、**@page margin box (頁番号・継続ヘッダ) と改ページは印刷系レンダリング (page.pdf() / ブラウザの印刷プレビュー) でのみ評価される** — CSS Paged Media の仕様上、通常タブの screen 表示では改ページ自体が発生しない (v1.1: 旧「両メディアで同一に見える」受入条件は 2 ページ超の書類で成立しないため撤回)。**WYSIWYG の受入条件は print メディア描画に限定** (= page.pdf() とブラウザ印刷プレビュー (Cmd+P) の一致。§13.4 スモークが検証)。§8.3 の「印刷プレビュー」新タブには「ページ割り・頁番号は Cmd+P (ブラウザの印刷プレビュー) で確認」の案内文言を添える。`@media print` 分岐は引き続き作らない — screen との差分は頁関連 (頁番号・継続ヘッダ・改ページ位置) のみに閉じ、内容・レイアウトの差分は生まない

---

## 11. 差分表示仕様 (必須章⑩)

00-overview §8 の割当 (「帳票の版間差分」「見積原案 vs シミュレーター入力」の 2 件が sales 所掌) の詳細化。

### 11.1 版間差分 (訂正発行の前後比較 — §8.4「前の版と比較」)

- 入力: issued_documents.content_snapshot × 2 版 (zIssuedContentSnapshot parse 済み — §5.2)。既定は最新版 vs 直前版。版セレクタで任意の 2 版を選択可 (supersedes 連鎖順に列挙)
- 実装: `internal/diff.ts` の純関数 `diffIssuedSnapshots(older, newer): IssuedSnapshotDiff` (単体テスト対象 — §13.1):
  - **ヘッダ差分**: issue_date / transaction_date (v1.1) / valid_until / billing_name / billing_suffix / billing_address / site_name / site_address / notes / issuer (表示対象は issuer_name と registration_number のみ) をフィールド単位で同値比較 → `{ field, old, new }[]`
  - **明細差分**: 各行を表示文字列 (`{description}｜{quantity}{unit}｜@{unit_price_jpy}｜{amount_jpy}｜{tax_category}`) に正規化し、既存 `diff` パッケージ (00-overview §8 — 依存追加なし) の diffArrays で added / removed / unchanged に分類
  - **金額差分**: subtotal_jpy / tax_summary (区分ごと) / total_jpy のフィールド比較
- UI (§8.4 のダイアログ): 旧版 (左)・新版 (右) の**並記** (00-overview §8 の裁定どおり) + 差分ハイライト。削除行 = 左に赤帯 / 追加行 = 右に緑帯 / 変更ヘッダ項目 = 両側に黄帯 + 「旧 → 新」注記。最上部に増減サマリ「合計 ¥168,300 → ¥172,700 (+¥4,400)」
- 内容同一の隣接版 (再出力 — §4.3-A) は「変更はありません (再出力による版追加)」の 1 行表示
- キーボード: Esc 閉じる / ← → 比較版の切替 / Tab フォーカストラップ (§8.7 と同規約)

### 11.2 見積原案 vs シミュレーター入力の参考パネル (§8.3)

- 対象: シミュレーター由来 (deal.source='simulator') の draft quote 編集画面。deal の activity 'simulator_estimate' (payload = 入力+結果スナップショット — 07 §4.10) を CrmFacade 経由で取得し、上部パネルに併記
- 表示: シミュレーター入力 (グレード/サイズ/個数/オプション) + 概算レンジ「税込 ¥{total_min:,}〜¥{total_max:,}」+ 現在の draft 合計「¥{total_jpy:,}（税込）」
- **差分計算はしない** (概算レンジ vs 確定見積は比較の意味論が異なる)。ただし現在合計がレンジ外に出たら「概算レンジ外」の情報 Badge を表示 (エラーにしない — 工程分解や値引きで正当に外れ得る)
- activity が取得できない場合 (手動 draft・取込失敗) はパネル自体を非表示 (degrade)

### 11.3 該当なしの明示 (理由付き — 00-overview §8 前例)

| 対象 | 判定 | 理由 |
|---|---|---|
| draft の編集履歴 | 該当なし | draft は発行前で法的保存対象外。保存は全行置換 (§2.6-3) で履歴を持たない。発行後は §11.1 の版管理が引き継ぐ |
| payments の変更履歴 | 該当なし | payments は不変 (訂正 = DELETE + 再 INSERT — §4.5-1)。訂正の痕跡は消込 trigger の paid⇔issued 遷移と削除確認ダイアログで足りる (1 人運用・監査は台帳と activities 側で担保) |

---

## 12. エラーコード表 (必須章③ — recovery 文言)

採番 canonical は 00-overview §3.3 (KMB-E620〜E649 帯 = sales 所有)。本表は errors.ts (KMB_ERRORS as const map) 登録文言の詳細化。**帯内の追加コード (issue #101): KMB-E644 / KMB-E645**:

| コード | 意味 | ユーザー向けメッセージ | recovery |
|---|---|---|---|
| KMB-E620 | 明細 0 行で発行 | 明細がありません。 | 明細を 1 行以上入力してから発行 (シミュレーター原案の XL は個別見積の明細化が先) |
| KMB-E621 | 帳票状態遷移が不正 | この状態ではその操作はできません。 | detail に現在状態。画面を再読み込みして状態を確認。取消済みは一切変更不可。**入金済み (入金記録あり) の請求書の取消は、先に入金記録を全削除して「発行済み」に戻してから (§4.3-C — v1.1)** |
| KMB-E622 | 採番失敗 / 書類番号重複 | 書類番号の発行に失敗しました。 | 再試行 (新しい番号で採番し直される — 欠番は許容 §6.1-4)。頻発時は document_sequences の状態を開発者へ |
| KMB-E623 | 派生条件外 (許可表外/派生元状態不正/対象不正) | この書類からは作成できません。 | 派生元が発行済み (または承諾済み) か確認。入金は請求書にのみ記録可 |
| KMB-E624 | 発行済み帳票の変更禁止 | 発行済みの帳票は変更できません。 | 「訂正発行…」(内容の差し替え) または「取消 + 再作成」(§4.3) から行う |
| KMB-E625 | 入金額が残高超過 | 入金合計が請求金額を超えます。 | detail の残高を確認して金額を修正。実際の過入金は返金 or 次回相殺 (memo 運用 — パターン 9) |
| KMB-E626 | 発行者情報未設定 | 請求書発行者の設定が必要です。 | サイト設定「請求書発行者」タブ (§8.6) で発行者名を保存してから発行 |
| KMB-E627 | 台帳 (issued_documents) 整合エラー / 不変保存違反 | 発行控えの記録に不整合があります。 | 「再出力 (版+1)」で回復を試す。解消しない場合は detail を添えて開発者へ。台帳行・保存 PDF の変更/削除試行は本コードで一律拒否 (trigger — §2.3.2) |
| KMB-E640 | PDF 生成失敗 (Chromium 起動/レンダリング) | PDF の作成に失敗しました。 | 再試行。detail が env 未設定 (PRINT_TOKEN_SECRET / SERVICE_ROLE_KEY) を示す場合は設定が先 (degrade バナー — §5.4) |
| KMB-E641 | PDF 保存失敗 (Storage 書込/署名 URL) | PDF の保存に失敗しました。 | 再試行 (保存パスは sha256 入りで版ごとに一意 — 重複は版番号の進行で自然回避)。続く場合は Storage 状態を開発者へ |
| KMB-E642 | 印刷トークン不正/期限切れ/**消費済み** (v1.1) | このプレビューの有効期限が切れました。 | 帳票画面から「印刷プレビュー」を開き直す (TTL 5 分・**1 回限り** — §7.3) |
| KMB-E643 | PDF 生成の同時実行制限 | PDF を作成中です。しばらくしてからもう一度お試しください。 | 数秒〜十数秒後に再試行 (グローバル同時実行 1 — §7.4-1。lease は最長 90 秒で自然解放) |
| KMB-E644 | 帳票メール送付の送信失敗 (issue #101) | メールの送信に失敗しました。 | detail を確認。RESEND_API_KEY 未設定なら env 設定が先。送信失敗は document_emails に status='failed' で記録済みのため、直せば再送できる |
| KMB-E645 | 帳票メール送付の宛先メールアドレス不正・未指定 (issue #101) | 送信先メールアドレスが不正です。 | 宛先を確認して入力し直す (顧客に email 未登録の場合は先に顧客情報を編集するか、ダイアログで直接入力する) |

運用規則:

- 共用コード: E101 (Zod 入力不正 — 税ガード §5.3 含む) / E103 (楽観排他) / E201・E202 (認証・認可) / E901 (システム)。E602 (deal ステージ) は crm 帯のまま app 層合成 (§7.1-2) で扱う
- SQL (trigger / RPC) からの送出は `raise exception 'KMB-EXXX: …'` の先頭埋め込み規約 (replace_work_image 前例) — repository がメッセージ先頭をパースして Result.code に変換する (§6.1 recordPayment の注記と同一機構)
- E628〜E639 / E646〜E649 は未使用のまま返上 (帯は sales 予約継続。追加は 00-overview §3.3 = 契約書の改訂が先)

---

## 13. テスト戦略 (必須章② — implementer+tester ペア・2 回連続 PASS を可能にする粒度)

00-overview §9.2 の sales 行 (必須単体 4 = sales-tax / sales-numbering-format / sales-derive-snapshot / sales-doc-state、必須結合 = 採番同時実行・issued 後編集拒否 trigger・台帳 append-only) を包含し、ファイル単位まで具体化する。

### 13.1 単体テスト (Vitest — 実 DB なし)

| テストファイル | 対象 (純関数) | 必須ケース |
|---|---|---|
| `tests/sales-tax.test.ts` | tax.ts (computeDocumentTotals / roundByMode) | **丸め 3 方式 (floor/round/ceil) × 税区分の全組合せ** (standard_10 単独 / reduced_8 混在 / zero・exempt 混在 / 4 区分同時) / 端数境界 (税額 *.5 円での round の挙動・floor/ceil の方向。**負値は Math.round 準拠の期待値で fixture 固定 — §5.3 v1.1**) / 値引き行 (負 amount) 反映後の課税標準 / 負課税標準の返却値 (発行ガード E101 の判定入力になる) / 出現しない区分 = 行なし・zero/exempt 出現 = tax_jpy 0 で行あり / **「行別丸め合算 ≠ 書類 1 回丸め」になる fixture** (例: ¥333 × 3 行 × 10%) で書類丸めの値になる回帰検証 (J5 / ext-hubspot B-3) / 上限値 9,999,999,999 / 空 lines → {0, [], 0} / **様式非依存の確認**: 免税/適格で計算結果が同一 (§5.3 — 分岐は表記のみ) |
| `tests/sales-numbering-format.test.ts` | contracts.ts (DOC_NO_PREFIX / zDocumentNo) | prefix 4 種 (Q/J/D/I) / 4 桁 zero-pad (1 → 0001) / 9999 → 10000 の桁増加 (切り詰めない — パターン 14) / zDocumentNo が RPC (M0 §3.4) の format 出力を全て受理 / 不正 prefix (O- 等)・桁不足の拒否 |
| `tests/sales-derive-snapshot.test.ts` | internal/derive.ts | DERIVATION_RULES の許可 4 経路 + 禁止代表 (order→quote / invoice→* / 同種間) / 複製対象 (lines 全行・position 維持・source/work_type_key 引継ぎ・billing_*/site_*/notes/tax_rounding) / 非複製 (doc_no/issue_date/valid_until/税集計 — §4.4) / **transaction_date の引継ぎ規則 (delivery→invoice = 派生元 issue_date、他は null — §4.4 v1.1)** / シミュレーター変換 (§9.1 — 06-simulator §5.4 T6 の canonical): 通常 1 行・単価逆算 round(total_max÷qty÷1.1)・quote_only=true → 0 行 + notes・notes 文言 (applied_tier あり/なし・レンジ表記) |
| `tests/sales-doc-state.test.ts` | internal/state.ts | canTransition の全状態 (7) × 全遷移の網羅マトリクス (§4.1/4.2 と 1:1) / 種別限定 (accepted・declined・expired = quote のみ、paid = invoice のみ) / voided 完全終端 / expired→accepted (遅れ承諾) / derivable_to 算出 (DERIVATION_RULES × 現状態) |
| `tests/sales-print-token.test.ts` | internal/print-token.ts | 正 token 往復 PASS / exp 超過 FAIL / hmac 1 文字改竄 FAIL / document_id 差し替え FAIL / 形式不正 (区切り欠落・hex 以外) / token_hash (sha256) の導出一致 / zPrintTokenExtras の parse (doc_no / staging_id — v1.1) / PRINT_TOKEN_SECRET 未設定時の degrade 判定 (isPrintTokenSecretConfigured)。※ワンタイム消費 (print_tokens) は DB 依存のため §13.3 で検証 |
| `tests/sales-issuer-snapshot.test.ts` | internal/issuer.ts | settings 'company' + 'invoice_issuer' の合成 / 任意項目 null (bank_account / seal_storage_path / tel / email / transfer_fee_note) / E626 判定 (キー行なし・issuer_name 空) / registration_number null の保持 (免税モード判定値 — §10.5) |
| `tests/sales-diff.test.ts` | internal/diff.ts | ヘッダ 1 項目変更 / 明細の追加・削除・変更 (行文字列正規化) / 完全同一 → 空 diff (「再出力」表示の判定) / tax_summary・total の増減サマリ / older/newer の入力順防御 |
| `tests/sales-contracts.test.ts` | contracts.ts (§5.2) | zUpdateDraftDocumentInput の refine (quote 以外で valid_until 非 null 拒否)・lines 0 行許容 (draft) / **zReviseDocumentInput の refine (quote 以外で valid_until 非 null 拒否 — v1.1。DB check の生 E901 化防止)**・lines min 1・issue_date 必須・transaction_date nullable / zIssuedContentSnapshot の代表 parse (.strict() 未知キー拒否・transaction_date 必須) / zDocumentListFilter / STANDARD_LINE_PRESETS の型・件数 (§8.3 の定型 3 行) |
| `tests/sales-send-email.test.ts` (issue #101) | facade.ts sendDocumentByEmail (repository/crmFacade/internal/email を vi.mock — sales-facade.test.ts と同型パターン) | E621 (draft・帳票不在) / E623 (voided/declined/expired) / E627 (版なし・doc_no 未確定) / E645 (宛先不正・未指定 — to フィールド由来のみ区別) / E644 (RESEND_API_KEY 未設定・Resend API エラー) + いずれも document_emails に status='failed' 行が記録されること / 成功時の document_emails 行 (status='sent') + appendActivity('email', direction:'outbound') 呼び出し内容 / appendActivity 失敗時も送信は成功扱いで返る (console.warn 縮退) |

### 13.2 契約 parity (`tests/contracts-ddl-parity.test.ts` へ追加)

- documents.doc_type / documents.status / documents.tax_rounding / documents.billing_suffix / document_lines.tax_category / payments.method の DB check ↔ Zod enum 1:1
- DOC_NO_PREFIX ↔ migration 0022 RPC の case 式の一致 (M0 §3.4 が指定する二重定義検証 — sales フェーズで実装を担う)
- **document_lines に列名へ `tax` を含む列が存在しないこと** (J5「明細に税額を持たない」の構造的強制の回帰テスト — §2.3.1 の注記どおり)
- issued_documents.sha256 の check (hex 64 桁) ↔ 保存前の TS 側検証の一致
- document_emails.status ↔ contracts.ts の zDocumentEmailStatus (issue #101 — migration 20260714000036)

### 13.3 結合テスト (supabase start — migration 0021〜0028 適用済み実 DB)

| 対象 | 検証セル |
|---|---|
| document_number_next 採番同時実行 (RPC は M0 0022 — 利用者として sales が担う。00-overview §9.2 の sales 必須結合) | 並行 10 呼び出しで欠番なく単調増加 / (doc_type, 年) ごとの独立採番 / 9999→10000 の桁増 (00-overview §14.2 A2 と同一セル — sales フェーズで再実行して回帰を確認) |
| document_finalize_issue RPC | draft→issued + 台帳 v1 + current_version=1 の原子性 / **台帳 transaction_date = coalesce(documents.transaction_date, issue_date) (v1.1 — 取引日 ≠ 発行日のケース)** / CAS (updated_at) 不一致 E103 / 非 draft E621 / 0 行 E620 / doc_no 重複 E622 / anon・非 admin authenticated で raise / admin・service で成功 |
| document_save_draft RPC (v1.1) | CAS 不一致 E103 / 非 draft E624 / ヘッダ+明細の原子置換 (途中失敗で明細が消えない) / 0 行許容 (quote_only 原案) / **契約形式の p_lines (position なし) が ordinality で 0 始まり連番に採番される** |
| document_append_version RPC | v2 append + supersedes=v1 行 + current_version 前進 / 現行版行の欠落 E627 / 対象外状態 (draft/declined/expired/voided) E621 / CAS E103 / **台帳 transaction_date = coalesce(transaction_date, issue_date) (v1.1)** |
| document_apply_revision RPC (v1.1 原子化) | **staging 起点の原子確定** — documents 更新 + 明細置換 + 台帳 append + current_version 前進が同一トランザクション (部分状態が観測されない。RPC 失敗時は documents/台帳が無傷で staging が残る) / **契約形式の staging.lines (position なし) が ordinality 採番で成功する** / staging 不在 E621 / 入金記録ありの invoice 拒否 / 0 行 E620 / 対象外状態 E621 / CAS E103 / **トランザクション外に GUC が残らないこと** (直後の session UPDATE が E624 で拒否される) |
| 凍結 trigger (§2.3.1) | issued の内容列 UPDATE → E624 (§2.3.1 の凍結対象 21 列から代表 3 列以上。transaction_date 含む) / status・status_reason・voided_at の更新は通る / voided は status 含め E621 / draft は自由 / **入金記録のある invoice の voided 遷移 → E621 (部分入金と void の TOCTOU ガード — v1.1)** |
| document_lines draft ガード | 発行後の INSERT/UPDATE/DELETE → E624 / draft は全操作可 / 親 draft DELETE の cascade 素通し |
| payments 消込 trigger | 部分入金 (status 不変・残高計算) → 完済で paid + paid_at / 超過 E625 / DELETE で paid→issued 自動復帰 / invoice 以外 E623 / 未発行 E621 / voided への入金・削除 E621 / **UPDATE は revoke 済み grant 欠如で permission denied (0 行素通りでないこと — v1.1)** |
| issued_documents append-only | UPDATE/DELETE が **service_role でも** E627 raise (trigger — §2.3.2) / admin session の直接 INSERT は書込ポリシー不在で拒否 (書込は RPC のみ) |
| **Storage 不変 trigger (v1.1)** | bucket issued-documents の storage.objects UPDATE/DELETE が **service_role でも** E627 raise / INSERT (upsert:false) は通る / 他バケットは無影響 |
| **document_emails RLS (issue #101、migration 20260714000036)** | authenticated (admin) の SELECT/INSERT は成功 / UPDATE/DELETE は grant なしで permission denied / anon は revoke 済みで全操作拒否。実 DB 適用・検証はプロジェクト運用方針 (docker 無し — 本番適用後 execute_sql 検証) に従い本 Issue 実装時点では migration ファイル作成のみに留め、適用は別途行う |
| **print_tokens 消費 (v1.1)** | 1 回目の消費 = returning 1 行 / 2 回目 = 0 行 (403 E642 相当) / 期限切れ = 0 行 / anon・authenticated の直接アクセス不可 (revoke) |
| **pdf_render_lock lease (v1.1)** | CAS 取得成功 → 並行 2 本目は 0 行 (E643) / locked_until 経過後に再取得可 / 返却 (locked_until=now) 直後に取得可 |
| RLS マトリクス §3.2 全セル | anon/admin/service の 3 クライアント × 全テーブル (補助 3 テーブル含む) × SELECT/INSERT/UPDATE/DELETE。**admin の列 grant** (doc_no / current_version / issuer_snapshot / issued_at / paid_at の直接 UPDATE → **permission denied** — v1.1 revoke 完全化の回帰点) / documents INSERT の status='draft' 限定 / DELETE の draft 限定 |
| SalesFacade 状態遷移 (facade 経由・実 DB) | 派生の許可 4 経路 + E623 (draft 元 / 許可表外) / accept → derive / 発行後 updateDraftDocument の E624 透過 / voidDocument の理由必須 E101・入金あり invoice の E621 / markExpiredQuotes (valid_until < JST 今日の issued quote → expired + activity) |
| appendActivity 統合 (crm と結合) | issued / paid / accepted の各 event の冪等 (二重 append → created:false) / 合成 ref_table (`documents/accepted` 等 — §6.2) が実レコード ref (issued_documents / payments) と衝突しないこと |
| Storage upsert:false | 同一パスへの 2 回目保存が Duplicate 失敗 → E641 変換 (gap-pdf §5 の最終防波堤) |

### 13.4 PDF スモークテスト (実 Chromium — 通常 CI から分離)

実行形態: `tests/pdf-smoke/` + 専用 script (例 `pnpm test:pdf-smoke`)。puppeteer 起動を伴うため vitest の通常 CI ジョブには含めず、**ローカル実行 + Issue #3s-3 の受入時に必ず実行** (00-overview §11 の受入注記と同運用)。検証は生成 PDF からのテキスト抽出 (pdf-parse 等の dev 依存 1 点 — 本番依存に足さない)。

| fixture | 検証 |
|---|---|
| (a) 標準 1 ページ (明細 5 行・角印あり・適格モード・quote) | 6 記載事項の文字列が全て存在 (発行者名 / T 番号 / 発行日 / 品名 / 「10%対象」+ 税額 / 宛名) / 「御見積金額」「有効期限」/ 「以下余白」/ ページ数 1 |
| (b) **2 ページ超 (明細 40 行・invoice)** — パターン 15 / R4 | ページ数 = 2 / 頁番号文字列「1 / 2」「2 / 2」(**counter(pages) の解決が主検証点** — gap-pdf §8) / 2 ページ目に列見出し (thead 再描画) と継続ヘッダ「（続き）」/ 1 ページ目に継続ヘッダなし (@page :first) / 「以下余白」と振込先が最終ページ / 合計ブロックが分断されていない |
| (c) 免税 + 値引き + exempt 混在 (invoice、transaction_date ≠ issue_date) | 「消費税相当額」あり・「登録番号」なし (§10.5) / 「▲」値引き表記 / 「対象外」行の税額 ¥0 / 振込先・手数料文言 / **「取引日」行が発行日と別に印字される (v1.1 §10.3)** |

- (b) の counter(pages) / :first / thead のいずれかが不動作の場合は §10.2 のフォールバック判断 (継続ヘッダ全頁妥協 → それでも不可なら headerTemplate 代替 — 00-overview §15 R4) を発動し、判断結果を本書の更新履歴に記録する
- sha256 の再現性 (同一入力 → 同一 PDF) は**検証しない** (フォントレンダリング・メタデータで揺れる。版同定は保存時点の sha256 で足りる)

### 13.5 E2E (Chrome MCP — 本番前・人が実行)

- 一気通貫: 顧客/案件 (crm) → draft 見積 (定型行挿入・税集計プレビュー・Cmd+S) → 発行 (トースト + deal ステージ自動適用) → 承諾 → 「受注にする」derive → 発行 → 「納品書にする」→ 「請求書にする」→ 発行 → 部分入金 → 完済 paid → deal 'paid'
- 訂正発行 → 版履歴 → 「前の版と比較」(§11.1) → 旧版 PDF の閲覧 (署名 URL)
- **キーボードチェックリスト §8.7 の全セル** (↑↓ / Enter / Esc / Tab / Cmd+S / Cmd+Enter / Alt+↑↓)。N/A セルは理由を記録 (E2E キーボード規約)
- 印刷プレビュー (draft 透かし確認 — §10.2) / PDF ダウンロード / env 未設定時の degrade (発行ボタン disabled + バナー — §5.4)

運用: implementer+tester ペア、修正→再検証ループ、**2 回連続 PASS で完了** (全プロジェクト規約)。カバレッジ: tax / state / derive / print-token / diff は分岐 100%、その他 80% 目安。

---

## 14. 移行計画と受入基準 (必須章⑦)

### 14.1 移行 — データ移行は該当なし (理由付き)

**該当なし**。sales の所有 5 テーブルは全て新規で、既存システム内に帳票データが存在しない。過去の紙/Excel 見積の取込も行わない — 理由: (1) 電帳法・税法上の既存書類の保存義務は従前の方法で履行済みであり、本システムの保存義務は**稼働後に交付する書類**から始まる (ext-hubspot B-12)。(2) 紙→構造化データの変換は費用対効果がない。リピート案件での過去金額の参照は crm の活動メモで代替できる (contact_inquiries の取込は 01-crm.md §12.1 の管轄 — 帳票データではない)。document_sequences の初期データも不要 (初回採番時に `on conflict do nothing` で行が生まれる — M0 §3.4)。

### 14.2 環境セットアップ手順 (受入の前提)

1. migration 0021/0022 (M0) の本番適用を確認 → **0026 → 0027 → 0028 を順に本番 apply** (手動 — HANDOFF §3 の運用)。0028 は branding-assets バケット作成のみ (v1.2 内容置換 — §2.3.3。旧「0015/0017 との diff 確認」手順は 3 点セット置換の廃止に伴い削除)
2. Vercel env: **PRINT_TOKEN_SECRET を新設** (§7.3) + SUPABASE_SERVICE_ROLE_KEY (00-overview §12.1 C2 — 未設定なら発行系は degrade)
3. /admin/settings「請求書発行者」タブ (§8.6) を保存: 発行者名 / 登録番号 (★堀さん確認 2 — 空なら免税モード) / 端数処理 (★確認 7 — 既定 切捨て) / 振込先 / 手数料文言 / 角印画像 / 見積有効期限日数
4. **電帳法の事務処理規程の備付け** (真実性 (d) の併用 — 国税庁ひな形) + 税理士確認の推奨 — 堀さん側の運用タスクとして Issue 化 (J5)
5. 動作確認の発行はステージング (supabase start) を第一選択とする。本番で試す場合は**宛名を「テスト」と明記して発行 → 即 void** (台帳は物理削除できない設計のため、テスト行も 7 年残る — §16 R6)

### 14.3 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| T1 | migration 0026〜0028 適用後、RLS マトリクス §3.2 の全セル + 列 grant (doc_no 等 5 列の session UPDATE 拒否) が期待どおり | 結合テスト + 本番 SQL 実測 |
| T2 | RPC 4 本 (save_draft / finalize_issue / append_version / apply_revision) が §13.3 の全分岐で PASS (admin/service/anon の 3 ロール)。apply_revision は staging 起点の原子確定 (v1.1) | 結合テスト |
| T3 | 凍結 trigger (入金あり invoice の void 拒否含む — v1.1)・draft ガード・入金消込 trigger が §13.3 の全分岐で PASS | 結合テスト |
| T4 | issued_documents **と Storage bucket issued-documents (storage.objects trigger — v1.1)** の UPDATE/DELETE が **service_role でも拒否**される | 結合テスト + 本番 SQL 実測 |
| T5 | 契約 parity (§13.2 — enum 6 種 + `tax` 列不存在 + DOC_NO_PREFIX↔RPC) PASS + 既存全テストが PASS のまま | CI |
| T6 | 請求書 PDF が適格請求書 6 記載事項を満たし、免税モードで区分記載様式に分岐する (00-overview §14.2 A7 前半) | PDF スモーク (§13.4 a/c) + E2E 目視 |
| T7 | issued_documents を取引年月日 (範囲)・金額 (範囲)・取引先で検索できる (電帳法 検索 3 項目 — A7 後半) | 台帳 SQL (index §2.3.2 使用) |
| T8 | 2 ページ超スモーク (§13.4 b) PASS — counter(pages) / thead 再描画 / 継続ヘッダ / 小計送り | PDF スモーク |
| T9 | quote→order→delivery→invoice→部分入金→完済の一気通貫 + deal ステージ自動適用 (§7.1-2) | E2E |
| T10 | 訂正発行 → 版履歴 → 版間差分表示 (§11.1) → 旧版 PDF が不変のまま閲覧可能 | E2E |
| T11 | 0028 適用後、branding-assets バケットが private (public=false) で存在し、anon/authenticated から直接読めない。角印画像は server 発行の署名 URL でのみ取得できる (v1.2 — 07 §D5 v1.2) | 結合テスト + 本番実測 |
| T12 | /admin/documents のキーボードチェックリスト (§8.7) 全 PASS (N/A は理由記録) | E2E |

---

## 15. 規模見積り (必須章⑧)

| 区分 | ファイル | 概算行数 (実装+テスト) |
|---|---|---|
| DDL/RPC | migrations 0026 / 0027 / 0028 (v1.1: save_draft RPC・補助 3 テーブル・storage trigger 追加) | 850 |
| contracts | sales/contracts.ts (07 §4.11 写経 + §5.2 内部契約 + STANDARD_LINE_PRESETS) | 450 |
| 税計算 | sales/tax.ts (純関数) | 120 |
| facade/repository | facade.ts (契約 8 + 拡張 12) / repository.ts (RPC 呼び出し・KMB prefix パース) | 1,000 |
| internal | pdf / print-token / issuer / derive / state / diff | 700 |
| 印刷ルート | (print) page.tsx + DocumentSheet + print.css (§10) | 700 |
| route/actions | /api/documents/[id]/pdf + actions.ts (12 Action + deal ステージ提案合成 §7.1-2) | 350 |
| 画面 | 一覧 / 編集 (明細エディタ・税プレビュー) / 詳細 (版履歴・入金・系譜) / 入金・版比較ダイアログ / 設定「請求書発行者」タブ | 1,900 |
| テスト | §13.1 単体 8 + §13.2 parity + §13.3 結合 + §13.4 PDF スモーク | 1,900 |
| **計** | | **約 7,950** (00-overview §13 の 〜7,500 に対し +6%: 明細エディタ・PDF スモークの精査増分 + v1.1 レビュー反映 (原子化 RPC・補助テーブル・lease)。許容範囲と判断) |

ランニングコスト増分: 実質なし — PDF 生成は既存 Chromium 基盤の従量内 (1 通 〜3 秒・単発生成)、Storage は 1 通数百 KB (月 30 通 ≈ 10MB/月、7 年で 〜1GB 弱)。AI 呼び出しなし。

---

## 16. リスクと要確認事項

スコープ外 (銀行 API 自動消込・カード決済・メール送付・適格簡易請求書・源泉徴収・会計連携) の canonical は **§0.5** — 本章では再掲しない。将来の拡張経路は §18。

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | margin boxes / counter(pages) / @page :first が page.pdf() で不完全 (gap-pdf §8) | 頁番号・継続ヘッダの欠落 | 2 ページ超スモーク (§13.4 b) を #3s-3 受入に必須化。不備の段階に応じ §10.2 のフォールバック (継続ヘッダ全頁妥協 → headerTemplate 代替 — 00-overview §15 R4) |
| R2 | 発行フローの多段外部作用 (採番→PDF→Storage→RPC→activity) の途中失敗 | 欠番・孤児 PDF・孤児 staging | 各段を前方安全に設計済み: 欠番許容 (§6.1-4) / 孤児 PDF・staging 無害 (§6.1-7 / §4.5-4 — documents と台帳の確定は常に最終段の単一 RPC で、乖離状態が存在しない — v1.1)。結合テストで各段の失敗を注入 (§13.3) |
| R3 | 電帳法の解釈 (真実性の確保の方式選択) | 法令適合 | システムは (c) 訂正削除不可を構造で満たす (append-only 台帳 + 凍結 trigger + upsert:false)。(d) 事務処理規程の備付け + 税理士確認は堀さん側運用 (§14.2-4、00-overview §15 R8) |
| R4 | PDF 同時実行 1 (E643) による発行の直列化 | 連続発行時の待ち | DB lease (pdf_render_lock — §7.4-1 v1.1) でインスタンス数によらずグローバル 1 本 (J5 の方式 A 条件を多インスタンスでも保証)。1 人運用で発行頻度は低く実害なし。E643 はトーストで再試行誘導 (§12)。クラッシュは lease 失効 90 秒で自己回復 |
| R5 | 免税→課税転換 (運用途中で T 番号を設定) | 様式の切替時期の混乱 | issuer_snapshot 凍結により発行済みは旧様式のままで正 (発行時点の事実)。設定変更後の新規発行から適格様式 (§10.5)。設定タブに切替挙動の注記を表示 (§8.6) |
| R6 | テスト発行の台帳残留 | 消せないテスト行が 7 年残る | 物理削除しない設計の裏面として受容。検証はステージング第一 + 本番は宛名「テスト」明記 → 即 void の運用手順 (§14.2-5) |
| R7 | 角印・振込先の未設定のまま発行 | 紙面の欄欠落 | いずれも法定事項ではなく非印字で正 (B-9/B-10、§10.4/§10.6)。必須は発行者名のみ (E626)。設定タブに「推奨」バッジで誘導 |
| R8 | 明細 0 行の quote_only 原案の滞留 | 発行できない draft が溜まる | 仕様どおり (E620 が明細化を強制 — パターン 5)。一覧の「下書き」Badge と draft フィルタで可視化 (§8.2)。自動削除はしない (相談の記録価値) |

---

## 17. 統合時確認事項 (契約差分の改訂申請 — 統合作業者向け)

07-contracts-delta を module-contracts.md v2.8 に統合する作業者への申請 (04-telephony §1.5 と同形式):

| Δ | 対象 | 内容 |
|---|---|---|
| Δs1 | 07 §D2 (依存方向) | 「sales ──→ settings (invoice_issuer / company の read facade のみ)」を追記 (§1.2 ★注記の正式申請)。issueDocument が発行者情報 read を必要とし、D8 シグネチャ上 app 層合成では実現不能。ai-studio→settings と同型の read 依存で循環しない |
| Δs2 | 07 §7.9 (appendActivity 統合契約) | sales の **activity ref 合成キー規約** (§6.2 注記: 実レコードを生まない状態遷移イベントは `ref_table='documents/'+event`・`ref_id=document_id`) を注記として転記。あわせて 01-crm §15.1 R3 の openIssue「document_event の多イベント型と冪等キーの相性」への回答になっていることを確認 — issued/reissued/paid は実レコード ref (issued_documents / payments、イベントごとに新 id)、状態遷移 4 種は合成 ref_table で分離され衝突しない。**01-crm のタイムライン部品 (ref 逆引きリンク解決) が未知の ref_table 値を安全に無視する (リンクなし表示に degrade する) ことを実装前に確認** |
| Δs3 | 01-crm §7.2 (/api/jobs/crm-digest) | digest route が sales の契約外拡張 `markExpiredQuotes({mode:'service'})` / `getSalesDigest()` を app 層合成で呼ぶ配線 (§7.2/§7.5) を、crm 側実装 Issue (#2-2) と sales 側 Issue (#3s-4) のどちらが配線コードを書くか明記して重複実装を防ぐ — 推奨: route 本体は crm フェーズで骨格 (sales 部分は facade 存在チェックで skip)、sales フェーズで配線を有効化 |
| Δs4 (v1.1) | 07 §D8 (CrmFacade) | sales の宛名複製 (createDraftDocument) と一覧の案件名解決 (listDocuments) に必要な deal read の契約メソッド昇格。**07 v1.2 で `getCustomerRef` / `getDealRef` (最小射影 DealRef — §4.10) として統合採用済み**。残課題 = listDocuments (50 件/頁) の N+1 → **07 v1.7 で batch 版 `getDealRefs(dealIds)` と DealRef への address 追加 (billing_address 複製の源) を反映** |
| Δs5 (v1.1) | 07 §4.10 (zDocumentEventActivityPayload) | event enum に **'payment_recorded'** (部分入金の記録) を追加し、'paid' を「この入金で完済到達」に限定 (§6.1 recordPayment)。タイムライン・集計が部分入金を完済と誤認する余地を排除 → 07 v1.7 反映済み |
| Δs6 (v1.1) | 07 §4.11 / §D8 コメント | DocumentTotals コメントの tax.ts パスを `sales/internal/tax.ts` → `sales/tax.ts` に訂正 (admin UI がクライアント import するため internal 配下は ESLint MODULES 境界で不可 — §1.3)。§D8 createDraftQuoteFromEstimate コメントの「仮単価 = セル price_max」を 06-simulator §5.4 T1 参照へ訂正 → 07 v1.7 反映済み |

**裁定結果 (2026-07-11 — 07-contracts-delta v1.1「裁定記録」#4/#6/#8/#9)**: Δs1 = **採用** (D2 反映済み) / Δs2 = **採用** (07 §7.9 に統合規約として転記済み、01-crm の未知 ref_table 安全無視は #2-3 受入条件化) / Δs3 = **採用** (推奨どおり: 骨格 = crm フェーズ・配線有効化 = sales フェーズ、D9 注記)。付帯是正: `getSalesDigest` は service 文脈でも呼ばれるため `ctx?: ExecutionContext` を追加 (§6.2 反映済み)。01-crm §7.2 の旧提案シグネチャ (listQuotesExpiringWithin / listUnpaidInvoices) は破棄され本書 §6.2 が正。

**v1.1 反映 (2026-07-11)**: Δs4 (batch 版 + address) / Δs5 / Δs6 は本書 v1.1 レビュー反映に伴う契約改訂として **07-contracts-delta v1.7 に反映済み** (07 末尾「裁定記録」#22〜#24 と更新履歴 v1.7 参照)。

**他書への波及 (本書からは変更しない — 統合作業者への申し送り)**:

1. 00-overview §5.3 の /print 行「HMAC-SHA256(document_id+version+exp)」→ §7.3 の確定仕様 (HMAC 対象 = `document_id.exp` + print_tokens 消費によるワンタイム化) に読み替え・要改訂
2. 00-overview §5.4 の issued-documents 行「INSERT ポリシーのみ」→「ポリシーなし + storage.objects 不変 trigger」(§2.3.2) に要改訂
3. 00-overview §4.2 手順 3 の「仮単価 = セル price_max」→ 06-simulator §5.4 T1 の解釈 (total_max の税抜換算) が正
4. 00-overview §10 の sales 所有テーブル列に print_tokens / pdf_render_lock / document_revision_stagings を追加
5. 00-overview §6.2「帳票 → 案件」行の提案遷移 paid→paid は「確認ダイアログ適用 (自動適用しない — §7.1-2)」の注記が必要

**消し込み (v1.2 — 2026-07-11)**: 上記波及 1〜5 は **00-overview v1.2 で全て反映済み** (§5.3 /print 行・§5.4 issued-documents 行・§4.2 手順 3・§10 sales 行・§6.2 帳票→案件行)。あわせて 07-contracts-delta v1.8 が D1 sales 行に補助 3 テーブルを追記済み。

---

## 18. 将来拡張 (契約予約・拡張余地 — 実装しない)

**「帳票のメール送付 (J7 Phase 2)」は issue #101 で実装済みのため本表から除外した** (PDF「添付」方式。
署名 URL 方式は TTL 10 分でメール記載に不適のため不採用 — 判断根拠は #101 設計「方式判断」参照)。
実装内容は §6.2 `sendDocumentByEmail` / §12 KMB-E644・E645 / migration 20260714000036 (document_emails) を参照。
残る将来拡張は「BCC ログ・受信取込 (inbound)」のみ (00-overview §0.5)。

| 拡張 | 現設計での受け口 |
|---|---|
| 適格簡易請求書 (宛名なし様式 — ext-hubspot B-5) | 紙面テンプレートの分岐追加のみで対応可 (通販 = 不特定多数向け)。DDL・契約変更不要 (billing_name は保持したまま印字だけ省略、税率/税額の一方記載は §10.4 の縮約)。v1 は常にフル様式 (§0.5) |
| 分割請求 | 同一 source からの多重派生は DDL・派生規則上すでに許容 (§4.4 — v1 は UI 警告のみ)。将来は派生 UI に分割金額の補助を足すだけ |
| 源泉徴収の減算行 (他業種転用時のみ) | 塗装業は不要で欄を設けない方針を維持 (B-7、§0.5)。転用時は「税率別集計の後段の任意減算行」として合計欄拡張で吸収 (明細・税計算は不変) |
| 銀行 API / 会計 (freee 等) 連携による自動消込 | payments の構造は不変 (取込元が増えるのみ。method/memo で出所記録)。§0.5 |
| **入金実体と配賦の分離 (1 入金 → 複数請求の充当) — v1.1** | payments を payment_receipts (入金実体) + payment_allocations (invoice への配賦) に分離し、過入金を未充当残高/返金/次回充当として状態管理する拡張。v1 の payments 行は「配賦済み 1 行」と等価なため移行は機械的 (§2.4 パターン 24 の分割記録がそのまま allocations になる)。銀行明細 1:1 対応が要る自動消込 (上記) と同時に設計する |
| staff ロール | §3.5 (R のみ追加。発行・入金・訂正・取消は admin 専権) |
| 大量一括発行 | 方式 A の同時実行 1 が律速。要件化時は pdfme v6 への切替が第二候補 (gap-pdf §7 — 紙面仕様 §10 はテンプレート移植の正として維持) |

---

## 19. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 |
|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §3 (テーブル 4 列 + 列 grant + Storage/RPC + API + staff 差分 §3.5。ポリシー全文は §2.3 DDL) |
| ② テスト戦略表 (単体+結合、ペア 2 連続 PASS 粒度) | §13 (単体 8 ファイル + parity + 結合 DB/facade + PDF スモーク 3 fixture + E2E。00-overview §9.2 の必須 4 単体・必須結合を包含) |
| ③ エラーコード表 | §12 (E620〜E627 / E640〜E643 の recovery 全表 + 返上。採番 canonical は 00-overview §3.3) |
| ④ ライフサイクル | §4 (状態機械 + 訂正 3 経路 + 派生意味論 + 入金/版の不変条件) + §7 (発行シーケンス) |
| ⑤ 全データパターン列挙 | §2.4 (24 パターン — 00-overview §7 の sales 該当分を包含。v1.1: 取引日≠発行日 / 0 円請求書 / 一括振込を追加) |
| ⑥ 印刷出力仕様 | §10 (**該当あり — 本プロジェクト初の canonical**。A4 縦 4 書類 3 系統・6 記載事項配置・margin boxes + counter(pages)・改ページ規則・適格/区分記載分岐・角印・スモーク要件) |
| ⑦ 移行受入基準 | §14 (移行該当なしの理由 + セットアップ 5 手順 + T1〜T12) |
| ⑧ 規模見積り | §15 (ファイル別 + 00-overview §13 との照合 + ランニングコスト) |
| ⑨ 状態意味論 | §4.1〜4.2 (ASCII 図 + 状態×意味論表) + §4.5 (不変条件) + §4.6 (跨モジュール整合) |
| ⑩ 差分表示仕様 | §11 (版間差分の並記 + シミュレーター併記 + 該当なし部の理由) |
| モジュール契約 (全プロジェクト規約) | §1.4 (canonical 分担・再定義禁止一覧) + §5.1 (写経規約) + §17 (Δs1〜Δs3 改訂申請) |
| 値契約 (Zod canonical) | §5 (完全 TypeScript・.strict()・any 禁止・z.toJSONSchema のみ) |
| 非機能要件 | §7.4 (生成 〜3 秒/通・同時実行 1・maxDuration 60) / §15 (規模・コスト) / §16 (リスク) |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07-11 | 初版。裁定 J5/J9/J10 準拠 — スナップショット派生の 4 書類×7 状態機械・書類×税率 1 回丸め税計算 (tax.ts 純関数)・発行系 RPC 3 本 (finalize_issue / append_version / apply_revision 全文)・電帳法 append-only 台帳 + 方式 A PDF (A4 縦 3 系統・margin boxes + counter(pages)・適格/区分記載分岐・角印合成・改ページ規則)・入金消込 trigger・版間差分・シミュレーター見積原案変換・契約差分 Δs1〜Δs3 申請 |
| v1.1 | 2026-07-11 | レビュー指摘反映 (触れた章: §0.4/§1.1/§1.2/§2.1〜2.6/§3.2〜3.4/§4.2〜4.6/§5.2〜5.4/§6.1〜6.2/§7.1〜7.4/§8.3〜8.5/§9/§10/§11.1/§12/§13/§14.3/§15/§16/§17/§18/§19)。**BLOCKER**: ①取引年月日を issue_date から分離 (documents.transaction_date 新設 — インボイス記載事項 2。派生引継ぎ・S3 別欄印字・台帳 coalesce) ②訂正発行の原子化 (document_revision_stagings + staging 描画 PDF → apply_revision 単一 RPC で documents/明細/台帳/version を同時確定 — 乖離状態の廃止、§4.5-4 バッジ削除) ③/print トークンのワンタイム消費 (print_tokens 新設 — HMAC + 消費の 2 段。doc_no は payload へ移動し PrintTokenPayload と hmac 入力の不一致解消) ④PDF 生成のグローバル直列化 (pdf_render_lock lease — 多インスタンスで J5 の同時実行 1 を保証) ⑤deal 'paid' 自動適用の廃止 → 確認ダイアログ (01-crm §4.2 終端で undo 不能のため)。**MAJOR**: revoke を anon+authenticated に完全化 (列 grant / payments 不変の実効化)・draft 保存の RPC 化 (document_save_draft)・apply_revision の position を ordinality 採番に (契約に position なし)・CrmFacade の deal read を契約メソッド getDealRef / getDealRefs (batch) に統一 (Δs4 — 07 v1.2 統合 + v1.7 batch/address)・createPricingFacade 前例引用の訂正 (client 注入は新設)・settings は get のみ + E901→E626 変換・入金あり invoice の void を trigger ガード (TOCTOU)・WYSIWYG 主張を print メディアに限定・シミュレーター変換の canonical 分担明記 (06 §5.4)・一括振込パターン収載 (構造分離は §18 将来拡張 — v1 は分割記録+memo)。**MINOR**: 0021/0022 誤記訂正・§4.3-C 手順明記・zReviseDocumentInput refine・発行時 CAS チェーン明記・0 円 invoice 発行拒否・roundByMode 負値定義・payment_recorded イベント分離 (Δs5)・tax.ts パス訂正 (Δs6)。他書波及は §17 末尾 |
| v1.2 | 2026-07-11 | **07 §D5 v1.2 (角印 private 化 — BLOCKER) への追随** (触れた章: §1.1/§2.2/§2.3.3/§2.4 #17/§3.3/§5.2/§8.6/§10.3/§10.6/§13.1/§14.2/§14.3)。①zIssuerSnapshot の `seal_media_id: zMediaId` を **`seal_storage_path`** に置換 (zMediaId import 削除) ②migration 0028 を**内容置換**: 旧「seal_media_id の media 参照 3 点セット置換」→ **private Storage bucket 'branding-assets' の作成** (media は anon 全行 SELECT + public バケットのため社印が匿名取得可能だった。3 点セットを置換する migration は favicon 分 0035 のみに) ③§10.6 の「media の公開 URL を `<img>`」を **server 側署名 URL 解決**に是正 ④§8.6 角印画像を MediaPicker → branding-assets 直接アップロードに変更 ⑤受入 T11 を「バケット private + 署名 URL のみ」検証に差し替え・§14.2-1 の 0015/0017 diff 手順削除。あわせて **§6.1 getDocumentLinesForBlocks に grade_key/size_key の空文字→null 正規化注記** (07 §4.12 zGenerateBlocksInput min(1) 整合 — final-check V17)。※0028 の内容置換により 05-site-settings §2.5 の 0028↔0035 逆時系列運用規則 (裁定 #21) は前提消滅 — 05 v1.2 で整理 |
