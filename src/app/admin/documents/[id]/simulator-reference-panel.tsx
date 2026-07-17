import { Badge } from "@/components/ui/badge";
import { Surface } from "@/app/admin/_ui";
import type { SimEstimateSnapshot } from "@/modules/crm/contracts";

import { formatJpy } from "../_shared";

export type SimulatorReferenceData = {
  estimate: SimEstimateSnapshot;
  price_note: string | null;
};

/**
 * 見積原案 vs シミュレーター入力の参考パネル (§11.2)。シミュレーター由来 (deal.source='simulator')
 * の draft quote 編集画面上部に表示する。差分計算はしない (概算レンジ vs 確定見積は比較の意味論が
 * 異なる — §11.2) — 現在合計がレンジ外なら情報 Badge のみ表示する (エラーにしない)。
 * activity 'simulator_estimate' が取得できない場合はこのコンポーネント自体を呼び出し側 ([id]/page.tsx)
 * が非表示にする degrade 方針 (§11.2「activity が取得できない場合はパネル自体を非表示」)。
 */
export function SimulatorReferencePanel({
  data,
  currentTotalJpy,
}: {
  data: SimulatorReferenceData;
  currentTotalJpy: number;
}) {
  const { estimate, price_note } = data;
  const outOfRange = currentTotalJpy < estimate.total_min || currentTotalJpy > estimate.total_max;

  return (
    <Surface className="flex flex-col gap-2 border-l-4 border-l-primary/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-label font-bold text-admin-text-label">シミュレーター入力 (参考)</h2>
        {outOfRange && <Badge variant="warning">概算レンジ外</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-meta text-admin-text-meta sm:grid-cols-4">
        <div>
          <dt>グレード</dt>
          <dd className="text-foreground">{estimate.grade_label}</dd>
        </div>
        <div>
          <dt>サイズ</dt>
          <dd className="text-foreground">{estimate.size_label}</dd>
        </div>
        <div>
          <dt>個数</dt>
          <dd className="text-foreground">{estimate.quantity}</dd>
        </div>
        {estimate.option_keys.length > 0 && (
          <div>
            <dt>オプション</dt>
            <dd className="text-foreground">{estimate.option_keys.join("・")}</dd>
          </div>
        )}
      </dl>
      <p className="text-meta">
        概算レンジ: <span className="font-medium tabular-nums">税込 {formatJpy(estimate.total_min)}〜{formatJpy(estimate.total_max)}</span>
        {" / "}現在の下書き合計: <span className="font-medium tabular-nums">{formatJpy(currentTotalJpy)} (税込)</span>
      </p>
      {price_note && <p className="text-meta text-admin-text-meta">{price_note}</p>}
    </Surface>
  );
}
