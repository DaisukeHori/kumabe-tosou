# M3 実装仕様書 — スクロール駆動 6 種 (G7) + 質感装飾 (G10/G11/G12)

- 班: scroll-texture (M3)
- 実装ターゲット: **main @ 334f6fe**(V2a/V2b は main にマージ済み。指示にあった worktree `agent-a24a69628487d5f3e` は 2026-07-09 にマージ後削除された。本仕様のパス・行番号はすべて main 基準で再検証済み)
- 旧実装の正: `legacy/css/style.css`(本仕様に行番号併記)。G7/G10/G11/G12 に JS は不要(`legacy/js/main.js` に該当コードなし)。**新規クライアントコンポーネント 0 個**、新規依存 0 個
- パラメータ正典: `docs/design/motion-gap-report.md` §2・§5(全値そのまま採用。変更提案は [EXTRA] のみ)

---

## 0. 全体設計

| 原則 | 本仕様での実現 |
|---|---|
| SSG 非退行 | 変更は CSS 追記 + 既存 JSX への className 追加 + Server Component 1 個(`PaperNoise`、"use client" なし)。request-time API・クライアント JS 追加なし |
| reduced-motion キルスイッチ | G7 全 6 種は legacy css:1504-1505 と同じ二重ガード `@supports (animation-timeline: view()) { @media (prefers-reduced-motion: no-preference) { … } }` 内のみに書く。G12 は reduce 時 transition:none(状態変化は即時反映され a11y 情報は保持) |
| pointer:fine ガード | 本班の 10 機構はいずれもポインタ非依存(スクロール駆動 + 静的装飾 + タップでも成立するトグル)のため適用対象なし |
| 非対応ブラウザとの共存 | `@supports` 非対応(Firefox 安定版想定)ではブロック丸ごと無効 → 既存 Reveal(IO フェード)が従来どおり働く。**唯一の同一要素重複は SecTitle**(.reveal と title-lift が同じ h2 に載る。legacy も同構造 css:1541 + html `class="sec-title reveal"`)— @supports 内で `transition: none` を明示し、opacity/transform の所有権をスクロール駆動側に一本化して二重発火を排除 |
| ビジュアルエディタ共存 | data-editable-* には一切触れない。追加するのは className のみ。clip-path はレイアウト寸法を変えないため V2b のホットスポット座標測定に影響しない。紙ノイズは「オーバーレイ」ではなく z-index:-1・pointer-events:none の背景レイヤなので (editor) にも載せ、/edit iframe と公開ページの見た目を一致させる(カーソル/インジケータ等の前面オーバーレイ禁止則には抵触しない) |
| CSS 追記位置 | `src/app/globals.css` **末尾**(既存 `@media (prefers-reduced-motion: reduce)` ブロック行 358-377 の後)に `/* === motion: scroll-texture === */` 区切りで 1 ブロック追記 |

### クラス設計一覧(全体対応表)

| 新クラス | 役割 | 付与先 (main の file:line) | 旧実装 (legacy css) | 正典パラメータ |
|---|---|---|---|---|
| `.kt-rule` | 罫線+両端レジマーク (G11) | page-blocks.tsx:25 (PageHead) / :66 (SectionMark) | 1236-1256 | 静的 |
| `.kt-sd-rule` | 罫線の左→右描画 (G7-1) | page-blocks.tsx:66 (SectionMark のみ。legacy 1508 も .sec-mark .rule のみ) | 1507-1517 | entry 0%–62%, clip-path |
| `.kt-sd-title` | 見出しパララックス (G7-2) | page-blocks.tsx:76 (SecTitle) | 1541-1550 | entry 0%–55%, opacity 0.35→1 + translateY(26px→0) |
| `.kt-sd-photo` | 写真せり上がり (G7-3) | slot-image.tsx:85 (Image) | 2487-2500 | entry 0%–45%, clip-path 下→上 |
| `.kt-sd-swatch` | 色板の塗り登場 (G7-4) | colors/page-body.tsx:142 (Drawdown) | 1530-1539 | entry 6%–60%, clip-path |
| `.kt-colors-sec` / `.kt-color-entry` | 透かし番号 01-08 + パララックス (G7-5) | colors/page-body.tsx:249 / :175 | 1271-1294 + 1519-1528 | cover, translateY(48px→-48px) |
| `.kt-sd-qty` | 数量バー伸長 (G7-6) | service/page-body.tsx:259 | 1589, 1624-1636 | entry 10%–70%, scaleX(0→1) |
| `.kt-paper-noise` | 紙ノイズ (G10) | 新規 PaperNoise → (site)/(editor) layout | 1333-1341 | opacity 0.045 (SVG 内), data URI |
| `.kt-header-edge` | ヘッダー 8 色小口帯 (G11) | site-header.tsx:34 | 1207-1222 | 静的 3px |
| `.kt-footer-ticks` | フッター目盛り (G11) | site-footer.tsx:27 | 1258-1269 | 静的 12px |
| `.kt-nav-toggle` | ハンバーガー→X (G12) | site-header.tsx:73-85 | 179-192 | 0.3s var(--ease) |

