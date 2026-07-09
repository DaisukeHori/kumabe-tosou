# M4-home モーション実装仕様書 — ヒーロー1文字リビール / 設計図グリッド / カラーストリップ

- 班: page-home (M4)
- 対象リポジトリ: `/Users/horidaisuke/projects/kumabe-tosou`
- 正典: `docs/design/motion-gap-report.md` §3(home) / §5、`legacy/js/main.js`、`legacy/css/style.css`(旧実装が唯一の正)
- 実装者への前提知識: Next.js 15 App Router / React 19 / Tailwind v4。新規依存の追加は禁止(CSS + 最小限の vanilla TS)。

## 0. 対象ファイルについての重要な前提

タスク指示にあった worktree `.claude/worktrees/agent-a24a69628487d5f3e` は **main へマージ済みで既に削除されている**(main の `git log`: `930c177 merge: ビジュアル画像エディタ V2a` → `334f6fe merge: V2b`)。V2a 構造(公開ページの page-body.tsx 抽出)は main に存在することを実測確認済み。**本仕様の対象は main の以下のファイル**(行番号はすべて main の現物で検証済み。worktree 版と一致):

| 種別 | パス |
|---|---|
| 変更 | `src/app/(site)/page-body.tsx` |
| 変更 | `src/app/globals.css`(末尾に `/* === motion: page-home === */` バンドを追記) |
| 新規 | `src/components/motion/split-chars.tsx`(Server Component 安全。"use client" なし) |
| 新規 | `src/components/motion/strip-wheel.ts`(純関数。テスト対象) |
| 新規 | `src/components/motion/color-strip.tsx`("use client") |
| 新規 | `tests/motion-home-split-chars.test.ts` |
| 新規 | `tests/motion-home-strip-wheel.test.ts` |

実装は main から新規ブランチ/worktree を切って行うこと。`src/components/motion/` ディレクトリは未存在(この班が新設。他班と同時作成でも衝突しない — ディレクトリ作成は冪等)。

**触ってはいけないもの**: `src/app/(editor)/**`、`src/components/site/reveal.tsx`(`kmb:reveal-done` イベントは V2b ホットスポット再測定が依存)、`slot-image.tsx` / `editable-attrs.ts`(data-editable-* の出所)、globals.css の既存行(追記のみ。既存 `.kt-hero-line` / `.kt-paint-mark` 規則は**残す** — §A.1 参照)。

## 1. 共通制約の適用マップ

| 制約 | 本班での適用 |
|---|---|
| SSG 非退行 | 文字分割は**ビルド時(RSC レンダー時)**に行う。client 化するのは wheel 変換の `ColorStrip` のみで、server ツリーは children パススルーで汚さない。request-time API なし。 |
| reduced-motion 一括キル | バンド末尾の `@media (prefers-reduced-motion: reduce)` で本班の全アニメ(`.kt-hero-char` / `.kt-strip-progress-bar`)を無効化。既存ブロック(globals.css:358-378)は行リビール/paint-mark を既にカバー済み。サイト全体のブランケット(`*,*::before,*::after`)は M1-M3 共通班の管轄なので**重複追加しない**。 |
| pointer:fine | 本班の JS は wheel イベントのみ。wheel はホイール/トラックパッド搭載環境でしか発火せず、タッチでは native 横スワイプがそのまま生きるため pointer ガード不要(設計判断として §C.1 に明記)。hover 系は既存クラス流用で変更なし。 |
| --ease | 全アニメで既存トークン `var(--ease)`(= 旧 css:41 と同値)を使用。独自イージング追加なし。 |
| 正典パラメータ | §10 の対応表どおり。変更提案はすべて [EXTRA] に隔離。 |
| CSS 追記位置 | `globals.css` 末尾に `/* === motion: page-home === */` 1 バンドのみ(§6 に全文)。 |
| エディタ共存 | 追加するのはページ内要素のみ(固定オーバーレイなし)。ヒーローに SlotImage は無く、カラーストリップ節にも data-editable-* 要素は無いため /edit のホットスポット測定に影響しない。`(editor)/layout.tsx` には何も載せない。 |

---

## Part A — ヒーロー1文字分割リビール

### A.1 設計判断: SSR(ビルド時)分割を採用

