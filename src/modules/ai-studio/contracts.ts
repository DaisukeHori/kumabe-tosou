import { z } from "zod";

import {
  zChannel,
  zExcerpt,
  zIsoDatetime,
  zMarkdown,
  zMediaId,
  zShortText,
  zSlug,
  zTitle,
  type Channel,
} from "@/modules/platform/contracts";
import { weightedTweetLength } from "@/modules/platform/text";

/**
 * canonical: docs/module-contracts.md §4.3 (ai-studio の生成物)
 */

/** stage 1.5 整文出力 (Claude structured output) */
export const zCleanedTranscript = z
  .object({
    cleaned_text: z.string().min(1).max(50_000),
    corrections: z
      .array(
        z.object({
          from: z.string().max(100),
          to: z.string().max(100),
          reason: z.enum(["filler", "punctuation", "term", "mishear"]),
        }),
      )
      .max(200),
    meaning_preserved: z.boolean(), // false → KMB-E406 (raw のまま人間修正へ)
  })
  .strict();
export type CleanedTranscript = z.infer<typeof zCleanedTranscript>;

/** stage 2 要旨抽出出力。claims が差分表示 §10 の「AI 追加事実」判定の基礎 */
export const zClaim = z
  .object({
    text: z.string().min(1).max(500),
    source: z.enum(["speech", "research", "inference"]),
    research_url: z.string().url().nullable(),
  })
  .strict()
  .refine(
    (c) => c.source !== "research" || c.research_url !== null,
    "research 由来は URL 必須",
  );
export type Claim = z.infer<typeof zClaim>;

export const zBrief = z
  .object({
    theme: zShortText(200),
    topics: z.array(z.string().max(100)).min(1).max(10),
    audience: z.string().max(200),
    keywords: z.array(z.string().max(50)).max(20),
    claims: z.array(zClaim).max(50),
  })
  .strict();
export type Brief = z.infer<typeof zBrief>;
// → ai_runs.brief

/** stage 3 リサーチ出力 */
export const zResearchNotes = z
  .object({
    facts: z
      .array(
        z.object({
          text: z.string().max(500),
          url: z.string().url(),
          accessed_at: zIsoDatetime,
        }),
      )
      .max(20),
    corrections: z
      .array(
        z.object({
          original: z.string().max(300),
          suggestion: z.string().max(300),
          reason: z.string().max(300),
          url: z.string().url().nullable(),
        }),
      )
      .max(10),
  })
  .strict();
export type ResearchNotes = z.infer<typeof zResearchNotes>;
// → ai_runs.research_notes

/** Claude API usage 記録 */
export const zTokenUsage = z
  .object({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    cache_read_input_tokens: z.number().int().min(0),
    cache_creation_input_tokens: z.number().int().min(0),
    web_search_requests: z.number().int().min(0).default(0),
  })
  .strict();
export type TokenUsage = z.infer<typeof zTokenUsage>;
// → ai_runs.token_usage (stage 別合算)

/**
 * canonical: docs/module-contracts.md §4.4 (channel_drafts.content)
 */

export const zSiteBlogContent = z
  .object({
    title: zTitle,
    excerpt: zExcerpt.pipe(z.string().min(1)),
    body_md: zMarkdown.pipe(z.string().min(100)),
    suggested_slug: zSlug,
    cover_media_id: zMediaId.nullable(),
  })
  .strict();
export type SiteBlogContent = z.infer<typeof zSiteBlogContent>;

