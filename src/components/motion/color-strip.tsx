"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { resolveStripWheel } from "./strip-wheel";

/**
 * カラーストリップの横スクロールコンテナ (legacy/js/main.js:197-210 の移植)。
 *
 * - children はサーバーでレンダー済みの静的な Link カード群をパススルーする
 *   (この境界だけが client。SSG 非退行 — docs/design/motion-gap-report.md §6)。
 * - React の onWheel はルートに passive 登録され preventDefault が効かないため、
 *   native listener を { passive: false } で直接張る (旧 main.js:209 と同義)。
 *   ★ onWheel prop への置き換え禁止 — preventDefault が無効になりページも
 *   同時にスクロールしてしまう (docs/design/motion-specs/page-home.md リスク節)。
 * - wheel はホイール/トラックパッド環境でのみ発火するため pointer: fine ガードは
 *   不要 (タッチは native の横スワイプ・スクロールスナップがそのまま効く)。
 * - reduced-motion でも無効化しない: これはアニメーションではなく、ユーザー入力
 *   の 1:1 な直接操作のため (旧実装も同様にガードなし)。
 */
export function ColorStrip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;

    function onWheel(e: WheelEvent) {
      if (!strip) return;
      const delta = resolveStripWheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        scrollLeft: strip.scrollLeft,
        clientWidth: strip.clientWidth,
        scrollWidth: strip.scrollWidth,
      });
      if (delta === null) return;
      e.preventDefault();
      strip.scrollLeft += delta;
    }

    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={ref} className={cn("kt-color-strip", className)}>
      {children}
    </div>
  );
}
