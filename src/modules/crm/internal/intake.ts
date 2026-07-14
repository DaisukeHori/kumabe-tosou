import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";

import { INQUIRY_TYPE_LABEL, type SimEstimateSnapshot } from "../contracts";
import {
  appendActivityRow,
  createCustomer as createCustomerRow,
  createDealIdempotentBySourceInquiry,
  createTaskRow,
  findActivityByTypeRef,
  findDealBySourceInquiry,
  getCustomerById,
  getDealById,
  linkActivityRow,
  listActivityLinksByActivity,
  resolveMergedCustomerIdSafe as terminalResolveCustomerId,
  updateCustomerWithCas,
  type ActivityLinkTarget,
} from "../repository";
import { resolveDuplicates } from "./dedup";
import { jstTomorrowDateOnly } from "./jst";

/**
 * リード取込の冪等シーケンス (01-crm.md §6.5)。facade の intakeFromInquiry/intakeFromSimulator
 * (常に service client) と scripts/crm-intake-inquiries.ts (script service client) の両方から
 * 呼ばれる共通実装。多テーブル書込だが supabase-js は TX を張れないため、各ステップを冪等にした
 * at-least-once シーケンスとして設計する (再呼び出し・二重クリックに耐える)。
 *
 * マージポインタの終端解決は repository.resolveMergedCustomerIdSafe (§6.3 手順 3 と同一ロジック) を
 * そのまま使う (facade.ts の getCustomerRef/getDealRef/appendActivity 等と同じ共通経路 — 本ファイルが
 * 独自の hop ループを再実装しない)。DB エラーはそのまま伝播する。
 */

export type ResolvedIntakeContact = {
  name: string;
  email: string | null;
  telE164: string | null;
};

export type IntakeCommonParams = {
  inquiryId: string;
  contact: ResolvedIntakeContact;
  /** 業務時刻 (問い合わせ送信時刻)。facade は now() を渡す。移行スクリプトは contact_inquiries.created_at を渡す (§12.1)。 */
  occurredAt: string;
};

export type IntakeFromInquiryParams = IntakeCommonParams & {
  kind: "inquiry";
  inquiryType: "construction" | "estimate" | "material" | "other";
  bodyExcerpt: string;
};

export type IntakeFromSimulatorParams = IntakeCommonParams & {
  kind: "simulator";
  estimate: SimEstimateSnapshot;
};

export type IntakeParams = IntakeFromInquiryParams | IntakeFromSimulatorParams;

export type IntakeOptions = {
  /**
   * false = 「deal なし取込」(§12.1 status='done' 移行行専用)。deal 作成・折り返しタスクの
   * 作成をスキップし、顧客解決後の lifecycle を直接 'customer' にする (過去完了案件を捏造しない)。
   * facade の intakeFromInquiry/intakeFromSimulator は常に true (省略時既定)。
   */
  createDeal?: boolean;
};

/**
 * 新規作成された行の記録 (scripts/crm-intake-inquiries.ts の seed_manifest 記録用 — §12.1 手順 2/4)。
 * 冪等ヒット (既存行の再利用) は含めない — created:true の行のみを積む。
 * 挿入順は customers を必ず先頭にする (deals.customer_id が on delete 句なし (NO ACTION) のため、
 * rollback-seed.ts の「id 降順 (=挿入の逆順) 削除」で customers が最後に削除される必要がある —
 * §12.1 前提タスク(c)。customers 以降 (deals/activities/activity_links/tasks) の相互順序は
 * 相互に参照する DB 制約が無いため任意 — 本実装は各エンティティの処理順そのまま (customer→
 * deal→activity→そのリンク...→task→task_event activity→そのリンク) で積む)。
 */
export type IntakeManifestEntry = { entity: "customers" | "deals" | "activities" | "activity_links" | "tasks"; ref_id: string };

export type IntakeResult = { customer_id: string; deal_id: string | null; manifest: IntakeManifestEntry[] };

function dealTitle(params: IntakeParams): string {
  if (params.kind === "simulator") return `シミュレーター見積 — ${params.contact.name}`;
  return `${INQUIRY_TYPE_LABEL[params.inquiryType]} — ${params.contact.name}`;
}

/**
 * §6.5 手順 2: 顧客解決。0 件=新規 lead 作成 / 1 件=既存採用 (手動 archived なら lead に戻す) /
 * 2 件以上=既存に寄せず新規 lead 作成 (system 'lead.intake.ambiguous' は呼び出し元が追記する)。
 * 戻り値: 解決した customer_id と、複数一致だったか (呼び出し元が system activity 要否判定に使う)。
 */
