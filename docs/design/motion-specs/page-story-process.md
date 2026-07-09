# M4 モーション実装仕様 — story / process ページ固有 (班: page-story-process)

- 正典: `docs/design/motion-gap-report.md` §3 (story / process) + §5、`legacy/css/style.css` (行番号は 2026-07-09 時点実測で再検証済み)
- **重要な前提変更**: 指示にあった worktree `.claude/worktrees/agent-a24a69628487d5f3e/` は本仕様作成中に削除された。V2a (page-body 抽出) / V2b は **main にマージ済み** (commit `930c177` / `334f6fe`)。対象ファイルの内容は worktree 版と完全一致 (行番号含む) を確認済みのため、**以下のパス (main) を正とする**:
  - `/Users/horidaisuke/projects/kumabe-tosou/src/app/globals.css`
  - `/Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/story/page-body.tsx` (338 行)
  - `/Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/process/page-body.tsx` (589 行)

## 0. 全体方針

本班の担当 7 項目は **legacy でも全て CSS のみで実装されている** (legacy/js/main.js に story/process 固有の JS は存在しないことを grep で確認済み)。したがって:

- **新規クライアントコンポーネントは作らない** (`src/components/motion/` 配下への追加なし)。JS ゼロ。
- page-body.tsx は Server Component のまま。`"use client"` を一切足さない → **SSG 非退行は構造的に保証される**。
- CSS は `globals.css` 末尾に `/* === motion: page-story-process === */` 区切りで一括追記。
- クラス命名は既存規約 `kt-` prefix (kt-hero-line / kt-paint-mark 等) に統一。
- カラー・easing は既存 `:root` トークン (`--soul` `--hair` `--paper` `--primer-deep` `--carbon*` `--ease`) を使用。mono フォントは **`var(--font-legacy-mono)`** を使うこと (`--font-mono` は `@theme inline` 定義のため `:root` にカスタムプロパティとして emit されない。globals.css:162 の `--font-legacy-mono` が raw CSS 用の正)。
- 共有コンポーネント (`page-blocks.tsx` / `reveal.tsx` / `slot-image.tsx`) は**変更しない**。
- 本班にオーバーレイ系 (カーソル/インジケータ) は無いため (editor) レイアウト対応は不要。/edit 共存は portrait の `pointer-events: none` のみ配慮 (後述)。

---

## 1. `src/app/globals.css` — 末尾に追記する CSS 全文 (貼り付け可)

ファイル末尾 (現在の `@media (prefers-reduced-motion: reduce)` ブロックの後) に、以下をそのまま追記する。

