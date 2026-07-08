import "server-only";

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { getEnv } from "@/lib/env";

/**
 * service_role key client。RLS を完全にバイパスするため、Route Handler / Server Action の
 * サーバ処理内でのみ使用する (scripts/** からは import 不可 — 下記注記参照)。
 * 先頭の "server-only" import により、誤ってクライアントバンドルに含まれた場合は
 * ビルドエラーになる (契約書 §3.6 の Vault アクセス規約・cms-ai-pipeline.md §3.3 と同じ思想)。
 *
 * 注: "server-only" は package.json の `"react-server"` export 条件でのみ no-op に解決され、
 * その条件を持たない実行環境 (tsx 等のプレーン Node.js 実行) では import した瞬間に例外を
 * 投げる。そのため scripts/**.ts は本ファイルを使わず scripts/lib/service-client.ts の
 * 専用ファクトリを使う (同じロジックだが "server-only" を付けない)。
 *
 * realtime.transport: @supabase/supabase-js は createClient() 実行時に無条件で
 * RealtimeClient を初期化するため、Node.js 20 (本プロジェクトの .nvmrc / engines 対象)
 * ではネイティブ WebSocket が無く即例外になる (実測確認済み)。"ws" パッケージを
 * transport として明示的に渡すことで回避する (Node 20 では必須。Node 22+ の
 * ネイティブ WebSocket でも動作に支障はない)。
 *
 * SUPABASE_SERVICE_ROLE_KEY は任意設定 (env.ts 参照)。未設定環境では呼び出し元が
 * catch して KMB-E9xx 相当に degrade する前提で、ここでは明確なメッセージの例外を投げる。
 */
export function createSupabaseServiceClient() {
  const env = getEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY が未設定です。service role 依存機能は無効化されています。",
    );
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      // "ws" の型定義と @supabase/realtime-js の WebSocketLikeConstructor の
      // シグネチャは実行時には互換だが型定義上は一致しないため any キャストする
      // (Node.js ランタイムでの既知の回避策)。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: WebSocket as any,
    },
  });
}
