import { describe, expect, it } from "vitest";

import { zSetTextReq } from "@/modules/page-media/contracts";
import { textSlotByKey } from "@/modules/page-media/text-registry";

/**
 * canonical: docs/design/visual-text-editor.md §3 (検証: registry 外 slot_key → KMB-E107 /
 * maxLen 超過・kind 違反 → KMB-E101) / §8。
 */

describe("zSetTextReq: slot_key は TEXT_REGISTRY のキーに限定する", () => {
  it("registry に存在する slot_key は許可される", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.cta.note", text: "テスト文言です。" });
    expect(result.success).toBe(true);
  });

  it("registry に存在しない slot_key は拒否される (KMB-E107 相当)", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.nonexistent", text: "テスト" });
    expect(result.success).toBe(false);
  });

  it("text は null を許可する (既定に戻す)。null のときは maxLen/kind 検証をスキップする", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.cta.note", text: null });
    expect(result.success).toBe(true);
  });

  it("未知のキーを含むオブジェクトは strict() により拒否される", () => {
    const result = zSetTextReq.safeParse({
      slot_key: "home.cta.note",
      text: "テスト",
      extra: "not-allowed",
    });
    expect(result.success).toBe(false);
  });
});

describe("zSetTextReq: kind=text の maxLen / 改行検証 (shared.cta.consult, maxLen=8)", () => {
  it("maxLen ちょうど (8 文字) は許可される", () => {
    const slot = textSlotByKey("shared.cta.consult")!;
    expect(slot.maxLen).toBe(8);
    const result = zSetTextReq.safeParse({ slot_key: "shared.cta.consult", text: "12345678" }); // 8 文字
    expect(result.success).toBe(true);
  });

  it("maxLen 超過は拒否される (KMB-E101 相当)", () => {
    const result = zSetTextReq.safeParse({
      slot_key: "shared.cta.consult",
      text: "12345678901", // 11 文字 > 8
    });
    expect(result.success).toBe(false);
  });

  it("kind=text は改行を含むと拒否される (KMB-E101 相当)", () => {
    const result = zSetTextReq.safeParse({ slot_key: "shared.cta.consult", text: "相談\nする" });
    expect(result.success).toBe(false);
  });

  it("kind=text で改行を含まない短い文字列は許可される", () => {
    const result = zSetTextReq.safeParse({ slot_key: "shared.cta.consult", text: "相談する" });
    expect(result.success).toBe(true);
  });
});

describe("zSetTextReq: kind=lines の行数・1 行文字数・全体 maxLen 検証 (home.statement.heading)", () => {
  const slotKey = "home.statement.heading"; // maxLen=90, maxLines=5, maxLineLen=18

  it("行数・1 行文字数・全体 maxLen すべて範囲内なら許可される", () => {
    const result = zSetTextReq.safeParse({
      slot_key: slotKey,
      text: "1行目\n2行目\n3行目",
    });
    expect(result.success).toBe(true);
  });

  it("行数が上限 (5 行) を超えると拒否される", () => {
    const result = zSetTextReq.safeParse({
      slot_key: slotKey,
      text: "a\nb\nc\nd\ne\nf",
    });
    expect(result.success).toBe(false);
  });

  it("1 行の文字数が上限 (18 字) を超えると拒否される", () => {
    const result = zSetTextReq.safeParse({
      slot_key: slotKey,
      text: `${"あ".repeat(19)}\n2行目`,
    });
    expect(result.success).toBe(false);
  });

  it("全体の文字数が maxLen (90) を超えると拒否される", () => {
    const longLine = "あ".repeat(18);
    const text = Array.from({ length: 5 }, () => longLine).join("\n"); // 18*5 + 改行4 = 94 > 90
    const result = zSetTextReq.safeParse({ slot_key: slotKey, text });
    expect(result.success).toBe(false);
  });
});

