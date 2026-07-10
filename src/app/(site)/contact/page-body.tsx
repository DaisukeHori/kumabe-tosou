import { ContactForm } from "@/components/contact/contact-form";
import {
  ArrowButton,
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

/** 3変数カード (SIZE/QTY/GRADE)。テキストは contact.quotevar.<n>.{label,ja,body} */
const QUOTE_VAR_KEYS = ["1", "2", "3"] as const;

/** FAQ (Q1-Q5)。テキストは contact.faq.{q,a}.<n> */
const FAQ_INDEXES = [1, 2, 3, 4, 5] as const;

export function ContactPageBody({
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
            slotKey="contact.hero.index"
            resolved={texts["contact.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="contact.hero.en"
            resolved={texts["contact.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="contact.hero.heading"
            resolved={texts["contact.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="contact.hero.lead"
            resolved={texts["contact.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section className="pb-0 pt-6 sm:pb-0 sm:pt-8">
        <PhotoFigure
          figNo="FIG.00"
          slotKey="contact.hero"
          resolved={slots["contact.hero"]}
          editMode={editMode}
          capJa={
            <SlotText
              slotKey="contact.hero.photo.capja"
              resolved={texts["contact.hero.photo.capja"]}
              editMode={editMode}
            />
          }
          capEn={
            <SlotText
              slotKey="contact.hero.photo.capen"
              resolved={texts["contact.hero.photo.capen"]}
              editMode={editMode}
            />
          }
          credit={
            <SlotText
              slotKey="contact.hero.photo.credit"
              resolved={texts["contact.hero.photo.credit"]}
              editMode={editMode}
            />
          }
        />
      </Section>

      {/* ============ 3変数 ============ */}
      <Section>
        <SectionMark
          no="SEC. 01"
          label={texts["contact.sec.1.label"].text}
          labelSlotKey="contact.sec.1.label"
          editMode={editMode}
        />
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-3">
          {QUOTE_VAR_KEYS.map((k) => (
            <div key={k} className="border border-hair bg-paper p-6">
              <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
                <SlotText
                  slotKey={`contact.quotevar.${k}.label`}
                  resolved={texts[`contact.quotevar.${k}.label`]}
                  editMode={editMode}
                />
              </span>
              <p className="mt-2 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey={`contact.quotevar.${k}.ja`}
                  resolved={texts[`contact.quotevar.${k}.ja`]}
                  editMode={editMode}
                />
              </p>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                <SlotText
                  slotKey={`contact.quotevar.${k}.body`}
                  resolved={texts[`contact.quotevar.${k}.body`]}
                  editMode={editMode}
                />
              </p>
            </div>
          ))}
        </Reveal>
        <MapNote>
          <SlotText
            slotKey="contact.estimate.note"
            resolved={texts["contact.estimate.note"]}
            editMode={editMode}
          />
        </MapNote>
      </Section>

      {/* ============ お問い合わせフォーム ============ */}
      <Section>
        <SectionMark
          no="SEC. 02"
          label={texts["contact.sec.2.label"].text}
          labelSlotKey="contact.sec.2.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="contact.form.heading"
            resolved={texts["contact.form.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="contact.form.lead"
            resolved={texts["contact.form.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10">
          <ContactForm texts={texts} editMode={editMode} />
        </Reveal>
      </Section>

      {/* ============ 逆リンク ============ */}
      <Section>
        <SectionMark
          no="SEC. 03"
          label={texts["contact.sec.3.label"].text}
          labelSlotKey="contact.sec.3.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="contact.before.heading"
            resolved={texts["contact.before.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="contact.before.lead"
            resolved={texts["contact.before.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/service">
            <SlotText
              slotKey="contact.before.link.service"
              resolved={texts["contact.before.link.service"]}
              editMode={editMode}
            />
          </ArrowButton>
          <ArrowButton href="/colors">
            <SlotText
              slotKey="contact.before.link.colors"
              resolved={texts["contact.before.link.colors"]}
              editMode={editMode}
            />
          </ArrowButton>
        </Reveal>
      </Section>

      {/* ============ FAQ ============ */}
      <Section>
        <SectionMark
          no="SEC. 04"
          label={texts["contact.sec.4.label"].text}
          labelSlotKey="contact.sec.4.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="contact.faq.heading"
            resolved={texts["contact.faq.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <Reveal as="div" className="mt-10 divide-y divide-hair border-y border-hair">
          {FAQ_INDEXES.map((i) => (
            <details key={i} className="group">
              <summary className="flex cursor-pointer list-none items-baseline gap-4 py-5 text-[15px] font-medium tracking-wider [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 font-mono text-[11px] tracking-[0.16em] text-carbon-soft">
                  Q.{String(i).padStart(2, "0")}
                </span>
                <SlotText
                  slotKey={`contact.faq.q.${i}`}
                  resolved={texts[`contact.faq.q.${i}`]}
                  editMode={editMode}
                />
                <span
                  aria-hidden="true"
                  className="ml-auto shrink-0 text-carbon-soft transition-transform group-open:rotate-45"
                >
                  ＋
                </span>
              </summary>
              <p className="kt-faq-answer pb-6 pl-[3.4em] pr-4 text-sm leading-7 text-carbon-mid">
                <SlotText
                  slotKey={`contact.faq.a.${i}`}
                  resolved={texts[`contact.faq.a.${i}`]}
                  editMode={editMode}
                />
              </p>
            </details>
          ))}
        </Reveal>
      </Section>
    </>
  );
}
