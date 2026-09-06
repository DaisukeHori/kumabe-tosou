/**
 * 見積書・請求書 (/admin/documents) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/documents.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 追加のデモデータは scripts/help-screenshots/seed-demo/documents.sql。
 * 出力: public/help/documents/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "documents";

/**
 * 説明したい場所だけを切り取るための指定を、注釈キーの一覧からまとめて作る。
 * 画面全体 (fullPage) で撮ると左サイドバーの下端に撮影用アカウントのメールアドレスが
 * 写ってしまうため、本文側の要素だけを囲んだ長方形で撮る
 * (設計書 §7「個人情報・本番データが写っていない」)。
 */
function frame(keys: string[], padding = 20) {
  return {
    anchors: keys.map(help),
    clipTo: { selectors: keys.map((key) => `[data-help="${key}"]`), padding },
  };
}

/** 00-base.sql の下書きの見積 (佐々木様)。明細エディタの説明に使う。 */
const DRAFT_QUOTE_ID = "00e0d55f-a3d4-439a-8c8b-269985724342";
/** documents.sql の発行済みの見積 (2 版 + 送信 2 通)。発行後の画面の説明に使う。 */
const ISSUED_QUOTE_ID = "c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01";
/** documents.sql の一部だけ入金された請求書。残高と入金の説明に使う。 */
const PARTLY_PAID_INVOICE_ID = "c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2a01";
/** 新規作成を「案件が選ばれた状態」で撮るための案件 (松本様 製作中案件)。 */
const DEMO_DEAL_ID = "f503b732-9c96-4dd4-aab8-ad17bf0196e6";

/**
 * 画面が操作できるようになる前に押しても何も起きないので、
 * 目的の要素が出るまで押し直す (開発サーバーは表示直後の一瞬だけ反応しないことがある)。
 */
async function clickUntil(
  page: Awaited<ReturnType<typeof newHelpPage>>,
  selector: string,
  appears: string,
  tries = 10,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await page.click(selector);
    try {
      await page.waitForSelector(appears, { timeout: 1500 });
      return;
    } catch {
      // まだ操作できていないだけなので押し直す。
    }
  }
  throw new Error(`${selector} を押しても ${appears} が出ませんでした`);
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 一覧 (絞り込み・検索・行の見方)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/documents",
      waitFor: '[data-help="doc-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="doc-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("doc-new"),
        help("doc-type-filter"),
        help("doc-status-filter"),
        help("doc-search"),
        help("doc-table"),
        help("doc-row-first"),
        help("doc-pay-from-list"),
      ],
    });

    // 2 枚目: 新規作成 (案件を選んだ状態で撮り、宛名が自動で入ることを見せる)。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: `/admin/documents/new?deal_id=${DEMO_DEAL_ID}`,
      waitFor: '[data-help="doc-new-form"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="doc-new-form"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("doc-new-form"),
        help("doc-new-deal"),
        help("doc-new-type"),
        help("doc-new-first-line"),
        help("doc-new-tax"),
        help("doc-new-submit"),
      ],
    });

    // 3 枚目: 下書きの編集画面 (明細・消費税・発行ボタン)。
    await capture(page, {
      slug: SLUG,
      name: "03-editor",
      url: `/admin/documents/${DRAFT_QUOTE_ID}`,
      waitFor: '[data-help="doc-edit-lines"]',
      ...frame([
        "help-button",
        "doc-edit-fields",
        "doc-edit-billing",
        "doc-edit-issue-date",
        "doc-edit-rounding",
        "doc-edit-lines",
        "doc-edit-preset",
        "doc-edit-add-line",
        "doc-edit-totals",
        "doc-edit-save",
        "doc-edit-preview",
        "doc-edit-issue",
        "doc-edit-delete",
      ]),
    });

    // 4 枚目: 発行済みの見積 (承諾・送付・再出力・訂正発行・取消と、版履歴・送信履歴)。
    await capture(page, {
      slug: SLUG,
      name: "04-issued-quote",
      url: `/admin/documents/${ISSUED_QUOTE_ID}`,
      waitFor: '[data-help="doc-detail-actions"]',
      ...frame([
        "help-button",
        "doc-detail-summary",
        "doc-detail-actions",
        "doc-accept",
        "doc-decline",
        "doc-derive",
        "doc-pdf",
        "doc-send-email",
        "doc-reissue",
        "doc-revise",
        "doc-void",
        "doc-versions",
        "doc-emails",
      ]),
    });

    // 5 枚目: 請求書の入金 (残高・入金を記録・入金履歴)。
    await capture(page, {
      slug: SLUG,
      name: "05-invoice",
      url: `/admin/documents/${PARTLY_PAID_INVOICE_ID}`,
      waitFor: '[data-help="doc-payments"]',
      ...frame([
        "help-button",
        "doc-detail-summary",
        "doc-detail-actions",
        "doc-record-payment",
        "doc-pdf",
        "doc-payments",
      ]),
    });

    // 6 枚目: 入金を記録するダイアログ (残高が最初から入っている)。記録はしない。
    await capture(page, {
      slug: SLUG,
      name: "06-payment-dialog",
      url: `/admin/documents/${PARTLY_PAID_INVOICE_ID}`,
      waitFor: '[data-help="doc-record-payment"]',
      actions: async (p) => {
        await clickUntil(p, '[data-help="doc-record-payment"]', '[data-help="doc-payment-dialog"]');
      },
      clipTo: { selectors: ['[data-help="doc-payment-dialog"]'], padding: 28 },
      anchors: [
        help("doc-payment-dialog"),
        help("doc-payment-date"),
        help("doc-payment-amount"),
        help("doc-payment-method"),
        help("doc-payment-submit"),
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