describe("zSetTextReq: kind=multiline の maxLen 検証 (chrome.footer.tagline, maxLen=80)", () => {
  it("maxLen 以内は許可される", () => {
    const result = zSetTextReq.safeParse({
      slot_key: "chrome.footer.tagline",
      text: "短い紹介文です。",
    });
    expect(result.success).toBe(true);
  });

  it("maxLen 超過は拒否される", () => {
    const result = zSetTextReq.safeParse({
      slot_key: "chrome.footer.tagline",
      text: "あ".repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it("multiline は改行 (段落区切り \\n\\n) を含んでも kind=text のような拒否はされない", () => {
    const result = zSetTextReq.safeParse({
      slot_key: "chrome.footer.tagline",
      text: "1段落目。\n\n2段落目。",
    });
    expect(result.success).toBe(true);
  });
});

/**
 * T1 検証タスク追加分 (エッジケース)。
 * - 絵文字・サロゲートペア: registry コメント (text-registry.ts の maxLen フィールド)
 *   「書記素クラスタ数ではなく string.length で判定」を独立に裏取りする。
 * - 空文字列: v1.3 で下限チェックを追加し、trim 後に空 (または空白のみ) のテキストは
 *   KMB-E101 相当で拒否するようにした (platform の zTitle 等が .min(1) を強制する規律との
 *   整合。旧「KNOWN GAP」テストは本修正で解消済みのため期待値を反転した)。
 * - \r\n: v1.3 で normalizeLineEndings による正規化を追加した (zSetTextReq の text
 *   transform / facade.setText の両方)。\r\n・単独 \r は保存前に \n へ統一され、
 *   maxLines/maxLineLen/kind の検証は正規化後のテキストに対して行われる。
 */
describe("zSetTextReq: エッジケース (絵文字・サロゲートペア)", () => {
  it("サロゲートペア絵文字は string.length で 1 文字あたり 2 とカウントされる (書記素クラスタ数ではない)", () => {
    const slot = textSlotByKey("shared.cta.consult")!; // maxLen = 8
    const fourEmoji = "😀😀😀😀"; // 見た目 4 文字だが string.length は 8 (サロゲートペア×4)
    expect(fourEmoji.length).toBe(8);
    expect(zSetTextReq.safeParse({ slot_key: slot.key, text: fourEmoji }).success).toBe(true);
  });

  it("5 個目の絵文字で string.length が 10 になり maxLen (8) 超過として拒否される", () => {
    const slot = textSlotByKey("shared.cta.consult")!; // maxLen = 8
    const fiveEmoji = "😀😀😀😀😀"; // string.length = 10 > 8 (見た目は 5 文字のみ)
    expect(fiveEmoji.length).toBe(10);
    expect(zSetTextReq.safeParse({ slot_key: slot.key, text: fiveEmoji }).success).toBe(false);
  });
});

describe("zSetTextReq: エッジケース (空文字列は拒否される、v1.3)", () => {
  it("空文字列は KMB-E101 相当で拒否される (下限チェック追加、旧 KNOWN GAP を解消)", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.cta.note", text: "" });
    expect(result.success).toBe(false);
  });

  it("空白のみ (trim 後に空) の文字列も拒否される", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.cta.note", text: "   　　" }); // 半角+全角スペースのみ
    expect(result.success).toBe(false);
  });

  it("空白を含むが trim 後に非空な文字列は許可される", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.cta.note", text: "  テスト文言  " });
    expect(result.success).toBe(true);
  });

  it("null (既定に戻す) は引き続き空文字列チェックの対象外", () => {
    const result = zSetTextReq.safeParse({ slot_key: "home.cta.note", text: null });
    expect(result.success).toBe(true);
  });
});

describe("zSetTextReq: エッジケース (\\r\\n 改行の正規化、v1.3)", () => {
  it("\\r\\n は保存前に \\n へ正規化される (kind=lines の行分割・行長検証は正規化後に評価)", () => {
    const slot = textSlotByKey("home.statement.heading")!; // kind=lines, maxLineLen=18
    const crlfText = "1行目\r\n2行目\r\n3行目";
    const result = zSetTextReq.safeParse({ slot_key: slot.key, text: crlfText });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe("1行目\n2行目\n3行目");
      const lines = result.data.text!.split("\n");
      expect(lines[0].endsWith("\r")).toBe(false);
      expect(lines).toEqual(["1行目", "2行目", "3行目"]);
    }
  });

  it("単独の \\r (旧 Mac 改行) も \\n へ正規化される", () => {
    const slot = textSlotByKey("home.statement.heading")!;
    const result = zSetTextReq.safeParse({ slot_key: slot.key, text: "1行目\r2行目" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe("1行目\n2行目");
    }
  });

  it("正規化後の行数で maxLines を評価する (\\r\\n 3 行 → 正規化後も 3 行で 5 行以内のため許可)", () => {
    const slot = textSlotByKey("home.statement.heading")!; // maxLines=5
    const result = zSetTextReq.safeParse({
      slot_key: slot.key,
      text: "1行目\r\n2行目\r\n3行目\r\n4行目\r\n5行目\r\n6行目", // 6 行 > 5
    });
    expect(result.success).toBe(false);
  });

  it("kind=text で \\r\\n を含む場合は正規化後の \\n 検出により改行として拒否される", () => {
    const result = zSetTextReq.safeParse({ slot_key: "shared.cta.consult", text: "a\r\nb" });
    expect(result.success).toBe(false);
  });
});
