import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// SiteHeader (MotionNavLink 経由の usePathname) と ShopSimulator (useRouter) は
// Next.js App Router のレンダーコンテキスト前提の hook を使うため、bare
// renderToStaticMarkup では invariant エラーになる。本テストはルーティング挙動
// そのものではなく SlotText 配線 (data-editable-text の出し分け) の検証が目的の
// ため、最小限のスタブに差し替える (tests/visual-actions.test.ts の vi.mock 方式に倣う)。
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { HomePageBody } from "@/app/(site)/page-body";
import { StoryPageBody } from "@/app/(site)/story/page-body";
import { AboutPageBody } from "@/app/(site)/about/page-body";
import { ShopPageBody } from "@/app/(site)/shop/page-body";
import { NoteDetailPageBody } from "@/app/(site)/notes/[slug]/page-body";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

import { SLOT_REGISTRY } from "@/modules/page-media/registry";
import { TEXT_REGISTRY } from "@/modules/page-media/text-registry";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";
import type { NoteNav } from "@/app/_lib/note-nav";
import type { PublicPostDetail } from "@/app/_lib/public-content";

/**
 * T2a (visual-text-editor.md §4.1/§4.2) の非退行検証: SlotText 置換後の page-body /
 * 共有 chrome コンポーネントが、editMode=false (公開 (site) ルート相当) のとき
 * data-editable-text を一切出力しないこと、かつ registry の defaultText がそのまま
 * 画面に出ることを、代表的なページを抽出して renderToStaticMarkup で検証する。
 *
 * .test.ts の都合上 (vitest.config.ts の include は *.test.ts のみ) JSX は使わず
 * React.createElement を直接呼ぶ (tests/slot-image-placeholder.test.ts に倣う)。
 */

/** registry 全件を defaultSrc/altDefault で埋めた ResolvedSlots (画像 slots バケツ) */
function buildDefaultSlots(): ResolvedSlots {
  const result: ResolvedSlots = {};
  for (const slot of SLOT_REGISTRY) {
    result[slot.key] = {
      src: slot.defaultSrc,
      alt: slot.altDefault,
      mediaId: null,
      isDefault: true,
      source: slot.defaultSrc ? "default" : "placeholder",
    };
  }
  return result;
}

/** registry 全件を defaultText で埋めた ResolvedTexts (texts バケツ、§4.2 の不変条件) */
function buildDefaultTexts(): ResolvedTexts {
  const result: ResolvedTexts = {};
  for (const slot of TEXT_REGISTRY) {
    result[slot.key] = { text: slot.defaultText, isDefault: true };
  }
  return result;
}

const slots = buildDefaultSlots();
const texts = buildDefaultTexts();

const FAKE_POST: PublicPostDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "test-post",
  kind: "reading",
  title: "テスト記事タイトル",
  excerpt: "テスト記事の抜粋です。",
  cover: null,
  publishedAt: "2026-01-01T00:00:00.000Z",
  body: "本文テスト。",
};
const FAKE_NAV: NoteNav = { noteNo: 1, prev: null, next: null };

describe("page-body: editMode=false は data-editable-text を出力しない (非退行)", () => {
  it("HomePageBody", () => {
    const html = renderToStaticMarkup(
      createElement(HomePageBody, { slots, texts, editMode: false }),
    );
    expect(html).not.toContain("data-editable-text");
    // registry defaultText が現行文言のまま出ること (frozen fixture と同一の文言)。
    expect(html).toContain("3つの技術を、ひとりで持つ。");
    expect(html).toContain("デザインモデルの品質は、");
    expect(html).toContain("その空白のために、この工房がある。");
    expect(html).toContain("積層痕を消す研磨");
    expect(html).toContain("プレミアムデザインモデルの一点仕上げ");
  });

  it("StoryPageBody (kind=lines カスタム renderLines / kind=multiline を含む)", () => {
    const html = renderToStaticMarkup(
      createElement(StoryPageBody, { slots, texts, editMode: false }),
    );
    expect(html).not.toContain("data-editable-text");
    expect(html).toContain("なぜ、積層痕と");
    expect(html).toContain("「見えなくなる仕事」に、");
    expect(html).toContain("物語の続きは、");
  });

  it("AboutPageBody (SecTitle 経由の kind=text/lines を含む)", () => {
    const html = renderToStaticMarkup(
      createElement(AboutPageBody, { slots, texts, editMode: false }),
    );
    expect(html).not.toContain("data-editable-text");
    expect(html).toContain("バンパー6本を、同時に塗れる。");
    expect(html).toContain("現場の、手ざわり。");
  });

  it("ShopPageBody (client component ShopSimulator 内の shop.simulator.cta を含む)", () => {
    // priceTable: null のとき ShopSimulator は「価格はお問い合わせください」fallback を
    // 描画し、shop.simulator.cta ボタン自体は出ない (既存挙動、非退行の対象外)。
    // ここでは SlotText/textEditableAttrs 配線が data-editable-text を漏らさないことのみ検証する。
    const html = renderToStaticMarkup(
      createElement(ShopPageBody, { slots, texts, editMode: false, priceTable: null }),
    );
    expect(html).not.toContain("data-editable-text");
    expect(html).toContain("価格はお問い合わせください");
    expect(html).toContain("3つのグレードから、");
  });

  it("NoteDetailPageBody (notes.cta.* を notes/page-body.tsx と共有)", () => {
    const html = renderToStaticMarkup(
      createElement(NoteDetailPageBody, {
        post: FAKE_POST,
        nav: FAKE_NAV,
        texts,
        editMode: false,
      }),
    );
    expect(html).not.toContain("data-editable-text");
    expect(html).toContain("読んで気になったことは、");
  });

  it("SiteHeader / SiteFooter (shared.cta.consult / chrome.footer.tagline / common.header.* / common.footer.*)", () => {
    const headerHtml = renderToStaticMarkup(
      createElement(SiteHeader, { texts, editMode: false }),
    );
    const footerHtml = renderToStaticMarkup(
      createElement(SiteFooter, { texts, editMode: false }),
    );
    expect(headerHtml).not.toContain("data-editable-text");
    expect(footerHtml).not.toContain("data-editable-text");
    expect(headerHtml).toContain("相談する");
    expect(headerHtml).toContain("隈部塗装");
    expect(headerHtml).toContain("ストーリー");
    expect(footerHtml).toContain("3Dプリント造形物の表面処理");
    expect(footerHtml).toContain("隈部塗装(代表: 隈部 信之)");
    expect(footerHtml).toContain("© 2026 KUMABE TOSO. ALL RIGHTS RESERVED.");
  });
});

describe("page-body: editMode=true は data-editable-text を出力する (positive path)", () => {
  it("HomePageBody", () => {
    const html = renderToStaticMarkup(
      createElement(HomePageBody, { slots, texts, editMode: true }),
    );
    expect(html).toContain('data-editable-text="home.craft.heading"');
    expect(html).toContain('data-editable-text="home.statement.heading"');
  });

  it("SiteHeader / SiteFooter", () => {
    const headerHtml = renderToStaticMarkup(
      createElement(SiteHeader, { texts, editMode: true }),
    );
    const footerHtml = renderToStaticMarkup(
      createElement(SiteFooter, { texts, editMode: true }),
    );
    expect(headerHtml).toContain('data-editable-text="shared.cta.consult"');
    expect(headerHtml).toContain('data-editable-text="common.header.brand"');
    expect(footerHtml).toContain('data-editable-text="chrome.footer.tagline"');
    expect(footerHtml).toContain('data-editable-text="common.footer.address"');
  });
});
