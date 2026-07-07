import type { Metadata } from "next";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CtaBand,
  MapNote,
  PageHead,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";

export const metadata: Metadata = {
  title: {
    absolute: "施工事例 | 隈部塗装 — 3Dプリント造形物の塗装・表面処理事例",
  },
  description:
    "隈部塗装の施工事例。3Dプリント造形物(スマホカバー・小物・車両パーツ・エアブラシ作品 等)の塗装・表面処理サンプルをジャンル別にご紹介します。掲載写真はイメージ、ケースは準備中のダミーです。",
  openGraph: {
    title: "施工事例 | 隈部塗装 — 3Dプリント造形物の塗装・表面処理事例",
    description:
      "3Dプリント造形物の塗装・表面処理サンプルをジャンル別にご紹介。掲載事例は準備中のダミーです。",
    images: ["/img/car-detail.jpg"],
  },
};

const WORKS = [
  {
    id: "work-01",
    title: "3Dプリント車両ボディ",
    genre: "ソリッドカラー",
    img: "/img/car-detail.jpg",
    alt: "車体パーツのクローズアップ",
    caption: "積層痕研磨 → プラサフ → ソリッド原色 → 2液ウレタンクリア",
  },
  {
    id: "work-02",
    title: "スマホケース",
    genre: "パール光彩",
    img: "/img/surface.jpg",
    alt: "光をふくんだ表面の質感",
    caption: "面出し研磨 → プラサフ → 3コートパールベース → クリア仕上げ",
  },
  {
    id: "work-03",
    title: "フィギュア小物",
    genre: "エアブラシグラデーション",
    img: "/img/airbrush-dark.jpg",
    alt: "エアブラシで陰影をつくる作業",
    caption: "下地研磨 → エアブラシで濃淡をのせる → クリアで色止め",
  },
  {
    id: "work-04",
    title: "カスタムパーツ",
    genre: "メタリック仕上げ",
    img: "/img/metal-work.jpg",
    alt: "金属的な質感の加工物",
    caption: "面出し → メタリックベース → クリアで粒子を閉じ込め鏡面研磨",
  },
  {
    id: "work-05",
    title: "エキゾースト風装飾",
    genre: "ソウルレッド",
    img: "/img/machine.jpg",
    alt: "産業機械のような質感の造形物",
    caption: "耐熱プラサフ → 3コートパール(赤系) → クリア + 磨き上げ",
  },
  {
    id: "work-06",
    title: "ヘルメット装飾",
    genre: "マット黒",
    img: "/img/black-car.jpg",
    alt: "モノクロの艶消し質感",
    caption: "面出し研磨#800 → プラサフ → マットブラック → つや消しクリア",
  },
] as const;

export default function WorksPage() {
  return (
    <>
      <PageHead
        index="INDEX 04 — WORKS"
        en="FINISHING SAMPLES"
        title={
          <>
            3Dプリントを、
            <br />
            量産品の顔に。
          </>
        }
        lead="車両パーツからスマホカバー、小物、エアブラシ作品まで。素材や用途ごとに下地の作り方は変わりますが、狙う仕上がりはいつも「積層痕が消えて、量産品と見分けがつかない表面」です。"
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark no="SEC. 01" label="SAMPLES" />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {WORKS.map((work) => (
            <Card
              key={work.id}
              className="gap-0 overflow-hidden rounded-none border-hair bg-paper py-0 shadow-none"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <Image
                  src={work.img}
                  alt={work.alt}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover"
                />
              </div>
              <CardHeader className="gap-2 px-5 pt-5">
                <Badge
                  variant="outline"
                  className="w-fit rounded-none border-hair font-mono text-[9px] tracking-[0.14em] text-carbon-mid"
                >
                  {work.genre}
                </Badge>
                <CardTitle className="text-base tracking-wider">
                  {work.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <p className="text-xs leading-6 text-carbon-mid">
                  {work.caption}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <MapNote>
          ※
          掲載画像はUnsplashの商用利用可能なイメージ素材で、実際の施工写真ではありません。案件情報もダミーです。今後、実施工の写真・詳細を順次公開予定です。
        </MapNote>
      </Section>

      <Section>
        <SectionMark no="SEC. 02" label="NOTE" />
        <SecTitle>一覧はCMSで管理予定です。</SecTitle>
        <SecLead>
          正式公開時は、案件写真・素材・グレード・工程写真を含む一覧をCMS(準備中)で管理し、このページから配信する予定です。現在はレイアウト確認用のダミー一覧を表示しています。
        </SecLead>
      </Section>

      <CtaBand
        title={<>あなたの造形物も、この一覧に。</>}
        note="サイズ・個数・グレードの3点がわかれば概算をお出しできます。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
