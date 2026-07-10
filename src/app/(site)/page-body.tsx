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
    noSlotKey: "home.craft.card.1.no",
    slotKey: "home.craft.card.1.title",
    title: "積層痕を消す研磨",
    bodySlotKey: "home.craft.card.1.body",
    body: "3Dプリント特有の縞を #800 まで面で研ぎ落とし、プラサフで埋め、#1200 で仕上げる。塗装の出来の大半は、この下地で決まります。",
  },
  {
    no: "CRAFT 02",
    noSlotKey: "home.craft.card.2.no",
    slotKey: "home.craft.card.2.title",
    title: "自動車グレードの艶",
    bodySlotKey: "home.craft.card.2.body",
    body: "2液ウレタンクリアは、吹きっぱなしで自動車外板と同等の艶が出ます。鏡面磨きに時間を使わないから、品質を揺らさずに数を仕上げられます。",
  },
  {
    no: "CRAFT 03",
    noSlotKey: "home.craft.card.3.no",
    slotKey: "home.craft.card.3.title",
    title: "3コートパールの意匠",
    bodySlotKey: "home.craft.card.3.body",
    body: "ベース＋パール＋クリアの3層構造。ホワイトパールやソウルレッドなど、経験がそのまま出る高難度の意匠塗装に対応します。",
  },
] as const;

const CRAFT_PHOTOS = [
  {
    slotKey: "home.craft.1",
    figNo: "FIG.01",
    capJa: "研ぎの手",
    capJaSlotKey: "home.craft.1.capja",
    capEn: "SANDING & PREP",
    capEnSlotKey: "home.craft.1.capen",
    credit: "Photo: mazinomron / Unsplash",
    creditSlotKey: "home.craft.1.credit",
  },
  {
    slotKey: "home.craft.2",
    figNo: "FIG.02",
    capJa: "吹き付けの手",
    capJaSlotKey: "home.craft.2.capja",
    capEn: "SPRAY APPLICATION",
    capEnSlotKey: "home.craft.2.capen",
    credit: "Photo: createasea / Unsplash",
    creditSlotKey: "home.craft.2.credit",
  },
  {
    slotKey: "home.craft.3",
    figNo: "FIG.03",
    capJa: "仕上がりの艶",
    capJaSlotKey: "home.craft.3.capja",
    capEn: "THE FINISH",
    capEnSlotKey: "home.craft.3.capen",
    credit: "Photo: avenir_visuals / Unsplash",
    creditSlotKey: "home.craft.3.credit",
  },
] as const;

