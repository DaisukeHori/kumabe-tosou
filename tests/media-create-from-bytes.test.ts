import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/ai-studio-v2.md §4 (画像生成カスケード。生成画像の media 保存は
 * MediaFacade.createFromBytes 経由)。オーケストレーター指示 (2026-07-10):
 *   - createFromBytes が (a) Storage upload を呼び (b) media 行を insert し (c) tags/credit を
 *     保存し (d) id を返すこと
 *   - completeUpload (既存のクライアントアップロード確定経路) が壊れていないこと (回帰確認)
 *
 * completeUpload/createFromBytes は共に internal/media-ingest.ts の ingestMediaBuffer を
 * 共有する (insert ロジックの重複実装禁止)。ここでは repository/image-processing を
 * モックし、facade 経由でその実装 (ingestMediaBuffer は実体のまま) を検証する。
 */

const processImageForRenditionsMock = vi.fn();
vi.mock("@/modules/media/internal/image-processing", () => ({
  processImageForRenditions: (...args: unknown[]) => processImageForRenditionsMock(...args),
  processImageToJpeg: vi.fn(),
}));

const uploadOriginalBytesMock = vi.fn();
const uploadRenditionMock = vi.fn();
const insertMediaRowMock = vi.fn();
const getMediaRowMock = vi.fn();
const downloadOriginalMock = vi.fn();

vi.mock("@/modules/media/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/media/repository")>("@/modules/media/repository");
  return {
    ...actual,
    uploadOriginalBytes: (...args: unknown[]) => uploadOriginalBytesMock(...args),
    uploadRendition: (...args: unknown[]) => uploadRenditionMock(...args),
    insertMediaRow: (...args: unknown[]) => insertMediaRowMock(...args),
    getMediaRow: (...args: unknown[]) => getMediaRowMock(...args),
    downloadOriginal: (...args: unknown[]) => downloadOriginalMock(...args),
  };
});

const serviceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => serviceClientMock(...args),
}));

const sessionMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => sessionMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown as SupabaseClient,
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }),
}));

import { mediaFacade } from "@/modules/media/facade";

beforeEach(() => {
  vi.clearAllMocks();
  processImageForRenditionsMock.mockResolvedValue({
    webp: Buffer.from("webp-bytes"),
    jpeg: Buffer.from("jpeg-bytes"),
    width: 800,
    height: 600,
  });
  uploadOriginalBytesMock.mockResolvedValue(undefined);
  uploadRenditionMock.mockResolvedValue(undefined);
  insertMediaRowMock.mockResolvedValue(undefined);
  serviceClientMock.mockReturnValue({} as unknown as SupabaseClient);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFromBytes (AI 生成画像のサーバ内直接保存)", () => {
  it("service client で原本を Storage へ直接アップロードし、media 行を INSERT して id/storagePath を返す", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await mediaFacade.createFromBytes({
      bytes,
      contentType: "image/png",
      alt: "AI 生成画像",
      credit: "AI生成 (gpt-image-2)",
      tags: ["ai-generated", "ai-draft"],
      isPlaceholder: false,
    });

    expect(result.id).toEqual(expect.any(String));
    expect(result.storagePath).toMatch(/^ai-generated\/.+\.png$/);

    // (a) Storage への直接アップロード (service client 経由)
    expect(serviceClientMock).toHaveBeenCalledTimes(1);
    expect(uploadOriginalBytesMock).toHaveBeenCalledTimes(1);
    const [, storagePathArg, bufferArg, contentTypeArg] = uploadOriginalBytesMock.mock.calls[0];
    expect(storagePathArg).toBe(result.storagePath);
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(contentTypeArg).toBe("image/png");

    // (b)(c) media 行 INSERT (tags/credit を保存)
    expect(insertMediaRowMock).toHaveBeenCalledTimes(1);
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({
      storagePath: result.storagePath,
      alt: "AI 生成画像",
      credit: "AI生成 (gpt-image-2)",
      tags: ["ai-generated", "ai-draft"],
      isPlaceholder: false,
      mimeType: "image/webp",
      createdBy: null,
    });

    // (d) 返り値の id は insertMediaRow に渡した id と一致する
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({ id: result.id });

    // レンディション (webp/jpg) も生成される
    expect(uploadRenditionMock).toHaveBeenCalledTimes(2);
  });

  it("拡張子を contentType から推定する (image/jpeg → jpg)", async () => {
    const result = await mediaFacade.createFromBytes({
      bytes: new Uint8Array([9, 9]),
      contentType: "image/jpeg",
      tags: ["ai-generated", "ai-draft"],
    });
    expect(result.storagePath).toMatch(/\.jpg$/);
  });

  it("alt/credit/isPlaceholder 省略時は空文字/null/false で保存する", async () => {
    await mediaFacade.createFromBytes({ bytes: new Uint8Array([1]), contentType: "image/png", tags: [] });
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({ alt: "", credit: null, isPlaceholder: false });
  });
});

describe("completeUpload (既存のクライアントアップロード確定経路。回帰確認)", () => {
  it("原本を DL してレンディション生成 + media 行 INSERT する経路が保たれている", async () => {
    sessionMock.mockResolvedValue({ supabase: {} as unknown as SupabaseClient, user: { id: "admin-1" } });
    downloadOriginalMock.mockResolvedValue(Buffer.from("original-bytes"));
    getMediaRowMock.mockResolvedValue({
      id: "media-x",
      storage_path: "uploads/x.png",
      alt: "テスト画像",
      width: 800,
      height: 600,
      mime_type: "image/webp",
      credit: null,
      is_placeholder: false,
      tags: ["site"],
      created_by: "admin-1",
      created_at: "2026-07-10T00:00:00.000Z",
    });

    const result = await mediaFacade.completeUpload({
      storagePath: "uploads/x.png",
      alt: "テスト画像",
      credit: null,
      tags: ["site"],
      isPlaceholder: false,
    });

    expect(result.ok).toBe(true);
    expect(downloadOriginalMock).toHaveBeenCalledWith(expect.anything(), "uploads/x.png");
    expect(insertMediaRowMock).toHaveBeenCalledTimes(1);
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({
      storagePath: "uploads/x.png",
      alt: "テスト画像",
      tags: ["site"],
      createdBy: "admin-1",
    });
    expect(uploadRenditionMock).toHaveBeenCalledTimes(2); // webp + jpg
  });

  it("未ログインは KMB-E201 を返す", async () => {
    sessionMock.mockResolvedValue({ supabase: {} as unknown as SupabaseClient, user: null });
    const result = await mediaFacade.completeUpload({
      storagePath: "uploads/x.png",
      alt: "a",
      credit: null,
      tags: [],
      isPlaceholder: false,
    });
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
  });

  it("入力検証エラー (tags 上限超過等) は KMB-E101 を返す", async () => {
    sessionMock.mockResolvedValue({ supabase: {} as unknown as SupabaseClient, user: { id: "admin-1" } });
    const result = await mediaFacade.completeUpload({
      storagePath: "uploads/x.png",
      alt: "a",
      credit: null,
      tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`), // max 10
      isPlaceholder: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E101");
    expect(insertMediaRowMock).not.toHaveBeenCalled();
  });
});
