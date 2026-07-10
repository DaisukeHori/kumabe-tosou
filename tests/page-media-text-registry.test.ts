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
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): 全 13 ページ + 共通 (shared/chrome) の
// 残テキストを並列ウェーブで段階的に配線し、最終的に全ページの静的テキストを網羅した。
// ページ別内訳 (2026-07-11 実測、TEXT_REGISTRY.length をスクリプトで機械的に集計):
//   shared=1, chrome=60, home=120, story=64, about=71, service=136, process=110,
//   materials=104, colors=84, shop=143, notes=13, contact=73, works=14, voices=12,
//   tokushoho=34, privacy=22 → 合計 1061 件。
//
// tokushoho (特定商取引法に基づく表記) / privacy (プライバシーポリシー) の 2 法定ページは
// 当初 docs/design/text-slots/rest-chrome.md で「法定ページ全文は tier C (編集不可)」と
// 確定していたが、ユーザー指示「全部の文字を変更できることが大事です」を受けて v2 で方針
// 転換し、他ページと同じ粒度 (SpecTable の th/td・小活字注記単位まで) で全文を編集可能スロット
// 化した (rest-chrome.md 側にも本方針転換の経緯を追記済み。旧 tier C 判定の記述は残しつつ
// 上書きされたことを明記)。
const EXPECTED_COUNT = 1061;

