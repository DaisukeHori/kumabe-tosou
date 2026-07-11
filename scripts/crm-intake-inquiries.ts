/**
 * 既存 contact_inquiries の CRM 取込 (設計書 01-crm.md §12.1 全文)。
 *
 * 【実装上の重要な注記 — crmFacade を使わない理由 (実測確認済みの致命的な制約)】
 * 当初 crmFacade.intakeFromInquiryMigration 経由での実装を試みたが、crm/facade.ts は
 * crm/repository.ts ("server-only" import) と @/lib/supabase/service.ts ("server-only" import)
 * を経由 import しており、"server-only" パッケージは package.json の "react-server" export 条件
 * (Next.js の RSC バンドラでのみ有効) を持たない実行環境では import した瞬間に例外を投げる
 * (src/lib/supabase/service.ts の確立コメントと同じ制約)。scripts/**\/*.ts は tsx で直接実行する
 * プレーンな Node.js プロセスであり react-server 条件を持たないため、`import { crmFacade } from
 * "@/modules/crm/facade"` を書いた時点で `npx tsx scripts/crm-intake-inquiries.ts` は
 * DB 接続を試みる前に必ずクラッシュする (実測: `Error: This module cannot be imported from a
 * Client Component module` at server-only/index.js)。
 * 加えて ESLint 境界 (eslint.config.mjs の scripts/**\/*.ts セクション) は crm/internal/** および
 * crm/repository の直接 import も禁止しているため、internal/intake.ts の runIntakeSequence を
 * 直接呼ぶ経路も塞がれている。
 * 結論: scripts/** から crm の書込みロジックを再利用する経路が構造上存在しない。
 * seed-from-legacy.ts の確立パターン (createScriptServiceClient の raw client で対象テーブルを
 * 直接操作する) に合わせ、01-crm.md §6.5 の冪等シーケンスを本ファイル内に再実装する
 * (internal/intake.ts とロジックが重複する — 上記の構造的制約によりコード共有不可。
 * 将来 crm 側に "server-only" を持たない薄いエントリポイントを用意できれば解消できる)。
 *
 * - 対象: contact_inquiries 全件 (status='spam' は除外)。
 *   - status IN ('new','in_progress') → 顧客 (lifecycle='lead') + deal (stage='inquiry') + 折り返しタスク
 *   - status='done' → 「deal なし取込」(顧客のみ lifecycle='customer'。deal も折り返しタスクも
 *     作らない — 過去完了案件を捏造しない)
 * - occurred_at = contact_inquiries.created_at (歴史時刻を保持)。
 * - 顧客解決は 01-crm §6.3 の簡略版 (email/tel 一致検索 → マージポインタ終端解決 → 単一終端なら
 *   既存採用・0 件または複数終端なら新規 lead 作成)。複数一致時の 'lead.intake.ambiguous' system
 *   activity 追記まで含む (§6.5 手順4 と同一)。
 * - batch_id (uuid) を発行し、投入した行を entity 順 (customers→deals→activities→
 *   activity_links→tasks) で seed_manifest に記録する (rollback-seed.ts が逆順削除に使う —
 *   §12.1 前提タスク(c): deals.customer_id は on delete 句なし (NO ACTION) のため customers を
 *   最後に削除する必要があり、この記録順がその前提)。
 * - 冪等: form_submission 冪等マーカー (ref_table='contact_inquiries', ref_id=inquiry_id) の
 *   有無で既存行を検出し skip する (再実行は新規行 0 件 — C6)。
 * - 既存 contact_inquiries テーブルへの書込は一切行わない (C4 の検証対象)。
 *
 * 使い方: npx tsx scripts/crm-intake-inquiries.ts
 * 必要 env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (または BOOTSTRAP_ADMIN_EMAIL/PASSWORD)
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeJpPhoneToE164 } from "@/modules/platform/text";

import { createScriptServiceClient } from "./lib/service-client";

type ContactInquiryRow = {
  id: string;
  name: string;
  email: string;
  tel: string | null;
  inquiry_type: "construction" | "estimate" | "material" | "other";
  body: string;
  status: "new" | "in_progress" | "done" | "spam";
  created_at: string;
};

type CustomerRow = {
  id: string;
  lifecycle: "lead" | "customer" | "archived";
  merged_into_customer_id: string | null;
  updated_at: string;
};

const INQUIRY_TYPE_LABEL: Record<ContactInquiryRow["inquiry_type"], string> = {
  construction: "施工依頼",
  estimate: "見積もり相談",
  material: "材料に関する質問",
  other: "その他",
};

const MAX_MERGE_HOPS = 5;

/** ILIKE パターン中のワイルドカード (`%`/`_`/`\`) をエスケープし、
 *  ILIKE を「大文字小文字を無視する完全一致」として使う (crm/repository.ts の escapeLikePattern と同一実装 —
 *  server-only 境界のため import できず複製。09-migration-scripts.md dedup ロジック再実装の一部)。 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

async function recordManifest(client: SupabaseClient, batchId: string, entity: string, refId: string): Promise<void> {
  const { error } = await client.from("seed_manifest").insert({ batch_id: batchId, entity, ref_id: refId });
  if (error) throw new Error(`seed_manifest 記録に失敗しました (${entity}/${refId}): ${error.message}`);
}

function excerpt300(body: string): string {
  return body.length > 300 ? body.slice(0, 300) : body;
}

/** customers.merged_into_customer_id の終端解決 (01-crm §6.3 手順3 と同一ロジック、上限 5 hop)。 */
async function resolveMergedTerminal(client: SupabaseClient, customerId: string): Promise<string> {
  let current = customerId;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const { data, error } = await client
      .from("customers")
      .select("merged_into_customer_id")
      .eq("id", current)
      .maybeSingle();
    if (error) throw new Error(`customers 終端解決に失敗しました (${current}): ${error.message}`);
    const nextId = (data as { merged_into_customer_id: string | null } | null)?.merged_into_customer_id ?? null;
    if (nextId === null) return current;
    current = nextId;
  }
  return current;
}

