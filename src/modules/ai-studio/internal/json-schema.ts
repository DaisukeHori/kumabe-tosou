import { z } from "zod";

import {
  zBrief,
  zChannelDraftOutput,
  zCleanedTranscript,
  zResearchNotes,
  zSnsImagePromptOutput,
} from "../contracts";
import type { Channel } from "@/modules/platform/contracts";

/**
 * Claude structured outputs 用の JSON Schema 生成。
 * canonical 規約 (契約書 §3): 「schema は zod v4 ネイティブの `z.toJSONSchema()` で契約から
 * 生成、手書き禁止」(zod-to-json-schema は zod v4 非対応で空スキーマを生成することが
 * Wave2-E で実証済みのため、契約書 §3 の記述通りネイティブ実装を使う)。
 *
 * P1 移行 (ai-studio-v2.md §1 受入条件): 生成した JSON Schema を Anthropic 専用の
 * `output_config.format` オブジェクトに変換する処理 (旧 `jsonSchemaOutputFormat()` 呼び出し)は
 * ai-providers/internal/anthropic.ts に移した (`@anthropic-ai/sdk` の直 import は
 * ai-providers/internal のみ許可・ESLint no-restricted-imports で機械的強制)。
 * 本ファイルはプレーンな `{ name, schema }` (ai-providers の GenerateTextReq.responseSchema
 * 契約 — OpenAI の response_format.json_schema.name にも流用される汎用形) を返すに留める。
 */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    // Claude/OpenAI の json_schema フォーマットは $schema / 未対応キーワードを嫌うため、
    // 用途に不要なメタ情報は省く (target は draft-2020-12 のまま出力される)。
    io: "output",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function toResponseSchema(name: string, schema: z.ZodType): { name: string; schema: Record<string, unknown> } {
  return { name, schema: toJsonSchema(schema) };
}

/** stage 1.5 整文出力 (zCleanedTranscript) の responseSchema */
export function cleanedTranscriptOutputFormat() {
  return toResponseSchema("cleaned_transcript", zCleanedTranscript);
}

/** stage 2 要旨抽出出力 (zBrief) の responseSchema */
export function briefOutputFormat() {
  return toResponseSchema("brief", zBrief);
}

/** stage 3 リサーチ出力 (zResearchNotes) の responseSchema */
export function researchNotesOutputFormat() {
  return toResponseSchema("research_notes", zResearchNotes);
}

/** stage 4 チャネル別ドラフト出力 (zChannelDraftOutput(channel)) の responseSchema */
export function channelDraftOutputFormat(channel: Channel) {
  return toResponseSchema(`channel_draft_${channel}`, zChannelDraftOutput(channel));
}

/** P4: image_generation ステージの画像プロンプト起案出力 (zSnsImagePromptOutput) の responseSchema */
export function snsImagePromptOutputFormat() {
  return toResponseSchema("sns_image_prompt", zSnsImagePromptOutput);
}
