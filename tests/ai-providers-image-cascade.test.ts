import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ImageGenerationRow } from "@/modules/ai-providers/repository";

/**
 * canonical: docs/design/ai-studio-v2.md §4 (画像生成カスケード)。
 *
 * facade 層 (generateImageCascade / markImageSelected / getImageGenerationBreadcrumb /
 * cleanupAiDraftMedia) を、repository・router・media facade・session をすべてモックして検証する。
 *   - 4 枚それぞれを media 保存 + ai_image_generations に 1 行 1 画像で記録すること
 *   - カスケード (parentId 指定) 時に親の media が sourceImages へ自動合成され、
 *     parent_id/root_id が継承され、sources にも記録されること
 *   - 予算超過 (KMB-E407) 時は media 保存を一切試みないこと
 *
 * repository 層の実装そのもの (root_id 自己参照規約等) は
 * tests/ai-providers-image-lineage.test.ts で検証する (同一ファイルで実装テストと
 * モックテストは両立できないため意図的に分離)。
 */

const sessionMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => sessionMock(...args),
}));

const serviceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => serviceClientMock(...args),
}));

const createFromBytesMock = vi.fn();
const getPublicUrlMock = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: {
    createFromBytes: (...args: unknown[]) => createFromBytesMock(...args),
    getPublicUrl: (...args: unknown[]) => getPublicUrlMock(...args),
  },
}));

const routeGenerateImagesMock = vi.fn();
vi.mock("@/modules/ai-providers/internal/router", () => ({
  routeGenerateImages: (...args: unknown[]) => routeGenerateImagesMock(...args),
  routeGenerateText: vi.fn(),
  routeTranscribe: vi.fn(),
}));

const insertImageGenerationRowMock = vi.fn();
const insertImageGenerationSourcesMock = vi.fn();
const getImageGenerationRowMock = vi.fn();
const findUsageLogIdByRefMock = vi.fn();
const markImageGenerationSelectedMock = vi.fn();
const runAiDraftCleanupMock = vi.fn();

vi.mock("@/modules/ai-providers/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ai-providers/repository")>(
    "@/modules/ai-providers/repository",
  );
  return {
    ...actual,
    insertImageGenerationRow: (...args: unknown[]) => insertImageGenerationRowMock(...args),
    insertImageGenerationSources: (...args: unknown[]) => insertImageGenerationSourcesMock(...args),
    getImageGenerationRow: (...args: unknown[]) => getImageGenerationRowMock(...args),
    findUsageLogIdByRef: (...args: unknown[]) => findUsageLogIdByRefMock(...args),
    markImageGenerationSelected: (...args: unknown[]) => markImageGenerationSelectedMock(...args),
    runAiDraftCleanup: (...args: unknown[]) => runAiDraftCleanupMock(...args),
  };
});

import { aiProvidersFacade, cleanupAiDraftMedia } from "@/modules/ai-providers/facade";

