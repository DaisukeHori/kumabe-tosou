import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Paged, Pagination, Result } from "@/modules/platform/contracts";

import type {
  BlockTransition,
  CalendarConnectionMeta,
  CalendarConnectionStatus,
  CalendarProvider,
  EventLinkSyncStatus,
  UpdateWorkBlockInput,
  WorkBlockStatus,
  WorkTemplateInput,
  WorkTemplateView,
  WorkTypeInput,
  WorkTypeRow,
} from "./contracts";
import type {
  BlockDraft,
  TemplateExpandTemplate,
  TemplateExpandTemplateItem,
  TemplateExpandWorkType,
} from "./internal/template-expand";

/**
 * scheduling モジュールの repository (03-scheduling.md §2.2 の DDL への唯一の直接クエリ経路)。
 * Issue #52 の対象は work_types / work_templates / work_template_items の CRUD と、
 * generateBlocksFromLines 用の work_blocks 一括 INSERT。Issue #53 が work_blocks の
 * CRUD/状態遷移/カレンダー読み取り/キャパ集計/自動配置候補取得を追加する。
 *
 * 全関数は admin セッション client (`createSupabaseServerClient`) のみを使う
 * (03-scheduling.md §6「実行文脈は全メソッド session 固定」)。
 * pricing/repository.ts の作法 (OptimisticLockError を throw し facade が catch して
 * Result に変換する) を踏襲する — crm/repository.ts のように client を注入して
 * Result を直接返す作法は、本モジュールの対象メソッドが全て単一 client (session) しか
 * 使わないため採用しない。
 */

// ============================================================
// エラー変換用の型付き例外 (facade.ts が catch して Result<T> に変換する)
// ============================================================

/** 楽観排他 (KMB-E103) 検知時に投げる印 */
export class OptimisticLockError extends Error {
  constructor() {
    super("CONFLICT");
  }
}

/** 23505 (一意制約違反)。work_types.key 重複 / work_templates_combo_active_uidx 重複 → facade が KMB-E101 に変換 */
export class UniqueViolationError extends Error {}

/** 23503 (FK 違反)。work_type 削除時の参照中エラー / generateBlocksFromLines の deal・種別参照不整合
 *  / saveWorkTemplate の work_type_key 解決不能 / createBlock・updateBlock の work_type_id 不在
 *  → facade が KMB-E702 に変換 */
export class ForeignKeyViolationError extends Error {}

/**
 * deleteWorkBlockRow 専用のガード再検証失敗 (facade の事前 status 読取 [backlog/cancelled] と
 * DELETE 実行の間に別の操作で状態が変わっていた) を表す印。deleteBlock は expectedUpdatedAt を
 * 取らない (§6.2 シグネチャ) ため OptimisticLockError (通常 KMB-E103 に変換) とは意味が異なり、
 * facade は KMB-E703 (この状態では実行できません) に変換する。
 */
export class DeleteGuardViolationError extends Error {
  constructor() {
    super("STATUS_CHANGED");
  }
}

type PgError = { code?: string; message: string };

function throwTypedPgError(error: PgError): never {
  if (error.code === "23505") throw new UniqueViolationError(error.message);
  if (error.code === "23503") throw new ForeignKeyViolationError(error.message);
  throw new Error(error.message);
}

// ============================================================
// work_types
// ============================================================

const WORK_TYPE_COLUMNS =
  "id, key, label, color, consumes_capacity, default_hours, sort_order, is_active, updated_at";

export async function listWorkTypes(includeInactive: boolean): Promise<WorkTypeRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("work_types")
    .select(WORK_TYPE_COLUMNS)
    .order("sort_order", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throwTypedPgError(error);
  return (data ?? []) as WorkTypeRow[];
}

/** generateBlocksFromLines (internal/template-expand.ts) が使うアクティブ一覧。§7.1 の入力契約 */
export async function listActiveWorkTypesForExpand(): Promise<TemplateExpandWorkType[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_types")
    .select("id, key, label, default_hours, consumes_capacity, is_active")
    .eq("is_active", true);
  if (error) throwTypedPgError(error);
  return (data ?? []) as TemplateExpandWorkType[];
}

export async function upsertWorkType(
  input: WorkTypeInput,
  id: string | null,
  expectedUpdatedAt: string | null,
): Promise<{ id: string; updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const row = {
    key: input.key,
    label: input.label,
    color: input.color,
    consumes_capacity: input.consumes_capacity,
    default_hours: input.default_hours,
    sort_order: input.sort_order,
    is_active: input.is_active,
  };

  if (id) {
    let query = supabase.from("work_types").update(row).eq("id", id);
    if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select("id, updated_at").maybeSingle();
    if (error) throwTypedPgError(error);
    if (!data) throw new OptimisticLockError();
    return data;
  }

  const { data, error } = await supabase
    .from("work_types")
    .insert(row)
    .select("id, updated_at")
    .single();
  if (error) throwTypedPgError(error);
  if (!data) throw new Error("work_types 作成に失敗しました");
  return data;
}

/** 参照中 (work_template_items / work_blocks) の削除は FK 違反 (23503) → facade が KMB-E702 に変換 */
export async function deleteWorkType(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("work_types").delete().eq("id", id);
  if (error) throwTypedPgError(error);
}

// ============================================================
// work_templates / work_template_items
// ============================================================

const WORK_TEMPLATE_COLUMNS = "id, name, grade_key, size_key, is_active, updated_at";

type WorkTemplateRow = {
  id: string;
  name: string;
  grade_key: string | null;
  size_key: string | null;
  is_active: boolean;
  updated_at: string;
};

type WorkTemplateItemJoinRow = {
  template_id: string;
  work_type_id: string;
  hours: number;
  sort_order: number;
  work_types: { key: string; label: string } | null;
};

export async function listWorkTemplates(includeInactive: boolean): Promise<WorkTemplateView[]> {
  const supabase = await createSupabaseServerClient();
  let templatesQuery = supabase
    .from("work_templates")
    .select(WORK_TEMPLATE_COLUMNS)
    .order("name", { ascending: true });
  if (!includeInactive) templatesQuery = templatesQuery.eq("is_active", true);
  const { data: templates, error: templatesError } = await templatesQuery;
  if (templatesError) throwTypedPgError(templatesError);

  const templateRows = (templates ?? []) as WorkTemplateRow[];
  if (templateRows.length === 0) return [];

  const templateIds = templateRows.map((t) => t.id);
  const { data: items, error: itemsError } = await supabase
    .from("work_template_items")
    .select("template_id, work_type_id, hours, sort_order, work_types(key, label)")
    .in("template_id", templateIds)
    .order("sort_order", { ascending: true });
  if (itemsError) throwTypedPgError(itemsError);

  const itemsByTemplate = new Map<string, WorkTemplateView["items"]>();
  for (const row of (items ?? []) as unknown as WorkTemplateItemJoinRow[]) {
    const list = itemsByTemplate.get(row.template_id) ?? [];
    list.push({
      work_type_id: row.work_type_id,
      work_type_key: row.work_types?.key ?? "",
      work_type_label: row.work_types?.label ?? "",
      hours: row.hours,
      sort_order: row.sort_order,
    });
    itemsByTemplate.set(row.template_id, list);
  }

  return templateRows.map((t) => ({
    id: t.id,
    name: t.name,
    grade_key: t.grade_key,
    size_key: t.size_key,
    is_active: t.is_active,
    updated_at: t.updated_at,
    items: itemsByTemplate.get(t.id) ?? [],
  }));
}

type ExpandTemplateItemJoinRow = {
  template_id: string;
  work_type_id: string;
  hours: number;
  sort_order: number;
  work_types: { key: string; label: string; consumes_capacity: boolean } | null;
};

