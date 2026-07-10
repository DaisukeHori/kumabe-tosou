import { CtaBand, PageHead, PhotoFigure } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotImage } from "@/components/site/slot-image";
import { SlotRichText } from "@/components/site/slot-rich-text";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

function Chapter({
  no,
  title,
  en,
  children,
  photo,
}: {
  no: React.ReactNode;
  title: React.ReactNode;
  en: React.ReactNode;
  children: React.ReactNode;
  photo: React.ReactNode;
}) {
  return (
    <section className="kt-story-chapter">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:gap-14">
          <Reveal as="div" className="kt-story-head">
            <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
              {no}
            </span>
            <h2 className="mt-4 text-[clamp(24px,3.2vw,38px)] font-bold leading-snug tracking-[0.04em]">
              {title}
            </h2>
            <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              {en}
            </p>
          </Reveal>
          <Reveal
            as="div"
            className="kt-story-body space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon"
          >
            {children}
          </Reveal>
        </div>
        <div className="mt-10">{photo}</div>
      </div>
    </section>
  );
}

function StoryQuote({ children }: { children: React.ReactNode }) {
  return <p className="kt-story-quote">{children}</p>;
}

/**
 * story.portrait (未来枠) の装飾プレースホルダ。V2a 以前 (旧 page.tsx) の見た目を
 * SlotImage の placeholder prop 経由で復元したもの (公開時の非退行、修正1)。
 * 自己完結で aspect-[3/4] / aria-label を持つため、editMode=false のときは
 * SlotImage が余計なラッパを足さずそのまま描画する。
 * 枠線・斜めストライプ背景・四隅コーナーマークは呼び出し側の `.kt-portrait-frame` /
 * `.kt-portrait-corner` (motion: page-story-process) が担うため、本体は背景を持たず
 * 透過のまま重ねる (ストライプが透けて見える)。
 */
export function StoryPortraitPlaceholder({
  texts,
  editMode,
}: {
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <figure
      className="relative flex aspect-[3/4] w-full flex-col items-center justify-center"
      aria-label="代表・隈部信之（近日、実際の写真に差し替え予定）"
    >
      <SlotText
        as="span"
        className="text-4xl font-bold tracking-[0.2em]"
        slotKey="story.portrait.initial"
        resolved={texts["story.portrait.initial"]}
        editMode={editMode}
      />
      <SlotText
        as="span"
        className="mt-6 font-mono text-[10px] tracking-[0.24em] text-carbon-soft"
        slotKey="story.portrait.caption"
        resolved={texts["story.portrait.caption"]}
        editMode={editMode}
      />
    </figure>
  );
}

