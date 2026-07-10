import type { Provider } from "@/modules/ai-providers/contracts";

/**
 * プロバイダの表示名・配色 (dataviz 用、light/dark 両対応)。
 * 既存 admin の色分けバッジ (status-badge.tsx / visual/side-panel.tsx) と同じ
 * 「Tailwind セマンティックカラー + dark: 明度調整」の規約に倣う
 * (globals.css の --chart-1..5 は shadcn 既定のグレースケールのままで
 * light/dark 同値・無彩色のため dataviz の色分けには使えない — 判断点)。
 */
export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

export const PROVIDER_FILL_CLASS: Record<Provider, string> = {
  openai: "fill-emerald-500 dark:fill-emerald-400",
  anthropic: "fill-amber-500 dark:fill-amber-400",
  gemini: "fill-sky-500 dark:fill-sky-400",
};

export const PROVIDER_SWATCH_CLASS: Record<Provider, string> = {
  openai: "bg-emerald-500 dark:bg-emerald-400",
  anthropic: "bg-amber-500 dark:bg-amber-400",
  gemini: "bg-sky-500 dark:bg-sky-400",
};

export const PROVIDER_BADGE_CLASS: Record<Provider, string> = {
  openai: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  anthropic: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  gemini: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};
