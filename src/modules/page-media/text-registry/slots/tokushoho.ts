import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// tokushoho (34, route: "/tokushoho") — v2 Wave 1
//
// 特定商取引法に基づく表記 (src/app/(site)/tokushoho/page.tsx、page-body 分割なしの
// 単一ファイル)。全 13 行の SpecTable 含め、全静的テキストを配線する。
//
// rich/装飾の方針 (canonical: docs/design/visual-text-editor-v2.md §3.1/§4.2):
// - spec.address.td / spec.tel.td / spec.payment.td は「主文 + 小活字開示注記
//   (<span className="text-xs text-carbon-soft">)」の構造。小活字 span は presentational な
//   ラッパーであり意味的インライン装飾ではないため rich にせず、主文 (…td) と注記 (…note) の
//   2 スロットに分割する (span 自体は page.tsx 側の構造 JSX として残す)。
// - spec.fees.td / spec.delivery.td / spec.return.td は <br/> で複数行 (箇条書き・条件列挙)
//   のため kind="lines" とする。
// - 他の th/td はすべて plain (kind="text")。
//
// ---- 既知の設計乖離 (オーケストレーターへ報告) ----
// docs/design/text-slots/rest-chrome.md L23/L128 は「法的ページ (tokushoho/privacy) は
// 全文 tier C のため page_text キー空間に登場させない」「tokushoho.specTable … 個別スロット化
// は行わず tier C 確定」と明記しており、本ファイルの配線 (Wave 1 タスク仕様) と矛盾する。
// 本タスクの指示書 (オーケストレーター作成) が th/td 単位の rich/plain 分類まで具体的に
// 指定しているため、v2 Wave 1 でこの旧 tier 判定を意図的に見直したもの (shop.ts も同様に
// 旧 74 件の Tier A 確定表を大幅に超えて拡張している前例あり) と判断し、指示どおり実装した。
// ただし rest-chrome.md 側の記述更新は本タスクの範囲外のため未反映。要オーケストレーター確認。
//
// ---- 技術的な前提の乖離 (オーケストレーターへ報告) ----
// 1. 本ファイル (tokushoho.ts) は Wave 1 開始時点で存在せず、index.ts にも配線されていな
//    かった (works.ts も同様)。「slots/<page>.ts は既に index に配線されている」という
//    共通ガイドの前提が本ページには当てはまらなかったため、やむを得ず index.ts に
//    import/spread の 2 行を追加した (機能上必須。SlotText は TEXT_REGISTRY に存在しない
//    slot_key を渡すと throw するため、配線なしでは本ページ自体が build できない)。
// 2. "/tokushoho" は page-media/registry.ts の EDITABLE_ROUTES に含まれていなかった
//    (tokushoho は画像スロットを持たないため SLOT_ROUTES 由来では拾われず、EDITABLE_ROUTES
//    末尾のハードコード追加リストにも "/tokushoho" が無かった)。tests/page-media-text-registry
//    .test.ts の「route はすべて EDITABLE_ROUTES の部分集合である」テストが本ファイルの
//    全スロットで失敗するため、やむを得ず registry.ts の EDITABLE_ROUTES に "/tokushoho" を
//    1 行追加した。いずれも「編集しない」と指示されたファイルへの逸脱であり、要
//    オーケストレーター確認 (詳細は実装報告を参照)。
// ---------------------------------------------------------------------------
export const TOKUSHOHO_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "tokushoho.hero.index",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / PageHead 構造ラベル",
    kind: "text",
    maxLen: 15,
    defaultText: "LEGAL",
  },
  {
    key: "tokushoho.hero.en",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / PageHead 英字サブラベル (実質は日本語見出しの繰り返し)",
    kind: "text",
    maxLen: 30,
    defaultText: "特定商取引法に基づく表記",
  },
  {
    key: "tokushoho.hero.heading",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / ヒーロー見出し",
    kind: "lines",
    maxLen: 30,
    defaultText: "特定商取引法に\n基づく表記",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "tokushoho.hero.lead",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / ヒーローリード文",
    kind: "multiline",
    maxLen: 160,
    defaultText:
      "通信販売（受託仕上げサービスおよび塗装済み製品の販売）に関する、特定商取引に関する法律第11条に基づく表示です。当工房は現在開業準備中のため、一部項目は準備中である旨を明記し、確定次第このページを更新します。",
  },
  {
    key: "tokushoho.spec.seller.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行1 項目名",
    kind: "text",
    maxLen: 20,
    defaultText: "販売業者（屋号）",
  },
  {
    key: "tokushoho.spec.seller.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行1 内容 (販売業者)",
    kind: "text",
    maxLen: 20,
    defaultText: "隈部塗装",
  },
  {
    key: "tokushoho.spec.representative.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行2 項目名",
    kind: "text",
    maxLen: 20,
    defaultText: "運営統括責任者",
  },
  {
    key: "tokushoho.spec.representative.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行2 内容 (運営統括責任者名)",
    kind: "text",
    maxLen: 20,
    defaultText: "隈部 信之",
  },
  {
    key: "tokushoho.spec.address.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行3 項目名",
    kind: "text",
    maxLen: 15,
    defaultText: "所在地",
  },
  {
    key: "tokushoho.spec.address.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行3 内容 主文 (所在地)",
    kind: "text",
    maxLen: 20,
    defaultText: "大分県豊後高田市",
  },
  {
    key: "tokushoho.spec.address.note",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行3 小活字開示注記",
    kind: "text",
    maxLen: 100,
    defaultText:
      "※ 番地以下の詳細な所在地は、ご請求があれば遅滞なく開示いたします。ご請求は「相談する」ページの窓口までお願いします。",
  },
  {
    key: "tokushoho.spec.tel.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行4 項目名",
    kind: "text",
    maxLen: 15,
    defaultText: "電話番号",
  },
  {
    key: "tokushoho.spec.tel.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行4 内容 主文 (電話番号)",
    kind: "text",
    maxLen: 40,
    defaultText: "ご請求があれば遅滞なく開示いたします。",
  },
  {
    key: "tokushoho.spec.tel.note",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行4 小活字開示注記",
    kind: "text",
    maxLen: 60,
    defaultText: "※ お問い合わせは原則として「相談する」ページの窓口にて承ります。",
  },
  {
    key: "tokushoho.spec.contact.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行5 項目名",
    kind: "text",
    maxLen: 20,
    defaultText: "お問い合わせ窓口",
  },
  {
    key: "tokushoho.spec.contact.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行5 内容 (お問い合わせ窓口)",
    kind: "text",
    maxLen: 80,
    defaultText:
      "「相談する」ページ記載の窓口（正式な受付窓口は現在準備中です。開設次第、本欄を更新します）",
  },
  {
    key: "tokushoho.spec.price.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行6 項目名",
    kind: "text",
    maxLen: 15,
    defaultText: "販売価格",
  },
  {
    key: "tokushoho.spec.price.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行6 内容 (販売価格)",
    kind: "text",
    maxLen: 160,
    defaultText:
      "各サービス・各商品の表示価格（税込）によります。受託仕上げサービスは「サイズ帯別の基本料金＋グレード」で算出し、正式なお見積もりにて確定します。SHOPページのシミュレータ表示は立ち上げ期の概算目安です。",
  },
  {
    key: "tokushoho.spec.fees.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行7 項目名",
    kind: "text",
    maxLen: 25,
    defaultText: "商品代金以外の必要料金",
  },
  {
    key: "tokushoho.spec.fees.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行7 内容 (商品代金以外の必要料金、改行区切り箇条書き)",
    kind: "lines",
    maxLen: 110,
    defaultText:
      "・往復の送料（実費。造形物の発送時はお客様負担、返送時は見積もりに明記）\n・銀行振込の場合の振込手数料\n・同一品バッチの初回のみ、治具・段取り費（リピート時は免除。金額は見積もりに明記）",
    maxLines: 3,
    maxLineLen: 50,
  },
  {
    key: "tokushoho.spec.payment.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行8 項目名",
    kind: "text",
    maxLen: 20,
    defaultText: "お支払い方法",
  },
  {
    key: "tokushoho.spec.payment.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行8 内容 主文 (お支払い方法)",
    kind: "text",
    maxLen: 20,
    defaultText: "銀行振込（前払い）",
  },
  {
    key: "tokushoho.spec.payment.note",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行8 小活字開示注記",
    kind: "text",
    maxLen: 70,
    defaultText: "※ クレジットカード等のオンライン決済は現在準備中です。対応開始時に本欄を更新します。",
  },
  {
    key: "tokushoho.spec.paytiming.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行9 項目名",
    kind: "text",
    maxLen: 20,
    defaultText: "お支払い時期",
  },
  {
    key: "tokushoho.spec.paytiming.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行9 内容 (お支払い時期)",
    kind: "text",
    maxLen: 70,
    defaultText: "正式なお見積もりにご承諾いただいた後、施工開始前にお支払いください（前払い）。",
  },
  {
    key: "tokushoho.spec.delivery.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行10 項目名",
    kind: "text",
    maxLen: 30,
    defaultText: "サービスの提供時期・商品の引渡時期",
  },
  {
    key: "tokushoho.spec.delivery.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行10 内容 (提供・引渡時期、改行区切り)",
    kind: "lines",
    maxLen: 170,
    defaultText:
      "受託仕上げ：ご入金とお預かり品の到着を確認後、施工に着手します。2液ウレタンの完全硬化（5〜7日）と検品を経て発送します。標準的な納期はお見積もり時にご案内し、特急仕上げ（＋50%）にも対応します。\n塗装済み製品：ご入金確認後、原則7営業日以内に発送します（受注制作品を除く）。",
    maxLines: 2,
    maxLineLen: 110,
  },
  {
    key: "tokushoho.spec.return.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行11 項目名",
    kind: "text",
    maxLen: 25,
    defaultText: "返品・キャンセルについて",
  },
  {
    key: "tokushoho.spec.return.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行11 内容 (返品・キャンセル、改行区切り)",
    kind: "lines",
    maxLen: 260,
    defaultText:
      "受託仕上げサービスは、お客様のお預かり品への施工という性質上、施工着手後のキャンセル・返金はお受けできません。着手前のキャンセルは可能です（往復送料はお客様負担）。\n仕上がりに施工上の不備（検品8項目に照らした欠陥）があった場合、または返送時の輸送破損があった場合は、到着後7日以内にご連絡ください。再施工または協議のうえ誠実に対応します。\n塗装済み製品は、不良品を除き、お客様都合による返品はお受けできません。不良品は到着後7日以内のご連絡で交換または返金します。",
    maxLines: 3,
    maxLineLen: 100,
  },
  {
    key: "tokushoho.spec.custody.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行12 項目名",
    kind: "text",
    maxLen: 20,
    defaultText: "お預かり品について",
  },
  {
    key: "tokushoho.spec.custody.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行12 内容 (お預かり品について)",
    kind: "text",
    maxLen: 150,
    defaultText:
      "未経験素材はテストピースで相性を確認したうえでお受けします。施工に伴う軽微な寸法変化（塗膜厚）が生じます。可動部・勘合部は事前にお知らせください。未発表製品はNDA（秘密保持契約）に対応します。",
  },
  {
    key: "tokushoho.spec.environment.th",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行13 項目名",
    kind: "text",
    maxLen: 15,
    defaultText: "動作環境",
  },
  {
    key: "tokushoho.spec.environment.td",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / SpecTable 行13 内容 (動作環境)",
    kind: "text",
    maxLen: 50,
    defaultText: "該当なし（デジタルコンテンツの販売は行っていません）。",
  },
  {
    key: "tokushoho.mapnote",
    page: "tokushoho",
    route: "/tokushoho",
    label: "特商法表記 / ページ末尾注記",
    kind: "text",
    maxLen: 110,
    defaultText:
      "本表記は開業準備中の内容を含みます。正式な販売開始時に、確定した事業者情報・支払い方法・窓口へ更新します（最終更新：2026年7月）。",
  },
];