easing は既存 `--ease: cubic-bezier(0.22,1,0.36,1)`(globals.css:170、旧 css:41 と同値)のみ使用。スクロール駆動 6 種は legacy 同様 `linear`(進捗=スクロール位置なので timing function は linear が正)。

---

## 1. `src/app/globals.css` — 末尾に追記(貼り付け可能・全文)

既存ファイル(377 行)の末尾にそのまま追記する。**既存行の変更は一切なし。**

```css

/* === motion: scroll-texture === */
/* =============================================================
   M3 — スクロール駆動 6 種 (G7) + 質感装飾 (G10/G11/G12)
   旧実装対応: legacy/css/style.css
     G7  … 1503-1550 / 2487-2500 / 1589+1624-1636
     G10 … 1333-1341   G11 … 1207-1222, 1236-1256, 1258-1269
     G12 … 179-192     透かし番号(G7-5 前提) … 1271-1294
   パラメータ正典: docs/design/motion-gap-report.md §2/§5
   ============================================================= */

/* ---------- G11-a) 罫線 + レジストレーションマーク (legacy 1236-1256) ----------
   罫線本体は両端 16px を空けた中央グラデ、両端に 9px の「+」。
   legacy 同様 flex:1 で残余幅いっぱいに伸ばす (旧 .sec-mark/.page-index の .rule)。 */
.kt-rule {
  position: relative;
  flex: 1;
  height: 1px;
  background: linear-gradient(var(--hair), var(--hair)) center / calc(100% - 32px)
    1px no-repeat;
}
.kt-rule::before,
.kt-rule::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  transform: translateY(-50%);
  background:
    linear-gradient(var(--hair), var(--hair)) center / 1px 100% no-repeat,
    linear-gradient(var(--hair), var(--hair)) center / 100% 1px no-repeat;
}
.kt-rule::before {
  left: 0;
}
.kt-rule::after {
  right: 0;
}

/* ---------- G11-b) ヘッダー 8 色小口帯 — 色見本帳の小口染め (legacy 1207-1222) ----------
   header は sticky (=positioned) なので ::before の absolute 基準になる。 */
.kt-header-edge::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(
    90deg,
    var(--dd-090-b) 0 12.5%,
    var(--dd-46v-a) 12.5% 25%,
    var(--dd-4y6-a) 25% 37.5%,
    var(--dd-3t4-b) 37.5% 50%,
    var(--dd-202-a) 50% 62.5%,
    var(--dd-tv2-a) 62.5% 75%,
    var(--dd-am-a) 75% 87.5%,
    var(--dd-46g-a) 87.5% 100%
  );
  pointer-events: none;
}

/* ---------- G11-c) フッター目盛りティック — 定規 (legacy 1258-1269) ---------- */
.kt-footer-ticks {
  position: relative;
}
.kt-footer-ticks::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 12px;
  background:
    repeating-linear-gradient(90deg, var(--hair) 0 1px, transparent 1px 96px)
      left top / auto 12px repeat-x,
    repeating-linear-gradient(90deg, var(--hair-soft) 0 1px, transparent 1px 12px)
      left top / auto 7px repeat-x;
  pointer-events: none;
}

/* ---------- G10) 紙の微細ノイズ (legacy 1333-1341 body::before の移植) ----------
   body は /admin と共有のため body::before ではなく、(site)/(editor) レイアウトが
   描画する固定レイヤ (PaperNoise) に載せる。z-index:-1 で body 背景の上・
   コンテンツの下に入る (legacy と同じ重なり)。 */
.kt-paper-noise {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23p)' opacity='0.045'/%3E%3C/svg%3E");
  pointer-events: none;
}

/* ---------- G12) ハンバーガー → X モーフィング (legacy 179-192) ----------
   Base UI の Dialog.Trigger は開時に aria-expanded="true" と data-popup-open を
   トリガー button に付与する。両方をセレクタにして版差に備える。 */
.kt-nav-toggle {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kt-nav-toggle span {
  display: block;
  width: 24px;
  height: 1.5px;
  background: var(--carbon);
  transition: transform 0.3s var(--ease);
}
[aria-expanded="true"] .kt-nav-toggle span:nth-child(1),
[data-popup-open] .kt-nav-toggle span:nth-child(1) {
  transform: translateY(3.75px) rotate(45deg);
}
[aria-expanded="true"] .kt-nav-toggle span:nth-child(2),
[data-popup-open] .kt-nav-toggle span:nth-child(2) {
  transform: translateY(-3.75px) rotate(-45deg);
}

/* ---------- G7-5 前提) colors 巨大透かし番号 01-08 (legacy 1271-1294) ----------
   legacy は body[data-page=colors] main を counter スコープにしていたが、
   現行は route group で body 属性を持たないため Section に .kt-colors-sec を付けて
   スコープする。--font-wide (Archivo) は現行未ロードのためフォールバックスタック
   (Helvetica Neue) で描画される (globals.css:163 の既存方針どおり)。 */
.kt-colors-sec {
  counter-reset: swatch;
}
.kt-color-entry {
  position: relative;
  counter-increment: swatch;
}
.kt-color-entry::after {
  content: "0" counter(swatch);
  position: absolute;
  top: clamp(24px, 4vw, 48px);
  right: 0;
  font-family: var(--font-wide);
  font-weight: 700;
  font-stretch: 125%;
  font-size: clamp(64px, 10vw, 150px);
  line-height: 1;
  letter-spacing: 0.02em;
  color: transparent;
  -webkit-text-stroke: 1px rgba(23, 25, 27, 0.13);
  pointer-events: none;
  user-select: none;
  z-index: 0;
}
.kt-color-entry > * {
  position: relative;
  z-index: 1;
}

/* ---------- G7) スクロール駆動 6 種 (legacy 1503-1550 / 2487-2500 / 1624-1636) ----------
   二重ガード: @supports 非対応 (Firefox 安定版等) はブロック丸ごと無効になり
   既存 Reveal (IO フェード) がフォールバックとして機能する。
   reduced-motion は no-preference 側にしか書かないので追加キルスイッチ不要。 */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    /* G7-1) セクション罫線が画面に入ると左から引かれる (legacy 1507-1517) */
    .kt-sd-rule {
      transform-origin: left center;
      animation: kt-rule-draw linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 62%;
    }

    /* G7-2) セクションタイトルの微パララックス上昇 (legacy 1541-1550)。
       同一 h2 に .reveal が付く (legacy html も sec-title reveal 併記で同構造)。
       アニメーション origin が opacity/transform を常時所有するため実害はないが、
       二重発火を仕様として明示的に断つため transition を無効化する。
       (このルールは .reveal より後ろに現れるため同 specificity で勝つ) */
    .kt-sd-title {
      transition: none;
      animation: kt-title-lift linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 55%;
    }

    /* G7-3) 写真がビュー内で下からせり上がる (legacy 2487-2500)。
       Reveal は親 figure のフェード、こちらは img の clip なので二重発火なし
       (legacy も figure.photo.reveal + img アニメの並存)。 */
    .kt-sd-photo {
      animation: kt-photo-reveal linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 45%;
    }

    /* G7-4) colors 色板が下から塗られて登場 (legacy 1530-1539) */
    .kt-sd-swatch {
      animation: kt-swatch-paint linear both;
      animation-timeline: view();
      animation-range: entry 6% entry 60%;
    }

    /* G7-5) colors 透かし数字の縦パララックス (legacy 1519-1528) */
    .kt-color-entry::after {
      animation: kt-wm-parallax linear both;
      animation-timeline: view();
      animation-range: cover;
    }

    /* G7-6) service 数量バーの伸長 (legacy 1624-1636) */
    .kt-sd-qty {
      transform-origin: left;
      animation: kt-qty-grow linear both;
      animation-timeline: view();
      animation-range: entry 10% entry 70%;
    }
  }
}

@keyframes kt-rule-draw {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
@keyframes kt-title-lift {
  from {
    opacity: 0.35;
    transform: translateY(26px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes kt-photo-reveal {
  from {
    clip-path: inset(0 0 100% 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
@keyframes kt-swatch-paint {
  from {
    clip-path: inset(100% 0 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
@keyframes kt-wm-parallax {
  from {
    transform: translateY(48px);
  }
  to {
    transform: translateY(-48px);
  }
}
@keyframes kt-qty-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* reduced-motion: G12 はトグルの状態変化のみ即時反映 (a11y 情報は保持) */
@media (prefers-reduced-motion: reduce) {
  .kt-nav-toggle span {
    transition: none;
  }
}

/* 印刷: scroll timeline が解決できず from 状態で固まる事故を防ぐ */
@media print {
  .kt-sd-rule,
  .kt-sd-title,
  .kt-sd-photo,
  .kt-sd-swatch,
  .kt-sd-qty,
  .kt-color-entry::after {
    animation: none;
  }
  .kt-paper-noise {
    display: none;
  }
}
/* === /motion: scroll-texture === */
```

