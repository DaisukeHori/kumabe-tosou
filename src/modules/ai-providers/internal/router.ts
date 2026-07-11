import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { DEFAULT_EXECUTION_CONTEXT, type ExecutionContext, type Result } from "@/modules/platform/contracts";

import type {
  AiKeyStatus,
  GenerateImageReq,
  GenerateTextReq,
  ImageResult,
  Provider,
  TextResult,
  TextUsage,
  TranscribeReq,
  TranscribeResult,
} from "../contracts";
import {
  budgetReserve,
  budgetSettle,
  insertUsageLog,
  listKeyRows,
  markKeyOutcomeRow,
  vaultReadSecret,
  type AiProviderKeyRow,
} from "../repository";
import { callAnthropicText } from "./anthropic";
import { callGeminiImage, callGeminiText } from "./gemini";
import { callOpenAiImage, callOpenAiText, callOpenAiTranscribe } from "./openai";
import {
  computeImageCostMicroUsd,
  computeTextCostMicroUsd,
  computeTranscribeCostMicroUsd,
  estimateImageCostMicroUsd,
  estimateTextCostMicroUsd,
  estimateTranscribeCostMicroUsd,
} from "./pricing";
import { providerErrorDetail, type ProviderCallError } from "./provider-error";

/**
 * ルータ (canonical: docs/design/ai-studio-v2.md §1 のキー選択・フォールバック・予算ガード・
 * usage 記録)。facade.ts の generateText/generateImages/transcribe はすべて本モジュールへ委譲する。
 */

const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const DEFAULT_MAX_OUTPUT_TOKENS_FOR_ESTIMATE = 4096;
/** レート制限で Retry-After が取れない場合の既定 cooldown (秒) */
const DEFAULT_COOLDOWN_SECONDS = 30;

export function inferProviderFromModel(model: string): Provider {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-") || model.startsWith("imagen-")) return "gemini";
  return "openai";
}

/** cooldown 中 (status='limited' かつ cooldown_until が未来) / failed なキーはスキップする (§1) */
export function isUsableNow(row: Pick<AiProviderKeyRow, "status" | "cooldown_until">, now: Date): boolean {
  if (row.status === "failed") return false;
  if (row.status === "limited" && row.cooldown_until && new Date(row.cooldown_until) > now) return false;
  return true;
}

export type KeyOutcomeDecision = {
  /** false の場合はキーの状態を変更しない (network/model_not_found/other/refusal 等の一時的・非キー起因の失敗) */
  changeStatus: boolean;
  status: AiKeyStatus;
  cooldownSeconds: number | null;
};

/**
 * 呼び出し結果からキーの状態遷移を決定する純関数 (§1 MAJOR-1 のフォールバック分類の核)。
 * - 成功 (error=null) → 'ok' (cooldown 解除)
 * - auth (401/403) → 'failed'
 * - rate_limit (429) → 'limited' + cooldown (Retry-After 優先、無ければ既定 30 秒)
 * - model_not_found / network / other / refusal → 状態は変えない (次のキーへ進むのみ、
 *   もしくは refusal は呼び出し元にそのまま返す性質のためキー起因ではない)
 */
export function classifyKeyOutcome(error: ProviderCallError | null): KeyOutcomeDecision {
  if (!error) return { changeStatus: true, status: "ok", cooldownSeconds: null };
  if (error.kind === "auth") return { changeStatus: true, status: "failed", cooldownSeconds: null };
  if (error.kind === "rate_limit") {
    return {
      changeStatus: true,
      status: "limited",
      cooldownSeconds: error.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS,
    };
  }
  return { changeStatus: false, status: "failed", cooldownSeconds: null };
}

function envFallbackKeyFor(provider: Provider): string | null {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY ?? null;
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? null;
  if (provider === "gemini") return process.env.GEMINI_API_KEY ?? null;
  return null;
}

export type KeyCandidate = { id: string | null; apiKey: string; row: AiProviderKeyRow | null };

/**
 * キー候補の解決 (§1: priority 昇順・同値は created_at 昇順・cooldown 中/failed はスキップ)。
 * 登録キーが 1 件も使えない場合、既存動作の非退行のため env の API キーへフォールバックする
 * (P1 移行要件: 「ai_provider_keys に登録があればそれ、無ければ env をフォールバック」)。
 */
