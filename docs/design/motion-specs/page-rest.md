# M4 実装仕様書 — service / about / shop / materials / notes ページ固有モーション (班: page-rest)

- 正典: `docs/design/motion-gap-report.md` §3 (service/about/shop/materials/notes) + §5 パラメータ表
- 旧実装の唯一の正: `legacy/css/style.css` / `legacy/*.html` (行番号は本文に明記)
- **実装ターゲットに関する重要な注記**: ブリーフィングにあった V2a worktree `.claude/worktrees/agent-a24a69628487d5f3e/` は本仕様作成中に消滅 (main へマージ済み)。main の `src/` が worktree と同一構造であることを検証済み (page-body.tsx 抽出済み、各ファイル行数一致: service 451 / shop 618 / about 274 / materials 407 / notes 95 / notes[slug] 56 / globals.css 377)。**以下のパスはすべて main の `src/` 基準**。実装時に別 worktree が指定された場合はそちらの同一パスに読み替えること。

## 0. 全体方針

- 追加 CSS は `src/app/globals.css` **末尾**に 1 ブロックで追記。区切りは `/* === motion: page-rest === */` (他班とのマージ衝突最小化)。
- クラス命名は既存慣習 (`kt-*`) を踏襲し、本班は `kt-qc-* / kt-qty-* / kt-map-* / kt-svc-* / kt-product-* / kt-pv-* / kt-mini-swatch / kt-timeline*` を使用。他班 (M1〜M3) と衝突しない名前空間。
- **新規クライアントコンポーネントは 0 個**。本班の演出はすべて「CSS + Server Component の JSX 変更」で完結する (SSG 完全非退行)。notes の前後ナビも build 時 fetch のみ。
- hover 系 (地図カラー化 / shop 写真 grayscale / 製品カード浮遊 / ミニスウォッチポップ) は `@media (hover: hover) and (pointer: fine)` でガード。**grayscale の常時適用もこの media 内に置く** — タッチ端末では hover でカラー化できず永久グレーになるため、タッチではカラーのまま表示する (旧サイトからの意図的な差分。旧は無条件適用だった)。
- reduced-motion: qty-fill のスクロール伸長は旧 css:1624-1636 と同じく `@media (prefers-reduced-motion: no-preference)` 内に置き、さらにブロック末尾に旧 css:1130-1136 方式の一括キル (`*, *::before, *::after` の duration 0.01ms) を含める。他班が同じ一括キルを追記しても冪等 (重複無害)。
- ビジュアルエディタ共存: data-editable-* を出す `SlotImage` / `MediaCover` は**一切変更しない**。shop 製品カードのモック復元は「editMode=false かつ 画像未設定」のときだけ描画し、/edit では従来どおり SlotImage の「画像を設定」導線を出す。オーバーレイ類は追加しないため (editor) レイアウトへの影響なし。`notes/_legacy-anchor-redirect.tsx` も無変更。

---

## 1. `src/app/globals.css` — 末尾に追記 (全文貼り付け可)

