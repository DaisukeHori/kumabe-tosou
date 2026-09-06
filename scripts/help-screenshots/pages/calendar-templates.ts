/**
 * カレンダー — テンプレート (/admin/calendar/templates) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/calendar-templates.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/calendar-templates/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "calendar-templates";
const URL = "/admin/calendar/templates";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧 (登録済みのセットが並ぶ)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: URL,
      waitFor: '[data-help="template-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="template-table"]'], padding: 20 },
      anchors: [help("page-header"), help("help-button"), help("template-new"), help("template-table")],
    });

    // 2 枚目: 新規作成の入力画面。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: URL,
      waitFor: '[data-help="template-new"]',
      actions: async (p) => {
        await p.click('[data-help="template-new"]');
        await p.waitForSelector('[data-help="template-dialog"]', { state: "visible" });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="template-dialog"]'], padding: 24 },
      anchors: [
        help("template-dialog"),
        help("template-name"),
        help("template-grade-size"),
        help("template-items"),
      ],
    });

    // 3 枚目: 既にあるセットを開いたところ (行を押すと編集画面になる)。
    await capture(page, {
      slug: SLUG,
      name: "03-edit",
      url: URL,
      waitFor: '[data-help="template-table"]',
      actions: async (p) => {
        await p.click('[data-help="template-table"] [role="option"]:has-text("標準塗装セット")');
        await p.waitForSelector('[data-help="template-dialog"]', { state: "visible" });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="template-dialog"]'], padding: 24 },
      anchors: [
        help("template-dialog"),
        help("template-name"),
        help("template-grade-size"),
        help("template-items"),
      ],
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
