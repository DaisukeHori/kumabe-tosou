import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { mediaFacade } from "@/modules/media/facade";
import { settingsFacade } from "@/modules/settings/facade";

/**
 * GET /icon — favicon の動的配信 (canonical: docs/design/crm-suite/05-site-settings.md §4.4)。
 *
 * フォルダ名 `icon` は App Router の `app/icon.*` ファイル規約 (拡張子ベース) と衝突しない
 * ため `route.ts` は素通りする (§4.4 注記)。
 *
 * sharp (Storage フェッチ + 画像変換) を使うため nodejs runtime 固定 (edge runtime では
 * sharp のネイティブバインディングが動かない — media ingest と同一基盤)。
 */
export const runtime = "nodejs";

/** キャッシュバスト専用クエリ。値は応答内容に影響しない (§3.3) */
const zIconQuery = z
  .object({
    v: z.string().regex(/^[0-9a-f]{1,16}$/).optional(),
  })
  .strict();

const FAVICON_ICO_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=300",
} as const;

function redirectToFaviconIco(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/favicon.ico", request.url), {
    status: 307,
    headers: FAVICON_ICO_HEADERS,
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  // クエリのバリデーションは応答内容に影響しない (キャッシュバスト目的のみ)。
  // parse 失敗しても続行する (§3.3/§4.4 の「失敗しても無視して続行」規約)。
  const url = new URL(request.url);
  zIconQuery.safeParse({ v: url.searchParams.get("v") ?? undefined });

  const brandingResult = await settingsFacade.getPublicValue("branding");
  if (!brandingResult.ok) {
    console.error("[GET /icon] branding の読み取りに失敗しました (既定 favicon へ degrade):", brandingResult.detail);
    return redirectToFaviconIco(request);
  }

  const faviconMediaId = brandingResult.value?.favicon_media_id ?? null;
  if (!faviconMediaId) {
    return redirectToFaviconIco(request);
  }

  const webpUrlResult = mediaFacade.getPublicUrl(faviconMediaId);
  if (!webpUrlResult.ok) {
    console.error("[GET /icon] favicon media の URL 解決に失敗しました (既定 favicon へ degrade):", webpUrlResult.detail);
    return redirectToFaviconIco(request);
  }

  try {
    const originalResponse = await fetch(webpUrlResult.value);
    if (!originalResponse.ok) {
      console.error(
        `[GET /icon] favicon media の取得に失敗しました (status=${originalResponse.status})。既定 favicon へ degrade します。`,
      );
      return redirectToFaviconIco(request);
    }

    const originalBuffer = Buffer.from(await originalResponse.arrayBuffer());
    // fit: "cover" で中央クロップ。.flatten() は呼ばない (media ingest の JPEG 変換と異なり
    // ここでは白背景合成をせずアルファを保持する — §4.4/§5.3 の透過維持要件)。
    const pngBuffer = await sharp(originalBuffer, { failOn: "none" })
      .resize(192, 192, { fit: "cover" })
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // s-maxage 必須 (max-age のみだと Vercel Edge にキャッシュされない既知地雷 — §4.4)
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    console.error(
      "[GET /icon] favicon の変換に失敗しました (既定 favicon へ degrade):",
      err instanceof Error ? err.message : String(err),
    );
    return redirectToFaviconIco(request);
  }
}
