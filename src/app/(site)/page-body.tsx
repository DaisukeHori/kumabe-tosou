import { Fragment } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ColorStrip } from "@/components/motion/color-strip";
import { SplitChars } from "@/components/motion/split-chars";
import { ArrowButton, SectionMark } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotImage } from "@/components/site/slot-image";
import { SlotText } from "@/components/site/slot-text";
import { StatCount } from "@/components/site/stat-count";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

/**
 * トップページのページボディ (docs/design/visual-media-editor.md §4.2)。
 * データ取得 (slots) は呼び出し側ルート ((site)/page.tsx = cached / (editor)/edit = fresh) が行う。
 * ページボディ自体はデータを受け取るだけの純粋な表示コンポーネント。
 */

const TICKER_ITEMS = [
  "#800 SANDED",
  "PRIMER-SURFACER",
  "#1200 WET-SANDED",
  "2K URETHANE TOPCOAT",
  "3-COAT PEARL READY",
  "BATCH ×30 / 200mm CLASS",
  "SHIPPED NATIONWIDE",
] as const;

const CRAFTS = [
  {
    no: "CRAFT 01",
    slotKey: "home.craft.card.1.title",
    title: "積層痕を消す研磨",
    body: "3Dプリント特有の縞を #800 まで面で研ぎ落とし、プラサフで埋め、#1200 で仕上げる。塗装の出来の大半は、この下地で決まります。",
  },
  {
    no: "CRAFT 02",
    slotKey: "home.craft.card.2.title",
    title: "自動車グレードの艶",
    body: "2液ウレタンクリアは、吹きっぱなしで自動車外板と同等の艶が出ます。鏡面磨きに時間を使わないから、品質を揺らさずに数を仕上げられます。",
  },
  {
    no: "CRAFT 03",
    slotKey: "home.craft.card.3.title",
    title: "3コートパールの意匠",
    body: "ベース＋パール＋クリアの3層構造。ホワイトパールやソウルレッドなど、経験がそのまま出る高難度の意匠塗装に対応します。",
  },
] as const;

const CRAFT_PHOTOS = [
  {
    slotKey: "home.craft.1",
    figNo: "FIG.01",
    capJa: "研ぎの手",
    capEn: "SANDING & PREP",
    credit: "Photo: mazinomron / Unsplash",
  },
  {
    slotKey: "home.craft.2",
    figNo: "FIG.02",
    capJa: "吹き付けの手",
    capEn: "SPRAY APPLICATION",
    credit: "Photo: createasea / Unsplash",
  },
  {
    slotKey: "home.craft.3",
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
    pearl: true,
  },
  {
    id: "c-46v",
    code: "MAZDA 46V / 3COAT",
    name: "ソウルレッドクリスタル",
    note: "最高難度の技術証明",
    a: "var(--dd-46v-a)",
    b: "var(--dd-46v-b)",
    pearl: false,
  },
  {
    id: "c-4y6",
    code: "TOYOTA 4Y6 / METALLIC",
    name: "プレシャスブロンズ",
    note: "現行クラウンの上品な茶",
    a: "var(--dd-4y6-a)",
    b: "var(--dd-4y6-b)",
    pearl: false,
  },
  {
    id: "c-3t4",
    code: "TOYOTA 3T4 / 3COAT",
    name: "ピンクサファイア",
    note: "全国650台限定の伝説色",
    a: "var(--dd-3t4-a)",
    b: "var(--dd-3t4-b)",
    pearl: true,
  },
  {
    id: "c-202",
    code: "TOYOTA 202 / SOLID",
    name: "ブラック",
    note: "最難関ソリッド黒",
    a: "var(--dd-202-a)",
    b: "var(--dd-202-b)",
    pearl: false,
  },
  {
    id: "c-tv2",
    code: "NISSAN TV2 / 3COAT",
    name: "ベイサイドブルー",
    note: "R34 GT-Rの代名詞",
    a: "var(--dd-tv2-a)",
    b: "var(--dd-tv2-b)",
    pearl: true,
  },
  {
    id: "c-am",
    code: "ASTON MARTIN AM9539",
    name: "レーシンググリーン",
    note: "英国の象徴色",
    a: "var(--dd-am-a)",
    b: "var(--dd-am-b)",
    pearl: false,
  },
  {
    id: "c-46g",
    code: "MAZDA 46G / METALLIC",
    name: "マシーングレー",
    note: "匠塗のもう一枚の看板",
    a: "var(--dd-46g-a)",
    b: "var(--dd-46g-b)",
    pearl: false,
  },
] as const;

