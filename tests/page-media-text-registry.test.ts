import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EDITABLE_ROUTES, SLOT_REGISTRY } from "@/modules/page-media/registry";
import {
  TEXT_REGISTRY,
  TEXT_REGISTRY_HASH,
  isValidTextSlotKey,
  normalizeLineEndings,
  resolveMaxLineLen,
  textSlotByKey,
  textSlotsForRoute,
  validateSlotText,
  type PageTextSlot,
} from "@/modules/page-media/text-registry";

/**
 * canonical: docs/design/visual-text-editor.md §2 (TEXT_REGISTRY) / §5.3 (lines 制約) /
 * §8 (単体テスト戦略)。入力資料: docs/design/text-slots/PLAN.md §3.2 (Tier A 確定表)。
 *
 * 「defaultText が page-body の現行文言と一致」の検証は、T1 時点では page-body が
 * まだ SlotText に変換されていない (T2a 領分) ため、変換前の現行 JSX から書き起こした
 * 「frozen fixture」(下記 FROZEN_DEFAULT_TEXT) との厳密一致で担保する。コーディネーター
 * 指示 (v1.1) のとおり、実装後の JSX から再抽出する自己一致テストにはしない
 * (それだと転記ミスを検出できない — テストが常に registry と同じ値を再計算してしまう)。
 */

// PLAN.md §3.2 の確定 75 件から、下記 1 件を除いた 74 件が T1 時点の確定 A (v1)。
// story.message.body は本文 3 段落目に <strong> インライン装飾を含むため
// (src/app/(site)/story/page-body.tsx を実測)、SlotText の dangerouslySetInnerHTML 禁止
// 制約と両立できず、PLAN.md §3.2 自身が用意した退避条項 (「あれば B へ戻す」) に従って
// 本レジストリには含めない (text-registry.ts 冒頭コメント参照)。story.message.body 自体は
// v2 の rich kind で再挑戦できるが、本 wave (shop) の対象外。
//
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): shop ページの残り全静的テキスト
// (rich 19件を含む 125件) を追加し、74 - 9 (旧 shop) + 134 (新 shop) = 199 件 (shop.ts 側の
// 詳細な内訳・rich マークアップ確定根拠は同ファイル冒頭コメント参照)。他ページの追加は
// 後続 wave で本カウント・フィクスチャを同様に更新する。
//
// 追補 (page-blocks.tsx 基盤整備): PageHead index/en・SectionMark label ×4・PhotoFigure
// capJa/capEn/credit の 9 件を追加配線し、199 + 9 = 208 件 (shop.ts 側の内訳詳細は同ファイル
// 冒頭コメント参照)。
const EXPECTED_COUNT = 208;

