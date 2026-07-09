import type { Provider, TextUsage } from "../contracts";

/**
 * レート表 (canonical: docs/research/ai-studio-v2/llm-usage-tracking.md §2/§3、
 * openai-image.md §7、gemini-image.md §5)。
 *
 * 単位: 「$ per 1,000,000 tokens」の値を **そのまま** micro-USD/token として使う
 * (1 USD = 1,000,000 micro-USD かつレートの分母も 1,000,000 tokens のため、
 * 両者の 10^6 が相殺して数値がそのまま使えるという設計上の工夫。MINOR-1: µUSD 整数統一)。
 *
 * usage は各プロバイダの internal/*.ts が normalize 済み (TextUsage 形。§ の
 * 「usage 正規化層」) であることを前提とする — つまり:
 *   - inputTokens      = 非キャッシュ分の入力トークン数 (3 社ともここで統一)
 *   - cachedInputTokens = キャッシュ命中分 (読み取り)
 *   - cacheWriteInputTokens = キャッシュ書き込み分 (Anthropic のみ発生。5分 TTL 前提)
 *   - outputTokens     = 出力トークン (Gemini は thinking 込みで正規化済み)
 * この正規化により、pricing 側は "inputTokens×input単価 + cachedInputTokens×cache_read単価 +
 * cacheWriteInputTokens×cache_write単価 + outputTokens×output単価" という単一の式で
 * 3 社を横断して計算できる (プロバイダ別の usage フィールド差はここには持ち込まない)。
 */

export type TextRateEntry = {
  provider: Provider;
  model: string;
  /** この単価が適用される開始日 (ISO 'YYYY-MM-DD')。複数ある場合は最新の該当分を採用 */
  effectiveFrom: string;
  inputMicroUsdPerToken: number;
  outputMicroUsdPerToken: number;
  cacheReadMicroUsdPerToken?: number;
  cacheWrite5mMicroUsdPerToken?: number;
  cacheWrite1hMicroUsdPerToken?: number;
  webSearchMicroUsdPerRequest?: number;
};

/** claude-sonnet-5 は 2026-09-01 に値上げ予定 (research 確認済み) のため effective_from を分ける */
export const TEXT_RATE_TABLE: TextRateEntry[] = [
  // ---- Anthropic ----
  {
    provider: "anthropic",
    model: "claude-opus-4-8",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 5,
    outputMicroUsdPerToken: 25,
    cacheReadMicroUsdPerToken: 0.5,
    cacheWrite5mMicroUsdPerToken: 6.25,
    cacheWrite1hMicroUsdPerToken: 10,
    webSearchMicroUsdPerRequest: 10_000, // $10 / 1,000 回
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 2,
    outputMicroUsdPerToken: 10,
    cacheReadMicroUsdPerToken: 0.2,
    cacheWrite5mMicroUsdPerToken: 2.5,
    cacheWrite1hMicroUsdPerToken: 4,
    webSearchMicroUsdPerRequest: 10_000,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5",
    effectiveFrom: "2026-09-01",
    inputMicroUsdPerToken: 3,
    outputMicroUsdPerToken: 15,
    cacheReadMicroUsdPerToken: 0.3,
    cacheWrite5mMicroUsdPerToken: 3.75,
    cacheWrite1hMicroUsdPerToken: 6,
    webSearchMicroUsdPerRequest: 10_000,
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 1,
    outputMicroUsdPerToken: 5,
    cacheReadMicroUsdPerToken: 0.1,
    cacheWrite5mMicroUsdPerToken: 1.25,
    cacheWrite1hMicroUsdPerToken: 2,
    webSearchMicroUsdPerRequest: 10_000,
  },
  // ---- OpenAI ----
  {
    provider: "openai",
    model: "gpt-5.5",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 5.0,
    outputMicroUsdPerToken: 30.0,
    cacheReadMicroUsdPerToken: 0.5,
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 2.5,
    outputMicroUsdPerToken: 15.0,
    cacheReadMicroUsdPerToken: 0.25,
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 0.75,
    outputMicroUsdPerToken: 4.5,
    cacheReadMicroUsdPerToken: 0.075,
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 0.2,
    outputMicroUsdPerToken: 1.25,
    cacheReadMicroUsdPerToken: 0.02,
  },
  // ---- Gemini ----
  {
    provider: "gemini",
    model: "gemini-3.5-flash",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 1.5,
    outputMicroUsdPerToken: 9.0,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 0.3,
    outputMicroUsdPerToken: 2.5,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 0.1,
    outputMicroUsdPerToken: 0.4,
  },
  // gemini-3.1-pro-preview は 200k トークン境界で単価が変わる段階制 (research §2)。
  // 本プロジェクト規模 (月 $30〜60、テキストは主に claude-opus-4-8) では未使用のため、
  // 閾値未満のレートのみ収録する (閾値超過分は将来の需要が出た時点で拡張。判断点)。
  {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    effectiveFrom: "2026-01-01",
    inputMicroUsdPerToken: 2.0,
    outputMicroUsdPerToken: 12.0,
  },
];

