import { randomUUID } from "node:crypto";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Channel, KmbErrorCode, Result } from "@/modules/platform/contracts";
import { zCreateUploadUrlReq, type CreateUploadUrlInput } from "@/modules/platform/contracts";

import {
  CHANNEL_CONTENT_SCHEMAS,
  zBrief,
  zCreateSourceReq,
  zResearchNotes,
  type ApprovedDraft,
  type CreateSourceInput,
  type RunStage,
  type RunStatus,
  type TokenUsage,
} from "./contracts";
import { cleanTranscript, draftChannel, extractBrief, isClaudeConfigured, researchBrief } from "./internal/claude";
import { HEARTBEAT_INTERVAL_MS, interpretAcquireLeaseResult } from "./internal/lease";
import { MAX_STAGE_ATTEMPTS, nextStatusAfterStage } from "./internal/stage-machine";
import { isOpenAiConfigured, transcribeAudio } from "./internal/transcribe";
import {
  acquireLease,
  commitStage,
  confirmCleanedText as repoConfirmCleanedText,
  createAudioSignedUploadUrl,
  downloadAudio,
  getDraft,
  getRun,
  getSource,
  heartbeatLease,
  insertAiRevision,
  insertHumanRevision,
  insertRun,
  insertSource,
  listDraftsForRun,
  listRevisions,
  listRuns,
  listSources,
  releaseLeaseAfterFailure,
  setDraftReviewStatus,
  updateSourceTranscript,
  type ChannelDraftCommitInput,
  type DraftRow,
  type RevisionRow,
  type RunRow,
  type SourceRow,
} from "./repository";

/**
 * DB 行の読み取り型を admin UI (src/app/admin/studio/**) 向けに再輸出する。
 * repository.ts は他モジュール (今回は admin UI page.tsx 等の非モジュールファイル)
 * から直接 import できない (ESLint no-restricted-imports、module-contracts.md §2)
 * ため、他モジュールの MediaListItem 等と同様に facade.ts を唯一の入口とする。
 */
export type { SourceRow, RunRow, DraftRow, RevisionRow };

/**
 * ai-studio モジュールの公開 facade (契約書 §5)。
 */
export interface AiStudioFacade {
  createSource(input: CreateSourceInput): Promise<Result<{ source_id: string }>>;
  createAudioUploadUrl(
    req: CreateUploadUrlInput,
  ): Promise<Result<{ upload_url: string; storage_path: string }>>;
  /** 整文の人間確定 (stage 1.5) */
  confirmCleanedText(sourceId: string, finalText: string): Promise<Result<void>>;
  startRun(
    sourceId: string,
    channels: Channel[],
    research: boolean,
  ): Promise<Result<{ run_id: string }>>;
  /** 1 呼び出し = 1 stage (lease 取得込み、§7.1) */
  advanceRun(runId: string): Promise<Result<{ status: RunStatus }>>;
  /** human revision を積む */
  editDraft(draftId: string, content: unknown): Promise<Result<{ revision: number }>>;
  approveDraft(draftId: string): Promise<Result<void>>;
  rejectDraft(draftId: string): Promise<Result<void>>;
  /** distribution 専用。approved 以外は拒否 */
  getApprovedDraft(draftId: string): Promise<Result<ApprovedDraft>>;
}

/**
 * advance() の詳細な結果。契約書 §5 の advanceRun は Result<{status}> のみを
 * 返せるため 409 (lease 中) を表現できない (KMB エラーコード一覧に「同時実行中」に
 * 対応するものが無く、これは HTTP レベルの concurrency 信号であって業務エラーでは
 * ないため)。/api/ai/runs/[id]/advance ルートは本メソッドを直接使うことで
 * 正確な 409 応答を返す (既知の拡張 — オーケストレーターへ報告済み。他モジュールの
 * *FacadeExtended パターンと同じ扱い)。
 */