---

## 2. `src/components/motion/paper-noise.tsx` — 新規(全文)

```tsx
/**
 * G10 紙の微細ノイズ (legacy/css/style.css:1333-1341 body::before の移植)。
 * body は /admin と共有のため body::before は使わず、公開サイト側レイアウト
 * ((site) と (editor)) が描画する固定背景レイヤとして実装する。
 * Server Component (JS なし) — SSG 非退行。z-index:-1 / pointer-events:none で
 * コンテンツ・ビジュアルエディタのホットスポット操作に一切干渉しない。
 */
export function PaperNoise() {
  return <div className="kt-paper-noise" aria-hidden="true" />;
}
```

## 3. `src/app/(site)/layout.tsx` — 変更

import 追加 + `<SiteHeader />` の直前に 1 行:

```tsx
import { PaperNoise } from "@/components/motion/paper-noise";
```

```tsx
      {/* 変更前: <SiteHeader /> の直前に挿入 */}
      <PaperNoise />
      <SiteHeader />
```

## 4. `src/app/(editor)/layout.tsx` — 変更

同上(import + `<SiteHeader />` 直前に `<PaperNoise />`)。/edit iframe の見た目を公開ページと一致させるため。前面オーバーレイではないので編集操作を阻害しない。

## 5. `src/components/site/page-blocks.tsx` — 変更 3 箇所

