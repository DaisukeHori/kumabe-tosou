import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StyleProfileRow } from "@/modules/distribution/repository";

/**
 * canonical: docs/module-contracts.md §5 DistributionFacade.getStyleProfiles (契約書 v2.2 記載分)
 *            / GitHub Issue #20 (「ai-studio モジュールは distribution モジュールに依存できない」
 *            制約から style_profiles を BRAND_SYSTEM_PROMPT にハードコードしていた箇所の正式解)。
 *
 * getStyleProfiles() は 4 チャネル全件を必ず返す (DB に行が無いチャネルは既定値で補う)。
 * repository が失敗を返した場合は既定値へ静かにフォールバックせず、そのままエラーを伝播する
 * (「DBエラーを ok:true に無言変換しない」プロジェクト規約の検証)。
 */

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown,
}));

const listStyleProfilesMock = vi.fn();
vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    listStyleProfiles: (...args: unknown[]) => listStyleProfilesMock(...args),
  };
});

import { distributionFacade } from "@/modules/distribution/facade";

function dbRow(overrides: Partial<StyleProfileRow> = {}): StyleProfileRow {
  return {
    channel: "x",
    tone_instructions: "DB に保存された文体指示",
    format_rules: "DB に保存された構成ルール",
    example_output: "DB に保存されたお手本",
    updated_by: "admin-1",
    updated_at: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("distributionFacade.getStyleProfiles", () => {
  it("DB に行が1件も無い場合は 4 チャネル全件が既定値で埋まる", async () => {
    listStyleProfilesMock.mockResolvedValue({ ok: true, value: [] });

    const result = await distributionFacade.getStyleProfiles();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["instagram", "note", "site_blog", "x"]);
    // 既定値は空文字ではなく、旧 ai-studio DEFAULT_STYLE_PROFILES と同じ非空の指示文を持つ
    for (const channel of ["site_blog", "note", "x", "instagram"] as const) {
      expect(result.value[channel].tone_instructions.length).toBeGreaterThan(0);
      expect(result.value[channel].format_rules.length).toBeGreaterThan(0);
      expect(result.value[channel].example_output).toBeNull();
    }
  });

  it("DB に一部チャネルの行がある場合、そのチャネルは DB 値を使い、残りは既定値で補う", async () => {
    listStyleProfilesMock.mockResolvedValue({
      ok: true,
      value: [dbRow({ channel: "x", tone_instructions: "編集後のX向けトーン" })],
    });

    const result = await distributionFacade.getStyleProfiles();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.x).toEqual({
      tone_instructions: "編集後のX向けトーン",
      format_rules: "DB に保存された構成ルール",
      example_output: "DB に保存されたお手本",
    });
    // site_blog は DB に行が無いので既定値のまま (DB 値の "編集後のX向けトーン" が漏れ出さない)
    expect(result.value.site_blog.tone_instructions).not.toContain("編集後");
  });

  it("全チャネル分の行がある場合はすべて DB 値になる (example_output も含めて反映される)", async () => {
    listStyleProfilesMock.mockResolvedValue({
      ok: true,
      value: [
        dbRow({ channel: "site_blog", example_output: "site_blog お手本" }),
        dbRow({ channel: "note", example_output: "note お手本" }),
        dbRow({ channel: "x", example_output: "x お手本" }),
        dbRow({ channel: "instagram", example_output: "instagram お手本" }),
      ],
    });

    const result = await distributionFacade.getStyleProfiles();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.site_blog.example_output).toBe("site_blog お手本");
    expect(result.value.note.example_output).toBe("note お手本");
    expect(result.value.x.example_output).toBe("x お手本");
    expect(result.value.instagram.example_output).toBe("instagram お手本");
  });

  it("repository がエラーを返した場合は既定値へフォールバックせずそのままエラーを伝播する (fail-closed)", async () => {
    listStyleProfilesMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const result = await distributionFacade.getStyleProfiles();

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
  });
});
