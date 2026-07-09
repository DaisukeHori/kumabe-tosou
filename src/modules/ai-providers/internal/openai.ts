import "server-only";

import OpenAI, { toFile } from "openai";

import type { DetectedModel, TextUsage } from "../contracts";
import type { ProviderCallError, ProviderResult } from "./provider-error";

/**
 * OpenAI 呼び出し (canonical: docs/research/ai-studio-v2/models-discovery.md §1,
 * openai-image.md, llm-usage-tracking.md §1)。
 */

export type OpenAiMessage = { role: "user" | "assistant"; content: string };
export type OpenAiImageInput = { mimeType: string; dataBase64: string };

export type OpenAiTextParams = {
  apiKey: string;
  model: string;
  system?: string;
  messages: OpenAiMessage[];
  images?: OpenAiImageInput[];
  maxTokens?: number;
  temperature?: number;
  responseSchema?: { name: string; schema: Record<string, unknown> };
};

export type OpenAiTextSuccess = { text: string; usage: TextUsage; stopReason: string | null };

/** 画像生成モデルの ID allowlist / プレフィックス判定 (models-discovery.md §1: API 側にメタデータが無いための必然) */
const IMAGE_MODEL_PREFIXES = ["gpt-image-", "dall-e-"];
export function isOpenAiImageModel(modelId: string): boolean {
  return IMAGE_MODEL_PREFIXES.some((p) => modelId.startsWith(p));
}

function classifyError(err: unknown): ProviderCallError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 429) {
      const raw = (err as { headers?: { get?: (k: string) => string | null } }).headers?.get?.("retry-after");
      const seconds = raw ? Number(raw) : NaN;
      return {
        kind: "rate_limit",
        message: err.message,
        retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      };
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
  if (err instanceof OpenAI.APIConnectionError) {
    return { kind: "network", message: err.message };
  }
  return { kind: "other", message: err instanceof Error ? err.message : String(err) };
}

/**
 * usage 正規化 (llm-usage-tracking.md §1):
 * prompt_tokens はキャッシュ分込みの総数のため、非キャッシュ分を引き算する
 * (Anthropic とは逆の意味論。ここで吸収して TextUsage に正規化する)。
 */
function toTextUsage(usage: OpenAI.CompletionUsage | undefined): TextUsage {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const promptTotal = usage?.prompt_tokens ?? 0;
  return {
    inputTokens: Math.max(0, promptTotal - cached),
    outputTokens: usage?.completion_tokens ?? 0,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0, // OpenAI にキャッシュ書き込みという概念は無い (自動キャッシュ)
    webSearchRequests: 0,
  };
}

export async function callOpenAiText(params: OpenAiTextParams): Promise<ProviderResult<OpenAiTextSuccess>> {
  try {
    const client = new OpenAI({ apiKey: params.apiKey });

    const userContentBlocks: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    for (const img of params.images ?? []) {
      userContentBlocks.push({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
      });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
      ...params.messages.map((m, i, arr) => {
        const isLastUser = m.role === "user" && i === arr.map((x) => x.role).lastIndexOf("user");
        if (isLastUser && userContentBlocks.length > 0) {
          return {
            role: "user" as const,
            content: [{ type: "text" as const, text: m.content }, ...userContentBlocks],
          };
        }
        return { role: m.role, content: m.content };
      }),
    ];

    const response = await client.chat.completions.create({
      model: params.model,
      messages,
      ...(params.maxTokens ? { max_completion_tokens: params.maxTokens } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.responseSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: params.responseSchema.name, schema: params.responseSchema.schema, strict: true },
            },
          }
        : {}),
    });

    const choice = response.choices[0];
    return {
      ok: true,
      value: {
        text: choice?.message?.content ?? "",
        usage: toTextUsage(response.usage),
        stopReason: choice?.finish_reason ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}

export type OpenAiImageParams = {
  apiKey: string;
  model: string;
  prompt: string;
  n: number;
  sourceImages?: OpenAiImageInput[];
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
};

export type OpenAiImageSuccess = {
  images: { dataBase64: string; mimeType: string }[];
  usage: { inputTokens?: number; outputTokens?: number };
};

export async function callOpenAiImage(params: OpenAiImageParams): Promise<ProviderResult<OpenAiImageSuccess>> {
  try {
    const client = new OpenAI({ apiKey: params.apiKey });
    // 判断点: quality/size は自前の狭い union ("low"|"medium"|"high"|"auto"、
    // zGenerateImageReq.quality と同一) をそのまま images.generate/images.edit の両方に渡す。
    // OpenAI SDK の ImageGenerateParams["quality"] 型は旧 DALL·E 系の "standard"/"hd" を含む
    // 広い union で、images.edit (ImageEditParamsBase) の quality union とは非互換のため、
    // その型へ経由キャストすると images.edit 呼び出しがコンパイルエラーになる
    // (gpt-image-2 は "standard"/"hd" を実際には使わないため実害はない)。
    const size = params.size as "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined;
    const quality = params.quality;

    const response =
      params.sourceImages && params.sourceImages.length > 0
        ? await client.images.edit({
            model: params.model,
            prompt: params.prompt,
            n: params.n,
            ...(size ? { size } : {}),
            ...(quality ? { quality } : {}),
            image: await Promise.all(
              params.sourceImages.map((img, i) =>
                toFile(Buffer.from(img.dataBase64, "base64"), `source-${i}.png`, { type: img.mimeType }),
              ),
            ),
          })
        : await client.images.generate({
            model: params.model,
            prompt: params.prompt,
            n: params.n,
            ...(size ? { size } : {}),
            ...(quality ? { quality } : {}),
          });

    const images = (response.data ?? []).map((d) => ({
      dataBase64: d.b64_json ?? "",
      mimeType: "image/png",
    }));
    return {
      ok: true,
      value: {
        images,
        usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens },
      },
    };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}

export type OpenAiTranscribeParams = {
  apiKey: string;
  model: string;
  filename: string;
  audioBytes: Buffer;
  prompt?: string;
};

export async function callOpenAiTranscribe(params: OpenAiTranscribeParams): Promise<ProviderResult<{ text: string }>> {
  try {
    const client = new OpenAI({ apiKey: params.apiKey });
    const file = await toFile(params.audioBytes, params.filename);
    const transcription = await client.audio.transcriptions.create({
      file,
      model: params.model,
      ...(params.prompt ? { prompt: params.prompt } : {}),
    });
    return { ok: true, value: { text: transcription.text } };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}

/** GET /v1/models (models-discovery.md §1)。画像対応判別は ID allowlist のみで可能 (能力メタデータ無し) */
export async function listOpenAiModels(apiKey: string): Promise<ProviderResult<DetectedModel[]>> {
  try {
    const client = new OpenAI({ apiKey });
    const list = await client.models.list();
    const models: DetectedModel[] = list.data.map((m) => ({
      id: m.id,
      kind: isOpenAiImageModel(m.id) ? "image" : "text",
      display: m.id,
    }));
    return { ok: true, value: models };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}
