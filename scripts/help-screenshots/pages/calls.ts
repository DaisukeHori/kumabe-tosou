/**
 * 通話 (/admin/calls) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/calls.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * デモデータの投入 SQL は scripts/help-screenshots/seed-demo/calls.sql に置いてある。
 * 出力: public/help/calls/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "calls";

/** 文字起こし・要約まで終わった通話 (seed-demo/calls.sql の 1 件目)。 */
const DONE_CALL_ID = "4ca11001-0000-4000-8000-000000000001";
/** 文字起こしに失敗した通話 (seed-demo/calls.sql の 2 件目)。 */
const FAILED_CALL_ID = "4ca11001-0000-4000-8000-000000000002";
/** 同じ番号の顧客が複数いて「要確認」になっている通話 (00-base.sql のデモデータ)。 */
const AMBIGUOUS_CALL_ID = "b3ec6d22-2f4b-4353-aa58-d2a6f8125f9d";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧 (どんな電話が来たかの一覧表)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/calls",
      waitFor: '[data-help="calls-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="calls-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("calls-filters"),
        help("calls-table"),
        help("calls-row-1"),
        help("calls-handling-1"),
        help("calls-job-status-1"),
        help("calls-summary-1"),
        help("calls-review-badge"),
      ],
    });

    // 2 枚目: 詳細の全体 (1 本の電話について分かることの地図)。
    await capture(page, {
      slug: SLUG,
      name: "02-detail",
      url: `/admin/calls/${DONE_CALL_ID}`,
      waitFor: '[data-help="call-minutes"]',
      // fullPage で撮ると左メニュー下端の撮影用アカウント名まで写るため、本文だけを切り取る
      // (設計書 §7「個人情報が写っていないこと」)。
      clipTo: {
        selectors: [
          '[data-help="page-header"]',
          '[data-help="help-button"]',
          '[data-help="call-customer-link"]',
          '[data-help="call-memo"]',
        ],
        padding: 20,
      },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("call-cost"),
        help("call-customer-link"),
        help("call-recordings"),
        help("call-minutes"),
        help("call-tasks"),
        help("call-jobs"),
        help("call-memo"),
      ],
    });

    // 3 枚目: 要約タブ (AI がまとめた内容とやること)。
    await capture(page, {
      slug: SLUG,
      name: "03-summary",
      url: `/admin/calls/${DONE_CALL_ID}`,
      waitFor: '[data-help="call-summary-body"]',
      clipTo: { selectors: ['[data-help="call-minutes"]', '[data-help="call-tasks"]'], padding: 20 },
      anchors: [
        help("call-tab-summary"),
        help("call-tab-full"),
        help("call-summary-body"),
        help("call-tasks"),
      ],
    });

    // 4 枚目: 全文タブに切り替えたところ (話した言葉そのまま)。
    await capture(page, {
      slug: SLUG,
      name: "04-transcript",
      url: `/admin/calls/${DONE_CALL_ID}`,
      waitFor: '[data-help="call-tab-full"]',
      actions: async (p) => {
        await p.click('[data-help="call-tab-full"]');
        await p.waitForSelector('[data-help="call-transcript-body"]');
      },
      clipTo: { selectors: ['[data-help="call-minutes"]'], padding: 20 },
      anchors: [help("call-tab-summary"), help("call-tab-full"), help("call-transcript-body")],
    });

    // 5 枚目: 顧客を検索して紐づけるダイアログを開いたところ。
    await capture(page, {
      slug: SLUG,
      name: "05-customer-link",
      url: `/admin/calls/${AMBIGUOUS_CALL_ID}`,
      waitFor: '[data-help="call-link-search"]',
      actions: async (p) => {
        await p.click('[data-help="call-link-search"]');
        await p.waitForSelector('[data-help="call-search-dialog"]');
        await p.fill('[data-help="call-search-input"]', "田中");
        await p.waitForTimeout(1200);
      },
      // 小窓だけを切り取る (左メニューの撮影用アカウント名を写さないため)。
      // 番号バッジ (枠の左上に描かれる) が切れないよう、少し広めに余白を取る。
      clipTo: { selectors: ['[data-help="call-search-dialog"]'], padding: 40 },
      anchors: [help("call-search-dialog"), help("call-search-input"), help("call-search-results")],
    });

    // 6 枚目: 処理に失敗した通話 (再実行ボタンと、まだ顧客が決まっていない状態)。
    await capture(page, {
      slug: SLUG,
      name: "06-failed",
      url: `/admin/calls/${FAILED_CALL_ID}`,
      waitFor: '[data-help="call-job-retry"]',
      clipTo: { selectors: ['[data-help="call-customer-link"]', '[data-help="call-jobs"]'], padding: 20 },
      anchors: [
        help("call-customer-link"),
        help("call-link-search"),
        help("call-link-create"),
        help("call-jobs"),
        help("call-job-retry"),
      ],
    });

    console.log(`[help-screenshots] ${SLUG}: 6 枚を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
