import { describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §4.2。
 *
 * mediaFacade.getPublicJpegUrl の**実装**を検証する (site-metadata-resolver.test.ts /
 * icon-route.test.ts はいずれも media facade 全体を vi.mock しているため、getPublicJpegUrl の
 * 実ロジック (buildDeterministicPublicJpegUrl) 自体はどこからも直接検証されていなかった)。
 *
 * getEnv() (NEXT_PUBLIC_SUPABASE_URL) を @/lib/env ごとモックし、実 DB / 実 env に依存せず
 * URL 組み立てロジックのみを検証する (public-content-media.test.ts / page-media-resolver.test.ts
 * の vi.mock 方式に倣う)。
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  }),
}));

import { mediaFacade } from "@/modules/media/facade";

const MEDIA_ID = "11111111-1111-1111-1111-111111111111";

describe("mediaFacade.getPublicJpegUrl", () => {
  it("{SUPABASE_URL}/storage/v1/object/public/media/{id}.jpg の決定論 URL を返す", () => {
    const result = mediaFacade.getPublicJpegUrl(MEDIA_ID);

    expect(result).toEqual({
      ok: true,
      value: `https://example-project.supabase.co/storage/v1/object/public/media/${MEDIA_ID}.jpg`,
    });
  });

  it("getPublicUrl (webp) と拡張子以外は完全に同型の URL を返す (§4.2: 既存 getPublicUrl の挙動を1文字も変えない)", () => {
    const webpResult = mediaFacade.getPublicUrl(MEDIA_ID);
    const jpegResult = mediaFacade.getPublicJpegUrl(MEDIA_ID);

    expect(webpResult.ok).toBe(true);
    expect(jpegResult.ok).toBe(true);
    if (!webpResult.ok || !jpegResult.ok) return;

    expect(webpResult.value.replace(/\.webp$/, "")).toBe(jpegResult.value.replace(/\.jpg$/, ""));
    expect(webpResult.value.endsWith(".webp")).toBe(true);
    expect(jpegResult.value.endsWith(".jpg")).toBe(true);
  });

  it("末尾スラッシュ付き NEXT_PUBLIC_SUPABASE_URL でも二重スラッシュにならない", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      getEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co/" }),
    }));
    const { mediaFacade: reloadedFacade } = await import("@/modules/media/facade");

    const result = reloadedFacade.getPublicJpegUrl(MEDIA_ID);

    expect(result).toEqual({
      ok: true,
      value: `https://example-project.supabase.co/storage/v1/object/public/media/${MEDIA_ID}.jpg`,
    });
  });
});
