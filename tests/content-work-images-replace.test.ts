import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { replaceWorkImages } from "@/modules/content/repository";

/**
 * work_images の全置換 (canonical: docs/design/cms-ai-pipeline.md §6.1、
 * migration 20260906000061_work_images_replace.sql)。
 *
 * 回帰: 旧実装は PostgREST の delete → insert の 2 呼び出しで、insert 失敗時に delete だけが
 * 残ってギャラリーが空になった。新実装は RPC work_images_replace 1 回で完結する。
 * content-cas.test.ts の buildFakeRpcClient 方式で、RPC 名・引数とエラー写像を検証する。
 */

type RpcCall = { fn: string; args: Record<string, unknown> };

function buildFakeRpcClient(response: { data: unknown; error: unknown }, calls: RpcCall[]) {
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return response;
    },
    from() {
      throw new Error("replaceWorkImages は PostgREST の from() を使ってはいけない (RPC 1 回で完結する)");
    },
  };
  return client as unknown as SupabaseClient;
}

describe("replaceWorkImages: work_images_replace RPC を 1 回だけ呼ぶ", () => {
  it("RPC 名と引数 (p_work_id / p_media_ids は配列順のまま) を渡し、成功なら ok:true", async () => {
    const calls: RpcCall[] = [];
    const client = buildFakeRpcClient({ data: null, error: null }, calls);

    const result = await replaceWorkImages(client, "work-1", ["m-b", "m-a", "m-c"]);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([
      { fn: "work_images_replace", args: { p_work_id: "work-1", p_media_ids: ["m-b", "m-a", "m-c"] } },
    ]);
  });

  it("空配列でも RPC を呼ぶ (全削除も RPC 側の単一トランザクションで行う)", async () => {
    const calls: RpcCall[] = [];
    const client = buildFakeRpcClient({ data: null, error: null }, calls);

    await replaceWorkImages(client, "work-1", []);

    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_media_ids).toEqual([]);
  });

  it("FK 違反 (SQLSTATE 23503) は KMB-E101 に写像する", async () => {
    const client = buildFakeRpcClient(
      {
        data: null,
        error: { code: "23503", message: 'insert or update on table "work_images" violates foreign key constraint' },
      },
      [],
    );

    const result = await replaceWorkImages(client, "work-1", ["missing-media"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("RPC が raise した 'KMB-E101: ...' メッセージは KMB-E101 に写像する", async () => {
    const client = buildFakeRpcClient(
      { data: null, error: { code: "P0001", message: "KMB-E101: 参照先が存在しません: media(xxx)" } },
      [],
    );

    const result = await replaceWorkImages(client, "work-1", ["missing-media"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toContain("参照先が存在しません");
    }
  });

  it("非 admin (SQLSTATE 42501) は KMB-E202 に写像する", async () => {
    const client = buildFakeRpcClient(
      { data: null, error: { code: "42501", message: "permission denied: work_images_replace requires admin" } },
      [],
    );

    const result = await replaceWorkImages(client, "work-1", ["m-1"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E202");
  });

  it("その他のエラーは KMB-E901", async () => {
    const client = buildFakeRpcClient({ data: null, error: { code: "XX000", message: "boom" } }, []);

    const result = await replaceWorkImages(client, "work-1", ["m-1"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });
});
