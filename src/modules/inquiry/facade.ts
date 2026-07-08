import { getSessionAndClient } from "@/lib/supabase/session";
import type { Pagination, Paged, Result } from "@/modules/platform/contracts";

import { zInquiryInput, type InquiryInput, type InquiryStatus } from "./contracts";
import { countInquiriesByStatus, listInquiries, updateInquiryStatus, type InquiryRow } from "./repository";
import { insertContactInquiry } from "./internal/repository";
import { notifyInquiryReceived } from "./internal/notify";

// repository は他モジュール/admin UI から直接 import できない (ESLint 境界ルール) ため、
// 一覧表示に必要な行の型を facade 経由で re-export する。
export type { InquiryRow };

/**
 * inquiry モジュールの公開 facade (契約書 §5)。
 */
export interface InquiryFacade {
  /**
   * site-public から呼べる唯一の書き込み。DB 保存成功後に Resend で通知メール
   * (ベストエフォート — 送信失敗は KMB-E902 をログ記録するのみで Result は成功のまま。
   *  宛先は settings 'notifications'.inquiry_to、RESEND_API_KEY は Vercel env。
   *  Wave1-D 統合分: anon client での INSERT + resend パッケージでの通知に統一)
   */
  submit(input: InquiryInput): Promise<Result<{ id: string }>>;
  updateStatus(id: string, status: InquiryStatus): Promise<Result<void>>;
}

/**
 * §5 に明記の無い admin 一覧表示用の拡張 (/admin/inquiries に必須。
 * module-contracts.md 未更新分 — オーケストレーターへ報告済み)。
 */
export interface InquiryFacadeExtended extends InquiryFacade {
  list(status: InquiryStatus | "all", pagination: Pagination): Promise<Result<Paged<InquiryRow>>>;
  countByStatus(status: InquiryStatus): Promise<Result<number>>;
}

export const inquiryFacade: InquiryFacadeExtended = {
  async submit(rawInput) {
    const parsed = zInquiryInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, code: "KMB-E101", detail: parsed.error.message };
    }

    const inserted = await insertContactInquiry(parsed.data);
    if (!inserted.ok) return inserted;

    // ベストエフォート通知 (失敗しても submit 自体は成功のまま — 設計書 §6.3 / KMB-E902)
    void notifyInquiryReceived(parsed.data, inserted.value.id);

    return inserted;
  },

  async updateStatus(id, status) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const updated = await updateInquiryStatus(supabase, id, status);
      if (!updated) {
        return { ok: false, code: "KMB-E901", detail: "対象の問い合わせが見つかりません" };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async list(status, pagination) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const { items, nextCursor } = await listInquiries(supabase, { status, pagination });
      return { ok: true, value: { items, next_cursor: nextCursor } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async countByStatus(status) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const count = await countInquiriesByStatus(supabase, status);
      return { ok: true, value: count };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