export type AdvanceOutcome =
  | { kind: "advanced"; status: RunStatus }
  | { kind: "held" }
  | { kind: "not_found" }
  | { kind: "error"; code: KmbErrorCode; detail?: string };

export interface AiStudioFacadeExtended extends AiStudioFacade {
  advanceRunDetailed(runId: string): Promise<AdvanceOutcome>;
  getSourceDetail(id: string): Promise<Result<SourceRow>>;
  listSourcesDetail(): Promise<Result<SourceRow[]>>;
  /** stage 1: 文字起こし (audio ソースのみ)。ai_sources.raw_text に保存する。 */
  transcribeSource(sourceId: string): Promise<Result<{ raw_text: string }>>;
  /**
   * stage 1.5: Claude 整文。ai_sources.cleaned_text に AI 出力を仮保存し、
   * corrections/meaning_preserved を含むペイロードをそのまま返す (raw との差分表示用)。
   * meaning_preserved=false は HTTP 的には成功応答のまま (§9 KMB-E406 は
   * 「raw のまま人間修正へフォールバック」という UI 側の判断材料であり、
   * Claude 呼び出し自体が失敗したわけではないため)。
   */
  cleanSource(sourceId: string): Promise<
    Result<{ cleaned_text: string; corrections: unknown; meaning_preserved: boolean; raw_text: string }>
  >;
  getRunDetail(id: string): Promise<Result<RunRow>>;
  listRunsDetail(): Promise<Result<RunRow[]>>;
  listDraftsForRunDetail(runId: string): Promise<Result<DraftRow[]>>;
  listRevisionsDetail(draftId: string): Promise<Result<RevisionRow[]>>;
  /** 修正指示付きの再生成。draft_revisions に ai 版として積む (§5.3)。 */
  regenerateDraft(draftId: string, instruction: string): Promise<Result<{ revision: number }>>;
}

function errFrom(err: unknown): Result<never> {
  return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
}

function sumTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce<TokenUsage>(
    (acc, u) => ({
      input_tokens: acc.input_tokens + u.input_tokens,
      output_tokens: acc.output_tokens + u.output_tokens,
      cache_read_input_tokens: acc.cache_read_input_tokens + u.cache_read_input_tokens,
      cache_creation_input_tokens: acc.cache_creation_input_tokens + u.cache_creation_input_tokens,
      web_search_requests: acc.web_search_requests + u.web_search_requests,
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      web_search_requests: 0,
    },
  );
}

