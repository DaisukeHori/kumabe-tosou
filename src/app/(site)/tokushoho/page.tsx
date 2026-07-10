import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { TokushohoPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "特定商取引法に基づく表記 | 隈部塗装",
  },
  description:
    "隈部塗装の特定商取引法に基づく表記。販売業者、取引条件（価格・支払方法・引渡時期・返品条件）、送料などについて記載しています。",
  robots: {
    index: false,
  },
  openGraph: {
    title: "特定商取引法に基づく表記 | 隈部塗装",
    description:
      "隈部塗装の特定商取引法に基づく表記。販売業者、取引条件、送料などについて記載しています。",
    images: ["/hero.jpg"],
  },
};

export default async function TokushohoPage() {
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return <TokushohoPageBody texts={texts} editMode={false} />;
}
