/**
 * 顧客 (/admin/customers) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/customers.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 追加のデモデータは scripts/help-screenshots/seed-demo/customers.sql。
 * 出力: public/help/customers/NN-name.png と同名 .json (注釈座標)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "customers";

/**
 * 画面が操作できるようになる前に押してしまうと何も起きないので、
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

/** 00-base.sql のデモ顧客「田中 一郎」(取引中・案件/やること/タイムラインあり)。 */
const DEMO_CUSTOMER_ID = "11d6e02c-bde6-4f21-b2e5-44072c1870da";
/** customers.sql で足した同姓同名の 2 件目 (統合の説明用)。電話番号で見分ける。 */
const DEMO_DUPLICATE_TEL = "819000000131";
/** 既存顧客と同じメール (重複の警告を出すために入力する。作成はされない)。 */
const DEMO_EXISTING_EMAIL = "tanaka.demo1@example.com";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 顧客の一覧 (探し方と並びの説明)。
    await capture(page, {
      slug: SLUG,
      name: "01-list",
      url: "/admin/customers",
      waitFor: '[data-help="customer-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="customer-table"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("customer-new"),
        help("customer-tabs"),
        help("customer-search"),
        help("customer-lifecycle-filter"),
        help("customer-table"),
        help("customer-row-first"),
      ],
    });

    // 2 枚目: 新規作成のフォーム (法人担当者を選んで「会社」欄も写す)。
    await capture(page, {
      slug: SLUG,
      name: "02-new",
      url: "/admin/customers/new",
      waitFor: '[data-help="customer-form"]',
      actions: async (p) => {
        await clickUntil(
          p,
          '[data-help="customer-kind"] button:has-text("法人担当者")',
          '[data-help="customer-field-company"]',
        );
      },
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="customer-form"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("customer-kind"),
        help("customer-field-name"),
        help("customer-field-email"),
        help("customer-field-tel"),
        help("customer-field-source"),
        help("customer-field-company"),
        help("customer-field-lifecycle"),
        help("customer-submit"),
      ],
    });

    // 3 枚目: 操作後の変化 (すでにいるお客様と同じメールで作ろうとしたときの警告)。
    // この時点では顧客は作られない (警告だけが返る)。
    await capture(page, {
      slug: SLUG,
      name: "03-duplicate",
      url: "/admin/customers/new",
      waitFor: '[data-help="customer-form"]',
      actions: async (p) => {
        // 画面が操作できる状態になるまで待つ (種別を切り替えて元に戻すことで確かめる)。
        await clickUntil(
          p,
          '[data-help="customer-kind"] button:has-text("法人担当者")',
          '[data-help="customer-field-company"]',
        );
        await p.click('[data-help="customer-kind"] button:has-text("個人")');
        await p.fill('[data-help="customer-field-name"]', "田中 一郎");
        await p.fill('[data-help="customer-field-email"]', DEMO_EXISTING_EMAIL);
        await p.click('[data-help="customer-submit"]');
        await p.waitForSelector('[data-help="customer-duplicate-dialog"]');
      },
      clipTo: { selectors: ['[data-help="customer-duplicate-dialog"]'], padding: 28 },
      anchors: [
        help("customer-duplicate-dialog"),
        help("customer-duplicate-list"),
        help("customer-duplicate-back"),
        help("customer-duplicate-force"),
      ],
    });

    // 4 枚目: 顧客の詳細 (基本情報カード・案件・やること・タイムライン)。
    await capture(page, {
      slug: SLUG,
      name: "04-detail",
      url: `/admin/customers/${DEMO_CUSTOMER_ID}`,
      waitFor: '[data-help="customer-profile"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("customer-profile"),
        help("customer-lifecycle-badge"),
        help("customer-profile-fields"),
        help("customer-edit"),
        help("customer-actions"),
        help("customer-deals"),
        help("customer-tasks"),
        help("customer-timeline"),
      ],
    });

    // 5 枚目: 編集パネル (請求先・配送先・追加情報)。右から出るパネルの下半分まで送る。
    await capture(page, {
      slug: SLUG,
      name: "05-edit",
      url: `/admin/customers/${DEMO_CUSTOMER_ID}`,
      waitFor: '[data-help="customer-edit"]',
      actions: async (p) => {
        await clickUntil(p, '[data-help="customer-edit"]', '[data-help="customer-edit-sheet"]');
        // 「請求先」の見出しがパネルの一番上に来るところまで送る
        // (下端まで送ると見出しが切れて、どの欄の説明か分からなくなるため)。
        await p.evaluate(() => {
          const sheet = document.querySelector('[data-help="customer-edit-sheet"]');
          const billing = document.querySelector('[data-help="customer-billing"]');
          if (!sheet || !billing) return;
          sheet.scrollTop += billing.getBoundingClientRect().top - sheet.getBoundingClientRect().top - 8;
        });
        await p.waitForTimeout(300);
      },
      clipTo: { selectors: ['[data-help="customer-edit-sheet"]'], padding: 0 },
      anchors: [
        help("customer-edit-sheet"),
        help("customer-billing"),
        help("customer-shipping"),
        help("customer-custom-fields"),
      ],
    });

    // 6 枚目: 重複の統合ダイアログ (相手を選び終えた状態)。
    await capture(page, {
      slug: SLUG,
      name: "06-merge",
      url: `/admin/customers/${DEMO_CUSTOMER_ID}`,
      waitFor: '[data-help="customer-actions"]',
      actions: async (p) => {
        await clickUntil(p, '[data-help="customer-actions"]', '[role="menuitem"]');
        await p.getByRole("menuitem", { name: "重複を統合" }).click();
        await p.waitForSelector('[data-help="customer-merge-dialog"]');
        await p.click('[data-help="customer-merge-picker"] button');
        await p.keyboard.type("田中");
        await p.waitForSelector(`[role="option"]:has-text("${DEMO_DUPLICATE_TEL}")`);
        await p.click(`[role="option"]:has-text("${DEMO_DUPLICATE_TEL}")`);
        await p.waitForTimeout(300);
      },
      clipTo: { selectors: ['[data-help="customer-merge-dialog"]'], padding: 28 },
      anchors: [
        help("customer-merge-dialog"),
        help("customer-merge-warning"),
        help("customer-merge-picker"),
        help("customer-merge-submit"),
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
