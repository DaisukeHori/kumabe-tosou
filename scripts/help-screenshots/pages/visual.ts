/**
 * 見た目と文章の編集 (/admin/visual) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/visual.ts
 *
 * この画面はホームページをそのまま縮小して表示するため、ページ全体を撮ると
 * 数千ピクセルの縦長になる。そこで画面 (ビューポート) の見えている範囲だけを撮り、
 * 説明したい場所までスクロールしてから撮る方針にしている。
 *
 * 出力: public/help/visual/NN-name.png と同名 .json (注釈座標)。
 */
import type { Page } from "playwright-core";

import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "visual";

/**
 * ページ選択タブを切り替える。プレビュー枠 (iframe) の読み込み先が変わり、
 * 写真・文章の枠が測り直されるまで待つ。
 */
async function selectTab(page: Page, label: string, previewUrl: string): Promise<void> {
  const tab = page.locator('[data-help="page-tabs"] button', { hasText: label }).first();
  // タブの並びが確定してから押す (直後だと折り返しで位置がずれて別のタブを押してしまう)。
  await page.waitForTimeout(1_500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tab.click();
    try {
      await page.waitForSelector(`iframe[src="${previewUrl}"]`, { timeout: 10_000 });
      await page.waitForSelector('[data-help="image-hotspot"]', { timeout: 30_000 });
      await page.waitForTimeout(2_500);
      return;
    } catch {
      // 押し損ねたときはもう一度だけ試す。
    }
  }
  throw new Error(`ページ選択タブ「${label}」に切り替えられませんでした`);
}

/** 指定した枠を画面内へスクロールしてから押し、出てきたメニューも画面内に入れる。 */
async function openHotspot(page: Page, key: string): Promise<void> {
  const hotspot = page.locator(`[data-help="${key}"]`);
  await hotspot.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await hotspot.click();
  const menu = page.locator('[data-help="hotspot-menu"]');
  await menu.waitFor({ timeout: 15_000 });
  await menu.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 画面全体の地図 (上のタブ・中央のプレビュー・右の一覧)。
    await capture(page, {
      slug: SLUG,
      name: "01-overview",
      url: "/admin/visual",
      waitFor: '[data-help="side-panel"]',
      actions: async (p) => {
        await p.waitForSelector('[data-help="image-hotspot"]', { timeout: 30_000 });
        await p.waitForTimeout(1_000);
      },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("site-tabs"),
        help("page-tabs"),
        help("preview"),
        help("side-panel"),
      ],
    });

    // 2 枚目: 写真をクリックしたときに出る小さなメニュー。
    await capture(page, {
      slug: SLUG,
      name: "02-image-menu",
      url: "/admin/visual",
      waitFor: '[data-help="side-panel"]',
      actions: async (p) => {
        await selectTab(p, "ストーリー", "/edit/story");
        await openHotspot(p, "image-hotspot");
      },
      anchors: [help("image-hotspot"), help("hotspot-menu")],
    });

    // 3 枚目: 文章をクリックしたときの書き換えフォーム (文字数の数え・AI 候補)。
    await capture(page, {
      slug: SLUG,
      name: "03-text-edit",
      url: "/admin/visual",
      waitFor: '[data-help="side-panel"]',
      actions: async (p) => {
        await openHotspot(p, "text-hotspot");
      },
      anchors: [help("text-hotspot"), help("hotspot-menu"), help("ai-suggest")],
    });

    // 4 枚目: 右側の一覧 (このページで直せるものの目次)。
    await capture(page, {
      slug: SLUG,
      name: "04-side-panel",
      url: "/admin/visual",
      waitFor: '[data-help="side-panel"]',
      actions: async (p) => {
        await p.waitForSelector('[data-help="slot-row"]', { timeout: 30_000 });
        await p.waitForTimeout(1_000);
      },
      // 右側の一覧のうち「画像スロット」のかたまりだけを切り取って大きく見せる。
      clipTo: { selectors: ['[data-help="side-panel-images"]'], padding: 16 },
      anchors: [help("side-panel-images"), help("slot-row"), help("slot-state")],
    });

    // 5 枚目: 「画像を変更」から開く写真の選択画面。
    await capture(page, {
      slug: SLUG,
      name: "05-picker",
      url: "/admin/visual",
      waitFor: '[data-help="side-panel"]',
      actions: async (p) => {
        await selectTab(p, "ストーリー", "/edit/story");
        await openHotspot(p, "image-hotspot");
        await p.locator('[data-help="hotspot-menu"] button', { hasText: "画像を変更" }).click();
        await p.waitForSelector('[data-slot="dialog-content"]', { timeout: 15_000 });
        // 写真の一覧が表示されるまで待つ (縮小画像の読み込みに少し時間がかかる)。
        await p.waitForTimeout(3_500);
      },
      anchors: [
        { key: "picker", selector: '[data-slot="dialog-content"]' },
        { key: "picker-header", selector: '[data-slot="dialog-header"]' },
        { key: "picker-footer", selector: '[data-slot="dialog-footer"]' },
      ],
    });

    console.log(`[help-screenshots] ${SLUG}: 5 枚を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
