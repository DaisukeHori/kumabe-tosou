import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §3.2 / §5.1 / §5.2 / §5.4。
 *
 * src/app/_lib/site-metadata.ts の純関数 (resolveGaId / buildSiteMetadata) と
 * I/O 合成関数 (resolveSiteMeta) を検証する。settingsFacade.getPublicValue /
 * mediaFacade.getPublicJpegUrl は vi.mock で差し替え、実 DB / cookie 依存 client には
 * 一切触れない (jobs-routes.test.ts / public-content-media.test.ts と同じ手法)。
 */

const getPublicValueMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: {
    getPublicValue: (...args: unknown[]) => getPublicValueMock(...args),
  },
}));

const getPublicJpegUrlMock = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: {
    getPublicJpegUrl: (...args: unknown[]) => getPublicJpegUrlMock(...args),
  },
}));

import {
  buildSiteMetadata,
  resolveGaId,
  resolveSiteMeta,
  SITE_META_FALLBACK,
  type ResolvedSiteMeta,
} from "@/app/_lib/site-metadata";

const OG_MEDIA_ID = "11111111-2222-3333-4444-555555555555";
const FAVICON_MEDIA_ID = "aabbccdd-1234-5678-9abc-def012345678";

type PublicValueResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "KMB-E901"; detail?: string };

function stubGetPublicValue(overrides: Record<string, PublicValueResult>) {
  getPublicValueMock.mockImplementation(async (key: string) => {
    return overrides[key] ?? { ok: true, value: null };
  });
}

describe("resolveGaId", () => {
  it("ga4MeasurementId が null なら vercelEnv に関わらず null を返す", () => {
    expect(resolveGaId(null, "production")).toBeNull();
    expect(resolveGaId(null, undefined)).toBeNull();
  });

  it("vercelEnv === 'production' のときのみ id を返す", () => {
    expect(resolveGaId("G-ABCD1234", "production")).toBe("G-ABCD1234");
  });

  it("vercelEnv === 'preview' では null を返す", () => {
    expect(resolveGaId("G-ABCD1234", "preview")).toBeNull();
  });

  it("vercelEnv === 'development' では null を返す", () => {
    expect(resolveGaId("G-ABCD1234", "development")).toBeNull();
  });

  it("vercelEnv が undefined (VERCEL_ENV 不存在。ローカル next build && next start 相当) では null を返す", () => {
    expect(resolveGaId("G-ABCD1234", undefined)).toBeNull();
  });
});

