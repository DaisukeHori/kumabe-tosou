import type { z } from "zod";

import { ACTIVITY_PAYLOAD_SCHEMAS, type ActivityType } from "../contracts";

const NOTE_TITLE_MAX = 60;
const NOTE_TITLE_FALLBACK = "メモ";

/**
 * note のタイトル自動生成 (01-crm.md §6.6 末尾)。本文 1 行目の先頭 60 字。
 * 「1 行目」は文字通り本文の最初の行 (空行/改行のみでも先頭行を採る — 空なら「メモ」)。
 */
export function deriveNoteTitle(body: string | null): string {
  if (body === null) return NOTE_TITLE_FALLBACK;
  const firstLine = body.split(/\r\n|\r|\n/)[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) return NOTE_TITLE_FALLBACK;
  return trimmed.length > NOTE_TITLE_MAX ? trimmed.slice(0, NOTE_TITLE_MAX) : trimmed;
}

export type ActivityPayloadParseResult<T extends ActivityType> =
  | { success: true; data: z.infer<(typeof ACTIVITY_PAYLOAD_SCHEMAS)[T]> }
  | { success: false; error: string };

/**
 * appendActivity の二段階 parse の内側 (01-crm.md §6.6 手順 3)。
 * ACTIVITY_PAYLOAD_SCHEMAS[activity_type] で payload (unknown) を parse する。失敗は KMB-E604。
 */
export function parseActivityPayload<T extends ActivityType>(
  activityType: T,
  payload: unknown,
): ActivityPayloadParseResult<T> {
  const schema = ACTIVITY_PAYLOAD_SCHEMAS[activityType];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, data: parsed.data as z.infer<(typeof ACTIVITY_PAYLOAD_SCHEMAS)[T]> };
}
