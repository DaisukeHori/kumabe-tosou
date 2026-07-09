"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * G6 代替: soft navigation 時のページ入場アニメーション。
 * (legacy css:1195-1203 の ::view-transition-new(root) = kt-vt-in 0.44s 相当)
 *
 * - App Router の Link 遷移ではクロスドキュメント View Transitions が発火しないため、
 *   pathname 変化を検知して WAAPI で入場のみ再現する (退場 0.28s は遷移を
 *   ブロックせずには不可能なため意図的に省略 — motion-gap-report §5 の
 *   「View Transitions out 0.28s」はフルロード遷移時のみ CSS 側で効く)。
 * - 初回ロード/リロードでは何もしない (opacity:0 開始で LCP を悪化させないため)。
 * - ハッシュのみ・クエリのみの変化では usePathname が変わらないため発火しない。
 * - WAAPI は CSS の reduced-motion キルスイッチが効かないので matchMedia で自前ガード。
 * - children は Server Component のまま素通しする (SSG 非退行)。
 * - 実装メモ: 統合計画 §1.6-7 の許容に従い、SSR での useLayoutEffect 警告を避けるため
 *   useEffect を採用 (発火が 1 フレーム遅れるだけで挙動差なし)。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    const prev = lastPathname.current;
    lastPathname.current = pathname;
    if (prev === null || prev === pathname) return; // 初回ロードは演出なし
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const animation = el.animate(
      [
        { opacity: 0, transform: "translateY(16px)" },
        { opacity: 1, transform: "none" },
      ],
      // 正典: motion-gap-report.md §5 View Transitions in 0.44s / --ease 同値
      { duration: 440, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
