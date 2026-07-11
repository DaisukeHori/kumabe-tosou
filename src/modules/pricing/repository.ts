import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  PriceGrade,
  PriceGradeInput,
  PriceMatrixCell,
  PriceMatrixCellInput,
  PriceOption,
  PriceOptionInput,
  PriceSizeClass,
  PriceSizeClassInput,
  PriceTable,
  QuantityTier,
  QuantityTierInput,
} from "./contracts";

/**
 * pricing モジュールの repository (契約書 §3: 所有テーブルへの DB アクセス)。
 * 他モジュール・admin UI からの直接 import は ESLint (no-restricted-imports) で禁止されており、
 * 必ず facade.ts 経由で参照する。
 *
 * anon SELECT は price_grades/price_size_classes/price_matrix/price_quantity_tiers/
 * price_options いずれも RLS で許可されている (migration 20260708000001/20260708000007)。
 *
 * ---- 🔴 本番 /shop fallback の真因と client の使い分け (#38) ----
 * getPriceTable の読み取り側は、呼び出しコンテキストで client を使い分ける (getPriceTable 内で分岐):
 *  - activeOnly=true  … 公開サイト /shop の unstable_cache 経由読み取り。
 *    createSupabaseServerClient は next/headers の cookies() に依存するため、
 *    **unstable_cache() 内部で呼ぶと Next.js が実行時エラーにする** (src/lib/supabase/public.ts の
 *    コメント参照)。従来これを server client で呼んでいたため常に例外→facade で握りつぶし→
 *    priceTable=null→ShopSimulator が「価格はお問い合わせください。」fallback を表示していた
 *    (これが #38 の焼き付きに見えていた本当の原因。Data Cache の問題ではなかった)。
 *    そのため cookie 非依存の createSupabasePublicClient (anon) を使う。anon RLS は
 *    is_active=true 行のみ許可だが、公開読み取りは activeOnly=true なので過不足なし。
 *  - activeOnly=false … admin (/admin/prices) の全件読み取り。is_active=false の行は
 *    anon RLS では見えず public.is_admin() ポリシー越しにのみ読めるため、cookie セッションを
 *    伴う createSupabaseServerClient が必須。admin は実リクエスト文脈なので cookies() は正常。
 *
 * 書き込み (upsert 系 / replace 系) は admin 専用で is_admin() ポリシーが必要なため引き続き
 * createSupabaseServerClient (cookie セッション) を使う。
 */

const GRADE_COLUMNS = "id, key, label, description, sort_order, is_active, updated_at";
const SIZE_COLUMNS = "key, label, max_mm, quote_only, sort_order";
const MATRIX_COLUMNS = "grade_key, size_key, price_min, price_max";
const TIER_COLUMNS = "min_qty, discount_rate, label";
const OPTION_COLUMNS = "id, key, label, kind, value, sort_order, is_active, updated_at";

export async function getPriceTable(opts: { activeOnly: boolean }): Promise<PriceTable> {
  // activeOnly=true は unstable_cache 経由の公開読み取り (cookies() を呼べない文脈) のため
  // cookie 非依存の public client を使う。activeOnly=false は admin 全件読み取りで
  // is_active=false 行を is_admin() RLS 越しに読むためセッション付き server client が必須。
  const supabase = opts.activeOnly
    ? createSupabasePublicClient()
    : await createSupabaseServerClient();

  let gradesQuery = supabase.from("price_grades").select(GRADE_COLUMNS);
  if (opts.activeOnly) gradesQuery = gradesQuery.eq("is_active", true);
  const gradesRes = await gradesQuery.order("sort_order", { ascending: true });
  if (gradesRes.error) {
    throw new Error(`price_grades 取得に失敗しました: ${gradesRes.error.message}`);
  }

  const sizesRes = await supabase
    .from("price_size_classes")
    .select(SIZE_COLUMNS)
    .order("sort_order", { ascending: true });
  if (sizesRes.error) {
    throw new Error(`price_size_classes 取得に失敗しました: ${sizesRes.error.message}`);
  }

  const matrixRes = await supabase.from("price_matrix").select(MATRIX_COLUMNS);
  if (matrixRes.error) {
    throw new Error(`price_matrix 取得に失敗しました: ${matrixRes.error.message}`);
  }

  const tiersRes = await supabase
    .from("price_quantity_tiers")
    .select(TIER_COLUMNS)
    .order("min_qty", { ascending: true });
  if (tiersRes.error) {
    throw new Error(`price_quantity_tiers 取得に失敗しました: ${tiersRes.error.message}`);
  }

  let optionsQuery = supabase.from("price_options").select(OPTION_COLUMNS);
  if (opts.activeOnly) optionsQuery = optionsQuery.eq("is_active", true);
  const optionsRes = await optionsQuery.order("sort_order", { ascending: true });
  if (optionsRes.error) {
    throw new Error(`price_options 取得に失敗しました: ${optionsRes.error.message}`);
  }

  return {
    grades: (gradesRes.data ?? []) as PriceGrade[],
    size_classes: (sizesRes.data ?? []) as PriceSizeClass[],
    matrix: (matrixRes.data ?? []) as PriceMatrixCell[],
    quantity_tiers: (tiersRes.data ?? []) as QuantityTier[],
    options: (optionsRes.data ?? []) as PriceOption[],
  };
}

