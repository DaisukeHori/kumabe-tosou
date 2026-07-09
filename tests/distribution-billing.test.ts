import { describe, expect, it } from "vitest";

import {
  estimateMediaUploadCostCents,
  estimateXCostCents,
  exceedsMonthlyBillingGuard,
  X_MEDIA_UPLOAD_COST_CENTS,
  X_POST_COST_CENTS,
  X_POST_WITH_URL_COST_CENTS,
} from "@/modules/distribution/internal/billing";

/**
 * canonical: 設計書 §8.2 (課金ガード) / §8.1 (単価: 投稿 $0.015/件, URL 付き $0.20/件)。
 */
describe("estimateXCostCents", () => {
  it("URL なしツイート 1 件は通常単価 (1.5 セント → 整数丸めで 2)", () => {
    expect(estimateXCostCents({ tweetCount: 1, urlCount: 0 })).toBe(Math.round(X_POST_COST_CENTS));
  });

  it("URL 付きツイート 1 件は URL 単価 (20 セント)", () => {
    expect(estimateXCostCents({ tweetCount: 1, urlCount: 1 })).toBe(X_POST_WITH_URL_COST_CENTS);
  });

  it("スレッド 3 件中 1 件のみ URL 付き", () => {
    const result = estimateXCostCents({ tweetCount: 3, urlCount: 1 });
    const expected = Math.round(2 * X_POST_COST_CENTS + 1 * X_POST_WITH_URL_COST_CENTS);
    expect(result).toBe(expected);
  });

  it("tweetCount=0 は 0 セント", () => {
    expect(estimateXCostCents({ tweetCount: 0, urlCount: 0 })).toBe(0);
  });

  it("urlCount が tweetCount を超える異常入力は tweetCount にクランプされる", () => {
    const result = estimateXCostCents({ tweetCount: 2, urlCount: 5 });
    expect(result).toBe(Math.round(2 * X_POST_WITH_URL_COST_CENTS));
  });

  it("負数入力は 0 として扱われる", () => {
    expect(estimateXCostCents({ tweetCount: -3, urlCount: -1 })).toBe(0);
  });

  it("mediaCount 省略時は画像コストが加算されない (従来どおりの計算結果)", () => {
    expect(estimateXCostCents({ tweetCount: 1, urlCount: 0 })).toBe(
      estimateXCostCents({ tweetCount: 1, urlCount: 0, mediaCount: 0 }),
    );
  });

  it("mediaCount を渡しても現行単価 (X_MEDIA_UPLOAD_COST_CENTS=0) では合計コストは変わらない " +
    "(research: media upload 自体の別建て課金は docs 記載なし、確度ある事実のみ反映)", () => {
    expect(X_MEDIA_UPLOAD_COST_CENTS).toBe(0);
    expect(estimateXCostCents({ tweetCount: 1, urlCount: 0, mediaCount: 4 })).toBe(
      estimateXCostCents({ tweetCount: 1, urlCount: 0 }),
    );
  });
});

describe("estimateMediaUploadCostCents (画像アップロード分の課金加算フック)", () => {
  it("costCentsPerMedia 省略時は canonical 定数 X_MEDIA_UPLOAD_COST_CENTS を使う (現行 0)", () => {
    expect(estimateMediaUploadCostCents(4)).toBe(0);
  });

  it("costCentsPerMedia を明示指定すると mediaCount との積になる (将来の単価改定時の計算検証)", () => {
    expect(estimateMediaUploadCostCents(3, 5)).toBe(15);
  });

  it("負数の mediaCount は 0 として扱われる", () => {
    expect(estimateMediaUploadCostCents(-2, 5)).toBe(0);
  });

  it("小数の costCentsPerMedia は整数丸めされる", () => {
    expect(estimateMediaUploadCostCents(3, 1.4)).toBe(Math.round(3 * 1.4));
  });
});

describe("exceedsMonthlyBillingGuard (境界値)", () => {
  it("ちょうど上限は超過とみなさない (境界値)", () => {
    expect(
      exceedsMonthlyBillingGuard({ currentMonthCentsSum: 80, additionalCents: 20, limitCents: 100 }),
    ).toBe(false);
  });

  it("上限を 1 セントでも超えたら超過", () => {
    expect(
      exceedsMonthlyBillingGuard({ currentMonthCentsSum: 80, additionalCents: 21, limitCents: 100 }),
    ).toBe(true);
  });

  it("既に current だけで上限超過している場合も超過 (additional=0)", () => {
    expect(
      exceedsMonthlyBillingGuard({ currentMonthCentsSum: 150, additionalCents: 0, limitCents: 100 }),
    ).toBe(true);
  });

  it("上限 0 (運用上限を絞り切った場合) は追加コストが正なら常に超過", () => {
    expect(exceedsMonthlyBillingGuard({ currentMonthCentsSum: 0, additionalCents: 1, limitCents: 0 })).toBe(
      true,
    );
  });

  it("追加コスト 0 かつ current も 0 なら超過しない", () => {
    expect(exceedsMonthlyBillingGuard({ currentMonthCentsSum: 0, additionalCents: 0, limitCents: 0 })).toBe(
      false,
    );
  });
});