/** generateBlocksFromLines (internal/template-expand.ts) が使うアクティブ一覧 (items 込み)。§7.1 の入力契約 */
export async function listActiveWorkTemplatesForExpand(): Promise<TemplateExpandTemplate[]> {
  const supabase = await createSupabaseServerClient();
  const { data: templates, error: templatesError } = await supabase
    .from("work_templates")
    .select("id, grade_key, size_key, is_active")
    .eq("is_active", true);
  if (templatesError) throwTypedPgError(templatesError);

  const templateRows = (templates ?? []) as Array<{
    id: string;
    grade_key: string | null;
    size_key: string | null;
    is_active: boolean;
  }>;
  if (templateRows.length === 0) return [];

  const templateIds = templateRows.map((t) => t.id);
  const { data: items, error: itemsError } = await supabase
    .from("work_template_items")
    .select("template_id, work_type_id, hours, sort_order, work_types(key, label, consumes_capacity)")
    .in("template_id", templateIds)
    .order("sort_order", { ascending: true });
  if (itemsError) throwTypedPgError(itemsError);

  const itemsByTemplate = new Map<string, TemplateExpandTemplateItem[]>();
  for (const row of (items ?? []) as unknown as ExpandTemplateItemJoinRow[]) {
    if (!row.work_types) continue; // work_type_id は FK not-null のため理論上到達しない防御分岐
    const list = itemsByTemplate.get(row.template_id) ?? [];
    list.push({
      work_type_id: row.work_type_id,
      work_type_key: row.work_types.key,
      work_type_label: row.work_types.label,
      consumes_capacity: row.work_types.consumes_capacity,
      hours: row.hours,
      sort_order: row.sort_order,
    });
    itemsByTemplate.set(row.template_id, list);
  }

  return templateRows.map((t) => ({
    grade_key: t.grade_key,
    size_key: t.size_key,
    is_active: t.is_active,
    items: itemsByTemplate.get(t.id) ?? [],
  }));
}

/**
 * work_templates の保存 (items は全置換 — delete + insert。DDL コメント/Issue 本文どおり)。
 * items[].work_type_key はアクティブな work_types から解決する。解決不能 (存在しない/無効) な
 * key が 1 つでもあれば ForeignKeyViolationError (facade が KMB-E702 に変換)。
 * アクティブ combo (grade_key, size_key) 重複は work_templates 側の部分一意 index 違反 (23505)
 * として throwTypedPgError が UniqueViolationError に変換する (facade が KMB-E101 に変換)。
 *
 * 非トランザクション (pricing/repository.ts replaceMatrix 等の既存パターンと同じ制約): delete
 * 成功後の insert 失敗時、items は空のまま残り得る。本 Issue のスコープでは許容する既存の作法。
 */
export async function upsertWorkTemplate(
  input: WorkTemplateInput,
  id: string | null,
  expectedUpdatedAt: string | null,
): Promise<{ id: string; updated_at: string }> {
  const supabase = await createSupabaseServerClient();

  const keys = [...new Set(input.items.map((i) => i.work_type_key))];
  const { data: workTypes, error: workTypesError } = await supabase
    .from("work_types")
    .select("id, key")
    .eq("is_active", true)
    .in("key", keys);
  if (workTypesError) throwTypedPgError(workTypesError);
  const idByKey = new Map(
    ((workTypes ?? []) as Array<{ id: string; key: string }>).map((w) => [w.key, w.id]),
  );
  const missingKeys = keys.filter((k) => !idByKey.has(k));
  if (missingKeys.length > 0) {
    throw new ForeignKeyViolationError(
      `work_type_key が見つからないか無効です: ${missingKeys.join(", ")}`,
    );
  }

  const row = {
    name: input.name,
    grade_key: input.grade_key,
    size_key: input.size_key,
    is_active: input.is_active,
  };

  let templateId: string;
  let updatedAt: string;
  if (id) {
    let query = supabase.from("work_templates").update(row).eq("id", id);
    if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select("id, updated_at").maybeSingle();
    if (error) throwTypedPgError(error);
    if (!data) throw new OptimisticLockError();
    templateId = data.id;
    updatedAt = data.updated_at;

    const { error: deleteError } = await supabase
      .from("work_template_items")
      .delete()
      .eq("template_id", templateId);
    if (deleteError) throwTypedPgError(deleteError);
  } else {
    const { data, error } = await supabase
      .from("work_templates")
      .insert(row)
      .select("id, updated_at")
      .single();
    if (error) throwTypedPgError(error);
    if (!data) throw new Error("work_templates 作成に失敗しました");
    templateId = data.id;
    updatedAt = data.updated_at;
  }

  const itemRows = input.items.map((item) => ({
    template_id: templateId,
    work_type_id: idByKey.get(item.work_type_key) as string,
    hours: item.hours,
    sort_order: item.sort_order,
  }));
  const { error: insertItemsError } = await supabase.from("work_template_items").insert(itemRows);
  if (insertItemsError) throwTypedPgError(insertItemsError);

  return { id: templateId, updated_at: updatedAt };
}

/** work_template_items は on delete cascade のため参照 FK 違反は起きない想定だが、
 *  将来の参照追加に備えて他エラーと同様 throwTypedPgError で一律変換する。 */
export async function deleteWorkTemplate(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("work_templates").delete().eq("id", id);
  if (error) throwTypedPgError(error);
}

// ============================================================
// work_blocks — generateBlocksFromLines の一括 INSERT (#52)
// ============================================================

/**
 * internal/template-expand.ts が生成した BlockDraft[] を work_blocks へ一括 INSERT する
 * (status='backlog' 固定 — 原案生成直後は未配置)。deal_id / source_document_id / work_type_id の
 * いずれかが参照不整合の場合は FK 違反 (23503) → ForeignKeyViolationError
 * (facade が KMB-E702 に変換)。
 */
export async function insertWorkBlocks(
  dealId: string,
  sourceDocumentId: string,
  drafts: BlockDraft[],
  createdBy: string | null,
): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const rows = drafts.map((draft) => ({
    deal_id: dealId,
    source_document_id: sourceDocumentId,
    work_type_id: draft.work_type_id,
    title: draft.title,
    status: "backlog" as const,
    planned_hours: draft.planned_hours,
    consumes_capacity: draft.consumes_capacity,
    quantity: draft.quantity,
    memo: draft.memo,
    created_by: createdBy,
  }));
  const { data, error } = await supabase.from("work_blocks").insert(rows).select("id");
  if (error) throwTypedPgError(error);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

// ============================================================
// work_blocks — CRUD / 状態遷移 / カレンダー読み取り / キャパ集計 / 自動配置候補取得 (#53)
// canonical: 03-scheduling.md §6.2 (facade メソッド一覧) / §5.1 (状態機械)。
// 遷移可否 (§5.1 の許可表) の判定は internal/block-state.ts の責務であり、この repository 層は
// facade がその判定結果 (導出済みの新 status 等) を渡してきた CAS UPDATE のみを行う
// (実装計画書「二重検証の原則」— facade が status を読んで判定する層、という設計を採用)。
// ============================================================

const WORK_BLOCK_COLUMNS =
  "id, deal_id, source_document_id, work_type_id, title, status, starts_at, ends_at, " +
  "planned_hours, actual_hours, performed_on, consumes_capacity, quantity, memo, updated_at";

