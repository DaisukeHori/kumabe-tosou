import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import type { RunProgressEvent, RunStage, RunStatus } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §3.5 / §7.1 / §7.6: GET /api/ai/runs/{id}/stream (admin, SSE 観測専用)。
 * zRunProgressEvent (契約書 §4.6) を送出する。
 *
 * 実装方式 (§7.6「SSE は観測専用」の具体化。オーケストレーターへ報告する既知の
 * 簡易化点):
 * advance の実行プロセスと本 SSE 接続は別プロセス (別 HTTP リクエスト) のため、
 * Claude のトークン単位の真のストリーミング (draft_delta) はここでは中継できない。
 * タスク指示どおり「DB ポーリング (2秒) + 直近 revision 差分」で簡易実装する:
 * - 2 秒ごとに ai_runs.status と channel_drafts を再取得する。
 * - status が変化したら、直前の stage の 'done' と (非終端なら) 次 stage の
 *   'start' を送る。
 * - まだ通知していない channel_drafts (commit 済み) を見つけたら、その
 *   channel の完成コンテンツ全体を 1 件の draft_delta として送る (真の
 *   トークン単位 delta ではなく、確定した内容のスナップショットを delta
 *   フィールドに JSON 文字列として載せる簡易実装)。
 * - status が終端 (ready_for_review/completed/failed/cancelled) になったら
 *   completed を送って接続を閉じる。
 */
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: readonly RunStatus[] = ["ready_for_review", "completed", "failed", "cancelled"];
const STAGE_STATUSES: readonly RunStage[] = ["extracting", "researching", "drafting"];

function isStage(status: RunStatus): status is RunStage {
  return (STAGE_STATUSES as readonly string[]).includes(status);
}

function sseLine(event: RunProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json(
      { code: admin.code, message: info.message },
      { status: admin.code === "KMB-E201" ? 401 : 403 },
    );
  }

  const { id: runId } = await params;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const notifiedDraftIds = new Set<string>();
      let lastStatus: RunStatus | null = null;

      function send(event: RunProgressEvent) {
        if (closed) return;
        controller.enqueue(encoder.encode(sseLine(event)));
      }

      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      try {
        while (true) {
          if (closed || request.signal.aborted) break;

          const runResult = await aiStudioFacade.getRunDetail(runId);
          if (!runResult.ok) {
            send({ type: "completed" });
            break;
          }
          const run = runResult.value;

          if (lastStatus === null) {
            const draftsResult = await aiStudioFacade.listDraftsForRunDetail(runId);
            const completedDrafts = draftsResult.ok
              ? draftsResult.value
                  .filter((d) => d.status !== "generating")
                  .map((d) => ({ channel: d.channel, draft_id: d.id }))
              : [];
            for (const d of completedDrafts) notifiedDraftIds.add(d.draft_id);
            send({ type: "snapshot", run_status: run.status, completed_drafts: completedDrafts });
          } else if (run.status !== lastStatus) {
            if (isStage(lastStatus)) {
              send({ type: "stage", stage: lastStatus, status: "done", error_code: run.error_code });
            }
            if (isStage(run.status)) {
              send({ type: "stage", stage: run.status, status: "start", error_code: null });
            }
            if (run.status === "failed") {
              // 直前 stage が failed の場合、lastStatus が既にそのステージ名のままの
              // ことがある (§7.6: 失敗時は status を進めず lease だけ解放するため)。
              if (isStage(lastStatus)) {
                send({ type: "stage", stage: lastStatus, status: "failed", error_code: run.error_code });
              }
            }
          }
          lastStatus = run.status;

          const draftsResult = await aiStudioFacade.listDraftsForRunDetail(runId);
          if (draftsResult.ok) {
            for (const draft of draftsResult.value) {
              if (draft.status === "generating") continue;
              if (notifiedDraftIds.has(draft.id)) continue;
              notifiedDraftIds.add(draft.id);
              send({ type: "draft_delta", channel: draft.channel, delta: JSON.stringify(draft.content) });
            }
          }

          if (TERMINAL_STATUSES.includes(run.status)) {
            send({ type: "completed" });
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