/**
 * §6.3 dedup の簡略版 (email/tel 一致 → 終端解決 → id で dedupe)。
 * 戻り値: 一意な終端顧客が 1 件のみなら { kind: "single", customer }。
 * 0 件は { kind: "none" }。複数の異なる終端顧客に一致した場合は { kind: "multiple", ids }
 * (§6.5 手順2: 既存に自動で寄せず新規 lead 作成 + ambiguous マーカー)。
 */
async function findDedupOutcome(
  client: SupabaseClient,
  email: string,
  tel: string | null,
): Promise<
  | { kind: "none" }
  | { kind: "single"; customer: CustomerRow }
  | { kind: "multiple"; ids: string[] }
> {
  const matches: { id: string; merged_into_customer_id: string | null }[] = [];

  const { data: emailRows, error: emailErr } = await client
    .from("customers")
    .select("id, merged_into_customer_id")
    .ilike("email", escapeLikePattern(email));
  if (emailErr) throw new Error(`customers email 検索に失敗しました: ${emailErr.message}`);
  matches.push(...((emailRows ?? []) as typeof matches));

  if (tel !== null) {
    const { data: telRows, error: telErr } = await client
      .from("customers")
      .select("id, merged_into_customer_id")
      .eq("tel_e164", tel);
    if (telErr) throw new Error(`customers tel 検索に失敗しました: ${telErr.message}`);
    matches.push(...((telRows ?? []) as typeof matches));
  }

  if (matches.length === 0) return { kind: "none" };

  const resolvedIds = new Set<string>();
  for (const m of matches) {
    const winnerId = m.merged_into_customer_id !== null ? await resolveMergedTerminal(client, m.id) : m.id;
    resolvedIds.add(winnerId);
  }

  if (resolvedIds.size > 1) return { kind: "multiple", ids: [...resolvedIds] };

  const winnerId = [...resolvedIds][0];
  const { data: winnerRow, error: winnerErr } = await client
    .from("customers")
    .select("id, lifecycle, merged_into_customer_id, updated_at")
    .eq("id", winnerId)
    .maybeSingle();
  if (winnerErr) throw new Error(`customers 終端行取得に失敗しました (${winnerId}): ${winnerErr.message}`);
  if (!winnerRow) return { kind: "none" }; // 構造上到達しないが防御的に
  return { kind: "single", customer: winnerRow as CustomerRow };
}

type IntakeOutcome = { customerId: string; dealId: string | null; createdRows: number };

/**
 * 01-crm §6.5 の冪等シーケンス (簡略版) を 1 件の contact_inquiries 行に対して実行する。
 * 既に取込済み (form_submission マーカーあり) の場合は呼び出し元 (main) が事前に skip する
 * ため、本関数は「未取込」の行のみを扱う (§6.5 の「補修モード」は本スクリプトのスコープ外 —
 * 移行データは 1 回の一括実行が前提であり、途中失敗した行は再実行時にマーカー無しのまま
 * 最初から通しで再試行される。途中で作成済みの customer/deal は各ステップの冪等 INSERT
 * (23505 捕捉 → 既存行 SELECT) により二重作成されない)。
 */
