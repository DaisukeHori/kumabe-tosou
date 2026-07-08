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
 *
 * (2026-07-08 admin セッション対応 — オーケストレーターへ報告済み)
 * service_role キーが未払い出しのまま運用する方針が確定したため、
 * SUPABASE_SERVICE_ROLE_KEY が設定されていれば従来通り service role client を返し、
 * 未設定の場合は BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD で
 * signInWithPassword した authenticated (admin profile) client を代替として返す。
 * 対象テーブルの RLS は is_admin() ポリシーで許可される前提
 * (migration 20260708000012 で work_images / seed_manifest を admin に開放済み。
 * それ以外の works / media / voices / posts / price 系 / site_settings は既存 migration で
 * admin 全権が付与済み)。どちらの env も無ければ明確なエラーで停止する。
 */
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { getEnv } from "@/lib/env";

export async function createScriptServiceClient() {
  const env = getEnv();

  const realtime = {
    // Node.js 20 にはネイティブ WebSocket が無く、createClient() が無条件で行う
    // RealtimeClient 初期化が例外になるため "ws" を渡す (実測確認済み)。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: WebSocket as any,
  };

  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime,
    });
  }

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY も BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD も未設定です。" +
        "いずれかを .env.local に設定してください。",
    );
  }

  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime,
  });

  const { error } = await client.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (error) {
    throw new Error(`admin セッションログインに失敗しました (${adminEmail}): ${error.message}`);
  }

  return client;
}