export const zNoteContent = z
  .object({
    title: zTitle,
    body_md: z.string().max(50_000).min(100),
    hashtags: z.array(z.string().regex(/^[^\s#]{1,30}$/)).max(5),
  })
  .strict();
export type NoteContent = z.infer<typeof zNoteContent>;

/**
 * X の字数は重み付き (半角1/全角2/URL23固定/上限280 = 全角換算140)。
 * 自作実装は禁止 — 公式 `twitter-text` の parseTweet().weightedLength を薄く包んだ
 * weightedTweetLength() (platform/text.ts) を使う (X 公式推奨)。
 */
export const zXTweet = z
  .object({
    text: z.string().min(1).refine((t) => weightedTweetLength(t) <= 280, "重み付き 280 超過"),
    media_id: zMediaId.nullable(),
  })
  .strict();
export type XTweet = z.infer<typeof zXTweet>;

export const zXContent = z
  .object({
    thread: z.array(zXTweet).min(1).max(5),
  })
  .strict();
export type XContent = z.infer<typeof zXContent>;

export const zInstagramContent = z
  .object({
    caption: z.string().min(1).max(2200),
    hashtags: z.array(z.string().regex(/^[^\s#]{1,30}$/)).min(5).max(15),
    media_ids: z.array(zMediaId).min(1).max(10), // JPEG レンディション存在チェックは配信時 (E502)
  })
  .strict();
export type InstagramContent = z.infer<typeof zInstagramContent>;

export const CHANNEL_CONTENT_SCHEMAS = {
  site_blog: zSiteBlogContent,
  note: zNoteContent,
  x: zXContent,
  instagram: zInstagramContent,
} as const;
export type ChannelContent = {
  site_blog: SiteBlogContent;
  note: NoteContent;
  x: XContent;
  instagram: InstagramContent;
};

/**
 * Claude 生成呼び出しの出力契約 (structured outputs の元)。
 * content と claims を同時出力させ、content → channel_drafts.content、
 * claims → channel_drafts.claims に分離保存する。
 * CHANNEL_CONTENT_SCHEMAS 単体は claims を含まない (.strict() のため混入不可)。
 */
export const zChannelDraftOutput = (channel: Channel) =>
  z
    .object({
      content: CHANNEL_CONTENT_SCHEMAS[channel],
      claims: z.array(zClaim).max(50),
    })
    .strict();

/**
 * canonical: docs/module-contracts.md §4.6 (SSE イベント)
 */

/**
 * run の stage。整文 (cleaning) は run 開始前の /api/ai/clean で完結するため含まない。
 * image_generation は SNS 画像生成 (ai-studio-v2.md §7、P4) で drafting 完了後に走る
 * 任意ステージ (X/IG を含まない run では skip して ready_for_review へ直行)。
 */
export const zRunStage = z.enum(["extracting", "researching", "drafting", "image_generation"]);
export type RunStage = z.infer<typeof zRunStage>;

export const zRunStatus = z.enum([
  "pending",
  "extracting",
  "researching",
  "drafting",
  "image_generation",
  "ready_for_review",
  "completed",
  "failed",
  "cancelled",
]); // ai_runs.status の check 制約と 1:1 (image_generation は migration 20260710000019 で追加)
export type RunStatus = z.infer<typeof zRunStatus>;

/**
 * P4: image_generation ステージが生成した候補画像 (ai_runs.image_candidates jsonb、最大4件)。
 * 「候補として run に紐付ける」ための最小の保持構造 (判断点。実装報告参照 — ai-providers 所有の
 * ai_image_generations は画像カスケード専用の系譜/7日 cron 掃除タグ前提のため転用せず、
 * ai-studio 所有の ai_runs に専用列として追加した)。
 */
export const zImageCandidate = z
  .object({
    media_id: zMediaId,
    selected: z.boolean(),
  })
  .strict();
export type ImageCandidate = z.infer<typeof zImageCandidate>;

/** image_generation ステージの LLM 起案出力 (本文に合う画像プロンプト 1 件)。structured output。 */
export const zSnsImagePromptOutput = z
  .object({
    image_prompt: z.string().min(1).max(2000),
  })
  .strict();
export type SnsImagePromptOutput = z.infer<typeof zSnsImagePromptOutput>;

/** POST /api/ai/runs/{id}/select-image の入力契約。media_id=null は skip。 */
export const zSelectImageReq = z
  .object({
    media_id: zMediaId.nullable(),
  })
  .strict();
export type SelectImageInput = z.infer<typeof zSelectImageReq>;

export const zRunProgressEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"), // 接続/再接続直後: DB 上の現在状態を一括送信
    run_status: zRunStatus,
    completed_drafts: z.array(z.object({ channel: zChannel, draft_id: z.string().uuid() })),
  }),
  z.object({
    type: z.literal("stage"),
    stage: zRunStage,
    status: z.enum(["start", "done", "failed"]),
    error_code: z.string().nullable(),
  }),
  z.object({
    type: z.literal("draft_delta"), // drafting 中の逐次テキスト
    channel: zChannel,
    delta: z.string(),
  }),
  z.object({ type: z.literal("completed") }),
]);
export type RunProgressEvent = z.infer<typeof zRunProgressEvent>;

/**
 * canonical: docs/module-contracts.md §4.7 の該当分 (ai-studio が所有する Route Handler 契約)。
 */

export const zTranscribeReq = z.object({ source_id: z.string().uuid() }).strict();
export const zCleanReq = z.object({ source_id: z.string().uuid() }).strict();
export const zStartRunReq = z
  .object({
    source_id: z.string().uuid(),
    channels: z.array(zChannel).min(1),
    research: z.boolean(),
  })
  .strict();
export const zRegenerateReq = z
  .object({
    instruction: z.string().min(1).max(2000), // 修正指示
  })
  .strict();

/** ai_sources.input_type (DDL の check 制約と 1:1)。contracts-ddl-parity.test.ts の比較対象 */
export const zSourceInputType = z.enum(["audio", "text"]);

/**
 * 実装時に判明した契約の抜け (オーケストレーターへ報告済み):
 * 設計書 §4.7 の zCreateSourceReq には audio_storage_path が無く、
 * input_type='audio' の場合に「アップロード済み音声をどの source に紐付けるか」が
 * 表現できなかった (/api/transcribe は source_id のみを受け取る前提のため、
 * 文字起こし実行前に ai_sources.audio_storage_path が確定している必要がある)。
 * 後方互換な追加 (optional/nullable) として audio_storage_path を追加した。
 * text 入力の既存利用箇所には影響しない。
 */
export const zCreateSourceReq = z
  .object({
    input_type: zSourceInputType,
    raw_text: z.string().max(50_000).nullable(), // input_type='text' のとき必須 (refine)
    audio_storage_path: z.string().max(500).nullable().optional(), // input_type='audio' のとき必須 (refine)
  })
  .strict()
  .refine((v) => v.input_type !== "text" || (v.raw_text !== null && v.raw_text.length > 0), {
    message: "input_type='text' のとき raw_text は必須",
    path: ["raw_text"],
  })
  .refine((v) => v.input_type !== "audio" || Boolean(v.audio_storage_path), {
    message: "input_type='audio' のとき audio_storage_path は必須",
    path: ["audio_storage_path"],
  });
export type CreateSourceInput = z.infer<typeof zCreateSourceReq>;

export const zConfirmCleanReq = z
  .object({
    source_id: z.string().uuid(),
    final_text: z.string().min(1).max(50_000), // 人間修正後の確定テキスト (整文の確定操作)
  })
  .strict();

export const zEditDraftReq = z
  .object({
    content: z.unknown(), // draft.channel を DB から引いた後 CHANNEL_CONTENT_SCHEMAS[channel] で二段階 parse
  })
  .strict();

// ---- §4.9 facade 補助型 (ai-studio 分) ----

/** channel_drafts の approved 状態のみ distribution へ渡す射影 (ApprovedDraft, §4.9) */
export type ApprovedDraft = {
  draft_id: string;
  channel: Channel;
  content: ChannelContent[Channel];
  approved_at: string;
};
