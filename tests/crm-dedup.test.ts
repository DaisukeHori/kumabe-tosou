import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dedupeCandidates,
  findDuplicateCandidates,
  MAX_MERGE_HOPS,
  resolveMergedCustomerId,
  type MergePointerLookup,
} from "@/modules/crm/repository";

/**
 * canonical: docs/design/crm-suite/01-crm.md §6.3 (dedup アルゴリズム)。
 * DB 接続不要の単体テスト。純関数部 (dedupeCandidates / resolveMergedCustomerId) は
 * プレーンなデータ/関数を直接渡して検証し、DB を叩く findDuplicateCandidates はチェーン可能な
 * 軽量モック SupabaseClient (ai-providers-repository.test.ts の確立パターン踏襲) で代替する。
 */

// ---------------------------------------------------------------------------
// resolveMergedCustomerId (マージポインタの終端解決。§6.3 手順 3)
// ---------------------------------------------------------------------------

describe("resolveMergedCustomerId (マージポインタ終端解決)", () => {
  it("1 hop で終端に到達する", async () => {
    const chain: Record<string, string | null> = { loser: "winner", winner: null };
    const lookup: MergePointerLookup = async (id) => chain[id] ?? null;
    const resolved = await resolveMergedCustomerId(lookup, "loser");
    expect(resolved).toBe("winner");
  });

  it("複数 hop (敗者の敗者) を辿って終端まで到達する", async () => {
    const chain: Record<string, string | null> = {
      "loser-a": "loser-b",
      "loser-b": "winner",
      winner: null,
    };
    const lookup: MergePointerLookup = async (id) => chain[id] ?? null;
    const resolved = await resolveMergedCustomerId(lookup, "loser-a");
    expect(resolved).toBe("winner");
  });

  it("終端ポインタが無い (merged_into_customer_id が最初から null) 顧客はそのまま返す", async () => {
    const lookup: MergePointerLookup = async () => null;
    const resolved = await resolveMergedCustomerId(lookup, "plain-customer");
    expect(resolved).toBe("plain-customer");
  });

  it(`上限 ${MAX_MERGE_HOPS} hop を超える鎖は打ち切り、最後に解決できた id を返す (循環は DB 制約で構造上発生しないが防御)`, async () => {
    // 無限に次を返す鎖 (現実には発生しないが上限打ち切りの安全性を確認)
    let calls = 0;
    const lookup: MergePointerLookup = async (id) => {
      calls += 1;
      return `${id}->next`;
    };
    const resolved = await resolveMergedCustomerId(lookup, "start");
    expect(calls).toBe(MAX_MERGE_HOPS);
    // 5 hop 分 "->next" が連結された文字列で打ち切られる
    expect(resolved).toBe("start" + "->next".repeat(MAX_MERGE_HOPS));
  });
});

// ---------------------------------------------------------------------------
// dedupeCandidates (§6.3 手順 4 — id で dedupe)
// ---------------------------------------------------------------------------

