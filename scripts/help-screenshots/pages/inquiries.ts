/**
 * 「問い合わせ」(/admin/inquiries) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/inquiries.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * デモデータ: scripts/help-screenshots/seed-demo/inquiries.sql
 * 出力: public/help/inquiries/NN-name.png と同名 .json (注釈座標)。
 *
 * どの場面も、既にあるデータを書き換えないもの (開く・絞り込む・選択肢を出す) だけで
 * 作っている。撮り直しても同じ絵になる。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "inquiries";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧 (届いた順に並ぶ)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/inquiries",
      waitFor: '[data-help="inquiry-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="inquiry-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("inquiry-filter"),
        help("inquiry-table"),
        help("inquiry-row"),
        help("inquiry-status"),
        help("inquiry-lead"),
      ],
    });

    // 2 枚目: 行を開いた小窓 (全文と連絡先が読める)。
    await capture(page, {
      slug: SLUG,
      name: "02-detail",
      url: "/admin/inquiries",
      waitFor: '[data-help="inquiry-row"]',
      actions: async (p) => {
        await p.click('[data-help="inquiry-row"]');
        await p.waitForSelector('[data-help="inquiry-dialog"]', { state: "visible" });
        await p.waitForTimeout(400); // 小窓が開ききるまで待つ
      },
      anchors: [
        help("inquiry-dialog"),
        help("inquiry-body"),
        help("inquiry-dialog-lead"),
        help("inquiry-status-select"),
        help("inquiry-save"),
      ],
    });

    // 3 枚目: 「未対応」だけに絞り込んだ一覧 (絞り込みを押した後)。
    await capture(page, {
      slug: SLUG,
      name: "03-filter-new",
      url: "/admin/inquiries?status=new",
      waitFor: '[data-help="inquiry-table"]',
      clipTo: { selectors: ['[data-help="inquiry-filter"]', '[data-help="inquiry-table"]'], padding: 20 },
      anchors: [help("inquiry-filter"), help("inquiry-table"), help("inquiry-row"), help("inquiry-status")],
    });

    // 4 枚目 (操作中): 小窓の「状態」を押して、選べる 4 つが出たところ。
    await capture(page, {
      slug: SLUG,
      name: "04-status",
      url: "/admin/inquiries",
      waitFor: '[data-help="inquiry-row"]',
      actions: async (p) => {
        await p.click('[data-help="inquiry-row"]');
        await p.waitForSelector('[data-help="inquiry-status-select"]', { state: "visible" });
        await p.click('[data-help="inquiry-status-select"]');
        await p.waitForSelector('[data-slot="select-content"]', { state: "visible" });
        await p.waitForTimeout(400);
      },
      anchors: [
        help("inquiry-dialog"),
        help("inquiry-status-select"),
        { key: "status-options", selector: '[data-slot="select-content"]' },
        help("inquiry-save"),
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