const FROZEN_DEFAULT_TEXT: Readonly<Record<string, string>> = {
  "shared.cta.consult": "相談する",
  "chrome.footer.tagline":
    "3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。",

  "home.statement.heading":
    "デザインモデルの品質は、\n表面処理で決まる。\nそれでも、表面処理を高い水準で\n内製できる会社は、多くない。\nその空白のために、この工房がある。",
  "home.craft.heading": "3つの技術を、ひとりで持つ。",
  "home.craft.card.1.title": "積層痕を消す研磨",
  "home.craft.card.2.title": "自動車グレードの艶",
  "home.craft.card.3.title": "3コートパールの意匠",
  "home.colorlineup.heading": "名車の象徴色で組んだ、\n8枚の技術証明。",
  "home.twoscenes.heading": "一点の勝負にも、千個の生産にも。",
  "home.twoscenes.scene.1.title": "プレミアムデザインモデルの一点仕上げ",
  "home.twoscenes.scene.2.title": "金型を作らない少量生産の外観仕上げ",
  "home.stats.heading": "工房の能力を、\n数字で。",
  "home.materials.heading": "FDMも、光造形も、SLSも。\n素材ごとに、手を変える。",
  "home.notes.heading": "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
  "home.gallery.heading": "工房の、手の記録。",
  "home.cta.heading": "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
  "home.cta.note": "造形データや写真があれば、より正確に概算をお出しできます。",

  "story.hero.heading": "なぜ、積層痕と\n戦うことにしたのか。",
  "story.hero.lead":
    "家電の量産塗装で長年腕を磨いた職人が、どうして3Dプリントの表面処理という、まだ名前もない仕事に専念することにしたのか。一本の相談から始まった、下地をめぐる物語です。",
  "story.message.heading": "「見えなくなる仕事」に、\n誇りを持っています。",
  "story.cta.heading": "物語の続きは、\nあなたの造形物で。",
  "story.cta.note": "「絶対に外せない一個」を、量産品の顔に。まずはお気軽にご相談ください。",

  "about.hero.heading": "下地の仕事は、\n見えなくなるからこそ。",
  "about.hero.lead":
    "仕上がった塗面に、研ぎの跡は残りません。それでも、艶の深さも、色の正確さも、すべては見えなくなった下地が決めています。隈部塗装は、その見えない工程に最も時間を割く工房です。",
  "about.why.heading": "「表面処理だけ頼みたい」に、\n応える工房が少なかった。",
  "about.facility.heading": "バンパー6本を、同時に塗れる。",
  "about.gallery.heading": "現場の、手ざわり。",
  "about.cta.heading": "工程と料金の詳細は、\nサービスページに。",
  "about.cta.note": "下地は全グレード共通。差分はトップコートの層数だけです。",

  "service.hero.heading": "下地は全グレード共通。\nだから品質が揺れない。",
  "service.hero.lead":
    "自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。",
  "service.process.aside.heading": "なぜ鏡面磨きをしないのか",
  "service.terms.heading": "正直に、先にお伝えします。",
  "service.qc.heading": "発送前に、8つの目で見る。",
  "service.gallery.heading": "工程の、その手。",
  "service.cta.heading": "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
  "service.cta.note": "造形データや写真があれば、より正確に概算をお出しできます。",

  "process.hero.heading": "一個が仕上がるまでの、\n9つの手。",
  "process.hero.lead":
    "3Dプリントの造形物が、量産品と見分けがつかない外観になるまでには、決まった順序があります。派手なのは色を吹く瞬間だけ。その前後にある地味な工程こそが、仕上がりを決めます。自動車補修の手順を、一手ずつ開きます。",
  "process.coating.heading": "塗装は、\n層でできている。",
  "process.steps.heading": "受け取ってから、\n送り出すまで。",
  "process.booth.heading": "きれいな空気でしか、\nきれいには塗れない。",
  "process.related.heading": "工程の、その先へ。",
  "process.gallery.heading": "工程を、支えるもの。",
  "process.cta.heading": "この9工程を、\nあなたの一個に。",
  "process.cta.note": "サイズ・個数・グレードが分かれば、概算をお出しできます。まずはご相談ください。",

  "materials.hero.heading": "素材を選ばない。\nただし、素材ごとに手を変える。",
  "materials.hero.lead":
    "3Dプリントは、造形方式によって積層痕の出方も、塗料の乗り方も、まったく違います。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む——同じ「下地」でも、素材ごとに手を変えます。ここでは対応方式と、素材別の考え方をまとめます。",
  "materials.methods.heading": "3つの造形方式、\nそれぞれの下地。",
  "materials.matrix.heading": "素材別の、対応と勘所。",
  "materials.why.heading": "失敗の多くは、\n塗る前に決まっている。",
  "materials.intake.heading": "造形から、任せてもいい。",
  "materials.gallery.heading": "素材の、その先。",
  "materials.cta.heading": "素材が決まっていなくても、\n用途から相談できます。",
  "materials.cta.note": "「屋外で使う」「撮影用」「触れる展示物」——用途に合う素材と仕上げをご提案します。",

  "colors.hero.heading": "名車の象徴色で組んだ、\n8枚の技術証明。",
  "colors.hero.lead":
    "見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。実物の色見本パネル（対辺70mmの六角形・裏面カラーコード刻印）は、郵送でお貸し出しできるよう準備中です。",
  "colors.cta.heading": "この8色以外も、\n色番号でご指定いただけます。",
  "colors.cta.note": "日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。",

  "shop.hero.index": "INDEX 09 — SHOP",
  "shop.hero.en": "ORDER FINISHING ONLINE",
  "shop.sec.1.label": "FINISHING SERVICES — 受託仕上げ",
  "shop.sec.2.label": "ESTIMATE SIMULATOR",
  "shop.sec.3.label": "READY-MADE — 塗装済み製品",
  "shop.sec.4.label": "HOW TO ORDER",
  "shop.hero.photo.capja": "あなたが手にするのは、この深さ。自動車グレードの艶を、造形物に。",
  "shop.hero.photo.capen": "AUTOMOTIVE-GRADE FINISH, DELIVERED",
  "shop.hero.photo.credit": "Photo: cmreflections / Unsplash",
  "shop.hero.heading": "仕上げを、\n通販のように買う。",
  "shop.hero.lead":
    "受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのまま注文のご相談へ。オンライン決済は現在準備中のため、いまは「注文の意思表示 → 相談 → 正式見積もり → お支払い」の流れでお受けしています。手のひらの造形物を送るだけで、量産品の顔になって還ってきます。",
  "shop.grades.heading": "3つのグレードから、\n選ぶ。",
  "shop.simulator.heading": "サイズ × 個数 × グレード。\n3つ選べば、概算が出る。",
  "shop.simulator.cta": "この内容で注文・相談する",
  "shop.products.heading": "手に取れる製品も、\nここに並びます。",
  "shop.flow.heading": "注文から、お届けまで。",
  "shop.cta.heading": "概算が出たら、\nあとは送るだけ。",
  "shop.cta.note": "シミュレータの内容をコピーして、そのまま貼り付けてご相談ください。",
  "shop.grades.lead": "下地はどのグレードも共通です。`#800` で積層痕を研ぎ落とし、プラサフで微細な段差を埋め、`#1200` で水研ぎ。違いはトップコートの層数だけ——塗らずに下地で仕上げるか、ソリッド1色か、パール3層か。あなたの造形物を工房へ送るだけで、射出成形品と見分けのつかない外観になって還ります。",
  "shop.grade.1.badge": "GRADE 01",
  "shop.grade.1.label": "SERVICE 01",
  "shop.grade.1.title": "下地仕上げ",
  "shop.grade.1.subtitle": "PRIMER-READY FINISH",
  "shop.grade.1.badge.grit": "研磨 **#800**",
  "shop.grade.1.badge.wetsand": "水研ぎ **#1200**",
  "shop.grade.1.badge.paint": "塗装 **なし**",
  "shop.grade.1.body": "積層痕を消し、プラサフまで入れた「塗る直前」の状態で納品します。縞は跡形もなく消え、面はなめらか。ここから先の色は、あなたの手に委ねます。塗装費が乗らないぶん、最も手に取りやすいグレードです。",
  "shop.grade.1.steps.label": "含まれる工程",
  "shop.grade.1.steps": "・#800 による積層痕の面研ぎ\n・プラサフ（下塗り・中塗り）で段差を充填\n・#1200 水研ぎで塗装可能面に",
  "shop.grade.1.suited.label": "こんな方に",
  "shop.grade.1.suited.body": "最終色をご自身で吹く造形作家・ガレージキット層・試作会社。「下地だけ、プロにやってほしい」という方へ。",
  "shop.grade.1.price": "¥7,000〜",
  "shop.grade.1.price.note": "1点あたり / サイズ別目安・税込",
  "shop.grade.1.cta": "サイズと個数で概算",
  "shop.grade.2.badge": "GRADE 02",
  "shop.grade.2.label": "SERVICE 02",
  "shop.grade.2.title": "スタンダード",
  "shop.grade.2.subtitle": "SOLID COLOR + 2K CLEAR",
  "shop.grade.2.badge.common": "共通下地",
  "shop.grade.2.badge.coat": "コート **2層**",
  "shop.grade.2.badge.urethane": "2液ウレタン",
  "shop.grade.2.body": "共通下地の上に、ソリッドカラーのベースコートと2液ウレタンクリアを重ねます。吹きっぱなしで自動車外板と同等の艶が出るため、磨き工程は不要。単色の製品試作・小ロット生産品の外観仕上げに、過不足のないグレードです。",
  "shop.grade.2.steps.label": "含まれる工程",
  "shop.grade.2.steps": "・共通下地（研磨〜水研ぎ）一式\n・ソリッドカラー ベースコート\n・2液ウレタンクリア（常温硬化）",
  "shop.grade.2.suited.label": "こんな方に",
  "shop.grade.2.suited.body": "単色でいい製品試作・小ロット生産品。「量産品のような、均一な単色の艶」が欲しい方へ。",
  "shop.grade.2.price": "¥10,000〜",
  "shop.grade.2.price.note": "1点あたり / サイズ別目安・税込",
  "shop.grade.2.cta": "サイズと個数で概算",
  "shop.grade.3.badge": "GRADE 03 — 最上位",
  "shop.grade.3.label": "SERVICE 03 — 最上位",
  "shop.grade.3.title": "プレミアム",
  "shop.grade.3.subtitle": "3-COAT PEARL",
  "shop.grade.3.badge.common": "共通下地",
  "shop.grade.3.badge.coat": "コート **3層**",
  "shop.grade.3.badge.colors": "参考色 **8色**",
  "shop.grade.3.body": "ベース＋パール＋クリアの3コート。角度で表情を変える、名車の象徴色そのものの深みです。「絶対に外せない一個」——商談・展示会・クラウドファンディングの一枚のための、最上位仕上げ。下記の8色から選べます。",
  "shop.grade.3.colors.label": "選べる参考色（8色）",
  "shop.grade.3.suited.label": "こんな方に",
  "shop.grade.3.suited.body": "商談・展示会・クラファン掲載の勝負試作。「写真で一目で伝わる、最高の質感」が要る方へ。",
  "shop.grade.3.price": "¥15,000–35,000",
  "shop.grade.3.price.note": "1点あたり / 目安・税込",
  "shop.grade.3.cta": "サイズと個数で概算",
  "shop.grades.footnote": "※ 価格は「サイズ帯別の基本料金＋グレード」で決まる立ち上げ期の目安です。上記は最小サイズ（〜100mm）からの参考価格で、サイズが上がると変動します。正式価格表は作業実測に基づいて確定し、このページを更新します。色番号指定（日塗工・自動車カラーコード）にも対応。[8色の色見本を一枚ずつ見る](/colors)／[工程と品質管理の詳細](/service)。",
  "shop.simulator.lead": "数量スライド（10個以上 −15% / 30個以上 −25%）と特急（＋50%）も反映した概算レンジを、その場で計算します。面を埋めるほど1個あたりの手間は下がる——だから、数を出すほど有利になります。内容はワンタップでコピーして、そのまま相談に貼り付けられます。",
  "shop.products.lead": "工房で仕上げた「そのまま買える」製品の販売枠です。第一弾として、画面では絶対に伝わらない粒子感・深みを手元で確かめられる、実物の色見本パネルを準備しています。掲載製品は順次追加していきます。",
  "shop.product.1.badge": "COMING SOON",
  "shop.product.1.title": "六角色見本パネル・8色セット",
  "shop.product.1.sku": "HEX-SET-08",
  "shop.product.1.body": "8色の参考色を、実物の塗り板で。画面では絶対に伝わらない、パールの粒子感と深みを手元で確認できるセットです。制作検討の色決めに。",
  "shop.product.1.spec.1.label": "形状",
  "shop.product.1.spec.1.value": "対辺70mm 六角形 × 8枚",
  "shop.product.1.spec.2.label": "仕様",
  "shop.product.1.spec.2.value": "裏面にカラーコード刻印",
  "shop.product.1.spec.3.label": "用途",
  "shop.product.1.spec.3.value": "色決め・貸出プラン準備中",
  "shop.product.1.price": "価格未定",
  "shop.product.1.price.note": "準備中",
  "shop.product.2.badge": "COMING SOON",
  "shop.product.2.title": "六角色見本パネル・単色",
  "shop.product.2.sku": "HEX-01",
  "shop.product.2.body": "気になる1色だけを手元に。ソウルレッド、ベイサイドブルー、ホワイトパールなど、8色から選べる単品パネル。まずは狙いの色を、実物で確かめてください。",
  "shop.product.2.spec.1.label": "形状",
  "shop.product.2.spec.1.value": "対辺70mm 六角形 × 1枚",
  "shop.product.2.spec.2.label": "選択",
  "shop.product.2.spec.2.value": "8色から1色を指定",
  "shop.product.2.spec.3.label": "仕様",
  "shop.product.2.spec.3.value": "裏面にカラーコード刻印",
  "shop.product.2.price": "価格未定",
  "shop.product.2.price.note": "準備中",
  "shop.product.3.badge": "受注制作",
  "shop.product.3.title": "あなたの造形物・一点仕上げ",
  "shop.product.3.sku": "CUSTOM-01",
  "shop.product.3.body": "この枠の主役は、あなたの造形物です。上のシミュレータで概算を出して、そのままご相談ください。仕上がった実例は、許可をいただいた上でここに並びます。",
  "shop.product.3.spec.1.label": "対応",
  "shop.product.3.spec.1.value": "郵送受託・全国対応",
  "shop.product.3.spec.2.label": "数量",
  "shop.product.3.spec.2.value": "1点〜1,000個",
  "shop.product.3.spec.3.label": "グレード",
  "shop.product.3.spec.3.value": "下地／スタンダード／プレミアム",
  "shop.product.3.price": "¥7,000〜",
  "shop.product.3.price.note": "シミュレータで概算",
  "shop.products.footnote": "※ 製品ビジュアルは現在イメージ（塗り板の色をCSSで再現したもの）です。実物の写真・価格・在庫は、販売開始時にこのページで公開します。",
  "shop.flow.lead": "遠く離れた工房でも、安心して預けられるように。受入から発送まで、記録を残しながら進めます。オンライン決済が整うまでは、下記のとおり相談ベースでお受けしています。",
  "shop.flow.1.meta": "必要なもの — **造形物 or データ・希望グレード・色**",
  "shop.flow.2.meta": "支払い — **銀行振込（カード決済は準備中）**",
  "shop.flow.3.meta": "記録 — **ビフォー／アフターを撮影**",
  "shop.flow.4.meta": "品質 — **完全硬化＋8項目検品**",
  "shop.flow.1.no": "STEP 01",
  "shop.flow.1.title": "注文・相談",
  "shop.flow.1.body": "上のシミュレータで概算を出し、内容をコピーして相談ページからご連絡ください。造形データ（STL/STEP）や写真、素材の種類が分かると、より正確なお見積もりになります。",
  "shop.flow.2.no": "STEP 02",
  "shop.flow.2.title": "正式見積もり・お支払い",
  "shop.flow.2.body": "形状・素材・色を確認し、正式なお見積もりを提示します。ご了承いただいてから、お支払い（銀行振込・前払い）。未発表製品にはNDAで対応します。",
  "shop.flow.3.no": "STEP 03",
  "shop.flow.3.title": "発送 → 施工",
  "shop.flow.3.body": "造形物を工房へお送りください。受入検品とビフォー撮影ののち、研磨・脱脂・プラサフ・足付け・塗装まで、全9工程で仕上げます。未経験素材はテストピースで確認してから。",
  "shop.flow.4.no": "STEP 04",
  "shop.flow.4.title": "硬化・検品 → お届け",
  "shop.flow.4.body": "2液ウレタンの完全硬化（5〜7日）を待ち、ブツ・タレ・肌・艶など8項目の検品を通してから、丁寧に梱包して返送します。生乾きで送ることはしません。",
  "shop.flow.footnote": "お支払い方法・時期、送料、返品条件などの取引条件は[特定商取引法に基づく表記](/tokushoho)を、よくある質問は[相談ページのFAQ](/contact)をご確認ください。オンライン決済（クレジットカード）は現在準備中で、対応開始時に各商品の「購入」ボタンが有効になります。",
  "shop.simulator.fallback": "価格はお問い合わせください。",
  "shop.simulator.quoteonly.default": "この帯の造形は、形状を確認のうえ個別にお見積もりします",
  "shop.simulator.quoteonly.withmax_suffix": "mmを超える造形は、形状を確認のうえ個別にお見積もりします",
  "shop.simulator.total.quoteonly": "個別見積もり",
  "shop.simulator.per.prefix": "1点あたり ",
  "shop.simulator.per.suffix": "（税込・目安）",
  "shop.simulator.grade.optgroup.label": "GRADE — グレード",
  "shop.simulator.size.optgroup.label": "SIZE — 最長辺の目安",
  "shop.simulator.size.sub.s": "手のひらサイズ",
  "shop.simulator.size.sub.m": "主戦場サイズ",
  "shop.simulator.size.sub.l": "大きめの造形",
  "shop.simulator.size.sub.xl": "個別見積もり",
  "shop.simulator.qty.label": "QUANTITY — 個数（同一品）",
  "shop.simulator.total.label": "ESTIMATED TOTAL — 概算合計（税込・目安）",
  "shop.simulator.row.grade": "グレード",
  "shop.simulator.row.size": "サイズ帯",
  "shop.simulator.row.qty": "個数",
  "shop.simulator.row.slide": "数量スライド",
  "shop.simulator.opt.none": "なし",
  "shop.simulator.footnote": "※ 立ち上げ期の概算目安です。形状の複雑さ・素材・色により変動します。初回のみ治具・段取り費を別途（リピート時免除）。送料は実費です。正式なお見積もりでご確定ください。",
  "shop.simulator.toast.copied": "内容をコピーしました。相談ページへ移動します…",
  "shop.simulator.toast.redirect": "相談ページへ移動します…",

  "notes.hero.heading": "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
  "notes.hero.lead": "工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。",
  "notes.cta.heading": "読んで気になったことは、\nそのまま聞いてください。",
  "notes.cta.note": "工程・色・素材の相性、どんな質問でも。",

  "contact.hero.heading": "見積もりは、\n3つの数字で。",
  "contact.hero.lead":
    "「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけシンプルです。造形データや写真、素材の種類がわかると、より正確になります。",
};

