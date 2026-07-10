import type { Metadata } from "next";

import { getPublishedVoices } from "@/app/_lib/public-content";
import { pageMediaFacade } from "@/modules/page-media/facade";

import { VoicesPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "お客様の声 | 隈部塗装 — ご依頼いただいた方のご感想",
  },
  description:
    "隈部塗装にご依頼いただいた方のご感想。フィギュア・小ロットのカスタムパーツ・車両パーツなど、3Dプリント造形物の塗装・表面処理のご依頼者の声を掲載しています。",
  openGraph: {
    title: "お客様の声 | 隈部塗装 — ご依頼いただいた方のご感想",
    description: "3Dプリント造形物の塗装・表面処理のご依頼者の声。",
    images: ["/img/airbrush-dark.jpg"],
  },
};

export default async function VoicesPage() {
  const voices = await getPublishedVoices();
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};
  return <VoicesPageBody voices={voices} texts={texts} editMode={false} />;
}