async function resolveIntakeCustomer(
  client: SupabaseClient,
  params: IntakeParams,
  createDealOption: boolean,
): Promise<
  Result<{
    customerId: string;
    customerCreated: boolean;
    ambiguousCandidateIds: string[] | null;
  }>
> {
  const dedup = await resolveDuplicates(client, params.contact.email, params.contact.telE164);
  if (!dedup.ok) return dedup;

  const source = params.kind === "simulator" ? "simulator" : "form";
  const lifecycle = createDealOption ? "lead" : "customer"; // §12.1: 「deal なし取込」は customer 直行

  if (dedup.value.kind === "none") {
    const created = await createCustomerRow(
      client,
      {
        kind: "person",
        name: params.contact.name,
        name_kana: null,
        email: params.contact.email,
        tel_e164: params.contact.telE164,
        company_id: null,
        address: null,
        notes: null,
        lifecycle,
        source,
      },
      null,
    );
    if (!created.ok) return created;
    return { ok: true, value: { customerId: created.value.id, customerCreated: true, ambiguousCandidateIds: null } };
  }

  if (dedup.value.kind === "single") {
    const candidate = dedup.value.candidate;
    if (candidate.lifecycle === "archived") {
      // 採用行が手動 archived なら lifecycle を 'lead' に戻す (再問い合わせ = 取引再開のシグナル)。
      const current = await getCustomerById(client, candidate.customer_id);
      if (!current.ok) return current;
      if (current.value) {
        const updated = await updateCustomerWithCas(
          client,
          candidate.customer_id,
          {
            kind: current.value.kind,
            name: current.value.name,
            name_kana: current.value.name_kana,
            email: current.value.email,
            tel_e164: current.value.tel_e164,
            company_id: current.value.company_id,
            address: current.value.address,
            notes: current.value.notes,
            lifecycle: "lead",
            custom_fields: current.value.custom_fields,
          },
          current.value.updated_at,
        );
        if (!updated.ok) return updated;
      }
    }
    return {
      ok: true,
      value: { customerId: candidate.customer_id, customerCreated: false, ambiguousCandidateIds: null },
    };
  }

  // dedup.value.kind === "multiple" — 既存に自動で寄せず新規 lead 作成
  const created = await createCustomerRow(
    client,
    {
      kind: "person",
      name: params.contact.name,
      name_kana: null,
      email: params.contact.email,
      tel_e164: params.contact.telE164,
      company_id: null,
      address: null,
      notes: null,
      lifecycle,
      source,
    },
    null,
  );
  if (!created.ok) return created;
  return {
    ok: true,
    value: {
      customerId: created.value.id,
      customerCreated: true,
      ambiguousCandidateIds: dedup.value.candidates.map((c) => c.customer_id),
    },
  };
}

/**
 * §6.5 手順 1 補修モード (a): links 逆引き → 欠損なら deals.source_inquiry_id 逆引き。
 * どちらも当たらなければ null を返し、呼び出し元が手順 2 (顧客解決) を実行する。
 */
async function repairResolveCustomerAndDeal(
  client: SupabaseClient,
  markerActivityId: string,
  inquiryId: string,
): Promise<Result<{ customerId: string | null; dealId: string | null }>> {
  const links = await listActivityLinksByActivity(client, markerActivityId);
  if (!links.ok) return links;

  const customerLink = links.value.find((l) => l.customer_id !== null);
  const dealLink = links.value.find((l) => l.deal_id !== null);

  let customerId: string | null = null;
  let dealId: string | null = dealLink ? dealLink.deal_id : null;

  if (customerLink && customerLink.customer_id) {
    const resolved = await terminalResolveCustomerId(client, customerLink.customer_id);
    if (!resolved.ok) return resolved;
    customerId = resolved.value;
  }

  if (dealId === null) {
    const found = await findDealBySourceInquiry(client, inquiryId);
    if (!found.ok) return found;
    if (found.value) {
      dealId = found.value.deal_id;
      if (customerId === null) {
        const deal = await getDealById(client, dealId);
        if (!deal.ok) return deal;
        if (deal.value) {
          const resolved = await terminalResolveCustomerId(client, deal.value.customer_id);
          if (!resolved.ok) return resolved;
          customerId = resolved.value;
        }
      }
    }
  }

  return { ok: true, value: { customerId, dealId } };
}

/**
 * リード取込の冪等シーケンス本体 (§6.5 全文)。
 */
