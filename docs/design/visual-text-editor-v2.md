# ビジュアルテキストエディタ v2 — 全静的テキストの編集可能化

canonical 上位: `docs/design/visual-text-editor.md`(v1、74 スロット確定表)。本書はその拡張 v2。

## 0. 背景と要求

ユーザー(隈部塗装オーナー)の要求(2026-07-10):

> 「3つのグレードから、選ぶ。」は変更できるが、その下の本文
> 「下地はどのグレードも共通です。#800 で積層痕を研ぎ落とし、プラサフで微細な段差を
> 埋め、#1200 で水研ぎ。違いはトップコートの層数だけ——…」が変更できない。他も全然変更できない。
> **「全部の文字を変更できることが大事です。」**

v1 は見出し/ヒーロー/CTA を中心に **74 スロット**を厳選し `<SlotText>` で配線した。本文段落・
箇条書き・**インライン装飾付きテキスト**はハードコード JSX のまま残り、編集不能だった。とりわけ
`#800`/`#1200` を `<span className="font-mono">` で囲む等の**インライン装飾**を持つ段落は、
plain-string の `<SlotText>`(`multiline`)では表現できず、v1 設計で意図的に Tier B(先送り)にしていた
(`docs/design/text-slots/colors-shop.md:14` 参照)。

v2 の目的: **公開サイトの全静的テキストを編集可能にする**。装飾を失わずに(視覚非退行)。

## 1. 編集不能テキストの 2 分類と対処

| 分類 | 例 | 対処 | 新機構 |
|---|---|---|---|
| **装飾なし本文** | 単純な段落・リード文・箇条書き項目 | 既存 kind(`text`/`lines`/`multiline`)で TEXT_REGISTRY に追加し `<SlotText>` で配線 | 不要 |
| **装飾付き本文** | `#800`/`#1200`(font-mono)、`<strong>` 太字を含む段落 | 新 kind `rich` + `<SlotRichText>` + マークアップ部分集合パーサ | **必要** |

大半は装飾なし(既存機構で対応)。装飾付きは少数(棚卸しで確定)だが、これらのために `rich` を新設する。

## 2. DB マイグレーション: **不要**

`page_text`(migration 0014)は `slot_key` PK + `text_override text not null` + `updated_at` のみ。
**`kind` は DB に無く、コード側 `TEXT_REGISTRY`(text-registry.ts)が単一ソース**。text 列に長さ・内容の
CHECK 制約は無い。したがって `rich` マークアップは既存 text 列に生文字列としてそのまま保存でき、
**本番 DB への変更は一切不要**。v2 は純粋なコード変更(コンポーネント + registry + エディタ UI + テスト)。

## 3. `rich` kind 仕様

### 3.1 マークアップ語彙(最小・実使用に対応)

現行ハードコード JSX に実在する装飾のみを表現する。過剰な表現力は攻撃面・UX 複雑化を招くため入れない。

| マークアップ | 描画 | 用途 |
|---|---|---|
| `` `text` ``(バッククォート囲み) | `<span className="font-mono">text</span>` | `#800`/`#1200`/番手/日塗工番号/カラーコード等の等幅表示 |
| `**text**`(二重アスタリスク囲み) | `<strong>text</strong>` | 太字強調(例: 「見えなくなるからこそ、そこに手を抜かない。」) |
| `[text](url)` | `<Link href="url">text</Link>`(内部) / `<a href>`(外部) | **本文中インラインリンク**(実在確認済み: shop.grades.footnote の `/colors`・`/service`、shop.flow.footnote の `/tokushoho`・`/contact` 等) |
| 空行(`\n\n`) | 段落区切り `<p>` | multiline と同じ段落分割 |
| 単一改行(`\n`) | `<br/>` | 段落内の強制改行 |
| その他すべて | 素テキスト(React エスケープ) | 通常本文 |

**リンクの安全性(必須)**: `[text](url)` の `url` は **相対パス(`/` 始まり)/ `http` / `https` / `mailto` のみ許可**。
`javascript:` / `data:` / その他スキームはパース時に**リンク化せずリテラル表示**(または検証エラー)。
相対内部リンク(`/colors` 等)は Next.js `<Link>`、外部(`http(s)://`)は `<a href rel="noopener noreferrer" target="_blank">`。
`url` はプレーン文字列を href 属性値として渡すのみで、`text` は常に React エスケープされる。

