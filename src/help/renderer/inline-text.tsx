import { Fragment, type ReactNode } from "react";

/**
 * ヘルプ本文の軽い装飾。**〜** だけを太字にする (それ以外は素のテキスト)。
 * 執筆者が Markdown を全部覚えなくて済むように、記法はこれ 1 つに絞っている。
 */
export function InlineText({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

export function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter((part) => part !== "").map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
