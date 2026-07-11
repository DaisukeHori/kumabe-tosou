import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runIntakeSequence, type IntakeParams } from "@/modules/crm/internal/intake";

/**
 * canonical: docs/design/crm-suite/01-crm.md §6.5 (リード取込の冪等シーケンス)。
 * DB 接続不要 — インメモリの簡易 Supabase 互換フェイク (crm-dedup.test.ts の
 * buildFakeClient 様式を拡張し、customers/deals/activities/activity_links/tasks の
 * 5 テーブルを模擬する) で runIntakeSequence の分岐を検証する。
 *
 * 「連絡先両NULL→E607」「tel 正規化失敗→null化」は facade.ts (intakeFromInquiry/
 * intakeFromSimulator の入口) の責務であり runIntakeSequence 自体には含まれない
 * (facade.ts の実測: normalizeJpPhoneToE164 呼び出し + E607 判定は runIntakeSequence 呼び出し前に
 * 完了している) ため、本ファイルでは対象としない。
 */

// ---------------------------------------------------------------------------
// インメモリ フェイク Supabase クライアント
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Table = "customers" | "deals" | "activities" | "activity_links" | "tasks";

type PgLikeError = { code?: string; message: string };

function uniqueViolation(message: string): PgLikeError {
  return { code: "23505", message };
}

class FakeDb {
  tables: Record<Table, Row[]> = {
    customers: [],
    deals: [],
    activities: [],
    activity_links: [],
    tasks: [],
  };

  reset() {
    for (const key of Object.keys(this.tables) as Table[]) this.tables[key] = [];
  }
}

/** unique index の衝突判定 (NULLS DISTINCT — NULL キーは互いに衝突しない、migration 0023 §2.2 の設計) */
function conflicts(existing: Row, candidate: Row, keys: string[]): boolean {
  return keys.every((k) => {
    const a = existing[k];
    const b = candidate[k];
    if (a === null || a === undefined || b === null || b === undefined) return false; // NULL は衝突しない
    return a === b;
  });
}

const UNIQUE_CONSTRAINTS: Record<Table, string[][]> = {
  customers: [],
  deals: [["source_inquiry_id"]],
  activities: [["activity_type", "ref_table", "ref_id"]],
  activity_links: [["customer_id", "activity_id"], ["company_id", "activity_id"], ["deal_id", "activity_id"]],
  tasks: [["source_activity_id", "title"]],
};

/**
 * 実 Postgres は INSERT で省略した nullable 列を明示的な SQL NULL として返す。本フェイクは
 * insert() に渡されたオブジェクトのみを行にマージするため、省略列は「キー自体が無い」状態になり
 * `row.merged_into_customer_id === null` のような比較が `undefined === null` (false) を返して
 * 誤動作する (実際に resolveMergedCustomerIdSafe の終端判定でこれを踏んだ — hop ループが
 * customerId=undefined のまま次の getCustomerById へ渡り KMB-E603 になる)。migration 0023 の
 * nullable 列を明示的に null 初期化して実 DB の挙動に合わせる。
 */
const NULLABLE_DEFAULTS: Record<Table, Row> = {
  customers: {
    name_kana: null,
    email: null,
    tel_e164: null,
    company_id: null,
    address: null,
    notes: null,
    merged_into_customer_id: null,
    created_by: null,
  },
  deals: {
    company_id: null,
    amount_jpy: null,
    expected_close_on: null,
    won_at: null,
    lost_reason: null,
    source_inquiry_id: null,
    notes: null,
    created_by: null,
  },
  activities: { body: null, ref_table: null, ref_id: null, created_by: null },
  activity_links: { customer_id: null, company_id: null, deal_id: null },
  tasks: {
    body: null,
    due_on: null,
    deal_id: null,
    customer_id: null,
    source_activity_id: null,
    completed_at: null,
    created_by: null,
  },
};

class FakeQuery {
  private filters: Array<{ kind: "eq" | "ilike" | "in"; col: string; val: unknown }> = [];
  private selectCols: string | null = null;
  private pendingInsert: Row | null = null;
  private pendingUpdate: Row | null = null;
  private isDelete = false;

  constructor(
    private db: FakeDb,
    private table: Table,
  ) {}

  select(cols: string) {
    this.selectCols = cols;
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }

  ilike(col: string, val: unknown) {
    this.filters.push({ kind: "ilike", col, val });
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.filters.push({ kind: "in", col, val: vals });
    return this;
  }

  insert(row: Row) {
    this.pendingInsert = row;
    return this;
  }