function makeRow(overrides: Partial<ImageGenerationRow>): ImageGenerationRow {
  return {
    id: "gen-1",
    request_group_id: "group-1",
    parent_id: null,
    root_id: null,
    prompt: "a cat",
    provider: "openai",
    model: "gpt-image-2",
    params: {},
    status: "succeeded",
    provider_interaction_id: null,
    media_id: "media-1",
    is_selected: false,
    usage_log_id: null,
    error_code: null,
    created_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ supabase: {} as unknown as SupabaseClient, user: { id: "admin-1" } });
  getPublicUrlMock.mockImplementation((mediaId: string) => ({ ok: true, value: `https://cdn.test/${mediaId}.webp` }));
  findUsageLogIdByRefMock.mockResolvedValue({ ok: true, value: "usage-log-1" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("generateImageCascade: 新規バッチ (parentId なし)", () => {
  it("4 枚それぞれを media 保存し、ai_image_generations に 1 行 1 画像で記録する (root 行)", async () => {
    routeGenerateImagesMock.mockResolvedValue({
      ok: true,
      value: {
        images: [
          { dataBase64: Buffer.from("img1").toString("base64"), mimeType: "image/png" },
          { dataBase64: Buffer.from("img2").toString("base64"), mimeType: "image/png" },
          { dataBase64: Buffer.from("img3").toString("base64"), mimeType: "image/png" },
          { dataBase64: Buffer.from("img4").toString("base64"), mimeType: "image/png" },
        ],
        provider: "openai",
        model: "gpt-image-2",
        costMicroUsd: 4000,
        failedCount: 0,
      },
    });

    let counter = 0;
    createFromBytesMock.mockImplementation(async () => {
      counter += 1;
      return { id: `media-${counter}`, storagePath: `ai-generated/media-${counter}.png` };
    });

    insertImageGenerationRowMock.mockImplementation(async (_client: unknown, input: Record<string, unknown>) => ({
      ok: true,
      value: makeRow({
        id: `gen-${input.mediaId}`,
        request_group_id: "group-x",
        parent_id: input.parentId as string | null,
        root_id: (input.parentId as string | null) ?? `gen-${input.mediaId}`, // ルート規約を模倣
        prompt: input.prompt as string,
        media_id: input.mediaId as string,
      }),
    }));

    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "a cat in a garden",
      model: "gpt-image-2",
      n: 4,
      parentId: null,
      sourceMediaIds: [],
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.images).toHaveLength(4);
    expect(result.value.failedCount).toBe(0);
    expect(result.value.breadcrumb).toEqual([]); // parentId なしなのでパンくずは空

    // media は 4 回保存され、tags/credit が正しく渡る
    expect(createFromBytesMock).toHaveBeenCalledTimes(4);
    expect(createFromBytesMock.mock.calls[0][0]).toMatchObject({
      contentType: "image/png",
      tags: ["ai-generated", "ai-draft"],
      credit: "AI生成 (gpt-image-2)",
    });

    // ai_image_generations は 4 回、すべて parentId=null / rootId=null (root は repository 側で自己参照確定)
    expect(insertImageGenerationRowMock).toHaveBeenCalledTimes(4);
    for (const call of insertImageGenerationRowMock.mock.calls) {
      expect(call[1]).toMatchObject({ parentId: null, rootId: null, status: "succeeded" });
    }

    // 新規バッチには参照画像が無いため sources は記録されない
    expect(insertImageGenerationSourcesMock).not.toHaveBeenCalled();
  });
});

describe("generateImageCascade: カスケード (parentId 指定)", () => {
  it("親の media を sourceImages へ自動合成し、parent_id/root_id を継承し、sources にも記録する", async () => {
    getImageGenerationRowMock.mockResolvedValue({
      ok: true,
      value: makeRow({
        id: "11111111-1111-4111-8111-111111111111",
        root_id: "22222222-2222-4222-8222-222222222222",
        parent_id: null,
        status: "succeeded",
        media_id: "media-parent",
      }),
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    routeGenerateImagesMock.mockResolvedValue({
      ok: true,
      value: {
        images: [{ dataBase64: Buffer.from("cascaded").toString("base64"), mimeType: "image/png" }],
        provider: "openai",
        model: "gpt-image-2",
        costMicroUsd: 1000,
        failedCount: 0,
      },
    });
    createFromBytesMock.mockResolvedValue({ id: "media-child", storagePath: "ai-generated/child.png" });
    insertImageGenerationRowMock.mockImplementation(async (_client: unknown, input: Record<string, unknown>) => ({
      ok: true,
      value: makeRow({
        id: "gen-child-1",
        parent_id: input.parentId as string | null,
        root_id: input.rootId as string,
        prompt: input.prompt as string,
        media_id: input.mediaId as string,
      }),
    }));

    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "make the sky bluer",
      model: "gpt-image-2",
      n: 1,
      parentId: "11111111-1111-4111-8111-111111111111",
      sourceMediaIds: [],
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 親画像が sourceImages へ自動合成されて渡っている (fetch 経由で公開 URL から取得)
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.test/media-parent.webp");
    expect(routeGenerateImagesMock.mock.calls[0][0]).toMatchObject({
      feature: "image-cascade",
      sourceImages: [{ mimeType: "image/webp", dataBase64: Buffer.from([1, 2, 3]).toString("base64") }],
    });

    // parent_id/root_id を継承する
    expect(insertImageGenerationRowMock.mock.calls[0][1]).toMatchObject({
      parentId: "11111111-1111-4111-8111-111111111111",
      rootId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.value.images[0].parentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.value.images[0].rootId).toBe("22222222-2222-4222-8222-222222222222");

    // 参照画像として使った親の media は sources にも記録される
    expect(insertImageGenerationSourcesMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), [
      "media-parent",
    ]);
  });

  it("カスケード元が見つからない/未成功の場合は KMB-E101 を返す", async () => {
    getImageGenerationRowMock.mockResolvedValue({ ok: true, value: null });

    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "x",
      model: "gpt-image-2",
      n: 1,
      parentId: "99999999-9999-4999-8999-999999999999",
      sourceMediaIds: [],
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: "指定されたカスケード元が見つかりません" });
    expect(routeGenerateImagesMock).not.toHaveBeenCalled();
  });
});

describe("generateImageCascade: 参照画像 4 枚上限 (tester 追加)", () => {
  const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

  it("parentId 無し・sourceMediaIds 3 枚 + rawSourceImages 2 枚 = 合計 5 枚は KMB-E101 で拒否する", async () => {
    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "a cat",
      model: "gpt-image-2",
      n: 1,
      parentId: null,
      sourceMediaIds: [uuid(1), uuid(2), uuid(3)],
      rawSourceImages: [
        { mimeType: "image/png", dataBase64: "AAAA" },
        { mimeType: "image/png", dataBase64: "BBBB" },
      ],
      siteContext: null,
    });

    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: "参照画像は合計 4 枚までです" });
    expect(routeGenerateImagesMock).not.toHaveBeenCalled();
    expect(createFromBytesMock).not.toHaveBeenCalled();
  });

  it("合計ちょうど 4 枚 (境界) は拒否されず生成に進む", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
    vi.stubGlobal("fetch", fetchMock);

    routeGenerateImagesMock.mockResolvedValue({
      ok: true,
      value: {
        images: [{ dataBase64: Buffer.from("img").toString("base64"), mimeType: "image/png" }],
        provider: "openai",
        model: "gpt-image-2",
        costMicroUsd: 1000,
        failedCount: 0,
      },
    });
    createFromBytesMock.mockResolvedValue({ id: "media-x", storagePath: "ai-generated/x.png" });
    insertImageGenerationRowMock.mockResolvedValue({ ok: true, value: makeRow({ id: "gen-x", media_id: "media-x" }) });

    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "a cat",
      model: "gpt-image-2",
      n: 1,
      parentId: null,
      sourceMediaIds: [uuid(1), uuid(2), uuid(3), uuid(4)],
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result.ok).toBe(true);
    expect(routeGenerateImagesMock).toHaveBeenCalledTimes(1);
  });

  it("parentId 指定時は親画像も 1 枚として合算され、追加 4 枚と合わせて 5 枚は拒否する", async () => {
    getImageGenerationRowMock.mockResolvedValue({
      ok: true,
      value: makeRow({
        id: uuid(9),
        root_id: uuid(9),
        parent_id: null,
        status: "succeeded",
        media_id: "media-parent",
      }),
    });

    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "make it bluer",
      model: "gpt-image-2",
      n: 1,
      parentId: uuid(9),
      sourceMediaIds: [uuid(1), uuid(2), uuid(3), uuid(4)], // 親と合わせて 5 枚
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: "参照画像は合計 4 枚までです" });
    expect(routeGenerateImagesMock).not.toHaveBeenCalled();
  });

  it("sourceMediaIds に parentId と同じ media が重複指定されても二重カウントしない (dedup)", async () => {
    const parentMediaId = uuid(99); // sourceMediaIds は zod で uuid 必須のため、有効な uuid を親 media にも使う
    getImageGenerationRowMock.mockResolvedValue({
      ok: true,
      value: makeRow({
        id: uuid(9),
        root_id: uuid(9),
        parent_id: null,
        status: "succeeded",
        media_id: parentMediaId,
      }),
    });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
    vi.stubGlobal("fetch", fetchMock);

    routeGenerateImagesMock.mockResolvedValue({
      ok: true,
      value: {
        images: [{ dataBase64: Buffer.from("img").toString("base64"), mimeType: "image/png" }],
        provider: "openai",
        model: "gpt-image-2",
        costMicroUsd: 1000,
        failedCount: 0,
      },
    });
    createFromBytesMock.mockResolvedValue({ id: "media-x", storagePath: "ai-generated/x.png" });
    insertImageGenerationRowMock.mockResolvedValue({ ok: true, value: makeRow({ id: "gen-x", media_id: "media-x" }) });

    // sourceMediaIds に parentMediaId を重複して含めても、実質の参照枚数は 4 枚
    // (parent 1 枚 + 追加 3 枚 [uuid(1..3)]) に収まるため拒否されない。
    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "make it bluer",
      model: "gpt-image-2",
      n: 1,
      parentId: uuid(9),
      sourceMediaIds: [parentMediaId, uuid(1), uuid(2), uuid(3)],
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result.ok).toBe(true);
    // fetch は重複除去後の 4 件 (parent + 3 件) のみ呼ばれる
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("generateImageCascade: 予算超過 (KMB-E407)", () => {
  it("routeGenerateImages が E407 を返した場合、media 保存を一切試みず、そのまま伝播する", async () => {
    routeGenerateImagesMock.mockResolvedValue({
      ok: false,
      code: "KMB-E407",
      detail: "月次予算上限に達しています",
    });

    const result = await aiProvidersFacade.generateImageCascade({
      prompt: "a cat",
      model: "gpt-image-2",
      n: 4,
      parentId: null,
      sourceMediaIds: [],
      rawSourceImages: [],
      siteContext: null,
    });

    expect(result).toEqual({ ok: false, code: "KMB-E407", detail: "月次予算上限に達しています" });
    expect(createFromBytesMock).not.toHaveBeenCalled();
    expect(insertImageGenerationRowMock).not.toHaveBeenCalled();
  });
});

describe("markImageSelected / getImageGenerationBreadcrumb", () => {
  it("markImageSelected は is_selected=true で repository を呼ぶ", async () => {
    markImageGenerationSelectedMock.mockResolvedValue({ ok: true, value: undefined });
    const result = await aiProvidersFacade.markImageSelected("gen-1");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(markImageGenerationSelectedMock).toHaveBeenCalledWith(expect.anything(), "gen-1", true);
  });

  it("getImageGenerationBreadcrumb は root → ... → 指定 id の順で返す", async () => {
    const child = makeRow({ id: "gen-3", parent_id: "gen-2", root_id: "gen-1", media_id: "media-3" });
    const middle = makeRow({ id: "gen-2", parent_id: "gen-1", root_id: "gen-1", media_id: "media-2" });
    const root = makeRow({ id: "gen-1", parent_id: null, root_id: "gen-1", media_id: "media-1" });

    getImageGenerationRowMock.mockImplementation(async (_client: unknown, id: string) => {
      if (id === "gen-3") return { ok: true, value: child };
      if (id === "gen-2") return { ok: true, value: middle };
      if (id === "gen-1") return { ok: true, value: root };
      return { ok: true, value: null };
    });

    const result = await aiProvidersFacade.getImageGenerationBreadcrumb("gen-3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((n) => n.id)).toEqual(["gen-1", "gen-2", "gen-3"]);
  });
});

describe("cleanupAiDraftMedia (ai-draft 掃除 cron)", () => {
  it("候補ごとに Storage を削除し processed/failed を集計する", async () => {
    serviceClientMock.mockReturnValue({
      storage: {
        from: () => ({ remove: vi.fn().mockResolvedValue({ error: null }) }),
      },
    });
    runAiDraftCleanupMock.mockResolvedValue({
      ok: true,
      value: [
        { mediaId: "media-1", storagePath: "ai-generated/1.png" },
        { mediaId: "media-2", storagePath: "ai-generated/2.png" },
      ],
    });

    const result = await cleanupAiDraftMedia();
    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(runAiDraftCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("RPC 自体が失敗した場合は processed=0/failed=0 で継続する (次回起床に委ねる)", async () => {
    serviceClientMock.mockReturnValue({ storage: { from: () => ({ remove: vi.fn() }) } });
    runAiDraftCleanupMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const result = await cleanupAiDraftMedia();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});