const TWO_SCENES = [
  {
    range: "1–9",
    unit: "PIECES / 勝負試作",
    slotKey: "home.twoscenes.scene.1.title",
    title: "プレミアムデザインモデルの一点仕上げ",
    body: "企業トップへの最終プレゼン、重要商談、展示会、クラウドファンディングの掲載写真。「絶対に外せない場面」で使う高品質試作を、量産品の顔に仕上げます。",
  },
  {
    range: "30–1,000",
    unit: "PIECES / ブリッジ生産",
    slotKey: "home.twoscenes.scene.2.title",
    title: "金型を作らない少量生産の外観仕上げ",
    body: "クラウドファンディングのリターン品、D2Cの初回ロット、産業機器の筐体。金型なしの少量生産を「量産品の見た目」にする最終工程を担います。",
  },
] as const;

const STAT_GRID = [
  {
    num: 6,
    unit: "本",
    label: "バンパー同時塗装",
    en: "SIMULTANEOUS BUMPERS",
    note: "この同時処理能力があるから、小物なら100個超を一度に。数量対応力は、そのまま価格に還元されます。",
  },
  {
    num: null,
    display: "220–2000",
    unit: "",
    label: "段階研磨の番手",
    en: "PROGRESSIVE GRIT",
    note: "粗い番手から徐々に上げる段階研磨。海外の現場で「射出成形品と見分けがつかない」とされる面の基準です。",
  },
  {
    num: 8,
    unit: "色",
    label: "名車の象徴色ラインナップ",
    en: "SIGNATURE COLORS",
    note: "うち5色が3コート・高難度系。ソウルレッドもベイサイドブルーも、塗れること自体が技術の証明です。",
  },
  {
    num: null,
    display: "1–1,000",
    unit: "",
    label: "対応数量（点）",
    en: "PIECES PER ORDER",
    note: "勝負試作の一点から、ブリッジ生産の千個まで。試作と量産を、同じ品質基準で仕上げます。",
  },
  {
    num: 40,
    unit: "時間",
    label: "最高級の黒が下地にかける時間",
    en: "CENTURY \"KAMUI\" BLACK",
    note: "名車センチュリーの黒は、塗装だけで約40時間・水研ぎ3回。その下地への敬意を、すべての仕事に持ち込みます。",
  },
  {
    num: null,
    display: "5–7",
    unit: "日",
    label: "2液ウレタン完全硬化",
    en: "FULL CURE",
    note: "主剤と硬化剤の化学反応で硬く艶やかに。硬化を待ち、検品してから発送します。急がば、回る。",
  },
] as const;

const GALLERY_PHOTOS = [
  {
    slotKey: "home.gallery.1",
    figNo: "FIG.04",
    capJa: "手を動かす",
    capEn: "HANDS AT WORK",
    credit: "Photo: claritycoat / Unsplash",
  },
  {
    slotKey: "home.gallery.2",
    figNo: "FIG.05",
    capJa: "段取り",
    capEn: "THE TOOLING",
    credit: "Photo: volft / Unsplash",
  },
  {
    slotKey: "home.gallery.3",
    figNo: "FIG.06",
    capJa: "精度",
    capEn: "THE MACHINERY",
    credit: "Photo: kadircelep / Unsplash",
  },
] as const;

