import Link from "next/link";

import type { HelpDoc, HelpSection, HelpUseCase } from "../types";
import { AnnotatedScreenshot } from "./annotated-screenshot";
import { FaqList } from "./faq-list";
import { FlowSteps } from "./flow-steps";
import { InlineText } from "./inline-text";
import { PersonaCard } from "./persona-card";

/**
 * ヘルプ本文のレンダラー。canonical: docs/design/admin-help/README.md §3 の 7 構成を
 * 常にこの順番で描く (ページごとに順番を変えない)。
 *   1 このページでできること / 2 利用のフロー / 3 画面の見方 /
 *   4 こんなときは / 5 よくある質問 / 6 関連するページ / 7 用語 (任意)
 */

export const HELP_PART_IDS = {
  summary: "help-summary",
  flow: "help-flow",
  sections: "help-sections",
  useCases: "help-usecases",
  faqs: "help-faqs",
  related: "help-related",
  glossary: "help-glossary",
} as const;

export function helpSectionAnchor(sectionId: string): string {
  return `help-section-${sectionId}`;
}

/** 左側の目次。本文中の見出しへのアンカーリンクだけを並べる。 */
export function HelpToc({ doc }: { doc: HelpDoc }) {
  return (
    <nav aria-label="このページの目次" className="flex flex-col gap-1 text-sm" data-help-toc="">
      <TocLink href={HELP_PART_IDS.summary} label="このページでできること" />
      <TocLink href={HELP_PART_IDS.flow} label="利用のフロー" />
      <TocLink href={HELP_PART_IDS.sections} label="画面の見方" />
      {doc.sections.map((section) => (
        <TocLink
          key={section.id}
          href={helpSectionAnchor(section.id)}
          label={section.heading}
          nested
        />
      ))}
      <TocLink href={HELP_PART_IDS.useCases} label="こんなときは" />
      <TocLink href={HELP_PART_IDS.faqs} label="よくある質問" />
      <TocLink href={HELP_PART_IDS.related} label="関連するページ" />
      {doc.glossary && doc.glossary.length > 0 ? (
        <TocLink href={HELP_PART_IDS.glossary} label="用語" />
      ) : null}
    </nav>
  );
}

function TocLink({ href, label, nested = false }: { href: string; label: string; nested?: boolean }) {
  return (
    <a
      href={`#${href}`}
      className={`rounded px-2 py-1 hover:bg-muted ${nested ? "pl-5 text-muted-foreground" : "font-semibold text-foreground"}`}
    >
      {label}
    </a>
  );
}