```css
/* === motion: page-rest === */
/* M4: service / about / shop / materials / notes ページ固有。
   正典: docs/design/motion-gap-report.md §3, §5。行番号は legacy/css/style.css。 */

/* ---------- service: QC チェック ✓ 赤アイコン (legacy css:1911-1927) ---------- */
.kt-qc-check {
  flex: none;
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 1.5px solid var(--soul);
  border-radius: 2px;
  position: relative;
}
.kt-qc-check::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid var(--soul);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

/* ---------- service: 数量バー 斜め縞 + スクロール伸長 (legacy css:1598-1636) ---------- */
.kt-qty-track {
  display: block;
  height: 8px;
  background: var(--primer-deep);
  border: 1px solid var(--hair);
  position: relative;
  overflow: hidden;
}
.kt-qty-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--w, 100%);
  background: repeating-linear-gradient(
    -45deg,
    var(--carbon) 0 6px,
    #2a2e32 6px 12px
  );
  transform-origin: left;
}
.kt-qty-fill--best {
  background: repeating-linear-gradient(
    -45deg,
    var(--soul) 0 6px,
    #c4132e 6px 12px
  );
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .kt-qty-fill {
      animation: kt-qty-grow linear both;
      animation-timeline: view();
      animation-range: entry 10% entry 70%;
    }
  }
}
@keyframes kt-qty-grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}

/* ---------- about: 地図 grayscale → hover カラー化 (legacy css:666-679)
   旧は無条件 grayscale だが、タッチでは hover 解除不能のため pointer:fine 限定 (意図的差分) */
@media (hover: hover) and (pointer: fine) {
  .kt-map-frame iframe {
    filter: grayscale(1) contrast(1.04);
    transition: filter 0.5s var(--ease);
  }
  .kt-map-frame:hover iframe {
    filter: grayscale(0);
  }
}

/* ---------- shop: グレードカード写真 grayscale → hover カラー+ズーム (legacy css:2954-2961)
   filter 0.7s / transform 1s の非対称 duration が正典 (§5「写真 hover」) */
@media (hover: hover) and (pointer: fine) {
  .kt-svc-card .kt-svc-photo img {
    filter: grayscale(0.9) contrast(1.05);
    transition:
      filter 0.7s var(--ease),
      transform 1s var(--ease);
  }
  .kt-svc-card:hover .kt-svc-photo img {
    filter: grayscale(0.1);
    transform: scale(1.05);
  }
}

/* ---------- shop: featured カード 赤 radial-gradient (legacy css:2978-2982) ---------- */
.kt-svc-featured {
  background:
    radial-gradient(80% 60% at 85% 0%, rgba(168, 15, 34, 0.06), transparent 60%),
    var(--paper);
}

/* ---------- shop: 製品カード 浮遊 + 斜めストライプ + 光沢 (legacy css:3176-3210, 3456-3476) ---------- */
.kt-product-card {
  transition:
    border-color 0.3s var(--ease),
    transform 0.3s var(--ease);
}
@media (hover: hover) and (pointer: fine) {
  .kt-product-card:hover {
    border-color: var(--carbon-soft);
    transform: translateY(-3px);
  }
}
/* 画像未設定時の legacy モックビジュアル (shop.html:236-287 の CSS 再現)。
   aspect は旧 4/3 でなく registry (card32 = 3/2) に合わせる: 画像設定後に
   カード高が変わらないための意図的差分 */
.kt-product-visual {
  aspect-ratio: 3 / 2;
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--hair);
  background:
    repeating-linear-gradient(-45deg, var(--primer-deep) 0 2px, transparent 2px 12px),
    linear-gradient(155deg, #e2e2db, #d0d0c8);
  display: grid;
  place-items: center;
}
.kt-pv-swatch {
  width: 62%;
  aspect-ratio: 16 / 10;
  background: linear-gradient(150deg, var(--a), var(--b) 78%);
  border-radius: 2px;
  box-shadow: 0 12px 30px rgba(23, 25, 27, 0.22);
  position: relative;
  overflow: hidden;
}
.kt-pv-swatch::after,
.kt-pv-mini::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    112deg,
    transparent 42%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 58%
  );
}
.kt-pv-swatch-row {
  display: flex;
  gap: 3px;
  padding: 8px;
  flex-wrap: wrap;
  justify-content: center;
  width: 78%;
}
.kt-pv-mini {
  width: 20px;
  height: 28px;
  border-radius: 1px;
  background: linear-gradient(150deg, var(--a), var(--b) 80%);
  box-shadow: 0 3px 8px rgba(23, 25, 27, 0.28);
  position: relative;
  overflow: hidden;
}
.kt-pv-note {
  position: absolute;
  bottom: 9px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-legacy-mono);
  font-size: 8.5px;
  letter-spacing: 0.12em;
  color: var(--carbon-soft);
}

/* ---------- shop: ミニスウォッチ hover ポップ + 質感 (legacy css:3423-3438) ---------- */
.kt-mini-swatch {
  position: relative;
  overflow: hidden;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.32),
    0 1px 3px rgba(23, 25, 27, 0.22);
  transition: transform 0.25s var(--ease);
}
.kt-mini-swatch::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    transparent 44%,
    rgba(255, 255, 255, 0.38) 52%,
    transparent 60%
  );
}
@media (hover: hover) and (pointer: fine) {
  .kt-mini-swatch:hover {
    transform: translateY(-2px) scale(1.08);
  }
}

/* ---------- materials: タイムライン 縦連結線 + 赤縁ノード (legacy css:2021-2034) ---------- */
.kt-timeline {
  border-left: 1px solid var(--hair);
  margin-left: 8px;
  padding-left: clamp(24px, 3vw, 40px);
}
.kt-timeline-item {
  position: relative;
  padding-bottom: clamp(28px, 3.4vw, 44px);
}
.kt-timeline-item:last-child {
  padding-bottom: 0;
}
.kt-timeline-item::before {
  content: "";
  position: absolute;
  left: calc(-1 * clamp(24px, 3vw, 40px) - 5px);
  top: 6px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--primer);
  border: 1.5px solid var(--soul);
}

/* ---------- reduced-motion 一括キル (旧 css:1130-1136 方式。他班と重複しても冪等) ---------- */
@media (prefers-reduced-motion: reduce) {
  .kt-qty-fill {
    animation: none;
    transform: none; /* 幅 var(--w) で静止表示 */
  }
  .kt-map-frame iframe,
  .kt-svc-card .kt-svc-photo img,
  .kt-product-card,
  .kt-mini-swatch {
    transition: none;
  }
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

注意: `font-family` は `var(--font-legacy-mono)` を使う (`--font-mono` は `@theme inline` で Tailwind 用に別マッピング済み — globals.css:11,162)。

---

## 2. `src/app/(site)/service/page-body.tsx`

### 2-1. FLOW 番号を赤に (legacy css:831-838: mono 11px / 0.14em / var(--soul))

313-315 行目を変更:

```tsx
// BEFORE
<span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
  {String(i + 1).padStart(2, "0")}
</span>
// AFTER
<span className="font-mono text-[11px] tracking-[0.14em] text-soul">
  {String(i + 1).padStart(2, "0")}
</span>
```

### 2-2. 数量バーを斜め縞 + スクロール伸長に (legacy css:1598-1636)

257-262 行目 (QUANTITY カード内の track/fill) を置換:

```tsx
// BEFORE
<span className="h-2 bg-hair-soft">
  <span
    className={`block h-full ${row.best ? "bg-soul" : "bg-carbon/60"}`}
    style={{ width: row.w }}
  />
