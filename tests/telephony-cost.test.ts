import { describe, expect, it } from "vitest";

import {
  TWILIO_RATES_MICRO_USD_PER_MIN,
  USD_JPY_DISPLAY_RATE,
  estimateTwilioCostMicroUsd,
  formatCostEstimateJpy,
} from "@/modules/telephony/internal/cost";

/**
 * internal/cost.ts の単体テスト (canonical: docs/design/crm-suite/04-telephony.md §3.2 末尾の
 * 単価表 + §6.3 手順4 + §6.6)。issue-58 計画書 成果物5 のテスト対象:
 * 単価表 × handling3種 (forwarded/voicemail/after_hours_voicemail — 後2者は同一計算式になることを
 * 明示的に確認) / 分単位切り上げ / 0秒 / µUSD→¥表示換算。
 */

describe("estimateTwilioCostMicroUsd (§3.2 単価表 / §6.3 手順4)", () => {
  it("forwarded: 着信料 + 録音料 + 転送レグ料金 を計上する (60秒ちょうど=1分)", () => {
    const result = estimateTwilioCostMicroUsd(60, "forwarded");
    const expected =
      TWILIO_RATES_MICRO_USD_PER_MIN.inbound_050 +
      TWILIO_RATES_MICRO_USD_PER_MIN.recording +
      TWILIO_RATES_MICRO_USD_PER_MIN.forward_leg_mobile;
    expect(result).toBe(expected);
  });

  it("voicemail: 着信料 + 録音料のみ (転送レグ料金は加算しない)", () => {
    const result = estimateTwilioCostMicroUsd(60, "voicemail");
    const expected = TWILIO_RATES_MICRO_USD_PER_MIN.inbound_050 + TWILIO_RATES_MICRO_USD_PER_MIN.recording;
    expect(result).toBe(expected);
  });

  it("after_hours_voicemail: voicemail と完全に同一の計算式になる (転送レグなしの点で forwarded と分岐する)", () => {
    const voicemail = estimateTwilioCostMicroUsd(125, "voicemail");
    const afterHoursVoicemail = estimateTwilioCostMicroUsd(125, "after_hours_voicemail");
    expect(afterHoursVoicemail).toBe(voicemail);
    // forwarded とは異なる計算式であることも合わせて確認する (転送レグ料金の有無で必ず差が出る)。
    const forwarded = estimateTwilioCostMicroUsd(125, "forwarded");
    expect(forwarded).not.toBe(voicemail);
  });

  it("分単位切り上げ: 61秒は2分として計算する (60秒ちょうどの1分計算とは異なる)", () => {
    const oneMinute = estimateTwilioCostMicroUsd(60, "voicemail");
    const justOverOneMinute = estimateTwilioCostMicroUsd(61, "voicemail");
    const twoMinutes = TWILIO_RATES_MICRO_USD_PER_MIN.inbound_050 * 2 + TWILIO_RATES_MICRO_USD_PER_MIN.recording * 2;
    expect(justOverOneMinute).toBe(twoMinutes);
    expect(justOverOneMinute).not.toBe(oneMinute);
  });

  it("0秒: 0 を返す (0秒ガード。handling を問わず常に0)", () => {
    expect(estimateTwilioCostMicroUsd(0, "voicemail")).toBe(0);
    expect(estimateTwilioCostMicroUsd(0, "forwarded")).toBe(0);
    expect(estimateTwilioCostMicroUsd(0, "after_hours_voicemail")).toBe(0);
    expect(estimateTwilioCostMicroUsd(0, null)).toBe(0);
  });

  it("負のduration (想定外入力) も0秒と同様に0を返す (下限ガード)", () => {
    expect(estimateTwilioCostMicroUsd(-5, "voicemail")).toBe(0);
  });

  it("handling=null (missed 等): 転送レグ料金を加算しない (voicemail と同じ計算式になる)", () => {
    const result = estimateTwilioCostMicroUsd(30, null);
    const expected = TWILIO_RATES_MICRO_USD_PER_MIN.inbound_050 + TWILIO_RATES_MICRO_USD_PER_MIN.recording;
    expect(result).toBe(expected);
  });
});

describe("formatCostEstimateJpy (§6.6 概算コスト¥表示換算)", () => {
  it("µUSD 合計 × USD_JPY_DISPLAY_RATE / 1_000_000 を四捨五入した整数円を返す", () => {
    // 1_000_000 µUSD = $1 = USD_JPY_DISPLAY_RATE 円
    expect(formatCostEstimateJpy(1_000_000, 0)).toBe(USD_JPY_DISPLAY_RATE);
    expect(formatCostEstimateJpy(0, 1_000_000)).toBe(USD_JPY_DISPLAY_RATE);
    // twilio分・ai分は加算されてから換算される
    expect(formatCostEstimateJpy(500_000, 500_000)).toBe(USD_JPY_DISPLAY_RATE);
  });

  it("四捨五入: 0.5円未満は切り捨て、0.5円以上は切り上げになる", () => {
    // 3_333 µUSD * 150 / 1_000_000 = 0.49995 → 0円
    expect(formatCostEstimateJpy(3_333, 0)).toBe(0);
    // 3_334 µUSD * 150 / 1_000_000 = 0.5001 → 1円
    expect(formatCostEstimateJpy(3_334, 0)).toBe(1);
  });

  it("0µUSD (twilio/ai とも0) → 0円", () => {
    expect(formatCostEstimateJpy(0, 0)).toBe(0);
  });

  it("大きい額でも整数円に丸められる (小数を含まない)", () => {
    const result = formatCostEstimateJpy(12_345_678, 9_876_543);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(Math.round(((12_345_678 + 9_876_543) * USD_JPY_DISPLAY_RATE) / 1_000_000));
  });
});
