import type { Channel, Result } from "@/modules/platform/contracts";

import type { ApprovedDraft, CreateSourceInput, RunStatus } from "./contracts";
import type { CreateUploadUrlInput } from "@/modules/platform/contracts";

/**
 * ai-studio モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 2 以降。
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
