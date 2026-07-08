import { z } from "zod";

import { zShortText } from "@/modules/platform/contracts";

/**
 * canonical: docs/module-contracts.md §4.8 (inquiry 分) + §4.9 (inquiry 分)
 * 公開フォーム (anon が触る唯一の書き込み入力)。
 */

export const zInquiryInput = z
  .object({
    name: zShortText(50),
    email: z.string().email().max(120),
    tel: z
      .string()
      .regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/)
      .nullable(),
    inquiry_type: z.enum(["construction", "estimate", "material", "other"]),
    item: z.string().max(100).nullable(),
    body: zShortText(5000).pipe(z.string().min(10)),
    privacy_agreed: z.literal(true), // 同意なし送信は型レベルで不可
  })
  .strict();
export type InquiryInput = z.infer<typeof zInquiryInput>;

export type InquiryStatus = "new" | "in_progress" | "done" | "spam";