| 案 | 判定 | 理由 |
|---|---|---|
| client 分割(旧 main.js:213-265 と同じく hydration 後に DOM 分割) | ✗ | JS 到着まで文字が動かない(SSG の初回描画とアニメ開始がズレる)、hydration 後の DOM 書き換えは React 管理外変異で React 19 では再レンダー時に破綻し得る |
| **SSR 分割(採用)**: RSC レンダー時に `span.kt-hero-char` へ分割し、SSG HTML に焼き込む | ✓ | 分割は純関数で server/client 同一出力 → **hydration mismatch ゼロ**。`transform` のみの初期状態(+親 `.kt-hero-line` の overflow:hidden)なのでレイアウト不変 = **CLS ゼロ**。アニメは CSS だけで first paint から発火(旧の「ロード時発火」より速く、JS 不要) |

旧実装は JS で `is-split` クラスを後付けしていたが、ビルド時分割では**分割済み状態が常時**なので発火クラスは不要。CSS は旧 css:1433-1437 の「is-split 後」の状態をそのまま無条件で書く。

**既存の行リビールは削除しない。** 旧実装では `is-split` 付与後も `.hero-title .line > span` の行ライズ(1s / 0.12s刻み — 旧 css:405-411)が併走し、文字ライズ(0.72s / 0.032s×通し番号)がその上に重なる複合アニメになっている(旧 CSS に is-split 時の行アニメ打ち消し規則は存在しない)。現行 `.kt-hero-line` 規則(globals.css:251-271)がその行ライズ相当なので、**そのまま残して文字分割を内側に追加**するのが忠実な移植。

aria: 旧 index.html:54 と同じく `h1` に `aria-label` で全文を与える(分割 span は AT から無視される)。

### A.2 新規ファイル: `src/components/motion/split-chars.tsx`(全文)

```tsx
import { Fragment, cloneElement, isValidElement } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

/**
 * legacy/js/main.js:213-265「A) ヒーロー見出しの1文字割り出し」の SSR 移植。
 * 旧実装は hydration 後に DOM を書き換えていたが、ここではレンダー時
 * (= SSG ビルド時) に純関数で分割するため、hydration mismatch も CLS も
 * 発生しない。"use client" を付けないこと (Server Component ツリーで使う)。
 *
 * - テキストノードを 1 文字ずつ span.kt-hero-char に変換 (要素は再帰して保存)
 * - --ci は行・要素を跨いだ通し番号 (旧 main.js:226,245-246 の counter と同義)
 * - 半角スペース / 改行 / タブは span 化せず素通し (旧 main.js:238-241)
 */

type Counter = { i: number };

const PASS_THROUGH = new Set([" ", "\n", "\t"]);

function splitNode(node: ReactNode, counter: Counter): ReactNode {
  if (node == null || typeof node === "boolean") return node;

  if (typeof node === "string" || typeof node === "number") {
    const out: ReactNode[] = [];
    // for...of はコードポイント単位 (サロゲートペアを割らない)。
    // 旧実装 (UTF-16 添字) と日本語 BMP 文字では同一の結果。
    for (const ch of String(node)) {
      if (PASS_THROUGH.has(ch)) {
        out.push(ch);
        continue;
      }
      const ci = counter.i;
      counter.i += 1;
      out.push(
        <span
          key={`ci-${ci}`}
          className="kt-hero-char"
          style={{ "--ci": ci } as CSSProperties}
        >
          {ch}
        </span>,
      );
    }
    return out;
  }

  if (Array.isArray(node)) {
    return node.map((child, idx) => (
      <Fragment key={idx}>{splitNode(child, counter)}</Fragment>
    ));
  }

  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(el, undefined, splitNode(el.props.children, counter));
  }

  return node;
}

export function SplitChars({ children }: { children: ReactNode }) {
  return <>{splitNode(children, { i: 0 })}</>;
}
```

### A.3 `src/app/(site)/page-body.tsx` の変更 (1/3): h1 の置換

import 追加(既存 import 群、line 11-14 付近に):

```tsx
import { ColorStrip } from "@/components/motion/color-strip";
import { SplitChars } from "@/components/motion/split-chars";
```

**現 line 255-268 の `<h1>` を丸ごと以下に置換**(className 追加 + aria-label 追加 + SplitChars ラップ。内側の行構造・文言は不変):

