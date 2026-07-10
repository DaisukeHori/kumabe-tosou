import { Badge } from "@/components/ui/badge";
import {
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

// v2 Wave 1: tag/title/en/desc/diff の実テキストは TEXT_REGISTRY (materials.method.N.*) から
// 引くため、ここでは 1〜3 の連番のみ保持する。
const METHOD_IDS = [1, 2, 3] as const;

// v2 Wave 1: name/sub/method/point/weather の実テキストは TEXT_REGISTRY
// (materials.matrix.row.N.*) から引くため、ここでは行ごとの構造フラグ (sub の有無・UV安定
// バッジの色) のみ保持する。
const MATERIALS: {
  hasSub: boolean;
  uv: boolean;
}[] = [
  { hasSub: true, uv: false }, // 1: PLA
  { hasSub: false, uv: true }, // 2: PETG
  { hasSub: false, uv: false }, // 3: ABS
  { hasSub: false, uv: true }, // 4: ASA
  { hasSub: true, uv: false }, // 5: 標準レジン
  { hasSub: true, uv: false }, // 6: タフレジン
  { hasSub: false, uv: false }, // 7: クリアレジン
  { hasSub: true, uv: true }, // 8: ナイロン
];

// v2 Wave 1: no/title/body の実テキストは TEXT_REGISTRY (materials.cause.N.*) から引くため、
// ここでは 1〜3 の連番のみ保持する。
const CAUSE_IDS = [1, 2, 3] as const;

export function MaterialsPageBody({
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
            slotKey="materials.hero.index"
            resolved={texts["materials.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="materials.hero.en"
            resolved={texts["materials.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="materials.hero.heading"
            resolved={texts["materials.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="materials.hero.lead"
            resolved={texts["materials.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      {/* ============ 3方式 ============ */}
      <Section>
        <SectionMark
          no="SEC. 01"
          label={texts["materials.methods.sec.label"].text}
          labelSlotKey="materials.methods.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="materials.methods.heading"
            resolved={texts["materials.methods.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-3">
          {METHOD_IDS.map((id) => (
            <div key={id} className="border border-hair bg-paper p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                <SlotText
                  slotKey={`materials.method.${id}.tag`}
                  resolved={texts[`materials.method.${id}.tag`]}
                  editMode={editMode}
                />
              </p>
              <h3 className="mt-3 text-lg font-bold tracking-wider">
                <SlotText
                  slotKey={`materials.method.${id}.title`}
                  resolved={texts[`materials.method.${id}.title`]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey={`materials.method.${id}.en`}
                  resolved={texts[`materials.method.${id}.en`]}
                  editMode={editMode}
                />
              </p>
              <SlotText
                slotKey={`materials.method.${id}.desc`}
                resolved={texts[`materials.method.${id}.desc`]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <SlotRichText
                slotKey={`materials.method.${id}.diff`}
                resolved={texts[`materials.method.${id}.diff`]}
                editMode={editMode}
                as="p"
                className="mt-4 border-t border-hair-soft pt-4 text-[13px] leading-6 text-carbon-mid"
              />
            </div>
          ))}
        </Reveal>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.01"
            slotKey="materials.methods.1"
            resolved={slots["materials.methods.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="materials.methods.1.photo.capja"
                resolved={texts["materials.methods.1.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="materials.methods.1.photo.capen"
                resolved={texts["materials.methods.1.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="materials.methods.1.photo.credit"
                resolved={texts["materials.methods.1.photo.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.02"
            slotKey="materials.methods.2"
            resolved={slots["materials.methods.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="materials.methods.2.photo.capja"
                resolved={texts["materials.methods.2.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="materials.methods.2.photo.capen"
                resolved={texts["materials.methods.2.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="materials.methods.2.photo.credit"
                resolved={texts["materials.methods.2.photo.credit"]}
                editMode={editMode}
              />
            }
          />
        </Reveal>
      </Section>

      {/* ============ 素材別対応表 ============ */}
      <Section>
        <SectionMark
          no="SEC. 02"
          label={texts["materials.matrix.sec.label"].text}
          labelSlotKey="materials.matrix.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="materials.matrix.heading"
            resolved={texts["materials.matrix.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="materials.matrix.lead"
            resolved={texts["materials.matrix.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[720px] border-t border-hair text-sm">
            <thead>
              <tr className="border-b border-hair text-left font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                <th scope="col" className="py-3 pr-4 font-normal">
                  <SlotText
                    slotKey="materials.matrix.col.1"
                    resolved={texts["materials.matrix.col.1"]}
                    editMode={editMode}
                  />
                </th>
                <th scope="col" className="py-3 pr-4 font-normal">
                  <SlotText
                    slotKey="materials.matrix.col.2"
                    resolved={texts["materials.matrix.col.2"]}
                    editMode={editMode}
                  />
                </th>
                <th scope="col" className="py-3 pr-4 font-normal">
                  <SlotText
                    slotKey="materials.matrix.col.3"
                    resolved={texts["materials.matrix.col.3"]}
                    editMode={editMode}
                  />
                </th>
                <th scope="col" className="py-3 font-normal">
                  <SlotText
                    slotKey="materials.matrix.col.4"
                    resolved={texts["materials.matrix.col.4"]}
                    editMode={editMode}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {MATERIALS.map((mat, i) => {
                const idx = i + 1;
                return (
                  <tr key={idx} className="border-b border-hair align-top">
                    <th
                      scope="row"
                      className="py-4 pr-4 text-left font-bold tracking-wider"
                    >
                      <SlotText
                        slotKey={`materials.matrix.row.${idx}.name`}
                        resolved={texts[`materials.matrix.row.${idx}.name`]}
                        editMode={editMode}
                      />
                      {mat.hasSub ? (
                        <small className="block text-[11px] font-normal text-carbon-soft">
                          <SlotText
                            slotKey={`materials.matrix.row.${idx}.sub`}
                            resolved={texts[`materials.matrix.row.${idx}.sub`]}
                            editMode={editMode}
                          />
                        </small>
                      ) : null}
                    </th>
                    <td className="py-4 pr-4 text-carbon-mid">
                      <SlotText
                        slotKey={`materials.matrix.row.${idx}.method`}
                        resolved={texts[`materials.matrix.row.${idx}.method`]}
                        editMode={editMode}
                      />
                    </td>
                    <td className="py-4 pr-4 leading-6 text-carbon-mid">
                      <SlotText
                        slotKey={`materials.matrix.row.${idx}.point`}
                        resolved={texts[`materials.matrix.row.${idx}.point`]}
                        editMode={editMode}
                      />
                    </td>
                    <td className="py-4">
                      <Badge
                        variant="outline"
                        className={`rounded-none font-mono text-[10px] tracking-[0.1em] ${
                          mat.uv
                            ? "border-soul/50 text-soul"
                            : "border-hair text-carbon-mid"
                        }`}
                      >
                        <SlotText
                          slotKey={`materials.matrix.row.${idx}.weather`}
                          resolved={texts[`materials.matrix.row.${idx}.weather`]}
                          editMode={editMode}
                        />
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Reveal>
        <MapNote>
          <SlotText
            slotKey="materials.matrix.note"
            resolved={texts["materials.matrix.note"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ 下地の作り分け ============ */}
      <Section>
        <SectionMark
          no="SEC. 03"
          label={texts["materials.why.sec.label"].text}
          labelSlotKey="materials.why.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="materials.why.heading"
            resolved={texts["materials.why.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="materials.why.lead"
            resolved={texts["materials.why.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="kt-timeline mt-10">
          {CAUSE_IDS.map((id) => (
            <div key={id} className="kt-timeline-item">
              <span className="font-mono text-[10.5px] tracking-[0.14em] text-soul">
                <SlotText
                  slotKey={`materials.cause.${id}.no`}
                  resolved={texts[`materials.cause.${id}.no`]}
                  editMode={editMode}
                />
              </span>
              <h4 className="mt-2 text-[17px] font-bold tracking-[0.04em]">
                <SlotText
                  slotKey={`materials.cause.${id}.title`}
                  resolved={texts[`materials.cause.${id}.title`]}
                  editMode={editMode}
                />
              </h4>
              <SlotText
                slotKey={`materials.cause.${id}.body`}
                resolved={texts[`materials.cause.${id}.body`]}
                editMode={editMode}
                className="mt-2 max-w-[44em] text-[13.5px] leading-[1.95] text-carbon-mid"
              />
            </div>
          ))}
        </Reveal>
      </Section>

      {/* ============ 入稿 ============ */}
      <Section>
        <SectionMark
          no="SEC. 04"
          label={texts["materials.intake.sec.label"].text}
          labelSlotKey="materials.intake.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="materials.intake.heading"
            resolved={texts["materials.intake.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="materials.intake.lead"
            resolved={texts["materials.intake.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <div className="border border-hair bg-paper p-6">
            <p className="font-mono text-2xl font-semibold tracking-[0.08em]">
              <SlotText
                slotKey="materials.intake.stl.title"
                resolved={texts["materials.intake.stl.title"]}
                editMode={editMode}
              />
              <small className="ml-3 text-[11px] font-normal tracking-[0.14em] text-carbon-soft">
                <SlotText
                  slotKey="materials.intake.stl.sub"
                  resolved={texts["materials.intake.stl.sub"]}
                  editMode={editMode}
                />
              </small>
            </p>
            <SlotText
              slotKey="materials.intake.stl.body"
              resolved={texts["materials.intake.stl.body"]}
              editMode={editMode}
              className="mt-4 text-sm leading-7 text-carbon-mid"
            />
          </div>
          <div className="border border-hair bg-paper p-6">
            <p className="font-mono text-2xl font-semibold tracking-[0.08em]">
              <SlotText
                slotKey="materials.intake.step.title"
                resolved={texts["materials.intake.step.title"]}
                editMode={editMode}
              />
              <small className="ml-3 text-[11px] font-normal tracking-[0.14em] text-carbon-soft">
                <SlotText
                  slotKey="materials.intake.step.sub"
                  resolved={texts["materials.intake.step.sub"]}
                  editMode={editMode}
                />
              </small>
            </p>
            <SlotText
              slotKey="materials.intake.step.body"
              resolved={texts["materials.intake.step.body"]}
              editMode={editMode}
              className="mt-4 text-sm leading-7 text-carbon-mid"
            />
          </div>
        </Reveal>
        <MapNote>
          <SlotText
            slotKey="materials.intake.note"
            resolved={texts["materials.intake.note"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark
          no="GALLERY"
          label={texts["materials.gallery.sec.label"].text}
          labelSlotKey="materials.gallery.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="materials.gallery.heading"
            resolved={texts["materials.gallery.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="materials.gallery.lead"
            resolved={texts["materials.gallery.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.03"
            slotKey="materials.gallery.1"
            resolved={slots["materials.gallery.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="materials.gallery.1.photo.capja"
                resolved={texts["materials.gallery.1.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="materials.gallery.1.photo.capen"
                resolved={texts["materials.gallery.1.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="materials.gallery.1.photo.credit"
                resolved={texts["materials.gallery.1.photo.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.04"
            slotKey="materials.gallery.2"
            resolved={slots["materials.gallery.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="materials.gallery.2.photo.capja"
                resolved={texts["materials.gallery.2.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="materials.gallery.2.photo.capen"
                resolved={texts["materials.gallery.2.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="materials.gallery.2.photo.credit"
                resolved={texts["materials.gallery.2.photo.credit"]}
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
            slotKey="materials.cta.heading"
            resolved={texts["materials.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="materials.cta.note"
            resolved={texts["materials.cta.note"]}
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