// calendar_event_links (migration 0030) を JOIN する。#53 時点は WorkBlockView.sync 用の実データが
// 存在しなかったため未 JOIN だったが、#54 でテーブルが追加されたため toWorkBlockView (facade.ts) が
// 実データを詰められるよう JOIN 列を追加する。admin セッション client でも calendar_event_links の
// SELECT は許可されている (RLS: calendar_event_links_admin_select — INSERT/UPDATE/DELETE のみ拒否)。
// calendar_event_links.id (link_id) は #54 レビュー修正で追加 (deleted_externally 解決ダイアログを
// block-detail-dialog.tsx がカレンダー画面から直接開けるようにするため — WorkBlockView.sync 参照)。
const WORK_BLOCK_JOIN_COLUMNS = `${WORK_BLOCK_COLUMNS}, work_types(key, label, color), calendar_event_links(id, provider, sync_status, last_error_code)`;

export type WorkBlockRow = {
  id: string;
  deal_id: string | null;
  source_document_id: string | null;
  work_type_id: string;
  title: string | null;
  status: WorkBlockStatus;
  starts_at: string | null;
  ends_at: string | null;
  planned_hours: number;
  actual_hours: number | null;
  performed_on: string | null;
  consumes_capacity: boolean;
  quantity: number | null;
  memo: string | null;
  updated_at: string;
};

export type WorkBlockJoinRow = WorkBlockRow & {
  work_types: { key: string; label: string; color: string } | null;
  // Supabase の埋め込みリソースは 1:多 (calendar_event_links.work_block_id → work_blocks.id) を
  // 常に配列で返す (行が無ければ [])。toWorkBlockView (facade.ts) が WorkBlockView.sync に詰める。
  // optional にしているのは #52/#53 の既存テスト (tests/scheduling-*.test.ts) のモック行が
  // この列を持たないため (`?? []` で facade 側が吸収する — テストを壊さない安全側の型)。
  calendar_event_links?: Array<{
    id: string;
    provider: CalendarProvider;
    sync_status: EventLinkSyncStatus;
    last_error_code: string | null;
  }>;
};

/** work_type.consumes_capacity のスナップショット取得。createBlock (facade) が使う。
 *  存在しない、または無効化済み (is_active=false) の work_type_id には null を返す
 *  (facade が KMB-E702 に変換 — 03-scheduling.md §6.2 createBlock コメント「E702 (work_type
 *  不在・無効)」どおり、無効種別も不在と同様に拒否する)。 */
export async function getWorkTypeSnapshot(
  workTypeId: string,
): Promise<{ consumes_capacity: boolean } | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_types")
    .select("consumes_capacity")
    .eq("id", workTypeId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throwTypedPgError(error);
  return data;
}

/**
 * createBlock 用の単体 INSERT。status は internal/block-state.ts の deriveCreateStatus() で
 * 導出済みの値を facade が渡す (backlog なら starts/ends は呼び出し元が null を渡す契約 —
 * DB check work_blocks_backlog_unplaced/work_blocks_active_placed に違反しないよう
 * 呼び出し順を厳守すること)。
 */
export async function insertWorkBlock(params: {
  deal_id: string | null;
  work_type_id: string;
  title: string | null;
  status: WorkBlockStatus;
  starts_at: string | null;
  ends_at: string | null;
  planned_hours: number;
  consumes_capacity: boolean;
  memo: string | null;
  created_by: string | null;
}): Promise<{ id: string; updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .insert({
      deal_id: params.deal_id,
      source_document_id: null,
      work_type_id: params.work_type_id,
      title: params.title,
      status: params.status,
      starts_at: params.starts_at,
      ends_at: params.ends_at,
      planned_hours: params.planned_hours,
      consumes_capacity: params.consumes_capacity,
      quantity: null,
      memo: params.memo,
      created_by: params.created_by,
    })
    .select("id, updated_at")
    .single();
  if (error) throwTypedPgError(error);
  if (!data) throw new Error("work_blocks 作成に失敗しました");
  return data;
}

/**
 * 単体取得 (状態遷移ガードの事前読み取り用。facade が status を見て internal/block-state.ts で
 * 判定する)。work_types を JOIN するのは recordActual の work_log activity payload
 * (work_type_key/work_type_label が必要 — §7.3) のため。他の呼び出し元 (placeBlock 等) は
 * work_types フィールドを単純に無視すればよく、専用の非 JOIN 版を別途持つほどの負荷差もない。
 */
export async function getWorkBlockById(id: string): Promise<WorkBlockJoinRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .select(WORK_BLOCK_JOIN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throwTypedPgError(error);
  return data as unknown as WorkBlockJoinRow | null;
}

/**
 * placeBlock 用 CAS UPDATE。newStatus は facade が internal/block-state.ts の
 * derivePlacementStatus(現status) で導出済みの値 (backlog→scheduled、それ以外は現状維持) を渡す —
 * 配置と遷移が同時に起きる §5.1 表の backlog→scheduled セルをここで実現する。
 */