```tsx
        <h1
          className="kt-hero-title--split mt-8 text-[clamp(34px,6.2vw,72px)] font-bold leading-[1.3] tracking-[0.04em]"
          aria-label="3Dプリントを、量産品と見分けがつかない外観に。"
        >
          <SplitChars>
            <span className="kt-hero-line">
              <span>3Dプリントを、</span>
            </span>
            <span className="kt-hero-line">
              <span>
                量産品と
                <span className="kt-paint-mark">見分けがつかない</span>
              </span>
            </span>
            <span className="kt-hero-line">
              <span>外観に。</span>
            </span>
          </SplitChars>
        </h1>
```

期待される出力: 全 24 文字(行1=8: 3Dプリントを、 / 行2=12: 量産品と+見分けがつかない / 行3=4: 外観に。)が `--ci: 0` 〜 `--ci: 23` の通し番号を持つ。最終文字のディレイ = 23 × 0.032s = 0.736s、全体の完了 ≈ 1.46s。paint-mark の塗りは 1.05s 開始(§6 の CSS で上書き)。

### A.4 旧実装との対応

| 項目 | 旧 | 新 |
|---|---|---|
| 分割ロジック | main.js:229-259(TEXT_NODE walk + counter) | split-chars.tsx `splitNode`(同じ walk を ReactNode で) |
| 発火 | main.js:262-264(rAF で is-split 付与) | 不要(SSG に焼き込み、first paint で CSS 発火) |
| char スタイル | css:1429-1441 | `.kt-hero-char`(§6。0.72s / 115% / 0.032s×--ci、パラメータ同値) |
| paint-mark 遅延繰り下げ | css:1443-1445(0.75s→1.05s) | `.kt-hero-title--split .kt-paint-mark::before`(§6) |
| reduced-motion | css:1446-1448 | §6 バンド末尾 |

---

## Part B — 設計図グリッド + 寸法マーカー

静的装飾(アニメなし・JS なし)。全マークアップを `page-body.tsx` に直書きし、`aria-hidden="true"` + `pointer-events: none`。

### B.1 `page-body.tsx` の変更 (2/3): HERO セクション

**現 line 247 の section 開始タグに `relative` を追加し、直下にグリッドを挿入、既存コンテンツ(現 line 248-292: hero-index の `<p>` から marquee の `</div>` まで)を `<div className="relative z-[1]">` で包む:**

```tsx
      {/* ============ HERO ============ */}
      <section className="relative mx-auto max-w-[1240px] px-5 pb-16 pt-20 sm:px-8 sm:pt-28">
        {/* 設計図グリッド+寸法マーカー (legacy/index.html:45-51, css:1451-1501) */}
        <div className="kt-hero-grid" aria-hidden="true">
          <span className="kt-hero-dim kt-hero-dim--x">
            <i className="kt-hero-tick" />
            200mm CLASS
            <i className="kt-hero-tick" />
          </span>
          <span className="kt-hero-dim kt-hero-dim--y">
            <i className="kt-hero-tick" />
            φ55
            <i className="kt-hero-tick" />
          </span>
          <span className="kt-hero-cross kt-hero-cross--tl">+</span>
          <span className="kt-hero-cross kt-hero-cross--tr">+</span>
          <span className="kt-hero-cross kt-hero-cross--bl">+</span>
        </div>
        <div className="relative z-[1]">
          {/* ▼ 既存の現 248〜292 行 (hero-index / h1 / lead / actions / marquee) を無変更でこの中へ ▼ */}
          ...
        </div>
      </section>
```

z 構造は旧と同じ(grid: z-0 / 内容: z-1 — 旧 css:1457,1466)。section に `overflow-hidden` は**付けない**(旧 .hero の overflow:hidden は全幅レイアウト由来。現構造では不要で、ボタンの hover 影をクリップするリスクだけがある)。

### B.2 座標換算の根拠(逸脱ではなく座標系の翻訳)

旧 `.hero-grid` は全幅 `.hero`(固定ヘッダー下、padding-top 172px、INDEX 行が 172px 位置)基準で `inset: 96px var(--gutter) 0` = INDEX 行の **76px 上**からグリッドが始まる。現構造は section 自体が max-w コンテナで sticky ヘッダーの下に通常フローで置かれ、INDEX 行は `pt-28` = 112px 位置(≥sm)。グリッド表示域は >900px のみなので sm 側だけ考えればよく、`top: 32px`(= 112 − 80)で旧とほぼ同じ相対位置になる。左右は section の padding(px-5=20px / sm:px-8=32px)に揃える。マスク・background-size・寸法テキストの位置(%)は旧値そのまま。

