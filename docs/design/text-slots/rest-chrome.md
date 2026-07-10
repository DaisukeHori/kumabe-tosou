# テキスト棚卸し: rest-chrome


## Tier A (18)

- `notes.hero.heading` [heading/複数行/max34] 「なぜ綺麗なのかは、写真だけでは伝わらない。」 — ページの顔となるh1見出し、オーナーが変えたい商売の言葉の代表格
- `notes.hero.lead` [lead/単行/max120] 「工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。」 — ヒーロー直下のリード文、工房の姿勢を語る「声」
- `notes.cta.heading` [heading/複数行/max32] 「読んで気になったことは、そのまま聞いてください。」 — ページ末尾CTA帯の見出し。notes/[slug]/page-body.tsxでも一字一句同一文言が使われており共有キー化を推奨
- `notes.cta.note` [body/単行/max40] 「工程・色・素材の相性、どんな質問でも。」 — CTA帯の補足コピー。notes/[slug]でも同一文言、共有キー推奨
- `notes.cta.label` [cta/単行/max8] 「相談する」 — サイト最重要のコンバージョンCTA文言。site-header(デスクトップ/モバイル)・footer・各ページCtaBandで繰り返し使われる中核ボタン、単一ソース化を強く推奨
- `contact.hero.heading` [heading/複数行/max20] 「見積もりは、3つの数字で。」 — 問い合わせページのh1見出し、ページの価値提案そのもの
- `contact.hero.lead` [lead/単行/max140] 「「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけ」 — ヒーロー直下のリード文、見積もりの考え方を語る声
- `contact.estimate.size.heading` [heading/単行/max8] 「サイズ」 — 3変数カードの短い見出し語、料金思想を伝える中核コピー
- `contact.estimate.qty.heading` [heading/単行/max8] 「個数」 — 3変数カードの短い見出し語
- `contact.estimate.grade.heading` [heading/単行/max10] 「グレード」 — 3変数カードの短い見出し語
- `contact.form.heading` [heading/単行/max16] 「お問い合わせフォーム」 — セクション見出しの日本語文言
- `contact.form.lead` [lead/単行/max70] 「下記フォームからお問い合わせいただけます。内容を確認のうえ、担当より折り返しご連絡いたします。」 — セクション見出しに続くリード文
- `contact.beforeAsk.heading` [heading/単行/max14] 「ご相談の前に。」 — セクション見出しの日本語文言
- `contact.beforeAsk.lead` [lead/単行/max130] 「工程・グレード・数量スライドの詳細はサービスページに、対応色の考え方は色見本ページにまとめています。「できないこと」も先」 — 工房の姿勢(正直さ)を語るリード文、声としての価値が高い
- `contact.faq.heading` [heading/単行/max14] 「よくあるご質問」 — セクション見出しの日本語文言
- `chrome.nav.cta.label` [cta/単行/max8] 「相談する」 — サイト最重要のコンバージョンCTA。同一ファイル内でデスクトップボタン・モバイルSheetボタンの2箇所に別々のリテラルとして存在し、さらにnotes等のCtaBand・footerとも同一文言。単一ソース化を強く推奨
- `chrome.footer.tagline` [body/単行/max80] 「3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします」 — 全ページ共通フッターに常時表示される事業紹介コピー。社名に次ぐ露出量の高い会社説明文で「声」としての価値が高い。max-w-smでの折返し前提
- `chrome.footer.nav.contact.label` [cta/単行/max8] 「相談する」 — footerでは通常のnavリスト項目として表示されるが、chrome.nav.cta.label/notes.cta.labelと同一のコアCTA文言。単一ソース化推奨

## Tier B (48)

