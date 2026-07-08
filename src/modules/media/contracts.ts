import { z } from "zod";

/**
 * canonical: docs/module-contracts.md §4.8 (media 分) + §4.9 (media 分)
 */

export const zMediaPatch = z
  .object({
    alt: z.string().max(200),
    tags: z.array(z.string().max(30)).max(10),
    is_placeholder: z.boolean(),
  })
  .partial()
  .strict();
export type MediaPatch = z.infer<typeof zMediaPatch>;

/** 読み取りビュー型 (DB 出力の正しさは repository + DDL が保証) */
export type MediaItem = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  tags: string[];
  is_placeholder: boolean;
};
