import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildNoteDraftEditUrl,
  createNoteDraft,
  listNoteDrafts,
  NoteRateLimitError,
  parseXsrfTokenFromCookie,
  reconcileDraftByTitle,
  resetNoteRateLimitForTest,
} from "@/modules/distribution/internal/note-draft-client";

/**
 * canonical: docs/design/ai-studio-v2.md §8 (note 下書き自動化) /
 * docs/research/ai-studio-v2/note-posting.md (実測仕様)。
 * 実 note API は叩かず、fetch を全面モックして 2 段階フローの契約・状態意味論
 * (created/failed/unknown)・レート規律・下書き一覧照合を検証する。
 */

const COOKIE = "_note_session_v5=abc; note_gql_auth_token=def; XSRF-TOKEN=xsrf%20token%2Fvalue";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

async function recordBody(init: RequestInit | undefined): Promise<unknown> {
  const body = init?.body;
  if (body instanceof FormData) {
    const entries: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      entries[key] = value instanceof Blob ? { byteLength: (await value.arrayBuffer()).byteLength } : value;
    }
    return entries;
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

function headersToRecord(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers ?? {};
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textErrorResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetNoteRateLimitForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseXsrfTokenFromCookie", () => {
  it("XSRF-TOKEN cookie を URL デコードして返す (research実測: 書き込み系は X-XSRF-TOKEN ヘッダ必須)", () => {
    expect(parseXsrfTokenFromCookie(COOKIE)).toBe("xsrf token/value");
  });

  it("XSRF-TOKEN が無ければ null", () => {
    expect(parseXsrfTokenFromCookie("_note_session_v5=abc")).toBeNull();
  });

  it("先頭が XSRF-TOKEN の場合も (セミコロン無し) 正しく抽出する", () => {
    expect(parseXsrfTokenFromCookie("XSRF-TOKEN=onlyvalue")).toBe("onlyvalue");
  });
});

describe("buildNoteDraftEditUrl", () => {
  it("note.com/notes/{id}/edit 形式を組み立てる (判断点: ファイル冒頭コメント参照)", () => {
    expect(buildNoteDraftEditUrl("12345")).toBe("https://note.com/notes/12345/edit");
  });
});

describe("createNoteDraft: 2 段階フローの契約 (成功)", () => {
  it("text_notes 作成 → draft_save の順で呼ばれ、Cookie/X-XSRF-TOKEN ヘッダが両方に付与される", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", headers: headersToRecord(init), body: await recordBody(init) });
      if (url === "https://note.com/api/v1/text_notes") {
        return jsonResponse(200, { data: { id: 999 } });
      }
      if (url.startsWith("https://note.com/api/v1/text_notes/draft_save")) {
        return jsonResponse(200, { data: { id: 999 } });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, {
      title: "テストタイトル",
      bodyMd: "本文です",
      hashtags: ["塗装", "施工事例"],
    });

    expect(outcome).toEqual({
      kind: "created",
      draftId: "999",
      url: "https://note.com/notes/999/edit",
      headerImageWarning: null,
    });

    expect(calls.map((c) => c.url)).toEqual([
      "https://note.com/api/v1/text_notes",
      "https://note.com/api/v1/text_notes/draft_save?id=999&is_temp_saved=true",
    ]);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Cookie).toBe(COOKIE);
    expect(calls[0].headers["X-XSRF-TOKEN"]).toBe("xsrf token/value");
    expect(calls[1].headers.Cookie).toBe(COOKIE);
    expect(calls[1].headers["X-XSRF-TOKEN"]).toBe("xsrf token/value");

    expect(calls[0].body).toMatchObject({ name: "テストタイトル", body: "本文です" });
    expect(calls[1].body).toMatchObject({ name: "テストタイトル", body: "本文です", hashtags: ["塗装", "施工事例"] });
  });

  it("見出し画像アップロード成功時は headerImageWarning が null のまま created", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", headers: headersToRecord(init), body: await recordBody(init) });
      if (url === "https://note.com/api/v1/text_notes") return jsonResponse(200, { data: { id: 1 } });
      if (url.startsWith("https://note.com/api/v1/text_notes/draft_save")) return jsonResponse(200, {});
      if (url === "https://storage.example.com/eyecatch.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (url === "https://note.com/api/v1/upload_image") return jsonResponse(200, {});
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, {
      title: "タイトル",
      bodyMd: "本文",
      hashtags: [],
      headerImageUrl: "https://storage.example.com/eyecatch.jpg",
    });

    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") {
      expect(outcome.headerImageWarning).toBeNull();
    }
    const uploadCall = calls.find((c) => c.url === "https://note.com/api/v1/upload_image");
    expect(uploadCall).toBeDefined();
    expect((uploadCall!.body as Record<string, unknown>).note_id).toBe("1");
  });

  it("見出し画像アップロード失敗時は本文のみで下書き作成を続行し headerImageWarning を設定する (§8)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", headers: headersToRecord(init), body: await recordBody(init) });
      if (url === "https://note.com/api/v1/text_notes") return jsonResponse(200, { data: { id: 1 } });
      if (url.startsWith("https://note.com/api/v1/text_notes/draft_save")) return jsonResponse(200, {});
      if (url === "https://storage.example.com/eyecatch.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (url === "https://note.com/api/v1/upload_image") return textErrorResponse(500, "upload failed");
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, {
      title: "タイトル",
      bodyMd: "本文",
      hashtags: [],
      headerImageUrl: "https://storage.example.com/eyecatch.jpg",
    });

    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") {
      expect(outcome.headerImageWarning).toContain("見出し画像");
      expect(outcome.draftId).toBe("1");
    }
  });
});

