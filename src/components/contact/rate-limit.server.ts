import "server-only";

import { isServiceRoleConfigured } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Result } from "@/modules/platform/contracts";

import { CONTACT_FORM_RATE_LIMIT_ROUTE, computeWindowStart, isRateLimited } from "./spam-guard";

/**
 * contact フォームの rate limit 記録・判定 (cms-ai-pipeline.md §3.3)。
 * rate_limits テーブルは anon/authenticated どちらの RLS ポリシーも持たない
 * (supabase/migrations/20260708000002_rls.sql の意図的な設計 — service role 専用)。
 * そのため site-public からの唯一の直接アクセス経路として、ここで service client を使う。
 *
 * (契約との既知の乖離メモ — オーケストレーターへ報告)
 * module-contracts.md §1 のモジュール所有マトリクスに rate_limits の owner が明記されていない
 * (inquiry は contact_inquiries のみを所有テーブルとして記載)。rate_limits は
 * contact フォームの anon 保護という inquiry 隣接の関心事だが、facade 化されていないため、
 * ここでは site-public 層 (contact コンポーネント) から直接 service client でアクセスする
 * 実装とした。RateLimitFacade 相当の抽象化が必要と判断されれば module-contracts.md 更新が先。
 *
 * SUPABASE_SERVICE_ROLE_KEY 未設定時はチェックをスキップして送信を許可する
 * (fail-open。rate limit は spam 抑止目的であり認可境界ではないため、インフラ未整備を
 * 理由にフォーム自体を止めない。§1.2 graceful degradation の方針に整合)。
 */
export async function checkAndRecordRateLimit(ipHash: string, now: Date): Promise<Result<void>> {
  if (!isServiceRoleConfigured()) {
    console.warn(
      "[contact] SUPABASE_SERVICE_ROLE_KEY 未設定のため rate limit チェックをスキップします",
    );
    return { ok: true, value: undefined };
  }

  const client = createSupabaseServiceClient();
  const windowStart = computeWindowStart(now).toISOString();

  const { data: existing, error: selectError } = await client
    .from("rate_limits")
    .select("count")
    .eq("ip_hash", ipHash)
    .eq("route", CONTACT_FORM_RATE_LIMIT_ROUTE)
    .eq("window_start", windowStart)
    .maybeSingle<{ count: number }>();

  if (selectError) {
    // fail-open: rate limit チェック自体の障害でフォーム送信全体を止めない。
    console.error("[contact] rate_limits 確認に失敗しました (fail-open で許可します):", selectError);
    return { ok: true, value: undefined };
  }

  if (existing) {
    if (isRateLimited(existing.count)) {
      return { ok: false, code: "KMB-E101", detail: "rate_limit_exceeded" };
    }
    const { error: updateError } = await client
      .from("rate_limits")
      .update({ count: existing.count + 1 })
      .eq("ip_hash", ipHash)
      .eq("route", CONTACT_FORM_RATE_LIMIT_ROUTE)
      .eq("window_start", windowStart);
    if (updateError) {
      console.error("[contact] rate_limits 更新に失敗しました:", updateError);
    }
    return { ok: true, value: undefined };
  }

  const { error: insertError } = await client.from("rate_limits").insert({
    ip_hash: ipHash,
    route: CONTACT_FORM_RATE_LIMIT_ROUTE,
    window_start: windowStart,
    count: 1,
  });
  if (insertError) {
    console.error("[contact] rate_limits 作成に失敗しました:", insertError);
  }
  return { ok: true, value: undefined };
}
