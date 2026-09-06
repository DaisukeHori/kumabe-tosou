import type { HelpFaq } from "../types";
import { InlineText } from "./inline-text";

/**
 * よくある質問。details/summary で開閉するので、JavaScript が動かなくても使える。
 * 印刷時は CSS (help レイアウト) で全部開いた状態にする。
 */
export function FaqList({ faqs }: { faqs: HelpFaq[] }) {
  return (
    <div className="flex flex-col gap-2" data-help-faq-list="">
      {faqs.map((faq, index) => (
        <details key={index} className="rounded-lg border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-bold text-foreground">{faq.q}</summary>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <InlineText text={faq.a} />
          </p>
        </details>
      ))}
    </div>
  );
}
