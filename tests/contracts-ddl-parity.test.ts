import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { zChannel, zTaxCategory, zTaxRounding } from "@/modules/platform/contracts";
import { zContentStatus, zPostKind } from "@/modules/content/contracts";
import { zPriceOptionKind } from "@/modules/pricing/contracts";
import { zSourceInputType, zRunStatus } from "@/modules/ai-studio/contracts";
import {
  zAccountChannel,
  zChannelAuthStatus,
  zChannelPostStatus,
  zNoteDraftStatus,
} from "@/modules/distribution/contracts";
import { zAiKeyStatus, zProvider, zUsageKind, zUsageStatus } from "@/modules/ai-providers/contracts";
import { SETTINGS_SCHEMAS } from "@/modules/settings/contracts";
import {
  ACTIVITY_PAYLOAD_SCHEMAS,
  zCustomerInput,
  zCustomerLifecycle,
  zDealInput,
  zDealStage,
  zLeadSource,
  zTaskOrigin,
  zTaskStatus,
} from "@/modules/crm/contracts";
import { DOC_NO_PREFIX, zDocType, zDocumentStatus, zPaymentInput } from "@/modules/sales/contracts";
import {
  zCalendarConnectionStatus,
  zCalendarProvider,
  zEventLinkSyncStatus,
  zWorkBlockStatus,
} from "@/modules/scheduling/contracts";
import {
  zCallDirection,
  zCallHandling,
  zCallJobStatus,
  zCallMatchStatus,
  zCallRecordingChannels,
  zCallRecordingSource,
} from "@/modules/telephony/contracts";

/**
 * DB 接続不要の静的検証 (設計書 §11.1 1a: contracts-ddl-parity.test.ts)。
 * supabase/migrations/*.sql の check 制約 (enum/status) と contracts.ts の z.enum が
 * 一致することを比較する。文字数上限・regex 等の値制約は Zod のみが正のためここでは扱わない
 * (module-contracts.md §3 / cms-ai-pipeline.md §2.2 共通規約 2)。
 *
 * #61 (issue-61.md): 本 Issue は既存 facade の app 層合成のみで新規テーブル/enum/DDL を
 * 一切追加しないため、本ファイルへの新規 parity テスト追加は対象外 (受入基準「contracts-ddl-parity
 * テスト PASS (新規 DDL なしのため対象外である旨をテストコメントに明記)」を満たすための記録)。
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
function parseCheckClausesInto(checks: EnumCheck[], table: string, body: string): void {
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

function extractEnumChecks(sql: string): EnumCheck[] {
  const checks: EnumCheck[] = [];

  const tableRegex = /create table (\w+) \(([\s\S]*?)\n\);/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(sql))) {
    parseCheckClausesInto(checks, tableMatch[1], tableMatch[2]);
  }

  // `alter table <table>\n  add column ... check (col in (...))` パターン (既存テーブルへの
  // 列追加。migration 20260710000016 の note_draft_status で新規に必要になった記法)。
  // create table 本体と区別するため「テーブル名の直後に改行 + add column」という本リポジトリの
  // 記法に限定してマッチさせる (単純な `alter table x enable row level security;` 等の
  // 1 行ステートメントを誤って巻き込まないため)。
  const alterTableRegex = /alter table (\w+)\s*\n\s*add column ([\s\S]*?);/g;
  let alterMatch: RegExpExecArray | null;
  while ((alterMatch = alterTableRegex.exec(sql))) {
    parseCheckClausesInto(checks, alterMatch[1], alterMatch[2]);
  }

  // `alter table <table>\n  add constraint <name>\n  check (col in (...));` パターン
  // (既存の CHECK 制約を drop+add で再定義するケース。P4: migration 20260710000019 が
  // ai_runs.status の check 制約に 'image_generation' を追加する際に新規に必要になった記法。
  // create table 本体からの区別は「テーブル名の直後に改行 + add constraint」で行う
  // (posts_source_run_fk のような 1 行の FK 制約追加を誤って巻き込まないため)。
  // グループはネストした括弧 (check(col in (...))) を丸ごと含める必要があるため、
  // 閉じ括弧 2 個を明示的にリテラルとして group 内に含める。
  const addConstraintRegex = /alter table (\w+)\s*\n\s*add constraint \w+\s*\n\s*(check \([\s\S]*?\)\));/g;
  let addConstraintMatch: RegExpExecArray | null;
  while ((addConstraintMatch = addConstraintRegex.exec(sql))) {
    parseCheckClausesInto(checks, addConstraintMatch[1], addConstraintMatch[2]);
  }

  return checks;
}

/**
 * 同一 (table, column) の check が複数見つかった場合は「最後 (=最新) の定義」を有効とする。
 * P4 で `alter table X add constraint Y check(...)` による既存制約の再定義パターンが
 * 初めて登場したため対応 (extractEnumChecks は create table → add column → add constraint の
 * 順に走査するため、drop+add で再定義された制約は配列の後方に来る)。
 */
