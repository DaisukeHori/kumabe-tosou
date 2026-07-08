"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * ブラウザ (Client Component) 専用の anon key client。
 *
 * NEXT_PUBLIC_* は Next.js のビルド時にリテラルとして静的置換されるため、
 * getEnv() (process.env 全体を Zod で検証する server 向けヘルパ) はここでは使わない
 * (client バンドルには process.env オブジェクト全体が存在しないため)。
 *
 * 用途: /admin/media の署名付きアップロード URL への直 PUT (uploadToSignedUrl) など、
 * ブラウザから直接 Supabase Storage を叩く必要がある処理に限定して使う。
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