export async function updateWorkBlockPlacement(
  blockId: string,
  startsAt: string,
  endsAt: string,
  newStatus: WorkBlockStatus,
  expectedUpdatedAt: string,
): Promise<{ updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .update({ starts_at: startsAt, ends_at: endsAt, status: newStatus })
    .eq("id", blockId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throwTypedPgError(error);
  if (!data) throw new OptimisticLockError();
  return data;
}

/**
 * updateBlock 用 CAS UPDATE。work_type_id 変更時は新種別の consumes_capacity を再スナップショット
 * する (§5.1 不変条件 1 — work_types 側の変更は既存ブロックへ波及しないが、種別変更操作そのものは
 * 新種別の値を採用する)。done への編集拒否 (E703) は facade が事前チェック済みの前提。
 */
export async function updateWorkBlockDetail(
  blockId: string,
  input: UpdateWorkBlockInput,
  expectedUpdatedAt: string,
): Promise<{ updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  // is_active=true も条件に含める: 無効化済み work_type への参照は不在と同様に拒否する
  // (03-scheduling.md §6.2 updateBlock コメント「E702 (work_type 不在・無効)」)。
  const { data: workType, error: workTypeError } = await supabase
    .from("work_types")
    .select("consumes_capacity")
    .eq("id", input.work_type_id)
    .eq("is_active", true)
    .maybeSingle();
  if (workTypeError) throwTypedPgError(workTypeError);
  if (!workType) {
    throw new ForeignKeyViolationError(`work_type_id ${input.work_type_id} が見つからないか無効です`);
  }

  const { data, error } = await supabase
    .from("work_blocks")
    .update({
      work_type_id: input.work_type_id,
      title: input.title,
      planned_hours: input.planned_hours,
      memo: input.memo,
      deal_id: input.deal_id,
      consumes_capacity: workType.consumes_capacity,
    })
    .eq("id", blockId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throwTypedPgError(error);
  if (!data) throw new OptimisticLockError();
  return data;
}

/** unscheduleBlock 用 CAS UPDATE。scheduled→backlog (starts/ends を NULL 化)。
 *  in_progress 等からの誤呼び出しは facade の事前ガード (E703) が防ぐ前提だが、
 *  status='scheduled' 条件を WHERE に足して二重に守る (実装計画書「二重検証」の repository 側実装)。 */
export async function unscheduleWorkBlock(
  blockId: string,
  expectedUpdatedAt: string,
): Promise<{ updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .update({ starts_at: null, ends_at: null, status: "backlog" })
    .eq("id", blockId)
    .eq("status", "scheduled")
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throwTypedPgError(error);
  if (!data) throw new OptimisticLockError();
  return data;
}

/** transitionBlock 用 CAS UPDATE ('in_progress' | 'cancelled')。配置 (starts/ends) は保持する。 */
export async function transitionWorkBlockStatus(
  blockId: string,
  to: BlockTransition,
  expectedUpdatedAt: string,
): Promise<{ updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .update({ status: to })
    .eq("id", blockId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throwTypedPgError(error);
  if (!data) throw new OptimisticLockError();
  return data;
}

/**
 * recordActual 用 CAS UPDATE (actual_hours/performed_on/status='done')。
 * DB check work_blocks_done_complete により actual_hours/performed_on/starts_at が全て非 NULL
 * でないと status='done' への UPDATE 自体が失敗する (23514) — backlog (starts_at NULL) への
 * 実績入力は facade が事前に KMB-E705 を返すため、通常この DB check には到達しない
 * (到達した場合は throwTypedPgError が拾えない check violation として素の Error になり、
 * facade の catch-all が KMB-E901 に変換する — 想定外経路のフェイルセーフ)。
 * 「旧 status」は facade が本関数呼び出し前に getWorkBlockById で読み取り済みの値を使う
 * (初回確定判定 — repository の戻り値に旧 status を含める設計も検討したが、facade は既に
 * 遷移ガードのために現在の status を読んでいるため、二重に持ち回らせず facade 側の変数で
 * 完結させる方がシンプルで一貫性がある、という実装判断)。
 */
export async function recordWorkBlockActual(
  blockId: string,
  actualHours: number,
  performedOn: string,
  expectedUpdatedAt: string,
): Promise<{ updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .update({ actual_hours: actualHours, performed_on: performedOn, status: "done" })
    .eq("id", blockId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throwTypedPgError(error);
  if (!data) throw new OptimisticLockError();
  return data;
}

/**
 * deleteBlock 用の物理 DELETE。backlog/cancelled のみ (WHERE status IN (...) — facade の事前
 * assertDeletable チェックと二重に守る)。hasUndeletedExternalLink の判定は calendar_event_links
 * (migration 0030) が存在しない #53 時点では行わない — 常に false 相当として扱われる
 * (呼び出し元 facade が internal/block-state.ts の assertDeletable(status, false) で判定済み)。
 * 0 行応答 (facade の事前読み取り後に別操作で status が backlog/cancelled から変わっていた競合) は
 * DeleteGuardViolationError を投げ、facade が KMB-E703 に変換する (無言で成功扱いにしない)。
 */
export async function deleteWorkBlockRow(blockId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .delete()
    .eq("id", blockId)
    .in("status", ["backlog", "cancelled"])
    .select("id");
  if (error) throwTypedPgError(error);
  if (!data || data.length === 0) throw new DeleteGuardViolationError();
}

/**
 * cancelOpenBlocksForDeal 用の一括 UPDATE。backlog/scheduled のみ対象 (in_progress/done は除外 — WHERE 句)。
 * scheduledBlockIds は「配置済みだった (starts_at 非 NULL) ため外部カレンダーへの削除マークが
 * 必要」なブロックの id (§6.2 cancelOpenBlocksForDeal コメント「scheduled だったブロックの links
 * は削除マーク」)。この UPDATE は status しか更新しないため starts_at は更新前の値のまま残る —
 * backlog 由来 (starts_at NULL、DB check work_blocks_backlog_unplaced) と scheduled 由来
 * (starts_at 非 NULL、work_blocks_active_placed) を区別する判定に使える。
 */
export async function cancelOpenWorkBlocksForDeal(
  dealId: string,
): Promise<{ cancelled: number; scheduledBlockIds: string[] }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .update({ status: "cancelled" })
    .eq("deal_id", dealId)
    .in("status", ["backlog", "scheduled"])
    .select("id, starts_at");
  if (error) throwTypedPgError(error);
  const rows = (data ?? []) as Array<{ id: string; starts_at: string | null }>;
  return {
    cancelled: rows.length,
    scheduledBlockIds: rows.filter((r) => r.starts_at !== null).map((r) => r.id),
  };
}

/** getCalendarRange 用。starts_at/ends_at が [fromIso, toIso) と重なる配置済みブロックを取得する。 */
export async function getWorkBlocksInRange(fromIso: string, toIso: string): Promise<WorkBlockJoinRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .select(WORK_BLOCK_JOIN_COLUMNS)
    .not("starts_at", "is", null)
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at", { ascending: true });
  if (error) throwTypedPgError(error);
  return (data ?? []) as unknown as WorkBlockJoinRow[];
}

type BacklogCursor = { createdAt: string; id: string };

function encodeBacklogCursor(c: BacklogCursor): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url");
}

function decodeBacklogCursor(raw: string | null | undefined): BacklogCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { createdAt?: unknown }).createdAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as BacklogCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/** getBacklogBlocks 用の keyset pagination (crm/repository.ts の decodeCreatedAtCursor パターンを流用)。 */
export async function getBacklogWorkBlocks(
  pagination: Pagination,
): Promise<Paged<WorkBlockJoinRow & { created_at: string }>> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("work_blocks")
    .select(`${WORK_BLOCK_JOIN_COLUMNS}, created_at`)
    .eq("status", "backlog")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  const cursor = decodeBacklogCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throwTypedPgError(error);
  const rows = (data ?? []) as unknown as Array<WorkBlockJoinRow & { created_at: string }>;
  const hasMore = rows.length > pagination.limit;
  const items = hasMore ? rows.slice(0, pagination.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeBacklogCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { items, next_cursor: nextCursor };
}

/** getWeeklyCapacity 用。§7.2 の絞り込み (consumes_capacity=true and status in (...) and
 *  starts_at ∈ [startUtc, endUtc)) を SQL 側で行い、planned_hours 列だけ返す。 */
export async function getWeeklyBookedBlocks(
  startUtc: string,
  endUtc: string,
): Promise<Array<{ planned_hours: number }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .select("planned_hours")
    .eq("consumes_capacity", true)
    .in("status", ["scheduled", "in_progress", "done"])
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);
  if (error) throwTypedPgError(error);
  return (data ?? []) as Array<{ planned_hours: number }>;
}

/** getDealWorkSummary 用。cancelled を含む全ブロックを取得する (集計時の cancelled 除外は
 *  facade の責務 — 履歴として cancelled も含めて一覧表示できるようにするため取得段階では絞らない)。 */
export async function getDealWorkBlocks(dealId: string): Promise<WorkBlockJoinRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .select(WORK_BLOCK_JOIN_COLUMNS)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) throwTypedPgError(error);
  return (data ?? []) as unknown as WorkBlockJoinRow[];
}

/**
 * runCalendarMaintenanceTasks の「work_log 再送」(§8.8) 用。直近 sinceDateOnly 以降に実績確定
 * (performed_on) された done ブロックのうち deal_id 非 NULL のものを取得する。recordActual
 * (facade.ts) の appendActivity 呼び出しはベストエフォート (§7.3 — 失敗しても実績確定自体は
 * 成立させる) なので、この一覧を日次で再送して自己修復する。service client 専用
 * (日次ジョブは cookie セッションを持たない)。
 */
export async function getRecentDoneBlocksForWorkLogResend(
  serviceClient: SupabaseClient,
  sinceDateOnly: string,
): Promise<WorkBlockJoinRow[]> {
  const { data, error } = await serviceClient
    .from("work_blocks")
    .select(WORK_BLOCK_JOIN_COLUMNS)
    .eq("status", "done")
    .not("deal_id", "is", null)
    .gte("performed_on", sinceDateOnly);
  if (error) throwTypedPgError(error);
  return (data ?? []) as unknown as WorkBlockJoinRow[];
}

export type AutoPlaceCandidateRow = {
  id: string;
  status: WorkBlockStatus;
  planned_hours: number;
  consumes_capacity: boolean;
  updated_at: string;
};

