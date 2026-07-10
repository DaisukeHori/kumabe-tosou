import type { CSSProperties } from "react";

import {
  CtaBand,
  MapNote,
  PageHead,
  PhotoFigure,
  Section,
} from "@/components/site/page-blocks";
import { ColorsTilt } from "@/components/motion/colors-tilt";
import { InkRecorder } from "@/components/motion/ink-recorder";
import { Reveal } from "@/components/site/reveal";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

const SWATCHES = [
  {
    id: "c-090",
    ddNo: "DRAWDOWN 01 / 8",
    ddName: "プレシャスホワイトパール",
    index: "SWATCH 01",
    title: "プレシャスホワイトパール",
    en: "TOYOTA 090 — PRECIOUS WHITE PEARL",
    specs: ["3コートパール", "ベース＋パール＋クリア", "実績納品色"],
    story:
      "現に法人のプロダクト試作へ納品している、この工房の実績色であり原点。白の奥でパールが回る上品な光は、単なる「白塗装」とはまったく別のものです。3コートの技術がそのまま出る、看板の一枚。",
    a: "var(--dd-090-a)",
    b: "var(--dd-090-b)",
    pearl: true,
  },
  {
    id: "c-46v",
    ddNo: "DRAWDOWN 02 / 8",
    ddName: "ソウルレッドクリスタル",
    index: "SWATCH 02",
    title: "ソウルレッドクリスタルメタリック",
    en: "MAZDA 46V — SOUL RED CRYSTAL",
    specs: ["3コート", "高難度", "匠塗"],
    story:
      "「ディーラーですら同色にならない」と業界で言われる高難度色。光を吸収するフレークを含む3層構造で、塗り重ねの経験がそのまま発色に出ます。これが塗れること自体が、技術の証明になる一枚です。",
    a: "var(--dd-46v-a)",
    b: "var(--dd-46v-b)",
    pearl: false,
  },
  {
    id: "c-4y6",
    ddNo: "DRAWDOWN 03 / 8",
    ddName: "プレシャスブロンズ",
    index: "SWATCH 03",
    title: "プレシャスブロンズ",
    en: "TOYOTA 4Y6 — PRECIOUS BRONZE",
    specs: ["メタリック"],
    story:
      "現行クラウンの上品なブラウン。落ち着いた製品筐体や、大人のプロダクトに映えるメタリックです。派手さではなく品位で選ばれる色は、仕上げの均一さがすべてを決めます。",
    a: "var(--dd-4y6-a)",
    b: "var(--dd-4y6-b)",
    pearl: false,
  },
  {
    id: "c-3t4",
    ddNo: "DRAWDOWN 04 / 8",
    ddName: "ピンクサファイア",
    index: "SWATCH 04",
    title: "ピンクサファイア",
    en: "TOYOTA 3T4 — PINK SAPPHIRE",
    specs: ["3コート", "限定色"],
    story:
      "全国650台限定「ReBORN PINK」のクラウンに採用された伝説色、通称モモタロウ。話題性と可愛げを両立し、プロダクトのカラーバリエーション展開でも強い引きを持つ一枚です。",
    a: "var(--dd-3t4-a)",
    b: "var(--dd-3t4-b)",
    pearl: true,
  },
  {
    id: "c-202",
    ddNo: "DRAWDOWN 05 / 8",
    ddName: "ブラック",
    index: "SWATCH 05",
    title: "ブラック",
    en: "TOYOTA 202 — BLACK",
    specs: ["ソリッド＋クリア", "最難関カラー"],
    story:
      "「最難関カラー」と呼ばれるソリッドの黒。メタリックやパールのような粒子の助けがなく、下地の平滑さと塗り肌がそのまま出ます。ごまかしが効かないからこそ、腕の見せ所。当工房が下地に時間を割く理由を、いちばん雄弁に語る色です。",
    a: "var(--dd-202-a)",
    b: "var(--dd-202-b)",
    pearl: false,
  },
  {
    id: "c-tv2",
    ddNo: "DRAWDOWN 06 / 8",
    ddName: "ベイサイドブルー",
    index: "SWATCH 06",
    title: "ベイサイドブルー",
    en: "NISSAN TV2 — BAYSIDE BLUE",
    specs: ["3コート", "R34 GT-R"],
    story:
      "R34 GT-Rの代名詞色。この色の補修では「経験のある塗装工場を探すことが重要」と言われ続けてきた、3コート構造のブルーです。だからこそ、看板色の一枚にしています。",
    a: "var(--dd-tv2-a)",
    b: "var(--dd-tv2-b)",
    pearl: true,
  },
  {
    id: "c-am",
    ddNo: "DRAWDOWN 07 / 8",
    ddName: "レーシンググリーン",
    index: "SWATCH 07",
    title: "レーシンググリーン",
    en: "ASTON MARTIN AM9539 — RACING GREEN",
    specs: ["メタリック", "英国の象徴色"],
    story:
      "英国レーシングの伝統を背負う深緑。市販車とF1マシンが同じ塗料配合という、由緒ある色です。深みのある濃色メタリックは、光の当たり方で表情が変わる——その変化を均一に出すのが職人の仕事です。",
    a: "var(--dd-am-a)",
    b: "var(--dd-am-b)",
    pearl: false,
  },
  {
    id: "c-46g",
    ddNo: "DRAWDOWN 08 / 8",
    ddName: "マシーングレー",
    index: "SWATCH 08",
    title: "マシーングレープレミアムメタリック",
    en: "MAZDA 46G — MACHINE GRAY",
    specs: ["高難度メタリック", "匠塗"],
    story:
      "46Vソウルレッドと並ぶ「匠塗」の2枚看板。金属の塊から削り出したような精緻な質感が特徴です。マツダの匠塗を両方仕上げられる工房——このラインナップが語る、技術ストーリーの完成形です。",
    a: "var(--dd-46g-a)",
    b: "var(--dd-46g-b)",
    pearl: false,
  },
] as const;