```css
/* === motion: page-story-process === */
/* M4 — story / process ページ固有の意匠 (legacy 正典移植)
   正典: docs/design/motion-gap-report.md §3 + legacy/css/style.css (行番号は各節に記載)
   すべて宣言的 CSS。JS なし・SSG 影響なし。 */

/* ---------- story: 章区切り罫線 (legacy css:2055-2059) ---------- */
.kt-story-chapter {
  padding: clamp(56px, 8vw, 104px) 0;
  border-bottom: 1px solid var(--hair);
}
.kt-story-chapter:first-of-type {
  border-top: 1px solid var(--hair);
}

/* ---------- story: 章見出し sticky (legacy css:2069 / 900px 未満で解除 css:2133-2136) ---------- */
@media (min-width: 900px) {
  .kt-story-head {
    position: sticky;
    top: 100px; /* sticky ヘッダー h-72px + 28px クリアランス (legacy と同値) */
  }
}

/* ---------- story: ドロップキャップ (legacy css:2103-2111) ---------- */
.kt-story-body > p:first-child::first-letter {
  font-family: var(--font-disp);
  font-weight: 700;
  font-size: 3.6em;
  line-height: 0.82;
  float: left;
  margin: 6px 12px 0 0;
  color: var(--carbon);
}

/* ---------- story: 引用意匠 (legacy css:2113-2131) ---------- */
.kt-story-quote {
  margin: 34px 0;
  padding: 4px 0 4px 26px;
  border-left: 3px solid var(--soul);
  font-family: var(--font-disp);
  font-weight: 700;
  font-size: clamp(18px, 2.4vw, 26px);
  line-height: 1.8;
  letter-spacing: 0.04em;
  color: var(--carbon);
}
.kt-story-quote cite {
  display: block;
  margin-top: 14px;
  font-family: var(--font-legacy-mono);
  font-size: 11px;
  font-style: normal;
  letter-spacing: 0.12em;
  color: var(--carbon-soft);
}

/* ---------- story: 代表メッセージ 赤光暈 (legacy css:2139-2145) ---------- */
.kt-message-sec {
  background:
    radial-gradient(
      70% 90% at 82% 15%,
      rgba(168, 15, 34, 0.05),
      transparent 62%
    ),
    var(--paper);
  border-top: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
}

/* ---------- story: portrait 斜めストライプ + コーナーマーク (legacy css:2155-2190) ---------- */
/* 画像未設定 (story.portrait は defaultSrc:null の未来枠) のあいだ、
   legacy の「PORTRAIT — COMING SOON」プレースホルダ意匠として見える。
   画像が設定されたら写真がストライプを覆う (legacy と同じ意図)。 */
.kt-portrait-frame {
  position: relative;
  border: 1px solid var(--hair);
  background:
    repeating-linear-gradient(
      -45deg,
      var(--primer-deep) 0 2px,
      transparent 2px 11px
    ),
    linear-gradient(160deg, #dfdfd8, #cfcfc8);
}
.kt-portrait-corner {
  position: absolute;
  font-family: var(--font-legacy-mono);
  font-size: 11px;
  color: var(--carbon-soft);
  pointer-events: none; /* /edit の data-editable ホットスポットのクリックを妨げない */
  z-index: 1;
}
.kt-portrait-corner--tl {
  top: 10px;
  left: 12px;
}
.kt-portrait-corner--br {
  bottom: 10px;
  right: 12px;
}

/* ---------- process: 工程番号 巨大アウトライン数字 (legacy css:2314-2327) ---------- */
.kt-ps-no {
  font-family: var(--font-wide);
  font-weight: 700;
  font-stretch: 125%; /* Archivo 未読み込みの現状では no-op。読み込み時に発効 (risks 参照) */
  font-size: clamp(40px, 5vw, 62px);
  line-height: 0.9;
  color: transparent;
  -webkit-text-stroke: 1.4px var(--carbon-soft);
  transition:
    -webkit-text-stroke-color 0.3s var(--ease),
    color 0.3s var(--ease);
}
/* text-stroke 非対応環境で数字が透明のまま消えないための保険 */
@supports not (-webkit-text-stroke: 1px #000) {
  .kt-ps-no {
    color: var(--carbon-soft);
  }
}
/* hover はポインタ精度ガード付き (タッチデバイスでは発火しない) */
@media (hover: hover) and (pointer: fine) {
  .kt-process-step:hover .kt-ps-no {
    -webkit-text-stroke-color: var(--soul);
    color: rgba(168, 15, 34, 0.06);
  }
}
/* モバイル縮小 (legacy css:2360-2363) */
@media (max-width: 640px) {
  .kt-ps-no {
    font-size: 44px;
  }
}

/* ---------- reduced-motion: 本班分のキルスイッチ (旧 css:1130-1136 方式・班内保険) ----------
   一括の全称キルスイッチ (*, *::before, *::after) は共通基盤班 (M2/M3) が追加する。
   本班で transition を持つのは kt-ps-no のみで、ここで独立に殺しておく。 */
@media (prefers-reduced-motion: reduce) {
  .kt-ps-no {
    transition: none;
  }
}
```

---

## 2. `src/app/(site)/story/page-body.tsx` の変更

### 2-1. `Chapter` コンポーネント (現行 6–43 行) を以下に置換

変更点: 外側 section を full-bleed の `kt-story-chapter` にし (罫線が画面幅いっぱいに走る legacy 構造)、max-w コンテナを内側へ。縦 padding は CSS 側の clamp に移管 (`py-14 sm:py-20` を削除)。grid に `items-start` を追加 (**sticky の成立条件**。デフォルトの stretch だと見出しセルが行の高さいっぱいに伸びて sticky が動かない。legacy css:2067 `align-items: start` に対応)。見出し側 Reveal に `kt-story-head`、本文側に `kt-story-body` を付与。

```tsx
function Chapter({
  no,
  title,
  en,
  children,
  photo,
}: {
  no: string;
  title: React.ReactNode;
  en: string;
  children: React.ReactNode;
  photo: React.ReactNode;
}) {
  return (
    <section className="kt-story-chapter">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:gap-14">
          <Reveal as="div" className="kt-story-head">
            <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
              {no}
            </span>
            <h2 className="mt-4 text-[clamp(24px,3.2vw,38px)] font-bold leading-snug tracking-[0.04em]">
              {title}
            </h2>
            <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              {en}
            </p>
          </Reveal>
          <Reveal
            as="div"
            className="kt-story-body space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon"
          >
            {children}
          </Reveal>
        </div>
        <div className="mt-10">{photo}</div>
      </div>
    </section>
  );
}
```