/** proposeBlockPlacement 用。指定 id 群のブロックを取得する (見つからない/backlog でない id は
 *  facade が KMB-E702 として拒否する — 呼び出し元の block_ids 順序への並べ替えも facade の責務)。 */
export async function getWorkBlocksByIds(ids: string[]): Promise<AutoPlaceCandidateRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .select("id, status, planned_hours, consumes_capacity, updated_at")
    .in("id", ids);
  if (error) throwTypedPgError(error);
  return (data ?? []) as AutoPlaceCandidateRow[];
}

/** proposeBlockPlacement 用。既存の拘束配置済みブロック (auto-place.ts の existingBookedBlocks) を
 *  探索ウィンドウと重なる範囲で取得する。 */
export async function getBookedBlocksForAutoPlaceWindow(
  fromIso: string,
  toIso: string,
): Promise<Array<{ starts_at: string; ends_at: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .select("starts_at, ends_at")
    .eq("consumes_capacity", true)
    .in("status", ["scheduled", "in_progress", "done"])
    .not("starts_at", "is", null)
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso);
  if (error) throwTypedPgError(error);
  return (data ?? []) as Array<{ starts_at: string; ends_at: string }>;
}

// ============================================================================
// calendar_connections / calendar_event_links (#54: migration 0030)
// canonical: 03-scheduling.md §2.3 (DDL) / §6.2 (facade 拡張メソッド一覧) / §8 (同期詳細)。
//
// 【実装方針の判断 (未解決点2 の実装者判断)】上記の work_blocks 系関数は「throw 型付き例外 →
// facade が catch して Result に変換する」流儀 (pricing/repository.ts 前例) だが、この節は
// distribution/repository.ts の vaultReadSecret/vaultUpsertSecret/claimTokenRefreshLease と
// 同型の「Result<T> を直接返す」流儀を採用する (実装計画書「vault ラッパは integrations §2.2 の
// 流儀で複製」の指示を Vault 関数以外の同節の関数にも一貫適用した)。理由: この節の呼び出し元は
// admin セッション (facade の CRUD 経由) ではなく sync-engine.ts (pg_cron worker) が主であり、
// worker ループは 1 link の失敗で全体を落とせない (例外 throw だと呼び出し側で毎回 try/catch を
// 書く必要があり、Result の方が「1 件失敗しても次の link へ進む」ループ制御と自然に整合する)。
//
// 【型による強制 (未解決点2)】calendar_event_links の書込みは RLS が authenticated からの
// INSERT/UPDATE/DELETE を一切許可しない (service_role のみ)。区別は各関数の引数名を
// `serviceClient` に統一することで示す (branded type 等の追加の型的強制は過剰設計と判断 —
// 実装計画書の判断に従う。session client を誤って渡した場合は RLS 拒否として即座に検出できる)。
// calendar_connections は admin セッションからも書けるため引数名は `client` のままとする。
// ============================================================================

function pgErrorToCalendarResult(error: PgError): { ok: false; code: "KMB-E901"; detail: string } {
  return { ok: false, code: "KMB-E901", detail: error.message };
}

// ---------------------------------------------------------
// calendar_connections
// ---------------------------------------------------------

export type CalendarConnectionRow = {
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  vault_secret_name: string | null;
  sync_token: string | null;
  sync_page_cursor: string | null;
  meta: Record<string, unknown>;
  token_refresh_lease_expires_at: string | null;
  sync_lease_expires_at: string | null;
  pull_requested_at: string | null;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  last_full_resync_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  connected_at: string | null;
  updated_at: string;
};

// 1 本の文字列リテラルにする (`+` 連結すると widen されて `string` 型になり、
// Supabase の select() の型推論 (リテラル型必須) が効かず GenericStringError に落ちるため)。
const CALENDAR_CONNECTION_COLUMNS =
  "provider, status, vault_secret_name, sync_token, sync_page_cursor, meta, token_refresh_lease_expires_at, sync_lease_expires_at, pull_requested_at, last_pulled_at, last_pushed_at, last_full_resync_at, last_error_code, last_error_detail, connected_at, updated_at";

export async function getCalendarConnection(
  client: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<CalendarConnectionRow | null>> {
  const { data, error } = await client
    .from("calendar_connections")
    .select(CALENDAR_CONNECTION_COLUMNS)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data as CalendarConnectionRow | null) ?? null };
}

export async function listCalendarConnections(client: SupabaseClient): Promise<Result<CalendarConnectionRow[]>> {
  const { data, error } = await client
    .from("calendar_connections")
    .select(CALENDAR_CONNECTION_COLUMNS)
    .order("provider", { ascending: true });
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data ?? []) as CalendarConnectionRow[] };
}

export type UpsertCalendarConnectionInput = {
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  vault_secret_name: string;
  meta: CalendarConnectionMeta;
};

/** OAuth callback (#54 の担当外 — 将来 facade 経由で呼ばれる) 用の UPSERT。
 *  sync_token は常に NULL 化する (接続完了 = 次回フル同期 — §8.2 手順6)。 */
