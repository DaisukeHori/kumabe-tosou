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
 * 実装メモ (§7.2 との乖離。オーケストレーターへ報告済み): 設計書は
 * 「zod-to-json-schema で契約から生成」と指定するが、当該パッケージ (v3.25.2) は
 * zod v4 (本プロジェクト pinned ^4.4.3) の内部表現を解釈できず、実際に検証したところ
 * 空スキーマ ({}) しか返さないことを確認した (パッケージ自身の README も zod v4 は
 * 非サポートと明記)。そのため zod v4 ネイティブの `z.toJSONSchema()` +
 * `@anthropic-ai/sdk/helpers/json-schema` の `jsonSchemaOutputFormat()` を使う
 * (internal/json-schema.ts 参照)。本テストは「生成された JSON Schema が空でなく、
 * 契約の必須フィールドを正しく反映していること」を検証する。
 */
describe("ai-studio internal/json-schema (structured outputs 用 JSON Schema 生成)", () => {
  it("cleanedTranscriptOutputFormat: type='json_schema' で必須フィールドを含む", () => {
    const format = cleanedTranscriptOutputFormat();
    expect(format.type).toBe("json_schema");
    expect(typeof format.parse).toBe("function");
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

  it("parse() で結果 JSON を実際にパースできる (AutoParseableOutputFormat)", () => {
    const format = briefOutputFormat();
    const sample = {
      theme: "テスト",
      topics: ["a"],
      audience: "テスト読者",
      keywords: [],
      claims: [],
    };
    const parsed = format.parse(JSON.stringify(sample));
    expect(parsed).toEqual(sample);
  });
});
