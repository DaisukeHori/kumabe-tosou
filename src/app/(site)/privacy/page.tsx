import type { Metadata } from "next";

import { pageMediaFacade } from "@/modules/page-media/facade";

import { PrivacyPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "プライバシーポリシー | 隈部塗装",
  },
  description:
    "隈部塗装のプライバシーポリシー。取得する個人情報、利用目的、第三者提供、保存期間、開示・訂正・削除の請求方法、Cookieの利用について記載しています。",
  openGraph: {
    title: "プライバシーポリシー | 隈部塗装",
    description:
      "隈部塗装のプライバシーポリシー。取得する個人情報、利用目的、第三者提供、保存期間、開示・訂正・削除の請求方法について。",
    images: ["/hero.jpg"],
  },
};

export default async function PrivacyPage() {
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return <PrivacyPageBody texts={texts} editMode={false} />;
}
