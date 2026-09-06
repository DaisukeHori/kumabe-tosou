/**
 * 管理画面ヘルプのコンテンツ型。canonical: docs/design/admin-help/README.md §4。
 *
 * ここに定義する型は「データだけ」で、描画方法 (SVG 注釈の描き方や見出しの装飾) は
 * src/help/renderer/** が持つ。ページ担当者は型を満たす素のオブジェクトを書くだけでよい。
 */

/**
 * スクリーンショットに重ねる注釈。
 * 座標はすべて「元画像のピクセル」で持つ。レンダラーが viewBox で % に変換するため、
 * 表示幅が変わっても (印刷・小さいウィンドウ) 注釈は同じ場所に追従する。
 */
export type HelpAnnotation =
  | { kind: "box"; x: number; y: number; w: number; h: number; number?: number; label?: string }
  | { kind: "arrow"; x: number; y: number; toX: number; toY: number; label?: string }
  | { kind: "badge"; x: number; y: number; number: number };

export type HelpScreenshot = {
  /** "/help/<slug>/<name>.png" (public/ 配下の実ファイル)。 */
  src: string;
  alt: string;
  /** 元画像のピクセルサイズ (撮影スクリプトが書き出す JSON の width/height をそのまま使う)。 */
  width: number;
  height: number;
  annotations: HelpAnnotation[];
  caption?: string;
};

/** 「画面の見方」の番号付き項目。number は注釈の番号と一致させる。 */
export type HelpSectionItem = {
  number: number;
  name: string;
  what: string;
  /** 入力・変更すると他のどの画面に影響するか。 */
  affects?: string;
};

export type HelpRelation = {
  label: string;
  href: string;
  why: string;
};

export type HelpSection = {
  id: string;
  heading: string;
  /** 段落 (プレーン文)。**〜** で太字にできる。 */
  body: string[];
  screenshot?: HelpScreenshot;
  items?: HelpSectionItem[];
  relations?: HelpRelation[];
};

export type HelpPersonaId = "yamagishi" | "sato" | "customer";

export type HelpUseCaseStep = {
  action: string;
  where: string;
  result: string;
  screenshot?: HelpScreenshot;
};

export type HelpUseCase = {
  persona: HelpPersonaId;
  title: string;
  situation: string;
  steps: HelpUseCaseStep[];
  outcome: string;
};

export type HelpFlowStep = {
  step: string;
  where: string;
  result: string;
};

export type HelpFaq = { q: string; a: string };

export type HelpGlossaryEntry = { term: string; meaning: string };

export type HelpDoc = {
  slug: string;
  title: string;
  /** このヘルプが説明している管理画面のパス (例: "/admin")。 */
  adminPath: string;
  summary: string[];
  flow: HelpFlowStep[];
  sections: HelpSection[];
  useCases: HelpUseCase[];
  faqs: HelpFaq[];
  related: { label: string; href: string }[];
  glossary?: HelpGlossaryEntry[];
};
