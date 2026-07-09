import "server-only";

import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import type { TextUsage } from "@/modules/ai-providers/contracts";
import type { Channel, Result } from "@/modules/platform/contracts";

import {
  zBrief,
  zChannelDraftOutput,
  zCleanedTranscript,
  zResearchNotes,
  type Brief,
  type CleanedTranscript,
  type Claim,
  type ChannelContent,
  type ResearchNotes,
  type TokenUsage,
} from "../contracts";
import {
  briefOutputFormat,
  channelDraftOutputFormat,
  cleanedTranscriptOutputFormat,
  researchNotesOutputFormat,
} from "./json-schema";
import { BRAND_SYSTEM_PROMPT, buildCleanUserPrompt, buildDraftUserPrompt, buildExtractUserPrompt, buildResearchUserPrompt } from "./prompts";

/**
 * Claude 呼び出し (canonical: docs/design/cms-ai-pipeline.md §7.2)。
 *
 * P1 移行 (ai-studio-v2.md §1 受入条件・全量ルータ移行): 実際の API 呼び出し・
 * キー選択/フォールバック・usage 記録・予算ガードは ai-providers モジュール
 * (aiProvidersFacade.generateText, feature='studio') に移管した。
 * 本ファイルに残る責務は ai-studio 固有の関心事のみ:
 *   - Claude 固有の呼び出しパラメータの組み立て (system=BRAND_SYSTEM_PROMPT・
 *     thinking:adaptive・cache_control 等は ai-providers/internal/anthropic.ts が
 *     全呼び出し共通の規約として適用するためここでは指定しない)
 *   - 各 stage の構造化出力契約 (zBrief 等) の JSON Schema 化とユーザープロンプト組み立て
 *   - AI 出力の JSON.parse + Zod 検証 + KMB エラーコードへのマッピング (旧 runStructured の
 *     「呼び出し」部分だけを facade.generateText に置き換え、判定ロジック自体は不変)
 *
 * キー解決 (非retrogression): ai_provider_keys に anthropic キーの登録があればそれを、
 * 無ければ環境変数 ANTHROPIC_API_KEY を ai-providers/internal/router.ts がフォールバックする
 * (既存動作の非退行。env キー経由でも usage は記録される)。
 */
const MODEL = "claude-opus-4-8" as const;
const MAX_TOKENS = 16_000;

function toTokenUsage(usage: TextUsage): TokenUsage {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_input_tokens: usage.cachedInputTokens,
    cache_creation_input_tokens: usage.cacheWriteInputTokens,
    web_search_requests: usage.webSearchRequests,
  };
}

type StructuredCallParams = {
  userPrompt: string;
  responseSchema: { name: string; schema: Record<string, unknown> };
  webSearch?: { maxUses: number };
  onDelta?: (delta: string) => void;
};

async function runStructured<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { message: string } } },
  params: StructuredCallParams,
): Promise<Result<{ data: T; usage: TokenUsage }>> {
  const result = await aiProvidersFacade.generateText({
    model: MODEL,
    feature: "studio",
    system: BRAND_SYSTEM_PROMPT,
    messages: [{ role: "user", content: params.userPrompt }],
    maxTokens: MAX_TOKENS,
    responseSchema: params.responseSchema,
    webSearch: params.webSearch,
    onDelta: params.onDelta,
  });

  if (!result.ok) return result;

  // stop_reason==='refusal' は API 呼び出し自体は成功 (usage も課金対象) のため
  // ai-providers 側ではエラー扱いにしない (internal/anthropic.ts のコメント参照)。
  // ここで KMB-E403 に変換するのが旧 claude.ts と同じ判定点。
  if (result.value.stopReason === "refusal") {
    return { ok: false, code: "KMB-E403" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.value.text);
  } catch {
    return { ok: false, code: "KMB-E404", detail: "AI 出力が JSON として解析できませんでした" };
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E404",
      detail: parsed.error?.message ?? "AI 出力がスキーマ契約を満たしませんでした",
    };
  }

  return { ok: true, value: { data: parsed.data as T, usage: toTokenUsage(result.value.usage) } };
}

/** stage 1.5: 整文 (raw_text → cleaned_text)。意味の追加・削除は禁止と system で明示済み。 */
export async function cleanTranscript(
  rawText: string,
): Promise<Result<{ data: CleanedTranscript; usage: TokenUsage }>> {
  return runStructured(zCleanedTranscript, {
    userPrompt: buildCleanUserPrompt(rawText),
    responseSchema: cleanedTranscriptOutputFormat(),
  });
}

/** stage 2: 要旨抽出 (cleaned_text → brief) */
export async function extractBrief(
  cleanedText: string,
): Promise<Result<{ data: Brief; usage: TokenUsage }>> {
  return runStructured(zBrief, {
    userPrompt: buildExtractUserPrompt(cleanedText),
    responseSchema: briefOutputFormat(),
  });
}

/**
 * stage 3: リサーチ (brief → research_notes)。server-side web_search を
 * ai-providers 経由で有効化する (max_uses: 8、§7.2)。
 */
export async function researchBrief(
  brief: Brief,
): Promise<Result<{ data: ResearchNotes; usage: TokenUsage }>> {
  return runStructured(zResearchNotes, {
    userPrompt: buildResearchUserPrompt(brief),
    responseSchema: researchNotesOutputFormat(),
    webSearch: { maxUses: 8 },
  });
}

/** stage 4: チャネル別脚色。content と claims を同時出力させる (zChannelDraftOutput)。 */
export async function draftChannel(
  channel: Channel,
  brief: Brief,
  researchNotes: ResearchNotes | null,
  instruction: string | null,
  onDelta?: (delta: string) => void,
): Promise<Result<{ data: { content: ChannelContent[Channel]; claims: Claim[] }; usage: TokenUsage }>> {
  const schema = zChannelDraftOutput(channel);
  return runStructured(schema, {
    userPrompt: buildDraftUserPrompt(channel, brief, researchNotes, instruction),
    responseSchema: channelDraftOutputFormat(channel),
    onDelta,
  }) as Promise<Result<{ data: { content: ChannelContent[Channel]; claims: Claim[] }; usage: TokenUsage }>>;
}
