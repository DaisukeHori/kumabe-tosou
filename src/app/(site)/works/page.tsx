import type { Metadata } from "next";

import { getPublishedWorks } from "@/app/_lib/public-content";
import { pageMediaFacade } from "@/modules/page-media/facade";

import { WorksPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "施工事例 | 隈部塗装 — 3Dプリント造形物の塗装・表面処理事例",
  },
  description:
    "隈部塗装の施工事例。3Dプリント造形物(スマホカバー・小物・車両パーツ・エアブラシ作品 等)の塗装・表面処理サンプルをジャンル別にご紹介します。",
  openGraph: {
    title: "施工事例 | 隈部塗装 — 3Dプリント造形物の塗装・表面処理事例",
    description: "3Dプリント造形物の塗装・表面処理サンプルをジャンル別にご紹介。",
    images: ["/img/car-detail.jpg"],
  },
};

export default async function WorksPage() {
  const works = await getPublishedWorks();
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};
  return <WorksPageBody works={works} texts={texts} editMode={false} />;
}
