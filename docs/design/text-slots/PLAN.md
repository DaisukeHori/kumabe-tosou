# テキストスロット統合裁定 (page_text 設計の確定入力)

- 生成: 2026-07-10 text-slot-inventory Workflow (5 班棚卸し → 統合裁定)
- 班別全量: docs/design/text-slots/*.md

# page_text 設計 統合裁定レポート (v1 確定入力)

裁定者: テキストスロット統合裁定 / 入力: 5 班棚卸し (home-story / about-service / process-materials / colors-shop / rest-chrome) / 照合済み: `/Users/horidaisuke/projects/kumabe-tosou/src/modules/page-media/registry.ts` (画像スロット 44 件)

---

## 1. 命名規約 (確定)

### 1.1 キー形式

```
<page>.<section>[.<index>][.<field>]
```

- 全セグメント **小文字 snake_case**、ドット区切り。camelCase 禁止 (`beforeAsk` → `before_ask`、`capJa` → `caption`)
- 連番は独立セグメント: `story.chapter.1.title` (× `story.chapter1.title`)、`home.craft.card.1.title`
- `page` 値: `home / story / about / service / process / materials / colors / shop / notes / contact` + 擬似ページ `chrome` (header/footer) / `shared` (全ページ共通文言)
- 法的ページ (tokushoho / privacy) は全文 tier C のため page_text キー空間に **登場させない**

### 1.2 ゾーン名の統一

| 班のブレ | 確定 |
|---|---|
| `head` / `pagehead` / `hero` (PageHead 領域) | **`hero`** に統一 (`colors.head.*` → `colors.hero.*`、`about.pagehead.*` → `about.hero.*`) |
| `secmark` / `sec_no`+`sec_label` / `sectionMark.no` | **`sec_no` / `sec_label`** (全て tier C のため記録上の統一) |
| `shop.sec1〜4` (番号ベース) | 意味名に変更: `shop.grades` / `shop.simulator` / `shop.products` / `shop.flow` |
| `cap_ja` / `capJa` / `caption` (和文写真キャプション) | **`caption`**。英語キャプションは `caption_en` (tier C) |
| CTA 帯: `cta.button` / `cta.label` | ボタンは `shared.cta.consult` に統合 (§2.2)。帯見出し/補足は `cta.heading` / `cta.note` |

### 1.3 field 予約語

`heading` (セクション/ページ見出し) / `lead` (見出し直下リード) / `title` (繰り返し単位内の項目見出し) / `body` (段落) / `note` (補足・注記) / `caption` (写真キャプション) / `label` (機能ラベル) / `cta` (ボタン文言)

### 1.4 画像スロットとの非衝突 (registry.ts 照合結果)

- **ルール: page_text キーは page_media の slot_key 44 件と完全一致してはならない**。実装時に両レジストリを import して交差ゼロを検証する単体テストを必須とする (page-media-registry.test.ts と同型)
- 確定 A 75 キーと画像 44 キーの完全一致は **ゼロ** (照合済み)
- **子キーのネストは許容**: `colors.hero.heading` (画像 `colors.hero` の配下) 等。特に画像キャプションは意図的に `<画像キー>.caption` とする (例: `home.craft.1.caption`, `contact.hero.caption`, `story.chapter.3.caption`) — 将来 admin で画像エディタと併置しやすい
- 単複で自然分離した近接キー: text `shop.grades.*` vs 画像 `shop.grade.1-3`、text `shop.products.*` vs 画像 `shop.product.1-3`。混同防止に有利なのでこの表記を維持

---

## 2. tier 境界の裁定 (班ごとのブレ修正)

方針: **迷ったら A を絞る。v1 の A =「オーナーが変えたくなる言葉」だけ**。process-materials 班の境界感覚が最も方針に近く、これをベースラインに他班を補正した。

### 2.1 統一ルール

| ルール | 裁定 | 補正された班判定 |
|---|---|---|
| PageHead (hero) の heading / lead | **A** | 全班一致、維持 |
| キャッチコピー性のあるセクション見出し | **A** | 全班ほぼ一致、維持 |
| 汎用・定型見出し (「会社概要」「依頼の流れ」「お問い合わせフォーム」「よくあるご質問」等) | **B** | rest-chrome が A にしていた `contact.form.heading` / `contact.faq.heading` / `contact.before_ask.heading`、about-service の `service.flow.heading` を降格 |
| セクションリード (SecLead) | **B** (hero lead と CTA 帯 note のみ A) | about-service (`about.facility.lead` 等 6 件)、colors-shop (`shop.sec1/3/4.lead`)、rest-chrome (`contact.form.lead` 等) を降格。process-materials は元から B で正 |
| CTA 帯の heading / note | **A** (note 含む) | home-story が B にしていた `home.cta.note` / `story.cta.note` を昇格 (他 4 班は A で一致) |
| CTA 帯ボタン「相談する」 | **A だが単一スロットに統合** (§2.2) | — |
| 内部導線ボタン (ページ間リンク) | **B** | home-story の `home.statement.cta` / `home.craft.cta.*` / `home.colorlineup.cta` / `home.materials.cta` / `home.notes.cta` (6件)、about-service の `service.process.link_button` / `service.grade.shop_button`、`about.cta.button`(サービスページへのリンク)、colors-shop の `shop.grade.{n}.cta` を降格。process-materials の related.button=B と整合 |
| 繰り返しカードの title (訴求フレーズ) | **A** / 汎用工程名・ステップ名は **B** | craft カード・twoscenes シーン title は A 維持。flow step title、buyflow title は B 維持 |
| 商品・グレード名 | **page_text 化しない** (pricing DB が正、§5.6) | about-service の `service.grade.{basic,standard,premium}.name`、colors-shop の `shop.grade.{n}.title` を A から除外 |
| グレードのターゲット訴求文 | **B** | about-service の `service.grade.*.target` (A) を colors-shop の `persona_text` (B) に揃えて降格 |
| story 章タイトル・引用 | **B** | home-story の `story.chapter.1-5.title` / `story.chapter.4.quote` を降格。本文 (B, リッチテキスト必須) とセット編集が前提であり、タイトルだけ独立編集可能にすると物語が壊れる |
| home hero の CTA 3 連 | **B (保留)** | site_settings.hero との二重管理問題が未解決のため v1 見送り (§5.5) |
| COMING SOON 商品名 (`shop.product.{n}.title`) | **B** | 販売開始時に商品 DB へ移行する性質。colors-shop 自身の注記に従い降格 |
| シミュレータ内テキスト (`shop.sim.size_sub` 等) | **B** | pricing UI と一体で扱うべき。A から降格 (`shop.simulator.cta` のみ例外的に A — サイト最重要 CV ボタンの一つ) |
| 見積もり 3 変数カードの一語見出し (サイズ/個数/グレード) | **B** | rest-chrome の A 判定を降格 (汎用名詞、声ではない) |
| インライン装飾 (`<strong>` / `font-mono`) を含むテキスト | **B 固定 (v2 リッチテキスト対応まで)** | colors-shop が A にしていた `shop.sec1.lead` (現 `shop.grades.lead`) を降格 |
| 価格・割引率・数値仕様・法的文言・英語意匠・SEC/INDEX/FIG・クレジット・フォームラベル・バリデーション文言 | **C** | 全班一致、維持 |

### 2.2 「相談する」の単一ソース化

同一文言 10 箇所 (`chrome.nav.cta.label` / `chrome.footer.nav.contact.label` / `home.cta.button` / `story.cta.button` / `service.cta.button` / `process.cta.label` / `materials.cta.label` / `colors.cta.label` / `shop.cta.label` / `notes.cta.label`) を **`shared.cta.consult` (cta, max8) 1 スロット**に統合。header・footer・全ページ CtaBand が同一キーを参照する。rest-chrome 班の単一ソース化推奨を採用。9 件削減。

`notes.cta.heading` / `notes.cta.note` は notes 一覧と notes/[slug] で同一文言のため **1 キーを両ルートで共有** (rest-chrome 推奨どおり)。

---

## 3. tier A 確定表 (75 件)

生カウント約 132 件 → 裁定後 **75 件** (上限 100 を下回る)。

### 3.1 ページ別件数

| ページ | 件数 |
|---|---|
| home | 15 |
| story | 6 |
| about | 7 |
| service | 8 |
| process | 9 |
| materials | 9 |
| colors | 4 |
| shop | 9 |
| notes | 4 |
| contact | 2 |
| chrome / shared | 2 |
| **合計** | **75** |

### 3.2 確定スロット一覧

kind: `text` = 単一行 / `lines` = 改行 (`\n`) 埋め込み見出し / `multiline` = 段落テキスト (`\n\n` 区切り)

**shared / chrome (2)**
| key | kind | max_len | 備考 |
|---|---|---|---|
| shared.cta.consult | text | 8 | 「相談する」。header nav・footer・全 CtaBand で共有 |
| chrome.footer.tagline | multiline | 80 | footer 事業紹介文。max-w-sm 折返し前提 |

**home (15)** — hero 見出し/リードは site_settings.hero 管轄のため対象外 (§5.5)
| key | kind | max_len | 備考 |
|---|---|---|---|
| home.statement.heading | lines | 90 | 5 行 reveal + 最終行 text-soul ハイライト (§5.3)。1 行 ≤18 字 |
| home.craft.heading | text | 24 | |
| home.craft.card.1.title / .2.title / .3.title | text | 16 | 等高 3 列グリッド、短さ厳守 |
| home.colorlineup.heading | lines | 30 | |
| home.twoscenes.heading | text | 26 | |
| home.twoscenes.scene.1.title / .2.title | text | 28 | |
| home.stats.heading | lines | 20 | |
| home.materials.heading | lines | 40 | |
| home.notes.heading | lines | 32 | |
| home.gallery.heading | text | 16 | |
| home.cta.heading | lines | 44 | ≤2 行 |
| home.cta.note | text | 60 | |

**story (6)**
| key | kind | max_len | 備考 |
|---|---|---|---|
| story.hero.heading | lines | 28 | 旧 story.head.title |
| story.hero.lead | multiline | 200 | |
| story.message.heading | lines | 36 | |
| story.message.body | multiline | 600 | 約370字4段落。textarea 必須 (§5.2)。インラインマークアップ有無を実装時に要確認、あれば B へ戻す |
| story.cta.heading | lines | 44 | |
| story.cta.note | text | 60 | |

**about (7)**
| key | kind | max_len |
|---|---|---|
| about.hero.heading | lines | 36 |
| about.hero.lead | multiline | 200 |
| about.why.heading | lines | 40 |
| about.facility.heading | text | 24 |
| about.gallery.heading | text | 18 |
| about.cta.heading | lines | 44 |
| about.cta.note | text | 60 |

**service (8)**
| key | kind | max_len |
|---|---|---|
| service.hero.heading | lines | 36 |
| service.hero.lead | multiline | 200 |
| service.process.aside.heading | text | 20 |
| service.terms.heading | text | 20 |
| service.qc.heading | text | 20 |
| service.gallery.heading | text | 16 |
| service.cta.heading | lines | 44 |
| service.cta.note | text | 60 |

**process (9)**
| key | kind | max_len |
|---|---|---|
| process.hero.heading | lines | 28 |
| process.hero.lead | multiline | 200 |
| process.coating.heading | lines | 24 |
| process.steps.heading | lines | 24 |
| process.booth.heading | lines | 28 |
| process.related.heading | text | 16 |
| process.gallery.heading | text | 18 |
| process.cta.heading | lines | 44 |
| process.cta.note | text | 60 |

**materials (9)**
| key | kind | max_len |
|---|---|---|
| materials.hero.heading | lines | 36 |
| materials.hero.lead | multiline | 200 |
| materials.methods.heading | lines | 24 |
| materials.matrix.heading | text | 18 |
| materials.why.heading | lines | 26 |
| materials.intake.heading | text | 20 |
| materials.gallery.heading | text | 14 |
| materials.cta.heading | lines | 44 |
| materials.cta.note | text | 60 |

**colors (4)**
| key | kind | max_len | 備考 |
|---|---|---|---|
| colors.hero.heading | lines | 36 | 「8枚」= SWATCHES.length と手動同期。admin にヘルプ警告 (§5.7) |
| colors.hero.lead | multiline | 200 | 「8色中5色」同上 |
| colors.cta.heading | lines | 44 | |
| colors.cta.note | text | 60 | |

**shop (9)**
| key | kind | max_len | 備考 |
|---|---|---|---|
| shop.hero.heading | lines | 26 | |
| shop.hero.lead | multiline | 200 | |
| shop.grades.heading | lines | 24 | 旧 sec1.title。lead は font-mono 混在のため B |
| shop.simulator.heading | lines | 30 | 旧 sec2.title |
| shop.simulator.cta | text | 16 | 旧 sim.order_cta。固定高ボタン+矢印、折返し厳禁 (班提案 18→16 に短縮) |
| shop.products.heading | lines | 24 | |
| shop.flow.heading | text | 20 | |
| shop.cta.heading | lines | 44 | |
| shop.cta.note | text | 60 | |

**notes (4)** — notes 一覧と notes/[slug] で共有
| key | kind | max_len |
|---|---|---|
| notes.hero.heading | lines | 34 |
| notes.hero.lead | multiline | 200 |
| notes.cta.heading | lines | 44 |
| notes.cta.note | text | 60 |

**contact (2)**
| key | kind | max_len |
|---|---|---|
| contact.hero.heading | lines | 20 |
| contact.hero.lead | multiline | 200 |

### 3.3 max_len の役割別標準 (レイアウトリスク突合結果)

| 役割 | 標準 max_len | 根拠 (班のリスク警告) |
|---|---|---|
| PageHead heading | 36 / ≤2 行 / 1 行 ≤20 | clamp(30px,5vw,56px) + 手動 br 前提。3 行化で組版崩れ |
| PageHead lead | 200 | 流し込み段落、clamp なしで寛容 (colors 現行 141 字 / shop 154 字を収容) |
| セクション heading | 20〜40 (現行文言基準) / ≤2 行 | 同上 |
| CtaBand heading | 44 / ≤2 行 | home-story 44 と about-service 32 のブレを 44 に統一 (同一文言「見積もりは、3つの数字で。…」26 字 ×2 箇所を収容) |
| CtaBand note | 60 | 全班 40〜80 のブレを 60 に統一 |
| カード title | 12〜28 (班提案どおり) | 等高グリッドの高さ崩れ防止 |
| shared.cta.consult | 8 | header 1 行バー 9 項目+CTA の制約 (rest-chrome 警告) |
| shop.simulator.cta | 16 | 固定高+矢印アイコンの折返し警告 (colors-shop) を反映し班提案 18 から短縮 |

---

## 4. B・C の扱い

- **tier B (約 180 件)**: v1 では **DB 化しない**。コードにハードコードのまま残し、本棚卸しを v2 バックログとして保存する。page_text スキーマ自体は B を後から追加できる設計 (registry 追記 = 自動 seed) とする。特に画像キャプション群は `<画像キー>.caption` の命名を予約済み — v2 で page-media 管理画面に併置する
- **tier C**: 恒久的にコード管理。理由別に: (a) 意匠 (SEC/INDEX/FIG/英語ラベル/マーキー/SVG 図)、(b) 事実・仕様値 (価格、番手、カラーコード、統計値、SKU、寸法)、(c) 法的 (特商法、プライバシー、写真クレジット、著作権、同意文言)、(d) 機能 (フォームラベル、バリデーション/エラーメッセージ、aria-label、プレースホルダ)。**tokushoho / privacy の 2 ページは全文 C**
- **境界の降格ルール確認**: C 判定に疑義が出た場合も v1 では C 維持 (絞る方向のみ許容)。B→A の昇格は v2 レビューで判断

---

## 5. 設計への引き継ぎ事項

### 5.1 レジストリ構造 (page-media と同型)

`src/modules/page-text/registry.ts` を単一ソースとする: `key / page / route / label(管理画面用) / kind(text|multiline|lines) / maxLen / maxLines / defaultText(現行ハードコード文言)`。migration seed・admin 一覧・フォールバック描画を全てここから生成。`REGISTRY_HASH` と件数アサーションテスト、**page_media SLOT_REGISTRY とのキー交差ゼロテスト**を必須とする。DB 行が無い/空のときは defaultText でフォールバック (画像の defaultSrc と同じ思想)。

### 5.2 複数行テキストの扱い

- `multiline`: `\n\n` = 段落区切り。描画側で段落ごとに `<p>` 生成。admin は textarea + 文字数カウンタ。`story.message.body` (600 字) が最大ケース
- リッチテキスト (`<strong>` / `font-mono` 番手表記) は **v1 非対応**。該当テキストは全て B/C に落とした (story 章本文、STEPS why、METHODS diff、shop.grades.lead、about.why.compare.kumabe.td、shop.buyflow meta)。v2 で制限付きマークアップ (strong と mono の 2 種のみの独自軽量記法 or 分割フィールド) を検討

### 5.3 改行を含む見出し (`lines` kind) の表現

- 値は **`\n` 埋め込みの単一文字列**。描画側は `\n` で split し行ごとに `<br/>` 相当で組む。既存 JSX の手動 `<br/>` は defaultText へ `\n` として転記
- バリデーション: 全体 maxLen に加え **行数上限 (原則 2、statement は 5) と 1 行あたり文字数 (18〜20)** を zod で強制。admin UI は行ごとのカウンタを表示し、「改行位置ごと編集できる」ことを明示 (colors-shop 班の指摘どおり、改行なし版への統一はしない)
- `home.statement.heading` (kt-hero-line 型): 行配列に split → 各行を reveal スパンで包む → **最終行に text-soul ハイライトを自動適用** (装飾はコンポーネント側の構造ルールであり、保存テキストにマークアップを含めない)。行数は 3〜5 行可変を許容し reveal ディレイは行 index から導出

### 5.4 SplitChars (文字分割アニメ) と編集テキストの共存

対象は home hero h1 のみ (site_settings 管轄、§5.5)。編集可能化する場合の必須要件:
1. スパン分割は描画時に DB 値から動的生成 (静的 JSX 焼き込み禁止)
2. `aria-label` は同一の生文字列から自動生成 (現状の手動複製をやめる)
3. 部分ハイライト (kt-paint-mark「見分けがつかない」) は**文字 index 固定ではなく部分文字列マーカーで指定** — v1 推奨は「編集 UI ではハイライト編集を出さず、固定部分文字列が含まれる場合のみ自動ハイライト、含まれなければハイライトなし」のフォールバック方式
4. 文字数上限厳守 (分割スパン数 = アニメコスト)
5. `\n` 改行と併用する場合は「行 split → 行内で文字 split」の順 (kt-hero-line 内 SplitChars)

### 5.5 site_settings との統合方針 (二重管理禁止)

- **home hero (見出し/リード/CTA) は page_text 化しない**。site_settings.hero が既存の編集経路。ただし現状 `(site)/page.tsx` が settings.hero を fetch していない**実装ドリフトの解消を v1 設計に含める** (接続タスク)。subheading 現行文言 90 字 > maxLength 80 の超過は「文言短縮 or maxLength 120 へ拡張」のどちらかを設計時に確定
- hero の CTA 3 連 (site_settings は単一 cta_label のみ): 第 1 CTA = site_settings.hero.cta_label、第 2・第 3 は v2 で page_text B として追加検討
- 会社名/代表者名/所在地: header・footer・about 会社概要表・tokushoho・privacy のハードコード計 10 箇所超を **site_settings.company 参照に接続する別タスク**として起票 (page_text ではない)。shop シミュレータのクリップボードヘッダー内社名も同様

### 5.6 pricing DB との整合

- グレード名 (下地仕上げ/スタンダード/プレミアム) は **PriceTable.grade.label が唯一の正**。service / shop の静的グレードカード表示を pricing DB 参照に切り替える (page_text 化しない)。contact.estimate.grade.body (B) 内のグレード名言及は注記で対応
- 価格・数量スライド率・オプション率を地の文に含むテキスト (shop.sec2.lead、shop.sec1.note、sim.footnote、contact.estimate.qty.body 等) は C/B 維持 — pricing DB と文言の乖離リスクが理由。v2 で「DB 値の埋め込みテンプレート化」を検討

### 5.7 同期警告つきスロット

admin UI にヘルプテキスト警告を付ける A スロット: `colors.hero.heading`(「8枚」= SWATCHES 件数) / `colors.hero.lead`(「8色中5色」)。B 以下でも将来編集時に同種警告が必要: stats の label↔実数、FAQ 納期↔特商法表記、craft/QC の番手数値

### 5.8 その他

- `home.cta.heading` と `service.cta.heading` は現在同一文言だが**別スロット** (ページごとの分岐余地を残す)。`notes.cta.*` のみ一覧/詳細で共有キー
- 等高グリッド (craft 3 列 / twoscenes 2 列 / stats / QC / flow) は maxLen 遵守で高さ崩れを予防。line-clamp の追加はしない (v1)
- 実装順: registry 定義 → 交差テスト → seed migration → 描画側フォールバック接続 → admin エディタ。§5.5 の hero ドリフト解消は独立タスクとして先行可