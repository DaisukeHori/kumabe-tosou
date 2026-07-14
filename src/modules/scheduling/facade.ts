import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionAndClient } from "@/lib/supabase/session";
import { crmFacade } from "@/modules/crm/facade";
import type { ExecutionContext, Paged, Pagination, Result } from "@/modules/platform/contracts";
import { zDateOnly, zPagination } from "@/modules/platform/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import type {
  ActualInput,
  BlockTransition,
  BusyInterval,
  CalendarConnectionView,
  CalendarProvider,
  CalendarRangeQuery,
  CalendarSyncReport,
  DealWorkSummary,
  ExternalDeletionResolution,
  GenerateBlocksInput,
  OrphanedLinkResolution,
  PlacementProposal,
  ProposePlacementInput,
  SyncIssueItem,
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
  zCalendarConnectionMeta,
  zCalendarRangeQuery,
  zExternalDeletionResolution,
  zGenerateBlocksInput,
  zOrphanedLinkResolution,
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
import { computeWrittenHash } from "./internal/echo";
import { decodeGoogleIdTokenEmail, exchangeGoogleAuthorizationCode, googleCalendarAdapter } from "./internal/google-api";
import { MANUAL_SYNC_PULL_PAGES, MANUAL_SYNC_PUSH_LIMIT } from "./internal/lease";
import { exchangeMsAuthorizationCode, fetchMsAccountEmail, msCalendarAdapter } from "./internal/ms-api";
import { OAuthTokenError } from "./internal/provider";
import { resolveProviderEnv, runPull, runPush } from "./internal/sync-engine";
import {
  canReconcilePushUnknown,
  canResendConflictedLink,
  canResolveExternalDeletion,
  canResolveOrphanedLink,
} from "./internal/sync-state";
import { expandLinesToBlocks } from "./internal/template-expand";
import { forceRefreshCalendarSecret, getValidCalendarSecret, TokenClientMisconfiguredError, TokenExpiredError } from "./internal/token";
import { CALENDAR_VAULT_SECRET_NAMES, zCalendarVaultSecret, type CalendarVaultSecret } from "./internal/vault-names";
import {
  DeleteGuardViolationError,
  deleteCalendarEventLinksForProvider,
  ForeignKeyViolationError,
  getCalendarConnection,
  getCalendarEventLinkById,
  markLinkSynced,
  OptimisticLockError,
  resetLinkForRepush,
  resetLinkForResend,
  UniqueViolationError,
  cancelOpenWorkBlocksForDeal,
  deleteCalendarEventLink,
  deleteWorkBlockRow,
  deleteWorkTemplate as deleteWorkTemplateRow,
  deleteWorkType as deleteWorkTypeRow,
  getBacklogWorkBlocks,
  getBookedBlocksForAutoPlaceWindow,
  getDealWorkBlocks,
  getWeeklyBookedBlocks,
  getRecentDoneBlocksForWorkLogResend,
  getWorkBlockById,
  getWorkBlocksByIds,
  getWorkBlocksInRange,
  getWorkBlocksNeedingPushBackfill,
  getWorkTypeSnapshot,
  hasUndeletedExternalCalendarLink,
  insertWorkBlock,
  insertWorkBlocks,
  listActiveWorkTemplatesForExpand,
  listActiveWorkTypesForExpand,
  listCalendarConnections,
  listSyncIssueLinks,
  listWorkTemplates as listWorkTemplatesRows,
  listWorkTypes as listWorkTypesRows,
  markLinkPendingPush,
  recordWorkBlockActual,
  rollCalendarSyncWindow,
  transitionWorkBlockStatus,
  unscheduleWorkBlock,
  updateCalendarConnectionStatus,
  updateWorkBlockDetail,
  updateWorkBlockPlacement,
  upsertCalendarConnection,
  upsertPendingPushLink,
  upsertWorkTemplate,
  upsertWorkType,
  vaultDeleteSecret,
  vaultReadSecret,
  vaultUpsertSecret,
  type CalendarConnectionRow,
  type SyncIssueLinkRow,
  type WorkBlockJoinRow,
} from "./repository";