注意: `.kt-story-body > p:first-child` にドロップキャップが付くため、**各 Chapter の children の最初の子は必ず `<p>` のまま維持**すること (現状 5 章とも満たしている)。

### 2-2. `StoryQuote` (現行 45–51 行) を以下に置換

```tsx
function StoryQuote({ children }: { children: React.ReactNode }) {
  return <p className="kt-story-quote">{children}</p>;
}
```

あわせて第二章内の cite (現行 143–145 行) の Tailwind クラスを削除して素の `<cite>` にする (スタイルは `.kt-story-quote cite` が担う):

```tsx
<cite>— ある試作の相談者の言葉</cite>
```

### 2-3. 代表メッセージ section (現行 277 行) — 赤光暈

```tsx
{/* before */}
<section className="bg-primer-deep">
{/* after */}
<section className="kt-message-sec">
```

内側の grid・本文・署名ブロック (278–320 行) は変更しない。

### 2-4. portrait — 斜めストライプ + コーナーマーク (現行 279–285 行を置換)

```tsx
<Reveal as="div" className="max-w-sm">
  <div className="kt-portrait-frame">
    <SlotImage
      slotKey="story.portrait"
      resolved={slots["story.portrait"]}
      editMode={editMode}
      className="bg-transparent"
    />
    <span className="kt-portrait-corner kt-portrait-corner--tl" aria-hidden="true">
      +
    </span>
    <span className="kt-portrait-corner kt-portrait-corner--br" aria-hidden="true">
      +
    </span>
  </div>
</Reveal>
```

- `className="bg-transparent"`: SlotImage の NO IMAGE プレースホルダは `bg-hair/40` を持つが、`cn()` = `twMerge(clsx())` (src/lib/utils.ts で確認済み) により後勝ちで透過になり、下のストライプが見える。
- コーナーマークは `pointer-events: none` (CSS 側) なので、/edit での `data-editable-*` ホットスポットのクリックを妨げない。SlotImage 本体・data 属性の出力経路は無変更。

## 3. `src/app/(site)/process/page-body.tsx` の変更

工程リストの map 内 (現行 438–444 行) のみ。番号セルを 80px→96px (legacy css:2308 `grid-template-columns: 96px 1fr`)、番号 span をアウトライン数字クラスへ。直後に `STEP {step.no}` の mono ラベルがあり情報は重複するため、巨大数字は `aria-hidden` にする (視覚専用装飾。legacy 比で SR 読み上げの二重化を解消する無害な改善)。

```tsx
{STEPS.map((step) => (
  <div
    key={step.no}
    className="kt-process-step grid gap-4 py-8 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-10"
  >
    <span className="kt-ps-no" aria-hidden="true">
      {step.no}
    </span>
    <div>
      {/* 以下 447 行目以降は現行のまま変更なし */}
```

囲みの `divide-y divide-hair border-y border-hair` (437 行) は legacy `.process-list` の border-top + step border-bottom に既に相当しており変更不要。

---

## 4. 旧実装との対応表

