import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * ヘルプ用スクリーンショット撮影のブラウザ起動まわり。
 * canonical: docs/design/admin-help/README.md §5。
 *
 * 撮影先は必ず開発サーバー (localhost:3000) + Supabase 開発ブランチ。
 * 本番データは絶対に写さない (デモデータのみ)。
 */

export const HELP_BASE_URL = process.env.HELP_BASE_URL ?? "http://localhost:3000";
export const HELP_LOGIN_EMAIL = process.env.HELP_LOGIN_EMAIL ?? "help-admin@example.com";
export const HELP_LOGIN_PASSWORD = process.env.HELP_LOGIN_PASSWORD ?? "help-screenshots-2026";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const AUTH_STATE_PATH = path.join(REPO_ROOT, "scripts/help-screenshots/.auth/state.json");

/** 同梱 Chromium の実行ファイルを探す (/opt/pw-browsers/chromium-XXXX/chrome-linux/chrome)。 */
export function resolveChromiumExecutable(): string {
  const root = "/opt/pw-browsers";
  const dir = readdirSync(root).find((name) => name.startsWith("chromium-"));
  if (!dir) throw new Error(`${root} に chromium-* が見つかりません`);
  const exe = path.join(root, dir, "chrome-linux", "chrome");
  if (!existsSync(exe)) throw new Error(`Chromium 実行ファイルが見つかりません: ${exe}`);
  return exe;
}

export async function launchHelpBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: resolveChromiumExecutable(),
    args: ["--no-sandbox"],
  });
}

/**
 * 撮影用のブラウザコンテキストを返す。
 * 保存済みのログイン状態 (storageState) があれば再利用し、無ければログインして保存する。
 */
export async function createHelpContext(browser: Browser): Promise<BrowserContext> {
  const options = {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  } as const;

  if (existsSync(AUTH_STATE_PATH)) {
    const context = await browser.newContext({ ...options, storageState: AUTH_STATE_PATH });
    if (await isSignedIn(context)) return context;
    await context.close();
  }

  const context = await browser.newContext(options);
  await signIn(context);
  mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
  await context.storageState({ path: AUTH_STATE_PATH });
  return context;
}

async function isSignedIn(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(`${HELP_BASE_URL}/admin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    return !page.url().includes("/admin/login");
  } finally {
    await page.close();
  }
}

async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${HELP_BASE_URL}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.fill("#login-email", HELP_LOGIN_EMAIL);
    await page.fill("#login-password", HELP_LOGIN_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/admin/login"), { timeout: 60_000 }),
      page.click('button[type="submit"]'),
    ]);
  } finally {
    await page.close();
  }
}

/** 撮影用のページを 1 枚開く (共通の待ち設定込み)。 */
export async function newHelpPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return page;
}
