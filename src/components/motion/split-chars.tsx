import { Fragment, cloneElement, isValidElement } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

/**
 * legacy/js/main.js:213-265「A) ヒーロー見出しの1文字割り出し」の SSR 移植。
 * 旧実装は hydration 後に DOM を書き換えていたが、ここではレンダー時
 * (= SSG ビルド時) に純関数で分割するため、hydration mismatch も CLS も
 * 発生しない。"use client" を付けないこと (Server Component ツリーで使う)。
 *
 * - テキストノードを 1 文字ずつ span.kt-hero-char に変換 (要素は再帰して保存)
 * - --ci は行・要素を跨いだ通し番号 (旧 main.js:226,245-246 の counter と同義)
 * - 半角スペース / 改行 / タブは span 化せず素通し (旧 main.js:238-241)
 */

type Counter = { i: number };

const PASS_THROUGH = new Set([" ", "\n", "\t"]);

function splitNode(node: ReactNode, counter: Counter): ReactNode {
  if (node == null || typeof node === "boolean") return node;

  if (typeof node === "string" || typeof node === "number") {
    const out: ReactNode[] = [];
    // for...of はコードポイント単位 (サロゲートペアを割らない)。
    // 旧実装 (UTF-16 添字) と日本語 BMP 文字では同一の結果。
    for (const ch of String(node)) {
      if (PASS_THROUGH.has(ch)) {
        out.push(ch);
        continue;
      }
      const ci = counter.i;
      counter.i += 1;
      out.push(
        <span
          key={`ci-${ci}`}
          className="kt-hero-char"
          style={{ "--ci": ci } as CSSProperties}
        >
          {ch}
        </span>,
      );
    }
    return out;
  }

  if (Array.isArray(node)) {
    return node.map((child, idx) => (
      <Fragment key={idx}>{splitNode(child, counter)}</Fragment>
    ));
  }

  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(el, undefined, splitNode(el.props.children, counter));
  }

  return node;
}

export function SplitChars({ children }: { children: ReactNode }) {
  return <>{splitNode(children, { i: 0 })}</>;
}
