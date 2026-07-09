/**
 * [Wave5 W5-A] インク引き継ぎ — 実装計画 §5 W5-A の純関数群。
 *
 * colors ページで直近閲覧した色見本の色を、他ページの PaintProgress / SectionIndicator
 * に反映するための土台。ここでは以下の 2 層に分ける (DOM/IO 依存ロジックは unit で
 * 追わない §1.7 規約に従い、輝度・コントラストの計算部分だけを純関数として切り出し、
 * テスト対象にする):
 *
 *   1. 純関数 (unit テスト対象): hexToRgb / relativeLuminance / contrastRatio /
 *      resolveInkColor / extractCssVarName
 *   2. DOM 依存の薄いラッパ (unit では追わない・実機 E2E に委ねる §1.7): sessionStorage
 *      の読み書き・document.documentElement への CSS 変数書き込み・var(--x) の
 *      computed 値解決
 */

// ---------------------------------------------------------------------------
// 純関数: 色計算 (WCAG 相対輝度・コントラスト比)
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** #rgb / #rrggbb (先頭 # は任意) を {r,g,b} (0-255) にパースする。不正な値は null。 */
export function hexToRgb(hex: string): Rgb | null {
  const normalized = hex.trim().replace(/^#/, "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function channelToLinear(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.x の相対輝度 (relative luminance)。
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * 不正な hex は輝度 0 (最も暗い側) を返す — フォールバック側に倒すための安全策。
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 2 色間のコントラスト比 (1〜21)。
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** var(--foo) 形式から CSS カスタムプロパティ名を取り出す。一致しなければ null。 */
export function extractCssVarName(value: string): string | null {
  const match = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value.trim());
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// 定数 (正典: 実装計画 §5 W5-A)
// ---------------------------------------------------------------------------

/** 判定に使う背景の参照色 — --paper (紙白 #fbfbf8)。ドット/バーが乗る面の近似値。 */
export const INK_REFERENCE_BG = "#fbfbf8";
/** コントラスト比の下限 (WCAG 1.4.11 非テキストコントラスト相当)。 */
export const INK_MIN_CONTRAST = 3;
/** 低コントラスト時のフォールバック — --soul (ソウルレッド)。 */
export const INK_FALLBACK = "#a80f22";

/** sessionStorage キー。 */
export const INK_STORAGE_KEY = "kt-ink-color";
/** PaintProgress / SectionIndicator が読む CSS カスタムプロパティ名。 */
export const INK_CSS_VAR = "--kt-ink";

/**
 * 色見本の hex を、他ページで「インク」として使ってよいか判定する。
 * 背景 (--paper) とのコントラストが INK_MIN_CONTRAST 未満 (DD-090 等の淡色) なら
 * INK_FALLBACK (--soul) を返す。不正な hex も安全側 (fallback) に倒す。
 */
export function resolveInkColor(
  hex: string,
  referenceBg: string = INK_REFERENCE_BG,
  fallback: string = INK_FALLBACK,
): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  return contrastRatio(hex, referenceBg) >= INK_MIN_CONTRAST ? hex : fallback;
}

// ---------------------------------------------------------------------------
// DOM 依存ラッパ (unit テスト対象外・実機 E2E で検証 — §1.7)
// ---------------------------------------------------------------------------

/**
 * "var(--dd-090-a)" のような CSS var 参照を実際の色値に解決する。
 * var() 参照でなければそのまま返す。SSR (window 未定義) でもそのまま返す。
 */
export function resolveCssColorValue(raw: string): string {
  const varName = extractCssVarName(raw);
  if (!varName || typeof window === "undefined") return raw;
  const computed = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return computed || raw;
}

/** sessionStorage から直近のインク色を読む。失敗時 (private mode 等) は null。 */
export function readStoredInk(): string | null {
  try {
    return window.sessionStorage.getItem(INK_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** sessionStorage にインク色を書く。失敗しても致命的ではないため無視する。 */
export function writeStoredInk(hex: string): void {
  try {
    window.sessionStorage.setItem(INK_STORAGE_KEY, hex);
  } catch {
    /* private mode 等で書き込み不可でも致命的ではない */
  }
}

/** document.documentElement に --kt-ink を設定する (null なら何もしない)。 */
export function applyInkCssVar(hex: string | null): void {
  if (typeof document === "undefined" || !hex) return;
  document.documentElement.style.setProperty(INK_CSS_VAR, hex);
}

/**
 * 新規フルロード後 (SPA 遷移ではなく直接 URL アクセス等) に、document.documentElement
 * 上の --kt-ink がまだ無い状態を sessionStorage の記録から復元する。
 * PaintProgress / SectionIndicator の両方がマウント時に呼ぶ (冪等)。
 */
export function applyStoredInkVar(): void {
  applyInkCssVar(readStoredInk());
}
