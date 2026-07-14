import "server-only";

import { getSessionAndClient } from "@/lib/supabase/session";
import { crmFacade } from "@/modules/crm/facade";
import type { ExecutionContext, Paged, Pagination, Result } from "@/modules/platform/contracts";
import { zDateOnly, zPagination } from "@/modules/platform/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import type {
  ActualInput,
  BlockTransition,
  BusyInterval,
  CalendarRangeQuery,
  CalendarSyncReport,
  DealWorkSummary,
  GenerateBlocksInput,
  PlacementProposal,
  ProposePlacementInput,
  UpdateWorkBlockInput,
  WeeklyCapacity,
  WorkBlockInput,
  WorkBlockView,
  WorkTemplateInput,
  WorkTemplateView,
  WorkTypeInput,
  WorkTypeRow,
} from "./contracts";
import {
  zActualInput,
  zBlockTransition,
  zCalendarRangeQuery,
  zGenerateBlocksInput,
  zPlaceBlockInput,
  zProposePlacementInput,
  zUpdateWorkBlockInput,
  zWorkBlockInput,
  zWorkTemplateInput,
  zWorkTypeInput,
} from "./contracts";
import { AUTO_PLACE_MAX_LOOKAHEAD_DAYS, proposePlacements, type AutoPlaceTarget } from "./internal/auto-place";
import {
  assertDeletable,
  canPlaceBlock,
  canTransitionBlock,
  deriveCreateStatus,
  derivePlacementStatus,
} from "./internal/block-state";
import { computeWeeklyCapacity, isJstMonday, resolveWeekRangeJst } from "./internal/capacity";
import { expandLinesToBlocks } from "./internal/template-expand";
import {
  DeleteGuardViolationError,
  ForeignKeyViolationError,
  OptimisticLockError,
  UniqueViolationError,
  cancelOpenWorkBlocksForDeal,
  deleteWorkBlockRow,
  deleteWorkTemplate as deleteWorkTemplateRow,
  deleteWorkType as deleteWorkTypeRow,
  getBacklogWorkBlocks,
  getBookedBlocksForAutoPlaceWindow,
  getDealWorkBlocks,
  getWeeklyBookedBlocks,
  getWorkBlockById,
  getWorkBlocksByIds,
  getWorkBlocksInRange,
  getWorkTypeSnapshot,
  insertWorkBlock,
  insertWorkBlocks,
  listActiveWorkTemplatesForExpand,
  listActiveWorkTypesForExpand,
  listWorkTemplates as listWorkTemplatesRows,
  listWorkTypes as listWorkTypesRows,
  recordWorkBlockActual,
  transitionWorkBlockStatus,
  unscheduleWorkBlock,
  updateWorkBlockDetail,
  updateWorkBlockPlacement,
  upsertWorkTemplate,
  upsertWorkType,
  type WorkBlockJoinRow,
} from "./repository";

