/**
 * 案件 (/admin/deals) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/deals.ts
 *
 * 撮影先は開発サーバー + Supabase 開発ブランチのデモデータ (本番データは写さない)。
 * 追加のデモデータは scripts/help-screenshots/seed-demo/deals.sql。
 * 出力: public/help/deals/NN-name.png と同名 .json (注釈座標)。
 */
import type { Page } from "playwright-core";

import { HELP_BASE_URL, createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help, type CaptureAnchor, type CaptureSpec } from "../lib/capture";

const SLUG = "deals";

/** 00-base.sql のデモ案件「小林様 自動車パーツ塗装 受注」(受注ステージ・帳票と作業ブロックあり)。 */
const DEMO_ORDERED_DEAL = "5529654d-511e-4706-a1f4-e2ef74016abe";
/** 00-base.sql のデモ案件「田中様 過去のご依頼(入金済み)」(終端ステージ = 再開の説明用)。 */
const DEMO_PAID_DEAL = "07b98327-95c8-41f8-80c8-d386c7cf0643";

/** カンバンの列は共通部品 (KanbanColumn) が描くので、data-help ではなく読み上げ用の名前で指す。 */
function column(key: string, label: string): CaptureAnchor {
  return { key, selector: `[role="group"][aria-label="${label}"]` };
}

/** その列の一番上のカード (列 = 見出し + カード置き場 の 2 段構造)。 */
function firstCard(key: string, label: string): CaptureAnchor {
  return { key, selector: `[role="group"][aria-label="${label}"] > div:last-child > div:first-child` };
}

/**
 * 開発サーバーは、その画面を初めて開くときだけ組み立てに時間がかかる。
 * 撮影本体 (capture) の待ち時間は共通で 60 秒に決まっているので、
 * 先に一度だけ長めに待って開いておく (失敗しても無視して撮影に進む)。
 */
