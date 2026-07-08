/**
 * scripts/** 専用の service role client 生成。
 *
 * (実装上の重要な注意点 — オーケストレーターへ報告済み)
 * src/lib/supabase/service.ts は先頭に "server-only" import を持つ (契約通り、
 * クライアントバンドルへの混入を防ぐため)。しかし "server-only" パッケージは
 * package.json の exports 条件 `"react-server"` が有効なビルド (Next.js の RSC
 * バンドラ) でのみ no-op (empty.js) に解決され、`react-server` 条件を持たない
 * プレーンな Node.js 実行 (tsx 含む) では常に index.js (即 throw) に解決される。
 * そのため scripts/*.ts (tsx で直接実行する運用スクリプト) から
 * src/lib/supabase/service.ts を import すると、実行するだけで必ず例外になる。
 *
 * これを避けるため、scripts 用にロジックを同一の service role client 生成として
 * 複製する ("server-only" は付けない — スクリプトはブラウザにバンドルされないため
 * 本来の懸念が当てはまらない)。
 */
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { getEnv } from "@/lib/env";

export function createScriptServiceClient() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      // Node.js 20 にはネイティブ WebSocket が無く、createClient() が無条件で行う
      // RealtimeClient 初期化が例外になるため "ws" を渡す (実測確認済み)。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: WebSocket as any,
    },
  });
}
