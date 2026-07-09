# モーション実装統合計画 (canonical)

- v1.1 (2026-07-09): 堀さん指示「旧サイトに無い発明でも良いものは大歓迎」を受け、却下 16 件を再裁定。5 件を Wave 5 (発明枠) として復活 (§5.1)。11 件は実害根拠で却下維持
- 生成: 2026-07-09 motion-spec-design Workflow (7 班仕様 → アートディレクション統合批評)
- 班別仕様の全文: docs/design/motion-specs/*.md
- ギャップ調査: docs/design/motion-gap-report.md

# モーション実装 統合計画書 v1.0 — 7 班仕様の統合裁定

- 作成: 2026-07-09 (アートディレクター兼リードエンジニア統合批評)
- 正典: `docs/design/motion-gap-report.md` (§5 パラメータ表) + `legacy/` 実装
- 実装ベース: **main @ 334f6fe** (V2a/V2b マージ済み。指示にあった worktree `agent-a24a69628487d5f3e` は削除済み — 全班一致で main に読み替え済み、本書で確定)
- 本書は各班仕様書の**上位裁定**。各班仕様と本書が矛盾する場合は本書 §2/§3 が勝つ。それ以外の詳細 (CSS 全文・TSX 差分・受入条件) は各班仕様書をそのまま使う。

---

## 1. 共通規約 (全班拘束)

### 1.1 z-index 階層表 (canonical)

| z | 要素 | クラス | 所有班 | 備考 |
|---|---|---|---|---|
| 9999 | カーソルドット | `.kt-cursor-dot` | signature | fixed / pointer-events:none |
| 9998 | カーソルリング | `.kt-cursor-ring` | signature | 同上。9000 番台はカーソル専用帯 |
| 60 | セクションインジケータ | `.kt-sec-indicator` | signature | fixed / pointer-events:none / ≤1100px 非表示 |
| 50 | ヘッダー (既存) + Sheet/Dialog (Base UI 既定) | — | 既存 | プログレスバー・小口帯はヘッダー内部 (z-auto) |
| 0〜1 | ページ内局所 stacking (hero grid z-0/内容 z-1、透かし番号 z-0/entry 内容 z-1) | — | page-home / page-colors | グローバル階層に不参加 |
| -1 | 紙ノイズ | `.kt-paper-noise` | scroll-texture | fixed 背景レイヤ |

規則: (a) 新規の固定オーバーレイは本表に追記登録してから実装。50–60 帯への追加禁止 (Sheet と衝突するため)。(b) カーソルは常に最上位。(c) `main` 内に `position: fixed` の要素を置かない (PageTransition の transform 中に containing block が変わるため。sticky は scroll container 基準なので story の sticky 見出しは無影響 — 検証済み)。

### 1.2 rAF 方針 — 単一マネージャは**採用しない**

判断根拠: 常時 (毎フレーム) ループはカーソルリングの lerp **1 本のみ**。プログレスバーは scroll イベント駆動の rAF スロットル (スクロール中のみ発火)、ColorStrip wheel は直接代入 (rAF なし)、チルトは mousemove 直接代入 (rAF なし)。任意の瞬間に生きる rAF コールバックは最大 2 本で、共有マネージャは性能利得ゼロのまま wave 間の import 結合とマージ面を増やすだけ。よって班ごと実装とする。

代わりに以下を拘束規則とする:
1. 常時ループは `CustomCursor` のみ許可。今後 2 本目の常時ループが必要になった時点で共有マネージャ導入を再審する
2. それ以外は「イベント駆動 rAF スロットル」か「直接代入」のみ
3. rAF コールバック内での layout read (`getBoundingClientRect` / `scrollHeight` 等) は禁止 — チルトは mouseenter で rect キャッシュ (M4-colors 実装済み)、PaintProgress の read は rAF 内だが write と同一フレームの read→write 1 回のみで layout thrash なし (許容)
4. cleanup で必ず `cancelAnimationFrame` + removeEventListener (全班仕様で確認済み)

### 1.3 easing トークン

- 動的 easing は **`--ease: cubic-bezier(0.22,1,0.36,1)`** (globals.css:170) の 1 本のみ。新規 easing トークンの追加禁止。
- WAAPI (PageTransition) は CSS 変数参照不可のためリテラル `cubic-bezier(0.22, 1, 0.36, 1)` を書く (M2 仕様どおり。値変更時は grep 対象)。
- `--ease-viscous` は**予約名として凍結** (未実装)。3 班が別々のカーブ (cubic-bezier(0.34,1.3,0.36,1) / linear() 2 種) で粘性イージングを提案したが全て却下 (§4)。将来採用する場合は堀さん選定の 1 カーブを Wave 0 相当の共通コミットで 1 箇所のみ定義する。
- duration は正典表 (report §5) の値をリテラル記述 (トークン化しない — legacy パリティを grep で監査可能に保つ)。

### 1.4 globals.css 配置規約

1. **Wave 0 で 7 班分の区画マーカーを先置き**する (下記順序)。各班は自班区画の**内側のみ**編集。これで append 位置競合が構造的に消える:
```css
/* === motion: signature === */
/* === /motion: signature === */
/* === motion: hover-suite === */
/* === /motion: hover-suite === */
/* === motion: scroll-texture === */
/* === /motion: scroll-texture === */
/* === motion: page-home === */
/* === /motion: page-home === */
/* === motion: page-colors === */
/* === /motion: page-colors === */
/* === motion: page-story-process === */
/* === /motion: page-story-process === */
/* === motion: page-rest === */
/* === /motion: page-rest === */
```
2. 既存 1〜377 行の変更禁止 (B1 も追記で解決 — M2 方式)。**唯一の例外**: W1-C (Archivo) による 163 行 `--font-wide` の 1 行更新 (§4 採用 EXTRA、本書が明示許可)。
3. `kt-` prefix 必須。班別名前空間は §1.8 の契約表どおり。
4. kt-* 規則は非レイヤー CSS のため Tailwind ユーティリティ (@layer) に常に勝つ。同一要素の transition/filter/transform を Tailwind 側で変えても効かない — 各班区画冒頭コメントに明記 (M2 方式を全班標準化)。
5. rebase 時は区画コメント単位でブロックを機械的に並べ直す。区画外への CSS 追記は差し戻し。

### 1.5 ガード規約 (reduced-motion / pointer / @supports / print)

| 対象 | 規約 |
|---|---|
| 装飾 transition/animation | 各班区画内で**自班クラスの個別 kill** を書く。全称ブランケット (`*, *::before, *::after` 0.01ms !important) は **signature 班区画の 1 箇所のみ** (page-rest の重複定義は削除 — §2-8)。ブランケットは /admin にも効くが reduce 設定ユーザーには意図どおり |
| スクロール駆動 (view()/scroll()) | `@supports (animation-timeline: …)` 内の `@media (prefers-reduced-motion: no-preference)` にのみ記述 (kill 不要になる二重ガード構造。M3 方式を全班標準化)。非対応ブラウザ (Firefox 安定版) は既存 Reveal / 静的表示に自然フォールバック |
| hover 演出 | CSS は `@media (hover: hover) and (pointer: fine)`。JS (カーソル/チルト) は matchMedia ガード |
| WAAPI / rAF (CSS で殺せない JS) | matchMedia 自前ガード必須。**常駐オーバーレイ (CustomCursor) は change イベント購読必須** (M1 実装済み)。ページ局所ドライバ (ColorsTilt / PageTransition) はマウント時/発火時評価で可 (ページ遷移で再評価される。legacy 同等) |
| 機能的フィードバック | reduce でも殺さない: 塗りプログレスバー (スクロール位置表示)、ColorStrip wheel 変換 (1:1 直接操作)、ストリップ進捗バー静的 15% |
| 印刷 | **view()/scroll() timeline を使う班は自班区画に `@media print { animation: none }` を必ず含める** (timeline 未解決で from 状態に固まる事故防止)。ガード漏れ 3 件を本書で補正: page-rest `.kt-qty-fill`、page-colors `.kt-color-entry::after`、page-home `.kt-strip-progress-bar { animation: none; transform: scaleX(0.15) }` (§3 参照)。M3 の print ブロックからは移管分 (`.kt-color-entry::after` / `.kt-sd-qty`) を除去 |
| -webkit-text-stroke | 内容性のある数字 (process 工程番号) は `@supports not` フォールバック必須 (story-process 実装済み)。純装飾 (colors 透かし番号、aria 的に不可視) は非対応時に消えても許容 — フォールバック不要と裁定 |

### 1.6 クライアント境界・SSG/エディタ共存規約

1. `"use client"` は `src/components/motion/` 配下の葉コンポーネントのみ。children は props パススルー (Server ツリー非汚染)。page.tsx / page-body.tsx はサーバー維持。request-time API 追加禁止。
2. 前面オーバーレイ (カーソル / インジケータ) は `(site)/layout.tsx` のみ。`(editor)` に載せてよいのは背景レイヤ `PaperNoise` のみ (z:-1 / pointer-events:none で /edit ホットスポット操作に不干渉)。PageTransition も (site) 限定。
3. `data-editable-*` の出力経路 (`slot-image.tsx` の editableAttrs / `editable-attrs.ts`)・`reveal.tsx` の `kmb:reveal-done` は**全班変更禁止** (className 追加のみ可)。
4. 共有 UI 基底 (`ui/button.tsx` 等 admin 共用) は変更禁止。公開サイト側呼び出し箇所での opt-in クラス方式 (M2 方式) を標準とする。
5. **サーバーコンポーネントの props シグネチャを変える場合、`grep -rn` で全呼び出し元 (特に `(editor)/edit/page-map.tsx`) を確認し同一 PR で修正する。** 実例: page-rest の `NoteDetailPageBody` nav 追加は `src/app/(editor)/edit/page-map.tsx:80` を壊す (実ファイル確認済み) — §3-7 で修正を義務化。
6. home の DOM 契約: `main` 内の最初の `section` は hero を維持 (SectionIndicator の表示切替が依存)。M2 の PageTransition ラッパ div を挟んでも `main section` (子孫セレクタ) は成立する — 検証済み。
7. PageTransition の `useLayoutEffect` が SSR コンソール警告を出す場合は `useEffect` へ変更可 (発火が 1 フレーム遅れるだけで挙動差なし)。

### 1.7 テスト・コマンド規約

- **vitest include は `tests/**/*.test.ts` のみ・node env・`vitest.config.ts` 変更禁止** (M4-home の指摘を全班規約に昇格)。テストは必ず `tests/` 直下に置く (§2-9 の是正 2 件)。
- **パッケージマネージャは npm** (package-lock.json が正)。M4-home / story-process 仕様の `pnpm` 記載は `npm run lint` / `npm test` / `npm run build` に読み替え。
- DOM/IO/rAF 依存ロジックは unit で追わず実機 E2E で検証 (jsdom 偽陽性回避。M1 方式)。
- 各 wave とも implementer + tester ペア、修正後に単体+結合を通し直し **2 回連続 PASS** で完了。
- コミットは Conventional Commits prefix + 日本語サマリ、セクション完成ごとにこまめに push + merge。

### 1.8 クラス名・データ属性 契約表 (班間インターフェース)

| 契約 | CSS 所有 | DOM 付与 | 備考 |
|---|---|---|---|
| `data-cursor="view"` + `a[href^="/colors#"]` | signature (セレクタ) | page-colors (Drawdown)、他班任意 | VIEW リング 62px/赤 |
| `[data-sec-mark]` / `data-sec-no` / `data-sec-label` | signature (収集) | signature (page-blocks SectionMark) | |
| `.kt-swatch-host:hover .kt-swatch-sheen` | **hover-suite (B1)** | hover-suite → page-colors 継承 | **これが sheen の正セレクタ。** page-colors 仕様の `.kt-dd:hover .kt-swatch-sheen` 期待は誤り (§2-4)。既存 354 行 `a:hover .kt-swatch-sheen` は home 用に残置 |
| `.kt-sd-swatch` (色板の塗り登場 G7-4) | **scroll-texture** | **page-colors** (Drawdown rewrite に含める) | `kt-dd-swatch` は**廃止** (§2-3) |
| `.kt-sd-photo` (写真せり上がり G7-3) | scroll-texture | scroll-texture (slot-image + media-cover) | |
| `.kt-photo` / `.kt-photo-img` (G8 hover) | hover-suite | hover-suite | |
| 透かし番号一式 (`.kt-color-entries` / `.kt-color-entry(::after)` / `kt-wm-parallax`) | **page-colors (単独所有)** | page-colors | M3 の `.kt-colors-sec` 案は**廃止**、M3 は colors/page-body.tsx を触らない (§2-2) |
| qty バー一式 (`.kt-qty-track` / `.kt-qty-fill(--best)` / `kt-qty-grow`) | **page-rest (単独所有)** | page-rest | M3 の `.kt-sd-qty` は**廃止**、M3 は service/page-body.tsx を触らない (§2-1) |
| `--kt-strip` (timeline-scope) | page-home | page-home | home 内で完結 |
| 班別 prefix 名前空間 | signature: `kt-cursor-* / kt-paint-progress / kt-sec-indicator* / kt-nav-*` ・ hover-suite: `kt-btn-* / kt-photo* / kt-footer-giant / kt-card-lift / kt-swatch-host / kt-vt-*` ・ scroll-texture: `kt-rule / kt-sd-* / kt-paper-noise / kt-header-edge / kt-footer-ticks / kt-nav-toggle` ・ page-home: `kt-hero-* / kt-color-strip* / kt-strip-*` ・ page-colors: `kt-dd* / kt-color-entr*` ・ story-process: `kt-story-* / kt-message-sec / kt-portrait-* / kt-ps-no / kt-process-step` ・ page-rest: `kt-qc-* / kt-qty-* / kt-map-* / kt-svc-* / kt-product-* / kt-pv-* / kt-mini-swatch / kt-timeline*` | | |

### 1.9 競合ファイルの最終形 (マージ解決の正)

**site-header.tsx** — header 開始タグ (M2 + M3 が同一行):
```tsx
<header className="kt-vt-header kt-header-edge sticky top-0 z-50 border-b border-hair bg-primer/80 backdrop-blur-md">
```
その他: デスクトップナビ = M1 の MotionNavLink 版、CTA = M2 の kt-btn-brush--cta 版、SheetTrigger = M3 のハンバーガー 2 本バー版、SheetClose = M1 の kt-nav-link-m 版、`</div>` (旧 115 行) 直後に `<PaintProgress />`。適用順 M1 → M2 → M3。

**slot-image.tsx** — 画像あり分岐の最終形 (M2 + M3 が同一行):
```tsx
<div className={cn("kt-photo relative w-full overflow-hidden", aspectClass, className)} {...editableAttrs}>
  <Image ... className="kt-photo-img kt-sd-photo object-cover" />
