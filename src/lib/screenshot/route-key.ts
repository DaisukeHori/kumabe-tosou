import "server-only";

import { z } from "zod";

import { getEnv } from "@/lib/env";
import { EDITABLE_ROUTES } from "@/modules/page-media/facade";
import type { Result } from "@/modules/platform/contracts";

/**
 * スクショ Route Handler (/api/ai/screenshot) の SSRF 対策 (canonical:
 * docs/design/ai-studio-v2.md §5 / §11 MAJOR-5)。
 *
 * 「URL を受け取らない。routeKey (EDITABLE_ROUTES のキー) のみを受け、URL はサーバー側で
 * `new URL(route, SITE_URL)` により構築する。絶対 URL・`//`・エンコード済みスラッシュ・
 * クエリ付き入力は Zod で拒否する」の実体。判定は 2 段階:
 *   1) 形式の拒否 (SUSPICIOUS_PATTERNS): スキーム付き絶対 URL・プロトコル相対 (//)・
 *      クエリ/フラグメント・エンコード済みスラッシュ/バックスラッシュ・生バックスラッシュ・
 *      動的ルートパターン ([slug] 等、実 URL を構築できないため本フェーズは対象外)・
 *      制御文字 (タブ/改行/CR 等。WHATWG URL パーサーが文字列中のどこにあっても除去するため、
 *      "/\t/evil.example" のような host injection の温床になり得る)。
 *   2) EDITABLE_ROUTES (page-media registry) に実在する静的ルートであること。
 */

export const zScreenshotRequest = z
  .object({
    routeKey: z.string().min(1).max(200),
  })
  .strict();
export type ScreenshotRequest = z.infer<typeof zScreenshotRequest>;

const SUSPICIOUS_PATTERNS: readonly RegExp[] = [
  /^[a-z][a-z0-9+.-]*:/i, // スキーム付き絶対 URL ("https:", "javascript:" 等)
  /^\/\//, // プロトコル相対 URL ("//evil.example")
  /[?#]/, // クエリ / フラグメント
  /%2f/i, // エンコード済みスラッシュ
  /%5c/i, // エンコード済みバックスラッシュ
  /\\/, // 生バックスラッシュ
  /\[/, // 動的ルートパターン ("works/[slug]" 等。本フェーズは静的ルートのみ対応)
  // 制御文字 (タブ/改行/CR 等): WHATWG URL がパース時に文字列のどこにあっても除去する仕様
  // (例: "/\t/evil.example" → "https://evil.example/") のため、位置を問わず拒否する。
  // 現状は EDITABLE_ROUTES の完全一致比較 (二段目) がこの種の文字列を既に排除しているが、
  // 多層防御としてこの層でも明示的に閉じておく。
  /[\x00-\x1f\x7f]/,
];

/** routeKey の形式検証 + EDITABLE_ROUTES 実在確認のみを行う純関数 (URL は組み立てない)。 */
export function validateRouteKey(routeKey: string): Result<string> {
  if (SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(routeKey))) {
    return { ok: false, code: "KMB-E101", detail: `routeKey に不正な形式が含まれています: ${routeKey}` };
  }
  if (!routeKey.startsWith("/") || !EDITABLE_ROUTES.includes(routeKey)) {
    return { ok: false, code: "KMB-E107", detail: `未知の routeKey です: ${routeKey}` };
  }
  return { ok: true, value: routeKey };
}

/**
 * 検証済み routeKey から自サイトの絶対 URL を組み立てる。
 * `new URL(path, base)` は path が相対パス (先頭 "/") である限り必ず base のオリジンに解決される
 * (validateRouteKey が絶対 URL・"//" を弾いているため、ここに到達する時点で安全)。
 */
export function buildScreenshotTargetUrl(routeKey: string): Result<string> {
  const validated = validateRouteKey(routeKey);
  if (!validated.ok) return validated;
  try {
    const url = new URL(validated.value, getEnv().NEXT_PUBLIC_SITE_URL);
    return { ok: true, value: url.toString() };
  } catch (err) {
    return { ok: false, code: "KMB-E101", detail: err instanceof Error ? err.message : String(err) };
  }
}
