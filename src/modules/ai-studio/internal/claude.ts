import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { WebSearchTool20260209 } from "@anthropic-ai/sdk/resources/messages";

import type { Channel, KmbErrorCode, Result } from "@/modules/platform/contracts";

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
 * Claude API 呼び出しの標準形 (canonical: docs/design/cms-ai-pipeline.md §7.2)。
 *
 * 規約:
 * - model: "claude-opus-4-8" (品質最優先、抽出のような軽処理も同一モデルで統一)。
 * - thinking: { type: "adaptive" }。budget_tokens は使わない。
 * - temperature / top_p / top_k は送らない。
 * - structured outputs は output_config.format (zod v4 ネイティブ toJSONSchema から
 *   生成。zod-to-json-schema は zod v4 非互換のため internal/json-schema.ts 参照)。
 * - 全呼び出しが client.messages.stream() を使う (Vercel timeout 対策 + UX)。
 * - BRAND_SYSTEM_PROMPT は固定文字列 + cache_control: ephemeral (先頭ブロック)。
 * - エラー処理: RateLimitError → retry-after 尊重 1 回だけ再試行 / 5xx → KMB-E402 /
 *   それ以外の APIError → KMB-E401 / stop_reason==='refusal' → KMB-E403。
 */
const MODEL = "claude-opus-4-8" as const;
const MAX_TOKENS = 16_000;

let cachedClient: Anthropic | undefined;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が未設定です (AI スタジオは無効化されています)。");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/** ANTHROPIC_API_KEY が設定済みかどうか (graceful degradation 判定用) */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function toTokenUsage(usage: Anthropic.Messages.Usage | null | undefined): TokenUsage {
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
    web_search_requests: usage?.server_tool_use?.web_search_requests ?? 0,
  };
}

function mapClaudeError(err: unknown): { code: KmbErrorCode; detail: string } {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (err instanceof Anthropic.RateLimitError || (typeof status === "number" && status === 429)) {
      return { code: "KMB-E402", detail: `レート制限: ${err.message}` };
    }
    if (typeof status === "number" && status >= 500) {
      return { code: "KMB-E402", detail: err.message };
    }
    return { code: "KMB-E401", detail: err.message };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { code: "KMB-E402", detail: err.message };
  }
  return { code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
}

function retryAfterMs(err: unknown): number {
  if (err instanceof Anthropic.APIError && err.headers) {
    const raw = err.headers.get?.("retry-after");
    const seconds = raw ? Number(raw) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return 2000;
}

type StreamRunParams = {
  userPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK の AutoParseableOutputFormat は zod 型引数を伴う generic のため
  outputFormat: any;
  tools?: WebSearchTool20260209[];
  onDelta?: (delta: string) => void;
};

/**
 * streaming + structured outputs での 1 回の Claude 呼び出し。
 * RateLimitError は retry-after を尊重して 1 回だけ再試行する (§7.2)。
 */
async function streamOnce(
  params: StreamRunParams,
): Promise<{ text: string; usage: Anthropic.Messages.Usage; stopReason: string | null }> {
  const client = getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: BRAND_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    output_config: { format: params.outputFormat },
    ...(params.tools ? { tools: params.tools } : {}),
    messages: [{ role: "user", content: params.userPrompt }],
  });

  if (params.onDelta) {
    stream.on("text", (delta) => params.onDelta?.(delta));
  }

  const message = await stream.finalMessage();
  const text = message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { text, usage: message.usage, stopReason: message.stop_reason };
}

async function runStructured<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { message: string } } },
  params: StreamRunParams,
): Promise<Result<{ data: T; usage: TokenUsage }>> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { text, usage, stopReason } = await streamOnce(params);
      if (stopReason === "refusal") {
        return { ok: false, code: "KMB-E403" };
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
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

      return { ok: true, value: { data: parsed.data as T, usage: toTokenUsage(usage) } };
    } catch (err) {
      const mapped = mapClaudeError(err);
      const isRateLimited = err instanceof Anthropic.RateLimitError;
      if (isRateLimited && attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs(err)));
        continue;
      }
      return { ok: false, code: mapped.code, detail: mapped.detail };
    }
  }
}

/** stage 1.5: 整文 (raw_text → cleaned_text)。意味の追加・削除は禁止と system で明示済み。 */
export async function cleanTranscript(
  rawText: string,
): Promise<Result<{ data: CleanedTranscript; usage: TokenUsage }>> {
  return runStructured(zCleanedTranscript, {
    userPrompt: buildCleanUserPrompt(rawText),
    outputFormat: cleanedTranscriptOutputFormat(),
  });
}

/** stage 2: 要旨抽出 (cleaned_text → brief) */
export async function extractBrief(
  cleanedText: string,
): Promise<Result<{ data: Brief; usage: TokenUsage }>> {
  return runStructured(zBrief, {
    userPrompt: buildExtractUserPrompt(cleanedText),
    outputFormat: briefOutputFormat(),
  });
}

/**
 * stage 3: リサーチ (brief → research_notes)。server-side web_search_20260209 を
 * tools に宣言する (max_uses: 8、§7.2)。
 */
export async function researchBrief(
  brief: Brief,
): Promise<Result<{ data: ResearchNotes; usage: TokenUsage }>> {
  const webSearchTool: WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 8,
  };
  return runStructured(zResearchNotes, {
    userPrompt: buildResearchUserPrompt(brief),
    outputFormat: researchNotesOutputFormat(),
    tools: [webSearchTool],
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
    outputFormat: channelDraftOutputFormat(channel),
    onDelta,
  }) as Promise<Result<{ data: { content: ChannelContent[Channel]; claims: Claim[] }; usage: TokenUsage }>>;
}
