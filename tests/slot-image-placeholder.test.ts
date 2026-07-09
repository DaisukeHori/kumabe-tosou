import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlotImage } from "@/components/site/slot-image";
import {
  ShopProduct1Placeholder,
  ShopProduct2Placeholder,
  ShopProduct3Placeholder,
} from "@/app/(site)/shop/page-body";
import { StoryPortraitPlaceholder } from "@/app/(site)/story/page-body";

/**
 * 修正1: 未来枠4スロット (story.portrait / shop.product.1-3) の公開時の見た目復元。
 * canonical: docs/design/visual-media-editor.md (公開時 (editMode=false) の見た目は
 * 非退行が原則)。
 *
 * V2a (commit 90f9c5b) が story.portrait / shop.product.1-3 の既存装飾を汎用
 * 「NO IMAGE」プレースホルダに置き換えてしまった問題を、SlotImage の `placeholder`
 * prop 経由で旧装飾 JSX を復元することで解消したことを、実際に SSR レンダリングして
 * 検証する (vitest environment: node のため jsdom 非依存の renderToStaticMarkup を使う)。
 *
 * このファイルが .test.ts である都合上 (vitest.config.ts の include は *.test.ts のみ)、
 * JSX 構文は使わず React.createElement を直接呼ぶ。
 */

const NO_SRC = { src: null, alt: "", mediaId: null, isDefault: true } as const;
const WITH_SRC = {
  src: "https://example.com/img.webp",
  alt: "テスト画像",
  mediaId: "11111111-1111-4111-8111-111111111111",
  isDefault: false,
} as const;

describe("SlotImage: placeholder prop (修正1)", () => {
  it("resolved.src が null かつ placeholder 未指定なら、従来どおり汎用 NO IMAGE を描画する (非退行)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "home.hero",
        resolved: NO_SRC,
        editMode: false,
      }),
    );
    expect(html).toContain("NO IMAGE");
  });

  it("resolved.src が null かつ placeholder 指定・editMode=false のとき、placeholder をそのまま描画し汎用 NO IMAGE は出さない", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "story.portrait",
        resolved: NO_SRC,
        editMode: false,
        placeholder: createElement("span", { "data-testid": "ph" }, "PLACEHOLDER"),
      }),
    );
    expect(html).toContain("PLACEHOLDER");
    expect(html).not.toContain("NO IMAGE");
    // 公開時 (editMode=false) は data-editable-* のコードパス自体が存在しない (§4.3)。
    expect(html).not.toContain("data-editable-slot");
  });

  it("resolved.src が null かつ placeholder 指定・editMode=false・className 指定のとき、className を持つ div でのみ包む (data 属性は出さない)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "story.portrait",
        resolved: NO_SRC,
        editMode: false,
        className: "max-w-sm",
        placeholder: createElement("span", null, "PLACEHOLDER"),
      }),
    );
    expect(html).toContain("PLACEHOLDER");
    expect(html).toContain('class="max-w-sm"');
    expect(html).not.toContain("NO IMAGE");
    expect(html).not.toContain("data-editable-slot");
  });

  it("resolved.src が null かつ placeholder 指定・editMode=true のとき、data-editable-slot 付きのラッパで包む (クリック対象を保証)", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "story.portrait",
        resolved: NO_SRC,
        editMode: true,
        placeholder: createElement("span", null, "PLACEHOLDER"),
      }),
    );
    expect(html).toContain("PLACEHOLDER");
    expect(html).toContain('data-editable-slot="story.portrait"');
  });

  it("resolved.src が設定済みのときは placeholder を無視して通常の画像を描画する", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "story.portrait",
        resolved: WITH_SRC,
        editMode: false,
        placeholder: createElement("span", null, "PLACEHOLDER"),
      }),
    );
    expect(html).not.toContain("PLACEHOLDER");
    expect(html).not.toContain("NO IMAGE");
  });
});

describe("StoryPortraitPlaceholder (story.portrait の旧装飾復元)", () => {
  it("V2a 以前の代表ポートレート装飾 (信之 大漢字 + aria-label + COMING SOON ラベル) を再現する", () => {
    const html = renderToStaticMarkup(createElement(StoryPortraitPlaceholder));
    expect(html).toContain("信之");
    expect(html).toContain("PORTRAIT — COMING SOON");
    expect(html).toContain("代表・隈部信之（近日、実際の写真に差し替え予定）");
    expect(html).toContain("aspect-[3/4]");
  });

  it("公開ページ (StoryPageBody) から editMode=false で描画すると、旧装飾が汎用 NO IMAGE を置き換える", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "story.portrait",
        resolved: NO_SRC,
        editMode: false,
        placeholder: createElement(StoryPortraitPlaceholder),
      }),
    );
    expect(html).toContain("信之");
    expect(html).not.toContain("NO IMAGE");
  });
});

describe("ShopProduct{1,2,3}Placeholder (SEC.03 塗装済み製品の旧装飾復元)", () => {
  it("shop.product.1 (8色セット) は 8 個のスウォッチ + ラベルを再現する", () => {
    const html = renderToStaticMarkup(createElement(ShopProduct1Placeholder));
    expect(html).toContain("8-COLOR SET — IMAGE");
    const swatchCount = (html.match(/linear-gradient/g) ?? []).length;
    expect(swatchCount).toBe(8);
  });

  it("shop.product.2 (単色) はラベルを再現する", () => {
    const html = renderToStaticMarkup(createElement(ShopProduct2Placeholder));
    expect(html).toContain("SINGLE PANEL — IMAGE");
  });

  it("shop.product.3 (受注制作) はラベルを再現する", () => {
    const html = renderToStaticMarkup(createElement(ShopProduct3Placeholder));
    expect(html).toContain("YOUR OBJECT HERE");
  });

  it("公開ページ (ShopPageBody) から editMode=false で描画すると、旧装飾が汎用 NO IMAGE を置き換える", () => {
    const html = renderToStaticMarkup(
      createElement(SlotImage, {
        slotKey: "shop.product.1",
        resolved: NO_SRC,
        editMode: false,
        placeholder: createElement(ShopProduct1Placeholder),
      }),
    );
    expect(html).toContain("8-COLOR SET — IMAGE");
    expect(html).not.toContain("NO IMAGE");
  });
});
