# M1 共通署名演出 (signature) — 実装仕様書

対象: G1 カスタムカーソル / G2 塗りプログレスバー / G3 セクションインジケータ / G4 ナビ現在地+下線スライド。
実装者: Sonnet 5。本仕様のコードはそのまま貼り付け可能な粒度で書いてある。

## 0. 前提 (最重要)

- **ターゲットは main (commit 334f6fe)**。指示にあった V2a worktree `agent-a24a69628487d5f3e` は V2a/V2b マージ完了に伴い削除済み。main の `src/` が同一構造 (公開ページは `page-body.tsx` に抽出済み、`(site)` / `(editor)` route group あり) であることを確認済み。以下のパスはすべて `/Users/horidaisuke/projects/kumabe-tosou/` からの相対。
- SiteHeader (`src/components/site/site-header.tsx`) は **"use client" を持たない Server Component**。したがって G4 の usePathname は新規クライアントコンポーネント `MotionNavLink` に閉じ込める。
- `--ease: cubic-bezier(0.22,1,0.36,1)` は `src/app/globals.css:170` に定義済み。全アニメでこれを使う。
- クラス名は legacy 名をそのまま使わず **`kt-` プレフィックス** に統一 (既存 `.kt-hero-line` 等の慣例に合わせる)。対応表は §3。
- ページ JSX (`src/app/(site)/**/page-body.tsx`) は**一切触らない**。変更は layout / header / 共有コンポーネント (page-blocks.tsx の SectionMark) のみ。
- `(editor)/layout.tsx` は**触らない**。カーソル/インジケータのオーバーレイ 2 種は `(site)/layout.tsx` にのみマウント (=/edit iframe に載らない)。プログレスバーとナビ下線は SiteHeader 内部なので両レイアウトに出るが、これは「iframe 越しの見た目一致」という (editor) の設計意図に合致し、`data-editable-*` のホットスポット測定 (画像要素の getBoundingClientRect) に影響しない。
- SSG 非退行: 追加コンポーネントは全て "use client" + ブラウザ API のみ。request-time API・fetch なし。usePathname は静的プリレンダで解決される。

## 1. 変更ファイル一覧

| 種別 | ファイル | 内容 |
|---|---|---|
| 新規 | `src/components/motion/custom-cursor.tsx` | G1 |
| 新規 | `src/components/motion/paint-progress.tsx` | G2 |
| 新規 | `src/components/motion/section-indicator.tsx` | G3 |
| 新規 | `src/components/motion/nav-link.tsx` | G4 (client Link) |
| 新規 | `src/components/motion/path-current.ts` | G4 現在地判定の純関数 |
| 新規 | `src/components/motion/path-current.test.ts` | vitest |
| 変更 | `src/app/(site)/layout.tsx` | オーバーレイ 2 種のマウント |
| 変更 | `src/components/site/site-header.tsx` | PaintProgress 追加 + ナビ書き換え |
| 変更 | `src/components/site/page-blocks.tsx` | SectionMark に data 属性 3 つ追加 |
| 変更 | `src/app/globals.css` | 末尾に `/* === motion: signature === */` ブロック追記 |

---

## 2. G1 カスタムカーソル

旧実装: `legacy/js/main.js:101-160` (生成・1:1 ドット・lerp 0.18 リング・mouseover 委譲) / `legacy/css/style.css:1361-1419` (見た目)。
正典パラメータ (report §5): lerp 係数 **0.18**、リング状態 **32/48/62px**、transition **0.3s var(--ease)**、ラベル opacity 0.2s。

### 2.1 `src/components/motion/custom-cursor.tsx` (新規・全文)

```tsx
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
```

設計メモ:
- `enabled` の初期値 false → サーバー/初回クライアントとも null 描画で hydration mismatch なし。静的 HTML にカーソル DOM が入らないので、旧 CSS が JS 生成前提だった点 (media query 外では無スタイル) と同じ安全性を持つ。
- left/top・クラス切替は ref 直接操作 (React state を通すと 60fps 再レンダーになるため禁止)。
- colors ページの Drawdown (div ラップ、識別クラスなし) は現状フック不在のため VIEW にならない。M4 colors 班が `data-cursor="view"` を付けた瞬間に自動で効く (本班はセレクタだけ先に備える)。

