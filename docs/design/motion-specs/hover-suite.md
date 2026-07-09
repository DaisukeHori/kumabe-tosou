# M2 hover-suite 実装仕様書 — G5 刷毛ボタン / G8 写真 hover / G9 footer 塗り / G6 ページ遷移 / G13 smooth + B1〜B3

- 班: hover-suite (M2)
- 正典: `docs/design/motion-gap-report.md` §5 / 旧実装 `legacy/css/style.css`・`legacy/js/main.js`
- **実装ベースに関する重要事項**: 指示書記載の V2a worktree `.claude/worktrees/agent-a24a69628487d5f3e` は本仕様策定中に削除済み。V2a (公開ページ page-body 抽出 + SlotImage) と V2b は **main にマージ済み (commit 334f6fe)**。本仕様の対象パスはすべて `/Users/horidaisuke/projects/kumabe-tosou/src/**` (main チェックアウト)。マージ済み main の内容が worktree 時点の V2a 構造と一致することは検証済み。
- 実行環境: Next.js 15.5.20 / React 19.2.4 (stable) / Tailwind v4 / vitest (node env, `tests/**/*.test.ts`)

## 0. 設計サマリ

| 項目 | 方式 | 新規依存 |
|---|---|---|
| G5 刷毛ストローク | CSS クラス `.kt-btn-brush` (::before 帯)。`ui/button.tsx` は**変更しない**(admin と共有のため、opt-in クラス方式) | なし |
| G8 写真 hover | `.kt-photo` (hover スコープ) + `.kt-photo-img` (img)。SlotImage/MediaCover 内部で付与 → 全ページ自動適用 | なし |
| G9 footer 塗り | `.kt-footer-giant` (background-clip:text、0%→100% 1.1s) | なし |
| G6 ページ遷移 | **クロスドキュメント VT は App Router の Link 遷移 (soft nav) では発火しない**(ブラウザ仕様)。soft nav は新規クライアント部品 `PageTransition` (WAAPI、入場 0.44s のみ) で代替。`@view-transition` CSS はフルロード遷移向けの進歩的強化として旧値のまま併設。React 19.2 stable に ViewTransition API は無いため experimental フラグは使わない ([EXTRA] 参照) | なし |
| G13 + B3 | `html { scroll-behavior: smooth }` 追加。既存 reduce 側 `auto` (globals.css:358-361) が「死んだ防御」から蘇生。**注意: 追記位置が既存 reduce ブロックより後のため、班セクション末尾の kill-switch で auto を再宣言しないと reduce 環境で smooth が勝つ** (後述 CSS に含む) | なし |
| B1 | 追記のみで修正: `.kt-swatch-host:hover .kt-swatch-sheen` を新設し colors の Drawdown ルート div に `kt-swatch-host` を付与。既存 `a:hover .kt-swatch-sheen` (globals.css:354) は home の Link カード用に**そのまま残す**(既存ブロック非破壊 = マージ衝突回避) | なし |
| B2 | works/voices 一覧カードに `Reveal` ラップ + `.kt-card-lift` (legacy drawdown hover 値) + `.kt-photo` | なし |

共通ガード: 全 hover 演出は `@media (hover: hover) and (pointer: fine)`、全 transition/animation は班セクション末尾の `prefers-reduced-motion: reduce` 一括キルスイッチ (旧 css:1130-1136 方式)。PageTransition は WAAPI のため CSS では殺せず、コンポーネント内 `matchMedia` で自前ガード。SSG 非退行: 追加されるクライアントコンポーネントは `PageTransition` 1 つのみで、children を props 素通しする (Server Component ツリー汚染なし・request-time API なし)。`/edit` ルート ((editor) レイアウト) には PageTransition を**載せない**。`data-editable-*` 属性のコードパスは一切変更しない (className 追記のみ)。

## 1. 変更ファイル一覧