**5-1. PageHead(行 25)** — レジマーク付き罫線に置換。legacy(css:209 `.page-index .rule { flex: 1 }`)どおり罫線が残余幅に伸び、EN ラベルが右端に寄る(意図的な legacy パリティ復元。§8 受入条件 7 で視認確認):

```tsx
      {/* 変更前: <span className="h-px w-16 bg-hair" aria-hidden="true" /> */}
      <span className="kt-rule" aria-hidden="true" />
```

**5-2. SectionMark(行 66)** — レジマーク + スクロール描画:

```tsx
      {/* 変更前: <span className="h-px w-12 bg-hair" aria-hidden="true" /> */}
      <span className="kt-rule kt-sd-rule" aria-hidden="true" />
```

**5-3. SecTitle(行 72-81)** — className に `kt-sd-title` を追加:

```tsx
export function SecTitle({ children }: { children: React.ReactNode }) {
  return (
    <Reveal
      as="h2"
      className="kt-sd-title mt-6 text-[clamp(26px,3.6vw,44px)] font-bold leading-snug tracking-[0.04em]"
    >
      {children}
    </Reveal>
  );
}
```

## 6. `src/components/site/slot-image.tsx` — 変更 1 箇所(行 79-87)

`<Image>` の className に `kt-sd-photo` を追加(NO IMAGE プレースホルダ側には付けない):

```tsx
      <Image
        src={resolved.src}
        alt={resolved.alt}
        fill
        priority={slot.priority}
        sizes={sizes}
        className="kt-sd-photo object-cover"
      />
```