export function HelpRenderer({ doc }: { doc: HelpDoc }) {
  return (
    <article className="flex flex-col gap-8" data-help-doc={doc.slug}>
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-foreground">{doc.title} の使い方</h1>
        <p className="text-sm text-muted-foreground">
          管理画面の場所:{" "}
          <Link href={doc.adminPath} className="underline underline-offset-4">
            {doc.adminPath}
          </Link>
        </p>
      </header>

      <HelpPart id={HELP_PART_IDS.summary} part="summary" heading="1. このページでできること">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-foreground">
          {doc.summary.map((line, index) => (
            <li key={index}>
              <InlineText text={line} />
            </li>
          ))}
        </ul>
      </HelpPart>

      <HelpPart id={HELP_PART_IDS.flow} part="flow" heading="2. 利用のフロー">
        <FlowSteps steps={doc.flow} />
      </HelpPart>

      <HelpPart id={HELP_PART_IDS.sections} part="sections" heading="3. 画面の見方">
        <div className="flex flex-col gap-8">
          {doc.sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>
      </HelpPart>

      <HelpPart id={HELP_PART_IDS.useCases} part="useCases" heading="4. こんなときは">
        <div className="flex flex-col gap-6">
          {doc.useCases.map((useCase, index) => (
            <UseCaseBlock key={index} useCase={useCase} />
          ))}
        </div>
      </HelpPart>

      <HelpPart id={HELP_PART_IDS.faqs} part="faqs" heading="5. よくある質問">
        <FaqList faqs={doc.faqs} />
      </HelpPart>

      <HelpPart id={HELP_PART_IDS.related} part="related" heading="6. 関連するページ">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {doc.related.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="underline underline-offset-4">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </HelpPart>

      {doc.glossary && doc.glossary.length > 0 ? (
        <HelpPart id={HELP_PART_IDS.glossary} part="glossary" heading="7. 用語">
          <dl className="flex flex-col gap-2 text-sm">
            {doc.glossary.map((entry) => (
              <div key={entry.term} className="rounded-lg border border-border bg-card p-3">
                <dt className="font-bold text-foreground">{entry.term}</dt>
                <dd className="mt-0.5 text-muted-foreground">
                  <InlineText text={entry.meaning} />
                </dd>
              </div>
            ))}
          </dl>
        </HelpPart>
      ) : null}
    </article>
  );
}

function HelpPart({
  id,
  part,
  heading,
  children,
}: {
  id: string;
  part: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-help-part={part} className="flex scroll-mt-20 flex-col gap-3">
      <h2 className="border-b border-border pb-1 font-heading text-lg font-bold text-foreground">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function SectionBlock({ section }: { section: HelpSection }) {
  return (
    <section id={helpSectionAnchor(section.id)} className="flex scroll-mt-20 flex-col gap-2">
      <h3 className="text-base font-bold text-foreground">{section.heading}</h3>
      {section.body.map((paragraph, index) => (
        <p key={index} className="text-sm leading-relaxed text-muted-foreground">
          <InlineText text={paragraph} />
        </p>
      ))}
      {section.screenshot ? <AnnotatedScreenshot shot={section.screenshot} /> : null}
      {section.items && section.items.length > 0 ? (
        <ol className="flex list-none flex-col gap-2 p-0">
          {section.items.map((item) => (
            <li key={item.number} className="flex gap-3 rounded-lg border border-border bg-card p-3">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#d33] text-xs font-bold text-white"
                aria-hidden="true"
              >
                {item.number}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-bold text-foreground">{item.name}</p>
                <p className="mt-0.5 text-muted-foreground">
                  <InlineText text={item.what} />
                </p>
                {item.affects ? (
                  <p className="mt-0.5 text-muted-foreground">
                    <span className="font-semibold">関連: </span>
                    <InlineText text={item.affects} />
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {section.relations && section.relations.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {section.relations.map((relation) => (
            <li key={relation.href}>
              <Link href={relation.href} className="underline underline-offset-4">
                {relation.label}
              </Link>
              ： <InlineText text={relation.why} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function UseCaseBlock({ useCase }: { useCase: HelpUseCase }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4" data-help-usecase="">
      <h3 className="text-base font-bold text-foreground">{useCase.title}</h3>
      <PersonaCard persona={useCase.persona} />
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold">状況: </span>
        <InlineText text={useCase.situation} />
      </p>
      <ol className="flex list-none flex-col gap-2 p-0">
        {useCase.steps.map((step, index) => (
          <li key={index} className="flex gap-3">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-white"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-foreground">
                <InlineText text={step.action} />
              </p>
              <p className="text-muted-foreground">
                <span className="font-semibold">場所: </span>
                <InlineText text={step.where} />
              </p>
              <p className="text-muted-foreground">
                <span className="font-semibold">結果: </span>
                <InlineText text={step.result} />
              </p>
              {step.screenshot ? <AnnotatedScreenshot shot={step.screenshot} /> : null}
            </div>
          </li>
        ))}
      </ol>
      <p className="rounded-lg bg-muted p-3 text-sm text-foreground">
        <span className="font-semibold">これで: </span>
        <InlineText text={useCase.outcome} />
      </p>
    </div>
  );
}
