"use server";

import { revalidatePath } from "next/cache";

import { crmFacade } from "@/modules/crm/facade";
import type { DealListItem } from "@/modules/crm/contracts";
import type { Paged, Pagination, Result } from "@/modules/platform/contracts";
import { zPagination } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";
import {
  zActualInput,
  zBlockTransition,
  zCalendarProvider,
  zCalendarRangeQuery,
  zExternalDeletionResolution,
  zOrphanedLinkResolution,
  zProposePlacementInput,
  zUpdateWorkBlockInput,
  zWorkBlockInput,
  zWorkTemplateInput,
  zWorkTypeInput,
  type ActualInput,
  type BlockTransition,
  type CalendarProvider,
  type CalendarRangeQuery,
  type CalendarSyncReport,
  type ExternalDeletionResolution,
  type OrphanedLinkResolution,
  type PlacementProposal,
  type ProposePlacementInput,
  type UpdateWorkBlockInput,
  type WeeklyCapacity,
  type WorkBlockInput,
  type WorkBlockView,
  type WorkTemplateInput,
  type WorkTypeInput,
} from "@/modules/scheduling/contracts";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

/**
 * /admin/calendar 系の Server Actions (03-scheduling.md §9.2)。
 * 全 Action の先頭で requireAdmin() + Zod parse を必須とする (契約書 §3.5 / 既存規約)。
 * calendar_connections/calendar_event_links 前提の Action (disconnectCalendarAction 等) は
 * #54 (migration 0030) で追加する。
 *
 * 【計画書からの逸脱を踏襲】計画書 (#53/#54 いずれも) は「actions.ts は export const
 * maxDuration = 60 を明示」と指示しているが、#53 が実測 (`npm run build`) で Next.js 15 が
 * 「"use server" ファイルは async 関数以外を export できない」でビルドを拒否することを確認済み
 * (直上のコミット履歴参照)。requestSyncNowAction (push 5 links + pull 5 ページ/provider の
 * 縮小上限 — facade 側の MANUAL_SYNC_PUSH_LIMIT/MANUAL_SYNC_PULL_PAGES) を含め、この Issue で
 * 追加する Action もいずれも既定のタイムアウトで十分なため、ビルドを壊してまで指示に従う
 * 理由がない (#53 の判断をそのまま踏襲— 安全側・機能を壊さないことを優先)。
 */
const schedulingFacade = createSchedulingFacade();

async function ensureAdmin(): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;
  return { ok: true, value: undefined };
}

// ---- 作業種別 / テンプレート (#52 facade 実装済み、UI は #53) ----

export async function saveWorkTypeAction(
  input: WorkTypeInput,
  id: string | null,
  expectedUpdatedAt: string | null,
): Promise<Result<{ work_type_id: string }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zWorkTypeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.saveWorkType(parsed.data, id, expectedUpdatedAt);
  if (result.ok) revalidatePath("/admin/calendar/types");
  return result;
}

export async function deleteWorkTypeAction(id: string): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.deleteWorkType(id);
  if (result.ok) revalidatePath("/admin/calendar/types");
  return result;
}

export async function saveWorkTemplateAction(
  input: WorkTemplateInput,
  id: string | null,
  expectedUpdatedAt: string | null,
): Promise<Result<{ template_id: string }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zWorkTemplateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.saveWorkTemplate(parsed.data, id, expectedUpdatedAt);
  if (result.ok) revalidatePath("/admin/calendar/templates");
  return result;
}

export async function deleteWorkTemplateAction(id: string): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.deleteWorkTemplate(id);
  if (result.ok) revalidatePath("/admin/calendar/templates");
  return result;
}

// ---- ブロック CRUD / 遷移 ----

export async function createBlockAction(input: WorkBlockInput): Promise<Result<{ block_id: string }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zWorkBlockInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.createBlock(parsed.data);
  if (result.ok) revalidatePath("/admin/calendar");
  return result;
}

export async function placeBlockAction(
  blockId: string,
  startsAt: string,
  endsAt: string,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.placeBlock(blockId, startsAt, endsAt, expectedUpdatedAt);
  if (result.ok) revalidatePath("/admin/calendar");
  return result;
}

export async function unscheduleBlockAction(blockId: string, expectedUpdatedAt: string): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.unscheduleBlock(blockId, expectedUpdatedAt);
  if (result.ok) revalidatePath("/admin/calendar");
  return result;
}