export function HomePageBody({
  slots,
  texts,
  editMode,
}: {
  slots: ResolvedSlots;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <>
      {/* ============ HERO ============ */}
      <section className="relative mx-auto max-w-[1240px] px-5 pb-16 pt-20 sm:px-8 sm:pt-28">
        {/* 設計図グリッド+寸法マーカー (legacy/index.html:45-51, css:1451-1501) */}
        <div className="kt-hero-grid" aria-hidden="true">
          <span className="kt-hero-dim kt-hero-dim--x">
            <i className="kt-hero-tick" />
            200mm CLASS
            <i className="kt-hero-tick" />
          </span>
          <span className="kt-hero-dim kt-hero-dim--y">
            <i className="kt-hero-tick" />
            φ55
            <i className="kt-hero-tick" />
          </span>
          <span className="kt-hero-cross kt-hero-cross--tl">+</span>
          <span className="kt-hero-cross kt-hero-cross--tr">+</span>
          <span className="kt-hero-cross kt-hero-cross--bl">+</span>
        </div>
        <div className="relative z-[1]">
          <p className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
            <span>INDEX 00 — HOME</span>
            <span className="h-px w-16 bg-hair" aria-hidden="true" />
            <span className="hidden sm:inline">
              SURFACE FINISHING FOR 3D PRINTS
            </span>
          </p>
          {/* [Wave5 W5-E] 文字リビール A/B 切替 (実装計画 §5): 既定は Variant A
              「立ち上がり」(kt-hero-title--split)。Variant B「塗られて現れる」を
              試すには、下の className を "kt-hero-title--paint" に差し替えるだけ
              (globals.css の page-home 区画 .kt-hero-title--paint を参照)。 */}
          <h1
            className="kt-hero-title--split mt-8 text-[clamp(34px,6.2vw,72px)] font-bold leading-[1.3] tracking-[0.04em]"
            aria-label="3Dプリントを、量産品と見分けがつかない外観に。"
          >
            <SplitChars>
              <span className="kt-hero-line">
                <span>3Dプリントを、</span>
              </span>
              <span className="kt-hero-line">
                <span>
                  量産品と
                  <span className="kt-paint-mark">見分けがつかない</span>
                </span>
              </span>
              <span className="kt-hero-line">
                <span>外観に。</span>
              </span>
            </SplitChars>
          </h1>
          <p className="mt-10 max-w-2xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid">
            積層痕を消す研磨から、自動車グレードの塗装仕上げまで。家電の量産塗装で「量産の精度」を磨いた自動車塗装職人が、勝負試作の一点からブリッジ生産の千個まで、郵送で全国からお受けします。
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ArrowButton href="/shop">SHOPで概算を出す</ArrowButton>
            <ArrowButton href="/colors">8色の色見本を見る</ArrowButton>
            <ArrowButton href="/service">サービス・料金</ArrowButton>
          </div>
          <div
            className="kt-marquee mt-14 overflow-hidden border-y border-hair py-2"
            aria-hidden="true"
          >
            <div className="kt-marquee-track font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
              {[0, 1].map((rep) => (
                <span key={rep} className="flex">
                  {TICKER_ITEMS.map((item, i) => (
                    <span key={`${rep}-${i}`} className="inline-block pr-[4.5em]">
                      {item}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ HERO PHOTO BAND ============ */}
      <section className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <Reveal as="figure" className="border border-hair bg-paper p-2">
          <span className="block px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
            FIG.00 — FINISH
          </span>
          <SlotImage slotKey="home.hero" resolved={slots["home.hero"]} editMode={editMode} />
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
        </Reveal>
      </section>

      {/* ============ STATEMENT ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="SEC. 01" label="STATEMENT" />
        <Reveal
          as="p"
          className="mt-8 text-[clamp(21px,3vw,34px)] font-bold leading-[2.05] tracking-[0.06em]"
        >
          <SlotText
            slotKey="home.statement.heading"
            resolved={texts["home.statement.heading"]}
            editMode={editMode}
            renderLines={(lines) => (
              <>
                {lines.map((line, i) => (
                  <Fragment key={i}>
                    {i > 0 ? <br /> : null}
                    {i === lines.length - 1 ? (
                      <span className="text-soul">{line}</span>
                    ) : (
                      line
                    )}
                  </Fragment>
                ))}
              </>
            )}
          />
        </Reveal>
        <Reveal
          as="p"
          className="mt-8 max-w-2xl text-[15px] leading-[2.05] text-carbon-mid"
        >
          塗装はできても積層痕を知らない塗装店。造形はできても、仕上げは単色止まりの出力サービス。金型を作らない少量生産の最大の弱点は「積層痕のある外観」——それを解決する最終工程こそが、この市場の付加価値の在り処です。
        </Reveal>
        <Reveal as="div" className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/story">なぜこの工房を始めたのか</ArrowButton>
        </Reveal>
      </section>

      {/* ============ CRAFT (サービス概要) ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="SEC. 02" label="CRAFT" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.craft.heading"
          resolved={texts["home.craft.heading"]}
          editMode={editMode}
        />
        <Reveal as="div" className="mt-12 grid gap-5 md:grid-cols-3">
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
                  <SlotText
                    slotKey={craft.slotKey}
                    resolved={texts[craft.slotKey]}
                    editMode={editMode}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-7 text-carbon-mid">
                  {craft.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </Reveal>
        <Reveal as="div" className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/process">全9工程を見る</ArrowButton>
          <ArrowButton href="/about">工房と職人について</ArrowButton>
        </Reveal>
        <Reveal as="div" className="mt-12 grid gap-5 sm:grid-cols-3">
          {CRAFT_PHOTOS.map((photo) => (
            <figure
              key={photo.figNo}
              className="border border-hair bg-paper p-2"
            >
              <span className="block px-1 py-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                {photo.figNo}
              </span>
              <SlotImage
                slotKey={photo.slotKey}
                resolved={slots[photo.slotKey]}
                editMode={editMode}
              />
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
        </Reveal>
      </section>

      {/* ============ COLOR LINEUP (実績プレビュー) ============ */}
      <section className="mx-auto max-w-[1240px] px-5 pb-24 sm:px-8 sm:pb-32">
        <SectionMark no="SEC. 03" label="COLOR LINEUP" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.colorlineup.heading"
          resolved={texts["home.colorlineup.heading"]}
          editMode={editMode}
        />
        <p className="mt-6 max-w-2xl text-[15px] leading-[2.05] text-carbon-mid">
          8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。
        </p>
        <Reveal as="div" className="kt-color-strip-wrap mt-12">
          <ColorStrip>
            {DRAWDOWNS.map((dd) => (
              <Link
                key={dd.id}
                href={`/colors#${dd.id}`}
                className="group border border-hair bg-paper p-2 transition-transform duration-[450ms] ease-out hover:-translate-y-1.5 hover:border-carbon/40 hover:shadow-[0_18px_40px_-22px_rgba(23,25,27,0.35)]"
              >
                <div
                  className="relative aspect-[4/3] w-full overflow-hidden"
                  style={{
                    background: `linear-gradient(168deg, ${dd.a}, ${dd.b})`,
                  }}
                  aria-hidden="true"
                >
                  <span className="kt-swatch-noise pointer-events-none" />
                  <span className="kt-swatch-sheen pointer-events-none" />
                  {dd.pearl ? (
                    <span className="kt-pearl-iris pointer-events-none" />
                  ) : null}
                </div>
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
          </ColorStrip>
          <div className="kt-strip-foot">
            <p className="kt-strip-hint font-mono">DRAG / SCROLL →</p>
            <span className="kt-strip-progress" aria-hidden="true">
              <span className="kt-strip-progress-bar" />
            </span>
          </div>
        </Reveal>
        <Reveal as="div" className="mt-10">
          <ArrowButton href="/colors">色見本を一枚ずつ見る</ArrowButton>
        </Reveal>
      </section>

      {/* ============ TWO SCENES ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="SEC. 04" label="TWO SCENES" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.twoscenes.heading"
          resolved={texts["home.twoscenes.heading"]}
          editMode={editMode}
        />
        <Reveal as="div" className="mt-12">
          <div className="grid gap-8 md:grid-cols-2 md:gap-14">
            {TWO_SCENES.map((scene) => (
              <div key={scene.range}>
                <span className="flex items-baseline gap-3">
                  <span className="text-[clamp(30px,4vw,44px)] font-bold leading-none tracking-[0.04em]">
                    {scene.range}
                  </span>
                  <small className="font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                    {scene.unit}
                  </small>
                </span>
                <SlotText
                  as="h3"
                  className="mt-4 text-lg font-bold tracking-wider"
                  slotKey={scene.slotKey}
                  resolved={texts[scene.slotKey]}
                  editMode={editMode}
                />
                <p className="mt-3 text-sm leading-7 text-carbon-mid">
                  {scene.body}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-10 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid">
            試作を仕上げたその手で、量産も仕上げる。クラウドファンディング達成の瞬間に「試作と同じ品質で数百個できます」と言える供給者は、ほとんどいません。
          </p>
        </Reveal>
      </section>

      {/* ============ 数字（能力） ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="SEC. 05" label="BY THE NUMBERS" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.stats.heading"
          resolved={texts["home.stats.heading"]}
          editMode={editMode}
        />
        <Reveal as="div" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STAT_GRID.map((stat) => (
            <div key={stat.label} className="border border-hair bg-paper p-6">
              <p className="text-[clamp(30px,4vw,44px)] font-bold leading-none tracking-[0.04em]">
                {stat.num !== null ? (
                  <StatCount target={stat.num} />
                ) : (
                  stat.display
                )}
                <span className="ml-1 text-base font-medium text-carbon-mid">
                  {stat.unit}
                </span>
              </p>
              <p className="mt-4 text-[13px] leading-6 text-carbon-mid">
                {stat.label}
                <span className="mt-1 block font-mono text-[9px] tracking-[0.16em] text-carbon-soft">
                  {stat.en}
                </span>
              </p>
              <p className="mt-3 border-t border-hair-soft pt-3 text-[12px] leading-5 text-carbon-soft">
                {stat.note}
              </p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ============ 素材対応 導線 ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="SEC. 06" label="MATERIALS" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.materials.heading"
          resolved={texts["home.materials.heading"]}
          editMode={editMode}
        />
        <p className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid">
          造形方式が違えば、積層痕の出方も塗料の乗り方も変わります。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む。PLA・PETG・ABS・ASA、各種レジン、ナイロンまで、素材別の勘所をまとめています。
        </p>
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/materials">素材別の対応を見る</ArrowButton>
        </Reveal>
      </section>

      {/* ============ NOTES PICK ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="SEC. 07" label="NOTES" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.notes.heading"
          resolved={texts["home.notes.heading"]}
          editMode={editMode}
        />
        <p className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid">
          工程と色の裏側を、読みものとして残しています。センチュリーの黒が水研ぎ3回である理由。ディーラーでも同色にならない赤の構造。専門性は、言葉にしてはじめて伝わります。
        </p>
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/notes">読みものを開く</ArrowButton>
        </Reveal>
      </section>

      {/* ============ GALLERY ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark no="GALLERY" label="IN THE WORKSHOP" />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.gallery.heading"
          resolved={texts["home.gallery.heading"]}
          editMode={editMode}
        />
        <p className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid">
          研ぎ、吹き、仕上げる。派手さのない手仕事の断片を。
        </p>
        <Reveal as="div" className="mt-12 grid gap-5 sm:grid-cols-3">
          {GALLERY_PHOTOS.map((photo) => (
            <figure
              key={photo.figNo}
              className="border border-hair bg-paper p-2"
            >
              <span className="block px-1 py-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                {photo.figNo}
              </span>
              <SlotImage
                slotKey={photo.slotKey}
                resolved={slots[photo.slotKey]}
                editMode={editMode}
              />
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
        </Reveal>
      </section>

      {/* ============ CTA ============ */}
      <section className="bg-carbon text-paper">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <SlotText
              as="p"
              className="text-[clamp(22px,3vw,34px)] font-bold leading-snug tracking-[0.04em]"
              slotKey="home.cta.heading"
              resolved={texts["home.cta.heading"]}
              editMode={editMode}
            />
            <SlotText
              as="p"
              className="mt-4 text-sm leading-7 text-paper/70"
              slotKey="home.cta.note"
              resolved={texts["home.cta.note"]}
              editMode={editMode}
            />
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
    </>
  );
}
