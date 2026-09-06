/**
 * 「お客様の声」(/admin/voices) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/voices.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * デモ行は scripts/help-screenshots/seed-demo/voices.sql で投入したもの。
 * 出力: public/help/voices/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "voices";

/** seed-demo/voices.sql で投入した固定 id。 */
const REVIEW_VOICE_ID = "5f000001-0000-4000-8000-000000000003";
const PUBLISHED_VOICE_ID = "5f000001-0000-4000-8000-000000000001";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧 (どこに何があるか)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/voices",
      waitFor: '[data-help="voice-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="voice-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("voice-new"),
        help("voice-search"),
        help("voice-status-filter"),
        help("voice-table"),
        help("voice-row-1"),
      ],
    });

    // 2 枚目: 新規作成のフォーム (入力欄の意味)。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: "/admin/voices/new",
      waitFor: '[data-help="voice-body"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("voice-header"),
        help("voice-save"),
        help("voice-initial"),
        help("voice-region"),
        help("voice-rating"),
        help("voice-body"),
        help("voice-item"),
        help("voice-sort-order"),
        help("voice-photo"),
        help("voice-media-list"),
      ],
    });

    // 3 枚目: レビュー待ちの 1 件を開いたところ (状態を進めるボタンが出ている)。
    await capture(page, {
      slug: SLUG,
      name: "03-review",
      url: `/admin/voices/${REVIEW_VOICE_ID}`,
      waitFor: '[data-help="voice-header"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="voice-body"]'], padding: 20 },
      anchors: [
        help("voice-header"),
        help("voice-status"),
        help("voice-transition-draft"),
        help("voice-transition-published"),
        help("voice-save"),
        help("voice-body"),
      ],
    });

    // 4 枚目: 公開中の 1 件を保存したあと (「保存しました。」が出た状態)。
    await capture(page, {
      slug: SLUG,
      name: "04-after-save",
      url: `/admin/voices/${PUBLISHED_VOICE_ID}`,
      waitFor: '[data-help="voice-save"]',
      actions: async (p) => {
        await p.click('[data-help="voice-save"]');
        await p.waitForSelector('[data-help="voice-notice"]', { timeout: 30_000 });
      },
      clipTo: { selectors: ['[data-help="voice-header"]', '[data-help="voice-notice"]'], padding: 20 },
      anchors: [
        help("voice-header"),
        help("voice-status"),
        help("voice-transition-archived"),
        help("voice-save"),
        help("voice-notice"),
      ],
    });

    console.log(`[help-screenshots] ${SLUG}: 4 枚を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
