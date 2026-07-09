import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { ProcessPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "工程 | 隈部塗装 — 一個が仕上がるまでの、9つの手",
  },
  description:
    "3Dプリント造形物が量産品の外観になるまで。積層痕の研磨、洗浄・脱脂、プラサフ、足付け水研ぎ、ベースコート、クリアコート、常温硬化、検品——自動車補修の工程を、塗膜の層構造とともに一手ずつ解説します。隈部塗装の全工程。",
  openGraph: {
    title: "工程 | 隈部塗装 — 一個が仕上がるまでの、9つの手",
    description:
      "積層痕の研磨から常温硬化・検品まで。自動車補修の工程を、塗膜の層構造とともに一手ずつ解説します。",
    images: ["/img/sanding.jpg"],
  },
};

export default async function ProcessPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};

  return <ProcessPageBody slots={slots} editMode={false} />;
}
