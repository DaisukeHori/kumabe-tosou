import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/02-sales.md §7.3 (/print/documents/[id] 署名トークン仕様) / §13.1。
 * DB 非依存の単体テスト。DB を引くケース (issuePrintToken/verifyAndConsumePrintToken の
 * print_tokens 書込) はチェーン可能な軽量モック SupabaseClient (tests/sales-repository.test.ts の
 * FakeChain パターン踏襲、is/gt/lt を追加) で検証する。ワンタイム消費そのもの (DB 側の
 * 0 行/1 行 CAS) は実 DB 依存のため §13.3 (結合テスト) の対象 — ここでは repository への
 * 呼び出し引数・成功/失敗の分岐のみを検証する。
 */

import {
  buildPrintTokenString,
  computePrintTokenHmac,
  hashPrintToken,
  isPrintTokenSecretConfigured,
  issuePrintToken,
  verifyAndConsumePrintToken,
  type PrintTokenExtras,
} from "@/modules/sales/internal/print-token";

const ORIGINAL_ENV = { ...process.env };
const SECRET = "test-print-token-secret-0123456789";
const DOCUMENT_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_DOCUMENT_ID = "99999999-8888-7777-6666-555555555555";

type PgResult = { data: unknown; error: unknown };

/** tests/sales-repository.test.ts の FakeChain と同型 (is/gt/lt を追加)。 */
class FakeChain implements PromiseLike<PgResult> {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: PgResult) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
  insert(...a: unknown[]): this {
    return this.record("insert", a);
  }
  update(...a: unknown[]): this {
    return this.record("update", a);
  }
  delete(...a: unknown[]): this {
    return this.record("delete", a);
  }
  select(...a: unknown[]): this {
    return this.record("select", a);
  }
  eq(...a: unknown[]): this {
    return this.record("eq", a);
  }
  is(...a: unknown[]): this {
    return this.record("is", a);
  }
  gt(...a: unknown[]): this {
    return this.record("gt", a);
  }
  lt(...a: unknown[]): this {
    return this.record("lt", a);
  }
  async maybeSingle(): Promise<PgResult> {
    return this.result;
  }
  then<T1 = PgResult, T2 = never>(
    onfulfilled?: ((value: PgResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** `.from()` 呼び出し順に fromQueue を消費するモック client。呼ばれるはずのない `.from()` は
 *  例外を投げる (「hmac/形式/exp 不正は DB に到達する前に弾く」ことの回帰検証を兼ねる)。 */
function buildClient(fromQueue: FakeChain[]): SupabaseClient {
  let cursor = 0;
  return {
    from: () => {
      const chain = fromQueue[cursor];
      cursor += 1;
      if (!chain) throw new Error(`fromQueue exhausted (call #${cursor})`);
      return chain;
    },
  } as unknown as SupabaseClient;
}

function noDbClient(): SupabaseClient {
  return {
    from: () => {
      throw new Error("verifyAndConsumePrintToken は DB に到達する前に拒否するべきです");
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  process.env.PRINT_TOKEN_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("print-token: 純関数 (hmac/hash)", () => {
  it("token_hash (sha256) の導出は node:crypto の sha256 と一致する", () => {
    const token = buildPrintTokenString(DOCUMENT_ID, 2_000_000_000, SECRET);
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    expect(hashPrintToken(token)).toBe(expected);
    expect(hashPrintToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computePrintTokenHmac は同一入力で決定的、document_id/exp/secret のいずれかが変われば異なる", () => {
    const base = computePrintTokenHmac(DOCUMENT_ID, 100, SECRET);
    expect(computePrintTokenHmac(DOCUMENT_ID, 100, SECRET)).toBe(base); // 決定的
    expect(computePrintTokenHmac(OTHER_DOCUMENT_ID, 100, SECRET)).not.toBe(base);
    expect(computePrintTokenHmac(DOCUMENT_ID, 101, SECRET)).not.toBe(base);
    expect(computePrintTokenHmac(DOCUMENT_ID, 100, "different-secret")).not.toBe(base);
  });

  it("isPrintTokenSecretConfigured: 設定済みは true、未設定は false", () => {
    expect(isPrintTokenSecretConfigured()).toBe(true);
    delete process.env.PRINT_TOKEN_SECRET;
    expect(isPrintTokenSecretConfigured()).toBe(false);
  });
});

describe("print-token: issuePrintToken", () => {
  it("PRINT_TOKEN_SECRET 未設定時は KMB-E640 (DB に到達しない)", async () => {
    delete process.env.PRINT_TOKEN_SECRET;
    const result = await issuePrintToken(noDbClient(), {
      documentId: DOCUMENT_ID,
      purpose: "pdf",
      payload: null,
    });
    expect(result).toEqual({
      ok: false,
      code: "KMB-E640",
      detail: expect.stringContaining("PRINT_TOKEN_SECRET"),
    });
  });

  it("payload 不正 (zPrintTokenExtras.strict() が未知キーを拒否) は KMB-E101 (DB に到達しない)", async () => {
    // 契約外キーを意図的に注入して parse 失敗を検証する (any は使わず unknown 経由でキャスト)。
    const invalidPayload = { unexpected_key: "x" } as unknown as PrintTokenExtras;
    const result = await issuePrintToken(noDbClient(), {
      documentId: DOCUMENT_ID,
      purpose: "pdf",
      payload: invalidPayload,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("正常発行: cleanup→insert の順で呼ばれ、token_hash = sha256(発行した token) が insert される", async () => {
    const cleanupChain = new FakeChain({ data: null, error: null });
    const insertChain = new FakeChain({ data: null, error: null });
    const client = buildClient([cleanupChain, insertChain]);

    const result = await issuePrintToken(client, {
      documentId: DOCUMENT_ID,
      purpose: "pdf",
      payload: { doc_no: "Q-2026-0001" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token.split(".")).toHaveLength(3);

    expect(cleanupChain.calls[0]?.method).toBe("delete");
    expect(insertChain.calls[0]?.method).toBe("insert");
    const insertedRow = insertChain.calls[0]?.args[0] as { token_hash: string; payload: unknown };
    expect(insertedRow.token_hash).toBe(hashPrintToken(result.value.token));
    expect(insertedRow.payload).toEqual({ doc_no: "Q-2026-0001" });
  });

  it("staging_id を payload に持つトークンも発行できる (zPrintTokenExtras — 訂正フロー)", async () => {
    const client = buildClient([
      new FakeChain({ data: null, error: null }),
      new FakeChain({ data: null, error: null }),
    ]);
    const result = await issuePrintToken(client, {
      documentId: DOCUMENT_ID,
      purpose: "pdf",
      payload: { staging_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("print-token: verifyAndConsumePrintToken", () => {
  it("正 token 往復 PASS: 発行した token を検証・消費すると同じ document_id/purpose/payload が返る", async () => {
    const issueClient = buildClient([
      new FakeChain({ data: null, error: null }), // cleanup
      new FakeChain({ data: null, error: null }), // insert
    ]);
    const issued = await issuePrintToken(issueClient, {
      documentId: DOCUMENT_ID,
      purpose: "pdf",
      payload: { doc_no: "Q-2026-0001" },
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const consumeChain = new FakeChain({
      data: { document_id: DOCUMENT_ID, purpose: "pdf", payload: { doc_no: "Q-2026-0001" } },
      error: null,
    });
    const verifyClient = buildClient([consumeChain]);

    const verified = await verifyAndConsumePrintToken(verifyClient, issued.value.token);
    expect(verified).toEqual({
      ok: true,
      value: { documentId: DOCUMENT_ID, purpose: "pdf", payload: { doc_no: "Q-2026-0001" } },
    });
    expect(consumeChain.calls[0]?.method).toBe("update");
  });

  it("DB 側 0 行 (消費済み/期限切れ/未登録) は KMB-E642", async () => {
    const consumeChain = new FakeChain({ data: null, error: null });
    const client = buildClient([consumeChain]);
    const token = buildPrintTokenString(DOCUMENT_ID, Math.floor(Date.now() / 1000) + 300, SECRET);

    const result = await verifyAndConsumePrintToken(client, token);
    expect(result).toEqual({ ok: false, code: "KMB-E642" });
  });

  it("exp 超過 (期限切れ) は DB に到達せず KMB-E642", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const token = buildPrintTokenString(DOCUMENT_ID, pastExp, SECRET);
    const result = await verifyAndConsumePrintToken(noDbClient(), token);
    expect(result).toEqual({ ok: false, code: "KMB-E642" });
  });

  it("hmac 1 文字改竄は DB に到達せず KMB-E642", async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = buildPrintTokenString(DOCUMENT_ID, exp, SECRET);
    const [documentId, expStr, hmacHex] = token.split(".");
    const flippedChar = hmacHex[0] === "0" ? "1" : "0";
    const tampered = `${documentId}.${expStr}.${flippedChar}${hmacHex.slice(1)}`;

    const result = await verifyAndConsumePrintToken(noDbClient(), tampered);
    expect(result).toEqual({ ok: false, code: "KMB-E642" });
  });

  it("document_id 差し替え (hmac は元の document_id で署名されたまま) は DB に到達せず KMB-E642", async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = buildPrintTokenString(DOCUMENT_ID, exp, SECRET);
    const [, expStr, hmacHex] = token.split(".");
    const tampered = `${OTHER_DOCUMENT_ID}.${expStr}.${hmacHex}`;

    const result = await verifyAndConsumePrintToken(noDbClient(), tampered);
    expect(result).toEqual({ ok: false, code: "KMB-E642" });
  });

  it.each([
    ["区切り欠落 (2 パーツ)", `${DOCUMENT_ID}.123`],
    ["区切り過多 (4 パーツ)", `${DOCUMENT_ID}.123.abcd.extra`],
    ["document_id が UUID 形式でない", `not-a-uuid.123.${"a".repeat(64)}`],
    ["exp が数値でない", `${DOCUMENT_ID}.not-a-number.${"a".repeat(64)}`],
    ["hmac が 64 桁 hex でない (短い)", `${DOCUMENT_ID}.123.abcd`],
    ["hmac が hex 以外の文字を含む", `${DOCUMENT_ID}.123.${"g".repeat(64)}`],
  ])("形式不正: %s は DB に到達せず KMB-E642", async (_label, malformed) => {
    const result = await verifyAndConsumePrintToken(noDbClient(), malformed);
    expect(result).toEqual({ ok: false, code: "KMB-E642" });
  });

  it("PRINT_TOKEN_SECRET 未設定時は DB に到達せず KMB-E642 (degrade)", async () => {
    delete process.env.PRINT_TOKEN_SECRET;
    const result = await verifyAndConsumePrintToken(noDbClient(), "anything.123.abcd");
    expect(result).toEqual({ ok: false, code: "KMB-E642" });
  });
});
