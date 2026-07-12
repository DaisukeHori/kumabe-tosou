import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DocumentLineInput, DocumentTotals, PaymentInput } from "@/modules/sales/contracts";
import {
  createDraftDocument,
  deleteDraftDocument,
  deletePayment,
  getDocumentById,
  insertPayment,
  issueDocumentNumber,
  listDocumentsPage,
  saveDraftDocument,
  updateDocumentStatusWithCas,
  type CreateDraftDocumentInput,
  type SaveDraftHeader,
} from "@/modules/sales/repository";

/**
 * canonical: docs/design/crm-suite/02-sales.md §1.3 (repository 配置規約) / §2.6-7 (document_number_next
 * 利用規約) / 00-overview §3.4 (採番 RPC)。repository.ts は DB 未接続では検証できないため、
 * ai-providers-repository.test.ts / crm-dedup.test.ts の確立パターン (チェーン可能な軽量モック
 * SupabaseClient) を踏襲し、以下を検証する:
 *  1. document_number_next / document_save_draft RPC への接続 (RPC 名・パラメータ・JST 年解決)
 *  2. CAS (楽観排他) の 3 分岐 (一致 / 不一致+対象存在 / 不一致+対象不在) が正しく Result.code に
 *     変換されること (document_save_draft の CAS は「二重送信で二重適用されない」冪等性の安全側実装)
 *  3. 【地雷: エラー握り潰し厳禁】DB/RPC のエラーが空値や ok:true へ握り潰されず、常に
 *     Result.code (未登録コードは KMB-E901 にフォールバック) として正確に伝播すること
 *     (createDraftDocument の孤児 draft cleanup が本来のエラーを上書きしないことを含む)
 */

type PgResult = { data: unknown; error: unknown };

/** チェーン可能な軽量モック (ai-providers-repository.test.ts の FakeSelectChain / crm-dedup.test.ts の
 *  buildFakeClient パターン踏襲)。select/insert/update/delete/eq/or/order/limit は呼び出しを記録して
 *  自身を返す (チェーン継続)。single/maybeSingle は明示的終端。それ以外はそのまま await できる
 *  (PostgREST クエリビルダの thenable 挙動を模す)。 */
class FakeChain implements PromiseLike<PgResult> {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: PgResult) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
  select(...a: unknown[]): this {
    return this.record("select", a);
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
  eq(...a: unknown[]): this {
    return this.record("eq", a);
  }
  or(...a: unknown[]): this {
    return this.record("or", a);
  }
  order(...a: unknown[]): this {
    return this.record("order", a);
  }
  limit(...a: unknown[]): this {
    return this.record("limit", a);
  }
  async single(): Promise<PgResult> {
    return this.result;
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

function buildClient(opts: { rpc?: PgResult; fromQueue?: FakeChain[] }) {
  let cursor = 0;
  const fromCalls: string[] = [];
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  const client = {
    rpc: vi.fn((name: string, params: unknown) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(opts.rpc ?? { data: null, error: { message: `no rpc mock: ${name}` } });
    }),
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const chain = opts.fromQueue?.[cursor];
      cursor += 1;
      if (!chain) throw new Error(`unexpected extra from("${table}") call (#${cursor})`);
      return chain;
    }),
  };
  return { client: client as unknown as SupabaseClient, fromCalls, rpcCalls };
}

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const DEAL_ID = "22222222-2222-2222-2222-222222222222";

const lineInput: DocumentLineInput = {
  description: "施工費",
  quantity: 1,
  unit: "式",
  unit_price_jpy: 10_000,
  amount_jpy: 10_000,
  tax_category: "standard_10",
  work_type_key: null,
  source: null,
};

// ============================================================
// issueDocumentNumber (document_number_next RPC 接続 + JST 年解決)
// ============================================================

