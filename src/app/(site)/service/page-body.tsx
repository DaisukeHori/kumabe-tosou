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

// PROCESS_ROWS / FLOW_CELLS / QC_ITEMS の文言は text-registry (slots/service.ts) に
// 一本化した (service.process.step.N.* / service.flow.cell.N.* / service.qc.item.N.*)。
// ここでは反復回数のみを保持する (単一ソース化、旧ハードコード文字列との重複drift防止)。
const PROCESS_STEP_COUNT = 5;
const FLOW_CELL_COUNT = 7;
const QC_ITEM_COUNT = 8;

// QUANTITY スライドの帯幅・強調フラグ (非テキストの表示ロジック) のみ保持。
// label/value のテキストは service.quantity.row.N.{label,value} を参照する。
const QUANTITY_ROWS = [
  { w: "100%", best: false },
  { w: "85%", best: false },
  { w: "75%", best: true },
] as const;

export function ServicePageBody({
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
            slotKey="service.hero.index"
            resolved={texts["service.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="service.hero.en"
            resolved={texts["service.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="service.hero.heading"
            resolved={texts["service.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="service.hero.lead"
            resolved={texts["service.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      {/* ============ 工程 ============ */}
      <Section>
        <SectionMark
          no="SEC. 01"
          label={texts["service.sec.1.label"].text}
          labelSlotKey="service.sec.1.label"
          editMode={editMode}
        />
        <Reveal as="div" className="mt-10 divide-y divide-hair border-y border-hair">
          {Array.from({ length: PROCESS_STEP_COUNT }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className="grid gap-3 py-6 sm:grid-cols-[140px_180px_minmax(0,1fr)] sm:gap-8"
            >
              <span className="font-mono text-2xl font-semibold tracking-[0.06em]">
                <SlotText
                  slotKey={`service.process.step.${n}.grit`}
                  resolved={texts[`service.process.step.${n}.grit`]}
                  editMode={editMode}
                />
                <small className="mt-1 block text-[10px] font-normal tracking-[0.18em] text-carbon-soft">
                  <SlotText
                    slotKey={`service.process.step.${n}.step`}
                    resolved={texts[`service.process.step.${n}.step`]}
                    editMode={editMode}
                  />
                </small>
              </span>
              <h3 className="text-lg font-bold tracking-wider">
                <SlotText
                  slotKey={`service.process.step.${n}.title`}
                  resolved={texts[`service.process.step.${n}.title`]}
                  editMode={editMode}
                />
              </h3>
              <SlotText
                slotKey={`service.process.step.${n}.body`}
                resolved={texts[`service.process.step.${n}.body`]}
                editMode={editMode}
                className="text-sm leading-7 text-carbon-mid"
              />
            </div>
          ))}
        </Reveal>
        <aside className="mt-10 border-l-2 border-soul bg-paper p-6">
          <SlotText
            as="span"
            className="font-mono text-[11px] tracking-[0.2em] text-soul"
            slotKey="service.process.aside.heading"
            resolved={texts["service.process.aside.heading"]}
            editMode={editMode}
          />
          <SlotText
            slotKey="service.process.aside.body"
            resolved={texts["service.process.aside.body"]}
            editMode={editMode}
            className="mt-3 text-sm leading-7 text-carbon-mid"
          />
        </aside>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.01"
            slotKey="service.process.1"
            resolved={slots["service.process.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="service.process.photo.1.capja"
                resolved={texts["service.process.photo.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="service.process.photo.1.capen"
                resolved={texts["service.process.photo.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="service.process.photo.1.credit"
                resolved={texts["service.process.photo.1.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.02"
            slotKey="service.process.2"
            resolved={slots["service.process.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="service.process.photo.2.capja"
                resolved={texts["service.process.photo.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="service.process.photo.2.capen"
                resolved={texts["service.process.photo.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="service.process.photo.2.credit"
                resolved={texts["service.process.photo.2.credit"]}
                editMode={editMode}
              />
            }
          />
        </Reveal>
        <Reveal as="div" className="mt-10">
          <ArrowButton href="/process">
            <SlotText
              slotKey="service.process.cta"
              resolved={texts["service.process.cta"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </Section>

      {/* ============ グレード ============ */}
      <Section>
        <SectionMark
          no="SEC. 02"
          label={texts["service.sec.2.label"].text}
          labelSlotKey="service.sec.2.label"
          editMode={editMode}
        />
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-3">
          <div className="border border-hair bg-paper p-6">
            <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
              <SlotText
                slotKey="service.grade.1.badge"
                resolved={texts["service.grade.1.badge"]}
                editMode={editMode}
              />
            </span>
            <h3 className="mt-3 text-xl font-bold tracking-wider">
              <SlotText
                slotKey="service.grade.1.title"
                resolved={texts["service.grade.1.title"]}
                editMode={editMode}
              />
            </h3>
            <SlotText
              slotKey="service.grade.1.body"
              resolved={texts["service.grade.1.body"]}
              editMode={editMode}
              className="mt-4 text-sm leading-7 text-carbon-mid"
            />
            <p className="mt-4 border-t border-hair-soft pt-4 text-[13px] leading-6 text-carbon-soft">
              <SlotText
                slotKey="service.grade.1.note"
                resolved={texts["service.grade.1.note"]}
                editMode={editMode}
              />
            </p>
          </div>
          <div className="border border-hair bg-paper p-6">
            <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
              <SlotText
                slotKey="service.grade.2.badge"
                resolved={texts["service.grade.2.badge"]}
                editMode={editMode}
              />
            </span>
            <h3 className="mt-3 text-xl font-bold tracking-wider">
              <SlotText
                slotKey="service.grade.2.title"
                resolved={texts["service.grade.2.title"]}
                editMode={editMode}
              />
            </h3>
            <SlotText
              slotKey="service.grade.2.body"
              resolved={texts["service.grade.2.body"]}
              editMode={editMode}
              className="mt-4 text-sm leading-7 text-carbon-mid"
            />
            <p className="mt-4 border-t border-hair-soft pt-4 text-[13px] leading-6 text-carbon-soft">
              <SlotText
                slotKey="service.grade.2.note"
                resolved={texts["service.grade.2.note"]}
                editMode={editMode}
              />
            </p>
          </div>
          <div className="border border-carbon bg-carbon p-6 text-paper">
            <span className="font-mono text-[10px] tracking-[0.2em] text-paper/60">
              <SlotText
                slotKey="service.grade.3.badge"
                resolved={texts["service.grade.3.badge"]}
                editMode={editMode}
              />
            </span>
            <h3 className="mt-3 text-xl font-bold tracking-wider">
              <SlotText
                slotKey="service.grade.3.title"
                resolved={texts["service.grade.3.title"]}
                editMode={editMode}
              />
            </h3>
            <SlotText
              slotKey="service.grade.3.body"
              resolved={texts["service.grade.3.body"]}
              editMode={editMode}
              className="mt-4 text-sm leading-7 text-paper/80"
            />
            <p className="mt-4 text-lg font-bold tracking-wider">
              <SlotText
                slotKey="service.grade.3.price"
                resolved={texts["service.grade.3.price"]}
                editMode={editMode}
              />
              <small className="mt-1 block text-[11px] font-normal text-paper/60">
                <SlotText
                  slotKey="service.grade.3.price.note"
                  resolved={texts["service.grade.3.price.note"]}
                  editMode={editMode}
                />
              </small>
            </p>
            <p className="mt-4 border-t border-paper/20 pt-4 text-[13px] leading-6 text-paper/70">
              <SlotText
                slotKey="service.grade.3.note"
                resolved={texts["service.grade.3.note"]}
                editMode={editMode}
              />
            </p>
          </div>
        </Reveal>
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="border border-hair bg-paper p-6">
            <h4 className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              <SlotText
                slotKey="service.quantity.heading"
                resolved={texts["service.quantity.heading"]}
                editMode={editMode}
              />
            </h4>
            <div className="mt-5 space-y-3">
              {QUANTITY_ROWS.map((row, i) => {
                const n = i + 1;
                return (
                  <div
                    key={n}
                    className="grid grid-cols-[5.5em_minmax(0,1fr)_4em] items-center gap-3"
                  >
                    <span className="text-[13px] tracking-wider">
                      <SlotText
                        slotKey={`service.quantity.row.${n}.label`}
                        resolved={texts[`service.quantity.row.${n}.label`]}
                        editMode={editMode}
                      />
                    </span>
                    <span className="kt-qty-track">
                      <span
                        className={`kt-qty-fill${row.best ? " kt-qty-fill--best" : ""}`}
                        style={{ "--w": row.w } as React.CSSProperties}
                      />
                    </span>
                    <span className="text-right font-mono text-[12px]">
                      <SlotText
                        slotKey={`service.quantity.row.${n}.value`}
                        resolved={texts[`service.quantity.row.${n}.value`]}
                        editMode={editMode}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <SlotText
              slotKey="service.quantity.footnote"
              resolved={texts["service.quantity.footnote"]}
              editMode={editMode}
              className="mt-5 text-xs leading-6 text-carbon-soft"
            />
          </div>
          <div className="border border-hair bg-paper p-6">
            <h4 className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              <SlotText
                slotKey="service.options.heading"
                resolved={texts["service.options.heading"]}
                editMode={editMode}
              />
            </h4>
            <div className="mt-5 divide-y divide-hair-soft text-sm">
              <div className="flex items-baseline justify-between py-3">
                <span>
                  <SlotText
                    slotKey="service.options.row.1.label"
                    resolved={texts["service.options.row.1.label"]}
                    editMode={editMode}
                  />
                </span>
                <span className="font-mono">
                  <SlotText
                    slotKey="service.options.row.1.value"
                    resolved={texts["service.options.row.1.value"]}
                    editMode={editMode}
                  />
                </span>
              </div>
              <div className="flex items-baseline justify-between py-3">
                <span>
                  <SlotText
                    slotKey="service.options.row.2.label"
                    resolved={texts["service.options.row.2.label"]}
                    editMode={editMode}
                  />
                </span>
                <span className="font-mono">
                  <SlotText
                    slotKey="service.options.row.2.value"
                    resolved={texts["service.options.row.2.value"]}
                    editMode={editMode}
                  />
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <span>
                  <SlotText
                    slotKey="service.options.row.3.label"
                    resolved={texts["service.options.row.3.label"]}
                    editMode={editMode}
                  />
                </span>
                <span className="font-mono">
                  <SlotText
                    slotKey="service.options.row.3.value"
                    resolved={texts["service.options.row.3.value"]}
                    editMode={editMode}
                  />
                </span>
              </div>
            </div>
            <SlotText
              slotKey="service.options.footnote"
              resolved={texts["service.options.footnote"]}
              editMode={editMode}
              className="mt-5 text-xs leading-6 text-carbon-soft"
            />
          </div>
        </Reveal>
        <Reveal as="div" className="mt-10">
          <ArrowButton href="/shop#sim">
            <SlotText
              slotKey="service.grades.cta"
              resolved={texts["service.grades.cta"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </Section>

      {/* ============ 依頼の流れ ============ */}
      <Section>
        <SectionMark
          no="SEC. 03"
          label={texts["service.sec.3.label"].text}
          labelSlotKey="service.sec.3.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="service.flow.heading"
            resolved={texts["service.flow.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="service.flow.lead"
            resolved={texts["service.flow.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: FLOW_CELL_COUNT }, (_, i) => i + 1).map((n) => (
            <div key={n} className="border border-hair bg-paper p-5">
              <span className="font-mono text-[11px] tracking-[0.14em] text-soul">
                {String(n).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-[15px] font-bold tracking-wider">
                <SlotText
                  slotKey={`service.flow.cell.${n}.title`}
                  resolved={texts[`service.flow.cell.${n}.title`]}
                  editMode={editMode}
                />
              </h3>
              <SlotText
                slotKey={`service.flow.cell.${n}.body`}
                resolved={texts[`service.flow.cell.${n}.body`]}
                editMode={editMode}
                className="mt-2 text-[13px] leading-6 text-carbon-mid"
              />
            </div>
          ))}
        </Reveal>
        <MapNote>
          <SlotText
            slotKey="service.flow.note"
            resolved={texts["service.flow.note"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ 正直な条件 ============ */}
      <Section>
        <SectionMark
          no="SEC. 04"
          label={texts["service.sec.4.label"].text}
          labelSlotKey="service.sec.4.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="service.terms.heading"
            resolved={texts["service.terms.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="border border-hair bg-paper p-6">
            <h3 className="text-lg font-bold tracking-wider">
              <SlotText
                slotKey="service.terms.can.heading"
                resolved={texts["service.terms.can.heading"]}
                editMode={editMode}
              />
            </h3>
            <ul className="mt-5 text-sm leading-7 text-carbon-mid">
              {[1, 2, 3, 4, 5].map((n) => (
                <li
                  key={n}
                  className="flex gap-3 border-b border-dashed border-hair-soft py-[11px] last:border-b-0"
                >
                  <span aria-hidden="true" className="font-mono text-[12px] text-carbon">
                    +
                  </span>
                  <SlotText
                    slotKey={`service.terms.can.${n}`}
                    resolved={texts[`service.terms.can.${n}`]}
                    editMode={editMode}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-hair bg-paper p-6">
            <h3 className="text-lg font-bold tracking-wider">
              <SlotText
                slotKey="service.terms.cannot.heading"
                resolved={texts["service.terms.cannot.heading"]}
                editMode={editMode}
              />
            </h3>
            <ul className="mt-5 text-sm leading-7 text-carbon-mid">
              {[1, 2, 3, 4, 5].map((n) => (
                <li
                  key={n}
                  className="flex gap-3 border-b border-dashed border-hair-soft py-[11px] last:border-b-0"
                >
                  <span aria-hidden="true" className="font-mono text-[12px] text-soul">
                    ※
                  </span>
                  <SlotText
                    slotKey={`service.terms.cannot.${n}`}
                    resolved={texts[`service.terms.cannot.${n}`]}
                    editMode={editMode}
                  />
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </Section>

      {/* ============ 品質管理 ============ */}
      <Section>
        <SectionMark
          no="SEC. 05"
          label={texts["service.sec.5.label"].text}
          labelSlotKey="service.sec.5.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="service.qc.heading"
            resolved={texts["service.qc.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="service.qc.lead"
            resolved={texts["service.qc.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: QC_ITEM_COUNT }, (_, i) => i + 1).map((n) => (
            <div key={n} className="border border-hair bg-paper p-5">
              <span aria-hidden="true" className="kt-qc-check" />
              <h4 className="mt-3 text-[15px] font-bold tracking-wider">
                <SlotText
                  slotKey={`service.qc.item.${n}.title`}
                  resolved={texts[`service.qc.item.${n}.title`]}
                  editMode={editMode}
                />
                <span className="ml-2 font-mono text-[9px] font-normal tracking-[0.16em] text-carbon-soft">
                  <SlotText
                    slotKey={`service.qc.item.${n}.en`}
                    resolved={texts[`service.qc.item.${n}.en`]}
                    editMode={editMode}
                  />
                </span>
              </h4>
              <SlotText
                slotKey={`service.qc.item.${n}.body`}
                resolved={texts[`service.qc.item.${n}.body`]}
                editMode={editMode}
                className="mt-2 text-[13px] leading-6 text-carbon-mid"
              />
            </div>
          ))}
        </Reveal>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark
          no="GALLERY"
          label={texts["service.gallery.label"].text}
          labelSlotKey="service.gallery.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="service.gallery.heading"
            resolved={texts["service.gallery.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="service.gallery.lead"
            resolved={texts["service.gallery.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.03"
            slotKey="service.gallery.1"
            resolved={slots["service.gallery.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="service.gallery.photo.1.capja"
                resolved={texts["service.gallery.photo.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="service.gallery.photo.1.capen"
                resolved={texts["service.gallery.photo.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="service.gallery.photo.1.credit"
                resolved={texts["service.gallery.photo.1.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.04"
            slotKey="service.gallery.2"
            resolved={slots["service.gallery.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="service.gallery.photo.2.capja"
                resolved={texts["service.gallery.photo.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="service.gallery.photo.2.capen"
                resolved={texts["service.gallery.photo.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="service.gallery.photo.2.credit"
                resolved={texts["service.gallery.photo.2.credit"]}
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
            slotKey="service.cta.heading"
            resolved={texts["service.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="service.cta.note"
            resolved={texts["service.cta.note"]}
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
