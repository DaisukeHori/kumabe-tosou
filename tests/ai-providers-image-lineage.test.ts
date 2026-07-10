import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/ai-studio-v2.md §4 (画像生成カスケード) / §2 (DDL)。
 *
 * repository 層 (実装をそのまま使い、フェイク client のみモック) を検証する:
 *  - insertImageGenerationRow の root_id 自己参照規約
 *    (オーケストレーター確定 2026-07-10: ルート行 (parent_id=null) は root_id=自身の id。
 *     子孫行は渡された rootId をそのまま保存し追加 UPDATE しない)
 *  - insertImageGenerationSources / getImageGenerationRow / markImageGenerationSelected /
 *    findUsageLogIdByRef / runAiDraftCleanup の呼び出し規約
 *
 * facade 層の generateImageCascade 自体は tests/ai-providers-image-cascade.test.ts
 * (repository/router/media facade を丸ごとモックする別ファイル) で検証する。
 * 同一ファイルで repository の実装テストと facade のモックテストを両立できない
 * (vi.mock はファイル内の全 import に効くため) ため、意図的にファイルを分けている。
 */

import {
  findUsageLogIdByRef,
  getImageGenerationRow,
  insertImageGenerationRow,
  insertImageGenerationSources,
  markImageGenerationSelected,
  runAiDraftCleanup,
  type ImageGenerationRow,
} from "@/modules/ai-providers/repository";

function makeGenerationRow(overrides: Partial<ImageGenerationRow>): ImageGenerationRow {
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

describe("insertImageGenerationRow (root_id 自己参照規約)", () => {
  it("parent_id が null の行は INSERT 直後に root_id を自身の id へ UPDATE する", async () => {
    const insertedRow = makeGenerationRow({ id: "gen-root", parent_id: null, root_id: null });
    const updatedRow = { ...insertedRow, root_id: "gen-root" };

    let updateCalledWith: unknown;
    let updateEqId: unknown;
    const client = {
      from() {
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: insertedRow, error: null }) }),
          }),
          update(payload: unknown) {
            updateCalledWith = payload;
            return {
              eq: (_col: string, id: string) => {
                updateEqId = id;
                return {
                  select: () => ({ single: async () => ({ data: updatedRow, error: null }) }),
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await insertImageGenerationRow(client, {
      requestGroupId: "group-1",
      parentId: null,
      rootId: null,
      prompt: "a cat",
      provider: "openai",
      model: "gpt-image-2",
      params: {},
      status: "succeeded",
      mediaId: "media-1",
      usageLogId: null,
      errorCode: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root_id).toBe("gen-root"); // 自身の id を指す (NULL のままにしない)
    expect(updateCalledWith).toEqual({ root_id: "gen-root" });
    expect(updateEqId).toBe("gen-root");
  });

  it("parent_id がある行は渡された rootId をそのまま保存し、追加の UPDATE は行わない", async () => {
    const insertedRow = makeGenerationRow({
      id: "gen-child",
      parent_id: "gen-root",
      root_id: "gen-root", // 親から継承した値をそのまま渡す
    });

    let updateCalled = false;
    const client = {
      from() {
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: insertedRow, error: null }) }),
          }),
          update() {
            updateCalled = true;
            return { eq: () => ({ select: () => ({ single: async () => ({ data: insertedRow, error: null }) }) }) };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await insertImageGenerationRow(client, {
      requestGroupId: "group-1",
      parentId: "gen-root",
      rootId: "gen-root",
      prompt: "make it bluer",
      provider: "openai",
      model: "gpt-image-2",
      params: {},
      status: "succeeded",
      mediaId: "media-2",
      usageLogId: null,
      errorCode: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root_id).toBe("gen-root"); // 親と一致
    expect(result.value.parent_id).toBe("gen-root");
    expect(updateCalled).toBe(false); // 子孫行は 2 段更新しない
  });
});

describe("insertImageGenerationSources", () => {
  it("media_id 配列を ord 付きで INSERT する", async () => {
    let captured: unknown;
    const client = {
      from() {
        return {
          insert: async (payload: unknown) => {
            captured = payload;
            return { error: null };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await insertImageGenerationSources(client, "group-1", ["media-a", "media-b"]);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(captured).toEqual([
      { generation_group_id: "group-1", media_id: "media-a", ord: 0 },
      { generation_group_id: "group-1", media_id: "media-b", ord: 1 },
    ]);
  });

  it("mediaIds が空配列なら INSERT を呼ばない", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;

    const result = await insertImageGenerationSources(client, "group-1", []);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("getImageGenerationRow / markImageGenerationSelected", () => {
  it("行が存在しない場合は null を返す", async () => {
    const client = {
      from() {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      },
    } as unknown as SupabaseClient;

    const result = await getImageGenerationRow(client, "missing-id");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("markImageGenerationSelected は is_selected を指定値で UPDATE する", async () => {
    let captured: unknown;
    const client = {
      from() {
        return {
          update: (payload: unknown) => {
            captured = payload;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await markImageGenerationSelected(client, "gen-1", true);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(captured).toEqual({ is_selected: true });
  });
});

describe("findUsageLogIdByRef", () => {
  it("ref_table/ref_id で ai_usage_log を逆引きする", async () => {
    const calls: Record<string, unknown> = {};
    const client = {
      from() {
        return {
          select: () => ({
            eq: (col: string, value: unknown) => {
              calls[col] = value;
              return {
                eq: (col2: string, value2: unknown) => {
                  calls[col2] = value2;
                  return {
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: { id: "usage-log-1" }, error: null }),
                      }),
                    }),
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;

    const result = await findUsageLogIdByRef(client, "ai_image_generations", "group-1");
    expect(result).toEqual({ ok: true, value: "usage-log-1" });
    expect(calls).toEqual({ ref_table: "ai_image_generations", ref_id: "group-1" });
  });

  it("該当なしは null を返す", async () => {
    const client = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            }),
          }),
        };
      },
    } as unknown as SupabaseClient;

    const result = await findUsageLogIdByRef(client, "ai_image_generations", "group-none");
    expect(result).toEqual({ ok: true, value: null });
  });
});

describe("runAiDraftCleanup (ai_draft_cleanup_run RPC ラッパ)", () => {
  it("正しい RPC 名・パラメータで呼び出し、結果を camelCase にマッピングする", async () => {
    let capturedName = "";
    let capturedParams: unknown;
    const client = {
      rpc(name: string, params: unknown) {
        capturedName = name;
        capturedParams = params;
        return Promise.resolve({
          data: [{ media_id: "media-1", storage_path: "ai-generated/x.png" }],
          error: null,
        });
      },
    } as unknown as SupabaseClient;

    const result = await runAiDraftCleanup(client, "2026-07-03T00:00:00.000Z");
    expect(capturedName).toBe("ai_draft_cleanup_run");
    expect(capturedParams).toEqual({ p_cutoff: "2026-07-03T00:00:00.000Z" });
    expect(result).toEqual({ ok: true, value: [{ mediaId: "media-1", storagePath: "ai-generated/x.png" }] });
  });

  it("RPC エラーは KMB-E901 として伝播する", async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    } as unknown as SupabaseClient;

    const result = await runAiDraftCleanup(client, "2026-07-03T00:00:00.000Z");
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });
});
