import { z } from "zod";

/**
 * 必須 env (Supabase 接続 + サイト URL)。欠けている場合は起動時に明確なエラーで停止する。
 * それ以外の機能別 env (Resend / Anthropic / OpenAI / X / Meta / cron secret 等) は
 * 各機能が Phase 2 以降で順次有効化される前提のため任意設定とし、
 * 未設定時は当該機能を無効化する (graceful degradation。設計書 §1.2 / §6.3 / §16.2)。
 *
 * (Wave 1-A 実装時の訂正メモ — オーケストレーターへ報告済み)
 * SUPABASE_SERVICE_ROLE_KEY は当初 z.string().min(1) (必須) だったが、実運用の
 * .env.local ではまだ未払い出し (空文字) であり、この必須検証のままだと
 * getEnv() が全機能 (ログインなど service role を全く使わない処理を含む) の
 * 起動時に例外を投げてしまう。RESEND_API_KEY 等と同様に任意設定へ変更し、
 * service role が必要な処理 (isAdmin の他者 profile 参照・署名付き URL 発行等) は
 * 個別に isServiceRoleConfigured() で確認した上で KMB-E9xx 相当に degrade する。
 */
/**
 * (2026-07-08 訂正 — オーケストレーターへ報告済み)
 * .env.local / Vercel の運用では「未払い出しの機能別キー」を空文字 ("") で
 * プレースホルダとして残す運用が実在する (例: SUPABASE_SERVICE_ROLE_KEY=)。
 * z.string().min(1).optional() は値が undefined の場合のみ検証をバイパスし、
 * 空文字は素通りせず min(1) 違反として弾いてしまう (optional() は「キー自体の省略」
 * のみを許すため)。これにより空文字プレースホルダが 1 つでも存在すると
 * getEnv() が全機能について例外を投げてしまい、graceful degradation の意図
 * (値の有無で機能の有効/無効を判定する) が成立しない。
 * 空文字を undefined に正規化してから optional 検証する preprocess で対処する。
 */
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value === "" ? undefined : value;

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  // 機能別 (任意)。フォーマットのみ緩く検証し、値の有無で機能の有効/無効を判定する。
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  REVALIDATE_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  JOBS_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  // 公開フォームの rate limit (contact_inquiries anon INSERT の spam 対策) で IP を hash する
  // salt。未設定時は固定フォールバック値を使う (rate limit は spam 抑止目的であり認可境界では
  // ないため未設定でも機能停止はしない。本番では設定を強く推奨。Wave1-D 統合分)。
  RATE_LIMIT_IP_SALT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ---- AI スタジオ (Phase 2a〜。設計書 §1.2)。未設定時は /admin/studio が
  // 「API キー未設定」バナーを表示し、実行系ボタンを無効化する (graceful degradation)。
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ---- SNS 配信 (Wave2-F distribution。設計書 §7.7 / §8、契約書 §7.3-7.4) ----
  // Preview 環境では OAuth 接続機能そのものを無効化する明示スイッチ (設計書 §7.7)。
  OAUTH_ENABLED: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
  // state + code_verifier を暗号化 httpOnly cookie に載せる際の対称鍵の素材 (32 文字以上)。
  OAUTH_STATE_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  X_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  X_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  META_APP_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  META_APP_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ---- 外部カレンダー同期 (Wave3 scheduling。docs/design/crm-suite/03-scheduling.md §8.2、
  // 00-overview §5.4)。MS_CALENDAR_CLIENT_ID/SECRET は #55 (Microsoft) の担当のため、
  // このモジュール (#54: Google のみ) では追加しない (未実装 provider の env キーを
  // OAuth route が誤って参照しないようにするための意図的なスコープ限定)。
  GOOGLE_CALENDAR_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ---- 電話連携 (Wave3 telephony。docs/design/crm-suite/04-telephony.md §1.3/§1.4/§4.6) ----
  // 15 秒制約下で Vault RPC 往復を避けるため env 直読み (Vault は使わない — 発注指示)。
  // 番号自体 (phone_number_e164/forward_to_e164) は settings.telephony キーが保持し、
  // env はこの 2 つの認証情報のみ (§1.4 番号非依存設計)。twilio npm パッケージは使わない
  // (署名検証は node:crypto 自前実装 — src/lib/telephony-signature.ts)。
  TWILIO_ACCOUNT_SID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  TWILIO_AUTH_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  // ---- 帳票 PDF 印刷トークン (Wave3 sales。docs/design/crm-suite/02-sales.md §7.3) ----
  // /print/documents/[id] への一時アクセスを許可する HMAC 署名の鍵素材。他の秘匿情報と同様
  // env 管理 (Vault 対象ではない — Issue #50 実装規約リマインダ)。未設定時は発行系 UI を
  // disabled + degrade バナーに倒す (isPrintTokenSecretConfigured() で判定)。
  PRINT_TOKEN_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
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

/** service_role key が設定済みかどうか。未設定時は呼び出し側が KMB-E9xx 相当で機能を無効化する */
export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** pg_cron からの起床 webhook を検証するための共有シークレットが設定済みか */
export function isJobsSecretConfigured(): boolean {
  return Boolean(process.env.JOBS_SECRET);
}

/** /api/revalidate webhook (x-revalidate-secret) を検証するための共有シークレットが設定済みか */
export function isRevalidateSecretConfigured(): boolean {
  return Boolean(process.env.REVALIDATE_SECRET);
}

/** rate limit の IP hash 用 salt が未設定の場合のフォールバック (本番では env 設定を推奨) */
const RATE_LIMIT_IP_SALT_FALLBACK = "kumabe-tosou-rate-limit-fallback-salt-please-set-env";

/** rate limit の IP hash に使う salt。未設定時は固定フォールバックを返す */
export function getRateLimitIpSalt(): string {
  return process.env.RATE_LIMIT_IP_SALT || RATE_LIMIT_IP_SALT_FALLBACK;
}

/**
 * AI スタジオ (Claude + OpenAI STT) が両方設定済みかどうか。
 * 未設定時は /admin/studio が「API キー未設定」バナー + 実行ボタン無効化に倒す
 * (設計書 §1.2「必要アカウント」/ Wave2-E タスク「Graceful degradation」)。
 */
export function isAiStudioConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.OPENAI_API_KEY);
}