</span>
// AFTER
<span className="kt-qty-track">
  <span
    className={`kt-qty-fill${row.best ? " kt-qty-fill--best" : ""}`}
    style={{ "--w": row.w } as React.CSSProperties}
  />
</span>
```

`--w` は CSS 側 `width: var(--w, 100%)` が受ける。データ (247-251 行の `w: "100%"` 等) は変更不要。

### 2-3. HONEST TERMS マーカー +/※ 復元 (legacy css:858-874)

「できること」リスト (338-353 行) — `○`→`+`、区切りを破線に:

```tsx
<ul className="mt-5 text-sm leading-7 text-carbon-mid">
  {[
    /* 既存 5 項目そのまま */
  ].map((item) => (
    <li
      key={item}
      className="flex gap-3 border-b border-dashed border-hair-soft py-[11px] last:border-b-0"
    >
      <span aria-hidden="true" className="font-mono text-[12px] text-carbon">
        +
      </span>
      {item}
    </li>
  ))}
</ul>
```

「ご了承いただきたいこと」リスト (359-374 行) — `—`→`※` (soul 赤):

```tsx
    <li
      key={item}
      className="flex gap-3 border-b border-dashed border-hair-soft py-[11px] last:border-b-0"
    >
      <span aria-hidden="true" className="font-mono text-[12px] text-soul">
        ※
      </span>
      {item}
    </li>
```

(legacy は li::before で `+`/`※` を出すが、aria-hidden span の方がスクリーンリーダー安全なため現行方式を維持し文字と色のみ正典化。mono 12px / can=carbon / honest=soul は css:867-874 のとおり)

### 2-4. QC チェックアイコン (legacy css:1911-1927)

389-392 行目を置換:

```tsx
// BEFORE
<span
  aria-hidden="true"
  className="inline-block size-3 border border-carbon/50"
/>
// AFTER
<span aria-hidden="true" className="kt-qc-check" />
```

---

## 3. `src/app/(site)/about/page-body.tsx`

### 3-1. craftsman ブロック: 比率 1.1fr/1fr + 下揃え + 名前側 Reveal (legacy css:625-630, about.html:81)

81-98 行目を置換:

```tsx
// BEFORE (骨格)
<div className="mt-10 grid gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:gap-14">
  <div>
    <p className="text-[clamp(28px,4vw,44px)] font-bold tracking-[0.1em]">隈部 信之</p>
    <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
      KUMABE NOBUYUKI — REPRESENTATIVE / PAINTER
    </p>
  </div>
  <Reveal as="div" className="space-y-6 ...">...</Reveal>
</div>

// AFTER
<div className="mt-10 grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-end md:gap-[clamp(32px,5vw,72px)]">
  <Reveal as="div">
    <p className="text-[clamp(28px,4vw,44px)] font-bold tracking-[0.1em]">
      隈部 信之
    </p>
    <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
      KUMABE NOBUYUKI — REPRESENTATIVE / PAINTER
    </p>
  </Reveal>
  <Reveal
    as="div"
    className="space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid"
  >
    {/* 本文 2 段落は既存のまま */}
  </Reveal>
</div>
```

md 未満は 1 カラム / items-start (legacy css:1144 の挙動と一致)。名前の文字サイズは現行維持 (旧 clamp(48px,7.6vw,96px) への拡大は本班スコープ外、[EXTRA] 参照)。

### 3-2. 地図 grayscale→hover (legacy css:666-679)

216 行目の Reveal に `kt-map-frame` を追加:

```tsx
<Reveal as="div" className="kt-map-frame mt-10 border border-hair bg-paper p-2">
```

iframe 側は無変更 (CSS が `.kt-map-frame iframe` で当たる)。

---

## 4. `src/app/(site)/shop/page-body.tsx`

### 4-1. import 追加

```tsx
import type { ResolvedSlot, ResolvedSlots } from "@/modules/page-media/contracts";
```

(既存の `ResolvedSlots` import を上記に置き換え)

### 4-2. MiniSwatch hover ポップ (legacy css:3423-3438)

41-51 行目 MiniSwatch の span に `kt-mini-swatch` を追加:

```tsx
<span
  title={SWATCH_TITLES[id]}
  className="kt-mini-swatch inline-block size-6 border border-hair"
  style={{
    background: `linear-gradient(135deg, ${DD[id].a}, ${DD[id].b})`,
  }}
