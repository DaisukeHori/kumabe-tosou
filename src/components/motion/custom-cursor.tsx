"use client";

import { useEffect, useRef, useState } from "react";

/**
 * カスタムカーソル — legacy/js/main.js:101-160 の移植。
 * - ドットは mousemove で 1:1 追従、リングは rAF ループで lerp(0.18) 追従
 * - hover 対象は document への mouseover 委譲で判定 (旧 main.js:148-160)
 * - ガード: pointer:fine かつ prefers-reduced-motion: no-preference のときだけ
 *   マウント後に描画する (SSR/SSG の HTML には一切出力されない)。
 *   旧はロード時 1 回評価 (main.js:73-74) だったが、matchMedia change も購読して
 *   実行中の設定変更に追従する。
 */
export function CustomCursor() {
  const [enabled, setEnabled] = useState(false);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const noMotion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const update = () => setEnabled(fine.matches && noMotion.matches);
    update();
    fine.addEventListener("change", update);
    noMotion.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      noMotion.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    document.body.classList.add("kt-has-cursor", "kt-cursor-hidden");

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let visible = false;
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (!visible) {
        visible = true;
        document.body.classList.remove("kt-cursor-hidden");
      }
      dot.style.left = `${mx}px`;
      dot.style.top = `${my}px`;
    };

    const onLeave = () => {
      visible = false;
      document.body.classList.add("kt-cursor-hidden");
    };

    /* 旧 main.js:148-160。VIEW 対象:
       - data-cursor="view" (M4 各班が付与するオプトイン共通フック)
       - a[href^="/colors#"] (home のカラーカード。旧 a.drawdown 相当) */
    const onOver = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-cursor="view"], a[href^="/colors#"]')) {
        ring.classList.add("is-view");
        ring.classList.remove("is-link");
      } else if (t.closest('a, button, input, label, [role="button"]')) {
        ring.classList.add("is-link");
        ring.classList.remove("is-view");
      } else {
        ring.classList.remove("is-link", "is-view");
      }
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const loop = () => {
      rx = lerp(rx, mx, 0.18); /* 正典: lerp 係数 0.18 (main.js:139) */
      ry = lerp(ry, my, 0.18);
      ring.style.left = `${rx}px`;
      ring.style.top = `${ry}px`;
      raf = window.requestAnimationFrame(loop);
    };

    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseover", onOver, { passive: true });
    raf = window.requestAnimationFrame(loop);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseover", onOver);
      window.cancelAnimationFrame(raf);
      document.body.classList.remove("kt-has-cursor", "kt-cursor-hidden");
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div ref={dotRef} className="kt-cursor-dot" aria-hidden="true" />
      <div ref={ringRef} className="kt-cursor-ring" aria-hidden="true">
        <span className="kt-cursor-label">VIEW</span>
      </div>
    </>
  );
}
