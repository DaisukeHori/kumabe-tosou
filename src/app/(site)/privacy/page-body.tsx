import { MapNote, PageHead, Section, SpecTable } from "@/components/site/page-blocks";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

export function PrivacyPageBody({
  texts,
  editMode,
}: {
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index={
          <SlotText
            slotKey="privacy.hero.index"
            resolved={texts["privacy.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="privacy.hero.en"
            resolved={texts["privacy.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="privacy.hero.title"
            resolved={texts["privacy.hero.title"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="privacy.hero.lead"
            resolved={texts["privacy.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section>
        <div className="max-w-[860px]">
          <SpecTable
            rows={[
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.business.th"
                    resolved={texts["privacy.spec.business.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <>
                    <SlotText
                      slotKey="privacy.spec.business.td"
                      resolved={texts["privacy.spec.business.td"]}
                      editMode={editMode}
                    />
                    <br />
                    <span className="text-xs text-carbon-soft">
                      <SlotText
                        slotKey="privacy.spec.business.note"
                        resolved={texts["privacy.spec.business.note"]}
                        editMode={editMode}
                      />
                    </span>
                  </>
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.collect.th"
                    resolved={texts["privacy.spec.collect.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.collect.td"
                    resolved={texts["privacy.spec.collect.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.purpose.th"
                    resolved={texts["privacy.spec.purpose.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.purpose.td"
                    resolved={texts["privacy.spec.purpose.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.third.th"
                    resolved={texts["privacy.spec.third.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.third.td"
                    resolved={texts["privacy.spec.third.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.retention.th"
                    resolved={texts["privacy.spec.retention.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.retention.td"
                    resolved={texts["privacy.spec.retention.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.disclosure.th"
                    resolved={texts["privacy.spec.disclosure.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.disclosure.td"
                    resolved={texts["privacy.spec.disclosure.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.cookie.th"
                    resolved={texts["privacy.spec.cookie.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.cookie.td"
                    resolved={texts["privacy.spec.cookie.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="privacy.spec.revision.th"
                    resolved={texts["privacy.spec.revision.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="privacy.spec.revision.td"
                    resolved={texts["privacy.spec.revision.td"]}
                    editMode={editMode}
                  />
                ),
              },
            ]}
          />
          <MapNote>
            <SlotText
              slotKey="privacy.mapnote"
              resolved={texts["privacy.mapnote"]}
              editMode={editMode}
            />
          </MapNote>
        </div>
      </Section>
    </>
  );
}
