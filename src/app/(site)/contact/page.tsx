import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { ContactPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "相談する | 隈部塗装 — 見積もりはサイズ×個数×グレードの3つで",
  },
  description:
    "隈部塗装へのご相談。見積もりは「サイズ×個数×グレード」の3点で概算をお出しできます。造形データや写真があればより正確に。お問い合わせフォームから承ります。",
  openGraph: {
    title: "相談する | 隈部塗装 — 見積もりはサイズ×個数×グレードの3つで",
    description: "見積もりは「サイズ×個数×グレード」の3点で概算をお出しできます。",
    images: ["/img/car-night.jpg"],
  },
};

export default async function ContactPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};

  return <ContactPageBody slots={slots} editMode={false} />;
}
