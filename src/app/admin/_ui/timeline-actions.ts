"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { platformFacade } from "@/modules/platform/facade";
import type { Paged, Result } from "@/modules/platform/contracts";
import { crmFacade, deriveNoteTitle } from "@/modules/crm/facade";
import {
  zAppendActivityInput,
  zNoteUpdateInput,
  zTimelinePagination,
  zTimelineTarget,
  type NoteUpdateInput,
  type TimelineItem,
  type TimelineTarget,
} from "@/modules/crm/contracts";

/**
 * ActivityTimeline (`activity-timeline.tsx`) 共用の Server Actions (01-crm.md §7.1 / §8.5)。
 * revalidate 対象は target 種別に応じて決める (customer_id→customers/[id], deal_id→deals/[id])。
 * company_id は会社 Sheet が独立ルートを持たない設計 (customers 一覧内の client Sheet) のため
 * 一覧 (/admin/customers) を revalidate する — CompanySheet 側は自身のデータ取得を
 * Server Action で行い、成功後にクライアント側で再取得する (revalidatePath は effect なし)。
 */
function revalidateForTarget(target: TimelineTarget) {
  if ("customer_id" in target) revalidatePath(`/admin/customers/${target.customer_id}`);
  else if ("deal_id" in target) revalidatePath(`/admin/deals/${target.deal_id}`);
  else revalidatePath("/admin/customers");
}

export type AddNoteInput = { target: TimelineTarget; body: string; occurred_at: string };

export async function addNoteAction(input: AddNoteInput): Promise<Result<{ activity_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsedTarget = zTimelineTarget.safeParse(input.target);
  if (!parsedTarget.success) return { ok: false, code: "KMB-E101", detail: parsedTarget.error.message };

  const title = deriveNoteTitle(input.body);
  const parsed = zAppendActivityInput.safeParse({
    activity_type: "note",
    occurred_at: input.occurred_at,
    title,
    body: input.body,
    payload: {},
    ref_table: null,
    ref_id: null,
    links: [
      {
        customer_id: "customer_id" in parsedTarget.data ? parsedTarget.data.customer_id : null,
        company_id: "company_id" in parsedTarget.data ? parsedTarget.data.company_id : null,
        deal_id: "deal_id" in parsedTarget.data ? parsedTarget.data.deal_id : null,
      },
    ],
  });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.appendActivity(parsed.data);
  if (!result.ok) return result;

  revalidateForTarget(parsedTarget.data);
  return { ok: true, value: { activity_id: result.value.activity_id } };
}

export async function loadMoreTimelineAction(
  target: TimelineTarget,
  cursor: string | null,
): Promise<Result<Paged<TimelineItem>>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsedTarget = zTimelineTarget.safeParse(target);
  if (!parsedTarget.success) return { ok: false, code: "KMB-E101", detail: parsedTarget.error.message };
  const pagination = zTimelinePagination.safeParse({ cursor, limit: 50 });
  if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };

  return crmFacade.listTimeline(parsedTarget.data, pagination.data);
}

export async function updateNoteAction(
  target: TimelineTarget,
  activityId: string,
  input: NoteUpdateInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };
  const parsed = zNoteUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.updateNoteActivity(activityId, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  const parsedTarget = zTimelineTarget.safeParse(target);
  if (parsedTarget.success) revalidateForTarget(parsedTarget.data);
  return result;
}

export async function deleteNoteAction(target: TimelineTarget, activityId: string): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const result = await crmFacade.deleteNoteActivity(activityId);
  if (!result.ok) return result;

  const parsedTarget = zTimelineTarget.safeParse(target);
  if (parsedTarget.success) revalidateForTarget(parsedTarget.data);
  return result;
}

/**
 * メモの紐づけ先を丸ごと置き換える (relinkNoteActivity — 01-crm §6.7)。v1 UI は「別の顧客/案件に
 * 付け替える」単一ターゲットの入替に絞る (links は 1〜6 件を許容する契約だが、複数同時リンクの
 * 編集 UI は本 Issue のスコープでは複雑度に見合わないため単一ターゲット入替のみ提供)。
 * affectedTargets には旧ターゲットと新ターゲットの両方を渡し、両方の画面を revalidate する。
 */
export async function relinkNoteAction(
  activityId: string,
  newTarget: TimelineTarget,
  affectedTargets: TimelineTarget[],
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsedLinks = z.array(zTimelineTarget).min(1).max(6).safeParse([newTarget]);
  if (!parsedLinks.success) return { ok: false, code: "KMB-E101", detail: parsedLinks.error.message };

  const result = await crmFacade.relinkNoteActivity(activityId, parsedLinks.data);
  if (!result.ok) return result;

  for (const t of affectedTargets) {
    const parsedTarget = zTimelineTarget.safeParse(t);
    if (parsedTarget.success) revalidateForTarget(parsedTarget.data);
  }
  return result;
}
