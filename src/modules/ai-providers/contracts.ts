import { z } from "zod";

import { zMediaId } from "@/modules/platform/contracts";

/**
 * canonical: docs/design/ai-studio-v2.md §1/§2、docs/module-contracts.md v2.5 §1/§5。
 * ai-providers モジュールの値契約。乖離時はドキュメントを正とし本ファイルを直す。
 */

export const zProvider = z.enum(["openai", "anthropic", "gemini"]);
export type Provider = z.infer<typeof zProvider>;

export const zModelKind = z.enum(["text", "image"]);
export type ModelKind = z.infer<typeof zModelKind>;

/** ai_provider_keys.status (設計書 §2 MAJOR-1: 'limited' 追加込み) */
export const zAiKeyStatus = z.enum(["untested", "ok", "failed", "limited"]);
export type AiKeyStatus = z.infer<typeof zAiKeyStatus>;

export const zDetectedModel = z
  .object({
    id: z.string().min(1).max(200),
    kind: zModelKind,
    display: z.string().min(1).max(200),
  })
  .strict();
export type DetectedModel = z.infer<typeof zDetectedModel>;

/**
 * キー保存 (新規登録のみ。ローテーションは削除して登録し直す運用 — facade §5 の
 * saveKey/deleteKey の 2 メソッド構成と整合)。
 */
export const zSaveKeyInput = z
  .object({
    provider: zProvider,
    label: z.string().min(1).max(50),
    apiKey: z.string().min(8).max(500),
    priority: z.number().int().min(1).max(9999).default(100),
  })
  .strict();
export type SaveKeyInput = z.infer<typeof zSaveKeyInput>;

/**
 * admin 一覧表示用メタ (secret は含まない。Vault 名も含めない — vault_secret_name は
 * repository 内部のみで扱い facade 境界を越えさせない)。
 * keyLast4: 判断点 (オーケストレーターへ報告済み) — 設計書 §6 UI 要件「保存後は末尾 4 桁のみ表示」を
 * 満たすため、生キーを DB に置かない前提の下で ai_provider_keys に key_last4 列を追加した
 * (設計書 §2 DDL 原文には無い拡張。末尾 4 桁は機微情報ではないため安全側)。
 */
export const zAiKeyMeta = z
  .object({
    id: z.string().uuid(),
    provider: zProvider,
    label: z.string(),
    keyLast4: z.string(),
    priority: z.number().int(),
    status: zAiKeyStatus,
    cooldownUntil: z.string().nullable(),
    lastError: z.string().nullable(),
    lastTestedAt: z.string().nullable(),
    detectedModels: z.array(zDetectedModel),
    enabledModels: z.array(z.string()),
    defaultModel: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type AiKeyMeta = z.infer<typeof zAiKeyMeta>;

/** ai_usage_log.kind / status の DDL check 制約と 1:1 (contracts-ddl-parity.test.ts 対象) */
export const zUsageKind = z.enum(["text", "image"]);
export type UsageKind = z.infer<typeof zUsageKind>;
export const zUsageStatus = z.enum(["ok", "error"]);
export type UsageStatus = z.infer<typeof zUsageStatus>;

export const zKeyTestResult = z
  .object({
    ok: z.boolean(),
    modelCount: z.number().int().min(0),
    detectedModels: z.array(zDetectedModel),
    error: z.string().nullable(),
  })
  .strict();
export type KeyTestResult = z.infer<typeof zKeyTestResult>;

// ---------------------------------------------------------
// generateText
// ---------------------------------------------------------

export const zGenerateTextMessage = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
  })
  .strict();
export type GenerateTextMessage = z.infer<typeof zGenerateTextMessage>;

export const zGenerateImageInput = z
  .object({
    mimeType: z.string().min(1).max(100),
    dataBase64: z.string().min(1),
  })
  .strict();
export type GenerateImageInput = z.infer<typeof zGenerateImageInput>;