export async function resolveCandidates(
  dbClient: SupabaseClient,
  serviceClient: SupabaseClient,
  provider: Provider,
): Promise<Result<KeyCandidate[]>> {
  const rowsResult = await listKeyRows(dbClient, provider);
  if (!rowsResult.ok) return rowsResult;

  const usableRows = rowsResult.value.filter((r) => isUsableNow(r, new Date()));
  const candidates: KeyCandidate[] = [];
  for (const row of usableRows) {
    const secretResult = await vaultReadSecret(serviceClient, row.vault_secret_name);
    if (secretResult.ok && secretResult.value) {
      candidates.push({ id: row.id, apiKey: secretResult.value, row });
    }
  }

  if (candidates.length === 0) {
    const envKey = envFallbackKeyFor(provider);
    if (envKey) candidates.push({ id: null, apiKey: envKey, row: null });
  }

  return { ok: true, value: candidates };
}

/** model 省略時: 全プロバイダ横断で最優先の「default_model を持つ使用可能キー」を採用する (§1) */
async function resolveDefaultTextSelection(
  dbClient: SupabaseClient,
): Promise<{ provider: Provider; model: string } | null> {
  const rowsResult = await listKeyRows(dbClient);
  if (!rowsResult.ok) return null;
  const candidate = rowsResult.value.find((r) => isUsableNow(r, new Date()) && r.default_model);
  return candidate ? { provider: candidate.provider, model: candidate.default_model! } : null;
}

async function recordUsage(
  client: SupabaseClient,
  input: {
    provider: Provider;
    model: string;
    keyId: string | null;
    kind: "text" | "image";
    feature: string;
    inputTokens: number | null;
    outputTokens: number | null;
    imageCount: number | null;
    costMicroUsd: number;
    status: "ok" | "error";
    errorCode: string | null;
    rawUsage: unknown;
    refTable: string | null;
    refId: string | null;
  },
): Promise<void> {
  await insertUsageLog(client, {
    provider: input.provider,
    model: input.model,
    keyId: input.keyId,
    kind: input.kind,
    feature: input.feature,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    imageCount: input.imageCount,
    costMicroUsd: input.costMicroUsd,
    status: input.status,
    errorCode: input.errorCode,
    rawUsage: input.rawUsage,
    rateSnapshot: { computedAt: new Date().toISOString() },
    refTable: input.refTable,
    refId: input.refId,
  });
}

async function applyOutcomeToKey(
  client: SupabaseClient,
  candidate: KeyCandidate,
  error: ProviderCallError | null,
): Promise<void> {
  if (!candidate.row) return; // env フォールバックキーは DB 行が無いため状態遷移も無い

  if (error?.kind === "model_not_found") {
    // §1: 「そのキーの enabled_models から当該モデルを外す提案をログし、次のキーへ」。
    // 自動除外は行わず (管理者の意図的な有効化を尊重)、ログのみに留める。
    console.warn(
      `[ai-providers/router] model_not_found: key=${candidate.row.id} model は enabled_models からの除外を検討してください (${error.message})`,
    );
    return;
  }

  const decision = classifyKeyOutcome(error);
  if (!decision.changeStatus) return; // network / refusal / other はキー状態を変えない

  if (decision.status === "ok" && candidate.row.status === "ok") return; // 既に ok なら無駄な UPDATE を避ける

  const cooldownUntil = decision.cooldownSeconds
    ? new Date(Date.now() + decision.cooldownSeconds * 1000).toISOString()
    : null;
  await markKeyOutcomeRow(client, candidate.row.id, {
    status: decision.status,
    cooldownUntil,
    lastError: error?.message ?? null,
  });
}

type TextCallOutcome = { text: string; usage: TextUsage; stopReason: string | null };

type ImageCallOutcome = {
  images: { dataBase64: string; mimeType: string }[];
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
  /** 要求 n 件のうち画像化できなかった件数 (tester 検証 MEDIUM 対応。0 = 全件成功) */
  failedCount: number;
};

/**
 * openai.ts (usage あり・all-or-nothing) / gemini.ts (usage なし・部分成功対応) の
 * 戻り値差を正規化する (TS の union 型に対する `"usage" in value` narrowing が
 * 三項演算子の分岐をまたぐと効きにくいのを避ける目的も兼ねる)。
 * openai.ts は 1 API 呼び出しで n 枚をまとめて生成するため、成功時は常に
 * failedCount=0 (n 未満しか返らなかった場合はその差分を failedCount とみなす)。
 */