| # | ファイル | 変更 |
|---|---|---|
| 1 | `src/app/globals.css` | 末尾に `/* === motion: hover-suite === */` ブロック追記 (§2 全文) |
| 2 | `src/components/motion/page-transition.tsx` | **新規** (§3) |
| 3 | `src/app/(site)/layout.tsx` | main 内を PageTransition でラップ (§4.1) |
| 4 | `src/components/site/page-blocks.tsx` | ArrowButton / CtaBand / PhotoFigure (§4.2) |
| 5 | `src/components/site/slot-image.tsx` | kt-photo / kt-photo-img 付与 (§4.3) |
| 6 | `src/components/site/media-cover.tsx` | 同上 (§4.4) |
| 7 | `src/components/site/site-footer.tsx` | footer-giant (§4.5) |
| 8 | `src/components/site/site-header.tsx` | CTA 刷毛 + kt-vt-header (§4.6) ★M1 班と競合注意 |
| 9 | `src/app/(site)/works/page-body.tsx` | B2 (§4.7) |
| 10 | `src/app/(site)/voices/page-body.tsx` | B2 (§4.8) |
| 11 | `src/app/(site)/colors/page-body.tsx` | B1 (§4.9) |
| 12 | `tests/motion-hover-suite.test.ts` | **新規** 正典値ガードテスト (§6) |

## 2. globals.css 追記ブロック (全文貼り付け可)

現在の globals.css は 378 行 (末尾 = `prefers-reduced-motion` ブロック)。その**直後**に以下を丸ごと追記する。