- `notes.articles.empty.body` [body/単行/max70] 「読みものは現在準備中です。工程・色の裏側を、順次言葉にして公開していきます。」 — 記事0件時のみ表示される説明文、変更頻度は低い
- `notes.comingSoon.body` [body/複数行/max150] 「今後、デモピースの製作記録や案件の実績（掲載許諾をいただいたもの）を、ここで発信していきます。note・X・Instag」 — 準備中告知の説明文、border box内でtext-center・自動可変高のためレイアウトリスクは比較的低い
- `notes-detail.backButton` [cta/単行/max14] 「読みもの一覧に戻る」 — 一覧に戻る導線ボタン、ArrowButton内で矢印アイコンと並ぶため長文化に弱い機能的ボタン
- `contact.hero.photo.capJa` [caption/単行/max28] 「あなたの「絶対に外せない一個」を、この艶に。」 — figcaptionのキャプション。文体はキャッチコピー寄りだが構造上はcaption役割のためtier B。capEnとsm:flex-rowで同一行に並ぶため長文化注意
- `contact.estimate.size.body` [body/単行/max120] 「最長辺のおおよその寸法をお知らせください。主戦場は手のひら〜200×200mm級。大型は個別見積もり（送料実費）で対応し」 — 説明文。200×200mm等の目安寸法を含むため編集時はサービス/SHOPページ等との整合に注意
- `contact.estimate.qty.body` [body/単行/max100] 「1点から1,000個まで。同一品は10個以上で−15%、30個以上で−25%（目安）の数量スライドが効きます。」 — 数量スライド率を含む説明文。pricing設定と密接なため編集時はservice/shopページとの整合に注意
- `contact.estimate.grade.body` [body/単行/max100] 「下地仕上げ / スタンダード / プレミアム（3コートパール）の3択。迷ったら用途をお聞かせください。ご提案します。」 — グレード名(下地仕上げ/スタンダード/プレミアム)はSHOPページのshop.grade.1-3ラベルやserviceページのグレード表記と一致させる必要があり、単独編集は不整合リスクあり
- `contact.estimate.mapNote` [body/単行/max160] 「※ あわせて伝えていただけると正確になる情報 — 造形方式（FDM / 光造形など）、素材の種類、希望色（カラーコード可」 — 補足事項の注記文、変更頻度は低い
- `contact.beforeAsk.linkService` [cta/単行/max12] 「サービス・料金」 — リンクボタン文言。header nav「サービス・料金」と表記を一致させる必要あり(chrome.nav.service.labelと重複)
- `contact.beforeAsk.linkColors` [cta/単行/max10] 「色見本」 — リンクボタン文言。header nav「色見本」と重複(chrome.nav.colors.label)
- `contact.faq.item1.q` [label/単行/max40] 「造形データだけでも頼めますか？」 — FAQ質問文、summary行がflex items-baselineでQ番号と1行前提のため長文で折返しに注意
- `contact.faq.item1.a` [body/単行/max300] 「はい。データ入稿 → 提携出力 → 工房直送の流れに対応しています。造形から仕上げまで一括でお受けできる...」 — details展開時のみ表示される回答文、幅制限がゆるくレイアウトリスクは低い
- `contact.faq.item2.q` [label/単行/max40] 「色は完全に純正色と同じにできますか？」 — FAQ質問文
- `contact.faq.item2.a` [body/単行/max300] 「純正色のピタリ合わせ（調色）は対象外です。市販の調色済み補修塗料を正規の用途で使い...」 — details展開時のみ表示される回答文
- `contact.faq.item3.q` [label/単行/max40] 「どのくらいの納期ですか？」 — FAQ質問文
- `contact.faq.item3.a` [body/単行/max300] 「2液ウレタンの完全硬化に5〜7日かかり、硬化を確認してから発送します。工程日数を加えた目安は個別にお出しします...」 — 納期日数(5〜7日)・特急仕上げ(+50%)の数値がtokushoho特商法表記(サービスの提供時期)と重複しており、編集時は両ページの整合に注意
- `contact.faq.item4.q` [label/単行/max40] 「初めての素材でも塗ってもらえますか？」 — FAQ質問文
- `contact.faq.item4.a` [body/単行/max300] 「経験のない樹脂素材は、いきなり本番にはせず、テストピースで相性を確認してから進めます...」 — details展開時のみ表示される回答文
- `contact.faq.item5.q` [label/単行/max40] 「秘密保持（NDA）に対応できますか？」 — FAQ質問文
- `contact.faq.item5.a` [body/単行/max300] 「対応可能です。進行中の写真は守秘義務の範囲で管理し、実績としての掲載は案件ごとに許諾をいただいてから...」 — details展開時のみ表示される回答文
- `contact.form.status.body` [body/単行/max60] 「必要事項をご入力のうえ送信してください。内容を確認し、担当より折り返しご連絡いたします。」 — フォーム冒頭の案内文
- `contact.form.inquiryTypeOptions.construction` [label/単行/max14] 「施工依頼」 — 問い合わせ種別の選択肢。SelectTriggerがsm:w-64固定幅のため長文化に弱い
- `contact.form.inquiryTypeOptions.estimate` [label/単行/max14] 「見積もり相談」 — 問い合わせ種別の選択肢
- `contact.form.inquiryTypeOptions.material` [label/単行/max14] 「材料に関する質問」 — 問い合わせ種別の選択肢
- `contact.form.inquiryTypeOptions.other` [label/単行/max14] 「その他」 — 問い合わせ種別の選択肢
- `contact.form.submitCta` [cta/単行/max10] 「送信する」 — フォーム送信ボタン。機能的UIコピーで「声」としての価値は低い
- `contact.form.success.body` [body/単行/max50] 「お問い合わせを受け付けました。内容を確認のうえ、ご連絡いたします。」 — 送信完了メッセージ
- `contact.form.success.resetCta` [cta/単行/max14] 「もう一度入力する」 — フォームリセットの機能ボタン
- `chrome.nav.story.label` [label/単行/max8] 「ストーリー」 — ヘッダー主要ナビ(NAV_ITEMS、デスクトップ/モバイル共通)。1行水平バーに9項目+CTAが並ぶため長文化に弱い。footerのchrome.footer.nav.story.labelと同一文言で重複
- `chrome.nav.about.label` [label/単行/max8] 「会社案内」 — ヘッダー主要ナビ。footerと重複
- `chrome.nav.service.label` [label/単行/max10] 「サービス・料金」 — ヘッダー主要ナビ。contact.beforeAsk.linkService・footerと重複
- `chrome.nav.works.label` [label/単行/max8] 「施工事例」 — ヘッダー主要ナビ。footerと重複
- `chrome.nav.voices.label` [label/単行/max8] 「お客様の声」 — ヘッダー主要ナビ。footerと重複
- `chrome.nav.materials.label` [label/単行/max8] 「素材対応」 — ヘッダー主要ナビ。footerと重複
- `chrome.nav.colors.label` [label/単行/max6] 「色見本」 — ヘッダー主要ナビ。contact.beforeAsk.linkColors・footerと重複
- `chrome.nav.notes.label` [label/単行/max8] 「読みもの」 — ヘッダー主要ナビ。footerと重複
- `chrome.nav.shop.label` [label/単行/max8] 「SHOP」 — ヘッダー主要ナビ。footerと重複
- `chrome.footer.nav.home.label` [label/単行/max6] 「ホーム」 — footer専用の追加ナビ項目(headerのNAV_ITEMSには無い)。grid-cols-2の2列リストで長文は折返し時に番号バッジとズレる
- `chrome.footer.nav.story.label` [label/単行/max8] 「ストーリー」 — chrome.nav.story.labelと同一文言の重複、将来的に共有ソース化を推奨
- `chrome.footer.nav.about.label` [label/単行/max8] 「会社案内」 — chrome.nav.about.labelと重複
- `chrome.footer.nav.service.label` [label/単行/max10] 「サービス・料金」 — chrome.nav.service.labelと重複
- `chrome.footer.nav.works.label` [label/単行/max8] 「施工事例」 — chrome.nav.works.labelと重複
- `chrome.footer.nav.voices.label` [label/単行/max8] 「お客様の声」 — chrome.nav.voices.labelと重複
- `chrome.footer.nav.process.label` [label/単行/max6] 「工程」 — footer専用の追加ナビ項目。/processページはheaderのNAV_ITEMSに無くfooter経由でしか到達できない
- `chrome.footer.nav.materials.label` [label/単行/max8] 「素材対応」 — chrome.nav.materials.labelと重複
- `chrome.footer.nav.colors.label` [label/単行/max6] 「色見本」 — chrome.nav.colors.labelと重複
- `chrome.footer.nav.notes.label` [label/単行/max8] 「読みもの」 — chrome.nav.notes.labelと重複
- `chrome.footer.nav.shop.label` [label/単行/max8] 「SHOP」 — chrome.nav.shop.labelと重複

