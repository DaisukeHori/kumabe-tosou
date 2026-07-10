import "server-only";

import { Resend } from "resend";

import { isResendConfigured } from "@/lib/env";
import { settingsFacade } from "@/modules/settings/facade";

/**
 * note セッション Cookie 失効 (401/403) 検知時のベストエフォート通知メール。
 * canonical: docs/design/ai-studio-v2.md §8「Cookie 失効 (401) 検知 → 設定画面バッジ + 通知メール
 * (既存 notifications 経路)」。
 *
 * settings.notifications.on_publish_failure (「配信失敗・トークン失効もメール通知するか」) を
 * 流用してゲートする — note セッション失効は「トークン失効」の一種として扱う。
 *
 * 失敗してもベストエフォート — 呼び出し元 (DistributionFacade.createNoteDraft) の処理結果には
 * 影響させない。src/modules/inquiry/internal/notify.ts と同型のロジックだが、
 * module-contracts.md の依存方向ルール (`internal/**` の跨モジュール import 禁止) のため
 * distribution モジュール内に複製する。
 */

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";
}

function fromAddress(): string {
  try {
    const host = new URL(siteUrl()).hostname;
    return `no-reply@${host}`;
  } catch {
    return "no-reply@kumabe-tosou.vercel.app";
  }
}

export async function notifyNoteSessionExpired(detail: string): Promise<void> {
  if (!isResendConfigured()) {
    console.warn("[KMB-E902] RESEND_API_KEY 未設定のため note セッション失効通知をスキップしました");
    return;
  }

  const notificationsResult = await settingsFacade.get("notifications");
  if (!notificationsResult.ok) {
    console.warn(
      "[KMB-E902] site_settings.notifications が取得できないため note セッション失効通知をスキップしました:",
      notificationsResult.detail ?? notificationsResult.code,
    );
    return;
  }
  if (!notificationsResult.value.on_publish_failure) {
    return; // 配信失敗通知が無効化されている場合は送信しない (settings の既定挙動を尊重)
  }
  const to = notificationsResult.value.inquiry_to;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const adminUrl = `${siteUrl()}/admin/channels`;
    const text = [
      "note の下書き自動作成に使用しているセッション Cookie が失効している可能性があります。",
      `管理画面 (${adminUrl}) から note セッション Cookie を再登録してください。`,
      "",
      `詳細: ${detail}`,
    ].join("\n");

    const { error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject: "【隈部塗装】note セッションが失効しました",
      text,
    });
    if (error) {
      console.error("[KMB-E902] note セッション失効通知の送信に失敗しました:", error);
    }
  } catch (err) {
    console.error("[KMB-E902] note セッション失効通知の送信中に例外が発生しました:", err);
  }
}
