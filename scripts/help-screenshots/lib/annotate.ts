/**
 * 注釈の組み立てヘルパ。実体は src/help/annotate.ts にある
 * (ヘルプ本文 src/help/content/**.tsx からも同じ関数を使うため)。
 * 撮影スクリプト側からはこのファイル経由で参照する。
 */
export { createAnnotator, type HelpShotBox, type HelpShotJson } from "@/help/annotate";