describe("TEXT_REGISTRY", () => {
  it(`実測 ${EXPECTED_COUNT} 件 (v1: PLAN.md 75件からstory.message.body除外=74。v2 Wave1: shopページ125件追加=199。page-blocks.tsx基盤整備でPageHead/SectionMark/PhotoFigure配線9件追加=208)`, () => {
    expect(TEXT_REGISTRY.length).toBe(EXPECTED_COUNT);
  });

  it("slot_key は一意である", () => {
    const keys = TEXT_REGISTRY.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("route はすべて非空文字列で、page-media EDITABLE_ROUTES の部分集合である", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(slot.route.length).toBeGreaterThan(0);
      expect(EDITABLE_ROUTES).toContain(slot.route);
    }
  });

  it("affectedRoutes を持つスロットは、その全ルートも EDITABLE_ROUTES に含まれる", () => {
    for (const slot of TEXT_REGISTRY) {
      for (const route of slot.affectedRoutes ?? []) {
        expect(EDITABLE_ROUTES).toContain(route);
      }
    }
  });

  it("kind は text | lines | multiline | rich のいずれかである (v2 Wave 1: rich 追加)", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(["text", "lines", "multiline", "rich"]).toContain(slot.kind);
    }
  });

  it("maxLen は正の整数である", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(Number.isInteger(slot.maxLen)).toBe(true);
      expect(slot.maxLen).toBeGreaterThan(0);
    }
  });

  it("kind=lines のスロットは maxLines が必須設定されている (v1.1)", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "lines")) {
      expect(slot.maxLines, `${slot.key} に maxLines が未設定です`).toBeDefined();
      expect(slot.maxLines).toBeGreaterThan(0);
    }
  });

  it("kind=text のスロットは maxLines を持たない (単一行のため無関係)", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "text")) {
      expect(slot.maxLines).toBeUndefined();
    }
  });

  it("defaultText は自身の maxLen 以下である", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(slot.defaultText.length, `${slot.key} が maxLen を超過`).toBeLessThanOrEqual(
        slot.maxLen,
      );
    }
  });

  it("kind=text の defaultText は改行を含まない", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "text")) {
      expect(slot.defaultText.includes("\n")).toBe(false);
    }
  });

  it("defaultText は trim 後も非空である (v1.3: 空文字列拒否ルールとの整合)", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(slot.defaultText.trim().length, `${slot.key} の defaultText が空`).toBeGreaterThan(0);
    }
  });

  it("kind=lines の defaultText は maxLines 行以内・各行が resolveMaxLineLen 以内である", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "lines")) {
      const lines = slot.defaultText.split("\n");
      expect(lines.length, `${slot.key} の行数超過`).toBeLessThanOrEqual(slot.maxLines!);
      const maxLineLen = resolveMaxLineLen(slot);
      if (maxLineLen !== undefined) {
        for (const line of lines) {
          expect(line.length, `${slot.key} の行長超過: "${line}"`).toBeLessThanOrEqual(maxLineLen);
        }
      }
    }
  });

  it("home.statement.heading は 5 行・1 行 18 字までの特例 (§5.3)", () => {
    const slot = textSlotByKey("home.statement.heading")!;
    expect(slot.maxLines).toBe(5);
    expect(resolveMaxLineLen(slot)).toBe(18);
    expect(slot.defaultText.split("\n").length).toBe(5);
  });

  it("shared.cta.consult / chrome.footer.tagline は affectsAllRoutes=true", () => {
    expect(textSlotByKey("shared.cta.consult")?.affectsAllRoutes).toBe(true);
    expect(textSlotByKey("chrome.footer.tagline")?.affectsAllRoutes).toBe(true);
  });

  it("notes.cta.* は /notes と notes/[slug] を affectedRoutes に持つ (一覧・詳細で共有)", () => {
    for (const key of ["notes.cta.heading", "notes.cta.note"]) {
      const slot = textSlotByKey(key)!;
      expect(slot.affectedRoutes).toEqual(["/notes", "notes/[slug]"]);
    }
  });

  it("フローズンフィクスチャと defaultText が完全一致する (転記ミス検出、frozen fixture 方式)", () => {
    const registryKeys = new Set(TEXT_REGISTRY.map((s) => s.key));
    const fixtureKeys = new Set(Object.keys(FROZEN_DEFAULT_TEXT));
    // 双方向: フィクスチャにあって registry に無い/その逆を両方検出する
    expect(fixtureKeys).toEqual(registryKeys);

    for (const slot of TEXT_REGISTRY) {
      expect(slot.defaultText, `${slot.key} の defaultText がフィクスチャと不一致`).toBe(
        FROZEN_DEFAULT_TEXT[slot.key],
      );
    }
  });

  it("page_media SLOT_REGISTRY (画像) との key 交差はゼロである (PLAN.md §1.4)", () => {
    const imageKeys = new Set(SLOT_REGISTRY.map((s) => s.key));
    const textKeys = TEXT_REGISTRY.map((s) => s.key);
    const overlap = textKeys.filter((k) => imageKeys.has(k));
    expect(overlap).toEqual([]);
  });
});

