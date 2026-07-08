"use server";

import { headers } from "next/headers";

import { getRateLimitIpSalt } from "@/lib/env";
import { zInquiryInput } from "@/modules/inquiry/contracts";
import { inquiryFacade } from "@/modules/inquiry/facade";

import { checkAndRecordRateLimit } from "./rate-limit.server";
import {
  extractClientIp,
  hashIp,
  isHoneypotFilled,
  isSubmittedTooFast,
} from "./spam-guard";

/**
 * contact フォームの Server Action。
 * canonical: cms-ai-pipeline.md §3.3 (rate limit + honeypot + 送信最小時間) / §6.3 (通知メール)。
 *
 * ガード (honeypot / 送信最小時間 / rate limit) は「Server Action 側で実施」する設計方針
 * (§3.3) に従い、inquiry モジュールの外 (site-public 層) に置く。DB 保存自体は
 * InquiryFacade.submit (契約書 §5) を経由する — site-public から書き込み系 facade を
 * import できる唯一の例外 (module-contracts.md §2)。
 */

export type ContactFormPayload = {
  name: string;
  email: string;
  /** 空文字を許容 (任意項目)。null 変換はこの Action 内で行う */
  phone: string;
  /** InquiryInput["inquiry_type"] の値 ("construction" 等) */
  inquiryType: string;
  /** 空文字を許容 (任意項目) */
  targetItem: string;
  message: string;
  agree: boolean;
  /** honeypot 隠しフィールド。人間には見えない想定で、値が入っていれば bot とみなす */
  honeypot: string;
  /** フォームがクライアントで描画された時刻 (epoch ms)。送信最小時間の判定に使う */
  formRenderedAt: number;
};

export type SubmitContactResult =
  | { status: "success" }
  | { status: "invalid"; message: string }
  | { status: "rate_limited" }
  | { status: "error" };

export async function submitContactFormAction(
  payload: ContactFormPayload,
): Promise<SubmitContactResult> {
  // 1) honeypot: 入力があれば bot とみなす。学習させないよう成功したふりをする (stealth)。
  if (isHoneypotFilled(payload.honeypot)) {
    console.warn("[contact] honeypot が入力されていたため送信を無視しました (spam 扱い)");
    return { status: "success" };
  }

  // 2) 送信最小時間: 表示から 3 秒未満の送信は bot とみなし、同様に stealth 扱いにする。
  //    submittedAt はサーバ側の時刻を使う (クライアント時刻は詐称され得るため)。
  const submittedAt = Date.now();
  if (isSubmittedTooFast({ formRenderedAt: payload.formRenderedAt, submittedAt })) {
    console.warn("[contact] 表示から3秒未満の送信のため無視しました (spam 扱い)");
    return { status: "success" };
  }

  // 3) rate limit (IP ごと 5 件/時)。
  const requestHeaders = await headers();
  const ip = extractClientIp(
    requestHeaders.get("x-forwarded-for"),
    requestHeaders.get("x-real-ip"),
  );
  const ipHash = hashIp(ip, getRateLimitIpSalt());
  const rateLimitResult = await checkAndRecordRateLimit(ipHash, new Date(submittedAt));
  if (!rateLimitResult.ok) {
    return { status: "rate_limited" };
  }

  // 4) 契約検証 (zInquiryInput) — フォームの空文字 → null 変換をここで行う。
  const candidate = {
    name: payload.name,
    email: payload.email,
    tel: payload.phone.trim() === "" ? null : payload.phone.trim(),
    inquiry_type: payload.inquiryType,
    item: payload.targetItem.trim() === "" ? null : payload.targetItem.trim(),
    body: payload.message,
    privacy_agreed: payload.agree,
  };

  const parsed = zInquiryInput.safeParse(candidate);
  if (!parsed.success) {
    return { status: "invalid", message: "入力内容をご確認ください。" };
  }

  // 5) 保存 + 通知メール (ベストエフォート。inquiryFacade.submit 内部で実施)。
  const result = await inquiryFacade.submit(parsed.data);
  if (!result.ok) {
    console.error("[contact] inquiryFacade.submit に失敗しました:", result);
    return { status: "error" };
  }

  return { status: "success" };
}
