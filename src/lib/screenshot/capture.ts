import "server-only";

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Result } from "@/modules/platform/contracts";

import { buildScreenshotTargetUrl } from "./route-key";

/**
 * フルページスクショ基盤 (canonical: docs/design/ai-studio-v2.md §5、入力資料:
 * docs/research/ai-studio-v2/fullpage-screenshot.md の推奨方式)。
 *
 * 方式: puppeteer-core + @sparticuz/chromium を Vercel Function 上で自前実行。
 * fullPage 撮影 → sharp で長辺 1568px の webp に圧縮 → Supabase Storage
 * `ai-context` バケットへ一時保存 (migration 20260710000016_ai_context_storage.sql)。
 *
 * 失敗時は常に Result で明示エラーを返す (§5「失敗時は常に graceful degradation」の実体は
 * 呼び出し元 — suggestText Server Action — が本関数の失敗を「MD のみで続行」に倒す形で担う。
 * 本モジュール自体は例外を飲み込まず、必ず ok:false を返す)。
 *
 * 判断点 (オーケストレーターへ報告済み):
 * - versioning: puppeteer-core / @sparticuz/chromium は研究資料の指摘通り exact pin
 *   (^ を使わない) にした。@sparticuz/chromium は本リポジトリの engines (node >=20.11 <23) と
 *   両立する最新版として 147.0.0 (Chromium 147 系。148 以降は engines.node が
 *   `>=22.17.0` に上がり Node 20 と非互換になるため見送った — `npm install` 時の
 *   EBADENGINE 警告で実測確認済み)。puppeteer-core も同じ制約で 25.x (node >=22.12.0 要求) を
 *   避け、24.43.1 (node >=18) を選定した。実運用開始前に Puppeteer の Chromium Support
 *   ページで組み合わせの再確認を推奨する。
 * - キャッシュ (§5「編集セッション中キャッシュ (route + 最終更新で 10 分)」): サーバレス関数の
 *   ウォームインスタンス内メモリ (Map) に routeKey → 直近キャプチャを 10 分 TTL で保持する
 *   簡易実装とした。Storage オブジェクトのメタデータ (updated_at) を突き合わせるクロス
 *   インスタンス方式は実装しない (再撮影は冪等でコストも小さいため、正確性要件ではなく
 *   最適化としてのキャッシュに留める判断)。
 * - 16,384px 超のフルページ (Chromium software GL の最大テクスチャ制限) の分割撮影 + sharp 結合は
 *   本 P2 のスコープ外 (research/fullpage-screenshot.md §2 の既知の制約。本サイトの実測ページ高は
 *   全ページ未満と推測されるが、実測は本タスクのスコープ外。フォローアップ課題として残す)。
 */

export type ScreenshotCapture = {
  dataBase64: string;
  mimeType: string;
  storagePath: string;
};

const AI_CONTEXT_BUCKET = "ai-context";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TARGET_LONG_EDGE_PX = 1568;
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1 };
const NAVIGATION_TIMEOUT_MS = 45_000;

type CacheEntry = { capture: ScreenshotCapture; capturedAt: number };
const captureCache = new Map<string, CacheEntry>();

function getCached(routeKey: string): ScreenshotCapture | null {
  const entry = captureCache.get(routeKey);
  if (!entry) return null;
  if (Date.now() - entry.capturedAt > CACHE_TTL_MS) {
    captureCache.delete(routeKey);
    return null;
  }
  return entry.capture;
}

/** routeKey → Storage オブジェクトパス ("/" → "root.webp"、それ以外は非英数字を "-" に正規化) */
function routeKeyToStoragePath(routeKey: string): string {
  const normalized = routeKey === "/" ? "root" : routeKey.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return `${normalized || "root"}.webp`;
}

async function launchAndCapturePng(url: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: VIEWPORT,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // スクロール連動アニメーション (docs/design/motion-specs) が中途半端な状態で写らないよう、
    // prefers-reduced-motion: reduce をエミュレートする (research/fullpage-screenshot.md §0)。
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(url, { waitUntil: "networkidle0", timeout: NAVIGATION_TIMEOUT_MS });
    // 自己ホスト webfont のロード完了を待つ (研究資料 §0: 自サイト撮影では追加フォント配置は
    // 不要だが、document.fonts.ready 待ちは省略しない)。
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    const png = await page.screenshot({ type: "png", fullPage: true });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}

/** fullPage PNG → 長辺 1568px (超過時のみ縮小) の webp に圧縮する (§5「webp 1568px」)。 */
async function compressToWebp(png: Buffer): Promise<Buffer> {
  const image = sharp(png);
  const metadata = await image.metadata();
  const width = metadata.width ?? TARGET_LONG_EDGE_PX;
  const height = metadata.height ?? TARGET_LONG_EDGE_PX;
  const longEdge = Math.max(width, height);

  let pipeline = image;
  if (longEdge > TARGET_LONG_EDGE_PX) {
    pipeline = width >= height ? pipeline.resize({ width: TARGET_LONG_EDGE_PX }) : pipeline.resize({ height: TARGET_LONG_EDGE_PX });
  }
  return pipeline.webp({ quality: 70 }).toBuffer();
}

async function uploadToStorage(routeKey: string, webp: Buffer): Promise<Result<string>> {
  try {
    const client = createSupabaseServiceClient();
    const path = routeKeyToStoragePath(routeKey);
    const { error } = await client.storage
      .from(AI_CONTEXT_BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: true });
    if (error) return { ok: false, code: "KMB-E901", detail: error.message };
    return { ok: true, value: path };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * routeKey (EDITABLE_ROUTES のキー) を撮影し、webp base64 + Storage パスを返す。
 * routeKey の検証 (SSRF 対策) は buildScreenshotTargetUrl (route-key.ts) に委譲する。
 */
export async function captureRouteScreenshot(routeKey: string): Promise<Result<ScreenshotCapture>> {
  const cached = getCached(routeKey);
  if (cached) return { ok: true, value: cached };

  const urlResult = buildScreenshotTargetUrl(routeKey);
  if (!urlResult.ok) return urlResult;

  let png: Buffer;
  try {
    png = await launchAndCapturePng(urlResult.value);
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }

  let webp: Buffer;
  try {
    webp = await compressToWebp(png);
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }

  const uploadResult = await uploadToStorage(routeKey, webp);
  if (!uploadResult.ok) return uploadResult;

  const capture: ScreenshotCapture = {
    dataBase64: webp.toString("base64"),
    mimeType: "image/webp",
    storagePath: uploadResult.value,
  };
  captureCache.set(routeKey, { capture, capturedAt: Date.now() });
  return { ok: true, value: capture };
}