async function intakeOneInquiry(
  client: SupabaseClient,
  batchId: string,
  row: ContactInquiryRow,
): Promise<IntakeOutcome> {
  let createdRows = 0;
  const createDeal = row.status === "new" || row.status === "in_progress";
  // contact_inquiries.tel は国内表記 (zInquiryInput 検証済み) だが customers.tel_e164 は E.164 保存
  // (crm/internal/intake.ts と同一の normalizeJpPhoneToE164 を使う — module-contracts.md §4.1)。
  // 正規化に失敗した場合 (旧フォーマット等) は番号非通知扱いと同じく null にフォールバックする。
  const telNormalized = row.tel !== null ? normalizeJpPhoneToE164(row.tel) : null;
  if (row.tel !== null && telNormalized === null) {
    console.warn(`[warn] contact_inquiries/${row.id}: tel "${row.tel}" の E.164 正規化に失敗したため tel_e164 は null で保存します。`);
  }

  let customerId: string;
  let ambiguousIds: string[] | null = null;

  const dedup = await findDedupOutcome(client, row.email, telNormalized);
  if (dedup.kind === "none") {
    const { data, error } = await client
      .from("customers")
      .insert({
        kind: "person",
        name: row.name,
        email: row.email,
        tel_e164: telNormalized,
        lifecycle: createDeal ? "lead" : "customer",
        source: "migration",
      })
      .select("id")
      .single();
    if (error) throw new Error(`customers 作成に失敗しました (inquiry=${row.id}): ${error.message}`);
    customerId = (data as { id: string }).id;
    createdRows++;
    await recordManifest(client, batchId, "customers", customerId);
  } else if (dedup.kind === "single") {
    customerId = dedup.customer.id;
    if (dedup.customer.lifecycle === "archived") {
      const { error } = await client
        .from("customers")
        .update({ lifecycle: "lead" })
        .eq("id", customerId)
        .eq("updated_at", dedup.customer.updated_at);
      if (error) throw new Error(`customers lead 復帰に失敗しました (${customerId}): ${error.message}`);
    }
  } else {
    // 複数の異なる終端顧客に一致 → 既存に寄せず新規 lead 作成 (§6.5 手順2)
    const { data, error } = await client
      .from("customers")
      .insert({
        kind: "person",
        name: row.name,
        email: row.email,
        tel_e164: telNormalized,
        lifecycle: createDeal ? "lead" : "customer",
        source: "migration",
      })
      .select("id")
      .single();
    if (error) throw new Error(`customers 作成に失敗しました (inquiry=${row.id}): ${error.message}`);
    customerId = (data as { id: string }).id;
    createdRows++;
    await recordManifest(client, batchId, "customers", customerId);
    ambiguousIds = dedup.ids;
  }

  const title = `${INQUIRY_TYPE_LABEL[row.inquiry_type]} — ${row.name}`;
  let dealId: string | null = null;

  if (createDeal) {
    const { data, error } = await client
      .from("deals")
      .insert({
        title,
        customer_id: customerId,
        pipeline: "default",
        stage: "inquiry",
        source: "migration",
        source_inquiry_id: row.id,
      })
      .select("id")
      .single();
    if (!error) {
      dealId = (data as { id: string }).id;
      createdRows++;
      await recordManifest(client, batchId, "deals", dealId);
    } else if ((error as { code?: string }).code === "23505") {
      const { data: existingDeal, error: selErr } = await client
        .from("deals")
        .select("id")
        .eq("source_inquiry_id", row.id)
        .maybeSingle();
      if (selErr) throw new Error(`deals 冪等回収に失敗しました (inquiry=${row.id}): ${selErr.message}`);
      dealId = existingDeal ? (existingDeal as { id: string }).id : null;
    } else {
      throw new Error(`deals 作成に失敗しました (inquiry=${row.id}): ${error.message}`);
    }
  }

  // activity: form_submission (冪等キー: activity_type, ref_table, ref_id — 非部分一意 index)
  const { data: formActivity, error: formErr } = await client
    .from("activities")
    .insert({
      activity_type: "form_submission",
      occurred_at: row.created_at,
      title,
      body: null,
      payload: { inquiry_id: row.id, inquiry_type: row.inquiry_type, excerpt: excerpt300(row.body) },
      ref_table: "contact_inquiries",
      ref_id: row.id,
    })
    .select("id")
    .single();
  let formActivityId: string;
  if (!formErr) {
    formActivityId = (formActivity as { id: string }).id;
    createdRows++;
    await recordManifest(client, batchId, "activities", formActivityId);
  } else if ((formErr as { code?: string }).code === "23505") {
    const { data: existing, error: selErr } = await client
      .from("activities")
      .select("id")
      .eq("activity_type", "form_submission")
      .eq("ref_table", "contact_inquiries")
      .eq("ref_id", row.id)
      .maybeSingle();
    if (selErr) throw new Error(`activities 冪等回収に失敗しました (inquiry=${row.id}): ${selErr.message}`);
    if (!existing) throw new Error(`activities 冪等回収で行が見つかりません (inquiry=${row.id})`);
    formActivityId = (existing as { id: string }).id;
  } else {
    throw new Error(`activities (form_submission) 作成に失敗しました (inquiry=${row.id}): ${formErr.message}`);
  }

  const links: Array<{ customer_id: string | null; company_id: null; deal_id: string | null }> = [
    { customer_id: customerId, company_id: null, deal_id: null },
  ];
  if (dealId !== null) links.push({ customer_id: null, company_id: null, deal_id: dealId });

  for (const link of links) {
    const { data: linkRow, error: linkErr } = await client
      .from("activity_links")
      .insert({ activity_id: formActivityId, ...link })
      .select("id")
      .single();
    if (!linkErr) {
      createdRows++;
      await recordManifest(client, batchId, "activity_links", (linkRow as { id: string }).id);
    } else if ((linkErr as { code?: string }).code !== "23505") {
      throw new Error(`activity_links 作成に失敗しました (activity=${formActivityId}): ${linkErr.message}`);
    }
  }

  if (ambiguousIds !== null) {
    const { data: sysActivity, error: sysErr } = await client
      .from("activities")
      .insert({
        activity_type: "system",
        occurred_at: row.created_at,
        title: "重複候補あり (要確認)",
        body: null,
        payload: { code: "lead.intake.ambiguous", detail: `候補: ${ambiguousIds.join(", ")}` },
        ref_table: "contact_inquiries",
        ref_id: row.id,
      })
      .select("id")
      .single();
    if (sysErr && (sysErr as { code?: string }).code !== "23505") {
      throw new Error(`activities (system) 作成に失敗しました (inquiry=${row.id}): ${sysErr.message}`);
    }
    if (!sysErr) {
      const sysId = (sysActivity as { id: string }).id;
      createdRows++;
      await recordManifest(client, batchId, "activities", sysId);
      for (const link of links) {
        const { data: linkRow, error: linkErr } = await client
          .from("activity_links")
          .insert({ activity_id: sysId, ...link })
          .select("id")
          .single();
        if (!linkErr) {
          createdRows++;
          await recordManifest(client, batchId, "activity_links", (linkRow as { id: string }).id);
        } else if ((linkErr as { code?: string }).code !== "23505") {
          throw new Error(`activity_links (system) 作成に失敗しました: ${linkErr.message}`);
        }
      }
    }
  }

  // 折り返しタスク (createDeal のときのみ — §12.1「deal なし取込」は作らない)
  if (createDeal) {
    const dueOn = jstNextDay(row.created_at);
    const { data: taskRow, error: taskErr } = await client
      .from("tasks")
      .insert({
        title: `折り返し連絡: ${row.name} (${INQUIRY_TYPE_LABEL[row.inquiry_type]})`,
        body: null,
        due_on: dueOn,
        deal_id: dealId,
        customer_id: customerId,
        origin: "form",
        source_activity_id: formActivityId,
      })
      .select("id")
      .single();
    let taskId: string;
    if (!taskErr) {
      taskId = (taskRow as { id: string }).id;
      createdRows++;
      await recordManifest(client, batchId, "tasks", taskId);
    } else if ((taskErr as { code?: string }).code === "23505") {
      const { data: existing, error: selErr } = await client
        .from("tasks")
        .select("id")
        .eq("source_activity_id", formActivityId)
        .maybeSingle();
      if (selErr) throw new Error(`tasks 冪等回収に失敗しました (inquiry=${row.id}): ${selErr.message}`);
      taskId = existing ? (existing as { id: string }).id : formActivityId;
    } else {
      throw new Error(`tasks 作成に失敗しました (inquiry=${row.id}): ${taskErr.message}`);
    }

    const { data: taskEventActivity, error: eventErr } = await client
      .from("activities")
      .insert({
        activity_type: "task_event",
        occurred_at: row.created_at,
        title: "やること作成",
        body: null,
        payload: { task_id: taskId, event: "created", origin: "form" },
        ref_table: "tasks",
        ref_id: taskId,
      })
      .select("id")
      .single();
    if (!eventErr) {
      const eventId = (taskEventActivity as { id: string }).id;
      createdRows++;
      await recordManifest(client, batchId, "activities", eventId);
      for (const link of links) {
        const { data: linkRow, error: linkErr } = await client
          .from("activity_links")
          .insert({ activity_id: eventId, ...link })
          .select("id")
          .single();
        if (!linkErr) {
          createdRows++;
          await recordManifest(client, batchId, "activity_links", (linkRow as { id: string }).id);
        } else if ((linkErr as { code?: string }).code !== "23505") {
          throw new Error(`activity_links (task_event) 作成に失敗しました: ${linkErr.message}`);
        }
      }
    } else if ((eventErr as { code?: string }).code !== "23505") {
      throw new Error(`activities (task_event) 作成に失敗しました (inquiry=${row.id}): ${eventErr.message}`);
    }
  }

  return { customerId, dealId, createdRows };
}

