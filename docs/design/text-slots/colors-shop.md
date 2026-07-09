# テキスト棚卸し: colors-shop


## Tier A (22)

- `colors.head.heading` [heading/複数行/max34] 「名車の象徴色で組んだ、8枚の技術証明。」 — ページ最上部のH1。手動<br/>2行組のため文字数超過で改行バランスが崩れる。「8枚」はSWATCHES.lengthと手動同期が必要な点に注意
- `colors.head.lead` [lead/複数行/max260] 「見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれ…」 — H1直下のリード文(現行141字)。max-w-3xlの流し込みでclampなし文字数に寛容だが「8色中5色」はSWATCHES実データとの手動同期が必要
- `colors.cta.heading` [heading/複数行/max34] 「この8色以外も、色番号でご指定いただけます。」 — ページ末尾CTA帯の見出し。手動<br/>2行組でレイアウトに敏感
- `colors.cta.note` [lead/単行/max80] 「日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。」 — CTA見出し直下のコンバージョン訴求文
- `colors.cta.label` [cta/単行/max10] 「相談する」 — CTAボタン文言そのもの。shop.cta.labelと同一文言で全ページ共通CTAとして統一管理する余地あり
- `shop.head.heading` [heading/複数行/max26] 「仕上げを、通販のように買う。」 — ページ最上部H1。手動<br/>2行組でレイアウトに敏感
- `shop.head.lead` [lead/複数行/max280] 「受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのま…」 — H1直下のリード文(現行154字)。flow段落でclampなし比較的寛容
- `shop.sec1.title` [heading/複数行/max24] 「3つのグレードから、選ぶ。」 — セクションH2見出し。手動<br/>2行組
- `shop.sec1.lead` [lead/複数行/max260] 「下地はどのグレードも共通です。#800 で積層痕を研ぎ落とし、プラサフで微細な段差を埋め、#1200 で…」 — セクションリード文だが#800/#1200という研磨番手をfont-monoのインラインspanで埋め込む複合JSX。plain string化するとインライン装飾が失われるためrich-textか分割設計が必要
- `shop.grade.{n}.title` [heading/単行/max12] 「下地仕上げ / スタンダード / プレミアム (n=1..3)」 — 3グレード(サービス)の独自命名(3件)。工房が自ら決めた商品階層名でありマーケティング的に変更したくなる典型例。等高3列グリッドのためh3が長いとカード高さが崩れる
- `shop.grade.{n}.cta` [cta/単行/max16] 「サイズと個数で概算」 — 3カード共通のCTAリンク文言、#simシミュレータへの主要導線
- `shop.sec2.title` [heading/複数行/max30] 「サイズ × 個数 × グレード。3つ選べば、概算が出る。」 — セクションH2見出し、手動<br/>2行組
- `shop.sim.size_sub` [label/単行/max10] 「手のひらサイズ / 主戦場サイズ / 大きめの造形 / 個別見積もり (SIZE_SUB, 4件)」 — コード内コメントで明示的に「装飾用の補助テキスト(DBが持たないUIフレーバー)」とされる自由文言。工房の言葉遣いが出る典型例(例:「主戦場サイズ」)。ボタン下の小さな枠のため長文で折返しに注意
- `shop.sim.order_cta` [cta/単行/max18] 「この内容で注文・相談する」 — シミュレータの主要CVボタン、サイト全体で最重要CTAの一つ。固定高さボタンで矢印アイコン付き、2行折返しに注意
- `shop.sec3.title` [heading/複数行/max24] 「手に取れる製品も、ここに並びます。」 — セクションH2見出し、手動<br/>2行組
- `shop.sec3.lead` [lead/複数行/max200] 「工房で仕上げた「そのまま買える」製品の販売枠です。第一弾として、画面では絶対に伝わらない粒子感・深みを手元…」 — セクションリード文
- `shop.product.{n}.title` [heading/単行/max20] 「六角色見本パネル・8色セット / 六角色見本パネル・単色 / あなたの造形物・一点仕上げ (n=1..3)」 — 未来枠(COMING SOON)の商品名(3件)。現状は静的JSXで商売の言葉として編集価値が高いが、将来正式な商品DBへ移行する可能性あり
- `shop.sec4.title` [heading/単行/max20] 「注文から、お届けまで。」 — セクションH2見出し、<br/>なし単一行
- `shop.sec4.lead` [lead/複数行/max180] 「遠く離れた工房でも、安心して預けられるように。受入から発送まで、記録を残しながら進めます。オンライン決済が…」 — セクションリード文
- `shop.cta.heading` [heading/複数行/max26] 「概算が出たら、あとは送るだけ。」 — ページ末尾CTA帯の見出し、手動<br/>2行組
- `shop.cta.note` [lead/単行/max50] 「シミュレータの内容をコピーして、そのまま貼り付けてご相談ください。」 — CTA見出し直下のコンバージョン訴求文
- `shop.cta.label` [cta/単行/max10] 「相談する」 — CTAボタン文言。colors.cta.labelと同一文言、全ページ共通CTAとして統一管理する余地あり

