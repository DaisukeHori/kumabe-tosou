import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Pagination } from "@/modules/platform/contracts";

import type { InquiryInput, InquiryStatus } from "./contracts";

/**
 * inquiry モジュールの repository (契約書 §3)。所有テーブル: contact_inquiries。
 */

export type InquiryRow = {
  id: string;
  name: string;
  email: string;
  tel: string | null;
  inquiry_type: string;
  item: string | null;
  body: string;
  status: InquiryStatus;
  created_at: string;
  handled_at: string | null;
};

export async function insertInquiry(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: InquiryInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("contact_inquiries")
    .insert({
      name: input.name,
      email: input.email,
      tel: input.tel,
      inquiry_type: input.inquiry_type,
      item: input.item,
      body: input.body,
      status: "new",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`contact_inquiries INSERT に失敗しました: ${error?.message}`);
  }
  return { id: data.id };
}

/** keyset ページネーション (created_at desc, id desc)。設計書 §2.4: admin 一覧 50 件/頁 */
export async function listInquiries(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  opts: { status: InquiryStatus | "all"; pagination: Pagination },
): Promise<{ items: InquiryRow[]; nextCursor: string | null }> {
  const limit = opts.pagination.limit;
  let query = supabase
    .from("contact_inquiries")
    .select("id, name, email, tel, inquiry_type, item, body, status, created_at, handled_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (opts.status !== "all") {
    query = query.eq("status", opts.status);
  }

  if (opts.pagination.cursor) {
    const decoded = decodeCursor(opts.pagination.cursor);
    if (decoded) {
      query = query.or(
        `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(`contact_inquiries 一覧取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as InquiryRow[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return { items, nextCursor };
}

export async function countInquiriesByStatus(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  status: InquiryStatus,
): Promise<number> {
  const { count, error } = await supabase
    .from("contact_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw new Error(`contact_inquiries 件数取得に失敗しました: ${error.message}`);
  return count ?? 0;
}

export async function updateInquiryStatus(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string,
  status: InquiryStatus,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("contact_inquiries")
    .update({ status, handled_at: status === "new" ? null : new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`contact_inquiries status 更新に失敗しました: ${error.message}`);
  return Boolean(data);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as { createdAt?: string; id?: string };
    if (!parsed.createdAt || !parsed.id) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
