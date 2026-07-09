import {
  ArrowButton,
  CtaBand,
  MapNote,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

const STEPS = [
  {
    no: "01",
    title: "受け入れ・確認",
    en: "INTAKE & INSPECTION",
    desc: "届いた造形物を確認します。造形方式と素材、積層痕の状態、欠けや反りの有無を見ます。初めての素材なら、いきなり本番にはせず、テストピースで塗料の相性を確かめてから進めます。",
    why: (
      <>
        <strong>なぜ</strong> —
        素材ごとに塗料の乗り方が違うから。最初の見極めが、後の失敗を防ぎます。
      </>
    ),
  },
  {
    no: "02",
    title: "積層痕の研磨",
    en: "SANDING — #800",
    desc: (
      <>
        <span className="font-mono">#800</span>{" "}
        の紙やすりで、積層痕を面ごと研ぎ落とします。ここで縞の大半を物理的に消します。細いディテールや薄い壁は、力を入れすぎないよう手加減しながら。
      </>
    ),
    why: (
      <>
        <strong>なぜ</strong> — 積層痕は塗料では消えません。
        <strong>縞を消すのは、塗料ではなく研ぎ</strong>です。
      </>
    ),
  },
  {
    no: "03",
    title: "洗浄・脱脂",
    en: "CLEANING & DEGREASING",
    desc: "研磨後、水洗いで削りカスを流し、脱脂剤（シリコンオフ）で油分を除去、タッククロスで微粉を拭き取ります。光造形品は、未硬化レジンの洗浄と二次硬化もここまでに済ませます。",
    why: (
      <>
        <strong>なぜ</strong> —
        油分が残ると塗料が弾き（ハジキ）、密着不良や膨れの原因に。
        <strong>脱脂を怠ると、あとで必ず出ます。</strong>
      </>
    ),
  },
  {
    no: "04",
    title: "マスキング",
    en: "MASKING",
    desc: "塗料を乗せない部分、塗り分ける境界を養生します。曲面や細部に沿ってテープを貼る精度が、塗り際の美しさを決めます。可動部や勘合部があれば、噛み合わせを保つよう保護します。",
    why: (
      <>
        <strong>なぜ</strong> —
        マスキングの技術は、そのまま仕上がりの輪郭に出ます。地味ですが、差が出る工程です。
      </>
    ),
  },
  {
    no: "05",
    title: "プラサフ（下塗り・中塗り）",
    en: "PRIMER-SURFACER",
    desc: "プライマー（密着）とサーフェイサー（凹凸埋め）を兼ねたプラサフを吹きます。厚膜タイプで微細な段差を埋め、研磨で残った細かな傷を覆う。塗料が乗る土台を、ここでつくります。",
    why: (
      <>
        <strong>なぜ</strong> — サーフェイサーを省くと密着も発色も落ちます。
        <strong>塗装の出来の大半は、この下地で決まる。</strong>
      </>
    ),
  },
  {
    no: "06",
    title: "足付け・水研ぎ",
    en: "WET-SANDING — #1200",
    desc: (
      <>
        プラサフが乾いたら、<span className="font-mono">#1200</span>{" "}
        の耐水ペーパーで水研ぎします。摩擦熱を抑えながら表面を整え、あえて細かな傷（足）をつけて、上塗り塗料の食いつきを良くします。
      </>
    ),
    why: (
      <>
        <strong>なぜ</strong> —
        つるつるより、わずかに足がある方が塗料は密着します。平滑さと密着の、両立点です。
      </>
    ),
  },
  {
    no: "07",
    title: "ベースコート（色）",
    en: "BASE COAT",
    desc: "いよいよ色を吹きます。一度に厚く吹かず、薄く数回に分けて重ねる。塗る方向を層ごとに変え、乾燥間隔（フラッシュタイム）を取りながら発色を積み上げます。メタリック・パールは、この膜厚の管理が仕上がりを左右します。",
    why: (
      <>
        <strong>なぜ</strong> —
        厚塗りはタレ・ゆず肌・ディテールの潰れを招く。
        <strong>薄く、数回。</strong>これが均一な発色の条件です。
      </>
    ),
  },
  {
    no: "08",
    title: "クリアコート",
    en: "CLEAR COAT — 2K URETHANE",
    desc: "2液ウレタンクリアを吹きます。3コートパールの場合は、ベースとクリアの間にパール層を挟みます。主剤と硬化剤が反応し、硬く平滑な塗膜そのものを形成する——だから、吹きっぱなしで深い艶が出ます。",
    why: (
      <>
        <strong>なぜ</strong> — 2液ウレタンは磨かずとも光る。
        <strong>だから鏡面磨きをしません。</strong>
        その時間を、数量対応と価格の還元に回します。
      </>
    ),
  },
  {
    no: "09",
    title: "常温硬化・検品・発送",
    en: "CURING & SHIPPING",
    desc: "2液ウレタンを常温で5〜7日かけて完全硬化させます。硬化を確認したら、発送前の検品へ。タレ・ゆず肌・色ムラ・異物・密着・エッジ・硬化——項目を確認し、養生・梱包して発送します。",
    why: (
      <>
        <strong>なぜ</strong> — 硬化を待たずに送れば、輸送で傷みます。
        <strong>急がば、回る。</strong>
        完全硬化を待つのは、届いてからの品質のためです。
      </>
    ),
  },
] as const;

function CoatDiagram() {
  return (
    <svg
      viewBox="0 0 800 360"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="塗膜の層構造断面図：造形物の積層痕をプラサフで埋め、ベースコート、クリアを重ねる"
      className="h-auto w-full"
    >
      <defs>
        <linearGradient id="clearGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#EAEAE4" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D8D8D0" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B21226" />
          <stop offset="100%" stopColor="#8E0F1E" />
        </linearGradient>
      </defs>

      {/* 造形物（積層痕：上辺がギザギザ） */}
      <path
        d="M60,300 L740,300 L740,235
           L700,235 L690,248 L672,235 L654,248 L636,235 L618,248 L600,235 L582,248 L564,235
           L546,248 L528,235 L510,248 L492,235 L474,248 L456,235 L438,248 L420,235 L402,248
           L384,235 L366,248 L348,235 L330,248 L312,235 L294,248 L276,235 L258,248 L240,235
           L222,248 L204,235 L186,248 L168,235 L150,248 L132,235 L114,248 L96,235 L78,248 L60,235 Z"
        fill="#CBCBC3"
        stroke="#17191B"
        strokeWidth="1.2"
        strokeOpacity="0.35"
      />
      <text
        x="76"
        y="285"
        fontFamily="'IBM Plex Mono',monospace"
        fontSize="12"
        fill="#4B4F53"
        letterSpacing="1.5"
      >
        3D PRINT — 積層痕 (layer lines)
      </text>

      {/* プラサフ（ギザギザを埋めて平滑な上辺に） */}
      <path
        d="M60,235
           L78,222 L96,222 L114,222 L132,222 L150,222 L168,222 L186,222 L204,222 L222,222
           L240,222 L258,222 L276,222 L294,222 L312,222 L330,222 L348,222 L366,222 L384,222
           L402,222 L420,222 L438,222 L456,222 L474,222 L492,222 L510,222 L528,222 L546,222
           L564,222 L582,222 L600,222 L618,222 L636,222 L654,222 L672,222 L690,222 L700,222
           L740,222 L740,235
           L700,235 L690,248 L672,235 L654,248 L636,235 L618,248 L600,235 L582,248 L564,235
           L546,248 L528,235 L510,248 L492,235 L474,248 L456,235 L438,248 L420,235 L402,248
           L384,235 L366,248 L348,235 L330,248 L312,235 L294,248 L276,235 L258,248 L240,235
           L222,248 L204,235 L186,248 L168,235 L150,248 L132,235 L114,248 L96,235 L78,248 L60,235 Z"
        fill="#E6E6E1"
        stroke="#17191B"
        strokeWidth="1"
        strokeOpacity="0.25"
      />
      <rect
        x="60"
        y="200"
        width="680"
        height="22"
        fill="#E6E6E1"
        stroke="#17191B"
        strokeWidth="1"
        strokeOpacity="0.25"
      />
      <text
        x="76"
        y="215"
        fontFamily="'IBM Plex Mono',monospace"
        fontSize="12"
        fill="#4B4F53"
        letterSpacing="1.5"
      >
        PRIMER-SURFACER — プラサフ (埋める)
      </text>

      {/* ベースコート（色） */}
      <rect x="60" y="168" width="680" height="32" fill="url(#baseGrad)" />
      <text
        x="76"
        y="189"
        fontFamily="'IBM Plex Mono',monospace"
        fontSize="12"
        fill="#FFFFFF"
        letterSpacing="1.5"
        opacity="0.92"
      >
        BASE COAT — 発色層
      </text>

      {/* クリア（透明・光沢） */}
      <rect
        x="60"
        y="128"
        width="680"
        height="40"
        fill="url(#clearGrad)"
        stroke="#17191B"
        strokeWidth="1"
        strokeOpacity="0.18"
      />
      <text
        x="76"
        y="153"
        fontFamily="'IBM Plex Mono',monospace"
        fontSize="12"
        fill="#4B4F53"
        letterSpacing="1.5"
      >
        CLEAR (2K) — 保護・艶
      </text>
      {/* 光沢ハイライト */}
      <path
        d="M110,134 Q200,130 320,138 L300,146 Q200,140 130,144 Z"
        fill="#FFFFFF"
        opacity="0.6"
      />

      {/* 右側の厚み矢印と総膜厚ラベル */}
      <line x1="760" y1="128" x2="760" y2="300" stroke="#797E83" strokeWidth="1" />
      <line x1="755" y1="128" x2="765" y2="128" stroke="#797E83" strokeWidth="1" />
      <line x1="755" y1="300" x2="765" y2="300" stroke="#797E83" strokeWidth="1" />
      <text
        x="772"
        y="218"
        fontFamily="'IBM Plex Mono',monospace"
        fontSize="11"
        fill="#797E83"
        transform="rotate(90 772 218)"
        letterSpacing="1"
      >
        BUILD-UP
      </text>

      {/* 上部の光線（艶の表現） */}
      <line
        x1="150"
        y1="60"
        x2="230"
        y2="128"
        stroke="#A80F22"
        strokeWidth="1.2"
        strokeDasharray="4 4"
        opacity="0.5"
      />
      <line
        x1="230"
        y1="128"
        x2="330"
        y2="60"
        stroke="#A80F22"
        strokeWidth="1.2"
        strokeDasharray="4 4"
        opacity="0.5"
      />
      <text
        x="150"
        y="52"
        fontFamily="'IBM Plex Mono',monospace"
        fontSize="10"
        fill="#A80F22"
        letterSpacing="1"
      >
        LIGHT — 平滑な面が光を素直に返す
      </text>
    </svg>
  );
}

const COAT_LEGEND = [
  {
    swatch: { background: "#CBCBC3" },
    name: "造形物",
    en: "3D PRINT",
    desc: "出発点。表面には積層痕という横縞がある。",
  },
  {
    swatch: { background: "#E6E6E1", border: "1px solid rgba(23,25,27,0.2)" },
    name: "プラサフ",
    en: "PRIMER-SURFACER",
    desc: "積層痕を埋めて平滑化し、塗料の密着をつくる下地。",
  },
  {
    swatch: { background: "linear-gradient(90deg,#B21226,#8E0F1E)" },
    name: "ベースコート",
    en: "BASE COAT",
    desc: "色を決める発色層。メタリック・パールもこの層。",
  },
  {
    swatch: {
      background:
        "linear-gradient(90deg,rgba(255,255,255,0.7),rgba(216,216,208,0.7))",
      border: "1px solid rgba(23,25,27,0.15)",
    },
    name: "クリア",
    en: "CLEAR (2K)",
    desc: "2液ウレタン。色を守り、磨かずとも深い艶を出す。",
  },
] as const;

export function ProcessPageBody({
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
      <PageHead
        index="PROCESS — 塗りが仕上がるまで"
        en="9 STEPS"
        title={
          <SlotText
            slotKey="process.hero.heading"
            resolved={texts["process.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="process.hero.lead"
            resolved={texts["process.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      {/* ============ 塗膜の層構造 ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="COATING STRUCTURE" />
        <SecTitle>
          <SlotText
            slotKey="process.coating.heading"
            resolved={texts["process.coating.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          仕上がった塗面は一枚に見えますが、実際は役割の違う層の積み重ねです。下から順に、造形物・プラサフ・ベースコート・クリア。積層痕は、下の層で吸収して消します。
        </SecLead>
        <Reveal as="div" className="mt-10 border border-hair bg-paper p-4 sm:p-8">
          <CoatDiagram />
          <div className="mt-6 grid gap-4 border-t border-hair-soft pt-6 sm:grid-cols-2 lg:grid-cols-4">
            {COAT_LEGEND.map((item) => (
              <div key={item.name}>
                <div className="h-4 w-full" style={item.swatch} />
                <p className="mt-2 text-sm font-bold tracking-wider">
                  {item.name}
                  <span className="ml-2 font-mono text-[9px] font-normal tracking-[0.16em] text-carbon-soft">
                    {item.en}
                  </span>
                </p>
                <p className="mt-1 text-[12px] leading-5 text-carbon-mid">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* ============ 9工程 ============ */}
      <Section>
        <SectionMark no="SEC. 02" label="THE 9 STEPS" />
        <SecTitle>
          <SlotText
            slotKey="process.steps.heading"
            resolved={texts["process.steps.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-3">
          <PhotoFigure
            figNo="FIG.02a"
            slotKey="process.steps.1"
            resolved={slots["process.steps.1"]}
            editMode={editMode}
            capJa="下地をつくる"
            capEn="SANDING & PRIMER"
            credit="Photo: mazinomron / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.02b"
            slotKey="process.steps.2"
            resolved={slots["process.steps.2"]}
            editMode={editMode}
            capJa="色を吹く"
            capEn="BASE & CLEAR"
            credit="Photo: createasea / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.02c"
            slotKey="process.steps.3"
            resolved={slots["process.steps.3"]}
            editMode={editMode}
            capJa="仕上がり"
            capEn="THE FINISH"
            credit="Photo: cmreflections / Unsplash"
          />
        </Reveal>
        <Reveal as="div" className="mt-10 divide-y divide-hair border-y border-hair">
          {STEPS.map((step) => (
            <div
              key={step.no}
              className="kt-process-step grid gap-4 py-8 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-10"
            >
              <span className="kt-ps-no" aria-hidden="true">
                {step.no}
              </span>
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                  STEP {step.no}
                </p>
                <h3 className="mt-2 text-xl font-bold tracking-wider">
                  {step.title}
                </h3>
                <p className="mt-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  {step.en}
                </p>
                <p className="mt-4 text-sm leading-7 text-carbon-mid">
                  {step.desc}
                </p>
                <p className="mt-3 border-l-2 border-hair pl-4 text-sm leading-7 text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
                  {step.why}
                </p>
              </div>
            </div>
          ))}
        </Reveal>
      </Section>

      {/* ============ 塗装環境 ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="THE BOOTH" />
        <SecTitle>
          <SlotText
            slotKey="process.booth.heading"
            resolved={texts["process.booth.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          塗装の大敵は、宙を舞うホコリです。だから塗装は、専用のブースの中で行います。フィルターを通した清浄な空気を上から下へ流し、オーバーミストとともに床下へ排気する——異物混入をふせぐ、目に見えない設備です。
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              num: "5",
              unit: "ミクロン",
              label: "二次フィルターが捕集する埃の大きさ",
              en: "DUST CAPTURED",
            },
            {
              num: "90",
              unit: "%超",
              label: "一次フィルターの外気ダスト捕集率",
              en: "PRIMARY FILTER",
            },
            {
              num: "上→下",
              unit: "",
              label: "清浄空気の流れ（ダウンフロー）",
              en: "DOWNDRAFT AIRFLOW",
            },
          ].map((fact) => (
            <div key={fact.en} className="border border-hair bg-paper p-6">
              <p className="text-[clamp(30px,4vw,44px)] font-bold leading-none tracking-[0.04em]">
                {fact.num}
                <span className="ml-1 text-base font-medium text-carbon-mid">
                  {fact.unit}
                </span>
              </p>
              <p className="mt-4 text-[13px] leading-6 text-carbon-mid">
                {fact.label}
                <span className="mt-1 block font-mono text-[9px] tracking-[0.16em] text-carbon-soft">
                  {fact.en}
                </span>
              </p>
            </div>
          ))}
        </Reveal>
        <MapNote>
          ※
          一般的な自動車塗装ブースの仕組みです。それでも極小のゴミは付着し得るため、最終的な確認は検品工程（サービスページ参照）で行います。
        </MapNote>
      </Section>

      {/* ============ 関連導線 ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="RELATED" />
        <SecTitle>
          <SlotText
            slotKey="process.related.heading"
            resolved={texts["process.related.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          グレード別の料金や数量スライドはサービスページに、素材ごとの下地の作り分けは素材対応ページにまとめています。工程の思想を、色の実例で見たいときは色見本へ。
        </SecLead>
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/service">サービス・料金</ArrowButton>
          <ArrowButton href="/materials">素材対応</ArrowButton>
          <ArrowButton href="/colors">色見本</ArrowButton>
        </Reveal>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark no="GALLERY" label="BEHIND THE STEPS" />
        <SecTitle>
          <SlotText
            slotKey="process.gallery.heading"
            resolved={texts["process.gallery.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          地味な工程の積み重ねが、量産品と見分けがつかない顔をつくります。
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-3">
          <PhotoFigure
            figNo="FIG.03"
            slotKey="process.gallery.1"
            resolved={slots["process.gallery.1"]}
            editMode={editMode}
            capJa="設備"
            capEn="SPRAY EQUIPMENT"
            credit="Photo: kagan_4854 / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.04"
            slotKey="process.gallery.2"
            resolved={slots["process.gallery.2"]}
            editMode={editMode}
            capJa="精度"
            capEn="PRECISION"
            credit="Photo: kadircelep / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.05"
            slotKey="process.gallery.3"
            resolved={slots["process.gallery.3"]}
            editMode={editMode}
            capJa="質感"
            capEn="THE SURFACE"
            credit="Photo: apryan_cahyo / Unsplash"
          />
        </Reveal>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <SlotText
            slotKey="process.cta.heading"
            resolved={texts["process.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="process.cta.note"
            resolved={texts["process.cta.note"]}
            editMode={editMode}
          />
        }
        href="/contact"
        label="相談する"
      />
    </>
  );
}
