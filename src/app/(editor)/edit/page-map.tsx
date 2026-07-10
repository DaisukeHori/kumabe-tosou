import { createPricingFacade } from "@/modules/pricing/facade";
import { pageMediaFacade } from "@/modules/page-media/facade";
import type { PriceTable } from "@/modules/pricing/contracts";

import {
  fetchPublishedPostBySlug,
  fetchPublishedPosts,
  fetchPublishedVoices,
  fetchPublishedWorkBySlug,
  fetchPublishedWorks,
} from "@/app/_lib/public-content";
import { buildNoteNav } from "@/app/_lib/note-nav";

import { AboutPageBody } from "@/app/(site)/about/page-body";
import { BlogDetailPageBody } from "@/app/(site)/blog/[slug]/page-body";
import { BlogPageBody } from "@/app/(site)/blog/page-body";
import { ColorsPageBody } from "@/app/(site)/colors/page-body";
import { ContactPageBody } from "@/app/(site)/contact/page-body";
import { MaterialsPageBody } from "@/app/(site)/materials/page-body";
import { NoteDetailPageBody } from "@/app/(site)/notes/[slug]/page-body";
import { NotesPageBody } from "@/app/(site)/notes/page-body";
import { HomePageBody } from "@/app/(site)/page-body";
import { PrivacyPageBody } from "@/app/(site)/privacy/page-body";
import { ProcessPageBody } from "@/app/(site)/process/page-body";
import { ServicePageBody } from "@/app/(site)/service/page-body";
import { ShopPageBody } from "@/app/(site)/shop/page-body";
import { StoryPageBody } from "@/app/(site)/story/page-body";
import { VoicesPageBody } from "@/app/(site)/voices/page-body";
import { WorkDetailPageBody } from "@/app/(site)/works/[slug]/page-body";
import { WorksPageBody } from "@/app/(site)/works/page-body";

import { matchEditRoute, type EditRouteMatch, type SlotPageKey } from "./route-match";

/**
 * `/edit/**` の「path パターン → ページボディ」対応 (canonical: docs/design/visual-media-editor.md
 * §5.3a)。EDITABLE_ROUTES (page-media/registry.ts) の全量を解決できることを
 * tests/edit-page-map.test.ts で保証する (route-match.ts の matchEditRoute を直接検証)。
 *
 * - matchEditRoute (./route-match.ts): 純粋関数。パス配列 → ルート種別の判定のみ
 *   (DB/コンポーネント非依存)。ここから re-export し、page.tsx は本ファイルだけを見ればよい。
 * - renderEditRouteBody(): 実際のデータ取得 (resolveAllFresh + 素の fetch 関数) を行い、
 *   対応するページボディを editMode=true で描画する (/edit ルートの page.tsx から呼ぶ)。
 */

export { matchEditRoute };
export type { EditRouteMatch, SlotPageKey };

/**
 * match を実際のページボディ (editMode=true) に解決する。
 * データは全て fresh fetch (resolveAllFresh / fetchPublished*Fresh、§5.3)。
 * 対象コンテンツが存在しない (detail の slug 不一致) 場合は null を返す
 * (呼び出し側が notFound() を出す)。
 */
export async function renderEditRouteBody(match: EditRouteMatch): Promise<React.ReactNode | null> {
  switch (match.kind) {
    case "slot-page":
      return renderSlotPage(match.page);
    case "works-list": {
      const works = await fetchPublishedWorks();
      const textsResult = await pageMediaFacade.resolveAllTextsFresh();
      const texts = textsResult.ok ? textsResult.value : {};
      return <WorksPageBody works={works} texts={texts} editMode={true} />;
    }
    case "voices-list": {
      const voices = await fetchPublishedVoices();
      const textsResult = await pageMediaFacade.resolveAllTextsFresh();
      const texts = textsResult.ok ? textsResult.value : {};
      return <VoicesPageBody voices={voices} texts={texts} editMode={true} />;
    }
    case "notes-list": {
      const posts = await fetchPublishedPosts("reading");
      const textsResult = await pageMediaFacade.resolveAllTextsFresh();
      const texts = textsResult.ok ? textsResult.value : {};
      return <NotesPageBody posts={posts} texts={texts} editMode={true} />;
    }
    case "blog-list": {
      const posts = await fetchPublishedPosts("blog");
      return <BlogPageBody posts={posts} editMode={true} />;
    }
    case "works-detail": {
      const work = await fetchPublishedWorkBySlug(match.slug);
      if (!work) return null;
      const textsResult = await pageMediaFacade.resolveAllTextsFresh();
      const texts = textsResult.ok ? textsResult.value : {};
      return <WorkDetailPageBody work={work} texts={texts} editMode={true} />;
    }
    case "notes-detail": {
      const [post, posts] = await Promise.all([
        fetchPublishedPostBySlug("reading", match.slug),
        fetchPublishedPosts("reading"),
      ]);
      if (!post) return null;
      const nav = buildNoteNav(posts, match.slug);
      const textsResult = await pageMediaFacade.resolveAllTextsFresh();
      const texts = textsResult.ok ? textsResult.value : {};
      return <NoteDetailPageBody post={post} nav={nav} texts={texts} editMode={true} />;
    }
    case "blog-detail": {
      const post = await fetchPublishedPostBySlug("blog", match.slug);
      if (!post) return null;
      return <BlogDetailPageBody post={post} editMode={true} />;
    }
    default: {
      const _exhaustive: never = match;
      return _exhaustive;
    }
  }
}

async function renderSlotPage(page: SlotPageKey): Promise<React.ReactNode> {
  const slotsResult = await pageMediaFacade.resolveAllFresh();
  const slots = slotsResult.ok ? slotsResult.value : {};
  const textsResult = await pageMediaFacade.resolveAllTextsFresh();
  const texts = textsResult.ok ? textsResult.value : {};

  switch (page) {
    case "":
      return <HomePageBody slots={slots} texts={texts} editMode={true} />;
    case "about":
      return <AboutPageBody slots={slots} texts={texts} editMode={true} />;
    case "colors":
      return <ColorsPageBody slots={slots} texts={texts} editMode={true} />;
    case "contact":
      return <ContactPageBody slots={slots} texts={texts} editMode={true} />;
    case "materials":
      return <MaterialsPageBody slots={slots} texts={texts} editMode={true} />;
    case "privacy":
      // privacy は画像スロットを持たないため slots は使わない (テキストのみ)。
      return <PrivacyPageBody texts={texts} editMode={true} />;
    case "process":
      return <ProcessPageBody slots={slots} texts={texts} editMode={true} />;
    case "service":
      return <ServicePageBody slots={slots} texts={texts} editMode={true} />;
    case "story":
      return <StoryPageBody slots={slots} texts={texts} editMode={true} />;
    case "shop": {
      const facade = createPricingFacade();
      const priceTableResult = await facade.getActivePriceTable();
      const priceTable: PriceTable | null = priceTableResult.ok ? priceTableResult.value : null;
      return <ShopPageBody slots={slots} texts={texts} editMode={true} priceTable={priceTable} />;
    }
    default: {
      const _exhaustive: never = page;
      return _exhaustive;
    }
  }
}
