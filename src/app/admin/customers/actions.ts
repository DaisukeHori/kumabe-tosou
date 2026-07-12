"use server";

import { revalidatePath } from "next/cache";

import { platformFacade } from "@/modules/platform/facade";
import type { Result } from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164 } from "@/modules/platform/text";
import { crmFacade } from "@/modules/crm/facade";
import {
  zCompanyInput,
  zCompanyUpdateInput,
  zCustomerInput,
  zCustomerUpdateInput,
  zMergeCustomersInput,
  type CompanyInput,
  type CompanyUpdateInput,
  type CustomerInput,
  type CustomerUpdateInput,
  type MergeCustomersInput,
} from "@/modules/crm/contracts";

/**
 * /admin/customers の Server Actions (01-crm.md §7.1)。全 Action 先頭で requireAdmin() +
 * Zod parse を必須とする (src/app/admin/inquiries/actions.ts の既存パターンを踏襲)。
 *
 * 電話番号の正規化について: `zCustomerInput.tel_e164` / `zCompanyInput.tel_e164` は
 * 「入力は normalizeJpPhoneToE164() 済みを渡す」契約 (crm/contracts.ts コメント) —
 * フォーム入力は生の日本語表記 (例: "096-123-4567") のまま届くため、ここ (Server Action、
 * サーバー実行) で正規化してから Zod parse に渡す。`normalizeJpPhoneToE164` は
 * twitter-text (CJS, next.config.ts serverExternalPackages) に依存する platform/text.ts の
 * 関数のためクライアントコンポーネントから直接 import できない (バンドル対象外) — フォーム側は
 * 生文字列のまま Server Action に渡し、正規化は必ずサーバー側のこの関数群で行う。
 */
function normalizeTelOrNull(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw.trim() === "") return { ok: true, value: null };
  const normalized = normalizeJpPhoneToE164(raw);
  if (normalized === null) return { ok: false };
  return { ok: true, value: normalized };
}

export type CustomerFormInput = Omit<CustomerInput, "tel_e164"> & { tel_raw: string | null };
export type CustomerUpdateFormInput = Omit<CustomerUpdateInput, "tel_e164"> & { tel_raw: string | null };
export type CompanyFormInput = Omit<CompanyInput, "tel_e164"> & { tel_raw: string | null };
export type CompanyUpdateFormInput = Omit<CompanyUpdateInput, "tel_e164"> & { tel_raw: string | null };

export async function createCustomerAction(
  input: CustomerFormInput,
  force: boolean,
): Promise<Result<{ customer_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const { tel_raw, ...rest } = input;
  const tel = normalizeTelOrNull(tel_raw);
  if (!tel.ok) return { ok: false, code: "KMB-E101", detail: "電話番号の形式が正しくありません。" };

  const parsed = zCustomerInput.safeParse({ ...rest, tel_e164: tel.value });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.createCustomer(parsed.data, { force });
  if (!result.ok) return result;

  revalidatePath("/admin/customers");
  revalidatePath("/admin");
  return result;
}

export async function updateCustomerAction(
  id: string,
  input: CustomerUpdateFormInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const { tel_raw, ...rest } = input;
  const tel = normalizeTelOrNull(tel_raw);
  if (!tel.ok) return { ok: false, code: "KMB-E101", detail: "電話番号の形式が正しくありません。" };

  const parsed = zCustomerUpdateInput.safeParse({ ...rest, tel_e164: tel.value });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.updateCustomer(id, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${id}`);
  return result;
}

export async function mergeCustomersAction(
  input: MergeCustomersInput,
  expectedWinnerUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zMergeCustomersInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.mergeCustomers(parsed.data, expectedWinnerUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${parsed.data.winner_id}`);
  revalidatePath(`/admin/customers/${parsed.data.loser_id}`);
  return result;
}

export async function createCompanyAction(input: CompanyFormInput): Promise<Result<{ company_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const { tel_raw, ...rest } = input;
  const tel = normalizeTelOrNull(tel_raw);
  if (!tel.ok) return { ok: false, code: "KMB-E101", detail: "電話番号の形式が正しくありません。" };

  const parsed = zCompanyInput.safeParse({ ...rest, tel_e164: tel.value });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.createCompany(parsed.data);
  if (!result.ok) return result;

  revalidatePath("/admin/customers");
  return result;
}

export async function updateCompanyAction(
  id: string,
  input: CompanyUpdateFormInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const { tel_raw, ...rest } = input;
  const tel = normalizeTelOrNull(tel_raw);
  if (!tel.ok) return { ok: false, code: "KMB-E101", detail: "電話番号の形式が正しくありません。" };

  const parsed = zCompanyUpdateInput.safeParse({ ...rest, tel_e164: tel.value });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.updateCompany(id, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/customers");
  return result;
}
