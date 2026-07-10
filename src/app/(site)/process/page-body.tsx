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
import { SlotRichText } from "@/components/site/slot-rich-text";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

/* 9工程の連番表記 ("01".."09")。SectionMark の no / PhotoFigure の figNo と同じ理由で
   構造的な連番のため slot化しない (非退行の対象外)。title/en/desc/why/固定ラベルは
   texts["process.step.N.*"] (N = 1-based index) から SlotText/SlotRichText で描画する。 */
const STEP_NOS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"] as const;

/* desc に研磨番手 (#800 / #1200) を文中インライン mono で含む工程 (STEP02, STEP06) のみ rich。
   他7工程の desc は装飾なしのため plain (SlotText) で描画する。 */
const RICH_DESC_STEP_NUMBERS = new Set([2, 6]);

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

/* 塗膜凡例のスウォッチ (色見本の見た目のみ)。name/en/desc は texts["process.legend.N.*"]
   (N = 1-based index) から SlotText で描画する。 */
const COAT_LEGEND_SWATCHES = [
  { background: "#CBCBC3" },
  { background: "#E6E6E1", border: "1px solid rgba(23,25,27,0.2)" },
  { background: "linear-gradient(90deg,#B21226,#8E0F1E)" },
  {
    background:
      "linear-gradient(90deg,rgba(255,255,255,0.7),rgba(216,216,208,0.7))",
    border: "1px solid rgba(23,25,27,0.15)",
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
        index={
          <SlotText
            slotKey="process.hero.index"
            resolved={texts["process.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="process.hero.en"
            resolved={texts["process.hero.en"]}
            editMode={editMode}
          />
        }
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
        <SectionMark
          no="SEC. 01"
          label={texts["process.sec.1.label"].text}
          labelSlotKey="process.sec.1.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="process.coating.heading"
            resolved={texts["process.coating.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="process.coating.lead"
            resolved={texts["process.coating.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 border border-hair bg-paper p-4 sm:p-8">
          <CoatDiagram />
          <div className="mt-6 grid gap-4 border-t border-hair-soft pt-6 sm:grid-cols-2 lg:grid-cols-4">
            {COAT_LEGEND_SWATCHES.map((swatch, i) => {
              const n = i + 1;
              return (
                <div key={n}>
                  <div className="h-4 w-full" style={swatch} />
                  <p className="mt-2 text-sm font-bold tracking-wider">
                    <SlotText
                      slotKey={`process.legend.${n}.name`}
                      resolved={texts[`process.legend.${n}.name`]}
                      editMode={editMode}
                    />
                    <span className="ml-2 font-mono text-[9px] font-normal tracking-[0.16em] text-carbon-soft">
                      <SlotText
                        slotKey={`process.legend.${n}.en`}
                        resolved={texts[`process.legend.${n}.en`]}
                        editMode={editMode}
                      />
                    </span>
                  </p>
                  <SlotText
                    slotKey={`process.legend.${n}.desc`}
                    resolved={texts[`process.legend.${n}.desc`]}
                    editMode={editMode}
                    as="p"
                    className="mt-1 text-[12px] leading-5 text-carbon-mid"
                  />
                </div>
              );
            })}
          </div>
        </Reveal>
      </Section>

      {/* ============ 9工程 ============ */}
      <Section>
        <SectionMark
          no="SEC. 02"
          label={texts["process.sec.2.label"].text}
          labelSlotKey="process.sec.2.label"
          editMode={editMode}
        />
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
            capJa={
              <SlotText
                slotKey="process.steps.1.capja"
                resolved={texts["process.steps.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="process.steps.1.capen"
                resolved={texts["process.steps.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="process.steps.1.credit"
                resolved={texts["process.steps.1.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.02b"
            slotKey="process.steps.2"
            resolved={slots["process.steps.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="process.steps.2.capja"
                resolved={texts["process.steps.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="process.steps.2.capen"
                resolved={texts["process.steps.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="process.steps.2.credit"
                resolved={texts["process.steps.2.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.02c"
            slotKey="process.steps.3"
            resolved={slots["process.steps.3"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="process.steps.3.capja"
                resolved={texts["process.steps.3.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="process.steps.3.capen"
                resolved={texts["process.steps.3.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="process.steps.3.credit"
                resolved={texts["process.steps.3.credit"]}
                editMode={editMode}
              />
            }
          />
        </Reveal>
        <Reveal as="div" className="mt-10 divide-y divide-hair border-y border-hair">
          {STEP_NOS.map((no, i) => {
            const n = i + 1;
            const isRichDesc = RICH_DESC_STEP_NUMBERS.has(n);
            return (
              <div
                key={no}
                className="kt-process-step grid gap-4 py-8 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-10"
              >
                <span className="kt-ps-no" aria-hidden="true">
                  {no}
                </span>
                <div>
                  <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                    <SlotText
                      slotKey={`process.step.${n}.label`}
                      resolved={texts[`process.step.${n}.label`]}
                      editMode={editMode}
                    />{" "}
                    {no}
                  </p>
                  <h3 className="mt-2 text-xl font-bold tracking-wider">
                    <SlotText
                      slotKey={`process.step.${n}.title`}
                      resolved={texts[`process.step.${n}.title`]}
                      editMode={editMode}
                    />
                  </h3>
                  <SlotText
                    slotKey={`process.step.${n}.en`}
                    resolved={texts[`process.step.${n}.en`]}
                    editMode={editMode}
                    as="p"
                    className="mt-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft"
                  />
                  {isRichDesc ? (
                    <SlotRichText
                      slotKey={`process.step.${n}.desc`}
                      resolved={texts[`process.step.${n}.desc`]}
                      editMode={editMode}
                      as="p"
                      className="mt-4 text-sm leading-7 text-carbon-mid"
                    />
                  ) : (
                    <SlotText
                      slotKey={`process.step.${n}.desc`}
                      resolved={texts[`process.step.${n}.desc`]}
                      editMode={editMode}
                      as="p"
                      className="mt-4 text-sm leading-7 text-carbon-mid"
                    />
                  )}
                  <SlotRichText
                    slotKey={`process.step.${n}.why`}
                    resolved={texts[`process.step.${n}.why`]}
                    editMode={editMode}
                    as="p"
                    className="mt-3 border-l-2 border-hair pl-4 text-sm leading-7 text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon"
                  />
                </div>
              </div>
            );
          })}
        </Reveal>
      </Section>

      {/* ============ 塗装環境 ============ */}
      <Section>
        <SectionMark
          no="SEC. 03"
          label={texts["process.sec.3.label"].text}
          labelSlotKey="process.sec.3.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="process.booth.heading"
            resolved={texts["process.booth.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="process.booth.lead"
            resolved={texts["process.booth.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="border border-hair bg-paper p-6">
              <p className="text-[clamp(30px,4vw,44px)] font-bold leading-none tracking-[0.04em]">
                <SlotText
                  slotKey={`process.booth.fact.${n}.num`}
                  resolved={texts[`process.booth.fact.${n}.num`]}
                  editMode={editMode}
                />
                <span className="ml-1 text-base font-medium text-carbon-mid">
                  {n === 3 ? null : (
                    <SlotText
                      slotKey={`process.booth.fact.${n}.unit`}
                      resolved={texts[`process.booth.fact.${n}.unit`]}
                      editMode={editMode}
                    />
                  )}
                </span>
              </p>
              <p className="mt-4 text-[13px] leading-6 text-carbon-mid">
                <SlotText
                  slotKey={`process.booth.fact.${n}.label`}
                  resolved={texts[`process.booth.fact.${n}.label`]}
                  editMode={editMode}
                />
                <span className="mt-1 block font-mono text-[9px] tracking-[0.16em] text-carbon-soft">
                  <SlotText
                    slotKey={`process.booth.fact.${n}.en`}
                    resolved={texts[`process.booth.fact.${n}.en`]}
                    editMode={editMode}
                  />
                </span>
              </p>
            </div>
          ))}
        </Reveal>
        <MapNote>
          <SlotText
            slotKey="process.booth.note"
            resolved={texts["process.booth.note"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ 関連導線 ============ */}
      <Section>
        <SectionMark
          no="SEC. 04"
          label={texts["process.sec.4.label"].text}
          labelSlotKey="process.sec.4.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="process.related.heading"
            resolved={texts["process.related.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="process.related.lead"
            resolved={texts["process.related.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/service">
            <SlotText
              slotKey="process.related.link.1"
              resolved={texts["process.related.link.1"]}
              editMode={editMode}
            />
          </ArrowButton>
          <ArrowButton href="/materials">
            <SlotText
              slotKey="process.related.link.2"
              resolved={texts["process.related.link.2"]}
              editMode={editMode}
            />
          </ArrowButton>
          <ArrowButton href="/colors">
            <SlotText
              slotKey="process.related.link.3"
              resolved={texts["process.related.link.3"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark
          no="GALLERY"
          label={texts["process.sec.5.label"].text}
          labelSlotKey="process.sec.5.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="process.gallery.heading"
            resolved={texts["process.gallery.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="process.gallery.lead"
            resolved={texts["process.gallery.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-3">
          <PhotoFigure
            figNo="FIG.03"
            slotKey="process.gallery.1"
            resolved={slots["process.gallery.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="process.gallery.1.capja"
                resolved={texts["process.gallery.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="process.gallery.1.capen"
                resolved={texts["process.gallery.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="process.gallery.1.credit"
                resolved={texts["process.gallery.1.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.04"
            slotKey="process.gallery.2"
            resolved={slots["process.gallery.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="process.gallery.2.capja"
                resolved={texts["process.gallery.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="process.gallery.2.capen"
                resolved={texts["process.gallery.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="process.gallery.2.credit"
                resolved={texts["process.gallery.2.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.05"
            slotKey="process.gallery.3"
            resolved={slots["process.gallery.3"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="process.gallery.3.capja"
                resolved={texts["process.gallery.3.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="process.gallery.3.capen"
                resolved={texts["process.gallery.3.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="process.gallery.3.credit"
                resolved={texts["process.gallery.3.credit"]}
                editMode={editMode}
              />
            }
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
        label={texts["shared.cta.consult"].text}
        labelSlotKey="shared.cta.consult"
        editMode={editMode}
      />
    </>
  );
}