async function callProviderImage(
  provider: Provider,
  req: GenerateImageReq,
  apiKey: string,
): Promise<{ ok: true; value: ImageCallOutcome } | { ok: false; error: ProviderCallError }> {
  if (provider === "openai") {
    const result = await callOpenAiImage({
      apiKey,
      model: req.model,
      prompt: req.prompt,
      n: req.n,
      sourceImages: req.sourceImages,
      size: req.size,
      quality: req.quality,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        images: result.value.images,
        usage: result.value.usage,
        failedCount: Math.max(0, req.n - result.value.images.length),
      },
    };
  }
  const result = await callGeminiImage({
    apiKey,
    model: req.model,
    prompt: req.prompt,
    n: req.n,
    sourceImages: req.sourceImages,
  });
  if (!result.ok) return result;
  return { ok: true, value: { images: result.value.images, usage: undefined, failedCount: result.value.failedCount } };
}

async function callProviderText(
  provider: Provider,
  model: string,
  apiKey: string,
  req: GenerateTextReq,
): Promise<{ ok: true; value: TextCallOutcome } | { ok: false; error: ProviderCallError }> {
  if (provider === "anthropic") {
    return callAnthropicText({
      apiKey,
      model,
      system: req.system,
      messages: req.messages,
      images: req.images,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      responseSchema: req.responseSchema,
      webSearch: req.webSearch,
      onDelta: req.onDelta,
    });
  }
  if (provider === "openai") {
    return callOpenAiText({
      apiKey,
      model,
      system: req.system,
      messages: req.messages,
      images: req.images,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      responseSchema: req.responseSchema,
    });
  }
  return callGeminiText({
    apiKey,
    model,
    system: req.system,
    messages: req.messages,
    images: req.images,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    responseSchema: req.responseSchema,
  });
}

export async function routeGenerateText(
  req: GenerateTextReq,
  ctx: ExecutionContext = DEFAULT_EXECUTION_CONTEXT,
): Promise<Result<TextResult>> {
  let serviceClient: SupabaseClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
  // service 文脈は cookie 依存の createSupabaseServerClient() を呼ばず、DB アクセスは
  // すべて service client (ctx.client 注入があればそちら) に一本化する (00-overview.md §3.1.2b:
  // 現状バグ — service 文脈でも予算 RPC に sessionClient を渡すと auth.uid()=null で必ず失敗する)。
  const dbClient: SupabaseClient = ctx.mode === "service" ? (ctx.client ?? serviceClient) : await createSupabaseServerClient();

  let provider: Provider;
  let model: string;
  if (req.model) {
    model = req.model;
    provider = inferProviderFromModel(model);
  } else {
    const resolved = await resolveDefaultTextSelection(dbClient);
    if (!resolved) {
      return { ok: false, code: "KMB-E408", detail: "model が未指定で、既定モデルも設定されていません" };
    }
    provider = resolved.provider;
    model = resolved.model;
  }

  const candidatesResult = await resolveCandidates(dbClient, serviceClient, provider);
  if (!candidatesResult.ok) return candidatesResult;
  if (candidatesResult.value.length === 0) {
    return {
      ok: false,
      code: "KMB-E408",
      detail: `${provider} の利用可能なキーがありません (設定画面での登録、または環境変数を確認してください)`,
    };
  }

  const approxChars = (req.system?.length ?? 0) + req.messages.reduce((acc, m) => acc + m.content.length, 0);
  const estimateMicroUsd = estimateTextCostMicroUsd(
    provider,
    model,
    approxChars,
    req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS_FOR_ESTIMATE,
  );
  const reserve = await budgetReserve(dbClient, estimateMicroUsd, 0);
  if (!reserve.ok) return reserve;
  if (!reserve.value.ok) {
    return { ok: false, code: "KMB-E407", detail: reserve.value.errorCode ?? undefined };
  }
  const reservationId = reserve.value.reservationId;

  let lastError: ProviderCallError | null = null;
  for (const candidate of candidatesResult.value) {
    const callResult = await callProviderText(provider, model, candidate.apiKey, req);

    if (callResult.ok) {
      const { usage, stopReason, text } = callResult.value;
      const costMicroUsd = computeTextCostMicroUsd(provider, model, usage);
      await budgetSettle(dbClient, {
        reservationId,
        actualMicroUsd: costMicroUsd,
        actualImageCount: 0,
      });
      await recordUsage(dbClient, {
        provider,
        model,
        keyId: candidate.id,
        kind: "text",
        feature: req.feature,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        imageCount: null,
        costMicroUsd,
        status: "ok",
        errorCode: null,
        rawUsage: usage,
        refTable: req.refTable ?? null,
        refId: req.refId ?? null,
      });
      await applyOutcomeToKey(dbClient, candidate, null);
      return { ok: true, value: { text, provider, model, usage, costMicroUsd, stopReason } };
    }

    lastError = callResult.error;
    await recordUsage(dbClient, {
      provider,
      model,
      keyId: candidate.id,
      kind: "text",
      feature: req.feature,
      inputTokens: null,
      outputTokens: null,
      imageCount: null,
      costMicroUsd: 0,
      status: "error",
      errorCode: lastError.kind,
      rawUsage: { error: lastError.message },
      refTable: req.refTable ?? null,
      refId: req.refId ?? null,
    });
    await applyOutcomeToKey(dbClient, candidate, lastError);
    // ループ続行 (次の候補キーへ)
  }

  await budgetSettle(dbClient, { reservationId, actualMicroUsd: 0, actualImageCount: 0 });
  return {
    ok: false,
    code: "KMB-E408",
    detail: lastError ? providerErrorDetail(lastError) : "候補キーがありませんでした",
  };
}

