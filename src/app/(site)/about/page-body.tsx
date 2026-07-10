import {
  CtaBand,
  MapNote,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
  SpecTable,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotRichText } from "@/components/site/slot-rich-text";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

export function AboutPageBody({
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
            slotKey="about.hero.index"
            resolved={texts["about.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="about.hero.en"
            resolved={texts["about.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="about.hero.heading"
            resolved={texts["about.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="about.hero.lead"
            resolved={texts["about.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      {/* ============ 市場の空白 ============ */}
      <Section>
        <SectionMark
          no="SEC. 01"
          label={texts["about.why.sec.label"].text}
          labelSlotKey="about.why.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="about.why.heading"
            resolved={texts["about.why.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <Reveal as="div" className="mt-10">
          <SpecTable
            rows={[
              {
                th: (
                  <SlotText
                    slotKey="about.why.table.1.th"
                    resolved={texts["about.why.table.1.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.why.table.1.td"
                    resolved={texts["about.why.table.1.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.why.table.2.th"
                    resolved={texts["about.why.table.2.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.why.table.2.td"
                    resolved={texts["about.why.table.2.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.why.table.3.th"
                    resolved={texts["about.why.table.3.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.why.table.3.td"
                    resolved={texts["about.why.table.3.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.why.table.4.th"
                    resolved={texts["about.why.table.4.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotRichText
                    slotKey="about.why.table.4.td"
                    resolved={texts["about.why.table.4.td"]}
                    editMode={editMode}
                  />
                ),
              },
            ]}
          />
        </Reveal>
      </Section>

      {/* ============ 代表 ============ */}
      <Section>
        <SectionMark
          no="SEC. 02"
          label={texts["about.craftsman.sec.label"].text}
          labelSlotKey="about.craftsman.sec.label"
          editMode={editMode}
        />
        <div className="mt-10 grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-end md:gap-[clamp(32px,5vw,72px)]">
          <Reveal as="div">
            {/* [採用 EXTRA] 代表名の原寸復元 (legacy css:631-637): clamp(48px,7.6vw,96px) /
                letter-spacing 0.12em — 1.1fr/1fr + 下揃えの構図で旧サイトの迫力を再現する。 */}
            <p className="text-[clamp(48px,7.6vw,96px)] font-bold tracking-[0.12em]">
              <SlotText
                slotKey="about.craftsman.name"
                resolved={texts["about.craftsman.name"]}
                editMode={editMode}
              />
            </p>
            <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              <SlotText
                slotKey="about.craftsman.romaji"
                resolved={texts["about.craftsman.romaji"]}
                editMode={editMode}
              />
            </p>
          </Reveal>
          <Reveal
            as="div"
            className="space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid"
          >
            <p>
              <SlotText
                slotKey="about.craftsman.bio.1"
                resolved={texts["about.craftsman.bio.1"]}
                editMode={editMode}
              />
            </p>
            <p>
              <SlotText
                slotKey="about.craftsman.bio.2"
                resolved={texts["about.craftsman.bio.2"]}
                editMode={editMode}
              />
            </p>
          </Reveal>
        </div>
      </Section>

      {/* ============ 設備 ============ */}
      <Section>
        <SectionMark
          no="SEC. 03"
          label={texts["about.facility.sec.label"].text}
          labelSlotKey="about.facility.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="about.facility.heading"
            resolved={texts["about.facility.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="about.facility.lead"
            resolved={texts["about.facility.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10">
          <SpecTable
            rows={[
              {
                th: (
                  <SlotText
                    slotKey="about.facility.table.1.th"
                    resolved={texts["about.facility.table.1.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotRichText
                    slotKey="about.facility.table.1.td"
                    resolved={texts["about.facility.table.1.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.facility.table.2.th"
                    resolved={texts["about.facility.table.2.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotRichText
                    slotKey="about.facility.table.2.td"
                    resolved={texts["about.facility.table.2.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.facility.table.3.th"
                    resolved={texts["about.facility.table.3.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.facility.table.3.td"
                    resolved={texts["about.facility.table.3.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.facility.table.4.th"
                    resolved={texts["about.facility.table.4.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.facility.table.4.td"
                    resolved={texts["about.facility.table.4.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.facility.table.5.th"
                    resolved={texts["about.facility.table.5.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.facility.table.5.td"
                    resolved={texts["about.facility.table.5.td"]}
                    editMode={editMode}
                  />
                ),
              },
            ]}
          />
        </Reveal>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-3">
          <PhotoFigure
            figNo="FIG.01"
            slotKey="about.facility.1"
            resolved={slots["about.facility.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="about.facility.1.capja"
                resolved={texts["about.facility.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="about.facility.1.capen"
                resolved={texts["about.facility.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="about.facility.1.credit"
                resolved={texts["about.facility.1.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.02"
            slotKey="about.facility.2"
            resolved={slots["about.facility.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="about.facility.2.capja"
                resolved={texts["about.facility.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="about.facility.2.capen"
                resolved={texts["about.facility.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="about.facility.2.credit"
                resolved={texts["about.facility.2.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.03"
            slotKey="about.facility.3"
            resolved={slots["about.facility.3"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="about.facility.3.capja"
                resolved={texts["about.facility.3.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="about.facility.3.capen"
                resolved={texts["about.facility.3.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="about.facility.3.credit"
                resolved={texts["about.facility.3.credit"]}
                editMode={editMode}
              />
            }
          />
        </Reveal>
      </Section>

      {/* ============ 会社概要 ============ */}
      <Section>
        <SectionMark
          no="SEC. 04"
          label={texts["about.profile.sec.label"].text}
          labelSlotKey="about.profile.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="about.profile.heading"
            resolved={texts["about.profile.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <Reveal as="div" className="mt-10">
          <SpecTable
            rows={[
              {
                th: (
                  <SlotText
                    slotKey="about.profile.table.1.th"
                    resolved={texts["about.profile.table.1.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.profile.table.1.td"
                    resolved={texts["about.profile.table.1.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.profile.table.2.th"
                    resolved={texts["about.profile.table.2.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.profile.table.2.td"
                    resolved={texts["about.profile.table.2.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.profile.table.3.th"
                    resolved={texts["about.profile.table.3.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.profile.table.3.td"
                    resolved={texts["about.profile.table.3.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.profile.table.4.th"
                    resolved={texts["about.profile.table.4.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.profile.table.4.td"
                    resolved={texts["about.profile.table.4.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.profile.table.5.th"
                    resolved={texts["about.profile.table.5.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.profile.table.5.td"
                    resolved={texts["about.profile.table.5.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="about.profile.table.6.th"
                    resolved={texts["about.profile.table.6.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="about.profile.table.6.td"
                    resolved={texts["about.profile.table.6.td"]}
                    editMode={editMode}
                  />
                ),
              },
            ]}
          />
        </Reveal>
      </Section>

      {/* ============ 地図 ============ */}
      <Section>
        <SectionMark
          no="SEC. 05"
          label={texts["about.location.sec.label"].text}
          labelSlotKey="about.location.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="about.location.heading"
            resolved={texts["about.location.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="about.location.lead"
            resolved={texts["about.location.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="kt-map-frame mt-10 border border-hair bg-paper p-2">
          <iframe
            src="https://maps.google.com/maps?q=%E5%A4%A7%E5%88%86%E7%9C%8C%E8%B1%8A%E5%BE%8C%E9%AB%98%E7%94%B0%E5%B8%82&t=m&z=10&output=embed"
            title="隈部塗装の所在地（大分県豊後高田市）"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block aspect-[21/9] w-full border-0"
          />
        </Reveal>
        <MapNote>
          <SlotText
            slotKey="about.location.note"
            resolved={texts["about.location.note"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark
          no="GALLERY"
          label={texts["about.gallery.sec.label"].text}
          labelSlotKey="about.gallery.sec.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="about.gallery.heading"
            resolved={texts["about.gallery.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="about.gallery.lead"
            resolved={texts["about.gallery.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.04"
            slotKey="about.gallery.1"
            resolved={slots["about.gallery.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="about.gallery.1.capja"
                resolved={texts["about.gallery.1.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="about.gallery.1.capen"
                resolved={texts["about.gallery.1.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="about.gallery.1.credit"
                resolved={texts["about.gallery.1.credit"]}
                editMode={editMode}
              />
            }
          />
          <PhotoFigure
            figNo="FIG.05"
            slotKey="about.gallery.2"
            resolved={slots["about.gallery.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="about.gallery.2.capja"
                resolved={texts["about.gallery.2.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="about.gallery.2.capen"
                resolved={texts["about.gallery.2.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="about.gallery.2.credit"
                resolved={texts["about.gallery.2.credit"]}
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
            slotKey="about.cta.heading"
            resolved={texts["about.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="about.cta.note"
            resolved={texts["about.cta.note"]}
            editMode={editMode}
          />
        }
        href="/service"
        label={texts["about.cta.button"].text}
        labelSlotKey="about.cta.button"
        editMode={editMode}
      />
    </>
  );
}
