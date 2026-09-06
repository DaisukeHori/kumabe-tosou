/**
 * ログイン (/admin/login) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/login.ts
 *
 * ログイン画面は「未ログインの状態」で撮るのが正しいので、保存済みのログイン状態
 * (storageState) は使わず、まっさらなブラウザコンテキストを自分で作る。
 * 出力: public/help/login/NN-name.png と同名 .json (注釈座標)。
 */
import { launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "login";

async function main() {
  const browser = await launchHelpBrowser();
  // 未ログインのまま撮るため createHelpContext (自動ログイン) は使わない。
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  const page = await newHelpPage(context);

  try {
    // 1 枚目: ログイン画面の全体。
    await capture(page, {
      slug: SLUG,
      name: "01-login",
      url: "/admin/login",
      waitFor: '[data-help="login-card"]',
      clipTo: { selectors: ['[data-help="login-card"]'], padding: 48 },
      anchors: [
        help("login-card"),
        help("login-email"),
        help("login-password"),
        help("login-submit"),
        help("login-forgot"),
        help("login-help-link"),
      ],
    });

    // 2 枚目 (操作後): メールアドレスかパスワードを間違えたときの赤い文字。
    // 実在しないアドレスで 1 回だけ送信する (撮影用アカウントは巻き込まない)。
    await capture(page, {
      slug: SLUG,
      name: "02-error",
      url: "/admin/login",
      waitFor: '[data-help="login-card"]',
      actions: async (p) => {
        await p.fill('[data-help="login-email"]', "machigai@example.com");
        await p.fill('[data-help="login-password"]', "wrong-password-for-help");
        await p.click('[data-help="login-submit"]');
        await p.waitForSelector('[data-help="login-error"]', { timeout: 30_000 });
      },
      clipTo: { selectors: ['[data-help="login-card"]'], padding: 48 },
      anchors: [
        help("login-card"),
        help("login-email"),
        help("login-password"),
        help("login-error"),
        help("login-submit"),
      ],
    });

    // 3 枚目: 管理者として登録されていないアカウントで来たときの案内。
    await capture(page, {
      slug: SLUG,
      name: "03-notice",
      url: "/admin/login?reason=forbidden",
      waitFor: '[data-help="login-notice"]',
      clipTo: { selectors: ['[data-help="login-card"]'], padding: 48 },
      anchors: [
        help("login-notice"),
        help("login-card"),
        help("login-email"),
        help("login-submit"),
      ],
    });

    // 4 枚目: 困ったときの入口 (下の 2 行) を大きく。
    await capture(page, {
      slug: SLUG,
      name: "04-help-link",
      url: "/admin/login",
      waitFor: '[data-help="login-help-link"]',
      clipTo: { selectors: ['[data-help="login-submit"]', '[data-help="login-help-link"]'], padding: 24 },
      anchors: [help("login-submit"), help("login-forgot"), help("login-help-link")],
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
