import type { Metadata } from "next";
import { Star } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ArrowButton,
  MapNote,
  PageHead,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    absolute: "お客様の声 | 隈部塗装 — ご依頼いただいた方のご感想",
  },
  description:
    "隈部塗装にご依頼いただいた方のご感想。フィギュア・小ロットのカスタムパーツ・車両パーツなど、3Dプリント造形物の塗装・表面処理のご依頼者の声を掲載しています。掲載内容は準備中のダミーです。",
  openGraph: {
    title: "お客様の声 | 隈部塗装 — ご依頼いただいた方のご感想",
    description:
      "3Dプリント造形物の塗装・表面処理のご依頼者の声。掲載内容は準備中のダミーです。",
    images: ["/img/airbrush-dark.jpg"],
  },
};

const VOICES = [
  {
    id: "voice-01",
    heading: "オリジナル3Dプリントフィギュアの仕上がりに感動",
    name: "K.T 様",
    area: "福岡県",
    stars: 5,
    item: "フィギュア(エアブラシグラデーション)",
    body: "自分でデザインしたフィギュアの積層痕がまったく気にならない仕上がりになって驚きました。陰影のグラデーションも思っていた以上に自然で、量産のフィギュアと並べても違和感がありません。",
  },
  {
    id: "voice-02",
    heading: "小ロットでも丁寧に対応いただけた",
    name: "M.S 様",
    area: "大分県",
    stars: 5,
    item: "小型カスタムパーツ(3個・メタリック仕上げ)",
    body: "3個だけの小ロットでも「数が少ないので」と断られることなく、通常と同じ工程で仕上げていただけました。色味の相談にも細かく応じてくれて、届いた実物は写真以上に質感がよかったです。",
  },
  {
    id: "voice-03",
    heading: "相談段階から工程を細かく共有してくれる",
    name: "R.H 様",
    area: "東京都(匿名)",
    stars: 4,
    item: "車両パーツ(ソリッドカラー)",
    body: "見積もり前の相談の時点で、下地からクリアまでの工程と納期の目安を具体的に説明してもらえたので安心して任せられました。郵送でのやり取りでしたが、進捗の連絡もこまめにいただけました。",
  },
] as const;

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`評価 ${count} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-4",
            i < count
              ? "fill-soul text-soul"
              : "fill-transparent text-carbon-soft/40",
          )}
        />
      ))}
    </div>
  );
}

export default function VoicesPage() {
  return (
    <>
      <PageHead
        index="INDEX 05 — VOICES"
        en="CUSTOMER VOICES"
        title={
          <>
            仕上がりを見た方の、
            <br />
            率直な声。
          </>
        }
        lead="ご依頼いただいた方からいただいたご感想を掲載しています。小ロット・個人利用のご依頼が多いため、掲載にあたってはお名前をイニシャルとし、ご了承いただいた範囲でご紹介しています。"
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark no="SEC. 01" label="VOICES" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {VOICES.map((voice) => (
            <Card
              key={voice.id}
              className="justify-between rounded-none border-hair bg-paper shadow-none"
            >
              <CardHeader className="gap-3">
                <StarRating count={voice.stars} />
                <p className="text-[15px] font-bold leading-snug tracking-wider">
                  {voice.heading}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <p className="text-sm leading-7 text-carbon-mid">
                  {voice.body}
                </p>
                <div className="border-t border-hair pt-4">
                  <p className="text-sm font-medium tracking-wider">
                    {voice.name}
                    <span className="ml-2 text-xs font-normal text-carbon-soft">
                      {voice.area}
                    </span>
                  </p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-carbon-soft">
                    施工品目 — {voice.item}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <MapNote>
          ※
          掲載しているお客様の声は、モックアップ段階のダミーです。実際のご依頼者様のご感想は、ご了承をいただいたうえで正式公開時に順次掲載します。
        </MapNote>
        <div className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/works">施工事例を見る</ArrowButton>
          <ArrowButton href="/contact">相談する</ArrowButton>
        </div>
      </Section>
    </>
  );
}