export async function updateBlockAction(
  blockId: string,
  input: UpdateWorkBlockInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zUpdateWorkBlockInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.updateBlock(blockId, parsed.data, expectedUpdatedAt);
  if (result.ok) revalidatePath("/admin/calendar");
  return result;
}

export async function transitionBlockAction(
  blockId: string,
  to: BlockTransition,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zBlockTransition.safeParse(to);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.transitionBlock(blockId, parsed.data, expectedUpdatedAt);
  if (result.ok) revalidatePath("/admin/calendar");
  return result;
}

export async function deleteBlockAction(blockId: string): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.deleteBlock(blockId);
  if (result.ok) revalidatePath("/admin/calendar");
  return result;
}

export async function recordActualAction(
  blockId: string,
  input: ActualInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zActualInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.recordActual(blockId, parsed.data, expectedUpdatedAt);
  if (result.ok) {
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/deals/[id]", "page");
  }
  return result;
}

/**
 * crm の案件画面 (#44 スコープ) からも呼ばれる想定 (実装計画書 §9.2 の注記どおり、export だけ
 * このファイルに置く)。
 */
export async function cancelOpenBlocksForDealAction(dealId: string): Promise<Result<{ cancelled: number }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.cancelOpenBlocksForDeal(dealId);
  if (result.ok) {
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/deals/[id]", "page");
  }
  return result;
}

// ---- app 層合成: ブロック配置→deal ステージ提案 / 失注→ブロック一括キャンセル提案 (#61) ----

/**
 * ブロック初回配置成功後の「製作中に進めますか?」提案 (00-overview §6.2 行2、03-scheduling §5.4
 * 行2)。`stage==='ordered'` のときのみ提案する (それ以外は既に in_production や他ステージであり
 * 提案が無意味なため `propose:false` で情報なしを返す — これはエラーではなく正常系の分岐)。
 *
 * 適用 (実際に stage を書き換える処理) は新規 Action を作らず、既存 `updateDealStageAction(dealId,
 * "in_production", expectedUpdatedAt)` (`@/app/admin/deals/actions`) をそのまま UI 側から呼ぶ
 * (実装計画書「成果物4」— 本 Action は「提案するだけ」の薄い層に留める)。`updateDealStageAction`
 * 呼び出し時の E602 (不正遷移) / E103 (楽観排他競合) はエラー化せず、UI 側の toast で情報表示に
 * 留める設計 (帳票イベント自体・ブロック配置自体は既に成立済みのため、ここでロールバックしない —
 * §7.1-2 の issueDocumentAction dealStageSkippedReason と同じ考え方)。
 */
export async function proposeInProductionAction(
  dealId: string,
): Promise<Result<{ propose: boolean; dealUpdatedAt: string | null }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;

  const dealRef = await crmFacade.getDealRef(dealId);
  if (!dealRef.ok) return dealRef;

  if (dealRef.value.stage !== "ordered") {
    return { ok: true, value: { propose: false, dealUpdatedAt: null } };
  }
  return { ok: true, value: { propose: true, dealUpdatedAt: dealRef.value.updated_at } };
}

/**
 * 失注確定成功後の「未着手の作業ブロックを取り消しますか?」提案の事前件数取得 (00-overview §6.2
 * 行2、01-crm §7.3 行5、03-scheduling §5.4 行1)。backlog/scheduled のみを対象とする
 * (in_progress/done は着手済みのため対象外 — 受入基準どおり)。
 *
 * 実際の一括キャンセルは新規 Action を作らず、既に #53 で実装・export 済みの
 * `cancelOpenBlocksForDealAction` (本ファイル上部) をそのまま UI 側から呼ぶ (実装計画書「乖離 B」:
 * issue 本文は deals/actions.ts への `proposeCancelBlocksAction` 新設を指示しているが、それは
 * 既存実装との二重実装になるため行わない — 本 Action は事前カウントのみを担う薄い層)。
 */
export async function getOpenBlockCountForDealAction(dealId: string): Promise<Result<{ count: number }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;

  const summary = await schedulingFacade.getDealWorkSummary(dealId);
  if (!summary.ok) return summary;

  const openStatuses = new Set<string>(["backlog", "scheduled"]);
  const count = summary.value.blocks.filter((b) => openStatuses.has(b.status)).length;
  return { ok: true, value: { count } };
}