---

## Part C — カラーストリップ横スクロール体験

### C.1 構造方針

- 現 line 419-458 の「静的 grid + 8 Link カード」を、**カード内部(Link + グラデ swatch + kt-swatch-noise/sheen/kt-pearl-iris + ラベル + Badge)は一切変えず**、外側コンテナだけ横スクロールストリップへ置換する(指示どおり Link 構造維持。この節に SlotImage は存在しない — SlotImage を使う節は無変更)。
- wheel 縦→横変換だけが JS 必要 → `ColorStrip`("use client")が **children パススルー**で受ける。カード群は server 側でレンダーされ RSC ペイロードとして流れるだけなので Server Component ツリー非汚染・SSG 非退行。
- **React の `onWheel` は使わない**(React はルートに passive で登録するため `preventDefault()` が無効)。`useEffect` で native listener を `{ passive: false }` 登録する(旧 main.js:209 の `{ passive: false }` と同義)。
- 判定ロジックは純関数 `resolveStripWheel` に切り出し、node 環境の vitest でそのままテストする(既存 vitest.config は `environment: "node"`, `include: tests/**/*.test.ts` — **config は変更しない**)。
- 進捗バーは旧どおり CSS scroll-timeline(`@supports` ガード、非対応ブラウザは静的 `scaleX(0.15)` フォールバック — 旧 css:1574)。**1 点だけ仕様準拠の修正**: 旧 CSS はストリップ(宣言側)と進捗バー(参照側)が兄弟枝にあり、現行の CSS Scroll-driven Animations 仕様では名前付きタイムラインはサブツリー外から参照できない。ラッパーに `timeline-scope: --kt-strip` を宣言して解決する(パラメータ変更ではなく、旧実装の意図を現仕様で成立させる正当化修正。risks 参照)。

### C.2 新規ファイル: `src/components/motion/strip-wheel.ts`(全文)

```ts
/**
 * legacy/js/main.js:197-210「7) カラーストリップのホイール横変換」の判定部。
 * 縦優勢のホイール入力を横スクロール量へ変換する。ストリップが端に達している
 * 方向への入力は null を返し、preventDefault せずページの縦スクロールへ抜く。
 * DOM 非依存の純関数 (vitest node 環境で直接テストする)。
 */
export function resolveStripWheel(input: {
  deltaX: number;
  deltaY: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): number | null {
  const { deltaX, deltaY, scrollLeft, clientWidth, scrollWidth } = input;
  // 旧実装は厳密に |deltaY| > |deltaX| (等値は変換しない)
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  const atStart = scrollLeft <= 0 && deltaY < 0;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 1 && deltaY > 0;
  if (atStart || atEnd) return null;
  return deltaY;
}
```

### C.3 新規ファイル: `src/components/motion/color-strip.tsx`(全文)

```tsx
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
```

### C.4 `page-body.tsx` の変更 (3/3): COLOR LINEUP 節

**現 line 419-458 の `<Reveal as="div" className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">...</Reveal>` を以下に置換**(`{DRAWDOWNS.map(...)}` の Link カード JSX = 現 423-457 行は**一字も変えずに**そのまま移す):

```tsx
        <Reveal as="div" className="kt-color-strip-wrap mt-12">
          <ColorStrip>
            {DRAWDOWNS.map((dd) => (
              /* ▼ 現 424-456 行の <Link>...</Link> を無変更でここへ ▼ */
              <Link
                key={dd.id}
                href={`/colors#${dd.id}`}
                className="group border border-hair bg-paper p-2 transition-transform duration-[450ms] ease-out hover:-translate-y-1.5 hover:border-carbon/40 hover:shadow-[0_18px_40px_-22px_rgba(23,25,27,0.35)]"
              >
                {/* ...既存の swatch / noise / sheen / iris / ラベル / Badge... */}
              </Link>
            ))}
          </ColorStrip>
          <div className="kt-strip-foot">
            <p className="kt-strip-hint font-mono">DRAG / SCROLL →</p>
            <span className="kt-strip-progress" aria-hidden="true">
              <span className="kt-strip-progress-bar" />
            </span>
          </div>
        </Reveal>