**核心原則: 意味的装飾のみ rich、装飾的ラッパーは構造分割**

rich パーサが表現するのは **内容に属する意味的インライン装飾(等幅=コード / 太字=強調 / リンク)のみ**。
**純粋に presentational なラッパーは rich トークンにせず、構造 JSX として残し、その中身テキストだけを
別 plain スロットに切り出す**。これで語彙を 3 トークンに保ち、任意 className の受け渡しを排除する。

| 実在パターン | 装飾 | 対処 |
|---|---|---|
| `<small>` 価格サブキャプション(shop/service 価格カード) | `<small>` | 価格スロット + 注記スロットの **2 plain に分割**(small は構造で残す) |
| 必須マーク `<span className="text-destructive">*</span>`(フォームラベル) | 色付き `*` | `*` は必須インジケータ = UI chrome。**ラベル文字だけ plain スロット化**、`*` span は構造で残す |
| 小活字の開示注記 `<span className="text-xs text-carbon-soft">…</span>`(tokushoho/privacy) | 小活字 | 主文スロット + 注記スロットの **2 plain に分割**(小活字 span は構造で残す) |
| 同意チェックボックス「`<Link href="/privacy">プライバシーポリシー</Link>`に同意する」+ `*` | インラインリンク + `*` | 文全体を **rich**(`[プライバシーポリシー](/privacy)に同意する`)、`*` span は構造で残す |

⇒ **rich 語彙は最終的に mono(バッククォート)/ strong(`**`)/ link(`[](url)`)の 3 トークンで確定**。
色付き span・小活字 span・必須マークは rich に含めない。

### 3.2 パーサの安全性(XSS 不可能を構造的に保証)

パーサはマークアップ文字列を**トークン列 → React 要素**へ変換する。`dangerouslySetInnerHTML` は
**使わない**(SlotText と同一原則)。

- 出力できる要素は `<p>` / `<span className="font-mono">` / `<strong>` / `<br/>` / テキストノード **のみ**。
- **属性の受け渡しは一切なし。`className` は固定リテラルのみ**。href/style/onClick 等の
  ユーザー制御属性は生成経路が存在しない。
- 生の `<` `>` `&` はテキストとして扱われ React が自動エスケープする。ユーザーが `<script>` と
  書いても文字列 `<script>` が画面に表示されるだけで、DOM ノードは生成されない。
- ⇒ **原理的に XSS 面ゼロ**。これが「rich でも安全」の核心であり、`dangerouslySetInnerHTML` 禁止と矛盾しない。

### 3.3 検証(`validateSlotText` の `rich` 分岐)

- 空文字(空白のみ)禁止 — 既存と同じ
- `text.length > maxLen` 超過チェック — **raw 長(マークアップ記号込み)**で判定(実装単純・保存サイズ制約として妥当)。
  maxLen は装飾記号分の余裕を持たせて設定する。
- **マークアップ未対応マーカー(奇数個のバッククォート/`**`)はエラーにしない** — パーサはリテラル文字として
  安全に描画するため壊れない。エディタ UI で「対応が取れていません」の**警告**表示は将来の改善(v2 は許容)。
- 段落数上限は任意(`maxLines` 指定時のみ、multiline と同基準)。

### 3.4 `<SlotRichText>` コンポーネント

`<SlotText>` と同型の props(`slotKey` / `resolved` / `editMode` / `className` / `as`)。

- `editMode===true` のとき `data-editable-text={slotKey}` を発行 → **既存エディタの iframe 走査
  (`[data-editable-text]`)が無改修で拾う**。
- **描画は SlotText の inline-vs-multiline 分岐を踏襲**(実装確定):
  - 単一段落(`\n\n` なし)→ `createElement(as ?? "span", …)` で **inline 描画**(`<p>`/`<div>` で包まない)。
    これにより `<SecLead>`(内部が `<p>`)の中に `<SlotRichText as="span">` を置いても `<p><div>` の
    不正 HTML にならず、shop.grades.lead 等のインライン flow 埋め込みが成立する。
  - 複数段落(`\n\n` あり)→ root=`div` + `<p>` 群(multiline と同型、`as` 無視)。