export async function upsertCalendarConnection(
  client: SupabaseClient,
  input: UpsertCalendarConnectionInput,
): Promise<Result<void>> {
  const { error } = await client.from("calendar_connections").upsert(
    {
      provider: input.provider,
      status: input.status,
      vault_secret_name: input.vault_secret_name,
      meta: input.meta,
      sync_token: null,
      sync_page_cursor: null,
      connected_at: new Date().toISOString(),
      last_error_code: null,
      last_error_detail: null,
    },
    { onConflict: "provider" },
  );
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** token.ts (§8.3) / sync-engine.ts (§8.4 の 401/404 分岐) が connection の状態異常を記録する。 */
export async function updateCalendarConnectionStatus(
  client: SupabaseClient,
  provider: CalendarProvider,
  status: CalendarConnectionStatus,
  errorCode: string | null,
  errorDetail: string | null,
): Promise<Result<void>> {
  const { error } = await client
    .from("calendar_connections")
    .update({ status, last_error_code: errorCode, last_error_detail: errorDetail })
    .eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** pull ラウンド完了/途中終了時の cursor/token/エラーコード更新 (§8.5)。 */
export async function updateCalendarConnectionAfterPull(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  patch: {
    sync_token: string | null;
    sync_page_cursor: string | null;
    last_full_resync_at?: string;
    last_error_code?: string | null;
    last_error_detail?: string | null;
  },
): Promise<Result<void>> {
  const updatePayload: Record<string, unknown> = {
    sync_token: patch.sync_token,
    sync_page_cursor: patch.sync_page_cursor,
    last_pulled_at: new Date().toISOString(),
  };
  if (patch.last_full_resync_at !== undefined) updatePayload.last_full_resync_at = patch.last_full_resync_at;
  if (patch.last_error_code !== undefined) updatePayload.last_error_code = patch.last_error_code;
  if (patch.last_error_detail !== undefined) updatePayload.last_error_detail = patch.last_error_detail;
  const { error } = await serviceClient.from("calendar_connections").update(updatePayload).eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/**
 * Graph ローリングウィンドウ切り直し (§8.8)。日次 runCalendarMaintenance から呼ばれる。
 * meta (sync_window_start/end 更新済み) を保存し、deltaLink (sync_token) / sync_page_cursor を
 * 破棄して次回 runPull がフル再同期に入るようにする (410=KMB-E722 の経路と同型 — token=null で
 * fullResyncTriggered になる runPullLoop の既存分岐に自然に乗る)。clearSafetyValveError=true の
 * ときのみ last_error_code をクリアする (KMB-E725 発火が理由で切り直した場合のみ — §8.8「完了時に
 * E725をクリア」。ウィンドウ経年劣化のみが理由の場合は他のエラーコードを誤って握り潰さないよう
 * このフィールド自体に触れない)。
 */
export async function rollCalendarSyncWindow(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  input: { meta: CalendarConnectionMeta; clearSafetyValveError: boolean },
): Promise<Result<void>> {
  const updatePayload: Record<string, unknown> = {
    meta: input.meta,
    sync_token: null,
    sync_page_cursor: null,
  };
  if (input.clearSafetyValveError) {
    updatePayload.last_error_code = null;
    updatePayload.last_error_detail = null;
  }
  const { error } = await serviceClient.from("calendar_connections").update(updatePayload).eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** push 完走時に connection.last_pushed_at を進める (last_pulled_at と対称の記録項目)。 */
export async function touchCalendarConnectionAfterPush(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_connections")
    .update({ last_pushed_at: new Date().toISOString() })
    .eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------
// リース (§8.3 token refresh CAS / §8.5 sync 単一化)
// ---------------------------------------------------------

export async function claimCalendarSyncLease(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  ttlMs: number,
): Promise<Result<boolean>> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const { data, error } = await serviceClient
    .from("calendar_connections")
    .update({ sync_lease_expires_at: leaseExpiresAt })
    .eq("provider", provider)
    .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${now.toISOString()}`)
    .select("provider")
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: Boolean(data) };
}

export async function releaseCalendarSyncLease(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_connections")
    .update({ sync_lease_expires_at: null })
    .eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

export async function claimCalendarTokenRefreshLease(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  ttlMs: number,
): Promise<Result<boolean>> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const { data, error } = await serviceClient
    .from("calendar_connections")
    .update({ token_refresh_lease_expires_at: leaseExpiresAt })
    .eq("provider", provider)
    .or(`token_refresh_lease_expires_at.is.null,token_refresh_lease_expires_at.lt.${now.toISOString()}`)
    .select("provider")
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: Boolean(data) };
}

export async function releaseCalendarTokenRefreshLease(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_connections")
    .update({ token_refresh_lease_expires_at: null })
    .eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------
// Vault (service client 専用。distribution/repository.ts と同型の複製 — 実装計画書の指示)
// ---------------------------------------------------------

export async function vaultUpsertSecret(
  serviceClient: SupabaseClient,
  name: string,
  value: string,
): Promise<Result<void>> {
  const { error } = await serviceClient.rpc("vault_upsert_secret", { p_name: name, p_secret: value });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: undefined };
}

export async function vaultReadSecret(serviceClient: SupabaseClient, name: string): Promise<Result<string | null>> {
  const { data, error } = await serviceClient.rpc("vault_read_secret", { p_name: name });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: (data as string | null) ?? null };
}

export async function vaultDeleteSecret(serviceClient: SupabaseClient, name: string): Promise<Result<void>> {
  const { error } = await serviceClient.rpc("vault_delete_secret", { p_name: name });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------
// calendar_event_links
// ---------------------------------------------------------

export type CalendarEventLinkRow = {
  id: string;
  work_block_id: string;
  provider: CalendarProvider;
  external_event_id: string | null;
  external_ical_uid: string | null;
  etag_or_change_key: string | null;
  external_updated_at: string | null;
  last_written_hash: string | null;
  sync_status: EventLinkSyncStatus;
  push_attempts: number;
  push_claimed_at: string | null;
  last_error_code: string | null;
  last_pushed_at: string | null;
  last_pulled_at: string | null;
  deleted_externally_at: string | null;
  created_at: string;
  updated_at: string;
};

const CALENDAR_EVENT_LINK_COLUMNS =
  "id, work_block_id, provider, external_event_id, external_ical_uid, etag_or_change_key, external_updated_at, last_written_hash, sync_status, push_attempts, push_claimed_at, last_error_code, last_pushed_at, last_pulled_at, deleted_externally_at, created_at, updated_at";

/**
 * deleteBlock (§5.1-5/§5.3-6/§6.2) 用。external_event_id 非 NULL の link が 1 件でも残っていれば
 * true — cascade による外部イベント永久残置 (ゴースト予定) を防ぐための削除ガード。
 * #53 時点は calendar_event_links が存在せず常に false 扱いだったが (facade.ts 旧コメント参照)、
 * #54 でテーブルが追加されたため実データで判定する。
 */
export async function hasUndeletedExternalCalendarLink(
  client: SupabaseClient,
  workBlockId: string,
): Promise<Result<boolean>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select("id")
    .eq("work_block_id", workBlockId)
    .not("external_event_id", "is", null)
    .limit(1);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data ?? []).length > 0 };
}

export async function getCalendarEventLink(
  client: SupabaseClient,
  workBlockId: string,
  provider: CalendarProvider,
): Promise<Result<CalendarEventLinkRow | null>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select(CALENDAR_EVENT_LINK_COLUMNS)
    .eq("work_block_id", workBlockId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data as CalendarEventLinkRow | null) ?? null };
}

/** appLinkId (出所マーキング) から直接解決する — calendar_event_links.id そのものが
 *  ExternalEventInput.linkId / ExternalEventChange.appLinkId として使われる (§8.1/§8.5)。 */
export async function getCalendarEventLinkById(
  client: SupabaseClient,
  linkId: string,
): Promise<Result<CalendarEventLinkRow | null>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select(CALENDAR_EVENT_LINK_COLUMNS)
    .eq("id", linkId)
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data as CalendarEventLinkRow | null) ?? null };
}

export async function findLinkByExternalEventId(
  client: SupabaseClient,
  provider: CalendarProvider,
  externalEventId: string,
): Promise<Result<CalendarEventLinkRow | null>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select(CALENDAR_EVENT_LINK_COLUMNS)
    .eq("provider", provider)
    .eq("external_event_id", externalEventId)
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data as CalendarEventLinkRow | null) ?? null };
}

export async function findLinkByIcalUid(
  client: SupabaseClient,
  provider: CalendarProvider,
  icalUid: string,
): Promise<Result<CalendarEventLinkRow | null>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select(CALENDAR_EVENT_LINK_COLUMNS)
    .eq("provider", provider)
    .eq("external_ical_uid", icalUid)
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data as CalendarEventLinkRow | null) ?? null };
}

export type PendingPushLinkRow = CalendarEventLinkRow & {
  block_status: WorkBlockStatus;
  block_starts_at: string | null;
  block_ends_at: string | null;
  block_title: string | null;
  block_work_type_label: string;
};

type WorkBlockJoinForLink = {
  id: string;
  status: WorkBlockStatus;
  starts_at: string | null;
  ends_at: string | null;
  title: string | null;
  work_types: { label: string } | null;
};

/** push (§8.4) 対象。provider 毎、1 起床最大 limit 件、created_at 昇順。 */
export async function listPendingPushLinks(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  limit: number,
): Promise<Result<PendingPushLinkRow[]>> {
  const { data, error } = await serviceClient
    .from("calendar_event_links")
    .select(`${CALENDAR_EVENT_LINK_COLUMNS}, work_blocks!inner(id, status, starts_at, ends_at, title, work_types(label))`)
    .eq("provider", provider)
    .eq("sync_status", "pending_push")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return pgErrorToCalendarResult(error);
  const rows = (data ?? []) as unknown as Array<CalendarEventLinkRow & { work_blocks: WorkBlockJoinForLink | null }>;
  return {
    ok: true,
    value: rows.map(({ work_blocks, ...link }) => ({
      ...link,
      block_status: work_blocks?.status ?? "backlog",
      block_starts_at: work_blocks?.starts_at ?? null,
      block_ends_at: work_blocks?.ends_at ?? null,
      block_title: work_blocks?.title ?? null,
      block_work_type_label: work_blocks?.work_types?.label ?? "",
    })),
  };
}

export type SyncIssueLinkRow = CalendarEventLinkRow & {
  block_id: string;
  block_title: string | null;
  block_status: WorkBlockStatus;
  block_starts_at: string | null;
  block_ends_at: string | null;
  block_work_type_label: string;
};

/** listSyncIssues (§6.2) 用。deleted_externally / conflict / orphaned の一覧 (work_blocks と JOIN)。 */
export async function listSyncIssueLinks(client: SupabaseClient): Promise<Result<SyncIssueLinkRow[]>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select(`${CALENDAR_EVENT_LINK_COLUMNS}, work_blocks!inner(id, status, starts_at, ends_at, title, work_types(label))`)
    .in("sync_status", ["deleted_externally", "conflict", "orphaned"])
    .order("updated_at", { ascending: false });
  if (error) return pgErrorToCalendarResult(error);
  const rows = (data ?? []) as unknown as Array<CalendarEventLinkRow & { work_blocks: WorkBlockJoinForLink | null }>;
  return {
    ok: true,
    value: rows.map(({ work_blocks, ...link }) => ({
      ...link,
      block_id: work_blocks?.id ?? "",
      block_title: work_blocks?.title ?? null,
      block_status: work_blocks?.status ?? "backlog",
      block_starts_at: work_blocks?.starts_at ?? null,
      block_ends_at: work_blocks?.ends_at ?? null,
      block_work_type_label: work_blocks?.work_types?.label ?? "",
    })),
  };
}

/** push の作成直前に単一 UPDATE で刻印する claim (§8.4 の push_claimed_at)。 */
export async function claimPushForLink(serviceClient: SupabaseClient, linkId: string): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({ push_claimed_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

export type MarkLinkSyncedPatch = {
  external_event_id: string;
  etag_or_change_key: string | null;
  external_updated_at: string | null;
  external_ical_uid: string | null;
  last_written_hash: string;
};

/** push 成功時の単一 UPDATE (§5.3 不変条件4/5 — 成功時のみ push_attempts を 0 リセットし
 *  push_claimed_at を NULL 化する)。 */
export async function markLinkSynced(
  serviceClient: SupabaseClient,
  linkId: string,
  patch: MarkLinkSyncedPatch,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({
      external_event_id: patch.external_event_id,
      etag_or_change_key: patch.etag_or_change_key,
      external_updated_at: patch.external_updated_at,
      external_ical_uid: patch.external_ical_uid,
      last_written_hash: patch.last_written_hash,
      last_pushed_at: new Date().toISOString(),
      sync_status: "synced",
      push_attempts: 0,
      push_claimed_at: null,
    })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** 412/409 (KMB-E721) / timeout (KMB-E724) の conflict 化。push_attempts は触らない
 *  (§5.1 手順「成功時のみリセット」— この 2 コードは確定失敗カウントの対象外)。 */
export async function markLinkConflict(
  serviceClient: SupabaseClient,
  linkId: string,
  errorCode: "KMB-E721" | "KMB-E724",
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({ sync_status: "conflict", last_error_code: errorCode })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** その他 4xx/5xx (確定エラー) の push_attempts 加算。閾値到達時のみ conflict+KMB-E723 化する。 */
export async function recordPushAttemptFailure(
  serviceClient: SupabaseClient,
  linkId: string,
  attempts: number,
  becameConflict: boolean,
): Promise<Result<void>> {
  const patch: Record<string, unknown> = { push_attempts: attempts };
  if (becameConflict) {
    patch.sync_status = "conflict";
    patch.last_error_code = "KMB-E723";
  }
  const { error } = await serviceClient.from("calendar_event_links").update(patch).eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** 外部削除検知 (§8.5)。ブロック本体は触らない (即削除禁止)。 */
export async function markLinkDeletedExternally(serviceClient: SupabaseClient, linkId: string): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({ sync_status: "deleted_externally", deleted_externally_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** フル再同期ラウンド完了時の逆方向突合 (§8.5)。未観測の link 群を一括 orphaned 化する。 */
export async function markLinksOrphaned(serviceClient: SupabaseClient, linkIds: string[]): Promise<Result<void>> {
  if (linkIds.length === 0) return { ok: true, value: undefined };
  const { error } = await serviceClient.from("calendar_event_links").update({ sync_status: "orphaned" }).in("id", linkIds);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** admin 操作 (resolveOrphanedLink の repush 等) や pull の再送要求 (P15) で使う汎用の
 *  pending_push 化。conflict+E724 のガード (§5.3 不変条件3) は呼び出し元 (sync-engine.ts の
 *  ワーカー駆動経路) が internal/sync-state.ts のガード関数で判定してから呼ぶ — これは
 *  admin の明示操作からの呼び出しまで一律に禁止すると「作成直後の kill 疑い」を人手で解除する
 *  唯一の手段が失われるため (§8.4 の findByLinkId 照合は push 側で毎回働くため、admin 操作
 *  経由での再 pending_push 化は安全)。 */
export async function markLinkPendingPush(serviceClient: SupabaseClient, linkId: string): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({ sync_status: "pending_push" })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** pull が観測した etag/icalUid/external_updated_at を記録する (§5.3 不変条件4 — 単一 UPDATE)。
 *  sync_status を省略した場合は変更しない (P18 タイトルのみ変更 — conflict 状態を黙って
 *  解除しないため)。 */
export async function applyPullObservedFields(
  serviceClient: SupabaseClient,
  linkId: string,
  patch: {
    etag_or_change_key: string | null;
    external_updated_at: string | null;
    external_ical_uid: string | null;
    sync_status?: "synced" | "pending_push";
  },
): Promise<Result<void>> {
  const updatePayload: Record<string, unknown> = {
    etag_or_change_key: patch.etag_or_change_key,
    external_updated_at: patch.external_updated_at,
    external_ical_uid: patch.external_ical_uid,
    last_pulled_at: new Date().toISOString(),
  };
  if (patch.sync_status) updatePayload.sync_status = patch.sync_status;
  const { error } = await serviceClient.from("calendar_event_links").update(updatePayload).eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** 削除待ち (external_event_id NULL の未 push リンク含む) の物理 DELETE (§8.4/§9.2)。 */
export async function deleteCalendarEventLink(serviceClient: SupabaseClient, linkId: string): Promise<Result<void>> {
  const { error } = await serviceClient.from("calendar_event_links").delete().eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** disconnectCalendar (§6.2) 用。provider 単位で links を一括物理削除する。 */
export async function deleteCalendarEventLinksForProvider(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<void>> {
  const { error } = await serviceClient.from("calendar_event_links").delete().eq("provider", provider);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/**
 * resolveExternalDeletion('repush') / resolveOrphanedLink('repush') (§6.2/§9.2/§10.4) 共通。
 * 外部イベントとの紐付け一式 (external_event_id/etag/ical_uid/hash/deleted_externally_at) を
 * 破棄して pending_push に戻す — 次回 push が createEvent から作り直す。
 */
export async function resetLinkForRepush(serviceClient: SupabaseClient, linkId: string): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({
      external_event_id: null,
      etag_or_change_key: null,
      external_ical_uid: null,
      last_written_hash: null,
      deleted_externally_at: null,
      push_attempts: 0,
      push_claimed_at: null,
      sync_status: "pending_push",
    })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/**
 * resendConflictedLink (§6.2/§8.7) 専用。conflict+KMB-E723 の「再送」— push_attempts=0 +
 * pending_push に戻すだけの軽量操作 (外部 API は呼ばない。external_event_id 等は保持したまま
 * 次回 push が updateEvent/createEvent のどちらを使うべきかを自然に再判定できるようにする)。
 */
export async function resetLinkForResend(serviceClient: SupabaseClient, linkId: string): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .update({ push_attempts: 0, sync_status: "pending_push" })
    .eq("id", linkId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/** 切断後再接続時の link 再構築 (§8.5 — disconnect→再接続後の二重イベント防止)。
 *  発見済みの外部イベントをそのまま synced として採用する。 */
export async function insertReconstructedLink(
  serviceClient: SupabaseClient,
  params: {
    work_block_id: string;
    provider: CalendarProvider;
    external_event_id: string;
    etag_or_change_key: string | null;
    external_updated_at: string | null;
    external_ical_uid: string | null;
  },
): Promise<Result<{ id: string }>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await serviceClient
    .from("calendar_event_links")
    .insert({
      work_block_id: params.work_block_id,
      provider: params.provider,
      external_event_id: params.external_event_id,
      etag_or_change_key: params.etag_or_change_key,
      external_updated_at: params.external_updated_at,
      external_ical_uid: params.external_ical_uid,
      sync_status: "synced",
      last_pulled_at: nowIso,
    })
    .select("id")
    .single();
  if (error) return pgErrorToCalendarResult(error);
  if (!data) return { ok: false, code: "KMB-E901", detail: "calendar_event_links の再構築に失敗しました" };
  return { ok: true, value: { id: data.id as string } };
}

/**
 * runCalendarMaintenance (§8.8) の「push 漏れ自己修復」対象抽出。
 * - 配置済み (scheduled/in_progress/done かつ starts_at 非 NULL) で当該 provider の link が
 *   無い、または last_pushed_at が block.updated_at より古い → push backfill 対象
 * - 削除マーク (starts_at NULL または status='cancelled') で当該 provider の link が
 *   pending_push 以外かつ external_event_id が残っている → 削除マークの取りこぼし回収
 * DB 側で NOT EXISTS の複雑な条件を組むより、対象規模が小さい (単一事業者の作業ブロック) 前提で
 * JS 側フィルタとする実装判断。
 */
export async function getWorkBlocksNeedingPushBackfill(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<string[]>> {
  const { data, error } = await serviceClient
    .from("work_blocks")
    .select("id, status, starts_at, updated_at, calendar_event_links(provider, sync_status, last_pushed_at, external_event_id)");
  if (error) return pgErrorToCalendarResult(error);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    status: WorkBlockStatus;
    starts_at: string | null;
    updated_at: string;
    calendar_event_links: Array<{
      provider: CalendarProvider;
      sync_status: EventLinkSyncStatus;
      last_pushed_at: string | null;
      external_event_id: string | null;
    }>;
  }>;

  const needsBackfill: string[] = [];
  for (const row of rows) {
    const link = row.calendar_event_links.find((l) => l.provider === provider);
    const isDeletionMark = row.starts_at === null || row.status === "cancelled";
    if (isDeletionMark) {
      if (link && link.sync_status !== "pending_push" && link.external_event_id) {
        needsBackfill.push(row.id);
      }
      continue;
    }
    if (row.status !== "scheduled" && row.status !== "in_progress" && row.status !== "done") continue;
    if (!link || (link.last_pushed_at ?? "") < row.updated_at) {
      needsBackfill.push(row.id);
    }
  }
  return { ok: true, value: needsBackfill };
}

/**
 * 汎用の pending_push upsert (placeBlock/createBlock/unscheduleBlock/cancelOpenBlocksForDeal 等の
 * facade 拡張メソッド — この Issue の担当外 — が配置/解除/キャンセル操作時に呼ぶための共通部品)。
 * (work_block_id, provider) の部分一意制約への upsert。既存行がある場合、payload に含めた
 * sync_status 列だけが更新され、external_event_id 等の他列は Postgres の upsert 意味論により
 * 変更されない (= 既存の外部イベント紐付けを保ったまま「再送待ち」にできる)。
 */
export async function upsertPendingPushLink(
  serviceClient: SupabaseClient,
  workBlockId: string,
  provider: CalendarProvider,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("calendar_event_links")
    .upsert(
      { work_block_id: workBlockId, provider, sync_status: "pending_push" },
      { onConflict: "work_block_id,provider" },
    );
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}

/**
 * フル再同期開始時のスナップショット取得 (§8.5 逆方向突合)。external_event_id が非 NULL の
 * link のみが対象 (突合は「外部に存在するはずのイベント」の消失検知のため)。
 * `sync_status in ('deleted_externally','orphaned')` は除外する — 既に「外部で削除された」
 * ことが判明済み/既に orphaned 化済みの link を再突合すると、より情報量の多い
 * deleted_externally を orphaned で上書きしてしまう (admin への誤情報) ため。
 * `sync_status='conflict' and last_error_code='KMB-E724'` (結果不明。自動再開禁止 —
 * §5.3 不変条件3) も除外する。orphaned への遷移も worker による自動処理の一種であり、
 * E724 link を worker が勝手に動かしてはならない不変条件に抵触するため。
 */
export async function listLinksWithExternalEventId(
  client: SupabaseClient,
  provider: CalendarProvider,
): Promise<Result<Array<{ id: string; external_event_id: string }>>> {
  const { data, error } = await client
    .from("calendar_event_links")
    .select("id, external_event_id, sync_status, last_error_code")
    .eq("provider", provider)
    .not("external_event_id", "is", null)
    .not("sync_status", "in", "(deleted_externally,orphaned)");
  if (error) return pgErrorToCalendarResult(error);
  const rows = (data ?? []) as Array<{
    id: string;
    external_event_id: string;
    sync_status: EventLinkSyncStatus;
    last_error_code: string | null;
  }>;
  const candidates = rows.filter((row) => !(row.sync_status === "conflict" && row.last_error_code === "KMB-E724"));
  return {
    ok: true,
    value: candidates.map((row) => ({ id: row.id, external_event_id: row.external_event_id })),
  };
}

/** pull の変更種別判定 (時刻変更 vs タイトルのみ変更 — P18) 用。work_blocks の現在の配置時刻を
 *  取得する。external_updated_at の差分だけでは「何が変わったか」は分からない
 *  (Google はタイトルのみの編集でも updated を進めるため) — 実際の starts_at/ends_at を
 *  比較することで時刻変更かどうかを正確に判定する。 */
export async function getWorkBlockTimes(
  client: SupabaseClient,
  workBlockId: string,
): Promise<Result<{ starts_at: string | null; ends_at: string | null } | null>> {
  const { data, error } = await client
    .from("work_blocks")
    .select("starts_at, ends_at")
    .eq("id", workBlockId)
    .maybeSingle();
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: (data as { starts_at: string | null; ends_at: string | null } | null) ?? null };
}

/**
 * pull が観測した外部の時刻変更を work_blocks へ反映する唯一の書込み経路 (§8.5 フィールド
 * 所有権原則: 時刻・存在は外部の直近操作が正)。service client 専用 — admin セッションからの
 * placeBlock 等 (CAS 楽観排他あり) とは別経路であり、ここでは expectedUpdatedAt を取らない
 * (外部カレンダーの直近操作を app の楽観排他と衝突させない設計判断)。
 */
export async function updateWorkBlockExternalTimeChange(
  serviceClient: SupabaseClient,
  workBlockId: string,
  startsAt: string,
  endsAt: string,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("work_blocks")
    .update({ starts_at: startsAt, ends_at: endsAt })
    .eq("id", workBlockId);
  if (error) return pgErrorToCalendarResult(error);
  return { ok: true, value: undefined };
}
