import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";
import type { PriceTable } from "@/modules/pricing/contracts";
import { createPricingFacade } from "@/modules/pricing/facade";

import { ShopPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "SHOP | 隈部塗装 — 仕上げを、通販のように買う",
  },
  description:
    "隈部塗装のSHOP。3Dプリント表面処理の受託サービス（下地仕上げ・スタンダード・プレミアム）を、サイズ×個数×グレードのシミュレータで概算し、そのまま注文相談へ。塗装済み製品の販売枠も。",
  openGraph: {
    title: "SHOP | 隈部塗装 — 仕上げを、通販のように買う",
    description:
      "受託サービスをサイズ×個数×グレードのシミュレータで概算し、そのまま注文相談へ。塗装済み製品の販売枠も。",
    images: ["/img/black-car.jpg"],
  },
};

export default async function ShopPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};

  // §6.2: 公開ページはサーバ側で SSR fetch し、クライアント側では再フェッチしない。
  // 取得に失敗した場合も ShopSimulator 側の「価格はお問い合わせください」fallback (§2.3) に委ねる。
  const facade = createPricingFacade();
  const priceTableResult = await facade.getActivePriceTable();
  const priceTable: PriceTable | null = priceTableResult.ok ? priceTableResult.value : null;

  return <ShopPageBody slots={slots} editMode={false} priceTable={priceTable} />;
}
