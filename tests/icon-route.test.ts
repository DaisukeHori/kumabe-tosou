import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §4.4 (仕様表全文)。
 *
 * GET /icon の 3 分岐 (未設定307 / 設定200 image・png / 失敗307) を検証する。
 * settingsFacade.getPublicValue / mediaFacade.getPublicUrl は vi.mock で差し替え、
 * 実 DB / cookie 依存 client には一切触れない (jobs-routes.test.ts と同じ手法)。
 * fetch はグローバルスタブに差し替え、実 Storage には触れない。
 */

const getPublicValueMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: {
    getPublicValue: (...args: unknown[]) => getPublicValueMock(...args),
  },
}));

const getPublicUrlMock = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: {
    getPublicUrl: (...args: unknown[]) => getPublicUrlMock(...args),
  },
}));

import { GET } from "@/app/icon/route";

const FAVICON_MEDIA_ID = "aabbccdd-1234-5678-9abc-def012345678";
const WEBP_URL = `https://example.supabase.co/storage/v1/object/public/media/${FAVICON_MEDIA_ID}.webp`;

let transparentWebp: Buffer;

beforeAll(async () => {
  // 小さな半透明 WebP fixture (透過保持の検証用)。実 Storage には触れない。
  transparentWebp = await sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } },
  })
    .webp()
    .toBuffer();
});

function makeRequest(query = ""): Request {
  return new Request(`http://localhost/icon${query}`);
}

describe("GET /icon", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getPublicValueMock.mockReset();
    getPublicUrlMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("branding 未設定 (favicon_media_id が null) の場合、307 で /favicon.ico へリダイレクトする", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: null });

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/favicon.ico");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect(getPublicUrlMock).not.toHaveBeenCalled();
  });

  it("branding の読み取りが失敗 (KMB-E901) した場合も 307 で /favicon.ico へ degrade する (4xx/5xx を返さない)", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "DB 障害" });

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/favicon.ico");
  });

  it("favicon_media_id 設定済みかつ取得成功なら 192x192 の PNG (透過保持) を 200 で返す", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } });
    getPublicUrlMock.mockReturnValueOnce({ ok: true, value: WEBP_URL });
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(transparentWebp), { status: 200 }));

    const res = await GET(makeRequest("?v=abcd1234"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(fetchMock).toHaveBeenCalledWith(WEBP_URL);

    const buffer = Buffer.from(await res.arrayBuffer());
    const outMeta = await sharp(buffer).metadata();
    expect(outMeta.width).toBe(192);
    expect(outMeta.height).toBe(192);
    expect(outMeta.format).toBe("png");
    expect(outMeta.hasAlpha).toBe(true);
  });

  it("v クエリが不正 (regex 不一致) でも無視して続行する (応答内容に影響しない)", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } });
    getPublicUrlMock.mockReturnValueOnce({ ok: true, value: WEBP_URL });
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(transparentWebp), { status: 200 }));

    const res = await GET(makeRequest("?v=not-a-valid-hex-query!!"));

    expect(res.status).toBe(200);
  });

  it("Storage fetch が失敗 (非 200) した場合、307 で /favicon.ico へ degrade する", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } });
    getPublicUrlMock.mockReturnValueOnce({ ok: true, value: WEBP_URL });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/favicon.ico");
  });

  it("fetch が例外を投げた場合も 307 で /favicon.ico へ degrade する", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } });
    getPublicUrlMock.mockReturnValueOnce({ ok: true, value: WEBP_URL });
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
  });

  it("sharp 変換が失敗 (壊れた画像バイト列) した場合も 307 で /favicon.ico へ degrade する", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } });
    getPublicUrlMock.mockReturnValueOnce({ ok: true, value: WEBP_URL });
    fetchMock.mockResolvedValueOnce(new Response(new TextEncoder().encode("not-an-image"), { status: 200 }));

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
  });

  it("mediaFacade.getPublicUrl が失敗 (env 不正) した場合も 307 で /favicon.ico へ degrade する", async () => {
    getPublicValueMock.mockResolvedValueOnce({ ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } });
    getPublicUrlMock.mockReturnValueOnce({ ok: false, code: "KMB-E901", detail: "env 不正" });

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
