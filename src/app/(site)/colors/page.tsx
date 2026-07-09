import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { ColorsPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "色見本 | 隈部塗装 — 名車の象徴色で組んだ8枚の技術証明",
  },
  description:
    "隈部塗装のカラーラインナップ。トヨタ090ホワイトパール、マツダ46Vソウルレッド、日産TV2ベイサイドブルーほか、名車の象徴色8色。8色中5色が3コート・高難度系です。",
  openGraph: {
    title: "色見本 | 隈部塗装 — 名車の象徴色で組んだ8枚の技術証明",
    description:
      "トヨタ090ホワイトパール、マツダ46Vソウルレッドほか、名車の象徴色8色。8色中5色が3コート・高難度系。",
    images: ["/img/car-night.jpg"],
  },
};

export default async function ColorsPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return <ColorsPageBody slots={slots} texts={texts} editMode={false} />;
}
