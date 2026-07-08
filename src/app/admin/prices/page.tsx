import type { Metadata } from "next";

import { createPricingFacade } from "@/modules/pricing/facade";

import { PriceTableEditor } from "./price-table-editor";

export const metadata: Metadata = {
  title: "価格表管理 | 隈部塗装 CMS",
};

/**
 * /admin/prices (設計書 §5.2)。
 * grades / sizes / matrix / tiers / options のインライン編集 + 保存前プレビュー
 * (変更前後の見積り例3パターン並記)。
 *
 * 認可: middleware (未ログインは /admin/login へ) + 各 Server Action 先頭の
 * platformFacade.requireAdmin() + RLS (is_admin(), migration 20260708000002/20260708000007)
 * の 3 層で保護する (settings/media 等と同じ規約)。本ページ自体 (Server Component の
 * データ読み取り) は admin layout 配下の認証ゲートに委ねる。
 */
export default async function AdminPricesPage() {
  const facade = createPricingFacade();
  const result = await facade.getFullPriceTable();

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-sm text-destructive">
          価格データの取得に失敗しました ({result.code}): {result.detail}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">価格表管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          グレード・サイズ帯・価格行列・数量値引き・オプションを編集します。保存前に見積り例のプレビュー(変更前後)を確認してください。
        </p>
      </div>
      <PriceTableEditor initialTable={result.value} />
    </div>
  );
}