describe("createNoteDraft: 明示的失敗 (failed)", () => {
  it("stage1 (text_notes) が 401 → failed/session_invalid (Cookie 失効)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://note.com/api/v1/text_notes") return textErrorResponse(401, "unauthorized");
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome).toMatchObject({ kind: "failed", reason: "session_invalid" });
  });

  it("stage1 が 403 も session_invalid 扱い", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://note.com/api/v1/text_notes") return textErrorResponse(403, "forbidden");
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome).toMatchObject({ kind: "failed", reason: "session_invalid" });
  });

  it("stage1 が 500 → failed/api_error (session とは無関係の確定エラー)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://note.com/api/v1/text_notes") return textErrorResponse(500, "server error");
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome).toMatchObject({ kind: "failed", reason: "api_error" });
  });

  it("stage2 (draft_save) が 401 → failed/session_invalid (stage1 成功済みでも失効扱い)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://note.com/api/v1/text_notes") return jsonResponse(200, { data: { id: 5 } });
      if (url.startsWith("https://note.com/api/v1/text_notes/draft_save")) return textErrorResponse(401, "expired");
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome).toMatchObject({ kind: "failed", reason: "session_invalid" });
  });
});

describe("createNoteDraft: タイムアウト/応答不明 (unknown)", () => {
  it("stage1 が AbortError (timeout) を投げると unknown", async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome.kind).toBe("unknown");
  });

  it("stage2 が TypeError (ネットワーク断) を投げると unknown (stage1 は成功済み)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://note.com/api/v1/text_notes") return jsonResponse(200, { data: { id: 7 } });
      if (url.startsWith("https://note.com/api/v1/text_notes/draft_save")) {
        throw new TypeError("fetch failed");
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome.kind).toBe("unknown");
  });

  it("応答に id が含まれない (想定外の形) 場合は unknown ではなく failed/api_error", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://note.com/api/v1/text_notes") return jsonResponse(200, {});
      throw new Error(`unexpected url: ${url}`);
    });

    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome).toMatchObject({ kind: "failed", reason: "api_error" });
  });
});

