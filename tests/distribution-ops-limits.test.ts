import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getOpsLimitsForService } from "@/modules/distribution/internal/ops-limits";

/**
 * canonical: 敵対レビュー MAJOR#1/MAJOR#2 (docs/module-contracts.md §2 の共通 helper 集約)。
 * distribution/internal/worker.ts と distribution/facade.ts (schedulePosts) の両方が使う
 * getOpsLimitsForService の判別可能戻り値 (missing/invalid/ok) を、テーブル問い合わせを
 * 最小限に模した fake service client で直接検証する。
 */

const OPS_LIMITS_VALID = {
  x_monthly_post_limit: 100,
  ai_monthly_budget_micro_usd: 50_000_000,
  ai_monthly_image_limit: 200,
  ai_default_image_model: null,
};

function fakeClient(response: { data: { value: unknown } | null; error: { message: string } | null }): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "site_settings") {
        throw new Error(`fake service client: 未対応のテーブルへのアクセスです (${table})`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => response,
          }),
        }),
      };
    },
    // getOpsLimitsForService は from().select().eq().maybeSingle() しか呼ばないため、
    // SupabaseClient の他のメソッドはテストダブルとして実装不要 (unknown 経由でキャスト。
    // any は使わない — CLAUDE.md 規約)。
  } as unknown as SupabaseClient;
}

describe("getOpsLimitsForService", () => {
  it("行が存在する (value が zOpsLimits を満たす) → status:'ok' + limits を返す", async () => {
    const client = fakeClient({ data: { value: OPS_LIMITS_VALID }, error: null });
    const result = await getOpsLimitsForService(client);
    expect(result).toEqual({ status: "ok", limits: OPS_LIMITS_VALID });
  });

  it("行が存在しない (data:null) → status:'missing'", async () => {
    const client = fakeClient({ data: null, error: null });
    const result = await getOpsLimitsForService(client);
    expect(result).toEqual({ status: "missing" });
  });

  it("select 自体がエラー → status:'missing' (行不在と同じ fail-closed 経路)", async () => {
    const client = fakeClient({ data: null, error: { message: "connection error" } });
    const result = await getOpsLimitsForService(client);
    expect(result).toEqual({ status: "missing" });
  });

  it("value が zOpsLimits と一致しない (必須フィールド欠落) → status:'invalid'", async () => {
    const client = fakeClient({ data: { value: { x_monthly_post_limit: 100 } }, error: null });
    const result = await getOpsLimitsForService(client);
    expect(result).toEqual({ status: "invalid" });
  });

  it("value が null (未設定を表す不正値) → status:'invalid'", async () => {
    const client = fakeClient({ data: { value: null }, error: null });
    const result = await getOpsLimitsForService(client);
    expect(result).toEqual({ status: "invalid" });
  });
});