/** OAuth 接続機能全体のスイッチ (Preview 環境では無効化する運用。設計書 §7.7) */
export function isOAuthEnabled(): boolean {
  return process.env.OAUTH_ENABLED === "true" && Boolean(process.env.OAUTH_STATE_SECRET);
}

/** X (Twitter) OAuth 2.0 PKCE 接続に必要な env が揃っているか */
export function isXOAuthConfigured(): boolean {
  return isOAuthEnabled() && Boolean(process.env.X_CLIENT_ID);
}

/** Meta (Instagram) OAuth 接続に必要な env が揃っているか */
export function isMetaOAuthConfigured(): boolean {
  return isOAuthEnabled() && Boolean(process.env.META_APP_ID) && Boolean(process.env.META_APP_SECRET);
}

/**
 * Google カレンダー OAuth 接続に必要な env が揃っているか (isXOAuthConfigured と同型)。
 * 未設定時は /api/oauth/google-calendar/{start,callback} が 503 (KMB-E901) で degrade し、
 * /admin/calendar/connections が「未設定」バナー + 接続ボタン無効化を表示する
 * (docs/design/crm-suite/03-scheduling.md §8.2 / §10.4)。
 */
export function isGoogleCalendarConfigured(): boolean {
  return (
    isOAuthEnabled() &&
    Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CALENDAR_CLIENT_SECRET)
  );
}

/**
 * 電話連携 (Twilio) の env が両方設定済みかどうか。未設定時は telephony の 3 webhook
 * (voice/status/recording-status) が 503 (KMB-E802) で degrade する
 * (docs/design/crm-suite/04-telephony.md §6.1 手順 1 / §4.6)。
 */
export function isTelephonyConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID) && Boolean(process.env.TWILIO_AUTH_TOKEN);
}

/**
 * 印刷トークン (/print/documents/[id]) の HMAC 鍵が設定済みかどうか。
 * 未設定時は sales の発行系 (issueDocument/reissueDocument/reviseAndReissueDocument や
 * admin の印刷プレビュー) を disabled + degrade バナーに倒す
 * (docs/design/crm-suite/02-sales.md §7.3 末尾)。
 */
export function isPrintTokenSecretConfigured(): boolean {
  return Boolean(process.env.PRINT_TOKEN_SECRET);
}
