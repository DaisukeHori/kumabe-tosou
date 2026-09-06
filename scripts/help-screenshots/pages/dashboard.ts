/**
 * ダッシュボード (/admin) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/dashboard.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/dashboard/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "dashboard";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 画面全体 (どこに何があるかの地図)。
    await capture(page, {
      slug: SLUG,
      name: "01-overview",
      url: "/admin",
      waitFor: '[data-help="page-header"]',
      fullPage: true,
      anchors: [
        help("admin-nav"),
        help("page-header"),
        help("help-button"),
        help("action-list"),
        help("kpi-section-site"),
        help("kpi-section-crm"),
        help("kpi-section-ops"),
      ],
    });

    // 2 枚目: 「次にやること」のカード (上から順に片づける部分)。
    await capture(page, {
      slug: SLUG,
      name: "02-actions",
      url: "/admin",
      waitFor: '[data-help="action-list"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="action-list"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("action-list"),
        help("action-card-1"),
      ],
    });

    // 3 枚目: 数字のタイル (全体の状況)。KPI が見えるところまでスクロールしてから撮る。
    await capture(page, {
      slug: SLUG,
      name: "03-kpi",
      url: "/admin",
      waitFor: '[data-help="kpi-section-crm"]',
      clipTo: { selectors: ['[data-help="kpi-section-crm"]', '[data-help="kpi-section-ops"]'], padding: 20 },
      anchors: [
        help("kpi-section-crm"),
        help("kpi-awaiting-lead"),
        help("kpi-overdue-tasks"),
        help("kpi-section-ops"),
        help("kpi-unpaid"),
        help("kpi-capacity"),
        help("kpi-calls"),
      ],
    });

    // 4 枚目: 左のメニュー (他の画面への行き方)。
    await capture(page, {
      slug: SLUG,
      name: "04-nav",
      url: "/admin",
      waitFor: '[data-help="admin-nav"]',
      // メニューの中身だけを切り取る (下の余白を写さないため、グループ 5 つの範囲で囲む)。
      clipTo: {
        selectors: [
          '[data-help="nav-group-create-customers"]',
          '[data-help="nav-group-misc"]',
        ],
        padding: 40,
      },
      anchors: [
        help("admin-nav"),
        help("nav-group-create-customers"),
        help("nav-group-intake"),
        help("nav-group-sales"),
        help("nav-group-production"),
        help("nav-group-misc"),
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