export const zResponseSchemaSpec = z
  .object({
    name: z.string().min(1).max(100),
    schema: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ResponseSchemaSpec = z.infer<typeof zResponseSchemaSpec>;

/**
 * facade.generateText の Zod 検証対象部分。onDelta (ストリーミング配信コールバック) は
 * 関数のためワイヤ契約に含めず、TS 側で GenerateTextReq に intersection で追加する
 * (facade 実装は onDelta を分離してから本スキーマで safeParse する)。
 */
export const zGenerateTextReq = z
  .object({
    // 省略時はルータが選ぶ最優先キーの default_model を使う (§1)。
    model: z.string().min(1).max(200).optional(),
    feature: z.string().min(1).max(50), // usage 分類 (ダッシュボード用)
    system: z.string().max(50_000).optional(),
    messages: z.array(zGenerateTextMessage).min(1).max(50),
    maxTokens: z.number().int().positive().max(64_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    images: z.array(zGenerateImageInput).max(10).optional(), // vision 入力 (P2 スクショ等)
    responseSchema: zResponseSchemaSpec.optional(), // structured outputs (Anthropic output_config.format 相当)
    webSearch: z.object({ maxUses: z.number().int().positive().max(20) }).optional(), // Anthropic server-side tool のみ
    refTable: z.string().max(100).optional(), // ai_usage_log.ref_table (監査列)
    refId: z.string().uuid().optional(), // ai_usage_log.ref_id
  })
  .strict();
export type GenerateTextReqBase = z.infer<typeof zGenerateTextReq>;
export type GenerateTextReq = GenerateTextReqBase & {
  /** streaming delta 配信 (Anthropic のみ実配線。他プロバイダは受け取っても無視する — internal 参照) */
  onDelta?: (delta: string) => void;
};

export const zTextUsage = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cachedInputTokens: z.number().int().min(0).default(0),
    cacheWriteInputTokens: z.number().int().min(0).default(0),
    webSearchRequests: z.number().int().min(0).default(0),
  })
  .strict();
export type TextUsage = z.infer<typeof zTextUsage>;

export const zTextResult = z
  .object({
    text: z.string(),
    provider: zProvider,
    model: z.string(),
    usage: zTextUsage,
    costMicroUsd: z.number().int().min(0),
    stopReason: z.string().nullable(),
  })
  .strict();
export type TextResult = z.infer<typeof zTextResult>;

// ---------------------------------------------------------
// generateImages
// ---------------------------------------------------------

export const zGenerateImageReq = z
  .object({
    // 判断点 (オーケストレーターへ報告済み): テキストと異なり必須にした。画像モデルの
    // 「既定」は ops 設定 (ai_default_image_model, settings モジュール所有) にあるが、
    // module-contracts.md §2 の依存方向規約 (ai-providers → settings は許可されていない)
    // により本モジュール内では解決できない。呼び出し元 (settings に依存できる admin UI /
    // 将来の画像カスケード機能) が settingsFacade から解決した上でモデル ID を渡す設計とする。
    model: z.string().min(1).max(200),
    feature: z.string().min(1).max(50),
    prompt: z.string().min(1).max(32_000),
    n: z.number().int().min(1).max(4).default(1),
    sourceImages: z.array(zGenerateImageInput).max(4).optional(),
    size: z.string().max(20).optional(), // '1024x1024' 等
    quality: z.enum(["low", "medium", "high", "auto"]).optional(),
    refTable: z.string().max(100).optional(),
    refId: z.string().uuid().optional(),
  })
  .strict();
export type GenerateImageReq = z.infer<typeof zGenerateImageReq>;

export const zGeneratedImage = z
  .object({
    dataBase64: z.string(),
    mimeType: z.string(),
  })
  .strict();
export type GeneratedImage = z.infer<typeof zGeneratedImage>;

export const zImageResult = z
  .object({
    images: z.array(zGeneratedImage),
    provider: zProvider,
    model: z.string(),
    costMicroUsd: z.number().int().min(0),
    /**
     * tester 検証 (MEDIUM) 対応: Gemini の並列 N リクエストは all-or-nothing をやめ、
     * 成功分の画像のみを返すようにした (gemini.ts callGeminiImage 参照)。
     * failedCount は要求 n 件のうち画像化できなかった件数 (0 = 全件成功)。
     */
    failedCount: z.number().int().min(0),
  })
  .strict();
export type ImageResult = z.infer<typeof zImageResult>;

// ---------------------------------------------------------
// transcribe (既存 gpt-4o-transcribe 経路の移行先)
// ---------------------------------------------------------

export const zTranscribeReq = z
  .object({
    feature: z.string().min(1).max(50),
    filename: z.string().max(200),
    audioBase64: z.string().min(1),
    prompt: z.string().max(1000).optional(), // 専門用語補助 (既存 TERMINOLOGY_PROMPT 相当)
    model: z.string().min(1).max(200).optional(),
    refTable: z.string().max(100).optional(),
    refId: z.string().uuid().optional(),
  })
  .strict();
export type TranscribeReq = z.infer<typeof zTranscribeReq>;

export const zTranscribeResult = z
  .object({
    text: z.string(),
    costMicroUsd: z.number().int().min(0),
  })
  .strict();
export type TranscribeResult = z.infer<typeof zTranscribeResult>;

// ---------------------------------------------------------
// usage summary (ダッシュボード用。P5 で本格利用。P1 では facade 契約のみ)
// ---------------------------------------------------------

export const zUsageSummaryRow = z
  .object({
    provider: zProvider,
    model: z.string(),
    feature: z.string(),
    keyId: z.string().uuid().nullable(),
    date: z.string(), // YYYY-MM-DD (UTC)
    costMicroUsd: z.number().int(),
    callCount: z.number().int(),
    imageCount: z.number().int(),
  })
  .strict();
export type UsageSummaryRow = z.infer<typeof zUsageSummaryRow>;

/**
 * 当月の予算状態 (tester 検証事項「repository/getUsageSummary に当月の reserved/settled/上限を
 * 含める」対応。P5 ダッシュボードの進捗バー表示用)。ai_budget_get_current_month RPC の射影。
 */
export const zBudgetState = z
  .object({
    month: z.string(), // YYYY-MM-DD (月初日)
    reservedMicroUsd: z.number().int(),
    settledMicroUsd: z.number().int(),
    reservedImageCount: z.number().int(),
    settledImageCount: z.number().int(),
    budgetLimitMicroUsd: z.number().int(),
    imageLimit: z.number().int(),
  })
  .strict();
export type BudgetState = z.infer<typeof zBudgetState>;

export const zUsageSummary = z
  .object({
    totalCostMicroUsd: z.number().int(),
    totalImageCount: z.number().int(),
    rows: z.array(zUsageSummaryRow),
    // 取得失敗時 (RPC エラー等) は null。summary 本体の表示は継続する (ベストエフォート)。
    budget: zBudgetState.nullable(),
  })
  .strict();
export type UsageSummary = z.infer<typeof zUsageSummary>;

export const zUsageRange = z
  .object({
    from: z.string(),
    to: z.string(),
  })
  .strict();
export type UsageRange = z.infer<typeof zUsageRange>;

// ---------------------------------------------------------
// 画像生成カスケード (P3: docs/design/ai-studio-v2.md §4、module-contracts.md v2.5)
// ---------------------------------------------------------

/** ai_image_generations.status の DDL check 制約と 1:1 (migration 20260710000015) */
export const zImageGenerationStatus = z.enum(["pending", "succeeded", "failed"]);
export type ImageGenerationStatus = z.infer<typeof zImageGenerationStatus>;

/**
 * generateImageCascade の入力契約。ai-providers はサイト構造 (works/posts/hero 等) を
 * 知らないため、「サイトの文脈を使う」トグルは呼び出し元 (admin UI 層) が構築済みの
 * テキストを siteContext として渡す形にする (依存方向 §2 の逸脱回避)。
 */
export const zGenerateImageCascadeInput = z
  .object({
    prompt: z.string().min(1).max(32_000),
    model: z.string().min(1).max(200),
    n: z.number().int().min(1).max(4).default(4),
    size: z.string().max(20).optional(),
    quality: z.enum(["low", "medium", "high", "auto"]).optional(),
    /** カスケード元 (選択済みの ai_image_generations.id)。null = 新規バッチ */
    parentId: z.string().uuid().nullable().default(null),
    /**
     * 追加の参照画像 (既存 media ライブラリから選択、最大 4 枚)。parentId 指定時は
     * カスケード元の画像が自動的に 1 枚目として合成されるため、ここには「追加分」のみを渡す
     * (parentId の画像自体を重複して渡す必要は無い)。
     */
    sourceMediaIds: z.array(zMediaId).max(4).default([]),
    /** ライブラリに未保存の参照画像 (自然言語レタッチ用アップロード等) */
    rawSourceImages: z.array(zGenerateImageInput).max(4).default([]),
    /** 「サイトの文脈を使う」トグル ON 時、呼び出し元が構築済みのコンテキスト MD */
    siteContext: z.string().max(20_000).nullable().default(null),
  })
  .strict();
export type GenerateImageCascadeInput = z.infer<typeof zGenerateImageCascadeInput>;

/** グリッド 1 枚 / パンくず 1 ノードの共通射影 */
export type ImageCascadeNode = {
  id: string;
  requestGroupId: string;
  parentId: string | null;
  /** BLOCKER (2026-07-10 確定): root_id は常に非 null。ルート行は自身の id を指す */
  rootId: string;
  prompt: string;
  provider: Provider;
  model: string;
  mediaId: string;
  url: string;
  isSelected: boolean;
  createdAt: string;
};

export type ImageCascadeResult = {
  requestGroupId: string;
  images: ImageCascadeNode[];
  /** 要求 n 件のうち画像化 or media 保存できなかった件数 */
  failedCount: number;
  /** parentId 指定時のみ非空。root → ... → parent の順 */
  breadcrumb: ImageCascadeNode[];
};
