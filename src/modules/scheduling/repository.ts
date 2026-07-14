import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Paged, Pagination } from "@/modules/platform/contracts";

import type {
  BlockTransition,
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

const WORK_BLOCK_JOIN_COLUMNS = `${WORK_BLOCK_COLUMNS}, work_types(key, label, color)`;

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

/** cancelOpenBlocksForDeal 用の一括 UPDATE。backlog/scheduled のみ対象 (in_progress/done は除外 — WHERE 句)。 */
export async function cancelOpenWorkBlocksForDeal(dealId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_blocks")
    .update({ status: "cancelled" })
    .eq("deal_id", dealId)
    .in("status", ["backlog", "scheduled"])
    .select("id");
  if (error) throwTypedPgError(error);
  return (data ?? []).length;
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