data-editable-* を出す `editableAttrs` はラッパー div 側で不変。clip-path は寸法を変えないため V2b の座標測定(visual-coordinate-mapping)に影響しない。

## 7. `src/app/(site)/colors/page-body.tsx` — 変更 3 箇所

**7-1. Drawdown の色板(行 141-145)** — `kt-sd-swatch` 追加:

```tsx
      <div
        className="kt-sd-swatch relative aspect-[4/3] w-full overflow-hidden"
        style={{ background: `linear-gradient(168deg, ${a}, ${b})` }}
        aria-hidden="true"
      >
```

**7-2. ColorEntry の article(行 171-176)** — `kt-color-entry` 追加(透かし番号 + パララックスの基点。`relative` は CSS 側 `.kt-color-entry` が持つ):

```tsx
    <Reveal
      as="article"
      id={sw.id}
      className="kt-color-entry grid scroll-mt-24 gap-8 border-t border-hair py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-14"
    >
```

**7-3. 8 色を包む Section(行 249)** — counter スコープ:

```tsx
      <Section className="kt-colors-sec">
```

(間に挟まる PhotoFigure は `.kt-color-entry` を持たないため counter は 01〜08 で正しく振られる)

## 8. `src/app/(site)/service/page-body.tsx` — 変更 1 箇所(行 257-262)

数量バーの内側 span に `kt-sd-qty` を追加(width 85%/75% は据え置き、その上に scaleX 0→1 が乗る = legacy の `--w` × scaleX と同じ構造):

```tsx
                  <span className="h-2 bg-hair-soft">
                    <span
                      className={`kt-sd-qty block h-full ${row.best ? "bg-soul" : "bg-carbon/60"}`}
                      style={{ width: row.w }}
                    />
                  </span>
```

## 9. `src/components/site/site-header.tsx` — 変更 2 箇所

**9-1. header 要素(行 34)** — 小口帯:

```tsx
    <header className="kt-header-edge sticky top-0 z-50 border-b border-hair bg-primer/80 backdrop-blur-md">
```

**9-2. ハンバーガー(行 2 の import と行 73-85)** — `import { MenuIcon } from "lucide-react";` を削除し、SheetTrigger の子を 2 本バーに置換:

```tsx
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="メニューを開く"
              />
            }
          >
            <span className="kt-nav-toggle" aria-hidden="true">
              <span />
              <span />
            </span>
          </SheetTrigger>
```

Base UI Dialog.Trigger が開時にトリガー button へ `aria-expanded="true"` / `data-popup-open` を付与するため、site-header は Server Component のまま(state 不要)。SheetContent 既定の閉じるボタンは残す(バックドロップが bg-black/10 の半透明なので、閉じ動作中の X→ハンバーガー戻りモーフも視認できる)。

## 10. 実装順序(1 コミットで可)

1. globals.css 追記 → 2. paper-noise.tsx 新規 → 3. 各 TSX の className 追加 → 4. layout 2 件 → 5. 検証(§11)

---

## 11. 受入条件

前提: `npm run dev`。スクロール駆動対応ブラウザ = Chrome/Edge 115+・Safari 18.2+。非対応 = Firefox 安定版(2026-07 時点想定。もし対応済みなら DevTools で `@supports` を無効化して代替確認)。

