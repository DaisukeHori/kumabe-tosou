import type { Channel } from "@/modules/platform/contracts";

import type { StyleProfile } from "../contracts";

/**
 * canonical: docs/design/cms-ai-pipeline.md §7.4 (プロンプト設計方針・style_profiles 初期値)。
 *
 * style_profiles テーブルにまだ行が無いチャネル (admin が一度も編集していない) に対して
 * DistributionFacade.getStyleProfiles() が返す既定値。
 *
 * 旧 ai-studio/internal/prompts.ts の DEFAULT_STYLE_PROFILES と同一文言 (Issue #20 で
 * distribution 側へ移設。「ai-studio は distribution に依存できないため style_profiles を
 * 直接読まず、ハードコードした既定値定数を常に使う」という Wave2-E の暫定回避策を解消し、
 * DistributionFacade.getStyleProfiles → route handler → AiStudioFacade.startRun の合成
 * パターンに置き換えた。既定値そのものは非退行のため文言を変えていない)。
 */
export const DEFAULT_STYLE_PROFILES: Record<Channel, StyleProfile> = {
  site_blog: {
    tone_instructions: "丁寧なですます調。専門用語には簡単な説明を添える。",
    format_rules: "見出し2〜4個、1500〜3000字程度。SEOを意識したtitleにする。",
    example_output: null,
  },
  note: {
    tone_instructions: "一人称の語り口。体験談ベースで親しみやすく。",
    format_rules: "2000〜4000字程度。ハッシュタグ3個程度。",
    example_output: null,
  },
  x: {
    tone_instructions: "簡潔に。絵文字は控えめに1個/ツイート程度。",
    format_rules: "1ツイート120字目安、スレッドは1〜5個。ハッシュタグ最大2個。",
    example_output: null,
  },
  instagram: {
    tone_instructions: "写真映えを意識した、改行多めの読みやすい文体。",
    format_rules: "キャプション300〜500字程度。ハッシュタグ10〜15個。",
    example_output: null,
  },
};
