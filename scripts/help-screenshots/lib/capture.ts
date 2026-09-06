import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright-core";

import type { HelpShotBox, HelpShotJson } from "@/help/annotate";

import { HELP_BASE_URL, REPO_ROOT } from "./browser";

/**
 * 1 枚のスクリーンショットを撮り、注釈座標 JSON も一緒に書き出す共通関数。
 * canonical: docs/design/admin-help/README.md §5。
 *
 * - 画像: public/help/<slug>/<name>.png
 * - 座標: public/help/<slug>/<name>.json  { width, height, boxes: { key: {x,y,w,h} } }
 *
 * 座標は CSS ピクセル (画面上の見た目の大きさ) で記録する。PNG は deviceScaleFactor: 2 の
 * ため実ピクセルは 2 倍だが、縦横比は同じなので、ヘルプ側は JSON の width/height を
 * そのまま viewBox に使えば注釈がぴったり重なる。
 *
 * page.goto の待ち方は "domcontentloaded" + 明示的な要素待ちで固定する
 * ("networkidle" は /admin/visual や /admin/studio のように裏で通信し続ける画面で
 *  タイムアウトするため使わない — 環境準備担当からの申し送り)。
 */
export type CaptureAnchor = { key: string; selector: string };

export type CaptureSpec = {
  slug: string;
  /** ファイル名 (拡張子なし)。"01-list" のように番号 + 内容。 */
  name: string;
  /** "/admin" のような相対パス、または完全な URL。 */
  url: string;
  /** 撮る前に出現を待つ要素 (省略時は data-help が 1 つ以上出るまで待つ)。 */
  waitFor?: string;
  /** 注釈を打ちたい要素。selector は data-help 属性を推奨。 */
  anchors: CaptureAnchor[];
  fullPage?: boolean;
  /**
   * 画面の一部だけを切り取って撮る (説明したい場所を大きく見せるため)。
   * selectors で指定した要素すべてが入る長方形 + padding を切り取る。
   * 切り取った場合、注釈座標も切り取り後の画像を基準に記録されるのでそのまま使える。
   */
  clipTo?: { selectors: string[]; padding?: number };
  /** 撮る前の操作 (タブを開く、行をクリックする等)。 */
  actions?: (page: Page) => Promise<void>;
  /**
   * page.goto の待ち時間 (ミリ秒。既定 60 秒)。開発サーバーで初回コンパイルが重い画面
   * (/admin/deals/[id] など) はここを伸ばす。
   */
  gotoTimeout?: number;
};

export type CaptureResult = {
  pngPath: string;
  jsonPath: string;
  shot: HelpShotJson;
};