- kind が `rich` でないスロットキーを渡したら throw(SlotText と同じ早期失敗)。
- パーサは共有関数 `renderRichText(text): React.ReactNode` として切り出し、単体テスト対象にする。

### 3.5 エディタ UI(`hotspot-menu.tsx` の `rich` 分岐)

- textarea(複数行、multiline と同様)で **raw マークアップ**を表示・編集。
- 凡例を表示: 「`` `文字` `` = 等幅 / `**文字**` = 太字 / 空行 = 段落区切り」。
- リアルタイムプレビューは v2 では省略可(将来改善)。

## 4. 棚卸しサマリ(全静的テキスト)

詳細な per-page スロット表は 3 体の棚卸しエージェント報告(Group A/B/C)が単一ソース。実装者へは
各ページの該当報告セクションをプロンプトに転記して渡す。ここでは規模と分類方針のみ記録する。

### 4.1 規模(要追加スロット概算 ~920)

| Group | 対象 | 要追加 | plain | lines | rich(暫定) |
|---|---|---|---|---|---|
| A | home / about / story / colors / process / materials | 469 (+重複42) | 395 | 6 | 68 |
| B | service / shop / works | 257 | 236 | 1 | 20 |
| C | 共通(header/footer/form) / voices / notes / tokushoho / privacy / contact | 194 | 175 | 10 | 9 |
| **計** | 全13ページ + 共通 | **~920** | ~806 | ~17 | ~97(暫定) |

### 4.2 rich の再分類(重要 — 真の rich は ~30-40 件)

棚卸しの「rich 暫定 ~97」の大半は**インライン装飾ではなく、コンポーネントが別フィールドに装飾クラスを
適用しているだけ**。§3.1 の「意味的装飾のみ rich、装飾的ラッパーは構造分割」原則で再分類する:

| 暫定 rich パターン | 実体 | 確定分類 |
|---|---|---|
| R2 PhotoFigure 英語キャプション(capEn, 31件) | `PhotoFigure` が capEn prop に font-mono を適用。テキスト自体に装飾なし | **plain**(capJa + capEn を別 plain スロット化) |
| R3 colors swatch 英語コード併記(8件) | swatch コンポーネントが code フィールドに font-mono を適用 | **plain**(name + code を別スロット化) |
| R7 `<cite>` 引用出典(story ch2, 1件) | 引用本文 + 出典は別要素 | **plain**(quote + cite を別スロット化) |
| R4 `kt-paint-mark` 装飾span(home hero, 1件) | 見出しの一語のみ装飾 | **lines + 既存 renderLines**(home.statement.heading と同型。generic rich 不要) |
| R8 `<strong>なぜ</strong>` 固定ラベル(process why ×9) | 固定ラベルは構造、理由文中の追加 `<strong>` のみ真 rich | ラベル構造化 + 理由文 **rich**(内部 strong 有る 6 件のみ) |
| R1 プロース内 `#800`/`#1200`(shop.grades.lead / story ch4 / process desc / materials diff) | 文中に埋め込まれ分割不能 | **真 rich(mono)** |
| R5 結論文の `<strong>`(story bodies / about table cells) | 文中強調、分割で文が壊れる | **真 rich(strong)** |
| 本文中インラインリンク(shop footnote ×2 / contact 同意 ×1) | 文中リンク | **真 rich(link)** |

⇒ **真の rich ≈ 30-40 件**。パーサ語彙 mono/strong/link で全て表現可能(§3.1 確定)。

### 4.3 スコープ確定(境界事例の既定判断)

| 項目 | 判断 |
|---|---|
| `<head>` metadata / SEO(title/description/OG) | **対象外**(画面本文でない)。将来別スコープ |
| SVG 内 `<text>`、寸法マーカー(φ55 等)、TICKER の aria-hidden 純装飾 | **対象外**(装飾/図表) |
| フッター巨大装飾文字・マーキュー(視覚表示される語) | **対象**(視覚表示・語として意味を持つ)。tight maxLen |
| aria-label / title 属性 / honeypot / clipboard テンプレ(非表示) | **対象外**(画面に見えない) |
| orphan `/blog`(nav 未リンク・/notes が実質後継) | **対象外・別途フラグ**(死にルートに投資しない。要削除確認は別) |
| DRAWDOWNS(home)と SWATCHES(colors)の重複色データ | **両方を独立スロット登録**(現状の独立ハードコードを踏襲)。二重編集の同期は将来課題としてフラグ |
| `CtaBand`/`ArrowButton` の「相談する」等ボタン文言(現行 registry 対象外) | **対象**(方針転換)。共通「相談する」は既存 `shared.cta.consult` へ配線、他ボタンは個別スロット |
| 反復配列(9工程/素材表/色見本/SpecTable 等) | **フラット per-field スロット**で対応(既存機構・click-on-page 編集で UX 問題なし)。構造化配列エディタは将来拡張 |