async function runOneStage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  runId: string,
  stage: RunStage,
  row: {
    source_id: string;
    research_enabled: boolean;
    target_channels: string[];
    brief: unknown;
    research_notes: unknown;
  },
): Promise<AdvanceOutcome> {
  if (stage === "extracting") {
    const source = await getSource(supabase, row.source_id);
    if (!source?.cleaned_text) {
      await releaseLeaseAfterFailure(supabase, runId, "KMB-E101");
      return { kind: "error", code: "KMB-E101", detail: "cleaned_text が未確定です" };
    }
    const result = await extractBrief(source.cleaned_text);
    if (!result.ok) {
      await releaseLeaseAfterFailure(supabase, runId, result.code);
      return { kind: "error", code: result.code, detail: result.detail };
    }
    const nextStatus = nextStatusAfterStage("extracting", row.research_enabled);
    const status = await commitStage(supabase, {
      runId,
      expectedStatus: "extracting",
      nextStatus,
      brief: result.value.data,
      tokenUsageDelta: result.value.usage,
    });
    return { kind: "advanced", status: status as RunStatus };
  }

  if (stage === "researching") {
    const brief = zBrief.parse(row.brief);
    const result = await researchBrief(brief);
    if (!result.ok) {
      await releaseLeaseAfterFailure(supabase, runId, result.code);
      return { kind: "error", code: result.code, detail: result.detail };
    }
    const nextStatus = nextStatusAfterStage("researching", row.research_enabled);
    const status = await commitStage(supabase, {
      runId,
      expectedStatus: "researching",
      nextStatus,
      researchNotes: result.value.data,
      tokenUsageDelta: result.value.usage,
    });
    return { kind: "advanced", status: status as RunStatus };
  }

  // stage === "drafting"
  const brief = zBrief.parse(row.brief);
  const researchNotes = row.research_notes ? zResearchNotes.parse(row.research_notes) : null;
  const channels = row.target_channels as Channel[];

  const results = await Promise.all(channels.map((ch) => draftChannel(ch, brief, researchNotes, null)));
  const firstFailure = results.find((r) => !r.ok);
  if (firstFailure && !firstFailure.ok) {
    await releaseLeaseAfterFailure(supabase, runId, firstFailure.code);
    return { kind: "error", code: firstFailure.code, detail: firstFailure.detail };
  }

  const channelDrafts: ChannelDraftCommitInput[] = channels.map((ch, i) => {
    const r = results[i];
    if (!r.ok) throw new Error("unreachable: checked above");
    return { channel: ch, content: r.value.data.content, claims: r.value.data.claims };
  });
  const usageSum = sumTokenUsage(
    results.map((r) => {
      if (!r.ok) throw new Error("unreachable: checked above");
      return r.value.usage;
    }),
  );

  const nextStatus = nextStatusAfterStage("drafting", row.research_enabled);
  const status = await commitStage(supabase, {
    runId,
    expectedStatus: "drafting",
    nextStatus,
    channelDrafts,
    tokenUsageDelta: usageSum,
  });
  return { kind: "advanced", status: status as RunStatus };
}

