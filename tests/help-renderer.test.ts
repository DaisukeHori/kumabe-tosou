import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HelpRenderer, HelpToc } from "@/help/renderer";
import type { HelpDoc } from "@/help/types";

/**
 * docs/design/admin-help/README.md §3: ヘルプ本文は 7 構成をこの順番で描く。
 * §4: 注釈は元画像ピクセル座標 → SVG オーバーレイ (赤枠・矢印・番号バッジ)。
 */
const shot = {
  src: "/help/sample/01-list.png",
  alt: "サンプル画面",
  width: 1000,
  height: 600,
  caption: "サンプルの説明",
  annotations: [
    { kind: "box" as const, x: 10, y: 20, w: 300, h: 100, number: 1 },
    { kind: "arrow" as const, x: 400, y: 300, toX: 600, toY: 320, label: "ここへ" },
    { kind: "badge" as const, x: 700, y: 500, number: 2 },
  ],
};

const doc: HelpDoc = {
  slug: "sample",
  title: "サンプル画面",
  adminPath: "/admin/sample",
  summary: ["これができます"],
  flow: [{ step: "開く", where: "メニュー", result: "一覧が出ます" }],
  sections: [
    {
      id: "list",
      heading: "一覧の見方",
      body: ["ここは **太字** を含む説明です。"],
      screenshot: shot,
      items: [{ number: 1, name: "検索欄", what: "名前で探せます", affects: "一覧の並びが変わります" }],
      relations: [{ label: "顧客", href: "/admin/customers", why: "ここから移動します" }],
    },
  ],
  useCases: [
    {
      persona: "sato",
      title: "こんなとき",
      situation: "こういう状況",
      steps: [{ action: "押す", where: "右上", result: "保存されます" }],
      outcome: "終わります",
    },
  ],
  faqs: [{ q: "保存できません", a: "入力を確かめてください" }],
  related: [{ label: "顧客", href: "/help/customers" }],
  glossary: [{ term: "下書き", meaning: "まだ公開していない状態です" }],
};

const html = renderToStaticMarkup(createElement(HelpRenderer, { doc }));

describe("HelpRenderer", () => {
  it("7 構成がすべて出る", () => {
    for (const part of ["summary", "flow", "sections", "useCases", "faqs", "related", "glossary"]) {
      expect(html, `${part} が描かれていません`).toContain(`data-help-part="${part}"`);
    }
  });

  it("7 構成が設計書の順番で並ぶ", () => {
    const order = ["summary", "flow", "sections", "useCases", "faqs", "related", "glossary"].map(
      (part) => html.indexOf(`data-help-part="${part}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it("用語 (glossary) が無い場合はその節を出さない", () => {
    const withoutGlossary = renderToStaticMarkup(
      createElement(HelpRenderer, { doc: { ...doc, glossary: undefined } }),
    );
    expect(withoutGlossary).not.toContain('data-help-part="glossary"');
    expect(withoutGlossary).toContain('data-help-part="faqs"');
  });

  it("本文・フロー・ユースケース・FAQ の中身が出る", () => {
    expect(html).toContain("これができます");
    expect(html).toContain("一覧が出ます");
    expect(html).toContain("こんなとき");
    expect(html).toContain("保存できません");
    expect(html).toContain("<details");
    expect(html).toContain("佐藤 さん"); // personas.ts から引いた人物紹介
    expect(html).toContain("<strong"); // **太字** の変換
  });

  it("スクリーンショットに注釈の SVG が重なる", () => {
    expect(html).toContain('src="/help/sample/01-list.png"');
    expect(html).toContain('viewBox="0 0 1000 600"');
    expect(html).toContain("<rect"); // 赤枠
    expect(html).toContain("<line"); // 矢印
    expect(html).toContain("<circle"); // 番号バッジ
    expect(html).toContain("#d33"); // 注釈の色
    expect(html).toContain("marker"); // 矢印の先端
    expect(html).toContain('data-help-badge="1"');
    expect(html).toContain('data-help-badge="2"');
  });

  it("目次に各節へのアンカーが並ぶ", () => {
    const toc = renderToStaticMarkup(createElement(HelpToc, { doc }));
    expect(toc).toContain('href="#help-summary"');
    expect(toc).toContain('href="#help-flow"');
    expect(toc).toContain('href="#help-sections"');
    expect(toc).toContain('href="#help-section-list"');
    expect(toc).toContain('href="#help-usecases"');
    expect(toc).toContain('href="#help-faqs"');
    expect(toc).toContain('href="#help-related"');
    expect(toc).toContain('href="#help-glossary"');
  });
});