/>
```

(`overflow-hidden`/gloss ::after/box-shadow は CSS クラス側が付与)

### 4-3. グレードカード 3 枚: 写真 grayscale hover + featured 赤 radial

- GRADE 01 (166 行): `<div className="flex flex-col border border-hair bg-paper">` → `<div className="kt-svc-card flex flex-col border border-hair bg-paper">`
- GRADE 02 (234 行): 同上 `kt-svc-card` を先頭に追加
- GRADE 03 (298 行): `<div className="flex flex-col border-2 border-carbon bg-paper">` → `<div className="kt-svc-card kt-svc-featured flex flex-col border-2 border-carbon">` (**`bg-paper` を外す** — 背景は `.kt-svc-featured` が radial+paper で供給。legacy css:2978-2982)
- 各カードの `<figure className="relative">` (167, 235, 299 行) → `<figure className="kt-svc-photo relative">`

SlotImage 内部の `next/image` (fill) に `.kt-svc-card .kt-svc-photo img` が当たり、SlotImage 自身のラッパが overflow-hidden なので scale(1.05) は枠内に収まる。SlotImage のコードは変更しない。

### 4-4. 製品カード: 浮遊 hover + legacy モックビジュアル復元

(a) 3 枚の article (407, 458, 509 行) に `kt-product-card` を追加:

```tsx
<article className="kt-product-card flex flex-col border border-hair bg-paper">
```

(b) ローカルヘルパを追加 (SvcBadge の近く、53 行付近。Server Component のまま):

```tsx
/* shop.product.* は未来枠 (defaultSrc null — registry.ts:471-497)。
   公開ページで画像未設定の間は legacy のCSSモック (shop.html:236-287) を復元して
   「NO IMAGE」プレースホルダの代わりに見せる。editMode では SlotImage の
   「画像を設定」導線 (data-editable-*) を必ず残す。 */
function ProductVisual({
  slotKey,
  resolved,
  editMode,
  mock,
}: {
  slotKey: string;
  resolved: ResolvedSlot;
  editMode: boolean;
  mock: React.ReactNode;
}) {
  if (resolved.src || editMode) {
    return (
      <SlotImage slotKey={slotKey} resolved={resolved} editMode={editMode} />
    );
  }
  return (
    <div className="kt-product-visual" aria-hidden="true">
      {mock}
    </div>
  );
}
```

(c) 3 箇所の `<SlotImage slotKey="shop.product.N" .../>` (412-416, 463-467, 514-518 行) を置換。COMING SOON / 受注制作バッジの span と外側 `<div className="relative">` はそのまま:

```tsx
{/* 8色セット (legacy shop.html:236-249) */}
<ProductVisual
  slotKey="shop.product.1"
  resolved={slots["shop.product.1"]}
  editMode={editMode}
  mock={
    <>
      <span className="kt-pv-swatch-row">
        {(Object.keys(DD) as (keyof typeof DD)[]).map((id) => (
          <span
            key={id}
            className="kt-pv-mini"
            style={{ "--a": DD[id].a, "--b": DD[id].b } as React.CSSProperties}
          />
        ))}
      </span>
      <span className="kt-pv-note">8-COLOR SET — IMAGE</span>
    </>
  }
/>

{/* 単色 (legacy shop.html:264-268 — ベイサイドブルー) */}
<ProductVisual
  slotKey="shop.product.2"
  resolved={slots["shop.product.2"]}
  editMode={editMode}
  mock={
    <>
      <span
        className="kt-pv-swatch"
        style={
          { "--a": "var(--dd-tv2-a)", "--b": "var(--dd-tv2-b)" } as React.CSSProperties
        }
      />
      <span className="kt-pv-note">SINGLE PANEL — IMAGE</span>
    </>
  }
/>

{/* 受注制作 (legacy shop.html:283-287 — ブラック) */}
<ProductVisual
  slotKey="shop.product.3"
  resolved={slots["shop.product.3"]}
  editMode={editMode}
  mock={
    <>
      <span
        className="kt-pv-swatch"
        style={
          { "--a": "var(--dd-202-a)", "--b": "var(--dd-202-b)" } as React.CSSProperties
        }
      />
      <span className="kt-pv-note">YOUR OBJECT HERE</span>
    </>
  }
/>
```

---

## 5. `src/app/(site)/materials/page-body.tsx` — CAUSES をタイムライン化 (legacy css:2021-2048, materials.html:173-188)

304-323 行目 (WHY IT MATTERS の Reveal ブロック) を置換:

```tsx
// BEFORE: divide-y のグリッド行
// AFTER:
<Reveal as="div" className="kt-timeline mt-10">
  {CAUSES.map((cause) => (
    <div key={cause.no} className="kt-timeline-item">
      <span className="font-mono text-[10.5px] tracking-[0.14em] text-soul">
        {cause.no}
      </span>
      <h4 className="mt-2 text-[17px] font-bold tracking-[0.04em]">
        {cause.title}
      </h4>
      <p className="mt-2 max-w-[44em] text-[13.5px] leading-[1.95] text-carbon-mid">
        {cause.body}
      </p>
    </div>
  ))}
</Reveal>
```

タイポは legacy css:2035-2048 の値 (no: mono 10.5px/0.14em/soul、h4: 17px、p: 13.5px/1.95/max 44em)。CAUSES データ配列は無変更。

---

## 6. notes — 体験要素の再構成 (一覧+個別構造は維持)

### 6-1. 新規ユーティリティ `src/app/_lib/note-nav.ts` (Server 専用・純関数)

```ts
import type { PublicPostListItem } from "@/app/_lib/public-content";

export type NoteNav = {
  /** NOTE 通し番号 (古い記事 = 01)。リストに見つからなければ null */
  noteNo: number | null;
  /** 前の記事 = 1 つ古い記事 (published_at 降順リストの idx+1) */
  prev: PublicPostListItem | null;
  /** 次の記事 = 1 つ新しい記事 (published_at 降順リストの idx-1) */
  next: PublicPostListItem | null;
};

