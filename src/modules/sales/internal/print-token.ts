import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";

import { zPrintTokenExtras } from "../contracts";
import {
  cleanupExpiredPrintTokens,
  consumePrintToken,
  insertPrintToken,
  type PrintTokenPurpose,
} from "../repository";

/**
 * canonical: docs/design/crm-suite/02-sales.md §7.3 (/print/documents/[id] 署名トークン仕様)。
 * 単体テスト: tests/sales-print-token.test.ts (§13.1)。
 *
 * トークン文字列: `${document_id}.${exp}.${hmac}`
 *   exp  = 発行時刻 + 300 秒 (unix 秒)
 *   hmac = HMAC-SHA256(`${document_id}.${exp}`, PRINT_TOKEN_SECRET) の hex 64 桁
 * ワンタイム消費 (v1.1): 発行時に print_tokens へ INSERT (token_hash = sha256(トークン全文))、
 * 検証時に 1 回だけ UPDATE ... RETURNING で消費する (repository.consumePrintToken)。
 *
 * hmac 比較は必ず timingSafeEqual (DB を引く前の偽造遮断 — src/lib/telephony-signature.ts と
 * 同型のパターン)。
 */

const TOKEN_TTL_SECONDS = 300; // 5 分 (§7.3)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXP_RE = /^\d+$/;
const HMAC_HEX_RE = /^[0-9a-f]{64}$/;

export type { PrintTokenPurpose };
export type PrintTokenExtras = { doc_no?: string; staging_id?: string };

/** PRINT_TOKEN_SECRET が設定済みかどうか (src/lib/env.ts の isPrintTokenSecretConfigured と同値。
 *  internal/ 配下は "server-only" のためこちらでも独立に判定できるよう再掲する)。 */
export function isPrintTokenSecretConfigured(): boolean {
  return Boolean(process.env.PRINT_TOKEN_SECRET);
}

function requireSecret(): string {
  const secret = process.env.PRINT_TOKEN_SECRET;
  if (!secret) {
    throw new Error("PRINT_TOKEN_SECRET が未設定です。印刷トークンの発行/検証はできません。");
  }
  return secret;
}