describe("issueDocumentNumber (document_number_next RPC 接続)", () => {
  it("issue_date 指定時はその文字列の年をそのまま p_year として渡す (DB の now() から導出しない — 実装計画書 §4 規約)", async () => {
    const { client, rpcCalls } = buildClient({ rpc: { data: [{ doc_no: "Q-2026-0001", seq: 1 }], error: null } });
    const result = await issueDocumentNumber(client, "quote", "2026-01-05");
    expect(rpcCalls).toEqual([
      { name: "document_number_next", params: { p_doc_type: "quote", p_year: 2026 } },
    ]);
    expect(result).toEqual({ ok: true, value: { doc_no: "Q-2026-0001", seq: 1 } });
  });

  it("issue_date が null の場合は Asia/Tokyo の現在年を解決して渡す", async () => {
    const expectedYear = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric" }).format(new Date()),
    );
    const { client, rpcCalls } = buildClient({
      rpc: { data: [{ doc_no: `I-${expectedYear}-0007`, seq: 7 }], error: null },
    });
    await issueDocumentNumber(client, "invoice", null);
    expect(rpcCalls[0]?.params).toEqual({ p_doc_type: "invoice", p_year: expectedYear });
  });

  it("RPC が単一オブジェクト (非配列) を返した場合もパースできる", async () => {
    const { client } = buildClient({ rpc: { data: { doc_no: "D-2026-0002", seq: 2 }, error: null } });
    const result = await issueDocumentNumber(client, "delivery", "2026-03-01");
    expect(result).toEqual({ ok: true, value: { doc_no: "D-2026-0002", seq: 2 } });
  });

  it("RPC が結果 0 件 (null) を返した場合は KMB-E622 として明示的に失敗させる (握り潰して ok:true にしない)", async () => {
    const { client } = buildClient({ rpc: { data: null, error: null } });
    const result = await issueDocumentNumber(client, "order", "2026-01-01");
    expect(result).toEqual({ ok: false, code: "KMB-E622", detail: expect.any(String) });
  });

  it("RPC 例外 (KMB-E622 埋め込み) を Result.code へ変換する", async () => {
    const { client } = buildClient({
      rpc: { data: null, error: { message: "KMB-E622: 不正な書類種別です (bogus)" } },
    });
    const result = await issueDocumentNumber(client, "quote", "2026-01-01");
    expect(result).toEqual({ ok: false, code: "KMB-E622", detail: "KMB-E622: 不正な書類種別です (bogus)" });
  });

  it("is_admin_or_service ガードの permission denied を KMB-E202 へ変換する", async () => {
    const { client } = buildClient({
      rpc: {
        data: null,
        error: { message: "permission denied: document_number_next requires admin or service_role" },
      },
    });
    const result = await issueDocumentNumber(client, "quote", "2026-01-01");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E202");
  });
});

// ============================================================
// pgErrorToResult の分岐網羅 (非 export のため getDocumentById 経由で検証。エラー握り潰し厳禁の回帰)
// ============================================================

describe("エラー写像 (getDocumentById 経由 — pgErrorToResult の全分岐)", () => {
  it("一意制約違反 (23505) を KMB-E102 へ変換する", async () => {
    const { client } = buildClient({
      fromQueue: [
        new FakeChain({
          data: null,
          error: { code: "23505", message: 'duplicate key value violates unique constraint "documents_doc_no_key"' },
        }),
      ],
    });
    const result = await getDocumentById(client, DOC_ID);
    expect(result).toEqual({
      ok: false,
      code: "KMB-E102",
      detail: 'duplicate key value violates unique constraint "documents_doc_no_key"',
    });
  });

  it("外部キー違反 (23503) を KMB-E101 へ変換し detail に日本語プレフィクスを付ける", async () => {
    const { client } = buildClient({
      fromQueue: [
        new FakeChain({
          data: null,
          error: { code: "23503", message: 'insert or update on table "documents" violates foreign key constraint' },
        }),
      ],
    });
    const result = await getDocumentById(client, DOC_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toContain("参照先が存在しません");
    }
  });

  it("RLS 拒否 (42501) を KMB-E202 へ変換する", async () => {
    const { client } = buildClient({
      fromQueue: [
        new FakeChain({
          data: null,
          error: { code: "42501", message: 'new row violates row-level security policy for table "documents"' },
        }),
      ],
    });
    const result = await getDocumentById(client, DOC_ID);
    expect(result).toEqual({
      ok: false,
      code: "KMB-E202",
      detail: expect.stringContaining("row-level security"),
    });
  });

  it("未登録の KMB-Exxx コードが埋め込まれていても誤ってそのまま通さず KMB-E901 にフォールバックする (typo 混入防御)", async () => {
    const { client } = buildClient({
      fromQueue: [new FakeChain({ data: null, error: { message: "KMB-E999: 未登録のコード" } })],
    });
    const result = await getDocumentById(client, DOC_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "KMB-E999: 未登録のコード" });
  });

  it("登録済みの KMB-Exxx コード (trigger raise 埋め込み) はそのまま Result.code に変換される", async () => {
    const { client } = buildClient({
      fromQueue: [
        new FakeChain({ data: null, error: { message: "KMB-E624: 発行済み帳票の内容は変更できません" } }),
      ],
    });
    const result = await getDocumentById(client, DOC_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E624", detail: "KMB-E624: 発行済み帳票の内容は変更できません" });
  });

  it("未分類のエラーは detail (元メッセージ) を保持したまま KMB-E901 にフォールバックする (空/null へ握り潰さない)", async () => {
    const { client } = buildClient({
      fromQueue: [new FakeChain({ data: null, error: { message: "connection reset by peer" } })],
    });
    const result = await getDocumentById(client, DOC_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "connection reset by peer" });
  });

  it("該当行が存在しない (data:null, error:null) は ok:true value:null として返す (エラーと不在を混同しない)", async () => {
    const { client } = buildClient({ fromQueue: [new FakeChain({ data: null, error: null })] });
    const result = await getDocumentById(client, DOC_ID);
    expect(result).toEqual({ ok: true, value: null });
  });
});