/** published_at 降順リストから NOTE 番号 (昇順で安定) を割り当てる。
    legacy notes.html の NOTE 01〜07 固定番号の再現 — 新規記事が増えても
    既存記事の番号が変わらない (バックデート公開は例外、risks 参照)。 */
export function noteNumberOf(posts: PublicPostListItem[], index: number): number {
  return posts.length - index;
}

export function formatNoteNo(n: number): string {
  return `NOTE ${String(n).padStart(2, "0")}`;
}

export function buildNoteNav(
  posts: PublicPostListItem[],
  slug: string,
): NoteNav {
  const idx = posts.findIndex((p) => p.slug === slug);
  if (idx < 0) return { noteNo: null, prev: null, next: null };
  return {
    noteNo: noteNumberOf(posts, idx),
    prev: idx < posts.length - 1 ? posts[idx + 1] : null,
    next: idx > 0 ? posts[idx - 1] : null,
  };
}
```

### 6-2. 単体テスト `src/app/_lib/note-nav.test.ts` (vitest)

```ts
import { describe, expect, it } from "vitest";
import { buildNoteNav, formatNoteNo, noteNumberOf } from "./note-nav";
import type { PublicPostListItem } from "./public-content";

const post = (slug: string): PublicPostListItem => ({
  id: slug,
  slug,
  kind: "reading",
  title: `title-${slug}`,
  excerpt: "",
  cover: null,
  publishedAt: "2026-01-01T00:00:00Z",
});

// published_at 降順 = 新しい順 (note-03 が最新)
const posts = [post("note-03"), post("note-02"), post("note-01")];

describe("noteNumberOf", () => {
  it("最古の記事が NOTE 01 になる", () => {
    expect(noteNumberOf(posts, 2)).toBe(1);
    expect(noteNumberOf(posts, 0)).toBe(3);
  });
});

describe("formatNoteNo", () => {
  it("2 桁ゼロ詰め", () => {
    expect(formatNoteNo(1)).toBe("NOTE 01");
    expect(formatNoteNo(12)).toBe("NOTE 12");
  });
});

describe("buildNoteNav", () => {
  it("中間記事: prev=古い方 / next=新しい方", () => {
    const nav = buildNoteNav(posts, "note-02");
    expect(nav.noteNo).toBe(2);
    expect(nav.prev?.slug).toBe("note-01");
    expect(nav.next?.slug).toBe("note-03");
  });
  it("最新記事は next なし、最古記事は prev なし", () => {
    expect(buildNoteNav(posts, "note-03").next).toBeNull();
    expect(buildNoteNav(posts, "note-01").prev).toBeNull();
  });
  it("未知 slug は全て null", () => {
    expect(buildNoteNav(posts, "nope")).toEqual({
      noteNo: null,
      prev: null,
      next: null,
    });
  });
});
```

### 6-3. `src/app/(site)/notes/page-body.tsx` — TOC ナビ + 2 段カード + COMING SOON

import に追加:

```tsx
import { formatNoteNo, noteNumberOf } from "@/app/_lib/note-nav";
```

(a) **TOC 的な記事ナビ** (legacy css:938-955 の notes-toc 意匠)。`SectionMark` の直後 (38 行目の三項演算子の前) に挿入。2 件以上のときのみ表示:

```tsx
{posts.length > 1 ? (
  <Reveal
    as="nav"
    aria-label="読みもの目次"
    className="mt-10 border border-hair bg-paper px-6 py-5 sm:px-9 sm:py-8"
  >
    <ul>
      {posts.map((post, i) => (
        <li
          key={post.id}
          className="border-b border-dashed border-hair-soft last:border-b-0"
        >
          <Link
            href={`/notes/${post.slug}`}
            className="flex items-baseline gap-[18px] px-0.5 py-3.5 text-[14.5px] font-medium transition-colors duration-[250ms] ease-[var(--ease)] hover:text-soul"
          >
            <span className="shrink-0 font-mono text-[10.5px] text-carbon-soft">
              {formatNoteNo(noteNumberOf(posts, i))}
            </span>
            {post.title}
          </Link>
        </li>
      ))}
    </ul>
  </Reveal>
) : null}
```

(b) **カードの 2 段見出しを article-no 正典に** (legacy css:962-969: mono 10.5px / 0.22em / soul + 安定番号)。63-65 行目:

```tsx
// BEFORE
<span className="font-mono text-[10px] tracking-[0.18em] text-soul">
  NOTE {String(i + 1).padStart(2, "0")}
</span>
// AFTER
<span className="font-mono text-[10.5px] tracking-[0.22em] text-soul">
  {formatNoteNo(noteNumberOf(posts, i))}
</span>
```

(c) **COMING SOON 告知** (legacy css:986-994 + notes.html:161-164)。カードグリッド (または EmptyState) の直後、`</Section>` の前に常時表示:

```tsx
<Reveal
  as="div"
  className="mt-[clamp(48px,6vw,72px)] border border-dashed border-hair p-[clamp(26px,3.4vw,40px)] text-center text-[13px] leading-[2.1] text-carbon-soft"