export async function routeGenerateImages(
  req: GenerateImageReq,
  ctx: ExecutionContext = DEFAULT_EXECUTION_CONTEXT,
): Promise<Result<ImageResult>> {
  let serviceClient: SupabaseClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
  const dbClient: SupabaseClient = ctx.mode === "service" ? (ctx.client ?? serviceClient) : await createSupabaseServerClient();

  const provider = inferProviderFromModel(req.model);
  if (provider === "anthropic") {
    return { ok: false, code: "KMB-E408", detail: "Anthropic には画像生成モデルが存在しません" };
  }

  const candidatesResult = await resolveCandidates(dbClient, serviceClient, provider);
  if (!candidatesResult.ok) return candidatesResult;
  if (candidatesResult.value.length === 0) {
    return {
      ok: false,
      code: "KMB-E408",
      detail: `${provider} の利用可能なキーがありません (設定画面での登録、または環境変数を確認してください)`,
    };
  }

  const estimateMicroUsd = estimateImageCostMicroUsd(provider, req.model, req.n, req.quality);
  const reserve = await budgetReserve(dbClient, estimateMicroUsd, req.n);
  if (!reserve.ok) return reserve;
  if (!reserve.value.ok) {
    return { ok: false, code: "KMB-E407", detail: reserve.value.errorCode ?? undefined };
  }
  const reservationId = reserve.value.reservationId;

  let lastError: ProviderCallError | null = null;
  for (const candidate of candidatesResult.value) {
    let callResult = await callProviderImage(provider, req, candidate.apiKey);

    // LOW (tester 検証): 画像パートが 1 枚も無い (全滅) 場合は成功扱いにしない。
    // 空配列のまま cost=0 で "成功" 応答すると、呼び出し元が空の結果を黙って
    // 受け取ってしまう (gemini.ts 側は既に自前でこの判定をするが、他プロバイダにも
    // 効く防御としてルータ側でも二重にチェックする)。
    if (callResult.ok && callResult.value.images.length === 0) {
      callResult = {
        ok: false,
        error: { kind: "other", message: "プロバイダが画像を返しませんでした" },
      };
    }

    if (callResult.ok) {
      const { images, usage, failedCount } = callResult.value;
      const costMicroUsd = computeImageCostMicroUsd(provider, req.model, images.length, usage, req.quality);
      await budgetSettle(dbClient, {
        reservationId,
        actualMicroUsd: costMicroUsd,
        actualImageCount: images.length,
      });
      await recordUsage(dbClient, {
        provider,
        model: req.model,
        keyId: candidate.id,
        kind: "image",
        feature: req.feature,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        imageCount: images.length,
        costMicroUsd,
        status: "ok",
        errorCode: null,
        rawUsage: { ...(usage ?? {}), failedCount },
        refTable: req.refTable ?? null,
        refId: req.refId ?? null,
      });
      await applyOutcomeToKey(dbClient, candidate, null);
      return { ok: true, value: { images, provider, model: req.model, costMicroUsd, failedCount } };
    }

    lastError = callResult.error;
    await recordUsage(dbClient, {
      provider,
      model: req.model,
      keyId: candidate.id,
      kind: "image",
      feature: req.feature,
      inputTokens: null,
      outputTokens: null,
      imageCount: 0,
      costMicroUsd: 0,
      status: "error",
      errorCode: lastError.kind,
      rawUsage: { error: lastError.message },
      refTable: req.refTable ?? null,
      refId: req.refId ?? null,
    });
    await applyOutcomeToKey(dbClient, candidate, lastError);
  }

  await budgetSettle(dbClient, { reservationId, actualMicroUsd: 0, actualImageCount: 0 });
  return {
    ok: false,
    code: "KMB-E408",
    detail: lastError ? providerErrorDetail(lastError) : "候補キーがありませんでした",
  };
}

