import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Surface } from "@/app/admin/_ui";
import { STATUS_LABEL } from "@/app/admin/calendar/_ui/status-labels";
import { canGenerateBlocks } from "@/app/admin/documents/_shared";
import { GenerateBlocksButton } from "@/app/admin/documents/generate-blocks-button";
import { DEAL_STAGE_REGISTRY, type DealStage } from "@/modules/crm/contracts";
import type { Paged, Result } from "@/modules/platform/contracts";
import type { DealWorkSummary } from "@/modules/scheduling/contracts";
import type { DocumentListItem } from "@/modules/sales/contracts";

const VISIBLE_BLOCK_LIMIT = 5;

/**
 * 案件詳細ページの作業ブロックカード (Issue #96 設計 §C-左4、実配線+生成導線)。
 * `schedulingFacade.getDealWorkSummary(id)` の予実サマリー+ブロック一覧に加え、issued/accepted の
 * 受注書があれば `GenerateBlocksButton` (document-detail.tsx から抽出した共用部品) を表示する
 * (帳票が複数ある場合は doc_no を添えて複数ボタン)。
 *
 * workSummaryResult / documentsResult が ok:false のときは blocks / generatableDocs をそれぞれ空配列に
 * 倒すだけでなく、DealDocumentsCard (隣接カード) と同じく code+detail を明示表示する。取得失敗を
 * 「受注後に…」「受注書を発行すると…」の空状態向け誘導文で偽装しない
 * (Result を握り潰さない、レビュー観点1。空状態ガードは workSummaryResult.ok && documentsResult.ok が両方
 * 真のときのみ成立させる)。
 */
export function DealWorkSummaryCard({
  dealId,
  dealStage,
  workSummaryResult,
  documentsResult,
}: {
  dealId: string;
  dealStage: DealStage;
  workSummaryResult: Result<DealWorkSummary>;
  documentsResult: Result<Paged<DocumentListItem>>;
}) {
  const isWon = DEAL_STAGE_REGISTRY[dealStage].isWon;
  const generatableDocs = documentsResult.ok
    ? documentsResult.value.items.filter((d) => canGenerateBlocks(d.doc_type, d.status))
    : [];
  const blocks = workSummaryResult.ok ? workSummaryResult.value.blocks : [];
  const visibleBlocks = blocks.slice(0, VISIBLE_BLOCK_LIMIT);
  const restCount = blocks.length - visibleBlocks.length;

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-medium">作業ブロック</h3>

      {!workSummaryResult.ok && (
        <p className="text-sm text-destructive">
          取得に失敗しました ({workSummaryResult.code}): {workSummaryResult.detail}
        </p>
      )}

      {!documentsResult.ok && (
        <p className="text-sm text-destructive">
          帳票の取得に失敗しました ({documentsResult.code}): {documentsResult.detail}
        </p>
      )}

      {workSummaryResult.ok && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">予定</dt>
            <dd className="font-medium">{workSummaryResult.value.planned_total_hours}h</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">実績</dt>
            <dd className="font-medium">{workSummaryResult.value.actual_total_hours}h</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">完了 / 未完了</dt>
            <dd className="font-medium">
              {workSummaryResult.value.done_count} / {workSummaryResult.value.open_count}
            </dd>
          </div>
        </dl>
      )}

      {generatableDocs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {generatableDocs.map((doc) => (
            <GenerateBlocksButton
              key={doc.id}
              documentId={doc.id}
              dealId={dealId}
              label={generatableDocs.length > 1 ? `作業ブロックを用意 (${doc.doc_no ?? "下書き"})` : "作業ブロックを用意"}
            />
          ))}
        </div>
      )}

      {workSummaryResult.ok && documentsResult.ok && generatableDocs.length === 0 && blocks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isWon ? (
            <>
              受注書を発行すると、明細から作業ブロックを自動で用意できます。{" "}
              <Link href={`/admin/documents/new?deal_id=${dealId}`} className="underline underline-offset-4">
                帳票を作成 →
              </Link>
            </>
          ) : (
            "受注後に、受注書の明細から自動で用意できます。"
          )}
        </p>
      )}

      {visibleBlocks.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {visibleBlocks.map((block) => (
            <li key={block.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{block.work_type_label}</span>
              <Badge variant="outline">{STATUS_LABEL[block.status]}</Badge>
              <span className="text-muted-foreground">
                予定 {block.planned_hours}h{block.actual_hours !== null && ` / 実績 ${block.actual_hours}h`}
              </span>
              {block.performed_on && <span className="ml-auto text-xs text-muted-foreground">{block.performed_on}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {restCount > 0 ? (
          <Link href="/admin/calendar" className="underline underline-offset-4">
            他 {restCount} 件 → カレンダー
          </Link>
        ) : (
          <span />
        )}
        <div className="flex gap-3">
          <Link href="/admin/calendar" className="underline underline-offset-4">
            カレンダーで見る →
          </Link>
          <Link href={`/admin/calendar?create_deal_id=${dealId}`} className="underline underline-offset-4">
            新規作成 →
          </Link>
        </div>
      </div>
    </Surface>
  );
}