const DRAWDOWNS = [
  {
    id: "c-090",
    code: "TOYOTA 090 / 3COAT",
    codeSlotKey: "home.colorlineup.swatch.1.code",
    name: "プレシャスホワイトパール",
    nameSlotKey: "home.colorlineup.swatch.1.name",
    note: "実績納品色",
    noteSlotKey: "home.colorlineup.swatch.1.note",
    a: "var(--dd-090-a)",
    b: "var(--dd-090-b)",
    pearl: true,
  },
  {
    id: "c-46v",
    code: "MAZDA 46V / 3COAT",
    codeSlotKey: "home.colorlineup.swatch.2.code",
    name: "ソウルレッドクリスタル",
    nameSlotKey: "home.colorlineup.swatch.2.name",
    note: "最高難度の技術証明",
    noteSlotKey: "home.colorlineup.swatch.2.note",
    a: "var(--dd-46v-a)",
    b: "var(--dd-46v-b)",
    pearl: false,
  },
  {
    id: "c-4y6",
    code: "TOYOTA 4Y6 / METALLIC",
    codeSlotKey: "home.colorlineup.swatch.3.code",
    name: "プレシャスブロンズ",
    nameSlotKey: "home.colorlineup.swatch.3.name",
    note: "現行クラウンの上品な茶",
    noteSlotKey: "home.colorlineup.swatch.3.note",
    a: "var(--dd-4y6-a)",
    b: "var(--dd-4y6-b)",
    pearl: false,
  },
  {
    id: "c-3t4",
    code: "TOYOTA 3T4 / 3COAT",
    codeSlotKey: "home.colorlineup.swatch.4.code",
    name: "ピンクサファイア",
    nameSlotKey: "home.colorlineup.swatch.4.name",
    note: "全国650台限定の伝説色",
    noteSlotKey: "home.colorlineup.swatch.4.note",
    a: "var(--dd-3t4-a)",
    b: "var(--dd-3t4-b)",
    pearl: true,
  },
  {
    id: "c-202",
    code: "TOYOTA 202 / SOLID",
    codeSlotKey: "home.colorlineup.swatch.5.code",
    name: "ブラック",
    nameSlotKey: "home.colorlineup.swatch.5.name",
    note: "最難関ソリッド黒",
    noteSlotKey: "home.colorlineup.swatch.5.note",
    a: "var(--dd-202-a)",
    b: "var(--dd-202-b)",
    pearl: false,
  },
  {
    id: "c-tv2",
    code: "NISSAN TV2 / 3COAT",
    codeSlotKey: "home.colorlineup.swatch.6.code",
    name: "ベイサイドブルー",
    nameSlotKey: "home.colorlineup.swatch.6.name",
    note: "R34 GT-Rの代名詞",
    noteSlotKey: "home.colorlineup.swatch.6.note",
    a: "var(--dd-tv2-a)",
    b: "var(--dd-tv2-b)",
    pearl: true,
  },
  {
    id: "c-am",
    code: "ASTON MARTIN AM9539",
    codeSlotKey: "home.colorlineup.swatch.7.code",
    name: "レーシンググリーン",
    nameSlotKey: "home.colorlineup.swatch.7.name",
    note: "英国の象徴色",
    noteSlotKey: "home.colorlineup.swatch.7.note",
    a: "var(--dd-am-a)",
    b: "var(--dd-am-b)",
    pearl: false,
  },
  {
    id: "c-46g",
    code: "MAZDA 46G / METALLIC",
    codeSlotKey: "home.colorlineup.swatch.8.code",
    name: "マシーングレー",
    nameSlotKey: "home.colorlineup.swatch.8.name",
    note: "匠塗のもう一枚の看板",
    noteSlotKey: "home.colorlineup.swatch.8.note",
    a: "var(--dd-46g-a)",
    b: "var(--dd-46g-b)",
    pearl: false,
  },
] as const;

const TWO_SCENES = [
  {
    range: "1–9",
    unit: "PIECES / 勝負試作",
    unitSlotKey: "home.twoscenes.scene.1.unit",
    slotKey: "home.twoscenes.scene.1.title",
    title: "プレミアムデザインモデルの一点仕上げ",
    bodySlotKey: "home.twoscenes.scene.1.body",
    body: "企業トップへの最終プレゼン、重要商談、展示会、クラウドファンディングの掲載写真。「絶対に外せない場面」で使う高品質試作を、量産品の顔に仕上げます。",
  },
  {
    range: "30–1,000",
    unit: "PIECES / ブリッジ生産",
    unitSlotKey: "home.twoscenes.scene.2.unit",
    slotKey: "home.twoscenes.scene.2.title",
    title: "金型を作らない少量生産の外観仕上げ",
    bodySlotKey: "home.twoscenes.scene.2.body",
    body: "クラウドファンディングのリターン品、D2Cの初回ロット、産業機器の筐体。金型なしの少量生産を「量産品の見た目」にする最終工程を担います。",
  },
] as const;

