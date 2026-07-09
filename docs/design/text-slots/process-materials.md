# テキスト棚卸し: process-materials


## Tier A (20)

- `process.hero.heading` [heading/複数行/max24] 「一個が仕上がるまでの、9つの手。」 — ページ冒頭H1、サイトの声の中核でオーナーが最も変更したい文言
- `process.hero.lead` [lead/複数行/max150] 「3Dプリントの造形物が、量産品と見分けがつかない外観になるまでには、決まった順序があり…」 — PageHead直下のリード文そのもの、ヒーロー見出しを補強する声
- `process.coating.heading` [heading/複数行/max18] 「塗装は、層でできている。」 — SEC.01セクション見出し、キャッチコピー性の高い日本語文言
- `process.steps.heading` [heading/複数行/max22] 「受け取ってから、送り出すまで。」 — SEC.02セクション見出し
- `process.booth.heading` [heading/複数行/max28] 「きれいな空気でしか、きれいには塗れない。」 — SEC.03セクション見出し、キャッチコピー性の高い文言
- `process.related.heading` [heading/単行/max16] 「工程の、その先へ。」 — SEC.04セクション見出し、短いキャッチフレーズ
- `process.gallery.heading` [heading/単行/max18] 「工程を、支えるもの。」 — GALLERYセクション見出し
- `process.cta.heading` [heading/複数行/max22] 「この9工程を、あなたの一個に。」 — ページ末尾CTA見出し、転換に直結する声
- `process.cta.note` [body/複数行/max60] 「サイズ・個数・グレードが分かれば、概算をお出しできます。まずはご相談ください。」 — CTA補助文言、商売の言葉として変更需要が高い
- `process.cta.label` [cta/単行/max8] 「相談する」 — CTAボタン文言そのもの
- `materials.hero.heading` [heading/複数行/max32] 「素材を選ばない。ただし、素材ごとに手を変える。」 — ページ冒頭H1、サイトの声の中核
- `materials.hero.lead` [lead/複数行/max170] 「3Dプリントは、造形方式によって積層痕の出方も、塗料の乗り方も、まったく違います。FDM…」 — PageHead直下のリード文
- `materials.methods.heading` [heading/複数行/max24] 「3つの造形方式、それぞれの下地。」 — SEC.01セクション見出し
- `materials.matrix.heading` [heading/単行/max18] 「素材別の、対応と勘所。」 — SEC.02セクション見出し
- `materials.why.heading` [heading/複数行/max26] 「失敗の多くは、塗る前に決まっている。」 — SEC.03セクション見出し、キャッチコピー性の高い文言
- `materials.intake.heading` [heading/単行/max20] 「造形から、任せてもいい。」 — SEC.04セクション見出し
- `materials.gallery.heading` [heading/単行/max14] 「素材の、その先。」 — GALLERYセクション見出し
- `materials.cta.heading` [heading/複数行/max34] 「素材が決まっていなくても、用途から相談できます。」 — ページ末尾CTA見出し、転換に直結する声
- `materials.cta.note` [body/複数行/max60] 「「屋外で使う」「撮影用」「触れる展示物」——用途に合う素材と仕上げをご提案します。」 — CTA補助文言、商売の言葉として変更需要が高い
- `materials.cta.label` [cta/単行/max8] 「相談する」 — CTAボタン文言そのもの

## Tier B (7)

- `process.hero.kicker` [label/単行/max26] 「PROCESS — 塗りが仕上がるまで」 — H1直上の極小mono kickerタグで日本語コピーを含むが、装飾的な位置づけのためA優先度ではない
- `process.coating.lead` [body/複数行/max140] 「仕上がった塗面は一枚に見えますが、実際は役割の違う層の積み重ねです。下から順に、造形物…」 — SecLead段落の代表例(本ページに同パターン計4箇所: SEC.01/03/04/GALLERY、加えてMapNote注記2箇所も同様の低頻度編集対象)
- `process.steps.item.desc` [body/複数行/max140] 「届いた造形物を確認します。造形方式と素材、積層痕の状態、欠けや反りの有無を見ます。初め…」 — STEPS配列(9件、STEP01-09)のdesc代表例。姉妹フィールドtitle(見出し、最長13字)は同tier B、why(strong強調混在)はtier C相当
- `process.related.button.label` [cta/単行/max10] 「サービス・料金 / 素材対応 / 色見本」 — 内部導線ArrowButtonラベル3件の代表例。CTAほどの訴求力は無いが表記変更需要はあり得る
- `materials.matrix.lead` [body/複数行/max110] 「代表的な樹脂ごとの下地処理・注意点・耐候性の目安です。ここに無い素材も、テストピースで…」 — SecLead段落の代表例(本ページに同パターン計4箇所: SEC.02/03/04/GALLERY、加えてMapNote注記2箇所も同様の低頻度編集対象)
- `materials.methods.item.desc` [body/複数行/max120] 「熱で溶かした樹脂を層状に積み上げる方式。3方式の中で積層痕が最も目立ち、研磨とサーフ…」 — METHODS配列(3件)のdesc代表例。姉妹フィールドtitle(FDM/SLA/SLS等の業界標準技術名)とdiff(strong+font-mono混在の複合JSX)はtier C
- `materials.why.cause.title` [heading/単行/max16] 「洗浄・脱脂の不足」 — CAUSES配列(3件)のタイムライン見出し代表例、bodyフィールド(説明段落)も同tier