```

対応: ラッパー構造は旧 index.html:163-210(color-strip-wrap.reveal > color-strip + strip-foot)と同型。Reveal が旧 `.reveal` クラス相当(既に同パラメータ)。

---

## §6 globals.css 追記バンド(全文・末尾にそのまま貼り付け)

```css
/* === motion: page-home === */
/* -------------------------------------------------------------
   M4-home: ヒーロー1文字リビール / 設計図グリッド / カラーストリップ
   正典: legacy/js/main.js:197-265,
         legacy/css/style.css:514-536, 1429-1501, 1554-1587
   ------------------------------------------------------------- */

/* ---------- 1) ヒーロー1文字分割リビール (旧 css:1429-1441) ----------
   旧 .hero-title[data-split].is-split .char 相当。ビルド時分割のため
   発火クラスは無く、first paint から CSS のみで発火する。
   既存 .kt-hero-line の行ライズ (1s) と併走する複合アニメ (旧実装と同じ)。 */
@keyframes kt-char-rise {
  from {
    transform: translateY(115%);
  }
  to {
    transform: translateY(0);
  }
}
.kt-hero-char {
  display: inline-block;
  will-change: transform;
  transform: translateY(115%);
  animation: kt-char-rise 0.72s var(--ease) both;
  animation-delay: calc(var(--ci, 0) * 0.032s);
}
/* 分割時は塗りマーカーの発火を後ろへ (旧 css:1443-1445: 0.75s → 1.05s) */
.kt-hero-title--split .kt-paint-mark::before {
  animation-delay: 1.05s;
}

/* ---------- 2) 設計図グリッド+寸法マーカー (旧 css:1451-1501) ----------
   inset の換算根拠: 旧は全幅 .hero 基準 top 96px (= INDEX 行の 76px 上)。
   現構造は max-w セクション内のため top 32px (= pt-28 の INDEX 行の 80px 上)、
   左右は section の padding (px-5 / sm:px-8) に一致させる。 */
.kt-hero-grid {
  position: absolute;
  inset: 32px 20px 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    linear-gradient(var(--hair-soft) 1px, transparent 1px),
    linear-gradient(90deg, var(--hair-soft) 1px, transparent 1px);
  background-size:
    100% 25%,
    20% 100%;
  -webkit-mask-image: radial-gradient(
    120% 90% at 78% 30%,
    #000 0%,
    rgba(0, 0, 0, 0.35) 45%,
    transparent 72%
  );
  mask-image: radial-gradient(
    120% 90% at 78% 30%,
    #000 0%,
    rgba(0, 0, 0, 0.35) 45%,
    transparent 72%
  );
  opacity: 0.9;
}
@media (min-width: 640px) {
  .kt-hero-grid {
    inset: 32px 32px 0; /* sm:px-8 に追従 */
  }
}
/* --font-mono は @theme inline のため runtime CSS 変数として参照不可。
   :root に実在する --font-legacy-mono を使う。 */
.kt-hero-dim {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-legacy-mono);
  font-size: 9.5px;
  letter-spacing: 0.16em;
  color: var(--carbon-soft);
  white-space: nowrap;
}
.kt-hero-dim .kt-hero-tick {
  display: inline-block;
  width: 1px;
  height: 8px;
  background: var(--carbon-soft);
}
.kt-hero-dim--x {
  top: 24%;
  right: 4%;
}
.kt-hero-dim--y {
  top: 46%;
  right: 20%;
  writing-mode: vertical-rl;
}
.kt-hero-dim--y .kt-hero-tick {
  width: 8px;
  height: 1px;
}
.kt-hero-cross {
  position: absolute;
  font-family: var(--font-legacy-mono);
  font-size: 12px;
  color: var(--carbon-soft);
  transform: translate(-50%, -50%);
}
.kt-hero-cross--tl {
  top: 0;
  left: 0;
}
.kt-hero-cross--tr {
  top: 0;
  right: 0;
  transform: translate(50%, -50%);
}
.kt-hero-cross--bl {
  bottom: 8%;
  left: 0;
}
@media (max-width: 900px) {
  .kt-hero-grid {
    display: none; /* 旧 css:1499-1501 */
  }
}

