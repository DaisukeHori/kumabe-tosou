import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { MaterialsPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "素材対応 | 隈部塗装 — 造形方式・樹脂ごとの下地の作り分け",
  },
  description:
    "FDM（PLA/PETG/ABS/ASA）、光造形（SLA/DLP レジン）、SLS（ナイロン）——3Dプリントの造形方式ごとに、積層痕の出方も塗料の乗り方も違います。素材別の下地の作り分け、UV耐性、入稿ファイル形式まで。隈部塗装の素材対応。",
  openGraph: {
    title: "素材対応 | 隈部塗装 — 造形方式・樹脂ごとの下地の作り分け",
    description:
      "3Dプリントの造形方式ごとに、素材別の下地の作り分け、UV耐性、入稿ファイル形式まで。",
    images: ["/img/printer-3d.jpg"],
  },
};

export default async function MaterialsPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};

  return <MaterialsPageBody slots={slots} editMode={false} />;
}