## 3. G2 塗りプログレスバー

旧実装: `legacy/js/main.js:76-99` (rAF スロットル + scaleX 直接代入) / `legacy/css/style.css:1224-1234`。
正典パラメータ: `scaleX(scrollY / (scrollHeight - innerHeight))` を rAF で直接代入。transition なし。

### 3.1 `src/components/motion/paint-progress.tsx` (新規・全文)

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * 塗りプログレスバー — legacy/js/main.js:76-99 の移植。
 * ヘッダー下端 2px をソウルレッドで塗り進める。scaleX を rAF スロットルで直接代入。
 * 旧はページ毎フルロードだったが SPA 遷移ではマウントが持続するため、
 * usePathname を依存に取りページ遷移直後に再計算する (パラメータ変更ではなく
 * MPA→SPA のライフサイクル差の吸収)。
 */
export function PaintProgress() {
  const barRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    let ticking = false;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = `scaleX(${ratio})`;
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
```

- 旧同様、reduced-motion では殺さない (スクロール位置のフィードバックでありアニメーションではない。旧 main.js の v2.1 節もガードなし)。
- マウント先はヘッダー要素内 (§5.2)。ヘッダーは `sticky` = positioned なので `position:absolute` の基準になる。

## 4. G3 セクションインジケータ

旧実装: `legacy/js/main.js:267-336` (sec-mark 収集→nav 生成→IO 2 本) / `legacy/css/style.css:1726-1774`。
正典パラメータ: IO rootMargin **-45% 0px -45% 0px** / threshold 0、可視集合の**最小 index** を現在地、dot transition 0.3s・nav opacity 0.5s、**sec-mark 2 個以上で生成**、is-current で dot **scale(1.25)** + soul、**1100px 以下非表示**。ヒーローがあるページはヒーロー退場後に表示、なければ常時表示 (旧 main.js:323-335 — `.hero` は index.html のみ存在)。

### 4.1 `src/components/site/page-blocks.tsx` — SectionMark に発見フックを追加

`SectionMark` (page-blocks.tsx:59-70) を以下に置換 (Reveal は rest props をそのまま DOM へ素通しする実装 — reveal.tsx:15,78-85 で確認済み):

```tsx
/* SEC. XX — LABEL (legacy .sec-mark.reveal)
   data-sec-* はセクションインジケータ (motion/section-indicator.tsx) の
   自動発見フック。旧 main.js:271-275 の span テキスト解析の代替。 */
export function SectionMark({ no, label }: { no: string; label: string }) {
  return (
    <Reveal
      as="p"
      data-sec-mark=""
      data-sec-no={no}
      data-sec-label={label}
      className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
    >
      <span>{no}</span>
      <span className="h-px w-12 bg-hair" aria-hidden="true" />
      <span>{label}</span>
    </Reveal>
  );
}
```

これ 1 箇所で全ページ (home 7 / contact 4 / materials 4 / shop 4 / about 5 …) に効く。ページ JSX は不変。

### 4.2 `src/components/motion/section-indicator.tsx` (新規・全文)

```tsx
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
```

- effect は commit 後に走るため、クライアント遷移でも新ページの `[data-sec-mark]` が DOM に揃った後にスキャンされる。
- `aria-hidden="true"` + CSS `pointer-events:none` は旧仕様どおり (装飾。クリックナビ化は [EXTRA])。

## 5. G4 ナビ現在地 + 下線スライド

旧実装: `legacy/js/main.js:10-16` (data-page → is-current) / `legacy/css/style.css:127-157` (下線 scaleX 0→1、origin hover=left / leave=right、0.35s) / `style.css:1330-1331` (現在地下線は soul 赤)。
正典パラメータ: 下線 **0.35s var(--ease)**、color 0.25s、is-current = 文字 carbon / 下線 soul / ナビ番号 soul。

### 5.1 `src/components/motion/path-current.ts` (新規・全文)

```ts
/**
 * ナビ現在地判定 — legacy/js/main.js:10-16 の data-page 比較の App Router 版。
 * href 配下のサブページ (/works/[slug] 等) も現在地として扱う。
 */
export function isCurrentPath(pathname: string, href: string): boolean {
  const path =
    pathname !== "/" && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
```

### 5.2 `src/components/motion/nav-link.tsx` (新規・全文)

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { isCurrentPath } from "./path-current";

/**
 * 現在地属性付き Link。SiteHeader (Server Component) から
 * NavigationMenuLink / SheetClose の render prop に渡して使う。
 * data-current / aria-current は globals.css の .kt-nav-link 系が拾う。
 */
export function MotionNavLink({
  href,
  ...props
}: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const hrefStr =
    typeof href === "string" ? href : (href.pathname ?? "");
  const current = isCurrentPath(pathname, hrefStr);

  return (
    <Link
      href={href}
      data-current={current ? "true" : undefined}
      aria-current={current ? "page" : undefined}
      {...props}
    />
  );
}
```

### 5.3 `src/components/site/site-header.tsx` の変更

SiteHeader 自体は Server Component のまま (「"use client" を足さない」)。差分は 4 点:

1. import 追加:
```tsx
import { MotionNavLink } from "@/components/motion/nav-link";
import { PaintProgress } from "@/components/motion/paint-progress";
```

2. デスクトップナビ (site-header.tsx:50-60) を置換:
```tsx
<NavigationMenuItem key={item.href}>
  <NavigationMenuLink
    render={<MotionNavLink href={item.href} />}
    className="kt-nav-link gap-1.5 rounded-none px-2.5 text-[13px] tracking-wider hover:bg-transparent focus:bg-transparent"
  >
    <span className="kt-nav-no font-mono text-[10px] text-carbon-soft">
      {item.no}
    </span>
    {item.label}
  </NavigationMenuLink>
</NavigationMenuItem>
```
変更点: `render` を Link → MotionNavLink、`kt-nav-link`/`kt-nav-no` クラス追加、`text-carbon hover:bg-carbon/5 focus:bg-carbon/5` を削除 (文字色は globals.css の `.kt-nav-link` が carbon-mid→carbon hover で所有。hover 背景は旧サイトに存在しないため透明化)。`rounded-none` は base の rounded-lg を tailwind-merge で打ち消す。

3. モバイルナビ (site-header.tsx:95-105) の SheetClose を置換:
```tsx
<SheetClose
  key={item.href}
  render={<MotionNavLink href={item.href} />}
  className="kt-nav-link-m flex items-baseline gap-3 border-b border-hair-soft py-3 text-sm tracking-wider text-carbon"
>
  <span className="kt-nav-no font-mono text-[10px] text-carbon-soft">
    {item.no}
  </span>
  {item.label}
</SheetClose>
```
(クラス追加は `kt-nav-link-m` と `kt-nav-no` のみ。下線スライドはデスクトップ限定、モバイルは番号の赤で現在地表示。)

4. `</header>` 直前 (site-header.tsx:115 `</div>` の後) に `<PaintProgress />` を挿入。

「相談する」CTA (`nav-cta` 相当) は **G5 刷毛ストローク班 (M2) の担当** — 本班では触らない。

### 5.4 `src/app/(site)/layout.tsx` の変更

return 部のみ変更 ((editor)/layout.tsx は触らない):

```tsx
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(LOCAL_BUSINESS_JSON_LD),
        }}
      />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      {/* 署名演出オーバーレイ (M1)。/edit iframe に載せないため (site) 限定 */}
      <CustomCursor />
      <SectionIndicator />
    </>
```

import 追加:
```tsx
import { CustomCursor } from "@/components/motion/custom-cursor";
import { SectionIndicator } from "@/components/motion/section-indicator";
```

## 6. `src/app/globals.css` 末尾追記 (全文貼り付け)

既存ファイル最終行 (`.kt-marquee-track { animation: none; }` を閉じる `}` ) の後に追記:

```css
/* === motion: signature === */
/* M1 共通署名演出: G1 カーソル / G2 プログレスバー / G3 インジケータ / G4 ナビ。
   正典: docs/design/motion-gap-report.md §5。easing は --ease を使い回す。 */

/* ---------- G2 塗りプログレスバー (旧 css:1224-1234) ---------- */
.kt-paint-progress {
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 100%;
  height: 2px;
  background: var(--soul);
  transform: scaleX(0);
  transform-origin: left;
  pointer-events: none;
}

/* ---------- G4 ナビ現在地 + 下線スライド (旧 css:127-157, 1330-1331) ---------- */
.kt-nav-link {
  position: relative;
  color: var(--carbon-mid);
  transition: color 0.25s var(--ease);
}
.kt-nav-link:hover,
.kt-nav-link:focus-visible {
  color: var(--carbon);
}
.kt-nav-link::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 4px;
  height: 1px;
  background: var(--carbon);
  transform: scaleX(0);
  transform-origin: right; /* leave 時: 右へ縮んで消える */
  transition: transform 0.35s var(--ease);
}
.kt-nav-link:hover::after,
.kt-nav-link:focus-visible::after {
  transform: scaleX(1);
  transform-origin: left; /* hover 時: 左から伸びる */
}
.kt-nav-link[data-current="true"] {
  color: var(--carbon);
}
.kt-nav-link[data-current="true"]::after {
  transform: scaleX(1);
  background: var(--soul); /* 旧 css:1330-1331 現在地は赤 */
}
.kt-nav-link[data-current="true"] .kt-nav-no,
.kt-nav-link-m[data-current="true"] .kt-nav-no {
  color: var(--soul); /* 旧 css:157 */
}

/* ---------- G3 セクションインジケータ (旧 css:1726-1774) ---------- */
.kt-sec-indicator {
  position: fixed;
  right: clamp(12px, 2vw, 26px);
  top: 50%;
  transform: translateY(-50%);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.5s var(--ease);
}
.kt-sec-indicator.is-active {
  opacity: 1;
}
.kt-sec-indicator-item {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}
.kt-sec-indicator-label {
  font-family: var(--font-legacy-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--carbon-soft);
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 0.3s var(--ease), transform 0.3s var(--ease);
  white-space: nowrap;
}
.kt-sec-indicator-dot {
  width: 7px;
  height: 7px;
  border: 1px solid var(--carbon-soft);
  border-radius: 50%;
  flex: none;
  transition:
    background 0.3s var(--ease),
    border-color 0.3s var(--ease),
    transform 0.3s var(--ease);
}
.kt-sec-indicator-item.is-current .kt-sec-indicator-dot {
  background: var(--soul);
  border-color: var(--soul);
  transform: scale(1.25);
}
.kt-sec-indicator-item.is-current .kt-sec-indicator-label {
  opacity: 1;
  transform: translateX(0);
  color: var(--carbon);
}
@media (max-width: 1100px) {
  .kt-sec-indicator {
    display: none;
  }
}

/* ---------- G1 カスタムカーソル (旧 css:1361-1419) ---------- */
@media (pointer: fine) and (prefers-reduced-motion: no-preference) {
  body.kt-has-cursor,
  body.kt-has-cursor a,
  body.kt-has-cursor button,
  body.kt-has-cursor input,
  body.kt-has-cursor label {
    cursor: none;
  }
  .kt-cursor-dot {
    position: fixed;
    top: 0;
    left: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--carbon);
    pointer-events: none;
    z-index: 9999;
    transform: translate(-50%, -50%);
  }
  .kt-cursor-ring {
    position: fixed;
    top: 0;
    left: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(23, 25, 27, 0.55);
    background: rgba(168, 15, 34, 0);
    pointer-events: none;
    z-index: 9998;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    transition:
      width 0.3s var(--ease),
      height 0.3s var(--ease),
      border-color 0.3s var(--ease),
      background-color 0.3s var(--ease);
  }
  .kt-cursor-label {
    font-family: var(--font-legacy-mono);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: #fff;
    opacity: 0;
    transition: opacity 0.2s var(--ease);
    user-select: none;
  }
  .kt-cursor-ring.is-link {
    width: 48px;
    height: 48px;
    border-color: var(--carbon);
  }
  .kt-cursor-ring.is-view {
    width: 62px;
    height: 62px;
    border-color: var(--soul);
    background: rgba(168, 15, 34, 0.92);
  }
  .kt-cursor-ring.is-view .kt-cursor-label {
    opacity: 1;
  }
  body.kt-cursor-hidden .kt-cursor-dot,
  body.kt-cursor-hidden .kt-cursor-ring {
    opacity: 0;
  }
}

/* ---------- 一括キルスイッチ (旧 css:1130-1136 方式) ----------
   既存の個別 reduce 対応 (globals.css:358-377) に加える site 全体の保険。
   M1 が導入点だが全班共通の前提 (他班が重複追記しても冪等)。 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

## 7. クラス名対応表 (旧 → 新)

| 旧 (legacy) | 新 (kt-) |
|---|---|
| `.cursor-dot` / `.cursor-ring` / `.cursor-label` | `.kt-cursor-dot` / `.kt-cursor-ring` / `.kt-cursor-label` |
| `body.has-cursor` / `body.cursor-hidden` | `body.kt-has-cursor` / `body.kt-cursor-hidden` |
| `.paint-progress` | `.kt-paint-progress` |
| `.sec-indicator(-item/-label/-dot)` | `.kt-sec-indicator(-item/-label/-dot)` |
| `.global-nav a` (+`.is-current`) | `.kt-nav-link[data-current="true"]` |
| `.nav-no` | `.kt-nav-no` |
| `.sec-mark` (DOM 収集) | `[data-sec-mark]` + `data-sec-no` / `data-sec-label` |

## 8. `src/components/motion/path-current.test.ts` (新規・全文)

```ts
import { describe, expect, it } from "vitest";

import { isCurrentPath } from "./path-current";

describe("isCurrentPath", () => {
  it("ルートは完全一致のみ", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/story", "/")).toBe(false);
  });
  it("完全一致で現在地", () => {
    expect(isCurrentPath("/works", "/works")).toBe(true);
    expect(isCurrentPath("/colors", "/colors")).toBe(true);
  });
  it("配下ページも現在地 (works/notes の詳細)", () => {
    expect(isCurrentPath("/works/some-slug", "/works")).toBe(true);
    expect(isCurrentPath("/notes/2026-01", "/notes")).toBe(true);
  });
  it("前方一致の誤検知をしない", () => {
    expect(isCurrentPath("/shopping", "/shop")).toBe(false);
    expect(isCurrentPath("/notes-archive", "/notes")).toBe(false);
  });
  it("trailing slash を正規化", () => {
    expect(isCurrentPath("/works/", "/works")).toBe(true);
  });
  it("非該当", () => {
    expect(isCurrentPath("/about", "/story")).toBe(false);
  });
});
```

## 9. 受入条件

**ビルド/退行なし**
1. `npm run build` 成功。ビルド出力で `(site)` 配下の全ルートが従来どおり Static/SSG (`ƒ Dynamic` への退行ゼロ)。
2. `npm test` (vitest) 全件 PASS (既存 247 件 + path-current 新規)。
3. ブラウザ console にエラー/警告なし (hydration mismatch なし)。

**G1 カーソル** (デスクトップ Chrome、pointer:fine)
4. 初期状態でドット/リング不可視 → 最初の mousemove で出現。ドットは即時追従、リングは遅れて追従 (lerp 0.18 の「ぬるっ」とした残り)。
5. ナビリンク・ボタン・フッターリンクに hover → リング 48px / carbon 枠。home の COLOR LINEUP カード (`a[href^="/colors#"]`) に hover → リング 62px / 赤塗り + 白字「VIEW」。
6. `body` と a/button/input/label 上でネイティブカーソル非表示 (cursor:none)。textarea 上はネイティブカーソル (旧仕様どおり)。
7. ウィンドウ外へマウスを出すと両者フェード消滅、戻すと復帰。
8. DevTools エミュレーションで pointer:coarse (タッチ) → カーソル DOM 自体が存在しない。prefers-reduced-motion: reduce → 同じく存在しない。
9. /edit/... (iframe プレビュー) と /admin にカーソル DOM が存在しない。

**G2 プログレスバー**
10. 全公開ページでヘッダー下端に赤 2px。ページ最上部で幅 0、最下部で全幅。スクロールに滑らかに追従 (transition なしの直接追従)。
11. クライアント遷移 (ナビリンククリック) 直後に前ページの進捗が残らない。
12. スクロールが発生しない短いページで幅 0 のまま。

**G3 インジケータ**
13. home: ヒーロー表示中は非表示 → ヒーロー通過で右端に 7 ドット出現。スクロールで現在セクションのドットが赤 + scale 1.25 + 英名ラベル表示。旧サイト (legacy を静的サーブ) と切替タイミングが体感一致 (-45%/-45% 帯)。
14. サブページ (about=5, contact=4, materials=4, shop=4) では最初から表示。SectionMark が 2 未満のページ (voices / works 一覧 / notes 一覧 / blog) では出ない。
15. ビューポート幅 1100px 以下で非表示。/edit・/admin に出ない。
16. クリック不能 (pointer-events:none) でその下の要素の操作を妨げない。

**G4 ナビ**
17. 各ページで該当ナビ項目が: 文字 carbon / 赤下線 (表示済み) / 番号 soul 赤。`aria-current="page"` が付与されている。
18. /works/[slug]・/notes/[slug] でも親項目 (施工事例/読みもの) が現在地。
19. 非現在項目は carbon-mid、hover で carbon + 下線が**左から**伸び (0.35s)、離すと**右へ**縮んで消える。hover 背景色 (旧 bg-carbon/5) は出ない。
20. モバイル Sheet 内で現在ページの番号が赤。
21. キーボード: Tab でナビ全項目にフォーカス可能 + focus-visible リング維持 + 下線表示、Enter で遷移、Esc で Sheet が閉じる (既存挙動の非退行)。

**reduced-motion 一括**
22. OS 設定 reduce で: カーソルなし / 下線・ドットの transition が実質即時 / Reveal 即時表示 / プログレスバーは機能維持。

## 10. テスト方針

- **unit (vitest)**: `path-current.test.ts` (§8)。DOM 依存ロジック (IO/rAF) は unit では追わず実機で検証する (jsdom に IO がなく偽陽性の温床のため)。
- **ビルド検証**: `npm run build` のルートテーブル diff で SSG 非退行を機械的に確認。
- **実機 E2E (Chrome MCP / Playwright MCP)**: 受入 4-22 を home / about / colors / works/[slug] / contact の 5 ページで実施。エミュレーション切替 (touch / reduced-motion) と 1100px / 880px リサイズを含める。キーボードチェックリスト (Tab/Enter/Esc/Arrow) を Sheet 開閉含めて通す。
- **旧サイト比較**: `legacy/` を `npx serve legacy` で立て、カーソル追従の残り方・インジケータ切替位置・下線の伸縮方向を並べて目視比較 (パラメータ一致の最終確認)。

## 11. 他班との境界

- ヘッダー CTA「相談する」の刷毛ストローク → **M2 (G5)**。本班は touching しない。
- `data-cursor="view"` を colors の Drawdown / チルトカードへ付与 → **M4 colors 班** (本班はセレクタ側だけ先行実装)。
- 一括キルスイッチは本班が導入。他班は自班ブロックに追加の reduce 個別対応だけ書けばよい。
- globals.css は各班「末尾に自班ブロック追記」。マージ時は `/* === motion: {班名} === */` 区切り単位で並べ直せば衝突解消できる。

---

## リスク (班申告)
- 【前提変化】指示された V2a worktree (agent-a24a69628487d5f3e) は V2a/V2b マージ完了に伴い削除済み。本仕様は main (commit 334f6fe) を対象に再検証済み。実装着手時に main が進んでいたら site-header.tsx / (site)/layout.tsx / globals.css の該当行を再確認すること
- globals.css 末尾追記は M1〜M4 全班が同じ場所を触るため、マージ順によって conflict する。区切りコメント単位の追記規約を厳守し、rebase 時はブロック順を機械的に並べ直す
- colors ページの Drawdown には識別フックがなく、data-cursor="view" を M4 colors 班が付与するまで colors ページ上で VIEW カーソルにならない (home のカラーカードは a[href^="/colors#"] で即日有効)。M4 への引き継ぎ事項
- 一括キルスイッチ (*, *::before, *::after の 0.01ms) は /admin と shadcn/tw-animate のダイアログ開閉アニメにも効く。reduced-motion 設定ユーザーには意図どおりだが、admin の UI アニメが即時になることをレビュー時に認識しておく
- Base UI の render prop (NavigationMenuLink render={<MotionNavLink/>}) で data-current/aria-current が最終的な <a> にマージされることを実装時に DOM インスペクタで必ず確認 (Base UI のバージョンによって props マージ挙動が変わり得る)
- kt-nav-link の className 上書き (rounded-none / hover:bg-transparent) は tailwind-merge の競合解決に依存。効いていなければ hover:bg-muted が残るので、受入 19 で必ず目視確認
- about ページの Google Map 等 iframe 上では mousemove が飛ばずカーソルリングが直前位置で停止する (旧サイトも同一挙動のため仕様内とするが、報告時に既知事項として明記)
- ヒーロー判定 document.querySelector("main section") は home の DOM 構造 (HomePageBody の最初の section が hero) に依存。home のセクション順を変える改修が入ったら SectionIndicator の表示タイミングを再確認

## EXTRA 提案 (原案)
- [EXTRA] 塗料の粘性カーソル (コスト: 約0.5日, 追加依存なし): リングの lerp 追従に速度ベースの変形を足す。rAF ループでカーソル速度ベクトルを計測し、速く動かすとリングが進行方向に楕円に伸び (scaleX up / scaleY down + rotate(θ))、止まると 2〜3 フレームのオーバーシュートを経て真円に戻る。「引きずった塗料が糸を引いて戻る」粘性の手触りで、塗装工房の署名として旧サイト超えの体験になる。transform 合成のみで実装でき正典パラメータ (lerp 0.18) は不変
- [EXTRA] インクの引き継ぎ — 進捗バーとドットが直近の色見本色に染まる (コスト: 約1日, M4 colors 班のフック待ち): :root に --kt-ink (既定 var(--soul)) を定義し、kt-paint-progress と kt-sec-indicator の is-current 色を var(--kt-ink) 参照に変える。色見本カード hover / /colors#46v アンカー到達で data-ink 属性から --kt-ink を書き換え、sessionStorage 経由でページ遷移後も維持。「見ていた色がサイトの署名色として付いてくる」= 色見本帳ブランドの中核演出。G6 View Transitions (M2) と組み合わせると遷移中も色が連続する
- [EXTRA] プログレスバーの刷毛先端 (コスト: 1〜2h): kt-paint-progress の右端に ::after で skewX(-14deg) の 8px 三角チップ + 不透明度グラデを付け、G5 刷毛ストローク (translateX skewX(-14deg)) とモチーフを揃える。スクロールで「刷毛が紙面を塗り進めている」隠喩が完成する。scaleX ではチップが歪むため、バー本体を width 100% 固定 + translateX((ratio-1)*100%) 方式に変える小改修込み
- [EXTRA] セクションインジケータのクリックナビ化 (コスト: 2〜3h): 旧仕様は pointer-events:none の純装飾だが、SectionMark に id (sec-01 等) を振り、ドットのクリックで scrollIntoView({behavior:"smooth"}) ジャンプ + hover で全ラベル一時表示。aria-hidden を外し nav[aria-label="セクション"] + 各項目 button 化で a11y も正規化。色見本帳の「見出しインデックス (小口の爪)」の隠喩に合致

## 対象ファイル
src/app/globals.css, src/app/(site)/layout.tsx, src/components/site/site-header.tsx, src/components/site/page-blocks.tsx, src/components/motion/custom-cursor.tsx, src/components/motion/paint-progress.tsx, src/components/motion/section-indicator.tsx, src/components/motion/nav-link.tsx, src/components/motion/path-current.ts, src/components/motion/path-current.test.ts
