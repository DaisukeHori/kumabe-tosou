import "server-only";

import { Resend } from "resend";

import { isResendConfigured } from "@/lib/env";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { zNotificationSettings } from "@/modules/settings/contracts";

import type { InquiryInput } from "../contracts";

/**
 * 問い合わせ受信通知メール (Resend)。canonical: cms-ai-pipeline.md §6.3。
 * ベストエフォート — 失敗しても呼び出し元 (submit) の成功判定には影響させない
 * (module-contracts.md §5 InquiryFacade.submit の注記通り)。
 */

const INQUIRY_TYPE_LABELS: Record<InquiryInput["inquiry_type"], string> = {
  construction: "施工依頼",
  estimate: "見積もり相談",
  material: "材料に関する質問",
  other: "その他",
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";
}

/** 差出人ドメイン。NEXT_PUBLIC_SITE_URL のホスト名から導出する (§6.3: no-reply@<独自ドメイン>) */
function fromAddress(): string {
  try {
    const host = new URL(siteUrl()).hostname;
    return `no-reply@${host}`;
  } catch {
    return "no-reply@kumabe-tosou.vercel.app";
  }
}

async function getInquiryNotificationEmail(): Promise<string | null> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("site_settings")
    .select("value")
    .eq("key", "notifications")
    .maybeSingle<{ value: unknown }>();
  if (error || !data) return null;

  const parsed = zNotificationSettings.safeParse(data.value);
  if (!parsed.success) return null;
  return parsed.data.inquiry_to;
}

function buildEmailSubject(input: InquiryInput): string {
  return `【隈部塗装】新しいお問い合わせ: ${INQUIRY_TYPE_LABELS[input.inquiry_type]} (${input.name}様)`;
}

function buildEmailBodies(input: InquiryInput, inquiryId: string) {
  const receivedAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const adminUrl = `${siteUrl()}/admin/inquiries/${inquiryId}`;

  const lines = [
    `お名前: ${input.name}`,
    `メール: ${input.email}`,
    `電話: ${input.tel ?? "(未入力)"}`,
    `種別: ${INQUIRY_TYPE_LABELS[input.inquiry_type]}`,
    `対象品目: ${input.item ?? "(未入力)"}`,
    "内容:",
    input.body,
    "",
    `受信日時: ${receivedAt} (JST)`,
    "",
    `管理画面で確認: ${adminUrl}`,
  ];
  const text = lines.join("\n");
  const html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
  return { text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * ベストエフォート送信。戻り値は呼び出し元のログ用途のみで、失敗しても submit() の
 * 成功判定には影響させない (§6.3 / module-contracts.md §5)。
 */
export async function notifyInquiryReceived(
  input: InquiryInput,
  inquiryId: string,
): Promise<void> {
  if (!isResendConfigured()) {
    console.warn(
      `[KMB-E902] RESEND_API_KEY 未設定のため問い合わせ通知メールをスキップしました (inquiryId=${inquiryId})`,
    );
    return;
  }

  const inquiryTo = await getInquiryNotificationEmail();
  if (!inquiryTo) {
    console.warn(
      `[KMB-E902] 通知先メール (site_settings.notifications.inquiry_to) が未設定のため送信をスキップしました (inquiryId=${inquiryId})`,
    );
    return;
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { text, html } = buildEmailBodies(input, inquiryId);
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: inquiryTo,
      replyTo: input.email,
      subject: buildEmailSubject(input),
      text,
      html,
    });
    if (error) {
      console.error(`[KMB-E902] 通知メール送信に失敗しました (inquiryId=${inquiryId}):`, error);
    }
  } catch (err) {
    console.error(`[KMB-E902] 通知メール送信中に例外が発生しました (inquiryId=${inquiryId}):`, err);
  }
}
