import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { zOpsLimits, type SettingsValue } from "@/modules/settings/contracts";

export type OpsLimits = SettingsValue<"ops_limits">;

/**
 * 判別可能な戻り値 (敵対レビュー MAJOR#1)。
 * - "missing": site_settings に ops_limits 行が存在しない (未 seed の新規/リストア環境、
 *   または select 自体がエラーになった場合を含む)。
 * - "invalid": 行は存在するが value が zOpsLimits (契約) と一致しない (手動 SQL 編集ミス等)。
 * - "ok": 正常に読めた。
 * 呼び出し元 (worker.ts / distribution/facade.ts schedulePosts) はこれを使い分けて
 * 「真の上限超過 (KMB-E505)」と「上限が確認できない (KMB-E901)」を区別する。
 */
export type OpsLimitsResult =
  | { status: "ok"; limits: OpsLimits }
  | { status: "missing" }
  | { status: "invalid" };

/**
 * migration 20260711000021 (site_settings anon SELECT の許可リスト化 — ops_limits は非公開キー)
 * 適用後、settingsFacade.get() は createSupabaseServerClient() (cookie セッション) を内部で
 * 固定生成するため、無セッション文脈からは常に匿名評価 (is_admin()=false) になり ops_limits が
 * 読めなくなる。/api/jobs/publish は pg_cron → net.http_post の無セッション webhook
 * (x-jobs-secret のみで認証) であり、この呼び出し元がまさにそれに該当する
 * (src/modules/ai-studio/facade.ts の同名キー読み取りは requireAdmin() 経由の管理画面セッション
 * 文脈のみなので影響を受けない)。
 * src/modules/inquiry/internal/notify.ts と同じ方針で、facade を経由せず呼び出し元から渡された
 * service client (RLS を bypass する) で site_settings を直接読む。
 *
 * distribution/internal/worker.ts と distribution/facade.ts (schedulePosts) の両方から
 * 使う共通 helper (敵対レビュー MAJOR#1/MAJOR#2: 同じ fail-closed ロジックを 1 箇所に集約し、
 * schedulePosts 側の Infinity フォールバック [事実上の fail-open] を無くす)。
 */
export async function getOpsLimitsForService(client: SupabaseClient): Promise<OpsLimitsResult> {
  const { data, error } = await client
    .from("site_settings")
    .select("value")
    .eq("key", "ops_limits")
    .maybeSingle<{ value: unknown }>();
  if (error || !data) {
    console.warn(
      "[KMB-E901] site_settings.ops_limits の取得に失敗しました。呼び出し元は安全側 (投稿ブロック) にフォールバックします:",
      error?.message ?? "行が存在しません (未設定)",
    );
    return { status: "missing" };
  }
  const parsed = zOpsLimits.safeParse(data.value);
  if (!parsed.success) {
    console.warn(
      "[KMB-E901] site_settings.ops_limits が契約 (zOpsLimits) と一致しません。" +
        "呼び出し元は安全側 (投稿ブロック) にフォールバックします。",
    );
    return { status: "invalid" };
  }
  return { status: "ok", limits: parsed.data };
}