```css
/* === motion: hover-suite === */
/* M2 班 (G5/G6/G8/G9/G13 + B1/B2/B3)。パラメータ正典: docs/design/motion-gap-report.md §5。
   旧実装対応: legacy/css/style.css 254-283, 596-620, 1093-1106, 1187-1205,
   1311-1318, 1343-1359, 2409-2424。
   注意: この kt-* 群は非レイヤー CSS のため Tailwind ユーティリティ(@layer)より常に勝つ。
   同一要素の transition/filter/transform を Tailwind 側で変えても効かない (仕様)。 */

/* ---------- G13 + B3: smooth scroll (legacy css:46) ---------- */
html {
  scroll-behavior: smooth;
}

/* ---------- G5: ボタン刷毛ストローク (legacy css:254-283 + 1343-1359) ---------- */
.kt-btn-brush {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  transition:
    color 0.35s var(--ease),
    border-color 0.35s var(--ease);
}
.kt-btn-brush::before {
  content: "";
  position: absolute;
  inset: -1px;
  width: calc(100% + 34px);
  background: var(--carbon);
  transform: translateX(-104%) skewX(-14deg);
  transform-origin: left center;
  transition: transform 0.42s var(--ease);
  z-index: -1;
  pointer-events: none;
}
/* CTA 帯上は赤刷毛 (legacy css:619 .cta-band .btn::before) */
.kt-btn-brush--soul::before {
  background: var(--soul);
}
/* ヘッダー CTA 変種 (legacy .nav-cta: 帯幅 +26px / 0.38s / 停止位置 -13px。css:1352-1359) */
.kt-btn-brush--cta::before {
  width: calc(100% + 26px);
  transition-duration: 0.38s;
}
.kt-btn-arrow {
  display: inline-block;
  transition: transform 0.3s var(--ease);
}
@media (hover: hover) and (pointer: fine) {
  .kt-btn-brush:hover::before {
    transform: translateX(-16px) skewX(-14deg);
  }
  .kt-btn-brush--cta:hover::before {
    transform: translateX(-13px) skewX(-14deg);
  }
  .kt-btn-brush:hover .kt-btn-arrow {
    transform: translateX(5px);
  }
}
/* キーボード操作でも同じ演出 (旧サイトに無い a11y 追補。パラメータは正典と同一) */
.kt-btn-brush:focus-visible::before {
  transform: translateX(-16px) skewX(-14deg);
}
.kt-btn-brush--cta:focus-visible::before {
  transform: translateX(-13px) skewX(-14deg);
}
.kt-btn-brush:focus-visible .kt-btn-arrow {
  transform: translateX(5px);
}

/* ---------- G8: 写真 grayscale→カラー + ズーム (legacy css:2409-2424) ---------- */
.kt-photo-img {
  filter: grayscale(0.9) contrast(1.05) brightness(0.99);
  transition:
    filter 0.7s var(--ease),
    transform 1s var(--ease);
  will-change: transform;
}
@media (hover: hover) and (pointer: fine) {
  .kt-photo:hover .kt-photo-img {
    filter: grayscale(0.1) contrast(1.05);
    transform: scale(1.04);
  }
}

/* ---------- G9: footer-giant 塗り込み (legacy css:1093-1106 + 1311-1318) ---------- */
.kt-footer-giant {
  color: transparent;
  -webkit-text-stroke: 1px rgba(23, 25, 27, 0.3);
  background: linear-gradient(90deg, var(--carbon), var(--carbon)) no-repeat left
    center / 0% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  transition: background-size 1.1s var(--ease);
}
@media (hover: hover) and (pointer: fine) {
  .kt-footer-giant:hover {
    background-size: 100% 100%;
  }
}
@media (max-width: 560px) {
  /* legacy css:1180 */
  .kt-footer-giant {
    -webkit-text-stroke-width: 0.6px;
  }
}

/* ---------- B2: 一覧カード浮上 (legacy css:287-297 a.drawdown:hover) ---------- */
.kt-card-lift {
  transition:
    transform 0.45s var(--ease),
    box-shadow 0.45s var(--ease),
    border-color 0.25s var(--ease);
}
@media (hover: hover) and (pointer: fine) {
  .kt-card-lift:hover {
    transform: translateY(-6px);
    box-shadow: 0 18px 40px -22px rgba(23, 25, 27, 0.35);
  }
}

/* ---------- B1: colors の sheen ホバー復活 ----------
   既存 `a:hover .kt-swatch-sheen` (globals.css:354) は home の Link カード用に残す。
   /colors の Drawdown は a 祖先を持たない div のため、.kt-swatch-host で拾う。 */
@media (hover: hover) and (pointer: fine) {
  .kt-swatch-host:hover .kt-swatch-sheen {
    transform: translateX(18%);
  }
}

/* ---------- G6: ページ遷移 (legacy css:1187-1205 と同値) ----------
   App Router の Link 遷移は soft navigation のためクロスドキュメント VT は発火しない。
   soft nav は PageTransition (src/components/motion/page-transition.tsx, WAAPI) が担い、
   以下はフルロード遷移 (外部リンク流入・JS 無効時など) のみに効く進歩的強化。 */
@view-transition {
  navigation: auto;
}
::view-transition-old(root) {
  animation: kt-vt-out 0.28s var(--ease) both;
}
::view-transition-new(root) {
  animation: kt-vt-in 0.44s var(--ease) both;
}
@keyframes kt-vt-out {
  to {
    opacity: 0;
    transform: translateY(-14px);
  }
}
@keyframes kt-vt-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}
/* ヘッダーは遷移中も静止 (legacy css:1205。site-header.tsx が kt-vt-header を付与) */
.kt-vt-header {
  view-transition-name: site-header;
}

/* ---------- hover-suite 一括キルスイッチ (旧 css:1130-1136 方式) ----------
   重要: 上の `html { scroll-behavior: smooth }` は既存 reduce ブロック
   (globals.css:358-361) より後に位置するため、ここで auto を再宣言しないと
   reduce 環境で smooth が後勝ちしてしまう。削除禁止。 */
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  .kt-btn-brush,
  .kt-btn-brush::before,
  .kt-btn-arrow,
  .kt-photo-img,
  .kt-footer-giant,
  .kt-card-lift,
  .kt-swatch-sheen {
    transition: none;
  }
  @view-transition {
    navigation: none;
  }
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
  }
}
```

