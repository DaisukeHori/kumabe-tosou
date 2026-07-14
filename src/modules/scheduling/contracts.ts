// scheduling モジュールの値契約。
// canonical: docs/design/crm-suite/07-contracts-delta.md §4.12 (07-contracts-delta が正。
// 03-scheduling.md §3.1 は写しであり内容は一致する)。差異があれば 07-contracts-delta を採用する。
// 実装は Issue #52 (03-scheduling.md §2.2 DDL + §7.1 テンプレ展開 + repository)、
// Issue #53 (§3.2 契約外拡張スキーマ + ブロック CRUD/状態機械/キャパ/自動配置)、
// Issue #54 (§2.3 calendar_connections/calendar_event_links DDL + §3.2 の外部同期解決アクション
// zExternalDeletionResolution/zOrphanedLinkResolution + §3.2 末尾の CalendarConnectionView/
// SyncIssueItem 読み取りビュー型 + WorkBlockView.sync の実データ化) の対象分。
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
// ============================================================================

/** ブロック配置/移動 (placeBlock)。starts < ends は refine + DB check (E701) の二重検証 */
export const zPlaceBlockInput = z.object({
  starts_at: zIsoDatetime,
  ends_at: zIsoDatetime,
}).strict().refine(
  (v) => new Date(v.starts_at).getTime() < new Date(v.ends_at).getTime(),
  "開始は終了より前である必要があります (KMB-E701)",
);

/** ブロック編集 (updateBlock)。配置・状態・実績は専用メソッド経由のためここに含めない */
export const zUpdateWorkBlockInput = z.object({
  work_type_id: z.string().uuid(),   // 変更時は consumes_capacity を再スナップショット (§5.1)
  title: zShortText(80).nullable(),  // zWorkBlockInput.title と対称 (空文字不可)
  planned_hours: z.number().min(0).max(999),
  memo: z.string().max(1000).nullable(),
  deal_id: z.string().uuid().nullable(),
}).strict();

/** admin 操作で許す状態遷移 (transitionBlock)。全遷移表は §5.1 — repository/internal で二重検証 */
export const zBlockTransition = z.enum(["in_progress", "cancelled"]);

/** カレンダー表示範囲の取得 (getCalendarRange / getExternalBusy) */
export const zCalendarRangeQuery = z.object({
  from: zIsoDatetime,
  to: zIsoDatetime,
}).strict().refine(
  (v) => {
    const ms = new Date(v.to).getTime() - new Date(v.from).getTime();
    return ms > 0 && ms < 62 * 24 * 60 * 60 * 1000; // Graph getSchedule の「62 日未満」制約 (ext-calendar §4)
  },
  "範囲は 62 日未満で指定してください",
);

/** 自動提案配置の要求 (§7.4)。対象は backlog ブロック集合 */
export const zProposePlacementInput = z.object({
  block_ids: z.array(z.string().uuid()).min(1).max(50),
  from: zIsoDatetime,                     // この時刻以降に置く (通常 = 今)
}).strict();

/** 外部削除 (deleted_externally) の解決アクション (§9.2 resolveExternalDeletionAction) */
export const zExternalDeletionResolution = z.enum([
  "unschedule",    // ブロックを未配置 (backlog) に戻し、リンクを削除
  "cancel_block",  // ブロックを cancelled にし、リンクを削除
  "repush",        // 外部イベントを再作成 (external_event_id を捨てて pending_push)
]);

/** orphaned link の解決アクション (§9.2 resolveOrphanedLinkAction — §5.3/§10.4) */
export const zOrphanedLinkResolution = z.enum([
  "repush",       // 外部イベントを再作成 (external_event_id/etag/hash を捨てて pending_push)
  "delete_link",  // link 行のみ削除 (ブロックは触らない)
]);

export type PlaceBlockInput = z.infer<typeof zPlaceBlockInput>;
export type UpdateWorkBlockInput = z.infer<typeof zUpdateWorkBlockInput>;
export type BlockTransition = z.infer<typeof zBlockTransition>;
export type CalendarRangeQuery = z.infer<typeof zCalendarRangeQuery>;
export type ProposePlacementInput = z.infer<typeof zProposePlacementInput>;
export type ExternalDeletionResolution = z.infer<typeof zExternalDeletionResolution>;
export type OrphanedLinkResolution = z.infer<typeof zOrphanedLinkResolution>;

// ============================================================================
// 読み取りビュー型 (Zod 化しない — §4.9「DB 出力の正しさは repository + DDL が保証」)。
// canonical: 03-scheduling.md §3.1 末尾 / §3.2 末尾。
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

export type WorkBlockView = {
  id: string; deal_id: string | null; deal_title: string | null;
  source_document_id: string | null;
  work_type_id: string; work_type_key: string; work_type_label: string; color: string;
  title: string | null; status: WorkBlockStatus;
  starts_at: string | null; ends_at: string | null;
  planned_hours: number; actual_hours: number | null; performed_on: string | null;
  consumes_capacity: boolean; quantity: number | null; memo: string | null;
  // calendar_event_links (migration 0030) を JOIN した実データ (facade.toWorkBlockView が詰める)。
  // link_id は #54 レビュー修正で追加 (deleted_externally 検知時に block-detail-dialog.tsx が
  // resolveExternalDeletionAction(linkId, action) をカレンダー画面上から直接呼べるようにするため —
  // 03-scheduling.md §10.2「deleted_externally の link を持つブロック: クリックで解決ダイアログ」)。
  sync: Array<{ link_id: string; provider: "google" | "microsoft";
                sync_status: EventLinkSyncStatus;
                last_error_code: string | null }>;
  updated_at: string;
};

export type BusyInterval = { starts_at: string; ends_at: string }; // 外部 free/busy 帯 (§8.1)

export type DealWorkSummary = {
  deal_id: string;
  planned_total_hours: number;   // cancelled 除く全ブロック
  actual_total_hours: number;    // done のみ
  done_count: number; open_count: number; // open = backlog+scheduled+in_progress
  blocks: Array<Pick<WorkBlockView,
    "id" | "work_type_label" | "status" | "planned_hours" | "actual_hours" | "performed_on">>;
};

/** proposeBlockPlacement (§7.4) の戻り値。提案のみ (永続化しない) */
export type PlacementProposal = {
  block_id: string; starts_at: string; ends_at: string;
  expected_updated_at: string;   // 提案生成時の block.updated_at — applyPlacementProposalsAction が
                                 // placeBlock(…, expectedUpdatedAt) へ透過 (楽観排他を形骸化させない §9.2)
};

/** getCalendarConnections (§6.2) の戻り値。calendar_connections 1 行 ↔ 1 要素 (provider 単位) */
export type CalendarConnectionView = {
  provider: "google" | "microsoft";
  status: CalendarConnectionStatus;
  account_email: string | null; app_calendar_id: string | null;
  token_expires_at: string | null; last_pulled_at: string | null;
  last_error_code: string | null; connected_at: string | null;
};

/** listSyncIssues (§6.2) の戻り値。deleted_externally / conflict / orphaned の一覧 (§10.4) */
export type SyncIssueItem = {
  link_id: string; provider: "google" | "microsoft";
  sync_status: EventLinkSyncStatus;
  last_error_code: string | null;
  block: Pick<WorkBlockView, "id" | "title" | "work_type_label" | "starts_at" | "ends_at" | "status">;
  deleted_externally_at: string | null;
};
