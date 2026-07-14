import { z } from "zod";

import {
  zDateOnly,
  zDocumentNo,
  zInvoiceRegistrationNumber,
  zJpyAmount,
  zJpySignedAmount,
  zShortText,
  zTaxCategory,
  zTaxRounding,
} from "@/modules/platform/contracts";

/**
 * canonical: docs/design/crm-suite/07-contracts-delta.md §4.11 (D7) — sales の値契約。
 * §5.2 以下は 02-sales.md 側の内部契約 (各セクション冒頭のコメント参照)。
 * 実装は Issue #48 (migration 0026: documents/document_lines/payments) のスコープ。
 * facade (SalesFacade) の実装は #49、issued_documents 系は #50。
 */

/* ============================================================
 * §4.11 canonical 写経部 (07-contracts-delta.md D7、行590-694)。
 * 一字一句コピー — 乖離時は契約書 (07-contracts-delta.md) が正。
 * ============================================================ */

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
 *  訂正は新版の行が supersedes で旧版を参照する (旧行は書き換えない — 00-overview §4.4)。
 *  テーブル自体の migration (0027) は #50 のスコープ — 本型はそちらの実装が使う契約のみ先出しする */
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

/* ============================================================
 * 02-sales.md §5.2 (行1173-1359) — sales 内部契約 (本書 canonical)。
 * 一字一句コピー — 乖離時は 02-sales.md が正。
 * 依存する zDocType / zDocumentLineInput / zDocumentNo / zTaxSummary は上の §4.11 写経部で定義済み。
 * ============================================================ */

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
 *  発行時に settings 'invoice_issuer' + 'company' (住所/電話) から合成し凍結 (internal/issuer.ts — #49)。
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
 *  宛名系を持つ (作成時は deal から自動複製、以後は編集可) + doc_type/deal_id は変更不可のため持たない。
 *
 *  注意 (未解決点 — 02-sales.md §5.2 コメント / 本 Issue 計画書「未解決点2」参照): 「quote 以外で
 *  valid_until 非 null 拒否」の refine が §13.1 テスト仕様で要求されているが、本スキーマは
 *  documents.doc_type を持たない (作成時固定・変更不可のため分離されている) ため、このスキーマ
 *  単体では refine を実装できない。02-sales.md §5.2 のコード例自体にも refine の実装は無い
 *  (コメントで言及されるのみ)。doc_type を伴う refine は呼び出し側 (SalesFacade — #49) が
 *  documents.doc_type と本入力を合わせて検証する設計とする (DB check
 *  documents_valid_until_check の生 E901 化防止は #49 側の責務)。 */
export const zUpdateDraftDocumentInput = z.object({
  issue_date: zDateOnly.nullable(),          // null = 発行時に JST 今日
  transaction_date: zDateOnly.nullable(),    // 取引年月日 (納品日/役務提供完了日 — v1.1。null = issue_date と同日扱い §10.3)
  valid_until: zDateOnly.nullable(),         // quote 以外は null 必須 (refine — #49 facade 側で doc_type と合わせて検証)
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
 *  issue_date は非 null 必須 (台帳 transaction_date になるため)。
 *  valid_until の refine は zUpdateDraftDocumentInput と同じ理由・同じ設計方針 (#49 facade 側) */
export const zReviseDocumentInput = z.object({
  issue_date: zDateOnly,
  transaction_date: zDateOnly.nullable(),    // v1.1 (zUpdateDraftDocumentInput と同義)
  valid_until: zDateOnly.nullable(),         // quote 以外は null 必須 (refine — #49 facade 側で doc_type と合わせて検証。
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
export type DocumentListFilter = z.infer<typeof zDocumentListFilter>;

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
  // #51 追加: 系譜パンくず (§8.4「派生元 → 本書類 → 派生先」) を listDocuments({deal_id}) 1 回の
  // 呼び出しで組み立てるための項目 (読み取りビュー型 — Zod 化しない既存規約 §4.9 のまま拡張)。
  source_document_id: string | null;
};

export type DocumentDetail = {
  document: DocumentListItem & {
    source_document_id: string | null;
    current_version: number;
    // #51 追加: 取引年月日 (updateDraftDocument/reviseAndReissueDocument が必須で受け取る項目 —
    // 従来この型に無かったため、admin 編集画面が毎回 null 初期化 → 保存のたびに既存値を無言で
    // 上書き消去するデータ損失バグを構造的に踏んでいた。地雷回避のため追加。
    transaction_date: string | null;
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

/* ---------- 印刷トークン (internal/print-token.ts — #50) ---------- */

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

/* ============================================================
 * 定型明細プリセット (02-sales.md §8.3)。ラベルはラベル 3 種 (canonical 指定) を写経。
 * 既定単価は canonical に明記が無いため仮値 (実装計画書「未解決点1」— 要堀さん確認)。
 * 単体テストは型・件数 (3件) のみを要求 (§13.1 sales-contracts.test.ts)。
 * ============================================================ */

export type StandardLinePreset = {
  label: string;
  unit: string;
  unit_price_jpy: number;
  tax_category: z.infer<typeof zTaxCategory>;
};

export const STANDARD_LINE_PRESETS: readonly StandardLinePreset[] = [
  {
    label: "初回治具・段取り費",
    unit: "式",
    unit_price_jpy: 5_000, // 仮値 — 要堀さん確認 (未解決点1)
    tax_category: "standard_10",
  },
  {
    label: "リピートにつき段取り費免除（値引き）",
    unit: "式",
    unit_price_jpy: -5_000, // 仮値 (上記と対称) — 要堀さん確認 (未解決点1)
    tax_category: "standard_10",
  },
  {
    label: "送料（実費）",
    unit: "式",
    unit_price_jpy: 0, // 実費のため既定 0 (手入力前提) — 要堀さん確認 (未解決点1)
    tax_category: "standard_10",
  },
] as const;