実装メモ:
- `isolation: isolate` + `z-index: -1` により、::before 帯は「ボタン自身の背景より上・テキストより下」に描画される (stacking context 内の負 z-index 描画順)。legacy の `.btn { z-index: 1 }` と等価だが周囲への影響がない。
- `overflow: hidden` は focus ring (box-shadow) を切らない。
- Tailwind v4 の `hover:` バリアントは既定で `(hover: hover)` ゲート付きのため、TSX 側の `hover:text-paper` と CSS 側のガードは整合する。

## 3. 新規: src/components/motion/page-transition.tsx (全文)

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

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
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
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
```

## 4. 既存 TSX の変更 (before → after)

### 4.1 src/app/(site)/layout.tsx (46 行目)
```tsx
// import 追加
import { PageTransition } from "@/components/motion/page-transition";

// before:
      <main className="flex-1">{children}</main>
// after:
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
```
**(editor)/layout.tsx には絶対に入れない** (エディタ iframe 内で座標再測定の邪魔になるため)。

### 4.2 src/components/site/page-blocks.tsx

**ArrowButton (145-164 行)** — legacy css:254-283+1343-1351 対応:
```tsx
export function ArrowButton({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <Button
      variant="outline"
      render={<Link href={href} />}
      className="kt-btn-brush h-10 rounded-none border-carbon/40 bg-transparent px-5 tracking-[0.08em] text-carbon hover:bg-transparent hover:text-paper focus-visible:text-paper"
    >
      {children}
      <span aria-hidden="true" className="kt-btn-arrow ml-1">
        →
      </span>
    </Button>
  );
}
```
変更点: `hover:bg-carbon` を削除 (塗りは ::before 帯が担う)、`hover:bg-transparent` で outline variant の `hover:bg-muted` を打ち消し、`kt-btn-brush` と矢印 `kt-btn-arrow` を追加。

**CtaBand の Button (187-195 行)** — legacy css:618-620 (`.cta-band .btn` = primer 枠 + 赤刷毛 + hover #FFF) 対応。現行の「paper 塗り潰しボタン」から旧サイト正規の outline 型へ変更する:
```tsx
        <Button
          variant="outline"
          render={<Link href={href} />}
          className="kt-btn-brush kt-btn-brush--soul h-12 shrink-0 rounded-none border-primer bg-transparent px-8 tracking-[0.12em] text-primer hover:border-soul hover:bg-transparent hover:text-white focus-visible:text-white"
        >
          {label}
          <span aria-hidden="true" className="kt-btn-arrow ml-1">
            →
          </span>
        </Button>
```

**PhotoFigure (124 行)** — figure 全体を hover スコープに (legacy `figure.photo:hover`):
```tsx
    <Reveal as="figure" className="kt-photo border border-hair bg-paper p-2">
```

`ui/button.tsx` は**変更しない**。理由: admin/全 UI と共有される cva 基底に position/overflow を入れると副作用範囲が広すぎるため、公開サイト側の呼び出し箇所で opt-in クラスを渡す設計とする。

### 4.3 src/components/site/slot-image.tsx (77-88 行、画像あり分岐のみ)
```tsx
  return (
    <div
      className={cn("kt-photo relative w-full overflow-hidden", aspectClass, className)}
      {...editableAttrs}
    >
      <Image
        src={resolved.src}
        alt={resolved.alt}
        fill
        priority={slot.priority}
        sizes={sizes}
        className="kt-photo-img object-cover"
      />
    </div>
  );
```
NO IMAGE プレースホルダ分岐 (55-75 行) は**変更しない**。`editableAttrs` の位置・内容も不変。

### 4.4 src/components/site/media-cover.tsx (54-58 行、src あり分岐のみ)
```tsx
  return (
    <div className={cn("kt-photo relative w-full overflow-hidden", aspect)} {...editableAttrs}>
      <Image src={src} alt={alt} fill sizes={sizes} className="kt-photo-img object-cover" />
    </div>
  );
