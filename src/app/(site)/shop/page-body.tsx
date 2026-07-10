import {
  CtaBand,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { ServiceSimLink } from "@/components/site/service-sim-link";
import { ShopSimulator } from "@/components/site/shop-simulator";
import { SlotImage } from "@/components/site/slot-image";
import { SlotRichText } from "@/components/site/slot-rich-text";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";
import type { PriceTable } from "@/modules/pricing/contracts";

const DD = {
  "090": { a: "var(--dd-090-a)", b: "var(--dd-090-b)" },
  "46v": { a: "var(--dd-46v-a)", b: "var(--dd-46v-b)" },
  "4y6": { a: "var(--dd-4y6-a)", b: "var(--dd-4y6-b)" },
  "3t4": { a: "var(--dd-3t4-a)", b: "var(--dd-3t4-b)" },
  "202": { a: "var(--dd-202-a)", b: "var(--dd-202-b)" },
  tv2: { a: "var(--dd-tv2-a)", b: "var(--dd-tv2-b)" },
  am: { a: "var(--dd-am-a)", b: "var(--dd-am-b)" },
  "46g": { a: "var(--dd-46g-a)", b: "var(--dd-46g-b)" },
} as const;

const SWATCH_TITLES: Record<keyof typeof DD, string> = {
  "090": "プレシャスホワイトパール",
  "46v": "ソウルレッドクリスタル",
  "4y6": "プレシャスブロンズ",
  "3t4": "ピンクサファイア",
  "202": "ブラック",
  tv2: "ベイサイドブルー",
  am: "アストンマーティングリーン",
  "46g": "マシーングレー",
};

function MiniSwatch({ id }: { id: keyof typeof DD }) {
  return (
    <span
      title={SWATCH_TITLES[id]}
      className="kt-mini-swatch inline-block size-6 border border-hair"
      style={{
        background: `linear-gradient(135deg, ${DD[id].a}, ${DD[id].b})`,
      }}
    />
  );
}

/**
 * SEC.03「塗装済み製品」3枠 (未来枠) の装飾プレースホルダ。V2a 以前 (旧 page.tsx) の
 * CSS スウォッチ装飾を SlotImage の placeholder prop 経由で復元したもの
 * (公開時の非退行、修正1)。COMING SOON / 受注制作バッジは page-body 側で
 * SlotImage の外側 (sibling) に既に描画されているため、ここでは含めない。
 *
 * motion (page-rest §4-4): legacy の斜めストライプ+浮遊塗り板+光沢を
 * kt-product-visual / kt-pv-swatch(-row) / kt-pv-mini / kt-pv-note で復元する。
 * SlotImage 側の editMode 分岐 (placeholder prop) は既存のまま変更しない —
 * data-editable-* のクリック対象確保は slot-image.tsx が一元管理するため、
 * ここでは kt-pv-* の視覚強化のみを行う (SlotImage を壊さない)。
 * 塗りグラデーションは従来どおり inline style (linear-gradient) を維持し、
 * tests/slot-image-placeholder.test.ts の非退行 (8 スウォッチ = linear-gradient ×8) を保つ。
 */
export function ShopProduct1Placeholder() {
  return (
    <div className="kt-product-visual" aria-hidden="true">
      <span className="kt-pv-swatch-row">
        {(Object.keys(DD) as (keyof typeof DD)[]).map((id) => (
          <span
            key={id}
            className="kt-pv-mini"
            style={
              {
                background: `linear-gradient(150deg, ${DD[id].a}, ${DD[id].b} 80%)`,
                "--a": DD[id].a,
                "--b": DD[id].b,
              } as React.CSSProperties
            }
          />
        ))}
      </span>
      <span className="kt-pv-note">8-COLOR SET — IMAGE</span>
    </div>
  );
}

export function ShopProduct2Placeholder() {
  return (
    <div className="kt-product-visual" aria-hidden="true">
      <span
        className="kt-pv-swatch"
        style={
          {
            background: `linear-gradient(150deg, ${DD.tv2.a}, ${DD.tv2.b} 78%)`,
            "--a": DD.tv2.a,
            "--b": DD.tv2.b,
          } as React.CSSProperties
        }
      />
      <span className="kt-pv-note">SINGLE PANEL — IMAGE</span>
    </div>
  );
}

export function ShopProduct3Placeholder() {
  return (
    <div className="kt-product-visual" aria-hidden="true">
      <span
        className="kt-pv-swatch"
        style={
          {
            background: `linear-gradient(150deg, ${DD["202"].a}, ${DD["202"].b} 78%)`,
            "--a": DD["202"].a,
            "--b": DD["202"].b,
          } as React.CSSProperties
        }
      />
      <span className="kt-pv-note">YOUR OBJECT HERE</span>
    </div>
  );
}

function SvcBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-hair bg-primer px-2.5 py-1 text-[11px] tracking-wider text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
      {children}
    </span>
  );
}

