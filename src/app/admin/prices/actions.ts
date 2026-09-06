"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";
import { zPricingReplaceInput, type PriceTable } from "@/modules/pricing/contracts";
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

export async function loadFullPriceTableAction(): Promise<Result<PriceTable>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const facade = createPricingFacade();
  return facade.getFullPriceTable();
}

const SECTION_LABELS: Record<string, string> = {
  grades: "グレード",
  sizes: "サイズ帯",
  matrix: "価格行列",
  tiers: "数量値引き",
  options: "オプション",
};

/** zod issue の path 先頭 (セクション名) を日本語ラベルに変換した detail 文字列を組み立てる。 */
function replaceIssuesToDetail(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => {
      const section = typeof i.path[0] === "string" ? SECTION_LABELS[i.path[0]] : undefined;
      const index = typeof i.path[1] === "number" ? ` #${i.path[1] + 1}` : "";
      return section ? `${section}${index}: ${i.message}` : i.message;
    })
    .join(", ");
}

/**
 * 価格表の一括保存。5 テーブル (grades/sizes/matrix/tiers/options) を facade.replaceAllPricing
 * (→ pricing_replace_all RPC、単一トランザクション) に 1 回で渡す。
 * 旧実装はテーブルごとに別々の facade メソッドを順に呼んでいたため、途中失敗で部分書き込みが
 * 残り、かつキャッシュ失効もされずに /shop に旧表が焼き付いた (レビュー指摘)。
 * RPC は原子的だが、DB 側で何が確定したかを Server Action からは断定できないため、
 * 失敗時も revalidateTag("prices") / revalidatePath("/shop") を必ず呼んで再取得させる。
 */
export async function savePricingAction(payload: PricingDraftPayload): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zPricingReplaceInput.safeParse({
    grades: payload.grades.map((g) => ({
      id: g.id,
      expected_updated_at: g.expected_updated_at,
      key: g.key,
      label: g.label,
      description: g.description,
      sort_order: g.sort_order,
      is_active: g.is_active,
    })),
    sizes: payload.sizes,
    matrix: payload.matrix,
    tiers: payload.tiers,
    options: payload.options.map((o) => ({
      id: o.id,
      key: o.key,
      label: o.label,
      kind: o.kind,
      value: o.value,
      sort_order: o.sort_order,
      is_active: o.is_active,
    })),
  });
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: replaceIssuesToDetail(parsed.error.issues) };
  }

  const facade = createPricingFacade();
  try {
    return await facade.replaceAllPricing(parsed.data);
  } finally {
    // 成否に関わらずキャッシュを失効させる (失敗時に旧表が焼き付く事故の防止)。
    revalidateTag("prices");
    revalidatePath("/shop");
    revalidatePath("/admin/prices");
  }
}
