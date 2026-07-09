"use client";

import { createElement, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type IntrinsicTag = keyof React.JSX.IntrinsicElements;

interface RevealProps {
  /** レンダリングするタグ。既定は div。 */
  as?: IntrinsicTag;
  className?: string;
  children: React.ReactNode;
  /** id / style など、DOM 属性をそのまま素通しするための拡張枠。 */
  [key: string]: unknown;
}

/**
 * legacy/js/main.js「2) スクロールリビール」の移植。
 * IntersectionObserver で初回交差時に is-visible を付与し、以後は監視を解除する。
 * prefers-reduced-motion: reduce、または IntersectionObserver 非対応環境では
 * 即座に表示する（globals.css の @media (prefers-reduced-motion: reduce) にも保険あり）。
 */
export function Reveal({ as = "div", className, children, ...rest }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ビジュアルエディタ (V2b) がホットスポットの座標を再測定するためのフック
  // (docs/design/visual-media-editor.md §5.2)。reveal のトランジション完了時
  // (opacity/transform の transitionend) に window へ通知する。
  // prefers-reduced-motion 等でトランジション自体が発生しない環境の保険として、
  // 次フレームでも一度通知する (再測定は冪等な処理のため二重発火は許容する)。
  useEffect(() => {
    if (!visible) return;
    const el = ref.current;
    if (!el) return;

    function notifyRevealDone() {
      window.dispatchEvent(new CustomEvent("kmb:reveal-done"));
    }

    el.addEventListener("transitionend", notifyRevealDone);
    const raf = requestAnimationFrame(notifyRevealDone);

    return () => {
      el.removeEventListener("transitionend", notifyRevealDone);
      cancelAnimationFrame(raf);
    };
  }, [visible]);

  return createElement(
    as,
    {
      ref,
      className: cn("reveal", visible && "is-visible", className),
      ...rest,
    },
    children,
  );
}
