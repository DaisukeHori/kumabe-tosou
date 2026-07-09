"use client";

import { useEffect } from "react";

import {
  applyInkCssVar,
  resolveCssColorValue,
  resolveInkColor,
  writeStoredInk,
} from "./ink-carry";

/**
 * [Wave5 W5-A] インク引き継ぎ — colors ページ側の記録役。
 * DOM 契約: `.kt-color-entry[data-ink]` (data-ink には sw.a と同じ
 * "var(--dd-xxx-a)" 形式の CSS var 参照、または直接 hex を渡してよい)。
 *
 * IntersectionObserver で「今いちばん画面に見えている色見本」を追跡し、
 * 変化するたびに WCAG コントラスト判定 (ink-carry.ts の resolveInkColor) を通した
 * 色を sessionStorage に保存 + document.documentElement の --kt-ink に反映する。
 * colors-tilt.tsx とは別コンポーネントとして分離 (実装計画 §5 W5-A の指示どおり)。
 * editMode では /edit iframe のホットスポット計測ノイズになるためマウントしない
 * (呼び出し側の colors/page-body.tsx が editMode で分岐する)。
 * render は null — Server Component ツリーを汚さない。
 */
export function InkRecorder() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;

    const entries = Array.from(
      document.querySelectorAll<HTMLElement>(".kt-color-entry[data-ink]"),
    );
    if (entries.length === 0) return;

    const visibleRatios = new Map<HTMLElement, number>();

    const io = new IntersectionObserver(
      (ioEntries) => {
        ioEntries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            visibleRatios.set(el, entry.intersectionRatio);
          } else {
            visibleRatios.delete(el);
          }
        });

        // 可視集合の中で最も intersectionRatio が高い (= 最も画面中央寄りに
        // 見えている) ものを「直近閲覧した色」として採用する。
        let best: HTMLElement | null = null;
        let bestRatio = 0;
        visibleRatios.forEach((ratio, el) => {
          if (ratio >= bestRatio) {
            bestRatio = ratio;
            best = el;
          }
        });
        if (!best) return;

        const raw = (best as HTMLElement).dataset.ink;
        if (!raw) return;
        const resolvedSource = resolveCssColorValue(raw);
        const ink = resolveInkColor(resolvedSource);
        writeStoredInk(ink);
        applyInkCssVar(ink);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    entries.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
