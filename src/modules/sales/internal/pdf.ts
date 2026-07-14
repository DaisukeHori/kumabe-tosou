import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";
import { launchChromium } from "@/lib/screenshot/chromium";
import type { Result } from "@/modules/platform/contracts";

import { acquirePdfRenderLock, releasePdfRenderLock, uploadIssuedDocumentPdf } from "../repository";
import { isPrintTokenSecretConfigured, issuePrintToken, type PrintTokenExtras, type PrintTokenPurpose } from "./print-token";

/**
 * canonical: docs/design/crm-suite/02-sales.md §7.4 (PDF 生成 — 方式 A、gap-pdf 確定)。
 *
 * 手順 (§7.4 と 1:1):
 *  1. pdf_render_lock の CAS lease 取得 (90 秒)。0 行 = 他インスタンス実行中 → 即 KMB-E643
 *  2. Chromium 起動 (src/lib/screenshot/chromium.ts — capture.ts と共通化)
 *  3. page.goto(自オリジン + /print/documents/{id}?token=…) — networkidle0 +
 *     document.fonts.ready 待ち (capture.ts:134 と同型)
 *  4. page.pdf({ format:'A4', printBackground:true, preferCSSPageSize:true })
 *  5. sha256 = createHash('sha256').update(buffer).digest('hex')
 *  6. Storage 保存 (bucket issued-documents、upsert:false 固定)
 *  7. finally: page/browser close + lease 解放 (ベストエフォート)
 *
 * 呼び出し元 (issueDocument/reissueDocument/reviseAndReissueDocument — facade、後続実装) が
 * version (保存パスの v{n}) と印刷トークンの purpose/payload を決めて渡す。本関数自体は
 * 「PDF を 1 回撮って保存する」責務のみを持ち、RPC (document_finalize_issue 等) や
 * documents/issued_documents への書き込みは行わない (facade のオーケストレーション対象)。
 */

const NAVIGATION_TIMEOUT_MS = 45_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GenerateDocumentPdfInput = {
  documentId: string;
  /** 保存パスの v{n} (呼び出し側が決める — 発行時は 1、再出力/訂正時は current_version+1)。 */
  version: number;
  purpose: PrintTokenPurpose;
  payload: PrintTokenExtras | null;
};

export type GeneratedDocumentPdf = {
  sha256: string;
  storagePath: string;
};

/**
 * PDF 生成本体。client は service client を渡すこと (pdf_render_lock/print_tokens/
 * Storage bucket issued-documents はいずれも service 専用)。
 *
 * 判断点 (実装計画書「未解決点4」、オーケストレーターへ報告): 自オリジン解決は
 * `new URL('/print/documents/' + id, env.NEXT_PUBLIC_SITE_URL)` で自前構築する
 * (document_id は下記で UUID 形式を再検証してから使う — 呼び出し元が Zod 検証済みの値のみを
 * 渡す前提だが、URL パスへの文字列連結という性質上、本関数内でも防御的に再検証する)。
 * capture.ts の installSubresourceGuard (任意サブリソースの遮断) は流用しない — /print は
 * 自サイト内の署名トークン付き固定パスへの goto のみで、遷移後に読み込む外部ホストは
 * Supabase Storage (角印の署名 URL) のみであり、フルページスクショ (任意サイトの任意ページを
 * 撮影しうる) と比べてリスク面が異なると判断した。この判断が正しいかは canonical に明記がなく、
 * 実装時の一考の余地として openIssues に記録する。
 */
export async function generateDocumentPdf(
  client: SupabaseClient,
  input: GenerateDocumentPdfInput,
): Promise<Result<GeneratedDocumentPdf>> {
  if (!UUID_RE.test(input.documentId)) {
    return { ok: false, code: "KMB-E901", detail: "documentId が UUID 形式ではありません。" };
  }
  if (!isPrintTokenSecretConfigured()) {
    return {
      ok: false,
      code: "KMB-E640",
      detail: "PRINT_TOKEN_SECRET が未設定です。PDF を生成できません。",
    };
  }

  const lockOwner = randomUUID();
  const acquired = await acquirePdfRenderLock(client, lockOwner);
  if (!acquired.ok) return acquired;
  if (!acquired.value) {
    return {
      ok: false,
      code: "KMB-E643",
      detail: "PDF を生成中です。しばらくしてからもう一度お試しください。",
    };
  }

  try {
    const tokenResult = await issuePrintToken(client, {
      documentId: input.documentId,
      purpose: input.purpose,
      payload: input.payload,
    });
    if (!tokenResult.ok) return tokenResult;

    let env: ReturnType<typeof getEnv>;
    try {
      env = getEnv();
    } catch (err) {
      return { ok: false, code: "KMB-E640", detail: err instanceof Error ? err.message : String(err) };
    }
    const targetUrl = new URL(`/print/documents/${input.documentId}`, env.NEXT_PUBLIC_SITE_URL);
    targetUrl.searchParams.set("token", tokenResult.value.token);

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderPdf(targetUrl.toString());
    } catch (err) {
      return { ok: false, code: "KMB-E640", detail: err instanceof Error ? err.message : String(err) };
    }

    const sha256 = createHash("sha256").update(pdfBuffer).digest("hex");
    const storagePath = `documents/${input.documentId}/v${input.version}-${sha256.slice(0, 8)}.pdf`;

    const uploaded = await uploadIssuedDocumentPdf(client, storagePath, pdfBuffer);
    if (!uploaded.ok) return uploaded;

    return { ok: true, value: { sha256, storagePath } };
  } finally {
    // ベストエフォート解放 (§7.4-1)。失敗してもクラッシュ時と同様 90 秒で自然失効するため、
    // 発行処理自体の成否には影響させない (地雷回避対象外 — repository の注記参照)。
    await releasePdfRenderLock(client, lockOwner);
  }
}

async function renderPdf(url: string): Promise<Buffer> {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: NAVIGATION_TIMEOUT_MS });
    // 日本語 webfont (next/font NotoSansJP) の読込完了を待つ (capture.ts:134 と同型)。
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