describe("buildSiteMetadata", () => {
  const fallbackMeta: ResolvedSiteMeta = {
    source: "fallback",
    titleDefault: SITE_META_FALLBACK.titleDefault,
    titleTemplate: SITE_META_FALLBACK.titleTemplate,
    description: SITE_META_FALLBACK.description,
    ogTitle: SITE_META_FALLBACK.ogTitle,
    ogDescription: SITE_META_FALLBACK.ogDescription,
    ogImage: { kind: "default", ...SITE_META_FALLBACK.ogImage },
    gaId: null,
    faviconHref: null,
  };

  it("fallback 時: title/description/openGraph/twitter を毎回全量返却する (部分返却によるフィールド欠落回帰がないことの担保)", () => {
    const metadata = buildSiteMetadata(fallbackMeta);

    expect(metadata.title).toEqual({
      default: SITE_META_FALLBACK.titleDefault,
      template: SITE_META_FALLBACK.titleTemplate,
    });
    expect(metadata.description).toBe(SITE_META_FALLBACK.description);
    expect(metadata.openGraph).toMatchObject({
      title: SITE_META_FALLBACK.ogTitle,
      description: SITE_META_FALLBACK.ogDescription,
      type: "website",
      locale: "ja_JP",
      siteName: SITE_META_FALLBACK.siteName,
      url: SITE_META_FALLBACK.siteUrl,
    });
    expect(metadata.openGraph?.images).toEqual([
      {
        url: SITE_META_FALLBACK.ogImage.url,
        width: SITE_META_FALLBACK.ogImage.width,
        height: SITE_META_FALLBACK.ogImage.height,
        alt: SITE_META_FALLBACK.ogImage.alt,
      },
    ]);
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      title: SITE_META_FALLBACK.ogTitle,
      description: SITE_META_FALLBACK.ogDescription,
      images: [SITE_META_FALLBACK.ogImage.url],
    });
  });

  it("fallback 時: faviconHref が null なら icons を返さない (ファイル規約 /favicon.ico にブラウザ既定で委ねる)", () => {
    const metadata = buildSiteMetadata(fallbackMeta);
    expect(metadata.icons).toBeUndefined();
  });

  it("metadataBase を返さない (root layout の値を継承する契約)", () => {
    const metadata = buildSiteMetadata(fallbackMeta);
    expect(metadata.metadataBase).toBeUndefined();
  });

  it("db 由来 (source: 'db') + media og 画像 + favicon 設定時: og/twitter は常に SITE_META_FALLBACK.ogTitle、description は db 値、images は url のみ (width/height/alt 非宣言)、icons は /icon?v= 形式", () => {
    const dbMeta: ResolvedSiteMeta = {
      source: "db",
      titleDefault: SITE_META_FALLBACK.titleDefault,
      titleTemplate: "%s | DBテンプレ",
      description: "DB から読んだ説明文です。".padEnd(55, "。"),
      ogTitle: SITE_META_FALLBACK.ogTitle,
      ogDescription: "DB から読んだ説明文です。".padEnd(55, "。"),
      ogImage: { kind: "media", url: `https://example.supabase.co/storage/v1/object/public/media/${OG_MEDIA_ID}.jpg`, alt: SITE_META_FALLBACK.ogImage.alt },
      gaId: null,
      faviconHref: `/icon?v=${FAVICON_MEDIA_ID.slice(0, 8)}`,
    };

    const metadata = buildSiteMetadata(dbMeta);

    expect(metadata.openGraph?.title).toBe(SITE_META_FALLBACK.ogTitle);
    expect(metadata.twitter?.title).toBe(SITE_META_FALLBACK.ogTitle);
    expect(metadata.openGraph?.description).toBe(dbMeta.description);
    expect(metadata.openGraph?.images).toEqual([{ url: dbMeta.ogImage.url }]);
    expect(metadata.twitter?.images).toEqual([dbMeta.ogImage.url]);
    expect(metadata.icons).toEqual({
      icon: [{ url: `/icon?v=${FAVICON_MEDIA_ID.slice(0, 8)}`, type: "image/png" }],
    });
  });
});

