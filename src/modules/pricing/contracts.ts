import { z } from "zod";

import { zShortText } from "@/modules/platform/contracts";

/**
 * canonical: docs/module-contracts.md §4.8 (pricing 分) + §4.9 (pricing 分)
 *
 * v2 (2026-07-08 改訂 — migration 20260708000007_pricing_v2 と 1:1)。
 * legacy の実価格構造 (グレード×サイズ行列、各セルが価格レンジ + 数量自動値引き +
 * 特急倍率 + XL は個別見積もり) は単一 base_price モデルでは表現できないと Wave 0 で
 * 判明したため、行列モデルへ再設計した。
 */

export const zPriceGradeInput = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,30}$/),
    label: zShortText(30),
    description: z.string().max(300), // base_price は v2 で廃止 (price_matrix に移行)
    sort_order: z.number().int().min(0).max(9999),
    is_active: z.boolean(),
  })
  .strict();
export type PriceGradeInput = z.infer<typeof zPriceGradeInput>;

export const zPriceSizeClassInput = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{1,10}$/), // 's' | 'm' | 'l' | 'xl'
    label: zShortText(30), // '〜120mm' 等
    max_mm: z.number().int().positive().nullable(), // null = 上限なし (xl = 個別見積もり)
    quote_only: z.boolean(), // true = 個別見積もり (金額を持たない)
    sort_order: z.number().int().min(0).max(9999),
  })
  .strict();
export type PriceSizeClassInput = z.infer<typeof zPriceSizeClassInput>;

export const zPriceMatrixCellInput = z
  .object({
    grade_key: z.string(),
    size_key: z.string(),
    price_min: z.number().int().min(0).max(10_000_000),
    price_max: z.number().int().min(0).max(10_000_000),
  })
  .strict()
  .refine((c) => c.price_max >= c.price_min, "price_max は price_min 以上");
export type PriceMatrixCellInput = z.infer<typeof zPriceMatrixCellInput>;

export const zQuantityTierInput = z
  .object({
    min_qty: z.number().int().min(2).max(9999),
    discount_rate: z.number().gt(0).lt(1), // 0.15 = 15%引き。quantity から自動適用
    label: zShortText(30), // '10個以上 -15%'
  })
  .strict();
export type QuantityTierInput = z.infer<typeof zQuantityTierInput>;

/** price_options.kind (DDL の check 制約と 1:1)。contracts-ddl-parity.test.ts の比較対象 */
export const zPriceOptionKind = z.enum(["multiplier", "fixed"]);

export const zPriceOptionInput = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,30}$/), // 'express' 等の任意選択オプション
    label: zShortText(30),
    kind: zPriceOptionKind,
    value: z.number().positive(),
    sort_order: z.number().int().min(0).max(9999),
    is_active: z.boolean(),
  })
  .strict()
  .refine(
    (o) =>
      o.kind === "multiplier"
        ? o.value <= 100
        : Number.isInteger(o.value) && o.value <= 1_000_000,
    "multiplier は 100 以下 / fixed は整数円 100 万以下",
  );
export type PriceOptionInput = z.infer<typeof zPriceOptionInput>;

export const zEstimateInput = z
  .object({
    grade_key: z.string(),
    size_key: z.string(),
    quantity: z.number().int().min(1).max(999),
    option_keys: z.array(z.string()).max(10), // 'express' 等。数量値引きは含めない (自動適用)
  })
  .strict();
export type EstimateInput = z.infer<typeof zEstimateInput>;

export const zEstimateResult = z
  .object({
    quote_only: z.boolean(), // true = 個別見積もり (total_min/max は 0)
    total_min: z.number().int().min(0),
    total_max: z.number().int().min(0),
    applied_tier: z.string().nullable(), // 自動適用された数量値引きの label
    breakdown: z.array(z.object({ label: z.string(), factor: z.string() })), // '×0.85' '+50%' 等の表示用
  })
  .strict();
export type EstimateResult = z.infer<typeof zEstimateResult>;

// ---- §4.9 facade 補助型 (pricing 分) ----

/**
 * 読み取りビュー型 (DB 出力の正しさは repository + DDL が保証)。
 *
 * updated_at は契約書 §4.9 の型定義に明記は無いが、price_grades/price_options の DDL
 * (supabase/migrations/20260708000001_init_schema.sql) には実在する列であり、
 * admin 画面 (/admin/prices) の楽観排他 (KMB-E103) に必須のため実装上追加する
 * (integration 実装時の最小追加。オーケストレーターへ報告済み)。
 */
export type PriceGrade = {
  id: string;
  key: string;
  label: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
};

export type PriceSizeClass = {
  key: string;
  label: string;
  max_mm: number | null;
  quote_only: boolean;
  sort_order: number;
};

export type PriceMatrixCell = {
  grade_key: string;
  size_key: string;
  price_min: number;
  price_max: number;
};

export type QuantityTier = {
  min_qty: number;
  discount_rate: number;
  label: string;
};

export type PriceOption = {
  id: string;
  key: string;
  label: string;
  kind: "multiplier" | "fixed";
  value: number;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
};

export type PriceTable = {
  grades: PriceGrade[];
  size_classes: PriceSizeClass[];
  matrix: PriceMatrixCell[];
  quantity_tiers: QuantityTier[];
  options: PriceOption[];
};
