import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

const CRAFTS = [
  {
    no: "CRAFT 01",
    title: "積層痕を消す研磨",
    body: "3Dプリント特有の縞を #800 まで面で研ぎ落とし、プラサフで埋め、#1200 で仕上げる。塗装の出来の大半は、この下地で決まります。",
  },
  {
    no: "CRAFT 02",
    title: "自動車グレードの艶",
    body: "2液ウレタンクリアは、吹きっぱなしで自動車外板と同等の艶が出ます。鏡面磨きに時間を使わないから、品質を揺らさずに数を仕上げられます。",
  },
  {
    no: "CRAFT 03",
    title: "3コートパールの意匠",
    body: "ベース＋パール＋クリアの3層構造。ホワイトパールやソウルレッドなど、経験がそのまま出る高難度の意匠塗装に対応します。",
  },
] as const;

const CRAFT_PHOTOS = [
  {
    src: "/img/sanding.jpg",
    alt: "ベルトサンダーで研磨する手元",
    figNo: "FIG.01",
    capJa: "研ぎの手",
    capEn: "SANDING & PREP",
    credit: "Photo: mazinomron / Unsplash",
  },
  {
    src: "/img/spray-hold.jpg",
    alt: "塗料を吹き付けるスプレーガン",
    figNo: "FIG.02",
    capJa: "吹き付けの手",
    capEn: "SPRAY APPLICATION",
    credit: "Photo: createasea / Unsplash",
  },
  {
    src: "/img/car-detail.jpg",
    alt: "深い艶の車体クローズアップ",
    figNo: "FIG.03",
    capJa: "仕上がりの艶",
    capEn: "THE FINISH",
    credit: "Photo: avenir_visuals / Unsplash",
  },
] as const;

const DRAWDOWNS = [
  {
    id: "c-090",
    code: "TOYOTA 090 / 3COAT",
    name: "プレシャスホワイトパール",
    note: "実績納品色",
    a: "var(--dd-090-a)",
    b: "var(--dd-090-b)",
  },
  {
    id: "c-46v",
    code: "MAZDA 46V / 3COAT",
    name: "ソウルレッドクリスタル",
    note: "最高難度の技術証明",
    a: "var(--dd-46v-a)",
    b: "var(--dd-46v-b)",
  },
  {
    id: "c-4y6",
    code: "TOYOTA 4Y6 / METALLIC",
    name: "プレシャスブロンズ",
    note: "現行クラウンの上品な茶",
    a: "var(--dd-4y6-a)",
    b: "var(--dd-4y6-b)",
  },
  {
    id: "c-3t4",
    code: "TOYOTA 3T4 / 3COAT",
    name: "ピンクサファイア",
    note: "全国650台限定の伝説色",
    a: "var(--dd-3t4-a)",
    b: "var(--dd-3t4-b)",
  },
  {
    id: "c-202",
    code: "TOYOTA 202 / SOLID",
    name: "ブラック",
    note: "最難関ソリッド黒",
    a: "var(--dd-202-a)",
    b: "var(--dd-202-b)",
  },
  {
    id: "c-tv2",
    code: "NISSAN TV2 / 3COAT",
    name: "ベイサイドブルー",
    note: "R34 GT-Rの代名詞",
    a: "var(--dd-tv2-a)",
    b: "var(--dd-tv2-b)",
  },
  {
    id: "c-am",
    code: "ASTON MARTIN AM9539",
    name: "レーシンググリーン",
    note: "英国の象徴色",
    a: "var(--dd-am-a)",
    b: "var(--dd-am-b)",
  },
  {
    id: "c-46g",
    code: "MAZDA 46G / METALLIC",
    name: "マシーングレー",
    note: "匠塗のもう一枚の看板",
    a: "var(--dd-46g-a)",
    b: "var(--dd-46g-b)",
  },
] as const;

