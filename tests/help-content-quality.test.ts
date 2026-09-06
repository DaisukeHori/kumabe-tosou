import { describe, expect, it } from "vitest";

import { HELP_REGISTRY, loadHelpDoc, pendingHelpSlugs, readyHelpSlugs } from "@/help/registry";
import { HELP_SLUGS, HELP_SLUG_META, type HelpSlug } from "@/help/slugs";
import type { HelpDoc } from "@/help/types";

/**
 * docs/design/admin-help/README.md §4 の「1 ページあたりの最低量」を機械的に確かめる。
 *   スクリーンショット 3 枚以上 / 1 枚につき注釈 3 箇所以上 /
 *   ユースケース 2 本以上 / FAQ 10 問以上。
 * まだ書かれていない slug (registry の pending) は未作成一覧を出すだけで落とさない。
 * HELP_STRICT=1 のときだけ、pending が残っていると落とす (全ページ完成の確認用)。
 */
const ready = readyHelpSlugs();
const pending = pendingHelpSlugs();

const docs = new Map<HelpSlug, HelpDoc>();
for (const slug of ready) {
  const doc = await loadHelpDoc(slug);
  if (doc) docs.set(slug, doc);
}

/** ユースケース内の画像も含めた、そのページの全スクリーンショット。 */
function screenshotsOf(doc: HelpDoc) {
  return [
    ...doc.sections.flatMap((section) => (section.screenshot ? [section.screenshot] : [])),
    ...doc.useCases.flatMap((useCase) =>
      useCase.steps.flatMap((step) => (step.screenshot ? [step.screenshot] : [])),
    ),
  ];
}

describe("ヘルプ本文の最低量", () => {
  it("registry の slug 一覧が対象ページ一覧と一致する", () => {
    expect(Object.keys(HELP_REGISTRY).sort()).toEqual([...HELP_SLUGS].sort());
  });

  it("未作成のページ一覧 (準備中として表示される)", () => {
    if (pending.length > 0) {
      console.log(`[help] 未作成のヘルプ: ${pending.join(", ")}`);
    }
    if (process.env.HELP_STRICT === "1") {
      expect(pending, `未作成のヘルプが残っています: ${pending.join(", ")}`).toEqual([]);
    }
    expect(ready.length).toBeGreaterThan(0);
  });

  it.each(ready)("%s: 設計書 §4 の最低量を満たす", (slug) => {
    const doc = docs.get(slug);
    expect(doc, `${slug} の本文を読み込めませんでした`).toBeDefined();
    if (!doc) return;

    expect(doc.slug).toBe(slug);
    expect(doc.title).toBe(HELP_SLUG_META[slug].title);
    expect(doc.adminPath).toBe(HELP_SLUG_META[slug].adminPath);

    expect(doc.summary.length, "できること 3〜6 箇条").toBeGreaterThanOrEqual(3);
    expect(doc.flow.length, "フローは 2 ステップ以上").toBeGreaterThanOrEqual(2);

    const shots = screenshotsOf(doc);
    const uniqueSources = new Set(shots.map((shot) => shot.src));
    expect(uniqueSources.size, "スクリーンショットは 3 枚以上").toBeGreaterThanOrEqual(3);
    for (const shot of shots) {
      expect(shot.annotations.length, `${shot.src} の注釈は 3 箇所以上`).toBeGreaterThanOrEqual(3);
      expect(shot.src.startsWith(`/help/${slug}/`), `${shot.src} の置き場所`).toBe(true);
      expect(shot.width).toBeGreaterThan(0);
      expect(shot.height).toBeGreaterThan(0);
      expect(shot.alt.length).toBeGreaterThan(0);
    }

    expect(doc.useCases.length, "ユースケースは 2 本以上").toBeGreaterThanOrEqual(2);
    for (const useCase of doc.useCases) {
      expect(useCase.steps.length).toBeGreaterThanOrEqual(2);
    }

    expect(doc.faqs.length, "FAQ は 10 問以上").toBeGreaterThanOrEqual(10);
    expect(doc.related.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ready)("%s: 注釈の番号と本文の番号が一致する", (slug) => {
    const doc = docs.get(slug);
    if (!doc) return;
    for (const section of doc.sections) {
      if (!section.screenshot || !section.items) continue;
      const annotationNumbers = section.screenshot.annotations
        .map((annotation) =>
          annotation.kind === "arrow" ? undefined : (annotation.number ?? undefined),
        )
        .filter((n): n is number => typeof n === "number")
        .sort((a, b) => a - b);
      const itemNumbers = section.items.map((item) => item.number).sort((a, b) => a - b);
      expect(annotationNumbers, `${slug} / ${section.id} の番号がずれています`).toEqual(itemNumbers);
    }
  });

  it.each(ready)("%s: リンク先が実在しそうな形になっている", (slug) => {
    const doc = docs.get(slug);
    if (!doc) return;
    const hrefs = [
      ...doc.related.map((r) => r.href),
      ...doc.sections.flatMap((s) => (s.relations ?? []).map((r) => r.href)),
    ];
    for (const href of hrefs) {
      expect(href.startsWith("/admin") || href.startsWith("/help/"), `${href}`).toBe(true);
      if (href.startsWith("/help/")) {
        expect(HELP_SLUGS, `${href} は対象ページ一覧にありません`).toContain(
          href.slice("/help/".length),
        );
      }
    }
  });
});
