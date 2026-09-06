/**
 * 「SNS の接続と配信」(/admin/channels) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/channels.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * デモデータ: scripts/help-screenshots/seed-demo/channels.sql
 * 出力: public/help/channels/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "channels";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: SNS の接続カード (X / Instagram / note)。
    await capture(page, {
      slug: SLUG,
      name: "01-connections",
      url: "/admin/channels",
      waitFor: '[data-help="connection-cards"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="connection-cards"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("channel-card-x"),
        help("channel-card-instagram"),
        help("channel-card-note"),
        help("note-cookie"),
      ],
    });

    // 2 枚目: 文章の書き方 (文体プロファイル) のタブ。
    await capture(page, {
      slug: SLUG,
      name: "02-style",
      url: "/admin/channels",
      waitFor: '[data-help="style-profiles"]',
      clipTo: { selectors: ['[data-help="style-profiles"]'], padding: 20 },
      anchors: [
        help("style-profiles"),
        help("style-tabs"),
        help("style-tone-site-blog"),
        help("style-format-site-blog"),
      ],
    });

    // 3 枚目: 配信キュー (予約済み・要人間照合・失敗・配信済みが並ぶところ)。
    await capture(page, {
      slug: SLUG,
      name: "03-queue",
      url: "/admin/channels",
      waitFor: '[data-help="queue-table"]',
      clipTo: { selectors: ['[data-help="queue-section"]'], padding: 20 },
      anchors: [
        help("queue-filter"),
        help("queue-table"),
        help("queue-status-manual_required"),
        help("queue-error"),
        help("queue-retry"),
        help("queue-mark-published"),
        help("queue-note-copy"),
      ],
    });

    // 4 枚目 (操作後): 「投稿済みにする」を押して確認の小窓が開いたところ。
    await capture(page, {
      slug: SLUG,
      name: "04-manual",
      url: "/admin/channels",
      waitFor: '[data-help="queue-mark-published"]',
      actions: async (p) => {
        await p.click('[data-help="queue-mark-published"]');
        await p.waitForSelector('[data-help="manual-dialog"]', { state: "visible" });
        await p.waitForTimeout(400); // 小窓が開ききるまで待つ (アニメーション)
      },
      anchors: [help("manual-dialog"), help("manual-url"), help("manual-confirm")],
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