/** HMAC-SHA256(`${documentId}.${exp}`, secret) の hex (テスト用に secret を明示的に受け取る純関数)。 */
export function computePrintTokenHmac(documentId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${documentId}.${exp}`).digest("hex");
}

/** token_hash 列に保存する値 = sha256(トークン全文) の hex (HMAC 値のハッシュではない — §2.3.2 注記)。 */
export function hashPrintToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildPrintTokenString(documentId: string, exp: number, secret: string): string {
  return `${documentId}.${exp}.${computePrintTokenHmac(documentId, exp, secret)}`;
}

function parseTokenString(token: string): { documentId: string; exp: number; hmacHex: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [documentId, expStr, hmacHex] = parts;
  if (!UUID_RE.test(documentId)) return null;
  if (!EXP_RE.test(expStr)) return null;
  if (!HMAC_HEX_RE.test(hmacHex)) return null;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isSafeInteger(exp)) return null;
  return { documentId, exp, hmacHex };
}

export type IssuePrintTokenInput = {
  documentId: string;
  purpose: PrintTokenPurpose;
  /** null = 現 DB 値のみ描画。非 null は zPrintTokenExtras で検証してから保存する。 */
  payload: PrintTokenExtras | null;
};

/**
 * 印刷トークンの発行 (internal/pdf.ts の PDF 撮影直前、および admin 印刷プレビュー用
 * Server Action から呼ばれる — §7.3「発行者」)。client は service client を渡すこと
 * (print_tokens は RLS ポリシーなし + revoke の service 専用テーブル)。
 */
export async function issuePrintToken(
  client: SupabaseClient,
  input: IssuePrintTokenInput,
): Promise<Result<{ token: string; expiresAt: string }>> {
  if (!isPrintTokenSecretConfigured()) {
    return {
      ok: false,
      code: "KMB-E640",
      detail: "PRINT_TOKEN_SECRET が未設定です。印刷トークンを発行できません。",
    };
  }

  let parsedPayload: PrintTokenExtras | null = null;
  if (input.payload !== null) {
    const parsed = zPrintTokenExtras.safeParse(input.payload);
    if (!parsed.success) {
      return { ok: false, code: "KMB-E101", detail: parsed.error.message };
    }
    parsedPayload = parsed.data;
  }

  const secret = requireSecret();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = nowSeconds + TOKEN_TTL_SECONDS;
  const token = buildPrintTokenString(input.documentId, exp, secret);
  const expiresAt = new Date(exp * 1000).toISOString();

  // 期限切れ行のベストエフォート掃除 (§7.3「発行時にベストエフォート掃除」)。
  // 失敗しても発行処理自体は継続する (地雷回避対象外 — repository.cleanupExpiredPrintTokens の注記参照)。
  await cleanupExpiredPrintTokens(client);

  const inserted = await insertPrintToken(client, {
    tokenHash: hashPrintToken(token),
    documentId: input.documentId,
    purpose: input.purpose,
    payload: parsedPayload,
    expiresAt,
  });
  if (!inserted.ok) return inserted;

  return { ok: true, value: { token, expiresAt } };
}

export type VerifiedPrintToken = {
  documentId: string;
  purpose: PrintTokenPurpose;
  payload: PrintTokenExtras | null;
};

/**
 * トークンの検証 + ワンタイム消費 (/print route から呼ばれる。§7.3 手順 1〜3)。
 * 失敗理由 (形式不正/document_id 不一致/exp 超過/hmac 不一致/DB 側 0 行のいずれか) は
 * 一律 KMB-E642 とし detail を返さない (§7.3「本文はコードのみ。詳細を返さない」— URL 漏洩時の
 * 再取得防止と同じ思想でエラー詳細も最小化する)。
 */
export async function verifyAndConsumePrintToken(
  client: SupabaseClient,
  token: string,
): Promise<Result<VerifiedPrintToken>> {
  if (!isPrintTokenSecretConfigured()) {
    return { ok: false, code: "KMB-E642" };
  }
  const parsed = parseTokenString(token);
  if (!parsed) {
    return { ok: false, code: "KMB-E642" };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.exp < nowSeconds) {
    return { ok: false, code: "KMB-E642" };
  }

  const secret = requireSecret();
  const expectedHex = computePrintTokenHmac(parsed.documentId, parsed.exp, secret);
  const expectedBuf = Buffer.from(expectedHex, "utf8");
  const providedBuf = Buffer.from(parsed.hmacHex, "utf8");
  // 長さは HMAC_HEX_RE で 64 桁固定を検証済みだが、timingSafeEqual は長さ不一致で例外を
  // 投げるため念のため先に比較する (src/lib/telephony-signature.ts と同型の安全策)。
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, code: "KMB-E642" };
  }

  const tokenHash = hashPrintToken(token);
  const consumed = await consumePrintToken(client, tokenHash);
  if (!consumed.ok) return consumed;
  if (!consumed.value) {
    // 0 行 = 消費済み / 期限切れ / 未登録 (DB 側で判明。区別せず一律 E642 — §7.3)
    return { ok: false, code: "KMB-E642" };
  }
  if (consumed.value.document_id !== parsed.documentId) {
    // 理論上到達しない (hmac が document_id を署名対象に含むため偽造不可) が、
    // token_hash 衝突等の万一の DB 不整合に対する多層防御として明示的に拒否する。
    return { ok: false, code: "KMB-E642" };
  }

  const payloadParsed =
    consumed.value.payload === null ? null : zPrintTokenExtras.safeParse(consumed.value.payload);
  if (payloadParsed && !payloadParsed.success) {
    return { ok: false, code: "KMB-E642" };
  }

  return {
    ok: true,
    value: {
      documentId: parsed.documentId,
      purpose: consumed.value.purpose,
      payload: payloadParsed && payloadParsed.success ? payloadParsed.data : null,
    },
  };
}
