import { isResendConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Pagination, Paged, Result } from "@/modules/platform/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import { zInquiryInput, type InquiryInput, type InquiryStatus } from "./contracts";
import {
  countInquiriesByStatus,
  insertInquiry,
  listInquiries,
  updateInquiryStatus,
  type InquiryRow,
} from "./repository";

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
   *  宛先は settings 'notifications'.inquiry_to、RESEND_API_KEY は Vercel env)
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

/** 設計書 §6.3 の通知メール仕様 (件名/本文) を満たす簡易実装。resend REST API を直接叩く */
async function sendInquiryNotificationEmail(input: InquiryInput, inquiryId: string) {
  if (!isResendConfigured()) {
    console.error(`KMB-E902: RESEND_API_KEY 未設定のため問い合わせ通知メールを送信できません (id=${inquiryId})`);
    return;
  }

  const settingsResult = await settingsFacade.get("notifications");
  if (!settingsResult.ok) {
    console.error(
      `KMB-E902: notifications 設定が取得できないため通知メールを送信できません (id=${inquiryId}): ${settingsResult.detail ?? settingsResult.code}`,
    );
    return;
  }

  const to = settingsResult.value.inquiry_to;
  const receivedAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const detailUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/inquiries/${inquiryId}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "no-reply@kumabe-tosou.example",
        to: [to],
        reply_to: input.email,
        subject: `【隈部塗装】新しいお問い合わせ: ${input.inquiry_type} (${input.name}様)`,
        text:
          `お名前: ${input.name}\n` +
          `メール: ${input.email}\n` +
          `電話: ${input.tel ?? "(未入力)"}\n` +
          `種別: ${input.inquiry_type}\n` +
          `対象品目: ${input.item ?? "(未入力)"}\n` +
          `受信日時: ${receivedAt}\n\n` +
          `内容:\n${input.body}\n\n` +
          `詳細: ${detailUrl}`,
      }),
    });
    if (!res.ok) {
      console.error(`KMB-E902: 通知メール送信に失敗しました (status=${res.status}, id=${inquiryId})`);
    }
  } catch (err) {
    console.error(
      `KMB-E902: 通知メール送信で例外が発生しました (id=${inquiryId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const inquiryFacade: InquiryFacadeExtended = {
  async submit(rawInput) {
    const parsed = zInquiryInput.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, code: "KMB-E101", detail: parsed.error.message };
    }

    try {
      const supabase = await createSupabaseServerClient();
      const { id } = await insertInquiry(supabase, parsed.data);

      // ベストエフォート通知 (失敗しても submit 自体は成功のまま — 設計書 §6.3 / KMB-E902)
      void sendInquiryNotificationEmail(parsed.data, id);

      return { ok: true, value: { id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
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
