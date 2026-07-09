"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { applyStoredInkVar } from "./ink-carry";

/**
 * 塗りプログレスバー — legacy/js/main.js:76-99 の移植。
 * ヘッダー下端 2px をソウルレッドで塗り進める。scaleX を rAF スロットルで直接代入。
 * 旧はページ毎フルロードだったが SPA 遷移ではマウントが持続するため、
 * usePathname を依存に取りページ遷移直後に再計算する (パラメータ変更ではなく
 * MPA→SPA のライフサイクル差の吸収)。
 *
 * 実装統合計画 §3-1-2 [採用 EXTRA]: 刷毛先端モチーフのため scaleX ではなく
 * width:100% 固定 + translateX((ratio-1)*100%) で塗り進める (::after のチップが
 * scaleX だと歪むため)。判定基準 (最上部で不可視 / 最下部で全幅 / 直接追従) は不変。
 *
 * [Wave5 W5-A] マウントのたびに sessionStorage の直近インク色を
 * document.documentElement の --kt-ink へ復元する (フルロード直後は JS が設定した
 * カスタムプロパティが消えているため。CSS 側は globals.css の
 * `background: var(--kt-ink, var(--soul))` で読む — 無指定時は従来どおり --soul)。
 */
export function PaintProgress() {
  const barRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    applyStoredInkVar();
  }, [pathname]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    let ticking = false;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = `translateX(${(ratio - 1) * 100}%)`;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  return <div ref={barRef} className="kt-paint-progress" aria-hidden="true" />;
}
