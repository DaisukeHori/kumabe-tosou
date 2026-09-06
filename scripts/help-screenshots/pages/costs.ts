/**
 * AI 利用料金 (/admin/costs) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/costs.ts
 *
 * デモデータ: scripts/help-screenshots/seed-demo/costs.sql
 * (鍵 3 本 + 直近 30 日の利用記録 + 当月の予算消化)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "costs";
const PATH = "/admin/costs";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 画面全体 (上から金額・グラフ・内訳の順)。
    await capture(page, {
      slug: SLUG,
      name: "01-overview",
      url: PATH,
      waitFor: '[data-help="cost-summary"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("help-button"),
        help("cost-total"),
        help("cost-images"),
        help("cost-chart"),
        help("cost-period"),
        help("cost-breakdown"),
      ],
    });

    // 2 枚目: 今月の合計と予算バー / 画像の枚数。
    await capture(page, {
      slug: SLUG,
      name: "02-summary",
      url: PATH,
      waitFor: '[data-help="cost-total"]',
      clipTo: { selectors: ['[data-help="cost-summary"]'], padding: 20 },
      anchors: [
        help("cost-total"),
        help("cost-budget-bar"),
        help("cost-images"),
        help("cost-image-bar"),
      ],
    });

    // 3 枚目: 日別の棒グラフ (どの日に使ったか)。
    await capture(page, {
      slug: SLUG,
      name: "03-chart",
      url: PATH,
      waitFor: '[data-help="cost-chart"]',
      clipTo: { selectors: ['[data-help="cost-chart"]', '[data-help="cost-period"]'], padding: 20 },
      anchors: [
        help("cost-chart"),
        help("cost-chart-graph"),
        help("cost-chart-legend"),
        help("cost-period"),
      ],
    });

    // 4 枚目: 3 つの内訳表 (モデル別 / キー別 / 用途別)。
    await capture(page, {
      slug: SLUG,
      name: "04-breakdown",
      url: PATH,
      waitFor: '[data-help="cost-by-model"]',
      clipTo: { selectors: ['[data-help="cost-breakdown"]'], padding: 20 },
      anchors: [help("cost-by-model"), help("cost-by-key"), help("cost-by-feature")],
    });

    // 5 枚目: 期間を「先月」に切り替えた直後 (数字と内訳が入れ替わる)。
    await capture(page, {
      slug: SLUG,
      name: "05-last-month",
      url: `${PATH}?period=last_month`,
      waitFor: '[data-help="cost-period"]',
      clipTo: {
        selectors: ['[data-help="cost-period"]', '[data-help="cost-breakdown"]'],
        padding: 20,
      },
      anchors: [
        help("cost-period"),
        help("cost-by-model"),
        help("cost-by-key"),
        help("cost-by-feature"),
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