export async function runIntakeSequence(
  client: SupabaseClient,
  params: IntakeParams,
  opts: IntakeOptions = {},
): Promise<Result<IntakeResult>> {
  const createDealOption = opts.createDeal ?? true;

  // scripts/crm-intake-inquiries.ts の seed_manifest 記録用 (§12.1 手順 2)。冪等ヒット
  // (既存行の再利用) は積まない — 本呼び出しで実際に新規作成された行のみ。customers を必ず
  // 先頭に積む (IntakeManifestEntry のコメント参照 — deals.customer_id の FK 整合)。
  const manifest: IntakeManifestEntry[] = [];

  // 手順 1: 冪等マーカー確認
  const marker = await findActivityByTypeRef(client, "form_submission", "contact_inquiries", params.inquiryId);
  if (!marker.ok) return marker;

  let customerId: string | null = null;
  let dealId: string | null = null;
  let ambiguousCandidateIds: string[] | null = null;

  if (marker.value !== null) {
    // 補修モード: (a) customer/deal の再解決
    const repaired = await repairResolveCustomerAndDeal(client, marker.value.id, params.inquiryId);
    if (!repaired.ok) return repaired;
    customerId = repaired.value.customerId;
    dealId = repaired.value.dealId;

    if (customerId === null) {
      // customer も未解決なら手順 2 の顧客解決を実行
      const resolved = await resolveIntakeCustomer(client, params, createDealOption);
      if (!resolved.ok) return resolved;
      customerId = resolved.value.customerId;
      ambiguousCandidateIds = resolved.value.ambiguousCandidateIds;
      if (resolved.value.customerCreated) manifest.push({ entity: "customers", ref_id: customerId });
    }

    if (dealId === null && createDealOption) {
      // (b) deal がどこにも無い場合、解決済み customer で手順 3 から deal を新規作成する
      const dealCreated = await createDealIdempotentBySourceInquiry(
        client,
        {
          title: dealTitle(params),
          customer_id: customerId,
          company_id: null,
          stage: "inquiry",
          amount_jpy:
            params.kind === "simulator"
              ? params.estimate.quote_only
                ? null
                : params.estimate.total_max
              : null,
          expected_close_on: null,
          source: params.kind === "simulator" ? "simulator" : "form",
          source_inquiry_id: params.inquiryId,
          notes: null,
        },
        null,
      );
      if (!dealCreated.ok) return dealCreated;
      dealId = dealCreated.value.row.id;
      if (dealCreated.value.created) manifest.push({ entity: "deals", ref_id: dealId });
    }
  } else {
    // 通常モード: 手順 2 から
    const resolved = await resolveIntakeCustomer(client, params, createDealOption);
    if (!resolved.ok) return resolved;
    customerId = resolved.value.customerId;
    ambiguousCandidateIds = resolved.value.ambiguousCandidateIds;
    if (resolved.value.customerCreated) manifest.push({ entity: "customers", ref_id: customerId });

    if (createDealOption) {
      const dealCreated = await createDealIdempotentBySourceInquiry(
        client,
        {
          title: dealTitle(params),
          customer_id: customerId,
          company_id: null,
          stage: "inquiry",
          amount_jpy:
            params.kind === "simulator"
              ? params.estimate.quote_only
                ? null
                : params.estimate.total_max
              : null,
          expected_close_on: null,
          source: params.kind === "simulator" ? "simulator" : "form",
          source_inquiry_id: params.inquiryId,
          notes: null,
        },
        null,
      );
      if (!dealCreated.ok) return dealCreated;
      dealId = dealCreated.value.row.id;
      if (dealCreated.value.created) manifest.push({ entity: "deals", ref_id: dealId });
    }
  }

  if (customerId === null) {
    // 構造上到達しない (上記の全分岐が customerId を解決してから抜ける) — 型ガード用の防御。
    return { ok: false, code: "KMB-E901", detail: "内部エラー: 顧客解決に失敗しました" };
  }

  // 手順 4: activity 追記 (冪等 — created:false でも links は必ず補完される)
  const links: ActivityLinkTarget[] = [{ customer_id: customerId, company_id: null, deal_id: null }];
  if (dealId !== null) links.push({ customer_id: null, company_id: null, deal_id: dealId });

  // form_submission の inquiry_type/excerpt: simulator kind は zIntakeFromSimulatorInput に
  // inquiry_type/body_excerpt を持たない (06-simulator 側の未確定点 — オーケストレーターへ報告済み)。
  // simulator 由来の相談は意味論的に「見積もり相談」に固定し、excerpt は見積スナップショットの要約とする。
  const formSubmissionInquiryType = params.kind === "simulator" ? "estimate" : params.inquiryType;
  const formSubmissionExcerpt =
    params.kind === "simulator"
      ? `シミュレーター見積: ${params.estimate.grade_label} / ${params.estimate.size_label} / 数量${params.estimate.quantity}`.slice(0, 300)
      : params.bodyExcerpt;

  const appended = await appendActivityRow(
    client,
    {
      activity_type: "form_submission",
      occurred_at: params.occurredAt,
      title: `${INQUIRY_TYPE_LABEL[formSubmissionInquiryType]} — ${params.contact.name}`,
      body: null,
      payload: {
        inquiry_id: params.inquiryId,
        inquiry_type: formSubmissionInquiryType,
        excerpt: formSubmissionExcerpt,
      },
      ref_table: "contact_inquiries",
      ref_id: params.inquiryId,
    },
    null,
  );
  if (!appended.ok) return appended;
  if (appended.value.created) manifest.push({ entity: "activities", ref_id: appended.value.row.id });

  for (const link of links) {
    const linked = await linkActivityRow(client, appended.value.row.id, link as ActivityLinkTarget);
    if (!linked.ok) return linked;
    if (linked.value.created) manifest.push({ entity: "activity_links", ref_id: linked.value.row.id });
  }

  if (params.kind === "simulator") {
    const simAppended = await appendActivityRow(
      client,
      {
        activity_type: "simulator_estimate",
        occurred_at: params.occurredAt,
        title: `シミュレーター見積 — ${params.contact.name}`,
        body: null,
        payload: { estimate: params.estimate, price_note: null },
        ref_table: "contact_inquiries",
        ref_id: params.inquiryId,
      },
      null,
    );
    if (!simAppended.ok) return simAppended;
    if (simAppended.value.created) manifest.push({ entity: "activities", ref_id: simAppended.value.row.id });
    for (const link of links) {
      const linked = await linkActivityRow(client, simAppended.value.row.id, link as ActivityLinkTarget);
      if (!linked.ok) return linked;
      if (linked.value.created) manifest.push({ entity: "activity_links", ref_id: linked.value.row.id });
    }
  }

  if (ambiguousCandidateIds !== null) {
    const sysAppended = await appendActivityRow(
      client,
      {
        activity_type: "system",
        occurred_at: params.occurredAt,
        title: "重複候補あり (要確認)",
        body: null,
        payload: {
          code: "lead.intake.ambiguous",
          detail: `候補: ${ambiguousCandidateIds.join(", ")}`,
        },
        ref_table: "contact_inquiries",
        ref_id: params.inquiryId,
      },
      null,
    );
    if (!sysAppended.ok) return sysAppended;
    if (sysAppended.value.created) manifest.push({ entity: "activities", ref_id: sysAppended.value.row.id });
    for (const link of links) {
      const linked = await linkActivityRow(client, sysAppended.value.row.id, link as ActivityLinkTarget);
      if (!linked.ok) return linked;
      if (linked.value.created) manifest.push({ entity: "activity_links", ref_id: linked.value.row.id });
    }
  }

  // 手順 5: 折り返しタスク (createDealOption のときのみ — §12.1 「deal なし取込」は作らない)
  if (createDealOption) {
    const taskCreated = await createTaskRow(
      client,
      {
        title: `折り返し連絡: ${params.contact.name} (${INQUIRY_TYPE_LABEL[formSubmissionInquiryType]})`,
        body: null,
        due_on: jstTomorrowDateOnly(new Date(params.occurredAt)),
        deal_id: dealId,
        customer_id: customerId,
        origin: "form",
        source_activity_id: appended.value.row.id,
      },
      null,
    );
    if (!taskCreated.ok) return taskCreated;
    if (taskCreated.value.created) manifest.push({ entity: "tasks", ref_id: taskCreated.value.row.id });

    const taskEvent = await appendActivityRow(
      client,
      {
        activity_type: "task_event",
        occurred_at: params.occurredAt,
        title: "やること作成",
        body: null,
        payload: { task_id: taskCreated.value.row.id, event: "created", origin: "form" },
        ref_table: "tasks",
        ref_id: taskCreated.value.row.id,
      },
      null,
    );
    if (!taskEvent.ok) return taskEvent;
    if (taskEvent.value.created) manifest.push({ entity: "activities", ref_id: taskEvent.value.row.id });
    if (customerId !== null) {
      const linked = await linkActivityRow(client, taskEvent.value.row.id, {
        customer_id: customerId,
        company_id: null,
        deal_id: null,
      });
      if (!linked.ok) return linked;
      if (linked.value.created) manifest.push({ entity: "activity_links", ref_id: linked.value.row.id });
    }
    if (dealId !== null) {
      const linked = await linkActivityRow(client, taskEvent.value.row.id, {
        customer_id: null,
        company_id: null,
        deal_id: dealId,
      });
      if (!linked.ok) return linked;
      if (linked.value.created) manifest.push({ entity: "activity_links", ref_id: linked.value.row.id });
    }
  }

  // 手順 6
  return { ok: true, value: { customer_id: customerId, deal_id: dealId, manifest } };
}
