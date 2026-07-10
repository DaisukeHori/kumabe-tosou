import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// shop (134, route: "/shop")
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): 既存9件 (hero/grades/simulator/
// products/flow/cta 見出し・CTA・リード文) はそのまま維持し、page-body.tsx / shop-simulator.tsx
// の残り全静的テキスト (rich 19件含む) を追加。defaultText は現行描画テキストと1文字も違わない
// (非退行)。rich kind の語彙は mono(`text`) / strong(**text**) / link([text](url)) の3種のみ
// (§3.1)。PageHead index/en・SectionMark label ×4・PhotoFigure capJa/capEn/credit は
// page-blocks.tsx が該当propを string 型 (ReactNode不可) で持つため本waveでは対象外
// (W1-1 のスコープ、page-blocks.tsx 非変更が本waveの制約)。
// ---------------------------------------------------------------------------
export const SHOP_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "shop.hero.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / ヒーロー見出し",
    kind: "lines",
    maxLen: 26,
    defaultText: "仕上げを、\n通販のように買う。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "shop.hero.lead",
    page: "shop",
    route: "/shop",
    label: "SHOP / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのまま注文のご相談へ。オンライン決済は現在準備中のため、いまは「注文の意思表示 → 相談 → 正式見積もり → お支払い」の流れでお受けしています。手のひらの造形物を送るだけで、量産品の顔になって還ってきます。",
  },
  {
    key: "shop.grades.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / FINISHING SERVICES 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "3つのグレードから、\n選ぶ。",
    maxLines: 2,
  },
  {
    key: "shop.simulator.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / ESTIMATE SIMULATOR 見出し",
    kind: "lines",
    maxLen: 30,
    defaultText: "サイズ × 個数 × グレード。\n3つ選べば、概算が出る。",
    maxLines: 2,
    maxLineLen: 16,
  },
  {
    key: "shop.simulator.cta",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ注文ボタン (固定高+矢印、折返し厳禁)",
    kind: "text",
    maxLen: 16,
    defaultText: "この内容で注文・相談する",
  },
  {
    key: "shop.products.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / READY-MADE 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "手に取れる製品も、\nここに並びます。",
    maxLines: 2,
  },
  {
    key: "shop.flow.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / HOW TO ORDER 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "注文から、お届けまで。",
  },
  {
    key: "shop.cta.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "概算が出たら、\nあとは送るだけ。",
    maxLines: 2,
  },
  {
    key: "shop.cta.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "シミュレータの内容をコピーして、そのまま貼り付けてご相談ください。",
  },
  {
    key: "shop.grades.lead",
    page: "shop",
    route: "/shop",
    label: "SHOP / FINISHING SERVICES リード文 (rich)",
    kind: "rich",
    maxLen: 205,
    defaultText:
      "下地はどのグレードも共通です。`#800` で積層痕を研ぎ落とし、プラサフで微細な段差を埋め、`#1200` で水研ぎ。違いはトップコートの層数だけ——塗らずに下地で仕上げるか、ソリッド1色か、パール3層か。あなたの造形物を工房へ送るだけで、射出成形品と見分けのつかない外観になって還ります。",
  },
  {
    key: "shop.grade.1.badge",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 バッジ (GRADE 0N)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "GRADE 01",
  },
  {
    key: "shop.grade.1.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 SERVICEラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "SERVICE 01",
  },
  {
    key: "shop.grade.1.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "下地仕上げ",
  },
  {
    key: "shop.grade.1.subtitle",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 英字サブラベル",
    kind: "text",
    maxLen: 30,
    defaultText:
      "PRIMER-READY FINISH",
  },
  {
    key: "shop.grade.1.badge.grit",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 バッジ (研磨番手, rich)",
    kind: "rich",
    maxLen: 19,
    defaultText:
      "研磨 **#800**",
  },
  {
    key: "shop.grade.1.badge.wetsand",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 バッジ (水研ぎ番手, rich)",
    kind: "rich",
    maxLen: 21,
    defaultText:
      "水研ぎ **#1200**",
  },
  {
    key: "shop.grade.1.badge.paint",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 バッジ (塗装有無, rich)",
    kind: "rich",
    maxLen: 17,
    defaultText:
      "塗装 **なし**",
  },
  {
    key: "shop.grade.1.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 本文",
    kind: "multiline",
    maxLen: 140,
    defaultText:
      "積層痕を消し、プラサフまで入れた「塗る直前」の状態で納品します。縞は跡形もなく消え、面はなめらか。ここから先の色は、あなたの手に委ねます。塗装費が乗らないぶん、最も手に取りやすいグレードです。",
  },
  {
    key: "shop.grade.1.steps.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 工程ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "含まれる工程",
  },
  {
    key: "shop.grade.1.steps",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 含まれる工程 (改行区切り)",
    kind: "lines",
    maxLen: 75,
    defaultText:
      "・#800 による積層痕の面研ぎ\n・プラサフ（下塗り・中塗り）で段差を充填\n・#1200 水研ぎで塗装可能面に",
    maxLines: 3,
  },
  {
    key: "shop.grade.1.suited.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 「こんな方に」ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "こんな方に",
  },
  {
    key: "shop.grade.1.suited.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 「こんな方に」本文",
    kind: "text",
    maxLen: 80,
    defaultText:
      "最終色をご自身で吹く造形作家・ガレージキット層・試作会社。「下地だけ、プロにやってほしい」という方へ。",
  },
  {
    key: "shop.grade.1.price",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 価格",
    kind: "text",
    maxLen: 20,
    defaultText:
      "¥7,000〜",
  },
  {
    key: "shop.grade.1.price.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 価格注記",
    kind: "text",
    maxLen: 25,
    defaultText:
      "1点あたり / サイズ別目安・税込",
  },
  {
    key: "shop.grade.1.cta",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE01 CTAボタン文言",
    kind: "text",
    maxLen: 20,
    defaultText:
      "サイズと個数で概算",
  },
  {
    key: "shop.grade.2.badge",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 バッジ (GRADE 0N)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "GRADE 02",
  },
  {
    key: "shop.grade.2.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 SERVICEラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "SERVICE 02",
  },
  {
    key: "shop.grade.2.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "スタンダード",
  },
  {
    key: "shop.grade.2.subtitle",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 英字サブラベル",
    kind: "text",
    maxLen: 35,
    defaultText:
      "SOLID COLOR + 2K CLEAR",
  },
  {
    key: "shop.grade.2.badge.common",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 バッジ (共通下地)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "共通下地",
  },
  {
    key: "shop.grade.2.badge.coat",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 バッジ (コート層数, rich)",
    kind: "rich",
    maxLen: 18,
    defaultText:
      "コート **2層**",
  },
  {
    key: "shop.grade.2.badge.urethane",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 バッジ (2液ウレタン)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "2液ウレタン",
  },
  {
    key: "shop.grade.2.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 本文",
    kind: "multiline",
    maxLen: 150,
    defaultText:
      "共通下地の上に、ソリッドカラーのベースコートと2液ウレタンクリアを重ねます。吹きっぱなしで自動車外板と同等の艶が出るため、磨き工程は不要。単色の製品試作・小ロット生産品の外観仕上げに、過不足のないグレードです。",
  },
  {
    key: "shop.grade.2.steps.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 工程ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "含まれる工程",
  },
  {
    key: "shop.grade.2.steps",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 含まれる工程 (改行区切り)",
    kind: "lines",
    maxLen: 65,
    defaultText:
      "・共通下地（研磨〜水研ぎ）一式\n・ソリッドカラー ベースコート\n・2液ウレタンクリア（常温硬化）",
    maxLines: 3,
  },
  {
    key: "shop.grade.2.suited.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 「こんな方に」ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "こんな方に",
  },
  {
    key: "shop.grade.2.suited.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 「こんな方に」本文",
    kind: "text",
    maxLen: 65,
    defaultText:
      "単色でいい製品試作・小ロット生産品。「量産品のような、均一な単色の艶」が欲しい方へ。",
  },
  {
    key: "shop.grade.2.price",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 価格",
    kind: "text",
    maxLen: 20,
    defaultText:
      "¥10,000〜",
  },
  {
    key: "shop.grade.2.price.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 価格注記",
    kind: "text",
    maxLen: 25,
    defaultText:
      "1点あたり / サイズ別目安・税込",
  },
  {
    key: "shop.grade.2.cta",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE02 CTAボタン文言",
    kind: "text",
    maxLen: 20,
    defaultText:
      "サイズと個数で概算",
  },
  {
    key: "shop.grade.3.badge",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 バッジ (GRADE 0N — 最上位)",
    kind: "text",
    maxLen: 25,
    defaultText:
      "GRADE 03 — 最上位",
  },
  {
    key: "shop.grade.3.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 SERVICEラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "SERVICE 03 — 最上位",
  },
  {
    key: "shop.grade.3.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "プレミアム",
  },
  {
    key: "shop.grade.3.subtitle",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 英字サブラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "3-COAT PEARL",
  },
  {
    key: "shop.grade.3.badge.common",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 バッジ (共通下地)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "共通下地",
  },
  {
    key: "shop.grade.3.badge.coat",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 バッジ (コート層数, rich)",
    kind: "rich",
    maxLen: 18,
    defaultText:
      "コート **3層**",
  },
  {
    key: "shop.grade.3.badge.colors",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 バッジ (参考色数, rich)",
    kind: "rich",
    maxLen: 18,
    defaultText:
      "参考色 **8色**",
  },
  {
    key: "shop.grade.3.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 本文",
    kind: "multiline",
    maxLen: 150,
    defaultText:
      "ベース＋パール＋クリアの3コート。角度で表情を変える、名車の象徴色そのものの深みです。「絶対に外せない一個」——商談・展示会・クラウドファンディングの一枚のための、最上位仕上げ。下記の8色から選べます。",
  },
  {
    key: "shop.grade.3.colors.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 参考色ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "選べる参考色（8色）",
  },
  {
    key: "shop.grade.3.suited.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 「こんな方に」ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "こんな方に",
  },
  {
    key: "shop.grade.3.suited.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 「こんな方に」本文",
    kind: "text",
    maxLen: 65,
    defaultText:
      "商談・展示会・クラファン掲載の勝負試作。「写真で一目で伝わる、最高の質感」が要る方へ。",
  },
  {
    key: "shop.grade.3.price",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 価格",
    kind: "text",
    maxLen: 25,
    defaultText:
      "¥15,000–35,000",
  },
  {
    key: "shop.grade.3.price.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 価格注記",
    kind: "text",
    maxLen: 20,
    defaultText:
      "1点あたり / 目安・税込",
  },
  {
    key: "shop.grade.3.cta",
    page: "shop",
    route: "/shop",
    label: "SHOP / GRADE03 CTAボタン文言",
    kind: "text",
    maxLen: 20,
    defaultText:
      "サイズと個数で概算",
  },
  {
    key: "shop.grades.footnote",
    page: "shop",
    route: "/shop",
    label: "SHOP / FINISHING SERVICES 注記 (rich, リンク×2)",
    kind: "rich",
    maxLen: 255,
    defaultText:
      "※ 価格は「サイズ帯別の基本料金＋グレード」で決まる立ち上げ期の目安です。上記は最小サイズ（〜100mm）からの参考価格で、サイズが上がると変動します。正式価格表は作業実測に基づいて確定し、このページを更新します。色番号指定（日塗工・自動車カラーコード）にも対応。[8色の色見本を一枚ずつ見る](/colors)／[工程と品質管理の詳細](/service)。",
  },
  {
    key: "shop.simulator.lead",
    page: "shop",
    route: "/shop",
    label: "SHOP / ESTIMATE SIMULATOR リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 190,
    defaultText:
      "数量スライド（10個以上 −15% / 30個以上 −25%）と特急（＋50%）も反映した概算レンジを、その場で計算します。面を埋めるほど1個あたりの手間は下がる——だから、数を出すほど有利になります。内容はワンタップでコピーして、そのまま相談に貼り付けられます。",
  },
  {
    key: "shop.products.lead",
    page: "shop",
    route: "/shop",
    label: "SHOP / READY-MADE リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 140,
    defaultText:
      "工房で仕上げた「そのまま買える」製品の販売枠です。第一弾として、画面では絶対に伝わらない粒子感・深みを手元で確かめられる、実物の色見本パネルを準備しています。掲載製品は順次追加していきます。",
  },
  {
    key: "shop.product.1.badge",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 バッジ (COMING SOON等)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "COMING SOON",
  },
  {
    key: "shop.product.1.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 見出し",
    kind: "text",
    maxLen: 25,
    defaultText:
      "六角色見本パネル・8色セット",
  },
  {
    key: "shop.product.1.sku",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 SKUコード",
    kind: "text",
    maxLen: 20,
    defaultText:
      "HEX-SET-08",
  },
  {
    key: "shop.product.1.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 本文",
    kind: "multiline",
    maxLen: 90,
    defaultText:
      "8色の参考色を、実物の塗り板で。画面では絶対に伝わらない、パールの粒子感と深みを手元で確認できるセットです。制作検討の色決めに。",
  },
  {
    key: "shop.product.1.spec.1.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 仕様1 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "形状",
  },
  {
    key: "shop.product.1.spec.1.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 仕様1 値",
    kind: "text",
    maxLen: 25,
    defaultText:
      "対辺70mm 六角形 × 8枚",
  },
  {
    key: "shop.product.1.spec.2.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 仕様2 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "仕様",
  },
  {
    key: "shop.product.1.spec.2.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 仕様2 値",
    kind: "text",
    maxLen: 20,
    defaultText:
      "裏面にカラーコード刻印",
  },
  {
    key: "shop.product.1.spec.3.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 仕様3 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "用途",
  },
  {
    key: "shop.product.1.spec.3.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 仕様3 値",
    kind: "text",
    maxLen: 20,
    defaultText:
      "色決め・貸出プラン準備中",
  },
  {
    key: "shop.product.1.price",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 価格",
    kind: "text",
    maxLen: 20,
    defaultText:
      "価格未定",
  },
  {
    key: "shop.product.1.price.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品1 価格注記",
    kind: "text",
    maxLen: 20,
    defaultText:
      "準備中",
  },
  {
    key: "shop.product.2.badge",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 バッジ (COMING SOON等)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "COMING SOON",
  },
  {
    key: "shop.product.2.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "六角色見本パネル・単色",
  },
  {
    key: "shop.product.2.sku",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 SKUコード",
    kind: "text",
    maxLen: 20,
    defaultText:
      "HEX-01",
  },
  {
    key: "shop.product.2.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 本文",
    kind: "multiline",
    maxLen: 110,
    defaultText:
      "気になる1色だけを手元に。ソウルレッド、ベイサイドブルー、ホワイトパールなど、8色から選べる単品パネル。まずは狙いの色を、実物で確かめてください。",
  },
  {
    key: "shop.product.2.spec.1.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 仕様1 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "形状",
  },
  {
    key: "shop.product.2.spec.1.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 仕様1 値",
    kind: "text",
    maxLen: 25,
    defaultText:
      "対辺70mm 六角形 × 1枚",
  },
  {
    key: "shop.product.2.spec.2.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 仕様2 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "選択",
  },
  {
    key: "shop.product.2.spec.2.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 仕様2 値",
    kind: "text",
    maxLen: 20,
    defaultText:
      "8色から1色を指定",
  },
  {
    key: "shop.product.2.spec.3.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 仕様3 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "仕様",
  },
  {
    key: "shop.product.2.spec.3.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 仕様3 値",
    kind: "text",
    maxLen: 20,
    defaultText:
      "裏面にカラーコード刻印",
  },
  {
    key: "shop.product.2.price",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 価格",
    kind: "text",
    maxLen: 20,
    defaultText:
      "価格未定",
  },
  {
    key: "shop.product.2.price.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品2 価格注記",
    kind: "text",
    maxLen: 20,
    defaultText:
      "準備中",
  },
  {
    key: "shop.product.3.badge",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 バッジ (受注制作等)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "受注制作",
  },
  {
    key: "shop.product.3.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "あなたの造形物・一点仕上げ",
  },
  {
    key: "shop.product.3.sku",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 SKUコード",
    kind: "text",
    maxLen: 20,
    defaultText:
      "CUSTOM-01",
  },
  {
    key: "shop.product.3.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 本文",
    kind: "multiline",
    maxLen: 110,
    defaultText:
      "この枠の主役は、あなたの造形物です。上のシミュレータで概算を出して、そのままご相談ください。仕上がった実例は、許可をいただいた上でここに並びます。",
  },
  {
    key: "shop.product.3.spec.1.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 仕様1 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "対応",
  },
  {
    key: "shop.product.3.spec.1.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 仕様1 値",
    kind: "text",
    maxLen: 20,
    defaultText:
      "郵送受託・全国対応",
  },
  {
    key: "shop.product.3.spec.2.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 仕様2 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "数量",
  },
  {
    key: "shop.product.3.spec.2.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 仕様2 値",
    kind: "text",
    maxLen: 20,
    defaultText:
      "1点〜1,000個",
  },
  {
    key: "shop.product.3.spec.3.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 仕様3 ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "グレード",
  },
  {
    key: "shop.product.3.spec.3.value",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 仕様3 値",
    kind: "text",
    maxLen: 25,
    defaultText:
      "下地／スタンダード／プレミアム",
  },
  {
    key: "shop.product.3.price",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 価格",
    kind: "text",
    maxLen: 20,
    defaultText:
      "¥7,000〜",
  },
  {
    key: "shop.product.3.price.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / 製品3 価格注記",
    kind: "text",
    maxLen: 20,
    defaultText:
      "シミュレータで概算",
  },
  {
    key: "shop.products.footnote",
    page: "shop",
    route: "/shop",
    label: "SHOP / READY-MADE 注記",
    kind: "multiline",
    maxLen: 100,
    defaultText:
      "※ 製品ビジュアルは現在イメージ（塗り板の色をCSSで再現したもの）です。実物の写真・価格・在庫は、販売開始時にこのページで公開します。",
  },
  {
    key: "shop.flow.lead",
    page: "shop",
    route: "/shop",
    label: "SHOP / HOW TO ORDER リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 120,
    defaultText:
      "遠く離れた工房でも、安心して預けられるように。受入から発送まで、記録を残しながら進めます。オンライン決済が整うまでは、下記のとおり相談ベースでお受けしています。",
  },
  {
    key: "shop.flow.1.meta",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP01 補足 (rich)",
    kind: "rich",
    maxLen: 45,
    defaultText:
      "必要なもの — **造形物 or データ・希望グレード・色**",
  },
  {
    key: "shop.flow.2.meta",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP02 補足 (rich)",
    kind: "rich",
    maxLen: 35,
    defaultText:
      "支払い — **銀行振込（カード決済は準備中）**",
  },
  {
    key: "shop.flow.3.meta",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP03 補足 (rich)",
    kind: "rich",
    maxLen: 30,
    defaultText:
      "記録 — **ビフォー／アフターを撮影**",
  },
  {
    key: "shop.flow.4.meta",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP04 補足 (rich)",
    kind: "rich",
    maxLen: 30,
    defaultText:
      "品質 — **完全硬化＋8項目検品**",
  },
  {
    key: "shop.flow.1.no",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP01 番号",
    kind: "text",
    maxLen: 20,
    defaultText:
      "STEP 01",
  },
  {
    key: "shop.flow.1.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP01 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "注文・相談",
  },
  {
    key: "shop.flow.1.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP01 本文",
    kind: "multiline",
    maxLen: 120,
    defaultText:
      "上のシミュレータで概算を出し、内容をコピーして相談ページからご連絡ください。造形データ（STL/STEP）や写真、素材の種類が分かると、より正確なお見積もりになります。",
  },
  {
    key: "shop.flow.2.no",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP02 番号",
    kind: "text",
    maxLen: 20,
    defaultText:
      "STEP 02",
  },
  {
    key: "shop.flow.2.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP02 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "正式見積もり・お支払い",
  },
  {
    key: "shop.flow.2.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP02 本文",
    kind: "multiline",
    maxLen: 100,
    defaultText:
      "形状・素材・色を確認し、正式なお見積もりを提示します。ご了承いただいてから、お支払い（銀行振込・前払い）。未発表製品にはNDAで対応します。",
  },
  {
    key: "shop.flow.3.no",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP03 番号",
    kind: "text",
    maxLen: 20,
    defaultText:
      "STEP 03",
  },
  {
    key: "shop.flow.3.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP03 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "発送 → 施工",
  },
  {
    key: "shop.flow.3.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP03 本文",
    kind: "multiline",
    maxLen: 120,
    defaultText:
      "造形物を工房へお送りください。受入検品とビフォー撮影ののち、研磨・脱脂・プラサフ・足付け・塗装まで、全9工程で仕上げます。未経験素材はテストピースで確認してから。",
  },
  {
    key: "shop.flow.4.no",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP04 番号",
    kind: "text",
    maxLen: 20,
    defaultText:
      "STEP 04",
  },
  {
    key: "shop.flow.4.title",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP04 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "硬化・検品 → お届け",
  },
  {
    key: "shop.flow.4.body",
    page: "shop",
    route: "/shop",
    label: "SHOP / STEP04 本文",
    kind: "multiline",
    maxLen: 100,
    defaultText:
      "2液ウレタンの完全硬化（5〜7日）を待ち、ブツ・タレ・肌・艶など8項目の検品を通してから、丁寧に梱包して返送します。生乾きで送ることはしません。",
  },
  {
    key: "shop.flow.footnote",
    page: "shop",
    route: "/shop",
    label: "SHOP / HOW TO ORDER 注記 (rich, リンク×2)",
    kind: "rich",
    maxLen: 200,
    defaultText:
      "お支払い方法・時期、送料、返品条件などの取引条件は[特定商取引法に基づく表記](/tokushoho)を、よくある質問は[相談ページのFAQ](/contact)をご確認ください。オンライン決済（クレジットカード）は現在準備中で、対応開始時に各商品の「購入」ボタンが有効になります。",
  },
  {
    key: "shop.simulator.fallback",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 価格未設定時フォールバック",
    kind: "text",
    maxLen: 25,
    defaultText:
      "価格はお問い合わせください。",
  },
  {
    key: "shop.simulator.quoteonly.default",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 個別見積もり文言 (最小帯)",
    kind: "text",
    maxLen: 40,
    defaultText:
      "この帯の造形は、形状を確認のうえ個別にお見積もりします",
  },
  {
    key: "shop.simulator.quoteonly.withmax_suffix",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 個別見積もり文言 (サイズ超過, mm接尾辞)",
    kind: "text",
    maxLen: 45,
    defaultText:
      "mmを超える造形は、形状を確認のうえ個別にお見積もりします",
  },
  {
    key: "shop.simulator.total.quoteonly",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 合計 (個別見積もり時)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "個別見積もり",
  },
  {
    key: "shop.simulator.per.prefix",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 1点あたり接頭辞",
    kind: "text",
    maxLen: 20,
    defaultText:
      "1点あたり ",
  },
  {
    key: "shop.simulator.per.suffix",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 1点あたり接尾辞 (税込・目安)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "（税込・目安）",
  },
  {
    key: "shop.simulator.grade.optgroup.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ GRADE 選択ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "GRADE — グレード",
  },
  {
    key: "shop.simulator.size.optgroup.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ SIZE 選択ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "SIZE — 最長辺の目安",
  },
  {
    key: "shop.simulator.size.sub.s",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ サイズ帯補足 (S)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "手のひらサイズ",
  },
  {
    key: "shop.simulator.size.sub.m",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ サイズ帯補足 (M)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "主戦場サイズ",
  },
  {
    key: "shop.simulator.size.sub.l",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ サイズ帯補足 (L)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "大きめの造形",
  },
  {
    key: "shop.simulator.size.sub.xl",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ サイズ帯補足 (XL)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "個別見積もり",
  },
  {
    key: "shop.simulator.qty.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ QUANTITY ラベル",
    kind: "text",
    maxLen: 30,
    defaultText:
      "QUANTITY — 個数（同一品）",
  },
  {
    key: "shop.simulator.total.label",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ ESTIMATED TOTAL ラベル",
    kind: "text",
    maxLen: 45,
    defaultText:
      "ESTIMATED TOTAL — 概算合計（税込・目安）",
  },
  {
    key: "shop.simulator.row.grade",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 内訳行ラベル (グレード)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "グレード",
  },
  {
    key: "shop.simulator.row.size",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 内訳行ラベル (サイズ帯)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "サイズ帯",
  },
  {
    key: "shop.simulator.row.qty",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 内訳行ラベル (個数)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "個数",
  },
  {
    key: "shop.simulator.row.slide",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 内訳行ラベル (数量スライド)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "数量スライド",
  },
  {
    key: "shop.simulator.opt.none",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ オプション未選択時表示 (なし)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "なし",
  },
  {
    key: "shop.simulator.footnote",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 注記",
    kind: "multiline",
    maxLen: 120,
    defaultText:
      "※ 立ち上げ期の概算目安です。形状の複雑さ・素材・色により変動します。初回のみ治具・段取り費を別途（リピート時免除）。送料は実費です。正式なお見積もりでご確定ください。",
  },
  {
    key: "shop.simulator.toast.copied",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ コピー成功トースト",
    kind: "text",
    maxLen: 35,
    defaultText:
      "内容をコピーしました。相談ページへ移動します…",
  },
  {
    key: "shop.simulator.toast.redirect",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ 相談ページ遷移トースト",
    kind: "text",
    maxLen: 20,
    defaultText:
      "相談ページへ移動します…",
  },
];
