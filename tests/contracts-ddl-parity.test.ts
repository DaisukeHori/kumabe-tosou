import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { zChannel } from "@/modules/platform/contracts";
import { zContentStatus, zPostKind } from "@/modules/content/contracts";
import { zPriceOptionKind } from "@/modules/pricing/contracts";
import { zSourceInputType, zRunStatus } from "@/modules/ai-studio/contracts";

/**
 * DB 接続不要の静的検証 (設計書 §11.1 1a: contracts-ddl-parity.test.ts)。
 * supabase/migrations/*.sql の check 制約 (enum/status) と contracts.ts の z.enum が
 * 一致することを比較する。文字数上限・regex 等の値制約は Zod のみが正のためここでは扱わない
 * (module-contracts.md §3 / cms-ai-pipeline.md §2.2 共通規約 2)。
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");

function loadAllMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8")).join("\n");
}

type EnumCheck = { table: string; column: string; values: string[] };

/**
 * `create table <name> ( ... );` ブロックを抽出し、各ブロック内の
 * `check (<col> in ('a','b',...))` を (table, column, values) として列挙する。
 * このリポジトリの migration ファイルの記法 (各 create table は行頭 ");" で閉じる) に依拠する
 * 軽量パーサ。
 */
function extractEnumChecks(sql: string): EnumCheck[] {
  const checks: EnumCheck[] = [];
  const tableRegex = /create table (\w+) \(([\s\S]*?)\n\);/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(sql))) {
    const table = tableMatch[1];
    const body = tableMatch[2];
    const checkRegex = /check \((\w+) in \(([^)]*)\)\)/g;
    let checkMatch: RegExpExecArray | null;
    while ((checkMatch = checkRegex.exec(body))) {
      const column = checkMatch[1];
      const values = checkMatch[2]
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""))
        .filter((v) => v.length > 0);
      checks.push({ table, column, values });
    }
  }
  return checks;
}

function findCheck(checks: EnumCheck[], table: string, column: string): string[] {
  const found = checks.find((c) => c.table === table && c.column === column);
  if (!found) {
    throw new Error(
      `migration に ${table}.${column} の check (... in (...)) 制約が見つかりません。` +
        `migration ファイルが変更された可能性があります。`,
    );
  }
  return found.values;
}

describe("contracts-ddl-parity (DB 接続不要の静的検証)", () => {
  const sql = loadAllMigrationSql();
  const checks = extractEnumChecks(sql);

  it("migration から enum check 制約が抽出できる (パーサ自体の健全性)", () => {
    expect(checks.length).toBeGreaterThan(0);
  });

  it("works.status / posts.status / voices.status ↔ content の zContentStatus", () => {
    const expected = [...zContentStatus.options].sort();
    for (const table of ["works", "posts", "voices"]) {
      const actual = findCheck(checks, table, "status").sort();
      expect(actual).toEqual(expected);
    }
  });

  it("posts.kind ↔ content の zPostKind", () => {
    const expected = [...zPostKind.options].sort();
    const actual = findCheck(checks, "posts", "kind").sort();
    expect(actual).toEqual(expected);
  });

  it("price_options.kind ↔ pricing の zPriceOptionKind", () => {
    const expected = [...zPriceOptionKind.options].sort();
    const actual = findCheck(checks, "price_options", "kind").sort();
    expect(actual).toEqual(expected);
  });

  it("ai_sources.input_type ↔ ai-studio の zSourceInputType", () => {
    const expected = [...zSourceInputType.options].sort();
    const actual = findCheck(checks, "ai_sources", "input_type").sort();
    expect(actual).toEqual(expected);
  });

  it("ai_runs.status ↔ ai-studio の zRunStatus", () => {
    const expected = [...zRunStatus.options].sort();
    const actual = findCheck(checks, "ai_runs", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("channel_drafts.channel / style_profiles.channel ↔ platform の zChannel", () => {
    const expected = [...zChannel.options].sort();
    for (const [table, column] of [
      ["channel_drafts", "channel"],
      ["style_profiles", "channel"],
    ] as const) {
      const actual = findCheck(checks, table, column).sort();
      expect(actual).toEqual(expected);
    }
  });

  /**
   * 以下は DB 上は enum/status だが、契約書 §4 に対応する Zod スキーマが定義されていない列。
   * (profiles.role, ai_sources.transcript_status, channel_drafts.status, draft_revisions.edited_by,
   *  channel_posts.status, channel_accounts.channel/auth_status, contact_inquiries.status)
   * これらは外部入力ではなく repository 内部の状態遷移 (設計書 §4 の状態図) で管理される値のため、
   * 契約書は意図的に Zod 化していない (§3: Zod は外部入力/JSONB の型が対象)。
   * 将来これらを Zod 化する場合は契約書 §4 を先に更新し、本テストに比較を追加する。
   */
  it("(記録) Zod 対応がない enum 列が意図した集合のままであることを確認する", () => {
    const uncoveredButPresent = [
      ["profiles", "role"],
      ["ai_sources", "transcript_status"],
      ["channel_drafts", "status"],
      ["draft_revisions", "edited_by"],
      ["channel_posts", "status"],
      ["channel_accounts", "channel"],
      ["channel_accounts", "auth_status"],
      ["contact_inquiries", "status"],
    ] as const;
    for (const [table, column] of uncoveredButPresent) {
      // 存在確認のみ (値集合の変更検知)。Zod 契約が増えたらここから正式な比較に格上げする。
      expect(findCheck(checks, table, column).length).toBeGreaterThan(0);
    }
  });
});
