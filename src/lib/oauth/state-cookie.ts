import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getEnv } from "@/lib/env";

/**
 * OAuth state / code_verifier (+ Meta ページ選択の一時データ) を保持する
 * 暗号化 httpOnly cookie ヘルパ (設計書 §7.7: 「暗号化 httpOnly cookie (TTL 10 分, SameSite=Lax)」)。
 * AES-256-GCM で任意の JSON ペイロードを暗号化する汎用ユーティリティ。
 */

const ALGO = "aes-256-gcm";

function deriveKey(): Buffer {
  const env = getEnv();
  const secret = env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error("OAUTH_STATE_SECRET が未設定のため OAuth cookie を暗号化できません");
  return createHash("sha256").update(secret).digest(); // 32 バイト鍵
}

export function encryptCookiePayload(payload: unknown): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(payload), "utf-8");
  const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptCookiePayload<T>(cookieValue: string): T | null {
  try {
    const key = deriveKey();
    const buf = Buffer.from(cookieValue, "base64url");
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf-8")) as T;
  } catch {
    return null;
  }
}

export const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60; // TTL 10 分 (設計書 §7.7)
