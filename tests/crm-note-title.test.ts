import { describe, expect, it } from "vitest";

import { deriveNoteTitle } from "@/modules/crm/internal/activity";

/**
 * canonical: docs/design/crm-suite/01-crm.md §6.6 末尾 (note のタイトル自動生成)。
 * 本文 1 行目の先頭 60 字。空なら「メモ」。
 */
describe("deriveNoteTitle", () => {
  it("60 字以内の 1 行はそのまま使う", () => {
    expect(deriveNoteTitle("田中様に折り返し電話")).toBe("田中様に折り返し電話");
  });

  it("60 字を超える場合は先頭 60 字に切り詰める", () => {
    const long = "あ".repeat(80);
    const title = deriveNoteTitle(long);
    expect(title).toBe("あ".repeat(60));
    expect(title.length).toBe(60);
  });

  it("ちょうど 60 字は切り詰めずそのまま", () => {
    const exact = "あ".repeat(60);
    expect(deriveNoteTitle(exact)).toBe(exact);
  });

  it("空文字は「メモ」になる", () => {
    expect(deriveNoteTitle("")).toBe("メモ");
  });

  it("null は「メモ」になる", () => {
    expect(deriveNoteTitle(null)).toBe("メモ");
  });

  it("空白のみの本文は「メモ」になる (trim 後に空)", () => {
    expect(deriveNoteTitle("   ")).toBe("メモ");
  });

  it("改行のみの本文は「メモ」になる", () => {
    expect(deriveNoteTitle("\n\n\n")).toBe("メモ");
    expect(deriveNoteTitle("\r\n")).toBe("メモ");
  });

  it("複数行の本文は 1 行目のみを使う (2 行目以降は無視)", () => {
    expect(deriveNoteTitle("見積の件で連絡\n電話番号: 090-1234-5678")).toBe("見積の件で連絡");
  });

  it("1 行目が空行で 2 行目に内容がある場合も「メモ」になる (1 行目のみ採用の仕様どおり)", () => {
    expect(deriveNoteTitle("\n本題はこちら")).toBe("メモ");
  });

  it("1 行目前後の空白は trim される", () => {
    expect(deriveNoteTitle("  見積送付済み  \n詳細は別紙")).toBe("見積送付済み");
  });

  it("CRLF 改行も正しく 1 行目を切り出す", () => {
    expect(deriveNoteTitle("電話対応メモ\r\n次回は来週")).toBe("電話対応メモ");
  });
});