>
  <p className="font-mono text-[10.5px] tracking-[0.22em]">COMING SOON</p>
  <p className="mt-2.5">
    今後、デモピースの製作記録や案件の実績（掲載許諾をいただいたもの）を、ここで発信していきます。
    <br />
    note・X・Instagram との連携も準備中です。
  </p>
</Reveal>
```

### 6-4. `src/app/(site)/notes/[slug]/page.tsx` — 前後ナビ用データ (build 時 fetch のみ、SSG 非退行)

```tsx
import {
  getPublishedReadingPostBySlug,
  getPublishedReadingPosts,
  listPublishedReadingSlugs,
} from "@/app/_lib/public-content";
import { buildNoteNav } from "@/app/_lib/note-nav";

// default export 内 (41-44 行) を:
const { slug } = await params;
const [post, posts] = await Promise.all([
  getPublishedReadingPostBySlug(slug),
  getPublishedReadingPosts(),
]);
if (!post) notFound();
const nav = buildNoteNav(posts, slug);

return <NoteDetailPageBody post={post} nav={nav} editMode={false} />;
```

`getPublishedReadingPosts` は既存のキャッシュ済み build-time fetch (一覧ページと同一関数) のため request-time API 追加なし。generateStaticParams は既存のまま → SSG 維持。**注意**: /edit 側で NoteDetailPageBody を呼んでいる箇所があれば同じ nav を渡す (`grep -rn "NoteDetailPageBody" src/` で全呼び出し元を確認し、page.tsx と同様に取得して渡すこと)。

### 6-5. `src/app/(site)/notes/[slug]/page-body.tsx` — article-no 2 段見出し + 前後記事ナビ

```tsx
import Link from "next/link";
import { MediaCover } from "@/components/site/media-cover";
import {
  ArrowButton,
  CtaBand,
  PageHead,
  Section,
} from "@/components/site/page-blocks";
import type { PublicPostDetail } from "@/app/_lib/public-content";
import { formatNoteNo, type NoteNav } from "@/app/_lib/note-nav";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";

