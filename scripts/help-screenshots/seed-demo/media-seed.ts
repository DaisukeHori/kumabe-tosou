/**
 * 「画像」ページ (slug: media) のヘルプ撮影用デモ画像を投入する。
 * 実行: npx tsx --env-file=.env.local scripts/help-screenshots/seed-demo/media-seed.ts
 *
 * 同ディレクトリの media-upload.ts は管理画面のアップロード画面を Playwright で
 * 操作する版だが、この撮影環境ではブラウザから Supabase Storage への直接 PUT が
 * 通らない (接続がリセットされる) ため実行できなかった。そこで seed-from-legacy.ts の
 * seedMedia() と同じ手順 (原本アップロード → レンディション生成 → media 行 INSERT) を
 * Node 側で行う。変換ロジックはアプリ本体と同じ image-transform.ts を共用する。
 *
 * - 対象は Supabase 開発ブランチ help-screenshots のみ (本番には投入しない)。
 * - 追加 (INSERT) のみ。既存行の更新・削除はしない (他の担当者が同時に撮影中)。
 * - 画像は media-assets/ の架空 PNG (generate-images.mjs で生成したもの)。
 * - 投入結果の記録は seed-demo/media.sql に残す。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { processImageForRenditions } from "@/modules/media/internal/image-transform";

import { createScriptServiceClient } from "../../lib/service-client";

import { HELP_MEDIA_SEED } from "./media-items";

const ASSET_DIR = path.resolve(import.meta.dirname, "media-assets");

/** 既に同じ名前のファイルがある場合のエラーか (再実行時に無視してよい)。 */
function isAlreadyExists(message: string): boolean {
  return /exists|Duplicate/i.test(message);
}

async function main() {
  const supabase = await createScriptServiceClient();

  for (const item of HELP_MEDIA_SEED) {
    const { data: existing, error: selectError } = await supabase
      .from("media")
      .select("id")
      .eq("id", item.id)
      .maybeSingle();
    if (selectError) throw new Error(`media 確認に失敗 (${item.id}): ${selectError.message}`);
    if (existing) {
      console.log(`[skip] ${item.file} は既に投入済みです`);
      continue;
    }

    const buffer = await readFile(path.join(ASSET_DIR, item.file));
    const storagePath = `help-demo/${item.id}.png`;

    const { error: originalError } = await supabase.storage
      .from("media-originals")
      .upload(storagePath, buffer, { contentType: "image/png", upsert: false });
    if (originalError && !isAlreadyExists(originalError.message)) {
      throw new Error(`原本アップロード失敗 (${item.file}): ${originalError.message}`);
    }

    const { webp, jpeg, width, height } = await processImageForRenditions(buffer);
    for (const rendition of [
      { path: `${item.id}.webp`, body: webp, contentType: "image/webp" },
      { path: `${item.id}.jpg`, body: jpeg, contentType: "image/jpeg" },
    ]) {
      const { error } = await supabase.storage
        .from("media")
        .upload(rendition.path, rendition.body, { contentType: rendition.contentType, upsert: false });
      if (error && !isAlreadyExists(error.message)) {
        throw new Error(`レンディション作成失敗 (${rendition.path}): ${error.message}`);
      }
    }

    const { error: insertError } = await supabase.from("media").insert({
      id: item.id,
      storage_path: storagePath,
      alt: item.alt,
      width,
      height,
      mime_type: "image/png",
      credit: item.credit,
      is_placeholder: item.isPlaceholder,
      tags: item.tags,
    });
    if (insertError) throw new Error(`media INSERT 失敗 (${item.file}): ${insertError.message}`);
    console.log(`[ok] ${item.file} (${width}x${height})`);
  }

  console.log("[seed-demo] media 完了");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