const FROZEN_DEFAULT_TEXT: Readonly<Record<string, string>> = {
  "shared.cta.consult": "相談する",

  "chrome.footer.tagline": "3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。",
  "common.header.brand": "隈部塗装",
  "common.header.brand.en": "KUMABE TOSO",
  "common.header.nav.1.no": "01",
  "common.header.nav.1.label": "ストーリー",
  "common.header.nav.2.no": "02",
  "common.header.nav.2.label": "会社案内",
  "common.header.nav.3.no": "03",
  "common.header.nav.3.label": "サービス・料金",
  "common.header.nav.4.no": "04",
  "common.header.nav.4.label": "施工事例",
  "common.header.nav.5.no": "05",
  "common.header.nav.5.label": "お客様の声",
  "common.header.nav.6.no": "06",
  "common.header.nav.6.label": "素材対応",
  "common.header.nav.7.no": "07",
  "common.header.nav.7.label": "色見本",
  "common.header.nav.8.no": "08",
  "common.header.nav.8.label": "読みもの",
  "common.header.nav.9.no": "09",
  "common.header.nav.9.label": "SHOP",
  "common.footer.marquee.1": "研磨 · 塗装 · 3Dプリント表面処理",
  "common.footer.marquee.2": "NATIONWIDE MAIL-IN",
  "common.footer.marquee.3": "OITA BUNGOTAKADA",
  "common.footer.marquee.4": "試作1点 — ブリッジ生産1,000個",
  "common.footer.nav.1.no": "00",
  "common.footer.nav.1.label": "ホーム",
  "common.footer.nav.2.no": "01",
  "common.footer.nav.2.label": "ストーリー",
  "common.footer.nav.3.no": "02",
  "common.footer.nav.3.label": "会社案内",
  "common.footer.nav.4.no": "03",
  "common.footer.nav.4.label": "サービス・料金",
  "common.footer.nav.5.no": "04",
  "common.footer.nav.5.label": "施工事例",
  "common.footer.nav.6.no": "05",
  "common.footer.nav.6.label": "お客様の声",
  "common.footer.nav.7.no": "06",
  "common.footer.nav.7.label": "工程",
  "common.footer.nav.8.no": "07",
  "common.footer.nav.8.label": "素材対応",
  "common.footer.nav.9.no": "08",
  "common.footer.nav.9.label": "色見本",
  "common.footer.nav.10.no": "09",
  "common.footer.nav.10.label": "読みもの",
  "common.footer.nav.11.no": "10",
  "common.footer.nav.11.label": "SHOP",
  "common.footer.nav.12.no": "11",
  "common.footer.nav.12.label": "相談する",
  "common.footer.sitemap.label": "SITEMAP",
  "common.footer.workshop.label": "WORKSHOP",
  "common.footer.legal.label": "LEGAL",
  "common.footer.brand": "隈部塗装",
  "common.footer.address": "隈部塗装(代表: 隈部 信之)\n大分県豊後高田市\n郵送受託・全国対応",
  "common.footer.legal.tokushoho": "特定商取引法に基づく表記",
  "common.footer.legal.privacy": "プライバシーポリシー",
  "common.footer.giant": "KUMABE TOSO",
  "common.footer.copyright": "© 2026 KUMABE TOSO. ALL RIGHTS RESERVED.",
  "common.footer.copyright.sub": "3D PRINT SURFACE FINISHING — OITA, JAPAN",
  "common.footer.creditNote": "掲載写真は Unsplash の商用利用可能なイメージ素材で、各写真のクレジットはキャプションに記載しています。これらは隈部塗装の工房・制作事例の写真ではなく、あくまでイメージです(実際の写真は準備中)。",

  "home.statement.heading": "デザインモデルの品質は、\n表面処理で決まる。\nそれでも、表面処理を高い水準で\n内製できる会社は、多くない。\nその空白のために、この工房がある。",
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
  "home.hero.index": "INDEX 00 — HOME",
  "home.hero.en": "SURFACE FINISHING FOR 3D PRINTS",
  "home.hero.heading": "3Dプリントを、\n量産品と見分けがつかない\n外観に。",
  "home.hero.lead": "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。家電の量産塗装で「量産の精度」を磨いた自動車塗装職人が、勝負試作の一点からブリッジ生産の千個まで、郵送で全国からお受けします。",
  "home.hero.cta.1": "SHOPで概算を出す",
  "home.hero.cta.2": "8色の色見本を見る",
  "home.hero.cta.3": "サービス・料金",
  "home.hero.photo.capja": "自動車グレードの塗装が、造形物の最終工程になる。",
  "home.hero.photo.capen": "AUTOMOTIVE-GRADE FINISH",
  "home.hero.photo.credit": "Photo: cmreflections / Unsplash",
  "home.statement.label": "STATEMENT",
  "home.statement.body": "塗装はできても積層痕を知らない塗装店。造形はできても、仕上げは単色止まりの出力サービス。金型を作らない少量生産の最大の弱点は「積層痕のある外観」——それを解決する最終工程こそが、この市場の付加価値の在り処です。",
  "home.statement.cta": "なぜこの工房を始めたのか",
  "home.craft.label": "CRAFT",
  "home.craft.card.1.no": "CRAFT 01",
  "home.craft.card.2.no": "CRAFT 02",
  "home.craft.card.3.no": "CRAFT 03",
  "home.craft.card.1.body": "3Dプリント特有の縞を #800 まで面で研ぎ落とし、プラサフで埋め、#1200 で仕上げる。塗装の出来の大半は、この下地で決まります。",
  "home.craft.card.2.body": "2液ウレタンクリアは、吹きっぱなしで自動車外板と同等の艶が出ます。鏡面磨きに時間を使わないから、品質を揺らさずに数を仕上げられます。",
  "home.craft.card.3.body": "ベース＋パール＋クリアの3層構造。ホワイトパールやソウルレッドなど、経験がそのまま出る高難度の意匠塗装に対応します。",
  "home.craft.cta.1": "全9工程を見る",
  "home.craft.cta.2": "工房と職人について",
  "home.craft.1.capja": "研ぎの手",
  "home.craft.1.capen": "SANDING & PREP",
  "home.craft.1.credit": "Photo: mazinomron / Unsplash",
  "home.craft.2.capja": "吹き付けの手",
  "home.craft.2.capen": "SPRAY APPLICATION",
  "home.craft.2.credit": "Photo: createasea / Unsplash",
  "home.craft.3.capja": "仕上がりの艶",
  "home.craft.3.capen": "THE FINISH",
  "home.craft.3.credit": "Photo: avenir_visuals / Unsplash",
  "home.colorlineup.label": "COLOR LINEUP",
  "home.colorlineup.lead": "8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。",
  "home.colorlineup.swatch.1.code": "TOYOTA 090 / 3COAT",
  "home.colorlineup.swatch.1.name": "プレシャスホワイトパール",
  "home.colorlineup.swatch.1.note": "実績納品色",
  "home.colorlineup.swatch.2.code": "MAZDA 46V / 3COAT",
  "home.colorlineup.swatch.2.name": "ソウルレッドクリスタル",
  "home.colorlineup.swatch.2.note": "最高難度の技術証明",
  "home.colorlineup.swatch.3.code": "TOYOTA 4Y6 / METALLIC",
  "home.colorlineup.swatch.3.name": "プレシャスブロンズ",
  "home.colorlineup.swatch.3.note": "現行クラウンの上品な茶",
  "home.colorlineup.swatch.4.code": "TOYOTA 3T4 / 3COAT",
  "home.colorlineup.swatch.4.name": "ピンクサファイア",
  "home.colorlineup.swatch.4.note": "全国650台限定の伝説色",
  "home.colorlineup.swatch.5.code": "TOYOTA 202 / SOLID",
  "home.colorlineup.swatch.5.name": "ブラック",
  "home.colorlineup.swatch.5.note": "最難関ソリッド黒",
  "home.colorlineup.swatch.6.code": "NISSAN TV2 / 3COAT",
  "home.colorlineup.swatch.6.name": "ベイサイドブルー",
  "home.colorlineup.swatch.6.note": "R34 GT-Rの代名詞",
  "home.colorlineup.swatch.7.code": "ASTON MARTIN AM9539",
  "home.colorlineup.swatch.7.name": "レーシンググリーン",
  "home.colorlineup.swatch.7.note": "英国の象徴色",
  "home.colorlineup.swatch.8.code": "MAZDA 46G / METALLIC",
  "home.colorlineup.swatch.8.name": "マシーングレー",
  "home.colorlineup.swatch.8.note": "匠塗のもう一枚の看板",
  "home.colorlineup.cta": "色見本を一枚ずつ見る",
  "home.colorlineup.hint": "DRAG / SCROLL →",
  "home.twoscenes.label": "TWO SCENES",
  "home.twoscenes.scene.1.unit": "PIECES / 勝負試作",
  "home.twoscenes.scene.2.unit": "PIECES / ブリッジ生産",
  "home.twoscenes.scene.1.body": "企業トップへの最終プレゼン、重要商談、展示会、クラウドファンディングの掲載写真。「絶対に外せない場面」で使う高品質試作を、量産品の顔に仕上げます。",
  "home.twoscenes.scene.2.body": "クラウドファンディングのリターン品、D2Cの初回ロット、産業機器の筐体。金型なしの少量生産を「量産品の見た目」にする最終工程を担います。",
  "home.twoscenes.body": "試作を仕上げたその手で、量産も仕上げる。クラウドファンディング達成の瞬間に「試作と同じ品質で数百個できます」と言える供給者は、ほとんどいません。",
  "home.stats.label": "BY THE NUMBERS",
  "home.stats.stat.1.unit": "本",
  "home.stats.stat.1.label": "バンパー同時塗装",
  "home.stats.stat.1.en": "SIMULTANEOUS BUMPERS",
  "home.stats.stat.1.note": "この同時処理能力があるから、小物なら100個超を一度に。数量対応力は、そのまま価格に還元されます。",
  "home.stats.stat.2.label": "段階研磨の番手",
  "home.stats.stat.2.en": "PROGRESSIVE GRIT",
  "home.stats.stat.2.note": "粗い番手から徐々に上げる段階研磨。海外の現場で「射出成形品と見分けがつかない」とされる面の基準です。",
  "home.stats.stat.3.unit": "色",
  "home.stats.stat.3.label": "名車の象徴色ラインナップ",
  "home.stats.stat.3.en": "SIGNATURE COLORS",
  "home.stats.stat.3.note": "うち5色が3コート・高難度系。ソウルレッドもベイサイドブルーも、塗れること自体が技術の証明です。",
  "home.stats.stat.4.label": "対応数量（点）",
  "home.stats.stat.4.en": "PIECES PER ORDER",
  "home.stats.stat.4.note": "勝負試作の一点から、ブリッジ生産の千個まで。試作と量産を、同じ品質基準で仕上げます。",
  "home.stats.stat.5.unit": "時間",
  "home.stats.stat.5.label": "最高級の黒が下地にかける時間",
  "home.stats.stat.5.en": "CENTURY \"KAMUI\" BLACK",
  "home.stats.stat.5.note": "名車センチュリーの黒は、塗装だけで約40時間・水研ぎ3回。その下地への敬意を、すべての仕事に持ち込みます。",
  "home.stats.stat.6.unit": "日",
  "home.stats.stat.6.label": "2液ウレタン完全硬化",
  "home.stats.stat.6.en": "FULL CURE",
  "home.stats.stat.6.note": "主剤と硬化剤の化学反応で硬く艶やかに。硬化を待ち、検品してから発送します。急がば、回る。",
  "home.materials.label": "MATERIALS",
  "home.materials.body": "造形方式が違えば、積層痕の出方も塗料の乗り方も変わります。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む。PLA・PETG・ABS・ASA、各種レジン、ナイロンまで、素材別の勘所をまとめています。",
  "home.materials.cta": "素材別の対応を見る",
  "home.notes.label": "NOTES",
  "home.notes.body": "工程と色の裏側を、読みものとして残しています。センチュリーの黒が水研ぎ3回である理由。ディーラーでも同色にならない赤の構造。専門性は、言葉にしてはじめて伝わります。",
  "home.notes.cta": "読みものを開く",
  "home.gallery.label": "IN THE WORKSHOP",
  "home.gallery.body": "研ぎ、吹き、仕上げる。派手さのない手仕事の断片を。",
  "home.gallery.1.capja": "手を動かす",
  "home.gallery.1.capen": "HANDS AT WORK",
  "home.gallery.1.credit": "Photo: claritycoat / Unsplash",
  "home.gallery.2.capja": "段取り",
  "home.gallery.2.capen": "THE TOOLING",
  "home.gallery.2.credit": "Photo: volft / Unsplash",
  "home.gallery.3.capja": "精度",
  "home.gallery.3.capen": "THE MACHINERY",
  "home.gallery.3.credit": "Photo: kadircelep / Unsplash",

  "story.hero.heading": "なぜ、積層痕と\n戦うことにしたのか。",
  "story.hero.lead": "家電の量産塗装で長年腕を磨いた職人が、どうして3Dプリントの表面処理という、まだ名前もない仕事に専念することにしたのか。一本の相談から始まった、下地をめぐる物語です。",
  "story.message.heading": "「見えなくなる仕事」に、\n誇りを持っています。",
  "story.cta.heading": "物語の続きは、\nあなたの造形物で。",
  "story.cta.note": "「絶対に外せない一個」を、量産品の顔に。まずはお気軽にご相談ください。",
  "story.hero.index": "INDEX 01 — STORY",
  "story.hero.en": "WHY THIS WORKSHOP EXISTS",
  "story.chapter1.no": "CHAPTER 01",
  "story.chapter1.title": "毎日、同じ色を、\n同じ艶で。",
  "story.chapter1.en": "The Ordinary Days",
  "story.chapter1.photo.capja": "均一に、正確に。それが量産塗装の日常だった。",
  "story.chapter1.photo.capen": "THE DISCIPLINE",
  "story.chapter1.photo.credit": "Photo: cmreflections / Unsplash",
  "story.chapter1.body.1": "隈部塗装を始める前、隈部信之の一日は、色に始まり、色に終わっていました。持ち場は、家電の量産塗装。工場のラインを流れてくる筐体に、決められた色を、決められた膜厚で、来る日も来る日も吹き付ける。一個目と一万個目が、寸分違わぬ艶であること。それが、その仕事に求められる唯一のことでした。",
  "story.chapter1.body.2": "派手さはありません。誰かに褒められる仕事でもない。塗り上がった製品は、当たり前の顔をして箱に詰められ、家電量販店の棚に並び、誰かの家のリビングに置かれる。その表面が均一で美しいことに、気づく人はいません。**気づかれないことこそが、量産塗装の完成形**だからです。",
  "story.chapter1.body.3": "けれど、毎日同じ色を塗り続けるうちに、体は覚えていきました。塗料がどう流れ、どう乾き、どの距離でどう乗るのか。均一な膜をつくる手つき。段取りの組み方。治具の使い方。それは、一点ものを美しく塗る技術とは、まったく別の筋肉でした。**「同じ品質で、数を仕上げる」——量産の精度**が、いつのまにか体に染み込んでいたのです。",
  "story.chapter2.no": "CHAPTER 02",
  "story.chapter2.title": "その造形物には、\n縞があった。",
  "story.chapter2.en": "The Call",
  "story.chapter2.photo.capja": "造形はできる。だが、その先の仕上げに空白があった。",
  "story.chapter2.photo.capen": "AWAITING ITS FINISH",
  "story.chapter2.photo.credit": "Photo: claritycoat / Unsplash",
  "story.chapter2.body.1": "きっかけは、知人からの一本の相談でした。手のひらにのる、樹脂の造形物。3Dプリンターで出力したという、ある製品の試作。手に取ると、表面にうっすらと横縞が走っていました。層を積み重ねてつくる、3Dプリント特有の跡——積層痕です。",
  "story.chapter2.body.2": "「これ、量産品みたいに綺麗に塗れませんか」。知人は言いました。そして、続けた言葉が、隈部の胸に刺さりました。",
  "story.chapter2.quote": "「塗装をやってくれる店はあるんです。でも、この積層痕を分かってる人がいない。造形はできても、仕上げは単色止まり。誰も、最後の一歩をやってくれないんですよ」",
  "story.chapter2.quote.cite": "— ある試作の相談者の言葉",
  "story.chapter2.body.3": "その瞬間、隈部は気づきました。塗装はできても3Dプリントの下地を知らない塗装店。造形はできても仕上げは苦手な出力サービス。その二つの**あいだにぽっかり空いた空白**——そこに必要なものは、自分が毎日やっていることそのものだ、と。均一に、正確に、数を美しく塗る。量産塗装の精度こそが、この新しい世界に決定的に欠けているものでした。",
  "story.chapter3.no": "CHAPTER 03",
  "story.chapter3.title": "樹脂は、\n鉄板とは違った。",
  "story.chapter3.en": "The Trials",
  "story.chapter3.photo.capja": "研いでは吹き、吹いては削る。",
  "story.chapter3.photo.capen": "TRIAL & ERROR",
  "story.chapter3.photo.credit": "Photo: mazinomron / Unsplash",
  "story.chapter3.body.1": "思い立ってすぐ、うまくいったわけではありません。自動車の鉄板と、3Dプリントの樹脂は、まるで別物でした。素材ごとに塗料の食いつきが違う。溶剤に弱いものもある。そして何より——**積層痕は、塗料をいくら重ねても消えない**。厚く吹けば、細かな造形ディテールが埋まってしまう。塗るほどに、縞は醜く浮かび上がることさえありました。",
  "story.chapter3.body.2": "テストピースを、何枚も塗りました。研いでは吹き、吹いては削り。失敗した造形物が、作業台の隅に積み上がっていきました。洗浄が甘ければ塗料が弾き、脱脂を怠ればムラが出る。3Dプリントの塗装には、模型とも、クルマとも違う、独自の勘所があったのです。",
  "story.chapter3.body.3": "それでも、手を動かし続けました。なぜなら、あの言葉が忘れられなかったから。「誰も、最後の一歩をやってくれない」。ならば、自分がやる。試行錯誤の日々は、地味で、報われるかも分からないものでした。けれど職人は、うまくいかない理由を一つずつ潰していくことを、苦だとは思わないのです。",
  "story.chapter4.no": "CHAPTER 04",
  "story.chapter4.title": "答えは、毎日やっていた\n下地にあった。",
  "story.chapter4.en": "The Revelation",
  "story.chapter4.photo.capja": "量産品と、見分けがつかない。",
  "story.chapter4.photo.capen": "INDISTINGUISHABLE",
  "story.chapter4.photo.credit": "Photo: avenir_visuals / Unsplash",
  "story.chapter4.body.1": "転機は、ある一枚のテストピースでした。積層痕を `#800` の紙やすりで面ごと研ぎ落とし、プラサフを厚めに吹いて微細な段差を埋め、`#1200` で水研ぎをかける。それは、自動車補修の現場で当たり前にやっている、ごく basic な下地の作り方でした。その上に塗料を乗せたとき——縞は、跡形もなく消えていました。",
  "story.chapter4.body.2": "答えは、遠くにはありませんでした。**毎日やっていた「下地」の中に、ずっとあった**のです。塗装の出来の大半は、塗る前の下地で決まる。自動車塗装が何十年もかけて磨いてきたこの原則は、そのまま3Dプリントの積層痕にも効いた。縞を消すのは、塗料ではなく、研ぎだったのです。",
  "story.chapter4.quote": "量産品と、見分けがつかない。\n金型を使わずに、金型で成形したような顔をつくる。",
  "story.chapter4.body.3": "試作の一個も、量産の千個も、同じ品質で。それは、一点を美しく塗る技術と、数を均一に仕上げる技術——その両方を持つ、**量産塗装職人にしかできない仕事**でした。あの空白に、ぴたりと嵌まる形が、ようやく見つかった瞬間でした。",
  "story.chapter5.no": "CHAPTER 05",
  "story.chapter5.title": "大分から、\nあなたの一個へ。",
  "story.chapter5.en": "The Return",
  "story.chapter5.photo.capja": "大分から、あなたの一個へ。",
  "story.chapter5.photo.capen": "THE BEGINNING",
  "story.chapter5.photo.credit": "Photo: aaronburden / Unsplash",
  "story.chapter5.body.1": "こうして、隈部塗装は始まりました。大分県豊後高田市の、小さな工房。乗用車のバンパーを6本同時に塗れるブースで、あなたの造形物を、量産品の顔に仕上げます。手のひらサイズの小物なら、郵送の送料はごくわずか。地方の工房であることは、もうハンデではありません。",
  "story.chapter5.body.2": "企業トップへの最終プレゼン。展示会。クラウドファンディングの一枚の写真。あるいは、金型を作らない少量生産の、初回ロット。**「絶対に外せない一個」**が、世の中にはたくさんあります。その一個を、量産品と見分けがつかない外観に仕上げること。それが、この工房の仕事です。",
  "story.chapter5.body.3": "本当のことを言えば、この物語がどこまで劇的だったかは、大した問題ではありません。大切なのは、いま目の前にある造形物を、どこまで美しく仕上げられるか。その一点だけです。**下地に、誠実に。**——それが、隈部塗装のすべてです。",
  "story.message.eyebrow": "MESSAGE — 代表挨拶",
  "story.message.body.1": "私は、塗装職人です。長く家電の量産塗装に携わり、来る日も来る日も、同じ色を同じ艶で塗ってきました。その中で身についたのは、「同じ品質で、数を仕上げる」という、量産の精度です。",
  "story.message.body.2": "3Dプリントの世界に足を踏み入れて分かったのは、この技術を必要としている人が、たしかにいるということでした。造形はできる。でも、量産品のように美しく仕上げる最後の一歩で、みんなが困っている。だったら、私がやろう。そう思って、この工房を始めました。",
  "story.message.body.3": "塗装の出来は、塗る前の下地で決まります。研磨し、埋め、また研ぐ。仕上がった塗面には、その苦労は一切見えません。**見えなくなるからこそ、そこに手を抜かない。**それが職人の矜持だと思っています。",
  "story.message.body.4": "あなたの大切な造形物を、量産品と見分けがつかない外観に。その一個に、私の持てる技術のすべてを注ぎます。どうぞ、安心してお預けください。",
  "story.message.role": "隈部塗装 代表 / 塗装職人",
  "story.message.name": "隈部 信之",
  "story.portrait.initial": "信之",
  "story.portrait.caption": "PORTRAIT — COMING SOON",

  "about.hero.heading": "下地の仕事は、\n見えなくなるからこそ。",
  "about.hero.lead": "仕上がった塗面に、研ぎの跡は残りません。それでも、艶の深さも、色の正確さも、すべては見えなくなった下地が決めています。隈部塗装は、その見えない工程に最も時間を割く工房です。",
  "about.why.heading": "「表面処理だけ頼みたい」に、\n応える工房が少なかった。",
  "about.facility.heading": "バンパー6本を、同時に塗れる。",
  "about.gallery.heading": "現場の、手ざわり。",
  "about.cta.heading": "工程と料金の詳細は、\nサービスページに。",
  "about.cta.note": "下地は全グレード共通。差分はトップコートの層数だけです。",
  "about.hero.index": "INDEX 02 — ABOUT",
  "about.hero.en": "WORKSHOP & CRAFTSMAN",
  "about.why.sec.label": "WHY THIS WORKSHOP",
  "about.why.table.1.th": "大手3Dプリント業者",
  "about.why.table.1.td": "塗装は後加工オプション扱いで、多くは黒塗装・単色止まり。カスタム塗装は手動見積もりで、3コートパール等の高難度意匠塗装は稀。",
  "about.why.table.2.th": "一般の塗装店",
  "about.why.table.2.td": "塗装はできても、3Dプリント特有の積層痕処理を知らない。素材との相性や下地の作り方に、専用のノウハウが要ります。",
  "about.why.table.3.th": "試作会社",
  "about.why.table.3.td": "デザインモデルの品質は表面処理で決まるにもかかわらず、表面処理を高水準で内製できる会社は少なく、「表面処理だけ外注したい」需要が存在します。",
  "about.why.table.4.th": "隈部塗装",
  "about.why.table.4.td": "**積層痕を消す研磨・自動車グレードの艶・3コートパールの意匠。3つ全部をひとりで持ち、その空白に正確に嵌まります。**海外では、顧客の試作品の仕上げ・塗装だけを専門に請け負うサービスが成立しており、世界大手の3Dプリンタメーカーも自動車塗装業者との協業事例を公開しています。「3Dプリント × 自動車塗装職人」は、業界の理想像そのものです。",
  "about.craftsman.sec.label": "CRAFTSMAN",
  "about.craftsman.name": "隈部 信之",
  "about.craftsman.romaji": "KUMABE NOBUYUKI — REPRESENTATIVE / PAINTER",
  "about.craftsman.bio.1": "家電の量産塗装の現場で、均一な膜厚管理・治具化・段取りを積み重ねてきた自動車塗装職人。「量産の精度」を体に入れ、いまはその技術のすべてを、3Dプリントの表面処理に注いでいます。",
  "about.craftsman.bio.2": "一点ものを美しく塗ることと、同じ品質で数を仕上げることは、別の技術です。量産塗装の現場は、後者を毎日要求します。だから、あなたの一点の勝負試作と、千個のブリッジ生産を、同じ品質基準で仕上げられます。",
  "about.facility.sec.label": "FACILITY",
  "about.facility.lead": "同時処理能力は、そのまま数量対応力と価格に反映されます。面を埋めるほど1個あたりの手間は下がる——バッチ処理は、この工房の価格競争力の源泉です。",
  "about.facility.table.1.th": "塗装ブース",
  "about.facility.table.1.td": "乗用車のバンパー**6本**を同時に塗装できる常設ブース。",
  "about.facility.table.2.th": "バッチ処理能力",
  "about.facility.table.2.td": "**200×200mm級 — 約30個** / **30×200mm級 — 100個超** を同時処理。",
  "about.facility.table.3.th": "塗料システム",
  "about.facility.table.3.td": "自動車補修用2液ウレタン（主剤＋硬化剤の化学反応で常温硬化）。市販の調色済み補修塗料を正規用途で使用。",
  "about.facility.table.4.th": "硬化",
  "about.facility.table.4.td": "常温硬化（表面乾燥1〜3時間 / 完全硬化5〜7日）。赤外線ヒーターは納期短縮・回転率向上の道具として小〜中型に併用。",
  "about.facility.table.5.th": "安全管理",
  "about.facility.table.5.td": "塗装作業中（溶剤蒸気がある間）の火気は厳禁。石油燃焼機器の使用は、塗装後に換気を経てからの雰囲気加熱に限定しています。",
  "about.facility.1.capja": "吹き付けの設備",
  "about.facility.1.capen": "SPRAY EQUIPMENT",
  "about.facility.1.credit": "Photo: kagan_4854 / Unsplash",
  "about.facility.2.capja": "整然と並ぶ工具",
  "about.facility.2.capen": "THE TOOLING",
  "about.facility.2.credit": "Photo: volft / Unsplash",
  "about.facility.3.capja": "工房の機械",
  "about.facility.3.capen": "THE MACHINERY",
  "about.facility.3.credit": "Photo: kadircelep / Unsplash",
  "about.profile.sec.label": "PROFILE",
  "about.profile.heading": "会社概要",
  "about.profile.table.1.th": "屋号",
  "about.profile.table.1.td": "隈部塗装（くまべとそう）",
  "about.profile.table.2.th": "代表",
  "about.profile.table.2.td": "隈部 信之",
  "about.profile.table.3.th": "所在地",
  "about.profile.table.3.td": "大分県豊後高田市",
  "about.profile.table.4.th": "事業内容",
  "about.profile.table.4.td": "3Dプリント造形物の表面処理（研磨・塗装）／家電の量産塗装",
  "about.profile.table.5.th": "対応エリア",
  "about.profile.table.5.td": "全国（郵送受託）。主戦場は手のひら〜200×200mm級の小〜中型品。",
  "about.profile.table.6.th": "受付窓口",
  "about.profile.table.6.td": "準備中（先行のご相談は紹介経由で承っています）",
  "about.location.sec.label": "LOCATION",
  "about.location.heading": "大分県豊後高田市",
  "about.location.lead": "郵送受託が基本のため、地方立地のハンデはありません。送料が軽微な小〜中型品なら、全国どこからでも同じ条件でお受けできます。",
  "about.location.note": "※ 工房の詳細な住所は、ご依頼確定時に発送先としてご案内します。",
  "about.gallery.sec.label": "THE PLACE",
  "about.gallery.lead": "大分・豊後高田の工房で、造形物と一個ずつ向き合っています。",
  "about.gallery.1.capja": "手の仕事",
  "about.gallery.1.capen": "CRAFTSMANSHIP",
  "about.gallery.1.credit": "Photo: riiyad / Unsplash",
  "about.gallery.2.capja": "面の質感",
  "about.gallery.2.capen": "THE SURFACE",
  "about.gallery.2.credit": "Photo: apryan_cahyo / Unsplash",
  "about.cta.button": "サービス・料金を見る",

  "service.hero.heading": "下地は全グレード共通。\nだから品質が揺れない。",
  "service.hero.lead": "自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。",
  "service.process.aside.heading": "なぜ鏡面磨きをしないのか",
  "service.terms.heading": "正直に、先にお伝えします。",
  "service.qc.heading": "発送前に、8つの目で見る。",
  "service.gallery.heading": "工程の、その手。",
  "service.cta.heading": "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
  "service.cta.note": "造形データや写真があれば、より正確に概算をお出しできます。",
  "service.hero.index": "INDEX 03 — SERVICE",
  "service.hero.en": "PROCESS / GRADE / PRICE / FLOW",
  "service.sec.1.label": "PROCESS — 全メニュー共通の下地",
  "service.process.step.1.grit": "#800",
  "service.process.step.1.step": "STEP 01 / SAND",
  "service.process.step.1.title": "素地研磨",
  "service.process.step.1.body": "積層痕を面で捉えて研ぎ落とします。FDMも光造形も、ここで平滑の土台を作ります。塗装の出来の大半は、この工程で決まります。",
  "service.process.step.2.grit": "PS",
  "service.process.step.2.step": "STEP 02 / PRIME",
  "service.process.step.2.title": "プラサフ吹付",
  "service.process.step.2.body": "プライマーサフェーサーを厚めに吹き、研磨で残った微細な段差を膜で埋めます。海外の3Dプリント仕上げでも、自動車用厚膜プラサフによる積層痕埋めは定番手法です。",
  "service.process.step.3.grit": "#1200",
  "service.process.step.3.step": "STEP 03 / WET-SAND",
  "service.process.step.3.title": "水研ぎ仕上げ",
  "service.process.step.3.body": "プロの板金塗装は #600〜800 で平滑化し、#1000〜1200 で仕上げます。一般的なDIY標準より1〜2段丁寧な、上塗りにとって十分以上の平滑面です。",
  "service.process.step.4.grit": "2K",
  "service.process.step.4.step": "STEP 04 / TOPCOAT",
  "service.process.step.4.title": "上塗り",
  "service.process.step.4.body": "ソリッド＋クリア、または3コートパール。市販の調色済み自動車補修塗料と2液ウレタンで、硬く艶やかに仕上げます。",
  "service.process.step.5.grit": "CURE",
  "service.process.step.5.step": "STEP 05 / 硬化・検品",
  "service.process.step.5.title": "硬化・検品",
  "service.process.step.5.body": "主剤と硬化剤の化学反応で常温硬化（表面乾燥1〜3時間、完全硬化5〜7日）。硬化を確認し、検品してから発送します。",
  "service.process.aside.body": "#2000〜コンパウンドの鏡面磨き工程は、あえて行いません。2液ウレタンは吹きっぱなしで自動車外板と同等の艶が出るためです。磨きに時間を使わないぶん、同じ品質で数量に応え、価格に還元します。",
  "service.process.photo.1.capja": "吹き付けの工程",
  "service.process.photo.1.capen": "SPRAY APPLICATION",
  "service.process.photo.1.credit": "Photo: createasea / Unsplash",
  "service.process.photo.2.capja": "調色済みの補修塗料",
  "service.process.photo.2.capen": "AUTOMOTIVE PAINT",
  "service.process.photo.2.credit": "Photo: jacobsoup / Unsplash",
  "service.process.cta": "全9工程を、層構造から見る",
  "service.sec.2.label": "GRADE — 差分はトップコートだけ",
  "service.grade.1.badge": "GRADE 01",
  "service.grade.1.title": "下地仕上げ",
  "service.grade.1.body": "#800 研磨＋プラサフ＋#1200 仕上げで納品。塗装はしません。",
  "service.grade.1.note": "最終色をご自身で吹く造形作家・ガレージキット層・試作会社の方へ。",
  "service.grade.2.badge": "GRADE 02",
  "service.grade.2.title": "スタンダード",
  "service.grade.2.body": "下地＋ソリッドカラー＋2液ウレタンクリア。",
  "service.grade.2.note": "単色の製品試作・小ロット生産品の外観仕上げに。",
  "service.grade.3.badge": "GRADE 03",
  "service.grade.3.title": "プレミアム",
  "service.grade.3.body": "下地＋3コートパール（ベース＋パール＋クリア）。",
  "service.grade.3.price": "¥15,000–35,000 / 1点",
  "service.grade.3.price.note": "目安。サイズにより変動します",
  "service.grade.3.note": "商談・展示会・クラウドファンディング掲載写真のための最上位仕上げ。",
  "service.quantity.heading": "QUANTITY — 数量スライド（目安）",
  "service.quantity.row.1.label": "〜9個",
  "service.quantity.row.1.value": "定価",
  "service.quantity.row.2.label": "10〜29個",
  "service.quantity.row.2.value": "−15%",
  "service.quantity.row.3.label": "30個〜",
  "service.quantity.row.3.value": "−25%",
  "service.quantity.footnote": "同一品のバッチ仕上げ・カラーバリエーション展開に対応。初回のみ治具・段取り費をいただき、リピート時は免除します。繰り返すほど、双方に有利な構造です。",
  "service.options.heading": "OPTIONS — 加算・個別対応",
  "service.options.row.1.label": "特急仕上げ",
  "service.options.row.1.value": "+50%",
  "service.options.row.2.label": "大型・特殊案件",
  "service.options.row.2.value": "個別見積もり",
  "service.options.row.3.label": "色番号指定（日塗工・自動車カラーコード）",
  "service.options.row.3.value": "対応",
  "service.options.footnote": "価格は「サイズ帯別の基本料金＋グレード加算」で算出します。立ち上げ期につき実績価格でご提供中——正式価格表は作業実測に基づいて確定し、このページで公開します。",
  "service.grades.cta": "SHOPのシミュレータで概算を出す",
  "service.sec.3.label": "FLOW — 郵送で、全国から",
  "service.flow.heading": "依頼の流れ",
  "service.flow.lead": "主戦場は手のひら〜200×200mm級の小〜中型品。送料が軽微なサイズ帯なら、地方立地のハンデはありません。",
  "service.flow.cell.1.title": "ご相談・お見積もり",
  "service.flow.cell.1.body": "サイズ × 個数 × グレードの3点で概算をお出しします。",
  "service.flow.cell.2.title": "造形物を工房へ発送",
  "service.flow.cell.2.body": "データ入稿 → 提携出力 → 工房直送の流れにも対応します。",
  "service.flow.cell.3.title": "受入検品・ビフォー撮影",
  "service.flow.cell.3.body": "状態を記録してから工程に入ります。",
  "service.flow.cell.4.title": "下地工程",
  "service.flow.cell.4.body": "#800 研磨 → プラサフ → #1200 水研ぎ。",
  "service.flow.cell.5.title": "上塗り",
  "service.flow.cell.5.body": "グレード別に施工。火気厳禁・換気管理のもとで行います。",
  "service.flow.cell.6.title": "硬化・アフター撮影",
  "service.flow.cell.6.body": "常温または赤外線ヒーターで硬化。仕上がりを記録します。",
  "service.flow.cell.7.title": "梱包・発送",
  "service.flow.cell.7.body": "完全硬化前後の取り扱い注意点を添えてお届けします。",
  "service.flow.note": "※ 進行中の写真は守秘義務の範囲で管理し、実績としての掲載は案件ごとに許諾をいただきます。NDA対応可。",
  "service.sec.4.label": "HONEST TERMS",
  "service.terms.can.heading": "できること",
  "service.terms.can.1": "色番号指定（日塗工番号・自動車カラーコード）",
  "service.terms.can.2": "同一品のバッチ仕上げ・カラーバリエーション展開",
  "service.terms.can.3": "NDA対応・掲載許諾の案件ごと管理",
  "service.terms.can.4": "大型・特殊案件の個別見積もり",
  "service.terms.can.5": "未経験素材のテストピース確認",
  "service.terms.cannot.heading": "ご了承いただきたいこと",
  "service.terms.cannot.1": "純正色のピタリ合わせ（調色）は対象外です。市販の調色済み補修塗料による「参考色」仕上げです。",
  "service.terms.cannot.2": "2液ウレタンの完全硬化は5〜7日。発送は硬化を確認してからになります。",
  "service.terms.cannot.3": "経験のない樹脂素材は、テストピースでの相性確認を挟みます。",
  "service.terms.cannot.4": "繁忙期は「納期◯週間待ち」を表示して受注を絞ります。品質を落とさないためです。",
  "service.terms.cannot.5": "輸送中の破損に備え、梱包基準と保証条件を事前に明示します。",
  "service.sec.5.label": "QUALITY CONTROL",
  "service.qc.lead": "自動車補修の現場で使われる検品項目を、そのまま持ち込んでいます。仕上がりは主観ではなく、チェックリストで確認してから梱包します。",
  "service.qc.item.1.title": "タレ・ダレ",
  "service.qc.item.1.en": "RUNS / SAGS",
  "service.qc.item.1.body": "塗料が流れて溜まった跡がないか。厚塗りを避け、薄く重ねることで防ぎます。",
  "service.qc.item.2.title": "ゆず肌",
  "service.qc.item.2.en": "ORANGE PEEL",
  "service.qc.item.2.body": "表面がミカンの皮のように凸凹していないか。吹き付けの距離と量で管理します。",
  "service.qc.item.3.title": "色ムラ",
  "service.qc.item.3.en": "COLOR CONSISTENCY",
  "service.qc.item.3.body": "光の当たり方を変えても、色が均一に見えるか。特にメタリック・パールで重要です。",
  "service.qc.item.4.title": "塗り残し",
  "service.qc.item.4.en": "COVERAGE",
  "service.qc.item.4.body": "エッジや奥まった箇所に、薄い部分・塗り残しがないか。角と縁を重点的に確認します。",
  "service.qc.item.5.title": "異物混入",
  "service.qc.item.5.en": "CONTAMINATION",
  "service.qc.item.5.body": "塗膜にホコリ・毛・ゴミが噛み込んでいないか。塗装環境の清浄度で防ぎます。",
  "service.qc.item.6.title": "密着",
  "service.qc.item.6.en": "ADHESION",
  "service.qc.item.6.body": "塗膜が素地にしっかり食いついているか。洗浄・脱脂・下地の徹底で担保します。",
  "service.qc.item.7.title": "エッジの被り",
  "service.qc.item.7.en": "EDGE QUALITY",
  "service.qc.item.7.body": "角・縁まで塗膜が回り込み、めくれや欠けがないか。輸送に耐える塗り際に整えます。",
  "service.qc.item.8.title": "硬化状態",
  "service.qc.item.8.en": "CURE",
  "service.qc.item.8.body": "2液ウレタンが完全硬化しているか。硬化を確認してから梱包・発送します。",
  "service.gallery.label": "THE HANDS",
  "service.gallery.lead": "工程の一つひとつに、自動車補修で培った手が入ります。",
  "service.gallery.photo.1.capja": "研ぐ",
  "service.gallery.photo.1.capen": "SANDING",
  "service.gallery.photo.1.credit": "Photo: mazinomron / Unsplash",
  "service.gallery.photo.2.capja": "仕上げる",
  "service.gallery.photo.2.capen": "THE FINISH",
  "service.gallery.photo.2.credit": "Photo: avenir_visuals / Unsplash",

  "process.hero.heading": "一個が仕上がるまでの、\n9つの手。",
  "process.hero.lead": "3Dプリントの造形物が、量産品と見分けがつかない外観になるまでには、決まった順序があります。派手なのは色を吹く瞬間だけ。その前後にある地味な工程こそが、仕上がりを決めます。自動車補修の手順を、一手ずつ開きます。",
  "process.coating.heading": "塗装は、\n層でできている。",
  "process.steps.heading": "受け取ってから、\n送り出すまで。",
  "process.booth.heading": "きれいな空気でしか、\nきれいには塗れない。",
  "process.related.heading": "工程の、その先へ。",
  "process.gallery.heading": "工程を、支えるもの。",
  "process.cta.heading": "この9工程を、\nあなたの一個に。",
  "process.cta.note": "サイズ・個数・グレードが分かれば、概算をお出しできます。まずはご相談ください。",
  "process.hero.index": "PROCESS — 塗りが仕上がるまで",
  "process.hero.en": "9 STEPS",
  "process.sec.1.label": "COATING STRUCTURE",
  "process.coating.lead": "仕上がった塗面は一枚に見えますが、実際は役割の違う層の積み重ねです。下から順に、造形物・プラサフ・ベースコート・クリア。積層痕は、下の層で吸収して消します。",
  "process.legend.1.name": "造形物",
  "process.legend.1.en": "3D PRINT",
  "process.legend.1.desc": "出発点。表面には積層痕という横縞がある。",
  "process.legend.2.name": "プラサフ",
  "process.legend.2.en": "PRIMER-SURFACER",
  "process.legend.2.desc": "積層痕を埋めて平滑化し、塗料の密着をつくる下地。",
  "process.legend.3.name": "ベースコート",
  "process.legend.3.en": "BASE COAT",
  "process.legend.3.desc": "色を決める発色層。メタリック・パールもこの層。",
  "process.legend.4.name": "クリア",
  "process.legend.4.en": "CLEAR (2K)",
  "process.legend.4.desc": "2液ウレタン。色を守り、磨かずとも深い艶を出す。",
  "process.sec.2.label": "THE 9 STEPS",
  "process.steps.1.capja": "下地をつくる",
  "process.steps.1.capen": "SANDING & PRIMER",
  "process.steps.1.credit": "Photo: mazinomron / Unsplash",
  "process.steps.2.capja": "色を吹く",
  "process.steps.2.capen": "BASE & CLEAR",
  "process.steps.2.credit": "Photo: createasea / Unsplash",
  "process.steps.3.capja": "仕上がり",
  "process.steps.3.capen": "THE FINISH",
  "process.steps.3.credit": "Photo: cmreflections / Unsplash",
  "process.step.1.label": "STEP",
  "process.step.1.title": "受け入れ・確認",
  "process.step.1.en": "INTAKE & INSPECTION",
  "process.step.1.desc": "届いた造形物を確認します。造形方式と素材、積層痕の状態、欠けや反りの有無を見ます。初めての素材なら、いきなり本番にはせず、テストピースで塗料の相性を確かめてから進めます。",
  "process.step.1.why": "**なぜ** — 素材ごとに塗料の乗り方が違うから。最初の見極めが、後の失敗を防ぎます。",
  "process.step.2.label": "STEP",
  "process.step.2.title": "積層痕の研磨",
  "process.step.2.en": "SANDING — #800",
  "process.step.2.desc": "`#800` の紙やすりで、積層痕を面ごと研ぎ落とします。ここで縞の大半を物理的に消します。細いディテールや薄い壁は、力を入れすぎないよう手加減しながら。",
  "process.step.2.why": "**なぜ** — 積層痕は塗料では消えません。**縞を消すのは、塗料ではなく研ぎ**です。",
  "process.step.3.label": "STEP",
  "process.step.3.title": "洗浄・脱脂",
  "process.step.3.en": "CLEANING & DEGREASING",
  "process.step.3.desc": "研磨後、水洗いで削りカスを流し、脱脂剤（シリコンオフ）で油分を除去、タッククロスで微粉を拭き取ります。光造形品は、未硬化レジンの洗浄と二次硬化もここまでに済ませます。",
  "process.step.3.why": "**なぜ** — 油分が残ると塗料が弾き（ハジキ）、密着不良や膨れの原因に。**脱脂を怠ると、あとで必ず出ます。**",
  "process.step.4.label": "STEP",
  "process.step.4.title": "マスキング",
  "process.step.4.en": "MASKING",
  "process.step.4.desc": "塗料を乗せない部分、塗り分ける境界を養生します。曲面や細部に沿ってテープを貼る精度が、塗り際の美しさを決めます。可動部や勘合部があれば、噛み合わせを保つよう保護します。",
  "process.step.4.why": "**なぜ** — マスキングの技術は、そのまま仕上がりの輪郭に出ます。地味ですが、差が出る工程です。",
  "process.step.5.label": "STEP",
  "process.step.5.title": "プラサフ（下塗り・中塗り）",
  "process.step.5.en": "PRIMER-SURFACER",
  "process.step.5.desc": "プライマー（密着）とサーフェイサー（凹凸埋め）を兼ねたプラサフを吹きます。厚膜タイプで微細な段差を埋め、研磨で残った細かな傷を覆う。塗料が乗る土台を、ここでつくります。",
  "process.step.5.why": "**なぜ** — サーフェイサーを省くと密着も発色も落ちます。**塗装の出来の大半は、この下地で決まる。**",
  "process.step.6.label": "STEP",
  "process.step.6.title": "足付け・水研ぎ",
  "process.step.6.en": "WET-SANDING — #1200",
  "process.step.6.desc": "プラサフが乾いたら、`#1200` の耐水ペーパーで水研ぎします。摩擦熱を抑えながら表面を整え、あえて細かな傷（足）をつけて、上塗り塗料の食いつきを良くします。",
  "process.step.6.why": "**なぜ** — つるつるより、わずかに足がある方が塗料は密着します。平滑さと密着の、両立点です。",
  "process.step.7.label": "STEP",
  "process.step.7.title": "ベースコート（色）",
  "process.step.7.en": "BASE COAT",
  "process.step.7.desc": "いよいよ色を吹きます。一度に厚く吹かず、薄く数回に分けて重ねる。塗る方向を層ごとに変え、乾燥間隔（フラッシュタイム）を取りながら発色を積み上げます。メタリック・パールは、この膜厚の管理が仕上がりを左右します。",
  "process.step.7.why": "**なぜ** — 厚塗りはタレ・ゆず肌・ディテールの潰れを招く。**薄く、数回。**これが均一な発色の条件です。",
  "process.step.8.label": "STEP",
  "process.step.8.title": "クリアコート",
  "process.step.8.en": "CLEAR COAT — 2K URETHANE",
  "process.step.8.desc": "2液ウレタンクリアを吹きます。3コートパールの場合は、ベースとクリアの間にパール層を挟みます。主剤と硬化剤が反応し、硬く平滑な塗膜そのものを形成する——だから、吹きっぱなしで深い艶が出ます。",
  "process.step.8.why": "**なぜ** — 2液ウレタンは磨かずとも光る。**だから鏡面磨きをしません。**その時間を、数量対応と価格の還元に回します。",
  "process.step.9.label": "STEP",
  "process.step.9.title": "常温硬化・検品・発送",
  "process.step.9.en": "CURING & SHIPPING",
  "process.step.9.desc": "2液ウレタンを常温で5〜7日かけて完全硬化させます。硬化を確認したら、発送前の検品へ。タレ・ゆず肌・色ムラ・異物・密着・エッジ・硬化——項目を確認し、養生・梱包して発送します。",
  "process.step.9.why": "**なぜ** — 硬化を待たずに送れば、輸送で傷みます。**急がば、回る。**完全硬化を待つのは、届いてからの品質のためです。",
  "process.sec.3.label": "THE BOOTH",
  "process.booth.lead": "塗装の大敵は、宙を舞うホコリです。だから塗装は、専用のブースの中で行います。フィルターを通した清浄な空気を上から下へ流し、オーバーミストとともに床下へ排気する——異物混入をふせぐ、目に見えない設備です。",
  "process.booth.fact.1.num": "5",
  "process.booth.fact.1.unit": "ミクロン",
  "process.booth.fact.1.label": "二次フィルターが捕集する埃の大きさ",
  "process.booth.fact.1.en": "DUST CAPTURED",
  "process.booth.fact.2.num": "90",
  "process.booth.fact.2.unit": "%超",
  "process.booth.fact.2.label": "一次フィルターの外気ダスト捕集率",
  "process.booth.fact.2.en": "PRIMARY FILTER",
  "process.booth.fact.3.num": "上→下",
  "process.booth.fact.3.label": "清浄空気の流れ（ダウンフロー）",
  "process.booth.fact.3.en": "DOWNDRAFT AIRFLOW",
  "process.booth.note": "※ 一般的な自動車塗装ブースの仕組みです。それでも極小のゴミは付着し得るため、最終的な確認は検品工程（サービスページ参照）で行います。",
  "process.sec.4.label": "RELATED",
  "process.related.lead": "グレード別の料金や数量スライドはサービスページに、素材ごとの下地の作り分けは素材対応ページにまとめています。工程の思想を、色の実例で見たいときは色見本へ。",
  "process.related.link.1": "サービス・料金",
  "process.related.link.2": "素材対応",
  "process.related.link.3": "色見本",
  "process.sec.5.label": "BEHIND THE STEPS",
  "process.gallery.lead": "地味な工程の積み重ねが、量産品と見分けがつかない顔をつくります。",
  "process.gallery.1.capja": "設備",
  "process.gallery.1.capen": "SPRAY EQUIPMENT",
  "process.gallery.1.credit": "Photo: kagan_4854 / Unsplash",
  "process.gallery.2.capja": "精度",
  "process.gallery.2.capen": "PRECISION",
  "process.gallery.2.credit": "Photo: kadircelep / Unsplash",
  "process.gallery.3.capja": "質感",
  "process.gallery.3.capen": "THE SURFACE",
  "process.gallery.3.credit": "Photo: apryan_cahyo / Unsplash",

  "materials.hero.heading": "素材を選ばない。\nただし、素材ごとに手を変える。",
  "materials.hero.lead": "3Dプリントは、造形方式によって積層痕の出方も、塗料の乗り方も、まったく違います。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む——同じ「下地」でも、素材ごとに手を変えます。ここでは対応方式と、素材別の考え方をまとめます。",
  "materials.methods.heading": "3つの造形方式、\nそれぞれの下地。",
  "materials.matrix.heading": "素材別の、対応と勘所。",
  "materials.why.heading": "失敗の多くは、\n塗る前に決まっている。",
  "materials.intake.heading": "造形から、任せてもいい。",
  "materials.gallery.heading": "素材の、その先。",
  "materials.cta.heading": "素材が決まっていなくても、\n用途から相談できます。",
  "materials.cta.note": "「屋外で使う」「撮影用」「触れる展示物」——用途に合う素材と仕上げをご提案します。",
  "materials.hero.index": "INDEX 06 — MATERIALS",
  "materials.hero.en": "FDM / SLA / SLS",
  "materials.methods.sec.label": "PRINTING METHODS",
  "materials.method.1.tag": "METHOD 01",
  "materials.method.1.title": "FDM / FFF方式",
  "materials.method.1.en": "FUSED DEPOSITION MODELING",
  "materials.method.1.desc": "熱で溶かした樹脂を層状に積み上げる方式。3方式の中で積層痕が最も目立ち、研磨とサーフェイサーによる下地づくりが仕上がりを大きく左右します。",
  "materials.method.1.diff": "**この工房での位置づけ** — 最も下地に手がかかる＝研磨の技術が最も活きる素材。`#800` で面出しし、厚膜プラサフで積層痕を埋め、`#1200` で仕上げます。",
  "materials.method.2.tag": "METHOD 02",
  "materials.method.2.title": "光造形方式（レジン）",
  "materials.method.2.en": "SLA / MSLA / DLP",
  "materials.method.2.desc": "液体樹脂を光で硬化させる方式。もともと積層痕が少なく滑らかですが、未硬化レジンの洗浄と二次硬化を済ませないと塗料が乗りません。レジンはアクリル系で、塗料との相性は良好です。",
  "materials.method.2.diff": "**この工房での位置づけ** — 洗浄・脱脂・二次硬化の状態を確認してから工程へ。滑らかなぶん下地は軽く、意匠塗装の美しさが素直に出ます。",
  "materials.method.3.tag": "METHOD 03",
  "materials.method.3.title": "SLS方式（粉末）",
  "materials.method.3.en": "SELECTIVE LASER SINTERING",
  "materials.method.3.desc": "ナイロン粉末をレーザーで焼結する方式。表面は多孔質で、ビーズブラストで均一化するのが一般的。塗装には粉末特有の下地づくりが必要です。",
  "materials.method.3.diff": "**この工房での位置づけ** — 要相談・テストピース確認を推奨。多孔質を活かした下地で、艶を作り込みます。",
  "materials.methods.1.photo.capja": "FDMの造形",
  "materials.methods.1.photo.capen": "FDM PRINTING",
  "materials.methods.1.photo.credit": "Photo: zmorph3d / Unsplash",
  "materials.methods.2.photo.capja": "精密な造形機械",
  "materials.methods.2.photo.capen": "PRECISION MACHINE",
  "materials.methods.2.photo.credit": "Photo: kadircelep / Unsplash",
  "materials.matrix.sec.label": "MATERIAL MATRIX",
  "materials.matrix.lead": "代表的な樹脂ごとの下地処理・注意点・耐候性の目安です。ここに無い素材も、テストピースで相性を確認してからお受けできます。",
  "materials.matrix.col.1": "素材",
  "materials.matrix.col.2": "造形方式",
  "materials.matrix.col.3": "下地の勘所",
  "materials.matrix.col.4": "耐候性の目安",
  "materials.matrix.row.1.name": "PLA",
  "materials.matrix.row.1.sub": "ポリ乳酸",
  "materials.matrix.row.1.method": "FDM",
  "materials.matrix.row.1.point": "アセトンは効かないため、研磨とスプレーパテで物理的に平滑化。サーフェイサーで密着を確保します。",
  "materials.matrix.row.1.weather": "屋内向き",
  "materials.matrix.row.2.name": "PETG",
  "materials.matrix.row.2.method": "FDM",
  "materials.matrix.row.2.point": "研磨・サーフェイサー・塗装が基本。密着のため脱脂を丁寧に行います。",
  "materials.matrix.row.2.weather": "UV安定",
  "materials.matrix.row.3.name": "ABS",
  "materials.matrix.row.3.method": "FDM",
  "materials.matrix.row.3.point": "研磨に加え、アセトン蒸気処理で光沢化する手もあります。塗装前は必ず脱脂。",
  "materials.matrix.row.3.weather": "屋内向き",
  "materials.matrix.row.4.name": "ASA",
  "materials.matrix.row.4.method": "FDM",
  "materials.matrix.row.4.point": "ABSに近い扱い。屋外用途に向く素材で、クリアのUVカットと相性良好です。",
  "materials.matrix.row.4.weather": "UV安定",
  "materials.matrix.row.5.name": "標準レジン",
  "materials.matrix.row.5.sub": "アクリル系",
  "materials.matrix.row.5.method": "光造形",
  "materials.matrix.row.5.point": "IPA洗浄とUV二次硬化を前提に。滑らかで下地は軽く、意匠塗装が映えます。黄変対策のクリアを推奨。",
  "materials.matrix.row.5.weather": "屋内向き",
  "materials.matrix.row.6.name": "タフレジン",
  "materials.matrix.row.6.sub": "ABSライク",
  "materials.matrix.row.6.method": "光造形",
  "materials.matrix.row.6.point": "靭性が高く、割れにくい。標準レジン同様の下地で、扱いやすい素材です。",
  "materials.matrix.row.6.weather": "屋内向き",
  "materials.matrix.row.7.name": "クリアレジン",
  "materials.matrix.row.7.method": "光造形",
  "materials.matrix.row.7.point": "段階研磨とクリアコートで透明感を出せます。透過部を活かした意匠にも対応。",
  "materials.matrix.row.7.weather": "屋内向き",
  "materials.matrix.row.8.name": "ナイロン",
  "materials.matrix.row.8.sub": "PA12 / PA11",
  "materials.matrix.row.8.method": "SLS",
  "materials.matrix.row.8.point": "多孔質のため下地を作り込む。ブラスト後の均一な面に艶を重ねます。要テスト。",
  "materials.matrix.row.8.weather": "UV安定",
  "materials.matrix.note": "※ 耐候性は一般的な目安です。標準レジンは紫外線で黄変・脆化が進むため、屋外長期使用には向きません。撮影・展示・商談用の高品質仕上げとしての運用を前提にしています。屋外で長く使う想定がある場合は、素材段階からご相談ください。",
  "materials.why.sec.label": "WHY IT MATTERS",
  "materials.why.lead": "塗料の食いつき不良やムラは、塗装技術以前の「素地の準備」で起きることがほとんどです。だから、この工房は塗る前の工程に最も神経を使います。",
  "materials.cause.1.no": "CAUSE 01",
  "materials.cause.1.title": "洗浄・脱脂の不足",
  "materials.cause.1.body": "造形物に残った離型剤・削りカス・指の脂は、塗料の密着を著しく下げます。研磨後に水洗いし、イソプロピルアルコールで脱脂、タッククロスで微粉を除いてから塗装に入ります。光造形品は未硬化レジンの洗浄も欠かせません。",
  "materials.cause.2.no": "CAUSE 02",
  "materials.cause.2.title": "サーフェイサーの省略",
  "materials.cause.2.body": "下地のサーフェイサー（プラサフ）を省くと、密着も発色も落ちます。厚膜タイプで微細な段差を埋め、塗料が乗る土台をつくる——この一手間を飛ばさないことが、量産品のような均一な面につながります。",
  "materials.cause.3.no": "CAUSE 03",
  "materials.cause.3.title": "厚塗りによる細部の潰れ",
  "materials.cause.3.body": "一度に厚く吹くと、タレ・ゆず肌が出て、細かな造形ディテールも埋まります。塗る方向を層ごとに変えながら、薄く数回に分けて重ねる——地味ですが、これが仕上がりの質を決めます。",
  "materials.intake.sec.label": "DATA INTAKE",
  "materials.intake.lead": "完成した造形物を送っていただくのはもちろん、データ入稿 → 提携出力 → 工房直送の流れにも対応します。出力先と塗装先を別々に手配する手間を省けます。",
  "materials.intake.stl.title": "STL",
  "materials.intake.stl.sub": "汎用フォーマット",
  "materials.intake.stl.body": "ほぼすべての3Dプリント環境で扱える標準形式。造形するだけなら、これで十分です。メッシュ（三角形の集合）でモデルを表現します。",
  "materials.intake.step.title": "STEP",
  "materials.intake.step.sub": "精密フォーマット",
  "materials.intake.step.body": "正確な形状を保持する形式（ISO 10303）。寸法精度が重要な場合や、任意の解像度で再メッシュしたい場合に向きます。精密案件ではこちらを推奨します。",
  "materials.intake.note": "※ ご相談時に、造形方式・素材・希望色（カラーコード可）・希望納期をあわせてお知らせいただけると、概算が正確になります。未発表製品はNDA対応可。",
  "materials.gallery.sec.label": "BEYOND MATERIAL",
  "materials.gallery.lead": "素材ごとに手を変える。それが下地づくりの本質です。",
  "materials.gallery.1.photo.capja": "質感",
  "materials.gallery.1.photo.capen": "TEXTURE",
  "materials.gallery.1.photo.credit": "Photo: apryan_cahyo / Unsplash",
  "materials.gallery.2.photo.capja": "仕上がり",
  "materials.gallery.2.photo.capen": "THE FINISH",
  "materials.gallery.2.photo.credit": "Photo: avenir_visuals / Unsplash",

  "colors.hero.heading": "名車の象徴色で組んだ、\n8枚の技術証明。",
  "colors.hero.lead": "見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。実物の色見本パネル（対辺70mmの六角形・裏面カラーコード刻印）は、郵送でお貸し出しできるよう準備中です。",
  "colors.cta.heading": "この8色以外も、\n色番号でご指定いただけます。",
  "colors.cta.note": "日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。",
  "colors.hero.index": "INDEX 07 — COLORS",
  "colors.hero.en": "8 SWATCHES / 5 ARE 3-COAT",
  "colors.hero.photo.capja": "名車の色は、塗る人の経験が発色させる。",
  "colors.hero.photo.capen": "COLOR AS PROOF OF SKILL",
  "colors.hero.photo.credit": "Photo: aaronburden / Unsplash",
  "colors.band.1.capja": "黒の深さは、研ぎで決まる。",
  "colors.band.1.capen": "DEPTH OF BLACK",
  "colors.band.1.credit": "Photo: cmreflections / Unsplash",
  "colors.band.2.capja": "光の映り込みが、平滑さを映す。",
  "colors.band.2.capen": "REFLECTION",
  "colors.band.2.credit": "Photo: avenir_visuals / Unsplash",
  "colors.band.3.capja": "色は、面の上に成立する。",
  "colors.band.3.capen": "ON THE SURFACE",
  "colors.band.3.credit": "Photo: apryan_cahyo / Unsplash",
  "colors.swatch.1.index": "SWATCH 01",
  "colors.swatch.1.title": "プレシャスホワイトパール",
  "colors.swatch.1.en": "TOYOTA 090 — PRECIOUS WHITE PEARL",
  "colors.swatch.1.dd.no": "DRAWDOWN 01 / 8",
  "colors.swatch.1.dd.name": "プレシャスホワイトパール",
  "colors.swatch.1.spec.1": "3コートパール",
  "colors.swatch.1.spec.2": "ベース＋パール＋クリア",
  "colors.swatch.1.spec.3": "実績納品色",
  "colors.swatch.1.story": "現に法人のプロダクト試作へ納品している、この工房の実績色であり原点。白の奥でパールが回る上品な光は、単なる「白塗装」とはまったく別のものです。3コートの技術がそのまま出る、看板の一枚。",
  "colors.swatch.2.index": "SWATCH 02",
  "colors.swatch.2.title": "ソウルレッドクリスタルメタリック",
  "colors.swatch.2.en": "MAZDA 46V — SOUL RED CRYSTAL",
  "colors.swatch.2.dd.no": "DRAWDOWN 02 / 8",
  "colors.swatch.2.dd.name": "ソウルレッドクリスタル",
  "colors.swatch.2.spec.1": "3コート",
  "colors.swatch.2.spec.2": "高難度",
  "colors.swatch.2.spec.3": "匠塗",
  "colors.swatch.2.story": "「ディーラーですら同色にならない」と業界で言われる高難度色。光を吸収するフレークを含む3層構造で、塗り重ねの経験がそのまま発色に出ます。これが塗れること自体が、技術の証明になる一枚です。",
  "colors.swatch.3.index": "SWATCH 03",
  "colors.swatch.3.title": "プレシャスブロンズ",
  "colors.swatch.3.en": "TOYOTA 4Y6 — PRECIOUS BRONZE",
  "colors.swatch.3.dd.no": "DRAWDOWN 03 / 8",
  "colors.swatch.3.dd.name": "プレシャスブロンズ",
  "colors.swatch.3.spec.1": "メタリック",
  "colors.swatch.3.story": "現行クラウンの上品なブラウン。落ち着いた製品筐体や、大人のプロダクトに映えるメタリックです。派手さではなく品位で選ばれる色は、仕上げの均一さがすべてを決めます。",
  "colors.swatch.4.index": "SWATCH 04",
  "colors.swatch.4.title": "ピンクサファイア",
  "colors.swatch.4.en": "TOYOTA 3T4 — PINK SAPPHIRE",
  "colors.swatch.4.dd.no": "DRAWDOWN 04 / 8",
  "colors.swatch.4.dd.name": "ピンクサファイア",
  "colors.swatch.4.spec.1": "3コート",
  "colors.swatch.4.spec.2": "限定色",
  "colors.swatch.4.story": "全国650台限定「ReBORN PINK」のクラウンに採用された伝説色、通称モモタロウ。話題性と可愛げを両立し、プロダクトのカラーバリエーション展開でも強い引きを持つ一枚です。",
  "colors.swatch.5.index": "SWATCH 05",
  "colors.swatch.5.title": "ブラック",
  "colors.swatch.5.en": "TOYOTA 202 — BLACK",
  "colors.swatch.5.dd.no": "DRAWDOWN 05 / 8",
  "colors.swatch.5.dd.name": "ブラック",
  "colors.swatch.5.spec.1": "ソリッド＋クリア",
  "colors.swatch.5.spec.2": "最難関カラー",
  "colors.swatch.5.story": "「最難関カラー」と呼ばれるソリッドの黒。メタリックやパールのような粒子の助けがなく、下地の平滑さと塗り肌がそのまま出ます。ごまかしが効かないからこそ、腕の見せ所。当工房が下地に時間を割く理由を、いちばん雄弁に語る色です。",
  "colors.swatch.6.index": "SWATCH 06",
  "colors.swatch.6.title": "ベイサイドブルー",
  "colors.swatch.6.en": "NISSAN TV2 — BAYSIDE BLUE",
  "colors.swatch.6.dd.no": "DRAWDOWN 06 / 8",
  "colors.swatch.6.dd.name": "ベイサイドブルー",
  "colors.swatch.6.spec.1": "3コート",
  "colors.swatch.6.spec.2": "R34 GT-R",
  "colors.swatch.6.story": "R34 GT-Rの代名詞色。この色の補修では「経験のある塗装工場を探すことが重要」と言われ続けてきた、3コート構造のブルーです。だからこそ、看板色の一枚にしています。",
  "colors.swatch.7.index": "SWATCH 07",
  "colors.swatch.7.title": "レーシンググリーン",
  "colors.swatch.7.en": "ASTON MARTIN AM9539 — RACING GREEN",
  "colors.swatch.7.dd.no": "DRAWDOWN 07 / 8",
  "colors.swatch.7.dd.name": "レーシンググリーン",
  "colors.swatch.7.spec.1": "メタリック",
  "colors.swatch.7.spec.2": "英国の象徴色",
  "colors.swatch.7.story": "英国レーシングの伝統を背負う深緑。市販車とF1マシンが同じ塗料配合という、由緒ある色です。深みのある濃色メタリックは、光の当たり方で表情が変わる——その変化を均一に出すのが職人の仕事です。",
  "colors.swatch.8.index": "SWATCH 08",
  "colors.swatch.8.title": "マシーングレープレミアムメタリック",
  "colors.swatch.8.en": "MAZDA 46G — MACHINE GRAY",
  "colors.swatch.8.dd.no": "DRAWDOWN 08 / 8",
  "colors.swatch.8.dd.name": "マシーングレー",
  "colors.swatch.8.spec.1": "高難度メタリック",
  "colors.swatch.8.spec.2": "匠塗",
  "colors.swatch.8.story": "46Vソウルレッドと並ぶ「匠塗」の2枚看板。金属の塊から削り出したような精緻な質感が特徴です。マツダの匠塗を両方仕上げられる工房——このラインナップが語る、技術ストーリーの完成形です。",
  "colors.disclaimer": "※ 画面上の色はイメージです。日塗工番号・自動車カラーコードでの色番号指定に対応します。純正色のピタリ合わせ（調色）は対象外で、市販の調色済み補修塗料による「参考色」仕上げです。実在車の車体形状の複製は行いません。",

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
  "shop.hero.lead": "受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのまま注文のご相談へ。オンライン決済は現在準備中のため、いまは「注文の意思表示 → 相談 → 正式見積もり → お支払い」の流れでお受けしています。手のひらの造形物を送るだけで、量産品の顔になって還ってきます。",
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
  "notes.hero.index": "INDEX 08 — NOTES",
  "notes.hero.en": "READING ON PAINT & COLOR",
  "notes.articles.label": "ARTICLES",
  "notes.empty.message": "読みものは現在準備中です。工程・色の裏側を、順次言葉にして公開していきます。",
  "notes.comingsoon.label": "COMING SOON",
  "notes.comingsoon.body": "今後、デモピースの製作記録や案件の実績（掲載許諾をいただいたもの）を、ここで発信していきます。\nnote・X・Instagram との連携も準備中です。",
  "notes.detail.prev.label": "← PREV — 前の記事",
  "notes.detail.next.label": "NEXT — 次の記事 →",
  "notes.detail.back": "読みもの一覧に戻る",

  "contact.hero.heading": "見積もりは、\n3つの数字で。",
  "contact.hero.lead": "「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけシンプルです。造形データや写真、素材の種類がわかると、より正確になります。",
  "contact.hero.index": "INDEX 10 — CONTACT",
  "contact.hero.en": "SIZE × QTY × GRADE",
  "contact.hero.photo.capja": "あなたの「絶対に外せない一個」を、この艶に。",
  "contact.hero.photo.capen": "YOUR ONE PIECE, PERFECTED",
  "contact.hero.photo.credit": "Photo: aaronburden / Unsplash",
  "contact.sec.1.label": "HOW TO ESTIMATE",
  "contact.quotevar.1.label": "SIZE",
  "contact.quotevar.1.ja": "サイズ",
  "contact.quotevar.1.body": "最長辺のおおよその寸法をお知らせください。主戦場は手のひら〜200×200mm級。大型は個別見積もり（送料実費）で対応します。",
  "contact.quotevar.2.label": "QTY",
  "contact.quotevar.2.ja": "個数",
  "contact.quotevar.2.body": "1点から1,000個まで。同一品は10個以上で−15%、30個以上で−25%（目安）の数量スライドが効きます。",
  "contact.quotevar.3.label": "GRADE",
  "contact.quotevar.3.ja": "グレード",
  "contact.quotevar.3.body": "下地仕上げ / スタンダード / プレミアム（3コートパール）の3択。迷ったら用途をお聞かせください。ご提案します。",
  "contact.estimate.note": "※ あわせて伝えていただけると正確になる情報 — 造形方式（FDM / 光造形など）、素材の種類、希望色（カラーコード可）、希望納期。未経験の素材はテストピース確認を挟みます。NDA対応可。",
  "contact.sec.2.label": "CONTACT FORM",
  "contact.form.heading": "お問い合わせフォーム",
  "contact.form.lead": "下記フォームからお問い合わせいただけます。内容を確認のうえ、担当より折り返しご連絡いたします。",
  "contact.sec.3.label": "BEFORE YOU ASK",
  "contact.before.heading": "ご相談の前に。",
  "contact.before.lead": "工程・グレード・数量スライドの詳細はサービスページに、対応色の考え方は色見本ページにまとめています。「できないこと」も先に書いています——正直さも品質のうちです。",
  "contact.before.link.service": "サービス・料金",
  "contact.before.link.colors": "色見本",
  "contact.sec.4.label": "FAQ",
  "contact.faq.heading": "よくあるご質問",
  "contact.faq.q.1": "造形データだけでも頼めますか？",
  "contact.faq.a.1": "はい。データ入稿 → 提携出力 → 工房直送の流れに対応しています。造形から仕上げまで一括でお受けできるため、「出力先と塗装先を別々に手配する」手間が省けます。造形方式（FDM / 光造形など）のご希望があればお知らせください。",
  "contact.faq.q.2": "色は完全に純正色と同じにできますか？",
  "contact.faq.a.2": "純正色のピタリ合わせ（調色）は対象外です。市販の調色済み補修塗料を正規の用途で使い、「参考色」として仕上げます。日塗工番号・自動車カラーコードでのご指定には対応します。8色ラインナップ以外の色もご相談ください。",
  "contact.faq.q.3": "どのくらいの納期ですか？",
  "contact.faq.a.3": "2液ウレタンの完全硬化に5〜7日かかり、硬化を確認してから発送します。工程日数を加えた目安は個別にお出しします。特急仕上げ（+50%）も可能です。繁忙期は品質維持のため「納期◯週間待ち」を表示して受注を絞ることがあります。",
  "contact.faq.q.4": "初めての素材でも塗ってもらえますか？",
  "contact.faq.a.4": "経験のない樹脂素材は、いきなり本番にはせず、テストピースで相性を確認してから進めます。塗料の食いつきや溶剤の影響を事前に見極めるためで、結果的に失敗のリスクを下げられます。",
  "contact.faq.q.5": "秘密保持（NDA）に対応できますか？",
  "contact.faq.a.5": "対応可能です。進行中の写真は守秘義務の範囲で管理し、実績としての掲載は案件ごとに許諾をいただいてからにしています。未発表製品の試作でも安心してお預けください。",
  "contact.form.badge.form": "STATUS — CONTACT FORM",
  "contact.form.badge.received": "STATUS — RECEIVED",
  "contact.form.intro": "必要事項をご入力のうえ送信してください。内容を確認し、担当より折り返しご連絡いたします。",
  "contact.form.success.message": "お問い合わせを受け付けました。内容を確認のうえ、ご連絡いたします。",
  "contact.form.button.reset": "もう一度入力する",
  "contact.form.label.name": "お名前",
  "contact.form.placeholder.name": "山田 太郎",
  "contact.form.label.email": "メールアドレス",
  "contact.form.placeholder.email": "you@example.com",
  "contact.form.label.phone": "電話番号(任意)",
  "contact.form.placeholder.phone": "090-1234-5678",
  "contact.form.label.inquiryType": "お問い合わせ種別",
  "contact.form.placeholder.inquiryType": "選択してください",
  "contact.form.option.construction": "施工依頼",
  "contact.form.option.estimate": "見積もり相談",
  "contact.form.option.material": "材料に関する質問",
  "contact.form.option.other": "その他",
  "contact.form.label.targetItem": "対象品目(任意)",
  "contact.form.placeholder.targetItem": "例: スマホケース、車両パーツ など",
  "contact.form.label.message": "内容",
  "contact.form.placeholder.message": "ご相談内容、サイズ・個数・希望グレード、造形データの有無などをご記入ください。",
  "contact.form.description.message": "10文字以上5000文字以内でご記入ください。",
  "contact.form.consent.text": "[プライバシーポリシー](/privacy)に同意する",
  "contact.form.button.submit": "送信する",
  "contact.form.error.name": "お名前を入力してください",
  "contact.form.error.email": "正しいメールアドレスを入力してください",
  "contact.form.error.phone": "正しい電話番号の形式で入力してください",
  "contact.form.error.inquiryType": "お問い合わせ種別を選択してください",
  "contact.form.error.targetItem": "100文字以内でご記入ください",
  "contact.form.error.message.min": "内容は10文字以上でご記入ください",
  "contact.form.error.message.max": "内容は5000文字以内でご記入ください",
  "contact.form.error.agree": "プライバシーポリシーへの同意が必要です",
  "contact.form.error.invalid": "入力内容をご確認ください。",
  "contact.form.error.rateLimited": "送信回数の上限に達しました。しばらく時間をおいてから再度お試しください。",
  "contact.form.error.generic": "送信に失敗しました。しばらくしてから再度お試しください。",

  "works.hero.heading": "3Dプリントを、\n量産品の顔に。",
  "works.hero.lead": "車両パーツからスマホカバー、小物、エアブラシ作品まで。素材や用途ごとに下地の作り方は変わりますが、狙う仕上がりはいつも「積層痕が消えて、量産品と見分けがつかない表面」です。",
  "works.sec.1.label": "SAMPLES",
  "works.empty.body": "施工事例は現在準備中です。実施工の写真・詳細が整い次第、順次公開します。",
  "works.empty.label": "STATUS — PREPARING",
  "works.gallery.placeholder.note": "※ 掲載画像の一部はイメージ素材です(実際の施工写真は準備が整い次第、順次差し替えます)。",
  "works.sec.2.label": "NOTE",
  "works.cms.heading": "一覧はCMSで管理しています。",
  "works.cms.lead": "案件写真・素材・グレード・工程の一覧はCMS(管理画面)から更新され、このページへ即時反映されます。",
  "works.cta.heading": "あなたの造形物も、この一覧に。",
  "works.cta.note": "サイズ・個数・グレードの3点がわかれば概算をお出しできます。",
  "works.detail.hero.index": "INDEX 04 — WORKS",
  "works.detail.hero.en": "CASE DETAIL",
  "works.detail.back.label": "施工事例一覧に戻る",

  "voices.hero.index": "INDEX 05 — VOICES",
  "voices.hero.en": "CUSTOMER VOICES",
  "voices.hero.heading": "仕上がりを見た方の、\n率直な声。",
  "voices.hero.lead": "ご依頼いただいた方からいただいたご感想を掲載しています。小ロット・個人利用のご依頼が多いため、掲載にあたってはお名前をイニシャルとし、ご了承いただいた範囲でご紹介しています。",
  "voices.sec.label": "VOICES",
  "voices.empty.message": "お客様の声は現在準備中です。ご了承をいただいたご感想を、順次掲載していきます。",
  "voices.card.item.prefix": "施工品目 — ",
  "voices.card.customer.suffix": " 様",
  "voices.mapnote": "※ 掲載しているお客様の声は、ご了承をいただいたうえで公開しています。",
  "voices.cta.works": "施工事例を見る",
  "voices.body.readmore": "続きを読む",
  "voices.body.collapse": "閉じる",

  "tokushoho.hero.index": "LEGAL",
  "tokushoho.hero.en": "特定商取引法に基づく表記",
  "tokushoho.hero.heading": "特定商取引法に\n基づく表記",
  "tokushoho.hero.lead": "通信販売（受託仕上げサービスおよび塗装済み製品の販売）に関する、特定商取引に関する法律第11条に基づく表示です。当工房は現在開業準備中のため、一部項目は準備中である旨を明記し、確定次第このページを更新します。",
  "tokushoho.spec.seller.th": "販売業者（屋号）",
  "tokushoho.spec.seller.td": "隈部塗装",
  "tokushoho.spec.representative.th": "運営統括責任者",
  "tokushoho.spec.representative.td": "隈部 信之",
  "tokushoho.spec.address.th": "所在地",
  "tokushoho.spec.address.td": "大分県豊後高田市",
  "tokushoho.spec.address.note": "※ 番地以下の詳細な所在地は、ご請求があれば遅滞なく開示いたします。ご請求は「相談する」ページの窓口までお願いします。",
  "tokushoho.spec.tel.th": "電話番号",
  "tokushoho.spec.tel.td": "ご請求があれば遅滞なく開示いたします。",
  "tokushoho.spec.tel.note": "※ お問い合わせは原則として「相談する」ページの窓口にて承ります。",
  "tokushoho.spec.contact.th": "お問い合わせ窓口",
  "tokushoho.spec.contact.td": "「相談する」ページ記載の窓口（正式な受付窓口は現在準備中です。開設次第、本欄を更新します）",
  "tokushoho.spec.price.th": "販売価格",
  "tokushoho.spec.price.td": "各サービス・各商品の表示価格（税込）によります。受託仕上げサービスは「サイズ帯別の基本料金＋グレード」で算出し、正式なお見積もりにて確定します。SHOPページのシミュレータ表示は立ち上げ期の概算目安です。",
  "tokushoho.spec.fees.th": "商品代金以外の必要料金",
  "tokushoho.spec.fees.td": "・往復の送料（実費。造形物の発送時はお客様負担、返送時は見積もりに明記）\n・銀行振込の場合の振込手数料\n・同一品バッチの初回のみ、治具・段取り費（リピート時は免除。金額は見積もりに明記）",
  "tokushoho.spec.payment.th": "お支払い方法",
  "tokushoho.spec.payment.td": "銀行振込（前払い）",
  "tokushoho.spec.payment.note": "※ クレジットカード等のオンライン決済は現在準備中です。対応開始時に本欄を更新します。",
  "tokushoho.spec.paytiming.th": "お支払い時期",
  "tokushoho.spec.paytiming.td": "正式なお見積もりにご承諾いただいた後、施工開始前にお支払いください（前払い）。",
  "tokushoho.spec.delivery.th": "サービスの提供時期・商品の引渡時期",
  "tokushoho.spec.delivery.td": "受託仕上げ：ご入金とお預かり品の到着を確認後、施工に着手します。2液ウレタンの完全硬化（5〜7日）と検品を経て発送します。標準的な納期はお見積もり時にご案内し、特急仕上げ（＋50%）にも対応します。\n塗装済み製品：ご入金確認後、原則7営業日以内に発送します（受注制作品を除く）。",
  "tokushoho.spec.return.th": "返品・キャンセルについて",
  "tokushoho.spec.return.td": "受託仕上げサービスは、お客様のお預かり品への施工という性質上、施工着手後のキャンセル・返金はお受けできません。着手前のキャンセルは可能です（往復送料はお客様負担）。\n仕上がりに施工上の不備（検品8項目に照らした欠陥）があった場合、または返送時の輸送破損があった場合は、到着後7日以内にご連絡ください。再施工または協議のうえ誠実に対応します。\n塗装済み製品は、不良品を除き、お客様都合による返品はお受けできません。不良品は到着後7日以内のご連絡で交換または返金します。",
  "tokushoho.spec.custody.th": "お預かり品について",
  "tokushoho.spec.custody.td": "未経験素材はテストピースで相性を確認したうえでお受けします。施工に伴う軽微な寸法変化（塗膜厚）が生じます。可動部・勘合部は事前にお知らせください。未発表製品はNDA（秘密保持契約）に対応します。",
  "tokushoho.spec.environment.th": "動作環境",
  "tokushoho.spec.environment.td": "該当なし（デジタルコンテンツの販売は行っていません）。",
  "tokushoho.mapnote": "本表記は開業準備中の内容を含みます。正式な販売開始時に、確定した事業者情報・支払い方法・窓口へ更新します（最終更新：2026年7月）。",

  "privacy.hero.index": "LEGAL",
  "privacy.hero.en": "PRIVACY POLICY",
  "privacy.hero.title": "プライバシーポリシー",
  "privacy.hero.lead": "隈部塗装(以下「当工房」といいます)は、お問い合わせ・お見積もり・施工のご依頼にあたってお預かりする個人情報を、以下の方針に基づき適切に取り扱います。本ページは開業準備中のドラフトであり、正式な法務チェックを経て内容を確定します。",
  "privacy.spec.business.th": "1. 事業者情報",
  "privacy.spec.business.td": "屋号：隈部塗装(くまべとそう)\n代表者：隈部 信之\n所在地：大分県豊後高田市",
  "privacy.spec.business.note": "※ 番地以下の詳細な所在地は非公開とし、ご請求があれば遅滞なく開示いたします。",
  "privacy.spec.collect.th": "2. 取得する個人情報",
  "privacy.spec.collect.td": "お問い合わせフォーム等を通じて、以下の情報を取得します。\n・氏名\n・メールアドレス\n・電話番号(ご提供いただいた場合)\n・お問い合わせ内容、対象品目等の付随情報",
  "privacy.spec.purpose.th": "3. 利用目的",
  "privacy.spec.purpose.td": "取得した個人情報は、以下の目的の範囲内で利用します。\n・お問い合わせへの対応\n・お見積もりの作成\n・施工内容のご連絡・進捗共有\n・その他、上記に付随して必要となる連絡",
  "privacy.spec.third.th": "4. 第三者提供",
  "privacy.spec.third.td": "法令に基づく場合を除き、ご本人の同意なく個人情報を第三者に提供することはありません。造形の外部提携先へ情報共有が必要になる場合は、事前に必要な範囲・目的をご案内したうえで行います。",
  "privacy.spec.retention.th": "5. 保存期間",
  "privacy.spec.retention.td": "お問い合わせいただいた個人情報は、お問い合わせの日から3年間保存し、期間経過後は安全な方法で廃棄します。ご成約いただいた場合は、法令が定める帳簿等の保存期間に従います。",
  "privacy.spec.disclosure.th": "6. 開示・訂正・削除等の請求",
  "privacy.spec.disclosure.td": "ご本人からの個人情報の開示・訂正・利用停止・削除等のご請求は、お問い合わせフォームより承ります。ご本人確認のうえ、法令に従い遅滞なく対応いたします。",
  "privacy.spec.cookie.th": "7. Cookie等の利用",
  "privacy.spec.cookie.td": "本サイトは、Next.js / Vercel によるアクセス解析のためCookie等を利用する場合があります。取得した情報は利用状況の把握のみに用い、個人を特定した広告配信やパーソナライズは行いません。",
  "privacy.spec.revision.th": "8. 本ポリシーの改定",
  "privacy.spec.revision.td": "本ポリシーは、法令の改正やサービス内容の変更等に応じて改定することがあります。改定した場合は本ページに掲載し、改定日を更新します。",
  "privacy.mapnote": "制定日・改定日：2026年7月7日\n※ 本ページは開業準備中のドラフトです。正式な法務チェックを経て、代表者名・所在地の開示範囲・第三者提供の想定などの内容を確定します。",
};

describe("TEXT_REGISTRY", () => {
  it(`実測 ${EXPECTED_COUNT} 件 (v2 Wave1: 全13ページ+共通のテキストスロット配線が完了。tokushoho/privacyの法定ページを含む。内訳はレジストリ冒頭コメント参照)`, () => {
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
