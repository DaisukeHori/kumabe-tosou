import { describe, expect, it } from "vitest";

import { nfc, zExcerpt, zShortText, zTitle } from "@/modules/platform/contracts";
import { zXTweet } from "@/modules/ai-studio/contracts";
import { zInquiryInput } from "@/modules/inquiry/contracts";

describe("platform/contracts nfc + 共通スカラー", () => {
  it("NFC 正規化: 濁点分解形 (か+゛) を正規化済み (が) にそろえる", () => {
    const decomposed = "が"; // か + COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK
    const composed = "が"; // が
    expect(nfc(decomposed)).toBe(composed);
  });

  it("制御文字を除去するが改行・タブは保持する", () => {
    const tab = String.fromCharCode(9);
    const lf = String.fromCharCode(10);
    const nul = String.fromCharCode(0);
    const unitSep = String.fromCharCode(31);
    const input = "a" + nul + "b" + unitSep + "c" + tab + "d" + lf + "e";
    const expected = "a" + "b" + "c" + tab + "d" + lf + "e";
    expect(nfc(input)).toBe(expected);
  });

  it("zTitle: 120 文字はOK、121 文字はNG (境界値)", () => {
    const ok = "あ".repeat(120);
    const ng = "あ".repeat(121);
    expect(zTitle.safeParse(ok).success).toBe(true);
    expect(zTitle.safeParse(ng).success).toBe(false);
  });

  it("zTitle: 空文字は NG", () => {
    expect(zTitle.safeParse("").success).toBe(false);
  });

  it("zExcerpt: 300 文字境界", () => {
    expect(zExcerpt.safeParse("あ".repeat(300)).success).toBe(true);
    expect(zExcerpt.safeParse("あ".repeat(301)).success).toBe(false);
  });

  it("絵文字はサロゲートペアで length=2 として数えられる (仕様通りの挙動)", () => {
    // "😀" は UTF-16 で 2 code unit。JS の string.length ベースの検証では 2 文字分としてカウントされる。
    const oneEmoji = "\u{1F600}"; // 😀
    expect(oneEmoji.length).toBe(2);
    expect(zShortText(1).safeParse(oneEmoji).success).toBe(false); // 1文字上限だと絵文字1個でも超過
    expect(zShortText(2).safeParse(oneEmoji).success).toBe(true);
  });
});

describe("ai-studio/contracts zXTweet (重み付き文字数)", () => {
  it("ASCII 280 文字ちょうどはOK、281文字はNG", () => {
    const ok = "a".repeat(280);
    const ng = "a".repeat(281);
    expect(zXTweet.safeParse({ text: ok, media_id: null }).success).toBe(true);
    expect(zXTweet.safeParse({ text: ng, media_id: null }).success).toBe(false);
  });

  it("URL は 23 字固定換算される (実文字数に関わらず)", () => {
    const longUrl = "https://example.com/" + "a".repeat(200); // 実文字数は 220+ だが重みは 23
    const text = `見てください ${longUrl}`;
    const result = zXTweet.safeParse({ text, media_id: null });
    expect(result.success).toBe(true);
  });

  it("空文字は NG", () => {
    expect(zXTweet.safeParse({ text: "", media_id: null }).success).toBe(false);
  });
});

describe("inquiry/contracts zInquiryInput (privacy_agreed)", () => {
  const base = {
    name: "山田太郎",
    email: "test@example.com",
    tel: null,
    inquiry_type: "estimate" as const,
    item: null,
    body: "これはテストのお問い合わせ本文です。",
  };

  it("privacy_agreed=true のみ許可される", () => {
    expect(zInquiryInput.safeParse({ ...base, privacy_agreed: true }).success).toBe(true);
  });

  it("privacy_agreed=false は型レベルで拒否される", () => {
    expect(zInquiryInput.safeParse({ ...base, privacy_agreed: false }).success).toBe(false);
  });

  it("privacy_agreed 欠落は拒否される", () => {
    expect(zInquiryInput.safeParse(base).success).toBe(false);
  });

  it("body は 10 文字未満だと拒否される", () => {
    expect(
      zInquiryInput.safeParse({ ...base, body: "短い", privacy_agreed: true }).success,
    ).toBe(false);
  });
});