function SectionMark({ no, label }: { no: string; label: string }) {
  return (
    <p className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
      <span>{no}</span>
      <span className="h-px w-12 bg-hair" aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}

function ArrowButton({ href, children }: { href: string; children: string }) {
  return (
    <Button
      variant="outline"
      render={<Link href={href} />}
      className="h-10 rounded-none border-carbon/40 bg-transparent px-5 tracking-[0.08em] text-carbon hover:bg-carbon hover:text-paper"
    >
      {children}
      <span aria-hidden="true" className="ml-1">
        →
      </span>
    </Button>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-primer text-carbon">
      <SiteHeader />

      <main className="flex-1">
        {/* ============ HERO ============ */}
        <section className="mx-auto max-w-[1240px] px-5 pb-16 pt-20 sm:px-8 sm:pt-28">
          <p className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
            <span>INDEX 00 — HOME</span>
            <span className="h-px w-16 bg-hair" aria-hidden="true" />
            <span className="hidden sm:inline">
              SURFACE FINISHING FOR 3D PRINTS
            </span>
          </p>
          <h1 className="mt-8 text-[clamp(34px,6.2vw,72px)] font-bold leading-[1.3] tracking-[0.04em]">
            3Dプリントを、
            <br />
            量産品と
            <span className="underline decoration-soul decoration-4 underline-offset-[10px]">
              見分けがつかない
            </span>
            <br />
            外観に。
          </h1>
          <p className="mt-10 max-w-2xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid">
            積層痕を消す研磨から、自動車グレードの塗装仕上げまで。家電の量産塗装で「量産の精度」を磨いた自動車塗装職人が、勝負試作の一点からブリッジ生産の千個まで、郵送で全国からお受けします。
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ArrowButton href="/shop">SHOPで概算を出す</ArrowButton>
            <ArrowButton href="/colors">8色の色見本を見る</ArrowButton>
            <ArrowButton href="/service">サービス・料金</ArrowButton>
          </div>
          <div className="mt-14 overflow-hidden border-y border-hair py-2">
            <p className="whitespace-nowrap font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
              #800 SANDED — PRIMER-SURFACER — #1200 WET-SANDED — 2K URETHANE
              TOPCOAT — 3-COAT PEARL READY — BATCH ×30 / 200mm CLASS — SHIPPED
              NATIONWIDE
            </p>
          </div>
        </section>

        {/* ============ HERO PHOTO BAND ============ */}
        <section className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <figure className="border border-hair bg-paper p-2">
            <span className="block px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
              FIG.00 — FINISH
            </span>
            <div className="relative aspect-[21/9] w-full overflow-hidden">
              <Image
                src="/hero.jpg"
                alt="深い艶で仕上げられた黒い車体"
                fill
                priority
                sizes="(max-width: 1240px) 100vw, 1240px"
                className="object-cover"
              />
            </div>
            <figcaption className="flex flex-col gap-1 px-2 py-2 sm:flex-row sm:items-baseline sm:justify-between">
              <span className="text-xs tracking-wider text-carbon-mid">
                自動車グレードの塗装が、造形物の最終工程になる。
                <span className="ml-3 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  AUTOMOTIVE-GRADE FINISH
                </span>
              </span>
              <span className="font-mono text-[10px] text-carbon-soft">
                Photo: cmreflections / Unsplash
              </span>
            </figcaption>
          </figure>
        </section>

        {/* ============ CRAFT (サービス概要) ============ */}
        <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
          <SectionMark no="SEC. 02" label="CRAFT" />
          <h2 className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]">
            3つの技術を、ひとりで持つ。
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {CRAFTS.map((craft) => (
              <Card
                key={craft.no}
                className="rounded-none border-hair bg-paper shadow-none"
              >
                <CardHeader>
                  <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                    {craft.no}
                  </p>
                  <CardTitle className="text-lg tracking-wider">
                    {craft.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-carbon-mid">
                    {craft.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <ArrowButton href="/process">全9工程を見る</ArrowButton>
            <ArrowButton href="/about">工房と職人について</ArrowButton>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {CRAFT_PHOTOS.map((photo) => (
              <figure
                key={photo.figNo}
                className="border border-hair bg-paper p-2"
              >
                <span className="block px-1 py-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  {photo.figNo}
                </span>
                <div className="relative aspect-[3/4] w-full overflow-hidden">
                  <Image
                    src={photo.src}
                    alt={photo.alt}
                    fill
                    sizes="(max-width: 640px) 100vw, 400px"
                    className="object-cover"
                  />
                </div>
                <figcaption className="flex items-baseline justify-between px-1 py-2">
                  <span className="text-xs tracking-wider text-carbon-mid">
                    {photo.capJa}
                    <span className="ml-2 font-mono text-[9px] tracking-[0.18em] text-carbon-soft">
                      {photo.capEn}
                    </span>
                  </span>
                  <span className="font-mono text-[9px] text-carbon-soft">
                    {photo.credit}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ============ COLOR LINEUP (実績プレビュー) ============ */}
        <section className="mx-auto max-w-[1240px] px-5 pb-24 sm:px-8 sm:pb-32">
          <SectionMark no="SEC. 03" label="COLOR LINEUP" />
          <h2 className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]">
            名車の象徴色で組んだ、
            <br />
            8枚の技術証明。
          </h2>
          <p className="mt-6 max-w-2xl text-[15px] leading-[2.05] text-carbon-mid">
            8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。
          </p>
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {DRAWDOWNS.map((dd) => (
              <Link
                key={dd.id}
                href={`/colors#${dd.id}`}
                className="group border border-hair bg-paper p-2 transition-colors hover:border-carbon/40"
              >
                <div
                  className="aspect-[4/3] w-full"
                  style={{
                    background: `linear-gradient(160deg, ${dd.a}, ${dd.b})`,
                  }}
                  aria-hidden="true"
                />
                <div className="px-1 pb-1 pt-3">
                  <p className="font-mono text-[9px] tracking-[0.14em] text-carbon-soft">
                    {dd.code}
                  </p>
                  <p className="mt-1 text-sm font-medium tracking-wider">
                    {dd.name}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-2 rounded-none border-hair font-mono text-[9px] tracking-[0.1em] text-carbon-mid"
                  >
                    {dd.note}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-10">
            <ArrowButton href="/colors">色見本を一枚ずつ見る</ArrowButton>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section className="bg-carbon text-paper">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[clamp(22px,3vw,34px)] font-bold leading-snug tracking-[0.04em]">
                見積もりは、3つの数字で。
                <br />
                サイズ × 個数 × グレード。
              </p>
              <p className="mt-4 text-sm leading-7 text-paper/70">
                造形データや写真があれば、より正確に概算をお出しできます。
              </p>
            </div>
            <Button
              render={<Link href="/contact" />}
              className="h-12 shrink-0 rounded-none bg-paper px-8 tracking-[0.12em] text-carbon hover:bg-paper/85"
            >
              相談する
              <span aria-hidden="true" className="ml-1">
                →
              </span>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
