import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import WebSocket from "ws";

import { getEnv } from "@/lib/env";

/**
 * Server Components / Route Handlers / Server Actions から使う anon key (SSR) client。
 * ユーザーセッション (cookie) を伴ってアクセスするため RLS がそのまま適用される
 * (認可マトリクス cms-ai-pipeline.md §3.2 に従う)。
 * service role key は絶対に使わない — 権限昇格が必要な処理は @/lib/supabase/service を使う。
 *
 * realtime.transport: createClient() は無条件で RealtimeClient を初期化するため、
 * Node.js 20 (本プロジェクトの .nvmrc / engines 対象) ではネイティブ WebSocket が無く
 * 即例外になる (実測確認済み、src/lib/supabase/service.ts と同じ理由)。
 */
export async function createSupabaseServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component (読み取り専用コンテキスト) から呼ばれた場合は無視する。
          // セッションの cookie 更新は middleware が担う。
        }
      },
    },
    realtime: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: WebSocket as any,
    },
  });
}
