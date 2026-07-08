import { createHash } from "node:crypto";

/**
 * contact フォームのスパム対策・rate limit の純粋ロジック (I/O を持たない)。
 * cms-ai-pipeline.md §3.3: rate limit (IP ごと 5 件/時) + honeypot + 送信最小時間 (3 秒)。
 *
 * DB アクセスを伴う実際の rate limit 記録は ./rate-limit.server.ts (service client 使用)。
 * ここに置く関数は単体テスト (tests/contact-spam-guard.test.ts) で時刻・入力値を注入して
 * 検証できるよう、すべて副作用なしの純粋関数にしている。
 */

export const RATE_LIMIT_MAX_PER_HOUR = 5;
export const MIN_SUBMIT_MS = 3000;
export const CONTACT_FORM_RATE_LIMIT_ROUTE = "contact_form";

/** honeypot (隠しフィールド) に値が入っていれば bot とみなす */
export function isHoneypotFilled(value: string): boolean {
  return value.trim().length > 0;
}

/** フォーム表示から送信までの経過時間が閾値未満なら bot とみなす */
export function isSubmittedTooFast(params: {
  formRenderedAt: number;
  submittedAt: number;
  minMs?: number;
}): boolean {
  const { formRenderedAt, submittedAt, minMs = MIN_SUBMIT_MS } = params;
  return submittedAt - formRenderedAt < minMs;
}

/** rate limit の集計単位 (1 時間) の開始時刻。UTC 時単位に floor する */
export function computeWindowStart(now: Date): Date {
  const hourMs = 60 * 60 * 1000;
  return new Date(Math.floor(now.getTime() / hourMs) * hourMs);
}

/** 現在の集計件数が上限に達しているか */
export function isRateLimited(currentCount: number, max: number = RATE_LIMIT_MAX_PER_HOUR): boolean {
  return currentCount >= max;
}

/** IP を salt 付き SHA-256 で hash する (生 IP は保持しない。cms-ai-pipeline.md §2.2) */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** x-forwarded-for / x-real-ip ヘッダからクライアント IP を取り出す */
export function extractClientIp(forwardedFor: string | null, realIp: string | null): string {
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return "unknown";
}
