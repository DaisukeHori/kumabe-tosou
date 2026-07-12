import { describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §4.1。
 *
 * settingsFacade.getPublicValue の**実装** (fetchPublicSettingRaw / getSettingRow /
 * SETTINGS_SCHEMAS.safeParse) を検証する。site-metadata-resolver.test.ts / icon-route.test.ts は
 * いずれも settings facade 全体を vi.mock しているため、getPublicValue の実ロジックは
 * どこからも直接検証されていなかった。
 *
 * unstable_cache (next/cache) はプレーン vitest (node) 環境では
 * "Invariant: incrementalCache missing" で例外になる (page-media-text-resolver.test.ts の
 * 既知の制約と同型)。ここでは next/cache をキャッシュなしのパススルーにモックして
 * fetchPublicSettingRaw 自体のロジックを検証する (visual-actions.test.ts の next/cache モック
 * 方式に倣う)。@/lib/supabase/public も createSupabasePublicClient (cookie 非依存 anon client) を
 * フェイクに差し替え、実 DB には触れない (page-media-resolver.test.ts の vi.mock 方式に倣う)。
 */

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

type FakeResponse = { data: { key: string; value: unknown; updated_at: string } | null; error: { message: string } | null };

let fakeResponse: FakeResponse = { data: null, error: null };
let lastKeyArg: string | null = null;

vi.mock("@/lib/supabase/public", () => ({
  createSupabasePublicClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, value: string) => {
          lastKeyArg = value;
          return { maybeSingle: async () => fakeResponse };
        },
      }),
    }),
  }),
}));

import { settingsFacade } from "@/modules/settings/facade";

describe("settingsFacade.getPublicValue (実装、cookie非依存 client 経由)", () => {
  it("行なし (data: null) の場合、ok:true value:null を返す (未設定は正常系 — E901 にしない)", async () => {
    fakeResponse = { data: null, error: null };

    const result = await settingsFacade.getPublicValue("analytics");

    expect(result).toEqual({ ok: true, value: null });
    expect(lastKeyArg).toBe("analytics");
  });

  it("行ありかつ契約 (SETTINGS_SCHEMAS) に一致する値なら ok:true でパース済み値を返す", async () => {
    fakeResponse = {
      data: { key: "analytics", value: { ga4_measurement_id: "G-ABCD1234" }, updated_at: "2026-07-12T00:00:00.000000+00:00" },
      error: null,
    };

    const result = await settingsFacade.getPublicValue("analytics");

    expect(result).toEqual({ ok: true, value: { ga4_measurement_id: "G-ABCD1234" } });
  });

  it("行ありだが契約と不一致 (safeParse 失敗) なら ok:false KMB-E901 を返す (無言で null 化しない)", async () => {
    fakeResponse = {
      data: { key: "analytics", value: { ga4_measurement_id: "not-a-valid-ga-id" }, updated_at: "2026-07-12T00:00:00.000000+00:00" },
      error: null,
    };

    const result = await settingsFacade.getPublicValue("analytics");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E901");
  });

  it("DB 側がエラーを返した場合 (getSettingRow が throw) も ok:false KMB-E901 を返す (無言で握り潰さない)", async () => {
    fakeResponse = { data: null, error: { message: "connection refused (test stub)" } };

    const result = await settingsFacade.getPublicValue("branding");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E901");
  });
});