## 5. 実装ウェーブ

**Wave 0(機構・直列・implementer+tester 1 組 → main マージ):**
0a. `text-registry.ts` を `text-registry/` ディレクトリへ分割(`types.ts` + per-page ファイル +
    `index.ts` 再エクスポート)。**公開 API(TEXT_REGISTRY / TEXT_REGISTRY_HASH / PageTextSlot /
    helper 群)と既存 74 スロットの内容・順序を厳密保持**。facade の import パス不変。
0b. `TextKind` に `"rich"` を追加。
0c. `renderRichText()` パーサ(mono=バッククォート / strong=`**` / link=`[](url)` スキーム制限)→ React
    ノード。**dangerouslySetInnerHTML 不使用**。`<SlotRichText>`(新規 slot-rich-text.tsx)。
0d. `validateSlotText` に `rich` 分岐。
0e. `hotspot-menu.tsx` に `rich` 分岐(textarea + 凡例)。
0f. 単体テスト: パーサ(装飾→正要素 / XSS→リテラル / 未対応マーカー安全 / link スキーム制限 /
    段落・改行)、validateSlotText rich、SlotRichText 属性発行、既存 74 系テスト維持。
- **Wave 0 は main にマージしてから Wave 1 を起動**(Wave 1 worktree は更新済み main から分岐)。

**Wave 1(登録 + 配線・ページ単位で並列・worktree 隔離・各 implementer+tester ペア):**
各ペアは自分の per-page registry ファイル + page-body のみ触る(分割済みなので競合ゼロ)。

| バッチ | ペア | 担当 |
|---|---|---|
| A | W1-1 | 共通(shared-chrome 74)+ CtaBand/header/footer/form 配線(page-blocks.tsx 等 shared は W1-1 のみ) |
| A | W1-2 | shop 120(ユーザー最優先) |
| A | W1-3 | service 122 |
| B | W1-4 | process 98 |
| B | W1-5 | materials 101 |
| B | W1-6 | colors 73 + works 15 |
| C | W1-7 | about 72 + voices 14 |
| C | W1-8 | home 66 + notes 14 |
| C | W1-9 | story 59 + tokushoho 31 |
| C | W1-10 | contact 40 + privacy 21 |

- 各ペア:per-page registry へスロット追加(**defaultText は現行描画テキストと厳密一致=非退行**)+
  page-body のハードコード文字列を `<SlotText>`/`<SlotRichText slotKey resolved={texts[key]} editMode>` へ置換。
- tester:2 連続 PASS(型 + lint + vitest + 該当ページ build + スロット発行確認)。
- Opus が git -C でマージ、per-page ファイルなので競合は spread 追加行(index.ts)のみ→ Opus 直接解決。

**Wave 2(統合検証 → Codex 外部レビュー → 総件数テスト更新 → デプロイ → 本番確認):**
- マイグレーション**不要**(§2)。
- `tests/page-media-text-registry.test.ts` の 74 件アサーションを最終総数へ更新。
- Codex CLI で全差分レビュー(rich パーサの XSS 安全性・非退行・モジュール境界を重点)。
- main マージ → Vercel デプロイ READY 確認 → `/admin/visual` 実機(Chrome MCP)で全テキスト hotspot 化・
  編集・保存を確認。

## 6. 非機能・非退行

- **視覚非退行**: 装飾付き段落は `rich` で font-mono/太字を保持。plain 化による装飾喪失を起こさない。
- **SSG 非破壊**: 既存の resolveAllTexts(unstable_cache)経路をそのまま使う。request-time API を増やさない。
- **モジュール境界**: SlotRichText は `@/modules/page-media/facade` の TEXT_REGISTRY のみ参照(SlotText と同じ)。
- **件数アサーション**: tests/page-media-text-registry.test.ts の 74 件アサーションを新総数へ更新。
