import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { crmFacade } from "@/modules/crm/facade";
import { createSalesFacade } from "@/modules/sales/facade";
import type { DocumentListItem } from "@/modules/sales/contracts";

import { DocumentDetailView, type Lineage } from "./document-detail";
import { DocumentEditor } from "./document-editor";
import type { SimulatorReferenceData } from "./simulator-reference-panel";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 発行/再出力/訂正発行 (PDF 生成) をこの画面から呼ぶため (§7.2)
// 静的タイトルに固定 (地雷回避: generateMetadata 内で cookie 依存クライアント
// (createSalesFacade() 既定 = session client) を使わない — 他の admin [id]/page.tsx
// (deals/[id]/page.tsx 等) にも generateMetadata 自体が無く、本画面もそれに倣う)。
export const metadata: Metadata = { title: "帳票" };

/** deal_id 内の全帳票から系譜 (派生元 → 本書類 → 派生先) を組み立てる (§8.4)。
 *  listDocuments({deal_id}) 1 回の呼び出しで完結させる (実装計画書「未解決点」に無い項目のため
 *  実装者判断 — 専用の再帰 fetch はしない、1 頁 (50 件) を超える案件は稀という前提)。 */
function buildLineage(items: DocumentListItem[], current: { id: string; source_document_id: string | null }): Lineage {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ancestors: DocumentListItem[] = [];
  let cursor = current.source_document_id;
  let guard = 0;
  while (cursor && guard < 10) {
    const parent = byId.get(cursor);
    if (!parent) break;
    ancestors.unshift(parent);
    cursor = parent.source_document_id;
    guard += 1;
  }
  const descendants = items.filter((i) => i.source_document_id === current.id);
  return { ancestors, descendants };
}

/** §11.2 参考パネル用データ取得。activity 'simulator_estimate' が取れない場合は null (degrade)。 */
async function resolveSimulatorReference(dealId: string): Promise<SimulatorReferenceData | null> {
  const dealDetail = await crmFacade.getDeal(dealId);
  if (!dealDetail.ok || dealDetail.value.source !== "simulator") return null;

  const timeline = await crmFacade.listTimeline({ deal_id: dealId }, { cursor: null, limit: 50 });
  if (!timeline.ok) return null;

  const item = timeline.value.items.find((t) => t.activity_type === "simulator_estimate");
  if (!item || item.payload_error || !item.payload) return null;
  const payload = item.payload as { estimate: SimulatorReferenceData["estimate"]; price_note: string | null };
  return { estimate: payload.estimate, price_note: payload.price_note };
}

/**
 * `/admin/documents/[id]` (§8.3 draft 編集 / §8.4 issued 以降詳細)。WorkForm の mode パターン —
 * 新規コンポーネント乱造禁止 (実装計画書「成果物4」注記) のとおり、同一ルート・同一 page.tsx が
 * document.status で DocumentEditor / DocumentDetailView のどちらをレンダーするか分岐する。
 */
export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const detailResult = await createSalesFacade().getDocumentDetail(id);
  if (!detailResult.ok) {
    if (detailResult.code === "KMB-E621") notFound();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          取得に失敗しました ({detailResult.code}): {detailResult.detail}
        </p>
      </div>
    );
  }
  const detail = detailResult.value;

  const dealRef = await crmFacade.getDealRef(detail.document.deal_id);
  if (!dealRef.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          案件の取得に失敗しました ({dealRef.code}): {dealRef.detail}
        </p>
      </div>
    );
  }

  if (detail.document.status === "draft") {
    const simulatorReference =
      detail.document.doc_type === "quote" ? await resolveSimulatorReference(detail.document.deal_id) : null;
    return (
      <DocumentEditor detail={detail} dealId={detail.document.deal_id} simulatorReference={simulatorReference} />
    );
  }

  const siblings = await createSalesFacade().listDocuments(
    { doc_type: null, status: null, deal_id: detail.document.deal_id, q: null },
    { cursor: null, limit: 50 },
  );
  const lineage: Lineage = siblings.ok
    ? buildLineage(siblings.value.items, { id: detail.document.id, source_document_id: detail.document.source_document_id })
    : { ancestors: [], descendants: [] };

  return (
    <DocumentDetailView
      detail={detail}
      dealTitle={dealRef.value.title}
      dealId={detail.document.deal_id}
      dealUpdatedAt={dealRef.value.updated_at}
      lineage={lineage}
    />
  );
}