describe("isValidTextSlotKey / textSlotByKey / textSlotsForRoute", () => {
  it("isValidTextSlotKey: registry に存在するキーのみ true", () => {
    expect(isValidTextSlotKey("home.statement.heading")).toBe(true);
    expect(isValidTextSlotKey("home.nonexistent")).toBe(false);
  });

  it("textSlotByKey: 存在しないキーは undefined", () => {
    expect(textSlotByKey("home.statement.heading")?.key).toBe("home.statement.heading");
    expect(textSlotByKey("home.nonexistent")).toBeUndefined();
  });

  it("textSlotsForRoute: 指定した route のスロットのみ返す", () => {
    const homeSlots = textSlotsForRoute("/");
    expect(homeSlots.length).toBeGreaterThan(0);
    expect(homeSlots.every((s) => s.route === "/")).toBe(true);

    const shopSlots = textSlotsForRoute("/shop");
    expect(shopSlots.map((s) => s.key)).toContain("shop.simulator.cta");
  });

  it("textSlotsForRoute: 未知の route は空配列", () => {
    expect(textSlotsForRoute("/nonexistent")).toEqual([]);
  });
});

describe("TEXT_REGISTRY_HASH", () => {
  it("TEXT_REGISTRY の JSON 内容を sha1 したものと一致する (build 時計算の再現性)", () => {
    const recomputed = createHash("sha1").update(JSON.stringify(TEXT_REGISTRY)).digest("hex");
    expect(TEXT_REGISTRY_HASH).toBe(recomputed);
  });

  it("registry の内容が変われば、2 つの入力に対するハッシュは異なる", () => {
    const a = createHash("sha1").update(JSON.stringify(TEXT_REGISTRY)).digest("hex");
    const mutated = TEXT_REGISTRY.map((s, i) =>
      i === 0 ? { ...s, label: `${s.label} (mutated for test)` } : s,
    );
    const b = createHash("sha1").update(JSON.stringify(mutated)).digest("hex");
    expect(a).not.toBe(b);
  });
});

