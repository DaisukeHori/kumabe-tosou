import { z } from "zod";

import { zShortText } from "@/modules/platform/contracts";

/**
 * canonical: docs/module-contracts.md §4.8 (pricing 分) + §4.9 (pricing 分)
 */

export const zPriceGradeInput = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,30}$/),
    label: zShortText(30),
    base_price: z.number().int().min(0).max(10_000_000),
    description: z.string().max(300),
    sort_order: z.number().int().min(0).max(9999),
    is_active: z.boolean(),
  })
  .strict();
export type PriceGradeInput = z.infer<typeof zPriceGradeInput>;

/** price_options.kind (DDL の check 制約と 1:1)。contracts-ddl-parity.test.ts の比較対象 */
export const zPriceOptionKind = z.enum(["multiplier", "fixed"]);

export const zPriceOptionInput = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,30}$/),
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
    quantity: z.number().int().min(1).max(999),
    option_keys: z.array(z.string()).max(10),
  })
  .strict();
export type EstimateInput = z.infer<typeof zEstimateInput>;

export const zEstimateResult = z
  .object({
    total: z.number().int().min(0),
    breakdown: z.array(z.object({ label: z.string(), amount: z.number().int() })),
  })
  .strict();
export type EstimateResult = z.infer<typeof zEstimateResult>;

// ---- §4.9 facade 補助型 (pricing 分) ----

/** 読み取りビュー型 (DB 出力の正しさは repository + DDL が保証) */
export type PriceGrade = {
  id: string;
  key: string;
  label: string;
  base_price: number;
  description: string;
  sort_order: number;
  is_active: boolean;
};

export type PriceOption = {
  id: string;
  key: string;
  label: string;
  kind: "multiplier" | "fixed";
  value: number;
  sort_order: number;
  is_active: boolean;
};

export type PriceTable = { grades: PriceGrade[]; options: PriceOption[] };