export type ImageRateEntry = {
  provider: Provider;
  model: string;
  effectiveFrom: string;
  /** トークン課金モデル (gpt-image-2 等)。usage から算出できる場合はこちらを優先 */
  imageInputMicroUsdPerToken?: number;
  imageOutputMicroUsdPerToken?: number;
  /** 枚数課金 or トークン usage が取れない場合のフォールバック (品質別、micro-USD/枚) */
  perImageMicroUsd?: { low?: number; medium?: number; high?: number };
};

export const IMAGE_RATE_TABLE: ImageRateEntry[] = [
  {
    provider: "openai",
    model: "gpt-image-2",
    effectiveFrom: "2026-01-01",
    imageInputMicroUsdPerToken: 8.0,
    imageOutputMicroUsdPerToken: 30.0,
    // 1024² の概算 (openai-image.md §7)。usage が取れた場合はトークン計算を優先する。
    perImageMicroUsd: { low: 6_000, medium: 53_000, high: 211_000 },
  },
  {
    provider: "gemini",
    model: "gemini-3.1-flash-lite-image",
    effectiveFrom: "2026-01-01",
    perImageMicroUsd: { medium: 33_600 }, // 1K ≈ $0.0336
  },
  {
    provider: "gemini",
    model: "gemini-3.1-flash-image",
    effectiveFrom: "2026-01-01",
    perImageMicroUsd: { low: 45_000, medium: 67_000, high: 101_000 }, // 0.5K/1K/2K
  },
  {
    provider: "gemini",
    model: "gemini-3-pro-image",
    effectiveFrom: "2026-01-01",
    perImageMicroUsd: { medium: 134_000, high: 240_000 }, // 1K-2K / 4K
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    effectiveFrom: "2026-01-01",
    perImageMicroUsd: { medium: 39_000 },
  },
];

export type TranscribeRateEntry = {
  provider: Provider;
  model: string;
  effectiveFrom: string;
  /**
   * 判断点 (オーケストレーターへ報告済み): gpt-4o-transcribe の usage はトークン建てで
   * 返るが (research/llm-usage-tracking.md §1)、公式の音声トークン単価は一次情報で
   * 確認できなかった。本プロジェクトで既存採用済みの $/分 概算 (設計書 §14 実績値と一致)
   * を暫定レートとして使い、音声バイト長から分数を粗く推定する
   * (16kbps 相当の実効ビットレート仮定。正確な duration メタデータが usage に無いため)。
   */
  microUsdPerMinute: number;
};

export const TRANSCRIBE_RATE_TABLE: TranscribeRateEntry[] = [
  { provider: "openai", model: "gpt-4o-transcribe", effectiveFrom: "2026-01-01", microUsdPerMinute: 6_000 },
  { provider: "openai", model: "gpt-4o-mini-transcribe", effectiveFrom: "2026-01-01", microUsdPerMinute: 3_000 },
];

function pickLatest<T extends { provider: Provider; model: string; effectiveFrom: string }>(
  table: T[],
  provider: Provider,
  model: string,
  atIso: string,
): T | null {
  const candidates = table
    .filter((r) => r.provider === provider && r.model === model && r.effectiveFrom <= atIso)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return candidates[0] ?? null;
}

export function findTextRate(provider: Provider, model: string, at: Date = new Date()): TextRateEntry | null {
  return pickLatest(TEXT_RATE_TABLE, provider, model, at.toISOString().slice(0, 10));
}

export function findImageRate(provider: Provider, model: string, at: Date = new Date()): ImageRateEntry | null {
  return pickLatest(IMAGE_RATE_TABLE, provider, model, at.toISOString().slice(0, 10));
}

export function findTranscribeRate(
  provider: Provider,
  model: string,
  at: Date = new Date(),
): TranscribeRateEntry | null {
  return pickLatest(TRANSCRIBE_RATE_TABLE, provider, model, at.toISOString().slice(0, 10));
}