describe("resolveSiteMeta", () => {
  beforeEach(() => {
    getPublicValueMock.mockReset();
    getPublicJpegUrlMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.VERCEL_ENV;
  });

  it("3 キーとも未設定 (行なし) の場合、fallback で全量埋める (source: 'fallback')", async () => {
    stubGetPublicValue({
      seo_defaults: { ok: true, value: null },
      analytics: { ok: true, value: null },
      branding: { ok: true, value: null },
    });

    const meta = await resolveSiteMeta();

    expect(meta.source).toBe("fallback");
    expect(meta.description).toBe(SITE_META_FALLBACK.description);
    expect(meta.ogDescription).toBe(SITE_META_FALLBACK.ogDescription);
    expect(meta.ogImage).toEqual({ kind: "default", ...SITE_META_FALLBACK.ogImage });
    expect(meta.gaId).toBeNull();
    expect(meta.faviconHref).toBeNull();
    expect(getPublicJpegUrlMock).not.toHaveBeenCalled();
  });

  it("seo_defaults 設定済みの場合、source='db' + og 画像は og_media_id の JPEG 決定論 URL", async () => {
    stubGetPublicValue({
      seo_defaults: {
        ok: true,
        value: { title_template: "%s | カスタム", description: "カスタム説明文。".padEnd(55, "あ"), og_media_id: OG_MEDIA_ID },
      },
      analytics: { ok: true, value: null },
      branding: { ok: true, value: null },
    });
    getPublicJpegUrlMock.mockReturnValueOnce({
      ok: true,
      value: `https://example.supabase.co/storage/v1/object/public/media/${OG_MEDIA_ID}.jpg`,
    });

    const meta = await resolveSiteMeta();

    expect(meta.source).toBe("db");
    expect(meta.titleTemplate).toBe("%s | カスタム");
    expect(meta.ogDescription).toBe(meta.description);
    expect(meta.ogImage).toEqual({
      kind: "media",
      url: `https://example.supabase.co/storage/v1/object/public/media/${OG_MEDIA_ID}.jpg`,
      alt: SITE_META_FALLBACK.ogImage.alt,
    });
    expect(getPublicJpegUrlMock).toHaveBeenCalledWith(OG_MEDIA_ID);
  });

  it("getPublicJpegUrl が失敗 (env 不正) しても throw せず既定 OG 画像へ degrade する", async () => {
    stubGetPublicValue({
      seo_defaults: {
        ok: true,
        value: { title_template: "%s | カスタム", description: "カスタム説明文。".padEnd(55, "あ"), og_media_id: OG_MEDIA_ID },
      },
      analytics: { ok: true, value: null },
      branding: { ok: true, value: null },
    });
    getPublicJpegUrlMock.mockReturnValueOnce({ ok: false, code: "KMB-E901", detail: "env 不正" });

    const meta = await resolveSiteMeta();

    expect(meta.ogImage).toEqual({ kind: "default", ...SITE_META_FALLBACK.ogImage });
  });

  it("analytics.ga4_measurement_id 設定済み + VERCEL_ENV='production' なら gaId を返す", async () => {
    process.env.VERCEL_ENV = "production";
    stubGetPublicValue({
      seo_defaults: { ok: true, value: null },
      analytics: { ok: true, value: { ga4_measurement_id: "G-ABCD1234" } },
      branding: { ok: true, value: null },
    });

    const meta = await resolveSiteMeta();

    expect(meta.gaId).toBe("G-ABCD1234");
  });

  it("analytics.ga4_measurement_id 設定済みでも VERCEL_ENV!=='production' なら gaId は null", async () => {
    process.env.VERCEL_ENV = "preview";
    stubGetPublicValue({
      seo_defaults: { ok: true, value: null },
      analytics: { ok: true, value: { ga4_measurement_id: "G-ABCD1234" } },
      branding: { ok: true, value: null },
    });

    const meta = await resolveSiteMeta();

    expect(meta.gaId).toBeNull();
  });

  it("branding.favicon_media_id 設定済みなら faviconHref = /icon?v={先頭8桁}", async () => {
    stubGetPublicValue({
      seo_defaults: { ok: true, value: null },
      analytics: { ok: true, value: null },
      branding: { ok: true, value: { favicon_media_id: FAVICON_MEDIA_ID } },
    });

    const meta = await resolveSiteMeta();

    expect(meta.faviconHref).toBe(`/icon?v=${FAVICON_MEDIA_ID.slice(0, 8)}`);
  });

  it("3 キーとも DB 障害 (ok:false) でも throw せず、全て fallback で degrade する (公開ページを落とさない)", async () => {
    stubGetPublicValue({
      seo_defaults: { ok: false, code: "KMB-E901", detail: "接続失敗" },
      analytics: { ok: false, code: "KMB-E901", detail: "接続失敗" },
      branding: { ok: false, code: "KMB-E901", detail: "接続失敗" },
    });

    await expect(resolveSiteMeta()).resolves.toMatchObject({
      source: "fallback",
      gaId: null,
      faviconHref: null,
      ogImage: { kind: "default" },
    });
  });
});