/** contact_inquiries.created_at (ISO) の JST 翌日 (date-only)。§6.5 手順5 の折り返しタスク due_on。 */
function jstNextDay(occurredAtIso: string): string {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const shifted = new Date(new Date(occurredAtIso).getTime() + JST_OFFSET_MS);
  const jstDate = shifted.toISOString().slice(0, 10);
  const midnightUtc = new Date(`${jstDate}T00:00:00Z`);
  return new Date(midnightUtc.getTime() + DAY_MS).toISOString().slice(0, 10);
}

async function hasIntakeMarker(client: SupabaseClient, inquiryId: string): Promise<boolean> {
  const { data, error } = await client
    .from("activities")
    .select("id")
    .eq("activity_type", "form_submission")
    .eq("ref_table", "contact_inquiries")
    .eq("ref_id", inquiryId)
    .maybeSingle();
  if (error) throw new Error(`form_submission マーカー確認に失敗しました (inquiry=${inquiryId}): ${error.message}`);
  return data !== null;
}

async function main() {
  const client = await createScriptServiceClient();
  const batchId = randomUUID();

  const { data: rows, error } = await client
    .from("contact_inquiries")
    .select("id, name, email, tel, inquiry_type, body, status, created_at")
    .neq("status", "spam")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("contact_inquiries の取得に失敗しました:", error.message);
    process.exitCode = 1;
    return;
  }
  if (!rows || rows.length === 0) {
    console.log("取込対象の contact_inquiries がありません (status='spam' 除外後 0 件)。");
    return;
  }

  console.log(`batch_id=${batchId}: ${rows.length} 件を取込対象として処理します。`);

  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const row of rows as ContactInquiryRow[]) {
    try {
      const already = await hasIntakeMarker(client, row.id);
      if (already) {
        skippedCount += 1;
        console.log(`[skip] contact_inquiries/${row.id} は既に取込済みです。`);
        continue;
      }

      const outcome = await intakeOneInquiry(client, batchId, row);
      createdCount += 1;
      console.log(
        `[created] contact_inquiries/${row.id} (status=${row.status}) → customer=${outcome.customerId} deal=${outcome.dealId ?? "(none)"} (新規行 ${outcome.createdRows} 件)`,
      );
    } catch (err) {
      failedCount += 1;
      console.error(`[failed] contact_inquiries/${row.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `完了: 新規取込 ${createdCount} 件 / skip ${skippedCount} 件 / 失敗 ${failedCount} 件 (batch_id=${batchId})。`,
  );
  if (failedCount > 0) {
    console.log(`失敗分は npx tsx scripts/crm-intake-inquiries.ts を再実行すると再試行されます (冪等)。`);
    process.exitCode = 1;
  }
  console.log(`ロールバックする場合: npx tsx scripts/rollback-seed.ts ${batchId}`);
}

main().catch((err) => {
  console.error("crm-intake-inquiries に失敗しました:", err);
  process.exitCode = 1;
});