| 項目 | legacy 根拠 | 新実装 | 正典値 |
|---|---|---|---|
| 章区切り罫線 | style.css:2055-2059 | `.kt-story-chapter` | padding clamp(56px,8vw,104px)、border 1px `--hair`、first-of-type に上罫線 |
| 章見出し sticky | style.css:2069 / 2133-2136 | `.kt-story-head` | top:100px、`min-width:900px` でのみ有効 (=900px 未満解除)、grid `items-start` 必須 |
| ドロップキャップ | style.css:2103-2111 | `.kt-story-body > p:first-child::first-letter` | font-disp 700 / 3.6em / lh 0.82 / float left / margin 6px 12px 0 0 |
| quote 意匠 | style.css:2113-2131 | `.kt-story-quote` (+cite) | border-left 3px `--soul`、clamp(18px,2.4vw,26px)、700、lh 1.8、ls 0.04em、cite: mono 11px |
| 代表メッセージ赤光暈 | style.css:2139-2145 | `.kt-message-sec` | radial-gradient(70% 90% at 82% 15%, rgba(168,15,34,0.05), transparent 62%) + `--paper`、上下 hair 罫線 |
| portrait 斜めストライプ | style.css:2155-2165 (+corner 2183-2190) | `.kt-portrait-frame` | repeating-linear-gradient(-45deg, `--primer-deep` 0 2px, transparent 2px 11px) + linear-gradient(160deg,#DFDFD8,#CFCFC8) |
| 工程番号アウトライン | style.css:2314-2327 / 2360-2363 | `.kt-ps-no` / `.kt-process-step:hover` | clamp(40px,5vw,62px)、lh 0.9、-webkit-text-stroke 1.4px `--carbon-soft`、hover: stroke `--soul` + fill rgba(168,15,34,0.06)、transition 0.3s `--ease`、≤640px で 44px |

パラメータはすべて motion-gap-report.md §5 / legacy 実値のまま。変更なし。

## 5. 受入条件

1. **ビルド**: `pnpm lint` と `pnpm build` が成功。build 出力で `/story` `/process` が引き続き Static (SSG) 表示。`"use client"` の新規追加ゼロ、`src/components/motion/` への追加ゼロであること。
2. **story sticky**: 幅 ≥900px で章本文をスクロールすると CHAPTER 見出しブロックが上端 100px (ヘッダー下 28px) に追従し、章の終端で自然に離脱。幅 899px 以下では static (追従しない)。
3. **ドロップキャップ**: 全 5 章の最初の段落頭文字 (隈/き/思/転/こ) が約 3.6em・Shippori・float 左で表示。2 段落目以降には付かない。
4. **章区切り**: 各章下端に画面幅いっぱいの 1px hair 罫線。第一章にのみ上罫線。
5. **quote**: 第二章・第四章の引用が 3px ソウルレッド左罫 + clamp(18-26px) 太字 Shippori、cite は mono 11px 非イタリック。
6. **赤光暈**: 代表メッセージ section の背景が紙白 + 右上 (82% 15%) にごく薄い赤 (0.05) の光暈、上下 hair 罫線。旧 bg-primer-deep でないこと。
7. **portrait**: 画像未設定の現状で -45° 斜めストライプ + 160° グラデが「NO IMAGE」の背後に見え、四隅 tl/br に「+」。/admin/visual から画像を設定すると写真がストライプを覆う。
8. **process 番号**: 9 個の番号が clamp(40-62px)・中抜き (透明 fill + 1.4px グレー stroke)。≤640px で 44px。`@supports` フォールバック環境では塗りグレーで可読。
9. **hover ガード**: マウス (pointer:fine) で工程行に hover すると stroke がソウルレッド化 + rgba(168,15,34,0.06) の薄塗りが 0.3s `--ease` で入る。タッチエミュレーション (pointer:coarse) では一切変化しない。
10. **reduced-motion**: `prefers-reduced-motion: reduce` で番号の transition が無効。全項目とも静的表示で内容が完全に読める。
11. **エディタ共存**: `/edit/story` で story.portrait のホットスポットがクリック可能 (コーナーマークが遮らない)、`data-editable-*` 属性出力に変化なし。`/edit/process` も表示崩れなし。
12. **回帰**: 320px 幅で横スクロールが発生しない。既存テストスイート (vitest 247 件) が PASS。

## 6. テスト方針

- **静的検証**: `pnpm lint` → `pnpm build` → 既存 vitest 全件。本班は module contract に触れないため既存テストの修正は不要のはず (要確認)。
- **実機検証 (Chrome/Playwright)**: viewport 1280px / 900px / 899px / 375px の 4 点で /story /process を確認。
  - sticky: `page.evaluate(() => getComputedStyle(document.querySelector('.kt-story-head')).position)` が 1280px で `sticky`、899px で `static`。
  - hover: `page.hover('.kt-process-step')` 後に `getComputedStyle(el).webkitTextStrokeColor` が `rgb(168, 15, 34)` になること。`page.emulateMedia` 相当でタッチ環境 (`hasTouch: true` + pointer:coarse) では変化しないこと。
  - reduced-motion: `page.emulateMedia({ reducedMotion: 'reduce' })` で transition が none。
  - キーボード: 本班は非インタラクティブ装飾のみ追加 (フォーカス可能要素の増減ゼロ) — Tab 順序が変わっていないことを両ページで一巡確認。
- **視覚照合**: `legacy/story.html` `legacy/process.html` をローカルで開き、並べて目視比較 (罫線位置・番号サイズ・quote・光暈)。
- 実装→検証は implementer + tester ペアで、2 回連続 PASS で完了 (全プロジェクト共通基準)。

## 7. 実装順序 (推奨)

1. globals.css 追記 (§1) → build 確認
2. process/page-body.tsx (§3、変更 2 行) → 受入 8-9
3. story/page-body.tsx (§2、4 箇所) → 受入 2-7
4. /edit 確認 (受入 11) → 全体回帰 (受入 1, 12)

---

## リスク (班申告)
- 指示にあった worktree .claude/worktrees/agent-a24a69628487d5f3e は本仕様作成中に削除された。V2a/V2b は main にマージ済み (commit 930c177 / 334f6fe) で page-body.tsx の内容・行番号は worktree 版と一致確認済み。実装は main (または新規 worktree) を対象にすること
- --font-wide は 'Archivo' 未読み込みのフォールバックスタックのみ (globals.css:163 コメントに明記)。process 番号は Helvetica Neue/システム UI で描画され、font-stretch:125% は不発 → legacy より字幅が狭い。EXTRA-2 (Archivo 読み込み) で解消可だが layout.tsx を触る班横断変更のためオーケストレーター調整が必要 (home 設計図・colors 透かし番号班も同フォントを使う)
- .kt-story-chapter:first-of-type は「第一章が兄弟中最初の <section>」であることに依存 (PageHead は div なので現状成立)。他班が story ページに先行 section (View Transitions ラッパ等) を挿入すると上罫線の位置がずれる — マージ時に受入条件 4 で再確認
- kt-story-quote の margin:34px 0 が Tailwind v4 space-y-6 に勝つのは space-y が :where() (specificity 0) で出力される前提。Tailwind メジャー更新時に要再確認
- SlotImage への className='bg-transparent' 上書きは cn()=twMerge(clsx()) 前提 (src/lib/utils.ts で確認済み)。cn 実装が単純結合に変わると bg-hair/40 が勝ちストライプが隠れる
- 代表メッセージ背景が bg-primer-deep → 紙白+赤光暈に変わる (legacy 正典準拠だが現行デプロイと見た目が変わる)。受入時にデザイン確認を通すこと
- globals.css 末尾追記は他班 (M1-M3, M4 他ページ) と同時マージで append 競合が起き得る。マーカーコメント区切りで解決は容易だがマージ順は直列推奨
- sticky 有効化 (900px) と grid 2 カラム化 (md=768px) の間の 768-899px 帯は「2 カラムだが sticky なし」となる。legacy は 900px で 1 カラム化していたため存在しなかった状態だが実害なし。気になる場合は Chapter の grid 切替を md: から min-[900px]: に変える選択肢あり
- @media (max-width: 640px) の 44px 縮小と Tailwind sm (min-width:640px) は幅ちょうど 640px で重なる (44px 番号が 96px カラムに載る)。無害だが視覚確認対象

## EXTRA 提案 (原案)
- [EXTRA] 塗料が満ちる工程番号 — hover 時の正典 (即時の薄赤 fill) に加え、番号の内側を rgba(168,15,34,0.10)→0.04 の縦グラデが下から満ちていく演出。background-clip:text + background-size 100% 0%→100% 100% を 0.5s var(--ease) で遷移させ「塗料が注がれて番号が塗り上がる」職人メタファーに。CSS のみ約 18 行・実装 0.5h。正典パラメータからの逸脱 (0.3s 即時→0.5s 充填) のため正典実装後のオプトインとして提案
- [EXTRA] Archivo variable font (wdth 軸) の読み込みで --font-wide を実体化 — next/font/google を layout.tsx に 1 箇所追加し、process 番号の font-stretch:125% を発効させ legacy の圧倒的な字幅を再現。転送 +25-30KB (woff2)。home (hero-dim/寸法マーカー)・colors (透かし番号 01-08)・story-ch-en とも共有される基盤のため、費用対効果はサイト全体に波及。実装 0.5h + 班横断調整。オーケストレーター判断推奨
- [EXTRA] 膜厚ゲージ — process 工程リストの左端に 2px の縦バーを置き、animation-timeline: view() (M3 と同じ @supports ガード) でリストを読み進めるほどソウルレッドが下へ塗り伸びる。9 工程を「塗膜が一層ずつ積み上がる」coat-diagram のメタファーと呼応させる。CSS のみ約 25 行・JS ゼロ・非対応ブラウザは自然に非表示。実装 1h
- [EXTRA] ドロップキャップの乾着 (かんちゃく) 登場 — 章の Reveal 完了後、first-letter の color を primer→carbon へ 0.6s var(--ease) で沈着させ「置いた塗料が乾いて色が定着する」を表現。.reveal.is-visible .kt-story-body > p:first-child::first-letter への transition 追加のみ・約 10 行・0.25h。::first-letter の transition は Safari で無視される場合があるが、その場合は静的表示に自然フォールバックし無害

## 対象ファイル
/Users/horidaisuke/projects/kumabe-tosou/src/app/globals.css, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/story/page-body.tsx, /Users/horidaisuke/projects/kumabe-tosou/src/app/(site)/process/page-body.tsx
