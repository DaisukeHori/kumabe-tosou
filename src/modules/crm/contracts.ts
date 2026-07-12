import { z } from "zod";

import {
  zDateOnly, zDocumentNo, zIsoDatetime, zJpyAmount, zShortText, zTelE164,
} from "@/modules/platform/contracts";

/**
 * canonical: docs/design/crm-suite/07-contracts-delta.md §4.10 (D7) — crm の値契約。
 * §5.2 以下は 01-crm.md 側の契約外拡張・読み取りビュー型 (各セクション冒頭のコメント参照)。
 */

/* ============================================================
 * §4.10 canonical 写経部 (07-contracts-delta.md D7、行322-586)。
 * 一字一句コピー — 乖離時は契約書 (07-contracts-delta.md) が正。
 * ============================================================ */

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

/* ============================================================
 * 契約外拡張 (01-crm.md §5.2、行817-947)。admin UI / crm 内部専用。
 * 他モジュールから import してはならない (契約昇格は 07-contracts-delta 改訂が先)。
 * 依存する zCustomerLifecycle / zDealStage / zTaskStatus は上の §4.10 写経部で定義済み。
 * ============================================================ */

/** 顧客更新 (楽観排他の expectedUpdatedAt は facade 引数で別渡し) */
export const zCustomerUpdateInput = z.object({
  kind: z.enum(["person", "company_contact"]),
  name: zShortText(80),
  name_kana: z.string().max(120).nullable(),
  email: z.string().email().max(120).nullable(),
  tel_e164: zTelE164.nullable(),
  company_id: z.string().uuid().nullable(),
  address: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
  lifecycle: zCustomerLifecycle,          // 全遷移許可 (§4.1)
}).strict();
export type CustomerUpdateInput = z.infer<typeof zCustomerUpdateInput>;

/** 会社更新 (作成は canonical の zCompanyInput) */
export const zCompanyUpdateInput = z.object({
  name: zShortText(80),
  name_kana: z.string().max(120).nullable(),
  tel_e164: zTelE164.nullable(),
  address: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
}).strict();
export type CompanyUpdateInput = z.infer<typeof zCompanyUpdateInput>;

/** 顧客一覧フィルタ (ページングは platform の zPagination を併用) */
export const zCustomerListFilter = z.object({
  q: z.string().max(80).nullable(),       // 名前/かな/email/電話の部分一致 (電話は E.164 正規化後に前方一致)
  // 'active' = lead + customer (既定 — §4.1「archived は一覧の既定フィルタから除外」と一致させる。v1.1 是正)
  lifecycle: z.union([zCustomerLifecycle, z.literal("all"), z.literal("active")]).default("active"),
  include_merged: z.boolean().default(false), // merged_into 非 NULL 行の表示 (既定除外)
}).strict();
export type CustomerListFilter = z.infer<typeof zCustomerListFilter>;

/** 案件更新 (ステージ/失注は専用メソッド — 本スキーマに stage を含めない) */
export const zDealUpdateInput = z.object({
  title: zShortText(120),
  company_id: z.string().uuid().nullable(),
  amount_jpy: z.number().int().min(0).max(9_999_999_999).nullable(),
  expected_close_on: zDateOnly.nullable(),
  notes: z.string().max(10_000).nullable(),
}).strict();
export type DealUpdateInput = z.infer<typeof zDealUpdateInput>;

/** 案件一覧フィルタ */
export const zDealListFilter = z.object({
  q: z.string().max(80).nullable(),
  stage: z.union([zDealStage, z.literal("all"), z.literal("open")]).default("open"),
  // 'open' = 終端 (paid/lost) 以外
}).strict();
export type DealListFilter = z.infer<typeof zDealListFilter>;

/** 失注 (updateDealStage(to='lost') は KMB-E602 — 本入力の専用メソッドのみが lost へ落とせる) */
export const zMarkDealLostInput = z.object({
  reason: zShortText(200),
}).strict();
export type MarkDealLostInput = z.infer<typeof zMarkDealLostInput>;

/** 顧客マージ (§6.4)。winner = 残す側 */
export const zMergeCustomersInput = z.object({
  winner_id: z.string().uuid(),
  loser_id: z.string().uuid(),
}).strict().refine(v => v.winner_id !== v.loser_id, "同一の顧客同士はマージできません (KMB-E608)");
export type MergeCustomersInput = z.infer<typeof zMergeCustomersInput>;

/** note activity の編集 (note 以外は KMB-E605) */
export const zNoteUpdateInput = z.object({
  title: zShortText(120),
  body: z.string().max(10_000).nullable(),
  occurred_at: zIsoDatetime,              // 過去日時への変更可 (§4.4)
}).strict();
export type NoteUpdateInput = z.infer<typeof zNoteUpdateInput>;

/** タスク更新 */
export const zTaskUpdateInput = z.object({
  title: zShortText(120),
  body: z.string().max(2000).nullable(),
  due_on: zDateOnly.nullable(),
  deal_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
}).strict();
export type TaskUpdateInput = z.infer<typeof zTaskUpdateInput>;

/** タスク一覧フィルタ */
export const zTaskListFilter = z.object({
  status: z.union([zTaskStatus, z.literal("all")]).default("open"),
  scope: z.enum(["all", "overdue", "today", "week", "no_due"]).default("all"), // JST 判定 (internal/jst.ts)
}).strict();
export type TaskListFilter = z.infer<typeof zTaskListFilter>;

/** タイムライン取得対象 (厳密に 1 対象) */
export const zTimelineTarget = z.union([
  z.object({ customer_id: z.string().uuid() }).strict(),
  z.object({ company_id: z.string().uuid() }).strict(),
  z.object({ deal_id: z.string().uuid() }).strict(),
]);
export type TimelineTarget = z.infer<typeof zTimelineTarget>;