const STAT_GRID = [
  {
    num: 6,
    unit: "本",
    unitSlotKey: "home.stats.stat.1.unit",
    label: "バンパー同時塗装",
    labelSlotKey: "home.stats.stat.1.label",
    en: "SIMULTANEOUS BUMPERS",
    enSlotKey: "home.stats.stat.1.en",
    note: "この同時処理能力があるから、小物なら100個超を一度に。数量対応力は、そのまま価格に還元されます。",
    noteSlotKey: "home.stats.stat.1.note",
  },
  {
    num: null,
    display: "220–2000",
    unit: "",
    unitSlotKey: undefined,
    label: "段階研磨の番手",
    labelSlotKey: "home.stats.stat.2.label",
    en: "PROGRESSIVE GRIT",
    enSlotKey: "home.stats.stat.2.en",
    note: "粗い番手から徐々に上げる段階研磨。海外の現場で「射出成形品と見分けがつかない」とされる面の基準です。",
    noteSlotKey: "home.stats.stat.2.note",
  },
  {
    num: 8,
    unit: "色",
    unitSlotKey: "home.stats.stat.3.unit",
    label: "名車の象徴色ラインナップ",
    labelSlotKey: "home.stats.stat.3.label",
    en: "SIGNATURE COLORS",
    enSlotKey: "home.stats.stat.3.en",
    note: "うち5色が3コート・高難度系。ソウルレッドもベイサイドブルーも、塗れること自体が技術の証明です。",
    noteSlotKey: "home.stats.stat.3.note",
  },
  {
    num: null,
    display: "1–1,000",
    unit: "",
    unitSlotKey: undefined,
    label: "対応数量（点）",
    labelSlotKey: "home.stats.stat.4.label",
    en: "PIECES PER ORDER",
    enSlotKey: "home.stats.stat.4.en",
    note: "勝負試作の一点から、ブリッジ生産の千個まで。試作と量産を、同じ品質基準で仕上げます。",
    noteSlotKey: "home.stats.stat.4.note",
  },
  {
    num: 40,
    unit: "時間",
    unitSlotKey: "home.stats.stat.5.unit",
    label: "最高級の黒が下地にかける時間",
    labelSlotKey: "home.stats.stat.5.label",
    en: "CENTURY \"KAMUI\" BLACK",
    enSlotKey: "home.stats.stat.5.en",
    note: "名車センチュリーの黒は、塗装だけで約40時間・水研ぎ3回。その下地への敬意を、すべての仕事に持ち込みます。",
    noteSlotKey: "home.stats.stat.5.note",
  },
  {
    num: null,
    display: "5–7",
    unit: "日",
    unitSlotKey: "home.stats.stat.6.unit",
    label: "2液ウレタン完全硬化",
    labelSlotKey: "home.stats.stat.6.label",
    en: "FULL CURE",
    enSlotKey: "home.stats.stat.6.en",
    note: "主剤と硬化剤の化学反応で硬く艶やかに。硬化を待ち、検品してから発送します。急がば、回る。",
    noteSlotKey: "home.stats.stat.6.note",
  },
] as const;