/**
 * TextUsage (正規化済み) から確定コストを計算する。レートが未収録のモデルは
 * 0 (かつ呼び出し側がログで気づけるよう console.warn) — 未知モデルで計算不能のまま
 * 例外を投げて呼び出しを失敗させるより、記録自体は残す方を優先する設計判断。
 */
export function computeTextCostMicroUsd(provider: Provider, model: string, usage: TextUsage): number {
  const rate = findTextRate(provider, model);
  if (!rate) {
    console.warn(`[ai-providers/pricing] レート未収録のモデル: ${provider}/${model} (cost=0 で記録)`);
    return 0;
  }
  const cost =
    usage.inputTokens * rate.inputMicroUsdPerToken +
    usage.outputTokens * rate.outputMicroUsdPerToken +
    usage.cachedInputTokens * (rate.cacheReadMicroUsdPerToken ?? 0) +
    // cache write は 5m TTL 前提 (既存 claude.ts の cache_control:{type:'ephemeral'} に ttl 指定なし = 5分)
    usage.cacheWriteInputTokens * (rate.cacheWrite5mMicroUsdPerToken ?? 0) +
    usage.webSearchRequests * (rate.webSearchMicroUsdPerRequest ?? 0);
  return Math.round(cost);
}

export function computeImageCostMicroUsd(
  provider: Provider,
  model: string,
  imageCount: number,
  usage?: { inputTokens?: number; outputTokens?: number },
  quality?: "low" | "medium" | "high" | "auto",
): number {
  const rate = findImageRate(provider, model);
  if (!rate) {
    console.warn(`[ai-providers/pricing] レート未収録の画像モデル: ${provider}/${model} (cost=0 で記録)`);
    return 0;
  }
  if (usage?.outputTokens && rate.imageOutputMicroUsdPerToken) {
    const cost =
      (usage.inputTokens ?? 0) * (rate.imageInputMicroUsdPerToken ?? 0) +
      usage.outputTokens * rate.imageOutputMicroUsdPerToken;
    return Math.round(cost);
  }
  const q = quality && quality !== "auto" ? quality : "medium";
  const perImage = rate.perImageMicroUsd?.[q] ?? rate.perImageMicroUsd?.medium ?? 0;
  return Math.round(perImage * imageCount);
}

/** 音声バイト長からの粗い分数推定 (§ TranscribeRateEntry のコメント参照) */
export function estimateAudioMinutesFromBytes(byteLength: number): number {
  const ASSUMED_BYTES_PER_SECOND = 16_000 / 8; // 16kbps 相当
  const seconds = byteLength / ASSUMED_BYTES_PER_SECOND;
  return seconds / 60;
}

export function computeTranscribeCostMicroUsd(provider: Provider, model: string, byteLength: number): number {
  const rate = findTranscribeRate(provider, model);
  if (!rate) {
    console.warn(`[ai-providers/pricing] レート未収録の文字起こしモデル: ${provider}/${model} (cost=0 で記録)`);
    return 0;
  }
  const minutes = estimateAudioMinutesFromBytes(byteLength);
  return Math.round(minutes * rate.microUsdPerMinute);
}

/** 予算予約 (§1 budget guard) 用の粗い事前見積り。実コストは呼び出し後に確定計算する。 */
export function estimateTextCostMicroUsd(
  provider: Provider,
  model: string,
  approxInputChars: number,
  maxOutputTokens: number,
): number {
  const rate = findTextRate(provider, model);
  if (!rate) return 0;
  const approxInputTokens = Math.ceil(approxInputChars / 4); // 粗い chars/token 比 (日英混在の概算)
  return Math.round(
    approxInputTokens * rate.inputMicroUsdPerToken + maxOutputTokens * rate.outputMicroUsdPerToken,
  );
}

export function estimateImageCostMicroUsd(
  provider: Provider,
  model: string,
  n: number,
  quality?: "low" | "medium" | "high" | "auto",
): number {
  const rate = findImageRate(provider, model);
  if (!rate) return 0;
  const q = quality && quality !== "auto" ? quality : "medium";
  const perImage = rate.perImageMicroUsd?.[q] ?? rate.perImageMicroUsd?.medium ?? 0;
  return Math.round(perImage * n);
}

export function estimateTranscribeCostMicroUsd(provider: Provider, model: string, byteLength: number): number {
  return computeTranscribeCostMicroUsd(provider, model, byteLength);
}
