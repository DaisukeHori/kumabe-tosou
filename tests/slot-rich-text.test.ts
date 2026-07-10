import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/visual-text-editor-v2.md §3.4 (SlotRichText の props 契約) / §5
 * Wave 0f。tests/visual-actions.test.ts の vi.mock 方式に倣い、TEXT_REGISTRY に `rich` kind の
 * スロットがまだ 1 件も登録されていない (Wave 0 は機構のみ、登録は Wave 1) ため、
 * `@/modules/page-media/facade` を最小限のフィクスチャへ差し替えてテストする。
 *
 * .test.ts の都合上 (vitest.config.ts の include は *.test.ts のみ) JSX は使わず
 * React.createElement を直接呼ぶ (tests/slot-text.test.ts に倣う)。
 */

const { RICH_SLOT, RICH_SLOT_WITH_MAXLINES, TEXT_SLOT } = vi.hoisted(() => ({
  RICH_SLOT: {
    key: "test.rich.body",
    page: "test",
    route: "/test",
    label: "テスト / rich 本文",
    kind: "rich" as const,
    maxLen: 300,
    defaultText: "下地は`#800`で研ぎます。",
  },
  RICH_SLOT_WITH_MAXLINES: {
    key: "test.rich.paragraphs",
    page: "test",
    route: "/test",
    label: "テスト / rich 段落",
    kind: "rich" as const,
    maxLen: 300,
    defaultText: "1段落目。",
    maxLines: 2,
  },
  TEXT_SLOT: {
    key: "test.text.plain",
    page: "test",
    route: "/test",
    label: "テスト / plain",
    kind: "text" as const,
    maxLen: 20,
    defaultText: "plain",
  },
}));

vi.mock("@/modules/page-media/facade", () => ({
  TEXT_REGISTRY: [RICH_SLOT, RICH_SLOT_WITH_MAXLINES, TEXT_SLOT],
}));

import { SlotRichText } from "@/components/site/slot-rich-text";

describe("SlotRichText: data-editable-text の出し分け", () => {
  it("editMode=true のとき data-editable-text=slotKey を出力する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.body",
        resolved: { text: "下地は`#800`で研ぎます。", isDefault: true },
        editMode: true,
      }),
    );
    expect(html).toContain('data-editable-text="test.rich.body"');
  });

  it("editMode=false のとき data-editable-text を出力しない", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.body",
        resolved: { text: "下地は`#800`で研ぎます。", isDefault: true },
        editMode: false,
      }),
    );
    expect(html).not.toContain("data-editable-text");
  });
});

describe("SlotRichText: 単一段落 (inline flow に埋め込み可能)", () => {
  it("as='span' で単一段落を inline 要素として描画し、<p> を生成しない", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.body",
        resolved: { text: "下地は`#800`で研ぎます。", isDefault: true },
        editMode: false,
        as: "span",
      }),
    );
    expect(html.startsWith("<span")).toBe(true);
    expect(html).not.toContain("<p>");
    expect(html).toContain('<span class="font-mono">#800</span>');
  });

  it("as 未指定の既定タグは span である", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.body",
        resolved: { text: "plain body", isDefault: true },
        editMode: false,
      }),
    );
    expect(html.startsWith("<span")).toBe(true);
  });

  it("className を反映する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.body",
        resolved: { text: "plain body", isDefault: true },
        editMode: false,
        className: "text-sm",
      }),
    );
    expect(html).toContain('class="text-sm"');
  });
});

describe("SlotRichText: 複数段落 (root は常に div)", () => {
  it("\\n\\n を含む場合、root が div になり as prop を無視する (multiline と同型)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.paragraphs",
        resolved: { text: "1段落目。\n\n2段落目。", isDefault: false },
        editMode: false,
        as: "span",
      }),
    );
    expect(html.startsWith("<div")).toBe(true);
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
    expect(html).toContain("1段落目。");
    expect(html).toContain("2段落目。");
  });

  it("editMode=true のとき複数段落の root div に data-editable-text を出力する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotRichText, {
        slotKey: "test.rich.paragraphs",
        resolved: { text: "1段落目。\n\n2段落目。", isDefault: false },
        editMode: true,
      }),
    );
    expect(html).toContain('data-editable-text="test.rich.paragraphs"');
  });
});

describe("SlotRichText: 未知の slotKey / kind 誤用", () => {
  it("TEXT_REGISTRY に存在しない slotKey は例外を投げる", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(SlotRichText, {
          slotKey: "test.nonexistent",
          resolved: { text: "x", isDefault: true },
          editMode: false,
        }),
      ),
    ).toThrow();
  });

  it("kind=\"rich\" でない slotKey (kind=text) を渡すと例外を投げる (誤用検出)", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(SlotRichText, {
          slotKey: "test.text.plain",
          resolved: { text: "plain", isDefault: true },
          editMode: false,
        }),
      ),
    ).toThrow();
  });
});
