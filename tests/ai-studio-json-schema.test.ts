import { describe, expect, it } from "vitest";

import {
  briefOutputFormat,
  channelDraftOutputFormat,
  cleanedTranscriptOutputFormat,
  researchNotesOutputFormat,
} from "@/modules/ai-studio/internal/json-schema";
import { zBrief, zChannelDraftOutput, zCleanedTranscript, zResearchNotes } from "@/modules/ai-studio/contracts";
import type { Channel } from "@/modules/platform/contracts";

/**
 * Claude structured outputs 用 JSON Schema 生成の単体テスト。
 *
 * 実装メモ (契約書 §3 との整合): zod v4 ネイティブの `z.toJSONSchema()` で契約から
 * JSON Schema を生成する (zod-to-json-schema は zod v4 非対応で空スキーマしか返さないことを
 * 実証済みのため不採用)。
 *
 * P1 移行 (ai-studio-v2.md §1 受入条件) での変更点: 生成した JSON Schema を Anthropic 専用の
 * `output_config.format` (jsonSchemaOutputFormat の戻り値、type='json_schema' + parse()) に
 * 変換する処理は ai-providers/internal/anthropic.ts に移した (`@anthropic-ai/sdk` の直 import は
 * ai-providers/internal のみ許可)。本ファイル (ai-studio 側) はプレーンな
 * `{ name, schema }` (ai-providers の GenerateTextReq.responseSchema 契約) を返すに留まるため、
 * 本テストはその形での検証に更新した (旧: format.type/format.parse を検証 → 新: format.name/format.schema)。
 */
describe("ai-studio internal/json-schema (structured outputs 用 JSON Schema 生成)", () => {
  it("cleanedTranscriptOutputFormat: name + 必須フィールドを含む schema を返す", () => {
    const format = cleanedTranscriptOutputFormat();
    expect(format.name).toBe("cleaned_transcript");
    const schema = format.schema as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(zCleanedTranscript.shape).sort(),
    );
    expect(schema.required).toEqual(expect.arrayContaining(["cleaned_text", "corrections", "meaning_preserved"]));
  });

  it("briefOutputFormat: zBrief の全フィールドを反映する", () => {
    const format = briefOutputFormat();
    const schema = format.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(zBrief.shape).sort());
  });

  it("researchNotesOutputFormat: zResearchNotes の全フィールドを反映する", () => {
    const format = researchNotesOutputFormat();
    const schema = format.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(zResearchNotes.shape).sort());
  });

  it("channelDraftOutputFormat: 4 チャネル全てで有効な (空でない) JSON Schema を生成する", () => {
    const channels: Channel[] = ["site_blog", "note", "x", "instagram"];
    for (const channel of channels) {
      const format = channelDraftOutputFormat(channel);
      expect(format.name).toBe(`channel_draft_${channel}`);
      const schema = format.schema as { type: string; properties: Record<string, unknown> };
      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties).sort()).toEqual(
        Object.keys(zChannelDraftOutput(channel).shape).sort(),
      );
      // 空スキーマ ({}) ではないこと (zod-to-json-schema の zod v4 非互換で
      // 発生した既知の不具合の再発防止)。
      expect(Object.keys(schema.properties).length).toBeGreaterThan(0);
    }
  });
});
