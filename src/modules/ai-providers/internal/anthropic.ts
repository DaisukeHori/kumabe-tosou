import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { WebSearchTool20260209 } from "@anthropic-ai/sdk/resources/messages";

import type { DetectedModel, TextUsage } from "../contracts";
import type { ProviderCallError, ProviderResult } from "./provider-error";

/**
 * Anthropic 呼び出し (canonical: docs/design/cms-ai-pipeline.md §7.2 の呼び出し規約を
 * ai-providers/internal に集約したもの)。
 * - thinking: adaptive を全呼び出しで固定 (既存 ai-studio の挙動を維持)。
 * - system が指定された場合は先頭ブロックに cache_control: ephemeral を付与。
 * - 全呼び出しが client.messages.stream() を使う (Vercel timeout 対策)。
 * - 画像生成 API は存在しない (models-discovery.md §2 の事実)。
 */

export type AnthropicMessage = { role: "user" | "assistant"; content: string };
export type AnthropicImageInput = { mimeType: string; dataBase64: string };

export type AnthropicTextParams = {
  apiKey: string;
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  images?: AnthropicImageInput[];
  maxTokens?: number;
  temperature?: number;
  responseSchema?: { name: string; schema: Record<string, unknown> };
  webSearch?: { maxUses: number };
  onDelta?: (delta: string) => void;
};

export type AnthropicTextSuccess = {
  text: string;
  usage: TextUsage;
  stopReason: string | null;
};

const DEFAULT_MAX_TOKENS = 16_000;

function toTextUsage(usage: Anthropic.Messages.Usage | null | undefined): TextUsage {
  // Anthropic の input_tokens は非キャッシュ分のみ (llm-usage-tracking.md §1) —
  // OpenAI/Gemini と異なり引き算不要でそのまま normalize できる。
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cachedInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteInputTokens: usage?.cache_creation_input_tokens ?? 0,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
  };
}

function retryAfterSeconds(err: unknown): number | null {
  if (err instanceof Anthropic.APIError && err.headers) {
    const raw = err.headers.get?.("retry-after");
    const seconds = raw ? Number(raw) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

function classifyError(err: unknown): ProviderCallError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (err instanceof Anthropic.RateLimitError || status === 429) {
      return { kind: "rate_limit", message: err.message, retryAfterSeconds: retryAfterSeconds(err) };
    }
    if (status === 401 || status === 403) {
      return { kind: "auth", message: err.message };
    }
    if (status === 404 || (status === 400 && /model/i.test(err.message))) {
      return { kind: "model_not_found", message: err.message };
    }
    if (typeof status === "number" && status >= 500) {
      return { kind: "network", message: err.message };
    }
    return { kind: "other", message: err.message };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: "network", message: err.message };
  }
  return { kind: "other", message: err instanceof Error ? err.message : String(err) };
}

function buildMessages(params: AnthropicTextParams): Anthropic.Messages.MessageParam[] {
  const imageBlocks: Anthropic.Messages.ImageBlockParam[] = (params.images ?? []).map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType as Anthropic.Messages.Base64ImageSource["media_type"], data: img.dataBase64 },
  }));

  return params.messages.map((m, i) => {
    // 画像は最初の user メッセージにのみ添付する (P1 移行時点で複数メッセージへの
    // 画像分散配置は使用しないため。vision 入力全般が使われるのは P2 のスクショ機能から)。
    const isFirstUser = i === params.messages.findIndex((mm) => mm.role === "user");
    if (isFirstUser && imageBlocks.length > 0) {
      return { role: m.role, content: [...imageBlocks, { type: "text", text: m.content }] };
    }
    return { role: m.role, content: m.content };
  });
}

async function callOnce(
  params: AnthropicTextParams,
): Promise<{ text: string; usage: Anthropic.Messages.Usage; stopReason: string | null }> {
  const client = new Anthropic({ apiKey: params.apiKey });
  const webSearchTool: WebSearchTool20260209 | null = params.webSearch
    ? { type: "web_search_20260209", name: "web_search", max_uses: params.webSearch.maxUses }
    : null;

  const stream = client.messages.stream({
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    thinking: { type: "adaptive" },
    ...(params.system
      ? { system: [{ type: "text" as const, text: params.system, cache_control: { type: "ephemeral" as const } }] }
      : {}),
    ...(params.responseSchema
      ? { output_config: { format: jsonSchemaOutputFormat(params.responseSchema.schema as never) } }
      : {}),
    ...(webSearchTool ? { tools: [webSearchTool] } : {}),
    messages: buildMessages(params),
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

/**
 * テキスト生成 1 回 (レート制限は Retry-After を尊重して 1 回だけ再試行、§1 の分類とは
 * 別に呼び出しレベルで実施)。
 *
 * 判断点: stop_reason==='refusal' は API 呼び出し自体は成功 (200 応答・usage も課金対象) の
 * ため ProviderCallError (キー起因の失敗) としては扱わず、成功 (ok:true) として
 * stopReason をそのまま返す。呼び出し元 (ai-studio 側) が stopReason==='refusal' を見て
 * KMB-E403 を判定する (旧 ai-studio/internal/claude.ts の runStructured と同じ判定点を
 * facade 境界の外側に移しただけで、判定ロジック自体は変えていない)。
 */
export async function callAnthropicText(params: AnthropicTextParams): Promise<ProviderResult<AnthropicTextSuccess>> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { text, usage, stopReason } = await callOnce(params);
      return { ok: true, value: { text, usage: toTextUsage(usage), stopReason } };
    } catch (err) {
      const classified = classifyError(err);
      if (classified.kind === "rate_limit" && attempt === 1) {
        const waitMs = (classified.retryAfterSeconds ?? 2) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      if (classified.kind === "network" && attempt === 1) {
        continue;
      }
      return { ok: false, error: classified };
    }
  }
}

/** GET /v1/models (models-discovery.md §2)。Anthropic は画像生成モデルが存在しないため kind は常に 'text' */
export async function listAnthropicModels(apiKey: string): Promise<ProviderResult<DetectedModel[]>> {
  try {
    const client = new Anthropic({ apiKey });
    const models: DetectedModel[] = [];
    for await (const model of client.models.list()) {
      models.push({ id: model.id, kind: "text", display: model.display_name ?? model.id });
    }
    return { ok: true, value: models };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}
