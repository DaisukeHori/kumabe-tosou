import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listCompaniesPage, listCustomersPage } from "@/modules/crm/repository";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 (zCustomerListFilter.q — 名前/かな/email/電話の部分一致、
 * 電話は E.164 正規化後に前方一致) / src/lib/postgrest-filter.ts。
 *
 * listCompaniesPage / listCustomersPage が組み立てる `.or()` フィルタ文字列を、supabase-js 互換の
 * チェーン記録フェイクで捕捉して検証する (DB 接続なし)。
 *   - 検索語にカンマ・括弧・引用符が含まれても PostgREST 構文が壊れない (値が引用符で囲まれる)
 *   - LIKE ワイルドカード (% _) がエスケープされる
 *   - telE164Prefix 指定時は tel_e164 の前方一致 (like '+81...%') になり、q の tel_e164 部分一致は出ない
 */

type Captured = { or: string[]; eq: Array<[string, unknown]>; in: Array<[string, unknown]>; is: Array<[string, unknown]> };

function buildCapturingClient(rows: unknown[] = []): { client: SupabaseClient; captured: Captured } {
  const captured: Captured = { or: [], eq: [], in: [], is: [] };
  const builder: Record<string, unknown> = {};
  const chain = (fn?: (...a: unknown[]) => void) => (...args: unknown[]) => {
    fn?.(...args);
    return builder;
  };
  Object.assign(builder, {
    select: chain(),
    order: chain(),
    limit: chain(),
    or: chain((f) => captured.or.push(f as string)),
    eq: chain((c, v) => captured.eq.push([c as string, v])),
    in: chain((c, v) => captured.in.push([c as string, v])),
    is: chain((c, v) => captured.is.push([c as string, v])),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  });
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, captured };
}

const PAGINATION = { limit: 20, cursor: null };

describe("listCompaniesPage の q フィルタ", () => {
  it("name/name_kana の ilike を引用符付きで OR 結合する", async () => {
    const { client, captured } = buildCapturingClient();
    const result = await listCompaniesPage(client, { q: "山岸" }, PAGINATION);
    expect(result.ok).toBe(true);
    expect(captured.or).toEqual(['name.ilike."%山岸%",name_kana.ilike."%山岸%"']);
  });

  it("カンマ・括弧を含む検索語でも値が引用符で囲まれ、フィルタ区切りとして解釈されない", async () => {
    const { client, captured } = buildCapturingClient();
    await listCompaniesPage(client, { q: "山岸塗装(株), 本社" }, PAGINATION);
    expect(captured.or).toHaveLength(1);
    const filter = captured.or[0];
    expect(filter).toBe('name.ilike."%山岸塗装(株), 本社%",name_kana.ilike."%山岸塗装(株), 本社%"');
    // 引用符の外側にカンマは 1 つ (2 項の区切り) だけ
    expect(filter.replace(/"[^"]*"/g, "").split(",")).toHaveLength(2);
  });

  it("% と _ は LIKE ワイルドカードとしてエスケープされ、そのバックスラッシュは引用符内でさらに \\ に二重化される", async () => {
    const { client, captured } = buildCapturingClient();
    await listCompaniesPage(client, { q: "100%_a" }, PAGINATION);
    // LIKE 層: 100\%\_a → PostgREST 引用符層: "%100\\%\\_a%" (PostgREST が unquote すると \% \_ に戻る)
    expect(captured.or[0]).toBe('name.ilike."%100\\\\%\\\\_a%",name_kana.ilike."%100\\\\%\\\\_a%"');
  });

  it("q が null なら or フィルタを付けない", async () => {
    const { client, captured } = buildCapturingClient();
    await listCompaniesPage(client, { q: null }, PAGINATION);
    expect(captured.or).toEqual([]);
  });
});

describe("listCustomersPage の q / telE164Prefix フィルタ", () => {
  const base = { lifecycle: "active" as const, includeMerged: false };

  it("q のみ: name/name_kana/email/tel_e164 の 4 列 ilike を引用符付きで OR 結合する", async () => {
    const { client, captured } = buildCapturingClient();
    await listCustomersPage(client, { ...base, q: "山田" }, PAGINATION);
    expect(captured.or).toEqual([
      'name.ilike."%山田%",name_kana.ilike."%山田%",email.ilike."%山田%",tel_e164.ilike."%山田%"',
    ]);
  });

  it("カンマ・括弧・引用符を含む検索語でも構文が壊れない (引用符はエスケープ)", async () => {
    const { client, captured } = buildCapturingClient();
    await listCustomersPage(client, { ...base, q: '山田, 太郎 ("株")' }, PAGINATION);
    expect(captured.or).toHaveLength(1);
    const filter = captured.or[0];
    expect(filter.startsWith('name.ilike."%山田, 太郎 (\\"株\\")%",')).toBe(true);
    // エスケープ済み引用符を除いた「引用符の外側」にはカンマが 3 つ (4 項の区切り) だけ
    expect(filter.replace(/\\"/g, "").replace(/"[^"]*"/g, "").split(",")).toHaveLength(4);
  });

  it("telE164Prefix 指定時: tel_e164 は like '<E.164>%' の前方一致になり、q の tel_e164 部分一致は出ない", async () => {
    const { client, captured } = buildCapturingClient();
    await listCustomersPage(client, { ...base, q: "090-1234-5678", telE164Prefix: "+819012345678" }, PAGINATION);
    expect(captured.or).toEqual([
      'name.ilike."%090-1234-5678%",name_kana.ilike."%090-1234-5678%",email.ilike."%090-1234-5678%",tel_e164.like."+819012345678%"',
    ]);
    expect(captured.or[0]).not.toContain("tel_e164.ilike");
  });

  it("telE164Prefix のみ (q=null) でも tel_e164 前方一致フィルタを付ける", async () => {
    const { client, captured } = buildCapturingClient();
    await listCustomersPage(client, { ...base, q: null, telE164Prefix: "+8196" }, PAGINATION);
    expect(captured.or).toEqual(['tel_e164.like."+8196%"']);
  });

  it("q も telE164Prefix も無ければ or フィルタを付けない (lifecycle/merged の既定フィルタのみ)", async () => {
    const { client, captured } = buildCapturingClient();
    await listCustomersPage(client, { ...base, q: null }, PAGINATION);
    expect(captured.or).toEqual([]);
    expect(captured.in).toEqual([["lifecycle", ["lead", "customer"]]]);
    expect(captured.is).toEqual([["merged_into_customer_id", null]]);
  });
});
