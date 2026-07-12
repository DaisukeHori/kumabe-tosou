// scheduling モジュールの値契約。
// canonical: docs/design/crm-suite/07-contracts-delta.md §4.12 (07-contracts-delta が正。
// 03-scheduling.md §3.1 は写しであり内容は一致する)。差異があれば 07-contracts-delta を採用する。
// 実装は Issue #52 (03-scheduling.md §2.2 DDL + §7.1 テンプレ展開 + repository) の対象分のみ。
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

// ============================================================================
// 契約外拡張スキーマ (canonical: 03-scheduling.md §3.2)。
// 自モジュールの admin UI (Server Actions) 専用の入力契約。他モジュールからの import 禁止。
// このファイルには Issue #52 (作業種別/テンプレート CRUD + generateBlocksFromLines) が使う分は
// 無い (zPlaceBlockInput 等は §6.2 の未実装メソッド専用のため、未使用 export による lint 警告を
// 避けて後続 Issue (#53/#54) がここへ追記する)。
// ============================================================================

// ============================================================================
// 読み取りビュー型 (Zod 化しない — §4.9「DB 出力の正しさは repository + DDL が保証」)。
// canonical: 03-scheduling.md §3.1 末尾。WorkBlockView 以降は #53 以降が使うため未転記。
// ============================================================================

export type WorkTypeRow = {
  id: string; key: string; label: string; color: string;
  consumes_capacity: boolean; default_hours: number | null;
  sort_order: number; is_active: boolean; updated_at: string;
};

export type WorkTemplateView = {
  id: string; name: string; grade_key: string | null; size_key: string | null;
  is_active: boolean; updated_at: string;
  items: Array<{ work_type_id: string; work_type_key: string; work_type_label: string;
                 hours: number; sort_order: number }>;
};
