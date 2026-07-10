import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { insertMediaRow, uploadRendition } from "../repository";
import { processImageForRenditions } from "./image-processing";

/**
 * original バッファ → レンディション生成 (webp/jpg) → media 行 INSERT の共有ロジック。
 *
 * facade.ts の completeUpload (クライアントアップロード確定経路) と createFromBytes
 * (サーバ内直接保存経路。AI 生成画像等、署名付き URL アップロードを経由できないケース) の
 * 両方から呼ばれる (オーケストレーター指示 2026-07-10: insert ロジックの重複実装を禁止)。
 * レンディションパス規約 (`{mediaId}.webp` / `{mediaId}.jpg`) は facade.ts の
 * renditionPathFor() コメントと同一。
 */
export type IngestMediaInput = {
  storagePath: string; // 原本の保存先 (media-originals バケット内)
  alt: string;
  credit: string | null;
  tags: string[];
  isPlaceholder: boolean;
  createdBy: string | null;
};

export type IngestedMedia = { id: string; width: number; height: number };

export async function ingestMediaBuffer(
  // completeUpload はセッション付き client、createFromBytes は service client を渡す。
  // どちらも @supabase/supabase-js の SupabaseClient 実体であるため型としては共通化できる。
  supabase: SupabaseClient,
  original: Buffer,
  input: IngestMediaInput,
): Promise<IngestedMedia> {
  const { webp, jpeg, width, height } = await processImageForRenditions(original);
  const mediaId = randomUUID();

  // Supa 型 (createSupabaseServerClient 由来) と service client (createClient 由来) は
  // 構造的に同じ SupabaseClient だが repository.ts のローカル型エイリアスと厳密に一致しないため、
  // この境界でのみ any 経由の構造的キャストを許容する。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repoClient = supabase as any;
  await uploadRendition(repoClient, `${mediaId}.webp`, webp, "image/webp");
  await uploadRendition(repoClient, `${mediaId}.jpg`, jpeg, "image/jpeg");

  await insertMediaRow(repoClient, {
    id: mediaId,
    storagePath: input.storagePath,
    alt: input.alt,
    width,
    height,
    mimeType: "image/webp",
    credit: input.credit,
    isPlaceholder: input.isPlaceholder,
    tags: input.tags,
    createdBy: input.createdBy,
  });

  return { id: mediaId, width, height };
}
