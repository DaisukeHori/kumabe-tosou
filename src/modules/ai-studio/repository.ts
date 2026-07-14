import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Channel } from "@/modules/platform/contracts";

import type { AcquireLeaseRawResult } from "./internal/lease";
import type { Claim, ChannelContent, ImageCandidate, RunStatus, StyleProfilesByChannel } from "./contracts";

type Supa = SupabaseClient;

const AUDIO_BUCKET = "audio";

// ---------------------------------------------------------
// ai_sources
// ---------------------------------------------------------

export type SourceRow = {
  id: string;
  input_type: "audio" | "text";
  audio_storage_path: string | null;
  raw_text: string | null;
  cleaned_text: string | null;
  cleaned_at: string | null;
  transcript_status: string;
  duration_seconds: number | null;
  created_by: string | null;
  created_at: string;
};

const SOURCE_SELECT =
  "id, input_type, audio_storage_path, raw_text, cleaned_text, cleaned_at, transcript_status, duration_seconds, created_by, created_at";

export async function insertSource(
  supabase: Supa,
  row: {
    inputType: "audio" | "text";
    rawText: string | null;
    audioStoragePath: string | null;
    createdBy: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("ai_sources")
    .insert({
      input_type: row.inputType,
      raw_text: row.rawText,
      audio_storage_path: row.audioStoragePath,
      transcript_status: row.inputType === "audio" ? "pending" : "n/a",
      created_by: row.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ai_sources 作成に失敗しました: ${error?.message}`);
  return data.id as string;
}

export async function getSource(supabase: Supa, id: string): Promise<SourceRow | null> {
  const { data, error } = await supabase.from("ai_sources").select(SOURCE_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`ai_sources 取得に失敗しました (${id}): ${error.message}`);
  return data ?? null;
}

export async function listSources(supabase: Supa, limit = 50): Promise<SourceRow[]> {
  const { data, error } = await supabase
    .from("ai_sources")
    .select(SOURCE_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`ai_sources 一覧取得に失敗しました: ${error.message}`);
  return (data ?? []) as SourceRow[];
}

export async function updateSourceTranscript(
  supabase: Supa,
  id: string,
  patch: { rawText: string; transcriptStatus: string; durationSeconds?: number | null },
): Promise<void> {
  const { error } = await supabase
    .from("ai_sources")
    .update({
      raw_text: patch.rawText,
      transcript_status: patch.transcriptStatus,
      ...(patch.durationSeconds !== undefined ? { duration_seconds: patch.durationSeconds } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(`ai_sources 更新 (transcript) に失敗しました (${id}): ${error.message}`);
}

export async function updateSourceTranscriptStatus(
  supabase: Supa,
  id: string,
  transcriptStatus: string,
): Promise<void> {
  const { error } = await supabase.from("ai_sources").update({ transcript_status: transcriptStatus }).eq("id", id);
  if (error) throw new Error(`ai_sources ステータス更新に失敗しました (${id}): ${error.message}`);
}

/** stage 1.5 の人間確定 (§5.3): cleaned_text = final_text (人間修正後)、cleaned_at 記録。 */
export async function confirmCleanedText(supabase: Supa, id: string, finalText: string): Promise<void> {
  const { error } = await supabase
    .from("ai_sources")
    .update({ cleaned_text: finalText, cleaned_at: new Date().toISOString(), transcript_status: "cleaned" })
    .eq("id", id);
  if (error) throw new Error(`ai_sources 整文確定に失敗しました (${id}): ${error.message}`);
}

export async function createAudioSignedUploadUrl(
  supabase: Supa,
  storagePath: string,
): Promise<{ uploadUrl: string; token: string }> {
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new Error(`音声アップロード URL の発行に失敗しました (${storagePath}): ${error?.message}`);
  }
  return { uploadUrl: data.signedUrl, token: data.token };
}

export async function downloadAudio(supabase: Supa, storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`音声のダウンロードに失敗しました (${storagePath}): ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

// ---------------------------------------------------------
// ai_runs
// ---------------------------------------------------------

export type RunRow = {
  id: string;
  source_id: string;
  status: RunStatus;
  target_channels: string[];
  research_enabled: boolean;
  brief: unknown;
  research_notes: unknown;
  error_code: string | null;
  token_usage: unknown;
  lease_expires_at: string | null;
  stage_attempts: number;
  /** P4: image_generation ステージが生成した候補画像 (migration 20260710000019)。 */
  image_candidates: ImageCandidate[];
  /**
   * Issue #20: startRun 時点で確定させた DistributionFacade.getStyleProfiles() の結果
   * (migration 20260714000036)。zStyleProfilesByChannel.parse() で検証してから使う
   * (brief/research_notes と同じ「unknown で持って利用箇所で parse する」規約)。
   */
  style_profiles: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const RUN_SELECT =
  "id, source_id, status, target_channels, research_enabled, brief, research_notes, error_code, token_usage, lease_expires_at, stage_attempts, image_candidates, style_profiles, created_by, created_at, updated_at";

export async function insertRun(
  supabase: Supa,
  row: {
    sourceId: string;
    targetChannels: Channel[];
    researchEnabled: boolean;
    styleProfiles: StyleProfilesByChannel;
    createdBy: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("ai_runs")
    .insert({
      source_id: row.sourceId,
      target_channels: row.targetChannels,
      research_enabled: row.researchEnabled,
      style_profiles: row.styleProfiles,
      created_by: row.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ai_runs 作成に失敗しました: ${error?.message}`);
  return data.id as string;
}

export async function getRun(supabase: Supa, id: string): Promise<RunRow | null> {
  const { data, error } = await supabase.from("ai_runs").select(RUN_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`ai_runs 取得に失敗しました (${id}): ${error.message}`);
  return data ?? null;
}

export async function listRuns(supabase: Supa, limit = 50): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("ai_runs")
    .select(RUN_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`ai_runs 一覧取得に失敗しました: ${error.message}`);
  return (data ?? []) as RunRow[];
}

/** migration 20260708000009 の ai_run_acquire_lease RPC (§7.6 lease 取得 CAS) */
export async function acquireLease(supabase: Supa, runId: string): Promise<AcquireLeaseRawResult> {
  const { data, error } = await supabase.rpc("ai_run_acquire_lease", { p_run_id: runId });
  if (error) throw new Error(`lease 取得 RPC に失敗しました (${runId}): ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as AcquireLeaseRawResult;
}

/** heartbeat (§7.6: 20 秒ごとに lease を延長)。lease を保持中の場合のみ延長する単純な CAS。 */
export async function heartbeatLease(supabase: Supa, runId: string): Promise<void> {
  const leaseUntil = new Date(Date.now() + 90_000).toISOString();
  const { error } = await supabase
    .from("ai_runs")
    .update({ lease_expires_at: leaseUntil })
    .eq("id", runId)
    .not("lease_expires_at", "is", null);
  if (error) throw new Error(`lease heartbeat に失敗しました (${runId}): ${error.message}`);
}

/**
 * stage が失敗した場合 (Claude 呼び出しが definitive error を返した場合) に
 * lease を解放して error_code を記録する。status・stage_attempts は変更しない
 * (同じ stage を次の advance が再試行できるようにするため。上限は
 * ai_run_acquire_lease の stage_attempts>=3 判定が担う)。
 */
export async function releaseLeaseAfterFailure(supabase: Supa, runId: string, errorCode: string): Promise<void> {
  const { error } = await supabase
    .from("ai_runs")
    .update({ lease_expires_at: null, error_code: errorCode })
    .eq("id", runId);
  if (error) throw new Error(`lease 解放 (失敗時) に失敗しました (${runId}): ${error.message}`);
}

export type ChannelDraftCommitInput = {
  channel: Channel;
  content: ChannelContent[Channel];
  claims: Claim[];
};

/** migration 20260708000009 の ai_run_commit_stage RPC (§7.6 成果物 commit + status 前進 + lease 解放) */
export async function commitStage(
  supabase: Supa,
  params: {
    runId: string;
    expectedStatus: string;
    nextStatus: string;
    brief?: unknown;
    researchNotes?: unknown;
    tokenUsageDelta?: unknown;
    channelDrafts?: ChannelDraftCommitInput[];
    errorCode?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("ai_run_commit_stage", {
    p_run_id: params.runId,
    p_expected_status: params.expectedStatus,
    p_next_status: params.nextStatus,
    p_brief: params.brief ?? null,
    p_research_notes: params.researchNotes ?? null,
    p_token_usage_delta: params.tokenUsageDelta ?? null,
    p_channel_drafts: params.channelDrafts ?? null,
    p_error_code: params.errorCode ?? null,
  });
  if (error) throw new Error(`stage commit RPC に失敗しました (${params.runId}): ${error.message}`);
  return data as string;
}

/**
 * P4: image_generation ステージ専用の commit (migration 20260710000019 の
 * ai_run_commit_image_stage RPC)。既存 ai_run_commit_stage は channel_drafts 書き込み
 * ロジックを抱えた drafting 専用の形をしているため、シグネチャを汚さず新規関数として分離した
 * (判断点。実装報告参照)。CAS 意味論・冪等性は commitStage と同型。
 */
export async function commitImageStage(
  supabase: Supa,
  params: {
    runId: string;
    expectedStatus: string;
    nextStatus: string;
    imageCandidates?: ImageCandidate[];
    errorCode?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("ai_run_commit_image_stage", {
    p_run_id: params.runId,
    p_expected_status: params.expectedStatus,
    p_next_status: params.nextStatus,
    p_image_candidates: params.imageCandidates ?? null,
    p_error_code: params.errorCode ?? null,
  });
  if (error) throw new Error(`image stage commit RPC に失敗しました (${params.runId}): ${error.message}`);
  return data as string;
}

/**
 * P4: 人間が候補画像 1 枚を選択したときに ai_runs.image_candidates[].selected を更新する。
 * 単一 admin 操作前提の read-modify-write (insertHumanRevision 等の既存パターンと同型。
 * 厳密な原子性は不要 — 同時に複数 admin が同一 run を選択操作する運用は想定しない)。
 */
export async function updateRunImageSelection(supabase: Supa, runId: string, mediaId: string): Promise<void> {
  const run = await getRun(supabase, runId);
  if (!run) throw new Error(`ai_runs が見つかりません (${runId})`);
  const updated = run.image_candidates.map((c) => ({ ...c, selected: c.media_id === mediaId }));
  const { error } = await supabase.from("ai_runs").update({ image_candidates: updated }).eq("id", runId);
  if (error) throw new Error(`ai_runs.image_candidates 更新に失敗しました (${runId}): ${error.message}`);
}

// ---------------------------------------------------------
// channel_drafts / draft_revisions
// ---------------------------------------------------------

export type DraftRow = {
  id: string;
  run_id: string;
  channel: Channel;
  status: string;
  content: unknown;
  claims: unknown;
  current_revision: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const DRAFT_SELECT =
  "id, run_id, channel, status, content, claims, current_revision, reviewed_by, reviewed_at, created_at";

export async function getDraft(supabase: Supa, id: string): Promise<DraftRow | null> {
  const { data, error } = await supabase.from("channel_drafts").select(DRAFT_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`channel_drafts 取得に失敗しました (${id}): ${error.message}`);
  return data ?? null;
}

export async function listDraftsForRun(supabase: Supa, runId: string): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from("channel_drafts")
    .select(DRAFT_SELECT)
    .eq("run_id", runId)
    .order("channel", { ascending: true });
  if (error) throw new Error(`channel_drafts 一覧取得に失敗しました (${runId}): ${error.message}`);
  return (data ?? []) as DraftRow[];
}

export type RevisionRow = {
  id: string;
  draft_id: string;
  revision: number;
  content: unknown;
  edited_by: "ai" | "human";
  editor_id: string | null;
  created_at: string;
};

export async function listRevisions(supabase: Supa, draftId: string): Promise<RevisionRow[]> {
  const { data, error } = await supabase
    .from("draft_revisions")
    .select("id, draft_id, revision, content, edited_by, editor_id, created_at")
    .eq("draft_id", draftId)
    .order("revision", { ascending: true });
  if (error) throw new Error(`draft_revisions 一覧取得に失敗しました (${draftId}): ${error.message}`);
  return (data ?? []) as RevisionRow[];
}

/** 人間編集 (editDraft) — 新しい revision を human として積み、content/current_revision を更新する。 */
export async function insertHumanRevision(
  supabase: Supa,
  draftId: string,
  content: unknown,
  editorId: string | null,
): Promise<number> {
  const draft = await getDraft(supabase, draftId);
  if (!draft) throw new Error(`channel_drafts が見つかりません (${draftId})`);
  const nextRevision = draft.current_revision + 1;

  const { error: revError } = await supabase
    .from("draft_revisions")
    .insert({ draft_id: draftId, revision: nextRevision, content, edited_by: "human", editor_id: editorId });
  if (revError) throw new Error(`draft_revisions 作成 (human) に失敗しました (${draftId}): ${revError.message}`);

  const { error: draftError } = await supabase
    .from("channel_drafts")
    .update({ content, current_revision: nextRevision })
    .eq("id", draftId);
  if (draftError) throw new Error(`channel_drafts 更新 (human 編集) に失敗しました (${draftId}): ${draftError.message}`);

  return nextRevision;
}

/** 再生成 (regenerate) — 新しい revision を ai として積み、content/claims/current_revision を更新する。 */
export async function insertAiRevision(
  supabase: Supa,
  draftId: string,
  content: unknown,
  claims: unknown,
): Promise<number> {
  const draft = await getDraft(supabase, draftId);
  if (!draft) throw new Error(`channel_drafts が見つかりません (${draftId})`);
  const nextRevision = draft.current_revision + 1;

  const { error: revError } = await supabase
    .from("draft_revisions")
    .insert({ draft_id: draftId, revision: nextRevision, content, edited_by: "ai" });
  if (revError) throw new Error(`draft_revisions 作成 (ai 再生成) に失敗しました (${draftId}): ${revError.message}`);

  const { error: draftError } = await supabase
    .from("channel_drafts")
    .update({ content, claims, current_revision: nextRevision, status: "needs_review" })
    .eq("id", draftId);
  if (draftError) throw new Error(`channel_drafts 更新 (再生成) に失敗しました (${draftId}): ${draftError.message}`);

  return nextRevision;
}

export async function setDraftReviewStatus(
  supabase: Supa,
  draftId: string,
  status: "approved" | "rejected",
  reviewerId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("channel_drafts")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(`channel_drafts レビュー状態更新に失敗しました (${draftId}): ${error.message}`);
}
