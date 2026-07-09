import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { StoryPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "ストーリー | 隈部塗装 — なぜ、積層痕と戦うことにしたのか",
  },
  description:
    "家電の量産塗装職人が、なぜ3Dプリントの表面処理専門工房を始めたのか。一本の相談から、積層痕との出会い、樹脂との格闘、そして「量産品と見分けがつかない」への到達まで。隈部塗装のストーリーと、代表・隈部信之からのメッセージ。",
  openGraph: {
    title: "ストーリー | 隈部塗装 — なぜ、積層痕と戦うことにしたのか",
    description:
      "家電の量産塗装職人が、なぜ3Dプリントの表面処理専門工房を始めたのか。一本の相談から始まった、下地をめぐる物語。",
    images: ["/img/black-car.jpg"],
  },
};

export default async function StoryPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return <StoryPageBody slots={slots} texts={texts} editMode={false} />;
}
