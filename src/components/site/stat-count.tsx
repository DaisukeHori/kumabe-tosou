"use client";

import { useEffect, useRef, useState } from "react";

/**
 * legacy/js/main.js「v2.4 — 数字のカウントアップ」の移植。
 * ビュー内に入ったら 0 → target へ ease-out で駆け上がる。
 * prefers-reduced-motion: reduce では即座に目標値を表示する。
 */
export function StatCount({ target }: { target: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setValue(target);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            const duration = 1100;
            const start = performance.now();
            const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
            const step = (ts: number) => {
              const p = Math.min(1, (ts - start) / duration);
              setValue(Math.round(easeOut(p) * target));
              if (p < 1) {
                window.requestAnimationFrame(step);
              } else {
                setValue(target);
              }
            };
            window.requestAnimationFrame(step);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return <span ref={ref}>{value}</span>;
}