// ============================================================
// createDraftDocument (documents 1 行 + document_lines N 行、エラー握り潰し厳禁)
// ============================================================

describe("createDraftDocument (draft 新規作成の DB アクセス層)", () => {
  const totals: DocumentTotals = {
    subtotal_jpy: 10_000,
    tax_summary: [{ tax_category: "standard_10", taxable_jpy: 10_000, tax_jpy: 1_000 }],
    total_jpy: 11_000,
  };
  const input: CreateDraftDocumentInput = {
    doc_type: "quote",
    deal_id: DEAL_ID,
    source_document_id: null,
    billing_name: "サンプル建設",
    billing_suffix: "様",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    issue_date: null,
    transaction_date: null,
    valid_until: null,
    tax_rounding: "floor",
    lines: [lineInput],
    totals,
    createdBy: null,
  };

  it("documents 1 行 INSERT → document_lines N 行 INSERT の順で書き込み、position を配列添字で採番する", async () => {
    const docChain = new FakeChain({ data: { id: "doc-1", updated_at: "2026-07-11T00:00:00Z" }, error: null });
    const linesChain = new FakeChain({ data: null, error: null });
    const { client, fromCalls } = buildClient({ fromQueue: [docChain, linesChain] });

    const result = await createDraftDocument(client, input);

    expect(result).toEqual({ ok: true, value: { id: "doc-1", updated_at: "2026-07-11T00:00:00Z" } });
    expect(fromCalls).toEqual(["documents", "document_lines"]);
    const insertCall = linesChain.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual([
      {
        document_id: "doc-1",
        position: 0,
        description: "施工費",
        quantity: 1,
        unit: "式",
        unit_price_jpy: 10_000,
        amount_jpy: 10_000,
        tax_category: "standard_10",
        work_type_key: null,
        source: null,
      },
    ]);
  });

  it("lines が空の場合は document_lines への INSERT を発行しない", async () => {
    const docChain = new FakeChain({ data: { id: "doc-2", updated_at: "t" }, error: null });
    const { client, fromCalls } = buildClient({ fromQueue: [docChain] });
    const result = await createDraftDocument(client, { ...input, lines: [] });
    expect(result.ok).toBe(true);
    expect(fromCalls).toEqual(["documents"]);
  });

  it("documents INSERT 自体が失敗した場合はそのエラーを伝播し、document_lines へは触れない", async () => {
    const docChain = new FakeChain({
      data: null,
      error: { code: "23503", message: "deal_id fk violation" },
    });
    const { client, fromCalls } = buildClient({ fromQueue: [docChain] });
    const result = await createDraftDocument(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(fromCalls).toEqual(["documents"]);
  });

  it("【地雷回帰】document_lines INSERT 失敗時は孤児 draft をベストエフォートで削除しつつ、返す Result は明細挿入の実エラーのまま (cleanup 自体が失敗しても本来のエラーを上書き・握り潰ししない)", async () => {
    const docChain = new FakeChain({ data: { id: "doc-3", updated_at: "t" }, error: null });
    const linesChain = new FakeChain({ data: null, error: { message: "KMB-E101: 明細不正" } });
    const cleanupChain = new FakeChain({
      data: null,
      error: { message: "cleanup がたまたま失敗しても本来のエラーを隠してはいけない" },
    });
    const { client, fromCalls } = buildClient({ fromQueue: [docChain, linesChain, cleanupChain] });

    const result = await createDraftDocument(client, input);

    expect(fromCalls).toEqual(["documents", "document_lines", "documents"]); // cleanup の delete も実行される
    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: "KMB-E101: 明細不正" });
  });
});