// v2 Wave 1: no/title/body/meta は shop.flow.{n}.no / .title / .body / .meta (rich) として
// text-registry (slots/shop.ts) に登録済み。ここでは step 番号の列挙のみ保持する
// (非退行: defaultText は元のハードコード値と1文字も違わない)。
const BUY_FLOW_STEPS = [1, 2, 3, 4] as const;

export function ShopPageBody({
  slots,
  texts,
  editMode,
  priceTable,
}: {
  slots: ResolvedSlots;
  texts: ResolvedTexts;
  editMode: boolean;
  priceTable: PriceTable | null;
}) {
  return (
    <>
      <PageHead
        index="INDEX 09 — SHOP"
        en="ORDER FINISHING ONLINE"
        title={
          <SlotText
            slotKey="shop.hero.heading"
            resolved={texts["shop.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="shop.hero.lead"
            resolved={texts["shop.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section className="pb-0 pt-6 sm:pb-0 sm:pt-8">
        <PhotoFigure
          figNo="FIG.00 — WHAT YOU BUY"
          slotKey="shop.hero"
          resolved={slots["shop.hero"]}
          editMode={editMode}
          capJa="あなたが手にするのは、この深さ。自動車グレードの艶を、造形物に。"
          capEn="AUTOMOTIVE-GRADE FINISH, DELIVERED"
          credit="Photo: cmreflections / Unsplash"
        />
      </Section>

      {/* ============ SEC.01 サービスを買う ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="FINISHING SERVICES — 受託仕上げ" />
        <SecTitle>
          <SlotText
            slotKey="shop.grades.heading"
            resolved={texts["shop.grades.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotRichText
            slotKey="shop.grades.lead"
            resolved={texts["shop.grades.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 lg:grid-cols-3">
          {/* GRADE 01 */}
          <div className="kt-svc-card flex flex-col border border-hair bg-paper">
            <figure className="kt-svc-photo relative">
              <span className="absolute left-3 top-3 z-10 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                <SlotText
                  slotKey="shop.grade.1.badge"
                  resolved={texts["shop.grade.1.badge"]}
                  editMode={editMode}
                />
              </span>
              <SlotImage
                slotKey="shop.grade.1"
                resolved={slots["shop.grade.1"]}
                editMode={editMode}
              />
            </figure>
            <div className="flex flex-1 flex-col p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.1.label"
                  resolved={texts["shop.grade.1.label"]}
                  editMode={editMode}
                />
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.grade.1.title"
                  resolved={texts["shop.grade.1.title"]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.1.subtitle"
                  resolved={texts["shop.grade.1.subtitle"]}
                  editMode={editMode}
                />
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SvcBadge>
                  <SlotRichText
                    slotKey="shop.grade.1.badge.grit"
                    resolved={texts["shop.grade.1.badge.grit"]}
                    editMode={editMode}
                  />
                </SvcBadge>
                <SvcBadge>
                  <SlotRichText
                    slotKey="shop.grade.1.badge.wetsand"
                    resolved={texts["shop.grade.1.badge.wetsand"]}
                    editMode={editMode}
                  />
                </SvcBadge>
                <SvcBadge>
                  <SlotRichText
                    slotKey="shop.grade.1.badge.paint"
                    resolved={texts["shop.grade.1.badge.paint"]}
                    editMode={editMode}
                  />
                </SvcBadge>
              </div>
              <SlotText
                slotKey="shop.grade.1.body"
                resolved={texts["shop.grade.1.body"]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.1.steps.label"
                  resolved={texts["shop.grade.1.steps.label"]}
                  editMode={editMode}
                />
              </p>
              <SlotText
                slotKey="shop.grade.1.steps"
                resolved={texts["shop.grade.1.steps"]}
                editMode={editMode}
                as="ul"
                className="mt-2 space-y-1.5 text-[13px] leading-6 text-carbon-mid"
                renderLines={(lines) =>
                  lines.map((line, i) => <li key={i}>{line}</li>)
                }
              />
              <div className="mt-4 border-t border-hair-soft pt-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  <SlotText
                    slotKey="shop.grade.1.suited.label"
                    resolved={texts["shop.grade.1.suited.label"]}
                    editMode={editMode}
                  />
                </p>
                <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                  <SlotText
                    slotKey="shop.grade.1.suited.body"
                    resolved={texts["shop.grade.1.suited.body"]}
                    editMode={editMode}
                  />
                </p>
              </div>
              <p className="mt-5 text-2xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.grade.1.price"
                  resolved={texts["shop.grade.1.price"]}
                  editMode={editMode}
                />{" "}
                <small className="text-[11px] font-normal text-carbon-soft">
                  <SlotText
                    slotKey="shop.grade.1.price.note"
                    resolved={texts["shop.grade.1.price.note"]}
                    editMode={editMode}
                  />
                </small>
              </p>
              <ServiceSimLink
                grade="base"
                className="mt-5 flex items-center justify-center gap-1 border border-carbon/40 py-3 text-sm tracking-[0.08em] transition-colors hover:bg-carbon hover:text-paper"
              >
                <SlotText
                  slotKey="shop.grade.1.cta"
                  resolved={texts["shop.grade.1.cta"]}
                  editMode={editMode}
                />
                <span aria-hidden="true">→</span>
              </ServiceSimLink>
            </div>
          </div>

          {/* GRADE 02 */}
          <div className="kt-svc-card flex flex-col border border-hair bg-paper">
            <figure className="kt-svc-photo relative">
              <span className="absolute left-3 top-3 z-10 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                <SlotText
                  slotKey="shop.grade.2.badge"
                  resolved={texts["shop.grade.2.badge"]}
                  editMode={editMode}
                />
              </span>
              <SlotImage
                slotKey="shop.grade.2"
                resolved={slots["shop.grade.2"]}
                editMode={editMode}
              />
            </figure>
            <div className="flex flex-1 flex-col p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.2.label"
                  resolved={texts["shop.grade.2.label"]}
                  editMode={editMode}
                />
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.grade.2.title"
                  resolved={texts["shop.grade.2.title"]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.2.subtitle"
                  resolved={texts["shop.grade.2.subtitle"]}
                  editMode={editMode}
                />
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SvcBadge>
                  <SlotText
                    slotKey="shop.grade.2.badge.common"
                    resolved={texts["shop.grade.2.badge.common"]}
                    editMode={editMode}
                  />
                </SvcBadge>
                <SvcBadge>
                  <SlotRichText
                    slotKey="shop.grade.2.badge.coat"
                    resolved={texts["shop.grade.2.badge.coat"]}
                    editMode={editMode}
                  />
                </SvcBadge>
                <SvcBadge>
                  <SlotText
                    slotKey="shop.grade.2.badge.urethane"
                    resolved={texts["shop.grade.2.badge.urethane"]}
                    editMode={editMode}
                  />
                </SvcBadge>
              </div>
              <SlotText
                slotKey="shop.grade.2.body"
                resolved={texts["shop.grade.2.body"]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.2.steps.label"
                  resolved={texts["shop.grade.2.steps.label"]}
                  editMode={editMode}
                />
              </p>
              <SlotText
                slotKey="shop.grade.2.steps"
                resolved={texts["shop.grade.2.steps"]}
                editMode={editMode}
                as="ul"
                className="mt-2 space-y-1.5 text-[13px] leading-6 text-carbon-mid"
                renderLines={(lines) =>
                  lines.map((line, i) => <li key={i}>{line}</li>)
                }
              />
              <div className="mt-4 border-t border-hair-soft pt-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  <SlotText
                    slotKey="shop.grade.2.suited.label"
                    resolved={texts["shop.grade.2.suited.label"]}
                    editMode={editMode}
                  />
                </p>
                <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                  <SlotText
                    slotKey="shop.grade.2.suited.body"
                    resolved={texts["shop.grade.2.suited.body"]}
                    editMode={editMode}
                  />
                </p>
              </div>
              <p className="mt-5 text-2xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.grade.2.price"
                  resolved={texts["shop.grade.2.price"]}
                  editMode={editMode}
                />{" "}
                <small className="text-[11px] font-normal text-carbon-soft">
                  <SlotText
                    slotKey="shop.grade.2.price.note"
                    resolved={texts["shop.grade.2.price.note"]}
                    editMode={editMode}
                  />
                </small>
              </p>
              <ServiceSimLink
                grade="standard"
                className="mt-5 flex items-center justify-center gap-1 border border-carbon/40 py-3 text-sm tracking-[0.08em] transition-colors hover:bg-carbon hover:text-paper"
              >
                <SlotText
                  slotKey="shop.grade.2.cta"
                  resolved={texts["shop.grade.2.cta"]}
                  editMode={editMode}
                />
                <span aria-hidden="true">→</span>
              </ServiceSimLink>
            </div>
          </div>

          {/* GRADE 03 */}
          <div className="kt-svc-card kt-svc-featured flex flex-col border-2 border-carbon">
            <figure className="kt-svc-photo relative">
              <span className="absolute left-3 top-3 z-10 bg-soul px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                <SlotText
                  slotKey="shop.grade.3.badge"
                  resolved={texts["shop.grade.3.badge"]}
                  editMode={editMode}
                />
              </span>
              <SlotImage
                slotKey="shop.grade.3"
                resolved={slots["shop.grade.3"]}
                editMode={editMode}
              />
            </figure>
            <div className="flex flex-1 flex-col p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                <SlotText
                  slotKey="shop.grade.3.label"
                  resolved={texts["shop.grade.3.label"]}
                  editMode={editMode}
                />
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.grade.3.title"
                  resolved={texts["shop.grade.3.title"]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.3.subtitle"
                  resolved={texts["shop.grade.3.subtitle"]}
                  editMode={editMode}
                />
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SvcBadge>
                  <SlotText
                    slotKey="shop.grade.3.badge.common"
                    resolved={texts["shop.grade.3.badge.common"]}
                    editMode={editMode}
                  />
                </SvcBadge>
                <SvcBadge>
                  <SlotRichText
                    slotKey="shop.grade.3.badge.coat"
                    resolved={texts["shop.grade.3.badge.coat"]}
                    editMode={editMode}
                  />
                </SvcBadge>
                <SvcBadge>
                  <SlotRichText
                    slotKey="shop.grade.3.badge.colors"
                    resolved={texts["shop.grade.3.badge.colors"]}
                    editMode={editMode}
                  />
                </SvcBadge>
              </div>
              <SlotText
                slotKey="shop.grade.3.body"
                resolved={texts["shop.grade.3.body"]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                <SlotText
                  slotKey="shop.grade.3.colors.label"
                  resolved={texts["shop.grade.3.colors.label"]}
                  editMode={editMode}
                />
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(DD) as (keyof typeof DD)[]).map((id) => (
                  <MiniSwatch key={id} id={id} />
                ))}
              </div>
              <div className="mt-4 border-t border-hair-soft pt-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  <SlotText
                    slotKey="shop.grade.3.suited.label"
                    resolved={texts["shop.grade.3.suited.label"]}
                    editMode={editMode}
                  />
                </p>
                <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                  <SlotText
                    slotKey="shop.grade.3.suited.body"
                    resolved={texts["shop.grade.3.suited.body"]}
                    editMode={editMode}
                  />
                </p>
              </div>
              <p className="mt-5 text-2xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.grade.3.price"
                  resolved={texts["shop.grade.3.price"]}
                  editMode={editMode}
                />{" "}
                <small className="text-[11px] font-normal text-carbon-soft">
                  <SlotText
                    slotKey="shop.grade.3.price.note"
                    resolved={texts["shop.grade.3.price.note"]}
                    editMode={editMode}
                  />
                </small>
              </p>
              <ServiceSimLink
                grade="premium"
                className="mt-5 flex items-center justify-center gap-1 bg-carbon py-3 text-sm tracking-[0.08em] text-paper transition-colors hover:bg-carbon/85"
              >
                <SlotText
                  slotKey="shop.grade.3.cta"
                  resolved={texts["shop.grade.3.cta"]}
                  editMode={editMode}
                />
                <span aria-hidden="true">→</span>
              </ServiceSimLink>
            </div>
          </div>
        </Reveal>
        <SlotRichText
          slotKey="shop.grades.footnote"
          resolved={texts["shop.grades.footnote"]}
          editMode={editMode}
          as="p"
          className="mt-6 text-xs leading-6 text-carbon-soft"
        />
      </Section>

      {/* ============ SEC.02 見積もりシミュレータ ============ */}
      <Section id="sim" className="scroll-mt-20">
        <SectionMark no="SEC. 02" label="ESTIMATE SIMULATOR" />
        <SecTitle>
          <SlotText
            slotKey="shop.simulator.heading"
            resolved={texts["shop.simulator.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="shop.simulator.lead"
            resolved={texts["shop.simulator.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10">
          <ShopSimulator
            priceTable={priceTable}
            texts={texts}
            editMode={editMode}
          />
        </Reveal>
      </Section>

      {/* ============ SEC.03 塗装済み製品 ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="READY-MADE — 塗装済み製品" />
        <SecTitle>
          <SlotText
            slotKey="shop.products.heading"
            resolved={texts["shop.products.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="shop.products.lead"
            resolved={texts["shop.products.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-3">
          {/* 8色セット */}
          <article className="kt-product-card flex flex-col border border-hair bg-paper">
            <div className="relative">
              <span className="absolute left-3 top-3 z-10 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                <SlotText
                  slotKey="shop.product.1.badge"
                  resolved={texts["shop.product.1.badge"]}
                  editMode={editMode}
                />
              </span>
              <SlotImage
                slotKey="shop.product.1"
                resolved={slots["shop.product.1"]}
                editMode={editMode}
                placeholder={<ShopProduct1Placeholder />}
              />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-bold tracking-wider">
                <SlotText
                  slotKey="shop.product.1.title"
                  resolved={texts["shop.product.1.title"]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey="shop.product.1.sku"
                  resolved={texts["shop.product.1.sku"]}
                  editMode={editMode}
                />
              </p>
              <SlotText
                slotKey="shop.product.1.body"
                resolved={texts["shop.product.1.body"]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <ul className="mt-4 space-y-2 border-t border-hair-soft pt-4 text-[13px]">
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.1.spec.1.label"
                      resolved={texts["shop.product.1.spec.1.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.1.spec.1.value"
                      resolved={texts["shop.product.1.spec.1.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.1.spec.2.label"
                      resolved={texts["shop.product.1.spec.2.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.1.spec.2.value"
                      resolved={texts["shop.product.1.spec.2.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.1.spec.3.label"
                      resolved={texts["shop.product.1.spec.3.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.1.spec.3.value"
                      resolved={texts["shop.product.1.spec.3.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-5 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.product.1.price"
                  resolved={texts["shop.product.1.price"]}
                  editMode={editMode}
                />
                <small className="ml-2 text-[11px] font-normal text-carbon-soft">
                  <SlotText
                    slotKey="shop.product.1.price.note"
                    resolved={texts["shop.product.1.price.note"]}
                    editMode={editMode}
                  />
                </small>
              </p>
            </div>
          </article>

          {/* 単色 */}
          <article className="kt-product-card flex flex-col border border-hair bg-paper">
            <div className="relative">
              <span className="absolute left-3 top-3 z-10 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                <SlotText
                  slotKey="shop.product.2.badge"
                  resolved={texts["shop.product.2.badge"]}
                  editMode={editMode}
                />
              </span>
              <SlotImage
                slotKey="shop.product.2"
                resolved={slots["shop.product.2"]}
                editMode={editMode}
                placeholder={<ShopProduct2Placeholder />}
              />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-bold tracking-wider">
                <SlotText
                  slotKey="shop.product.2.title"
                  resolved={texts["shop.product.2.title"]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey="shop.product.2.sku"
                  resolved={texts["shop.product.2.sku"]}
                  editMode={editMode}
                />
              </p>
              <SlotText
                slotKey="shop.product.2.body"
                resolved={texts["shop.product.2.body"]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <ul className="mt-4 space-y-2 border-t border-hair-soft pt-4 text-[13px]">
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.2.spec.1.label"
                      resolved={texts["shop.product.2.spec.1.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.2.spec.1.value"
                      resolved={texts["shop.product.2.spec.1.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.2.spec.2.label"
                      resolved={texts["shop.product.2.spec.2.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.2.spec.2.value"
                      resolved={texts["shop.product.2.spec.2.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.2.spec.3.label"
                      resolved={texts["shop.product.2.spec.3.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.2.spec.3.value"
                      resolved={texts["shop.product.2.spec.3.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-5 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.product.2.price"
                  resolved={texts["shop.product.2.price"]}
                  editMode={editMode}
                />
                <small className="ml-2 text-[11px] font-normal text-carbon-soft">
                  <SlotText
                    slotKey="shop.product.2.price.note"
                    resolved={texts["shop.product.2.price.note"]}
                    editMode={editMode}
                  />
                </small>
              </p>
            </div>
          </article>

          {/* 受注制作 */}
          <article className="kt-product-card flex flex-col border border-hair bg-paper">
            <div className="relative">
              <span className="absolute left-3 top-3 z-10 bg-soul px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                <SlotText
                  slotKey="shop.product.3.badge"
                  resolved={texts["shop.product.3.badge"]}
                  editMode={editMode}
                />
              </span>
              <SlotImage
                slotKey="shop.product.3"
                resolved={slots["shop.product.3"]}
                editMode={editMode}
                placeholder={<ShopProduct3Placeholder />}
              />
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-bold tracking-wider">
                <SlotText
                  slotKey="shop.product.3.title"
                  resolved={texts["shop.product.3.title"]}
                  editMode={editMode}
                />
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                <SlotText
                  slotKey="shop.product.3.sku"
                  resolved={texts["shop.product.3.sku"]}
                  editMode={editMode}
                />
              </p>
              <SlotText
                slotKey="shop.product.3.body"
                resolved={texts["shop.product.3.body"]}
                editMode={editMode}
                className="mt-4 text-sm leading-7 text-carbon-mid"
              />
              <ul className="mt-4 space-y-2 border-t border-hair-soft pt-4 text-[13px]">
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.3.spec.1.label"
                      resolved={texts["shop.product.3.spec.1.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.3.spec.1.value"
                      resolved={texts["shop.product.3.spec.1.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.3.spec.2.label"
                      resolved={texts["shop.product.3.spec.2.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.3.spec.2.value"
                      resolved={texts["shop.product.3.spec.2.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">
                    <SlotText
                      slotKey="shop.product.3.spec.3.label"
                      resolved={texts["shop.product.3.spec.3.label"]}
                      editMode={editMode}
                    />
                  </span>
                  <span className="text-right text-carbon-mid">
                    <SlotText
                      slotKey="shop.product.3.spec.3.value"
                      resolved={texts["shop.product.3.spec.3.value"]}
                      editMode={editMode}
                    />
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-5 text-xl font-bold tracking-wider">
                <SlotText
                  slotKey="shop.product.3.price"
                  resolved={texts["shop.product.3.price"]}
                  editMode={editMode}
                />
                <small className="ml-2 text-[11px] font-normal text-carbon-soft">
                  <SlotText
                    slotKey="shop.product.3.price.note"
                    resolved={texts["shop.product.3.price.note"]}
                    editMode={editMode}
                  />
                </small>
              </p>
            </div>
          </article>
        </Reveal>
        <SlotText
          slotKey="shop.products.footnote"
          resolved={texts["shop.products.footnote"]}
          editMode={editMode}
          className="mt-6 text-xs leading-6 text-carbon-soft"
        />
      </Section>

      {/* ============ SEC.04 購入の流れ ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="HOW TO ORDER" />
        <SecTitle>
          <SlotText
            slotKey="shop.flow.heading"
            resolved={texts["shop.flow.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="shop.flow.lead"
            resolved={texts["shop.flow.lead"]}
            editMode={editMode}
          />
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUY_FLOW_STEPS.map((step) => (
            <div key={step} className="border border-hair bg-paper p-5">
              <span className="font-mono text-[10px] tracking-[0.2em] text-soul">
                <SlotText
                  slotKey={`shop.flow.${step}.no`}
                  resolved={texts[`shop.flow.${step}.no`]}
                  editMode={editMode}
                />
              </span>
              <h4 className="mt-2 text-[15px] font-bold tracking-wider">
                <SlotText
                  slotKey={`shop.flow.${step}.title`}
                  resolved={texts[`shop.flow.${step}.title`]}
                  editMode={editMode}
                />
              </h4>
              <SlotText
                slotKey={`shop.flow.${step}.body`}
                resolved={texts[`shop.flow.${step}.body`]}
                editMode={editMode}
                className="mt-3 text-[13px] leading-6 text-carbon-mid"
              />
              <p className="mt-3 border-t border-hair-soft pt-3 text-[12px] leading-5 text-carbon-soft">
                <SlotRichText
                  slotKey={`shop.flow.${step}.meta`}
                  resolved={texts[`shop.flow.${step}.meta`]}
                  editMode={editMode}
                />
              </p>
            </div>
          ))}
        </Reveal>
        <SlotRichText
          slotKey="shop.flow.footnote"
          resolved={texts["shop.flow.footnote"]}
          editMode={editMode}
          as="p"
          className="mt-6 text-xs leading-6 text-carbon-soft"
        />
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <SlotText
            slotKey="shop.cta.heading"
            resolved={texts["shop.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="shop.cta.note"
            resolved={texts["shop.cta.note"]}
            editMode={editMode}
          />
        }
        href="/contact"
        label={texts["shared.cta.consult"].text}
      />
    </>
  );
}
