import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { WorkTemplateInput, WorkTemplateView, WorkTypeInput, WorkTypeRow } from "./contracts";
import type {
  BlockDraft,
  TemplateExpandTemplate,
  TemplateExpandTemplateItem,
  TemplateExpandWorkType,
} from "./internal/template-expand";

/**
 * scheduling モジュールの repository (03-scheduling.md §2.2 の DDL への唯一の直接クエリ経路)。
 * この Issue (#52) の対象は work_types / work_templates / work_template_items の CRUD と、
 * generateBlocksFromLines 用の work_blocks 一括 INSERT のみ。
 *
 * 全関数は admin セッション client (`createSupabaseServerClient`) のみを使う
 * (Issue 本文: 「この Issue の対象メソッドはいずれも admin セッション実行のみ」)。
 * pricing/repository.ts の作法 (OptimisticLockError を throw し facade が catch して
 * Result に変換する) を踏襲する — crm/repository.ts のように client を注入して
 * Result を直接返す作法は、本 Issue の対象メソッドが全て単一 client (session) しか
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
 *  / saveWorkTemplate の work_type_key 解決不能 → facade が KMB-E702 に変換 */
export class ForeignKeyViolationError extends Error {}

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
// work_blocks (この Issue では generateBlocksFromLines の一括 INSERT のみ。CRUD は #53)
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