## Tier C (5)

- `process.diagram.svg_label` [caption/単行/max30] 「3D PRINT — 積層痕 (layer lines)」 — CoatDiagram内SVGテキスト(6ノード+aria-label)とCOAT_LEGEND凡例(4件)の代表例、絶対座標配置と技術用語固定のため編集不可
- `process.photo.caption` [caption/単行/max8] 「下地をつくる / 色を吹く / 仕上がり / 設備 / 精度 / 質感」 — PhotoFigure capJa(6件)の代表例。capEn/creditはUnsplash帰属表示で常にtier C固定、SEC.03の数値キャプション(5ミクロン等)も同様に技術仕様領域
- `materials.hero.kicker` [label/単行/max26] 「INDEX 06 — MATERIALS」 — 純粋な英語装飾インデックスラベル(SEC.01/INDEX意匠と同型)
- `materials.matrix.row.point` [body/複数行/max80] 「アセトンは効かないため、研磨とスプレーパテで物理的に平滑化。サーフェイサーで密着を確保…」 — MATERIALS対応表(8行)のpoint代表例、アセトン/IPA等の化学的技術情報で誤編集が実害につながるため編集不可。列見出し4件(素材/造形方式/下地の勘所/耐候性の目安)も同様に構造上tier C
- `materials.intake.format.label` [label/単行/max12] 「STL / 汎用フォーマット」 — STL/STEPカードの代表例、技術フォーマット名は意味固定のため編集不可(descフィールドはtier B相当)

## DB 由来 (スロット化しない)


## レイアウトリスク
- 見出し(*.heading)の多くは JSX 内で明示的な <br/> による2行固定レイアウト(例: process.hero.heading, process.coating.heading, process.steps.heading, process.booth.heading, process.cta.heading, materials.hero.heading, materials.methods.heading, materials.why.heading, materials.cta.heading)。文字数が増えると改行位置がずれ、text-[clamp(26px,3.6vw,44px)]〜clamp(30px,5vw,56px) の大型フォントで行間バランスが崩れる/はみ出す恐れがあるため、行ごとの文字数上限を厳守する必要がある。
- STEPS配列(process)の desc フィールドのうち STEP02・STEP06 は文中に <span className="font-mono">#800</span>/<span className="font-mono">#1200</span> という技術値を埋め込んだ複合JSXで、プレーン文字列スロットに変換すると等幅フォント強調の書式が失われる。
- STEPS(why)・METHODS(diff)フィールドは <strong>タグによる部分強調を複数箇所含む複合JSXで、単一プレーンテキストスロットに変換すると強調位置が保持できない。リッチテキスト対応が無い限りv1では編集対象外にすべき(tier C)。
- process の CoatDiagram は全テキストがSVG内の絶対座標(x/y)で配置されており、文字数が変わると図形バーからはみ出す・重なる。編集不可(tier C)を厳守すべき最重要箇所。
- PhotoFigure の capEn・credit(例: "Photo: mazinomron / Unsplash")はUnsplash写真クレジットの帰属表示であり、法的に文言固定が必要。capJaのみtier B候補とし、capEn/creditは常にtier C固定にする設計が必須。
- materials の素材別対応表は `overflow-x-auto` + `min-w-[720px]` の横スクロールテーブルで8行×4列。point列が長文化すると行高が不揃いになり、他行との視覚的バランスが崩れやすい。
- ArrowButton(h-10)・CtaBandのボタン(h-12)は固定高さのボタンで、ラベル文言が長くなると折り返し/オーバーフローを起こす(process.related.button.label は最長でも7文字を想定した設計)。
- materials.intake.format.label(STL/STEPカード)は `font-mono text-2xl` の大きな等幅表示で、技術フォーマット名自体が意味を持つため文言変更は形式的な誤りを生む恐れがある。