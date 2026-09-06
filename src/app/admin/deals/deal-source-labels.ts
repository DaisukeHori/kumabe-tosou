import type { DealInput } from "@/modules/crm/contracts";

/** 案件の流入元 (zLeadSource の 5 値)。DB には英字の値が入るので、画面には必ず日本語で出す。 */
export type DealSource = DealInput["source"];

/**
 * 流入元の表示ラベル。新規作成フォーム (DealForm.tsx) と詳細の基本情報カード
 * (\[id\]/DealOverviewCard.tsx) で同じ日本語を出すための単一の対応表。
 * 画面には内部の値 (manual など) をそのまま出さない (ヘルプ設計書 §1)。
 */
export const DEAL_SOURCE_LABELS: Record<DealSource, string> = {
  manual: "手動",
  form: "フォーム",
  simulator: "シミュレーター",
  phone: "電話",
  migration: "移行",
};

/** 流入元の値を表示ラベルに変換する (未知の値が来たらそのまま返す — 画面を壊さないため)。 */
export function dealSourceLabel(source: DealSource): string {
  return DEAL_SOURCE_LABELS[source] ?? source;
}
