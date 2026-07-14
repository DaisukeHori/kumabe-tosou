import { describe, expect, it } from "vitest";

import { generateWorkTypeKey } from "@/app/admin/calendar/types/work-type-key";

/**
 * canonical: GitHub Issue #97 (作業種別マスタ「key」フィールドのUI改善)。
 * generateWorkTypeKey は zWorkTypeInput.key の regex /^[a-z0-9_]{2,30}$/
 * (src/modules/scheduling/contracts.ts) に常に適合する値を返す純関数。
 */
const KEY_RE = /^[a-z0-9_]{2,30}$/;

describe("generateWorkTypeKey: ASCII ラベル → 意味的スラッグ", () => {
  it("英字のみ → 小文字化", () => {
    expect(generateWorkTypeKey("Painting")).toBe("painting");
  });

  it("空白を含む → アンダースコア区切り", () => {
    expect(generateWorkTypeKey("Wall Prep")).toBe("wall_prep");
  });

  it("ハイフンを含む → アンダースコアへ統一", () => {
    expect(generateWorkTypeKey("top-coat")).toBe("top_coat");
  });

  it("英数字混在も許容する", () => {
    expect(generateWorkTypeKey("Coat 2nd")).toBe("coat_2nd");
  });
});

describe("generateWorkTypeKey: 非 ASCII / 短すぎる入力 → フォールバック", () => {
  it("日本語ラベルは wt_ プレフィックスのフォールバックへ", () => {
    const key = generateWorkTypeKey("研磨");
    expect(key.startsWith("wt_")).toBe(true);
    expect(key).toMatch(KEY_RE);
  });

  it("1文字の ASCII ラベル (スラッグ化すると2文字未満) もフォールバックへ", () => {
    const key = generateWorkTypeKey("A");
    expect(key.startsWith("wt_")).toBe(true);
    expect(key).toMatch(KEY_RE);
  });

  it("記号/アンダースコアのみのラベルもフォールバックへ", () => {
    const key = generateWorkTypeKey("___");
    expect(key.startsWith("wt_")).toBe(true);
    expect(key).toMatch(KEY_RE);
  });

  it("空文字・空白のみもフォールバックへ (常に regex 適合を返す)", () => {
    expect(generateWorkTypeKey("")).toMatch(KEY_RE);
    expect(generateWorkTypeKey("   ")).toMatch(KEY_RE);
  });
});

describe("generateWorkTypeKey: 出力は常に regex 適合 + 30文字以内", () => {
  const samples = [
    "Sanding",
    "研磨",
    "下地処理 Primer 20260101",
    "A".repeat(50),
    "日本語だけの表示名です",
    "  spaced  out  ",
    "🎨絵文字入り",
  ];

  for (const label of samples) {
    it(`"${label.slice(0, 20)}" → regex 適合 & 30文字以内`, () => {
      const key = generateWorkTypeKey(label);
      expect(key).toMatch(KEY_RE);
      expect(key.length).toBeLessThanOrEqual(30);
      expect(key.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("50文字の ASCII ラベルは30文字にクランプされる", () => {
    const key = generateWorkTypeKey("a".repeat(50));
    expect(key).toBe("a".repeat(30));
  });
});
