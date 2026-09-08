import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { ContactPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "相談する | 山岸塗装 — 見積もりはサイズ×個数×グレードの3つで",
  },
  description:
    "山岸塗装へのご相談。見積もりは「サイズ×個数×グレード」の3点で概算をお出しできます。造形データや写真があればより正確に。お問い合わせフォームから承ります。",
  openGraph: {
    title: "相談する | 山岸塗装 — 見積もりはサイズ×個数×グレードの3つで",
    description: "見積もりは「サイズ×個数×グレード」の3点で概算をお出しできます。",
    images: ["/img/car-night.jpg"],
  },
};

export default async function ContactPage() {
  // フォームの送信最小時間 (3秒) 判定をサーバー時刻基準に揃えるため、描画時刻を渡す
  // (クライアントの時計ずれで正当な送信が黙って捨てられるのを防ぐ。contact-form.tsx 参照)。
  const serverRenderedAt = Date.now();
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return (
    <ContactPageBody
      slots={slots}
      texts={texts}
      editMode={false}
      serverRenderedAt={serverRenderedAt}
    />
  );
}
