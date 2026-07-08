import { createSupabaseServerClient } from "./server";

/**
 * 「現在ログイン中のユーザー (auth.users) を取得する」だけの汎用ヘルパ。
 * profiles (admin 判定) を見るわけではないため platform モジュール固有のロジックではなく、
 * server.ts / service.ts と同じ「共通 Supabase infra」として src/lib/supabase/ に置く
 * (module-contracts.md §2 の ESLint 境界ルールは @/modules/*\/repository の直接 import を
 *  禁止しているため、複数モジュールから使う汎用処理はここに置くのが正しい置き場所)。
 */
export async function getSessionAndClient() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}
