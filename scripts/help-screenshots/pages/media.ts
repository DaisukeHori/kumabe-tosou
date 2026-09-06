/**
 * 「写真・画像」(/admin/media) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/media.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * デモ画像は scripts/help-screenshots/seed-demo/media-seed.ts で投入したもの。
 * 8 枚目 (いちばん古い画像) はお客様の声から使われているため「参照 1」で写る。
 * 出力: public/help/media/NN-name.png と同名 .json (注釈座標)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright-core";

import { REPO_ROOT, createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";
import { HELP_MEDIA_SEED } from "../seed-demo/media-items";

const SLUG = "media";

const ASSET_DIR = path.join(REPO_ROOT, "scripts/help-screenshots/seed-demo/media-assets");

/**
 * 撮影用ブラウザは外部への通信ができない環境で動くため、画像置き場 (Supabase Storage) の
 * URL をそのまま読むとサムネイルが灰色のままになる。投入したのと同じ画像ファイルを
 * ローカルから返して、実際の見た目どおりに写るようにする
 * (中身は seed-demo/media-seed.ts で投入した画像そのもの)。
 */
async function serveDemoImagesLocally(page: Page): Promise<void> {
  await page.route("**/storage/v1/object/public/media/**", async (route) => {
    const url = route.request().url();
    const id = url.split("/").pop()?.replace(/\.(webp|jpg)$/, "") ?? "";
    const seed = HELP_MEDIA_SEED.find((item) => item.id === id);
    if (!seed) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: readFileSync(path.join(ASSET_DIR, seed.file)),
    });
  });
}

/** 遅延読み込みの画像をすべて表示させてから撮る (下のほうが灰色のままにならないように)。 */
async function loadAllThumbnails(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 500));
    window.scrollTo(0, 0);
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => new Promise((resolve) => img.addEventListener("load", resolve, { once: true }))),
    );
  });
  await page.waitForTimeout(500);
}

/** 一覧は新しい順。1 番目が仮素材、8 番目がお客様の声から使われている画像。 */
const PLACEHOLDER_CARD = '[data-help="media-card-1"]';
const USED_CARD = '[data-help="media-card-8"]';

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);
  await serveDemoImagesLocally(page);

  try {
    // 1 枚目: 画面全体 (どこに何があるか)。
    await capture(page, {
      slug: SLUG,
      name: "01-grid",
      url: "/admin/media",
      waitFor: '[data-help="media-grid"]',
      actions: loadAllThumbnails,
      fullPage: true,
      anchors: [
        help("page-header"),
        help("help-button"),
        help("media-placeholder-notice"),
        help("media-upload-open"),
        help("media-grid"),
        help("media-card-1"),
      ],
    });

    // 2 枚目: 1 枚のカードの見方 (仮素材の印と、使われている数)。
    await capture(page, {
      slug: SLUG,
      name: "02-cards",
      url: "/admin/media",
      waitFor: '[data-help="media-card-8"]',
      actions: loadAllThumbnails,
      clipTo: { selectors: [PLACEHOLDER_CARD, USED_CARD], padding: 16 },
      anchors: [
        help("media-card-1"),
        help("media-card-1-references"),
        help("media-card-8"),
        help("media-card-8-references"),
      ],
    });

    // 3 枚目: 画像を足すダイアログ。
    await capture(page, {
      slug: SLUG,
      name: "03-upload",
      url: "/admin/media",
      waitFor: '[data-help="media-upload-open"]',
      actions: async (p) => {
        await p.click('[data-help="media-upload-open"]');
        await p.waitForSelector('[data-help="media-upload-dialog"]');
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="media-upload-dialog"]'], padding: 16 },
      anchors: [
        help("media-upload-dialog"),
        help("media-dropzone"),
        help("media-upload-tags"),
        help("media-upload-credit"),
        help("media-upload-submit"),
      ],
    });

    // 4 枚目: 使われている画像を開いたところ (削除ボタンが押せない状態)。
    await capture(page, {
      slug: SLUG,
      name: "04-edit-used",
      url: "/admin/media",
      waitFor: USED_CARD,
      actions: async (p) => {
        await loadAllThumbnails(p);
        await p.click(USED_CARD);
        await p.waitForSelector('[data-help="media-edit-dialog"]');
        await p.waitForTimeout(600);
      },
      clipTo: { selectors: ['[data-help="media-edit-dialog"]'], padding: 16 },
      anchors: [
        help("media-edit-dialog"),
        help("media-alt-field"),
        help("media-tags-field"),
        help("media-placeholder-field"),
        help("media-reference-count"),
        help("media-delete"),
        help("media-save"),
      ],
    });

    // 5 枚目: どこからも使われていない画像を開いたところ (削除ボタンが押せる状態)。
    await capture(page, {
      slug: SLUG,
      name: "05-edit-unused",
      url: "/admin/media",
      waitFor: PLACEHOLDER_CARD,
      actions: async (p) => {
        await loadAllThumbnails(p);
        await p.click(PLACEHOLDER_CARD);
        await p.waitForSelector('[data-help="media-edit-dialog"]');
        await p.waitForTimeout(600);
      },
      clipTo: { selectors: ['[data-help="media-edit-dialog"]'], padding: 16 },
      anchors: [
        help("media-edit-dialog"),
        help("media-placeholder-field"),
        help("media-reference-count"),
        help("media-delete"),
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
