/**
 * seed-from-legacy.ts で投入したデータの補償削除 (設計書 §12.1)。
 *
 * seed_manifest を batch_id で絞り込み、id 降順 (= 投入の逆順) に DB → Storage の順で削除する。
 * Storage の削除は Postgres トランザクションに参加できず失敗しうるため、
 * 失敗した項目は seed_manifest 行を残したまま次回再実行できるようにする (§12.1)。
 *
 * 使い方: npx tsx scripts/rollback-seed.ts <batch_id>
 * 必要 env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */
import { createScriptServiceClient } from "./lib/service-client";

const ENTITY_TABLE: Record<string, { table: string; pk: string }> = {
  media: { table: "media", pk: "id" },
  works: { table: "works", pk: "id" }, // work_images は on delete cascade で追従
  voices: { table: "voices", pk: "id" },
  posts: { table: "posts", pk: "id" },
  price_grades: { table: "price_grades", pk: "id" },
  price_options: { table: "price_options", pk: "id" },
  site_settings: { table: "site_settings", pk: "key" },
};

async function main() {
  const batchId = process.argv[2] ?? process.env.ROLLBACK_BATCH_ID;
  if (!batchId) {
    console.error("使い方: npx tsx scripts/rollback-seed.ts <batch_id>");
    process.exitCode = 1;
    return;
  }

  const supabase = createScriptServiceClient();

  const { data: rows, error } = await supabase
    .from("seed_manifest")
    .select("id, entity, ref_id")
    .eq("batch_id", batchId)
    .order("id", { ascending: false }); // §12.1: 逆順ロールバック

  if (error) {
    console.error("seed_manifest の取得に失敗しました:", error.message);
    process.exitCode = 1;
    return;
  }
  if (!rows || rows.length === 0) {
    console.log(`batch_id=${batchId} に該当する seed_manifest 行がありません。`);
    return;
  }

  console.log(`batch_id=${batchId}: ${rows.length} 件を逆順ロールバックします。`);

  let failedCount = 0;

  for (const row of rows) {
    try {
      if (row.entity === "storage:media-originals" || row.entity === "storage:media") {
        const bucket = row.entity === "storage:media-originals" ? "media-originals" : "media";
        const { error: removeError } = await supabase.storage.from(bucket).remove([row.ref_id]);
        if (removeError) throw removeError;
      } else {
        const mapping = ENTITY_TABLE[row.entity];
        if (!mapping) {
          console.warn(`[warn] 未知の entity (${row.entity})。DB 削除をスキップします。`);
        } else {
          const { error: deleteError } = await supabase
            .from(mapping.table)
            .delete()
            .eq(mapping.pk, row.ref_id);
          if (deleteError) throw deleteError;
        }
      }

      // 補償削除に成功した場合のみ manifest 行を削除する
      // (voices の「既に seed 済みか」判定など、他ロジックの整合を保つため)。
      const { error: manifestDeleteError } = await supabase
        .from("seed_manifest")
        .delete()
        .eq("id", row.id);
      if (manifestDeleteError) throw manifestDeleteError;

      console.log(`[rolled back] ${row.entity} / ${row.ref_id}`);
    } catch (err) {
      failedCount += 1;
      // Storage 削除失敗は再実行可能 (§12.1) — manifest 行を残し、次回再実行で再試行できるようにする。
      console.error(
        `[failed] ${row.entity} / ${row.ref_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (failedCount > 0) {
    console.log(
      `完了しましたが ${failedCount} 件失敗しました。再度 npx tsx scripts/rollback-seed.ts ${batchId} を実行してください。`,
    );
    process.exitCode = 1;
  } else {
    console.log("ロールバックがすべて完了しました。");
  }
}

main().catch((err) => {
  console.error("rollback-seed に失敗しました:", err);
  process.exitCode = 1;
});