// ---- 読み取り (カレンダー/一覧/集計) — クライアントからのナビゲーション再取得用 ----

export async function getCalendarRangeAction(query: CalendarRangeQuery): Promise<Result<WorkBlockView[]>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zCalendarRangeQuery.safeParse(query);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  return schedulingFacade.getCalendarRange(parsed.data);
}

export async function getBacklogBlocksAction(p: Pagination): Promise<Result<Paged<WorkBlockView>>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zPagination.safeParse(p);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  return schedulingFacade.getBacklogBlocks(parsed.data);
}

export async function getWeeklyCapacityAction(weekStart: string): Promise<Result<WeeklyCapacity>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  return schedulingFacade.getWeeklyCapacity(weekStart);
}

// ---- 自動提案配置 ----

export async function proposePlacementAction(input: ProposePlacementInput): Promise<Result<PlacementProposal[]>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zProposePlacementInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  return schedulingFacade.proposeBlockPlacement(parsed.data);
}

/**
 * 提案の一括確定 (§9.2 applyPlacementProposalsAction)。提案生成後の他更新は placeBlock の
 * 楽観排他 (expected_updated_at) が E103 で検知する。途中失敗は中断し、それまでの成功件数を返す
 * (「エラー握り潰し禁止」— 失敗した提案の情報を落とさず、どこで止まったかを detail に残す)。
 */
export async function applyPlacementProposalsAction(
  proposals: PlacementProposal[],
): Promise<Result<{ applied: number }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  let applied = 0;
  for (const proposal of proposals) {
    const result = await schedulingFacade.placeBlock(
      proposal.block_id,
      proposal.starts_at,
      proposal.ends_at,
      proposal.expected_updated_at,
    );
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        detail: `${applied} 件を配置した後、ブロック ${proposal.block_id} で失敗しました: ${result.detail ?? result.code}`,
      };
    }
    applied += 1;
  }
  if (applied > 0) revalidatePath("/admin/calendar");
  return { ok: true, value: { applied } };
}

// ---- 案件検索 (DealPicker 用。crmFacade.listDeals の薄いラッパ) ----

export async function searchDealsForCalendarAction(q: string): Promise<Result<DealListItem[]>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const trimmed = q.trim();
  const page = await crmFacade.listDeals(
    { q: trimmed.length > 0 ? trimmed : null, stage: "all" },
    { cursor: null, limit: 20 },
  );
  if (!page.ok) return page;
  return { ok: true, value: page.value.items };
}

// ---- 外部カレンダー接続管理 / 同期運用 (#54, §9.2) ----

export async function disconnectCalendarAction(provider: CalendarProvider): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zCalendarProvider.safeParse(provider);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.disconnectCalendar(parsed.data);
  if (result.ok) revalidatePath("/admin/calendar/connections");
  return result;
}

export async function resolveExternalDeletionAction(
  linkId: string,
  action: ExternalDeletionResolution,
): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zExternalDeletionResolution.safeParse(action);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.resolveExternalDeletion(linkId, parsed.data);
  if (result.ok) {
    revalidatePath("/admin/calendar/connections");
    revalidatePath("/admin/calendar");
  }
  return result;
}

export async function reconcilePushUnknownAction(linkId: string): Promise<Result<{ resolved: boolean }>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.reconcilePushUnknown(linkId);
  if (result.ok) revalidatePath("/admin/calendar/connections");
  return result;
}

export async function resendConflictedLinkAction(linkId: string): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.resendConflictedLink(linkId);
  if (result.ok) revalidatePath("/admin/calendar/connections");
  return result;
}

export async function resolveOrphanedLinkAction(
  linkId: string,
  action: OrphanedLinkResolution,
): Promise<Result<void>> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const parsed = zOrphanedLinkResolution.safeParse(action);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const result = await schedulingFacade.resolveOrphanedLink(linkId, parsed.data);
  if (result.ok) {
    revalidatePath("/admin/calendar/connections");
    revalidatePath("/admin/calendar");
  }
  return result;
}

export async function requestSyncNowAction(): Promise<
  Result<{ reports: CalendarSyncReport[]; skipped_running: boolean }>
> {
  const admin = await ensureAdmin();
  if (!admin.ok) return admin;
  const result = await schedulingFacade.requestSyncNow();
  if (result.ok) {
    revalidatePath("/admin/calendar/connections");
    revalidatePath("/admin/calendar");
  }
  return result;
}