/* ---------- 3) カラーストリップ (旧 css:514-536, 1554-1587) ---------- */
.kt-color-strip-wrap {
  position: relative;
  /* 進捗バー (兄弟枝の .kt-strip-progress-bar) から名前付き scroll timeline を
     参照するための scope 宣言。旧 CSS には無いが、現仕様ではサブツリー外参照に
     必須 (無いと Chrome で進捗バーが scaleX(0) のまま不可視になる)。 */
  timeline-scope: --kt-strip;
}
.kt-color-strip {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  padding: 4px 4px 26px;
  scrollbar-width: thin;
  scrollbar-color: var(--carbon-soft) transparent;
}
.kt-color-strip::-webkit-scrollbar {
  height: 4px;
}
.kt-color-strip::-webkit-scrollbar-thumb {
  background: var(--carbon-soft);
}
.kt-color-strip > * {
  flex: 0 0 clamp(200px, 22vw, 250px);
  scroll-snap-align: start;
}
.kt-strip-foot {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 20px;
}
.kt-strip-hint {
  margin: 0;
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--carbon-soft);
}
.kt-strip-progress {
  flex: 1;
  display: block;
  height: 2px;
  background: var(--hair);
  position: relative;
  overflow: hidden;
}
.kt-strip-progress-bar {
  position: absolute;
  inset: 0;
  background: var(--soul);
  transform-origin: left;
  transform: scaleX(0.15); /* scroll-timeline 非対応環境の静的表示 (旧 css:1574) */
}
@supports (animation-timeline: scroll()) {
  .kt-color-strip {
    scroll-timeline: --kt-strip x;
  }
  .kt-strip-progress-bar {
    transform: scaleX(0);
    animation: kt-strip-fill linear both;
    animation-timeline: --kt-strip;
  }
  @keyframes kt-strip-fill {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
}

/* ---------- reduced-motion キルスイッチ (旧 css:1130-1136 / 1446-1448 方式) ----------
   既存ブロック (kt-hero-line / kt-paint-mark / reveal / marquee) は上方で定義済み。
   ここでは本バンドが追加した機構だけを止める。wheel 変換は 1:1 の直接操作
   (アニメではない) のため対象外。 */
@media (prefers-reduced-motion: reduce) {
  .kt-hero-char {
    animation: none;
    transform: none;
    will-change: auto;
  }
  .kt-strip-progress-bar {
    animation: none;
    transform: scaleX(0.15);
  }
}
```

---

## §7 受入条件(これが全部 ✓ で完成)

### ビルド・基盤
1. `pnpm lint` / `pnpm test` / `pnpm build` すべて成功。新規依存が `package.json` に増えていない。
2. `next build` の出力で `/` が Static(prerendered)のまま(SSG 非退行)。
3. `.next/server/app/index.html`(または view-source)に `kt-hero-char` が **24 個**、`style="--ci:0"` 〜 `--ci:23` の通し番号で存在する(行跨ぎ・paint-mark 内も連番)。
4. `pnpm dev` でトップを開き、コンソールに hydration mismatch エラーが出ない。

### A) 文字リビール
5. リロード時: 文字が左上から 1 文字ずつ(0.032s 間隔、各 0.72s、下 115% から)立ち上がり、行 2・3 は行ライズ(0.12s/0.24s 遅延)と複合する。赤い塗りマーカーは約 1.05s 後に左から塗られる。
6. DevTools Performance でヒーロー由来の Layout Shift が 0(transform のみ、`.kt-hero-line` の overflow:hidden ではみ出しなし)。
7. DevTools Rendering → `prefers-reduced-motion: reduce` エミュレート + リロード: 見出しが即時・完全表示(アニメなし)。
8. a11y ツリーで h1 の accessible name が「3Dプリントを、量産品と見分けがつかない外観に。」。ブラウザの文字列検索・コピーで見出しテキストが取得できる。

### B) 設計図グリッド
9. ビューポート >900px: ヒーロー背後に 4×5 の罫線グリッド + 右上へ向かう radial フェード、右上に「200mm CLASS」、右中に縦書き「φ55」、四隅相当 3 箇所に「+」。
10. ≤900px: グリッド一式が非表示(旧 css:1499-1501)。
11. グリッド上でもテキスト選択・ボタンクリック・Tab フォーカスが一切阻害されない(pointer-events: none / z 順)。

### C) カラーストリップ
12. COLOR LINEUP 節が横一列ストリップ(カード幅 clamp(200px,22vw,250px)、gap 18px、snap、細スクロールバー)になり、8 カードの Link 先(/colors#c-xxx)・hover 浮上・光沢スライド・パール虹彩が置換前と同一に機能する。
13. ストリップ上で縦ホイール → 横スクロール。**左端で上方向 / 右端で下方向はページスクロールに抜ける**(ページがスクロールする)。トラックパッドの横パンは変換されない。
14. タッチ環境(または DevTools タッチエミュレート): 横スワイプで自然にスクロール(JS 干渉なし)。
15. Chrome: スクロールに応じ赤い進捗バーが 0→100% に伸びる(timeline-scope 効果の確認)。Safari/Firefox: バーが静的 15% 表示でエラーなし。
16. reduced-motion: 進捗バーは静的 15%、wheel 変換は生きている(直接操作のため)。
17. Reveal(節全体のフェードイン)が置換前と同様に発火し、`kmb:reveal-done` が飛ぶ(コンソールで `window.addEventListener("kmb:reveal-done", () => console.log("ok"))` 確認)。

### エディタ共存
18. `/edit`(ホーム)で同ページボディがエラーなく描画され、SlotImage のホットスポット編集(hero 写真バンド / craft / gallery)が置換前どおり動く。

## §8 テスト方針

- **ユニット(vitest, node 環境, 既存 config 無変更)**: 新規 2 ファイル。`.test.ts`(tsx でなく)で書く — vitest.config の include が `tests/**/*.test.ts` のため。React は `createElement` + `renderToStaticMarkup` を使う。
- `tests/motion-home-split-chars.test.ts`:
  - 「外観に。」→ `kt-hero-char` が 4 個、`--ci:0`〜`--ci:3`。
  - ネスト(kt-hero-line > span > テキスト + kt-paint-mark)→ 12 個で通し番号継続(`--ci:11` あり)、`kt-paint-mark` クラスが構造保存されている。
  - `"A B"` → span 2 個(空白は素通し)。
  - 3 行のヒーロー実データ → 24 個、`--ci:23` が最終。
- `tests/motion-home-strip-wheel.test.ts`(§C.2 の意味論):
  - 縦優勢(|dY|>|dX|)で deltaY を返す(正負とも)/ 横優勢・**等値**は null / 左端×上方向は null / 右端(scrollLeft+clientWidth >= scrollWidth-1)×下方向は null / 端でも逆方向は変換する。
- **手動 E2E(受入条件 §7 を Chrome 実機で消化)**: キーボード必須チェック — Tab でヒーロー 3 ボタン → ストリップ内 8 Link を順に巡回でき、フォーカスリング可視、Enter で遷移すること。reduced-motion・タッチエミュレート・Safari(または @supports を一時 false 化)での確認を含む。
- 2 回連続 PASS で完了(implementer+tester ペア運用)。

## §9 実装順序(コミット粒度)

1. `src/components/motion/` 新設 + split-chars.tsx + strip-wheel.ts + テスト 2 本(この時点で `pnpm test` green)
2. globals.css バンド追記(§6 全文)
3. page-body.tsx の 3 変更(A.3 → B.1 → C.4)+ color-strip.tsx
4. `pnpm lint && pnpm test && pnpm build` → 手動 E2E(§7)

## §10 正典パラメータ適用表(motion-gap-report.md §5 との突合)

| 動き | 正典値 | 本仕様での適用箇所 |
|---|---|---|
| 文字分割リビール | 0.72s / 0.032s×通し番号 / translateY(115%) / ロード時発火 | `.kt-hero-char`(§6)— 同値。発火は first paint(ロード時と同義でより早い) |
| 行リビール | 1s / 0.12s/行 / translateY(110%) | 既存 `.kt-hero-line` を無変更で維持(旧は文字分割と併走) |
| 塗りマーカー | 0.7s / **分割時 1.05s** | 既存 0.7s 維持 + `.kt-hero-title--split` で delay 1.05s 上書き |
| ストリップ wheel 変換 | 縦優勢判定 / 端で素通し / passive:false | `resolveStripWheel` + native listener(旧 main.js:197-210 と同一意味論) |
| ストリップ進捗バー | scroll-timeline / フォールバック scaleX(0.15) | §6(唯一の追加 = `timeline-scope`、理由は §C.1) |
| easing | cubic-bezier(0.22,1,0.36,1) | 全アニメ `var(--ease)` |
| reduced-motion | 一括キル(旧 css:1130-1136 方式) | §6 バンド末尾 + 既存ブロック |


---

## リスク (班申告)
- 指示された worktree agent-a24a69628487d5f3e はセッション中に main へマージ済みで削除されていた (930c177 V2a → 334f6fe V2b)。本仕様は main の同一ファイル (行番号は main 現物で再検証済み) を対象にしている。実装時は main から新規ブランチ/worktree を切ること
- 旧 CSS の進捗バーは現行の Scroll-driven Animations 仕様では名前付き timeline をサブツリー外 (兄弟枝) から参照できず Chrome で scaleX(0) のまま不可視になるため、timeline-scope: --kt-strip を追加した。正典からの唯一の追加であり、旧実装の意図 (バーがスクロールで伸びる) を成立させる修正。視覚 QA で必ず Chrome 実機確認すること
- React の onWheel はルートに passive 登録されるため preventDefault が無効。実装者が native addEventListener({ passive: false }) を onWheel に置き換えると症状なしに壊れる (ページも同時にスクロールする)。受入条件 13 で必ず検知すること
- 設計図グリッドの inset top 32px は座標系換算 (旧: 全幅 hero + 固定ヘッダー基準の 96px) による適応値。ピクセルパーフェクトではないため、legacy サイトとの並置視覚比較で微調整の余地あり (±8px 程度)
- h1 の文字分割はコピー/検索/SEO 上は問題ない (span 連結で空白が入らない) が、ブラウザ翻訳 (Google 翻訳) が span 単位で誤翻訳する可能性は旧サイト同様に残る
- page-body.tsx のヒーロー節・COLOR LINEUP 節は本班が単独所有する前提。M2 班 (刷毛ボタン等) が ArrowButton コンポーネント側を変更しても衝突しないが、万一他班が page-body.tsx を触る場合はマージ順を調整すること
- vitest.config の include は tests/**/*.test.ts のみ (tsx 不可・node 環境)。テストは createElement + renderToStaticMarkup で書く設計にしてあり、config を変更してはならない (他班との衝突源になる)
- Safari / Firefox (scroll-timeline 未対応) では進捗バーが静的 15% 表示になる。これは旧サイトと同一のフォールバック挙動であり不具合ではない (JS フォールバックは EXTRA 参照)

## EXTRA 提案 (原案)
- [EXTRA] 塗料の粘性ホイール慣性: ColorStrip の wheel 変換を scrollLeft 直代入から rAF + lerp(係数 0.18 — カーソルリングの正典係数を流用) の追従スクロールに変更し、色見本カードを「濡れた塗膜の上で引きずる」ような粘性の手触りにする。reduced-motion 時は直代入へフォールバック。実装コスト: color-strip.tsx 内 +30 行程度、約 1 時間 (strip-wheel.ts の純関数はそのまま使える)
- [EXTRA] 文字の「塗られて現れる」リビール: kt-hero-char の rise と同時に background-clip:text + 下→上の塗り上げ (clip-path inset(100% 0 0 0)→0) を重ね、文字自体が刷毛で塗られて定着する表現にする。colors ページの swatch-paint (旧 css:1530-1539) と語彙が揃い「色見本帳」のブランド一貫性が出る。正典パラメータ (0.72s/0.032s) は不変で塗りだけ追加。実装コスト: CSS のみ +15 行、約 1-2 時間 (Safari の text-clip 検証込み)
- [EXTRA] 進捗バーの JS フォールバック: @supports (animation-timeline) 非対応環境 (Safari/Firefox) 向けに、ColorStrip の scroll イベントで --kt-strip-progress CSS 変数を rAF スロットル更新し scaleX に反映。旧サイトの「静的 15%」を超えるパリティ超え。実装コスト: color-strip.tsx +20 行、約 0.5-1 時間
- [EXTRA] 設計図グリッドの検分ルーペ: pointer:fine 環境限定で、ヒーローの mousemove に追従して radial-gradient マスクの中心 (--gx/--gy) が動き、カーソル付近のグリッド罫線と寸法マーカーがわずかに浮かび上がる「図面をルーペで検分する」演出。colors のチルト実装 (旧 main.js:163-195) と同じ CSS 変数直代入パターン。reduced-motion で無効、/edit には SlotImage が無い節なので干渉なし。実装コスト: 小型 client コンポーネント +40 行と CSS +10 行、約 2 時間

## 対象ファイル
src/app/(site)/page-body.tsx, src/app/globals.css, src/components/motion/split-chars.tsx, src/components/motion/strip-wheel.ts, src/components/motion/color-strip.tsx, tests/motion-home-split-chars.test.ts, tests/motion-home-strip-wheel.test.ts
