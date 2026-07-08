import "server-only";

import sharp from "sharp";

/**
 * アップロード画像 → 公開レンディション変換 (設計書 §2.4 / §3.4 / §5.2)。
 * - 長辺 2560px 上限にリサイズ (超過時のみ)。
 * - 表示用 WebP + Instagram 用 JPEG の両方を生成。
 * - sharp の再エンコードにより EXIF/GPS は自動的に失われる (設計書 §3.4 の前提)。
 */

export const MEDIA_MAX_LONG_EDGE = 2560;

export type ProcessedRenditions = {
  webp: Buffer;
  jpeg: Buffer;
  width: number;
  height: number;
};

export async function processImageForRenditions(original: Buffer): Promise<ProcessedRenditions> {
  const base = sharp(original, { failOn: "none" }).rotate(); // rotate(): Exif Orientation を反映してから破棄
  const resized = base.resize({
    width: MEDIA_MAX_LONG_EDGE,
    height: MEDIA_MAX_LONG_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  const [webp, jpeg, metadata] = await Promise.all([
    resized.clone().webp({ quality: 82 }).toBuffer(),
    resized.clone().flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer(),
    resized.clone().metadata(),
  ]);

  return {
    webp,
    jpeg,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

/** JPEG レンディションのみ (IG 用。getJpegRenditionUrl の遅延生成で使う) */
export async function processImageToJpeg(original: Buffer): Promise<Buffer> {
  return sharp(original, { failOn: "none" })
    .rotate()
    .resize({
      width: MEDIA_MAX_LONG_EDGE,
      height: MEDIA_MAX_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
}
