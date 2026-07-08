import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * メディア選択の簡易一覧 (オーケストレーター実装指示: 「メディア選択は media_id 直接入力+
 * 一覧表示の簡易版で可、Wave1-A のライブラリとの統合は Wave 3」)。
 * MediaFacade (media モジュール) は Wave1-B 時点で未実装のため、media テーブルの
 * read-only 簡易一覧をここで直接参照する。media は RLS で anon にも全行 SELECT が
 * 許可されている (cms-ai-pipeline.md §3.2) ため安全。書込は一切行わない。
 */
export type SimpleMediaItem = {
  id: string;
  alt: string;
  tags: string[];
  is_placeholder: boolean;
};

export async function listMediaForPicker(limit = 100): Promise<SimpleMediaItem[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("media")
    .select("id, alt, tags, is_placeholder")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as SimpleMediaItem[];
}
