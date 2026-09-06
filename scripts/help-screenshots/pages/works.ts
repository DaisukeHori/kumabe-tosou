/**
 * 施工事例 (/admin/works) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/works.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/works/NN-name.png と同名 .json (注釈座標)。
 *
 * デモデータ: scripts/help-screenshots/seed-demo/works.sql
 *   - help-work-draft  (下書き)      … 入力欄と画像まわりの説明に使う
 *   - help-work-review (レビュー待ち) … 予約公開と「公開する」の説明に使う
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "works";

/** seed-demo/works.sql で投入した行の id (撮影用デモデータ)。 */
const DRAFT_ID = "3f000001-0000-4000-8000-000000000001";
const REVIEW_ID = "3f000001-0000-4000-8000-000000000002";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧。探す・絞り込む・新しく作るの入口。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/works",
      waitFor: '[data-help="work-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="work-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("work-new"),
        help("work-search"),
        help("work-status-filter"),
        help("work-table"),
        help("work-row-1"),
      ],
    });

    // 2 枚目: 新規作成の入力欄。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: "/admin/works/new",
      waitFor: '[data-help="work-title-field"]',
      // 空欄のままだと何を書く欄か伝わらないので、説明用の文字を入れてから撮る
      // (保存はしないので、開発ブランチのデータは増えない)。
      actions: async (p) => {
        // 画面が反応するようになるまで待ってから入力する (待たずに入れると消える)。
        await p.waitForTimeout(1500);
        await p.fill("#work-title", "ヘルメット キャンディレッド塗装");
        await p.fill("#work-slug", "helmet-candy-red");
        await p.fill("#work-category", "vehicle");
        await p.fill(
          "#work-body",
          "3D プリントのヘルメット外装を、深みのある赤で塗装しました。\n\n赤の下に銀を敷き、透ける赤を上から重ねています。",
        );
        await p.fill("#work-process-note", "研磨→下地→銀→キャンディレッド→クリア");
        await p.waitForTimeout(200);
      },
      clipTo: {
        selectors: ['[data-help="work-actionbar"]', '[data-help="work-process-field"]'],
        padding: 20,
      },
      anchors: [
        help("work-actionbar"),
        help("work-save"),
        help("work-title-field"),
        help("work-slug-field"),
        help("work-category-field"),
        help("work-body-field"),
        help("work-process-field"),
      ],
    });

    // 3 枚目: 画像と並び順 (カバー画像・添付画像・表示順)。
    await capture(page, {
      slug: SLUG,
      name: "03-images",
      url: `/admin/works/${DRAFT_ID}`,
      waitFor: '[data-help="work-images-field"]',
      clipTo: {
        selectors: ['[data-help="work-cover-field"]', '[data-help="work-images-field"]'],
        padding: 20,
      },
      anchors: [
        help("work-cover-field"),
        help("work-cover-pick"),
        help("work-sort-field"),
        help("work-images-field"),
        help("work-images-pick"),
      ],
    });

    // 4 枚目: レビュー待ちの状態。予約公開の日時と「公開する」が出ているところ。
    await capture(page, {
      slug: SLUG,
      name: "04-publish",
      url: `/admin/works/${REVIEW_ID}`,
      waitFor: '[data-help="work-transition-published"]',
      // 予約公開の日時欄に例を入れてから撮る (入力するだけで、公開はしない)。
      actions: async (p) => {
        await p.waitForTimeout(1500);
        await p.fill('[data-help="work-schedule"]', "2026-09-15T09:00");
        await p.waitForTimeout(200);
      },
      clipTo: {
        selectors: ['[data-help="page-header"]', '[data-help="work-actionbar"]'],
        padding: 20,
      },
      anchors: [
        help("work-actionbar"),
        help("work-status"),
        help("work-schedule"),
        help("work-transition-draft"),
        help("work-transition-published"),
        help("work-save"),
      ],
    });

    // 5 枚目: 保存した直後 (「保存しました。」の帯が出た状態)。
    await capture(page, {
      slug: SLUG,
      name: "05-saved",
      url: `/admin/works/${DRAFT_ID}`,
      waitFor: '[data-help="work-save"]',
      actions: async (p) => {
        await p.waitForTimeout(1500);
        await p.click('[data-help="work-save"]');
        await p.waitForSelector('[data-help="work-notice"]', { timeout: 30_000 });
        await p.waitForTimeout(500);
      },
      clipTo: {
        selectors: ['[data-help="work-actionbar"]', '[data-help="work-title-field"]'],
        padding: 20,
      },
      anchors: [
        help("work-actionbar"),
        help("work-save"),
        help("work-status"),
        help("work-notice"),
        help("work-title-field"),
      ],
    });


    // 「画像を選ぶ」ダイアログは、この撮影環境ではサムネイル写真が読み込めず灰色の四角に
    // なってしまうため撮っていない (ダイアログの中身は本文で説明する)。
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