/**
 * scheduling モジュールの公開 facade (03-scheduling.md §6)。
 *
 * `SchedulingFacade` (契約 6 メソッド = 07-contracts-delta §D8。シグネチャ変更禁止) と
 * `SchedulingFacadeExtended` (§6.2 契約外拡張。他モジュールから呼ぶこと禁止) を型として
 * フルセットで宣言する (crm/facade.ts の CrmFacade/CrmFacadeExtended 分割と同型)。
 *
 * ---- この Issue (#53) での実装範囲 ----
 * #52 が実装した generateBlocksFromLines + 作業種別/テンプレート CRUD 6 つに加え、
 * placeBlock/recordActual/getWeeklyCapacity (契約メソッド) と、createBlock/updateBlock/
 * unscheduleBlock/transitionBlock/deleteBlock/cancelOpenBlocksForDeal/getCalendarRange/
 * getBacklogBlocks/getDealWorkSummary/getExternalBusy/proposeBlockPlacement (契約外拡張) を
 * 実装する。runCalendarSync/runCalendarMaintenance (契約メソッド) と、外部カレンダー接続管理系
 * 8 メソッド (getCalendarConnections/disconnectCalendar/listSyncIssues/resolveExternalDeletion/
 * reconcilePushUnknown/resendConflictedLink/resolveOrphanedLink/requestSyncNow) は
 * calendar_connections/calendar_event_links (migration 0030) を前提とし、そのテーブルは
 * #54 が追加するため、この Issue では実装しない。前者 2 つは既に SchedulingFacade 側で型宣言
 * 済みなので `SchedulingFacadeExtended` に残るが Pick から外す。後者 8 つは戻り値/引数の型
 * (CalendarConnectionView / SyncIssueItem / zExternalDeletionResolution /
 * zOrphanedLinkResolution) 自体が #53 の contracts.ts にまだ存在しない設計判断
 * (worktree 実装計画書 §3.2 の指示) のため、インターフェース宣言そのものを #54 に委ねる
 * (存在しない型を参照する宣言だけを先に書いても tsc が通らず、かつ「型だけ先に書いて
 * 実装しない」ことによる利益がないため — オーケストレーターへの実装判断報告事項)。
 *
 * 実行文脈: 全メソッド session 固定 (admin セッション、`createSupabaseServerClient()` のみ)。
 * service 実行が必要なのは runCalendarSync/runCalendarMaintenance のみで #54 の担当。
 */
export interface SchedulingFacade {
  generateBlocksFromLines(
    input: GenerateBlocksInput,
  ): Promise<Result<{ block_ids: string[]; skipped: Array<{ description: string; reason: string }> }>>;
  placeBlock(
    blockId: string,
    startsAt: string,
    endsAt: string,
    expectedUpdatedAt: string,
  ): Promise<Result<void>>;
  recordActual(blockId: string, input: ActualInput, expectedUpdatedAt: string): Promise<Result<void>>;
  getWeeklyCapacity(weekStart: string): Promise<Result<WeeklyCapacity>>;
  runCalendarSync(ctx: ExecutionContext): Promise<Result<CalendarSyncReport[]>>;
  runCalendarMaintenance(ctx: ExecutionContext): Promise<Result<void>>;
}

export interface SchedulingFacadeExtended extends SchedulingFacade {
  // ---- 契約外拡張 (03-scheduling.md §6.2)。他モジュールから呼ぶこと禁止 — admin UI / app 層専用 ----

  // -- 作業種別 / テンプレート (#52) --
  listWorkTypes(includeInactive?: boolean): Promise<Result<WorkTypeRow[]>>;
  saveWorkType(
    input: WorkTypeInput,
    id: string | null,
    expectedUpdatedAt: string | null,
  ): Promise<Result<{ work_type_id: string }>>; // id null = 新規。key 重複は E101 (detail: 'key が重複しています')
  deleteWorkType(id: string): Promise<Result<void>>; // 参照ありは E702 (FK 変換)
  listWorkTemplates(includeInactive?: boolean): Promise<Result<WorkTemplateView[]>>;
  saveWorkTemplate(
    input: WorkTemplateInput,
    id: string | null,
    expectedUpdatedAt: string | null,
  ): Promise<Result<{ template_id: string }>>; // items は全置換。work_type_key 解決不能 / アクティブ combo 重複は E702 / E101
  deleteWorkTemplate(id: string): Promise<Result<void>>;

  // -- ブロック CRUD / 遷移 (#53) --
  createBlock(input: WorkBlockInput): Promise<Result<{ block_id: string }>>;
  updateBlock(blockId: string, input: UpdateWorkBlockInput, expectedUpdatedAt: string): Promise<Result<void>>;
  unscheduleBlock(blockId: string, expectedUpdatedAt: string): Promise<Result<void>>;
  transitionBlock(blockId: string, to: BlockTransition, expectedUpdatedAt: string): Promise<Result<void>>;
  deleteBlock(blockId: string): Promise<Result<void>>;
  cancelOpenBlocksForDeal(dealId: string): Promise<Result<{ cancelled: number }>>;

