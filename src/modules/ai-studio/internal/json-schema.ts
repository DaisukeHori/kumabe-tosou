import { z } from "zod";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

import { zBrief, zChannelDraftOutput, zCleanedTranscript, zResearchNotes } from "../contracts";
import type { Channel } from "@/modules/platform/contracts";

/**
 * Claude structured outputs (`output_config.format`) 用の JSON Schema 生成。
 * canonical 規約 (設計書 §7.2): 「schema は zod-to-json-schema で契約から生成、手書き禁止」。
 *
 * 実装時の乖離 (オーケストレーターへ報告済み・検証済みの技術的事実):
 * `zod-to-json-schema` (package.json 記載の既存依存, v3.25.2) は zod v4 (本プロジェクトの
 * pinned version ^4.4.3) の内部表現を解釈できず、実際に検証したところ
 * `zodToJsonSchema(z.object({...}).strict())` が `{ "$schema": "...", "definitions": { "X": {} } }`
 * という**中身が空のスキーマ**を返すことを確認した (再現手順: node で smoke test 実施)。
 * 当該パッケージの README 自身も「2025-11 で保守終了、zod v4 は `z.toJSONSchema()` の
 * ネイティブ実装に移行を推奨、v3.25 系は zod v4 を peerDependency として許容するだけで
 * v4 の schema 自体はサポートしない (`import { z } from "zod/v3"` が必要)」と明記している。
 *
 * 空スキーマを Claude に渡すと structured outputs が実質無制約になり、契約による
 * 型安全性を失う (手書き回避の目的にも反する)。そのため本ファイルでは zod v4 ネイティブの
 * `z.toJSONSchema()` (同じく「契約から自動生成・手書きしない」という規約の精神を満たす)
 * を使う。契約書 §7.2 の「zod-to-json-schema」という文言との乖離は、
 * バージョン非互換という具体的根拠に基づく実装判断としてオーケストレーターに報告する。
 */
function toClaudeJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    // Claude の json_schema フォーマットは $schema / 未対応キーワードを嫌うため、
    // 用途に不要なメタ情報は省く (target は draft-2020-12 のまま出力される)。
    io: "output",
  }) as Record<string, unknown>;
  // Claude API 側でトップレベルの $schema は不要 (むしろ無視されるだけの冗長情報)。
  delete jsonSchema.$schema;
  return jsonSchema;
}

/**
 * `@anthropic-ai/sdk/helpers/json-schema` の `jsonSchemaOutputFormat()` で
 * `{ type: 'json_schema', schema, parse() }` (AutoParseableOutputFormat) を作る。
 * これを `output_config.format` にそのまま渡すと、`stream.finalMessage()` の
 * `parsed_output` が自動的に JSON.parse された値になる (§7.2 の
 * `output_config: { format: { type: "json_schema", schema } }` と構造的に一致)。
 * transform (既定 true) が Claude 側で扱いにくいキーワード (minLength 等) を
 * description 注記に変換してくれるため、そのまま利用する。
 */
function toOutputFormat(schema: z.ZodType) {
  const jsonSchema = toClaudeJsonSchema(schema);
  // 全ての契約スキーマは z.object(...).strict() のためトップレベルは常に
  // type:'object' になる (実行時に保証済み)。jsonSchemaOutputFormat() の型制約
  // (const Schema extends ... & {type:'object'}) はリテラル型向けのため、
  // 実行時生成のスキーマではこの cast が必要 (契約は Zod 側で担保されている)。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jsonSchemaOutputFormat(jsonSchema as any);
}

/** stage 1.5 整文出力 (zCleanedTranscript) の output_config.format */
export function cleanedTranscriptOutputFormat() {
  return toOutputFormat(zCleanedTranscript);
}

/** stage 2 要旨抽出出力 (zBrief) の output_config.format */
export function briefOutputFormat() {
  return toOutputFormat(zBrief);
}

/** stage 3 リサーチ出力 (zResearchNotes) の output_config.format */
export function researchNotesOutputFormat() {
  return toOutputFormat(zResearchNotes);
}

/** stage 4 チャネル別ドラフト出力 (zChannelDraftOutput(channel)) の output_config.format */
export function channelDraftOutputFormat(channel: Channel) {
  return toOutputFormat(zChannelDraftOutput(channel));
}
