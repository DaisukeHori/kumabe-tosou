import type { Metadata } from "next";

import { getPublishedReadingPosts } from "@/app/_lib/public-content";
import { pageMediaFacade } from "@/modules/page-media/facade";

import { NotesPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "読みもの | 隈部塗装 — 塗りと色の裏側",
  },
  description:
    "隈部塗装の読みもの。工程と色の裏側を言葉で残しています。センチュリーの黒が水研ぎ3回である理由、ディーラーでも同色にならない赤の構造など。",
  openGraph: {
    title: "読みもの | 隈部塗装 — 塗りと色の裏側",
    description: "工程と色の裏側を言葉で残しています。",
    images: ["/img/garage-work.jpg"],
  },
};

export default async function NotesPage() {
  const posts = await getPublishedReadingPosts();
  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};
  return <NotesPageBody posts={posts} texts={texts} editMode={false} />;
}