async function warmUp(page: Page, url: string): Promise<void> {
  try {
    await page.goto(`${HELP_BASE_URL}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  } catch {
    // 組み立てが間に合わなくても、撮影側でもう一度開き直すのでここでは止めない。
  }
}

/**
 * 画面が操作できるようになる前に押しても何も起きないので、
 * 目的の要素が出るまで押し直す (開発サーバーは表示直後の一瞬だけ反応しないことがある)。
 */
async function clickUntil(page: Page, selector: string, appears: string, tries = 10): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await page.click(selector);
    try {
      await page.waitForSelector(appears, { timeout: 1500 });
      return;
    } catch {
      // まだ操作を受け付けていないだけなので押し直す。
    }
  }
  throw new Error(`${selector} を押しても ${appears} が出ませんでした`);
}

/**
 * 撮り直したい画像だけを名前で指定できるようにする (例: `npx tsx ... deals.ts 04-detail 06-reopen`)。
 * 何も指定しなければ 6 枚すべてを撮る。
 */
const ONLY = new Set(process.argv.slice(2));
function shoot(name: string): boolean {
  return ONLY.size === 0 || ONLY.has(name);
}

/** 指定された画像だけを撮る (指定が無ければ全部撮る)。 */
async function maybeCapture(page: Page, spec: CaptureSpec): Promise<void> {
  if (!shoot(spec.name)) return;
  await capture(page, spec);
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: カンバン (案件を段階ごとの列で見る画面)。
    await maybeCapture(page, {
      slug: SLUG,
      name: "01-kanban",
      url: "/admin/deals",
      waitFor: '[role="grid"][aria-label="案件カンバン"]',
      clipTo: {
        selectors: ['[data-help="page-header"]', '[data-help="deal-closed-columns"]'],
        padding: 16,
      },
      anchors: [
        help("page-header"),
        help("help-button"),
        help("deal-view-toggle"),
        help("deal-new"),
        help("deal-pipeline-total"),
        { key: "deal-kanban", selector: '[role="grid"][aria-label="案件カンバン"]' },
        column("deal-column-estimating", "見積作成"),
        firstCard("deal-card-estimating", "見積作成"),
        column("deal-column-quote-sent", "見積送付"),
        help("deal-closed-columns"),
      ],
    });

    // 2 枚目: 表 (一覧) 表示。ステージの絞り込みと並びの説明用。
    await maybeCapture(page, {
      slug: SLUG,
      name: "02-table",
      url: "/admin/deals?view=table",
      waitFor: '[data-help="deal-table"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="deal-table"]'], padding: 16 },
      anchors: [
        help("page-header"),
        help("deal-view-toggle"),
        help("deal-new"),
        help("deal-stage-filter"),
        help("deal-table"),
        help("deal-row-1"),
      ],
    });

    // 3 枚目: 新規作成の入力画面。
    await maybeCapture(page, {
      slug: SLUG,
      name: "03-new",
      url: "/admin/deals/new",
      waitFor: '[data-help="deal-form"]',
      clipTo: { selectors: ['[data-help="page-header"]', '[data-help="deal-form"]'], padding: 16 },
      anchors: [
        help("page-header"),
        help("deal-field-title"),
        help("deal-field-customer"),
        help("deal-field-amount"),
        help("deal-field-close"),
        help("deal-field-source"),
        help("deal-field-notes"),
        help("deal-submit"),
      ],
    });

    if (shoot("04-detail") || shoot("05-lost")) await warmUp(page, `/admin/deals/${DEMO_ORDERED_DEAL}`);

    // 4 枚目: 案件の詳細 (受注ステージ — 帳票・作業ブロック・タイムラインが全部そろう)。
    await maybeCapture(page, {
      slug: SLUG,
      name: "04-detail",
      url: `/admin/deals/${DEMO_ORDERED_DEAL}`,
      waitFor: '[data-help="deal-stage-summary"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("deal-actions"),
        help("deal-stage-summary"),
        help("deal-stage-bar"),
        help("deal-stage-stats"),
        help("deal-overview"),
        help("deal-edit"),
        help("deal-tasks"),
        help("deal-documents"),
        help("deal-work-blocks"),
        help("deal-generate-blocks"),
        help("deal-timeline"),
      ],
    });

    // 5 枚目: 「操作」→「失注にする」で出る、失注理由の入力窓 (確定はしない)。
    await maybeCapture(page, {
      slug: SLUG,
      name: "05-lost",
      url: `/admin/deals/${DEMO_ORDERED_DEAL}`,
      waitFor: '[data-help="deal-actions"]',
      actions: async (p) => {
        await clickUntil(p, '[data-help="deal-actions"]', '[role="menuitem"]');
        await p.getByRole("menuitem", { name: "失注にする" }).click();
        await p.waitForSelector('[data-help="deal-lost-dialog"]');
        await p.fill('[data-help="deal-lost-reason"]', "他社の見積りの方が安かったため");
        await p.waitForTimeout(200);
      },
      clipTo: { selectors: ['[data-help="deal-lost-dialog"]'], padding: 28 },
      anchors: [
        help("deal-lost-dialog"),
        help("deal-lost-reason"),
        help("deal-lost-submit"),
      ],
    });

    if (shoot("06-reopen")) await warmUp(page, `/admin/deals/${DEMO_PAID_DEAL}`);

    // 6 枚目: 入金済み (終わった案件) の詳細で「案件を再開…」を押した窓 (確定はしない)。
    await maybeCapture(page, {
      slug: SLUG,
      name: "06-reopen",
      url: `/admin/deals/${DEMO_PAID_DEAL}`,
      waitFor: '[data-help="deal-reopen"]',
      actions: async (p) => {
        await clickUntil(p, '[data-help="deal-reopen"]', '[data-help="deal-reopen-dialog"]');
        await p.fill('[data-help="deal-reopen-reason"]', "追加のご依頼をいただいたため");
        await p.waitForTimeout(200);
      },
      clipTo: { selectors: ['[data-help="deal-reopen-dialog"]'], padding: 28 },
      anchors: [
        help("deal-reopen-dialog"),
        help("deal-reopen-stage"),
        help("deal-reopen-reason"),
        help("deal-reopen-submit"),
      ],
    });

    console.log(`[help-screenshots] ${SLUG}: ${ONLY.size === 0 ? "6 枚" : [...ONLY].join(", ")} を撮影しました`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
