"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";
import {
  zPriceGradeInput,
  zPriceMatrixCellInput,
  zPriceOptionInput,
  zPriceSizeClassInput,
  zQuantityTierInput,
  type PriceTable,
} from "@/modules/pricing/contracts";
import { createPricingFacade } from "@/modules/pricing/facade";

/**
 * /admin/prices の Server Actions。
 * 契約書 §3.5「全 Action の先頭で requireAdmin() + Zod parse を必須とする」に従い、
 * platformFacade.requireAdmin() を先頭で呼ぶ (settings/media/inquiries と同じ規約)。
 * モジュール境界の規則 (docs/module-contracts.md §2, ESLint no-restricted-imports) により
 * pricing/repository を直接 import できないため、必ず @/modules/pricing/facade 経由で書き込む。
 * 各行は canonical Zod (契約書 §4.8) で再検証してから facade へ渡す (「入力は Zod が唯一の正」)。
 */

export type AdminGradeRow = {
  id: string | null;
  expected_updated_at: string | null;
  key: string;
  label: string;
  description: string;
  sort_order: number;
  is_active: boolean;
};

export type AdminOptionRow = {
  id: string | null;
  key: string;
  label: string;
  kind: "multiplier" | "fixed";
  value: number;
  sort_order: number;
  is_active: boolean;
};

export type PricingDraftPayload = {
  grades: AdminGradeRow[];
  sizes: {
    key: string;
    label: string;
    max_mm: number | null;
    quote_only: boolean;
    sort_order: number;
  }[];
  matrix: { grade_key: string; size_key: string; price_min: number; price_max: number }[];
  tiers: { min_qty: number; discount_rate: number; label: string }[];
  options: AdminOptionRow[];
};

function issuesToDetail(issues: { message: string }[]): string {
  return issues.map((i) => i.message).join(", ");
}

export async function loadFullPriceTableAction(): Promise<Result<PriceTable>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const facade = createPricingFacade();
  return facade.getFullPriceTable();
}

export async function savePricingAction(payload: PricingDraftPayload): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const facade = createPricingFacade();

  // grades: 1 件ずつ楽観排他 (id + expected_updated_at) を伴って保存する。
  for (const grade of payload.grades) {
    const parsed = zPriceGradeInput.safeParse({
      key: grade.key,
      label: grade.label,
      description: grade.description,
      sort_order: grade.sort_order,
      is_active: grade.is_active,
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "KMB-E101",
        detail: `グレード (${grade.key}): ${issuesToDetail(parsed.error.issues)}`,
      };
    }
    const saved = await facade.savePriceGrade(parsed.data, grade.id, grade.expected_updated_at);
    if (!saved.ok) return saved;
  }

  // sizes / matrix / tiers: updated_at を持たないため全置換 upsert で可 (task 仕様通り)。
  const sizesParsed = zPriceSizeClassInput.array().safeParse(payload.sizes);
  if (!sizesParsed.success) {
    return { ok: false, code: "KMB-E101", detail: `サイズ帯: ${issuesToDetail(sizesParsed.error.issues)}` };
  }
  const sizesSaved = await facade.replacePriceSizeClasses(sizesParsed.data);
  if (!sizesSaved.ok) return sizesSaved;

  const matrixParsed = zPriceMatrixCellInput.array().safeParse(payload.matrix);
  if (!matrixParsed.success) {
    return { ok: false, code: "KMB-E101", detail: `価格行列: ${issuesToDetail(matrixParsed.error.issues)}` };
  }
  const matrixSaved = await facade.replacePriceMatrix(matrixParsed.data);
  if (!matrixSaved.ok) return matrixSaved;

  const tiersParsed = zQuantityTierInput.array().safeParse(payload.tiers);
  if (!tiersParsed.success) {
    return { ok: false, code: "KMB-E101", detail: `数量値引き: ${issuesToDetail(tiersParsed.error.issues)}` };
  }
  const tiersSaved = await facade.replacePriceQuantityTiers(tiersParsed.data);
  if (!tiersSaved.ok) return tiersSaved;

  // options: 現状は key の存在有無で upsert (grades と異なり明示的な楽観排他は課さない仕様)。
  for (const option of payload.options) {
    const parsed = zPriceOptionInput.safeParse({
      key: option.key,
      label: option.label,
      kind: option.kind,
      value: option.value,
      sort_order: option.sort_order,
      is_active: option.is_active,
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "KMB-E101",
        detail: `オプション (${option.key}): ${issuesToDetail(parsed.error.issues)}`,
      };
    }
    const saved = await facade.savePriceOption(parsed.data, option.id);
    if (!saved.ok) return saved;
  }

  revalidateTag("prices");
  revalidatePath("/shop");
  revalidatePath("/admin/prices");

  return { ok: true, value: undefined };
}
