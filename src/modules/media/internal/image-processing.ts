import "server-only";

/**
 * アプリ本体 (facade.ts) から使う画像変換の入口。
 * 実体は ./image-transform (server-only 非依存) にあり、ここでは "server-only" ガードを
 * 掛けた上で re-export するのみ。scripts/seed-from-legacy.ts は tsx 直接実行のため
 * "server-only" を経由できず (scripts/lib/service-client.ts と同じ理由)、
 * ./image-transform を直接 import してロジックを共用する (複製禁止)。
 */
export {
  MEDIA_MAX_LONG_EDGE,
  processImageForRenditions,
  processImageToJpeg,
  type ProcessedRenditions,
} from "./image-transform";
