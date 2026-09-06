/**
 * ヘルプ用スクリーンショットの「画像」ページで使うデモ写真を生成する。
 * 実行: node scripts/help-screenshots/seed-demo/media-assets/generate-images.mjs
 *
 * 本番の写真は絶対に使わないため、抽象的な色面だけの架空の写真を作る。
 * 生成した PNG は /admin/media の「画像をアップロード」から実際に取り込む
 * (scripts/help-screenshots/seed-demo/media.mjs)。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const OUT_DIR = path.resolve(import.meta.dirname);

/**
 * 架空の作品写真っぽい PNG を 1 枚作る (文字は入れない)。
 * ファイル名はカメラから取り込んだ写真らしく英数字にする
 * (日本語ファイル名は撮影スクリプトのファイル選択で扱えないため)。
 */
function svgFor({ from, to, accent, shape }) {
  const w = 1200;
  const h = 900;
  const body =
    shape === "figure"
      ? `<ellipse cx="600" cy="640" rx="230" ry="120" fill="${accent}" opacity="0.85"/>
         <rect x="500" y="300" width="200" height="330" rx="90" fill="${accent}"/>
         <circle cx="600" cy="290" r="105" fill="${accent}"/>`
      : shape === "parts"
        ? `<rect x="230" y="330" width="330" height="230" rx="28" fill="${accent}"/>
           <rect x="640" y="400" width="330" height="160" rx="80" fill="${accent}" opacity="0.8"/>
           <circle cx="420" cy="680" r="80" fill="${accent}" opacity="0.7"/>`
        : shape === "spray"
          ? `<path d="M250 700 L600 220 L950 700 Z" fill="${accent}" opacity="0.85"/>
             <circle cx="600" cy="620" r="70" fill="#ffffff" opacity="0.35"/>`
          : `<rect x="300" y="260" width="600" height="380" rx="40" fill="${accent}" opacity="0.9"/>
             <rect x="380" y="340" width="440" height="60" rx="30" fill="#ffffff" opacity="0.35"/>
             <rect x="380" y="450" width="280" height="60" rx="30" fill="#ffffff" opacity="0.25"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${body}
</svg>`;
}

const IMAGES = [
  { file: "IMG_2381.png", from: "#1f2937", to: "#4b5563", accent: "#f97316", shape: "figure" },
  { file: "IMG_2382.png", from: "#111827", to: "#374151", accent: "#38bdf8", shape: "figure" },
  { file: "IMG_2390.png", from: "#0f172a", to: "#334155", accent: "#e11d48", shape: "parts" },
  { file: "IMG_2391.png", from: "#1e293b", to: "#475569", accent: "#a3e635", shape: "parts" },
  { file: "IMG_2402.png", from: "#164e63", to: "#0e7490", accent: "#fde047", shape: "spray" },
  { file: "IMG_2415.png", from: "#312e81", to: "#4338ca", accent: "#fb7185", shape: "panel" },
  { file: "IMG_2420.png", from: "#365314", to: "#4d7c0f", accent: "#fef3c7", shape: "panel" },
  { file: "IMG_2431.png", from: "#7c2d12", to: "#c2410c", accent: "#fed7aa", shape: "spray" },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const image of IMAGES) {
  const svg = svgFor(image);
  const out = path.join(OUT_DIR, image.file);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`[seed-demo] 生成: ${image.file}`);
}