## Tier C (74)

> **v2 追記 (2026-07-11): 法定ページ (tokushoho/privacy) の tier C 判定は上書き済み。**
> 本セクション以下の `tokushoho.*` / `privacy.*` エントリは、当初「法的文言のため個別
> スロット化しない」という tier C 確定判断の記録として残しているが、ユーザー指示
> 「全部の文字を変更できることが大事です」を受けて v2 Wave 1 でこの判定を撤回した。
> 実際には `tokushoho.hero.*` / `tokushoho.spec.*.{th,td,note}` / `tokushoho.mapnote` の
> 全 34 スロット、`privacy.hero.*` / `privacy.spec.*.{th,td,note}` / `privacy.mapnote` の
> 全 22 スロットを text-registry (`src/modules/page-media/text-registry/slots/{tokushoho,
> privacy}.ts`) に登録し、他ページと同じ粒度 (SpecTable の th/td・小活字開示注記単位まで)
> で編集可能化した。ページ実装は `src/app/(site)/{tokushoho,privacy}/page-body.tsx` +
> ビジュアルエディタ (`src/app/(editor)/edit/route-match.ts` / `page-map.tsx`) を参照。
> 以下のリスト項目 (「tier C確定」「編集不可」等の記述) は歴史的経緯としてそのまま残す。