```
media-cover.tsx も同型 (`kt-photo` ラッパ + `kt-photo-img kt-sd-photo object-cover`)。NO IMAGE 分岐は両ファイルとも不変。

**page-blocks.tsx SectionMark** — M1 (data 属性) + M3 (kt-rule) の合成:
```tsx
export function SectionMark({ no, label }: { no: string; label: string }) {
  return (
    <Reveal as="p" data-sec-mark="" data-sec-no={no} data-sec-label={label}
      className="flex items-center gap-4 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
      <span>{no}</span>
      <span className="kt-rule kt-sd-rule" aria-hidden="true" />
      <span>{label}</span>
    </Reveal>
  );
}
```
PageHead の罫線 span は `kt-rule` のみ (M3)。ArrowButton/CtaBand/PhotoFigure は M2 版、SecTitle は M3 版。

**(site)/layout.tsx** — M1 + M2 + M3 の合成 (import は各班分を追加):
```tsx
<>
  <script type="application/ld+json" ... />
  <PaperNoise />
  <SiteHeader />
  <main className="flex-1">
    <PageTransition>{children}</PageTransition>
  </main>
  <SiteFooter />
  {/* 署名演出オーバーレイ (M1)。/edit iframe に載せないため (site) 限定 */}
  <CustomCursor />
  <SectionIndicator />