describe("dedupeCandidates (候補の id 集約)", () => {
  it("email のみ一致の 1 件をそのまま返す", () => {
    const result = dedupeCandidates([
      { resolvedId: "c1", name: "田中", lifecycle: "lead", matchedBy: "email" },
    ]);
    expect(result).toEqual([{ customer_id: "c1", name: "田中", lifecycle: "lead", matched_by: "email" }]);
  });

  it("tel のみ一致の 1 件をそのまま返す", () => {
    const result = dedupeCandidates([
      { resolvedId: "c1", name: "田中", lifecycle: "customer", matchedBy: "tel" },
    ]);
    expect(result).toEqual([
      { customer_id: "c1", name: "田中", lifecycle: "customer", matched_by: "tel" },
    ]);
  });

  it("同一顧客が email/tel 両方で一致した場合は 1 件に集約し matched_by:'both' になる", () => {
    const result = dedupeCandidates([
      { resolvedId: "c1", name: "田中", lifecycle: "lead", matchedBy: "email" },
      { resolvedId: "c1", name: "田中", lifecycle: "lead", matchedBy: "tel" },
    ]);
    expect(result).toEqual([{ customer_id: "c1", name: "田中", lifecycle: "lead", matched_by: "both" }]);
  });

  it("異なる顧客の一致は別々の候補として残る", () => {
    const result = dedupeCandidates([
      { resolvedId: "c1", name: "田中", lifecycle: "lead", matchedBy: "email" },
      { resolvedId: "c2", name: "鈴木", lifecycle: "customer", matchedBy: "tel" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.customer_id).sort()).toEqual(["c1", "c2"]);
  });

  it("空配列は空配列を返す", () => {
    expect(dedupeCandidates([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findDuplicateCandidates (DB 呼び出し込みの結線。軽量モック SupabaseClient)
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  name: string;
  lifecycle: string;
  merged_into_customer_id: string | null;
};

function buildFakeClient(config: {
  emailRows?: Row[];
  telRows?: Row[];
  customersById?: Record<string, Row>;
  onIlike?: (col: string, pattern: string) => void;
}) {
  const customersById = config.customersById ?? {};
  const client = {
    from(table: string) {
      if (table !== "customers") throw new Error(`unexpected table: ${table}`);
      return {
        select(columns: string) {
          // findDuplicateCandidates が投げる 3 種の select を列名で判別する
          if (columns.includes("merged_into_customer_id") && !columns.includes("email")) {
            // email/tel 検索 or ポインタ解決の select。呼び出しの種類はチェーンされる filter で分岐
            return {
              ilike: (col: string, pattern: string) => {
                config.onIlike?.(col, pattern);
                return Promise.resolve({ data: config.emailRows ?? [], error: null });
              },
              eq: (col: string, value: string) => {
                if (col === "tel_e164") {
                  return Promise.resolve({ data: config.telRows ?? [], error: null });
                }
                if (col === "id") {
                  return {
                    maybeSingle: async () => ({
                      data: customersById[value]
                        ? { merged_into_customer_id: customersById[value].merged_into_customer_id }
                        : null,
                      error: null,
                    }),
                  };
                }
                throw new Error(`unexpected eq column: ${col}`);
              },
            };
          }
          // getCustomerById 用 select("*")
          return {
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => ({ data: customersById[value] ?? null, error: null }),
            }),
          };
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

describe("findDuplicateCandidates (結線: 検索 → 終端解決 → dedupe)", () => {
  it("email のみ一致で 1 件返す", async () => {
    const client = buildFakeClient({
      emailRows: [{ id: "c1", name: "田中太郎", lifecycle: "lead", merged_into_customer_id: null }],
    });
    const result = await findDuplicateCandidates(client, "taro@example.com", null);
    expect(result).toEqual({
      ok: true,
      value: [{ customer_id: "c1", name: "田中太郎", lifecycle: "lead", matched_by: "email" }],
    });
  });

  it("tel のみ一致で 1 件返す", async () => {
    const client = buildFakeClient({
      telRows: [{ id: "c1", name: "田中太郎", lifecycle: "lead", merged_into_customer_id: null }],
    });
    const result = await findDuplicateCandidates(client, null, "+819012345678");
    expect(result).toEqual({
      ok: true,
      value: [{ customer_id: "c1", name: "田中太郎", lifecycle: "lead", matched_by: "tel" }],
    });
  });

  it("email/tel 両方で同一顧客に一致 → 1 件に dedupe される (matched_by:'both')", async () => {
    const client = buildFakeClient({
      emailRows: [{ id: "c1", name: "田中太郎", lifecycle: "lead", merged_into_customer_id: null }],
      telRows: [{ id: "c1", name: "田中太郎", lifecycle: "lead", merged_into_customer_id: null }],
    });
    const result = await findDuplicateCandidates(client, "taro@example.com", "+819012345678");
    expect(result).toEqual({
      ok: true,
      value: [{ customer_id: "c1", name: "田中太郎", lifecycle: "lead", matched_by: "both" }],
    });
  });

  it("大文字混じり email はそのまま ILIKE へ渡し、大文字小文字の畳み込みは DB (ILIKE) 側に委ねる", async () => {
    let capturedPattern = "";
    const client = buildFakeClient({
      emailRows: [{ id: "c1", name: "田中太郎", lifecycle: "lead", merged_into_customer_id: null }],
      onIlike: (_col, pattern) => {
        capturedPattern = pattern;
      },
    });
    const result = await findDuplicateCandidates(client, "Taro@Example.com", null);
    // ILIKE は大文字小文字を無視して一致するため、クライアント側で lower() する必要はない
    // (エスケープ (%_\\) のみ適用。ワイルドカードを含まない email なら元の大文字小文字のまま渡ってよい)
    expect(capturedPattern).toBe("Taro@Example.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("マージ敗者行がヒット → 終端解決して勝者 id・勝者の現行 name/lifecycle に置換される (敗者行自身は候補に出ない)", async () => {
    const client = buildFakeClient({
      emailRows: [{ id: "loser", name: "旧表記の名前", lifecycle: "archived", merged_into_customer_id: "winner" }],
      customersById: {
        loser: { id: "loser", name: "旧表記の名前", lifecycle: "archived", merged_into_customer_id: "winner" },
        winner: { id: "winner", name: "田中太郎 (現行)", lifecycle: "customer", merged_into_customer_id: null },
      },
    });
    const result = await findDuplicateCandidates(client, "taro@example.com", null);
    expect(result).toEqual({
      ok: true,
      value: [
        { customer_id: "winner", name: "田中太郎 (現行)", lifecycle: "customer", matched_by: "email" },
      ],
    });
  });

  it("email も tel も null なら DB を叩かず空配列を返す (force バイパス相当の 0 件経路)", async () => {
    const client = buildFakeClient({});
    const result = await findDuplicateCandidates(client, null, null);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("一致なし (0 件) は空配列を返す", async () => {
    const client = buildFakeClient({ emailRows: [], telRows: [] });
    const result = await findDuplicateCandidates(client, "nobody@example.com", "+810000000000");
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("複数の別顧客に一致 → 候補 2 件以上を返す", async () => {
    const client = buildFakeClient({
      emailRows: [
        { id: "c1", name: "田中太郎", lifecycle: "lead", merged_into_customer_id: null },
        { id: "c2", name: "田中花子", lifecycle: "lead", merged_into_customer_id: null },
      ],
    });
    const result = await findDuplicateCandidates(client, "shared-family@example.com", null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value.map((v) => v.customer_id).sort()).toEqual(["c1", "c2"]);
    }
  });
});
