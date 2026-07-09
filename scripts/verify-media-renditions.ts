/**
 * 全 media 行の公開レンディション (`{id}.webp`) が実際に "media" バケットに存在するかを
 * 検証し、欠損があれば media-originals の原本から webp/jpeg を再生成してアップロードする
 * (冪等、既存分は再アップロードしない)。
 *
 * canonical: docs/design/visual-media-editor.md §2.3 (V0 メディア URL 規約の統一 — hotfix)。
 * 受入基準 (a) 「検証スクリプトで全 media 行の {id}.webp が 200」を機械的に確定させる。
 *
 * "media" バケットは RLS 上 list() を禁止しているため (src/modules/media/repository.ts の
 * renditionExists() と同じ理由)、存在確認は公開配信エンドポイントへの HEAD リクエストで行う。
 * レンディション生成は src/modules/media/internal/image-transform.ts
 * (server-only 非依存) を直接 import して共用する (scripts/seed-from-legacy.ts と同じ理由:
 * tsx 直接実行では "server-only" 経由の image-processing.ts を import できないため)。
 *
 * 使い方: npx tsx scripts/verify-media-renditions.ts
 * 必要 env: NEXT_PUBLIC_SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY もしくは
 *           BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD。scripts/lib/service-client.ts 参照)
 */
import { processImageForRenditions } from "@/modules/media/internal/image-transform";

import { createScriptServiceClient } from "./lib/service-client";

type Supa = Awaited<ReturnType<typeof createScriptServiceClient>>;

const MEDIA_ORIGINALS_BUCKET = "media-originals";
const MEDIA_PUBLIC_BUCKET = "media";

type MediaRow = {
  id: string;
  storage_path: string;
};

function publicRenditionUrl(supabase: Supa, mediaId: string, ext: "webp" | "jpg"): string {
  const { data } = supabase.storage.from(MEDIA_PUBLIC_BUCKET).getPublicUrl(`${mediaId}.${ext}`);
  return data.publicUrl;
}

async function renditionExists(supabase: Supa, mediaId: string, ext: "webp" | "jpg"): Promise<boolean> {
  try {
    const res = await fetch(publicRenditionUrl(supabase, mediaId, ext), {
      method: "HEAD",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function repairRenditions(supabase: Supa, row: MediaRow): Promise<void> {
  const { data: original, error: downloadError } = await supabase.storage
    .from(MEDIA_ORIGINALS_BUCKET)
    .download(row.storage_path);
  if (downloadError || !original) {
    throw new Error(
      `原本のダウンロードに失敗しました (${row.storage_path}): ${downloadError?.message}`,
    );
  }
  const originalBuffer = Buffer.from(await original.arrayBuffer());

  const { webp, jpeg } = await processImageForRenditions(originalBuffer);

  const { error: uploadWebpError } = await supabase.storage
    .from(MEDIA_PUBLIC_BUCKET)
    .upload(`${row.id}.webp`, webp, { contentType: "image/webp", upsert: true });
  if (uploadWebpError) {
    throw new Error(`webp レンディションのアップロードに失敗しました (${row.id}): ${uploadWebpError.message}`);
  }

  const { error: uploadJpegError } = await supabase.storage
    .from(MEDIA_PUBLIC_BUCKET)
    .upload(`${row.id}.jpg`, jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploadJpegError) {
    throw new Error(`jpg レンディションのアップロードに失敗しました (${row.id}): ${uploadJpegError.message}`);
  }
}

async function main() {
  const supabase = await createScriptServiceClient();

  const { data, error } = await supabase.from("media").select("id, storage_path");
  if (error) {
    console.error("media 一覧の取得に失敗しました:", error.message);
    process.exitCode = 1;
    return;
  }

  const rows = (data ?? []) as MediaRow[];
  console.log(`media: ${rows.length} 件を検証します。`);

  let okCount = 0;
  let repairedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    try {
      const exists = await renditionExists(supabase, row.id, "webp");
      if (exists) {
        console.log(`[ok] ${row.id}`);
        okCount += 1;
        continue;
      }

      console.warn(`[missing] ${row.id}: {id}.webp が見つかりません。原本から再生成します。`);
      await repairRenditions(supabase, row);
      console.log(`[repaired] ${row.id}: webp/jpg レンディションを再生成しました。`);
      repairedCount += 1;
    } catch (err) {
      failedCount += 1;
      console.error(`[failed] ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("");
  console.log(
    `完了: 総数=${rows.length} ok=${okCount} repaired=${repairedCount} failed=${failedCount}`,
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-media-renditions に失敗しました:", err);
  process.exitCode = 1;
});
