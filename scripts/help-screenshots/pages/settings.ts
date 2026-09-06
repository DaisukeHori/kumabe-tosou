/**
 * 設定 (/admin/settings) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/settings.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 出力: public/help/settings/NN-name.png と同名 .json (注釈座標)。
 *
 * 注意: 撮影中に既存データを書き換えないこと (他の担当者も同時に撮影している)。
 * 「操作後」の 1 枚は、保存が行われない入力エラー (確認用パスワードの不一致) を使う。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "settings";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);
  // 14 個のタブは 1440px 幅だと右端 (アカウント) が隠れてしまうため、
  // タブの並びを見せる 1 枚だけ横に広い画面で撮る。
  const widePage = await newHelpPage(
    await context.browser()!.newContext({
      storageState: await context.storageState(),
      viewport: { width: 1760, height: 900 },
      deviceScaleFactor: 2,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    }),
  );

  try {
    // 1 枚目: タブの並び (14 個の見出し) と画面の上部。
    await capture(widePage, {
      slug: SLUG,
      name: "01-tabs",
      url: "/admin/settings",
      waitFor: '[data-help="settings-tabs"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="settings-tabs"]'], padding: 20 },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("settings-tabs"),
        help("settings-tab-company"),
        help("settings-tab-invoice_issuer"),
        help("settings-tab-integrations"),
        help("settings-tab-account"),
      ],
    });

    // 2 枚目: 「会社情報」タブの入力欄と保存ボタン (全タブ共通の作りの見本)。
    await capture(page, {
      slug: SLUG,
      name: "02-company",
      url: "/admin/settings",
      waitFor: '[data-help="settings-company-form"]',
      // 撮影用の見た目だけ差し替える (保存はしないのでデータは変わらない)。
      // 代表の携帯番号がそのまま写らないようにするため。
      actions: async (p) => {
        // 画面が動き出す (React の準備が終わる) のを待ってから書き換える。
        await p.waitForTimeout(2000);
        await p.fill("#company-tel", "0978-00-0000");
        // 入力欄に枠が付いたままにならないよう、選択を外してから撮る。
        await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      },
      clipTo: { selectors: ['[data-help="settings-tabs"]', '[data-help="settings-company-save"]'], padding: 20 },
      anchors: [
        help("settings-tabs"),
        help("settings-updated-at"),
        help("settings-company-name"),
        help("settings-company-form"),
        help("settings-company-save"),
      ],
    });

    // 3 枚目: 「請求書発行者」タブ (帳票に印字される内容)。
    await capture(page, {
      slug: SLUG,
      name: "03-invoice-issuer",
      url: "/admin/settings?tab=invoice_issuer",
      waitFor: '[data-help="ii-form"]',
      clipTo: { selectors: ['[data-help="settings-tabs"]', '[data-help="ii-save"]'], padding: 20 },
      anchors: [
        help("settings-tab-invoice_issuer"),
        help("ii-issuer-name-field"),
        help("ii-registration-field"),
        help("ii-quote-valid-days-field"),
        help("ii-bank-block"),
        help("ii-seal-field"),
        help("ii-save"),
      ],
    });

    // 4 枚目: 「外部連携」タブ (認証情報の登録)。
    await capture(page, {
      slug: SLUG,
      name: "04-integrations",
      url: "/admin/settings?tab=integrations",
      waitFor: '[data-help="integration-card-google_calendar"]',
      // 開発サーバーで撮っているため、コピー用 URL が localhost のままだと読者が混乱する。
      // 本番のサイトのアドレスに見た目だけ差し替える (保存も送信もしない)。
      actions: async (p) => {
        await p.waitForTimeout(2000);
        await p.evaluate(() => {
          for (const code of document.querySelectorAll("code")) {
            if (code.textContent?.startsWith("http://localhost:3000")) {
              code.textContent = code.textContent.replace(
                "http://localhost:3000",
                "https://yamagishi-tosou.com",
              );
            }
          }
        });
      },
      clipTo: {
        selectors: ['[data-help="integrations-intro"]', '[data-help="integration-card-google_calendar"]'],
        padding: 20,
      },
      anchors: [
        help("integrations-intro"),
        help("integration-card-google_calendar"),
        help("integration-status-google_calendar"),
        help("integration-urls-google_calendar"),
        help("integration-public-id-google_calendar"),
        help("integration-secret-google_calendar"),
        help("integration-save-google_calendar"),
      ],
    });

    // 5 枚目: 「アカウント」タブ (メールアドレスの確認とパスワード変更)。
    await capture(page, {
      slug: SLUG,
      name: "05-account",
      url: "/admin/settings?tab=account",
      waitFor: '[data-help="account-password-form"]',
      clipTo: { selectors: ['[data-help="settings-tabs"]', '[data-help="account-submit"]'], padding: 20 },
      anchors: [
        help("settings-tab-account"),
        help("account-email"),
        help("account-current-password"),
        help("account-new-password"),
        help("account-confirm-password"),
        help("account-submit"),
      ],
    });

    // 6 枚目 (操作後): 確認用パスワードが一致しないまま押したときのエラー表示。
    // 入力の検査だけで止まるため、パスワードは変更されない (データを書き換えない)。
    await capture(page, {
      slug: SLUG,
      name: "06-account-error",
      url: "/admin/settings?tab=account",
      waitFor: '[data-help="account-password-form"]',
      actions: async (p) => {
        await p.fill("#account-current-password", "ちがうパスワード");
        await p.fill("#account-new-password", "newpassword2026");
        await p.fill("#account-confirm-password", "newpassword2027");
        await p.click('[data-help="account-submit"]');
        await p.waitForSelector('[data-help="account-password-form"] [data-slot="field-error"]', {
          timeout: 30_000,
        });
      },
      clipTo: { selectors: ['[data-help="account-password-form"]'], padding: 12 },
      anchors: [
        help("account-current-password"),
        help("account-new-password"),
        help("account-confirm-password"),
        { key: "account-error", selector: '[data-help="account-password-form"] [data-slot="field-error"]' },
        help("account-submit"),
      ],
    });

    console.log(`[help-screenshots] ${SLUG}: 6 枚を撮影しました`);
  } finally {
    await widePage.context().close();
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
