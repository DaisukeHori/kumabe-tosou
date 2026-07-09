"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface IndicatorItem {
  no: string;
  label: string;
}

/**
 * セクションインジケータ (右端固定ドット) — legacy/js/main.js:267-336 の移植。
 * - main 内の [data-sec-mark] を収集し、2 個以上あるページだけ描画 (旧 :269)
 * - 現在地: IO rootMargin -45%/-45% で可視集合の最小 index (旧 :307-321)
 * - 表示切替: home はヒーロー (main 内最初の section) 退場後に表示、
 *   他ページは常時表示 (旧 :323-335 — .hero は旧 index.html のみ存在した)
 * - SPA 遷移に追従するため pathname を依存に再スキャン
 */
export function SectionIndicator() {
  const pathname = usePathname();
  const [items, setItems] = useState<IndicatorItem[]>([]);
  const [current, setCurrent] = useState(-1);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setItems([]);
    setCurrent(-1);
    setActive(false);

    if (!("IntersectionObserver" in window)) return;

    const marks = Array.from(
      document.querySelectorAll<HTMLElement>("main [data-sec-mark]"),
    );
    if (marks.length < 2) return;

    setItems(
      marks.map((mark, idx) => ({
        no: (mark.dataset.secNo ?? "").replace(/[^0-9]/g, "") || String(idx + 1),
        label: (mark.dataset.secLabel ?? "").trim(),
      })),
    );

    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = marks.indexOf(entry.target as HTMLElement);
          if (entry.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        });
        if (visible.size > 0) setCurrent(Math.min(...visible));
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    marks.forEach((m) => io.observe(m));

    let toggleIo: IntersectionObserver | null = null;
    const hero =
      pathname === "/" ? document.querySelector("main section") : null;
    if (hero) {
      toggleIo = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => setActive(!entry.isIntersecting));
        },
        { threshold: 0 },
      );
      toggleIo.observe(hero);
    } else {
      setActive(true);
    }

    return () => {
      io.disconnect();
      toggleIo?.disconnect();
    };
  }, [pathname]);

  if (items.length < 2) return null;

  return (
    <nav
      className={`kt-sec-indicator${active ? " is-active" : ""}`}
      aria-hidden="true"
    >
      {items.map((item, idx) => (
        <div
          key={`${item.no}-${idx}`}
          className={`kt-sec-indicator-item${idx === current ? " is-current" : ""}`}
        >
          <span className="kt-sec-indicator-label">
            {item.label || `SEC ${item.no}`}
          </span>
          <span className="kt-sec-indicator-dot" />
        </div>
      ))}
    </nav>
  );
}
