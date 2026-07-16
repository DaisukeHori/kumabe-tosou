"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { platformFacade } from "@/modules/platform/facade";
import type { Result } from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164, normalizePostalCode7 } from "@/modules/platform/text";
import { crmFacade } from "@/modules/crm/facade";
import {
  zCompanyInput,
  zCompanyUpdateInput,
  zCustomerInput,
  zCustomerLifecycle,
  zCustomerUpdateInput,
  zMergeCustomersInput,
  type CompanyInput,
  type CompanyUpdateInput,
  type CustomerInput,
  type CustomerLifecycle,
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

/**
 * zCustomerUpdateInput の検証失敗を Result.detail 文字列へ変換する。
 * custom_fields 関連の検証エラー (zod v4 の ZodError#message は issues の JSON.stringify —
 * 生の英語 JSON がそのまま UI に出てしまう) は、issue #98 で約束していた日本語ガイダンスへ
 * 変換する。CustomerEditSheet の collectCustomFields (クライアント側の件数/文字数/重複チェック)
 * をすり抜けた場合 (API 直叩き等) の保険。
 *
 * custom_fields 配下の issue には複数の形がある (path はいずれも先頭が "custom_fields"):
 *   - 配列全体の too_big (51 件以上、path=["custom_fields"] のみ、origin="array")
 *     → 「項目が多すぎます」
 *   - 個別行の label/value の too_small・too_big (path=["custom_fields", idx, "label"|"value"])
 *   - 重複ラベルの custom (.refine() 由来、path=["custom_fields"])
 *     → いずれも件数の話ではないため汎用メッセージにフォールバックする
 * custom_fields 以外のバリデーションエラー (名前必須等) は従来通り error.message のまま。
 */
function customerUpdateErrorDetail(error: z.ZodError): string {
  const customFieldIssues = error.issues.filter((issue) => issue.path[0] === "custom_fields");
  if (customFieldIssues.length > 0) {
    const isArrayLevelTooBig = customFieldIssues.some(
      (issue) => issue.code === "too_big" && issue.path.length === 1,
    );
    if (isArrayLevelTooBig) return "項目が多すぎます。不要な行を削除してください。";
    return "入力内容を確認してください(項目名は30文字以内、値は300文字以内、項目名の重複不可)。";
  }

  // billing_info / shipping_info 配下の検証失敗も日本語ガイダンスへ変換する (custom_fields と同型 —
  // クライアント側 collectAddressBlock をすり抜けた保険経路。zod v4 の生 JSON 露出を防ぐ)。
  // path[0] が "billing_info" / "shipping_info" のいずれか、leaf の項目名で文言を分岐する。
  const addressIssue = error.issues.find(
    (issue) => issue.path[0] === "billing_info" || issue.path[0] === "shipping_info",
  );
  if (addressIssue) {
    const label = addressIssue.path[0] === "billing_info" ? "請求先" : "配送先";
    const related = error.issues.filter((i) => i.path[0] === addressIssue.path[0]);
    const has = (field: string) => related.some((i) => i.path.includes(field));
    if (has("postal_code")) return `${label}の郵便番号は7桁の数字で入力してください (KMB-E610)。`;
    if (has("name")) return `${label}の名前は80文字以内で入力してください。`;
    if (has("address")) return `${label}の住所は190文字以内で入力してください。`;
    // 到達不能: address block の tel_raw は updateCustomerAction が normalizeAddressBlock
    // (normalizeTelOrNull) で先に E101 を返すため、不正 tel が tel_e164 として zod まで伝播しない。
    // 防御的に残す (将来 normalize 経路が変わっても生 ZodError を露出させないため)。
    if (has("tel_e164")) return `${label}の電話番号の形式が正しくありません。`;
    if (has("suffix")) return `${label}の敬称は「様」または「御中」を選択してください。`;
    return `${label}の宛先情報を確認してください。`;
  }

  return error.message;
}

/** 請求先/配送先ブロックのフォーム入力 (01-crm.md §8.2)。tel_raw は生入力 (server で正規化)。 */
export type AddressBlockFormInput = {
  postal_code: string | null;
  address: string | null;
  tel_raw: string | null;
  name: string | null;
  suffix: "様" | "御中" | null;
};

/** normalizeAddressBlock の戻り値 (CustomerAddressBlock と構造同型 — zod parse に渡す前段)。 */
type NormalizedAddressBlock = {
  postal_code: string | null;
  address: string | null;
  tel_e164: string | null;
  name: string | null;
  suffix: "様" | "御中" | null;
};

/**
 * 請求先/配送先ブロックのサーバー側正規化 (01-crm.md §8.2 手順): (a) trim、(b) tel_raw →
 * normalizeTelOrNull (失敗時はブロック別ラベル付きで早期リターン)、(c) postal_code →
 * normalizePostalCode7 (正規化不能かつ非空なら raw を残し zod に E610 を報告させる)、
 * (d) 全フィールド null なら ブロックごと null。
 */
function normalizeAddressBlock(
  block: AddressBlockFormInput | null,
  telErrorDetail: string,
): { ok: true; value: NormalizedAddressBlock | null } | { ok: false; detail: string } {
  if (block === null) return { ok: true, value: null };

  const name = block.name?.trim() ? block.name.trim() : null;
  const address = block.address?.trim() ? block.address.trim() : null;
  const suffix = block.suffix ?? null;
  const postalRaw = block.postal_code?.trim() ?? "";
  const postal_code = postalRaw === "" ? null : (normalizePostalCode7(postalRaw) ?? postalRaw);

  const tel = normalizeTelOrNull(block.tel_raw);
  if (!tel.ok) return { ok: false, detail: telErrorDetail };
  const tel_e164 = tel.value;

  if (name === null && address === null && suffix === null && postal_code === null && tel_e164 === null) {
    return { ok: true, value: null };
  }
  return { ok: true, value: { postal_code, address, tel_e164, name, suffix } };
}

export type CustomerFormInput = Omit<CustomerInput, "tel_e164"> & { tel_raw: string | null };
export type CustomerUpdateFormInput = Omit<CustomerUpdateInput, "tel_e164" | "billing_info" | "shipping_info"> & {
  tel_raw: string | null;
  billing_info: AddressBlockFormInput | null;
  shipping_info: AddressBlockFormInput | null;
};
export type CompanyFormInput = Omit<CompanyInput, "tel_e164"> & { tel_raw: string | null };
export type CompanyUpdateFormInput = Omit<CompanyUpdateInput, "tel_e164"> & { tel_raw: string | null };

/**
 * 郵便番号 → 住所の自動補完プロキシ (01-crm.md §7.1 — zipcloud、無料・登録不要)。
 * 乗換点を 1 箇所に隔離する。保存経路とは独立 (検索失敗でも住所手入力で保存は常に成立)。
 * 手順: requireAdmin → normalizePostalCode7 (不能なら E610) → zipcloud fetch (5s timeout) →
 * status≠200 / results=null / throw / timeout は E611 → results[0] の address1+2+3 連結を返す。
 */
export async function lookupPostalAddressAction(postalRaw: string): Promise<Result<{ address: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const pc = normalizePostalCode7(postalRaw);
  if (pc === null) return { ok: false, code: "KMB-E610" };

  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${pc}`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.status !== 200) return { ok: false, code: "KMB-E611" };
    const json: unknown = await res.json();
    const results = (json as { results?: unknown }).results;
    if (!Array.isArray(results) || results.length === 0) return { ok: false, code: "KMB-E611" };
    const first = results[0] as { address1?: unknown; address2?: unknown; address3?: unknown };
    const part = (v: unknown) => (typeof v === "string" ? v : "");
    const address = `${part(first.address1)}${part(first.address2)}${part(first.address3)}`;
    if (address === "") return { ok: false, code: "KMB-E611" };
    return { ok: true, value: { address } };
  } catch {
    return { ok: false, code: "KMB-E611" };
  }
}

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

  const { tel_raw, billing_info, shipping_info, ...rest } = input;
  const tel = normalizeTelOrNull(tel_raw);
  // 請求先/配送先のラベル付き文言 (下記) と揃え、基本連絡先であることを明示する。
  if (!tel.ok) return { ok: false, code: "KMB-E101", detail: "基本連絡先の電話番号の形式が正しくありません。" };

  const billing = normalizeAddressBlock(billing_info, "請求先の電話番号の形式が正しくありません。");
  if (!billing.ok) return { ok: false, code: "KMB-E101", detail: billing.detail };
  const shipping = normalizeAddressBlock(shipping_info, "配送先の電話番号の形式が正しくありません。");
  if (!shipping.ok) return { ok: false, code: "KMB-E101", detail: shipping.detail };

  const parsed = zCustomerUpdateInput.safeParse({
    ...rest,
    tel_e164: tel.value,
    billing_info: billing.value,
    shipping_info: shipping.value,
  });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: customerUpdateErrorDetail(parsed.error) };

  const result = await crmFacade.updateCustomer(id, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${id}`);
  return result;
}

/**
 * 顧客カンバン (#99) の DnD / Shift+←→ 専用。updateCustomerAction (zCustomerUpdateInput 全項目必須)
 * とは別に lifecycle 1 カラムのみを送る — 他フィールドをカード側の手元の古い値で再送してしまうのを
 * 避けるため (crmFacade.updateCustomerLifecycle のコメント参照)。
 */
export async function updateCustomerLifecycleAction(
  id: string,
  lifecycle: CustomerLifecycle,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zCustomerLifecycle.safeParse(lifecycle);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.updateCustomerLifecycle(id, parsed.data, expectedUpdatedAt);
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
