import "server-only";

import { getSessionAndClient } from "@/lib/supabase/session";
import type { ExecutionContext, Result } from "@/modules/platform/contracts";

import type {
  ActualInput,
  CalendarSyncReport,
  GenerateBlocksInput,
  WeeklyCapacity,
  WorkTemplateInput,
  WorkTemplateView,
  WorkTypeInput,
  WorkTypeRow,
} from "./contracts";
import { zGenerateBlocksInput, zWorkTemplateInput, zWorkTypeInput } from "./contracts";
import { expandLinesToBlocks } from "./internal/template-expand";
import {
  ForeignKeyViolationError,
  OptimisticLockError,
  UniqueViolationError,
  deleteWorkTemplate as deleteWorkTemplateRow,
  deleteWorkType as deleteWorkTypeRow,
  insertWorkBlocks,
  listActiveWorkTemplatesForExpand,
  listActiveWorkTypesForExpand,
  listWorkTemplates as listWorkTemplatesRows,
  listWorkTypes as listWorkTypesRows,
  upsertWorkTemplate,
  upsertWorkType,
} from "./repository";

/**
 * scheduling モジュールの公開 facade (03-scheduling.md §6)。
 *
 * `SchedulingFacade` (契約 6 メソッド = 07-contracts-delta §D8。シグネチャ変更禁止) と
 * `SchedulingFacadeExtended` (§6.2 契約外拡張。他モジュールから呼ぶこと禁止) を型として
 * フルセットで宣言する (crm/facade.ts の CrmFacade/CrmFacadeExtended 分割と同型)。
 *
 * ---- この Issue (#52) での実装範囲 ----
 * `createSchedulingFacade()` が実際に export するのは、契約メソッドのうち
 * `generateBlocksFromLines` の 1 つと、契約外拡張のうち作業種別/テンプレートの CRUD 6 つ
 * (listWorkTypes/saveWorkType/deleteWorkType/listWorkTemplates/saveWorkTemplate/
 * deleteWorkTemplate) のみ。残り 5 契約メソッド (placeBlock/recordActual/
 * getWeeklyCapacity/runCalendarSync/runCalendarMaintenance) は #53/#54 が実装する
 * ため、本ファイルでは型宣言のみに留め、戻り値型を `Pick<SchedulingFacadeExtended, ...>`
 * に絞ることで「未実装メソッドをスタブで誤魔化す」ことを構造的に防ぐ
 * (呼び出せば型検査の時点でエラーになる)。
 *
 * 実行文脈: 全メソッド session 固定 (admin セッション、`createSupabaseServerClient()` のみ)。
 * service 実行が必要なのは runCalendarSync/runCalendarMaintenance のみで #53/#54 の担当。
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
}

/** この Issue (#52) で実装済みのメソッドのみに絞った戻り値型 (上記コメント参照) */
export type SchedulingFacadeCore = Pick<
  SchedulingFacadeExtended,
  | "generateBlocksFromLines"
  | "listWorkTypes"
  | "saveWorkType"
  | "deleteWorkType"
  | "listWorkTemplates"
  | "saveWorkTemplate"
  | "deleteWorkTemplate"
>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  };
}
