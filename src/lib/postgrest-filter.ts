/**
 * PostgREST (supabase-js) のフィルタ文字列を安全に組み立てるためのヘルパ。
 *
 * `.or("name.ilike.%foo%,email.ilike.%foo%")` のような複合フィルタは 1 本の文字列として
 * PostgREST に渡され、カンマ `,` と括弧 `()` がフィルタ区切りとして解釈される。
 * 利用者入力 (検索語 q) にそれらが含まれると構文が壊れて 400 (PGRST100) になるか、
 * 意図しない条件になるため、値は必ず二重引用符で囲む (PostgREST の quoted value 規約:
 * 引用符内では `\"` と `\\` でエスケープ)。
 *
 * ilike のパターン文字 (`%` `_` `\`) のエスケープは LIKE 側の規約で、引用符とは別レイヤ。
 * 両方を順に適用するのが ilikeContainsFilter。
 */

/** LIKE / ILIKE のパターン文字 (\ % _) をバックスラッシュでエスケープする (部分一致検索用) */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * PostgREST フィルタ値を二重引用符で囲む。内部の `\` と `"` は `\\` `\"` にエスケープする。
 * 囲んだ値の中ではカンマ・括弧・ドットが区切りとして解釈されなくなる。
 */
export function quotePostgrestValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * `${column}.ilike."%${escaped}%"` 形式の部分一致フィルタ 1 項を返す。
 * 複数列を `.or()` に渡す場合は本関数の戻り値をカンマで連結する。
 */
export function ilikeContainsFilter(column: string, q: string): string {
  return `${column}.ilike.${quotePostgrestValue(`%${escapeLikePattern(q)}%`)}`;
}
