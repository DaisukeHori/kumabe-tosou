import Link from "next/link";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/site/reveal";
import { SlotImage } from "@/components/site/slot-image";
import type { ResolvedSlot } from "@/modules/page-media/contracts";

/* ページ冒頭 (legacy .page-head) */
export function PageHead({
  index,
  en,
  title,
  lead,
}: {
  index: string;
  en: string;
  title: React.ReactNode;
  lead: string;
}) {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-6 pt-20 sm:px-8 sm:pt-28">
      <p className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
        <span>{index}</span>
        <span className="kt-rule" aria-hidden="true" />
        <span className="hidden sm:inline">{en}</span>
      </p>
      <h1 className="mt-8 text-[clamp(30px,5vw,56px)] font-bold leading-[1.35] tracking-[0.04em]">
        {title}
      </h1>
      <p className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid">
        {lead}
      </p>
    </div>
  );
}

/* セクション枠 (legacy .sec > .sec-inner) */
export function Section({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("mx-auto max-w-[1240px] px-5 py-14 sm:px-8 sm:py-20", className)}
    >
      {children}
    </section>
  );
}

/* SEC. XX — LABEL (legacy .sec-mark.reveal)
   data-sec-* はセクションインジケータ (motion/section-indicator.tsx) の
   自動発見フック。旧 main.js:271-275 の span テキスト解析の代替。 */
export function SectionMark({ no, label }: { no: string; label: string }) {
  return (
    <Reveal
      as="p"
      data-sec-mark=""
      data-sec-no={no}
      data-sec-label={label}
      className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
    >
      <span>{no}</span>
      <span className="kt-rule kt-sd-rule" aria-hidden="true" />
      <span>{label}</span>
    </Reveal>
  );
}

export function SecTitle({ children }: { children: React.ReactNode }) {
  return (
    <Reveal
      as="h2"
      className="kt-sd-title mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
    >
      {children}
    </Reveal>
  );
}

export function SecLead({ children }: { children: React.ReactNode }) {
  return (
    <Reveal
      as="p"
      className="mt-6 max-w-3xl text-[15px] leading-[2.05] text-carbon-mid"
    >
      {children}
    </Reveal>
  );
}

/* 注記 (legacy .map-note.reveal) */
export function MapNote({ children }: { children: React.ReactNode }) {
  return (
    <Reveal as="p" className="mt-6 text-xs leading-6 text-carbon-soft">
      {children}
    </Reveal>
  );
}

/* 写真 figure (legacy .photo)。
   V2a: aspect/sizes/priority は SlotImage が registry (slotKey) から引くため、
   ここでは持たない (docs/design/visual-media-editor.md §4.2)。 */
export function PhotoFigure({
  figNo,
  slotKey,
  resolved,
  editMode,
  capJa,
  capEn,
  credit,
}: {
  figNo: string;
  slotKey: string;
  resolved: ResolvedSlot;
  editMode: boolean;
  capJa: string;
  capEn: string;
  credit: string;
}) {
  return (
    <Reveal as="figure" className="kt-photo border border-hair bg-paper p-2">
      <span className="block px-1 py-1 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
        {figNo}
      </span>
      <SlotImage slotKey={slotKey} resolved={resolved} editMode={editMode} />
      <figcaption className="flex flex-col gap-1 px-1 py-2 sm:flex-row sm:items-baseline sm:justify-between">
        <span className="text-xs tracking-wider text-carbon-mid">
          {capJa}
          <span className="ml-2 font-mono text-[9px] tracking-[0.18em] text-carbon-soft">
            {capEn}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[9px] text-carbon-soft">
          {credit}
        </span>
      </figcaption>
    </Reveal>
  );
}

/* 矢印付き outline ボタン */
export function ArrowButton({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <Button
      variant="outline"
      render={<Link href={href} />}
      className="kt-btn-brush h-10 rounded-none border-carbon/40 bg-transparent px-5 tracking-[0.08em] text-carbon hover:bg-transparent hover:text-paper focus-visible:text-paper"
    >
      {children}
      <span aria-hidden="true" className="kt-btn-arrow ml-1">
        →
      </span>
    </Button>
  );
}

/* ページ末尾 CTA 帯 (legacy .cta-band) */
export function CtaBand({
  title,
  note,
  href,
  label,
}: {
  title: React.ReactNode;
  note: string;
  href: string;
  label: string;
}) {
  return (
    <section className="bg-carbon text-paper">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[clamp(22px,3vw,34px)] font-bold leading-snug tracking-[0.04em]">
            {title}
          </p>
          <p className="mt-4 text-sm leading-7 text-paper/70">{note}</p>
        </div>
        <Button
          variant="outline"
          render={<Link href={href} />}
          className="kt-btn-brush kt-btn-brush--soul h-12 shrink-0 rounded-none border-primer bg-transparent px-8 tracking-[0.12em] text-primer hover:border-soul hover:bg-transparent hover:text-white focus-visible:text-white"
        >
          {label}
          <span aria-hidden="true" className="kt-btn-arrow ml-1">
            →
          </span>
        </Button>
      </div>
    </section>
  );
}

/* 仕様表 (legacy .spec-table) */
export function SpecTable({
  rows,
}: {
  rows: { th: string; td: React.ReactNode }[];
}) {
  return (
    <table className="w-full border-t border-hair text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row.th} className="border-b border-hair">
            <th
              scope="row"
              className="w-[9.5em] py-4 pr-4 text-left align-top font-medium tracking-wider sm:w-48"
            >
              {row.th}
            </th>
            <td className="py-4 leading-7 text-carbon-mid">{row.td}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
