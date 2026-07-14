import { describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §6.5 (破損行復旧経路)。
 * issue-47.md 成果物2 / テスト戦略 #3。
 *
 * settingsFacade.getWithMeta は createSupabaseServerClient (cookie 依存) を使う
 * (settings-repository.test.ts はモジュール内 upsertSetting の直接呼び出しのため
 * fake client を関数引数で渡せたが、getWithMeta は自前で createSupabaseServerClient() を
 * 呼ぶため @/lib/supabase/server を vi.mock する必要がある。
 * tests/ai-providers-router-integration.test.ts の `vi.mock("@/lib/supabase/server", ...)`
 * 方式に倣う)。実 DB には一切触れない。
 */

type FakeRow = { key: string; value: unknown; updated_at: string } | null;

let fakeData: FakeRow = null;
let fakeError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: fakeData, error: fakeError }),
        }),
      }),
    }),
  }),
}));

import { settingsFacade } from "@/modules/settings/facade";

describe("settingsFacade.getWithMeta の §6.5 破損行復旧経路", () => {
  it("行はあるが値が契約 (SETTINGS_SCHEMAS) と不一致な場合、ok:true + corrupted:true + 生 updated_at を返す (E901 で握り潰さない)", async () => {
    fakeData = {
      key: "branding",
      value: { unknown_key: "x" },
      updated_at: "2026-07-14T00:00:00.123456+00:00",
    };
    fakeError = null;

    const result = await settingsFacade.getWithMeta("branding");

    expect(result).toEqual({
      ok: true,
      value: {
        value: null,
        updatedAt: "2026-07-14T00:00:00.123456+00:00",
        isUnset: false,
        corrupted: true,
      },
    });
  });

  it("corrupted 行では isUnset を true にしない (「未設定」と「破損」を混同させない — §6.5)", async () => {
    fakeData = {
      key: "analytics",
      value: { ga4_measurement_id: "not-a-valid-id" },
      updated_at: "2026-07-14T00:00:01.000000+00:00",
    };
    fakeError = null;

    const result = await settingsFacade.getWithMeta("analytics");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isUnset).toBe(false);
    expect(result.value.value).toBeNull();
  });

  it("corrupted 行の updatedAt に生の DB 値 (マイクロ秒精度) がそのまま入る (§6.5 が解決対象とする hidden expected_updated_at 空文字列バグの回帰防止)", async () => {
    const MICROSECOND = "2026-07-14T09:15:30.998877+00:00";
    fakeData = { key: "branding", value: { extra: 1 }, updated_at: MICROSECOND };
    fakeError = null;

    const result = await settingsFacade.getWithMeta("branding");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Date を経由すると精度が落ちる (settings-repository.test.ts と同型の回帰防止観点)。
    expect(result.value.updatedAt).toBe(MICROSECOND);
    expect(new Date(MICROSECOND).toISOString()).not.toBe(MICROSECOND);
  });

  it("正常行 (契約と一致) は従来どおり corrupted を含まず value にパース済みデータを返す (regress ゼロ確認)", async () => {
    fakeData = {
      key: "analytics",
      value: { ga4_measurement_id: "G-ABCD1234" },
      updated_at: "2026-07-14T00:00:02.000000+00:00",
    };
    fakeError = null;

    const result = await settingsFacade.getWithMeta("analytics");

    expect(result).toEqual({
      ok: true,
      value: {
        value: { ga4_measurement_id: "G-ABCD1234" },
        updatedAt: "2026-07-14T00:00:02.000000+00:00",
        isUnset: false,
      },
    });
  });

  it("行なし (未設定) は従来どおり isUnset:true / value:null / updatedAt:null を返す (regress ゼロ確認)", async () => {
    fakeData = null;
    fakeError = null;

    const result = await settingsFacade.getWithMeta("branding");

    expect(result).toEqual({
      ok: true,
      value: { value: null, updatedAt: null, isUnset: true },
    });
  });

  it("DB 側エラー (throw) は従来どおり ok:false KMB-E901 を返す (corrupted 分岐に丸め込まない)", async () => {
    fakeData = null;
    fakeError = { message: "connection refused (test stub)" };

    const result = await settingsFacade.getWithMeta("branding");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E901");
  });
});
