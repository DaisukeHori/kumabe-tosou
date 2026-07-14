import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { DocType } from "@/modules/sales/contracts";
import { createSalesFacade } from "@/modules/sales/facade";

import { DocumentSheet } from "../_components/document-sheet";
import "../print.css";

/**
 * canonical: docs/design/crm-suite/02-sales.md §7.3 (route 実装部分) / §10.8。
 *
 * token 検証・消費 → document + lines(+staging) + issuer の読み取り → 角印署名 URL 解決までは
 * `salesFacade.resolvePrintView()` (sales/facade.ts — Issue #50 追加、上記ファイルの JSDoc
 * 参照) に集約されている。**page.tsx (src/app 配下) は sales モジュールに所属しないため
 * ESLint モジュール境界 (module-contracts.md §2) により sales/internal/** や
 * sales/repository を直接 import できず、facade 経由のみが許可される** — この 1 メソッド呼び出しに
 * 薄く留めているのはその制約による設計。
 *
 * route group `(print)` はサイト chrome・モーション CSS を持たない (middleware の保護対象にも
 * 含めない — /admin, /edit のみが matcher 対象。トークンのみが認可)。
 *
 * 判断点 (実装計画書「未解決点」、オーケストレーターへ報告):
 * - **HTTP ステータス**: §7.3 は「403 + KMB-E642」を想定した記述だが、Next.js App Router の
 *   page.tsx (Server Component) から任意のステータスコードを直接返す標準手段がない
 *   (Route Handler であれば NextResponse で可能だが、canonical §10.8 は実装ファイルとして
 *   明示的に page.tsx を指定している)。ここでは token 不正/期限切れ/消費済み/帳票不在のケースを
 *   一律 `notFound()` (404) に倒す — 詳細を返さない・偽装アクセスを拒否する、という§7.3の
 *   意図は満たしつつ、正確な 403 は返せていない。Next.js 15 の `forbidden()` (next/navigation) は
 *   `experimental.authInterrupts` フラグが必要で本 Issue のスコープ外の next.config.ts 変更を
 *   伴うため見送った。openIssues に記録する。
 * - **Cache-Control: no-store**: page.tsx から明示的にレスポンスヘッダを設定する標準手段が
 *   ないため、`searchParams` (dynamic API) 使用による自動的な動的レンダリング + 明示的な
 *   `export const dynamic = "force-dynamic"` で「キャッシュしない」を実現する
 *   (Next.js は dynamic API を使うページを静的最適化・ISR の対象にしない)。厳密な
 *   `Cache-Control: no-store` ヘッダそのものの付与は確認できていない — openIssues に記録する。
 * - DB/システム側の実エラー (KMB-E901/E621 等、トークン検証以外の失敗) は notFound() に丸めず
 *   例外として投げる (地雷回避: サーバ障害が「トークン切れ」に見えると原因追跡を妨げるため)。
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PrintDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;

  if (!token) notFound();

  const result = await createSalesFacade().resolvePrintView(id, token);
  if (!result.ok) {
    if (result.code === "KMB-E642") notFound();
    if (result.code === "KMB-E621") notFound();
    throw new Error(`印刷ビューの取得に失敗しました (${result.code}): ${result.detail ?? ""}`);
  }
  const view = result.value;

  return (
    <div className="print-sheet">
      <DocumentSheet
        docType={view.docType as DocType}
        docNo={view.docNo}
        issueDate={view.issueDate}
        transactionDate={view.transactionDate}
        validUntil={view.validUntil}
        billingName={view.billingName}
        billingSuffix={view.billingSuffix}
        billingAddress={view.billingAddress}
        siteName={view.siteName}
        siteAddress={view.siteAddress}
        notes={view.notes}
        subtotalJpy={view.subtotalJpy}
        taxSummary={view.taxSummary}
        totalJpy={view.totalJpy}
        issuer={view.issuer}
        sealSignedUrl={view.sealSignedUrl}
        lines={view.lines}
        watermark={view.watermark}
      />
    </div>
  );
}
