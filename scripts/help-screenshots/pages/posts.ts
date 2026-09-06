/**
 * 記事 (/admin/posts) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/posts.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/posts/NN-name.png と同名 .json (注釈座標)。
 *
 * デモデータ: scripts/help-screenshots/seed-demo/posts.sql
 *   - help-post-draft  (下書き)      … 入力欄・プレビュー・保存の説明に使う
 *   - help-post-review (レビュー待ち) … 予約公開と「公開する」の説明に使う
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "posts";

/** seed-demo/posts.sql で投入した行の id (撮影用デモデータ)。 */
const DRAFT_ID = "3f000002-0000-4000-8000-000000000001";
const REVIEW_ID = "3f000002-0000-4000-8000-000000000002";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧。種類の切り替えと絞り込み。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/posts?kind=reading",
      waitFor: '[data-help="post-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="post-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("post-new"),
        help("post-kind-tabs"),
        help("post-search"),
        help("post-status-filter"),
        help("post-table"),
        help("post-row-1"),
      ],
    });

    // 2 枚目: 新規作成の入力欄。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: "/admin/posts/new?kind=reading",
      waitFor: '[data-help="post-title-field"]',
      // 空欄のままだと何を書く欄か伝わらないので、説明用の文字を入れてから撮る
      // (保存はしないので、開発ブランチのデータは増えない)。
      actions: async (p) => {
        // 画面が反応するようになるまで待ってから入力する (待たずに入れると消える)。
        await p.waitForTimeout(1500);
        await p.fill("#post-title", "色見本の選び方 — 写真の色と実物の色がちがう理由");
        await p.fill("#post-slug", "color-sample-guide");
        await p.fill(
          "#post-excerpt",
          "画面で見た色と塗り上がりの色がちがうのはなぜか。色見本の使い方を説明します。",
        );
        await p.fill(
          "#post-body",
          "## 画面の色はあてになりません\n\nスマホの画面は機種ごとに色みがちがいます。",
        );
        await p.waitForTimeout(200);
      },
      clipTo: {
        selectors: ['[data-help="post-actionbar"]', '[data-help="post-body-field"]'],
        padding: 20,
      },
      anchors: [
        help("post-actionbar"),
        help("post-save"),
        help("post-title-field"),
        help("post-slug-field"),
        help("post-excerpt-field"),
        help("post-body-field"),
        help("post-preview-toggle"),
      ],
    });

    // 3 枚目: プレビュー表示中 (書いた文字が読む人の見え方に変わるところ)。
    await capture(page, {
      slug: SLUG,
      name: "03-preview",
      url: `/admin/posts/${DRAFT_ID}`,
      waitFor: '[data-help="post-preview-toggle"]',
      actions: async (p) => {
        // 画面の読み込み直後はボタンがまだ反応しないことがあるので、少し待ってから押し、
        // 切り替わらなければもう一度押す。
        await p.waitForTimeout(1500);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await p.click('[data-help="post-preview-toggle"] button:has-text("プレビュー")');
          try {
            await p.waitForSelector('[data-help="post-preview"]', { timeout: 5_000 });
            break;
          } catch {
            await p.waitForTimeout(1000);
          }
        }
        await p.waitForSelector('[data-help="post-preview"]', { timeout: 10_000 });
        await p.waitForTimeout(300);
      },
      clipTo: {
        selectors: ['[data-help="post-body-field"]'],
        padding: 20,
      },
      anchors: [help("post-body-field"), help("post-preview-toggle"), help("post-preview")],
    });

    // 4 枚目: レビュー待ちの状態。予約公開の日時と「公開する」が出ているところ。
    await capture(page, {
      slug: SLUG,
      name: "04-publish",
      url: `/admin/posts/${REVIEW_ID}`,
      waitFor: '[data-help="post-transition-published"]',
      // 予約公開の日時欄に例を入れてから撮る (入力するだけで、公開はしない)。
      actions: async (p) => {
        await p.waitForTimeout(1500);
        await p.fill('[data-help="post-schedule"]', "2026-09-15T09:00");
        await p.waitForTimeout(200);
      },
      clipTo: {
        selectors: ['[data-help="page-header"]', '[data-help="post-actionbar"]'],
        padding: 20,
      },
      anchors: [
        help("post-actionbar"),
        help("post-status"),
        help("post-schedule"),
        help("post-transition-draft"),
        help("post-transition-published"),
        help("post-save"),
      ],
    });

    // 5 枚目: 保存した直後 (「保存しました。」の帯) とカバー画像の選び方。
    await capture(page, {
      slug: SLUG,
      name: "05-saved",
      url: `/admin/posts/${DRAFT_ID}`,
      waitFor: '[data-help="post-save"]',
      actions: async (p) => {
        await p.waitForTimeout(1500);
        await p.click('[data-help="post-save"]');
        await p.waitForSelector('[data-help="post-notice"]', { timeout: 30_000 });
        await p.waitForTimeout(500);
      },
      fullPage: true,
      anchors: [
        help("post-actionbar"),
        help("post-save"),
        help("post-status"),
        help("post-notice"),
        help("post-cover-field"),
        help("post-cover-pick"),
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
