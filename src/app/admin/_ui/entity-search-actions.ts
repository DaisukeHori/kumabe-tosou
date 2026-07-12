"use server";

import { platformFacade } from "@/modules/platform/facade";
import { getErrorInfo } from "@/modules/platform/errors";
import { crmFacade } from "@/modules/crm/facade";

/**
 * `<EntityPicker>` (command ベースの汎用ピッカー — #44 計画書「顧客/会社/案件の command ピッカー、
 * 3 画面で使い回す」) が使う検索 Server Action 群。crm/facade の listCustomers/listCompanies/listDeals
 * を検索クエリのたびに叩く非同期方式 (計画書 §「entity-picker.tsx」注記: 全件ロードは不可)。
 *
 * 【地雷: エラー握り潰し禁止】検索失敗時に空配列だけを返すと「該当なし」と「取得失敗」が
 * UI 上で区別できず、通信/権限エラーが無言で「0 件」に化ける。`error` フィールドで
 * 明示的に失敗を伝播する (sentinel — Result 型そのものではないが同じ意図)。
 */
export type EntityPickerItem = { id: string; label: string; sublabel: string | null };
export type EntityPickerSearchResult = { items: EntityPickerItem[]; error: string | null };

async function requireAdminOrError(): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.detail ?? getErrorInfo(admin.code).message };
  return { ok: true };
}

export async function searchCustomersAction(q: string): Promise<EntityPickerSearchResult> {
  const admin = await requireAdminOrError();
  if (!admin.ok) return { items: [], error: admin.error };

  const trimmed = q.trim();
  const result = await crmFacade.listCustomers(
    { q: trimmed === "" ? null : trimmed, lifecycle: "all", include_merged: false },
    { cursor: null, limit: 20 },
  );
  if (!result.ok) return { items: [], error: result.detail ?? getErrorInfo(result.code).message };

  return {
    items: result.value.items.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: [c.company_name, c.tel_e164, c.email].filter((v): v is string => !!v).join(" / ") || null,
    })),
    error: null,
  };
}

export async function searchCompaniesAction(q: string): Promise<EntityPickerSearchResult> {
  const admin = await requireAdminOrError();
  if (!admin.ok) return { items: [], error: admin.error };

  const trimmed = q.trim();
  const result = await crmFacade.listCompanies({ q: trimmed === "" ? null : trimmed }, { cursor: null, limit: 20 });
  if (!result.ok) return { items: [], error: result.detail ?? getErrorInfo(result.code).message };

  return {
    items: result.value.items.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: c.tel_e164,
    })),
    error: null,
  };
}

export async function searchDealsAction(q: string): Promise<EntityPickerSearchResult> {
  const admin = await requireAdminOrError();
  if (!admin.ok) return { items: [], error: admin.error };

  const trimmed = q.trim();
  const result = await crmFacade.listDeals({ q: trimmed === "" ? null : trimmed, stage: "all" }, { cursor: null, limit: 20 });
  if (!result.ok) return { items: [], error: result.detail ?? getErrorInfo(result.code).message };

  return {
    items: result.value.items.map((d) => ({
      id: d.id,
      label: d.title,
      sublabel: d.customer_name,
    })),
    error: null,
  };
}