</>
```

**colors/page-body.tsx Drawdown** — page-colors の全置換をベースに、ルート div と swatch div のクラスを契約合成:
```tsx
<div className="kt-dd kt-swatch-host border border-hair bg-paper p-2" data-tilt="" data-cursor="view">
  <div className="kt-sd-swatch relative aspect-[4/3] w-full overflow-hidden" style={...} aria-hidden="true">
```
(kt-swatch-host = M2 B1 の sheen フック維持、kt-sd-swatch = M3 の塗り登場フック、kt-dd = page-colors のチルト/浮上。Wave 1 で M2 が付与した kt-swatch-host を Wave 3 の rewrite が**必ず保持**する)

---

## 2. 班間衝突の裁定 (全 17 件)

| # | 衝突 | 裁定 |
|---|---|---|
| 1 | **service 数量バーの二重実装**: M3 `.kt-sd-qty` (色据え置き+scaleX) と page-rest `.kt-qty-track/.kt-qty-fill` (斜め縞+scaleX) が service/page-body.tsx の同一行 (258-263) を書き換える | **page-rest 所有** (縞質感まで含む完全パリティ)。M3 は G7-6 をスコープから削除 (`.kt-sd-qty` CSS + `kt-qty-grow` keyframes + service TSX 変更を全部除去)。keyframes 名 `kt-qty-grow` は page-rest 区画の 1 定義のみに |
| 2 | **colors 透かし番号の所有権が正面衝突**: M3 §13「本班が所有」vs page-colors §4 が同一機能をフル実装。カウンタスコープ名も不一致 (`.kt-colors-sec` vs `.kt-color-entries`) | **page-colors 単独所有** (relative 付与・reduce kill・チルトとの stacking を一体設計しているため)。M3 は G7-5 と colors/page-body.tsx への変更 3 箇所を全削除。スコープ名は `.kt-color-entries` で確定 |
| 3 | **swatch-paint フックのクラス名契約不一致**: M3 は `.kt-sd-swatch` を自分で付与する前提、page-colors は `.kt-dd-swatch` を提供すると宣言 | フック名は **`.kt-sd-swatch`** に統一 (CSS 所有 = M3)。DOM 付与は page-colors の Drawdown rewrite に含める。`kt-dd-swatch` は廃止 |
| 4 | **sheen セレクタ契約不一致**: M2 B1 は `.kt-swatch-host:hover .kt-swatch-sheen`、page-colors 受入 9 は `.kt-dd:hover .kt-swatch-sheen` を期待 | **`.kt-swatch-host:hover` が正**。Drawdown ルートに `kt-dd kt-swatch-host` 併記 (§1.9)。page-colors 受入 9 の grep 文字列を `kt-swatch-host` に修正 |
| 5 | site-header.tsx: M1 (ナビ+PaintProgress) / M2 (header タグ+CTA) / M3 (header タグ+ハンバーガー) の 3 班同一ファイル、M2 と M3 は同一行 | wave 順序 M1‖M2 (行非交差) → M3 (直列)。最終形は §1.9 |
| 6 | slot-image.tsx Image className: M2 `kt-photo-img` と M3 `kt-sd-photo` が同一行 | 併記最終形 §1.9。M3 が後着で合成 |
| 7 | page-blocks.tsx SectionMark: M1 (data 属性追加) と M3 (罫線 span 置換) が同一関数 | 合成最終形 §1.9。M1 先行、M3 が span のみ差し替え |
| 8 | reduced-motion 全称ブランケットを M1 と page-rest が重複定義 | **M1 (signature) 単独所有**。page-rest は自区画から全称セレクタを削除 (個別 kill は維持) |
| 9 | **テスト配置欠陥**: M1 `src/components/motion/path-current.test.ts`・page-rest `src/app/_lib/note-nav.test.ts` は vitest include (`tests/**/*.test.ts`) 外で**一度も実行されない** | `tests/motion-path-current.test.ts` / `tests/note-nav.test.ts` へ移動 (import は `@/` alias で解決。note-nav テスト内の `./public-content` import も `@/app/_lib/public-content` に) |
| 10 | **NoteDetailPageBody の props 変更が editor を壊す**: page-rest の `nav` 必須化に対し `src/app/(editor)/edit/page-map.tsx:80` が `nav` なしで呼んでいる (実在確認済み) | page-rest の触るファイルに page-map.tsx を追加。`getPublishedReadingPosts()` + `buildNoteNav()` で nav を構築して渡す (editMode プレビューでも前後ナビの見た目一致)。受入に「/edit/notes/[slug] 描画」追加 |
| 11 | コマンド不統一 (M4-home / story-process が pnpm、リポジトリは package-lock.json = npm) | npm に統一 (§1.7) |
| 12 | 粘性イージングを 3 班が異なるカーブで提案 (hover-suite / scroll-texture EXTRA-3 / page-colors EXTRA-2) | 3 案とも却下、`--ease-viscous` を予約名として凍結 (§1.3)。採用時は 1 定義に統一 |
| 13 | globals.css 末尾 append を 7 班全員が行う物理衝突 | Wave 0 の区画マーカー先置きで構造的に解消 (§1.4) |
| 14 | M3 EXTRA-5 (小口帯読了プログレス) が M1 G2 (塗りプログレスバー) と機能重複 | G2 採用確定につき EXTRA-5 却下 |
| 15 | 「色引き継ぎ」概念を 2 班が別実装で提案 (signature インク引き継ぎ / hover-suite ページ間色引き継ぎ) | 両方却下 (§4)。採用するなら統一設計が必須のためバックログ 1 本に集約 |
| 16 | M2 PageTransition の transform (0.44s) と main 内 fixed/sticky の干渉懸念 | sticky は scroll container 基準で無影響 (story sticky OK)。fixed は main 内に存在しない (オーバーレイは main 外)。**規約化**: main 内に position:fixed を置かない (§1.1) |
| 17 | M4-home の COLOR LINEUP ストリップ化と M1 の VIEW カーソルセレクタ `a[href^="/colors#"]` | Link 構造維持 (M4-home 仕様どおり) のため両立。契約表 §1.8 に明記 |

---

## 3. 各班仕様への修正指示 (原案からの差分のみ — これ以外は各班仕様書どおり)

### 3-1. signature (M1)
1. `path-current.test.ts` を `tests/motion-path-current.test.ts` へ (import: `@/components/motion/path-current`)
2. [採用 EXTRA] プログレスバーの刷毛先端: `.kt-paint-progress` を width:100% 固定 + `translateX((ratio-1)*100%)` 方式に変え、`::after` で skewX(-14deg) の 8px チップ + 不透明度グラデを付ける (G5 の刷毛とモチーフ統一)。受入 10-12 の判定基準は不変 (最上部で不可視/最下部で全幅/直接追従)
3. 全称ブランケット kill は自区画末尾に置く (他班は書かない)
4. 受入 2 の「既存 247 件」は「既存全件」に読み替え (先行 wave でテストが増えるため)

### 3-2. hover-suite (M2)
1. layout.tsx / site-header.tsx / page-blocks.tsx は §1.9 最終形に従う (M1 マージ後に rebase)
2. [採用 EXTRA] 刷毛の掠れエッジ: `.kt-btn-brush::before` 右端に dd-edge polygon (legacy css:340) を 90° 回転で clip-path 適用
3. [採用 EXTRA] footer-giant のスクロール駆動塗り — **`@media (hover: none)` 環境限定に修正して採用**: hover 環境では view() アニメの fill が hover transition (background-size) をロックして塗り演出を壊すため、`@supports (animation-timeline: view())` + `@media (hover: none)` の二重ガード内でのみ一度塗りを再生。デスクトップは従来の hover 塗りのまま
4. Drawdown への `kt-swatch-host` 付与 (B1) は Wave 3 の page-colors rewrite が保持する契約 (§1.9)。受入 4「既存行変更ゼロ」は維持
5. PageTransition: SSR で useLayoutEffect 警告が出た場合のみ useEffect へ (§1.6-7)

### 3-3. scroll-texture (M3)
1. **スコープ削除**: G7-5 透かし番号一式 (静的 CSS + `kt-wm-parallax` + `.kt-colors-sec`) と G7-6 (`.kt-sd-qty` + `kt-qty-grow`)、および colors/page-body.tsx (§7 の 3 箇所)・service/page-body.tsx (§8) への変更を全て除外。触るファイルから両 page-body を削除
2. `.kt-sd-swatch` の CSS (G7-4) は残す — DOM 付与は page-colors (Wave 3)。**Wave 2 時点では colors に発火対象がないのは想定どおり** (受入 4 は Wave 3 後の統合確認に移動)
3. [採用 EXTRA-4] media-cover.tsx の Image に `kt-sd-photo` を追加 (works/voices/notes カバーへ写真せり上がり展開)。最終 className は §1.9
4. print ブロックから `.kt-color-entry::after` / `.kt-sd-qty` を除去 (移管先班が自区画で所有)
5. header / slot-image / SectionMark は §1.9 最終形に従う (Wave 1 マージ後の main へ直列適用)
6. kt-rule の flex:1 化 (ラベル右寄せ) は意図的 legacy パリティとして続行、Wave 4 の堀さん視覚確認項目に登録

### 3-4. page-home (M4)
1. コマンドは npm (§1.7)
2. 自区画に print ガード追加: `@media print { .kt-strip-progress-bar { animation: none; transform: scaleX(0.15); } }`
3. その他は原案どおり (timeline-scope 追加・SSR 文字分割・native wheel listener の設計は妥当と裁定。React onWheel 禁止の注意を実装者プロンプトに転記すること)

### 3-5. page-colors (M4)
1. 透かし番号 (静的 + パララックス) を単独所有 (原案 §4 どおり)。スコープ名 `.kt-color-entries` 確定
2. Drawdown ルート/swatch のクラスは §1.9 最終形 (`kt-swatch-host` 保持・`kt-sd-swatch` 付与・`kt-dd-swatch` 廃止)
3. 受入 9 の grep 対象を `.kt-swatch-host:hover .kt-swatch-sheen` に修正
4. 自区画に print ガード追加: `@media print { .kt-color-entry::after { animation: none; } }`
5. [採用 EXTRA] ①透かし番号の色見本連動 (scroll-texture EXTRA-2 を本班へ移管): ColorEntry に `style={{ "--wm": sw.a }}`、stroke を `color-mix` で 13% 化。**受入に淡色 (DD-090 アルペンホワイト) の視認性チェックを追加し、不可視なら該当エントリのみ既定グレーに戻す** ②グレアの色温度連動: `color-mix(in oklab, #fff 78%, var(--dd-a))` ③透かし番号の hover 滲み: `:hover::after` stroke → rgba(168,15,34,0.28) 0.45s (hover:hover+pointer:fine ガード内)

### 3-6. page-story-process (M4)
1. コマンドは npm (§1.7)
2. [採用 EXTRA] ドロップキャップの乾着: `.reveal.is-visible .kt-story-body > p:first-child::first-letter` へ color transition (primer→carbon 0.6s var(--ease))。Safari 無視時は静的フォールバック (原案どおり無害)
3. Archivo は W1-C が導入済み前提で実装 (font-stretch 125% が発効する。自班での font 読み込み作業は不要)
4. その他原案どおり。`.kt-story-chapter:first-of-type` の section 依存は「story ページに先行 section を挿入しない」ことを全班規約に追加して保全

### 3-7. page-rest (M4)
1. qty バー一式を単独所有 (原案 §2-2 どおり。M3 の `.kt-sd-qty` は存在しない前提で実装)
2. 自区画に print ガード追加: `@media print { .kt-qty-fill { animation: none; transform: none; } }`
3. 全称ブランケット kill を自区画から削除 (M1 所有。個別 kill は維持)
4. `note-nav.test.ts` を `tests/note-nav.test.ts` へ移動 (§2-9)
5. **`src/app/(editor)/edit/page-map.tsx:80` を同一 PR で修正** (§2-10): posts 取得 + `buildNoteNav` で nav を渡す。受入 8 に「/edit/notes/[slug] が nav 付きで正常描画」を追加
6. [採用 EXTRA] ①検品スタンプ (QC ✓ の clip-path 0.4s + nth-child 0.06s stagger、`.reveal.is-visible` 連動。reduce では静的全表示) ②代表名の原寸復元 (clamp(48px,7.6vw,96px) / letter-spacing 0.12em — legacy パリティ修復。Wave 4 の堀さん確認項目に登録) ③前後記事ナビの塗り下線 (soul 赤 scaleX 0→1 0.35s var(--ease)、origin hover=left/leave=right — G4 正典パラメータ流用)

### 3-8. W1-C Archivo フォント (新設小タスク — page-colors EXTRA-1 + story-process EXTRA-2 の統合)
- `src/app/layout.tsx` (root) に next/font/google の Archivo (`axes: ["wdth"]`, `subsets: ["latin"]`, variable: `--font-archivo`) を追加し、globals.css:163 を `--font-wide: var(--font-archivo), "Archivo", "Helvetica Neue", sans-serif;` に更新 (§1.4 の明示例外)
- 効果範囲: process 工程番号 / colors 透かし番号 / home 寸法マーカー / story 章 EN。新規依存なし (next/font は同梱)
- 受入: `npm run build` PASS、font-stretch:125% の発効を /process で目視、CLS 増なし、転送 +25-30KB 以内。数字サブセット最適化はバックログ

---

## 4. EXTRA 裁定

採用基準: ①実ギャップ修復・legacy 機構の適用範囲拡大 → 採用 ②正典パラメータ不変のまま「塗装/色見本帳/クラフト」の記号性を強める微小 CSS (JS なし・単一班内完結) → 採用 ③正典逸脱 (easing/duration 変更)・跨ページ状態・experimental API・legacy に存在しない新規要素の発明 → 却下 (バックログ)。

### 採用 (12 件 — 所属班の wave 内に組込み。詳細は §3)
| EXTRA | 班 | 根拠 |
|---|---|---|
| プログレスバーの刷毛先端 | signature | 基準② — G5 とモチーフ統一、transform のみ |
| 刷毛の掠れエッジ | hover-suite | 基準② — dd-edge との意匠連結、CSS 0.5h |
| footer-giant スクロール駆動塗り (hover:none 限定に修正) | hover-suite | 基準① — hover 不能環境に見せ場を補完。fill と hover の競合を媒体分離で回避 |
| MediaCover への kt-sd-photo 展開 (EXTRA-4) | scroll-texture | 基準① — legacy photo-reveal の DB ページ適用、B2 回収 |
| 透かし番号の色見本連動 (EXTRA-2、page-colors へ移管) | scroll-texture→page-colors | 基準② — 色見本帳インデックスの中核隠喩。淡色視認性チェック条件付き |
| Archivo 可変フォント導入 (2 班統合 → W1-C) | page-colors + story-process | 基準① — font-stretch 125% は legacy 正典の一部。4 ページ横断の字形パリティ修復 |
| グレアの色温度連動 (EXTRA-3) | page-colors | 基準② — 塗膜の照り。style prop 1 個 + CSS 1 行 |
| 透かし番号の hover 滲み (EXTRA-4) | page-colors | 基準② — process 番号 hover と意匠統一 |
| ドロップキャップの乾着 | page-story-process | 基準② — 乾着の職人隠喩。安全フォールバック内蔵 |
| 検品スタンプ演出 | page-rest | 基準② — 検品票の手つき。CSS 20 行 |
| 代表名の原寸復元 | page-rest | 基準① — legacy パリティ修復 (1.1fr/1fr 構図の完成要件)。堀さん視覚確認対象 |
| 前後記事ナビの塗り下線 | page-rest | 基準② — 新設 UI に G4 正典パラメータを流用し体系整合 |

### 却下 (16 件 — 理由は構造化出力 rejected_extras と同一。全てバックログ管理)
粘性カーソル / インクの引き継ぎ / インジケータのクリックナビ化 (signature)、ページ間の色引き継ぎ / 真の View Transitions 化 / 粘性イージング (hover-suite)、刷毛目ワイプ写真リビール / 粘性イージングトークン / 小口帯の読了プログレス化 (scroll-texture)、粘性ホイール慣性 / 文字の塗られて現れるリビール / 進捗バー JS フォールバック / 検分ルーペ (page-home)、粘性イージング (page-colors)、塗料が満ちる工程番号 / 膜厚ゲージ (story-process)、ウェットエッジ / マスキング剥がし (page-rest)。

---

## 5. 実装 wave 割り (worktree 並列単位)

依存の骨格: M1/M2/M3 は共有部品 4 ファイル (site-header / page-blocks / slot-image / (site)layout) を共同で触るため前段に集約し、ページ 4 班は共有部品を一切触らない後段で完全並列にする。並列 implementer は `isolation: "worktree"` 必須。

```
Wave 0 (直列・main 直・1 コミット)
  └─ globals.css 区画マーカー 7 対の先置き (§1.4) + 本書を docs/design/motion-implementation-plan.md として commit
Wave 1 (並列 3 worktree)                     マージ順: A → B → C
  ├─ W1-A signature (M1)                     … site-header ナビ/PaintProgress, page-blocks SectionMark(data属性), layout オーバーレイ, motion 4 部品
  ├─ W1-B hover-suite (M2)                   … site-header CTA/kt-vt-header, page-blocks ボタン群, slot-image/media-cover kt-photo, footer, works/voices/colors(B1), PageTransition
  └─ W1-C archivo-font (§3-8)                … root layout + globals.css:163 のみ (他班と非交差)
     ※ A と B の site-header/page-blocks/layout は行非交差だが隣接 hunk があるため、B の rebase 時は §1.9 最終形で機械解消
Wave 2 (直列 1)
  └─ scroll-texture (M3 修正版スコープ §3-3)  … Wave 1 確定形の上に header className / slot-image / media-cover / SectionMark 罫線 / SecTitle / PaperNoise / ハンバーガー / footer ticks
Wave 3 (並列 4 worktree — 相互ファイル交差ゼロ)  マージ順: 任意
  ├─ page-home      … (site)/page-body.tsx + 自区画 CSS + motion/split-chars, strip-wheel, color-strip
  ├─ page-colors    … colors/page-body.tsx + 自区画 CSS + motion/tilt-math, colors-tilt
  ├─ page-story-process … story/process page-body + 自区画 CSS (新規コンポーネントなし)
  └─ page-rest      … service/about/shop/materials/notes page-body + _lib/note-nav + (editor)/edit/page-map.tsx + 自区画 CSS
Wave 4 (直列・実装なし・fix のみ)
  └─ 統合検証 (§7) + 堀さん視覚承認 4 項目
Wave 5 (発明枠 — v1.1 で新設。パリティ検収完了後に着手)
  ├─ W5-A インク引き継ぎ (signature+hover-suite の同根 2 案を統合 1 設計。
  │       sessionStorage に直近閲覧色を保持 → プログレスバー/インジケータドットに反映。
  │       WCAG コントラスト 3:1 未満の淡色 (DD-090 等) は --soul 赤へフォールバック)
  ├─ W5-B 塗料が満ちる工程番号 (process .kt-ps-no の hover fill を下から満ちる
  │       linear-gradient 遷移 0.6s に。正典 0.3s 即時塗りからのオプトイン逸脱)
  ├─ W5-C インジケータのクリックナビ化 (ドット 7px 見た目のまま ::before で 24px
  │       ヒット領域。tabindex なし = マウス/タッチ専用、scrollIntoView smooth)
  ├─ W5-D 粘性イージング統一 (--ease-viscous を 1 定義で新設。適用はカーソルリング拡大 /
  │       検品スタンプ / hover 戻りの 3 箇所限定。カーブ 2 案を実機で堀さんが選定)
  └─ W5-E 文字が塗られて現れるヒーロー (正典「立ち上がり」と A/B 実機比較 →
          堀さんが選択。Safari の background-clip:text 実機 QA 必須)
※ 膜厚ゲージは「事実データ (工程別膜厚 μm) の入手」が前提条件。隈部さんから実測値が
  もらえたら W5-F として昇格 (データ発明は不可)。
```

各 wave の worktree は直前 wave マージ後の main から切る。globals.css は全班とも自区画内のみ編集のためどの順でマージしても衝突しない。

---

## 6. wave 別受入条件

### Wave 0
- `npm run build` / `npm test` / `npm run lint` PASS (マーカーは空コメントのため無影響)。区画 7 対 + 順序が §1.4 と一致。

### Wave 1 (A/B/C マージ完了時)
- 各班仕様の受入条件全件 (M1 §9 の 22 項目 / M2 §7 の 6 項目+手動 13 項目、§3-1/3-2 の修正込み) + W1-C 受入 (§3-8)
- build で (site) 全ルート Static 維持、`npm test` 全 PASS (tests/motion-path-current + tests/motion-hover-suite 追加)
- **堀さん視覚確認ゲート①** (dev スクショで先行承認、Wave 2 着手をブロックしない): 写真の静置 grayscale(0.9) 化 / CTA・ヘッダーボタンの outline+刷毛化
- /edit・/admin にカーソル/インジケータ/PageTransition が存在しない。/admin に kt-btn-brush が漏れていない (`git grep kt-btn-brush src/app/admin` ゼロ)

### Wave 2
- M3 受入 1-3, 5-14 (§3-3 修正版: 受入 4 の colors 項目と qty 項目は Wave 3 後へ移動)。works/voices/notes カバーで kt-sd-photo 発火 (EXTRA-4)
- Firefox (または @supports 無効化) フォールバックで全コンテンツ表示、reduce で G7 全停止
- /edit で画像ホットスポット操作の非退行 (`npm test` の editable-attrs / coordinate-mapping / edit-page-map PASS 含む)

### Wave 3 (4 班それぞれ + 統合)
- 各班仕様の受入条件全件 (§3-4〜3-7 の修正込み)
- 統合確認 (Wave 2 から移動分): /colors で ①swatch-paint (M3 CSS × page-colors DOM) 発火 ②sheen スライド (`.kt-swatch-host:hover`) ③VIEW カーソル (`data-cursor="view"`) ④チルト+塗り登場+透かしパララックスの同時成立 (transform / clip-path / ::after transform のプロパティ非競合を実機確認、低スペック機でレイヤ数/GPU メモリ確認)
- /service で qty バー (page-rest 版) がスクロール伸長 + 縞 + reduce 静止満尺
- /edit/notes/[slug] が nav 付きで正常描画 (§2-10)

### Wave 4 (統合検証 — §7 全体受入の消化)
- 全体受入 §7 を 2 回連続 PASS
- **堀さん視覚確認ゲート②**: kt-rule flex:1 化 (ラベル右寄せ) / 代表名の原寸復元 / 透かし番号の色連動 (特に淡色 090)

---

## 7. 全体受入条件・テスト方針

### 全体受入条件
1. **SSG 非退行**: `npm run build` 成功、(site) 配下全ルートのレンダリング区分が実装前 main と完全一致 (ルートテーブル diff ゼロ)。`ƒ Dynamic` 化ゼロ
2. **テスト**: `npm test` 全 PASS — 既存全件 + 新規 6 ファイル (tests/motion-path-current, motion-hover-suite, motion-home-split-chars, motion-home-strip-wheel, colors-tilt-math, note-nav)。`npm run lint` PASS。package.json 差分なし (新規依存ゼロ — Archivo は next/font 同梱)
3. **reduced-motion 全停止**: DevTools エミュレーションで全ページ確認 — カーソル DOM 不在 / チルト・パララックス・スクロール駆動・文字リビール・刷毛・遷移アニメ全停止 / コンテンツ完全可読 / 機能フィードバック (プログレスバー・wheel 変換・静的 15%) は維持
4. **pointer:coarse**: hover 演出全停止、タッチスクロール/横スワイプ非阻害、地図・shop 写真はカラー維持 (page-rest の意図的差分)
5. **エディタ共存**: /edit 全ページ + /admin/visual でホットスポット操作・data-editable-*・kmb:reveal-done の非退行
6. **console**: エラー / hydration mismatch ゼロ (特に home の SSR 文字分割)
7. **キーボード**: Tab/Enter/Esc/Arrow 全項目 PASS (ナビ・Sheet 開閉・刷毛ボタン focus-visible・ヒーロー→ストリップ 8 Link 巡回)
8. **legacy 並置比較**: `npx serve legacy` と並べ、カーソル lerp の残り方 / インジケータ切替位置 / 下線伸縮方向 / 刷毛スイープ / grayscale / チルト+グレア / 透かしパララックス / 工程番号 hover の体感一致
9. **レイアウト**: 320px/375px で横スクロール非発生 (全ページ)、1100px/900px/640px ブレークポイント確認
10. **印刷**: /colors /service の印刷プレビューで clip/scaleX の from 固まりなし
11. **Firefox 安定版**: スクロール駆動無効でも全コンテンツ表示・透明欠落なし
12. **堀さん視覚承認 4 項目** (ゲート①②) 完了
13. 実装→検証 2 回連続 PASS (implementer + tester ペア、全 wave)

### テスト方針
- **unit (vitest / node / tests/ 直下)**: 純関数のみ (path-current / strip-wheel / tilt-math / split-chars / note-nav)。IO・rAF・WAAPI は unit で追わない (jsdom 偽陽性回避)
- **ソースガードテスト** (M2 方式): 正典値リテラル (0.42s / 0.18 / -45% / grayscale(0.9) 等) と配線 (クラス名の CSS⇔TSX 対) を fs 読みで grep 検証。scroll-behavior smooth→auto の順序ガード含む
- **ビルド検証**: ルートテーブル diff の機械比較 (wave 毎)
- **実機 E2E (Chrome MCP / Playwright MCP)**: home / colors / works/[slug] / service / story / contact の 6 ページ × {通常 / reduce / touch / 375px / 1100px} マトリクス。CDP エミュレーション + スクリーンショット 3 段階スクロール比較 (伸長の単調増加判定)
- **クロスブラウザ**: Chrome (フル) / Safari 18.2+ (フル + clip-path 実機チラつき確認) / Firefox (フォールバック)
- **回帰の砦**: /edit iframe 5 ページ + /admin/visual の操作確認を Wave 2 以降の全 wave で反復


---

## 採用 EXTRA
- signature: プログレスバーの刷毛先端 (width100%+translateX 方式 + skewX(-14deg) チップ — G5 と刷毛モチーフ統一)
- hover-suite: 刷毛の掠れエッジ (kt-btn-brush::before 先端に dd-edge polygon 90° 回転)
- hover-suite: footer-giant のスクロール駆動塗り — @media (hover:none) 環境限定に修正して採用 (hover 環境では view() の fill が hover 塗りをロックするため媒体分離)
- scroll-texture EXTRA-4: MediaCover への kt-sd-photo 展開 (works/voices/notes カバーに写真せり上がり — B2 回収)
- scroll-texture EXTRA-2: 透かし番号の色見本連動 — 実装を page-colors に移管、淡色 DD-090 の視認性チェック条件付き
- page-colors EXTRA-1 + story-process EXTRA (統合): Archivo 可変フォント導入 — W1-C 独立タスク化 (root layout + globals.css:163 のみ、font-stretch 125% の legacy パリティ修復)
- page-colors EXTRA-3: グレアの色温度連動 (color-mix(in oklab, #fff 78%, var(--dd-a)))
- page-colors EXTRA-4: 透かし番号の hover 滲み (stroke → rgba(168,15,34,0.28) 0.45s)
- page-story-process: ドロップキャップの乾着 (reveal 完了後 primer→carbon 0.6s、Safari は静的フォールバック)
- page-rest: 検品スタンプ演出 (QC ✓ clip-path 0.4s + 0.06s stagger、reduce で静的全表示)
- page-rest: 代表名の原寸復元 (clamp(48px,7.6vw,96px) — legacy パリティ修復、堀さん視覚確認対象)
- page-rest: 前後記事ナビの塗り下線 (G4 正典パラメータ 0.35s/origin 反転を流用)

## 却下 EXTRA (理由付き)
- signature: 塗料の粘性カーソル — 署名演出 (カーソル) の手触り変質リスクと QA 増。パリティ検収後のバックログ
- signature: インクの引き継ぎ (--kt-ink) — 跨ページ状態 (sessionStorage) の複雑性 + 淡色 (DD-090) でプログレスバー/ドットの視認性破綻 + hover-suite 案と概念重複。バックログで統一設計要
- signature: セクションインジケータのクリックナビ化 — 全ページの Tab 停止増と 7px ドットのタップ標的問題。旧サイト正典 (純装飾 pointer-events:none) を優先
- hover-suite: ページ間の色引き継ぎ — signature インク引き継ぎと同根の跨ページ状態。両案まとめて却下・バックログ集約
- hover-suite: 真の View Transitions 化 — experimental API 依存 (自班も別ブランチ PoC 推奨と明記)。本計画外
- hover-suite: 塗料の粘性イージング / scroll-texture EXTRA-3 / page-colors EXTRA-2 (粘性イージング 3 案) — 3 班 3 カーブの正典逸脱で採用すると分裂する。全却下し --ease-viscous を予約名として凍結、採用時は堀さん選定の 1 定義
- scroll-texture EXTRA-1: 刷毛目ワイプ写真リビール — mask-image + view() timeline の iOS Safari 実機リスク (自班が clip-path ですらチラつき前例を指摘) + 0.5 日。バックログ
- scroll-texture EXTRA-5: ヘッダー小口帯の読了プログレス化 — M1 G2 塗りプログレスバーと機能重複 (G2 採用確定)
- page-home: 塗料の粘性ホイール慣性 — scroll-snap (proximity) と lerp スクロールの干渉リスク。正典の 1:1 直接操作を優先
- page-home: 文字の塗られて現れるリビール — ヒーロー (最重要視覚) の正典逸脱 + Safari text-clip QA。堀さん判断バックログ
- page-home: 進捗バーの JS フォールバック — Safari 18.2+ が scroll-timeline 対応済みで実対象は Firefox のみ。静的 15% は旧サイト同等でパリティ充足
- page-home: 設計図グリッドの検分ルーペ — LCP 直上ヒーローへの client コンポーネント追加に対して payoff が小さい
- page-story-process: 塗料が満ちる工程番号 — hover 正典 (0.3s 即時 fill) からの逸脱。正典実装後のオプトイン候補
- page-story-process: 膜厚ゲージ — 旧サイトに存在しない新規要素の発明。パリティ最優先の本計画では見送り (バックログ)
- page-rest: ウェットエッジ — qty バーは縞+スクロール伸長で情報量十分。過剰装飾の抑制
- page-rest: マスキング剥がし (about 地図) — iframe 二重読み込みコスト、自班も要実機検証と明記。filter 遷移 (採用済み) で十分

## 検出した班間衝突と解決
- service 数量バー二重実装: M3 (.kt-sd-qty) と page-rest (.kt-qty-track/.kt-qty-fill) が service/page-body.tsx 258-263 行を両方書き換え → page-rest 単独所有、M3 は G7-6 (CSS+TSX) を全削除
- colors 透かし番号の所有権が正面衝突: M3 §13「本班所有・再実装禁止」vs page-colors §4 フル実装、カウンタスコープ名も不一致 (.kt-colors-sec vs .kt-color-entries) → page-colors 単独所有・.kt-color-entries 確定、M3 は G7-5 と colors/page-body.tsx 変更を全削除
- swatch-paint フック名の契約不一致: M3 は .kt-sd-swatch を自付与、page-colors は .kt-dd-swatch 提供を宣言 → .kt-sd-swatch に統一 (CSS=M3 / DOM 付与=page-colors)、kt-dd-swatch 廃止
- sheen セレクタ契約不一致: M2 B1 は .kt-swatch-host:hover、page-colors 受入 9 は .kt-dd:hover を期待 → .kt-swatch-host:hover が正、Drawdown ルートに kt-dd kt-swatch-host 併記で解決
- site-header.tsx を 3 班が編集 (M2 kt-vt-header と M3 kt-header-edge は同一行) → M1‖M2 並列 → M3 直列、最終形 className を計画書 §1.9 で確定
- slot-image.tsx Image className 同一行: M2 kt-photo-img と M3 kt-sd-photo → 併記最終形 'kt-photo-img kt-sd-photo object-cover' を確定
- page-blocks.tsx SectionMark を M1 (data 属性) と M3 (kt-rule 罫線) が両方置換 → 合成最終形を §1.9 で確定、M1→M3 順
- reduced-motion 全称ブランケット (*,::before,::after 0.01ms) を M1 と page-rest が重複定義 → M1 単独所有、page-rest から削除
- テスト配置欠陥: M1 src/components/motion/path-current.test.ts と page-rest src/app/_lib/note-nav.test.ts は vitest include (tests/**/*.test.ts) 外で実行されない → tests/ 直下へ移動
- NoteDetailPageBody の nav 必須 props 化が src/app/(editor)/edit/page-map.tsx:80 (nav なし呼び出し・実在確認済み) を破壊 → page-rest が同一 PR で page-map を修正
- コマンド不統一: M4-home / story-process が pnpm 記載、リポジトリは package-lock.json (npm) → npm に統一
- 粘性イージングを 3 班が異なるカーブで提案 → 全却下、--ease-viscous を予約名として凍結 (採用時は 1 定義)
- globals.css 末尾 append を 7 班全員が実施する物理衝突 → Wave 0 で班別区画マーカーを先置きし構造解消
- M3 EXTRA-5 (小口帯読了プログレス) が M1 G2 塗りプログレスバーと機能重複 → G2 採用につき却下
- 色引き継ぎ概念の 2 班重複 (signature インク引き継ぎ / hover-suite ページ間色引き継ぎ) → 両却下・バックログ 1 本に集約
- M2 PageTransition の transform 中の fixed/sticky 干渉懸念 → sticky 無影響を検証、main 内 position:fixed 禁止を規約化
- M4-home ストリップ化 × M1 VIEW カーソルセレクタ a[href^='/colors#'] → Link 構造維持で両立 (契約表に明記)