1. **G7-1 罫線**: /service /story /about 等で SectionMark の罫線が、セクションのビューポート進入 0%→62% に同期して左→右に描かれる(スクロールを途中で止めると線も途中で止まる = scroll 駆動である証拠。時間駆動ではないこと)
2. **G7-2 見出し**: SecTitle が opacity 0.35→1 / translateY 26px→0 で進入 0-55% に同期して立ち上がる。**フェードが 1 回しか見えないこと**(Reveal との二重発火なし)
3. **G7-3 写真**: / (home) や /colors の FIG 画像が下から clip で立ち上がる(進入 0-45%)。NO IMAGE プレースホルダは動かない
4. **G7-4/5 colors**: /colors で ①色板が下から塗られて登場(進入 6-60%)②右上に 01〜08 のアウトライン透かし番号が表示され、スクロールで +48px→-48px に逆行パララックスする ③番号は写真バンドを挟んでも 01〜08 連番
5. **G7-6 qty**: /service「QUANTITY — 数量スライド」の 3 本バーが左から伸びる(進入 10-70%)。伸長後の最終幅が 100%/85%/75% であること
6. **G10 ノイズ**: 公開ページの背景に微細な紙ノイズが載る(拡大 or カラーピッカーで --primer 単色でないことを確認)。/admin/** には出ない
7. **G11**: 全公開ページでヘッダー上端に 3px の 8 色帯 / SectionMark・PageHead の罫線両端に「+」レジマーク(罫線は右端まで伸び、ラベルが右寄せになる = 意図したレイアウト変更) / フッター上端に定規ティック。/admin には出ない
8. **G12**: <1024px でハンバーガー 2 本バー表示 → タップで Sheet が開き X にモーフ(0.3s)→ 閉じると戻る。DevTools でトリガー button に `aria-expanded` / `data-popup-open` が付くことを確認(付かない場合は §risks-4 のフォールバック)
9. **フォールバック**: Firefox(または @supports 内を一時 disable)で全ページ表示 → G7 は無効だが既存 Reveal フェードで全コンテンツ表示、透明・欠落なし
10. **reduced-motion**: DevTools Rendering → prefers-reduced-motion: reduce で G7 全停止・コンテンツ即時表示・G12 即時切替。ノイズ/小口帯/ティック(静的装飾)は表示継続で正
11. **SSG 非退行**: `npm run build` で公開ページが従来どおり Static(○)のまま。ビルドエラーなし
12. **エディタ非退行**: `npm test` PASS(既存全件、特に slot-image-editable-attrs / visual-coordinate-mapping / edit-page-map)。/edit/colors 等で画像ホットスポットのクリック→差し替えが従来どおり動く
13. **印刷**: /colors の印刷プレビューで写真・色板が clip されず全表示
14. **横スクロール非発生**: 375px 幅で /colors を全域スクロールし、水平スクロールバーが出ない(透かし番号は right:0 アンカーで entry 内に収まる)

## 12. テスト方針

- **単体**: 既存 vitest 全件 PASS 維持(本班の変更はロジック無変更・className 追加のみ。snapshot 型のテストは存在しないことを確認済み)。新規単体テストは対象が CSS のため追加しない
- **E2E(Chrome MCP / Playwright)**: ①/service を 3 段階の scrollY で screenshot し、罫線・バーの伸長率が単調増加すること ②CDP `Emulation.setEmulatedMedia({ features: [{ name: "prefers-reduced-motion", value: "reduce" }] })` で全静止・全表示 ③375px viewport で G12 開閉 + 横スクロール検査 ④/admin/login にノイズ・小口帯が無いこと
- **クロスブラウザ**: Chrome(フル動作)/ Safari 18.2+(フル動作 + clip-path 描画崩れがないか実機確認)/ Firefox 安定版(フォールバック動作)
- **2 回連続 PASS ルール**: 上記受入 1-14 を実装直後と修正後の 2 サイクルで全通し

## 13. 他班との境界(実装者への注意)

- **G8(写真 hover grayscale→カラー+ズーム)は M2 班**。slot-image.tsx:85 の同じ className 行に両班がクラスを足すため、後からマージする側は両クラス併記(`"kt-sd-photo kt-hover-photo object-cover"` 等)にすること
- **qty-fill の斜め縞質感(legacy 1605-1622)と dd-edge 刷毛(337-341)は M4 班**。本班は動きのみ
- **colors 透かし番号(静的部分含む)は本班が所有**。M4 colors 班(チルト・光沢追従担当)は再実装しないこと
- CSS は必ず自班マーカー内に閉じる(`/* === motion: scroll-texture === */` 〜 `/* === /motion: scroll-texture === */`)

---

## リスク (班申告)
- 【前提変化】指示にあった V2a worktree (agent-a24a69628487d5f3e) は調査中にマージ・削除された (main 334f6fe に V2a+V2b 反映済み)。本仕様は main 基準。他班の仕様が worktree パスのままなら main に読み替えが必要
- 【班間ファイル競合】slot-image.tsx / page-blocks.tsx / site-header.tsx は M2 班 (G5刷毛・G8写真hover・G4ナビ) も className 行を触る見込み。CSS はマーカー分離で安全だが TSX は同一行競合になるため、班のマージは逐次 (並列 worktree なら conflict 解決前提) にすること
- 【意図的レイアウト変更】PageHead/SectionMark の罫線を legacy 準拠 flex:1 に戻すため、ラベルが右端に寄る視覚変化が全ページに出る (parity 復元だが視覚回帰として要周知。回帰扱いする場合は kt-rule から flex:1 を外し現行幅維持も可)
- 【Base UI 属性依存】G12 の開閉セレクタは Base UI Dialog.Trigger が付与する aria-expanded / data-popup-open に依存。@base-ui/react のバージョンで属性名が変わると morphing が発火しない (機能自体は壊れない)。受入条件 8 で実属性を必ず確認し、無ければ Sheet の onOpenChange で開閉クラスを付ける最小クライアント分離にフォールバック
- 【透かし番号の重複実装】G7-5 の前提となる colors 透かし番号 (静的 ::after + counter) を本班が作る。M4 colors 班と所有権を明確化しないと二重実装になる (仕様 §13 に明記済み)
- 【Safari 実機】animation-timeline: view() は Safari 18.2+ 対応だが、Next/Image (fill) + clip-path アニメの組合せは iOS Safari で描画チラつきの前例があるため実機確認を受入に含めた
- 【印刷】scroll timeline が解決できない印刷コンテキストで clip-path の from 状態のまま固まるリスク → @media print { animation: none } で回避済み (仕様に含む)。ただし既存 Reveal の opacity:0 印刷問題は本班スコープ外の既存事象
- 【透かし番号のフォント】legacy の --font-wide (Archivo, font-stretch 125%) は現行未ロードのため Helvetica Neue フォールバックで字形がやや細くなる (globals.css:159 の既存方針を踏襲。Archivo 追加ロードは行わない)

## EXTRA 提案 (原案)
- [EXTRA-1] 刷毛目ワイプ写真リビール (実装 0.5 日): G7-3 の写真せり上がりを、直線の clip-path でなく荒い刷毛エッジの SVG data-URI を mask-image にして mask-position を同じ view() timeline で動かす方式に格上げ。写真が「刷毛で塗り出される」ように登場し、塗装工房のブランド署名になる。CSS 約 30 行 + テクスチャ 1 枚、JS 不要・reduced-motion/フォールバック構造は本仕様のまま流用可
- [EXTRA-2] 透かし番号の色見本連動 (実装 0.1 日): /colors の透かし番号 01-08 の -webkit-text-stroke 色を一律 rgba(23,25,27,0.13) でなく各エントリの swatch A 色 (var(--dd-090-a) 等を color-mix で 13% 不透明化) にする。ページを下るごとに透かしの色が「色見本帳のインデックス」として引き継がれ、G7-5 のパララックスと相乗する。ColorEntry に style={{ '--wm': sw.a }} を 1 個足すだけ
- [EXTRA-3] 塗料粘性イージングトークン (実装 0.25 日): CSS linear() 関数で「粘って糸を引いてから追いつく」2 段カーブ --ease-viscous を globals.css に追加し、G12 のモーフと将来の hover 系 (M2 班の刷毛ストローク等) に適用。スクロール駆動 6 種は linear が正典なので適用しない (正典パラメータは不変更)。全班共有トークンになるためオーケストレータ承認後に導入推奨
- [EXTRA-4] MediaCover への kt-sd-photo 展開 (実装 0.1 日): legacy の photo-reveal は全 10 ページの figure.photo img に効いていた。新設 DB ページ (works/voices/notes 一覧カード) の MediaCover (src/components/site/media-cover.tsx:56 の Image) にも kt-sd-photo を足せば、ギャップレポート B2 (works/voices の演出全欠落) の 3 割をこの班の CSS 資産だけで先行回収できる
- [EXTRA-5] ヘッダー小口帯の読了プログレス化 (実装 0.25 日): 8 色帯の上に scaleX を animation-timeline: scroll(root) で伸ばす擬似要素を重ね、ページ読了に応じて小口帯が「塗り進む」。ただし M1 班の G2 塗りプログレスバーと役割が重複するため、G2 実装が重いと判断された場合の代替案として提示

## 対象ファイル
/Users/horidaisuke/projects/kumabe-tosou/src/app/globals.css, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/page-blocks.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/slot-image.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/site-header.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/site/site-footer.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/colors/page-body.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/service/page-body.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/layout.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(editor)/layout.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/components/motion/paper-noise.tsx