describe("resolveMaxLineLen", () => {
  it("maxLineLen が明示されていればそれを返す", () => {
    const slot: PageTextSlot = {
      key: "test.a",
      page: "test",
      route: "/",
      label: "test",
      kind: "lines",
      maxLen: 100,
      defaultText: "a\nb",
      maxLines: 2,
      maxLineLen: 30,
    };
    expect(resolveMaxLineLen(slot)).toBe(30);
  });

  it("maxLineLen 未指定なら Math.floor(maxLen / maxLines) を返す", () => {
    const slot: PageTextSlot = {
      key: "test.b",
      page: "test",
      route: "/",
      label: "test",
      kind: "lines",
      maxLen: 45,
      defaultText: "a\nb",
      maxLines: 2,
    };
    expect(resolveMaxLineLen(slot)).toBe(22);
  });

  it("maxLines も maxLineLen も未指定なら undefined (1 行制約なし)", () => {
    const slot: PageTextSlot = {
      key: "test.c",
      page: "test",
      route: "/",
      label: "test",
      kind: "text",
      maxLen: 20,
      defaultText: "a",
    };
    expect(resolveMaxLineLen(slot)).toBeUndefined();
  });
});

describe("validateSlotText", () => {
  const linesSlot: PageTextSlot = {
    key: "test.lines",
    page: "test",
    route: "/",
    label: "test",
    kind: "lines",
    maxLen: 20,
    defaultText: "aa\nbb",
    maxLines: 2,
    maxLineLen: 8,
  };
  const textSlot: PageTextSlot = {
    key: "test.text",
    page: "test",
    route: "/",
    label: "test",
    kind: "text",
    maxLen: 10,
    defaultText: "hello",
  };
  const multilineSlotWithCap: PageTextSlot = {
    key: "test.multiline",
    page: "test",
    route: "/",
    label: "test",
    kind: "multiline",
    maxLen: 100,
    defaultText: "para1",
    maxLines: 2, // 段落数上限 (v1 の registry では未使用だが機能としては検証する)
  };
  // v2 Wave 0f: kind="rich" 専用の検証 (docs/design/visual-text-editor-v2.md §3.3)。
  const richSlot: PageTextSlot = {
    key: "test.rich",
    page: "test",
    route: "/",
    label: "test",
    kind: "rich",
    maxLen: 30,
    defaultText: "`#800`で研ぎます。",
  };
  const richSlotWithCap: PageTextSlot = {
    key: "test.rich.cap",
    page: "test",
    route: "/",
    label: "test",
    kind: "rich",
    maxLen: 100,
    defaultText: "para1",
    maxLines: 2, // 段落数上限 (multiline と同基準)
  };

  it("maxLen 以内・kind 違反なしなら issues は空", () => {
    expect(validateSlotText(textSlot, "hi")).toEqual([]);
    expect(validateSlotText(linesSlot, "a\nb")).toEqual([]);
  });

  it("maxLen 超過を検出する", () => {
    expect(validateSlotText(textSlot, "12345678901")).not.toEqual([]);
  });

  it("kind=text で改行を含めると拒否する", () => {
    expect(validateSlotText(textSlot, "a\nb")).not.toEqual([]);
  });

  it("kind=lines で行数超過を検出する", () => {
    expect(validateSlotText(linesSlot, "a\nb\nc")).not.toEqual([]);
  });

  it("kind=lines で 1 行文字数超過 (maxLineLen) を検出する", () => {
    expect(validateSlotText(linesSlot, "123456789\nb")).not.toEqual([]);
  });

  it("kind=lines で境界値 (maxLineLen ちょうど) は許可する", () => {
    expect(validateSlotText(linesSlot, "12345678\nb")).toEqual([]);
  });

  it("kind=multiline で maxLines (段落数) が設定されていれば段落数超過を検出する", () => {
    expect(validateSlotText(multilineSlotWithCap, "p1\n\np2\n\np3")).not.toEqual([]);
    expect(validateSlotText(multilineSlotWithCap, "p1\n\np2")).toEqual([]);
  });

  // v1.3 tester 検証ギャップ対応 (MEDIUM): 空文字列 / 空白のみは拒否する
  it("空文字列は kind によらず拒否する", () => {
    expect(validateSlotText(textSlot, "")).not.toEqual([]);
    expect(validateSlotText(linesSlot, "")).not.toEqual([]);
    expect(validateSlotText(multilineSlotWithCap, "")).not.toEqual([]);
  });

  it("空白のみ (trim 後に空、半角/全角スペース) は拒否する", () => {
    expect(validateSlotText(textSlot, "   ")).not.toEqual([]);
    expect(validateSlotText(textSlot, "　　　")).not.toEqual([]); // 全角スペースのみ
  });

  it("前後に空白を含むが trim 後に非空なら許可する (下限チェックのみの観点)", () => {
    expect(validateSlotText(textSlot, "  hi  ")).toEqual([]);
  });

  // v2 Wave 0f: kind="rich" 分岐 (docs/design/visual-text-editor-v2.md §3.3)
  it("kind=rich は maxLen 以内・マークアップ記号込みの raw 長で判定し issues は空", () => {
    expect(validateSlotText(richSlot, "`#800`で研ぎます。")).toEqual([]);
  });

  it("kind=rich は raw 長 (マークアップ記号込み) で maxLen 超過を検出する", () => {
    // マークアップ記号を含めて 30 字を超える入力
    const over = "`" + "あ".repeat(29) + "`"; // 31 字 (バッククォート込み)
    expect(validateSlotText(richSlot, over)).not.toEqual([]);
  });

  it("kind=rich は改行を含めても拒否しない (kind=text と異なり multiline 相当)", () => {
    expect(validateSlotText(richSlot, "1行目\n2行目")).toEqual([]);
  });

  it("kind=rich は maxLines (段落数) が設定されていれば multiline と同基準で段落数超過を検出する", () => {
    expect(validateSlotText(richSlotWithCap, "p1\n\np2\n\np3")).not.toEqual([]);
    expect(validateSlotText(richSlotWithCap, "p1\n\np2")).toEqual([]);
  });

  it("kind=rich は maxLines 未設定なら段落数を制限しない", () => {
    expect(validateSlotText(richSlot, "p1\n\np2\n\np3\n\np4")).toEqual([]);
  });

  it("kind=rich は未対応マーカー (奇数個のバッククォート/**) をエラーにしない (パーサがリテラル安全描画するため)", () => {
    expect(validateSlotText(richSlot, "これは`未閉じです")).toEqual([]);
    expect(validateSlotText(richSlot, "これは**未閉じです")).toEqual([]);
  });

  it("kind=rich も空文字列 (空白のみ) は拒否する", () => {
    expect(validateSlotText(richSlot, "")).not.toEqual([]);
    expect(validateSlotText(richSlot, "   ")).not.toEqual([]);
  });
});

describe("normalizeLineEndings (v1.3 tester 検証ギャップ対応: CRLF 正規化)", () => {
  it("\\r\\n (CRLF) を \\n (LF) に統一する", () => {
    expect(normalizeLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("単独の \\r (CR、旧 Mac 改行) も \\n に統一する", () => {
    expect(normalizeLineEndings("a\rb\rc")).toBe("a\nb\nc");
  });

  it("既に \\n のみのテキストは変化しない", () => {
    expect(normalizeLineEndings("a\nb\nc")).toBe("a\nb\nc");
  });

  it("改行を含まないテキストは変化しない", () => {
    expect(normalizeLineEndings("hello")).toBe("hello");
  });

  it("CRLF と単独 CR が混在していてもすべて \\n に統一する", () => {
    expect(normalizeLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
