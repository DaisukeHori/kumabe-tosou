/**
 * 「画像」ページのヘルプ撮影用デモ画像を、実際の管理画面のアップロード機能から投入する。
 * 実行: npx tsx scripts/help-screenshots/seed-demo/media-upload.ts
 *
 * 画像そのものは SQL では入れられない (実ファイルが Storage に必要) ため、
 * 架空の PNG (media-assets/generate-images.mjs で生成) を画面から取り込む。
 * 既に 8 枚以上ある場合は何もしない (他の担当者のデータを増やさないため)。
 * 投入結果の記録は seed-demo/media.sql に残す。
 */
import path from "node:path";

import type { Page } from "playwright-core";

import { HELP_BASE_URL, REPO_ROOT, createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";

const ASSET_DIR = path.join(REPO_ROOT, "scripts/help-screenshots/seed-demo/media-assets");

type Batch = {
  files: { file: string; alt: string }[];
  tags: string;
  credit: string;
  placeholder: boolean;
};

const BATCHES: Batch[] = [
  {
    tags: "フィギュア, 完成写真",
    credit: "熊部塗装",
    placeholder: false,
    files: [
      { file: "IMG_2381.png", alt: "塗装が仕上がったフィギュアを正面から撮った写真" },
      { file: "IMG_2382.png", alt: "フィギュアに下塗りをしている作業中の写真" },
      { file: "IMG_2415.png", alt: "小物パーツを並べて仕上がりを確認している写真" },
    ],
  },
  {
    tags: "自動車パーツ, 作業風景",
    credit: "熊部塗装",
    placeholder: false,
    files: [
      { file: "IMG_2390.png", alt: "塗装が終わった自動車パーツを台に載せた写真" },
      { file: "IMG_2391.png", alt: "自動車パーツの下地処理をしている写真" },
      { file: "IMG_2402.png", alt: "塗装ブースで吹き付けをしている作業風景" },
      { file: "IMG_2420.png", alt: "工房を外から撮った写真" },
    ],
  },
  {
    tags: "仮素材",
    credit: "",
    placeholder: true,
    files: [{ file: "IMG_2431.png", alt: "看板の色を試し塗りした板の写真 (差し替え予定)" }],
  },
];

async function uploadBatch(page: Page, batch: Batch): Promise<void> {
  await page.click('button:has-text("画像をアップロード")');
  await page.waitForSelector("#upload-dropzone-input", { state: "attached" });
  await page.setInputFiles(
    "#upload-dropzone-input",
    batch.files.map((f) => path.join(ASSET_DIR, f.file)),
  );

  const altInputs = page.locator('input[placeholder="alt テキスト (必須)"]');
  for (let i = 0; i < batch.files.length; i += 1) {
    await altInputs.nth(i).fill(batch.files[i].alt);
  }
  await page.fill("#upload-tags", batch.tags);
  if (batch.credit) await page.fill("#upload-credit", batch.credit);
  if (batch.placeholder) {
    await page.click('[role="dialog"] [role="checkbox"]');
  }

  await page.click(`button:has-text("${batch.files.length}枚をアップロード")`);
  // アップロードが終わるとダイアログが閉じる (失敗した行が残ると閉じないので、そこで気づける)。
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 180_000 });
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await launchHelpBrowser();
  const context = await createHelpContext(browser);
  const page = await newHelpPage(context);

  try {
    await page.goto(`${HELP_BASE_URL}/admin/media`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const existing = await page.locator('[role="button"] img').count();
    if (existing >= 8) {
      console.log(`[seed-demo] 画像が既に ${existing} 枚あるため何もしません`);
      return;
    }

    for (const batch of BATCHES) {
      await uploadBatch(page, batch);
      console.log(`[seed-demo] ${batch.files.length} 枚をアップロードしました (${batch.tags})`);
    }
    console.log("[seed-demo] 完了");
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