/** タイムライン keyset ページング。カーソルは base64("<occurred_at ISO>|<id>")
 *  (platform zPagination は created_at 基準のため crm 専用に分離。
 *   encode/decode は internal/timeline-cursor.ts — 単体テスト対象) */
export const zTimelinePagination = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export type TimelinePagination = z.infer<typeof zTimelinePagination>;

/** inquiry 種別 → 案件タイトル/取込ラベルの対応 (INQUIRY_TYPE_LABEL — UI/intake 共用)。
 *  訳語は既存 src/modules/inquiry/internal/notify.ts の INQUIRY_TYPE_LABELS と同一文字列 (v1.1 是正 —
 *  通知メールと CRM 画面で同じ inquiry_type に別ラベルを見せない)。inquiry internal は import 不可の
 *  ため定義の重複は構造上やむを得ない — 文言を変えるときは必ず両方を同時更新すること */
export const INQUIRY_TYPE_LABEL: Record<"construction" | "estimate" | "material" | "other", string> = {
  construction: "施工依頼",
  estimate: "見積もり相談",
  material: "材料に関する質問",
  other: "その他",
};

/* ============================================================
 * 読み取りビュー型 (01-crm.md §5.3、行949-1062)。
 * Zod 化しない — 契約書 §4.9 の規約どおり repository + DDL が正しさを保証する。
 * ActivityType / DealStage は上の §4.10 写経部で定義済み (この節では再 import しない)。
 * ============================================================ */

export type CustomerListItem = {
  id: string;
  kind: "person" | "company_contact";
  name: string;
  name_kana: string | null;
  email: string | null;
  tel_e164: string | null;
  company_name: string | null;       // companies JOIN (crm 所有内)
  lifecycle: "lead" | "customer" | "archived";
  source: "form" | "simulator" | "phone" | "manual" | "migration";
  open_deal_count: number;           // stage ∉ {paid, lost} の件数
  created_at: string;
  updated_at: string;                // 楽観排他用の生文字列
};

export type CustomerDetail = CustomerListItem & {
  address: string | null;
  notes: string | null;
  company_id: string | null;
  merged_into_customer_id: string | null;
  created_by: string | null;
};

export type CompanyListItem = {
  id: string;
  name: string;
  name_kana: string | null;
  tel_e164: string | null;
  address: string | null;
  customer_count: number;
  updated_at: string;
};

export type DealListItem = {
  id: string;
  title: string;
  customer_id: string;
  customer_name: string;
  company_id: string | null;   // #44 追加 (UI の編集フォームが company_id を EntityPicker の初期値として必要とするため — company_name のみでは id が復元できず編集保存時に無言で会社リンクが外れる不整合を防ぐ)
  company_name: string | null;
  stage: DealStage;
  amount_jpy: number | null;
  expected_close_on: string | null;
  source: "form" | "simulator" | "phone" | "manual" | "migration";
  created_at: string;
  updated_at: string;
};

export type DealDetail = DealListItem & {
  pipeline: "default";
  won_at: string | null;
  lost_reason: string | null;
  source_inquiry_id: string | null;
  notes: string | null;
};

/** カンバン 1 列 (§8.3)。probability/label は registry から UI が引く */
export type DealKanbanColumn = {
  stage: DealStage;
  total_jpy: number;                 // 列内 amount_jpy 合計 (NULL は 0 扱い)
  deals: DealListItem[];
};

export type TimelineItem = {
  id: string;
  activity_type: ActivityType;
  occurred_at: string;
  title: string;
  body: string | null;
  // facade が ACTIVITY_PAYLOAD_SCHEMAS で parse 済み。parse 失敗時は payload=null かつ payload_error に
  // メッセージが入る「行単位フォールバック」(01-crm.md §5.4 行1071/§8.5 行1390「表示できない記録」
  // フォールバック描画の要求 — 1 行の不整合でページ全体を KMB-E604 失敗にしない。実装判断根拠は
  // facade.ts の listTimeline 実装コメント参照)。UI は payload_error !== null を「表示できない記録」の
  // トリガーとして扱うこと。
  payload: ActivityPayload<ActivityType> | null;
  payload_error: string | null;
  ref_table: string | null;
  ref_id: string | null;
  editable: boolean;                 // activity_type === 'note'
  updated_at: string;
};

export type TaskListItem = {
  id: string;
  title: string;
  body: string | null;
  due_on: string | null;
  status: "open" | "done" | "cancelled";
  origin: "manual" | "ai_call" | "form" | "system";
  deal: { id: string; title: string } | null;
  customer: { id: string; name: string } | null;
  overdue: boolean;                  // JST 判定済み
  updated_at: string;
};

/** 日次ダイジェスト (§7.2)。sales 章は Phase 5 配線までは null (graceful degrade) */
export type CrmDigest = {
  generated_on: string;              // zDateOnly (JST)
  overdue_tasks: TaskListItem[];
  today_tasks: TaskListItem[];
  awaiting_leads: DealListItem[];    // stage='inquiry' の全件 (取込直後含む)
  sales: {
    expiring_quotes: Array<{ document_id: string; doc_no: string; valid_until: string; total_jpy: number }>;
    unpaid_invoices: Array<{ document_id: string; doc_no: string; issue_date: string; balance_jpy: number }>;
  } | null;
};

/** ダッシュボード KPI (§8.6) */
export type CrmDashboardKpi = {
  awaiting_lead_count: number;       // stage='inquiry' の deal 数
  weighted_pipeline_jpy: number;     // Σ floor(amount_jpy × probability / 100)、stage ∉ {paid, lost}
  overdue_task_count: number;
  week_open_task_count: number;      // 今週 (JST 月曜起点) が期日の open タスク数
};