// ============================================================
// updateDocumentStatusWithCas (status 系 CAS 更新)
// ============================================================

describe("updateDocumentStatusWithCas (status 系 CAS 更新)", () => {
  const patch = { status: "voided", status_reason: "取消", voided_at: "2026-07-12T00:00:00Z" };

  it("CAS 一致で更新が成功する", async () => {
    const row = { id: "doc-1", status: "voided" };
    const { client, fromCalls } = buildClient({ fromQueue: [new FakeChain({ data: row, error: null })] });
    const result = await updateDocumentStatusWithCas(client, "doc-1", patch, "2026-07-11T00:00:00Z");
    expect(result).toEqual({ ok: true, value: row });
    expect(fromCalls).toEqual(["documents"]);
  });

  it("CAS 不一致で対象行が現存する場合は KMB-E103 (楽観排他の衝突)", async () => {
    const updateChain = new FakeChain({ data: null, error: null });
    const existChain = new FakeChain({ data: { id: "doc-1" }, error: null });
    const { client, fromCalls } = buildClient({ fromQueue: [updateChain, existChain] });
    const result = await updateDocumentStatusWithCas(client, "doc-1", patch, "stale-updated-at");
    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: expect.any(String) });
    expect(fromCalls).toEqual(["documents", "documents"]);
  });

  it("CAS 不一致かつ対象行が存在しない場合は KMB-E621 (不在)", async () => {
    const updateChain = new FakeChain({ data: null, error: null });
    const existChain = new FakeChain({ data: null, error: null });
    const { client } = buildClient({ fromQueue: [updateChain, existChain] });
    const result = await updateDocumentStatusWithCas(client, "doc-404", patch, "whatever");
    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: expect.any(String) });
  });

  it("UPDATE 自体のエラーは resolveCasMiss を経由せずそのまま伝播する", async () => {
    const updateChain = new FakeChain({ data: null, error: { message: "permission denied for column doc_no" } });
    const { client, fromCalls } = buildClient({ fromQueue: [updateChain] });
    const result = await updateDocumentStatusWithCas(client, "doc-1", patch, "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E202");
    expect(fromCalls).toEqual(["documents"]); // 2 回目の from (resolveCasMiss) は呼ばれない
  });
});

// ============================================================
// deleteDraftDocument (draft 限定 DELETE + CAS)
// ============================================================

describe("deleteDraftDocument (draft 限定 DELETE + CAS)", () => {
  it("成功時は削除行を確認して ok:true を返す", async () => {
    const chain = new FakeChain({ data: [{ id: "doc-1" }], error: null });
    const { client, fromCalls } = buildClient({ fromQueue: [chain] });
    const result = await deleteDraftDocument(client, "doc-1", "t");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(fromCalls).toEqual(["documents"]);
  });

  it("0 行 (RLS の draft 限定に阻まれた) + 対象が非 draft の場合は KMB-E621", async () => {
    const deleteChain = new FakeChain({ data: [], error: null });
    const existChain = new FakeChain({ data: { id: "doc-1", status: "issued", updated_at: "t" }, error: null });
    const { client } = buildClient({ fromQueue: [deleteChain, existChain] });
    const result = await deleteDraftDocument(client, "doc-1", "t");
    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: expect.any(String) });
  });

  it("0 行 + 対象は draft のまま存在 (updated_at 相違) の場合は KMB-E103", async () => {
    const deleteChain = new FakeChain({ data: [], error: null });
    const existChain = new FakeChain({ data: { id: "doc-1", status: "draft", updated_at: "new" }, error: null });
    const { client } = buildClient({ fromQueue: [deleteChain, existChain] });
    const result = await deleteDraftDocument(client, "doc-1", "stale");
    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: expect.any(String) });
  });

  it("0 行 + 対象が存在しない場合は KMB-E621 (不在)", async () => {
    const deleteChain = new FakeChain({ data: [], error: null });
    const existChain = new FakeChain({ data: null, error: null });
    const { client } = buildClient({ fromQueue: [deleteChain, existChain] });
    const result = await deleteDraftDocument(client, "doc-404", "t");
    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: expect.any(String) });
  });

  it("DELETE 自体のエラーはそのまま伝播する", async () => {
    const deleteChain = new FakeChain({ data: null, error: { code: "42501", message: "denied" } });
    const { client, fromCalls } = buildClient({ fromQueue: [deleteChain] });
    const result = await deleteDraftDocument(client, "doc-1", "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E202");
    expect(fromCalls).toEqual(["documents"]);
  });
});