export async function routeTranscribe(
  req: TranscribeReq,
  ctx: ExecutionContext = DEFAULT_EXECUTION_CONTEXT,
): Promise<Result<TranscribeResult>> {
  let serviceClient: SupabaseClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
  const dbClient: SupabaseClient = ctx.mode === "service" ? (ctx.client ?? serviceClient) : await createSupabaseServerClient();

  const model = req.model ?? DEFAULT_TRANSCRIBE_MODEL;
  const provider: Provider = "openai"; // 文字起こしは OpenAI (gpt-4o-transcribe) のみ対応 (P1 移行対象)

  const candidatesResult = await resolveCandidates(dbClient, serviceClient, provider);
  if (!candidatesResult.ok) return candidatesResult;
  if (candidatesResult.value.length === 0) {
    return {
      ok: false,
      code: "KMB-E408",
      detail: `${provider} の利用可能なキーがありません (設定画面での登録、または環境変数を確認してください)`,
    };
  }

  const audioBytes = Buffer.from(req.audioBase64, "base64");
  const estimateMicroUsd = estimateTranscribeCostMicroUsd(provider, model, audioBytes.byteLength);
  const reserve = await budgetReserve(dbClient, estimateMicroUsd, 0);
  if (!reserve.ok) return reserve;
  if (!reserve.value.ok) {
    return { ok: false, code: "KMB-E407", detail: reserve.value.errorCode ?? undefined };
  }
  const reservationId = reserve.value.reservationId;

  let lastError: ProviderCallError | null = null;
  for (const candidate of candidatesResult.value) {
    const callResult = await callOpenAiTranscribe({
      apiKey: candidate.apiKey,
      model,
      filename: req.filename,
      audioBytes,
      prompt: req.prompt,
    });

    if (callResult.ok) {
      const costMicroUsd = computeTranscribeCostMicroUsd(provider, model, audioBytes.byteLength);
      await budgetSettle(dbClient, {
        reservationId,
        actualMicroUsd: costMicroUsd,
        actualImageCount: 0,
      });
      await recordUsage(dbClient, {
        provider,
        model,
        keyId: candidate.id,
        kind: "text",
        feature: req.feature,
        inputTokens: null,
        outputTokens: null,
        imageCount: null,
        costMicroUsd,
        status: "ok",
        errorCode: null,
        rawUsage: { audioBytes: audioBytes.byteLength },
        refTable: req.refTable ?? null,
        refId: req.refId ?? null,
      });
      await applyOutcomeToKey(dbClient, candidate, null);
      return { ok: true, value: { text: callResult.value.text, costMicroUsd } };
    }

    lastError = callResult.error;
    await recordUsage(dbClient, {
      provider,
      model,
      keyId: candidate.id,
      kind: "text",
      feature: req.feature,
      inputTokens: null,
      outputTokens: null,
      imageCount: null,
      costMicroUsd: 0,
      status: "error",
      errorCode: lastError.kind,
      rawUsage: { error: lastError.message },
      refTable: req.refTable ?? null,
      refId: req.refId ?? null,
    });
    await applyOutcomeToKey(dbClient, candidate, lastError);
  }

  await budgetSettle(dbClient, { reservationId, actualMicroUsd: 0, actualImageCount: 0 });
  return {
    ok: false,
    code: "KMB-E408",
    detail: lastError ? providerErrorDetail(lastError) : "候補キーがありませんでした",
  };
}