export function NoteDetailPageBody({
  post,
  nav,
  editMode,
}: {
  post: PublicPostDetail;
  nav: NoteNav;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index="INDEX 08 — NOTES"
        en="READING ON PAINT & COLOR"
        title={
          <>
            {nav.noteNo !== null ? (
              /* legacy .article-no (css:962-969): mono / 0.22em / soul の 2 段見出し */
              <span className="mb-4 block font-mono text-[11px] font-normal tracking-[0.22em] text-soul">
                {formatNoteNo(nav.noteNo)}
              </span>
            ) : null}
            {post.title}
          </>
        }
        lead={post.excerpt}
      />

      <Section className="pt-2 sm:pt-4">
        {/* cover / 本文は既存のまま */}
        {post.cover ? (
          <div className="mb-8">
            <MediaCover
              src={post.cover.url}
              alt={post.cover.alt}
              aspect="aspect-[21/9]"
              editMode={editMode}
              kind="post"
              id={post.id}
              mediaId={post.cover.id}
            />
          </div>
        ) : null}

        <div className="max-w-3xl space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
          <SimpleMarkdown text={post.body} />
        </div>

        {/* 前後記事ナビ (notes-toc 意匠 css:938-955 の応用 + hover 0.25s var(--ease)) */}
        {nav.prev || nav.next ? (
          <nav
            aria-label="前後の読みもの"
            className="mt-12 grid border-y border-hair sm:grid-cols-2"
          >
            {nav.prev ? (
              <Link
                href={`/notes/${nav.prev.slug}`}
                className="flex flex-col gap-1.5 border-b border-hair px-1 py-5 transition-colors duration-[250ms] ease-[var(--ease)] hover:text-soul sm:border-b-0 sm:border-r sm:pr-6"
              >
                <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                  ← PREV — 前の記事
                </span>
                <span className="text-[14.5px] font-medium leading-relaxed">
                  {nav.prev.title}
                </span>
              </Link>
            ) : (
              <span aria-hidden="true" className="hidden sm:block sm:border-r sm:border-hair" />
            )}
            {nav.next ? (
              <Link
                href={`/notes/${nav.next.slug}`}
                className="flex flex-col items-start gap-1.5 px-1 py-5 transition-colors duration-[250ms] ease-[var(--ease)] hover:text-soul sm:items-end sm:pl-6 sm:text-right"
              >
                <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                  NEXT — 次の記事 →
                </span>
                <span className="text-[14.5px] font-medium leading-relaxed">
                  {nav.next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/notes">読みもの一覧に戻る</ArrowButton>
        </div>
      </Section>

      {/* CTA は既存のまま */}
      <CtaBand
        title={
          <>
            読んで気になったことは、
            <br />
            そのまま聞いてください。
          </>
        }
        note="工程・色・素材の相性、どんな質問でも。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
```

---

## 7. 旧実装との対応表

| 項目 | 旧根拠 | 新実装 |
|---|---|---|
| qc-check 赤✓ | css:1911-1927 | `.kt-qc-check` + service TSX |
| flow 番号赤 | css:831-838 | Tailwind (`text-soul` 11px/0.14em) |
| qty-fill 斜め縞 | css:1605-1622 | `.kt-qty-fill(--best)` repeating-linear-gradient 同値 |
| qty スクロール伸長 | css:1624-1636 | `@supports(animation-timeline: view())` + range entry 10-70% 同値 |
| terms +/※ | css:858-874 | aria-hidden span (mono 12px, +=carbon / ※=soul, 破線区切り, py 11px) |
| 地図 grayscale | css:666-679 | `.kt-map-frame` grayscale(1)→0, 0.5s var(--ease) (pointer:fine 限定は意図的差分) |
| craftsman 比率/下揃え/Reveal | css:625-630, about.html:81 | grid-cols 1.1fr/1fr + items-end + gap clamp(32px,5vw,72px) + 名前側 Reveal |
| svc-photo grayscale hover | css:2954-2961 | `.kt-svc-card/.kt-svc-photo` grayscale 0.9→0.1 + scale 1.05, filter 0.7s / transform 1s 非対称 |
| featured 赤 radial | css:2978-2982 | `.kt-svc-featured` 同値 gradient |
| 製品カード浮遊 | css:3176-3183 | `.kt-product-card` translateY(-3px) + border-color, 0.3s |
| 製品ビジュアル縞+浮遊パネル+光沢 | css:3184-3210, 3456-3476, shop.html:236-287 | `.kt-product-visual/.kt-pv-*` (画像未設定時のみ。aspect 3/2 は registry 準拠の意図的差分) |
| MiniSwatch hover | css:3423-3438 | `.kt-mini-swatch` translateY(-2px) scale(1.08), 0.25s |
| materials タイムライン | css:2021-2048, materials.html:173-188 | `.kt-timeline(-item)` 同値 (9px ノード, soul 1.5px 縁) |
| notes TOC | css:938-955, notes.html:49-57 | 一覧ページ nav (hover color 0.25s var(--ease)) |
| article-no 2 段見出し | css:962-969 | 一覧カード + 詳細 PageHead title 内 (10.5-11px / 0.22em / soul) |
| COMING SOON | css:986-994, notes.html:161-164 | 一覧末尾の破線ボックス |
| 前後記事ナビ | (旧: 単一ページ内アンカー遷移の再構成) | buildNoteNav + 詳細ページ nav |

## 8. 受入条件

1. `npm run lint` / `npm run test` (note-nav.test.ts 含む) / `npm run build` がすべて成功し、build 出力で `/service` `/about` `/shop` `/materials` `/notes` `/notes/[slug]` が Static (○/●) のまま (request-time API 追加なし)。
2. /service: QC 8 カードに赤枠+赤✓、FLOW 01-07 が赤 mono、数量バー 3 本が斜め縞 (30個〜のみ赤縞) で Chrome では見出し通過時に左から伸長、HONEST TERMS が +/※ マーカー+破線区切り。
3. /about: 代表名ブロックが md+ で左 1.1fr/右 1fr・下揃え、名前側もスクロールでリビール。地図がデスクトップで灰色→hover でカラー化 (0.5s)、タッチエミュレーション (DevTools sensors: pointer coarse) ではカラーのまま。
4. /shop: グレードカード hover で写真が grayscale 0.9→0.1 + scale 1.05 (filter 0.7s / transform 1s の時差が体感できる)、GRADE 03 カード右上に薄赤 radial。プレミアムの 8 色ミニスウォッチ hover でポップ+光沢。製品カード hover で -3px 浮遊+枠色変化。画像未設定の製品 3 枠に「NO IMAGE」ではなく斜めストライプ+浮遊塗り板 (8色列/青単板/黒単板)+光沢+PV ノートが出る。
5. /materials: WHY IT MATTERS が縦連結線+赤縁丸ノード 3 個のタイムラインで、テキスト内容は不変。
6. /notes: 2 記事以上あるとき冒頭に TOC ボックス (破線区切り、hover で赤)、カード番号は「最古=NOTE 01」で安定 (公開順を入れ替えたテストデータで確認)、末尾に COMING SOON 破線ボックス。詳細ページ: タイトル上に NOTE XX の赤 mono 行、本文下に PREV/NEXT ナビ (最新記事は NEXT なし、最古は PREV なし)、`/notes#note-01` の legacy リダイレクトが引き続き動作。
7. reduced-motion (DevTools emulation) で: 数量バーが最初から満尺、全 hover/transition が即時 (0.01ms)、レイアウト崩れなし。
8. /edit (ビジュアルエディタ) で shop 製品 3 枠に「画像を設定」プレースホルダが従来どおり表示され (モックに置き換わらない)、data-editable-* 属性が全スロットで欠落していない。エディタで画像を設定すると公開側がモック→実写真に切り替わる。
9. `git grep -n "kt-qc-check\|kt-qty-fill\|kt-map-frame\|kt-svc-card\|kt-product-visual\|kt-mini-swatch\|kt-timeline" src/` で CSS 定義と TSX 使用箇所が対で存在する。

## 9. テスト方針

- **単体**: note-nav.test.ts (§6-2) — 番号安定性・prev/next 境界・未知 slug。
- **静的**: lint + build + `tsc` (build 内包)。`--w` / `--a` / `--b` の CSSProperties キャストが型エラーにならないこと。
- **実機 (Chrome MCP / DevTools)**: §8 の 2-8 を desktop / pointer:coarse エミュ / prefers-reduced-motion エミュの 3 モードで確認。`animation-timeline: view()` 非対応ブラウザ相当は `@supports` を一時的に false にして (クラス名替え確認) バーが常時満尺で表示されることを確認。
- **回帰**: /edit iframe で 5 ページを開き、hover 演出がエディタ操作 (ホットスポットクリック) を阻害しないこと、`kmb:reveal-done` ベースの再測定が壊れていないこと (Reveal コンポーネント自体は無変更なので構造チェックのみ)。

---

## リスク (班申告)
- ブリーフィング記載の V2a worktree (.claude/worktrees/agent-a24a69628487d5f3e) は本仕様作成中に消滅 (main へマージ済みと判断 — main の src/ が worktree と同一構造・同一行数であることを検証済み)。本仕様の行番号は main の現 HEAD 基準のため、実装前に他班のマージで行番号がずれていないか対象箇所の周辺コードで照合すること
- globals.css 末尾追記は M1〜M3 班と物理的に同じ位置のため、同時マージで append コンフリクトが発生し得る (区切りコメント単位で機械的に解消可能)。reduced-motion の一括キル (*,*::before,*::after 0.01ms) は他班も追記する想定で重複しても冪等だが、レビューで一本化を推奨
- notes の NOTE 番号は published_at 降順リストの位置から算出するため、既存記事より古い日付で新規公開 (バックデート) すると既存記事の番号がずれる。CMS 運用上バックデートしない前提。厳密な固定が必要なら posts テーブルに note_no カラム追加が正道 (本班スコープ外)
- shop 製品モックは resolved.src が null のときのみ描画。管理画面で画像が設定済みだとモックは出ない (仕様どおりだが、受入確認時に admin/media の設定状態に依存する点に注意)
- NoteDetailPageBody の props 変更 (nav 追加) に伴い、/edit 側など page.tsx 以外の呼び出し元があれば同時修正が必要 (grep で全呼び出し元確認を仕様に明記済み)
- hover: hover and pointer: fine ガードは iPad+トラックパッド等で判定が揺れる環境がある (演出が出ない側に倒れるため実害は小)
- 地図 grayscale とshop 写真 grayscale を pointer:fine 内に限定したのは旧サイトからの意図的差分 (タッチで永久グレー化を防ぐ)。パリティ厳格解釈なら無条件適用に戻せるが非推奨
- Tailwind v4 の任意値 (ease-[var(--ease)] / gap-[clamp(...)] / mt-[clamp(...)]) を使用。ビルドで生成されない場合は該当箇所のみ globals.css のクラスに退避する

## EXTRA 提案 (原案)
- [EXTRA] 検品スタンプ演出 (service QC): Reveal 表示時に ✓ を clip-path (inset 0 100% 0 0 → 0) で 0.4s 描画し、セル順に 0.06s stagger。検品票にチェックを入れていく手つきを再現する。CSS のみ (kt-qc-check::after への keyframes + .reveal.is-visible 連動 + nth-child delay 8 行)。コスト: 小 (CSS 約 20 行、JS 不要)
- [EXTRA] ウェットエッジ (service 数量バー): kt-qty-fill の右端 6px に明るいハイライト (linear-gradient オーバーレイの ::after) を重ね、スクロール伸長時に「塗りたてのウェットエッジが走る」質感を出す。2 液ウレタンの生乾きの艶という工房の語彙に直結。コスト: 小 (CSS 約 12 行)
- [EXTRA] マスキング剥がし (about 地図): hover 時の grayscale 解除を filter 遷移でなく clip-path polygon の斜めワイプ (カラー版 iframe を重ねる二層構成) で行い、マスキングテープを斜めに剥がして色が現れる演出にする。ただし iframe 二重読み込みのコストがあるため、実装するなら CSS mask + backdrop-filter 方式を検証してから。コスト: 中 (CSS 20 行 + 構造 1 層追加、要実機検証)
- [EXTRA] 代表名の原寸復元 (about craftsman): 旧 css:631-637 の clamp(48px,7.6vw,96px)・letter-spacing 0.12em に戻し、名前そのものをページ最大のタイポグラフィにする (現行は clamp(28px,4vw,44px) に縮小されている)。本班仕様の 1.1fr/1fr + 下揃えと組み合わさって初めて旧サイトの構図が完成する。コスト: 極小 (Tailwind クラス 1 行)、ただし M4 割当外のため堀さん判断
- [EXTRA] 前後記事ナビの塗り下線 (notes 詳細): PREV/NEXT hover 時に soul 赤の下線を scaleX 0→1 (0.35s var(--ease)、origin は hover=left / leave=right — §5「ナビ下線」正典と同パラメータ) でスライドさせ、色見本帳のページをめくる指の動きを暗示。コスト: 小 (CSS 約 15 行)

## 対象ファイル
src/app/globals.css, src/app/(site)/service/page-body.tsx, src/app/(site)/about/page-body.tsx, src/app/(site)/shop/page-body.tsx, src/app/(site)/materials/page-body.tsx, src/app/(site)/notes/page-body.tsx, src/app/(site)/notes/[slug]/page-body.tsx, src/app/(site)/notes/[slug]/page.tsx, src/app/_lib/note-nav.ts, src/app/_lib/note-nav.test.ts