function findCheck(checks: EnumCheck[], table: string, column: string): string[] {
  const found = [...checks].reverse().find((c) => c.table === table && c.column === column);
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

  it("channel_posts.status ↔ distribution の zChannelPostStatus (Wave2-F で追加)", () => {
    const expected = [...zChannelPostStatus.options].sort();
    const actual = findCheck(checks, "channel_posts", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("channel_accounts.channel ↔ distribution の zAccountChannel (Wave2-F で追加)", () => {
    const expected = [...zAccountChannel.options].sort();
    const actual = findCheck(checks, "channel_accounts", "channel").sort();
    expect(actual).toEqual(expected);
  });

  it("channel_accounts.auth_status ↔ distribution の zChannelAuthStatus (Wave2-F で追加)", () => {
    const expected = [...zChannelAuthStatus.options].sort();
    const actual = findCheck(checks, "channel_accounts", "auth_status").sort();
    expect(actual).toEqual(expected);
  });

  it("channel_posts.note_draft_status ↔ distribution の zNoteDraftStatus (P6: migration 20260710000016)", () => {
    const expected = [...zNoteDraftStatus.options].sort();
    const actual = findCheck(checks, "channel_posts", "note_draft_status").sort();
    expect(actual).toEqual(expected);
  });

  // ---- ai-providers (P1: migration 20260710000015) ----
  it("ai_provider_keys.provider ↔ ai-providers の zProvider", () => {
    const expected = [...zProvider.options].sort();
    const actual = findCheck(checks, "ai_provider_keys", "provider").sort();
    expect(actual).toEqual(expected);
  });

  it("ai_provider_keys.status ↔ ai-providers の zAiKeyStatus (MAJOR-1: 'limited' 追加込み)", () => {
    const expected = [...zAiKeyStatus.options].sort();
    const actual = findCheck(checks, "ai_provider_keys", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("ai_usage_log.kind ↔ ai-providers の zUsageKind", () => {
    const expected = [...zUsageKind.options].sort();
    const actual = findCheck(checks, "ai_usage_log", "kind").sort();
    expect(actual).toEqual(expected);
  });

  it("ai_usage_log.status ↔ ai-providers の zUsageStatus", () => {
    const expected = [...zUsageStatus.options].sort();
    const actual = findCheck(checks, "ai_usage_log", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("ai_image_generations.status ↔ 固定 3 値 ('pending','succeeded','failed')", () => {
    const actual = findCheck(checks, "ai_image_generations", "status").sort();
    expect(actual).toEqual(["failed", "pending", "succeeded"]);
  });

  // ---- crm (#2-1: migration 20260711000023_crm_core.sql) ----
  it("customers.kind ↔ crm の zCustomerInput.shape.kind (インライン enum。named export なし — 07-contracts-delta 原文どおり)", () => {
    const expected = [...zCustomerInput.shape.kind.options].sort();
    const actual = findCheck(checks, "customers", "kind").sort();
    expect(actual).toEqual(expected);
  });

  it("customers.lifecycle ↔ crm の zCustomerLifecycle", () => {
    const expected = [...zCustomerLifecycle.options].sort();
    const actual = findCheck(checks, "customers", "lifecycle").sort();
    expect(actual).toEqual(expected);
  });

  it("customers.source / deals.source ↔ crm の zLeadSource (customers と deals で共用)", () => {
    const expected = [...zLeadSource.options].sort();
    for (const table of ["customers", "deals"]) {
      const actual = findCheck(checks, table, "source").sort();
      expect(actual).toEqual(expected);
    }
  });

  it("deals.pipeline ↔ crm の zDealInput.shape.pipeline (z.literal('default') — 1 値のみのため .options は使えず直接比較)", () => {
    const actual = findCheck(checks, "deals", "pipeline").sort();
    expect(actual).toEqual([zDealInput.shape.pipeline.value]);
  });

  it("deals.stage ↔ crm の zDealStage (9 値。zDealInput.shape.stage は作成時 3 値限定の部分集合であり比較対象外 — 01-crm §5.1 の裁定どおり zDealStage が DDL parity 対象)", () => {
    const expected = [...zDealStage.options].sort();
    const actual = findCheck(checks, "deals", "stage").sort();
    expect(actual).toEqual(expected);
  });

  it("activities.activity_type ↔ crm の ACTIVITY_PAYLOAD_SCHEMAS のキー (9 種。文字列 enum の二重列挙をしない設計)", () => {
    const expected = Object.keys(ACTIVITY_PAYLOAD_SCHEMAS).sort();
    const actual = findCheck(checks, "activities", "activity_type").sort();
    expect(actual).toEqual(expected);
  });

  it("tasks.status ↔ crm の zTaskStatus", () => {
    const expected = [...zTaskStatus.options].sort();
    const actual = findCheck(checks, "tasks", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("tasks.origin ↔ crm の zTaskOrigin", () => {
    const expected = [...zTaskOrigin.options].sort();
    const actual = findCheck(checks, "tasks", "origin").sort();
    expect(actual).toEqual(expected);
  });

  // ---- sales (#48: migration 20260711000026_sales_core.sql) ----
  it("documents.doc_type ↔ sales の zDocType", () => {
    const expected = [...zDocType.options].sort();
    const actual = findCheck(checks, "documents", "doc_type").sort();
    expect(actual).toEqual(expected);
  });

  it("documents.status ↔ sales の zDocumentStatus", () => {
    const expected = [...zDocumentStatus.options].sort();
    const actual = findCheck(checks, "documents", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("documents.tax_rounding ↔ platform の zTaxRounding", () => {
    const expected = [...zTaxRounding.options].sort();
    const actual = findCheck(checks, "documents", "tax_rounding").sort();
    expect(actual).toEqual(expected);
  });

  it("documents.billing_suffix ↔ 固定 2 値 ('様','御中') (§5.2 zUpdateDraftDocumentInput/zReviseDocumentInput の billing_suffix と同一集合。専用 named export が無いため固定値比較)", () => {
    const actual = findCheck(checks, "documents", "billing_suffix").sort();
    expect(actual).toEqual(["御中", "様"].sort());
  });

  it("document_lines.tax_category ↔ platform の zTaxCategory", () => {
    const expected = [...zTaxCategory.options].sort();
    const actual = findCheck(checks, "document_lines", "tax_category").sort();
    expect(actual).toEqual(expected);
  });

  it("payments.method ↔ sales の zPaymentInput.shape.method", () => {
    const expected = [...zPaymentInput.shape.method.options].sort();
    const actual = findCheck(checks, "payments", "method").sort();
    expect(actual).toEqual(expected);
  });

  it("DOC_NO_PREFIX ↔ migration 20260711000022 の document_number_next RPC の case 式 (quote→Q / order→J / delivery→D / invoice→I。二重定義の乖離検知 — 00-overview §3.4)", () => {
    const caseBody = /v_prefix\s*:=\s*case p_doc_type([\s\S]*?)end;/.exec(sql)?.[1];
    expect(caseBody, "document_number_next の v_prefix case 式が見つかりません").toBeDefined();
    const extracted: Record<string, string> = {};
    const whenRegex = /when '(\w+)' then '([A-Z])'/g;
    let whenMatch: RegExpExecArray | null;
    while ((whenMatch = whenRegex.exec(caseBody as string))) {
      extracted[whenMatch[1]] = whenMatch[2];
    }
    expect(extracted).toEqual(DOC_NO_PREFIX);
  });

  it("document_lines に税額カラムが存在しない (裁定 J5: 明細行に税額を持たせない構造的強制。tax_category 以外に 'tax' を含む識別子があれば税額カラム混入の回帰)", () => {
    const body = /create table document_lines \(([\s\S]*?)\n\);/.exec(sql)?.[1];
    expect(body, "document_lines の create table ブロックが見つかりません").toBeDefined();
    const taxIdentifiers = new Set(
      ((body as string).match(/\btax\w*/gi) ?? []).map((s) => s.toLowerCase()),
    );
    expect([...taxIdentifiers]).toEqual(["tax_category"]);
  });

  // ---- sales (#50: migration 20260711000027_sales_issuance.sql) ----
  it("issued_documents.doc_type ↔ sales の zDocType (電帳法台帳。documents.doc_type と同一集合)", () => {
    const expected = [...zDocType.options].sort();
    const actual = findCheck(checks, "issued_documents", "doc_type").sort();
    expect(actual).toEqual(expected);
  });

  it("print_tokens.purpose ↔ 固定 2 値 ('pdf','preview') (02-sales §7.3。専用 named export が無いため固定値比較 — documents.billing_suffix と同型)", () => {
    const actual = findCheck(checks, "print_tokens", "purpose").sort();
    expect(actual).toEqual(["pdf", "preview"].sort());
  });

  it("issued_documents.sha256 の check が hex 64 桁の正規表現であること (§13.2 — findCheck の in 句パーサでは正規表現 check を抽出できないため、リテラル文字列の存在確認に留める。実装計画書「未解決点3」の簡易案どおり)", () => {
    expect(sql).toContain("check (sha256 ~ '^[0-9a-f]{64}$')");
  });

  // ---- scheduling (#52: migration 20260711000029_scheduling_core.sql) ----
  it("work_blocks.status ↔ scheduling の zWorkBlockStatus", () => {
    const expected = [...zWorkBlockStatus.options].sort();
    const actual = findCheck(checks, "work_blocks", "status").sort();
    expect(actual).toEqual(expected);
  });

  // ---- scheduling (#54: migration 20260711000030_calendar_sync.sql) ----
  it("calendar_connections.provider / calendar_event_links.provider ↔ scheduling の zCalendarProvider", () => {
    const expected = [...zCalendarProvider.options].sort();
    for (const table of ["calendar_connections", "calendar_event_links"]) {
      const actual = findCheck(checks, table, "provider").sort();
      expect(actual).toEqual(expected);
    }
  });

  it("calendar_connections.status ↔ scheduling の zCalendarConnectionStatus", () => {
    const expected = [...zCalendarConnectionStatus.options].sort();
    const actual = findCheck(checks, "calendar_connections", "status").sort();
    expect(actual).toEqual(expected);
  });

  it("calendar_event_links.sync_status ↔ scheduling の zEventLinkSyncStatus", () => {
    const expected = [...zEventLinkSyncStatus.options].sort();
    const actual = findCheck(checks, "calendar_event_links", "sync_status").sort();
    expect(actual).toEqual(expected);
  });

  /**
   * 以下は DB 上は enum/status だが、契約書 §4 に対応する Zod スキーマが定義されていない列。
   * (profiles.role, ai_sources.transcript_status, channel_drafts.status, draft_revisions.edited_by,
   *  contact_inquiries.status)
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
      ["contact_inquiries", "status"],
    ] as const;
    for (const [table, column] of uncoveredButPresent) {
      // 存在確認のみ (値集合の変更検知)。Zod 契約が増えたらここから正式な比較に格上げする。
      expect(findCheck(checks, table, column).length).toBeGreaterThan(0);
    }
  });
});

/**
 * settings-media-refs parity (#45: 05-site-settings.md §12.1 808行目)。
 * 上記の enum-check パーサ (extractEnumChecks/findCheck) とは別ロジック — jsonb キー literal は
 * `check (col in (...))` パターンではないため既存パーサでは検出できない。ここでは
 * (1) SETTINGS_SCHEMAS のキー集合が 07-contracts-delta §D5 の 11 キー最終形と一致すること、
 * (2) migration 0035 の SQL 本文中に jsonb キー literal 'favicon_media_id' が
 *     media_admin_delete / media_reference_summary / ai_draft_cleanup_run の 3 箇所とも
 *     存在すること (media 参照 3 点セット漏れ検知)、を単純な文字列マッチで検証する。
 * DB 接続不要の静的検証。
 */
describe("settings-media-refs parity (DB 接続不要の静的検証)", () => {
  const sql = loadAllMigrationSql();

  it("SETTINGS_SCHEMAS のキー集合が 07-contracts-delta §D5 の 11 キー最終形と一致する", () => {
    const expected = [
      "analytics",
      "branding",
      "business_hours",
      "company",
      "hero",
      "invoice_issuer",
      "notifications",
      "ops_limits",
      "seo_defaults",
      "telephony",
      "work_capacity",
    ].sort();
    const actual = Object.keys(SETTINGS_SCHEMAS).sort();
    expect(actual).toEqual(expected);
  });

  it("migration 0035 の favicon_media_id jsonb キー literal が媒体参照3点セット (media_admin_delete / media_reference_summary / ai_draft_cleanup_run) の3箇所とも存在する", () => {
    const occurrences = (
      sql.match(/jsonb_build_object\('favicon_media_id',/g) ?? []
    ).length;
    expect(occurrences).toBe(3);
  });

  it("migration に seal_media_id という jsonb キー literal が存在しない (v1.2 で撤回済み — 最大の地雷)", () => {
    expect(sql.includes("jsonb_build_object('seal_media_id'")).toBe(false);
  });
});

/**
 * telephony ddl parity (#56: migration 20260711000032_telephony_core.sql)。
 * canonical: docs/design/crm-suite/04-telephony.md §2.2 (DDL 全文) / §2.6 (自モジュール所有の
 * enum は DB check ↔ Zod enum 1:1 で parity テストに追加する)。上記の enum-check パーサ
 * (extractEnumChecks/findCheck) をそのまま再利用する (独立した describe として再計算する —
 * 上の describe 内の記述には一切手を加えない)。
 */
describe("telephony ddl parity (#56: migration 20260711000032_telephony_core.sql)", () => {
  const sql = loadAllMigrationSql();
  const checks = extractEnumChecks(sql);

  it("calls.direction ↔ telephony の zCallDirection", () => {
    const expected = [...zCallDirection.options].sort();
    const actual = findCheck(checks, "calls", "direction").sort();
    expect(actual).toEqual(expected);
  });

  it("calls.handling ↔ telephony の zCallHandling (nullable 列。check 制約自体は非 null 値のみ列挙するため findCheck の対象と単純比較できる — 既存の ai_runs.status 等と同じ扱い)", () => {
    const expected = [...zCallHandling.options].sort();
    const actual = findCheck(checks, "calls", "handling").sort();
    expect(actual).toEqual(expected);
  });

  it("calls.match_status ↔ telephony の zCallMatchStatus (07-contracts-delta/04-telephony のコードブロックに export 記載が無かったため telephony/contracts.ts に追加 export したもの — issue-56 計画書「未解決点」#1 参照。DDL の check 制約が正)", () => {
    const expected = [...zCallMatchStatus.options].sort();
    const actual = findCheck(checks, "calls", "match_status").sort();
    expect(actual).toEqual(expected);
  });

  it("call_recordings.source ↔ telephony の zCallRecordingSource", () => {
    const expected = [...zCallRecordingSource.options].sort();
    const actual = findCheck(checks, "call_recordings", "source").sort();
    expect(actual).toEqual(expected);
  });

  it("call_recordings.channels ↔ telephony の zCallRecordingChannels (数値 literal union — z.enum ではないため .options は各メンバー ZodLiteral スキーマの配列を返す。各要素の .value で実値 [1,2] を取り出し、文字列化してから比較する)", () => {
    const expected = zCallRecordingChannels.options.map((option) => String(option.value)).sort();
    const actual = findCheck(checks, "call_recordings", "channels").sort();
    expect(actual).toEqual(expected);
  });

  /**
   * call_jobs.status ↔ telephony の zCallJobStatus (#57/#58: migration 20260711000033 の
   * lease/commit/retry RPC が操作する状態機械。check 制約自体は DDL 本体 (migration 0032) に
   * 定義済みで #58 では変更していないが、parity テストが未追加だったため issue-58 計画書
   * 「テスト戦略」節の指示どおり追加する。既存の enum-check パーサ (findCheck) をそのまま使う)。
   */
  it("call_jobs.status ↔ telephony の zCallJobStatus", () => {
    const expected = [...zCallJobStatus.options].sort();
    const actual = findCheck(checks, "call_jobs", "status").sort();
    expect(actual).toEqual(expected);
  });

  /**
   * calls.twilio_status は意図的に check 制約を持たない (04-telephony.md §2.6: 外部所有の
   * Twilio CallStatus 語彙は将来値が追加されても DDL 変更不要にするため check を張らない設計判断。
   * 「自モジュール所有の enum のみ check+Zod parity」の対象外 — 受入基準に明記の注記コメント)。
   * findCheck は見つからない場合に例外を投げる実装のため、その例外が起きることをもって
   * 「check 制約が存在しない」ことの検証とする。
   */
  it("(注記) calls.twilio_status は意図的に check 制約を持たない (外部所有語彙 — Zod parity 対象外)", () => {
    expect(() => findCheck(checks, "calls", "twilio_status")).toThrow();
  });
});
