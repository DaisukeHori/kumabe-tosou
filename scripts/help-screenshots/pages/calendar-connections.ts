/**
 * カレンダーの外部連携 (/admin/calendar/connections) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/calendar-connections.ts
 *
 * デモデータ: scripts/help-screenshots/seed-demo/calendar-connections.sql
 * (Google / Microsoft を「接続中」にし、同期の問題を 4 パターン作る)。
 *
 * 補足: 接続ボタンが押せる状態 (外部連携の認証情報あり) を写すため、
 * この画面だけは認証情報を入れた別ポートの開発サーバーを使うことがある。
 * その場合は HELP_BASE_URL=http://localhost:3010 を付けて実行する。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "calendar-connections";
const PATH = "/admin/calendar/connections";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 画面全体 (上が接続カード、下が同期の問題)。
    await capture(page, {
      slug: SLUG,
      name: "01-overview",
      url: PATH,
      waitFor: '[data-help="connection-cards"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("help-button"),
        help("calendar-settings-tabs"),
        help("connection-cards"),
        help("sync-issues-section"),
        help("sync-now"),
      ],
    });

    // 2 枚目: 接続カードの中身 (状態・アカウント・ボタン)。
    await capture(page, {
      slug: SLUG,
      name: "02-connection-card",
      url: PATH,
      waitFor: '[data-help="connection-card-google"]',
      clipTo: { selectors: ['[data-help="connection-cards"]'], padding: 24 },
      anchors: [
        help("connection-card-google"),
        help("connection-status-google"),
        help("connection-detail-google"),
        help("connection-buttons-google"),
        help("connection-card-microsoft"),
      ],
    });

    // 3 枚目: 同期の問題の一覧 (どの行がどの状態か)。
    await capture(page, {
      slug: SLUG,
      name: "03-sync-issues",
      url: PATH,
      waitFor: '[data-help="sync-issues-table"]',
      clipTo: { selectors: ['[data-help="sync-issues-section"]'], padding: 24 },
      anchors: [
        help("sync-now"),
        help("sync-issues-table"),
        help("sync-issue-row-deleted_externally"),
        help("sync-issue-row-conflict-kmb-e724"),
        help("sync-issue-row-conflict-kmb-e723"),
        help("sync-issue-row-orphaned"),
      ],
    });

    // 4 枚目: 外部で消された予定の行 (直し方の 3 つのボタン)。
    await capture(page, {
      slug: SLUG,
      name: "04-deleted-row",
      url: PATH,
      waitFor: '[data-help="sync-issue-row-deleted_externally"]',
      clipTo: { selectors: ['[data-help="sync-issues-table"]'], padding: 16 },
      anchors: [
        help("sync-issue-row-deleted_externally"),
        help("sync-issue-status-deleted_externally"),
        help("sync-issue-actions-deleted_externally"),
        help("sync-issue-actions-conflict-kmb-e724"),
        help("sync-issue-actions-orphaned"),
      ],
    });

    // 5 枚目: 接続が終わった直後 (緑の帯が出た状態)。
    await capture(page, {
      slug: SLUG,
      name: "05-connected",
      url: `${PATH}?cal_connected=google`,
      waitFor: '[data-help="connected-banner"]',
      clipTo: {
        selectors: ['[data-help="page-header"]', '[data-help="connection-cards"]'],
        padding: 20,
      },
      anchors: [
        help("connected-banner"),
        help("connection-status-google"),
        help("connection-detail-google"),
        help("connection-buttons-google"),
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