  // -- 読み取り (カレンダー/一覧/集計) (#53) --
  getCalendarRange(query: CalendarRangeQuery): Promise<Result<WorkBlockView[]>>;
  getBacklogBlocks(p: Pagination): Promise<Result<Paged<WorkBlockView>>>; // keyset 50 件
  getDealWorkSummary(dealId: string): Promise<Result<DealWorkSummary>>; // 案件画面の予実差 (app 層が呼ぶ)
  getExternalBusy(query: CalendarRangeQuery): Promise<Result<BusyInterval[]>>; // 未接続 = 空配列 (エラーにしない)

  // -- 自動提案配置 (#53) --
  proposeBlockPlacement(input: ProposePlacementInput): Promise<Result<PlacementProposal[]>>; // 提案のみ (永続化しない)
}

/** この Issue (#53) までで実装済みのメソッドのみに絞った戻り値型 (上記コメント参照) */
export type SchedulingFacadeCore = Pick<
  SchedulingFacadeExtended,
  | "generateBlocksFromLines"
  | "placeBlock"
  | "recordActual"
  | "getWeeklyCapacity"
  | "listWorkTypes"
  | "saveWorkType"
  | "deleteWorkType"
  | "listWorkTemplates"
  | "saveWorkTemplate"
  | "deleteWorkTemplate"
  | "createBlock"
  | "updateBlock"
  | "unscheduleBlock"
  | "transitionBlock"
  | "deleteBlock"
  | "cancelOpenBlocksForDeal"
  | "getCalendarRange"
  | "getBacklogBlocks"
  | "getDealWorkSummary"
  | "getExternalBusy"
  | "proposeBlockPlacement"
>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Zod の object-level refine (path.length === 0 の issue) が原因の失敗かどうかを判定する
 * (crm/facade.ts mergeCustomers の isCombo 判定と同型のパターン)。
 * zPlaceBlockInput / zWorkBlockInput の「開始<終了」refine 失敗はこの経路で KMB-E701 に
 * 昇格させ、それ以外のフィールド単位の Zod 検証失敗は KMB-E101 のままにする。
 */
function isRootRefineViolation(error: { issues: Array<{ path: PropertyKey[] }> }): boolean {
  return error.issues.some((i) => i.path.length === 0);
}

/** work_blocks 行 (JOIN 込み) → WorkBlockView (deal_title は attachDealTitles が後付けする) */
function toWorkBlockView(row: WorkBlockJoinRow): Omit<WorkBlockView, "deal_title"> {
  return {
    id: row.id,
    deal_id: row.deal_id,
    source_document_id: row.source_document_id,
    work_type_id: row.work_type_id,
    work_type_key: row.work_types?.key ?? "",
    work_type_label: row.work_types?.label ?? "",
    color: row.work_types?.color ?? "#000000",
    title: row.title,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    planned_hours: row.planned_hours,
    actual_hours: row.actual_hours,
    performed_on: row.performed_on,
    consumes_capacity: row.consumes_capacity,
    quantity: row.quantity,
    memo: row.memo,
    // #53 時点は calendar_event_links (migration 0030) が存在しないため常に空 (#54 が実データを繋ぐ)
    sync: [],
    updated_at: row.updated_at,
  };
}

/**
 * deal_id を持つブロック群に deal_title を合成する (getCalendarRange/getBacklogBlocks 共通)。
 * crmFacade.getDealRefs はバッチ呼び出し (N+1 回避 — sales/facade.ts:485 の前例と同型)。
 * 見つからない deal (削除済み等) は "(不明)" にフォールバックする (sales/facade.ts と同じ規約)。
 */
