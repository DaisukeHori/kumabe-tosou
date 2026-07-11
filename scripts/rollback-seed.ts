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
  price_size_classes: { table: "price_size_classes", pk: "key" },
  // price_matrix は複合主キー (grade_key, size_key) のため main() 内で個別に分岐する
  price_quantity_tiers: { table: "price_quantity_tiers", pk: "min_qty" },
  price_options: { table: "price_options", pk: "id" },
  site_settings: { table: "site_settings", pk: "key" },
  // crm 取込 (scripts/crm-intake-inquiries.ts、01-crm §12.1 前提タスク(a))。いずれも pk='id'。
  // 記録順 (customers→deals→activities→activity_links→tasks) の逆順削除で
  // deals.customer_id (on delete 句なし = NO ACTION) との FK 整合を担保する (前提タスク(c))。
  customers: { table: "customers", pk: "id" },
  deals: { table: "deals", pk: "id" },
  activities: { table: "activities", pk: "id" },
  activity_links: { table: "activity_links", pk: "id" },
  tasks: { table: "tasks", pk: "id" },
};

async function main() {
  const batchId = process.argv[2] ?? process.env.ROLLBACK_BATCH_ID;
  if (!batchId) {
    console.error("使い方: npx tsx scripts/rollback-seed.ts <batch_id>");
    process.exitCode = 1;
    return;
  }

  const supabase = await createScriptServiceClient();

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
      } else if (row.entity === "price_matrix") {
        // 複合主キー (grade_key, size_key) のため ref_id ("grade_key:size_key") を分割して削除する。
        const [gradeKey, sizeKey] = row.ref_id.split(":");
        const { error: deleteError } = await supabase
          .from("price_matrix")
          .delete()
          .eq("grade_key", gradeKey)
          .eq("size_key", sizeKey);
        if (deleteError) throw deleteError;
      } else {
        const mapping = ENTITY_TABLE[row.entity];
        if (!mapping) {
          // 01-crm §12.1 前提タスク(b): 未知 entity は DB 削除をスキップしたまま manifest 行だけ
          // 削除して「rolled back」成功ログを出す旧実装の欠陥 (=実データが本番に残留するのに
          // 成功ログが出て追跡証跡=manifest も消える) を fail-fast に是正する。例外を投げて
          // 下の catch (manifest 行を残す・failedCount 計上) に落とす — 既存 try/catch 構造に
          // そのまま乗る。
          throw new Error(
            `未知の entity (${row.entity}) のため DB 削除方法が不明です。ENTITY_TABLE への追加が必要です。`,
          );
        }
        const { error: deleteError } = await supabase
          .from(mapping.table)
          .delete()
          .eq(mapping.pk, row.ref_id);
        if (deleteError) throw deleteError;
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
