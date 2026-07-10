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
 *
 * 2026-07-10 Codex MAJOR 反映: createFromBytes は Promise<Result<...>> を返す
 * (例外を境界外に漏らさない)。Storage upload 失敗・DB insert 失敗時それぞれの
 * err 化と、DB insert 失敗時のアップロード済み Storage オブジェクト削除
 * (orphan クリーンアップ) を検証する。
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
const removeOriginalBytesMock = vi.fn();
const removeRenditionsMock = vi.fn();

vi.mock("@/modules/media/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/media/repository")>("@/modules/media/repository");
  return {
    ...actual,
    uploadOriginalBytes: (...args: unknown[]) => uploadOriginalBytesMock(...args),
    uploadRendition: (...args: unknown[]) => uploadRenditionMock(...args),
    insertMediaRow: (...args: unknown[]) => insertMediaRowMock(...args),
    getMediaRow: (...args: unknown[]) => getMediaRowMock(...args),
    downloadOriginal: (...args: unknown[]) => downloadOriginalMock(...args),
    removeOriginalBytes: (...args: unknown[]) => removeOriginalBytesMock(...args),
    removeRenditions: (...args: unknown[]) => removeRenditionsMock(...args),
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
  removeOriginalBytesMock.mockResolvedValue(undefined);
  removeRenditionsMock.mockResolvedValue(undefined);
  serviceClientMock.mockReturnValue({} as unknown as SupabaseClient);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFromBytes (AI 生成画像のサーバ内直接保存)", () => {
  it("service client で原本を Storage へ直接アップロードし、media 行を INSERT して ok:true で id/storagePath を返す", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await mediaFacade.createFromBytes({
      bytes,
      contentType: "image/png",
      alt: "AI 生成画像",
      credit: "AI生成 (gpt-image-2)",
      tags: ["ai-generated", "ai-draft"],
      isPlaceholder: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toEqual(expect.any(String));
    expect(result.value.storagePath).toMatch(/^ai-generated\/.+\.png$/);

    // (a) Storage への直接アップロード (service client 経由)
    expect(serviceClientMock).toHaveBeenCalledTimes(1);
    expect(uploadOriginalBytesMock).toHaveBeenCalledTimes(1);
    const [, storagePathArg, bufferArg, contentTypeArg] = uploadOriginalBytesMock.mock.calls[0];
    expect(storagePathArg).toBe(result.value.storagePath);
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(contentTypeArg).toBe("image/png");

    // (b)(c) media 行 INSERT (tags/credit を保存)
    expect(insertMediaRowMock).toHaveBeenCalledTimes(1);
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({
      storagePath: result.value.storagePath,
      alt: "AI 生成画像",
      credit: "AI生成 (gpt-image-2)",
      tags: ["ai-generated", "ai-draft"],
      isPlaceholder: false,
      mimeType: "image/webp",
      createdBy: null,
    });

    // (d) 返り値の id は insertMediaRow に渡した id と一致する
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({ id: result.value.id });

    // レンディション (webp/jpg) も生成される
    expect(uploadRenditionMock).toHaveBeenCalledTimes(2);

    // 正常系では削除系クリーンアップは一切呼ばれない
    expect(removeOriginalBytesMock).not.toHaveBeenCalled();
    expect(removeRenditionsMock).not.toHaveBeenCalled();
  });

  it("拡張子を contentType から推定する (image/jpeg → jpg)", async () => {
    const result = await mediaFacade.createFromBytes({
      bytes: new Uint8Array([9, 9]),
      contentType: "image/jpeg",
      tags: ["ai-generated", "ai-draft"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storagePath).toMatch(/\.jpg$/);
  });

  it("alt/credit/isPlaceholder 省略時は空文字/null/false で保存する", async () => {
    await mediaFacade.createFromBytes({ bytes: new Uint8Array([1]), contentType: "image/png", tags: [] });
    expect(insertMediaRowMock.mock.calls[0][1]).toMatchObject({ alt: "", credit: null, isPlaceholder: false });
  });

  it("Storage への原本アップロードが失敗した場合は例外を投げず err (KMB-E901) を返す", async () => {
    uploadOriginalBytesMock.mockRejectedValue(new Error("network error"));

    const result = await mediaFacade.createFromBytes({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      tags: ["ai-generated"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E901");
    expect(result.detail).toContain("network error");

    // まだ何もアップロードされていないため、削除系クリーンアップは呼ばれない
    expect(insertMediaRowMock).not.toHaveBeenCalled();
    expect(removeOriginalBytesMock).not.toHaveBeenCalled();
    expect(removeRenditionsMock).not.toHaveBeenCalled();
  });

  it("DB insert が失敗した場合、アップロード済みの原本 Storage オブジェクトを削除してから err (KMB-E901) を返す", async () => {
    insertMediaRowMock.mockRejectedValue(new Error("media INSERT に失敗しました"));

    const result = await mediaFacade.createFromBytes({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      tags: ["ai-generated"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E901");

    // 原本は既にアップロード済みだったため削除される (orphan 防止)
    expect(uploadOriginalBytesMock).toHaveBeenCalledTimes(1);
    expect(removeOriginalBytesMock).toHaveBeenCalledTimes(1);
    const [, removedStoragePath] = removeOriginalBytesMock.mock.calls[0];
    const [, uploadedStoragePath] = uploadOriginalBytesMock.mock.calls[0];
    expect(removedStoragePath).toBe(uploadedStoragePath);

    // レンディションも既にアップロード済みのため、ingestMediaBuffer 内で自己クリーンアップされる
    expect(removeRenditionsMock).toHaveBeenCalledTimes(1);
    expect(removeRenditionsMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.webp$/), expect.stringMatching(/\.jpg$/)]),
    );
  });

  it("webp レンディションのアップロードが失敗した場合、jpg はまだ存在しないため webp のみ削除対象になる", async () => {
    uploadRenditionMock.mockRejectedValueOnce(new Error("webp upload failed"));

    const result = await mediaFacade.createFromBytes({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      tags: ["ai-generated"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E901");

    // レンディションが 1 つもアップロードできていないため、削除の必要が無い
    expect(removeRenditionsMock).not.toHaveBeenCalled();
    // 原本 (facade.ts が事前アップロード済み) は削除される
    expect(removeOriginalBytesMock).toHaveBeenCalledTimes(1);
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