```
これで works/voices/notes/blog の全 cover と works/[slug] のギャラリーに G8 が自動適用される。

### 4.5 src/components/site/site-footer.tsx (103-108 行)
```tsx
        <p
          aria-hidden="true"
          className="kt-footer-giant mt-8 select-none overflow-hidden whitespace-nowrap font-mono text-[clamp(40px,9vw,110px)] font-semibold leading-none tracking-[0.08em]"
        >
          KUMABE TOSO
        </p>
```
変更点: `text-carbon/10` を削除し `kt-footer-giant` を追加 (静置時はアウトライン文字 = legacy css:1102-1103、hover で 1.1s 塗り込み)。

### 4.6 src/components/site/site-header.tsx ★M1 班 (G4 ナビ) と同一ファイル。**M1 → M2 の順でマージすること**

(a) header 要素 (34 行) に VT 用クラスを 1 語追加:
```tsx
    <header className="kt-vt-header sticky top-0 z-50 border-b border-hair bg-primer/80 backdrop-blur-md">
```
(b) デスクトップ CTA (64-69 行) — legacy `.nav-cta` (css:158-165 = carbon 枠 outline + 刷毛 0.38s) へ:
```tsx
          <Button
            variant="outline"
            render={<Link href="/contact" />}
            className="kt-btn-brush kt-btn-brush--cta ml-2 rounded-none border-carbon bg-transparent px-4 tracking-[0.12em] text-carbon hover:bg-transparent hover:text-paper focus-visible:text-paper"
          >
            相談する
          </Button>
```
モバイル Sheet 内 CTA (106-111 行) は触らない (タッチ環境のため刷毛不要)。

### 4.7 src/app/(site)/works/page-body.tsx (B2)

import 追加: `import { Reveal } from "@/components/site/reveal";`

map 部 (53-82 行) を置換:
```tsx
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {works.map((work) => (
                <Reveal key={work.id} as="div">
                  <Link
                    href={`/works/${work.slug}`}
                    className="group block kt-card-lift kt-photo"
                  >
                    <Card className="gap-0 overflow-hidden rounded-none border-hair bg-paper py-0 shadow-none group-hover:border-carbon/40">
                      {/* …内側 (MediaCover / CardHeader / CardContent) は現行のまま… */}
                    </Card>
                  </Link>
                </Reveal>
              ))}
            </div>
```
変更点: Reveal ラップ (key は Reveal へ移動)、Link に `kt-card-lift kt-photo` (カードのどこを hover しても浮上 + 写真カラー化)、Card から `transition-colors` を削除 (kt-card-lift の transition に border-color を含めたため)。

### 4.8 src/app/(site)/voices/page-body.tsx (B2)

import 追加: `import { Reveal } from "@/components/site/reveal";`

map 部 (66-103 行) の Card を置換:
```tsx
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {voices.map((voice) => (
                <Reveal key={voice.id} as="div">
                  <Card className="kt-card-lift kt-photo h-full justify-between overflow-hidden rounded-none border-hair bg-paper py-0 shadow-none">
                    {/* …内側は現行のまま… */}
                  </Card>
                </Reveal>
              ))}
            </div>
```
**`h-full` 追加が必須**: 従来 Card 自身が grid item として stretch されていたが、Reveal div が grid item になるため、h-full が無いと等高カードが崩れる。

### 4.9 src/app/(site)/colors/page-body.tsx (B1)

Drawdown コンポーネントのルート div (140 行) に 1 語追加:
```tsx
    <div className="kt-swatch-host border border-hair bg-paper p-2">
