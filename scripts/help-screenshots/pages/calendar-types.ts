/**
 * カレンダー — 作業種別 (/admin/calendar/types) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/calendar-types.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/calendar-types/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "calendar-types";
const URL = "/admin/calendar/types";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧 (登録済みの作業の種類が並ぶ)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: URL,
      waitFor: '[data-help="type-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="type-table"]'], padding: 20 },
      anchors: [help("page-header"), help("help-button"), help("type-new"), help("type-table")],
    });

    // 2 枚目: 新規作成の入力画面。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: URL,
      waitFor: '[data-help="type-new"]',
      actions: async (p) => {
        await p.click('[data-help="type-new"]');
        await p.waitForSelector('[data-help="type-dialog"]', { state: "visible" });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="type-dialog"]'], padding: 24 },
      anchors: [
        help("type-dialog"),
        help("type-label"),
        help("type-color"),
        help("type-consumes"),
        help("type-defaults"),
        help("type-details"),
      ],
    });

    // 3 枚目: 既にある種類を開き、「詳細設定」を開いたところ。
    await capture(page, {
      slug: SLUG,
      name: "03-edit",
      url: URL,
      waitFor: '[data-help="type-table"]',
      actions: async (p) => {
        await p.click('[data-help="type-table"] [role="option"]:has-text("乾燥")');
        await p.waitForSelector('[data-help="type-dialog"]', { state: "visible" });
        await p.click('[data-help="type-details"] button:has-text("詳細設定")');
        await p.waitForTimeout(600);
      },
      clipTo: { selectors: ['[data-help="type-dialog"]'], padding: 24 },
      anchors: [help("type-dialog"), help("type-label"), help("type-consumes"), help("type-details")],
    });

    console.log(`[help-screenshots] ${SLUG}: 3 枚を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
