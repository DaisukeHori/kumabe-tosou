import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { replaceWorkImage, updateCoverWithCas } from "@/modules/content/repository";

/**
 * canonical: docs/design/visual-media-editor.md §6 (cover/photo の CAS) / §6.1
 * (replace_work_image RPC のエラー写像)。
 *
 * settings-repository.test.ts / distribution-cas.test.ts のフェイククエリビルダ方式に倣い、
 * Supabase の query builder を模した最小限のフェイクで検証する。
 */

type Call = [string, unknown[]];

class FakeUpdateQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(
    private response: { data: unknown; error: unknown },
    private calls: Call[],
  ) {}
  eq(col: string, value: unknown): this {
    this.calls.push(["eq", [col, value]]);
    return this;
  }
  is(col: string, value: unknown): this {
    this.calls.push(["is", [col, value]]);
    return this;
  }
  select(cols?: string): this {
    this.calls.push(["select", [cols]]);
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

function buildFakeCoverClient(response: { data: unknown; error: unknown }, calls: Call[]) {
  const client = {
    from() {
      return {
        update: () => new FakeUpdateQuery(response, calls),
      };
    },
  };
  return client as unknown as SupabaseClient;
}

function buildFakeRpcClient(response: { data: unknown; error: unknown }) {
  const client = {
    rpc: async () => response,
  };
  return client as unknown as SupabaseClient;
}

describe("updateCoverWithCas: cover/photo 差し替えの楽観排他 (§6)", () => {
  it("affected 1 行 (CAS 成功) は ok:true を返す", async () => {
    const calls: Call[] = [];
    const client = buildFakeCoverClient({ data: [{ id: "work-1" }], error: null }, calls);

    const result = await updateCoverWithCas(
      client,
      "works",
      "work-1",
      "cover_media_id",
      "old-media",
      "new-media",
    );

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("affected 0 行 (CAS 不一致 / 対象なし) は KMB-E109 を返す", async () => {
    const calls: Call[] = [];
    const client = buildFakeCoverClient({ data: [], error: null }, calls);

    const result = await updateCoverWithCas(
      client,
      "works",
      "work-1",
      "cover_media_id",
      "old-media",
      "new-media",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E109");
  });

  it("old_media_id が null の場合は .is(column, null) を使う (is not distinct from の等価表現)", async () => {
    const calls: Call[] = [];
    const client = buildFakeCoverClient({ data: [{ id: "voice-1" }], error: null }, calls);

    await updateCoverWithCas(client, "voices", "voice-1", "photo_media_id", null, "new-media");

    expect(calls).toContainEqual(["is", ["photo_media_id", null]]);
    expect(calls.some(([method, args]) => method === "eq" && args[0] === "photo_media_id")).toBe(false);
  });

  it("old_media_id が非 null の場合は .eq(column, old) を使う", async () => {
    const calls: Call[] = [];
    const client = buildFakeCoverClient({ data: [{ id: "post-1" }], error: null }, calls);

    await updateCoverWithCas(client, "posts", "post-1", "cover_media_id", "old-media", "new-media");

    expect(calls).toContainEqual(["eq", ["cover_media_id", "old-media"]]);
  });

  it("id を eq 条件に必ず含める", async () => {
    const calls: Call[] = [];
    const client = buildFakeCoverClient({ data: [{ id: "work-9" }], error: null }, calls);

    await updateCoverWithCas(client, "works", "work-9", "cover_media_id", null, null);

    expect(calls).toContainEqual(["eq", ["id", "work-9"]]);
  });
});

describe("replaceWorkImage: RPC 例外メッセージ → KMB コード写像 (§6.1)", () => {
  it("エラー無し (成功) は ok:true を返す", async () => {
    const client = buildFakeRpcClient({ data: null, error: null });
    const result = await replaceWorkImage(client, "work-1", "media-old", "media-new");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("先頭が KMB-E108 の例外メッセージは KMB-E108 に写像される (同一 work に同 media が既存)", async () => {
    const client = buildFakeRpcClient({
      data: null,
      error: { message: "KMB-E108: work_images(work-1, media-new) already exists" },
    });
    const result = await replaceWorkImage(client, "work-1", "media-old", "media-new");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E108");
      expect(result.detail).toContain("KMB-E108");
    }
  });

  it("先頭が KMB-E109 の例外メッセージは KMB-E109 に写像される (対象行なし)", async () => {
    const client = buildFakeRpcClient({
      data: null,
      error: { message: "KMB-E109: work_images(work-1, media-old) not found" },
    });
    const result = await replaceWorkImage(client, "work-1", "media-old", "media-new");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E109");
  });

  it("同時挿入による unique_violation 正規化後の KMB-E108 メッセージも E108 に写像される", async () => {
    const client = buildFakeRpcClient({
      data: null,
      error: { message: "KMB-E108: work_images(work-1, media-new) already exists (concurrent insert)" },
    });
    const result = await replaceWorkImage(client, "work-1", "media-old", "media-new");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E108");
  });

  it("KMB コードを含まない例外は KMB-E901 (parse 不能) に写像される", async () => {
    const client = buildFakeRpcClient({ data: null, error: { message: "unexpected database error" } });
    const result = await replaceWorkImage(client, "work-1", "media-old", "media-new");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("削除ケース (new_media_id=null) も RPC に渡す (エラー無しなら ok:true)", async () => {
    const client = buildFakeRpcClient({ data: null, error: null });
    const result = await replaceWorkImage(client, "work-1", "media-old", null);
    expect(result).toEqual({ ok: true, value: undefined });
  });
});