/**
 * scheduling モジュールの公開 facade (03-scheduling.md §6)。
 *
 * `SchedulingFacade` (契約 6 メソッド = 07-contracts-delta §D8。シグネチャ変更禁止) と
 * `SchedulingFacadeExtended` (§6.2 契約外拡張。他モジュールから呼ぶこと禁止) を型として
 * フルセットで宣言する (crm/facade.ts の CrmFacade/CrmFacadeExtended 分割と同型)。
 *
 * ---- この Issue (#54) での実装範囲 ----
 * #52/#53 が実装済みの分に加え、runCalendarSync/runCalendarMaintenance (契約メソッド) と、
 * 外部カレンダー接続管理系 8 メソッド (getCalendarConnections/disconnectCalendar/
 * listSyncIssues/resolveExternalDeletion/reconcilePushUnknown/resendConflictedLink/
 * resolveOrphanedLink/requestSyncNow) を実装する。加えて OAuth callback route (§8.2) が
 * ビジネスロジックを持たないよう `completeGoogleCalendarOAuthCallback` を契約外拡張として
 * 追加する (distribution/facade.ts の completeXOAuthCallback と同型パターン。canonical §6.2
 * の公開契約一覧には無いが、実装計画書「OAuth ルート」節が明示的に指示する内部メソッド)。
 * `toWorkBlockView` の `sync` フィールドも calendar_event_links の実 JOIN データを詰めるよう
 * repository.ts (WORK_BLOCK_JOIN_COLUMNS) と合わせて更新した。
 *
 * ---- #55 (Microsoft) での追加分 ----
 * SUPPORTED_CALENDAR_PROVIDERS/adapterForProvider に "microsoft" を追加し、
 * completeGoogleCalendarOAuthCallback と同型の `completeMsCalendarOAuthCallback` を追加した。
 * runCalendarSync/runCalendarMaintenance/requestSyncNow/reconcilePushUnknown 等の provider ループは
 * #54 の時点で provider 非依存に書かれていたため無改修で microsoft に対応する。
 *
 * 実行文脈: runCalendarSync/runCalendarMaintenance のみ service 専用 (ctx.mode!=='service' は
 * KMB-E202)。接続管理系 8 メソッド + completeGoogleCalendarOAuthCallback/completeMsCalendarOAuthCallback は session 固定
 * (admin セッション、`createSupabaseServerClient()` 相当) — ただし calendar_event_links への
 * 書込みは RLS で authenticated から拒否されるため、内部で `createSupabaseServiceClient()` を
 * 都度生成して書込みにのみ使う (実装計画書「未解決点2」の判断: 型レベルでの branded type 導入は
 * 過剰設計と判断し、関数シグネチャ (`serviceClient: SupabaseClient` 明示) + このコメントで
 * 防御する。誤って session client を渡すと RLS 拒否で即座に検出できる)。
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

  // -- 接続管理 / 同期運用 (#54, §6.2) --
  getCalendarConnections(): Promise<Result<CalendarConnectionView[]>>;
  disconnectCalendar(provider: CalendarProvider): Promise<Result<void>>;
  listSyncIssues(): Promise<Result<SyncIssueItem[]>>;
  resolveExternalDeletion(linkId: string, action: ExternalDeletionResolution): Promise<Result<void>>;
  reconcilePushUnknown(linkId: string): Promise<Result<{ resolved: boolean }>>;
  resendConflictedLink(linkId: string): Promise<Result<void>>;
  resolveOrphanedLink(linkId: string, action: OrphanedLinkResolution): Promise<Result<void>>;
  requestSyncNow(): Promise<Result<{ reports: CalendarSyncReport[]; skipped_running: boolean }>>;

  /** OAuth callback (§8.2) の内部委譲先。route はこれを呼ぶだけでビジネスロジックを持たない。 */
  completeGoogleCalendarOAuthCallback(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<Result<{ account_email: string }>>;

  /** completeGoogleCalendarOAuthCallback の Microsoft 版 (#55、同型パターン)。 */
  completeMsCalendarOAuthCallback(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<Result<{ account_email: string }>>;
}

/** この Issue (#54) までで実装済みのメソッドのみに絞った戻り値型 (上記コメント参照) */
export type SchedulingFacadeCore = Pick<
  SchedulingFacadeExtended,
  | "generateBlocksFromLines"
  | "placeBlock"
  | "recordActual"
  | "getWeeklyCapacity"
  | "runCalendarSync"
  | "runCalendarMaintenance"
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
  | "getCalendarConnections"
  | "disconnectCalendar"
  | "listSyncIssues"
  | "resolveExternalDeletion"
  | "reconcilePushUnknown"
  | "resendConflictedLink"
  | "resolveOrphanedLink"
  | "requestSyncNow"
  | "completeGoogleCalendarOAuthCallback"
  | "completeMsCalendarOAuthCallback"
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
    // calendar_event_links (migration 0030) の JOIN 結果をそのまま詰める (#54 で実データ化)。
    // link_id は #54 レビュー修正で追加 (block-detail-dialog.tsx の解決ダイアログが
    // resolveExternalDeletionAction(linkId, ...) を呼ぶために必要)。
    sync: (row.calendar_event_links ?? []).map((l) => ({
      link_id: l.id,
      provider: l.provider,
      sync_status: l.sync_status,
      last_error_code: l.last_error_code,
    })),
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
        // BLOCKER 修正 (§6.1): 接続済み provider の links を pending_push で upsert する。
        await markConnectedProvidersPendingPush(blockId);
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
        // BLOCKER 修正 (§6.2 createBlock「placeBlock と同処理」): 配置入力ありで直接 'scheduled'
        // 作成された場合のみ、接続済み provider の links を pending_push で upsert する。
        if (status === "scheduled") {
          await markConnectedProvidersPendingPush(created.id);
        }
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
        // BLOCKER 修正 (§6.2 unscheduleBlock「外部イベント削除は links を pending 削除マーク」):
        // starts_at が NULL 化された後なので、pushOneLink の isDeletionMark 判定 (§8.4) に乗る。
        await markConnectedProvidersPendingPush(blockId);
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
        // BLOCKER 修正 (§6.2 transitionBlock / §5.1 cancelled 行「外部イベント削除 + link 削除」):
        // 'cancelled' への遷移のみ pending_push (削除マーク) が必要。'in_progress' は配置内容
        // (時刻/タイトル) が変わらないため外部へ再送する必要がない (§8.4 は starts_at/status の
        // 組み合わせのみで削除マークを判定するため in_progress は現状維持のまま synced 継続)。
        // さらに current.starts_at !== null (= 配置済みだった。backlog→cancelled は starts_at が
        // 元々 NULL のため外部イベントが存在し得ない) で絞る — cancelOpenBlocksForDeal の
        // scheduledBlockIds と同じ判定基準 (無駄な pending_push→即削除の往復を避ける)。
        if (parsed.data === "cancelled" && current.starts_at !== null) {
          await markConnectedProvidersPendingPush(blockId);
        }
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
        // hasUndeletedExternalLink は #53 時点では calendar_event_links 不在のため常に false だったが
        // (地雷2)、#54 でテーブルが追加されたため実データで判定する (§5.1-5/§5.3-6 — cascade による
        // 外部イベント永久残置=ゴースト予定の防止)。session client で SELECT 可 (RLS admin 許可)。
        const { supabase } = await getSessionAndClient();
        const linkCheckResult = await hasUndeletedExternalCalendarLink(supabase, blockId);
        if (!linkCheckResult.ok) return linkCheckResult;
        if (!assertDeletable(current.status, linkCheckResult.value)) {
          return {
            ok: false,
            code: "KMB-E703",
            detail: linkCheckResult.value
              ? "外部カレンダーへの反映待ちです。同期が完了してから削除してください"
              : "backlog / cancelled のブロックのみ削除できます",
          };
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
        const result = await cancelOpenWorkBlocksForDeal(dealId);
        // BLOCKER 修正 (§6.2「scheduled だったブロックの links は削除マーク」): backlog 由来
        // (元々 starts_at NULL で外部イベントが存在し得ない) は対象外、scheduled 由来のみ upsert する。
        for (const blockId of result.scheduledBlockIds) {
          await markConnectedProvidersPendingPush(blockId);
        }
        return { ok: true, value: { cancelled: result.cancelled } };
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
      try {
        // Vault 読み取り (RPC) は service client 専用のため、SELECT だけでも service client を使う
        // (calendar_connections は admin セッションからも読めるが、この後の getValidCalendarSecret が
        // 必ず service client を要求するため、ここで先に生成して使い回す)。
        const serviceClient = createSupabaseServiceClient();

        // 【BLOCKER 修正】旧実装は provider="google" 決め打ちで、#55 で追加した msCalendarAdapter が
        // 一切呼ばれていなかった (P15「Google だけ/Microsoft だけ/両方接続」の後者2ケースで busy 帯が
        // 常に空になる実データ欠落)。runCalendarSync/requestSyncNow と同じ provider ループパターンを
        // 踏襲し、接続済み provider 全ての busy 帯をマージして返す。
        const busyIntervals: BusyInterval[] = [];
        for (const provider of SUPPORTED_CALENDAR_PROVIDERS) {
          const adapter = adapterForProvider(provider);
          if (!adapter) continue;

          const connectionResult = await getCalendarConnection(serviceClient, provider);
          if (!connectionResult.ok) return connectionResult;
          const connection = connectionResult.value;

          // 「未接続 = 空配列 (エラーにしない)」(§6.2)。'expired' のみ明示的に E720 を返す
          // (過去に接続済みで再連携が必要な状態を calendar 画面へ静かに伝える設計判断 — 実装計画書の
          // 未解決点欄には無いが §6.2 の注記「E720 は expired 時のみ」を素直に解釈した)。'disconnected'/
          // 'error' は当該 provider を skip するだけに倒す ('error' は connections 画面のバナーで既に
          // 案内済みのため、カレンダー表示自体は他 provider の busy 帯を含めて継続させる — 安全側・
          // 機能を壊さない判断)。'expired' はループを打ち切って即座に E720 を返す (元の単一 provider
          // 実装と同じ fail-fast — busy 帯を欠いたまま自動配置が二重予約するより、再連携が必要な
          // ことを明示的に呼び出し元へ伝える方が安全側)。
          if (!connection || connection.status === "disconnected" || connection.status === "error") {
            continue;
          }
          if (connection.status === "expired") {
            return { ok: false, code: "KMB-E720", detail: `カレンダーの再連携が必要です (${provider})` };
          }

          const metaResult = zCalendarConnectionMeta.safeParse(connection.meta);
          if (!metaResult.success) {
            // meta 不整合はこの provider だけ busy 帯なしで安全側に倒す (他 provider の収集は継続)
            continue;
          }

          let secret: CalendarVaultSecret;
          try {
            secret = await getValidCalendarSecret(serviceClient, provider, adapter, resolveProviderEnv(provider));
          } catch (err) {
            if (err instanceof TokenExpiredError) return { ok: false, code: "KMB-E720", detail: err.message };
            if (err instanceof TokenClientMisconfiguredError) return { ok: false, code: "KMB-E723", detail: err.message };
            throw err;
          }

          const busy = await adapter.getBusy({ start: parsed.data.from, end: parsed.data.to }, secret);
          busyIntervals.push(...busy.map((b) => ({ starts_at: b.start, ends_at: b.end })));
        }
        return { ok: true, value: busyIntervals };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
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
          // getExternalBusy は #54 で実データ化されたが、proposeBlockPlacement への配線
          // (外部 busy 帯を考慮した自動配置) は本 Issue のスコープ外のため [] のまま据え置く
          // (openIssues へ follow-up として報告)。
          externalBusy: [],
        });
        return { ok: true, value: proposals };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    // ============================================================
    // 接続管理 / 同期運用 (03-scheduling.md §6.2、#54)
    // ============================================================

    async runCalendarSync(ctx) {
      if (ctx.mode !== "service") {
        return { ok: false, code: "KMB-E202", detail: "runCalendarSync は service 実行専用です" };
      }
      let serviceClient: SupabaseClient;
      try {
        serviceClient = ctx.client ?? createSupabaseServiceClient();
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
      try {
        // この Issue (#54) では google のみ実装 (#55 が microsoft の adapter を追加した時点で
        // ここに provider を足すだけで済む — sync-engine.ts/token.ts は既に provider 抽象済み)。
        const reports: CalendarSyncReport[] = [];
        for (const provider of SUPPORTED_CALENDAR_PROVIDERS) {
          const adapter = adapterForProvider(provider);
          if (!adapter) continue; // #55 が microsoft の adapter を追加するまでは到達しない防御分岐
          const pushResult = await runPush(serviceClient, provider, adapter);
          const pullResult = await runPull(serviceClient, provider, adapter);
          reports.push({
            provider,
            pulled: pullResult.pulled,
            echoes_rejected: pullResult.echoes_rejected,
            pushed: pushResult.pushed,
            conflicts: pushResult.conflicts,
            full_resync: pullResult.full_resync,
          });
        }
        return { ok: true, value: reports };
      } catch (err) {
        // runPush/runPull は provider 単位の業務エラー (E720〜E725) を connection/link に記録し
        // 例外を投げない設計 (sync-engine.ts のコメント参照)。ここに到達する例外は DB 読み取り
        // 自体の失敗等のインフラ異常のみ (§6.1 表どおり Result エラーはインフラ異常のみ)。
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async runCalendarMaintenance(ctx) {
      if (ctx.mode !== "service") {
        return { ok: false, code: "KMB-E202", detail: "runCalendarMaintenance は service 実行専用です" };
      }
      let serviceClient: SupabaseClient;
      try {
        serviceClient = ctx.client ?? createSupabaseServiceClient();
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
      try {
        await runCalendarMaintenanceTasks(serviceClient);
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getCalendarConnections() {
      try {
        const { supabase } = await getSessionAndClient();
        const result = await listCalendarConnections(supabase);
        if (!result.ok) return result;
        return { ok: true, value: result.value.map(toCalendarConnectionView) };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async disconnectCalendar(provider) {
      try {
        const serviceClient = createSupabaseServiceClient();
        const statusResult = await updateCalendarConnectionStatus(serviceClient, provider, "disconnected", null, null);
        if (!statusResult.ok) return statusResult;

        // Vault 削除はベストエフォート (§6.2「Vault ベストエフォート削除」) — 失敗しても
        // disconnect 自体 (status='disconnected' + links 削除) は継続する。ログは必ず残す
        // (エラー握り潰し禁止 — Vault に secret が残留すること自体は再接続時に上書きされるため
        // 実害は小さいが、放置すると調査時に気づけなくなる)。
        const vaultResult = await vaultDeleteSecret(serviceClient, CALENDAR_VAULT_SECRET_NAMES[provider]);
        if (!vaultResult.ok) {
          console.error(
            `[scheduling] disconnectCalendar: Vault 削除に失敗しました (provider=${provider}): ${vaultResult.code} ${vaultResult.detail ?? ""}`,
          );
        }

        const deleteLinksResult = await deleteCalendarEventLinksForProvider(serviceClient, provider);
        if (!deleteLinksResult.ok) return deleteLinksResult;

        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async listSyncIssues() {
      try {
        const { supabase } = await getSessionAndClient();
        const result = await listSyncIssueLinks(supabase);
        if (!result.ok) return result;
        return { ok: true, value: result.value.map(toSyncIssueItem) };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async resolveExternalDeletion(linkId, rawAction) {
      const parsed = zExternalDeletionResolution.safeParse(rawAction);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const { supabase } = await getSessionAndClient();
        const linkResult = await getCalendarEventLinkById(supabase, linkId);
        if (!linkResult.ok) return linkResult;
        const link = linkResult.value;
        if (!link) return { ok: false, code: "KMB-E109" };
        if (!canResolveExternalDeletion(link)) {
          return { ok: false, code: "KMB-E703", detail: "この link は外部削除検知の状態ではありません" };
        }

        const serviceClient = createSupabaseServiceClient();

        if (parsed.data === "repush") {
          return await resetLinkForRepush(serviceClient, linkId);
        }

        // unschedule / cancel_block はブロック本体も動かす (§9.2 の 3 択の意味論)。
        const block = await getWorkBlockById(link.work_block_id);
        if (!block) return { ok: false, code: "KMB-E109" };

        try {
          if (parsed.data === "unschedule") {
            if (!canTransitionBlock(block.status, "backlog")) {
              return { ok: false, code: "KMB-E703", detail: "この状態では未配置に戻せません" };
            }
            await unscheduleWorkBlock(block.id, block.updated_at);
          } else {
            // 'cancel_block'
            if (!canTransitionBlock(block.status, "cancelled")) {
              return { ok: false, code: "KMB-E703", detail: "この状態ではキャンセルできません" };
            }
            await transitionWorkBlockStatus(block.id, "cancelled", block.updated_at);
          }
        } catch (err) {
          if (err instanceof OptimisticLockError) {
            return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
          }
          throw err;
        }

        return await deleteCalendarEventLink(serviceClient, linkId);
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async reconcilePushUnknown(linkId) {
      try {
        const { supabase } = await getSessionAndClient();
        const linkResult = await getCalendarEventLinkById(supabase, linkId);
        if (!linkResult.ok) return linkResult;
        const link = linkResult.value;
        if (!link) return { ok: false, code: "KMB-E109" };
        if (!canReconcilePushUnknown(link)) {
          return { ok: false, code: "KMB-E703", detail: "この link は結果不明 (KMB-E724) の状態ではありません" };
        }
        const adapter = adapterForProvider(link.provider);
        if (!adapter) {
          return { ok: false, code: "KMB-E901", detail: `未対応の provider です: ${link.provider}` };
        }

        const serviceClient = createSupabaseServiceClient();
        const connectionResult = await getCalendarConnection(serviceClient, link.provider);
        if (!connectionResult.ok) return connectionResult;
        const connection = connectionResult.value;
        if (!connection || connection.status !== "connected") {
          return { ok: false, code: "KMB-E703", detail: "カレンダーが接続されていません" };
        }
        const metaResult = zCalendarConnectionMeta.safeParse(connection.meta);
        if (!metaResult.success || !metaResult.data.app_calendar_id) {
          return { ok: false, code: "KMB-E901", detail: "アプリ専用カレンダーの設定が不整合です" };
        }
        const appCalendarId = metaResult.data.app_calendar_id;

        let secret: CalendarVaultSecret;
        try {
          secret = await getValidCalendarSecret(serviceClient, link.provider, adapter, resolveProviderEnv(link.provider));
        } catch (err) {
          if (err instanceof TokenExpiredError) return { ok: false, code: "KMB-E720", detail: err.message };
          if (err instanceof TokenClientMisconfiguredError) return { ok: false, code: "KMB-E723", detail: err.message };
          throw err;
        }

        let found;
        try {
          found = await adapter.findByLinkId(appCalendarId, linkId, secret);
        } catch (err) {
          // 照合そのものが失敗 (API 到達不能等) → conflict+E724 のまま据え置き、エラーとして報告する
          // (§8.7「照合失敗はE723/E724を返しconflict継続」— link の状態は一切変更しない)。
          return { ok: false, code: "KMB-E724", detail: errMessage(err) };
        }

        if (!found) {
          // 未発見 → pending_push に戻して再送 (§8.7)
          const result = await markLinkPendingPush(serviceClient, linkId);
          if (!result.ok) return result;
          return { ok: true, value: { resolved: false } };
        }

        // 発見 → 外部 id/etag を採用して synced 化。hash は現在のブロック内容から再計算する
        // (finalizePushSuccess (sync-engine.ts) と同じ正規化関数 computeWrittenHash を使う —
        // 別の正規化を使うと以後のエコー判定が壊れる)。
        const block = await getWorkBlockById(link.work_block_id);
        if (!block || block.starts_at === null || block.ends_at === null) {
          // ブロックが見つからない/未配置化されている (競合) → 安全側で pending_push に戻す
          const result = await markLinkPendingPush(serviceClient, linkId);
          if (!result.ok) return result;
          return { ok: true, value: { resolved: false } };
        }
        const title = block.title ?? block.work_types?.label ?? "";
        const hash = computeWrittenHash({ startsAt: block.starts_at, endsAt: block.ends_at, title });
        const markResult = await markLinkSynced(serviceClient, linkId, {
          external_event_id: found.externalEventId,
          etag_or_change_key: found.etagOrChangeKey,
          external_updated_at: found.externalUpdatedAt,
          external_ical_uid: found.icalUid,
          last_written_hash: hash,
        });
        if (!markResult.ok) return markResult;
        return { ok: true, value: { resolved: true } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async resendConflictedLink(linkId) {
      try {
        const { supabase } = await getSessionAndClient();
        const linkResult = await getCalendarEventLinkById(supabase, linkId);
        if (!linkResult.ok) return linkResult;
        const link = linkResult.value;
        if (!link) return { ok: false, code: "KMB-E109" };
        if (!canResendConflictedLink(link)) {
          return { ok: false, code: "KMB-E703", detail: "この link は確定エラー (KMB-E723) の状態ではありません" };
        }
        const serviceClient = createSupabaseServiceClient();
        return await resetLinkForResend(serviceClient, linkId);
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async resolveOrphanedLink(linkId, rawAction) {
      const parsed = zOrphanedLinkResolution.safeParse(rawAction);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      try {
        const { supabase } = await getSessionAndClient();
        const linkResult = await getCalendarEventLinkById(supabase, linkId);
        if (!linkResult.ok) return linkResult;
        const link = linkResult.value;
        if (!link) return { ok: false, code: "KMB-E109" };
        if (!canResolveOrphanedLink(link)) {
          return { ok: false, code: "KMB-E703", detail: "この link は orphaned の状態ではありません" };
        }
        const serviceClient = createSupabaseServiceClient();
        if (parsed.data === "repush") {
          return await resetLinkForRepush(serviceClient, linkId);
        }
        return await deleteCalendarEventLink(serviceClient, linkId);
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async requestSyncNow() {
      try {
        const serviceClient = createSupabaseServiceClient();
        const reports: CalendarSyncReport[] = [];
        let skippedRunning = false;
        for (const provider of SUPPORTED_CALENDAR_PROVIDERS) {
          const adapter = adapterForProvider(provider);
          if (!adapter) continue;
          const pushResult = await runPush(serviceClient, provider, adapter, { limit: MANUAL_SYNC_PUSH_LIMIT });
          const pullResult = await runPull(serviceClient, provider, adapter, { maxPages: MANUAL_SYNC_PULL_PAGES });
          if (pullResult.skipped_running) skippedRunning = true;
          reports.push({
            provider,
            pulled: pullResult.pulled,
            echoes_rejected: pullResult.echoes_rejected,
            pushed: pushResult.pushed,
            conflicts: pushResult.conflicts,
            full_resync: pullResult.full_resync,
          });
        }
        return { ok: true, value: { reports, skipped_running: skippedRunning } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async completeGoogleCalendarOAuthCallback(input) {
      const env = getEnv();
      if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
        return { ok: false, code: "KMB-E901", detail: "GOOGLE_CALENDAR_CLIENT_ID/SECRET が未設定です" };
      }
      try {
        const tokenResult = await exchangeGoogleAuthorizationCode({
          clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
          clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirectUri: input.redirectUri,
        });
        if (!tokenResult.refreshToken) {
          return {
            ok: false,
            code: "KMB-E720",
            detail: "refresh_token が発行されませんでした (access_type=offline / prompt=consent を確認してください)",
          };
        }
        const accountEmail = tokenResult.idToken ? decodeGoogleIdTokenEmail(tokenResult.idToken) : null;
        if (!accountEmail) {
          return { ok: false, code: "KMB-E720", detail: "id_token から account_email を取得できませんでした" };
        }

        const serviceClient = createSupabaseServiceClient();
        const secret: CalendarVaultSecret = {
          access_token: tokenResult.accessToken,
          refresh_token: tokenResult.refreshToken,
          expires_at: tokenResult.expiresAt,
        };

        // 既存の app_calendar_id を引き継ぐ (再接続時は calendars.get で実在検証のみ — §5.2/§8.2)
        const existingConnectionResult = await getCalendarConnection(serviceClient, "google");
        if (!existingConnectionResult.ok) return existingConnectionResult;
        const existingMetaResult = existingConnectionResult.value
          ? zCalendarConnectionMeta.safeParse(existingConnectionResult.value.meta)
          : null;
        const knownCalendarId = existingMetaResult?.success ? existingMetaResult.data.app_calendar_id : null;

        let appCalendarId: string;
        try {
          appCalendarId = await googleCalendarAdapter.ensureAppCalendar(secret, knownCalendarId);
        } catch (err) {
          return { ok: false, code: "KMB-E901", detail: `アプリ専用カレンダーの準備に失敗しました: ${errMessage(err)}` };
        }

        const metaCandidate = {
          account_email: accountEmail,
          app_calendar_id: appCalendarId,
          token_expires_at: tokenResult.expiresAt,
          sync_window_start: null,
          sync_window_end: null,
        };
        const metaParsed = zCalendarConnectionMeta.safeParse(metaCandidate);
        if (!metaParsed.success) {
          return { ok: false, code: "KMB-E101", detail: metaParsed.error.message };
        }

        const vaultResult = await vaultUpsertSecret(serviceClient, CALENDAR_VAULT_SECRET_NAMES.google, JSON.stringify(secret));
        if (!vaultResult.ok) return vaultResult;

        const upsertResult = await upsertCalendarConnection(serviceClient, {
          provider: "google",
          status: "connected",
          vault_secret_name: CALENDAR_VAULT_SECRET_NAMES.google,
          meta: metaParsed.data,
        });
        if (!upsertResult.ok) return upsertResult;

        return { ok: true, value: { account_email: accountEmail } };
      } catch (err) {
        if (err instanceof OAuthTokenError) {
          return { ok: false, code: "KMB-E720", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async completeMsCalendarOAuthCallback(input) {
      // completeGoogleCalendarOAuthCallback (#54) と同型パターン。差分:
      //  - account_email は id_token デコードではなく GET /me (fetchMsAccountEmail) を叩く (§8.2 手順3)
      //  - meta.sync_window_start/end を今日−30日〜+180日で初期化する (§8.2「Microsoft は同型」注記。
      //    Graph delta の calendarView は時間窓必須 — sync-engine.ts の resolveSyncWindow が読む)
      const env = getEnv();
      if (!env.MS_CALENDAR_CLIENT_ID || !env.MS_CALENDAR_CLIENT_SECRET) {
        return { ok: false, code: "KMB-E901", detail: "MS_CALENDAR_CLIENT_ID/SECRET が未設定です" };
      }
      try {
        const tokenResult = await exchangeMsAuthorizationCode({
          clientId: env.MS_CALENDAR_CLIENT_ID,
          clientSecret: env.MS_CALENDAR_CLIENT_SECRET,
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirectUri: input.redirectUri,
        });
        if (!tokenResult.refreshToken) {
          return {
            ok: false,
            code: "KMB-E720",
            detail: "refresh_token が発行されませんでした (offline_access スコープを確認してください)",
          };
        }
        const accountEmail = await fetchMsAccountEmail(tokenResult.accessToken);
        if (!accountEmail) {
          return { ok: false, code: "KMB-E720", detail: "GET /me から account_email (mail/userPrincipalName) を取得できませんでした" };
        }

        const serviceClient = createSupabaseServiceClient();
        const secret: CalendarVaultSecret = {
          access_token: tokenResult.accessToken,
          refresh_token: tokenResult.refreshToken,
          expires_at: tokenResult.expiresAt,
        };

        // 既存の app_calendar_id を引き継ぐ (再接続時は calendars.get で実在検証のみ — §5.2/§8.2)
        const existingConnectionResult = await getCalendarConnection(serviceClient, "microsoft");
        if (!existingConnectionResult.ok) return existingConnectionResult;
        const existingMetaResult = existingConnectionResult.value
          ? zCalendarConnectionMeta.safeParse(existingConnectionResult.value.meta)
          : null;
        const knownCalendarId = existingMetaResult?.success ? existingMetaResult.data.app_calendar_id : null;

        let appCalendarId: string;
        try {
          appCalendarId = await msCalendarAdapter.ensureAppCalendar(secret, knownCalendarId);
        } catch (err) {
          return { ok: false, code: "KMB-E901", detail: `アプリ専用カレンダーの準備に失敗しました: ${errMessage(err)}` };
        }

        // Graph delta (calendarView/delta) の時間窓初期化 (§8.2「今日−30日〜+180日」)。
        // UTC 日境界での概算 (JST とのずれは最大1日分の安全側余裕になるだけ — runCalendarMaintenance
        // の work_log 再送と同じ既存規約を踏襲)。
        const nowMs = Date.now();
        const syncWindowStart = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const syncWindowEnd = new Date(nowMs + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const metaCandidate = {
          account_email: accountEmail,
          app_calendar_id: appCalendarId,
          token_expires_at: tokenResult.expiresAt,
          sync_window_start: syncWindowStart,
          sync_window_end: syncWindowEnd,
        };
        const metaParsed = zCalendarConnectionMeta.safeParse(metaCandidate);
        if (!metaParsed.success) {
          return { ok: false, code: "KMB-E101", detail: metaParsed.error.message };
        }

        const vaultResult = await vaultUpsertSecret(serviceClient, CALENDAR_VAULT_SECRET_NAMES.microsoft, JSON.stringify(secret));
        if (!vaultResult.ok) return vaultResult;

        const upsertResult = await upsertCalendarConnection(serviceClient, {
          provider: "microsoft",
          status: "connected",
          vault_secret_name: CALENDAR_VAULT_SECRET_NAMES.microsoft,
          meta: metaParsed.data,
        });
        if (!upsertResult.ok) return upsertResult;

        return { ok: true, value: { account_email: accountEmail } };
      } catch (err) {
        if (err instanceof OAuthTokenError) {
          return { ok: false, code: "KMB-E720", detail: err.message };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },
  };
}

/** 接続 (push/pull) を実装している provider の集合 (#54: google / #55: microsoft)。 */
const SUPPORTED_CALENDAR_PROVIDERS: readonly CalendarProvider[] = ["google", "microsoft"];

/** reconcilePushUnknown 等が provider ごとの adapter を解決する。 */
function adapterForProvider(provider: CalendarProvider) {
  if (provider === "google") return googleCalendarAdapter;
  if (provider === "microsoft") return msCalendarAdapter;
  return null;
}

/**
 * 接続済み provider の calendar_event_links を pending_push で upsert する共通ヘルパー
 * (§6.1 placeBlock 「接続済み provider の links を pending_push で upsert (service client。
 * 未設定時は skip + warn)」/ §6.2 createBlock「placeBlock と同処理」/ unscheduleBlock
 * 「外部イベント削除は links を pending 削除マーク」/ cancelOpenBlocksForDeal「scheduled だった
 * ブロックの links は削除マーク」の共通実装。BLOCKER 修正: #54 の初期実装はこの upsert が
 * どの facade メソッドからも呼ばれておらず、日次 runCalendarMaintenance の push 漏れ自己修復
 * (§8.8) 頼みになっていた (C5/C6 の「5分以内反映」要件を満たさない) ため、呼び出し元 5 箇所
 * (placeBlock/createBlock/unscheduleBlock/transitionBlock('cancelled')/cancelOpenBlocksForDeal)
 * に配線した。
 *
 * ベストエフォート: 呼び出し元の DB 操作 (配置/解除/遷移本体) は既にこの関数の呼び出し前に
 * 成功しているため、ここでの失敗は Result に反映せず console.warn のみに留める
 * (canonical 「未設定時は skip + warn」を service client 生成失敗以外の失敗にも適用した —
 * カレンダー同期の不調で本来成功すべき配置/解除操作まで失敗扱いにしないための安全側判断)。
 * ログは必ず残すため無言の握り潰しではない。取りこぼしは日次 runCalendarMaintenance
 * (§8.8 検査4: push 漏れ自己修復) が回収する。
 */
async function markConnectedProvidersPendingPush(blockId: string): Promise<void> {
  let serviceClient: SupabaseClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (err) {
    console.warn(
      `[scheduling] markConnectedProvidersPendingPush: service client 生成に失敗しました (block=${blockId}): ${errMessage(err)}`,
    );
    return;
  }
  for (const provider of SUPPORTED_CALENDAR_PROVIDERS) {
    const connectionResult = await getCalendarConnection(serviceClient, provider);
    if (!connectionResult.ok) {
      console.warn(
        `[scheduling] markConnectedProvidersPendingPush: connection 読み取りに失敗しました (block=${blockId}, provider=${provider}): ${connectionResult.code} ${connectionResult.detail ?? ""}`,
      );
      continue;
    }
    if (!connectionResult.value || connectionResult.value.status !== "connected") continue; // 未接続は正常系 (warn 不要)
    const upsertResult = await upsertPendingPushLink(serviceClient, blockId, provider);
    if (!upsertResult.ok) {
      console.warn(
        `[scheduling] markConnectedProvidersPendingPush: pending_push upsert に失敗しました (block=${blockId}, provider=${provider}): ${upsertResult.code} ${upsertResult.detail ?? ""}`,
      );
    }
  }
}

function toCalendarConnectionView(row: CalendarConnectionRow): CalendarConnectionView {
  const metaResult = zCalendarConnectionMeta.safeParse(row.meta);
  const meta = metaResult.success ? metaResult.data : null;
  if (!metaResult.success && row.status !== "disconnected") {
    // 接続中/エラー中のはずの行の meta が契約と不一致 = データ不整合の兆候。ログだけ残し
    // (エラー握り潰し禁止)、画面は null フィールドで安全側に degrade する (一覧取得自体は失敗させない)。
    console.error(`[scheduling] toCalendarConnectionView: meta が zCalendarConnectionMeta と不一致です (provider=${row.provider})`);
  }
  return {
    provider: row.provider,
    status: row.status,
    account_email: meta?.account_email ?? null,
    app_calendar_id: meta?.app_calendar_id ?? null,
    token_expires_at: meta?.token_expires_at ?? null,
    last_pulled_at: row.last_pulled_at,
    last_error_code: row.last_error_code,
    connected_at: row.connected_at,
  };
}

function toSyncIssueItem(row: SyncIssueLinkRow): SyncIssueItem {
  return {
    link_id: row.id,
    provider: row.provider,
    sync_status: row.sync_status,
    last_error_code: row.last_error_code,
    block: {
      id: row.block_id,
      title: row.block_title,
      work_type_label: row.block_work_type_label,
      starts_at: row.block_starts_at,
      ends_at: row.block_ends_at,
      status: row.block_status,
    },
    deleted_externally_at: row.deleted_externally_at,
  };
}

/**
 * runCalendarMaintenance (§8.8) の 5 項目。runCalendarSync とは異なり単一の Result を返さず
 * 個々のチェックが失敗しても残りのチェックを継続する (1 つの検査の失敗で他の自己修復が止まると
 * 被害が拡大するため — 各チェックは自身のエラーを console.error に残し、呼び出し元
 * (facade.runCalendarMaintenance) の catch には基本的に到達しない設計)。
 */
async function runCalendarMaintenanceTasks(serviceClient: SupabaseClient): Promise<void> {
  for (const provider of SUPPORTED_CALENDAR_PROVIDERS) {
    const adapter = adapterForProvider(provider);
    if (!adapter) continue;

    const connectionResult = await getCalendarConnection(serviceClient, provider);
    if (!connectionResult.ok) {
      console.error(`[scheduling] runCalendarMaintenance: connection 読み取りに失敗しました (provider=${provider}): ${connectionResult.code} ${connectionResult.detail ?? ""}`);
      continue;
    }
    const connection = connectionResult.value;
    if (!connection || connection.status !== "connected") continue;

    const metaResult = zCalendarConnectionMeta.safeParse(connection.meta);
    if (!metaResult.success || !metaResult.data.app_calendar_id) continue;
    const appCalendarId = metaResult.data.app_calendar_id;

    const env = resolveProviderEnv(provider);

    // 1. トークン健全性: 期限 24h 以内のもののみ refresh を実行する (getValidCalendarSecret の
    //    5 分マージンでは日次 maintenance の間隔 (24h) をカバーできないため、ここだけ広めの
    //    マージンで強制チェックする — §8.8)。invalid_grant/invalid_client による失効は
    //    forceRefreshCalendarSecret (token.ts) が既に connection.status を更新済みなので
    //    二重処理せず、この provider の残りの検査 (3/4) をスキップして次 provider へ進む。
    let tokenHealthy = true;
    try {
      const vaultResult = await vaultReadSecret(serviceClient, CALENDAR_VAULT_SECRET_NAMES[provider]);
      if (vaultResult.ok && vaultResult.value) {
        const parsedSecret = zCalendarVaultSecret.safeParse(JSON.parse(vaultResult.value));
        if (parsedSecret.success && new Date(parsedSecret.data.expires_at).getTime() - Date.now() < 24 * 60 * 60 * 1000) {
          await forceRefreshCalendarSecret(serviceClient, provider, adapter, env);
        }
      }
    } catch (err) {
      if (err instanceof TokenExpiredError || err instanceof TokenClientMisconfiguredError) {
        tokenHealthy = false;
      } else {
        console.error(`[scheduling] runCalendarMaintenance: トークン健全性チェックに失敗しました (provider=${provider}): ${errMessage(err)}`);
      }
    }
    if (!tokenHealthy) continue;

    // 2. Graph ローリングウィンドウ切り直し (§8.8)。Google は窓を使わない (resolveSyncWindow が
    //    provider==="microsoft" のみ) ため microsoft 限定で処理する。
    //    条件: `sync_window_end − 今日 < 90日` (窓の経年劣化) または `last_error_code==='KMB-E725'`
    //    (安全弁発動の復旧 — §8.5)。旧実装はこの節がコメントのみの no-op で、E725 発火後に
    //    last_error_code をクリアする経路が一切無く (updateCalendarConnectionAfterPull は
    //    lastError===null のとき当該フィールドに触れない)、Microsoft 同期が事実上恒久停止する
    //    MAJOR バグだった。sync_token=null (deltaLink 破棄) は 410=KMB-E722 と同じ「次回 runPull で
    //    fullResyncTriggered」経路に自然に乗せるだけで、ここでフル再同期そのものを実行する必要は
    //    無い (§8.5 runPullLoop の既存分岐を再利用)。
    if (provider === "microsoft") {
      try {
        const syncWindowEnd = metaResult.data.sync_window_end;
        const daysUntilWindowEnd = syncWindowEnd
          ? (new Date(`${syncWindowEnd}T00:00:00Z`).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
          : Number.NEGATIVE_INFINITY; // 窓未初期化 (異常系) は即座に切り直し対象として扱う (安全側)
        const safetyValveTriggered = connection.last_error_code === "KMB-E725";
        if (daysUntilWindowEnd < 90 || safetyValveTriggered) {
          const nowMs = Date.now();
          const newMeta = {
            ...metaResult.data,
            sync_window_start: new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            sync_window_end: new Date(nowMs + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          };
          // クリアは E725 (安全弁) が発火理由のときのみ (§8.8「完了時にE725をクリア」)。実際のフル
          // 再同期の完了を待たずここでクリアするが、sync_token=null により次回 runPull が確実に
          // フル再同期へ入るため「クリアしたのに直らない」放置にはならない — その再同期が再び
          // 安全弁を踏めば runPullLoop が last_error_code='KMB-E725' を新たに書き戻すため、
          // 握り潰しにはならない (安全側)。
          const rollResult = await rollCalendarSyncWindow(serviceClient, provider, {
            meta: newMeta,
            clearSafetyValveError: safetyValveTriggered,
          });
          if (!rollResult.ok) {
            console.error(`[scheduling] runCalendarMaintenance: Graph ローリングウィンドウ切り直しに失敗しました (provider=${provider}): ${rollResult.code} ${rollResult.detail ?? ""}`);
          }
        }
      } catch (err) {
        // 他タスク (1/3/4) と同じ流儀: このチェックの失敗で残りのタスクを止めない (§8.8)。
        console.error(`[scheduling] runCalendarMaintenance: Graph ローリングウィンドウ切り直しに失敗しました (provider=${provider}): ${errMessage(err)}`);
      }
    }

    // 3. アプリ専用カレンダー実在確認 (P20)
    try {
      const secret = await getValidCalendarSecret(serviceClient, provider, adapter, env);
      const exists = await adapter.calendarExists(appCalendarId, secret);
      if (!exists) {
        const updateResult = await updateCalendarConnectionStatus(
          serviceClient,
          provider,
          "error",
          "KMB-E723",
          "アプリ専用カレンダーが見つかりません",
        );
        if (!updateResult.ok) {
          console.error(`[scheduling] runCalendarMaintenance: connection error 更新に失敗しました (provider=${provider}): ${updateResult.code} ${updateResult.detail ?? ""}`);
        }
        continue; // カレンダー消失時はこの provider の push 漏れ自己修復も意味が無いためスキップ
      }
    } catch (err) {
      if (!(err instanceof TokenExpiredError) && !(err instanceof TokenClientMisconfiguredError)) {
        console.error(`[scheduling] runCalendarMaintenance: カレンダー実在確認に失敗しました (provider=${provider}): ${errMessage(err)}`);
      }
      continue;
    }

    // 4. push 漏れ自己修復
    try {
      const backfillResult = await getWorkBlocksNeedingPushBackfill(serviceClient, provider);
      if (!backfillResult.ok) {
        console.error(`[scheduling] runCalendarMaintenance: push 漏れ対象の取得に失敗しました (provider=${provider}): ${backfillResult.code} ${backfillResult.detail ?? ""}`);
      } else {
        for (const blockId of backfillResult.value) {
          const upsertResult = await upsertPendingPushLink(serviceClient, blockId, provider);
          if (!upsertResult.ok) {
            console.error(`[scheduling] runCalendarMaintenance: push 漏れ自己修復の upsert に失敗しました (block=${blockId}, provider=${provider}): ${upsertResult.code} ${upsertResult.detail ?? ""}`);
          }
        }
      }
    } catch (err) {
      console.error(`[scheduling] runCalendarMaintenance: push 漏れ自己修復に失敗しました (provider=${provider}): ${errMessage(err)}`);
    }
  }

  // 5. work_log 再送 (§8.8)。MAJOR 修正: canonical §8.8 表で「Phase 5」マーカーが付くのは
  //    「滞留警告」のみであり、「work_log 再送」には無い (v1 必須の自己修復)。旧実装は誤って
  //    両方を Phase 5 扱いにして丸ごとスキップしていた。recordActual (facade.ts) の
  //    appendActivity 呼び出しはベストエフォート (§7.3 — 失敗しても実績確定自体は成立させる) の
  //    ため、直近 7 日分の done ブロックへ同じ冪等キー ((work_log, work_blocks, blockId)) で
  //    再送して自己修復する。provider ループの外 (google 接続の有無に関係ない自己修復) なので
  //    for ループの後段に置く。
  try {
    // UTC 日境界で計算する (JST とのずれは最大 1 日分の safe-side の余裕になるだけで、
    // 「直近7日」の趣旨である取りこぼし回収を損なわない)。
    const sinceDateOnly = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const blocks = await getRecentDoneBlocksForWorkLogResend(serviceClient, sinceDateOnly);
    for (const block of blocks) {
      // クエリ条件 (status='done' + deal_id 非NULL) から deal_id/performed_on/actual_hours は
      // 非NULL のはずだが (DB check work_blocks_done_complete)、型を狭めるための防御。
      if (block.deal_id === null || block.actual_hours === null || block.performed_on === null) continue;
      const workTypeLabel = block.work_types?.label ?? "";
      const appended = await crmFacade.appendActivity(
        {
          activity_type: "work_log",
          occurred_at: `${block.performed_on}T12:00:00+09:00`, // recordActual と同一の決定的値 (§7.3)
          title: `作業実績: ${workTypeLabel}`,
          body: null,
          payload: {
            work_block_id: block.id,
            work_type_key: block.work_types?.key ?? "",
            work_type_label: workTypeLabel,
            planned_hours: block.planned_hours,
            actual_hours: block.actual_hours,
            performed_on: block.performed_on,
          },
          ref_table: "work_blocks",
          ref_id: block.id,
          links: [{ customer_id: null, company_id: null, deal_id: block.deal_id }],
        },
        { mode: "service", client: serviceClient },
      );
      if (!appended.ok) {
        console.error(
          `[scheduling] runCalendarMaintenance: work_log 再送に失敗しました (block=${block.id}): ${appended.code} ${appended.detail ?? ""}`,
        );
      }
    }
  } catch (err) {
    console.error(`[scheduling] runCalendarMaintenance: work_log 再送タスクに失敗しました: ${errMessage(err)}`);
  }

  // 6. 滞留警告 (Phase 5 ダッシュボード統合待ち) はこの Issue のスコープ外 (§8.8 表に
  //    「Phase 5」と明記されている唯一の項目 — openIssues 報告)。
}