async function attachDealTitles(
  blocks: Array<Omit<WorkBlockView, "deal_title">>,
): Promise<Result<WorkBlockView[]>> {
  const dealIds = [...new Set(blocks.map((b) => b.deal_id).filter((id): id is string => id !== null))];
  const dealRefs = await crmFacade.getDealRefs(dealIds);
  if (!dealRefs.ok) return dealRefs;
  const titleMap = new Map(dealRefs.value.map((d) => [d.deal_id, d.title]));
  return {
    ok: true,
    value: blocks.map((b) => ({
      ...b,
      deal_title: b.deal_id !== null ? (titleMap.get(b.deal_id) ?? "(不明)") : null,
    })),
  };
}

export function createSchedulingFacade(): SchedulingFacadeCore {
  return {
    async generateBlocksFromLines(rawInput) {
      const parsed = zGenerateBlocksInput.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const [activeWorkTypes, activeWorkTemplates] = await Promise.all([
          listActiveWorkTypesForExpand(),
          listActiveWorkTemplatesForExpand(),
        ]);
        const { blocks, skipped } = expandLinesToBlocks(
          parsed.data.lines,
          activeWorkTypes,
          activeWorkTemplates,
        );
        if (blocks.length === 0) {
          // 全滅時のみ KMB-E704 (07-contracts-delta §7.7 / 03-scheduling §7.1)。
          // 部分成功 (blocks 非空 + skipped 非空) は成功として skipped を戻り値に同梱する。
          return {
            ok: false,
            code: "KMB-E704",
            detail: `明細 ${skipped.length} 件すべてを段取りに変換できませんでした`,
          };
        }
        const { user } = await getSessionAndClient();
        const blockIds = await insertWorkBlocks(
          parsed.data.deal_id,
          parsed.data.source_document_id,
          blocks,
          user?.id ?? null,
        );
        return { ok: true, value: { block_ids: blockIds, skipped } };
      } catch (err) {
        if (err instanceof ForeignKeyViolationError) {
          return { ok: false, code: "KMB-E702", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async placeBlock(blockId, startsAt, endsAt, expectedUpdatedAt) {
      const parsed = zPlaceBlockInput.safeParse({ starts_at: startsAt, ends_at: endsAt });
      if (!parsed.success) {
        return {
          ok: false,
          code: isRootRefineViolation(parsed.error) ? "KMB-E701" : "KMB-E101",
          detail: parsed.error.message,
        };
      }
      try {
        const current = await getWorkBlockById(blockId);
        if (!current) return { ok: false, code: "KMB-E109" };
        // 遷移可否 (§5.1) — canPlaceBlock は canTransitionBlock を流用しつつ in_progress の
        // 例外 (時刻変更は許可・状態は維持) を追加した専用判定 (internal/block-state.ts のコメント参照)
        if (!canPlaceBlock(current.status)) {
          return { ok: false, code: "KMB-E703", detail: "done / cancelled のブロックは配置できません" };
        }
        const newStatus = derivePlacementStatus(current.status);
        await updateWorkBlockPlacement(blockId, parsed.data.starts_at, parsed.data.ends_at, newStatus, expectedUpdatedAt);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async recordActual(blockId, rawInput, expectedUpdatedAt) {
      const parsed = zActualInput.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const current = await getWorkBlockById(blockId);
        if (!current) return { ok: false, code: "KMB-E109" };
        // 遷移ガード: scheduled/in_progress → done (初回) / done → done (訂正 — P12)。
        // backlog/cancelled への実績入力は KMB-E705 (§5.1)。
        if (!canTransitionBlock(current.status, "done")) {
          return {
            ok: false,
            code: "KMB-E705",
            detail: "未配置・キャンセル済みのブロックには実績を入力できません",
          };
        }
        const isFirstConfirmation = current.status !== "done"; // §7.3: 旧 status ≠ 'done' で初回確定判定
        await recordWorkBlockActual(
          blockId,
          parsed.data.actual_hours,
          parsed.data.performed_on,
          expectedUpdatedAt,
        );

        if (isFirstConfirmation && current.deal_id !== null) {
          const workTypeLabel = current.work_types?.label ?? "";
          const appended = await crmFacade.appendActivity({
            activity_type: "work_log",
            occurred_at: `${parsed.data.performed_on}T12:00:00+09:00`, // 実施日の正午 JST 固定 (決定的 — §7.3)
            title: `作業実績: ${workTypeLabel}`,
            body: null,
            payload: {
              work_block_id: blockId,
              work_type_key: current.work_types?.key ?? "",
              work_type_label: workTypeLabel,
              planned_hours: current.planned_hours,
              actual_hours: parsed.data.actual_hours,
              performed_on: parsed.data.performed_on,
            },
            ref_table: "work_blocks",
            ref_id: blockId,
            links: [{ customer_id: null, company_id: null, deal_id: current.deal_id }],
          });
          if (!appended.ok) {
            // KMB-E902 相当: 実績確定は既に成立しているため recordActual 自体は ok:true のまま返す。
            // 「エラー握り潰し禁止」に反しないよう console.error でログだけは必ず残す (§7.3)。
            console.error(
              `[scheduling] recordActual: work_log activity の追記に失敗しました (block=${blockId}): ${appended.code} ${appended.detail ?? ""}`,
            );
          }
        }
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getWeeklyCapacity(weekStart) {
      const parsedDate = zDateOnly.safeParse(weekStart);
      if (!parsedDate.success) {
        return { ok: false, code: "KMB-E101", detail: parsedDate.error.message };
      }
      if (!isJstMonday(parsedDate.data)) {
        return { ok: false, code: "KMB-E101", detail: "週の開始日は月曜日 (JST) を指定してください" };
      }

      let weeklyHours = 40; // P28: settings 取得失敗時の既定フォールバック (E101 にしない)
      const settingsResult = await settingsFacade.get("work_capacity");
      if (settingsResult.ok) {
        weeklyHours = settingsResult.value.weekly_hours;
      } else {
        console.warn(
          `[scheduling] getWeeklyCapacity: work_capacity 設定の取得に失敗したため既定値 (週 40 時間) にフォールバックします: ${settingsResult.code} ${settingsResult.detail ?? ""}`,
        );
      }

      try {
        const { startUtc, endUtc } = resolveWeekRangeJst(parsedDate.data);
        const booked = await getWeeklyBookedBlocks(startUtc, endUtc);
        const capacity = computeWeeklyCapacity(weeklyHours, booked);
        return { ok: true, value: { week_start: parsedDate.data, ...capacity } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async listWorkTypes(includeInactive) {
      try {
        const rows = await listWorkTypesRows(includeInactive ?? false);
        return { ok: true, value: rows };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async saveWorkType(rawInput, id, expectedUpdatedAt) {
      const parsed = zWorkTypeInput.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const saved = await upsertWorkType(parsed.data, id, expectedUpdatedAt);
        return { ok: true, value: { work_type_id: saved.id } };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        if (err instanceof UniqueViolationError) {
          return { ok: false, code: "KMB-E101", detail: "key が重複しています" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async deleteWorkType(id) {
      try {
        await deleteWorkTypeRow(id);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof ForeignKeyViolationError) {
          return { ok: false, code: "KMB-E702", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async listWorkTemplates(includeInactive) {
      try {
        const rows = await listWorkTemplatesRows(includeInactive ?? false);
        return { ok: true, value: rows };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async saveWorkTemplate(rawInput, id, expectedUpdatedAt) {
      const parsed = zWorkTemplateInput.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const saved = await upsertWorkTemplate(parsed.data, id, expectedUpdatedAt);
        return { ok: true, value: { template_id: saved.id } };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        if (err instanceof UniqueViolationError) {
          return {
            ok: false,
            code: "KMB-E101",
            detail: "同じ組み合わせ (グレード×サイズ) の有効なテンプレートが既に存在します",
          };
        }
        if (err instanceof ForeignKeyViolationError) {
          return { ok: false, code: "KMB-E702", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async deleteWorkTemplate(id) {
      try {
        await deleteWorkTemplateRow(id);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof ForeignKeyViolationError) {
          return { ok: false, code: "KMB-E702", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async createBlock(rawInput) {
      const parsed = zWorkBlockInput.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          code: isRootRefineViolation(parsed.error) ? "KMB-E701" : "KMB-E101",
          detail: parsed.error.message,
        };
      }
      try {
        const workType = await getWorkTypeSnapshot(parsed.data.work_type_id);
        if (!workType) {
          return { ok: false, code: "KMB-E702", detail: "work_type_id が見つかりません" };
        }
        // §5.1-6: 配置入力ありなら直接 'scheduled' で生成 (backlog 経由だと DB check に違反する)
        const status = deriveCreateStatus(parsed.data.starts_at !== null);
        const { user } = await getSessionAndClient();
        const created = await insertWorkBlock({
          deal_id: parsed.data.deal_id,
          work_type_id: parsed.data.work_type_id,
          title: parsed.data.title,
          status,
          starts_at: parsed.data.starts_at,
          ends_at: parsed.data.ends_at,
          planned_hours: parsed.data.planned_hours,
          consumes_capacity: workType.consumes_capacity,
          memo: parsed.data.memo,
          created_by: user?.id ?? null,
        });
        return { ok: true, value: { block_id: created.id } };
      } catch (err) {
        if (err instanceof ForeignKeyViolationError) {
          return { ok: false, code: "KMB-E702", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async updateBlock(blockId, rawInput, expectedUpdatedAt) {
      const parsed = zUpdateWorkBlockInput.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const current = await getWorkBlockById(blockId);
        if (!current) return { ok: false, code: "KMB-E109" };
        if (current.status === "done") {
          return { ok: false, code: "KMB-E703", detail: "実績確定済みのブロックは編集できません" };
        }
        await updateWorkBlockDetail(blockId, parsed.data, expectedUpdatedAt);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        if (err instanceof ForeignKeyViolationError) {
          return { ok: false, code: "KMB-E702", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async unscheduleBlock(blockId, expectedUpdatedAt) {
      try {
        const current = await getWorkBlockById(blockId);
        if (!current) return { ok: false, code: "KMB-E109" };
        if (!canTransitionBlock(current.status, "backlog")) {
          return { ok: false, code: "KMB-E703", detail: "配置済み (scheduled) のブロックのみ未配置に戻せます" };
        }
        await unscheduleWorkBlock(blockId, expectedUpdatedAt);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async transitionBlock(blockId, rawTo, expectedUpdatedAt) {
      const parsed = zBlockTransition.safeParse(rawTo);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const current = await getWorkBlockById(blockId);
        if (!current) return { ok: false, code: "KMB-E109" };
        if (!canTransitionBlock(current.status, parsed.data)) {
          return { ok: false, code: "KMB-E703", detail: "この状態からは遷移できません" };
        }
        await transitionWorkBlockStatus(blockId, parsed.data, expectedUpdatedAt);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async deleteBlock(blockId) {
      try {
        const current = await getWorkBlockById(blockId);
        if (!current) return { ok: false, code: "KMB-E109" };
        // hasUndeletedExternalLink は #53 時点では常に false (calendar_event_links 不在 — 地雷2)
        if (!assertDeletable(current.status, false)) {
          return { ok: false, code: "KMB-E703", detail: "backlog / cancelled のブロックのみ削除できます" };
        }
        await deleteWorkBlockRow(blockId);
        return { ok: true, value: undefined };
      } catch (err) {
        if (err instanceof DeleteGuardViolationError) {
          return { ok: false, code: "KMB-E703", detail: "他の変更と競合し、削除できませんでした" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async cancelOpenBlocksForDeal(dealId) {
      try {
        const cancelled = await cancelOpenWorkBlocksForDeal(dealId);
        return { ok: true, value: { cancelled } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getCalendarRange(rawQuery) {
      const parsed = zCalendarRangeQuery.safeParse(rawQuery);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const rows = await getWorkBlocksInRange(parsed.data.from, parsed.data.to);
        return await attachDealTitles(rows.map(toWorkBlockView));
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getBacklogBlocks(rawPagination) {
      const parsed = zPagination.safeParse(rawPagination);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const page = await getBacklogWorkBlocks(parsed.data);
        const viewsResult = await attachDealTitles(page.items.map(toWorkBlockView));
        if (!viewsResult.ok) return viewsResult;
        return { ok: true, value: { items: viewsResult.value, next_cursor: page.next_cursor } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getDealWorkSummary(dealId) {
      try {
        const rows = await getDealWorkBlocks(dealId);
        const views = rows.map(toWorkBlockView);
        const openStatuses = new Set(["backlog", "scheduled", "in_progress"]);
        const plannedTotal = views
          .filter((v) => v.status !== "cancelled")
          .reduce((sum, v) => sum + v.planned_hours, 0);
        const actualTotal = views
          .filter((v) => v.status === "done")
          .reduce((sum, v) => sum + (v.actual_hours ?? 0), 0);
        const doneCount = views.filter((v) => v.status === "done").length;
        const openCount = views.filter((v) => openStatuses.has(v.status)).length;
        return {
          ok: true,
          value: {
            deal_id: dealId,
            planned_total_hours: plannedTotal,
            actual_total_hours: actualTotal,
            done_count: doneCount,
            open_count: openCount,
            blocks: views.map((v) => ({
              id: v.id,
              work_type_label: v.work_type_label,
              status: v.status,
              planned_hours: v.planned_hours,
              actual_hours: v.actual_hours,
              performed_on: v.performed_on,
            })),
          },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getExternalBusy(rawQuery) {
      const parsed = zCalendarRangeQuery.safeParse(rawQuery);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      // calendar_connections (migration 0030) が存在しない #53 時点は常に未接続扱い。
      // 「未接続 = 空配列 (エラーにしない)」(§6.2) — #54 が実データを繋ぐ。
      return { ok: true, value: [] };
    },

    async proposeBlockPlacement(rawInput) {
      const parsed = zProposePlacementInput.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const rows = await getWorkBlocksByIds(parsed.data.block_ids);
        const rowById = new Map(rows.map((r) => [r.id, r]));
        const invalidIds = parsed.data.block_ids.filter((id) => {
          const row = rowById.get(id);
          return !row || row.status !== "backlog";
        });
        if (invalidIds.length > 0) {
          return {
            ok: false,
            code: "KMB-E702",
            detail: `backlog ではないか存在しないブロックが含まれています: ${invalidIds.join(", ")}`,
          };
        }

        // 入力順 (block_ids の並び) を提案順として保持する (§7.4 手順 5 — 依存グラフを持たない)
        const targets: AutoPlaceTarget[] = [];
        for (const id of parsed.data.block_ids) {
          const row = rowById.get(id);
          if (!row) continue; // 直前のチェックで到達しないが型を狭めるための防御
          targets.push({
            block_id: row.id,
            planned_hours: row.planned_hours,
            consumes_capacity: row.consumes_capacity,
            updated_at: row.updated_at,
          });
        }

        // 14 日探索窓 + 1 日分のバッファで既存拘束ブロックを取得 (auto-place.ts の日境界計算の
        // ズレを吸収する安全マージン)
        const windowToIso = new Date(
          new Date(parsed.data.from).getTime() + (AUTO_PLACE_MAX_LOOKAHEAD_DAYS + 1) * 24 * 60 * 60 * 1000,
        ).toISOString();
        const existingBooked = await getBookedBlocksForAutoPlaceWindow(parsed.data.from, windowToIso);

        const proposals = proposePlacements({
          targets,
          from: parsed.data.from,
          existingBookedBlocks: existingBooked,
          externalBusy: [], // #53 時点は getExternalBusy が常に [] を返すため固定
        });
        return { ok: true, value: proposals };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },
  };
}