export function StoryPageBody({
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
            slotKey="story.hero.index"
            resolved={texts["story.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="story.hero.en"
            resolved={texts["story.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="story.hero.heading"
            resolved={texts["story.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="story.hero.lead"
            resolved={texts["story.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      {/* ============ 第一章 ============ */}
      <Chapter
        no={
          <SlotText
            slotKey="story.chapter1.no"
            resolved={texts["story.chapter1.no"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="story.chapter1.title"
            resolved={texts["story.chapter1.title"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="story.chapter1.en"
            resolved={texts["story.chapter1.en"]}
            editMode={editMode}
          />
        }
        photo={
          <PhotoFigure
            figNo="FIG.01"
            slotKey="story.chapter.1"
            resolved={slots["story.chapter.1"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="story.chapter1.photo.capja"
                resolved={texts["story.chapter1.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="story.chapter1.photo.capen"
                resolved={texts["story.chapter1.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="story.chapter1.photo.credit"
                resolved={texts["story.chapter1.photo.credit"]}
                editMode={editMode}
              />
            }
          />
        }
      >
        <SlotText
          slotKey="story.chapter1.body.1"
          resolved={texts["story.chapter1.body.1"]}
          editMode={editMode}
        />
        <SlotRichText
          as="p"
          slotKey="story.chapter1.body.2"
          resolved={texts["story.chapter1.body.2"]}
          editMode={editMode}
        />
        <SlotRichText
          as="p"
          slotKey="story.chapter1.body.3"
          resolved={texts["story.chapter1.body.3"]}
          editMode={editMode}
        />
      </Chapter>

      {/* ============ 第二章 ============ */}
      <Chapter
        no={
          <SlotText
            slotKey="story.chapter2.no"
            resolved={texts["story.chapter2.no"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="story.chapter2.title"
            resolved={texts["story.chapter2.title"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="story.chapter2.en"
            resolved={texts["story.chapter2.en"]}
            editMode={editMode}
          />
        }
        photo={
          <PhotoFigure
            figNo="FIG.02 — THE GAP"
            slotKey="story.chapter.2"
            resolved={slots["story.chapter.2"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="story.chapter2.photo.capja"
                resolved={texts["story.chapter2.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="story.chapter2.photo.capen"
                resolved={texts["story.chapter2.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="story.chapter2.photo.credit"
                resolved={texts["story.chapter2.photo.credit"]}
                editMode={editMode}
              />
            }
          />
        }
      >
        <SlotText
          slotKey="story.chapter2.body.1"
          resolved={texts["story.chapter2.body.1"]}
          editMode={editMode}
        />
        <SlotText
          slotKey="story.chapter2.body.2"
          resolved={texts["story.chapter2.body.2"]}
          editMode={editMode}
        />
        <StoryQuote>
          <SlotText
            slotKey="story.chapter2.quote"
            resolved={texts["story.chapter2.quote"]}
            editMode={editMode}
          />
          <cite>
            <SlotText
              slotKey="story.chapter2.quote.cite"
              resolved={texts["story.chapter2.quote.cite"]}
              editMode={editMode}
            />
          </cite>
        </StoryQuote>
        <SlotRichText
          as="p"
          slotKey="story.chapter2.body.3"
          resolved={texts["story.chapter2.body.3"]}
          editMode={editMode}
        />
      </Chapter>

      {/* ============ 第三章 ============ */}
      <Chapter
        no={
          <SlotText
            slotKey="story.chapter3.no"
            resolved={texts["story.chapter3.no"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="story.chapter3.title"
            resolved={texts["story.chapter3.title"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="story.chapter3.en"
            resolved={texts["story.chapter3.en"]}
            editMode={editMode}
          />
        }
        photo={
          <PhotoFigure
            figNo="FIG.03"
            slotKey="story.chapter.3"
            resolved={slots["story.chapter.3"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="story.chapter3.photo.capja"
                resolved={texts["story.chapter3.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="story.chapter3.photo.capen"
                resolved={texts["story.chapter3.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="story.chapter3.photo.credit"
                resolved={texts["story.chapter3.photo.credit"]}
                editMode={editMode}
              />
            }
          />
        }
      >
        <SlotRichText
          as="p"
          slotKey="story.chapter3.body.1"
          resolved={texts["story.chapter3.body.1"]}
          editMode={editMode}
        />
        <SlotText
          slotKey="story.chapter3.body.2"
          resolved={texts["story.chapter3.body.2"]}
          editMode={editMode}
        />
        <SlotText
          slotKey="story.chapter3.body.3"
          resolved={texts["story.chapter3.body.3"]}
          editMode={editMode}
        />
      </Chapter>

      {/* ============ 第四章 ============ */}
      <Chapter
        no={
          <SlotText
            slotKey="story.chapter4.no"
            resolved={texts["story.chapter4.no"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="story.chapter4.title"
            resolved={texts["story.chapter4.title"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="story.chapter4.en"
            resolved={texts["story.chapter4.en"]}
            editMode={editMode}
          />
        }
        photo={
          <PhotoFigure
            figNo="FIG.04"
            slotKey="story.chapter.4"
            resolved={slots["story.chapter.4"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="story.chapter4.photo.capja"
                resolved={texts["story.chapter4.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="story.chapter4.photo.capen"
                resolved={texts["story.chapter4.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="story.chapter4.photo.credit"
                resolved={texts["story.chapter4.photo.credit"]}
                editMode={editMode}
              />
            }
          />
        }
      >
        <SlotRichText
          as="p"
          slotKey="story.chapter4.body.1"
          resolved={texts["story.chapter4.body.1"]}
          editMode={editMode}
        />
        <SlotRichText
          as="p"
          slotKey="story.chapter4.body.2"
          resolved={texts["story.chapter4.body.2"]}
          editMode={editMode}
        />
        <StoryQuote>
          <SlotText
            slotKey="story.chapter4.quote"
            resolved={texts["story.chapter4.quote"]}
            editMode={editMode}
          />
        </StoryQuote>
        <SlotRichText
          as="p"
          slotKey="story.chapter4.body.3"
          resolved={texts["story.chapter4.body.3"]}
          editMode={editMode}
        />
      </Chapter>

      {/* ============ 第五章 ============ */}
      <Chapter
        no={
          <SlotText
            slotKey="story.chapter5.no"
            resolved={texts["story.chapter5.no"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="story.chapter5.title"
            resolved={texts["story.chapter5.title"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="story.chapter5.en"
            resolved={texts["story.chapter5.en"]}
            editMode={editMode}
          />
        }
        photo={
          <PhotoFigure
            figNo="FIG.05"
            slotKey="story.chapter.5"
            resolved={slots["story.chapter.5"]}
            editMode={editMode}
            capJa={
              <SlotText
                slotKey="story.chapter5.photo.capja"
                resolved={texts["story.chapter5.photo.capja"]}
                editMode={editMode}
              />
            }
            capEn={
              <SlotText
                slotKey="story.chapter5.photo.capen"
                resolved={texts["story.chapter5.photo.capen"]}
                editMode={editMode}
              />
            }
            credit={
              <SlotText
                slotKey="story.chapter5.photo.credit"
                resolved={texts["story.chapter5.photo.credit"]}
                editMode={editMode}
              />
            }
          />
        }
      >
        <SlotText
          slotKey="story.chapter5.body.1"
          resolved={texts["story.chapter5.body.1"]}
          editMode={editMode}
        />
        <SlotRichText
          as="p"
          slotKey="story.chapter5.body.2"
          resolved={texts["story.chapter5.body.2"]}
          editMode={editMode}
        />
        <SlotRichText
          as="p"
          slotKey="story.chapter5.body.3"
          resolved={texts["story.chapter5.body.3"]}
          editMode={editMode}
        />
      </Chapter>

      {/* ============ 代表メッセージ ============ */}
      <section className="kt-message-sec">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] md:gap-14">
          <Reveal as="div" className="max-w-sm">
            <div className="kt-portrait-frame">
              <SlotImage
                slotKey="story.portrait"
                resolved={slots["story.portrait"]}
                editMode={editMode}
                className="bg-transparent"
                placeholder={<StoryPortraitPlaceholder texts={texts} editMode={editMode} />}
              />
              <span
                className="kt-portrait-corner kt-portrait-corner--tl"
                aria-hidden="true"
              >
                +
              </span>
              <span
                className="kt-portrait-corner kt-portrait-corner--br"
                aria-hidden="true"
              >
                +
              </span>
            </div>
          </Reveal>
          <div>
            <SlotText
              as="span"
              className="font-mono text-[11px] tracking-[0.22em] text-soul"
              slotKey="story.message.eyebrow"
              resolved={texts["story.message.eyebrow"]}
              editMode={editMode}
            />
            <SlotText
              as="h2"
              className="mt-5 text-[clamp(24px,3.2vw,38px)] font-bold leading-snug tracking-[0.04em]"
              slotKey="story.message.heading"
              resolved={texts["story.message.heading"]}
              editMode={editMode}
            />
            <div className="mt-8 space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
              <SlotText
                slotKey="story.message.body.1"
                resolved={texts["story.message.body.1"]}
                editMode={editMode}
              />
              <SlotText
                slotKey="story.message.body.2"
                resolved={texts["story.message.body.2"]}
                editMode={editMode}
              />
              <SlotRichText
                as="p"
                slotKey="story.message.body.3"
                resolved={texts["story.message.body.3"]}
                editMode={editMode}
              />
              <SlotText
                slotKey="story.message.body.4"
                resolved={texts["story.message.body.4"]}
                editMode={editMode}
              />
            </div>
            <div className="mt-10 flex items-baseline gap-4 border-t border-hair pt-6">
              <SlotText
                as="span"
                className="text-xs tracking-wider text-carbon-soft"
                slotKey="story.message.role"
                resolved={texts["story.message.role"]}
                editMode={editMode}
              />
              <SlotText
                as="span"
                className="text-xl font-bold tracking-[0.14em]"
                slotKey="story.message.name"
                resolved={texts["story.message.name"]}
                editMode={editMode}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <SlotText
            slotKey="story.cta.heading"
            resolved={texts["story.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="story.cta.note"
            resolved={texts["story.cta.note"]}
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