const GALLERY_PHOTOS = [
  {
    slotKey: "home.gallery.1",
    figNo: "FIG.04",
    capJa: "手を動かす",
    capJaSlotKey: "home.gallery.1.capja",
    capEn: "HANDS AT WORK",
    capEnSlotKey: "home.gallery.1.capen",
    credit: "Photo: claritycoat / Unsplash",
    creditSlotKey: "home.gallery.1.credit",
  },
  {
    slotKey: "home.gallery.2",
    figNo: "FIG.05",
    capJa: "段取り",
    capJaSlotKey: "home.gallery.2.capja",
    capEn: "THE TOOLING",
    capEnSlotKey: "home.gallery.2.capen",
    credit: "Photo: volft / Unsplash",
    creditSlotKey: "home.gallery.2.credit",
  },
  {
    slotKey: "home.gallery.3",
    figNo: "FIG.06",
    capJa: "精度",
    capJaSlotKey: "home.gallery.3.capja",
    capEn: "THE MACHINERY",
    capEnSlotKey: "home.gallery.3.capen",
    credit: "Photo: kadircelep / Unsplash",
    creditSlotKey: "home.gallery.3.credit",
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
            <SlotText
              slotKey="home.hero.index"
              resolved={texts["home.hero.index"]}
              editMode={editMode}
            />
            <span className="h-px w-16 bg-hair" aria-hidden="true" />
            <SlotText
              as="span"
              className="hidden sm:inline"
              slotKey="home.hero.en"
              resolved={texts["home.hero.en"]}
              editMode={editMode}
            />
          </p>
          {/* [Wave5 W5-E] 文字リビール A/B 切替 (実装計画 §5): 既定は Variant A
              「立ち上がり」(kt-hero-title--split)。Variant B「塗られて現れる」を
              試すには、下の className を "kt-hero-title--paint" に差し替えるだけ
              (globals.css の page-home 区画 .kt-hero-title--paint を参照)。 */}
          <h1
            className="kt-hero-title--split mt-8 text-[clamp(34px,6.2vw,72px)] font-bold leading-[1.3] tracking-[0.04em]"
            aria-label="3Dプリントを、量産品と見分けがつかない外観に。"
          >
            <SlotText
              slotKey="home.hero.heading"
              resolved={texts["home.hero.heading"]}
              editMode={editMode}
              renderLines={(lines) => (
                <SplitChars>
                  {lines.map((line, i) => {
                    const markPhrase = "見分けがつかない";
                    const markIndex = i === 1 ? line.indexOf(markPhrase) : -1;
                    return (
                      <span key={i} className="kt-hero-line">
                        {markIndex !== -1 ? (
                          <span>
                            {line.slice(0, markIndex)}
                            <span className="kt-paint-mark">{markPhrase}</span>
                            {line.slice(markIndex + markPhrase.length)}
                          </span>
                        ) : (
                          <span>{line}</span>
                        )}
                      </span>
                    );
                  })}
                </SplitChars>
              )}
            />
          </h1>
          <SlotText
            as="p"
            className="mt-10 max-w-2xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
            slotKey="home.hero.lead"
            resolved={texts["home.hero.lead"]}
            editMode={editMode}
          />
          <div className="mt-10 flex flex-wrap gap-3">
            <ArrowButton href="/shop">
              <SlotText
                slotKey="home.hero.cta.1"
                resolved={texts["home.hero.cta.1"]}
                editMode={editMode}
              />
            </ArrowButton>
            <ArrowButton href="/colors">
              <SlotText
                slotKey="home.hero.cta.2"
                resolved={texts["home.hero.cta.2"]}
                editMode={editMode}
              />
            </ArrowButton>
            <ArrowButton href="/service">
              <SlotText
                slotKey="home.hero.cta.3"
                resolved={texts["home.hero.cta.3"]}
                editMode={editMode}
              />
            </ArrowButton>
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
              <SlotText
                slotKey="home.hero.photo.capja"
                resolved={texts["home.hero.photo.capja"]}
                editMode={editMode}
              />
              <SlotText
                as="span"
                className="ml-3 font-mono text-[10px] tracking-[0.18em] text-carbon-soft"
                slotKey="home.hero.photo.capen"
                resolved={texts["home.hero.photo.capen"]}
                editMode={editMode}
              />
            </span>
            <SlotText
              as="span"
              className="font-mono text-[10px] text-carbon-soft"
              slotKey="home.hero.photo.credit"
              resolved={texts["home.hero.photo.credit"]}
              editMode={editMode}
            />
          </figcaption>
        </Reveal>
      </section>

      {/* ============ STATEMENT ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="SEC. 01"
          label={texts["home.statement.label"].text}
          labelSlotKey="home.statement.label"
          editMode={editMode}
        />
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
          <SlotText
            slotKey="home.statement.body"
            resolved={texts["home.statement.body"]}
            editMode={editMode}
          />
        </Reveal>
        <Reveal as="div" className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/story">
            <SlotText
              slotKey="home.statement.cta"
              resolved={texts["home.statement.cta"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </section>

      {/* ============ CRAFT (サービス概要) ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="SEC. 02"
          label={texts["home.craft.label"].text}
          labelSlotKey="home.craft.label"
          editMode={editMode}
        />
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
                  <SlotText
                    slotKey={craft.noSlotKey}
                    resolved={texts[craft.noSlotKey]}
                    editMode={editMode}
                  />
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
                  <SlotText
                    slotKey={craft.bodySlotKey}
                    resolved={texts[craft.bodySlotKey]}
                    editMode={editMode}
                  />
                </p>
              </CardContent>
            </Card>
          ))}
        </Reveal>
        <Reveal as="div" className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/process">
            <SlotText
              slotKey="home.craft.cta.1"
              resolved={texts["home.craft.cta.1"]}
              editMode={editMode}
            />
          </ArrowButton>
          <ArrowButton href="/about">
            <SlotText
              slotKey="home.craft.cta.2"
              resolved={texts["home.craft.cta.2"]}
              editMode={editMode}
            />
          </ArrowButton>
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
                  <SlotText
                    slotKey={photo.capJaSlotKey}
                    resolved={texts[photo.capJaSlotKey]}
                    editMode={editMode}
                  />
                  <SlotText
                    as="span"
                    className="ml-2 font-mono text-[9px] tracking-[0.18em] text-carbon-soft"
                    slotKey={photo.capEnSlotKey}
                    resolved={texts[photo.capEnSlotKey]}
                    editMode={editMode}
                  />
                </span>
                <SlotText
                  as="span"
                  className="font-mono text-[9px] text-carbon-soft"
                  slotKey={photo.creditSlotKey}
                  resolved={texts[photo.creditSlotKey]}
                  editMode={editMode}
                />
              </figcaption>
            </figure>
          ))}
        </Reveal>
      </section>

      {/* ============ COLOR LINEUP (実績プレビュー) ============ */}
      <section className="mx-auto max-w-[1240px] px-5 pb-24 sm:px-8 sm:pb-32">
        <SectionMark
          no="SEC. 03"
          label={texts["home.colorlineup.label"].text}
          labelSlotKey="home.colorlineup.label"
          editMode={editMode}
        />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.colorlineup.heading"
          resolved={texts["home.colorlineup.heading"]}
          editMode={editMode}
        />
        <SlotText
          as="p"
          className="mt-6 max-w-2xl text-[15px] leading-[2.05] text-carbon-mid"
          slotKey="home.colorlineup.lead"
          resolved={texts["home.colorlineup.lead"]}
          editMode={editMode}
        />
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
                    <SlotText
                      slotKey={dd.codeSlotKey}
                      resolved={texts[dd.codeSlotKey]}
                      editMode={editMode}
                    />
                  </p>
                  <p className="mt-1 text-sm font-medium tracking-wider">
                    <SlotText
                      slotKey={dd.nameSlotKey}
                      resolved={texts[dd.nameSlotKey]}
                      editMode={editMode}
                    />
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-2 rounded-none border-hair font-mono text-[9px] tracking-[0.1em] text-carbon-mid"
                  >
                    <SlotText
                      slotKey={dd.noteSlotKey}
                      resolved={texts[dd.noteSlotKey]}
                      editMode={editMode}
                    />
                  </Badge>
                </div>
              </Link>
            ))}
          </ColorStrip>
          <div className="kt-strip-foot">
            <SlotText
              as="p"
              className="kt-strip-hint font-mono"
              slotKey="home.colorlineup.hint"
              resolved={texts["home.colorlineup.hint"]}
              editMode={editMode}
            />
            <span className="kt-strip-progress" aria-hidden="true">
              <span className="kt-strip-progress-bar" />
            </span>
          </div>
        </Reveal>
        <Reveal as="div" className="mt-10">
          <ArrowButton href="/colors">
            <SlotText
              slotKey="home.colorlineup.cta"
              resolved={texts["home.colorlineup.cta"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </section>

      {/* ============ TWO SCENES ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="SEC. 04"
          label={texts["home.twoscenes.label"].text}
          labelSlotKey="home.twoscenes.label"
          editMode={editMode}
        />
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
                  <SlotText
                    as="small"
                    className="font-mono text-[10px] tracking-[0.16em] text-carbon-soft"
                    slotKey={scene.unitSlotKey}
                    resolved={texts[scene.unitSlotKey]}
                    editMode={editMode}
                  />
                </span>
                <SlotText
                  as="h3"
                  className="mt-4 text-lg font-bold tracking-wider"
                  slotKey={scene.slotKey}
                  resolved={texts[scene.slotKey]}
                  editMode={editMode}
                />
                <p className="mt-3 text-sm leading-7 text-carbon-mid">
                  <SlotText
                    slotKey={scene.bodySlotKey}
                    resolved={texts[scene.bodySlotKey]}
                    editMode={editMode}
                  />
                </p>
              </div>
            ))}
          </div>
          <SlotText
            as="p"
            className="mt-10 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid"
            slotKey="home.twoscenes.body"
            resolved={texts["home.twoscenes.body"]}
            editMode={editMode}
          />
        </Reveal>
      </section>

      {/* ============ 数字（能力） ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="SEC. 05"
          label={texts["home.stats.label"].text}
          labelSlotKey="home.stats.label"
          editMode={editMode}
        />
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
                  {stat.unitSlotKey ? (
                    <SlotText
                      slotKey={stat.unitSlotKey}
                      resolved={texts[stat.unitSlotKey]}
                      editMode={editMode}
                    />
                  ) : (
                    stat.unit
                  )}
                </span>
              </p>
              <p className="mt-4 text-[13px] leading-6 text-carbon-mid">
                <SlotText
                  slotKey={stat.labelSlotKey}
                  resolved={texts[stat.labelSlotKey]}
                  editMode={editMode}
                />
                <SlotText
                  as="span"
                  className="mt-1 block font-mono text-[9px] tracking-[0.16em] text-carbon-soft"
                  slotKey={stat.enSlotKey}
                  resolved={texts[stat.enSlotKey]}
                  editMode={editMode}
                />
              </p>
              <p className="mt-3 border-t border-hair-soft pt-3 text-[12px] leading-5 text-carbon-soft">
                <SlotText
                  slotKey={stat.noteSlotKey}
                  resolved={texts[stat.noteSlotKey]}
                  editMode={editMode}
                />
              </p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ============ 素材対応 導線 ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="SEC. 06"
          label={texts["home.materials.label"].text}
          labelSlotKey="home.materials.label"
          editMode={editMode}
        />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.materials.heading"
          resolved={texts["home.materials.heading"]}
          editMode={editMode}
        />
        <SlotText
          as="p"
          className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid"
          slotKey="home.materials.body"
          resolved={texts["home.materials.body"]}
          editMode={editMode}
        />
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/materials">
            <SlotText
              slotKey="home.materials.cta"
              resolved={texts["home.materials.cta"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </section>

      {/* ============ NOTES PICK ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="SEC. 07"
          label={texts["home.notes.label"].text}
          labelSlotKey="home.notes.label"
          editMode={editMode}
        />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.notes.heading"
          resolved={texts["home.notes.heading"]}
          editMode={editMode}
        />
        <SlotText
          as="p"
          className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid"
          slotKey="home.notes.body"
          resolved={texts["home.notes.body"]}
          editMode={editMode}
        />
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/notes">
            <SlotText
              slotKey="home.notes.cta"
              resolved={texts["home.notes.cta"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </section>

      {/* ============ GALLERY ============ */}
      <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <SectionMark
          no="GALLERY"
          label={texts["home.gallery.label"].text}
          labelSlotKey="home.gallery.label"
          editMode={editMode}
        />
        <SlotText
          as="h2"
          className="mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
          slotKey="home.gallery.heading"
          resolved={texts["home.gallery.heading"]}
          editMode={editMode}
        />
        <SlotText
          as="p"
          className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid"
          slotKey="home.gallery.body"
          resolved={texts["home.gallery.body"]}
          editMode={editMode}
        />
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
                  <SlotText
                    slotKey={photo.capJaSlotKey}
                    resolved={texts[photo.capJaSlotKey]}
                    editMode={editMode}
                  />
                  <SlotText
                    as="span"
                    className="ml-2 font-mono text-[9px] tracking-[0.18em] text-carbon-soft"
                    slotKey={photo.capEnSlotKey}
                    resolved={texts[photo.capEnSlotKey]}
                    editMode={editMode}
                  />
                </span>
                <SlotText
                  as="span"
                  className="font-mono text-[9px] text-carbon-soft"
                  slotKey={photo.creditSlotKey}
                  resolved={texts[photo.creditSlotKey]}
                  editMode={editMode}
                />
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
            <SlotText
              slotKey="shared.cta.consult"
              resolved={texts["shared.cta.consult"]}
              editMode={editMode}
            />
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Button>
        </div>
      </section>
    </>
  );
}
