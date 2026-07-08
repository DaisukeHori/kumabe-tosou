import type { Metadata } from "next";
import { Star } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/site/empty-state";
import { MediaCover } from "@/components/site/media-cover";
import {
  ArrowButton,
  MapNote,
  PageHead,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { VoiceBody } from "@/components/site/voice-body";
import { cn } from "@/lib/utils";

import { getPublishedVoices } from "@/app/_lib/public-content";

export const metadata: Metadata = {
  title: {
    absolute: "お客様の声 | 隈部塗装 — ご依頼いただいた方のご感想",
  },
  description:
    "隈部塗装にご依頼いただいた方のご感想。フィギュア・小ロットのカスタムパーツ・車両パーツなど、3Dプリント造形物の塗装・表面処理のご依頼者の声を掲載しています。",
  openGraph: {
    title: "お客様の声 | 隈部塗装 — ご依頼いただいた方のご感想",
    description: "3Dプリント造形物の塗装・表面処理のご依頼者の声。",
    images: ["/img/airbrush-dark.jpg"],
  },
};

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`評価 ${count} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-4",
            i < count ? "fill-soul text-soul" : "fill-transparent text-carbon-soft/40",
          )}
        />
      ))}
    </div>
  );
}

export default async function VoicesPage() {
  const voices = await getPublishedVoices();

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
        {voices.length === 0 ? (
          <div className="mt-10">
            <EmptyState>
              お客様の声は現在準備中です。ご了承をいただいたご感想を、順次掲載していきます。
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {voices.map((voice) => (
                <Card
                  key={voice.id}
                  className="justify-between overflow-hidden rounded-none border-hair bg-paper py-0 shadow-none"
                >
                  {voice.photo ? (
                    <MediaCover src={voice.photo.url} alt={voice.photo.alt} aspect="aspect-[16/10]" />
                  ) : null}
                  <CardHeader className="gap-3 pt-5">
                    <StarRating count={voice.rating} />
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-6">
                    <VoiceBody body={voice.body} />
                    <div className="border-t border-hair pt-4">
                      <p className="text-sm font-medium tracking-wider">
                        {voice.customerInitial} 様
                        <span className="ml-2 text-xs font-normal text-carbon-soft">
                          {voice.region}
                        </span>
                      </p>
                      {voice.item ? (
                        <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-carbon-soft">
                          施工品目 — {voice.item}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <MapNote>
              ※
              掲載しているお客様の声は、ご了承をいただいたうえで公開しています。
            </MapNote>
          </>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/works">施工事例を見る</ArrowButton>
          <ArrowButton href="/contact">相談する</ArrowButton>
        </div>
      </Section>
    </>
  );
}
