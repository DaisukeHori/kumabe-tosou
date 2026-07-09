import { describe, expect, it } from "vitest";

import { textEditableAttrs } from "@/components/site/editable-attrs";

/**
 * canonical: docs/design/visual-text-editor.md §4.1 (data-editable-text は
 * editMode===true のときだけ出力する — 画像側 editable-attrs.ts の構造的保証と同型)。
 */

describe("textEditableAttrs (SlotText: テキストスロット)", () => {
  it("editMode=false のときは空オブジェクト (data 属性のコードパス自体が無い)", () => {
    expect(textEditableAttrs("home.cta.note", false)).toEqual({});
    expect(textEditableAttrs("home.statement.heading", false)).toEqual({});
  });

  it("editMode=true のとき data-editable-text=slotKey を出力する", () => {
    expect(textEditableAttrs("home.cta.note", true)).toEqual({
      "data-editable-text": "home.cta.note",
    });
  });

  it("slotKey が異なれば出力値もそのスロットキーになる", () => {
    expect(textEditableAttrs("shared.cta.consult", true)).toEqual({
      "data-editable-text": "shared.cta.consult",
    });
  });
});
