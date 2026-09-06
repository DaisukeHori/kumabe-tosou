import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import type { Result } from "@/modules/platform/contracts";

import type { InquiryInput } from "../contracts";

/**
 * 公開 contact フォーム送信 (anon INSERT) 専用の repository。
 * 管理側 (list / countByStatus / updateStatus) の repository は既存の
 * ../repository.ts (session client・admin 認可) を引き続き使う — こちらは
 * site-public から呼ばれる唯一の書き込み経路のため、anon client を使い
 * service role には依存しない (Wave1-D 統合分)。
 *
 * INSERT は anon RLS 経由 — RLS ポリシー `contact_inquiries_anon_insert`
 * (supabase/migrations/20260708000002_rls.sql) が `status='new'` 固定で許可しているため、
 * service role は不要 (SUPABASE_SERVICE_ROLE_KEY 未設定でも contact フォームは動作する)。
 */

type ContactInquiryRow = {
  id: string;
  name: string;
  email: string;
  tel: string | null;
  inquiry_type: InquiryInput["inquiry_type"];
  item: string | null;
  body: string;
  status: "new";
};

export async function insertContactInquiry(input: InquiryInput): Promise<Result<{ id: string }>> {
  const client = createSupabasePublicClient();
  // id はサーバ側で先に採番する。anon には INSERT ポリシーしか無く SELECT ポリシーが無いため、
  // `.insert().select("id")` (Prefer: return=representation) は PostgREST が返却行の読み取りを
  // RLS で拒否し「new row violates row-level security policy」(401) になる (本番で再現・修正)。
  // return=minimal (select を付けない) で INSERT し、id は自前生成した値をそのまま返す。
  const id = crypto.randomUUID();
  const row: ContactInquiryRow = {
    id,
    name: input.name,
    email: input.email,
    tel: input.tel,
    inquiry_type: input.inquiry_type,
    item: input.item,
    body: input.body,
    status: "new",
  };

  const { error } = await client.from("contact_inquiries").insert(row);

  if (error) {
    console.error("[inquiry] contact_inquiries INSERT に失敗しました:", error);
    return { ok: false, code: "KMB-E901", detail: error.message };
  }

  return { ok: true, value: { id } };
}