## Tier B (18)

- `colors.hero.caption` [caption/単行/max30] 「名車の色は、塗る人の経験が発色させる。」 — 写真キャプション。sm以上でクレジットと横並びになるため長文は圧迫要因
- `colors.band.1.caption` [caption/単行/max28] 「黒の深さは、研ぎで決まる。」 — 写真キャプション、バンド写真共通パターン
- `colors.band.2.caption` [caption/単行/max28] 「光の映り込みが、平滑さを映す。」 — 写真キャプション
- `colors.band.3.caption` [caption/単行/max28] 「色は、面の上に成立する。」 — 写真キャプション
- `colors.swatch.{n}.name` [label/単行/max16] 「プレシャスホワイトパール (ddName, n=1..8同パターン)」 — スウォッチタグ表示用の色名短縮形(8件)。実車の正式カラー名でCSS変数(--dd-XXX-a/b)と1対1対応するため自由編集は色データとの不整合リスクあり
- `colors.swatch.{n}.title` [heading/単行/max22] 「プレシャスホワイトパール (title, n=1..8同パターン)」 — 各色エントリのH2見出し(8件)。見た目はセクション見出しだが実車の正式カラー名で商品仕様に近く、A(声)というよりB。将来は専用カラーカタログDBへの移行候補
- `colors.swatch.{n}.story` [body/複数行/max220] 「現に法人のプロダクト試作へ納品している、この工房の実績色であり原点。白の奥でパールが回る上品な光は、単な…」 — 各色の説明本文(8件、現行80〜140字)。流し込み段落でclampなし、比較的寛容な段落テキスト
- `shop.hero.caption` [caption/単行/max36] 「あなたが手にするのは、この深さ。自動車グレードの艶を、造形物に。」 — 写真キャプション、sm以上でクレジットと横並び
- `shop.grade.{n}.description` [body/複数行/max200] 「積層痕を消し、プラサフまで入れた「塗る直前」の状態で納品します。縞は跡形もなく消え、面はなめらか。ここ…」 — グレード説明本文(3件、現行90〜100字程度)
- `shop.grade.{n}.persona_text` [body/複数行/max140] 「最終色をご自身で吹く造形作家・ガレージキット層・試作会社。「下地だけ、プロにやってほしい」という方へ。」 — 想定顧客像の説明文(3件)
- `shop.sec1.link_colors` [cta/単行/max20] 「8色の色見本を一枚ずつ見る」 — 注記段落内のインラインリンク文言。プレーンテキストとLinkが混在するJSXで単純文字列スロット化が難しい
- `shop.sec1.link_service` [cta/単行/max18] 「工程と品質管理の詳細」 — 同注記段落内のインラインリンク文言
- `shop.sim.copied_success` [label/単行/max36] 「内容をコピーしました。相談ページへ移動します…」 — クリップボードコピー成功時のフィードバック文言、口調変更の余地あり
- `shop.sim.copied_fallback` [label/単行/max24] 「相談ページへ移動します…」 — クリップボード非対応/失敗時のフォールバック文言(2箇所で同一文字列)
- `shop.product.{n}.description` [body/複数行/max160] 「8色の参考色を、実物の塗り板で。画面では絶対に伝わらない、パールの粒子感と深みを手元で確認できるセットで…」 — 商品説明本文(3件)
- `shop.buyflow.{n}.title` [heading/単行/max14] 「注文・相談 / 正式見積もり・お支払い / 発送 → 施工 / 硬化・検品 → お届け (n=1..4)」 — 4カラム等高グリッドのステップ見出し(4件)。工程名という構造的要素の色が強くB、長文はカード高さを崩す
- `shop.buyflow.{n}.body` [body/複数行/max150] 「上のシミュレータで概算を出し、内容をコピーして相談ページからご連絡ください。造形データ（STL/STEP）や…」 — 各ステップの説明本文(4件、現行80〜100字程度)
- `shop.buyflow.{n}.meta` [label/単行/max40] 「必要なもの — 造形物 or データ・希望グレード・色 (n=1..4)」 — 接頭ラベル(必要なもの/支払い/記録/品質)+<strong>強調テキストの複合JSX(4件)。プレーンテキストと太字が混在し単純文字列スロット化が難しく、page_text設計では複合フィールドが必要

