/**
 * カレンダー (作業予定) /admin/calendar のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/calendar.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/calendar/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "calendar";

/** 週の表は 0 時から 24 時まであるので、朝 8 時あたりが上に来るようにスクロールしてから撮る。 */
const GRID_SCROLL_SELECTOR = '[data-help="week-grid"] div.overflow-y-auto';
async function scrollGridToMorning(p: import("playwright-core").Page) {
  await p.$eval(GRID_SCROLL_SELECTOR, (el) => {
    el.scrollTop = 8 * 2 * 22; // 08:00 (1 行 30 分 = 22px)
  });
  await p.waitForTimeout(200);
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 画面全体 (どこに何があるかの地図)。
    await capture(page, {
      slug: SLUG,
      name: "01-week",
      url: "/admin/calendar",
      waitFor: '[data-help="week-grid"]',
      actions: scrollGridToMorning,
      clipTo: {
        selectors: ['[data-help="page-header"]', '[data-help="week-grid"]', '[data-help="backlog-tray"]'],
        padding: 16,
      },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("capacity-badge"),
        help("create-block"),
        help("view-nav"),
        help("view-tabs"),
        help("week-grid"),
        help("backlog-tray"),
      ],
    });

    // 2 枚目: 未配置トレイ (日程が決まっていない仕事の置き場)。
    await capture(page, {
      slug: SLUG,
      name: "02-tray",
      url: "/admin/calendar",
      waitFor: '[data-help="backlog-tray"]',
      clipTo: { selectors: ['[data-help="capacity-badge"]', '[data-help="backlog-tray"]'], padding: 16 },
      anchors: [help("capacity-badge"), help("create-block"), help("auto-place"), help("backlog-tray")],
    });

    // 3 枚目: 「ブロックを作る」の入力画面。
    await capture(page, {
      slug: SLUG,
      name: "03-create",
      url: "/admin/calendar",
      waitFor: '[data-help="create-block"]',
      actions: async (p) => {
        await p.click('[data-help="create-block"]');
        await p.waitForSelector('[data-help="create-dialog"]', { state: "visible" });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="create-dialog"]'], padding: 24 },
      anchors: [
        help("create-dialog"),
        help("create-deal"),
        help("create-type"),
        help("create-hours"),
        help("create-place-now"),
        help("create-submit"),
      ],
    });

    // 4 枚目: 予定の札を押したときに出る詳細 (操作後の画面)。
    await capture(page, {
      slug: SLUG,
      name: "04-detail",
      url: "/admin/calendar",
      waitFor: '[data-help="week-grid"]',
      actions: async (p) => {
        await scrollGridToMorning(p);
        await p.click('[data-help="week-grid"] button:has-text("3Dプリント造形 本塗装")');
        await p.waitForSelector('[data-help="detail-dialog"]', { state: "visible" });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="detail-dialog"]'], padding: 24 },
      anchors: [help("detail-dialog"), help("detail-place"), help("detail-form"), help("detail-status")],
    });

    // 5 枚目: 同じ詳細を下までスクロールしたところ (かかった時間を書く欄)。
    await capture(page, {
      slug: SLUG,
      name: "05-actual",
      url: "/admin/calendar",
      waitFor: '[data-help="week-grid"]',
      actions: async (p) => {
        await scrollGridToMorning(p);
        await p.click('[data-help="week-grid"] button:has-text("3Dプリント造形 本塗装")');
        await p.waitForSelector('[data-help="detail-actual"]', { state: "attached" });
        await p.$eval('[data-help="detail-dialog"] div.overflow-y-auto', (el) => {
          el.scrollTop = el.scrollHeight;
        });
        await p.waitForTimeout(400);
      },
      clipTo: { selectors: ['[data-help="detail-dialog"]'], padding: 24 },
      anchors: [help("detail-dialog"), help("detail-status"), help("detail-actual")],
    });

    // 6 枚目: 「自動で並べる」を押した直後 (点線の下書きと確定バー)。
    await capture(page, {
      slug: SLUG,
      name: "06-auto-place",
      url: "/admin/calendar",
      waitFor: '[data-help="auto-place"]',
      actions: async (p) => {
        await scrollGridToMorning(p);
        await p.click('[data-help="auto-place"]');
        await p.waitForSelector('[data-help="proposal-bar"]', { state: "visible", timeout: 30_000 });
        await p.waitForTimeout(500);
      },
      clipTo: {
        // 「今週あと〇時間」の表示も画角に入れる (注釈 4 番がこのバッジを指すため)。
        selectors: [
          '[data-help="capacity-badge"]',
          '[data-help="proposal-bar"]',
          '[data-help="week-grid"]',
          '[data-help="backlog-tray"]',
        ],
        padding: 16,
      },
      anchors: [help("proposal-bar"), help("week-grid"), help("backlog-tray"), help("capacity-badge")],
    });

    // 7 枚目: 月の表 (ひと月分をまとめて見る)。
    await capture(page, {
      slug: SLUG,
      name: "07-month",
      url: "/admin/calendar",
      waitFor: '[data-help="view-tabs"]',
      actions: async (p) => {
        await p.click('[data-help="view-tabs"] button:has-text("月")');
        await p.waitForSelector('[data-help="month-grid"]', { state: "visible" });
        await p.waitForTimeout(600);
      },
      clipTo: { selectors: ['[data-help="capacity-badge"]', '[data-help="month-grid"]'], padding: 16 },
      anchors: [help("month-grid"), help("view-tabs"), help("view-nav"), help("capacity-badge")],
    });

    console.log(`[help-screenshots] ${SLUG}: 7 枚を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
