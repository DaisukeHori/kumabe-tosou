import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { getEnv } from "@/lib/env";

/**
 * 公開サイト (site-public) の読み取り専用 fetch 専用 anon client。
 *
 * createSupabaseServerClient (src/lib/supabase/server.ts) は next/headers の cookies() に
 * 依存するため、unstable_cache() 内部や generateStaticParams() / generateMetadata() など
 * cookies() を呼べないコンテキストからは使えない (Next.js が実行時エラーにする)。
 * 公開一覧・詳細ページは認証セッションを必要としない匿名読み取りのみのため、
 * cookie 非依存のプレーンな anon client を別途用意する (cms-ai-pipeline.md §6.1)。
 * RLS は anon ロールでそのまま適用される (認可マトリクス §3.2)。
 *
 * realtime.transport: createClient() は無条件で RealtimeClient を初期化するため、
 * Node.js 20 (本プロジェクトの .nvmrc / engines 対象) ではネイティブ WebSocket が無く
 * 即例外になる (src/lib/supabase/service.ts / server.ts と同じ理由・実測確認済み)。
 */
export function createSupabasePublicClient() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: WebSocket as any,
    },
  });
}