export const aiStudioFacade: AiStudioFacadeExtended = {
  async createSource(input) {
    try {
      const parsed = zCreateSourceReq.safeParse(input);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const sourceId = await insertSource(supabase, {
        inputType: parsed.data.input_type,
        rawText: parsed.data.raw_text,
        audioStoragePath: parsed.data.audio_storage_path ?? null,
        createdBy: user.id,
      });
      return { ok: true, value: { source_id: sourceId } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async createAudioUploadUrl(req) {
    try {
      const parsed = zCreateUploadUrlReq.safeParse({ ...req, kind: "audio" });
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const safeName = req.filename
        .split(/[\\/]/)
        .pop()!
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 100);
      const storagePath = `${randomUUID()}-${safeName}`;
      const { uploadUrl } = await createAudioSignedUploadUrl(supabase, storagePath);
      return { ok: true, value: { upload_url: uploadUrl, storage_path: storagePath } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async confirmCleanedText(sourceId, finalText) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      await repoConfirmCleanedText(supabase, sourceId, finalText);
      return { ok: true, value: undefined };
    } catch (err) {
      return errFrom(err);
    }
  },

  async startRun(sourceId, channels, research) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const source = await getSource(supabase, sourceId);
      if (!source) return { ok: false, code: "KMB-E101", detail: "source が見つかりません" };
      if (!source.cleaned_text) {
        return { ok: false, code: "KMB-E101", detail: "整文確定 (confirmCleanedText) が未実施です" };
      }

      const runId = await insertRun(supabase, {
        sourceId,
        targetChannels: channels,
        researchEnabled: research,
        createdBy: user.id,
      });
      return { ok: true, value: { run_id: runId } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async advanceRunDetailed(runId) {
    if (!isClaudeConfigured()) {
      return { kind: "error", code: "KMB-E901", detail: "ANTHROPIC_API_KEY が未設定です" };
    }
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const supabase = await createSupabaseServerClient();
      const raw = await acquireLease(supabase, runId);
      const outcome = interpretAcquireLeaseResult(raw);

      if (outcome.kind === "not_found") return { kind: "not_found" };
      if (outcome.kind === "held") return { kind: "held" };
      if (outcome.kind === "terminal") return { kind: "advanced", status: outcome.status };
      if (outcome.kind === "exhausted") {
        return { kind: "advanced", status: "failed" };
      }

      const row = outcome.row;
      heartbeatTimer = setInterval(() => {
        heartbeatLease(supabase, runId).catch(() => {
          // heartbeat 失敗はベストエフォート。lease が自然失効しても
          // クラッシュ再開 (§7.6) の仕組みで次の advance が回収する。
        });
      }, HEARTBEAT_INTERVAL_MS);

      const stage = row.status as RunStage;
      return await runOneStage(supabase, runId, stage, row);
    } catch (err) {
      return { kind: "error", code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  },

  async advanceRun(runId) {
    const outcome = await this.advanceRunDetailed(runId);
    if (outcome.kind === "advanced") return { ok: true, value: { status: outcome.status } };
    if (outcome.kind === "held") {
      return { ok: false, code: "KMB-E901", detail: "lease_held (409相当。advanceRunDetailed を使用してください)" };
    }
    if (outcome.kind === "not_found") return { ok: false, code: "KMB-E901", detail: "run が見つかりません" };
    return { ok: false, code: outcome.code, detail: outcome.detail };
  },

  async editDraft(draftId, content) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const draft = await getDraft(supabase, draftId);
      if (!draft) return { ok: false, code: "KMB-E101", detail: "draft が見つかりません" };

      const schema = CHANNEL_CONTENT_SCHEMAS[draft.channel];
      const parsed = schema.safeParse(content);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const revision = await insertHumanRevision(supabase, draftId, parsed.data, user.id);
      return { ok: true, value: { revision } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async approveDraft(draftId) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      await setDraftReviewStatus(supabase, draftId, "approved", user.id);
      return { ok: true, value: undefined };
    } catch (err) {
      return errFrom(err);
    }
  },

  async rejectDraft(draftId) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      await setDraftReviewStatus(supabase, draftId, "rejected", user.id);
      return { ok: true, value: undefined };
    } catch (err) {
      return errFrom(err);
    }
  },

  async getApprovedDraft(draftId) {
    try {
      const supabase = await createSupabaseServerClient();
      const draft = await getDraft(supabase, draftId);
      if (!draft) return { ok: false, code: "KMB-E101", detail: "draft が見つかりません" };
      if (draft.status !== "approved") {
        return { ok: false, code: "KMB-E101", detail: "承認済みの draft ではありません" };
      }
      return {
        ok: true,
        value: {
          draft_id: draft.id,
          channel: draft.channel,
          content: draft.content as ApprovedDraft["content"],
          approved_at: draft.reviewed_at ?? new Date().toISOString(),
        },
      };
    } catch (err) {
      return errFrom(err);
    }
  },

  async getSourceDetail(id) {
    try {
      const supabase = await createSupabaseServerClient();
      const row = await getSource(supabase, id);
      if (!row) return { ok: false, code: "KMB-E101", detail: "source が見つかりません" };
      return { ok: true, value: row };
    } catch (err) {
      return errFrom(err);
    }
  },

  async listSourcesDetail() {
    try {
      const supabase = await createSupabaseServerClient();
      return { ok: true, value: await listSources(supabase) };
    } catch (err) {
      return errFrom(err);
    }
  },

  async transcribeSource(sourceId) {
    if (!isOpenAiConfigured()) {
      return { ok: false, code: "KMB-E901", detail: "OPENAI_API_KEY が未設定です" };
    }
    try {
      const supabase = await createSupabaseServerClient();
      const source = await getSource(supabase, sourceId);
      if (!source) return { ok: false, code: "KMB-E101", detail: "source が見つかりません" };
      if (source.input_type !== "audio" || !source.audio_storage_path) {
        return { ok: false, code: "KMB-E101", detail: "audio ソースではありません" };
      }

      await updateSourceTranscript(supabase, sourceId, {
        rawText: source.raw_text ?? "",
        transcriptStatus: "processing",
      });

      const bytes = await downloadAudio(supabase, source.audio_storage_path);
      const result = await transcribeAudio(bytes, source.audio_storage_path);
      if (!result.ok) {
        await updateSourceTranscript(supabase, sourceId, {
          rawText: source.raw_text ?? "",
          transcriptStatus: "failed",
        });
        return result;
      }

      await updateSourceTranscript(supabase, sourceId, {
        rawText: result.value.text,
        transcriptStatus: "done",
      });
      return { ok: true, value: { raw_text: result.value.text } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async cleanSource(sourceId) {
    if (!isClaudeConfigured()) {
      return { ok: false, code: "KMB-E901", detail: "ANTHROPIC_API_KEY が未設定です" };
    }
    try {
      const supabase = await createSupabaseServerClient();
      const source = await getSource(supabase, sourceId);
      if (!source) return { ok: false, code: "KMB-E101", detail: "source が見つかりません" };
      if (!source.raw_text) return { ok: false, code: "KMB-E101", detail: "raw_text が未確定です" };

      const result = await cleanTranscript(source.raw_text);
      if (!result.ok) return result;

      // AI 出力を仮保存 (transcript_status='cleaning' — 人間確定前の中間状態)。
      // 確定 (transcript_status='cleaned') は confirmCleanedText が担う (§5.3)。
      await updateSourceTranscript(supabase, sourceId, {
        rawText: source.raw_text,
        transcriptStatus: "cleaning",
      });

      return {
        ok: true,
        value: {
          cleaned_text: result.value.data.cleaned_text,
          corrections: result.value.data.corrections,
          meaning_preserved: result.value.data.meaning_preserved,
          raw_text: source.raw_text,
        },
      };
    } catch (err) {
      return errFrom(err);
    }
  },

  async getRunDetail(id) {
    try {
      const supabase = await createSupabaseServerClient();
      const row = await getRun(supabase, id);
      if (!row) return { ok: false, code: "KMB-E101", detail: "run が見つかりません" };
      return { ok: true, value: row };
    } catch (err) {
      return errFrom(err);
    }
  },

  async listRunsDetail() {
    try {
      const supabase = await createSupabaseServerClient();
      return { ok: true, value: await listRuns(supabase) };
    } catch (err) {
      return errFrom(err);
    }
  },

  async listDraftsForRunDetail(runId) {
    try {
      const supabase = await createSupabaseServerClient();
      return { ok: true, value: await listDraftsForRun(supabase, runId) };
    } catch (err) {
      return errFrom(err);
    }
  },

  async listRevisionsDetail(draftId) {
    try {
      const supabase = await createSupabaseServerClient();
      return { ok: true, value: await listRevisions(supabase, draftId) };
    } catch (err) {
      return errFrom(err);
    }
  },

  async regenerateDraft(draftId, instruction) {
    if (!isClaudeConfigured()) {
      return { ok: false, code: "KMB-E901", detail: "ANTHROPIC_API_KEY が未設定です" };
    }
    try {
      const supabase = await createSupabaseServerClient();
      const draft = await getDraft(supabase, draftId);
      if (!draft) return { ok: false, code: "KMB-E101", detail: "draft が見つかりません" };

      const run = await getRun(supabase, draft.run_id);
      if (!run) return { ok: false, code: "KMB-E101", detail: "run が見つかりません" };

      const brief = zBrief.parse(run.brief);
      const researchNotes = run.research_notes ? zResearchNotes.parse(run.research_notes) : null;

      const result = await draftChannel(draft.channel, brief, researchNotes, instruction);
      if (!result.ok) return result;

      const revision = await insertAiRevision(supabase, draftId, result.value.data.content, result.value.data.claims);
      return { ok: true, value: { revision } };
    } catch (err) {
      return errFrom(err);
    }
  },
};

export const MAX_ADVANCE_STAGE_ATTEMPTS = MAX_STAGE_ATTEMPTS;
