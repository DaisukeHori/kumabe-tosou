/**
 * 価格表 (/admin/prices) のヘルプ用スクリーンショット撮影。
 * 実行: npx tsx scripts/help-screenshots/pages/prices.ts
 *
 * デモデータ: scripts/help-screenshots/seed-demo/prices.sql
 * (グレード 3 種 × サイズ帯 4 段 + 数量値引き 2 段 + オプション 3 種)。
 */
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

const SLUG = "prices";
const PATH = "/admin/prices";

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    // 1 枚目: 画面全体 (6 つの箱が縦に並んでいることを見せる)。
    await capture(page, {
      slug: SLUG,
      name: "01-overview",
      url: PATH,
      waitFor: '[data-help="price-matrix"]',
      fullPage: true,
      anchors: [
        help("page-header"),
        help("help-button"),
        help("price-grades"),
        help("price-sizes"),
        help("price-matrix"),
        help("price-tiers"),
        help("price-options"),
        help("price-preview"),
        help("price-save"),
      ],
    });

    // 2 枚目: グレードとサイズ帯 (行列の縦軸・横軸を決める部分)。
    await capture(page, {
      slug: SLUG,
      name: "02-grades-sizes",
      url: PATH,
      waitFor: '[data-help="price-sizes"]',
      clipTo: { selectors: ['[data-help="price-grades"]', '[data-help="price-sizes"]'], padding: 20 },
      anchors: [help("price-grades"), help("grade-add"), help("price-sizes"), help("size-add")],
    });

    // 3 枚目: 価格行列 (グレード × サイズ帯のマス目)。
    await capture(page, {
      slug: SLUG,
      name: "03-matrix",
      url: PATH,
      waitFor: '[data-help="price-matrix"]',
      clipTo: { selectors: ['[data-help="price-matrix"]'], padding: 20 },
      anchors: [
        help("price-matrix"),
        help("price-cell-standard-s"),
        help("price-cell-standard-m"),
        help("price-cell-show-l"),
      ],
    });

    // 4 枚目: 数量値引きとオプション (自動で効く割引と、選ばれたときだけ効く追加料金)。
    await capture(page, {
      slug: SLUG,
      name: "04-tiers-options",
      url: PATH,
      waitFor: '[data-help="price-options"]',
      clipTo: { selectors: ['[data-help="price-tiers"]', '[data-help="price-options"]'], padding: 20 },
      anchors: [help("price-tiers"), help("tier-add"), help("price-options"), help("option-add")],
    });

    // 5 枚目: 金額を書き換えた直後 (保存前プレビューに変更前後が並ぶ)。
    // 保存はしない (画面上の下書きを変えるだけ)。
    await capture(page, {
      slug: SLUG,
      name: "05-preview",
      url: PATH,
      waitFor: '[data-help="price-preview-table"]',
      actions: async (p) => {
        const minInput = p.locator('[data-help="price-cell-standard-m"] input').first();
        await minInput.fill("5200");
        await minInput.blur();
        await p.waitForTimeout(300);
      },
      clipTo: {
        selectors: ['[data-help="price-cell-standard-m"]', '[data-help="price-save-row"]'],
        padding: 20,
      },
      anchors: [
        help("price-cell-standard-m"),
        help("price-preview"),
        help("price-preview-table"),
        help("price-save"),
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