  update(row: Row) {
    this.pendingUpdate = row;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const value = row[f.col];
      if (f.kind === "eq") return value === f.val;
      if (f.kind === "in") return (f.val as unknown[]).includes(value);
      if (f.kind === "ilike") return typeof value === "string" && value.toLowerCase() === String(f.val).toLowerCase();
      return true;
    });
  }

  private runRead(): { data: Row[]; error: PgLikeError | null } {
    const rows = this.db.tables[this.table].filter((r) => this.matches(r));
    return { data: rows, error: null };
  }

  private runInsert(): { data: Row | null; error: PgLikeError | null } {
    const row: Row = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...NULLABLE_DEFAULTS[this.table],
      ...this.pendingInsert,
    };
    const constraints = UNIQUE_CONSTRAINTS[this.table];
    for (const keys of constraints) {
      const clash = this.db.tables[this.table].find((existing) => conflicts(existing, row, keys));
      if (clash) return { data: null, error: uniqueViolation(`duplicate key value violates unique constraint on (${keys.join(",")})`) };
    }
    this.db.tables[this.table].push(row);
    return { data: row, error: null };
  }

  private runUpdate(): { data: Row | null; error: PgLikeError | null } {
    const idx = this.db.tables[this.table].findIndex((r) => this.matches(r));
    if (idx === -1) return { data: null, error: null }; // CAS 不一致/不在 (maybeSingle が null を返す)
    const updated = { ...this.db.tables[this.table][idx], ...this.pendingUpdate, updated_at: new Date().toISOString() };
    this.db.tables[this.table][idx] = updated;
    return { data: updated, error: null };
  }

  private runDelete(): { data: null; error: PgLikeError | null } {
    this.db.tables[this.table] = this.db.tables[this.table].filter((r) => !this.matches(r));
    return { data: null, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: PgLikeError | null }> {
    if (this.pendingInsert) return this.runInsert();
    if (this.pendingUpdate) return this.runUpdate();
    if (this.isDelete) return this.runDelete();
    const { data, error } = this.runRead();
    return { data: data[0] ?? null, error };
  }

  async single(): Promise<{ data: Row | null; error: PgLikeError | null }> {
    if (this.pendingInsert) return this.runInsert();
    if (this.pendingUpdate) return this.runUpdate();
    const { data, error } = this.runRead();
    return { data: data[0] ?? null, error };
  }

  // await query (select のまま .single()/.maybeSingle() を呼ばない使い方 — 配列取得系)
  then<T1, T2>(
    onFulfilled?: ((value: { data: Row[]; error: PgLikeError | null }) => T1) | null,
    onRejected?: ((reason: unknown) => T2) | null,
  ) {
    if (this.isDelete) return Promise.resolve(this.runDelete()).then(onFulfilled as never, onRejected);
    return Promise.resolve(this.runRead()).then(onFulfilled as never, onRejected);
  }
}

