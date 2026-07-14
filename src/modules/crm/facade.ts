import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSessionAndClient } from "@/lib/supabase/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ExecutionContext, Paged, Pagination, Result } from "@/modules/platform/contracts";
import { zPagination, zTelE164 } from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164 } from "@/modules/platform/text";

import {
  DEAL_STAGE_REGISTRY,
  zAppendActivityInput,
  zCompanyInput,
  zCompanyUpdateInput,
  zCustomerInput,
  zCustomerListFilter,
  zCustomerUpdateInput,
  zDealInput,
  zDealListFilter,
  zDealStage,
  zDealUpdateInput,
  zIntakeFromInquiryInput,
  zIntakeFromSimulatorInput,
  zMarkDealLostInput,
  zMergeCustomersInput,
  zNoteUpdateInput,
  zReopenDealInput,
  zTaskInput,
  zTaskListFilter,
  zTaskUpdateInput,
  zTimelinePagination,
  zTimelineTarget,
  type ActivityPayload,
  type AppendActivityInput,
  type CompanyInput,
  type CompanyListItem,
  type CompanyUpdateInput,
  type CrmDashboardKpi,
  type CrmDigest,
  type CustomerDetail,
  type CustomerInput,
  type CustomerListFilter,
  type CustomerListItem,
  type CustomerRef,
  type CustomerUpdateInput,
  type DealDetail,
  type DealInput,
  type DealKanbanColumn,
  type DealListFilter,
  type DealListItem,
  type DealRef,
  type DealStage,
  type DealUpdateInput,
  type IntakeFromInquiryInput,
  type IntakeFromSimulatorInput,
  type MarkDealLostInput,
  type MergeCustomersInput,
  type NoteUpdateInput,
  type ReopenDealInput,
  type TaskInput,
  type TaskListFilter,
  type TaskListItem,
  type TaskStatus,
  type TaskUpdateInput,
  type TimelineItem,
  type TimelinePagination,
  type TimelineTarget,
} from "./contracts";
import {
  appendActivityRow,
  countCustomersByCompanyIds,
  countDealsByStage,
  countOpenDealsByCustomerIds,
  countTasksInRange,
  createCompany as createCompanyRow,
  createCustomer as createCustomerRow,
  createDeal as createDealRow,
  createTaskRow,
  deleteActivityLinksByActivity,
  deleteNoteActivity as deleteNoteActivityRow,
  findActivityByTypeRef,
  findDealBySourceInquiry,
  getActivityById,
  getCompaniesByIds,
  getCompanyById,
  getCustomerById,
  getCustomersByIds,
  getDealById,
  getDealsByIds,
  getTaskById,
  linkActivityRow,
  listActivityLinksByActivity,
  listAwaitingLeadDeals,
  listCompaniesPage,
  listCustomersPage,
  listDealsByStage,
  listDealsPage,
  listOpenDealAmounts,
  listOpenTasksForDigest,
  listTasksPage,
  listTimelinePage,
  mergeCustomers as mergeCustomersRepo,
  reopenDeal as reopenDealRpc,
  resolveMergedCustomerIdSafe,
  updateCompanyWithCas,
  updateCustomerWithCas,
  updateDealWithCas,
  updateNoteActivity as updateNoteActivityRow,
  updateTaskWithCas,
  type ActivityLinkTarget,
  type CompanyRow,
  type CustomerRow,
  type DealRow,
  type DealUpdatePatch,
  type TaskRow,
} from "./repository";
import { resolveDuplicates } from "./internal/dedup";
import { runIntakeSequence, type IntakeResult } from "./internal/intake";
import {
  canReopenDeal, canTransitionDealStage, shouldPromoteLifecycleOnWin, shouldRecordWonAt,
} from "./internal/stage-machine";
import { canTransitionTaskStatus } from "./internal/task-machine";
import { parseActivityPayload } from "./internal/activity";
import { weightedPipelineJpy } from "./internal/digest";
import { isOverdueJst, jstTodayDateOnly, jstWeekRange } from "./internal/jst";
import { sendCrmDigestEmail } from "./internal/notify";

export { deriveNoteTitle } from "./internal/activity";
// route.ts (src/app/) は crm/internal/** を import できない (ESLint MODULES) ため、
// /api/jobs/crm-digest が §7.2 手順 b (全リスト空なら送信スキップ) に使う純関数を facade 経由で公開する。
export { isDigestEmpty } from "./internal/digest";

/**
 * crm モジュールの公開 facade (01-crm.md §6)。
 * 契約 13 メソッド (07-contracts-delta §D8 — シグネチャ不変) + 契約外拡張 22 メソッド
 * (01-crm.md §6.2、他モジュールから呼出禁止)。
 */
export interface CrmFacade {
  intakeFromInquiry(input: IntakeFromInquiryInput): Promise<Result<{ customer_id: string; deal_id: string }>>;
  intakeFromSimulator(input: IntakeFromSimulatorInput): Promise<Result<{ customer_id: string; deal_id: string }>>;

  createCustomer(
    input: CustomerInput,
    opts?: { force?: boolean },
    ctx?: ExecutionContext,
  ): Promise<Result<{ customer_id: string }>>;
  matchCustomerByPhone(telE164: string, ctx?: ExecutionContext): Promise<Result<{ customer_id: string } | null>>;
  getCustomerRef(customerId: string, ctx?: ExecutionContext): Promise<Result<CustomerRef>>;
  getDealRef(dealId: string, ctx?: ExecutionContext): Promise<Result<DealRef>>;
  getDealRefs(dealIds: string[], ctx?: ExecutionContext): Promise<Result<DealRef[]>>;

  createDeal(input: DealInput): Promise<Result<{ deal_id: string }>>;
  updateDealStage(dealId: string, to: DealStage, expectedUpdatedAt: string): Promise<Result<void>>;

  appendActivity(
    input: AppendActivityInput,
    ctx?: ExecutionContext,
  ): Promise<Result<{ activity_id: string; created: boolean }>>;
  relinkActivity(
    activityId: string,
    links: Array<{ customer_id: string | null; company_id: string | null; deal_id: string | null }>,
    ctx?: ExecutionContext,
  ): Promise<Result<void>>;

  createTask(input: TaskInput, ctx?: ExecutionContext): Promise<Result<{ task_id: string }>>;
  completeTask(taskId: string, expectedUpdatedAt: string): Promise<Result<void>>;
}

