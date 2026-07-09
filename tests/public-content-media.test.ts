import { describe, expect, it, vi } from "vitest";

/**
 * 回帰テスト (V0 hotfix): 公開サイト側の media 解決ヘルパー toPublicMediaRef() が
 * media facade の決定論レンディション URL (`{id}.webp`) を返すことを検証する。
 *
 * canonical: docs/design/visual-media-editor.md §2.3。
 * 本番実測で `storage_path` 直の Storage URL は 400 になることが判明したバグの再発防止。
 *
 * getEnv() (NEXT_PUBLIC_SUPABASE_URL 等) を @/lib/env ごとモックし、実 DB / 実 env に
 * 依存せず URL 組み立てロジックのみを検証する (settings-repository.test.ts のフェイク方式に
 * ならい、外側の依存を最小限のスタブに差し替える。vi.mock は vitest によりファイル先頭へ
 * 巻き上げられるため、下の import 文より先に評価される)。
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  }),
}));

import { toPublicMediaRef } from "@/app/_lib/media";
import { mediaFacade } from "@/modules/media/facade";

const SUPABASE_URL = "https://example-project.supabase.co";
const MEDIA_ID = "11111111-1111-1111-1111-111111111111";

describe("toPublicMediaRef", () => {
  it("media id から決定論レンディション URL ({SUPABASE_URL}/storage/v1/object/public/media/{id}.webp) を組み立てる", () => {
    const ref = toPublicMediaRef({
      id: MEDIA_ID,
      alt: "施工事例の写真",
      is_placeholder: false,
    });

    expect(ref).toEqual({
      id: MEDIA_ID,
      url: `${SUPABASE_URL}/storage/v1/object/public/media/${MEDIA_ID}.webp`,
      alt: "施工事例の写真",
      isPlaceholder: false,
    });
  });

  it("storage_path 由来の URL は組み立てない (旧実装の 400 バグの再発防止)", () => {
    const ref = toPublicMediaRef({
      id: MEDIA_ID,
      alt: "施工事例の写真",
      is_placeholder: false,
    });

    expect(ref?.url).not.toContain("seed/works");
    expect(ref?.url.endsWith(`${MEDIA_ID}.webp`)).toBe(true);
  });

  it("alt / is_placeholder をそのままパススルーする (isPlaceholder に camelCase 変換)", () => {
    const ref = toPublicMediaRef({
      id: MEDIA_ID,
      alt: "仮素材の写真",
      is_placeholder: true,
    });

    expect(ref?.alt).toBe("仮素材の写真");
    expect(ref?.isPlaceholder).toBe(true);
  });

  it("row が null/undefined のときは null を返す", () => {
    expect(toPublicMediaRef(null)).toBeNull();
    expect(toPublicMediaRef(undefined)).toBeNull();
  });

  it("mediaFacade.getPublicUrl が Result 失敗を返した場合は throw する (silent fallback しない)", () => {
    const spy = vi.spyOn(mediaFacade, "getPublicUrl").mockReturnValueOnce({
      ok: false,
      code: "KMB-E901",
      detail: "env 未設定 (テスト用スタブ)",
    });

    try {
      expect(() =>
        toPublicMediaRef({
          id: MEDIA_ID,
          alt: "施工事例の写真",
          is_placeholder: false,
        }),
      ).toThrow(/公開 URL 生成に失敗しました/);
    } finally {
      spy.mockRestore();
    }
  });
});
