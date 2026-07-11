import "server-only";

import { unstable_cache } from "next/cache";

import type { Result } from "@/modules/platform/contracts";

import type {
  EstimateInput,
  EstimateResult,
  PriceGradeInput,
  PriceMatrixCellInput,
  PriceOptionInput,
  PriceSizeClassInput,
  PriceTable,
  QuantityTierInput,
} from "./contracts";
import { zEstimateInput } from "./contracts";
import { computeEstimate } from "./estimate";
import {
  OptimisticLockError,
  getPriceTable,
  replaceMatrix,
  replaceQuantityTiers,
  replaceSizeClasses,
  upsertGrade,
  upsertOption,
} from "./repository";

/**
 * pricing モジュールの公開 facade (契約書 §5)。
 *
 * ---- 契約との乖離 (オーケストレーターへ報告済み) ----
 * 契約書 §5 の PricingFacade は `getActivePriceTable` / `estimate` の 2 メソッドのみを定義しているが、
 * /admin/prices (行列インライン編集 + 保存前プレビュー、設計書 §5.2) の実装には CRUD 書き込みが必須。
 * かつ ESLint (no-restricted-imports, docs/module-contracts.md §2 の機械的強制) が
 * repository.ts への他モジュール外 import を一律禁止しているため、admin Server Action は
 * facade 経由でしか書き込めない。そのため本実装は契約書 §5 の 2 メソッドはそのまま維持しつつ、
 * admin 専用の書き込みメソッド (getFullPriceTable / savePriceGrade / savePriceOption /
 * replacePriceSizeClasses / replacePriceMatrix / replacePriceQuantityTiers) を追補した。
 * 契約書 §5 を更新するかは今後の判断だが、本実装は追補分を含めてこのファイルを正とする。
 *
 * `estimate(input): Result<EstimateResult>` は契約書のシグネチャ通り table 引数を取らない
 * ("純関数" と明記されているが、実際には直前に読み込んだ PriceTable を内部に保持する必要がある)。
 * そのため本実装は `getActivePriceTable()` 呼び出し時に取得した PriceTable を facade インスタンス内に
 * キャッシュし、`estimate()` はそのキャッシュを使って計算する (未取得時は KMB-E901)。
 * shop シミュレータ (クライアントコンポーネント) と admin プレビューは、この facade を介さず
 * `./estimate` の `computeEstimate(table, input)` を直接呼ぶ — こちらが本当の意味での
 * 「副作用なしの純関数」であり、両画面はすでに PriceTable を props/state として保持しているため
 * facade 越しに Supabase を呼ぶ必要がない。
 *
 * createPricingFacade() は呼び出しごとに新しいインスタンスを返すファクトリ (settings/content の
 * ような singleton オブジェクトエクスポートとは異なる) — cachedTable を facade インスタンスの
 * クロージャに閉じ込めるための意図的な設計であり、呼び出し元 (page.tsx / actions.ts) は
 * 都度 createPricingFacade() する前提のため、リクエスト間で state が漏れることはない。
 */
export interface PricingFacade {
  getActivePriceTable(): Promise<Result<PriceTable>>;
  /** 純関数 wrap。直前に getActivePriceTable() で読み込んだ表を使って計算する */
  estimate(input: EstimateInput): Result<EstimateResult>;

  // ---- admin 専用 (契約書 §5 からの拡張。上記コメント参照) ----
  getFullPriceTable(): Promise<Result<PriceTable>>;
  savePriceGrade(
    input: PriceGradeInput,
    id: string | null,
    expectedUpdatedAt: string | null,
  ): Promise<Result<{ id: string }>>;
  savePriceOption(input: PriceOptionInput, id: string | null): Promise<Result<{ id: string }>>;
  replacePriceSizeClasses(input: PriceSizeClassInput[]): Promise<Result<void>>;
  replacePriceMatrix(input: PriceMatrixCellInput[]): Promise<Result<void>>;
  replacePriceQuantityTiers(input: QuantityTierInput[]): Promise<Result<void>>;
}

/**
 * 公開サイト向け読み取りのキャッシュ (設計書 §6.1: unstable_cache + タグ方式、tag='prices')。
 * admin 側 (getFullPriceTable) はキャッシュせず常に最新を読む。
 *
 * 恒久策 P2 (docs/design/crm-suite/06-simulator.md §2.4): revalidate: 3600 を追加し、
 * Data Cache 側の無期限エントリ (旧: tags のみ指定 = TTL なし) を廃止する。
 * revalidateTag('prices') による即時反映 (既存) と、TTL による時間ベース自己修復の
 * 二重化。facade のシグネチャ・契約は不変 (キャッシュ戦略のみの変更)。
 */
// 本番Data Cacheに焼き付いた空エントリを退避するための一度きりのキー更新 (#38)。
// REVALIDATE_SECRETがSensitiveで外部revalidate不可のための代替。
// tag='prices'は不変なので/admin/pricesのrevalidateTagは引き続き有効。
const getCachedActivePriceTable = unstable_cache(
  async () => getPriceTable({ activeOnly: true }),
  ["pricing-active-table", "cachebust-20260711"],
  { tags: ["prices"], revalidate: 3600 },
);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createPricingFacade(): PricingFacade {
  let cachedTable: PriceTable | null = null;

  return {
    async getActivePriceTable() {
      try {
        const table = await getCachedActivePriceTable();
        cachedTable = table;
        return { ok: true, value: table };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    estimate(input) {
      const parsed = zEstimateInput.safeParse(input);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }
      if (!cachedTable) {
        return {
          ok: false,
          code: "KMB-E901",
          detail: "価格表が未取得です。先に getActivePriceTable() を呼んでください。",
        };
      }
      return { ok: true, value: computeEstimate(cachedTable, parsed.data) };
    },

    async getFullPriceTable() {
      try {
        const table = await getPriceTable({ activeOnly: false });
        return { ok: true, value: table };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async savePriceGrade(input, id, expectedUpdatedAt) {
      try {
        const saved = await upsertGrade(input, id, expectedUpdatedAt);
        return { ok: true, value: { id: saved.id } };
      } catch (err) {
        if (err instanceof OptimisticLockError) {
          return { ok: false, code: "KMB-E103", detail: "他の変更と競合しました" };
        }
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async savePriceOption(input, id) {
      try {
        const saved = await upsertOption(input, id);
        return { ok: true, value: { id: saved.id } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async replacePriceSizeClasses(input) {
      try {
        await replaceSizeClasses(input);
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async replacePriceMatrix(input) {
      try {
        await replaceMatrix(input);
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async replacePriceQuantityTiers(input) {
      try {
        await replaceQuantityTiers(input);
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },
  };
}
