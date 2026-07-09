import "server-only";

import type { DetectedModel, TextUsage } from "../contracts";
import type { ProviderCallError, ProviderResult } from "./provider-error";

/**
 * Gemini 呼び出し (canonical: docs/research/ai-studio-v2/models-discovery.md §3,
 * gemini-image.md)。SDK (`@google/genai`) は本プロジェクトに未導入のため、
 * fetch 直叩きで実装する (研究時点で Interactions API はまだ若く breaking change 実績が
 * あるため、legacy 格下げだが安定している generateContent を採用 — gemini-image.md §2:
 * 「廃止日は未定・4 画像モデル全てで引き続き動作」の事実に基づく判断)。
 */

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiMessage = { role: "user" | "assistant"; content: string };
export type GeminiImageInput = { mimeType: string; dataBase64: string };

export type GeminiTextParams = {
  apiKey: string;
  model: string;
  system?: string;
  messages: GeminiMessage[];
  images?: GeminiImageInput[];
  maxTokens?: number;
  temperature?: number;
  responseSchema?: { name: string; schema: Record<string, unknown> };
};

export type GeminiTextSuccess = { text: string; usage: TextUsage; stopReason: string | null };

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function toGeminiContents(params: { messages: GeminiMessage[]; images?: GeminiImageInput[] }): GeminiContent[] {
  const lastUserIndex = params.messages.map((m) => m.role).lastIndexOf("user");
  return params.messages.map((m, i) => {
    const parts: GeminiPart[] = [{ text: m.content }];
    if (i === lastUserIndex) {
      for (const img of params.images ?? []) {
        parts.unshift({ inlineData: { mimeType: img.mimeType, data: img.dataBase64 } });
      }
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

async function classifyResponseError(res: Response): Promise<ProviderCallError> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) message = body.error.message;
  } catch {
    // レスポンスが JSON でない場合は statusText のまま
  }
  if (res.status === 401 || res.status === 403) return { kind: "auth", message };
  if (res.status === 429) {
    const raw = res.headers.get("retry-after");
    const seconds = raw ? Number(raw) : NaN;
    return { kind: "rate_limit", message, retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  }
  if (res.status === 404 || (res.status === 400 && /model/i.test(message))) {
    return { kind: "model_not_found", message };
  }
  if (res.status >= 500) return { kind: "network", message };
  return { kind: "other", message };
}

function classifyNetworkError(err: unknown): ProviderCallError {
  return { kind: "network", message: err instanceof Error ? err.message : String(err) };
}

/**
 * usage 正規化 (llm-usage-tracking.md §1): promptTokenCount はキャッシュ込みの総数
 * (OpenAI と同じ意味論) のため引き算する。thinking (thoughtsTokenCount) は output 課金対象
 * だが candidatesTokenCount に含まれないため合算する。
 */
function toTextUsage(usageMetadata: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
} | undefined): TextUsage {
  const cached = usageMetadata?.cachedContentTokenCount ?? 0;
  const promptTotal = usageMetadata?.promptTokenCount ?? 0;
  const outputTotal = (usageMetadata?.candidatesTokenCount ?? 0) + (usageMetadata?.thoughtsTokenCount ?? 0);
  return {
    inputTokens: Math.max(0, promptTotal - cached),
    outputTokens: outputTotal,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    webSearchRequests: 0,
  };
}

export async function callGeminiText(params: GeminiTextParams): Promise<ProviderResult<GeminiTextSuccess>> {
  try {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(params),
      ...(params.system ? { systemInstruction: { parts: [{ text: params.system }] } } : {}),
      generationConfig: {
        ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.responseSchema
          ? { responseMimeType: "application/json", responseSchema: params.responseSchema.schema }
          : {}),
      },
    };

    const res = await fetch(`${BASE_URL}/models/${params.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": params.apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { ok: false, error: await classifyResponseError(res) };

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    const candidate = json.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");

    return {
      ok: true,
      value: { text, usage: toTextUsage(json.usageMetadata), stopReason: candidate?.finishReason ?? null },
    };
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err) };
  }
}

export type GeminiImageParams = {
  apiKey: string;
  model: string;
  prompt: string;
  n: number;
  sourceImages?: GeminiImageInput[];
};

export type GeminiImageSuccess = {
  images: { dataBase64: string; mimeType: string }[];
  /** 要求 n 件のうち画像化できなかった件数 (tester 検証 MEDIUM 対応。0 = 全件成功) */
  failedCount: number;
};

/**
 * 複数枚生成の公式パラメータは存在しないため並列 N リクエストで代替する (gemini-image.md §4)。
 *
 * tester 検証 (MEDIUM) 対応: 従来は Promise.all + 「1 件でも失敗したら全体を捨てる」
 * (all-or-nothing) 実装だったが、Gemini 側では成功した分は既に生成・課金対象になっている
 * 可能性があるため、成功済みの画像を握りつぶすと実コストが ai_usage_log に記録されない
 * 欠落が生じる。各リクエストを独立に判定し、成功分はすべて images に集約して返す
 * (failedCount で欠落数を可視化)。全滅 (images が 0 件) の場合のみ ok:false とし、
 * この場合に限りルータが次のキーへフォールバックする (部分成功時は再試行しない)。
 */
export async function callGeminiImage(params: GeminiImageParams): Promise<ProviderResult<GeminiImageSuccess>> {
  try {
    const parts: GeminiPart[] = [{ text: params.prompt }];
    for (const img of params.sourceImages ?? []) {
      parts.unshift({ inlineData: { mimeType: img.mimeType, data: img.dataBase64 } });
    }

    const requests = Array.from({ length: params.n }, () =>
      fetch(`${BASE_URL}/models/${params.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": params.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      }),
    );

    // Promise.all ではなく allSettled: 1 件の reject (fetch 自体の失敗) が
    // 他の成功済みリクエストを巻き込んで全滅させないようにする。
    const settledResponses = await Promise.allSettled(requests);

    const images: { dataBase64: string; mimeType: string }[] = [];
    let failedCount = 0;
    let firstError: ProviderCallError | null = null;

    for (const settled of settledResponses) {
      if (settled.status === "rejected") {
        failedCount += 1;
        firstError ??= classifyNetworkError(settled.reason);
        continue;
      }

      const res = settled.value;
      if (!res.ok) {
        failedCount += 1;
        firstError ??= await classifyResponseError(res);
        continue;
      }

      const body = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
      const parts2 = body.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts2.find((p) => p.inlineData);
      if (imagePart?.inlineData) {
        images.push({ dataBase64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType });
      } else {
        // HTTP は成功したが画像パートが無かった (プロンプトが画像を生成しなかった等)。
        // 「失敗」として一括りにはせず、単に画像化できなかった 1 件として数える。
        failedCount += 1;
      }
    }

    if (images.length === 0) {
      // LOW (tester 検証): 画像パートが 1 枚も無い (全滅) 場合は成功として返さない。
      // HTTP エラーが 1 件も無かった (全部 200 だが画像が無かった) 場合は
      // 「プロバイダが画像を返しませんでした」を明示する (E408 相当)。
      return {
        ok: false,
        error: firstError ?? { kind: "other", message: "プロバイダが画像を返しませんでした" },
      };
    }

    return { ok: true, value: { images, failedCount } };
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err) };
  }
}

/**
 * GET /v1beta/models (models-discovery.md §3)。画像対応判別は predict メソッド
 * (Imagen 系) または名前規約 (-image サフィックス / imagen- プレフィックス、
 * ネイティブ画像生成モデル向けのハイブリッド判定) の併用。
 */
export function isGeminiImageModelName(name: string): boolean {
  return /-image(-|$)/.test(name) || name.startsWith("imagen-") || name.includes("imagen-");
}

export async function listGeminiModels(apiKey: string): Promise<ProviderResult<DetectedModel[]>> {
  try {
    const models: DetectedModel[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${BASE_URL}/models`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: { "x-goog-api-key": apiKey } });
      if (!res.ok) return { ok: false, error: await classifyResponseError(res) };
      const json = (await res.json()) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      for (const m of json.models ?? []) {
        const shortName = m.name.replace(/^models\//, "");
        const isImage = (m.supportedGenerationMethods ?? []).includes("predict") || isGeminiImageModelName(shortName);
        models.push({ id: shortName, kind: isImage ? "image" : "text", display: m.displayName ?? shortName });
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
    return { ok: true, value: models };
  } catch (err) {
    return { ok: false, error: classifyNetworkError(err) };
  }
}