// ============================================================
// saveDraftDocument (document_save_draft RPC — CAS + 冪等性)
// ============================================================

describe("saveDraftDocument (document_save_draft RPC — CAS + 冪等性)", () => {
  const header: SaveDraftHeader = {
    issue_date: null,
    transaction_date: null,
    valid_until: null,
    billing_name: "サンプル建設",
    billing_suffix: "様",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    tax_rounding: "floor",
  };
  const lines: DocumentLineInput[] = [lineInput];
  const totals: DocumentTotals = { subtotal_jpy: 10_000, tax_summary: [], total_jpy: 10_000 };

  it("契約形式の引数 (position を含まない p_lines) をそのまま RPC に渡す (position 付与は RPC 側の ordinality 採番の専任)", async () => {
    const { client, rpcCalls } = buildClient({ rpc: { data: [{ new_updated_at: "u2" }], error: null } });
    await saveDraftDocument(client, "doc-1", "u1", header, lines, totals);
    expect(rpcCalls).toEqual([
      {
        name: "document_save_draft",
        params: {
          p_document_id: "doc-1",
          p_expected_updated_at: "u1",
          p_header: header,
          p_lines: lines,
          p_subtotal_jpy: 10_000,
          p_tax_summary: [],
          p_total_jpy: 10_000,
        },
      },
    ]);
    expect((rpcCalls[0]?.params as { p_lines: unknown[] }).p_lines[0]).not.toHaveProperty("position");
  });

  it("成功時は new_updated_at を返す", async () => {
    const { client } = buildClient({ rpc: { data: [{ new_updated_at: "u2" }], error: null } });
    const result = await saveDraftDocument(client, "doc-1", "u1", header, lines, totals);
    expect(result).toEqual({ ok: true, value: { updated_at: "u2" } });
  });

  it("【冪等性】二重送信 (古い expected_updated_at のまま再送) は RPC 側の CAS 埋め込みエラー (KMB-E103) がそのまま伝播し、二重適用されない", async () => {
    const { client } = buildClient({
      rpc: { data: null, error: { message: "KMB-E103: 帳票が他の操作で更新されています" } },
    });
    const result = await saveDraftDocument(client, "doc-1", "u1 (stale)", header, lines, totals);
    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "KMB-E103: 帳票が他の操作で更新されています" });
  });

  it("発行済み (非 draft) への保存は KMB-E624 が伝播する", async () => {
    const { client } = buildClient({
      rpc: {
        data: null,
        error: { message: "KMB-E624: 発行済み帳票の内容は変更できません (訂正は新版発行で行ってください)" },
      },
    });
    const result = await saveDraftDocument(client, "doc-1", "u1", header, lines, totals);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E624");
  });

  it("RPC が結果を返さない場合は KMB-E901 として明示的に失敗させる (握り潰さない)", async () => {
    const { client } = buildClient({ rpc: { data: null, error: null } });
    const result = await saveDraftDocument(client, "doc-1", "u1", header, lines, totals);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: expect.any(String) });
  });
});

// ============================================================
// insertPayment / deletePayment (payments_apply trigger のエラー伝播)
// ============================================================

