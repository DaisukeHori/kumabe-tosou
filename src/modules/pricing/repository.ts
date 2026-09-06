import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  PriceGrade,
  PriceMatrixCell,
  PriceOption,
  PriceSizeClass,
  PriceTable,
  PricingReplaceInput,
  QuantityTier,
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
 * 書き込み (replacePricingAll → pricing_replace_all RPC) は admin 専用で is_admin() ガードが必要なため
 * 引き続き createSupabaseServerClient (cookie セッション) を使う。
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

/**
 * pricing_replace_all RPC (migration 20260906000010) が `raise exception 'KMB-Exxx: ...'` で返した
 * エラーを facade 層で Result のコードに変換するための印。RPC 内で判定する楽観排他 (E103) と
 * 入力不備 (E101) はここ経由で伝播し、それ以外の DB エラーは通常の Error (→ E901) のまま。
 */
export class PricingRpcError extends Error {
  constructor(
    readonly code: "KMB-E101" | "KMB-E103" | "KMB-E202",
    message: string,
  ) {
    super(message);
  }
}

/**
 * /admin/prices の一括保存: 5 テーブル (grades/sizes/matrix/tiers/options) の置換を
 * security definer RPC pricing_replace_all(jsonb) に 1 回で委ね、単一トランザクションで確定する。
 * 従来の「テーブルごとに別々の PostgREST 呼び出し」は途中失敗で部分書き込みが残る非原子構造
 * だったため廃止した (レビュー指摘)。is_admin() ガードは RPC 側にあり、cookie セッション付き
 * server client (authenticated ロール) で呼ぶ。
 */
export async function replacePricingAll(input: PricingReplaceInput): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("pricing_replace_all", { p_payload: input });
  if (!error) return;

  const kmb = /KMB-E(\d{3})/.exec(error.message ?? "");
  if (kmb?.[1] === "103") throw new PricingRpcError("KMB-E103", error.message);
  if (kmb?.[1] === "101") throw new PricingRpcError("KMB-E101", error.message);
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) {
    throw new PricingRpcError("KMB-E202", error.message);
  }
  throw new Error(`価格表の保存 (pricing_replace_all) に失敗しました: ${error.message}`);
}