function buildFakeClient(db: FakeDb): SupabaseClient {
  const client = {
    from(table: string) {
      return new FakeQuery(db, table as Table);
    },
  };
  return client as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// テストデータヘルパ
// ---------------------------------------------------------------------------

function formInput(overrides: Partial<Extract<IntakeParams, { kind: "inquiry" }>> = {}): Extract<IntakeParams, { kind: "inquiry" }> {
  return {
    kind: "inquiry",
    inquiryId: randomUUID(),
    contact: { name: "田中太郎", email: "taro@example.com", telE164: null },
    occurredAt: "2026-07-10T02:00:00.000Z",
    inquiryType: "estimate",
    bodyExcerpt: "外壁塗装の見積もりをお願いします",
    ...overrides,
  };
}

function simulatorInput(overrides: Partial<Extract<IntakeParams, { kind: "simulator" }>> = {}): Extract<IntakeParams, { kind: "simulator" }> {
  return {
    kind: "simulator",
    inquiryId: randomUUID(),
    contact: { name: "鈴木花子", email: "hanako@example.com", telE164: null },
    occurredAt: "2026-07-10T02:00:00.000Z",
    estimate: {
      grade_key: "standard",
      grade_label: "標準グレード",
      size_key: "m",
      size_label: "中型車",
      quantity: 1,
      option_keys: [],
      quote_only: false,
      total_min: 100_000,
      total_max: 150_000,
      applied_tier: null,
      breakdown: [],
    },
    ...overrides,
  };
}

let db: FakeDb;
let client: SupabaseClient;

beforeEach(() => {
  db = new FakeDb();
  client = buildFakeClient(db);
});

describe("runIntakeSequence — 新規取込 (マーカーなし)", () => {
  it("顧客(lead)・deal(inquiry)・form_submission・折り返しタスクを作成する", async () => {
    const input = formInput();
    const result = await runIntakeSequence(client, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.deal_id).not.toBeNull();
    expect(db.tables.customers).toHaveLength(1);
    expect(db.tables.customers[0]).toMatchObject({ lifecycle: "lead", source: "form", name: "田中太郎" });
    expect(db.tables.deals).toHaveLength(1);
    expect(db.tables.deals[0]).toMatchObject({ stage: "inquiry", source_inquiry_id: input.inquiryId });
    expect(db.tables.activities.filter((a) => a.activity_type === "form_submission")).toHaveLength(1);
    expect(db.tables.tasks).toHaveLength(1);
    expect(db.tables.activities.filter((a) => a.activity_type === "task_event")).toHaveLength(1);
  });

  it("タイトル生成: INQUIRY_TYPE_LABEL に応じて4種のラベルが使われる", async () => {
    const cases: Array<[Extract<IntakeParams, { kind: "inquiry" }>["inquiryType"], string]> = [
      ["construction", "施工依頼"],
      ["estimate", "見積もり相談"],
      ["material", "材料に関する質問"],
      ["other", "その他"],
    ];
    for (const [inquiryType, label] of cases) {
      db.reset();
      const input = formInput({ inquiryType });
      const result = await runIntakeSequence(client, input);
      expect(result.ok).toBe(true);
      const deal = db.tables.deals[0];
      expect(deal.title).toBe(`${label} — 田中太郎`);
    }
  });

  it("simulator kind のタイトルは「シミュレーター見積 — 氏名」固定", async () => {
    const input = simulatorInput();
    const result = await runIntakeSequence(client, input);
    expect(result.ok).toBe(true);
    expect(db.tables.deals[0].title).toBe("シミュレーター見積 — 鈴木花子");
  });

  it("simulator: quote_only=false は deal.amount_jpy = total_max", async () => {
    const input = simulatorInput({
      estimate: { ...simulatorInput().estimate, quote_only: false, total_max: 200_000 },
    });
    await runIntakeSequence(client, input);
    expect(db.tables.deals[0].amount_jpy).toBe(200_000);
  });

  it("simulator: quote_only=true は deal.amount_jpy = null (個別見積り)", async () => {
    const input = simulatorInput({
      estimate: { ...simulatorInput().estimate, quote_only: true, total_max: 500_000 },
    });
    await runIntakeSequence(client, input);
    expect(db.tables.deals[0].amount_jpy).toBeNull();
  });

  it("simulator: simulator_estimate activity の price_note は常に null (v1 固定)", async () => {
    const input = simulatorInput();
    await runIntakeSequence(client, input);
    const simActivity = db.tables.activities.find((a) => a.activity_type === "simulator_estimate");
    expect(simActivity).toBeDefined();
    expect((simActivity!.payload as { price_note: unknown }).price_note).toBeNull();
  });

  it("simulator: form_submission の excerpt は 300 字以内に切り詰められる", async () => {
    const input = simulatorInput({
      estimate: {
        ...simulatorInput().estimate,
        grade_label: "あ".repeat(200),
        size_label: "い".repeat(200),
      },
    });
    await runIntakeSequence(client, input);
    const formActivity = db.tables.activities.find((a) => a.activity_type === "form_submission");
    const excerpt = (formActivity!.payload as { excerpt: string }).excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(300);
  });

  it("複数の重複候補がある場合は既存に寄せず新規 lead を作成し、system(lead.intake.ambiguous) を積む", async () => {
    // 事前に異なる 2 顧客が同一 email に一致するデータを用意 (email 完全一致で 2 件ヒットさせる)
    db.tables.customers.push(
      { id: randomUUID(), name: "既存A", email: "shared@example.com", lifecycle: "lead", merged_into_customer_id: null, source: "form", kind: "person", updated_at: new Date().toISOString() },
      { id: randomUUID(), name: "既存B", email: "shared@example.com", lifecycle: "customer", merged_into_customer_id: null, source: "form", kind: "person", updated_at: new Date().toISOString() },
    );
    const input = formInput({ contact: { name: "新規太郎", email: "shared@example.com", telE164: null } });
    const result = await runIntakeSequence(client, input);
    expect(result.ok).toBe(true);

    // 新規 lead が作成される (既存の 2 件とは別の 3 件目)
    expect(db.tables.customers).toHaveLength(3);
    const newCustomer = db.tables.customers.find((c) => c.name === "新規太郎");
    expect(newCustomer).toBeDefined();
    expect(newCustomer!.lifecycle).toBe("lead");

    const ambiguous = db.tables.activities.find(
      (a) => a.activity_type === "system" && (a.payload as { code: string }).code === "lead.intake.ambiguous",
    );
    expect(ambiguous).toBeDefined();
  });

  it("単一一致が手動 archived なら lifecycle を lead に戻して既存顧客を採用する", async () => {
    const archivedId = randomUUID();
    db.tables.customers.push({
      id: archivedId,
      name: "田中太郎",
      email: "taro@example.com",
      lifecycle: "archived",
      merged_into_customer_id: null,
      source: "form",
      kind: "person",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const result = await runIntakeSequence(client, formInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer_id).toBe(archivedId);
    expect(db.tables.customers).toHaveLength(1);
    expect(db.tables.customers[0].lifecycle).toBe("lead");
  });
});

describe("runIntakeSequence — dealless (§12.1「deal なし取込」, opts.createDeal=false)", () => {
  it("customer のみ作成 (lifecycle=customer)。deal も折り返しタスクも作らない", async () => {
    const input = formInput();
    const result = await runIntakeSequence(client, input, { createDeal: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.deal_id).toBeNull();
    expect(db.tables.customers).toHaveLength(1);
    expect(db.tables.customers[0].lifecycle).toBe("customer");
    expect(db.tables.deals).toHaveLength(0);
    expect(db.tables.tasks).toHaveLength(0);
    expect(db.tables.activities.filter((a) => a.activity_type === "form_submission")).toHaveLength(1);
  });
});

describe("runIntakeSequence — マーカー既存 (補修モード)", () => {
  it("links から customer/deal を逆引きできれば重複作成しない (再実行の冪等性)", async () => {
    const input = formInput();
    const first = await runIntakeSequence(client, input);
    expect(first.ok).toBe(true);
    const customersAfterFirst = db.tables.customers.length;
    const dealsAfterFirst = db.tables.deals.length;
    const tasksAfterFirst = db.tables.tasks.length;

    const second = await runIntakeSequence(client, input);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.customer_id).toBe(first.value.customer_id);
    expect(second.value.deal_id).toBe(first.value.deal_id);
    // 2 回目は新規行を作らない (id 数が変化しない)
    expect(db.tables.customers).toHaveLength(customersAfterFirst);
    expect(db.tables.deals).toHaveLength(dealsAfterFirst);
    expect(db.tables.tasks).toHaveLength(tasksAfterFirst);
  });

  it("links 欠損時は deals.source_inquiry_id 逆引きで customer/deal を回収できる (activity_links 消失からの再送耐性)", async () => {
    const input = formInput();
    const first = await runIntakeSequence(client, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // links 欠損を人為的に再現 (INSERT 直後クラッシュ相当)
    db.tables.activity_links = [];

    const second = await runIntakeSequence(client, input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.customer_id).toBe(first.value.customer_id);
    expect(second.value.deal_id).toBe(first.value.deal_id);
    // links が再送で補完される
    expect(db.tables.activity_links.length).toBeGreaterThan(0);
  });

  it("マーカー既存 + deal がどこにも無い場合は解決済み customer で deal を再作成する (§6.5-1b)", async () => {
    // dealless (§12.1 done 相当) で一度取込 → 後から「リード化」相当の再要求 (createDeal:true) を模す
    const input = formInput();
    const firstDealless = await runIntakeSequence(client, input, { createDeal: false });
    expect(firstDealless.ok).toBe(true);
    if (!firstDealless.ok) return;
    expect(firstDealless.value.deal_id).toBeNull();
    expect(db.tables.deals).toHaveLength(0);

    const second = await runIntakeSequence(client, input, { createDeal: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.customer_id).toBe(firstDealless.value.customer_id);
    expect(second.value.deal_id).not.toBeNull();
    expect(db.tables.deals).toHaveLength(1);
    expect(db.tables.deals[0].customer_id).toBe(firstDealless.value.customer_id);
  });
});

describe("runIntakeSequence — 戻り値の manifest (scripts/crm-intake-inquiries.ts の seed_manifest 記録用)", () => {
  it("新規作成された行のみが customers→deals→activities→activity_links→tasks の順で積まれる", async () => {
    const result = await runIntakeSequence(client, formInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entities = result.value.manifest.map((m) => m.entity);
    expect(entities[0]).toBe("customers");
    // customers は先頭固定 (rollback-seed.ts の FK 整合前提)
    expect(entities.filter((e) => e === "customers")).toHaveLength(1);
    expect(entities).toContain("deals");
    expect(entities).toContain("activities");
    expect(entities).toContain("tasks");
  });

  it("冪等ヒット (2 回目呼び出し) は manifest が空になる (新規行 0 件)", async () => {
    const input = formInput();
    await runIntakeSequence(client, input);
    const second = await runIntakeSequence(client, input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.manifest).toEqual([]);
  });
});
