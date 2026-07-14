import "server-only";

import { Resend } from "resend";

import { isResendConfigured } from "@/lib/env";
import type { ExecutionContext, Result } from "@/modules/platform/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import type { CrmDigest, TaskListItem, DealListItem } from "../contracts";

/**
 * 日次ダイジェストメール送信 (01-crm.md §6.2 sendDailyDigest・§7.2 手順 c)。
 * src/modules/inquiry/internal/notify.ts と同型だが、宛先取得は crm 自身が site_settings を
 * 直接読まず SettingsFacade.get('notifications', ctx) 経由で行う (01-crm §6.2 の facade 実装注記:
 * settings モジュール境界違反を避けるため)。
 *
 * エラー分類 (§6.1 補足・facade.sendDailyDigest のエラー列挙 "E901 (settings 読取不能のみ)" と
 * 1:1 — RESEND_API_KEY 未設定・Resend API 呼び出し失敗はベストエフォート (KMB-E902 をログするのみで
 * Result は成功のまま) だが、**宛先を決定できない (settings 'notifications' 自体が読めない) のは
 * ダイジェスト送信という処理自体が実行不能な真の失敗であり、これを ok:true で握り潰すと
 * 「メールは送られたはず」という誤った成功扱いになる (facade 境界でのエラー握り潰し禁止規約)。
 * そのため戻り値を Result<void> にして、settings 読取不能時のみ ok:false (KMB-E901) を返す。
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

function formatTask(task: TaskListItem): string {
  const due = task.due_on ?? "(期日なし)";
  const target = task.customer?.name ?? task.deal?.title ?? "";
  return `- [${due}] ${task.title}${target ? ` (${target})` : ""}`;
}

function formatLead(deal: DealListItem): string {
  return `- ${deal.title} (${deal.customer_name})`;
}

function formatExpiringQuote(q: NonNullable<CrmDigest["sales"]>["expiring_quotes"][number]): string {
  return `- ${q.doc_no} ${q.billing_name} 様 (期限 ${q.valid_until}・¥${q.total_jpy.toLocaleString("ja-JP")})`;
}

function formatUnpaidInvoice(inv: NonNullable<CrmDigest["sales"]>["unpaid_invoices"][number]): string {
  return `- ${inv.doc_no} ${inv.billing_name} 様 (発行 ${inv.issue_date}・残高 ¥${inv.balance_jpy.toLocaleString("ja-JP")} / 請求 ¥${inv.total_jpy.toLocaleString("ja-JP")})`;
}

/**
 * sales セクション (§0.4「未回収が一目で消える」業務シナリオ — #51 で配線)。
 * digest.sales は route (app 層) 側で SalesFacade.getSalesDigest が失敗したときに null のまま
 * (graceful degrade — crm-digest配線有効化の計画書参照)。null のときはセクション自体を省略する
 * (「(なし)」ではなく非表示 — 「取得できなかった」と「0 件だった」を UI 上区別しないと
 * 未回収の見落としに繋がるため、あいまいな「(なし)」表示にしない)。
 */
function buildSalesSectionLines(sales: CrmDigest["sales"]): string[] {
  if (!sales) return [];
  return [
    "",
    `■ 期限接近の見積 (${sales.expiring_quotes.length} 件)`,
    ...(sales.expiring_quotes.length > 0 ? sales.expiring_quotes.map(formatExpiringQuote) : ["(なし)"]),
    "",
    `■ 未消込の請求書 (${sales.unpaid_invoices.length} 件)`,
    ...(sales.unpaid_invoices.length > 0 ? sales.unpaid_invoices.map(formatUnpaidInvoice) : ["(なし)"]),
  ];
}

function buildEmailBodies(digest: CrmDigest) {
  const adminUrl = `${siteUrl()}/admin`;
  const lines = [
    `${digest.generated_on} の CRM ダイジェストです。`,
    "",
    `■ 期日超過のやること (${digest.overdue_tasks.length} 件)`,
    ...(digest.overdue_tasks.length > 0 ? digest.overdue_tasks.map(formatTask) : ["(なし)"]),
    "",
    `■ 本日期日のやること (${digest.today_tasks.length} 件)`,
    ...(digest.today_tasks.length > 0 ? digest.today_tasks.map(formatTask) : ["(なし)"]),
    "",
    `■ 未着手の相談 (${digest.awaiting_leads.length} 件)`,
    ...(digest.awaiting_leads.length > 0 ? digest.awaiting_leads.map(formatLead) : ["(なし)"]),
    ...buildSalesSectionLines(digest.sales),
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
 * 呼び出し元 (facade.sendDailyDigest) は常に ctx をそのまま渡す (worker からは service 固定)。
 * RESEND_API_KEY 未設定・Resend 送信失敗はベストエフォート (KMB-E902 ログのみ、ok:true で返す)。
 * settings 'notifications' 自体が読めない場合のみ ok:false (KMB-E901) を返す (上記コメント参照)。
 */
export async function sendCrmDigestEmail(digest: CrmDigest, ctx: ExecutionContext): Promise<Result<void>> {
  if (!isResendConfigured()) {
    console.warn("[KMB-E902] RESEND_API_KEY 未設定のため CRM ダイジェストメールをスキップしました");
    return { ok: true, value: undefined };
  }

  const settingsResult = await settingsFacade.get("notifications", ctx);
  if (!settingsResult.ok) {
    return {
      ok: false,
      code: "KMB-E901",
      detail: `settings 'notifications' の取得に失敗したため CRM ダイジェストメールの宛先を解決できません: ${settingsResult.code} ${settingsResult.detail ?? ""}`,
    };
  }
  const inquiryTo = settingsResult.value.inquiry_to;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { text, html } = buildEmailBodies(digest);
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: inquiryTo,
      subject: `【隈部塗装】CRM 日次ダイジェスト (${digest.generated_on})`,
      text,
      html,
    });
    if (error) {
      console.error("[KMB-E902] CRM ダイジェストメール送信に失敗しました:", error);
    }
  } catch (err) {
    console.error("[KMB-E902] CRM ダイジェストメール送信中に例外が発生しました:", err);
  }
  return { ok: true, value: undefined };
}