- `notes.hero.index` [label/単行/max24] 「INDEX 08 — NOTES」 — SEC.xx/INDEXパターンの英語+番号装飾標識、意匠として固定
- `notes.hero.en` [label/単行/max30] 「READING ON PAINT & COLOR」 — PageHeadの英語装飾サブラベル(smのみ表示)、意匠文言
- `notes.articles.sectionMark.no` [label/単行/max10] 「SEC. 01」 — 構造上の連番標識
- `notes.articles.sectionMark.label` [label/単行/max14] 「ARTICLES」 — SEC.xxパターンの英語装飾ラベル
- `notes.articles.nav.ariaLabel` [label/単行/max20] 「読みもの目次」 — aria-labelのみで画面には表示されないスクリーンリーダー専用文言
- `notes.articles.empty.badge` [caption/単行/max24] 「STATUS — PREPARING」 — EmptyStateコンポーネントのデフォルトlabel(props未指定で暗黙表示)、他ページ(works/voices等)でも共用される英語装飾バッジ
- `notes.comingSoon.badge` [caption/単行/max14] 「COMING SOON」 — サイト全体で繰り返し使われる英語装飾バッジ意匠
- `notes-detail.hero.index` [label/単行/max24] 「INDEX 08 — NOTES」 — notes一覧と同一の装飾インデックス(重複、共有キー化余地あり)
- `notes-detail.hero.en` [label/単行/max30] 「READING ON PAINT & COLOR」 — notes一覧と重複する英語装飾サブラベル
- `notes-detail.nav.prevLabel` [label/単行/max20] 「← PREV — 前の記事」 — 矢印+英語+日本語の装飾ナビラベル、SEC.xxと同系統の意匠
- `notes-detail.nav.nextLabel` [label/単行/max20] 「NEXT — 次の記事 →」 — 同上、装飾ナビラベル
- `contact.hero.index` [label/単行/max24] 「INDEX 10 — CONTACT」 — 英語+番号の装飾インデックス標識
- `contact.hero.en` [label/単行/max24] 「SIZE × QTY × GRADE」 — PageHeadの英語装飾サブラベル
- `contact.hero.photo.figNo` [label/単行/max10] 「FIG.00」 — 写真番号の構造ラベル
- `contact.hero.photo.capEn` [caption/単行/max30] 「YOUR ONE PIECE, PERFECTED」 — キャプションの英語装飾サブテキスト
- `contact.hero.photo.credit` [caption/単行/max40] 「Photo: aaronburden / Unsplash」 — 画像クレジット表記、事実情報のため自由編集させない
- `contact.estimate.sectionMark.no` [label/単行/max10] 「SEC. 01」 — 構造上の連番標識
- `contact.estimate.sectionMark.label` [label/単行/max20] 「HOW TO ESTIMATE」 — 英語装飾ラベル
- `contact.estimate.size.label` [label/単行/max10] 「SIZE」 — 3変数カードの英語装飾ラベル
- `contact.estimate.qty.label` [label/単行/max10] 「QTY」 — 3変数カードの英語装飾ラベル
- `contact.estimate.grade.label` [label/単行/max10] 「GRADE」 — 3変数カードの英語装飾ラベル
- `contact.form.sectionMark.no` [label/単行/max10] 「SEC. 02」 — 構造上の連番標識
- `contact.form.sectionMark.label` [label/単行/max20] 「CONTACT FORM」 — 英語装飾ラベル
- `contact.beforeAsk.sectionMark.no` [label/単行/max10] 「SEC. 03」 — 構造上の連番標識
- `contact.beforeAsk.sectionMark.label` [label/単行/max20] 「BEFORE YOU ASK」 — 英語装飾ラベル
- `contact.faq.sectionMark.no` [label/単行/max10] 「SEC. 04」 — 構造上の連番標識
- `contact.faq.sectionMark.label` [label/単行/max10] 「FAQ」 — 英語装飾ラベル
- `contact.form.status.badge` [caption/単行/max26] 「STATUS — CONTACT FORM」 — 英語装飾ステータスバッジ(意匠パターン)
- `contact.form.honeypot.label` [label/単行/max20] 「ウェブサイト」 — honeypot隠しフィールドのlabel、視覚的には非表示(bot対策専用)で編集対象にならない
- `contact.form.field.name.label` [label/単行/max10] 「お名前」 — フォーム必須項目ラベル、必須マーカー(*)と対になる機能文言
- `contact.form.field.name.placeholder` [label/単行/max14] 「山田 太郎」 — 入力例プレースホルダ、UI機能文言
- `contact.form.field.email.label` [label/単行/max14] 「メールアドレス」 — フォーム必須項目ラベル
- `contact.form.field.email.placeholder` [label/単行/max20] 「you@example.com」 — 入力例プレースホルダ
- `contact.form.field.phone.label` [label/単行/max14] 「電話番号(任意)」 — フォーム任意項目ラベル
- `contact.form.field.phone.placeholder` [label/単行/max20] 「090-1234-5678」 — 入力例プレースホルダ
- `contact.form.field.inquiryType.label` [label/単行/max14] 「お問い合わせ種別」 — フォーム必須項目ラベル
- `contact.form.field.inquiryType.placeholder` [label/単行/max16] 「選択してください」 — Selectのプレースホルダ、UI機能文言
- `contact.form.field.targetItem.label` [label/単行/max14] 「対象品目(任意)」 — フォーム任意項目ラベル
- `contact.form.field.targetItem.placeholder` [label/単行/max30] 「例: スマホケース、車両パーツ など」 — 入力例プレースホルダ
- `contact.form.field.message.label` [label/単行/max10] 「内容」 — フォーム必須項目ラベル
- `contact.form.field.message.placeholder` [label/単行/max60] 「ご相談内容、サイズ・個数・希望グレード、造形データの有無などをご記入ください。」 — Textareaの入力例プレースホルダ
- `contact.form.field.message.description` [body/単行/max30] 「10文字以上5000文字以内でご記入ください。」 — zodのmin(10)/max(5000)と数値が直結しているFieldDescription、テキストのみ編集すると実際のバリデーション制約と乖離するリスクが高い
- `contact.form.field.agree.label` [label/単行/max30] 「プライバシーポリシーに同意する」 — リンク付きの法的同意文言、自由編集させるべきでない
- `contact.form.success.badge` [caption/単行/max20] 「STATUS — RECEIVED」 — 英語装飾ステータスバッジ
- `contact.form.validationMessages` [body/単行/max0] 「お名前を入力してください / 正しいメールアドレスを入力してください / 正しい電話番号の形式で入力してください / お」 — zodバリデーションのcustom messageで、実際のmin/max/正規表現の数値と一致している必要がある。テキストのみ編集するとロジックとの整合が壊れるためコード管理を維持すべき
- `contact.form.errorMessages` [body/単行/max0] 「送信回数の上限に達しました。しばらく時間をおいてから再度お試しください。 / 送信に失敗しました。しばらくしてから再度お」 — rate-limit・送信失敗時のシステムフォールバック文言、機能ロジックと直結
- `tokushoho.hero.index` [label/単行/max10] 「LEGAL」 — 法的ページの構造ラベル
- `tokushoho.hero.en` [label/単行/max20] 「特定商取引法に基づく表記」 — 法的文言、tier C確定
- `tokushoho.hero.heading` [heading/複数行/max20] 「特定商取引法に基づく表記」 — 特定商取引法に基づく表記そのもの。法的文言のため編集不可
- `tokushoho.hero.lead` [lead/単行/max160] 「通信販売（受託仕上げサービスおよび塗装済み製品の販売）に関する、特定商取引に関する法律第11条に基づく表示です...」 — 法的リード文、tier C確定
- `tokushoho.specTable` [body/複数行/max0] 「販売業者(屋号)/運営統括責任者/所在地/電話番号/お問い合わせ窓口/販売価格/商品代金以外の必要料金/お支払い方法/お」 — 特定商取引法の必須記載事項テーブル全13行。法定表示のため個別スロット化は行わずtier C確定
- `tokushoho.mapNote` [body/単行/max100] 「本表記は開業準備中の内容を含みます。正式な販売開始時に、確定した事業者情報・支払い方法・窓口へ更新します（最終更新：20」 — 法的注記、tier C確定
- `privacy.hero.index` [label/単行/max10] 「LEGAL」 — 法的ページの構造ラベル
- `privacy.hero.en` [label/単行/max20] 「PRIVACY POLICY」 — 英語装飾ラベル、法的ページのためtier C
- `privacy.hero.heading` [heading/単行/max16] 「プライバシーポリシー」 — 法的文言(プライバシーポリシー)そのもの、tier C確定
- `privacy.hero.lead` [lead/単行/max160] 「隈部塗装（以下「当工房」といいます）は、お問い合わせ・お見積もり・施工のご依頼にあたってお預かりする個人情報を...」 — 法的リード文、tier C確定
- `privacy.specTable` [body/複数行/max0] 「1.事業者情報/2.取得する個人情報/3.利用目的/4.第三者提供/5.保存期間/6.開示・訂正・削除等の請求/7.Co」 — プライバシーポリシー本文全8項、法的文言のためtier C確定
- `privacy.mapNote` [body/複数行/max100] 「制定日・改定日：2026年7月7日 / 本ページは開業準備中のドラフトです...」 — 法的注記(制定日を含む)、tier C確定
- `chrome.header.brandEn` [caption/単行/max16] 「KUMABE TOSO」 — 社名のローマ字装飾ブランドマーク。site_settings.company.nameにローマ字専用フィールドが無く、デザイン意匠として維持
- `chrome.header.menuAriaLabel` [label/単行/max16] 「メニューを開く」 — aria-labelのみ、画面には表示されない
- `chrome.header.navAriaLabel` [label/単行/max20] 「メインナビゲーション」 — aria-labelのみ、画面には表示されない
- `chrome.footer.sitemapLabel` [label/単行/max14] 「SITEMAP」 — footerナビ見出しの英語装飾ラベル
- `chrome.footer.workshopLabel` [label/単行/max14] 「WORKSHOP」 — 英語装飾ラベル
- `chrome.footer.legalLabel` [label/単行/max10] 「LEGAL」 — 英語装飾ラベル
- `chrome.footer.tokushohoLink` [cta/単行/max20] 「特定商取引法に基づく表記」 — tokushohoページのタイトルと一致させる必要がある法的リンクテキスト、独立編集は不整合リスク
- `chrome.footer.privacyLink` [cta/単行/max20] 「プライバシーポリシー」 — privacyページのタイトルと一致させる必要がある法的リンクテキスト
- `chrome.footer.marquee.1` [caption/単行/max30] 「研磨 · 塗装 · 3Dプリント表面処理」 — footer横スクロールマーキー(ticker)の装飾文言、overflow-hidden+whitespace-nowrap前提でループ幅に影響するためtier C
- `chrome.footer.marquee.2` [caption/単行/max24] 「NATIONWIDE MAIL-IN」 — マーキー装飾文言(英語)
- `chrome.footer.marquee.3` [caption/単行/max24] 「OITA BUNGOTAKADA」 — マーキー装飾文言(英語、所在地のローマ字表記)
- `chrome.footer.marquee.4` [caption/単行/max24] 「試作1点 — ブリッジ生産1,000個」 — マーキー装飾文言、数量(1,000個)を含みpricing/QUOTE_VARSの数値と整合が必要
- `chrome.footer.brandGiant` [caption/単行/max16] 「KUMABE TOSO」 — footer最下部の巨大装飾テキスト(kt-footer-giant)、overflow-hidden/whitespace-nowrap前提のCSS意匠、社名ローマ字表記と重複
- `chrome.footer.copyright` [caption/単行/max50] 「© 2026 KUMABE TOSO. ALL RIGHTS RESERVED.」 — 著作権表記、法的/技術的性質のため編集不可
- `chrome.footer.tagEn` [caption/単行/max50] 「3D PRINT SURFACE FINISHING — OITA, JAPAN」 — 英語装飾サブコピー(フッター最下段)
- `chrome.footer.photoDisclaimer` [caption/複数行/max140] 「掲載写真は Unsplash の商用利用可能なイメージ素材で、各写真のクレジットはキャプションに記載しています...」 — 写真ライセンス・実写真ではない旨の免責事項。事実情報のため自由編集させない

