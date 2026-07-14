import "server-only";

import { Resend } from "resend";

import type { Result } from "@/modules/platform/contracts";

import type { DocType } from "../contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §18 → 本編化 (issue #101)。
 * 帳票 PDF のメール添付送信 (Resend)。inquiry/internal/notify.ts の fromAddress()/escapeHtml() と
 * 同型の実装を持つ (ESLint モジュール境界により跨モジュール internal import は不可 — jstTodayDateOnly
 * と同じ「許容された重複実装」)。ただし notify.ts と異なり **ベストエフォートにしない**:
 * 送信が本 Issue の主操作であるため、失敗を握り潰さず Result で返す (呼び出し元 facade が
 * document_emails に status='failed' + error_detail として記録する)。
 */

const DOC_TYPE_ATTACHMENT_LABEL: Record<DocType, string> = {
  quote: "見積書",
  order: "受注書",
  delivery: "納品書",
  invoice: "請求書",
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";
}

/** 差出人ドメイン。NEXT_PUBLIC_SITE_URL のホスト名から導出する (inquiry/internal/notify.ts と同型)。 */
function fromAddress(): string {
  try {
    const host = new URL(siteUrl()).hostname;
    return `no-reply@${host}`;
  } catch {
    return "no-reply@kumabe-tosou.vercel.app";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 本文 (plain text, ユーザー編集済み) を単純な段落 HTML に変換する。改行 = 段落区切り。 */
function textToHtml(body: string): string {
  return body
    .split(/\r\n|\r|\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

export type SendDocumentEmailParams = {
  docType: DocType;
  docNo: string;
  version: number;
  to: string;
  cc: string | null;
  subject: string;
  body: string;
  /** issuer_snapshot.email (null なら Reply-To を省略 — 07 §D7 zIssuerSnapshot 注記どおり) */
  replyTo: string | null;
  pdf: Buffer;
};

/** 添付ファイル名 (issue #101 設計どおり): `{帳票種別ラベル}_{doc_no}_v{version}.pdf` */
export function buildAttachmentFilename(docType: DocType, docNo: string, version: number): string {
  return `${DOC_TYPE_ATTACHMENT_LABEL[docType]}_${docNo}_v${version}.pdf`;
}

/**
 * 送信本体。呼び出し元 (facade sendDocumentByEmail) が isResendConfigured() を事前チェック済みの
 * 前提で呼ぶ (未設定はここに到達する前に KMB-E644 で早期リターンする設計 — §18 手順4)。
 * それでも RESEND_API_KEY が空の状態で呼ばれた場合は Resend SDK 自体がエラーを返すため、
 * その場合も同じく KMB-E644 に写像する (二重の安全網 — 握り潰さない)。
 */
export async function sendDocumentEmail(
  params: SendDocumentEmailParams,
): Promise<Result<{ provider_message_id: string | null }>> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const filename = buildAttachmentFilename(params.docType, params.docNo, params.version);

    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to: params.to,
      ...(params.cc !== null ? { cc: params.cc } : {}),
      ...(params.replyTo !== null ? { replyTo: params.replyTo } : {}),
      subject: params.subject,
      text: params.body,
      html: textToHtml(params.body),
      attachments: [{ filename, content: params.pdf }],
    });
    if (error) {
      return { ok: false, code: "KMB-E644", detail: error.message ?? "メールの送信に失敗しました。" };
    }
    return { ok: true, value: { provider_message_id: data?.id ?? null } };
  } catch (err) {
    return { ok: false, code: "KMB-E644", detail: err instanceof Error ? err.message : String(err) };
  }
}
