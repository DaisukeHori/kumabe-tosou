import { describe, expect, it } from "vitest";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §3.2 / §12.1。
 *
 * SITE_META_FALLBACK (src/app/_lib/site-metadata.ts) は root layout
 * (src/app/layout.tsx — 変更不可、裁定 J12) のハードコード `metadata` export と
 * 文字列完全一致していなければならない (二重定義の乖離防止 — §3.2 コメント)。
 *
 * root layout はモジュールスコープで next/font/google を呼ぶため、
 * tests/mocks/next-font-google.ts のスタブ (vitest.config.ts の resolve.alias) が
 * 前提となる (このスタブが無いと import 時に TypeError になる — §12.1 実測)。
 */

import { metadata as rootMetadata } from "@/app/layout";
import { SITE_META_FALLBACK } from "@/app/_lib/site-metadata";

describe("SITE_META_FALLBACK ↔ root layout metadata の一致", () => {
  it("title.default が一致する", () => {
    expect(rootMetadata.title).toMatchObject({ default: SITE_META_FALLBACK.titleDefault });
  });

  it("title.template が一致する", () => {
    expect(rootMetadata.title).toMatchObject({ template: SITE_META_FALLBACK.titleTemplate });
  });

  it("description が一致する", () => {
    expect(rootMetadata.description).toBe(SITE_META_FALLBACK.description);
  });

  it("openGraph.title / openGraph.description が一致する", () => {
    expect(rootMetadata.openGraph?.title).toBe(SITE_META_FALLBACK.ogTitle);
    expect(rootMetadata.openGraph?.description).toBe(SITE_META_FALLBACK.ogDescription);
  });

  it("twitter.title / twitter.description が一致する", () => {
    expect(rootMetadata.twitter?.title).toBe(SITE_META_FALLBACK.ogTitle);
    expect(rootMetadata.twitter?.description).toBe(SITE_META_FALLBACK.ogDescription);
  });

  it("OG 画像の宣言 (url/width/height/alt) が SITE_META_FALLBACK.ogImage と一致する (1200x630)", () => {
    const images = rootMetadata.openGraph?.images;
    const image = Array.isArray(images) ? images[0] : images;
    expect(image).toEqual(SITE_META_FALLBACK.ogImage);
    expect(SITE_META_FALLBACK.ogImage.width).toBe(1200);
    expect(SITE_META_FALLBACK.ogImage.height).toBe(630);
  });

  it("siteName / siteUrl が一致する", () => {
    expect(rootMetadata.openGraph?.siteName).toBe(SITE_META_FALLBACK.siteName);
    expect(String(rootMetadata.metadataBase)).toBe(`${SITE_META_FALLBACK.siteUrl}/`);
  });
});