export interface CrmFacadeExtended extends CrmFacade {
  // 契約外拡張 (01-crm.md §6.2) — 以下すべて他モジュールから呼出禁止。
  listCustomers(filter: CustomerListFilter, p: Pagination): Promise<Result<Paged<CustomerListItem>>>; // 契約外拡張 (01-crm.md §6.2)
  // #44 で追加。会社 Sheet の所属顧客一覧専用 (zCustomerListFilter に company_id が無いための新設 — 上記コメント参照)。
  listCustomersByCompany(companyId: string, p: Pagination): Promise<Result<Paged<CustomerListItem>>>;
  getCustomer(id: string): Promise<Result<CustomerDetail>>; // 契約外拡張 (01-crm.md §6.2)
  updateCustomer(id: string, input: CustomerUpdateInput, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  mergeCustomers(input: MergeCustomersInput, expectedWinnerUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  listCompanies(filter: { q: string | null }, p: Pagination): Promise<Result<Paged<CompanyListItem>>>; // 契約外拡張 (01-crm.md §6.2)
  getCompany(id: string): Promise<Result<CompanyRow>>; // 契約外拡張 (01-crm.md §6.2)
  createCompany(input: CompanyInput): Promise<Result<{ company_id: string }>>; // 契約外拡張 (01-crm.md §6.2)
  updateCompany(id: string, input: CompanyUpdateInput, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  listDeals(filter: DealListFilter, p: Pagination): Promise<Result<Paged<DealListItem>>>; // 契約外拡張 (01-crm.md §6.2)
  // #44 で追加。顧客詳細ページの「進行中案件リスト」専用 (zDealListFilter に customer_id が無いための
  // 新設 — listCustomersByCompany と同型の判断基準。§8.2)。stage は open (非終端) 固定。
  listDealsByCustomer(customerId: string, p: Pagination): Promise<Result<Paged<DealListItem>>>;
  listDealsKanban(): Promise<Result<DealKanbanColumn[]>>; // 契約外拡張 (01-crm.md §6.2)
  getDeal(id: string): Promise<Result<DealDetail>>; // 契約外拡張 (01-crm.md §6.2)
  updateDeal(id: string, input: DealUpdateInput, expectedUpdatedAt: string): Promise<Result<{ updated_at: string }>>; // 契約外拡張 (01-crm.md §6.2)
  markDealLost(id: string, input: MarkDealLostInput, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  // #102: 終端ステージ (入金済み/失注) の案件再開専用経路。理由必須 + 監査 activity ('system',
  // code='deal.reopened') + RPC 限定 DB バイパス (crm_reopen_deal — GUC 'kmb.crm_reopen_unlock')。
  // updateDealStage/markDealLost のガードは無変更 (誤操作防止は維持)。
  reopenDeal(
    dealId: string,
    input: ReopenDealInput,
    expectedUpdatedAt: string,
  ): Promise<Result<{ updated_at: string }>>; // 契約外拡張 (01-crm.md §6.2)
  findDealByInquiry(inquiryId: string): Promise<Result<{ deal_id: string } | null>>; // 契約外拡張 (01-crm.md §6.2)
  listTimeline(target: TimelineTarget, p: TimelinePagination): Promise<Result<Paged<TimelineItem>>>; // 契約外拡張 (01-crm.md §6.2)
  updateNoteActivity(id: string, input: NoteUpdateInput, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  deleteNoteActivity(id: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  relinkNoteActivity(id: string, links: TimelineTarget[]): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  listTasks(filter: TaskListFilter, p: Pagination): Promise<Result<Paged<TaskListItem>>>; // 契約外拡張 (01-crm.md §6.2)
  // #44 で追加。顧客/案件詳細ページの open タスクリスト専用 (zTaskListFilter に customer_id/deal_id
  // が無いための新設 — listDealsByCustomer と同型の判断基準。§8.2/§8.3)。status は open 固定。
  listTasksByCustomer(customerId: string, p: Pagination): Promise<Result<Paged<TaskListItem>>>;
  listTasksByDeal(dealId: string, p: Pagination): Promise<Result<Paged<TaskListItem>>>;
  // #44 で追加。「完了 → toast『元に戻す』で reopen」UX (§8.4) が CAS 用の最新 updated_at を
  // 必要とするための最小の単票参照 (getDealRef/getCustomerRef と同型 — 他モジュール向けではなく
  // admin UI 内の再取得専用)。reopenTask/cancelTask の署名 (expectedUpdatedAt 必須) はそのまま —
  // ページ描画時点の値を使う通常操作の CAS 保護を弱めないため、fetch→write は「直前に自分が
  // 完了させた行を元に戻す」ような同一セッション内の追撃操作に限定して呼び出し側で使う。
  getTaskRef(taskId: string): Promise<Result<{ task_id: string; status: TaskStatus; updated_at: string }>>;
  updateTask(id: string, input: TaskUpdateInput, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  cancelTask(id: string, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  reopenTask(id: string, expectedUpdatedAt: string): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)
  getDashboardKpi(): Promise<Result<CrmDashboardKpi>>; // 契約外拡張 (01-crm.md §6.2)
  collectDigest(ctx: ExecutionContext): Promise<Result<CrmDigest>>; // 契約外拡張 (01-crm.md §6.2)
  sendDailyDigest(digest: CrmDigest, ctx: ExecutionContext): Promise<Result<void>>; // 契約外拡張 (01-crm.md §6.2)

/**
   * 契約外拡張 (01-crm.md §6.2 の変形 — scripts/crm-intake-inquiries.ts 専用、§12.1)。
   * intakeFromInquiry (D8) と同じ冪等シーケンスだが (a) 常に service client (script 実行文脈は
   * cookie セッションを持たない) (b) opts.createDeal=false で「deal なし取込」
   * (status='done' 行、customer のみ lifecycle='customer'・deal も折り返しタスクも作らない) を
   * 表現できる (c) occurredAt を明示指定できる (contact_inquiries.created_at を渡す — 歴史時刻の
   * 保持) 点が D8 と異なる (d) 戻り値に manifest (新規作成された行のみ、customers 先頭) を含む —
   * scripts/crm-intake-inquiries.ts が seed_manifest への記録に使う (§12.1 手順 2)。
   * scripts/**\/*.ts は ESLint 境界により crm/internal を直接 import できないため facade 経由にする。
   */
  intakeFromInquiryMigration(
    input: IntakeFromInquiryInput,
    opts: { createDeal: boolean; occurredAt: string },
  ): Promise<Result<IntakeResult>>;
  /** 契約外拡張 (§6.2 の変形 — scripts/crm-intake-inquiries.ts 専用)。C6 (再実行時の skip 判定) 用。 */
  hasIntakeMarker(inquiryId: string): Promise<Result<boolean>>;
}

// ============================================================
// 共通ヘルパ
// ============================================================

/**
 * ctx 任意の 8 契約メソッド + collectDigest/sendDailyDigest (ctx 必須) が使う client 解決。
 * 省略時/{mode:'session'} は cookie セッション (未ログインは E201)。{mode:'service'} は
 * service_role client (client 注入可、省略時は生成 — 未設定は E901)。
 */
async function resolveExecutionClient(
  ctx: ExecutionContext | undefined,
): Promise<Result<{ client: SupabaseClient; userId: string | null }>> {
  if (ctx?.mode === "service") {
    try {
      const client = ctx.client ?? createSupabaseServiceClient();
      return { ok: true, value: { client, userId: null } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  }
  const { supabase, user } = await getSessionAndClient();
  if (!user) return { ok: false, code: "KMB-E201" };
  return { ok: true, value: { client: supabase, userId: user.id } };
}

function toCustomerRef(row: CustomerRow): CustomerRef {
  return {
    customer_id: row.id,
    name: row.name,
    kind: row.kind,
    company_id: row.company_id,
    tel_e164: row.tel_e164,
    email: row.email,
    address: row.address,
  };
}

/** date-only (YYYY-MM-DD) 文字列の 1 日前。overdue (due_on < today) を lte 検索に変換するため。 */
function dateOnlyMinusOneDay(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function buildDealRef(client: SupabaseClient, deal: DealRow): Promise<Result<DealRef>> {
  const terminalCustomerId = await resolveMergedCustomerIdSafe(client, deal.customer_id);
  if (!terminalCustomerId.ok) return terminalCustomerId;
  const customer = await getCustomerById(client, terminalCustomerId.value);
  if (!customer.ok) return customer;
  if (!customer.value) return { ok: false, code: "KMB-E603", detail: "案件の顧客が見つかりません" };

  let company: DealRef["company"] = null;
  if (deal.company_id !== null) {
    const companyRow = await getCompanyById(client, deal.company_id);
    if (!companyRow.ok) return companyRow;
    if (companyRow.value) {
      company = { company_id: companyRow.value.id, name: companyRow.value.name, address: companyRow.value.address };
    }
  }

  return {
    ok: true,
    value: {
      deal_id: deal.id,
      title: deal.title,
      stage: deal.stage,
      updated_at: deal.updated_at,
      customer: {
        customer_id: customer.value.id,
        name: customer.value.name,
        kind: customer.value.kind,
        address: customer.value.address,
      },
      company,
    },
  };
}

/**
 * 一覧/カンバン/ダイジェスト表示用の DealListItem 変換 (batch)。表示専用のため merged_into の
 * 終端解決はしない (getDealRef/getDealRefs のような跨モジュール参照時のみ厳密解決が必要 —
 * §6.3 補足。表示上の軽微なズレはマージ直後の一覧再読み込みで解消される)。
 */
async function enrichDealListItems(client: SupabaseClient, deals: DealRow[]): Promise<Result<DealListItem[]>> {
  const customerIds = [...new Set(deals.map((d) => d.customer_id))];
  const customersResult = await getCustomersByIds(client, customerIds);
  if (!customersResult.ok) return customersResult;
  const customerNameMap = new Map(customersResult.value.map((c) => [c.id, c.name]));

  const companyIds = [...new Set(deals.map((d) => d.company_id).filter((v): v is string => v !== null))];
  const companiesResult = await getCompaniesByIds(client, companyIds);
  if (!companiesResult.ok) return companiesResult;
  const companyNameMap = new Map(companiesResult.value.map((c) => [c.id, c.name]));

  return {
    ok: true,
    value: deals.map(
      (d): DealListItem => ({
        id: d.id,
        title: d.title,
        customer_id: d.customer_id,
        customer_name: customerNameMap.get(d.customer_id) ?? "(不明)",
        company_id: d.company_id,
        company_name: d.company_id !== null ? (companyNameMap.get(d.company_id) ?? null) : null,
        stage: d.stage,
        amount_jpy: d.amount_jpy,
        expected_close_on: d.expected_close_on,
        source: d.source,
        created_at: d.created_at,
        updated_at: d.updated_at,
      }),
    ),
  };
}

/** listCustomers / listCustomersByCompany (#44) 共用の会社名・進行中案件数エンリッチ。 */
async function enrichCustomerListItems(client: SupabaseClient, customers: CustomerRow[]): Promise<Result<CustomerListItem[]>> {
  const companyIds = [...new Set(customers.map((c) => c.company_id).filter((v): v is string => v !== null))];
  const companies = await getCompaniesByIds(client, companyIds);
  if (!companies.ok) return companies;
  const companyNameMap = new Map(companies.value.map((c) => [c.id, c.name]));

  const customerIds = customers.map((c) => c.id);
  const openDealCounts = await countOpenDealsByCustomerIds(client, customerIds);
  if (!openDealCounts.ok) return openDealCounts;

  return {
    ok: true,
    value: customers.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      name_kana: c.name_kana,
      email: c.email,
      tel_e164: c.tel_e164,
      company_name: c.company_id !== null ? (companyNameMap.get(c.company_id) ?? null) : null,
      lifecycle: c.lifecycle,
      source: c.source,
      open_deal_count: openDealCounts.value[c.id] ?? 0,
      created_at: c.created_at,
      updated_at: c.updated_at,
    })),
  };
}

function toTaskListItem(
  row: TaskRow,
  deal: { id: string; title: string } | null,
  customer: { id: string; name: string } | null,
): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    due_on: row.due_on,
    status: row.status,
    origin: row.origin,
    deal,
    customer,
    overdue: row.status === "open" && isOverdueJst(row.due_on),
    updated_at: row.updated_at,
  };
}

async function enrichTaskListItems(client: SupabaseClient, tasks: TaskRow[]): Promise<Result<TaskListItem[]>> {
  const dealIds = [...new Set(tasks.map((t) => t.deal_id).filter((v): v is string => v !== null))];
  const deals = await getDealsByIds(client, dealIds);
  if (!deals.ok) return deals;
  const dealMap = new Map(deals.value.map((d) => [d.id, d.title]));

  const customerIds = [...new Set(tasks.map((t) => t.customer_id).filter((v): v is string => v !== null))];
  const customers = await getCustomersByIds(client, customerIds);
  if (!customers.ok) return customers;
  const customerMap = new Map(customers.value.map((c) => [c.id, c.name]));

  return {
    ok: true,
    value: tasks.map((t) =>
      toTaskListItem(
        t,
        t.deal_id !== null && dealMap.has(t.deal_id) ? { id: t.deal_id, title: dealMap.get(t.deal_id)! } : null,
        t.customer_id !== null && customerMap.has(t.customer_id)
          ? { id: t.customer_id, name: customerMap.get(t.customer_id)! }
          : null,
      ),
    ),
  };
}

/** links 要素 (customer_id/company_id/deal_id のいずれか厳密 1 つ) の存在確認 + merged 終端解決込みの解決。 */
async function resolveLinkTarget(
  client: SupabaseClient,
  link: { customer_id: string | null; company_id: string | null; deal_id: string | null },
): Promise<Result<ActivityLinkTarget>> {
  if (link.customer_id !== null) {
    const terminalId = await resolveMergedCustomerIdSafe(client, link.customer_id);
    if (!terminalId.ok) return terminalId;
    return { ok: true, value: { customer_id: terminalId.value, company_id: null, deal_id: null } };
  }
  if (link.company_id !== null) {
    const row = await getCompanyById(client, link.company_id);
    if (!row.ok) return row;
    if (!row.value) return { ok: false, code: "KMB-E603", detail: `会社が見つかりません: ${link.company_id}` };
    return { ok: true, value: { customer_id: null, company_id: link.company_id, deal_id: null } };
  }
  if (link.deal_id !== null) {
    const row = await getDealById(client, link.deal_id);
    if (!row.ok) return row;
    if (!row.value) return { ok: false, code: "KMB-E603", detail: `案件が見つかりません: ${link.deal_id}` };
    return { ok: true, value: { customer_id: null, company_id: null, deal_id: link.deal_id } };
  }
  return {
    ok: false,
    code: "KMB-E101",
    detail: "links の各要素は customer_id/company_id/deal_id のいずれか 1 つが必要です",
  };
}

// ============================================================
// facade 実装
// ============================================================

export const crmFacade: CrmFacadeExtended = {
  // ---- 契約メソッド (07-delta §D8) ----

  async intakeFromInquiry(rawInput) {
    try {
      const parsed = zIntakeFromInquiryInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const telE164 = parsed.data.contact.tel !== null ? normalizeJpPhoneToE164(parsed.data.contact.tel) : null;
      const email = parsed.data.contact.email;
      if (email === null && telE164 === null) return { ok: false, code: "KMB-E607" };

      const client = createSupabaseServiceClient();
      const result = await runIntakeSequence(client, {
        kind: "inquiry",
        inquiryId: parsed.data.inquiry_id,
        contact: { name: parsed.data.contact.name, email, telE164 },
        occurredAt: new Date().toISOString(),
        inquiryType: parsed.data.inquiry_type,
        bodyExcerpt: parsed.data.body_excerpt,
      });
      if (!result.ok) return result;
      if (result.value.deal_id === null) {
        return { ok: false, code: "KMB-E901", detail: "内部エラー: deal_id が解決されませんでした" };
      }
      return { ok: true, value: { customer_id: result.value.customer_id, deal_id: result.value.deal_id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async intakeFromSimulator(rawInput) {
    try {
      const parsed = zIntakeFromSimulatorInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const telE164 = parsed.data.contact.tel !== null ? normalizeJpPhoneToE164(parsed.data.contact.tel) : null;
      const email = parsed.data.contact.email;
      if (email === null && telE164 === null) return { ok: false, code: "KMB-E607" };

      const client = createSupabaseServiceClient();
      const result = await runIntakeSequence(client, {
        kind: "simulator",
        inquiryId: parsed.data.inquiry_id,
        contact: { name: parsed.data.contact.name, email, telE164 },
        occurredAt: new Date().toISOString(),
        estimate: parsed.data.estimate,
      });
      if (!result.ok) return result;
      if (result.value.deal_id === null) {
        return { ok: false, code: "KMB-E901", detail: "内部エラー: deal_id が解決されませんでした" };
      }
      return { ok: true, value: { customer_id: result.value.customer_id, deal_id: result.value.deal_id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createCustomer(rawInput, opts, ctx) {
    try {
      const parsed = zCustomerInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const { client, userId } = resolved.value;

      if (parsed.data.company_id !== null) {
        const company = await getCompanyById(client, parsed.data.company_id);
        if (!company.ok) return company;
        if (!company.value) return { ok: false, code: "KMB-E603", detail: "指定の会社が見つかりません" };
      }

      if (!opts?.force) {
        const dedup = await resolveDuplicates(client, parsed.data.email, parsed.data.tel_e164);
        if (!dedup.ok) return dedup;
        if (dedup.value.kind !== "none") {
          const candidates = dedup.value.kind === "single" ? [dedup.value.candidate] : dedup.value.candidates;
          // detail は JSON 配列文字列で返す (顧客名にカンマを含み得るため単純なカンマ区切りは不可 —
          // 呼び出し側 UI は src/app/admin/customers/duplicate-candidates.ts の parseDuplicateCandidates で復元する)。
          return {
            ok: false,
            code: "KMB-E601",
            detail: JSON.stringify(candidates.map((c) => ({ customer_id: c.customer_id, name: c.name }))),
          };
        }
      }

      const created = await createCustomerRow(client, parsed.data, userId);
      if (!created.ok) return created;
      return { ok: true, value: { customer_id: created.value.id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async matchCustomerByPhone(telE164, ctx) {
    try {
      const parsedTel = zTelE164.safeParse(telE164);
      if (!parsedTel.success) return { ok: false, code: "KMB-E101", detail: parsedTel.error.message };

      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;

      const dedup = await resolveDuplicates(resolved.value.client, null, parsedTel.data);
      if (!dedup.ok) return dedup;
      if (dedup.value.kind === "none") return { ok: true, value: null };
      if (dedup.value.kind === "single") return { ok: true, value: { customer_id: dedup.value.candidate.customer_id } };
      return { ok: false, code: "KMB-E601", detail: dedup.value.candidates.map((c) => c.customer_id).join(", ") };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getCustomerRef(customerId, ctx) {
    try {
      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const terminalId = await resolveMergedCustomerIdSafe(resolved.value.client, customerId);
      if (!terminalId.ok) return terminalId;
      const row = await getCustomerById(resolved.value.client, terminalId.value);
      if (!row.ok) return row;
      if (!row.value) return { ok: false, code: "KMB-E603" };
      return { ok: true, value: toCustomerRef(row.value) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getDealRef(dealId, ctx) {
    try {
      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const row = await getDealById(resolved.value.client, dealId);
      if (!row.ok) return row;
      if (!row.value) return { ok: false, code: "KMB-E603" };
      return buildDealRef(resolved.value.client, row.value);
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getDealRefs(dealIds, ctx) {
    try {
      if (dealIds.length === 0) return { ok: true, value: [] };
      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const deals = await getDealsByIds(resolved.value.client, dealIds);
      if (!deals.ok) return deals;
      const refs: DealRef[] = [];
      for (const deal of deals.value) {
        const ref = await buildDealRef(resolved.value.client, deal);
        if (!ref.ok) return ref;
        refs.push(ref.value);
      }
      return { ok: true, value: refs };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createDeal(rawInput) {
    try {
      const parsed = zDealInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const customer = await getCustomerById(supabase, parsed.data.customer_id);
      if (!customer.ok) return customer;
      if (!customer.value) return { ok: false, code: "KMB-E603", detail: "指定の顧客が見つかりません" };

      // P2: customer.kind==='company_contact' かつ input.company_id===null なら自動補完
      let companyId = parsed.data.company_id;
      if (companyId === null && customer.value.kind === "company_contact" && customer.value.company_id !== null) {
        companyId = customer.value.company_id;
      }
      if (companyId !== null) {
        const company = await getCompanyById(supabase, companyId);
        if (!company.ok) return company;
        if (!company.value) return { ok: false, code: "KMB-E603", detail: "指定の会社が見つかりません" };
      }

      const created = await createDealRow(
        supabase,
        {
          title: parsed.data.title,
          customer_id: parsed.data.customer_id,
          company_id: companyId,
          stage: parsed.data.stage,
          amount_jpy: parsed.data.amount_jpy,
          expected_close_on: parsed.data.expected_close_on,
          source: parsed.data.source,
          source_inquiry_id: null,
          notes: parsed.data.notes,
        },
        user.id,
      );
      if (!created.ok) return created;
      return { ok: true, value: { deal_id: created.value.id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async updateDealStage(dealId, to, expectedUpdatedAt) {
    try {
      const parsedStage = zDealStage.safeParse(to);
      if (!parsedStage.success) return { ok: false, code: "KMB-E101", detail: parsedStage.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const deal = await getDealById(supabase, dealId);
      if (!deal.ok) return deal;
      if (!deal.value) return { ok: false, code: "KMB-E603" };

      const guard = canTransitionDealStage(deal.value.stage, parsedStage.data);
      if (guard.kind === "noop") return { ok: true, value: undefined };
      if (guard.kind === "invalid") {
        return { ok: false, code: "KMB-E602", detail: "終端ステージ (入金済み/失注) からは変更できません" };
      }
      if (guard.kind === "needs_reason") {
        return { ok: false, code: "KMB-E602", detail: "失注は「失注にする」(理由入力) から行ってください" };
      }

      const patch: DealUpdatePatch = { stage: parsedStage.data };
      if (shouldRecordWonAt(parsedStage.data, deal.value.won_at)) {
        patch.won_at = new Date().toISOString();
      }
      const updated = await updateDealWithCas(supabase, dealId, patch, expectedUpdatedAt);
      if (!updated.ok) return updated;

      if (DEAL_STAGE_REGISTRY[parsedStage.data].isWon) {
        const customer = await getCustomerById(supabase, deal.value.customer_id);
        if (!customer.ok) {
          // §4.2 不変条件2: 昇格は「won 系遷移のたびに再試行される冪等条件」。stage 更新は既に成立
          // しているため、ここでの取得失敗はログに残しつつ主操作は成功のまま返す (握り潰さない —
          // 明示的にログ出力し、以後の won 系遷移で自己修復される設計)。
          console.warn(
            `[KMB-E901] updateDealStage: lifecycle 自動昇格のための顧客取得に失敗しました (deal=${dealId}):`,
            customer.code,
            customer.detail,
          );
        } else if (customer.value && shouldPromoteLifecycleOnWin(parsedStage.data, customer.value.lifecycle)) {
          const promote = await updateCustomerWithCas(
            supabase,
            customer.value.id,
            {
              kind: customer.value.kind,
              name: customer.value.name,
              name_kana: customer.value.name_kana,
              email: customer.value.email,
              tel_e164: customer.value.tel_e164,
              company_id: customer.value.company_id,
              address: customer.value.address,
              notes: customer.value.notes,
              lifecycle: "customer",
            },
            customer.value.updated_at,
          );
          if (!promote.ok) {
            console.warn(
              `[KMB-E901] updateDealStage: lifecycle 自動昇格に失敗しました (customer=${customer.value.id}):`,
              promote.code,
              promote.detail,
            );
          }
        }
      }

      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async appendActivity(rawInput, ctx) {
    try {
      const parsed = zAppendActivityInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const payloadParsed = parseActivityPayload(parsed.data.activity_type, parsed.data.payload);
      if (!payloadParsed.success) return { ok: false, code: "KMB-E604", detail: payloadParsed.error };

      // J7 Phase 2 段階解禁 (#101): 'email' は outbound (帳票のメール送付 — sales.sendDocumentByEmail)
      // のみ挿入を許可する。inbound (受信取込) は受信基盤が無く、挿入しても孤児データになるため
      // 引き続き KMB-E604 で拒否する。二段階 parse (上記) 済みの payload で判定する
      // (旧実装は activity_type だけで一律拒否していた — 01-crm.md §12「'email' activity」是正)。
      if (
        parsed.data.activity_type === "email" &&
        (payloadParsed.data as ActivityPayload<"email">).direction === "inbound"
      ) {
        return { ok: false, code: "KMB-E604", detail: "メールの受信取込は未対応です (送信のみ対応)。" };
      }

      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const { client, userId } = resolved.value;

      const resolvedLinks: ActivityLinkTarget[] = [];
      for (const link of parsed.data.links) {
        const target = await resolveLinkTarget(client, link);
        if (!target.ok) return target;
        resolvedLinks.push(target.value);
      }

      const appended = await appendActivityRow(
        client,
        {
          activity_type: parsed.data.activity_type,
          occurred_at: parsed.data.occurred_at,
          title: parsed.data.title,
          body: parsed.data.body,
          payload: payloadParsed.data,
          ref_table: parsed.data.ref_table,
          ref_id: parsed.data.ref_id,
        },
        userId,
      );
      if (!appended.ok) return appended;

      for (const link of resolvedLinks) {
        const linked = await linkActivityRow(client, appended.value.row.id, link);
        if (!linked.ok) return linked;
      }

      return { ok: true, value: { activity_id: appended.value.row.id, created: appended.value.created } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async relinkActivity(activityId, rawLinks, ctx) {
    try {
      for (const l of rawLinks) {
        const nonNullCount = [l.customer_id, l.company_id, l.deal_id].filter((v) => v !== null).length;
        if (nonNullCount !== 1) {
          return {
            ok: false,
            code: "KMB-E101",
            detail: "links の各要素は customer_id/company_id/deal_id のいずれか 1 つのみ指定してください",
          };
        }
      }

      // 呼び出し元の認可確認 (session ならログイン確認、service ならそのまま許可)
      const caller = await resolveExecutionClient(ctx);
      if (!caller.ok) return caller;

      // 全置換は service 実行 (§6.7 手順 4 — RLS の「note のリンクのみ」直接操作制約を widen しない)
      let serviceClient: SupabaseClient;
      try {
        serviceClient = createSupabaseServiceClient();
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
      }

      const activity = await getActivityById(serviceClient, activityId);
      if (!activity.ok) return activity;
      if (!activity.value) return { ok: false, code: "KMB-E603", detail: "対象の記録が見つかりません" };

      const resolvedLinks: ActivityLinkTarget[] = [];
      for (const link of rawLinks) {
        const target = await resolveLinkTarget(serviceClient, link);
        if (!target.ok) return target;
        resolvedLinks.push(target.value);
      }

      const oldLinks = await listActivityLinksByActivity(serviceClient, activityId);
      if (!oldLinks.ok) return oldLinks;

      const deleted = await deleteActivityLinksByActivity(serviceClient, activityId);
      if (!deleted.ok) return deleted;
      for (const link of resolvedLinks) {
        const linked = await linkActivityRow(serviceClient, activityId, link);
        if (!linked.ok) return linked;
      }

      // 監査 (§6.7 手順5)。失敗しても置換自体は成立 — ログのみ (マージ §6.4 と同じ縮退)。
      const summarize = (ls: Array<{ customer_id: string | null; company_id: string | null; deal_id: string | null }>) =>
        ls.length === 0 ? "(なし)" : ls.map((l) => l.customer_id ?? l.company_id ?? l.deal_id).join(", ");
      const auditLinks = resolvedLinks.length > 0 ? resolvedLinks : (oldLinks.value as ActivityLinkTarget[]);
      const audit = await appendActivityRow(
        serviceClient,
        {
          activity_type: "system",
          occurred_at: new Date().toISOString(),
          title: "リンク付け替え",
          body: null,
          payload: {
            code: "activity.relinked",
            detail: `旧: [${summarize(oldLinks.value)}] → 新: [${summarize(resolvedLinks)}]`,
          },
          ref_table: "activities/relinked",
          ref_id: null,
        },
        caller.value.userId,
      );
      if (audit.ok) {
        for (const link of auditLinks) {
          await linkActivityRow(serviceClient, audit.value.row.id, link);
        }
      } else {
        console.warn(
          `[KMB-E901] relinkActivity の監査 activity 追記に失敗しました (activity=${activityId}):`,
          audit.code,
          audit.detail,
        );
      }

      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createTask(rawInput, ctx) {
    try {
      const parsed = zTaskInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const { client, userId } = resolved.value;

      if (parsed.data.deal_id !== null) {
        const deal = await getDealById(client, parsed.data.deal_id);
        if (!deal.ok) return deal;
        if (!deal.value) return { ok: false, code: "KMB-E603", detail: "指定の案件が見つかりません" };
      }
      if (parsed.data.customer_id !== null) {
        const customer = await getCustomerById(client, parsed.data.customer_id);
        if (!customer.ok) return customer;
        if (!customer.value) return { ok: false, code: "KMB-E603", detail: "指定の顧客が見つかりません" };
      }

      const created = await createTaskRow(client, parsed.data, userId);
      if (!created.ok) return created;

      const event = await appendActivityRow(
        client,
        {
          activity_type: "task_event",
          occurred_at: new Date().toISOString(),
          title: "やること作成",
          body: null,
          payload: { task_id: created.value.row.id, event: "created", origin: parsed.data.origin },
          ref_table: "tasks",
          ref_id: created.value.row.id,
        },
        userId,
      );
      if (!event.ok) return event;
      if (parsed.data.customer_id !== null) {
        const linked = await linkActivityRow(client, event.value.row.id, {
          customer_id: parsed.data.customer_id,
          company_id: null,
          deal_id: null,
        });
        if (!linked.ok) return linked;
      }
      if (parsed.data.deal_id !== null) {
        const linked = await linkActivityRow(client, event.value.row.id, {
          customer_id: null,
          company_id: null,
          deal_id: parsed.data.deal_id,
        });
        if (!linked.ok) return linked;
      }

      return { ok: true, value: { task_id: created.value.row.id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async completeTask(taskId, expectedUpdatedAt) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const task = await getTaskById(supabase, taskId);
      if (!task.ok) return task;
      if (!task.value) return { ok: false, code: "KMB-E603" };

      const guard = canTransitionTaskStatus(task.value.status, "done");
      if (guard.kind === "invalid") return { ok: false, code: "KMB-E606" };
      if (guard.kind === "noop") return { ok: true, value: undefined };

      const updated = await updateTaskWithCas(
        supabase,
        taskId,
        { status: "done", completed_at: new Date().toISOString() },
        expectedUpdatedAt,
      );
      if (!updated.ok) return updated;

      const event = await appendActivityRow(
        supabase,
        {
          activity_type: "task_event",
          occurred_at: new Date().toISOString(),
          title: "やること完了",
          body: null,
          payload: { task_id: taskId, event: "completed", origin: task.value.origin },
          ref_table: null,
          ref_id: null,
        },
        user.id,
      );
      if (!event.ok) return event;

      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  // ---- 契約外拡張 (01-crm.md §6.2) ----

  async listCustomers(rawFilter, rawPagination) {
    try {
      const filter = zCustomerListFilter.safeParse(rawFilter);
      if (!filter.success) return { ok: false, code: "KMB-E101", detail: filter.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listCustomersPage(
        supabase,
        { q: filter.data.q, lifecycle: filter.data.lifecycle, includeMerged: filter.data.include_merged },
        pagination.data,
      );
      if (!page.ok) return page;

      const items = await enrichCustomerListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  // #44 (crm 画面) で追加した契約外拡張。会社 Sheet の「所属顧客一覧」用 (01-crm.md §8.2)。
  // zCustomerListFilter (§5.2 完全定義) には company_id が無く、canonical スキーマを崩さず対応するため
  // listCustomers とは別の専用メソッドとして新設 (repository.CustomerListQuery.companyId は内部限定の
  // 型拡張 — 07-contracts-delta 改訂を要する契約変更ではない、という plan.md の判断基準に従った)。
  // lifecycle は絞らず全件 (会社に所属する顧客を lifecycle 横断で見せるのが「所属顧客一覧」の目的)。
  // マージ済み (merged_into 非 NULL) は listCustomers 既定と同じく除外 — 敗者行を会社Sheetに残さない。
  async listCustomersByCompany(companyId, rawPagination) {
    try {
      const parsedId = z.string().uuid().safeParse(companyId);
      if (!parsedId.success) return { ok: false, code: "KMB-E101", detail: parsedId.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listCustomersPage(
        supabase,
        { q: null, lifecycle: "all", includeMerged: false, companyId: parsedId.data },
        pagination.data,
      );
      if (!page.ok) return page;

      const items = await enrichCustomerListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getCustomer(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const row = await getCustomerById(supabase, id);
      if (!row.ok) return row;
      if (!row.value) return { ok: false, code: "KMB-E603" };
      const c = row.value;

      let companyName: string | null = null;
      if (c.company_id !== null) {
        const company = await getCompanyById(supabase, c.company_id);
        if (!company.ok) return company;
        companyName = company.value?.name ?? null;
      }
      const openDealCounts = await countOpenDealsByCustomerIds(supabase, [c.id]);
      if (!openDealCounts.ok) return openDealCounts;

      const detail: CustomerDetail = {
        id: c.id,
        kind: c.kind,
        name: c.name,
        name_kana: c.name_kana,
        email: c.email,
        tel_e164: c.tel_e164,
        company_name: companyName,
        lifecycle: c.lifecycle,
        source: c.source,
        open_deal_count: openDealCounts.value[c.id] ?? 0,
        created_at: c.created_at,
        updated_at: c.updated_at,
        address: c.address,
        notes: c.notes,
        company_id: c.company_id,
        merged_into_customer_id: c.merged_into_customer_id,
        created_by: c.created_by,
      };
      return { ok: true, value: detail };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async updateCustomer(id, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zCustomerUpdateInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      if (parsed.data.company_id !== null) {
        const company = await getCompanyById(supabase, parsed.data.company_id);
        if (!company.ok) return company;
        if (!company.value) return { ok: false, code: "KMB-E603", detail: "指定の会社が見つかりません" };
      }
      const updated = await updateCustomerWithCas(supabase, id, parsed.data, expectedUpdatedAt);
      if (!updated.ok) return updated;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async mergeCustomers(rawInput, expectedWinnerUpdatedAt) {
    try {
      const parsed = zMergeCustomersInput.safeParse(rawInput);
      if (!parsed.success) {
        const isCombo = parsed.error.issues.some((i) => i.path.length === 0);
        return { ok: false, code: isCombo ? "KMB-E608" : "KMB-E101", detail: parsed.error.message };
      }
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const loser = await getCustomerById(supabase, parsed.data.loser_id);
      if (!loser.ok) return loser;
      if (!loser.value) return { ok: false, code: "KMB-E603", detail: "統合対象 (消える側) の顧客が見つかりません" };
      if (loser.value.merged_into_customer_id !== null) {
        return { ok: false, code: "KMB-E608", detail: "統合済みの顧客は統合元に指定できません" };
      }

      const merged = await mergeCustomersRepo(supabase, parsed.data.winner_id, parsed.data.loser_id, expectedWinnerUpdatedAt);
      if (!merged.ok) return merged;

      const audit = await appendActivityRow(
        supabase,
        {
          activity_type: "system",
          occurred_at: new Date().toISOString(),
          title: "顧客統合",
          body: null,
          payload: { code: "customer.merged", detail: `${loser.value.name} を統合` },
          ref_table: "customers",
          ref_id: parsed.data.loser_id,
        },
        user.id,
      );
      if (audit.ok) {
        await linkActivityRow(supabase, audit.value.row.id, {
          customer_id: parsed.data.winner_id,
          company_id: null,
          deal_id: null,
        });
      } else {
        console.warn(`[KMB-E901] mergeCustomers の監査 activity 追記に失敗しました:`, audit.code, audit.detail);
      }

      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listCompanies(rawFilter, rawPagination) {
    try {
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listCompaniesPage(supabase, { q: rawFilter.q }, pagination.data);
      if (!page.ok) return page;

      const companyIds = page.value.items.map((c) => c.id);
      const counts = await countCustomersByCompanyIds(supabase, companyIds);
      if (!counts.ok) return counts;

      const items: CompanyListItem[] = page.value.items.map((c) => ({
        id: c.id,
        name: c.name,
        name_kana: c.name_kana,
        tel_e164: c.tel_e164,
        address: c.address,
        customer_count: counts.value[c.id] ?? 0,
        updated_at: c.updated_at,
      }));
      return { ok: true, value: { items, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getCompany(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const row = await getCompanyById(supabase, id);
      if (!row.ok) return row;
      if (!row.value) return { ok: false, code: "KMB-E603" };
      return { ok: true, value: row.value };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createCompany(rawInput) {
    try {
      const parsed = zCompanyInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const created = await createCompanyRow(supabase, parsed.data, user.id);
      if (!created.ok) return created;
      return { ok: true, value: { company_id: created.value.id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async updateCompany(id, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zCompanyUpdateInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const updated = await updateCompanyWithCas(supabase, id, parsed.data, expectedUpdatedAt);
      if (!updated.ok) return updated;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listDeals(rawFilter, rawPagination) {
    try {
      const filter = zDealListFilter.safeParse(rawFilter);
      if (!filter.success) return { ok: false, code: "KMB-E101", detail: filter.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listDealsPage(supabase, { q: filter.data.q, stage: filter.data.stage }, pagination.data);
      if (!page.ok) return page;
      const items = await enrichDealListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  // #44 (crm 画面) で追加した契約外拡張。顧客詳細ページの「進行中案件リスト」用 (01-crm.md §8.2)。
  // stage は open (非終端 7 ステージ) 固定 — 完了済み/失注案件は詳細ページの別セクションを
  // 設けず一覧非表示のまま (v1 の割り切り、listDeals?stage=all で個別に確認可能)。
  async listDealsByCustomer(customerId, rawPagination) {
    try {
      const parsedId = z.string().uuid().safeParse(customerId);
      if (!parsedId.success) return { ok: false, code: "KMB-E101", detail: parsedId.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listDealsPage(supabase, { q: null, stage: "open", customerId: parsedId.data }, pagination.data);
      if (!page.ok) return page;
      const items = await enrichDealListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listDealsKanban() {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const columns: DealKanbanColumn[] = [];
      for (const stage of zDealStage.options) {
        const limit = stage === "paid" || stage === "lost" ? 20 : null;
        const rows = await listDealsByStage(supabase, stage, limit);
        if (!rows.ok) return rows;
        const items = await enrichDealListItems(supabase, rows.value);
        if (!items.ok) return items;
        const totalJpy = rows.value.reduce((sum, d) => sum + (d.amount_jpy ?? 0), 0);
        columns.push({ stage, total_jpy: totalJpy, deals: items.value });
      }
      return { ok: true, value: columns };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getDeal(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const row = await getDealById(supabase, id);
      if (!row.ok) return row;
      if (!row.value) return { ok: false, code: "KMB-E603" };
      const items = await enrichDealListItems(supabase, [row.value]);
      if (!items.ok) return items;
      const listItem = items.value[0];
      const detail: DealDetail = {
        ...listItem,
        pipeline: row.value.pipeline,
        won_at: row.value.won_at,
        lost_reason: row.value.lost_reason,
        source_inquiry_id: row.value.source_inquiry_id,
        notes: row.value.notes,
      };
      return { ok: true, value: detail };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async updateDeal(id, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zDealUpdateInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      if (parsed.data.company_id !== null) {
        const company = await getCompanyById(supabase, parsed.data.company_id);
        if (!company.ok) return company;
        if (!company.value) return { ok: false, code: "KMB-E603", detail: "指定の会社が見つかりません" };
      }
      const updated = await updateDealWithCas(supabase, id, parsed.data, expectedUpdatedAt);
      if (!updated.ok) return updated;
      return { ok: true, value: { updated_at: updated.value.updated_at } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async markDealLost(id, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zMarkDealLostInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const deal = await getDealById(supabase, id);
      if (!deal.ok) return deal;
      if (!deal.value) return { ok: false, code: "KMB-E603" };

      const guard = canTransitionDealStage(deal.value.stage, "lost");
      if (guard.kind === "invalid") {
        return { ok: false, code: "KMB-E602", detail: "終端ステージ (入金済み/失注) からは変更できません" };
      }
      if (guard.kind === "noop") return { ok: true, value: undefined };

      const updated = await updateDealWithCas(
        supabase,
        id,
        { stage: "lost", lost_reason: parsed.data.reason },
        expectedUpdatedAt,
      );
      if (!updated.ok) return updated;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async reopenDeal(dealId, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zReopenDealInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const deal = await getDealById(supabase, dealId);
      if (!deal.ok) return deal;
      if (!deal.value) return { ok: false, code: "KMB-E603" };

      const guard = canReopenDeal(deal.value.stage, parsed.data.to_stage);
      if (guard.kind === "invalid") {
        return {
          ok: false,
          code: "KMB-E609",
          detail: "再開は終端ステージ (入金済み/失注) からのみ、戻し先は非終端ステージのみ指定できます",
        };
      }

      // §4.2 不変条件1: won_at は isWon 系ステージへの初到達時に 1 回だけ記録する。lost からの再開は
      // 「lost に落ちる前に一度も won 系ステージに到達していなかった (won_at が null のままだった)」
      // 案件を won 系ステージ (ordered/in_production/delivered/invoiced) へ戻すケースがあり得るため、
      // これも「初到達」に該当する (updateDealStage と同じ shouldRecordWonAt 判定を再利用 — isWon の
      // 唯一の正は DEAL_STAGE_REGISTRY であり SQL 側に重複させない)。既に記録済みなら false を返し
      // RPC には null を渡す (crm_reopen_deal 側は coalesce(v_deal.won_at, p_won_at) で
      // 「既存値があれば上書きしない」を再確認する二重防御)。
      const wonAt = shouldRecordWonAt(parsed.data.to_stage, deal.value.won_at)
        ? new Date().toISOString()
        : null;

      const reopened = await reopenDealRpc(
        supabase,
        dealId,
        parsed.data.to_stage,
        parsed.data.reason,
        expectedUpdatedAt,
        wonAt,
      );
      if (!reopened.ok) return reopened;

      // 監査 activity ('customer.merged' — facade.ts mergeCustomers と同前例)。ref_table/ref_id は
      // null (activities_ref_pair check 許容) — 同一 deal の複数回再開が冪等キー (activity_type,
      // ref_table, ref_id) で誤って dedup されるのを回避する (links のみで deal に紐づける)。
      // 追記失敗は console.warn のみで主操作 (再開) は成功のまま返す (updateDealStage の lifecycle
      // 昇格失敗時と同じ「握り潰さず明示ログ」パターン)。
      const fromLabel = DEAL_STAGE_REGISTRY[deal.value.stage].label;
      const toLabel = DEAL_STAGE_REGISTRY[parsed.data.to_stage].label;
      const audit = await appendActivityRow(
        supabase,
        {
          activity_type: "system",
          occurred_at: new Date().toISOString(),
          title: "案件を再開",
          body: null,
          payload: { code: "deal.reopened", detail: `${fromLabel}→${toLabel}: ${parsed.data.reason}` },
          ref_table: null,
          ref_id: null,
        },
        user.id,
      );
      if (audit.ok) {
        await linkActivityRow(supabase, audit.value.row.id, {
          customer_id: null,
          company_id: null,
          deal_id: dealId,
        });
      } else {
        console.warn(`[KMB-E901] reopenDeal の監査 activity 追記に失敗しました:`, audit.code, audit.detail);
      }

      return { ok: true, value: { updated_at: reopened.value.new_updated_at } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async findDealByInquiry(inquiryId) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      return await findDealBySourceInquiry(supabase, inquiryId);
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listTimeline(rawTarget, rawPagination) {
    try {
      const target = zTimelineTarget.safeParse(rawTarget);
      if (!target.success) return { ok: false, code: "KMB-E101", detail: target.error.message };
      const pagination = zTimelinePagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      let column: "customer_id" | "company_id" | "deal_id";
      let targetId: string;
      if ("customer_id" in target.data) {
        column = "customer_id";
        targetId = target.data.customer_id;
        const row = await getCustomerById(supabase, targetId);
        if (!row.ok) return row;
        if (!row.value) return { ok: false, code: "KMB-E603" };
      } else if ("company_id" in target.data) {
        column = "company_id";
        targetId = target.data.company_id;
        const row = await getCompanyById(supabase, targetId);
        if (!row.ok) return row;
        if (!row.value) return { ok: false, code: "KMB-E603" };
      } else {
        column = "deal_id";
        targetId = target.data.deal_id;
        const row = await getDealById(supabase, targetId);
        if (!row.ok) return row;
        if (!row.value) return { ok: false, code: "KMB-E603" };
      }

      const page = await listTimelinePage(supabase, column, targetId, {
        cursor: pagination.data.cursor,
        limit: pagination.data.limit,
      });
      if (!page.ok) return page;

      // 01-crm.md §5.4 (行1071) / §8.5 (行1390): payload parse 失敗は「E604 ログ + タイムラインでは
      // 『表示できない記録』フォールバック描画」と規定されている — ページ全体を失敗させる仕様ではない
      // (#44 実装時に facade.ts 旧実装 [1件でも parse 失敗すると Result 全体を E604 で失敗させていた]
      // が canonical のこの規定と矛盾していたため是正。判断根拠: 上記2箇所の canonical 記述を実測で
      // 確認した結果、行単位フォールバックが明文で要求されており「安全側」判断を要する余地はなかった)。
      // parse 失敗行は payload=null / payload_error=メッセージ で個別に degrade し、握り潰さず
      // console.warn で明示ログする (E901 系の既存ログ規約に倣う — updateDealStage 昇格失敗時と同型)。
      const items: TimelineItem[] = page.value.items.map((row) => {
        const payloadParsed = parseActivityPayload(row.activity_type, row.payload);
        if (!payloadParsed.success) {
          console.warn(
            `[KMB-E604] listTimeline: activity ${row.id} の payload が契約と不一致です。行単位で「表示できない記録」にフォールバックします:`,
            payloadParsed.error,
          );
        }
        return {
          id: row.id,
          activity_type: row.activity_type,
          occurred_at: row.occurred_at,
          title: row.title,
          body: row.body,
          payload: payloadParsed.success ? payloadParsed.data : null,
          payload_error: payloadParsed.success ? null : payloadParsed.error,
          ref_table: row.ref_table,
          ref_id: row.ref_id,
          editable: row.activity_type === "note",
          updated_at: row.updated_at,
        };
      });
      return { ok: true, value: { items, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async updateNoteActivity(id, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zNoteUpdateInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const existing = await getActivityById(supabase, id);
      if (!existing.ok) return existing;
      if (!existing.value) return { ok: false, code: "KMB-E603" };
      if (existing.value.activity_type !== "note") return { ok: false, code: "KMB-E605" };
      const updated = await updateNoteActivityRow(supabase, id, parsed.data, expectedUpdatedAt);
      if (!updated.ok) return updated;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async deleteNoteActivity(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const existing = await getActivityById(supabase, id);
      if (!existing.ok) return existing;
      if (!existing.value) return { ok: false, code: "KMB-E603" };
      if (existing.value.activity_type !== "note") return { ok: false, code: "KMB-E605" };
      return await deleteNoteActivityRow(supabase, id);
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async relinkNoteActivity(id, rawLinks) {
    try {
      const parsedLinks = z.array(zTimelineTarget).safeParse(rawLinks);
      if (!parsedLinks.success) return { ok: false, code: "KMB-E101", detail: parsedLinks.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const existing = await getActivityById(supabase, id);
      if (!existing.ok) return existing;
      if (!existing.value) return { ok: false, code: "KMB-E603" };
      if (existing.value.activity_type !== "note") return { ok: false, code: "KMB-E605" };

      const resolvedLinks: ActivityLinkTarget[] = [];
      for (const t of parsedLinks.data) {
        const target = await resolveLinkTarget(supabase, {
          customer_id: "customer_id" in t ? t.customer_id : null,
          company_id: "company_id" in t ? t.company_id : null,
          deal_id: "deal_id" in t ? t.deal_id : null,
        });
        if (!target.ok) return target;
        resolvedLinks.push(target.value);
      }

      const deleted = await deleteActivityLinksByActivity(supabase, id);
      if (!deleted.ok) return deleted;
      for (const link of resolvedLinks) {
        const linked = await linkActivityRow(supabase, id, link);
        if (!linked.ok) return linked;
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listTasks(rawFilter, rawPagination) {
    try {
      const filter = zTaskListFilter.safeParse(rawFilter);
      if (!filter.success) return { ok: false, code: "KMB-E101", detail: filter.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const today = jstTodayDateOnly();
      let dueOnFrom: string | null = null;
      let dueOnTo: string | null = null;
      let dueOnIsNull: boolean | null = null;
      if (filter.data.scope === "today") {
        dueOnFrom = today;
        dueOnTo = today;
      } else if (filter.data.scope === "week") {
        const week = jstWeekRange();
        dueOnFrom = week.from;
        dueOnTo = week.to;
      } else if (filter.data.scope === "no_due") {
        dueOnIsNull = true;
      } else if (filter.data.scope === "overdue") {
        dueOnTo = dateOnlyMinusOneDay(today);
        dueOnIsNull = false;
      }

      const page = await listTasksPage(
        supabase,
        { status: filter.data.status, dueOnFrom, dueOnTo, dueOnIsNull },
        pagination.data,
      );
      if (!page.ok) return page;
      const items = await enrichTaskListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  // #44 (crm 画面) で追加した契約外拡張。顧客/案件詳細ページの open タスクリスト用 (01-crm.md §8.2/§8.3)。
  async listTasksByCustomer(customerId, rawPagination) {
    try {
      const parsedId = z.string().uuid().safeParse(customerId);
      if (!parsedId.success) return { ok: false, code: "KMB-E101", detail: parsedId.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listTasksPage(
        supabase,
        { status: "open", dueOnFrom: null, dueOnTo: null, dueOnIsNull: null, customerId: parsedId.data },
        pagination.data,
      );
      if (!page.ok) return page;
      const items = await enrichTaskListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listTasksByDeal(dealId, rawPagination) {
    try {
      const parsedId = z.string().uuid().safeParse(dealId);
      if (!parsedId.success) return { ok: false, code: "KMB-E101", detail: parsedId.error.message };
      const pagination = zPagination.safeParse(rawPagination);
      if (!pagination.success) return { ok: false, code: "KMB-E101", detail: pagination.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const page = await listTasksPage(
        supabase,
        { status: "open", dueOnFrom: null, dueOnTo: null, dueOnIsNull: null, dealId: parsedId.data },
        pagination.data,
      );
      if (!page.ok) return page;
      const items = await enrichTaskListItems(supabase, page.value.items);
      if (!items.ok) return items;
      return { ok: true, value: { items: items.value, next_cursor: page.value.next_cursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getTaskRef(taskId) {
    try {
      const parsedId = z.string().uuid().safeParse(taskId);
      if (!parsedId.success) return { ok: false, code: "KMB-E101", detail: parsedId.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const row = await getTaskById(supabase, parsedId.data);
      if (!row.ok) return row;
      if (!row.value) return { ok: false, code: "KMB-E603" };
      return { ok: true, value: { task_id: row.value.id, status: row.value.status, updated_at: row.value.updated_at } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async updateTask(id, rawInput, expectedUpdatedAt) {
    try {
      const parsed = zTaskUpdateInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const existing = await getTaskById(supabase, id);
      if (!existing.ok) return existing;
      if (!existing.value) return { ok: false, code: "KMB-E603" };
      if (existing.value.status === "cancelled") return { ok: false, code: "KMB-E606" };
      if (parsed.data.deal_id !== null) {
        const deal = await getDealById(supabase, parsed.data.deal_id);
        if (!deal.ok) return deal;
        if (!deal.value) return { ok: false, code: "KMB-E603", detail: "指定の案件が見つかりません" };
      }
      if (parsed.data.customer_id !== null) {
        const customer = await getCustomerById(supabase, parsed.data.customer_id);
        if (!customer.ok) return customer;
        if (!customer.value) return { ok: false, code: "KMB-E603", detail: "指定の顧客が見つかりません" };
      }
      const updated = await updateTaskWithCas(supabase, id, parsed.data, expectedUpdatedAt);
      if (!updated.ok) return updated;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async cancelTask(id, expectedUpdatedAt) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const task = await getTaskById(supabase, id);
      if (!task.ok) return task;
      if (!task.value) return { ok: false, code: "KMB-E603" };
      const guard = canTransitionTaskStatus(task.value.status, "cancelled");
      if (guard.kind === "invalid") return { ok: false, code: "KMB-E606" };
      if (guard.kind === "noop") return { ok: true, value: undefined };
      const updated = await updateTaskWithCas(supabase, id, { status: "cancelled" }, expectedUpdatedAt);
      if (!updated.ok) return updated;
      const event = await appendActivityRow(
        supabase,
        {
          activity_type: "task_event",
          occurred_at: new Date().toISOString(),
          title: "やること取消",
          body: null,
          payload: { task_id: id, event: "cancelled", origin: task.value.origin },
          ref_table: null,
          ref_id: null,
        },
        user.id,
      );
      if (!event.ok) return event;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async reopenTask(id, expectedUpdatedAt) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const task = await getTaskById(supabase, id);
      if (!task.ok) return task;
      if (!task.value) return { ok: false, code: "KMB-E603" };
      const guard = canTransitionTaskStatus(task.value.status, "open");
      if (guard.kind === "invalid") return { ok: false, code: "KMB-E606" };
      if (guard.kind === "noop") return { ok: true, value: undefined };
      const updated = await updateTaskWithCas(supabase, id, { status: "open", completed_at: null }, expectedUpdatedAt);
      if (!updated.ok) return updated;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getDashboardKpi() {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const awaitingCount = await countDealsByStage(supabase, "inquiry");
      if (!awaitingCount.ok) return awaitingCount;

      const openAmounts = await listOpenDealAmounts(supabase);
      if (!openAmounts.ok) return openAmounts;

      const today = jstTodayDateOnly();
      const overdueCount = await countTasksInRange(supabase, "open", null, dateOnlyMinusOneDay(today));
      if (!overdueCount.ok) return overdueCount;

      const week = jstWeekRange();
      const weekCount = await countTasksInRange(supabase, "open", week.from, week.to);
      if (!weekCount.ok) return weekCount;

      const kpi: CrmDashboardKpi = {
        awaiting_lead_count: awaitingCount.value,
        weighted_pipeline_jpy: weightedPipelineJpy(openAmounts.value),
        overdue_task_count: overdueCount.value,
        week_open_task_count: weekCount.value,
      };
      return { ok: true, value: kpi };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async collectDigest(ctx) {
    try {
      const resolved = await resolveExecutionClient(ctx);
      if (!resolved.ok) return resolved;
      const { client } = resolved.value;

      const today = jstTodayDateOnly();
      const overdueRows = await listOpenTasksForDigest(client, null, dateOnlyMinusOneDay(today));
      if (!overdueRows.ok) return overdueRows;
      const todayRows = await listOpenTasksForDigest(client, today, today);
      if (!todayRows.ok) return todayRows;
      const awaitingDeals = await listAwaitingLeadDeals(client);
      if (!awaitingDeals.ok) return awaitingDeals;
      const dealItems = await enrichDealListItems(client, awaitingDeals.value);
      if (!dealItems.ok) return dealItems;

      const digest: CrmDigest = {
        generated_on: today,
        overdue_tasks: overdueRows.value.map((row) => toTaskListItem(row, row.deal, row.customer)),
        today_tasks: todayRows.value.map((row) => toTaskListItem(row, row.deal, row.customer)),
        awaiting_leads: dealItems.value,
        sales: null,
      };
      return { ok: true, value: digest };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async sendDailyDigest(digest, ctx) {
    try {
      return await sendCrmDigestEmail(digest, ctx);
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  // 契約外拡張 (01-crm.md §6.2 の変形 — scripts/crm-intake-inquiries.ts 専用)
  async intakeFromInquiryMigration(rawInput, opts) {
    try {
      const parsed = zIntakeFromInquiryInput.safeParse(rawInput);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const telE164 = parsed.data.contact.tel !== null ? normalizeJpPhoneToE164(parsed.data.contact.tel) : null;
      const email = parsed.data.contact.email;
      if (email === null && telE164 === null) return { ok: false, code: "KMB-E607" };

      const client = createSupabaseServiceClient();
      return await runIntakeSequence(
        client,
        {
          kind: "inquiry",
          inquiryId: parsed.data.inquiry_id,
          contact: { name: parsed.data.contact.name, email, telE164 },
          occurredAt: opts.occurredAt,
          inquiryType: parsed.data.inquiry_type,
          bodyExcerpt: parsed.data.body_excerpt,
        },
        { createDeal: opts.createDeal },
      );
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  // 契約外拡張 (01-crm.md §6.2 の変形 — scripts/crm-intake-inquiries.ts 専用)
  async hasIntakeMarker(inquiryId) {
    try {
      const client = createSupabaseServiceClient();
      const marker = await findActivityByTypeRef(client, "form_submission", "contact_inquiries", inquiryId);
      if (!marker.ok) return marker;
      return { ok: true, value: marker.value !== null };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
