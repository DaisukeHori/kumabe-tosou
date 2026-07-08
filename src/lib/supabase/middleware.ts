import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getEnv } from "@/lib/env";

/**
 * middleware.ts から呼ぶセッション更新ヘルパ (Supabase SSR 標準パターン)。
 *
 * - リクエスト cookie からセッションを読み、期限が近ければ自動リフレッシュして
 *   レスポンス cookie に書き戻す (これをしないと Server Component 側で
 *   セッションが静かに失効する)。
 * - 併せて、後続の Server Component (admin/layout.tsx) がログイン画面かどうかを
 *   判定できるよう、リクエストヘッダに現在の pathname を積む
 *   (`headers()` 経由で読める。App Router に pathname を渡す一般的な回避策)。
 *
 * realtime は middleware (Edge/Node 双方で動きうる) では使わないため
 * server.ts / service.ts と異なり ws transport の指定は不要。
 */
export async function updateSupabaseSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const env = getEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
