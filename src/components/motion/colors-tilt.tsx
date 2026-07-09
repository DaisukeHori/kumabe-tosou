"use client";

import { useEffect } from "react";

import { TILT_RESET, computeTilt } from "./tilt-math";

/**
 * colors ページ: ドローダウンのチルト+光沢追従ドライバ。
 * legacy/js/main.js:163-195 の移植。DOM 契約:
 *   - カード: [data-tilt] (globals.css の .kt-dd と同一要素)
 *   - グレア: カード内の [data-tilt-glare] (.kt-dd-glare)
 * pointer:fine かつ prefers-reduced-motion: no-preference のときだけ動く
 * (legacy main.js:164 の `fine && noMotionPref` ガード相当)。
 * render は null — Server Component ツリーを汚さない。
 */
export function ColorsTilt() {
  useEffect(() => {
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tilt]"),
    );
    const cleanups: Array<() => void> = [];

    cards.forEach((card) => {
      const glare = card.querySelector<HTMLElement>("[data-tilt-glare]");
      let rect: DOMRect | null = null;

      const onEnter = () => {
        rect = card.getBoundingClientRect();
        // 追従中は transform の transition を切る (.kt-dd.is-tilting)
        card.classList.add("is-tilting");
      };
      const onMove = (e: MouseEvent) => {
        if (!rect) rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width; /* 0..1 */
        const py = (e.clientY - rect.top) / rect.height; /* 0..1 */
        const v = computeTilt(px, py);
        card.style.setProperty("--rx", v.rxDeg);
        card.style.setProperty("--ry", v.ryDeg);
        if (glare) {
          glare.style.setProperty("--gx", v.gx);
          glare.style.setProperty("--gy", v.gy);
        }
      };
      const onLeave = () => {
        rect = null;
        // 先に is-tilting を外して transition を復活させてから 0 に戻す
        // → 0.45s var(--ease) でスムーズ復帰 (正典 §5「チルト reset 0.45s」)
        card.classList.remove("is-tilting");
        card.style.setProperty("--rx", TILT_RESET.rxDeg);
        card.style.setProperty("--ry", TILT_RESET.ryDeg);
        if (glare) {
          glare.style.setProperty("--gx", TILT_RESET.gx);
          glare.style.setProperty("--gy", TILT_RESET.gy);
        }
      };

      card.addEventListener("mouseenter", onEnter);
      card.addEventListener("mousemove", onMove, { passive: true });
      card.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        card.removeEventListener("mouseenter", onEnter);
        card.removeEventListener("mousemove", onMove);
        card.removeEventListener("mouseleave", onLeave);
        card.classList.remove("is-tilting");
        card.style.removeProperty("--rx");
        card.style.removeProperty("--ry");
        if (glare) {
          glare.style.removeProperty("--gx");
          glare.style.removeProperty("--gy");
        }
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
