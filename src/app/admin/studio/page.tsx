import { PageHeader } from "@/app/admin/_ui";
import { isAiStudioConfigured } from "@/lib/env";
import { aiStudioFacade } from "@/modules/ai-studio/facade";

import { StudioWorkspace } from "./StudioWorkspace";

export const dynamic = "force-dynamic";

/**
 * /admin/studio (設計書 §5.3 AI スタジオ画面フロー)。
 * URL 検索パラメータ (?source=..&run=..) で選択状態を持たせることで、
 * 履歴一覧・整文確認・実行進行・レビューの各段階をサーバ側で組み立てる
 * (他 admin 画面と同じ Server Component + facade 直接呼び出しパターン)。
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; run?: string }>;
}) {
  const { source: sourceId, run: runId } = await searchParams;
  const aiConfigured = isAiStudioConfigured();

  const sourcesResult = await aiStudioFacade.listSourcesDetail();
  const sources = sourcesResult.ok ? sourcesResult.value : [];

  const sourceDetailResult = sourceId ? await aiStudioFacade.getSourceDetail(sourceId) : null;
  const selectedSource = sourceDetailResult && sourceDetailResult.ok ? sourceDetailResult.value : null;

  const allRunsResult = sourceId ? await aiStudioFacade.listRunsDetail() : null;
  const runsForSource =
    allRunsResult && allRunsResult.ok ? allRunsResult.value.filter((r) => r.source_id === sourceId) : [];

  const selectedRunResult = runId ? await aiStudioFacade.getRunDetail(runId) : null;
  const selectedRun = selectedRunResult && selectedRunResult.ok ? selectedRunResult.value : null;

  const draftsResult = runId ? await aiStudioFacade.listDraftsForRunDetail(runId) : null;
  const drafts = draftsResult && draftsResult.ok ? draftsResult.value : [];

  // P4 (ai-studio-v2.md §7): image_generation ステージの候補画像 (レビュー画面の選択 UI 用)。
  const imageCandidatesResult = runId ? await aiStudioFacade.listRunImageCandidates(runId) : null;
  const imageCandidates = imageCandidatesResult && imageCandidatesResult.ok ? imageCandidatesResult.value : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AIスタジオ" />
      <StudioWorkspace
        aiConfigured={aiConfigured}
        sources={sources}
        selectedSourceId={sourceId ?? null}
        selectedSource={selectedSource}
        runsForSource={runsForSource}
        selectedRunId={runId ?? null}
        selectedRun={selectedRun}
        drafts={drafts}
        imageCandidates={imageCandidates}
      />
    </div>
  );
}