## Tier C (66)

- `colors.head.index` [label/単行/max30] 「INDEX 07 — COLORS」 — SEC.01/INDEX系の意匠ラベル、tier C例示に直接合致する構造上の飾り文字
- `colors.head.en` [label/単行/max40] 「8 SWATCHES / 5 ARE 3-COAT」 — 英語装飾サブラベル。色数(5/8)というSWATCHES件数と連動した事実を含み自由編集不可
- `colors.hero.fig_no` [label/単行/max24] 「FIG.00 — COLOR」 — 写真番号の意匠ラベル、SEC.01と同系統の構造上の文字
- `colors.hero.caption_en` [caption/単行/max36] 「COLOR AS PROOF OF SKILL」 — キャプション併記の英語装飾サブテキスト
- `colors.hero.credit` [caption/単行/max40] 「Photo: aaronburden / Unsplash」 — 画像クレジット。colors.hero画像スロットと1対1で紐づきpage_media管轄が妥当
- `colors.band.1.fig_no` [label/単行/max16] 「FIG.01」 — 写真番号の意匠ラベル
- `colors.band.1.caption_en` [caption/単行/max30] 「DEPTH OF BLACK」 — 英語装飾サブキャプション
- `colors.band.1.credit` [caption/単行/max40] 「Photo: cmreflections / Unsplash」 — 画像クレジット、page_media管轄が妥当
- `colors.band.2.fig_no` [label/単行/max16] 「FIG.02」 — 写真番号の意匠ラベル
- `colors.band.2.caption_en` [caption/単行/max30] 「REFLECTION」 — 英語装飾サブキャプション
- `colors.band.2.credit` [caption/単行/max40] 「Photo: avenir_visuals / Unsplash」 — 画像クレジット
- `colors.band.3.fig_no` [label/単行/max16] 「FIG.03」 — 写真番号の意匠ラベル
- `colors.band.3.caption_en` [caption/単行/max30] 「ON THE SURFACE」 — 英語装飾サブキャプション
- `colors.band.3.credit` [caption/単行/max40] 「Photo: apryan_cahyo / Unsplash」 — 画像クレジット
- `colors.swatch.{n}.ddno` [label/単行/max24] 「DRAWDOWN 01 / 8 (SWATCHES配列, n=1..8同パターン)」 — 色見本エントリの意匠番号ラベル(8件)、英語+連番の構造上の文字
- `colors.swatch.{n}.index` [label/単行/max16] 「SWATCH 01 (n=1..8同パターン)」 — 色見本エントリの意匠番号ラベル(8件)、SEC.01と同系統
- `colors.swatch.{n}.en` [label/単行/max50] 「TOYOTA 090 — PRECIOUS WHITE PEARL (n=1..8同パターン)」 — メーカー型式コード+英語名(8件)、技術仕様値/装飾英語ラベル
- `colors.swatch.{n}.specs` [label/単行/max14] 「3コートパール / ベース＋パール＋クリア / 実績納品色 (可変1〜3個, n=1..8)」 — 各色1〜3個の技術仕様バッジ(8件×可変個数)。コート数・難易度という工程事実を表し、価格同様DB管轄が妥当
- `colors.swatches.note` [body/複数行/max260] 「※ 画面上の色はイメージです。日塗工番号・自動車カラーコードでの色番号指定に対応します。純正色のピタリ合わ…」 — 実車再現・純正色一致を否定する免責文言。商標/知財リスク回避に近い性質で法的文言に準じ編集不可とする
- `shop.head.index` [label/単行/max30] 「INDEX 09 — SHOP」 — 意匠インデックスラベル
- `shop.head.en` [label/単行/max36] 「ORDER FINISHING ONLINE」 — 英語装飾サブラベル
- `shop.hero.fig_no` [label/単行/max32] 「FIG.00 — WHAT YOU BUY」 — 写真番号の意匠ラベル
- `shop.hero.caption_en` [caption/単行/max44] 「AUTOMOTIVE-GRADE FINISH, DELIVERED」 — 英語装飾サブキャプション
- `shop.hero.credit` [caption/単行/max40] 「Photo: cmreflections / Unsplash」 — 画像クレジット、page_media管轄が妥当
- `shop.sec1.no` [label/単行/max12] 「SEC. 01」 — セクション連番
- `shop.sec1.label` [label/単行/max36] 「FINISHING SERVICES — 受託仕上げ」 — 英日混在の意匠セクションラベル、SEC.01系
- `shop.grade.{n}.badge` [label/単行/max16] 「GRADE 01 / GRADE 02 / GRADE 03 — 最上位 (n=1..3)」 — 写真左上absolute配置バッジ(3件)、文字数超過でバッジ枠からはみ出す
- `shop.grade.{n}.eyebrow` [label/単行/max20] 「SERVICE 01 / SERVICE 03 — 最上位 (n=1..3)」 — サービス番号の意匠ラベル(3件)
- `shop.grade.{n}.subtitle_en` [label/単行/max30] 「PRIMER-READY FINISH / SOLID COLOR + 2K CLEAR / 3-COAT PEARL 」 — 英語装飾サブタイトル(3件)
- `shop.grade.{n}.spec_badges` [label/単行/max14] 「研磨 #800 / 水研ぎ #1200 / 塗装 なし (各グレード3個, n=1..3)」 — グレードごと3個の技術仕様バッジ、研磨番手・層数などの事実値でDB管轄が妥当
- `shop.grade.{n}.process_list` [body/複数行/max40] 「・#800 による積層痕の面研ぎ / ・プラサフ（下塗り・中塗り）で段差を充填 / ・#1200 水研ぎで塗装可能面に 」 — 「含まれる工程」の箇条書き(2カード×3行)、研磨番手・工程名という技術事実そのもの
- `shop.grade.{n}.included_label` [label/単行/max10] 「含まれる工程 (grade1,2で同一)」 — 複数カードで一字一句同一のUI小見出し、商売の言葉というよりインターフェース慣用句
- `shop.grade.{n}.persona_label` [label/単行/max10] 「こんな方に (3カードで同一)」 — 3カード共通の同一UI小見出し
- `shop.grade.{n}.price` [label/単行/max20] 「¥7,000〜 / 1点あたり・サイズ別目安・税込 (n=1..3)」 — 価格そのもの、tier C定義の「価格・数値はDB/pricingの領分」に直接該当。priceTable(DB)とは別にハードコードされておりデータ乖離リスクあり
- `shop.grade.3.colors_label` [label/単行/max16] 「選べる参考色（8色）」 — 「8色」がSWATCHES件数と連動する事実を含む、プレミアムカード専用1件
- `shop.sec1.note` [body/複数行/max260] 「※ 価格は「サイズ帯別の基本料金＋グレード」で決まる立ち上げ期の目安です。上記は最小サイズ（〜100mm）…」 — 価格算定方針そのものの説明文で価格ドメインに直結、DB/pricing管轄
- `shop.sec2.no` [label/単行/max12] 「SEC. 02」 — セクション連番
- `shop.sec2.label` [label/単行/max30] 「ESTIMATE SIMULATOR」 — 英語装飾セクションラベル
- `shop.sec2.lead` [lead/複数行/max220] 「数量スライド（10個以上 −15% / 30個以上 −25%）と特急（＋50%）も反映した概算レンジを、その場…」 — 見た目はセクションリード文だが数量値引き率(−15%/−25%/＋50%)というPriceTable(quantity_tiers/options)由来の数値を地の文に埋め込む。自由編集すると実際のDB価格設定とズレるリスクが高くAではなくCと判定
- `shop.sim.group_label.grade` [label/単行/max20] 「GRADE — グレード」 — 英日混在フォームグループラベル
- `shop.sim.group_label.size` [label/単行/max24] 「SIZE — 最長辺の目安」 — 英日混在フォームグループラベル
- `shop.sim.group_label.quantity` [label/単行/max26] 「QUANTITY — 個数（同一品）」 — 英日混在フォームグループラベル
- `shop.sim.option_suffix` [label/単行/max14] 「（＋50%）を希望する」 — オプションチェックボックスの固定サフィックス、DB由来のoption.labelとテンプレート結合される
- `shop.sim.result_label` [label/単行/max36] 「ESTIMATED TOTAL — 概算合計（税込・目安）」 — 結果パネルの英日混在ラベル
- `shop.sim.quote_only_text` [label/単行/max12] 「個別見積もり」 — quote_only状態のフォールバック表示、価格フロー制御と直結
- `shop.sim.quote_only_message` [body/単行/max60] 「◯◯mmを超える造形は、形状を確認のうえ個別にお見積もりします / この帯の造形は、形状を確認のうえ個別に…」 — DB由来のmax_mmを埋め込むテンプレート文言(2バリアント)、価格フロー制御に直結
- `shop.sim.summary_labels` [label/単行/max10] 「グレード / サイズ帯 / 個数 / 数量スライド」 — 概算結果パネルの項目ラベル(4件)、価格テーブルの行見出し
- `shop.sim.tier_fallback` [label/単行/max20] 「適用なし（10個以上 −15%） / 適用なし」 — 数量値引き未適用時の表示、DB由来のtier.labelとテンプレート結合
- `shop.sim.footnote` [body/複数行/max200] 「※ 立ち上げ期の概算目安です。形状の複雑さ・素材・色により変動します。初回のみ治具・段取り費を別途（リピー…」 — 見積り条件の免責文言、価格ドメインに直結
- `shop.sim.empty_state` [label/単行/max24] 「価格はお問い合わせください。」 — PriceTable未取得時のエラー状態表示、価格ドメイン
- `shop.sim.clipboard_header` [label/単行/max30] 「【隈部塗装 SHOP — 注文・相談内容】」 — クリップボードコピー文の見出し。社名「隈部塗装」がハードコードされておりsite_settingsの会社名と重複(db_backed_texts参照)
- `shop.sim.clipboard_labels` [label/単行/max10] 「グレード: / サイズ帯: / 個数: / オプション: / 概算: (5件)」 — クリップボード本文の項目ラベル、構造的テンプレート文言
- `shop.sim.clipboard_footer` [body/単行/max60] 「※ 上記はシミュレータの目安です。素材・色・形状を添えてご相談ください。」 — クリップボード本文末尾の免責文言
- `shop.sim.swatch_tooltip` [label/単行/max16] 「プレシャスホワイトパール 等 (SWATCH_TITLES, title属性, 8件)」 — MiniSwatchのtitle属性(ネイティブツールチップ)用の色名複製データ。colors.swatch.{n}.nameと重複するカタログデータで将来は共通カラーカタログへ一元化すべき
- `shop.sec3.no` [label/単行/max12] 「SEC. 03」 — セクション連番
- `shop.sec3.label` [label/単行/max30] 「READY-MADE — 塗装済み製品」 — 英日混在セクションラベル
- `shop.product.{n}.badge` [label/単行/max14] 「COMING SOON / COMING SOON / 受注制作 (n=1..3)」 — 商品カードのステータスバッジ(3件)。将来は在庫/販売状態のDBフラグに連動すべき性質でフリーテキスト化は非推奨
- `shop.product.{n}.sku` [label/単行/max16] 「HEX-SET-08 / HEX-01 / CUSTOM-01 (n=1..3)」 — 商品コード(SKU相当)、構造上の識別子で自由編集不可
- `shop.product.{n}.specs` [label/単行/max20] 「形状: 対辺70mm 六角形 × 8枚 / 仕様: 裏面にカラーコード刻印 / 用途: 色決め・貸出プラン準備中 (3件」 — 商品仕様表のラベル・値ペア、寸法・数量などの技術仕様値そのもの
- `shop.product.{n}.price` [label/単行/max20] 「価格未定 / 準備中、¥7,000〜 / シミュレータで概算 (n=1..3)」 — 価格表示そのもの、DB/pricing領分
- `shop.product.{n}.placeholder_note` [label/単行/max26] 「8-COLOR SET — IMAGE / SINGLE PANEL — IMAGE / YOUR OBJECT HER」 — 画像未設定時のみ表示される装飾プレースホルダ(3件)。実写真アップロード後は非表示になるためpage_mediaのplaceholder管轄が妥当
- `shop.sec3.note` [body/複数行/max160] 「※ 製品ビジュアルは現在イメージ（塗り板の色をCSSで再現したもの）です。実物の写真・価格・在庫は、販売開…」 — 画像がCSS再現である旨の注記+価格/在庫の告知、価格・在庫ドメインに直結
- `shop.sec4.no` [label/単行/max12] 「SEC. 04」 — セクション連番
- `shop.sec4.label` [label/単行/max20] 「HOW TO ORDER」 — 英語装飾セクションラベル
- `shop.buyflow.{n}.no` [label/単行/max10] 「STEP 01 〜 STEP 04 (n=1..4)」 — 工程連番ラベル
- `shop.sec4.legal_note` [body/複数行/max180] 「お支払い方法・時期、送料、返品条件などの取引条件は特定商取引法に基づく表記を、よくある質問は相談ページの…」 — 特定商取引法に基づく表記への参照を含む取引条件の説明文。tier C「法的文言(特商法/プライバシー)」に直接該当、内包する2件のリンクラベルも含め編集不可とする

## DB 由来 (スロット化しない)
- PriceTable由来の grade.label / grade.description / size.label / option.label (shop-simulator.tsx が @/modules/pricing/contracts の PriceTable を通じて参照) — 既にpricingモジュールのDBで編集可能なため page_text 化不要
- shop-simulator.tsx のクリップボードヘッダー文字列に含まれる社名「隈部塗装」— site_settings の会社名テキストと重複しうるハードコードで、page_text 化ではなく site_settings 参照への統一を design 側で検討すべき

## レイアウトリスク
- PageHead / SecTitle / CtaBand.title は clamp(...)フォントサイズ + JSX内の手動<br/>で2行に固定改行しているため、文字数が増えると改行位置が崩れ2行目が極端に短く/長くなる。差し替えUIは改行位置ごと編集できる設計か、改行なし版に統一するかの判断が必要
- PhotoFigure の figcaption は sm ブレークポイント以上で capJa と credit(クレジット表記)が横並びになるため、capJa が長いと credit が右端に押し出され窮屈になる。capJa は現行15〜20字程度に対し max_len 28〜36字を推奨
- SHOPのグレード/商品カード見出し(h3)は lg:grid-cols-3 等の等高カードのため、1枚だけ長い見出しがあると折返してカード全体の高さバランスが崩れる。max_len は現行5〜14字程度に近い短さを推奨
- GRADE 0X / COMING SOON / 受注制作などの absolute 配置バッジは写真左上の小さな固定パディング枠に収まる前提。長文に差し替えるとバッジ枠からテキストがはみ出す、または画像に重なる
- ShopSimulator の注文CTAボタン(この内容で注文・相談する)は固定高さ(py-3.5)の1行ボタンで末尾に矢印アイコンが続く。文字数が増えると2行折返しして矢印の位置が崩れる
- colors ページの SWATCHES 配列由来テキスト(ddName/title/en/specs)はCSSカスタムプロパティ(--dd-XXX-a/b)や実車の型式コードと1対1で対応しており、テキストだけを自由編集すると実際の色データと矛盾する。page_text より専用カラーカタログテーブルでの管理が望ましい
- SEC.02(見積もりシミュレータ)のSecLead、および買い方注記(shop.sec1.note / shop.sim.footnote)は数量値引き率や価格算定方針など、実際はPriceTable(pricing DB)が正とする数値の説明文である。page_textとして自由編集可能にすると、DB側の実際の割引率・価格ロジックと表示文言が乖離するリスクが高い