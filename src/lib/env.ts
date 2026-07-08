import { z } from "zod";

/**
 * 必須 env (Supabase 接続 + サイト URL)。欠けている場合は起動時に明確なエラーで停止する。
 * それ以外の機能別 env (Resend / Anthropic / OpenAI / X / Meta / cron secret 等) は
 * 各機能が Phase 2 以降で順次有効化される前提のため任意設定とし、
 * 未設定時は当該機能を無効化する (graceful degradation。設計書 §1.2 / §6.3 / §16.2)。
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  // 機能別 (任意)。フォーマットのみ緩く検証し、値の有無で機能の有効/無効を判定する。
  RESEND_API_KEY: z.string().min(1).optional(),
  REVALIDATE_SECRET: z.string().min(1).optional(),
  JOBS_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * 必須 env を検証して返す。未設定/不正な場合は例外を投げる
 * (呼び出し側 — Route Handler / Server Action / スクリプト — で早期に失敗させる意図)。
 */
export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(`環境変数の検証に失敗しました (${issues})。.env.example を参照してください。`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/** 通知メール (Resend) が設定済みかどうか。未設定時は呼び出し側が KMB-E902 相当でログのみに倒す */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** pg_cron からの起床 webhook を検証するための共有シークレットが設定済みか */
export function isJobsSecretConfigured(): boolean {
  return Boolean(process.env.JOBS_SECRET);
}
