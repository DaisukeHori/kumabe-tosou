import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlotText } from "@/components/site/slot-text";

/**
 * canonical: docs/design/visual-text-editor.md §4.1 (SlotText の props 契約) / §4.2
 * (dangerouslySetInnerHTML 禁止 = React の通常レンダリングでエスケープされる)。
 *
 * .test.ts の都合上 (vitest.config.ts の include は *.test.ts のみ) JSX は使わず
 * React.createElement を直接呼ぶ (tests/slot-image-placeholder.test.ts に倣う)。
 */

describe("SlotText: kind=text", () => {
  const resolved = { text: "テスト文言です。", isDefault: true };

  it("editMode=false のとき data-editable-text を出力しない", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, { slotKey: "home.cta.note", resolved, editMode: false }),
    );
    expect(html).toContain("テスト文言です。");
    expect(html).not.toContain("data-editable-text");
  });

  it("editMode=true のとき data-editable-text=slotKey を出力する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, { slotKey: "home.cta.note", resolved, editMode: true }),
    );
    expect(html).toContain('data-editable-text="home.cta.note"');
  });

  it("既定タグは span である", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, { slotKey: "home.cta.note", resolved, editMode: false }),
    );
    expect(html.startsWith("<span")).toBe(true);
  });

  it("as prop で任意のタグを指定できる", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, { slotKey: "home.cta.note", resolved, editMode: false, as: "h2" }),
    );
    expect(html.startsWith("<h2")).toBe(true);
  });

  it("className を反映する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "home.cta.note",
        resolved,
        editMode: false,
        className: "text-xs",
      }),
    );
    expect(html).toContain('class="text-xs"');
  });

  it("テキストは通常の React レンダリングでエスケープされる (dangerouslySetInnerHTML 禁止)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "home.cta.note",
        resolved: { text: "<b>注入テスト</b>", isDefault: false },
        editMode: false,
      }),
    );
    expect(html).not.toContain("<b>注入テスト</b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("SlotText: kind=lines", () => {
  it("renderLines 未指定なら行を <br/> で結合する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "home.statement.heading",
        resolved: { text: "1行目\n2行目\n3行目", isDefault: false },
        editMode: false,
      }),
    );
    expect(html).toContain("1行目");
    expect(html).toContain("2行目");
    expect(html).toContain("3行目");
    expect((html.match(/<br\/?>/g) ?? []).length).toBe(2);
  });

  it("renderLines を指定すると呼び出し側の装飾で描画される", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "home.statement.heading",
        resolved: { text: "1行目\n2行目", isDefault: false },
        editMode: false,
        renderLines: (lines: string[]) =>
          lines.map((line, i) => createElement("em", { key: i, "data-line": i }, line)),
      }),
    );
    expect(html).toContain('data-line="0"');
    expect(html).toContain('data-line="1"');
    expect(html).toContain("<em");
    expect(html).not.toContain("<br");
  });

  it("既定タグは span で、editMode=true のとき data-editable-text を出力する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "home.statement.heading",
        resolved: { text: "1行目\n2行目", isDefault: false },
        editMode: true,
      }),
    );
    expect(html.startsWith("<span")).toBe(true);
    expect(html).toContain('data-editable-text="home.statement.heading"');
  });

  it("行のテキストも通常の React レンダリングでエスケープされる", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "home.statement.heading",
        resolved: { text: "<i>a</i>\n2行目", isDefault: false },
        editMode: false,
      }),
    );
    expect(html).not.toContain("<i>a</i>");
    expect(html).toContain("&lt;i&gt;");
  });
});

describe("SlotText: kind=multiline", () => {
  it("段落 (\\n\\n 区切り) ごとに <p> を生成する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "chrome.footer.tagline",
        resolved: { text: "1段落目。\n\n2段落目。", isDefault: false },
        editMode: false,
      }),
    );
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
    expect(html).toContain("1段落目。");
    expect(html).toContain("2段落目。");
  });

  it("root は常に div (as prop を無視、<p><p> の不正 HTML を回避する v1.1 仕様)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "chrome.footer.tagline",
        resolved: { text: "1段落目。", isDefault: false },
        editMode: false,
        as: "p",
      }),
    );
    expect(html.startsWith("<div")).toBe(true);
    expect(html).not.toContain("<p><p");
  });

  it("editMode=true のとき root の div に data-editable-text を出力する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotText, {
        slotKey: "chrome.footer.tagline",
        resolved: { text: "1段落目。", isDefault: false },
        editMode: true,
      }),
    );
    expect(html).toContain('data-editable-text="chrome.footer.tagline"');
  });
});

describe("SlotText: 未知の slotKey", () => {
  it("TEXT_REGISTRY に存在しない slotKey は例外を投げる (SlotImage と同じ安全側の方針)", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(SlotText, {
          slotKey: "home.nonexistent",
          resolved: { text: "x", isDefault: true },
          editMode: false,
        }),
      ),
    ).toThrow();
  });
});
