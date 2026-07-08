/**
 * legacy (Phase 0 ハードコード) コンテンツを Supabase へ投入する (設計書 §12.1)。
 *
 * - batch_id (uuid) を発行し、投入した行/Storage オブジェクトをすべて
 *   seed_manifest に記録する (rollback-seed.ts が逆順削除に使う)。
 * - 冪等性: slug / storage_path / key の unique 衝突を検知したら該当項目を skip して報告する
 *   (上書きしない。再実行安全)。voices は DDL 上ユニークキーを持たないため、
 *   「seed_manifest に entity='voices' の記録が既にあるか」で全体をスキップ判定する。
 * - Storage は Postgres トランザクションに参加できないため厳密な原子性はない
 *   (設計書 §12.1 で明示された既知の制約)。
 *
 * (契約/設計との乖離メモ — オーケストレーターへ報告済み)
 * 設計書 §12.1 は「DB 投入は 1 トランザクション」と書いているが、本スクリプトは
 * supabase-js (PostgREST 経由) を使っており、複数テーブルにまたがる真の SQL
 * トランザクションを張ることはできない (実現するには専用の plpgsql RPC 関数を
 * migration に追加する必要があり、今回のタスク範囲 (スクリプト + seed-data の新規作成)
 * には含まれていない)。そのため本スクリプトはテーブルごとの逐次 INSERT +
 * 各 INSERT 直後の seed_manifest 記録 (途中失敗時も記録済み分は rollback-seed.ts で
 * 確実に補償削除できるようにするため) で実装している。真の原子性が必要な場合は
 * 将来 migration で seed 用 RPC 関数を追加し、本スクリプトから呼び出す形に切り替えること。
 *
 * 使い方: npx tsx scripts/seed-from-legacy.ts
 * 必要 env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { processImageForRenditions } from "@/modules/media/internal/image-transform";

import { createScriptServiceClient } from "./lib/service-client";
import { MEDIA_SEED } from "./seed-data/media";
import { POSTS_SEED } from "./seed-data/posts";
import { PRICE_GRADES_SEED, PRICE_OPTIONS_SEED } from "./seed-data/pricing";
import {
  COMPANY_SETTINGS_SEED,
  HERO_SETTINGS_SEED,
  OPS_LIMITS_SEED,
  SEO_DEFAULTS_SEED,
} from "./seed-data/settings";
import { VOICES_SEED } from "./seed-data/voices";
import { WORKS_SEED } from "./seed-data/works";

const REPO_ROOT = path.resolve(__dirname, "..");

async function recordManifest(
  supabase: SupabaseClient,
  batchId: string,
  entity: string,
  refId: string,
) {
  const { error } = await supabase
    .from("seed_manifest")
    .insert({ batch_id: batchId, entity, ref_id: refId });
  if (error) {
    throw new Error(`seed_manifest 記録に失敗しました (${entity}/${refId}): ${error.message}`);
  }
}

async function seedMedia(supabase: SupabaseClient, batchId: string) {
  console.log("== media ==");
  for (const m of MEDIA_SEED) {
    const { data: existing, error: selectError } = await supabase
      .from("media")
      .select("id")
      .eq("storage_path", m.storagePath)
      .maybeSingle();
    if (selectError) throw new Error(`media 確認に失敗 (${m.storagePath}): ${selectError.message}`);
    if (existing) {
      console.log(`[skip] media: ${m.storagePath} は既に存在します`);
      continue;
    }

    const fileBuffer = await readFile(path.join(REPO_ROOT, m.sourceFile));

    const { error: uploadOriginalError } = await supabase.storage
      .from("media-originals")
      .upload(m.storagePath, fileBuffer, { contentType: m.mimeType, upsert: false });
    if (uploadOriginalError) {
      throw new Error(
        `media-originals アップロード失敗 (${m.storagePath}): ${uploadOriginalError.message}`,
      );
    }
    await recordManifest(supabase, batchId, "storage:media-originals", m.storagePath);

    // レンディション生成: media モジュール本体 (image-processing.ts) と同一の変換ロジック
    // (image-transform.ts、server-only 非依存) を共用し、公開規約通り `{mediaId}.webp` /
    // `{mediaId}.jpg` を "media" バケットへ生成する (facade.ts の renditionPathFor と同じ規約)。
    const { webp, jpeg, width, height } = await processImageForRenditions(fileBuffer);
    const webpPath = `${m.id}.webp`;
    const jpegPath = `${m.id}.jpg`;

    const { error: uploadWebpError } = await supabase.storage
      .from("media")
      .upload(webpPath, webp, { contentType: "image/webp", upsert: false });
    if (uploadWebpError) {
      throw new Error(`media (webp レンディション) アップロード失敗 (${webpPath}): ${uploadWebpError.message}`);
    }
    await recordManifest(supabase, batchId, "storage:media", webpPath);

    const { error: uploadJpegError } = await supabase.storage
      .from("media")
      .upload(jpegPath, jpeg, { contentType: "image/jpeg", upsert: false });
    if (uploadJpegError) {
      throw new Error(`media (jpg レンディション) アップロード失敗 (${jpegPath}): ${uploadJpegError.message}`);
    }
    await recordManifest(supabase, batchId, "storage:media", jpegPath);

    const { error: insertError } = await supabase.from("media").insert({
      id: m.id,
      storage_path: m.storagePath,
      alt: m.alt,
      width,
      height,
      mime_type: m.mimeType,
      credit: m.credit,
      is_placeholder: m.isPlaceholder,
      tags: m.tags,
    });
    if (insertError) throw new Error(`media INSERT 失敗 (${m.storagePath}): ${insertError.message}`);
    await recordManifest(supabase, batchId, "media", m.id);

    console.log(`[created] media: ${m.storagePath} -> ${webpPath} / ${jpegPath} (${width}x${height})`);
  }
}

async function seedWorks(supabase: SupabaseClient, batchId: string) {
  console.log("== works ==");
  const publishedAt = new Date().toISOString();
  for (const w of WORKS_SEED) {
    const { data: existing, error: selectError } = await supabase
      .from("works")
      .select("id")
      .eq("slug", w.slug)
      .maybeSingle();
    if (selectError) throw new Error(`works 確認に失敗 (${w.slug}): ${selectError.message}`);
    if (existing) {
      console.log(`[skip] works: ${w.slug} は既に存在します`);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("works")
      .insert({
        slug: w.slug,
        title: w.title,
        category: w.category,
        body: w.body,
        process_note: w.process_note,
        cover_media_id: w.cover_media_id,
        status: "published", // §12.1: 全件 status='published'
        published_at: publishedAt,
        sort_order: w.sort_order,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`works INSERT 失敗 (${w.slug}): ${insertError?.message}`);
    }
    await recordManifest(supabase, batchId, "works", inserted.id);

    for (const [index, mediaId] of w.image_ids.entries()) {
      const { error: imageError } = await supabase
        .from("work_images")
        .insert({ work_id: inserted.id, media_id: mediaId, sort_order: index });
      if (imageError) {
        throw new Error(`work_images INSERT 失敗 (${w.slug}): ${imageError.message}`);
      }
    }
    // work_images は works の on delete cascade で追従するため manifest への個別記録は不要。

    console.log(`[created] works: ${w.slug}`);
  }
}

async function seedVoices(supabase: SupabaseClient, batchId: string) {
  console.log("== voices ==");
  // voices は DDL 上ユニークキーを持たないため、seed_manifest の記録有無で
  // 「既に一度 seed 済みか」を判定する (再実行での重複作成を避けるための代替手段)。
  const { data: existingManifest, error: manifestSelectError } = await supabase
    .from("seed_manifest")
    .select("id")
    .eq("entity", "voices")
    .limit(1)
    .maybeSingle();
  if (manifestSelectError) {
    throw new Error(`voices の seed_manifest 確認に失敗: ${manifestSelectError.message}`);
  }
  if (existingManifest) {
    console.log("[skip] voices: 過去の batch で投入済みのためスキップします");
    return;
  }

  const publishedAt = new Date().toISOString();
  for (const v of VOICES_SEED) {
    const { data: inserted, error: insertError } = await supabase
      .from("voices")
      .insert({
        customer_initial: v.customer_initial,
        region: v.region,
        rating: v.rating,
        body: v.body,
        item: v.item,
        photo_media_id: v.photo_media_id,
        status: "published", // §12.1: 全件 status='published'
        published_at: publishedAt,
        sort_order: v.sort_order,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`voices INSERT 失敗 (${v.customer_initial}): ${insertError?.message}`);
    }
    await recordManifest(supabase, batchId, "voices", inserted.id);
    console.log(`[created] voices: ${v.customer_initial} / ${v.region}`);
  }
}

async function seedPosts(supabase: SupabaseClient, batchId: string) {
  console.log("== posts ==");
  const publishedAt = new Date().toISOString();
  for (const p of POSTS_SEED) {
    const { data: existing, error: selectError } = await supabase
      .from("posts")
      .select("id")
      .eq("slug", p.slug)
      .maybeSingle();
    if (selectError) throw new Error(`posts 確認に失敗 (${p.slug}): ${selectError.message}`);
    if (existing) {
      console.log(`[skip] posts: ${p.slug} は既に存在します`);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("posts")
      .insert({
        slug: p.slug,
        kind: p.kind,
        title: p.title,
        excerpt: p.excerpt,
        body: p.body,
        cover_media_id: p.cover_media_id,
        status: "published", // §12.1: 全件 status='published'
        published_at: publishedAt,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`posts INSERT 失敗 (${p.slug}): ${insertError?.message}`);
    }
    await recordManifest(supabase, batchId, "posts", inserted.id);
    console.log(`[created] posts: ${p.slug}`);
  }
}

async function seedPriceGrades(supabase: SupabaseClient, batchId: string) {
  console.log("== price_grades ==");
  for (const g of PRICE_GRADES_SEED) {
    const { data: existing, error: selectError } = await supabase
      .from("price_grades")
      .select("id")
      .eq("key", g.key)
      .maybeSingle();
    if (selectError) throw new Error(`price_grades 確認に失敗 (${g.key}): ${selectError.message}`);
    if (existing) {
      console.log(`[skip] price_grades: ${g.key} は既に存在します`);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("price_grades")
      .insert({
        key: g.key,
        label: g.label,
        base_price: g.base_price,
        description: g.description,
        sort_order: g.sort_order,
        is_active: g.is_active,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`price_grades INSERT 失敗 (${g.key}): ${insertError?.message}`);
    }
    await recordManifest(supabase, batchId, "price_grades", inserted.id);
    console.log(`[created] price_grades: ${g.key}`);
  }
}

async function seedPriceOptions(supabase: SupabaseClient, batchId: string) {
  console.log("== price_options ==");
  for (const o of PRICE_OPTIONS_SEED) {
    const { data: existing, error: selectError } = await supabase
      .from("price_options")
      .select("id")
      .eq("key", o.key)
      .maybeSingle();
    if (selectError) throw new Error(`price_options 確認に失敗 (${o.key}): ${selectError.message}`);
    if (existing) {
      console.log(`[skip] price_options: ${o.key} は既に存在します`);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("price_options")
      .insert({
        key: o.key,
        label: o.label,
        kind: o.kind,
        value: o.value,
        sort_order: o.sort_order,
        is_active: o.is_active,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`price_options INSERT 失敗 (${o.key}): ${insertError?.message}`);
    }
    await recordManifest(supabase, batchId, "price_options", inserted.id);
    console.log(`[created] price_options: ${o.key}`);
  }
}

async function seedSettings(supabase: SupabaseClient, batchId: string) {
  console.log("== site_settings ==");
  const entries: { key: string; value: unknown }[] = [
    { key: "company", value: COMPANY_SETTINGS_SEED },
    { key: "hero", value: HERO_SETTINGS_SEED },
    { key: "seo_defaults", value: SEO_DEFAULTS_SEED },
    { key: "ops_limits", value: OPS_LIMITS_SEED },
  ];
  for (const entry of entries) {
    const { data: existing, error: selectError } = await supabase
      .from("site_settings")
      .select("key")
      .eq("key", entry.key)
      .maybeSingle();
    if (selectError) {
      throw new Error(`site_settings 確認に失敗 (${entry.key}): ${selectError.message}`);
    }
    if (existing) {
      console.log(`[skip] site_settings: ${entry.key} は既に存在します (上書きしません)`);
      continue;
    }

    const { error: insertError } = await supabase
      .from("site_settings")
      .insert({ key: entry.key, value: entry.value });
    if (insertError) {
      throw new Error(`site_settings INSERT 失敗 (${entry.key}): ${insertError.message}`);
    }
    await recordManifest(supabase, batchId, "site_settings", entry.key);
    console.log(`[created] site_settings: ${entry.key}`);
  }
}

async function main() {
  const supabase = createScriptServiceClient();
  const batchId = randomUUID();
  console.log(`batch_id = ${batchId}`);

  await seedMedia(supabase, batchId);
  await seedWorks(supabase, batchId);
  await seedVoices(supabase, batchId);
  await seedPosts(supabase, batchId);
  await seedPriceGrades(supabase, batchId);
  await seedPriceOptions(supabase, batchId);
  await seedSettings(supabase, batchId);

  console.log(`完了しました。batch_id=${batchId} (rollback-seed.ts の引数に使えます)`);
}

main().catch((err) => {
  console.error("seed-from-legacy に失敗しました:", err);
  process.exitCode = 1;
});