describe("insertPayment / deletePayment (payments_apply trigger のエラー伝播)", () => {
  const paymentInput: PaymentInput = {
    document_id: "doc-1",
    paid_on: "2026-07-01",
    amount_jpy: 5000,
    method: "bank_transfer",
    memo: null,
  };

  it("成功時は挿入行を返す", async () => {
    const row = { id: "pay-1", ...paymentInput, created_by: null, created_at: "t" };
    const { client } = buildClient({ fromQueue: [new FakeChain({ data: row, error: null })] });
    const result = await insertPayment(client, paymentInput, null);
    expect(result).toEqual({ ok: true, value: row });
  });

  it("残高超過 (trigger 埋め込み KMB-E625) を握り潰さず伝播する", async () => {
    const { client } = buildClient({
      fromQueue: [
        new FakeChain({ data: null, error: { message: "KMB-E625: 入金合計が請求金額を超えます (残高 3000 円)" } }),
      ],
    });
    const result = await insertPayment(client, paymentInput, null);
    expect(result).toEqual({
      ok: false,
      code: "KMB-E625",
      detail: "KMB-E625: 入金合計が請求金額を超えます (残高 3000 円)",
    });
  });

  it("deletePayment: 対象なし (0 行) は KMB-E621", async () => {
    const { client } = buildClient({ fromQueue: [new FakeChain({ data: [], error: null })] });
    const result = await deletePayment(client, "pay-404");
    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: expect.any(String) });
  });

  it("deletePayment: 成功時は ok:true", async () => {
    const { client } = buildClient({ fromQueue: [new FakeChain({ data: [{ id: "pay-1" }], error: null })] });
    const result = await deletePayment(client, "pay-1");
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

// ============================================================
// listDocumentsPage (keyset ページング)
// ============================================================

describe("listDocumentsPage (keyset ページング)", () => {
  it("limit を 1 件超えて返した場合 hasMore とみなし、末尾行から次カーソルを生成する", async () => {
    const rows = [
      { id: "d3", created_at: "2026-07-03T00:00:00Z" },
      { id: "d2", created_at: "2026-07-02T00:00:00Z" },
      { id: "d1", created_at: "2026-07-01T00:00:00Z" }, // limit=2 + 1 件超過
    ];
    const { client } = buildClient({ fromQueue: [new FakeChain({ data: rows, error: null })] });
    const result = await listDocumentsPage(
      client,
      { doc_type: null, status: null, deal_id: null, q: null },
      { cursor: null, limit: 2 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.next_cursor).not.toBeNull();
    const decoded: unknown = JSON.parse(
      Buffer.from(result.value.next_cursor as string, "base64url").toString("utf-8"),
    );
    expect(decoded).toEqual({ createdAt: "2026-07-02T00:00:00Z", id: "d2" });
  });

  it("limit 以下しか返らない場合は next_cursor が null", async () => {
    const rows = [{ id: "d1", created_at: "2026-07-01T00:00:00Z" }];
    const { client } = buildClient({ fromQueue: [new FakeChain({ data: rows, error: null })] });
    const result = await listDocumentsPage(
      client,
      { doc_type: "quote", status: null, deal_id: null, q: null },
      { cursor: null, limit: 50 },
    );
    expect(result).toEqual({ ok: true, value: { items: rows, next_cursor: null } });
  });

  it("q フィルタは doc_no / billing_name への ILIKE OR 条件を発行する", async () => {
    const chain = new FakeChain({ data: [], error: null });
    const { client } = buildClient({ fromQueue: [chain] });
    await listDocumentsPage(
      client,
      { doc_type: null, status: null, deal_id: null, q: "田中建設" },
      { cursor: null, limit: 50 },
    );
    const orCall = chain.calls.find((c) => c.method === "or");
    expect(orCall?.args[0]).toBe("doc_no.ilike.%田中建設%,billing_name.ilike.%田中建設%");
  });

  it("q に % (ILIKE ワイルドカード) を含む場合はエスケープしてから OR 条件に渡す", async () => {
    const chain = new FakeChain({ data: [], error: null });
    const { client } = buildClient({ fromQueue: [chain] });
    await listDocumentsPage(
      client,
      { doc_type: null, status: null, deal_id: null, q: "100%" },
      { cursor: null, limit: 50 },
    );
    const orCall = chain.calls.find((c) => c.method === "or");
    expect(orCall?.args[0]).toBe("doc_no.ilike.%100\\%%,billing_name.ilike.%100\\%%");
  });
});
