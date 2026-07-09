import { describe, expect, it } from "vitest";

import {
  computeImageCostMicroUsd,
  computeTextCostMicroUsd,
  computeTranscribeCostMicroUsd,
  estimateAudioMinutesFromBytes,
  estimateImageCostMicroUsd,
  estimateTextCostMicroUsd,
  findTextRate,
} from "@/modules/ai-providers/internal/pricing";
import type { TextUsage } from "@/modules/ai-providers/contracts";

/**
 * canonical: docs/research/ai-studio-v2/llm-usage-tracking.md §1/§2、openai-image.md §7、
 * gemini-image.md §5。3 社の usage 形式差 (プロバイダ側 internal/*.ts が正規化済みという前提)
 * から確定コストを計算する pricing.ts の単体テスト (設計書 §13)。
 */

function usage(partial: Partial<TextUsage>): TextUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    webSearchRequests: 0,
    ...partial,
  };
}

describe("computeTextCostMicroUsd: 各社 usage フィクスチャからの確定コスト計算", () => {
  it("Anthropic claude-opus-4-8: input/output のみ ($5/$25 per 1M tok)", () => {
    // 1,000,000 input + 1,000,000 output → $5 + $25 = $30 = 30,000,000 µUSD
    const cost = computeTextCostMicroUsd("anthropic", "claude-opus-4-8", usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBe(30_000_000);
  });

  it("Anthropic claude-opus-4-8: cache read/write を含む正規化 usage", () => {
    // input 0 (非キャッシュ) + cacheRead 1,000,000 (@0.5) + cacheWrite 1,000,000 (@6.25) + output 0
    const cost = computeTextCostMicroUsd(
      "anthropic",
      "claude-opus-4-8",
      usage({ cachedInputTokens: 1_000_000, cacheWriteInputTokens: 1_000_000 }),
    );
    expect(cost).toBe(500_000 + 6_250_000);
  });

  it("Anthropic web_search_requests は $10/1,000 回で加算される", () => {
    const cost = computeTextCostMicroUsd("anthropic", "claude-opus-4-8", usage({ webSearchRequests: 1_000 }));
    expect(cost).toBe(10_000_000); // $10
  });

  it("OpenAI gpt-5.4: input($2.5)/output($15) per 1M tok + cached($0.25)", () => {
    const cost = computeTextCostMicroUsd(
      "openai",
      "gpt-5.4",
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 1_000_000 }),
    );
    expect(cost).toBe(2_500_000 + 15_000_000 + 250_000);
  });

  it("Gemini gemini-2.5-flash: input($0.3)/output($2.5) per 1M tok", () => {
    const cost = computeTextCostMicroUsd(
      "gemini",
      "gemini-2.5-flash",
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    );
    expect(cost).toBe(300_000 + 2_500_000);
  });

  it("レート未収録のモデルは 0 (例外を投げず記録は継続する設計)", () => {
    const cost = computeTextCostMicroUsd("openai", "unknown-model-xyz", usage({ inputTokens: 100, outputTokens: 100 }));
    expect(cost).toBe(0);
  });

  it("usage 全 0 は cost 0", () => {
    expect(computeTextCostMicroUsd("anthropic", "claude-opus-4-8", usage({}))).toBe(0);
  });
});

describe("claude-sonnet-5 の effective_from (2026-09-01 値上げ、research 確認済み)", () => {
  it("2026-08-31 以前は導入価格 ($2/$10)", () => {
    const rate = findTextRate("anthropic", "claude-sonnet-5", new Date("2026-08-31T23:59:59Z"));
    expect(rate?.inputMicroUsdPerToken).toBe(2);
    expect(rate?.outputMicroUsdPerToken).toBe(10);
  });

  it("2026-09-01 以降は値上げ後 ($3/$15)", () => {
    const rate = findTextRate("anthropic", "claude-sonnet-5", new Date("2026-09-01T00:00:00Z"));
    expect(rate?.inputMicroUsdPerToken).toBe(3);
    expect(rate?.outputMicroUsdPerToken).toBe(15);
  });

  it("過去分の再計算でも effective_from の値が変わらない (レート改定が過去に波及しない)", () => {
    // 2026-07 時点で記録された呼び出しを 2026-10 に再計算しても 2026-07 時点のレートが使われる
    const rateAtRecordTime = findTextRate("anthropic", "claude-sonnet-5", new Date("2026-07-10T00:00:00Z"));
    expect(rateAtRecordTime?.inputMicroUsdPerToken).toBe(2);
  });
});

describe("computeImageCostMicroUsd: トークン課金 (usage あり) / 枚数課金 (フォールバック) の 2 系統", () => {
  it("gpt-image-2: usage (出力トークン) が取れる場合はトークン計算を優先する", () => {
    // input 1,000,000 tok ($8) + output 1,000,000 tok ($30) = $38 = 38,000,000 µUSD
    const cost = computeImageCostMicroUsd("openai", "gpt-image-2", 1, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBe(38_000_000);
  });

  it("gpt-image-2: usage が取れない場合は品質別の枚数課金にフォールバックする (medium)", () => {
    const cost = computeImageCostMicroUsd("openai", "gpt-image-2", 2, undefined, "medium");
    expect(cost).toBe(53_000 * 2);
  });

  it("gpt-image-2: quality 未指定は medium 扱い", () => {
    const cost = computeImageCostMicroUsd("openai", "gpt-image-2", 1, undefined);
    expect(cost).toBe(53_000);
  });

  it("gemini-2.5-flash-image: トークン課金モデルではないため常に枚数課金 ($0.039/枚)", () => {
    const cost = computeImageCostMicroUsd("gemini", "gemini-2.5-flash-image", 3, undefined);
    expect(cost).toBe(39_000 * 3);
  });

  it("レート未収録の画像モデルは 0", () => {
    expect(computeImageCostMicroUsd("gemini", "unknown-image-model", 1, undefined)).toBe(0);
  });
});

describe("estimateTextCostMicroUsd / estimateImageCostMicroUsd (予算予約用の事前見積り)", () => {
  it("estimateTextCostMicroUsd はゼロでない概算値を返す (claude-opus-4-8)", () => {
    const estimate = estimateTextCostMicroUsd("anthropic", "claude-opus-4-8", 4000, 4096);
    expect(estimate).toBeGreaterThan(0);
  });

  it("estimateImageCostMicroUsd は n 倍される", () => {
    const one = estimateImageCostMicroUsd("openai", "gpt-image-2", 1, "medium");
    const four = estimateImageCostMicroUsd("openai", "gpt-image-2", 4, "medium");
    expect(four).toBe(one * 4);
  });
});

describe("computeTranscribeCostMicroUsd / estimateAudioMinutesFromBytes", () => {
  it("音声バイト長から分数を推定し、$/分レートを掛ける (gpt-4o-transcribe)", () => {
    const bytesFor1Minute = 60 * (16_000 / 8); // 16kbps 相当の 1 分ぶん
    const minutes = estimateAudioMinutesFromBytes(bytesFor1Minute);
    expect(minutes).toBeCloseTo(1, 5);

    const cost = computeTranscribeCostMicroUsd("openai", "gpt-4o-transcribe", bytesFor1Minute);
    expect(cost).toBe(6_000); // $0.006/分 = 6,000 µUSD
  });

  it("gpt-4o-mini-transcribe は gpt-4o-transcribe の半額レート", () => {
    const bytesFor1Minute = 60 * (16_000 / 8);
    const cost = computeTranscribeCostMicroUsd("openai", "gpt-4o-mini-transcribe", bytesFor1Minute);
    expect(cost).toBe(3_000);
  });
});
