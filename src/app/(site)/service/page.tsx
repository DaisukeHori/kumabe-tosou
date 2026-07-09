import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { ServicePageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "サービス・料金 | 隈部塗装 — 工程・グレード・依頼の流れ",
  },
  description:
    "隈部塗装のサービスと料金。#800研磨→プラサフ→#1200水研ぎの共通下地に、下地仕上げ・スタンダード・プレミアム（3コートパール）の3グレード。数量スライド、依頼の流れ、正直な条件まで。",
  openGraph: {
    title: "サービス・料金 | 隈部塗装 — 工程・グレード・依頼の流れ",
    description:
      "#800研磨→プラサフ→#1200水研ぎの共通下地に、3グレード。数量スライド、依頼の流れ、正直な条件まで。",
    images: ["/img/spray-hold.jpg"],
  },
};

export default async function ServicePage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return <ServicePageBody slots={slots} texts={texts} editMode={false} />;
}
