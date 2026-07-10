import { MapNote, PageHead, Section, SpecTable } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

export function TokushohoPageBody({
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
            slotKey="tokushoho.hero.index"
            resolved={texts["tokushoho.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="tokushoho.hero.en"
            resolved={texts["tokushoho.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="tokushoho.hero.heading"
            resolved={texts["tokushoho.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="tokushoho.hero.lead"
            resolved={texts["tokushoho.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section>
        <Reveal as="div" className="max-w-[860px]">
          <SpecTable
            rows={[
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.seller.th"
                    resolved={texts["tokushoho.spec.seller.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.seller.td"
                    resolved={texts["tokushoho.spec.seller.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.representative.th"
                    resolved={texts["tokushoho.spec.representative.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.representative.td"
                    resolved={texts["tokushoho.spec.representative.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.address.th"
                    resolved={texts["tokushoho.spec.address.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <>
                    <SlotText
                      slotKey="tokushoho.spec.address.td"
                      resolved={texts["tokushoho.spec.address.td"]}
                      editMode={editMode}
                    />
                    <br />
                    <span className="text-xs text-carbon-soft">
                      <SlotText
                        slotKey="tokushoho.spec.address.note"
                        resolved={texts["tokushoho.spec.address.note"]}
                        editMode={editMode}
                      />
                    </span>
                  </>
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.tel.th"
                    resolved={texts["tokushoho.spec.tel.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <>
                    <SlotText
                      slotKey="tokushoho.spec.tel.td"
                      resolved={texts["tokushoho.spec.tel.td"]}
                      editMode={editMode}
                    />
                    <br />
                    <span className="text-xs text-carbon-soft">
                      <SlotText
                        slotKey="tokushoho.spec.tel.note"
                        resolved={texts["tokushoho.spec.tel.note"]}
                        editMode={editMode}
                      />
                    </span>
                  </>
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.contact.th"
                    resolved={texts["tokushoho.spec.contact.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.contact.td"
                    resolved={texts["tokushoho.spec.contact.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.price.th"
                    resolved={texts["tokushoho.spec.price.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.price.td"
                    resolved={texts["tokushoho.spec.price.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.fees.th"
                    resolved={texts["tokushoho.spec.fees.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.fees.td"
                    resolved={texts["tokushoho.spec.fees.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.payment.th"
                    resolved={texts["tokushoho.spec.payment.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <>
                    <SlotText
                      slotKey="tokushoho.spec.payment.td"
                      resolved={texts["tokushoho.spec.payment.td"]}
                      editMode={editMode}
                    />
                    <br />
                    <span className="text-xs text-carbon-soft">
                      <SlotText
                        slotKey="tokushoho.spec.payment.note"
                        resolved={texts["tokushoho.spec.payment.note"]}
                        editMode={editMode}
                      />
                    </span>
                  </>
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.paytiming.th"
                    resolved={texts["tokushoho.spec.paytiming.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.paytiming.td"
                    resolved={texts["tokushoho.spec.paytiming.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.delivery.th"
                    resolved={texts["tokushoho.spec.delivery.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.delivery.td"
                    resolved={texts["tokushoho.spec.delivery.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.return.th"
                    resolved={texts["tokushoho.spec.return.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.return.td"
                    resolved={texts["tokushoho.spec.return.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.custody.th"
                    resolved={texts["tokushoho.spec.custody.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.custody.td"
                    resolved={texts["tokushoho.spec.custody.td"]}
                    editMode={editMode}
                  />
                ),
              },
              {
                th: (
                  <SlotText
                    slotKey="tokushoho.spec.environment.th"
                    resolved={texts["tokushoho.spec.environment.th"]}
                    editMode={editMode}
                  />
                ),
                td: (
                  <SlotText
                    slotKey="tokushoho.spec.environment.td"
                    resolved={texts["tokushoho.spec.environment.td"]}
                    editMode={editMode}
                  />
                ),
              },
            ]}
          />
          <MapNote>
            <SlotText
              slotKey="tokushoho.mapnote"
              resolved={texts["tokushoho.mapnote"]}
              editMode={editMode}
            />
          </MapNote>
        </Reveal>
      </Section>
    </>
  );
}
