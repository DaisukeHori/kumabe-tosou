import type { Metadata } from "next";

import {
  CtaBand,
  MapNote,
  PageHead,
  PhotoFigure,
  Section,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";

export const metadata: Metadata = {
  title: {
    absolute: "色見本 | 隈部塗装 — 名車の象徴色で組んだ8枚の技術証明",
  },
  description:
    "隈部塗装のカラーラインナップ。トヨタ090ホワイトパール、マツダ46Vソウルレッド、日産TV2ベイサイドブルーほか、名車の象徴色8色。8色中5色が3コート・高難度系です。",
  openGraph: {
    title: "色見本 | 隈部塗装 — 名車の象徴色で組んだ8枚の技術証明",
    description:
      "トヨタ090ホワイトパール、マツダ46Vソウルレッドほか、名車の象徴色8色。8色中5色が3コート・高難度系。",
    images: ["/img/car-night.jpg"],
  },
};

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
  ddNo,
  ddName,
}: {
  a: string;
  b: string;
  pearl: boolean;
  ddNo: string;
  ddName: string;
}) {
  return (
    <div className="border border-hair bg-paper p-2">
      <div
        className="relative aspect-[4/3] w-full overflow-hidden"
        style={{ background: `linear-gradient(168deg, ${a}, ${b})` }}
        aria-hidden="true"
      >
        {/* 塗料のムラ・粒子 (legacy .dd-swatch::before) */}
        <span className="kt-swatch-noise pointer-events-none" />
        {/* 光の面 (legacy .dd-swatch::after) */}
        <span className="kt-swatch-sheen pointer-events-none" />
        {/* パール専用の虹彩 (legacy .dd-iris) */}
        {pearl ? (
          <span className="kt-pearl-iris pointer-events-none" />
        ) : null}
      </div>
      <div
        className="mt-1 h-2 w-full"
        style={{ background: `linear-gradient(90deg, ${a}, ${b})` }}
        aria-hidden="true"
      />
      <div className="flex items-baseline justify-between px-1 pb-1 pt-3">
        <span className="font-mono text-[9px] tracking-[0.16em] text-carbon-soft">
          {ddNo}
        </span>
        <span className="text-xs font-medium tracking-wider">{ddName}</span>
      </div>
    </div>
  );
}

function ColorEntry({ sw }: { sw: (typeof SWATCHES)[number] }) {
  return (
    <Reveal
      as="article"
      id={sw.id}
      className="grid scroll-mt-24 gap-8 border-t border-hair py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-14"
    >
      <div>
        <Drawdown
          a={sw.a}
          b={sw.b}
          pearl={sw.pearl}
          ddNo={sw.ddNo}
          ddName={sw.ddName}
        />
      </div>
      <div>
        <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
          {sw.index}
        </span>
        <h2 className="mt-4 text-[clamp(22px,2.8vw,32px)] font-bold leading-snug tracking-[0.04em]">
          {sw.title}
          <span className="mt-2 block font-mono text-[11px] font-normal tracking-[0.18em] text-carbon-soft">
            {sw.en}
          </span>
        </h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {sw.specs.map((spec) => (
            <span
              key={spec}
              className="border border-hair bg-paper px-3 py-1 text-[11px] tracking-wider text-carbon-mid"
            >
              {spec}
            </span>
          ))}
        </div>
        <p className="mt-6 text-[15px] leading-[2.05] text-carbon-mid">
          {sw.story}
        </p>
      </div>
    </Reveal>
  );
}

export default function ColorsPage() {
  return (
    <>
      <PageHead
        index="INDEX 07 — COLORS"
        en="8 SWATCHES / 5 ARE 3-COAT"
        title={
          <>
            名車の象徴色で組んだ、
            <br />
            8枚の技術証明。
          </>
        }
        lead="見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。実物の色見本パネル（対辺70mmの六角形・裏面カラーコード刻印）は、郵送でお貸し出しできるよう準備中です。"
      />

      <Section className="pb-0 pt-6 sm:pb-0 sm:pt-8">
        <PhotoFigure
          figNo="FIG.00 — COLOR"
          src="/img/car-night.jpg"
          alt="夜に艶めく車体"
          capJa="名車の色は、塗る人の経験が発色させる。"
          capEn="COLOR AS PROOF OF SKILL"
          credit="Photo: aaronburden / Unsplash"
          aspect="aspect-[21/9]"
          sizes="(max-width: 1240px) 100vw, 1240px"
        />
      </Section>

      {/* ============ 8色 ============ */}
      <Section>
        <ColorEntry sw={SWATCHES[0]} />
        <ColorEntry sw={SWATCHES[1]} />

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.01"
            src="/img/black-car.jpg"
            alt="深い艶のモノクロ車体"
            capJa="黒の深さは、研ぎで決まる。"
            capEn="DEPTH OF BLACK"
            credit="Photo: cmreflections / Unsplash"
            aspect="aspect-[21/9]"
            sizes="(max-width: 1240px) 100vw, 1240px"
          />
        </div>

        <ColorEntry sw={SWATCHES[2]} />
        <ColorEntry sw={SWATCHES[3]} />

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.02"
            src="/img/car-detail.jpg"
            alt="車体の艶のクローズアップ"
            capJa="光の映り込みが、平滑さを映す。"
            capEn="REFLECTION"
            credit="Photo: avenir_visuals / Unsplash"
            aspect="aspect-[21/9]"
            sizes="(max-width: 1240px) 100vw, 1240px"
          />
        </div>

        <ColorEntry sw={SWATCHES[4]} />
        <ColorEntry sw={SWATCHES[5]} />

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.03"
            src="/img/surface.jpg"
            alt="塗装面の質感"
            capJa="色は、面の上に成立する。"
            capEn="ON THE SURFACE"
            credit="Photo: apryan_cahyo / Unsplash"
            aspect="aspect-[21/9]"
            sizes="(max-width: 1240px) 100vw, 1240px"
          />
        </div>

        <ColorEntry sw={SWATCHES[6]} />
        <ColorEntry sw={SWATCHES[7]} />

        <MapNote>
          ※
          画面上の色はイメージです。日塗工番号・自動車カラーコードでの色番号指定に対応します。純正色のピタリ合わせ（調色）は対象外で、市販の調色済み補修塗料による「参考色」仕上げです。実在車の車体形状の複製は行いません。
        </MapNote>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <>
            この8色以外も、
            <br />
            色番号でご指定いただけます。
          </>
        }
        note="日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
