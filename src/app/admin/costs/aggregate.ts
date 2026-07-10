import { zProvider, type Provider, type UsageSummaryRow } from "@/modules/ai-providers/contracts";

import type { StackedBarInput } from "./chart";

/**
 * /admin/costs (設計書 §9) の集計結果整形 — 純関数群。
 *
 * データの出所: aiProvidersFacade.getUsageSummary(range) が返す UsageSummaryRow[] は
 * repository.getUsageSummaryRows() が `ai_usage_log` を SQL の `created_at` 範囲条件
 * (`.gte`/`.lt`) で絞り込んだ上で (provider, model, feature, key_id, date) 単位まで
 * 折り畳んだ「集計済みの cube」(P1 で実装・tests/ai-providers-repository.test.ts で
 * 契約済み)。本ファイルはその cube を 4 つのダッシュボード表示 (日別×プロバイダ /
 * モデル別 / キー別 / feature別) の形に整形するだけで、生の呼び出しイベントを
 * 数え直す集計はしない (契約書の「クライアント集計禁止」は生ログの再集計を指す —
 * 判断点: 既に確定した集計値を表示用の軸で足し直す本ファイルの処理はこれに当たらない)。
 */

export const PROVIDERS = zProvider.options;

export function microUsdToUsd(microUsd: number): number {
  return microUsd / 1_000_000;
}

export function formatUsd(microUsd: number, fractionDigits = 2): string {
  return `$${microUsdToUsd(microUsd).toFixed(fractionDigits)}`;
}

export function budgetProgressRatio(usedMicroUsd: number, limitMicroUsd: number): number {
  if (limitMicroUsd <= 0) return 0;
  return Math.min(1, Math.max(0, usedMicroUsd / limitMicroUsd));
}

/** [fromDateStr, toDateStrExclusive) の日付 (YYYY-MM-DD, UTC) を列挙する */
export function enumerateDatesUtc(fromDateStr: string, toDateStrExclusive: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromDateStr}T00:00:00.000Z`);
  const end = new Date(`${toDateStrExclusive}T00:00:00.000Z`);
  while (cursor.getTime() < end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

export type DailyProviderPoint = { date: string; provider: Provider; costMicroUsd: number };

/**
 * 日別×プロバイダの積み上げ棒グラフ用データ。[from, to) の全日 × 全プロバイダを
 * ゼロ埋めして返す (データが無い日/プロバイダも棒の位置がずれないようにするため)。
 */
export function toDailyByProvider(rows: readonly UsageSummaryRow[], from: string, to: string): DailyProviderPoint[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.date}|${row.provider}`;
    totals.set(key, (totals.get(key) ?? 0) + row.costMicroUsd);
  }

  const out: DailyProviderPoint[] = [];
  for (const date of enumerateDatesUtc(from, to)) {
    for (const provider of PROVIDERS) {
      out.push({ date, provider, costMicroUsd: totals.get(`${date}|${provider}`) ?? 0 });
    }
  }
  return out;
}

/** 日別ポイントを UsageStackedBarChart の入力形 (日付ごとにセグメント配列を持つ) へ束ねる */
export function toStackedBarInputs(points: readonly DailyProviderPoint[]): StackedBarInput[] {
  const byDate = new Map<string, StackedBarInput>();
  for (const point of points) {
    const segment = { provider: point.provider, value: point.costMicroUsd };
    const existing = byDate.get(point.date);
    if (existing) {
      existing.segments.push(segment);
    } else {
      byDate.set(point.date, { date: point.date, segments: [segment] });
    }
  }
  return [...byDate.values()];
}

export type ModelBreakdownRow = {
  provider: Provider;
  model: string;
  costMicroUsd: number;
  callCount: number;
  imageCount: number;
};

/** モデル別内訳 (provider+model で合算、コスト降順) */
export function toByModel(rows: readonly UsageSummaryRow[]): ModelBreakdownRow[] {
  const totals = new Map<string, ModelBreakdownRow>();
  for (const row of rows) {
    const key = `${row.provider}|${row.model}`;
    const existing = totals.get(key);
    if (existing) {
      existing.costMicroUsd += row.costMicroUsd;
      existing.callCount += row.callCount;
      existing.imageCount += row.imageCount;
    } else {
      totals.set(key, {
        provider: row.provider,
        model: row.model,
        costMicroUsd: row.costMicroUsd,
        callCount: row.callCount,
        imageCount: row.imageCount,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.costMicroUsd - a.costMicroUsd);
}

export type KeyBreakdownRow = {
  keyId: string | null;
  label: string;
  costMicroUsd: number;
  callCount: number;
  imageCount: number;
};

/**
 * キー別内訳。表示ラベルは ai_provider_keys の label (listKeys() 由来のマップ) を
 * 引くだけの単純な参照解決であり集計ではない。未知/削除済みキーは id の先頭 8 桁で表示する。
 */
export function toByKey(rows: readonly UsageSummaryRow[], labelByKeyId: ReadonlyMap<string, string>): KeyBreakdownRow[] {
  const totals = new Map<string, KeyBreakdownRow>();
  for (const row of rows) {
    const dedupeKey = row.keyId ?? "__none__";
    const existing = totals.get(dedupeKey);
    if (existing) {
      existing.costMicroUsd += row.costMicroUsd;
      existing.callCount += row.callCount;
      existing.imageCount += row.imageCount;
    } else {
      const label = row.keyId
        ? (labelByKeyId.get(row.keyId) ?? `不明なキー (${row.keyId.slice(0, 8)})`)
        : "キー未指定";
      totals.set(dedupeKey, {
        keyId: row.keyId,
        label,
        costMicroUsd: row.costMicroUsd,
        callCount: row.callCount,
        imageCount: row.imageCount,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.costMicroUsd - a.costMicroUsd);
}

export type FeatureBreakdownRow = {
  feature: string;
  costMicroUsd: number;
  callCount: number;
  imageCount: number;
};

/** feature 別内訳 (コスト降順) */
export function toByFeature(rows: readonly UsageSummaryRow[]): FeatureBreakdownRow[] {
  const totals = new Map<string, FeatureBreakdownRow>();
  for (const row of rows) {
    const existing = totals.get(row.feature);
    if (existing) {
      existing.costMicroUsd += row.costMicroUsd;
      existing.callCount += row.callCount;
      existing.imageCount += row.imageCount;
    } else {
      totals.set(row.feature, {
        feature: row.feature,
        costMicroUsd: row.costMicroUsd,
        callCount: row.callCount,
        imageCount: row.imageCount,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.costMicroUsd - a.costMicroUsd);
}
