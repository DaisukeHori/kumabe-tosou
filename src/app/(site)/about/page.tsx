import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { AboutPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "会社案内 | 隈部塗装 — 3Dプリント表面処理の専門工房",
  },
  description:
    "隈部塗装の会社案内。代表・隈部信之のプロフィール、工房設備、会社概要、所在地（大分県豊後高田市）。家電量産塗装で培った精度を、3Dプリントの表面処理に注ぐ自動車塗装職人の工房です。",
  openGraph: {
    title: "会社案内 | 隈部塗装 — 3Dプリント表面処理の専門工房",
    description:
      "代表・隈部信之のプロフィール、工房設備、会社概要、所在地（大分県豊後高田市）。",
    images: ["/img/airbrush-dark.jpg"],
  },
};

export default async function AboutPage() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};

  return <AboutPageBody slots={slots} editMode={false} />;
}