function Drawdown({
  a,
  b,
  pearl,
  n,
  texts,
  editMode,
}: {
  a: string;
  b: string;
  pearl: boolean;
  n: number;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  const ddNoKey = `colors.swatch.${n}.dd.no`;
  const ddNameKey = `colors.swatch.${n}.dd.name`;
  return (
    <div
      className="kt-dd kt-swatch-host border border-hair bg-paper p-2"
      data-tilt=""
      data-cursor="view"
      // --dd-a: グレアの色温度連動 (EXTRA-3) が var(--dd-a) を子孫の
      // .kt-dd-glare から参照するためのカスタムプロパティ (継承で伝播)。
      style={{ "--dd-a": a } as CSSProperties}
    >
      <div
        className="kt-sd-swatch relative aspect-[4/3] w-full overflow-hidden"
        style={{ background: `linear-gradient(168deg, ${a}, ${b})` }}
        aria-hidden="true"
      >
        {/* 光沢追従グレア (legacy css:1304-1308 の radial-gradient 層を別レイヤ化) */}
        <span className="kt-dd-glare pointer-events-none" data-tilt-glare="" />
        {/* 塗料のムラ・粒子 (legacy .dd-swatch::before) */}
        <span className="kt-swatch-noise pointer-events-none" />
        {/* パール専用の虹彩 (legacy .dd-iris) */}
        {pearl ? <span className="kt-pearl-iris pointer-events-none" /> : null}
        {/* 光の面 (legacy .dd-swatch::after)。旧サイトの描画順 (::after は子要素より上、
            css:305-335) に合わせ iris より後に置く */}
        <span className="kt-swatch-sheen pointer-events-none" />
      </div>
      {/* 刷毛の終端 — 塗りの不規則な下端 (legacy .dd-edge css:337-341) */}
      <div
        className="kt-dd-edge w-full"
        style={{ background: `linear-gradient(168deg, ${a}, ${b})` }}
        aria-hidden="true"
      />
      <div className="flex items-baseline justify-between px-1 pb-1 pt-3">
        <span className="font-mono text-[9px] tracking-[0.16em] text-carbon-soft">
          <SlotText
            slotKey={ddNoKey}
            resolved={texts[ddNoKey]}
            editMode={editMode}
          />
        </span>
        <span className="text-xs font-medium tracking-wider">
          <SlotText
            slotKey={ddNameKey}
            resolved={texts[ddNameKey]}
            editMode={editMode}
          />
        </span>
      </div>
    </div>
  );
}

function ColorEntry({
  sw,
  n,
  texts,
  editMode,
}: {
  sw: (typeof SWATCHES)[number];
  n: number;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  // 透かし番号の色見本連動 (EXTRA①、統合計画 §3-5-5)。--wm を stroke の
  // color-mix ソースにする。DD-090 (プレシャスホワイトパール) は背景
  // (--paper #fbfbf8 / --primer #e6e6e1) とほぼ同色で連動させるとストロークが
  // 視認不能になるため、このエントリのみ既定グレー (--carbon) にフォールバックする
  // (受入: 淡色 DD-090 の視認性チェック)。
  const wm = sw.id === "c-090" ? "#17191b" : sw.a;
  const indexKey = `colors.swatch.${n}.index`;
  const titleKey = `colors.swatch.${n}.title`;
  const enKey = `colors.swatch.${n}.en`;
  const storyKey = `colors.swatch.${n}.story`;
  return (
    <Reveal
      as="article"
      id={sw.id}
      className="kt-color-entry relative grid scroll-mt-24 gap-8 border-t border-hair py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-14"
      style={{ "--wm": wm } as CSSProperties}
      // [Wave5 W5-A] インク引き継ぎ (ink-recorder.tsx) が IntersectionObserver で
      // 追跡するための data 属性。値は Drawdown の背景と同じ CSS var 参照。
      data-ink={sw.a}
    >
      <div>
        <Drawdown
          a={sw.a}
          b={sw.b}
          pearl={sw.pearl}
          n={n}
          texts={texts}
          editMode={editMode}
        />
      </div>
      <div>
        <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
          <SlotText
            slotKey={indexKey}
            resolved={texts[indexKey]}
            editMode={editMode}
          />
        </span>
        <h2 className="mt-4 text-[clamp(22px,2.8vw,32px)] font-bold leading-snug tracking-[0.04em]">
          <SlotText
            slotKey={titleKey}
            resolved={texts[titleKey]}
            editMode={editMode}
          />
          <span className="mt-2 block font-mono text-[11px] font-normal tracking-[0.18em] text-carbon-soft">
            <SlotText
              slotKey={enKey}
              resolved={texts[enKey]}
              editMode={editMode}
            />
          </span>
        </h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {sw.specs.map((_spec, i) => {
            const specKey = `colors.swatch.${n}.spec.${i + 1}`;
            return (
              <span
                key={specKey}
                className="border border-hair bg-paper px-3 py-1 text-[11px] tracking-wider text-carbon-mid"
              >
                <SlotText
                  slotKey={specKey}
                  resolved={texts[specKey]}
                  editMode={editMode}
                />
              </span>
            );
          })}
        </div>
        <p className="mt-6 text-[15px] leading-[2.05] text-carbon-mid">
          <SlotText
            slotKey={storyKey}
            resolved={texts[storyKey]}
            editMode={editMode}
          />
        </p>
      </div>
    </Reveal>
  );
}

export function ColorsPageBody({
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
      {/* チルト+光沢追従 (fine ポインタのみ)。/edit iframe ではホットスポット
          座標計測のノイズになるため editMode では載せない */}
      {editMode ? null : <ColorsTilt />}
      {/* [Wave5 W5-A] インク引き継ぎの記録役。colors-tilt.tsx とは別コンポーネント
          (実装計画 §5 W5-A)。同じ理由で editMode では載せない。 */}
      {editMode ? null : <InkRecorder />}
      <PageHead
        index={
          <SlotText
            slotKey="colors.hero.index"
            resolved={texts["colors.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="colors.hero.en"
            resolved={texts["colors.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="colors.hero.heading"
            resolved={texts["colors.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="colors.hero.lead"
            resolved={texts["colors.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section className="pb-0 pt-6 sm:pb-0 sm:pt-8">
        <PhotoFigure
          figNo="FIG.00 — COLOR"
          slotKey="colors.hero"
          resolved={slots["colors.hero"]}
          editMode={editMode}
          capJa={
            <SlotText
              slotKey="colors.hero.photo.capja"
              resolved={texts["colors.hero.photo.capja"]}
              editMode={editMode}
            />
          }
          capEn={
            <SlotText
              slotKey="colors.hero.photo.capen"
              resolved={texts["colors.hero.photo.capen"]}
              editMode={editMode}
            />
          }
          credit={
            <SlotText
              slotKey="colors.hero.photo.credit"
              resolved={texts["colors.hero.photo.credit"]}
              editMode={editMode}
            />
          }
        />
      </Section>

      {/* ============ 8色 ============ */}
      <Section className="kt-color-entries">
        <ColorEntry sw={SWATCHES[0]} n={1} texts={texts} editMode={editMode} />
        <ColorEntry sw={SWATCHES[1]} n={2} texts={texts} editMode={editMode} />

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.01"
            slotKey="colors.band.1"
            resolved={slots["colors.band.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="colors.band.1.capja"
                resolved={texts["colors.band.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="colors.band.1.capen"
                resolved={texts["colors.band.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="colors.band.1.credit"
                resolved={texts["colors.band.1.credit"]}
                editMode={editMode}
              />
            }
          />
        </div>

        <ColorEntry sw={SWATCHES[2]} n={3} texts={texts} editMode={editMode} />
        <ColorEntry sw={SWATCHES[3]} n={4} texts={texts} editMode={editMode} />

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.02"
            slotKey="colors.band.2"
            resolved={slots["colors.band.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="colors.band.2.capja"
                resolved={texts["colors.band.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="colors.band.2.capen"
                resolved={texts["colors.band.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="colors.band.2.credit"
                resolved={texts["colors.band.2.credit"]}
                editMode={editMode}
              />
            }
          />
        </div>

        <ColorEntry sw={SWATCHES[4]} n={5} texts={texts} editMode={editMode} />
        <ColorEntry sw={SWATCHES[5]} n={6} texts={texts} editMode={editMode} />

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.03"
            slotKey="colors.band.3"
            resolved={slots["colors.band.3"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="colors.band.3.capja"
                resolved={texts["colors.band.3.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="colors.band.3.capen"
                resolved={texts["colors.band.3.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="colors.band.3.credit"
                resolved={texts["colors.band.3.credit"]}
                editMode={editMode}
              />
            }
          />
        </div>

        <ColorEntry sw={SWATCHES[6]} n={7} texts={texts} editMode={editMode} />
        <ColorEntry sw={SWATCHES[7]} n={8} texts={texts} editMode={editMode} />

        <MapNote>
          <SlotText
            slotKey="colors.disclaimer"
            resolved={texts["colors.disclaimer"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <SlotText
            slotKey="colors.cta.heading"
            resolved={texts["colors.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="colors.cta.note"
            resolved={texts["colors.cta.note"]}
            editMode={editMode}
          />
        }
        href="/contact"
        label={texts["shared.cta.consult"].text}
        labelSlotKey="shared.cta.consult"
        editMode={editMode}
      />
    </>
  );
}
