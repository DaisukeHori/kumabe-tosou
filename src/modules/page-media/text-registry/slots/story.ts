import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// story (64, route: "/story")
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): 既存5件 (hero/message.heading/cta)
// はそのまま維持し、page-body.tsx の残り全静的テキスト (rich 10件を含む 59件) を追加。
// defaultText は現行描画テキストと1文字も違わない (非退行)。rich kind の語彙は
// mono(`text`) / strong(**text**) の2種のみ使用 (§3.1)。
//
// rich 10件の内訳 (すべて単一段落 = SlotRichText を as="p" で描画し、現行の <p> 構造を
// そのまま再現する):
// - story.chapter1.body.2 / body.3 (strong)
// - story.chapter2.body.3 (strong)
// - story.chapter3.body.1 (strong)
// - story.chapter4.body.1 (mono #800/#1200 インライン埋め込み)
// - story.chapter4.body.2 / body.3 (strong)
// - story.chapter5.body.2 / body.3 (strong)
// - story.message.body.3 (strong)。旧 text-registry (shop wave) の除外条項
//   (「story.message.body は <strong> インライン装飾のため対象外」) は、v2 の rich kind
//   導入により本 wave で正式に解消する。
//
// story.chapter2.quote / story.chapter4.quote は StoryQuote (<p> ラッパー) の直下に
// 描画されるため、kind=multiline (div ラップ) だと <p><div> の不正 HTML になる。よって
// kind=text (chapter2.quote は装飾なしの引用文) / kind=lines (chapter4.quote は <br/> 2行)
// とし、出典 (<cite>) は構造をそのまま残して chapter2.quote.cite に分割する。
// ---------------------------------------------------------------------------
export const STORY_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "story.hero.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / ヒーロー見出し",
    kind: "lines",
    maxLen: 28,
    defaultText: "なぜ、積層痕と\n戦うことにしたのか。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "story.hero.lead",
    page: "story",
    route: "/story",
    label: "ストーリー / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "家電の量産塗装で長年腕を磨いた職人が、どうして3Dプリントの表面処理という、まだ名前もない仕事に専念することにしたのか。一本の相談から始まった、下地をめぐる物語です。",
  },
  {
    key: "story.message.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "「見えなくなる仕事」に、\n誇りを持っています。",
    maxLines: 2,
  },
  {
    key: "story.cta.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "物語の続きは、\nあなたの造形物で。",
    maxLines: 2,
  },
  {
    key: "story.cta.note",
    page: "story",
    route: "/story",
    label: "ストーリー / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "「絶対に外せない一個」を、量産品の顔に。まずはお気軽にご相談ください。",
  },

  // -------------------------------------------------------------------------
  // hero (PageHead index/en)
  // -------------------------------------------------------------------------
  {
    key: "story.hero.index",
    page: "story",
    route: "/story",
    label: "ストーリー / PageHead 連番表記 (INDEX NN — ページ名)",
    kind: "text",
    maxLen: 25,
    defaultText: "INDEX 01 — STORY",
  },
  {
    key: "story.hero.en",
    page: "story",
    route: "/story",
    label: "ストーリー / PageHead 英字サブラベル",
    kind: "text",
    maxLen: 35,
    defaultText: "WHY THIS WORKSHOP EXISTS",
  },

  // -------------------------------------------------------------------------
  // CHAPTER 01
  // -------------------------------------------------------------------------
  {
    key: "story.chapter1.no",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 章番号",
    kind: "text",
    maxLen: 20,
    defaultText: "CHAPTER 01",
  },
  {
    key: "story.chapter1.title",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "毎日、同じ色を、\n同じ艶で。",
    maxLines: 2,
  },
  {
    key: "story.chapter1.en",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 英字サブ見出し",
    kind: "text",
    maxLen: 28,
    defaultText: "The Ordinary Days",
  },
  {
    key: "story.chapter1.photo.capja",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 写真 日本語キャプション",
    kind: "text",
    maxLen: 35,
    defaultText: "均一に、正確に。それが量産塗装の日常だった。",
  },
  {
    key: "story.chapter1.photo.capen",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 写真 英語キャプション",
    kind: "text",
    maxLen: 24,
    defaultText: "THE DISCIPLINE",
  },
  {
    key: "story.chapter1.photo.credit",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 写真 クレジット表記",
    kind: "text",
    maxLen: 45,
    defaultText: "Photo: cmreflections / Unsplash",
  },
  {
    key: "story.chapter1.body.1",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 本文1",
    kind: "multiline",
    maxLen: 170,
    defaultText:
      "隈部塗装を始める前、隈部信之の一日は、色に始まり、色に終わっていました。持ち場は、家電の量産塗装。工場のラインを流れてくる筐体に、決められた色を、決められた膜厚で、来る日も来る日も吹き付ける。一個目と一万個目が、寸分違わぬ艶であること。それが、その仕事に求められる唯一のことでした。",
  },
  {
    key: "story.chapter1.body.2",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 本文2 (rich: strong)",
    kind: "rich",
    maxLen: 160,
    defaultText:
      "派手さはありません。誰かに褒められる仕事でもない。塗り上がった製品は、当たり前の顔をして箱に詰められ、家電量販店の棚に並び、誰かの家のリビングに置かれる。その表面が均一で美しいことに、気づく人はいません。**気づかれないことこそが、量産塗装の完成形**だからです。",
  },
  {
    key: "story.chapter1.body.3",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER01 本文3 (rich: strong)",
    kind: "rich",
    maxLen: 190,
    defaultText:
      "けれど、毎日同じ色を塗り続けるうちに、体は覚えていきました。塗料がどう流れ、どう乾き、どの距離でどう乗るのか。均一な膜をつくる手つき。段取りの組み方。治具の使い方。それは、一点ものを美しく塗る技術とは、まったく別の筋肉でした。**「同じ品質で、数を仕上げる」——量産の精度**が、いつのまにか体に染み込んでいたのです。",
  },

  // -------------------------------------------------------------------------
  // CHAPTER 02
  // -------------------------------------------------------------------------
  {
    key: "story.chapter2.no",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 章番号",
    kind: "text",
    maxLen: 20,
    defaultText: "CHAPTER 02",
  },
  {
    key: "story.chapter2.title",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 見出し",
    kind: "lines",
    maxLen: 26,
    defaultText: "その造形物には、\n縞があった。",
    maxLines: 2,
  },
  {
    key: "story.chapter2.en",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 英字サブ見出し",
    kind: "text",
    maxLen: 18,
    defaultText: "The Call",
  },
  {
    key: "story.chapter2.photo.capja",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 写真 日本語キャプション",
    kind: "text",
    maxLen: 38,
    defaultText: "造形はできる。だが、その先の仕上げに空白があった。",
  },
  {
    key: "story.chapter2.photo.capen",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 写真 英語キャプション",
    kind: "text",
    maxLen: 30,
    defaultText: "AWAITING ITS FINISH",
  },
  {
    key: "story.chapter2.photo.credit",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 写真 クレジット表記",
    kind: "text",
    maxLen: 42,
    defaultText: "Photo: claritycoat / Unsplash",
  },
  {
    key: "story.chapter2.body.1",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 本文1",
    kind: "multiline",
    maxLen: 140,
    defaultText:
      "きっかけは、知人からの一本の相談でした。手のひらにのる、樹脂の造形物。3Dプリンターで出力したという、ある製品の試作。手に取ると、表面にうっすらと横縞が走っていました。層を積み重ねてつくる、3Dプリント特有の跡——積層痕です。",
  },
  {
    key: "story.chapter2.body.2",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 本文2",
    kind: "multiline",
    maxLen: 70,
    defaultText:
      "「これ、量産品みたいに綺麗に塗れませんか」。知人は言いました。そして、続けた言葉が、隈部の胸に刺さりました。",
  },
  {
    key: "story.chapter2.quote",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 引用文 (StoryQuote 本文)",
    kind: "text",
    maxLen: 95,
    defaultText:
      "「塗装をやってくれる店はあるんです。でも、この積層痕を分かってる人がいない。造形はできても、仕上げは単色止まり。誰も、最後の一歩をやってくれないんですよ」",
  },
  {
    key: "story.chapter2.quote.cite",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 引用文 出典 (<cite>)",
    kind: "text",
    maxLen: 25,
    defaultText: "— ある試作の相談者の言葉",
  },
  {
    key: "story.chapter2.body.3",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER02 本文3 (rich: strong)",
    kind: "rich",
    maxLen: 195,
    defaultText:
      "その瞬間、隈部は気づきました。塗装はできても3Dプリントの下地を知らない塗装店。造形はできても仕上げは苦手な出力サービス。その二つの**あいだにぽっかり空いた空白**——そこに必要なものは、自分が毎日やっていることそのものだ、と。均一に、正確に、数を美しく塗る。量産塗装の精度こそが、この新しい世界に決定的に欠けているものでした。",
  },

  // -------------------------------------------------------------------------
  // CHAPTER 03
  // -------------------------------------------------------------------------
  {
    key: "story.chapter3.no",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 章番号",
    kind: "text",
    maxLen: 20,
    defaultText: "CHAPTER 03",
  },
  {
    key: "story.chapter3.title",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 見出し",
    kind: "lines",
    maxLen: 22,
    defaultText: "樹脂は、\n鉄板とは違った。",
    maxLines: 2,
  },
  {
    key: "story.chapter3.en",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 英字サブ見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "The Trials",
  },
  {
    key: "story.chapter3.photo.capja",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 写真 日本語キャプション",
    kind: "text",
    maxLen: 24,
    defaultText: "研いでは吹き、吹いては削る。",
  },
  {
    key: "story.chapter3.photo.capen",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 写真 英語キャプション",
    kind: "text",
    maxLen: 22,
    defaultText: "TRIAL & ERROR",
  },
  {
    key: "story.chapter3.photo.credit",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 写真 クレジット表記",
    kind: "text",
    maxLen: 40,
    defaultText: "Photo: mazinomron / Unsplash",
  },
  {
    key: "story.chapter3.body.1",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 本文1 (rich: strong)",
    kind: "rich",
    maxLen: 195,
    defaultText:
      "思い立ってすぐ、うまくいったわけではありません。自動車の鉄板と、3Dプリントの樹脂は、まるで別物でした。素材ごとに塗料の食いつきが違う。溶剤に弱いものもある。そして何より——**積層痕は、塗料をいくら重ねても消えない**。厚く吹けば、細かな造形ディテールが埋まってしまう。塗るほどに、縞は醜く浮かび上がることさえありました。",
  },
  {
    key: "story.chapter3.body.2",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 本文2",
    kind: "multiline",
    maxLen: 150,
    defaultText:
      "テストピースを、何枚も塗りました。研いでは吹き、吹いては削り。失敗した造形物が、作業台の隅に積み上がっていきました。洗浄が甘ければ塗料が弾き、脱脂を怠ればムラが出る。3Dプリントの塗装には、模型とも、クルマとも違う、独自の勘所があったのです。",
  },
  {
    key: "story.chapter3.body.3",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER03 本文3",
    kind: "multiline",
    maxLen: 165,
    defaultText:
      "それでも、手を動かし続けました。なぜなら、あの言葉が忘れられなかったから。「誰も、最後の一歩をやってくれない」。ならば、自分がやる。試行錯誤の日々は、地味で、報われるかも分からないものでした。けれど職人は、うまくいかない理由を一つずつ潰していくことを、苦だとは思わないのです。",
  },

  // -------------------------------------------------------------------------
  // CHAPTER 04
  // -------------------------------------------------------------------------
  {
    key: "story.chapter4.no",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 章番号",
    kind: "text",
    maxLen: 20,
    defaultText: "CHAPTER 04",
  },
  {
    key: "story.chapter4.title",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 見出し",
    kind: "lines",
    maxLen: 30,
    defaultText: "答えは、毎日やっていた\n下地にあった。",
    maxLines: 2,
  },
  {
    key: "story.chapter4.en",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 英字サブ見出し",
    kind: "text",
    maxLen: 24,
    defaultText: "The Revelation",
  },
  {
    key: "story.chapter4.photo.capja",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 写真 日本語キャプション",
    kind: "text",
    maxLen: 24,
    defaultText: "量産品と、見分けがつかない。",
  },
  {
    key: "story.chapter4.photo.capen",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 写真 英語キャプション",
    kind: "text",
    maxLen: 28,
    defaultText: "INDISTINGUISHABLE",
  },
  {
    key: "story.chapter4.photo.credit",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 写真 クレジット表記",
    kind: "text",
    maxLen: 45,
    defaultText: "Photo: avenir_visuals / Unsplash",
  },
  {
    key: "story.chapter4.body.1",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 本文1 (rich: mono #800/#1200)",
    kind: "rich",
    maxLen: 185,
    defaultText:
      "転機は、ある一枚のテストピースでした。積層痕を `#800` の紙やすりで面ごと研ぎ落とし、プラサフを厚めに吹いて微細な段差を埋め、`#1200` で水研ぎをかける。それは、自動車補修の現場で当たり前にやっている、ごく basic な下地の作り方でした。その上に塗料を乗せたとき——縞は、跡形もなく消えていました。",
  },
  {
    key: "story.chapter4.body.2",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 本文2 (rich: strong)",
    kind: "rich",
    maxLen: 165,
    defaultText:
      "答えは、遠くにはありませんでした。**毎日やっていた「下地」の中に、ずっとあった**のです。塗装の出来の大半は、塗る前の下地で決まる。自動車塗装が何十年もかけて磨いてきたこの原則は、そのまま3Dプリントの積層痕にも効いた。縞を消すのは、塗料ではなく、研ぎだったのです。",
  },
  {
    key: "story.chapter4.quote",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 引用文 (StoryQuote 本文、2行)",
    kind: "lines",
    maxLen: 50,
    defaultText: "量産品と、見分けがつかない。\n金型を使わずに、金型で成形したような顔をつくる。",
    maxLines: 2,
  },
  {
    key: "story.chapter4.body.3",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER04 本文3 (rich: strong)",
    kind: "rich",
    maxLen: 140,
    defaultText:
      "試作の一個も、量産の千個も、同じ品質で。それは、一点を美しく塗る技術と、数を均一に仕上げる技術——その両方を持つ、**量産塗装職人にしかできない仕事**でした。あの空白に、ぴたりと嵌まる形が、ようやく見つかった瞬間でした。",
  },

  // -------------------------------------------------------------------------
  // CHAPTER 05
  // -------------------------------------------------------------------------
  {
    key: "story.chapter5.no",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 章番号",
    kind: "text",
    maxLen: 20,
    defaultText: "CHAPTER 05",
  },
  {
    key: "story.chapter5.title",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "大分から、\nあなたの一個へ。",
    maxLines: 2,
  },
  {
    key: "story.chapter5.en",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 英字サブ見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "The Return",
  },
  {
    key: "story.chapter5.photo.capja",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 写真 日本語キャプション",
    kind: "text",
    maxLen: 22,
    defaultText: "大分から、あなたの一個へ。",
  },
  {
    key: "story.chapter5.photo.capen",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 写真 英語キャプション",
    kind: "text",
    maxLen: 22,
    defaultText: "THE BEGINNING",
  },
  {
    key: "story.chapter5.photo.credit",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 写真 クレジット表記",
    kind: "text",
    maxLen: 42,
    defaultText: "Photo: aaronburden / Unsplash",
  },
  {
    key: "story.chapter5.body.1",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 本文1",
    kind: "multiline",
    maxLen: 155,
    defaultText:
      "こうして、隈部塗装は始まりました。大分県豊後高田市の、小さな工房。乗用車のバンパーを6本同時に塗れるブースで、あなたの造形物を、量産品の顔に仕上げます。手のひらサイズの小物なら、郵送の送料はごくわずか。地方の工房であることは、もうハンデではありません。",
  },
  {
    key: "story.chapter5.body.2",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 本文2 (rich: strong)",
    kind: "rich",
    maxLen: 160,
    defaultText:
      "企業トップへの最終プレゼン。展示会。クラウドファンディングの一枚の写真。あるいは、金型を作らない少量生産の、初回ロット。**「絶対に外せない一個」**が、世の中にはたくさんあります。その一個を、量産品と見分けがつかない外観に仕上げること。それが、この工房の仕事です。",
  },
  {
    key: "story.chapter5.body.3",
    page: "story",
    route: "/story",
    label: "ストーリー / CHAPTER05 本文3 (rich: strong)",
    kind: "rich",
    maxLen: 140,
    defaultText:
      "本当のことを言えば、この物語がどこまで劇的だったかは、大した問題ではありません。大切なのは、いま目の前にある造形物を、どこまで美しく仕上げられるか。その一点だけです。**下地に、誠実に。**——それが、隈部塗装のすべてです。",
  },

  // -------------------------------------------------------------------------
  // 代表メッセージ
  // -------------------------------------------------------------------------
  {
    key: "story.message.eyebrow",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ アイブロウ (MESSAGE — 代表挨拶)",
    kind: "text",
    maxLen: 24,
    defaultText: "MESSAGE — 代表挨拶",
  },
  {
    key: "story.message.body.1",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ 本文1",
    kind: "multiline",
    maxLen: 110,
    defaultText:
      "私は、塗装職人です。長く家電の量産塗装に携わり、来る日も来る日も、同じ色を同じ艶で塗ってきました。その中で身についたのは、「同じ品質で、数を仕上げる」という、量産の精度です。",
  },
  {
    key: "story.message.body.2",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ 本文2",
    kind: "multiline",
    maxLen: 150,
    defaultText:
      "3Dプリントの世界に足を踏み入れて分かったのは、この技術を必要としている人が、たしかにいるということでした。造形はできる。でも、量産品のように美しく仕上げる最後の一歩で、みんなが困っている。だったら、私がやろう。そう思って、この工房を始めました。",
  },
  {
    key: "story.message.body.3",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ 本文3 (rich: strong)",
    kind: "rich",
    maxLen: 120,
    defaultText:
      "塗装の出来は、塗る前の下地で決まります。研磨し、埋め、また研ぐ。仕上がった塗面には、その苦労は一切見えません。**見えなくなるからこそ、そこに手を抜かない。**それが職人の矜持だと思っています。",
  },
  {
    key: "story.message.body.4",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ 本文4",
    kind: "multiline",
    maxLen: 85,
    defaultText:
      "あなたの大切な造形物を、量産品と見分けがつかない外観に。その一個に、私の持てる技術のすべてを注ぎます。どうぞ、安心してお預けください。",
  },
  {
    key: "story.message.role",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ 肩書き",
    kind: "text",
    maxLen: 24,
    defaultText: "隈部塗装 代表 / 塗装職人",
  },
  {
    key: "story.message.name",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ 氏名",
    kind: "text",
    maxLen: 15,
    defaultText: "隈部 信之",
  },

  // -------------------------------------------------------------------------
  // portrait プレースホルダ
  // -------------------------------------------------------------------------
  {
    key: "story.portrait.initial",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表写真プレースホルダ イニシャル表記",
    kind: "text",
    maxLen: 10,
    defaultText: "信之",
  },
  {
    key: "story.portrait.caption",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表写真プレースホルダ キャプション",
    kind: "text",
    maxLen: 35,
    defaultText: "PORTRAIT — COMING SOON",
  },
];