/** 楽観排他 (KMB-E103) 検知時に投げる印。facade 層で判定してエラーコードへ変換する。 */
export class OptimisticLockError extends Error {
  constructor() {
    super("CONFLICT");
  }
}

export async function upsertGrade(
  input: PriceGradeInput,
  id: string | null,
  expectedUpdatedAt: string | null,
): Promise<{ id: string; updated_at: string }> {
  const supabase = await createSupabaseServerClient();
  const row = {
    key: input.key,
    label: input.label,
    description: input.description,
    sort_order: input.sort_order,
    is_active: input.is_active,
  };

  if (id) {
    let query = supabase.from("price_grades").update(row).eq("id", id);
    if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select("id, updated_at").maybeSingle();
    if (error) throw new Error(`price_grades 更新に失敗しました: ${error.message}`);
    if (!data) throw new OptimisticLockError();
    return data;
  }

  const { data, error } = await supabase
    .from("price_grades")
    .insert(row)
    .select("id, updated_at")
    .single();
  if (error || !data) {
    throw new Error(`price_grades 作成に失敗しました: ${error?.message}`);
  }
  return data;
}

export async function upsertOption(
  input: PriceOptionInput,
  id: string | null,
): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const row = {
    key: input.key,
    label: input.label,
    kind: input.kind,
    value: input.value,
    sort_order: input.sort_order,
    is_active: input.is_active,
  };

  if (id) {
    const { data, error } = await supabase
      .from("price_options")
      .update(row)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`price_options 更新に失敗しました: ${error.message}`);
    if (!data) throw new Error("price_options 更新対象が見つかりません");
    return data;
  }

  const { data, error } = await supabase
    .from("price_options")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`price_options 作成に失敗しました: ${error?.message}`);
  }
  return data;
}

async function deleteRemoved<T>(
  supabase: SupabaseClient,
  table: string,
  column: string,
  existing: T[],
  keep: Set<T>,
) {
  const toDelete = existing.filter((v) => !keep.has(v));
  if (toDelete.length === 0) return;
  const { error } = await supabase.from(table).delete().in(column, toDelete as (string | number)[]);
  if (error) throw new Error(`${table} の削除に失敗しました: ${error.message}`);
}

export async function replaceSizeClasses(input: PriceSizeClassInput[]): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: selectError } = await supabase
    .from("price_size_classes")
    .select("key");
  if (selectError) {
    throw new Error(`price_size_classes 取得に失敗しました: ${selectError.message}`);
  }

  await deleteRemoved(
    supabase,
    "price_size_classes",
    "key",
    (existing ?? []).map((r) => r.key as string),
    new Set(input.map((s) => s.key)),
  );

  if (input.length > 0) {
    const { error } = await supabase.from("price_size_classes").upsert(input, { onConflict: "key" });
    if (error) throw new Error(`price_size_classes 保存に失敗しました: ${error.message}`);
  }
}

export async function replaceMatrix(input: PriceMatrixCellInput[]): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: selectError } = await supabase
    .from("price_matrix")
    .select("grade_key, size_key");
  if (selectError) {
    throw new Error(`price_matrix 取得に失敗しました: ${selectError.message}`);
  }

  const newKeySet = new Set(input.map((c) => `${c.grade_key}::${c.size_key}`));
  const toDelete = (existing ?? []).filter(
    (r) => !newKeySet.has(`${r.grade_key}::${r.size_key}`),
  );
  for (const row of toDelete) {
    const { error } = await supabase
      .from("price_matrix")
      .delete()
      .eq("grade_key", row.grade_key)
      .eq("size_key", row.size_key);
    if (error) throw new Error(`price_matrix の削除に失敗しました: ${error.message}`);
  }

  if (input.length > 0) {
    const { error } = await supabase
      .from("price_matrix")
      .upsert(input, { onConflict: "grade_key,size_key" });
    if (error) throw new Error(`price_matrix 保存に失敗しました: ${error.message}`);
  }
}

export async function replaceQuantityTiers(input: QuantityTierInput[]): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: selectError } = await supabase
    .from("price_quantity_tiers")
    .select("min_qty");
  if (selectError) {
    throw new Error(`price_quantity_tiers 取得に失敗しました: ${selectError.message}`);
  }

  await deleteRemoved(
    supabase,
    "price_quantity_tiers",
    "min_qty",
    (existing ?? []).map((r) => r.min_qty as number),
    new Set(input.map((t) => t.min_qty)),
  );

  if (input.length > 0) {
    const { error } = await supabase
      .from("price_quantity_tiers")
      .upsert(input, { onConflict: "min_qty" });
    if (error) throw new Error(`price_quantity_tiers 保存に失敗しました: ${error.message}`);
  }
}