export async function capture(page: Page, spec: CaptureSpec): Promise<CaptureResult> {
  const url = spec.url.startsWith("http") ? spec.url : `${HELP_BASE_URL}${spec.url}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: spec.gotoTimeout ?? 60_000 });
  await page.waitForSelector(spec.waitFor ?? "[data-help]", { state: "attached", timeout: 30_000 });
  if (spec.actions) await spec.actions(page);
  // 開発サーバーの開発者向けバッジ (画面の隅に出る小さな黒い印) は説明の邪魔なので隠す。
  await page.addStyleTag({
    content: "nextjs-portal, #__next-build-watcher, [data-nextjs-toast] { display: none !important; }",
  });
  // 日本語フォントの読み込みが終わってから撮る (未完了だと字が置き換わって写る)。
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);

  const outDir = path.join(REPO_ROOT, "public", "help", spec.slug);
  mkdirSync(outDir, { recursive: true });
  const pngPath = path.join(outDir, `${spec.name}.png`);
  const jsonPath = path.join(outDir, `${spec.name}.json`);

  const clip = spec.clipTo ? await resolveClip(page, spec.clipTo) : null;
  await page.screenshot({
    path: pngPath,
    fullPage: clip ? true : (spec.fullPage ?? false),
    ...(clip ? { clip } : {}),
  });

  const measured = await measure(page, spec.anchors, spec.fullPage ?? false, clip);
  const missing = spec.anchors.filter((a) => !measured.boxes[a.key]);
  if (missing.length > 0) {
    throw new Error(
      `注釈の対象が見つかりませんでした (${spec.slug}/${spec.name}): ${missing
        .map((m) => `${m.key} -> ${m.selector}`)
        .join(", ")}`,
    );
  }
  assertBoxesInsideImage(spec, measured);
  writeFileSync(jsonPath, `${JSON.stringify(measured, null, 2)}\n`, "utf8");

  return { pngPath, jsonPath, shot: measured };
}

/**
 * 注釈の枠が画像の外を指していないか確かめる。
 * clipTo の切り取り範囲に入っていない要素を anchors に混ぜると、座標だけが記録されて
 * 注釈が画像の外に描かれ、読者からは「番号があるのに枠が見えない」状態になる
 * (実際に calendar の 06-auto-place で y が負になる不良注釈が出た)。撮影の時点で
 * 気づけるように、画像とまったく重ならない枠と、番号バッジが切れる枠 (左上が画像の外)
 * は例外にする。anchors に入れた要素は clipTo の selectors にも必ず入れること。
 *
 * 画面より縦に長い要素 (ホームページ全体のプレビューなど) は、下がはみ出すのが自然なので
 * 警告だけにとどめる。
 */
function assertBoxesInsideImage(spec: CaptureSpec, shot: HelpShotJson): void {
  /** 番号バッジ (半径 11px) が切れない程度の許容。 */
  const tolerance = 4;
  const fatal: string[] = [];
  const warn: string[] = [];
  for (const [key, b] of Object.entries(shot.boxes)) {
    const where = `${key} (x=${b.x}, y=${b.y}, w=${b.w}, h=${b.h})`;
    const noOverlap = b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= shot.width || b.y >= shot.height;
    if (noOverlap || b.x < -tolerance || b.y < -tolerance) {
      fatal.push(where);
    } else if (b.x + b.w > shot.width || b.y + b.h > shot.height) {
      warn.push(where);
    }
  }
  for (const w of warn) {
    console.warn(
      `[help-screenshots] 注釈が画像の下 (または右) にはみ出しています: ${spec.slug}/${spec.name} ${w}`,
    );
  }
  if (fatal.length > 0) {
    throw new Error(
      `注釈の枠が画像 (${shot.width}x${shot.height}) の外にあります (${spec.slug}/${spec.name}): ` +
        `${fatal.join(", ")}。clipTo の selectors に注釈対象を含めてください。`,
    );
  }
}

type Clip = { x: number; y: number; width: number; height: number };

/** clipTo で指定した要素すべてを含む長方形 (ページ座標) を求める。 */
async function resolveClip(page: Page, clipTo: { selectors: string[]; padding?: number }): Promise<Clip> {
  const padding = clipTo.padding ?? 24;
  const clip = await page.evaluate(
    ({ selectors, padding }) => {
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        left = Math.min(left, r.left + window.scrollX);
        top = Math.min(top, r.top + window.scrollY);
        right = Math.max(right, r.right + window.scrollX);
        bottom = Math.max(bottom, r.bottom + window.scrollY);
      }
      if (!Number.isFinite(left)) return null;
      const docWidth = document.documentElement.scrollWidth;
      const docHeight = document.documentElement.scrollHeight;
      const x = Math.max(0, Math.round(left - padding));
      const y = Math.max(0, Math.round(top - padding));
      return {
        x,
        y,
        width: Math.min(docWidth - x, Math.round(right - left + padding * 2)),
        height: Math.min(docHeight - y, Math.round(bottom - top + padding * 2)),
      };
    },
    { selectors: clipTo.selectors, padding },
  );
  if (!clip) throw new Error(`clipTo の対象が見つかりません: ${clipTo.selectors.join(", ")}`);
  return clip;
}

async function measure(
  page: Page,
  anchors: CaptureAnchor[],
  fullPage: boolean,
  clip: Clip | null,
): Promise<HelpShotJson> {
  return page.evaluate(
    ({ anchors, fullPage, clip }) => {
      const scrollX = clip ? clip.x : fullPage ? 0 : window.scrollX;
      const scrollY = clip ? clip.y : fullPage ? 0 : window.scrollY;
      const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const anchor of anchors) {
        const el = document.querySelector(anchor.selector);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        boxes[anchor.key] = {
          x: Math.round(r.left + window.scrollX - scrollX),
          y: Math.round(r.top + window.scrollY - scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }
      return {
        width: clip ? clip.width : fullPage ? document.documentElement.scrollWidth : window.innerWidth,
        height: clip ? clip.height : fullPage ? document.documentElement.scrollHeight : window.innerHeight,
        boxes,
      };
    },
    { anchors, fullPage, clip },
  ) as Promise<{ width: number; height: number; boxes: Record<string, HelpShotBox> }>;
}

/** data-help="<key>" を指すセレクタ (撮影スクリプトの記述を短くするための糖衣)。 */
export function help(key: string): CaptureAnchor {
  return { key, selector: `[data-help="${key}"]` };
}