```
これで globals.css の新セレクタが効き、/colors の光沢スライド (translateX(18%) 0.7s) が復活する。既存 globals.css:354 の `a:hover .kt-swatch-sheen` は home 用に残置 (M4 の colors チルト+グレア追従とは独立。M4 は `.kt-swatch-host` に transform を足す際、本仕様の sheen と衝突しないこと)。

## 5. 旧実装との対応表

| 実装物 | 旧根拠 (legacy/css/style.css) | 正典パラメータ (§5) |
|---|---|---|
| .kt-btn-brush 基本形 | 254-283 (.btn 骨格) + 1343-1351 (斜め刷毛化) | translateX(-104%) skewX(-14deg) → -16px、0.42s --ease、帯幅 +34px、inset -1px、color 0.35s |
| .kt-btn-brush--cta | 158-165 (.nav-cta 骨格) + 1352-1359 | 帯幅 +26px、0.38s、停止 -13px |
| .kt-btn-brush--soul / CtaBand 色 | 596-620 (.cta-band / 赤刷毛 / hover #FFF / hover border soul) | — |
| .kt-btn-arrow | 279-280 | transform 0.3s、translateX(5px) |
| .kt-photo(-img) | 2409-2424 | grayscale(0.9)→(0.1)、contrast 1.05、brightness 0.99 (静置)、scale 1.04、filter 0.7s / transform 1s 非対称、will-change |
| .kt-footer-giant | 1093-1106 (stroke 1px rgba(23,25,27,.3)) + 1311-1318 (塗り) + 1180 (≤560px stroke 0.6px) | background-size 0%→100% 1.1s |
| .kt-card-lift | 287-297 (a.drawdown:hover) | translateY(-6px)、shadow 0 18px 40px -22px rgba(23,25,27,.35)、0.45s |
| B1 sheen | 315-325 | translateX(18%)、0.7s |
| @view-transition + kt-vt-* | 1187-1205 | out 0.28s translateY(-14px) / in 0.44s translateY(16px)、header 固定 |
| PageTransition | 1195-1203 の in 側の soft-nav 移植 | 440ms、cubic-bezier(0.22,1,0.36,1)、translateY(16px) |
| scroll-behavior | 46 | smooth (reduce で auto) |
| キルスイッチ | 1130-1136 | 班セクション末尾に一括 |

## 6. テスト方針

### 6.1 自動テスト (新規 `tests/motion-hover-suite.test.ts`、node env / vitest 既存規約準拠)
ソースを `fs.readFileSync` で読み、正典値と配線をガードする:
1. globals.css に `=== motion: hover-suite ===` マーカーが存在する
2. 正典値の存在: `translateX(-104%) skewX(-14deg)` / `transform 0.42s` / `0.38s` / `translateX(-16px)` / `translateX(-13px)` / `grayscale(0.9)` / `filter 0.7s` / `transform 1s` / `scale(1.04)` / `background-size 1.1s` / `translateY(-6px)` / `0 18px 40px -22px` / `kt-vt-out 0.28s` / `kt-vt-in 0.44s` / `scroll-behavior: smooth`
3. **順序ガード (B3/G13 回帰防止)**: `scroll-behavior: smooth` の出現位置より後に、reduce ブロック内の `scroll-behavior: auto` が存在する (最後の `auto` の index > `smooth` の index)
4. 配線: slot-image.tsx と media-cover.tsx が `kt-photo-img` を含む / page-blocks.tsx の ArrowButton・CtaBand が `kt-btn-brush` を含む / site-footer.tsx が `kt-footer-giant` を含む / works・voices page-body が `Reveal` を import している / colors page-body が `kt-swatch-host` を含む / `(site)/layout.tsx` が `PageTransition` を含み **`(editor)/layout.tsx` が含まない**
5. page-transition.tsx が `"use client"` で始まり、`prefers-reduced-motion` の matchMedia ガードと `440` / `cubic-bezier(0.22, 1, 0.36, 1)` を含む

実行: `npm run test` — 既存 247 件 + 新規が全 PASS すること (既存テストへの影響は無いはず。editable-attrs 系テストが className 変更で落ちないことを確認)。

### 6.2 ビルド検証 (SSG 非退行)
`npm run build` が成功し、ビルド出力で `(site)` 配下の全ルートが従前と同じレンダリング区分 (Static/SSG) であること。`PageTransition` 追加で `(site)/layout` が dynamic 化していないこと。

### 6.3 手動検証マトリクス (dev server + DevTools)
| # | 操作 | 期待 |
|---|---|---|
| 1 | 任意ページの ArrowButton hover | 炭色帯が左から -14° 斜めで 0.42s スイープ、文字→paper、矢印 +5px。leave で逆再生 |
| 2 | CtaBand ボタン hover | 赤帯 0.42s、文字→白、枠→soul |
| 3 | ヘッダー「相談する」hover | outline 見た目 + 帯 0.38s (M1 のナビ下線と両立) |
| 4 | Tab キーでボタンへ focus | hover と同じ帯 + 文字色 (キーボードチェックリスト準拠) |
| 5 | 各ページの写真 | 静置でほぼモノクロ、hover で 0.7s カラー化 + 1s で 1.04 倍ズーム (枠からはみ出さない) |
| 6 | /works /voices スクロール | カードが 0.85s Reveal。hover で -6px 浮上 + 影 + 写真カラー化 |
| 7 | /colors Drawdown hover | 光沢が 18% スライド (B1 復活) |
| 8 | footer「KUMABE TOSO」hover | 左から 1.1s で塗られる。560px 以下でストローク 0.6px |
| 9 | ページ内アンカー (/colors#c-202 を colors 内リンクから) | スムーススクロール |
| 10 | Link でページ遷移 | 新ページが 0.44s フェード+ライズ。**初回ロード/リロードでは発火しない** (Performance パネルで LCP 要素が opacity:0 で始まらないこと) |
| 11 | DevTools Rendering → prefers-reduced-motion: reduce | smooth 無効 / 帯・写真・footer・lift が即時切替 / ページ遷移アニメなし |
| 12 | DevTools デバイスエミュレーション (touch) | hover 演出が一切発火しない。写真の静置モノクロは維持 |
| 13 | /admin/visual → iframe (/edit) | オーバーレイ操作・data-editable-* が従前どおり。ページ遷移アニメが iframe 内に無い |

## 7. 受入条件 (完成の定義)
1. §6.1 の新規テスト + 既存全テストが PASS
2. `npm run build` 成功、(site) 全ルートの Static 区分維持
3. §6.3 の 13 項目すべて確認済み (特に #4 キーボード、#10 LCP、#11 reduce、#13 エディタ共存)
4. globals.css の追記が `/* === motion: hover-suite === */` ブロック 1 箇所に収まっており、既存行の変更が**ゼロ**であること (B1 も追記で解決)
5. 新規依存パッケージの追加がないこと (package.json 差分なし)
6. `git grep kt-btn-brush src/app/admin` がヒットしない (admin UI へ漏れていない)


---

## リスク (班申告)
- 【最重要】指示書記載の V2a worktree (.claude/worktrees/agent-a24a69628487d5f3e) は本仕様策定中に削除された。V2a+V2b は main (commit 334f6fe) にマージ済みで、本仕様は main のパスを対象にしている。他班の仕様が worktree パスを前提にしている場合、オーケストレーターがパスを main に読み替えて統一すること
- site-header.tsx は M1 班 (G4 ナビ現在地/下線) も編集する。本班の変更は kt-vt-header 1 語 + CTA Button の className のみだが、必ず M1 → M2 の順で適用しレビューで両立を確認すること
- G8 により全写真の静置状態が grayscale(0.9) のほぼモノクロに変わる (旧サイト正規の見た目だが現行比で最大の視覚変化)。デプロイ前に堀さんのスクリーンショット確認を推奨
- ヘッダー CTA と CtaBand ボタンが「塗り潰し」から旧サイト正規の「outline + 刷毛」へ変わる (意図した legacy パリティだが見た目が変わる点は要周知)
- kt-* ルールは非レイヤー CSS のため Tailwind ユーティリティ (@layer) より常に優先される。今後同一要素に transition/filter/transform 系ユーティリティを足しても効かない — CSS ブロック冒頭コメントに明記済み
- PageTransition は 0.44s 間 wrapper に transform を掛けるため、main 内に position:fixed / sticky 要素を置く後続班 (M3/M4 の story sticky 見出し等) はアニメ中の挙動を確認すること (fixed は一時的に wrapper 基準になる)
- 退場アニメ (out 0.28s) は soft nav では遷移をブロックせず実現不能のため意図的に非対応 (入場 0.44s のみ)。完全再現は extras の experimental View Transitions 案でのみ可能
- @view-transition を @media (prefers-reduced-motion: reduce) 内に置く書法 (legacy 踏襲) は Safari で無視される可能性があるが、その場合も ::view-transition-*(root) { animation: none } が効くため実害なし
- works/voices の Reveal ラップで grid item が Reveal div に変わる。voices は Card に h-full を付けないと等高レイアウトが崩れる (仕様に含む) — 実装時に省略しないこと
- scroll-behavior: smooth は html 全域 (admin 含む) に効く。admin 内アンカージャンプも smooth になるが実害は軽微

## EXTRA 提案 (原案)
- [EXTRA] 刷毛の掠れエッジ: .kt-btn-brush::before の先端 (右端) に legacy dd-edge の不規則 polygon (css:340) を 90° 回転で clip-path 適用し、ホバー静止時 (-16px) に帯の先端が『刷毛の掠れ』として覗くようにする。塗装工房のボタンとして最も記号性が高い一手。CSS のみ、目安 0.5h
- [EXTRA] ページ間の色引き継ぎ: home/colors のスウォッチ Link クリック時に押した色の CSS 変数 (--a) を sessionStorage へ書き、PageTransition が遷移入場の 0.44s 間だけ背景に該当色を 6-8% の薄さで敷いてフェードアウトさせる (『前のページの塗料がまだ乾いていない』演出)。クライアント完結・SSG 非退行。目安 2-3h
- [EXTRA] 真の View Transitions 化: next.config に experimental.viewTransition を立て React の unstable_ViewTransition で out 0.28s / in 0.44s の双方向遷移を完全再現する案。App Router は vendored React canary を使うため技術的には動くが、experimental API 依存でアップグレード時の破損リスクが中程度。本仕様の PageTransition (WAAPI) を安定版とし、こちらは別ブランチで PoC 推奨。目安 2h + QA
- [EXTRA] 塗料の粘性イージング (正典逸脱提案): kt-btn-brush と kt-card-lift に限り --ease-viscous: cubic-bezier(0.34, 1.3, 0.36, 1) (微オーバーシュート) を新設して『塗料の腰』を感じさせる。正典 --ease からの意図的逸脱のため堀さん判断が必要。CSS 2 行、目安 0.2h
- [EXTRA] footer-giant のスクロール駆動塗り (M3 連携): hover に加え @supports (animation-timeline: view()) ガードで viewport 進入時に一度 0→100% の塗りを自動再生し、モバイル (hover 不能環境) でも見せ場を作る。M3 のスクロール駆動 6 種と同じガード方式に相乗り。目安 0.5h

## 対象ファイル
/Users/horidaisuke/projects/kumabe-tosou/src/app/globals.css, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/layout.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/page-blocks.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/slot-image.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/media-cover.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/site-footer.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/site-header.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/works/page-body.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/voices/page-body.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/colors/page-body.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/motion/page-transition.tsx, /Users/horidaisuke/projects/kumabe-tosou/tests/motion-hover-suite.test.ts
