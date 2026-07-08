import { createHash, randomBytes } from "node:crypto";

/**
 * X OAuth 2.0 Authorization Code + PKCE 用のヘルパ (設計書 §7.7 / 契約書 §7.3)。
 * distribution モジュール固有ではなく汎用の暗号ユーティリティのため、
 * src/lib/supabase/* と同様に src/lib/ に置く (module-contracts.md §2 の
 * モジュール境界とは無関係な共通 infra)。
 */

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32)); // 43-128 文字の RFC 7636 要件を満たす
}

export function computeCodeChallenge(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}
