/**
 * 発信スタジオ (/admin/studio) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/studio.ts
 *
 * 前提: scripts/help-screenshots/seed-demo/studio.sql を開発ブランチに投入済みであること
 * (固定 UUID の発言 3 件と、レビュー待ちの実行 1 件 + 下書き 3 件)。
 * 出力: public/help/studio/NN-name.png と同名 .json (注釈座標)。
 */
import type { Page } from "playwright-core";

import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "studio";

/** seed-demo/studio.sql が入れる固定 ID (ここを変えたら SQL 側も合わせる)。 */
const SOURCE_RAW = "11111111-1111-4111-8111-111111111101"; // 文字起こし済み・未整文
const SOURCE_CLEANED = "11111111-1111-4111-8111-111111111102"; // 整文済み・実行前
const SOURCE_REVIEW = "11111111-1111-4111-8111-111111111103"; // レビュー待ち
const RUN_REVIEW = "22222222-2222-4222-8222-222222222201";

/** レビュー画面で「自サイトブログ」のタブを開く (撮影で 2 回使うので関数にする)。 */
async function openSiteBlogTab(p: Page): Promise<void> {
  await p.click('[data-help="channel-tabs"] >> text=自サイトブログ');
  await p.waitForTimeout(500);
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 入力画面 (最初に開いたときの姿)。AI の鍵が未設定のときの注意書きも一緒に写す。
    await capture(page, {
      slug: SLUG,
      name: "01-input",
      url: "/admin/studio",
      waitFor: '[data-help="input-form"]',
      clipTo: {
        selectors: [
          '[data-help="page-header"]',
          '[data-help="source-list"]',
          '[data-help="input-form"]',
        ],
        padding: 20,
      },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("source-list"),
        help("stage-progress"),
        help("ai-not-configured"),
        help("input-form"),
        help("input-mode"),
      ],
    });

    // 2 枚目: 整文確認 (話し言葉を読める文に直す段階)。
    await capture(page, {
      slug: SLUG,
      name: "02-clean",
      url: `/admin/studio?source=${SOURCE_RAW}`,
      waitFor: '[data-help="clean-stage"]',
      clipTo: {
        selectors: ['[data-help="stage-progress"]', '[data-help="clean-stage"]'],
        padding: 20,
      },
      anchors: [
        help("stage-progress"),
        help("clean-stage"),
        help("raw-text"),
        help("clean-actions"),
      ],
    });

    // 3 枚目: 実行の設定 (どこ向けに作るかを選ぶ)。
    await capture(page, {
      slug: SLUG,
      name: "03-run",
      url: `/admin/studio?source=${SOURCE_CLEANED}`,
      waitFor: '[data-help="run-form"]',
      clipTo: {
        selectors: ['[data-help="stage-progress"]', '[data-help="run-form"]'],
        padding: 20,
      },
      anchors: [
        help("stage-progress"),
        help("run-form"),
        help("channel-choice"),
        help("research-toggle"),
        help("run-start"),
      ],
    });

    // 4 枚目: レビュー (できあがった下書きを見て直す)。
    await capture(page, {
      slug: SLUG,
      name: "04-review",
      url: `/admin/studio?source=${SOURCE_REVIEW}&run=${RUN_REVIEW}`,
      waitFor: '[data-help="review-panel"]',
      // 3 チャネルのうち「自サイトブログ」のタブを開いた状態で撮る
      // (推測 (inference) 由来の事実主張が黄色で出る例を見せるため)。
      actions: openSiteBlogTab,
      clipTo: {
        selectors: ['[data-help="channel-tabs"]', '[data-help="draft-claims"]'],
        padding: 20,
      },
      anchors: [
        help("channel-tabs"),
        help("draft-status"),
        help("draft-diff"),
        help("draft-claims"),
      ],
    });

    // 5 枚目: 直して決める場所 (手直し・作り直し・却下・承認)。
    await capture(page, {
      slug: SLUG,
      name: "05-decide",
      url: `/admin/studio?source=${SOURCE_REVIEW}&run=${RUN_REVIEW}`,
      waitFor: '[data-help="draft-decide"]',
      // 「自サイトブログ」タブを開き、「編集する」を押して手直し欄を出した状態で撮る。
      actions: async (p) => {
        await openSiteBlogTab(p);
        await p.click('[data-help="draft-edit"] button');
        await p.waitForTimeout(500);
      },
      clipTo: {
        selectors: ['[data-help="draft-edit"]', '[data-help="draft-decide"]'],
        padding: 20,
      },
      anchors: [
        help("draft-edit"),
        help("draft-decide"),
        help("draft-instruction"),
        help("draft-approve"),
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