## DB 由来 (スロット化しない)
- notes 一覧・詳細の記事タイトル/抜粋/本文 (posts.title / posts.excerpt / posts.body、Markdown経由でSimpleMarkdown表示)。前後記事ナビの nav.prev.title / nav.next.title も同源。既存CMS編集画面の領分でありpage_textスロット化しない
- 会社名「隈部塗装」— site-header.tsx のロゴ文字・モバイルSheetTitle、site-footer.tsx の見出し・住所ブロック冒頭で計4箇所使用。概念上は site_settings.company.name の領分だが、現状は3ファイルとも文字列リテラルでハードコードされておりDBと未連携(admin/settingsで社名を変更してもheader/footerには反映されない状態と推測。要確認)
- 代表者名「隈部 信之」— site-footer.tsx 住所ブロック、tokushoho/page.tsx「運営統括責任者」行、privacy/page.tsx「1. 事業者情報」行で使用。概念上は site_settings.company.representative の領分だが同様に現状ハードコード
- 所在地「大分県豊後高田市」— site-footer.tsx、tokushoho/page.tsx「所在地」行、privacy/page.tsx「1. 事業者情報」行で使用。概念上は site_settings.company.address の領分だが同様に現状ハードコード

## レイアウトリスク
- site-header.tsx デスクトップnav: lg breakpoint(1024px+)で9項目+CTAボタンが1行の水平バーに収まる設計(gap-2 / px-2.5の狭い間隔)。NAV_ITEMSのlabelを現行より長くすると折り返し・overflowが発生しやすい。目安は全角4〜8文字
- site-footer.tsx FOOTER_NAV: grid-cols-2の2列リスト。長いlabelは2行に折り返し、no番号バッジ(font-mono)と項目名の baseline 整列が崩れる
- PageHead の title は各ページとも手動 <br/> でJSX内に改行位置を焼き込んでいる(例: notes/contact/tokushohoのhero見出し)。文言を変えるとbrの位置だけ古いままになり不自然な改行や1行だけ極端に長い見出しになるリスクがある。編集時はbr位置の見直しをセットで行う想定が必要
- contact.hero.photo (PhotoFigure) の capJa は figcaption内で capEn(英語装飾) と同一行に sm:flex-row items-baseline で並ぶため、capJa を大幅に長くすると capEn が下段に押し出され意図しない改行になる
- contact の QUOTE_VARS 3カード(md:grid-cols-3): bodyを現行よりかなり長くすると横並びの3カードで高さが不揃いになる(グリッドは行高を自動で揃えないため見た目のガタつきが出る)
- contact の FAQ summary 行は flex items-baseline gap-4 でQ番号(font-mono固定幅)+質問文が1行前提のレイアウト。質問文(q)が長いと折り返し、Q番号との baseline がズレる。回答文(a)は<details>展開時のみ表示され幅制限はゆるいため長文リスクは低い
- contact-form.tsx の InquiryType SelectTrigger は sm:w-64 の固定幅。INQUIRY_TYPES の label を現行(4〜8文字)より大きく伸ばすとトリガー内で折り返し/はみ出しが起きる
- ArrowButton / CtaBand のボタン文言は矢印アイコン(→)付きの固定高さボタン(h-10〜h-12)内に収まる想定。長文化すると矢印との間隔が詰まる、または改行してボタンが縦に伸びる
- site-footer.tsx の kt-footer-giant(社名ローマ字の巨大装飾テキスト)と kt-marquee(ティッカー)は overflow-hidden / whitespace-nowrap 前提のCSSアニメーション要素。文字数を変えるとループ幅・速度の再調整が必要になる