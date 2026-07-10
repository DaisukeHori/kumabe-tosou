import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// privacy (22, route: "/privacy")
// v2 Wave 1: プライバシーポリシーページの全静的テキストを新規登録する。defaultText は
// 現行 (src/app/(site)/privacy/page.tsx) の描画テキストと1文字も違わない (非退行)。
//
// 分割方針:
// - SpecTable row 1 (事業者情報) の td は「主文3行 (屋号/代表者/所在地) + 小活字注記」の
//   構造。小活字 <span className="text-xs text-carbon-soft"> は presentational な
//   ラッパーとして構造で残し、中身のテキストのみ別スロット (privacy.spec.business.note) に
//   分割する (主文3行は kind="lines" の privacy.spec.business.td)。
// - SpecTable row 2/3 (取得する個人情報 / 利用目的) の td は「導入文 + 箇条書き」が
//   すべて <br/> 結合の単純な行区切りであるため、導入文を含めて1つの kind="lines" スロット
//   (5行) として登録する (defaultRenderLines の <br/> 結合が原文の <br/> 構成と完全一致する)。
// - MapNote (制定日 + 注記) も同様に、原文の唯一の <br/> に対応する2行の kind="lines"
//   スロットとして登録する。
// ---------------------------------------------------------------------------
export const PRIVACY_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "privacy.hero.index",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / PageHead 連番表記",
    kind: "text",
    maxLen: 20,
    defaultText: "LEGAL",
  },
  {
    key: "privacy.hero.en",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / PageHead 英字サブ表記",
    kind: "text",
    maxLen: 30,
    defaultText: "PRIVACY POLICY",
  },
  {
    key: "privacy.hero.title",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / ページ見出し",
    kind: "lines",
    maxLen: 20,
    defaultText: "プライバシーポリシー",
    maxLines: 1,
    maxLineLen: 20,
  },
  {
    key: "privacy.hero.lead",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / ページ冒頭リード文",
    kind: "multiline",
    maxLen: 250,
    defaultText:
      "隈部塗装(以下「当工房」といいます)は、お問い合わせ・お見積もり・施工のご依頼にあたってお預かりする個人情報を、以下の方針に基づき適切に取り扱います。本ページは開業準備中のドラフトであり、正式な法務チェックを経て内容を確定します。",
  },
  {
    key: "privacy.spec.business.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し1 (事業者情報)",
    kind: "text",
    maxLen: 30,
    defaultText: "1. 事業者情報",
  },
  {
    key: "privacy.spec.business.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 事業者情報 本文 (屋号/代表者/所在地)",
    kind: "lines",
    maxLen: 120,
    defaultText: "屋号：隈部塗装(くまべとそう)\n代表者：隈部 信之\n所在地：大分県豊後高田市",
    maxLines: 3,
    maxLineLen: 40,
  },
  {
    key: "privacy.spec.business.note",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 事業者情報 小活字注記 (所在地非公開の断り書き)",
    kind: "text",
    maxLen: 80,
    defaultText: "※ 番地以下の詳細な所在地は非公開とし、ご請求があれば遅滞なく開示いたします。",
  },
  {
    key: "privacy.spec.collect.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し2 (取得する個人情報)",
    kind: "text",
    maxLen: 30,
    defaultText: "2. 取得する個人情報",
  },
  {
    key: "privacy.spec.collect.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 取得する個人情報 本文 (導入文+箇条書き4行)",
    kind: "lines",
    maxLen: 225,
    defaultText:
      "お問い合わせフォーム等を通じて、以下の情報を取得します。\n・氏名\n・メールアドレス\n・電話番号(ご提供いただいた場合)\n・お問い合わせ内容、対象品目等の付随情報",
    maxLines: 5,
    maxLineLen: 45,
  },
  {
    key: "privacy.spec.purpose.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し3 (利用目的)",
    kind: "text",
    maxLen: 30,
    defaultText: "3. 利用目的",
  },
  {
    key: "privacy.spec.purpose.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 利用目的 本文 (導入文+箇条書き4行)",
    kind: "lines",
    maxLen: 225,
    defaultText:
      "取得した個人情報は、以下の目的の範囲内で利用します。\n・お問い合わせへの対応\n・お見積もりの作成\n・施工内容のご連絡・進捗共有\n・その他、上記に付随して必要となる連絡",
    maxLines: 5,
    maxLineLen: 45,
  },
  {
    key: "privacy.spec.third.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し4 (第三者提供)",
    kind: "text",
    maxLen: 30,
    defaultText: "4. 第三者提供",
  },
  {
    key: "privacy.spec.third.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 第三者提供 本文",
    kind: "text",
    maxLen: 150,
    defaultText:
      "法令に基づく場合を除き、ご本人の同意なく個人情報を第三者に提供することはありません。造形の外部提携先へ情報共有が必要になる場合は、事前に必要な範囲・目的をご案内したうえで行います。",
  },
  {
    key: "privacy.spec.retention.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し5 (保存期間)",
    kind: "text",
    maxLen: 30,
    defaultText: "5. 保存期間",
  },
  {
    key: "privacy.spec.retention.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 保存期間 本文",
    kind: "text",
    maxLen: 140,
    defaultText:
      "お問い合わせいただいた個人情報は、お問い合わせの日から3年間保存し、期間経過後は安全な方法で廃棄します。ご成約いただいた場合は、法令が定める帳簿等の保存期間に従います。",
  },
  {
    key: "privacy.spec.disclosure.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し6 (開示・訂正・削除等の請求)",
    kind: "text",
    maxLen: 30,
    defaultText: "6. 開示・訂正・削除等の請求",
  },
  {
    key: "privacy.spec.disclosure.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 開示・訂正・削除等の請求 本文",
    kind: "text",
    maxLen: 120,
    defaultText:
      "ご本人からの個人情報の開示・訂正・利用停止・削除等のご請求は、お問い合わせフォームより承ります。ご本人確認のうえ、法令に従い遅滞なく対応いたします。",
  },
  {
    key: "privacy.spec.cookie.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し7 (Cookie等の利用)",
    kind: "text",
    maxLen: 30,
    defaultText: "7. Cookie等の利用",
  },
  {
    key: "privacy.spec.cookie.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / Cookie等の利用 本文",
    kind: "text",
    maxLen: 160,
    defaultText:
      "本サイトは、Next.js / Vercel によるアクセス解析のためCookie等を利用する場合があります。取得した情報は利用状況の把握のみに用い、個人を特定した広告配信やパーソナライズは行いません。",
  },
  {
    key: "privacy.spec.revision.th",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 表 見出し8 (本ポリシーの改定)",
    kind: "text",
    maxLen: 30,
    defaultText: "8. 本ポリシーの改定",
  },
  {
    key: "privacy.spec.revision.td",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 本ポリシーの改定 本文",
    kind: "text",
    maxLen: 110,
    defaultText:
      "本ポリシーは、法令の改正やサービス内容の変更等に応じて改定することがあります。改定した場合は本ページに掲載し、改定日を更新します。",
  },
  {
    key: "privacy.mapnote",
    page: "privacy",
    route: "/privacy",
    label: "プライバシーポリシー / 末尾注記 (制定日+ドラフト断り書き)",
    kind: "lines",
    maxLen: 200,
    defaultText:
      "制定日・改定日：2026年7月7日\n※ 本ページは開業準備中のドラフトです。正式な法務チェックを経て、代表者名・所在地の開示範囲・第三者提供の想定などの内容を確定します。",
    maxLines: 2,
    maxLineLen: 100,
  },
];
