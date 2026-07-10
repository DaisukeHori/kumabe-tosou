import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// service (136, route: "/service")
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): 既存8件 (hero.heading/hero.lead/
// process.aside.heading/terms.heading/qc.heading/gallery.heading/cta.heading/cta.note) は
// そのまま維持し、page-body.tsx の残り全静的テキストを追加 (rich 0件、全て plain)。
// 反復構造 (PROCESS STEP×5 / GRADE×3 / QUANTITY・OPTIONS 表 / FLOW セル×7 / できること・
// ご了承いただきたいこと×5+5 / QC項目×8 / PhotoFigure×4) は index 付き slot_key
// (`service.<section>.<n>.<field>`) で個別に採番。defaultText は現行描画テキストと1文字も
// 違わない (非退行)。PageHead index/en・SectionMark label (no は対象外、shop.ts と同方針)・
// PhotoFigure capJa/capEn/credit も配線。SecLead/MapNote に埋め込む文言は forced <p> root
// との両立のため kind="text" (shop.simulator.lead 等と同方針)。
// ---------------------------------------------------------------------------
export const SERVICE_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "service.hero.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "下地は全グレード共通。\nだから品質が揺れない。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "service.hero.lead",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。",
  },
  {
    key: "service.process.aside.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / 「なぜ鏡面磨きをしないのか」見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "なぜ鏡面磨きをしないのか",
  },
  {
    key: "service.terms.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / HONEST TERMS 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "正直に、先にお伝えします。",
  },
  {
    key: "service.qc.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUALITY CONTROL 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "発送前に、8つの目で見る。",
  },
  {
    key: "service.gallery.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GALLERY 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "工程の、その手。",
  },
  {
    key: "service.cta.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
    maxLines: 2,
  },
  {
    key: "service.cta.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "造形データや写真があれば、より正確に概算をお出しできます。",
  },
  {
    key: "service.hero.index",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PageHead 連番表記 (INDEX NN — ページ名)",
    kind: "text",
    maxLen: 30,
    defaultText:
      "INDEX 03 — SERVICE",
  },
  {
    key: "service.hero.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PageHead 英字サブラベル",
    kind: "text",
    maxLen: 45,
    defaultText:
      "PROCESS / GRADE / PRICE / FLOW",
  },
  {
    key: "service.sec.1.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / SEC.01 セクションラベル",
    kind: "text",
    maxLen: 30,
    defaultText:
      "PROCESS — 全メニュー共通の下地",
  },
  {
    key: "service.process.step.1.grit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP1 番手表記",
    kind: "text",
    maxLen: 10,
    defaultText:
      "#800",
  },
  {
    key: "service.process.step.1.step",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP1 STEPラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "STEP 01 / SAND",
  },
  {
    key: "service.process.step.1.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP1 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "素地研磨",
  },
  {
    key: "service.process.step.1.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP1 本文",
    kind: "multiline",
    maxLen: 90,
    defaultText:
      "積層痕を面で捉えて研ぎ落とします。FDMも光造形も、ここで平滑の土台を作ります。塗装の出来の大半は、この工程で決まります。",
  },
  {
    key: "service.process.step.2.grit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP2 番手表記",
    kind: "text",
    maxLen: 7,
    defaultText:
      "PS",
  },
  {
    key: "service.process.step.2.step",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP2 STEPラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "STEP 02 / PRIME",
  },
  {
    key: "service.process.step.2.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP2 見出し",
    kind: "text",
    maxLen: 11,
    defaultText:
      "プラサフ吹付",
  },
  {
    key: "service.process.step.2.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP2 本文",
    kind: "multiline",
    maxLen: 110,
    defaultText:
      "プライマーサフェーサーを厚めに吹き、研磨で残った微細な段差を膜で埋めます。海外の3Dプリント仕上げでも、自動車用厚膜プラサフによる積層痕埋めは定番手法です。",
  },
  {
    key: "service.process.step.3.grit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP3 番手表記",
    kind: "text",
    maxLen: 10,
    defaultText:
      "#1200",
  },
  {
    key: "service.process.step.3.step",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP3 STEPラベル",
    kind: "text",
    maxLen: 30,
    defaultText:
      "STEP 03 / WET-SAND",
  },
  {
    key: "service.process.step.3.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP3 見出し",
    kind: "text",
    maxLen: 11,
    defaultText:
      "水研ぎ仕上げ",
  },
  {
    key: "service.process.step.3.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP3 本文",
    kind: "multiline",
    maxLen: 115,
    defaultText:
      "プロの板金塗装は #600〜800 で平滑化し、#1000〜1200 で仕上げます。一般的なDIY標準より1〜2段丁寧な、上塗りにとって十分以上の平滑面です。",
  },
  {
    key: "service.process.step.4.grit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP4 番手表記",
    kind: "text",
    maxLen: 7,
    defaultText:
      "2K",
  },
  {
    key: "service.process.step.4.step",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP4 STEPラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "STEP 04 / TOPCOAT",
  },
  {
    key: "service.process.step.4.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP4 見出し",
    kind: "text",
    maxLen: 8,
    defaultText:
      "上塗り",
  },
  {
    key: "service.process.step.4.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP4 本文",
    kind: "multiline",
    maxLen: 80,
    defaultText:
      "ソリッド＋クリア、または3コートパール。市販の調色済み自動車補修塗料と2液ウレタンで、硬く艶やかに仕上げます。",
  },
  {
    key: "service.process.step.5.grit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP5 番手表記",
    kind: "text",
    maxLen: 10,
    defaultText:
      "CURE",
  },
  {
    key: "service.process.step.5.step",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP5 STEPラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "STEP 05 / 硬化・検品",
  },
  {
    key: "service.process.step.5.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP5 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "硬化・検品",
  },
  {
    key: "service.process.step.5.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS STEP5 本文",
    kind: "multiline",
    maxLen: 80,
    defaultText:
      "主剤と硬化剤の化学反応で常温硬化（表面乾燥1〜3時間、完全硬化5〜7日）。硬化を確認し、検品してから発送します。",
  },
  {
    key: "service.process.aside.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / 「なぜ鏡面磨きをしないのか」本文",
    kind: "multiline",
    maxLen: 135,
    defaultText:
      "#2000〜コンパウンドの鏡面磨き工程は、あえて行いません。2液ウレタンは吹きっぱなしで自動車外板と同等の艶が出るためです。磨きに時間を使わないぶん、同じ品質で数量に応え、価格に還元します。",
  },
  {
    key: "service.process.photo.1.capja",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.01 (PROCESS) 日本語キャプション",
    kind: "text",
    maxLen: 12,
    defaultText:
      "吹き付けの工程",
  },
  {
    key: "service.process.photo.1.capen",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.01 (PROCESS) 英語キャプション",
    kind: "text",
    maxLen: 25,
    defaultText:
      "SPRAY APPLICATION",
  },
  {
    key: "service.process.photo.1.credit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.01 (PROCESS) クレジット表記",
    kind: "text",
    maxLen: 40,
    defaultText:
      "Photo: createasea / Unsplash",
  },
  {
    key: "service.process.photo.2.capja",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.02 (PROCESS) 日本語キャプション",
    kind: "text",
    maxLen: 15,
    defaultText:
      "調色済みの補修塗料",
  },
  {
    key: "service.process.photo.2.capen",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.02 (PROCESS) 英語キャプション",
    kind: "text",
    maxLen: 25,
    defaultText:
      "AUTOMOTIVE PAINT",
  },
  {
    key: "service.process.photo.2.credit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.02 (PROCESS) クレジット表記",
    kind: "text",
    maxLen: 40,
    defaultText:
      "Photo: jacobsoup / Unsplash",
  },
  {
    key: "service.process.cta",
    page: "service",
    route: "/service",
    label: "サービス・料金 / PROCESS セクション ボタン文言",
    kind: "text",
    maxLen: 20,
    defaultText:
      "全9工程を、層構造から見る",
  },
  {
    key: "service.sec.2.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / SEC.02 セクションラベル",
    kind: "text",
    maxLen: 30,
    defaultText:
      "GRADE — 差分はトップコートだけ",
  },
  {
    key: "service.grade.1.badge",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE1 バッジ (GRADE 0N)",
    kind: "text",
    maxLen: 15,
    defaultText:
      "GRADE 01",
  },
  {
    key: "service.grade.1.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE1 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "下地仕上げ",
  },
  {
    key: "service.grade.1.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE1 本文",
    kind: "multiline",
    maxLen: 50,
    defaultText:
      "#800 研磨＋プラサフ＋#1200 仕上げで納品。塗装はしません。",
  },
  {
    key: "service.grade.1.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE1 補足文",
    kind: "text",
    maxLen: 45,
    defaultText:
      "最終色をご自身で吹く造形作家・ガレージキット層・試作会社の方へ。",
  },
  {
    key: "service.grade.2.badge",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE2 バッジ (GRADE 0N)",
    kind: "text",
    maxLen: 15,
    defaultText:
      "GRADE 02",
  },
  {
    key: "service.grade.2.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE2 見出し",
    kind: "text",
    maxLen: 11,
    defaultText:
      "スタンダード",
  },
  {
    key: "service.grade.2.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE2 本文",
    kind: "multiline",
    maxLen: 30,
    defaultText:
      "下地＋ソリッドカラー＋2液ウレタンクリア。",
  },
  {
    key: "service.grade.2.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE2 補足文",
    kind: "text",
    maxLen: 35,
    defaultText:
      "単色の製品試作・小ロット生産品の外観仕上げに。",
  },
  {
    key: "service.grade.3.badge",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE3 バッジ (GRADE 0N)",
    kind: "text",
    maxLen: 15,
    defaultText:
      "GRADE 03",
  },
  {
    key: "service.grade.3.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE3 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "プレミアム",
  },
  {
    key: "service.grade.3.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE3 本文",
    kind: "multiline",
    maxLen: 35,
    defaultText:
      "下地＋3コートパール（ベース＋パール＋クリア）。",
  },
  {
    key: "service.grade.3.price",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE3 価格",
    kind: "text",
    maxLen: 30,
    defaultText:
      "¥15,000–35,000 / 1点",
  },
  {
    key: "service.grade.3.price.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE3 価格注記",
    kind: "text",
    maxLen: 20,
    defaultText:
      "目安。サイズにより変動します",
  },
  {
    key: "service.grade.3.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE3 補足文",
    kind: "text",
    maxLen: 50,
    defaultText:
      "商談・展示会・クラウドファンディング掲載写真のための最上位仕上げ。",
  },
  {
    key: "service.quantity.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 見出し",
    kind: "text",
    maxLen: 30,
    defaultText:
      "QUANTITY — 数量スライド（目安）",
  },
  {
    key: "service.quantity.row.1.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 行1 ラベル",
    kind: "text",
    maxLen: 8,
    defaultText:
      "〜9個",
  },
  {
    key: "service.quantity.row.1.value",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 行1 値",
    kind: "text",
    maxLen: 7,
    defaultText:
      "定価",
  },
  {
    key: "service.quantity.row.2.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 行2 ラベル",
    kind: "text",
    maxLen: 11,
    defaultText:
      "10〜29個",
  },
  {
    key: "service.quantity.row.2.value",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 行2 値",
    kind: "text",
    maxLen: 10,
    defaultText:
      "−15%",
  },
  {
    key: "service.quantity.row.3.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 行3 ラベル",
    kind: "text",
    maxLen: 10,
    defaultText:
      "30個〜",
  },
  {
    key: "service.quantity.row.3.value",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 行3 値",
    kind: "text",
    maxLen: 10,
    defaultText:
      "−25%",
  },
  {
    key: "service.quantity.footnote",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUANTITY 注記",
    kind: "multiline",
    maxLen: 105,
    defaultText:
      "同一品のバッチ仕上げ・カラーバリエーション展開に対応。初回のみ治具・段取り費をいただき、リピート時は免除します。繰り返すほど、双方に有利な構造です。",
  },
  {
    key: "service.options.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 見出し",
    kind: "text",
    maxLen: 25,
    defaultText:
      "OPTIONS — 加算・個別対応",
  },
  {
    key: "service.options.row.1.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 行1 ラベル",
    kind: "text",
    maxLen: 10,
    defaultText:
      "特急仕上げ",
  },
  {
    key: "service.options.row.1.value",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 行1 値",
    kind: "text",
    maxLen: 10,
    defaultText:
      "+50%",
  },
  {
    key: "service.options.row.2.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 行2 ラベル",
    kind: "text",
    maxLen: 12,
    defaultText:
      "大型・特殊案件",
  },
  {
    key: "service.options.row.2.value",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 行2 値",
    kind: "text",
    maxLen: 11,
    defaultText:
      "個別見積もり",
  },
  {
    key: "service.options.row.3.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 行3 ラベル",
    kind: "text",
    maxLen: 30,
    defaultText:
      "色番号指定（日塗工・自動車カラーコード）",
  },
  {
    key: "service.options.row.3.value",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 行3 値",
    kind: "text",
    maxLen: 7,
    defaultText:
      "対応",
  },
  {
    key: "service.options.footnote",
    page: "service",
    route: "/service",
    label: "サービス・料金 / OPTIONS 注記",
    kind: "multiline",
    maxLen: 115,
    defaultText:
      "価格は「サイズ帯別の基本料金＋グレード加算」で算出します。立ち上げ期につき実績価格でご提供中——正式価格表は作業実測に基づいて確定し、このページで公開します。",
  },
  {
    key: "service.grades.cta",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GRADE セクション ボタン文言",
    kind: "text",
    maxLen: 25,
    defaultText:
      "SHOPのシミュレータで概算を出す",
  },
  {
    key: "service.sec.3.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / SEC.03 セクションラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "FLOW — 郵送で、全国から",
  },
  {
    key: "service.flow.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "依頼の流れ",
  },
  {
    key: "service.flow.lead",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW リード文",
    kind: "text",
    maxLen: 80,
    defaultText:
      "主戦場は手のひら〜200×200mm級の小〜中型品。送料が軽微なサイズ帯なら、地方立地のハンデはありません。",
  },
  {
    key: "service.flow.cell.1.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル1 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "ご相談・お見積もり",
  },
  {
    key: "service.flow.cell.1.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル1 本文",
    kind: "multiline",
    maxLen: 45,
    defaultText:
      "サイズ × 個数 × グレードの3点で概算をお出しします。",
  },
  {
    key: "service.flow.cell.2.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル2 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "造形物を工房へ発送",
  },
  {
    key: "service.flow.cell.2.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル2 本文",
    kind: "multiline",
    maxLen: 45,
    defaultText:
      "データ入稿 → 提携出力 → 工房直送の流れにも対応します。",
  },
  {
    key: "service.flow.cell.3.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル3 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "受入検品・ビフォー撮影",
  },
  {
    key: "service.flow.cell.3.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル3 本文",
    kind: "multiline",
    maxLen: 25,
    defaultText:
      "状態を記録してから工程に入ります。",
  },
  {
    key: "service.flow.cell.4.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル4 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "下地工程",
  },
  {
    key: "service.flow.cell.4.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル4 本文",
    kind: "multiline",
    maxLen: 40,
    defaultText:
      "#800 研磨 → プラサフ → #1200 水研ぎ。",
  },
  {
    key: "service.flow.cell.5.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル5 見出し",
    kind: "text",
    maxLen: 8,
    defaultText:
      "上塗り",
  },
  {
    key: "service.flow.cell.5.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル5 本文",
    kind: "multiline",
    maxLen: 40,
    defaultText:
      "グレード別に施工。火気厳禁・換気管理のもとで行います。",
  },
  {
    key: "service.flow.cell.6.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル6 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "硬化・アフター撮影",
  },
  {
    key: "service.flow.cell.6.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル6 本文",
    kind: "multiline",
    maxLen: 40,
    defaultText:
      "常温または赤外線ヒーターで硬化。仕上がりを記録します。",
  },
  {
    key: "service.flow.cell.7.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル7 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "梱包・発送",
  },
  {
    key: "service.flow.cell.7.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW セル7 本文",
    kind: "multiline",
    maxLen: 35,
    defaultText:
      "完全硬化前後の取り扱い注意点を添えてお届けします。",
  },
  {
    key: "service.flow.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FLOW 注記",
    kind: "text",
    maxLen: 75,
    defaultText:
      "※ 進行中の写真は守秘義務の範囲で管理し、実績としての掲載は案件ごとに許諾をいただきます。NDA対応可。",
  },
  {
    key: "service.sec.4.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / SEC.04 セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "HONEST TERMS",
  },
  {
    key: "service.terms.can.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / できること 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "できること",
  },
  {
    key: "service.terms.can.1",
    page: "service",
    route: "/service",
    label: "サービス・料金 / できること 項目1",
    kind: "text",
    maxLen: 35,
    defaultText:
      "色番号指定（日塗工番号・自動車カラーコード）",
  },
  {
    key: "service.terms.can.2",
    page: "service",
    route: "/service",
    label: "サービス・料金 / できること 項目2",
    kind: "text",
    maxLen: 35,
    defaultText:
      "同一品のバッチ仕上げ・カラーバリエーション展開",
  },
  {
    key: "service.terms.can.3",
    page: "service",
    route: "/service",
    label: "サービス・料金 / できること 項目3",
    kind: "text",
    maxLen: 25,
    defaultText:
      "NDA対応・掲載許諾の案件ごと管理",
  },
  {
    key: "service.terms.can.4",
    page: "service",
    route: "/service",
    label: "サービス・料金 / できること 項目4",
    kind: "text",
    maxLen: 20,
    defaultText:
      "大型・特殊案件の個別見積もり",
  },
  {
    key: "service.terms.can.5",
    page: "service",
    route: "/service",
    label: "サービス・料金 / できること 項目5",
    kind: "text",
    maxLen: 20,
    defaultText:
      "未経験素材のテストピース確認",
  },
  {
    key: "service.terms.cannot.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ご了承いただきたいこと 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "ご了承いただきたいこと",
  },
  {
    key: "service.terms.cannot.1",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ご了承いただきたいこと 項目1",
    kind: "text",
    maxLen: 65,
    defaultText:
      "純正色のピタリ合わせ（調色）は対象外です。市販の調色済み補修塗料による「参考色」仕上げです。",
  },
  {
    key: "service.terms.cannot.2",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ご了承いただきたいこと 項目2",
    kind: "text",
    maxLen: 50,
    defaultText:
      "2液ウレタンの完全硬化は5〜7日。発送は硬化を確認してからになります。",
  },
  {
    key: "service.terms.cannot.3",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ご了承いただきたいこと 項目3",
    kind: "text",
    maxLen: 45,
    defaultText:
      "経験のない樹脂素材は、テストピースでの相性確認を挟みます。",
  },
  {
    key: "service.terms.cannot.4",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ご了承いただきたいこと 項目4",
    kind: "text",
    maxLen: 55,
    defaultText:
      "繁忙期は「納期◯週間待ち」を表示して受注を絞ります。品質を落とさないためです。",
  },
  {
    key: "service.terms.cannot.5",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ご了承いただきたいこと 項目5",
    kind: "text",
    maxLen: 45,
    defaultText:
      "輸送中の破損に備え、梱包基準と保証条件を事前に明示します。",
  },
  {
    key: "service.sec.5.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / SEC.05 セクションラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "QUALITY CONTROL",
  },
  {
    key: "service.qc.lead",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUALITY CONTROL リード文",
    kind: "text",
    maxLen: 90,
    defaultText:
      "自動車補修の現場で使われる検品項目を、そのまま持ち込んでいます。仕上がりは主観ではなく、チェックリストで確認してから梱包します。",
  },
  {
    key: "service.qc.item.1.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目1 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "タレ・ダレ",
  },
  {
    key: "service.qc.item.1.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目1 英字ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "RUNS / SAGS",
  },
  {
    key: "service.qc.item.1.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目1 本文",
    kind: "multiline",
    maxLen: 55,
    defaultText:
      "塗料が流れて溜まった跡がないか。厚塗りを避け、薄く重ねることで防ぎます。",
  },
  {
    key: "service.qc.item.2.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目2 見出し",
    kind: "text",
    maxLen: 8,
    defaultText:
      "ゆず肌",
  },
  {
    key: "service.qc.item.2.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目2 英字ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "ORANGE PEEL",
  },
  {
    key: "service.qc.item.2.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目2 本文",
    kind: "multiline",
    maxLen: 55,
    defaultText:
      "表面がミカンの皮のように凸凹していないか。吹き付けの距離と量で管理します。",
  },
  {
    key: "service.qc.item.3.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目3 見出し",
    kind: "text",
    maxLen: 8,
    defaultText:
      "色ムラ",
  },
  {
    key: "service.qc.item.3.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目3 英字ラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "COLOR CONSISTENCY",
  },
  {
    key: "service.qc.item.3.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目3 本文",
    kind: "multiline",
    maxLen: 55,
    defaultText:
      "光の当たり方を変えても、色が均一に見えるか。特にメタリック・パールで重要です。",
  },
  {
    key: "service.qc.item.4.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目4 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "塗り残し",
  },
  {
    key: "service.qc.item.4.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目4 英字ラベル",
    kind: "text",
    maxLen: 15,
    defaultText:
      "COVERAGE",
  },
  {
    key: "service.qc.item.4.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目4 本文",
    kind: "multiline",
    maxLen: 60,
    defaultText:
      "エッジや奥まった箇所に、薄い部分・塗り残しがないか。角と縁を重点的に確認します。",
  },
  {
    key: "service.qc.item.5.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目5 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "異物混入",
  },
  {
    key: "service.qc.item.5.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目5 英字ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "CONTAMINATION",
  },
  {
    key: "service.qc.item.5.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目5 本文",
    kind: "multiline",
    maxLen: 55,
    defaultText:
      "塗膜にホコリ・毛・ゴミが噛み込んでいないか。塗装環境の清浄度で防ぎます。",
  },
  {
    key: "service.qc.item.6.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目6 見出し",
    kind: "text",
    maxLen: 7,
    defaultText:
      "密着",
  },
  {
    key: "service.qc.item.6.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目6 英字ラベル",
    kind: "text",
    maxLen: 15,
    defaultText:
      "ADHESION",
  },
  {
    key: "service.qc.item.6.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目6 本文",
    kind: "multiline",
    maxLen: 55,
    defaultText:
      "塗膜が素地にしっかり食いついているか。洗浄・脱脂・下地の徹底で担保します。",
  },
  {
    key: "service.qc.item.7.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目7 見出し",
    kind: "text",
    maxLen: 11,
    defaultText:
      "エッジの被り",
  },
  {
    key: "service.qc.item.7.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目7 英字ラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "EDGE QUALITY",
  },
  {
    key: "service.qc.item.7.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目7 本文",
    kind: "multiline",
    maxLen: 55,
    defaultText:
      "角・縁まで塗膜が回り込み、めくれや欠けがないか。輸送に耐える塗り際に整えます。",
  },
  {
    key: "service.qc.item.8.title",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目8 見出し",
    kind: "text",
    maxLen: 10,
    defaultText:
      "硬化状態",
  },
  {
    key: "service.qc.item.8.en",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目8 英字ラベル",
    kind: "text",
    maxLen: 10,
    defaultText:
      "CURE",
  },
  {
    key: "service.qc.item.8.body",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QC項目8 本文",
    kind: "multiline",
    maxLen: 50,
    defaultText:
      "2液ウレタンが完全硬化しているか。硬化を確認してから梱包・発送します。",
  },
  {
    key: "service.gallery.label",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GALLERY セクションラベル",
    kind: "text",
    maxLen: 15,
    defaultText:
      "THE HANDS",
  },
  {
    key: "service.gallery.lead",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GALLERY リード文",
    kind: "text",
    maxLen: 40,
    defaultText:
      "工程の一つひとつに、自動車補修で培った手が入ります。",
  },
  {
    key: "service.gallery.photo.1.capja",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.03 (GALLERY) 日本語キャプション",
    kind: "text",
    maxLen: 7,
    defaultText:
      "研ぐ",
  },
  {
    key: "service.gallery.photo.1.capen",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.03 (GALLERY) 英語キャプション",
    kind: "text",
    maxLen: 12,
    defaultText:
      "SANDING",
  },
  {
    key: "service.gallery.photo.1.credit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.03 (GALLERY) クレジット表記",
    kind: "text",
    maxLen: 40,
    defaultText:
      "Photo: mazinomron / Unsplash",
  },
  {
    key: "service.gallery.photo.2.capja",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.04 (GALLERY) 日本語キャプション",
    kind: "text",
    maxLen: 10,
    defaultText:
      "仕上げる",
  },
  {
    key: "service.gallery.photo.2.capen",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.04 (GALLERY) 英語キャプション",
    kind: "text",
    maxLen: 15,
    defaultText:
      "THE FINISH",
  },
  {
    key: "service.gallery.photo.2.credit",
    page: "service",
    route: "/service",
    label: "サービス・料金 / FIG.04 (GALLERY) クレジット表記",
    kind: "text",
    maxLen: 45,
    defaultText:
      "Photo: avenir_visuals / Unsplash",
  },
];