describe("listNoteDrafts / reconcileDraftByTitle: unknown 時の同タイトル照合 (§8 MAJOR-3)", () => {
  it("data 配列形式のレスポンスをパースできる", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { data: [{ id: 1, name: "記事A" }, { id: 2, name: "記事B" }] }),
    );
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([
      { id: "1", title: "記事A", url: "https://note.com/notes/1/edit" },
      { id: "2", title: "記事B", url: "https://note.com/notes/2/edit" },
    ]);
  });

  it("drafts / notes / items キーのいずれでもパースできる", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { notes: [{ key: "abc", title: "記事C" }] }));
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([{ id: "abc", title: "記事C", url: "https://note.com/notes/abc/edit" }]);
  });

  it("直接の配列レスポンスもパースできる", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, [{ id: 3, name: "記事D" }]));
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([{ id: "3", title: "記事D", url: "https://note.com/notes/3/edit" }]);
  });

  it("想定外の形 (実測未確定な応答) は例外を投げず空配列を返す (防御的パース)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { unexpected: "shape" }));
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([]);
  });

  it("応答ボディが null (JSON として妥当だが空) でも例外を投げず空配列を返す (防御的パース)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, null));
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([]);
  });

  it("応答ボディが配列でないプリミティブ (文字列) でも例外を投げず空配列を返す (防御的パース)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, "plain string body"));
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([]);
  });

  it("応答が JSON として不正 (パース失敗) でも例外を投げず空配列を返す (防御的パース)", async () => {
    fetchMock.mockImplementation(async () => new Response("not json {{{", { status: 200 }));
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([]);
  });

  it("配列内にフィールド欠落・非オブジェクト要素が混在しても、健全な要素だけ抽出し例外を投げない (防御的パース)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          null,
          "not an object",
          42,
          { id: 1 }, // title (name/title) 欠落 → スキップ
          { name: "タイトルだけ" }, // id (id/key/note_id) 欠落 → スキップ
          { id: 2, name: "健全な要素" },
        ],
      }),
    );
    const drafts = await listNoteDrafts(COOKIE);
    expect(drafts).toEqual([{ id: "2", title: "健全な要素", url: "https://note.com/notes/2/edit" }]);
  });

  it("非 ok 応答はハード失敗として例外を投げる (呼び出し元が best-effort で扱う)", async () => {
    fetchMock.mockImplementation(async () => textErrorResponse(500, "server error"));
    await expect(listNoteDrafts(COOKIE)).rejects.toThrow();
  });

  it("reconcileDraftByTitle: 同タイトルの下書きが見つかれば返す", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { data: [{ id: 1, name: "違うタイトル" }, { id: 2, name: "探しているタイトル" }] }),
    );
    const found = await reconcileDraftByTitle(COOKIE, "探しているタイトル");
    expect(found).toEqual({ id: "2", title: "探しているタイトル", url: "https://note.com/notes/2/edit" });
  });

  it("reconcileDraftByTitle: 同タイトルが無ければ null (重複防止のための照合が空振り)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { data: [{ id: 1, name: "違うタイトル" }] }));
    const found = await reconcileDraftByTitle(COOKIE, "存在しないタイトル");
    expect(found).toBeNull();
  });

  it("reconcileDraftByTitle: 下書き一覧が空でも例外を投げず null (空一覧の境界)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { data: [] }));
    const found = await reconcileDraftByTitle(COOKIE, "何かのタイトル");
    expect(found).toBeNull();
  });

  it("reconcileDraftByTitle: 部分一致は一致とみなさない (完全一致のみ。誤って既存扱いにして再作成をスキップしない)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { data: [{ id: 1, name: "探しているタイトルの続き" }, { id: 2, name: "探している" }] }),
    );
    const found = await reconcileDraftByTitle(COOKIE, "探しているタイトル");
    expect(found).toBeNull();
  });

  it("reconcileDraftByTitle: 同タイトルの下書きが複数存在しても例外を投げず 1 件を返す (二重下書きが既にある境界。新規作成はしない前提の確認)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          { id: 1, name: "重複タイトル" },
          { id: 2, name: "重複タイトル" },
        ],
      }),
    );
    const found = await reconcileDraftByTitle(COOKIE, "重複タイトル");
    expect(found).not.toBeNull();
    expect(["1", "2"]).toContain(found?.id);
  });
});

describe("レート規律: 10 req/分以下 (research の note-mcp DISCLAIMER 準拠)", () => {
  it("同一ウィンドウ内で 11 回目のリクエストは NoteRateLimitError で failed になる", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { data: [] }));

    // 10 回は正常に消費できる (1 回 = listNoteDrafts 1 リクエスト)
    for (let i = 0; i < 10; i++) {
      await listNoteDrafts(COOKIE);
    }
    // 11 回目は直接レート制限に阻まれる
    await expect(listNoteDrafts(COOKIE)).rejects.toThrow(NoteRateLimitError);
  });

  it("createNoteDraft はレート制限超過時に failed (api_error) を返す (例外を外に漏らさない)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { data: [] }));
    for (let i = 0; i < 10; i++) {
      await listNoteDrafts(COOKIE);
    }
    const outcome = await createNoteDraft(COOKIE, { title: "t", bodyMd: "b", hashtags: [] });
    expect(outcome).toMatchObject({ kind: "failed", reason: "api_error" });
  });

  it("ウィンドウ経過後は再びリクエストが許可される", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(async () => jsonResponse(200, { data: [] }));
      for (let i = 0; i < 10; i++) {
        await listNoteDrafts(COOKIE);
      }
      await expect(listNoteDrafts(COOKIE)).rejects.toThrow(NoteRateLimitError);

      vi.advanceTimersByTime(61_000);

      await expect(listNoteDrafts(COOKIE)).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
