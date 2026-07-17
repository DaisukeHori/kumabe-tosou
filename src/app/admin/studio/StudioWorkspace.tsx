"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { NoticePanel, StageProgress, Surface, type StageProgressStep } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Channel } from "@/modules/platform/contracts";
import type { DraftRow, RunImageCandidate, RunRow, SourceRow } from "@/modules/ai-studio/facade";
import type { RunProgressEvent, RunStage } from "@/modules/ai-studio/contracts";

import { ALL_CHANNELS, CHANNEL_LABELS, channelContentToText } from "./channel-content";
import { DiffView } from "./DiffView";

type Props = {
  aiConfigured: boolean;
  sources: SourceRow[];
  selectedSourceId: string | null;
  selectedSource: SourceRow | null;
  runsForSource: RunRow[];
  selectedRunId: string | null;
  selectedRun: RunRow | null;
  drafts: DraftRow[];
  /** P4 (ai-studio-v2.md §7): image_generation ステージの候補画像 (最大4件)。 */
  imageCandidates: RunImageCandidate[];
};

const RUN_TERMINAL_STATUSES = new Set(["ready_for_review", "completed", "failed", "cancelled"]);
const STAGE_LABELS: Record<RunStage, string> = {
  extracting: "要旨抽出",
  researching: "リサーチ",
  drafting: "チャネル別生成",
  image_generation: "画像生成",
};

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, message: json.message ?? json.detail ?? `失敗しました (HTTP ${res.status})`, status: res.status };
  }
  return { ok: true, data: json as T };
}

// [#127 R6a] source→整文→run→レビューの 4 段階を stage-progress.tsx で可視化する。
// URL クエリ (?source / ?run) と props から現在の段階を導出するだけの見た目専用ロジックで、
// 既存のフロー・分岐条件 (下の JSX) は一切変更しない。
const STUDIO_STAGE_DEFS: { key: string; label: string }[] = [
  { key: "input", label: "入力" },
  { key: "clean", label: "整文" },
  { key: "run", label: "実行" },
  { key: "review", label: "レビュー" },
];

function buildStudioStages(
  selectedSource: SourceRow | null,
  selectedRun: RunRow | null,
): StageProgressStep[] {
  const cleanConfirmed = selectedSource ? isCleanConfirmed(selectedSource) : false;
  const runReview =
    selectedRun !== null && (selectedRun.status === "ready_for_review" || selectedRun.status === "completed");

  let currentIndex: number;
  if (!selectedSource) currentIndex = 0; // 入力
  else if (!cleanConfirmed) currentIndex = 1; // 整文
  else if (!selectedRun) currentIndex = 2; // 実行 (開始フォーム)
  else if (runReview) currentIndex = 3; // レビュー
  else currentIndex = 2; // 実行 (進行中 / 失敗)

  return STUDIO_STAGE_DEFS.map((s, i) => ({
    ...s,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming",
  }));
}

export function StudioWorkspace(props: Props) {
  const { aiConfigured, sources, selectedSourceId, selectedSource, runsForSource, selectedRun, drafts, imageCandidates } =
    props;
  const router = useRouter();
  const stages = buildStudioStages(selectedSource, selectedRun);

  return (
    <div className="flex gap-6">
      <aside className="w-64 shrink-0">
        <SourceSidebar sources={sources} selectedSourceId={selectedSourceId} disabled={!aiConfigured} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Surface className="px-4 py-3">
          <StageProgress steps={stages} ariaLabel="発信スタジオの進行" />
        </Surface>

        {!aiConfigured && (
          <NoticePanel tone="warning">
            APIキー未設定です。ANTHROPIC_API_KEY / OPENAI_API_KEY を設定すると実行できるようになります。
          </NoticePanel>
        )}

        {!selectedSource && <NewSourceForm disabled={!aiConfigured} onCreated={(id) => router.push(`/admin/studio?source=${id}`)} />}

        {selectedSource && !isCleanConfirmed(selectedSource) && (
          <CleanStage source={selectedSource} disabled={!aiConfigured} onConfirmed={() => router.refresh()} />
        )}

        {selectedSource && isCleanConfirmed(selectedSource) && !selectedRun && (
          <StartRunForm
            sourceId={selectedSource.id}
            disabled={!aiConfigured}
            runsForSource={runsForSource}
            onStarted={(runId) => router.push(`/admin/studio?source=${selectedSource.id}&run=${runId}`)}
          />
        )}

        {selectedRun && !RUN_TERMINAL_STATUSES.has(selectedRun.status) && selectedRun.status !== "failed" && (
          <RunProgress key={selectedRun.id} run={selectedRun} onDone={() => router.refresh()} />
        )}

        {selectedRun && selectedRun.status === "failed" && (
          <NoticePanel tone="danger">
            実行が失敗しました ({selectedRun.error_code ?? "不明なエラー"})。新しい実行を作成してください。
          </NoticePanel>
        )}

        {selectedRun && (selectedRun.status === "ready_for_review" || selectedRun.status === "completed") && (
          <ReviewPanel
            key={selectedRun.id}
            runId={selectedRun.id}
            drafts={drafts}
            cleanedText={selectedSource?.cleaned_text ?? ""}
            imageCandidates={imageCandidates}
            onChanged={() => router.refresh()}
          />
        )}
      </div>
    </div>
  );
}

function isCleanConfirmed(source: SourceRow): boolean {
  return Boolean(source.cleaned_text) && source.transcript_status === "cleaned";
}

function SourceSidebar({ sources, selectedSourceId, disabled }: { sources: SourceRow[]; selectedSourceId: string | null; disabled: boolean }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" disabled={disabled} onClick={() => router.push("/admin/studio")}>
        + 新規作成
      </Button>
      <div className="mt-2 flex flex-col gap-1">
        {sources.length === 0 && <p className="text-xs text-muted-foreground">履歴はまだありません。</p>}
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => router.push(`/admin/studio?source=${s.id}`)}
            className={
              "rounded-lg px-3 py-2 text-left text-xs transition-colors " +
              (selectedSourceId === s.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")
            }
          >
            <p className="truncate">{(s.raw_text ?? "(音声/未処理)").slice(0, 30) || "(空)"}</p>
            <p className="mt-0.5 opacity-70">{new Date(s.created_at).toLocaleString("ja-JP")}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewSourceForm({ disabled, onCreated }: { disabled: boolean; onCreated: (sourceId: string) => void }) {
  const [mode, setMode] = useState<"text" | "record">("text");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const MAX_SECONDS = 15 * 60;
  const MAX_BYTES = 50 * 1024 * 1024;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            stopRecording();
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error("マイクにアクセスできませんでした。");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function submitAudio() {
    if (!recordedBlob) return;
    if (recordedBlob.size > MAX_BYTES) {
      toast.error("50MBを超えています。分割して録音してください (KMB-E303)。");
      return;
    }
    setIsSubmitting(true);
    try {
      const uploadUrlRes = await postJson<{ upload_url: string; storage_path: string }>("/api/upload-url", {
        kind: "audio",
        filename: "recording.webm",
        content_type: "audio/webm",
        size_bytes: recordedBlob.size,
      });
      if (!uploadUrlRes.ok) {
        toast.error(uploadUrlRes.message);
        return;
      }
      const putRes = await fetch(uploadUrlRes.data.upload_url, {
        method: "PUT",
        headers: { "content-type": "audio/webm" },
        body: recordedBlob,
      });
      if (!putRes.ok) {
        toast.error("音声のアップロードに失敗しました。");
        return;
      }
      const sourceRes = await postJson<{ source_id: string }>("/api/ai/sources", {
        input_type: "audio",
        raw_text: null,
        audio_storage_path: uploadUrlRes.data.storage_path,
      });
      if (!sourceRes.ok) {
        toast.error(sourceRes.message);
        return;
      }
      const transcribeRes = await postJson<{ raw_text: string }>("/api/transcribe", { source_id: sourceRes.data.source_id });
      if (!transcribeRes.ok) {
        toast.error(`文字起こしに失敗しました: ${transcribeRes.message}`);
      }
      onCreated(sourceRes.data.source_id);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitText() {
    if (!text.trim()) {
      toast.error("テキストを入力してください。");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await postJson<{ source_id: string }>("/api/ai/sources", { input_type: "text", raw_text: text });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onCreated(result.data.source_id);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Surface className="flex flex-col gap-4 p-4">
      <h2 className="font-heading text-section text-foreground">1. 入力</h2>
      <div className="flex gap-2">
        <Button size="sm" variant={mode === "text" ? "default" : "outline"} onClick={() => setMode("text")}>
          テキスト直書き
        </Button>
        <Button size="sm" variant={mode === "record" ? "default" : "outline"} onClick={() => setMode("record")}>
          録音
        </Button>
      </div>

      {mode === "text" && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="話したい内容・伝えたいことを自由に書いてください。"
            className="min-h-40"
            disabled={disabled}
          />
          <Button onClick={submitText} disabled={disabled || isSubmitting}>
            {isSubmitting ? "作成中..." : "次へ (整文確認)"}
          </Button>
        </div>
      )}

      {mode === "record" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">最長15分・50MB上限 (MediaRecorder, audio/webm)</p>
          <div className="flex items-center gap-2">
            {!isRecording && !recordedBlob && (
              <Button size="sm" onClick={startRecording} disabled={disabled}>
                録音開始
              </Button>
            )}
            {isRecording && (
              <Button size="sm" variant="destructive" onClick={stopRecording}>
                停止 ({Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")})
              </Button>
            )}
            {!isRecording && recordedBlob && (
              <>
                <Badge variant="neutral">録音済み ({(recordedBlob.size / 1024 / 1024).toFixed(1)}MB)</Badge>
                <Button size="sm" variant="outline" onClick={() => setRecordedBlob(null)}>
                  録り直す
                </Button>
              </>
            )}
          </div>
          {recordedBlob && (
            <Button onClick={submitAudio} disabled={disabled || isSubmitting}>
              {isSubmitting ? "アップロード中..." : "アップロード・文字起こし"}
            </Button>
          )}
        </div>
      )}
    </Surface>
  );
}

function CleanStage({ source, disabled, onConfirmed }: { source: SourceRow; disabled: boolean; onConfirmed: () => void }) {
  const [cleanResult, setCleanResult] = useState<{ cleaned_text: string; meaning_preserved: boolean } | null>(null);
  const [finalText, setFinalText] = useState(source.raw_text ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const needsTranscribe = source.input_type === "audio" && !source.raw_text && source.transcript_status !== "failed";

  async function runTranscribe() {
    setIsLoading(true);
    try {
      const res = await postJson<{ raw_text: string }>("/api/transcribe", { source_id: source.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      window.location.reload();
    } finally {
      setIsLoading(false);
    }
  }

  async function runClean() {
    setIsLoading(true);
    try {
      const res = await postJson<{ cleaned_text: string; corrections: unknown; meaning_preserved: boolean; raw_text: string; warning_code?: string }>(
        "/api/ai/clean",
        { source_id: source.id },
      );
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCleanResult({ cleaned_text: res.data.cleaned_text, meaning_preserved: res.data.meaning_preserved });
      setFinalText(res.data.meaning_preserved ? res.data.cleaned_text : res.data.raw_text);
      if (!res.data.meaning_preserved) {
        toast.warning("整文が意味を変えた可能性があります (KMB-E406)。原文のまま確認してください。");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function confirm(text: string) {
    setIsConfirming(true);
    try {
      const res = await postJson<{ ok: true }>("/api/ai/clean/confirm", { source_id: source.id, final_text: text });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onConfirmed();
    } finally {
      setIsConfirming(false);
    }
  }

  if (needsTranscribe) {
    return (
      <Surface className="flex flex-col gap-3 p-4">
        <h2 className="font-heading text-section text-foreground">文字起こし</h2>
        <Button onClick={runTranscribe} disabled={disabled || isLoading}>
          {isLoading ? "文字起こし中..." : "文字起こしを実行"}
        </Button>
      </Surface>
    );
  }

  const rawText = source.raw_text ?? "";

  return (
    <Surface className="flex flex-col gap-4 p-4">
      <h2 className="font-heading text-section text-foreground">1.5 整文確認</h2>
      <div className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">{rawText}</div>

      {!cleanResult && (
        <div className="flex gap-2">
          <Button onClick={runClean} disabled={disabled || isLoading || !rawText}>
            {isLoading ? "整文中..." : "AIで整文する"}
          </Button>
          <Button variant="outline" onClick={() => confirm(rawText)} disabled={isConfirming || !rawText}>
            整文せずこのまま確定 (skip)
          </Button>
        </div>
      )}

      {cleanResult && (
        <>
          <DiffView oldText={rawText} newText={cleanResult.cleaned_text} oldLabel="原文" newLabel="整文後" />
          {!cleanResult.meaning_preserved && (
            <p className="text-xs text-status-warning-fg">
              KMB-E406: 整文処理が意味の変化を検出しました。原文をベースに手修正してください。
            </p>
          )}
          <Textarea value={finalText} onChange={(e) => setFinalText(e.target.value)} className="min-h-32" />
          <Button onClick={() => confirm(finalText)} disabled={isConfirming}>
            {isConfirming ? "確定中..." : "この内容で確定"}
          </Button>
        </>
      )}
    </Surface>
  );
}

function StartRunForm({
  sourceId,
  disabled,
  runsForSource,
  onStarted,
}: {
  sourceId: string;
  disabled: boolean;
  runsForSource: RunRow[];
  onStarted: (runId: string) => void;
}) {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>(["site_blog"]);
  const [research, setResearch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleChannel(ch: Channel) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  }

  async function start() {
    if (channels.length === 0) {
      toast.error("チャネルを1つ以上選択してください。");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await postJson<{ run_id: string }>("/api/ai/runs", { source_id: sourceId, channels, research });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onStarted(res.data.run_id);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Surface className="flex flex-col gap-4 p-4">
      <h2 className="font-heading text-section text-foreground">2. 実行</h2>
      <div className="flex flex-col gap-2">
        <p className="text-sm">配信チャネル</p>
        <div className="flex flex-wrap gap-3">
          {ALL_CHANNELS.map((ch) => (
            <label key={ch} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={channels.includes(ch)} onCheckedChange={() => toggleChannel(ch)} />
              {CHANNEL_LABELS[ch]}
            </label>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-sm">
          <Checkbox checked={research} onCheckedChange={(c) => setResearch(Boolean(c))} />
          リサーチを有効にする (web_search)
        </label>
      </div>
      <Button onClick={start} disabled={disabled || isSubmitting}>
        {isSubmitting ? "開始中..." : "実行を開始"}
      </Button>

      {runsForSource.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-sm text-muted-foreground">過去の実行</p>
          <div className="flex flex-col gap-1">
            {runsForSource.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/admin/studio?source=${sourceId}&run=${r.id}`)}
                className="rounded px-2 py-1 text-left text-xs hover:bg-muted"
              >
                {r.status} / {new Date(r.created_at).toLocaleString("ja-JP")}
              </button>
            ))}
          </div>
        </div>
      )}
    </Surface>
  );
}

function RunProgress({ run, onDone }: { run: RunRow; onDone: () => void }) {
  const [status, setStatus] = useState(run.status);
  const [log, setLog] = useState<string[]>([]);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    const es = new EventSource(`/api/ai/runs/${run.id}/stream`);
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as RunProgressEvent;
        if (event.type === "snapshot") {
          setStatus(event.run_status);
        } else if (event.type === "stage") {
          setLog((prev) => [...prev, `${STAGE_LABELS[event.stage]}: ${event.status}`]);
        } else if (event.type === "completed") {
          es.close();
        }
      } catch {
        // ignore malformed event
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [run.id]);

  useEffect(() => {
    let cancelled = false;
    async function loop() {
      while (!cancelled) {
        const res = await fetch(`/api/ai/runs/${run.id}/advance`, { method: "POST" });
        if (cancelled) return;
        if (res.status === 409) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json.message ?? "実行に失敗しました。");
          setStatus("failed");
          onDone();
          return;
        }
        setStatus(json.status);
        if (RUN_TERMINAL_STATUSES.has(json.status)) {
          onDone();
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    void loop();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <h2 className="font-heading text-section text-foreground">2. 実行中</h2>
      <p className="text-sm">
        現在のステータス: <Badge variant="info">{status}</Badge>
      </p>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {log.length === 0 && <p>開始しています...</p>}
        {log.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </Surface>
  );
}

function ReviewPanel({
  runId,
  drafts,
  cleanedText,
  imageCandidates,
  onChanged,
}: {
  runId: string;
  drafts: DraftRow[];
  cleanedText: string;
  imageCandidates: RunImageCandidate[];
  onChanged: () => void;
}) {
  const [active, setActive] = useState<Channel | "distribution">(drafts[0]?.channel ?? "distribution");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-section text-foreground">3. レビュー</h2>

      {imageCandidates.length > 0 && (
        <ImageSelectionPanel runId={runId} candidates={imageCandidates} onChanged={onChanged} />
      )}

      <Tabs value={active} onValueChange={(v) => setActive(v as Channel | "distribution")}>
        <TabsList variant="line">
          {drafts.map((d) => (
            <TabsTrigger key={d.channel} value={d.channel}>
              {CHANNEL_LABELS[d.channel]}
            </TabsTrigger>
          ))}
          <TabsTrigger value="distribution">4. 配信</TabsTrigger>
        </TabsList>

        {drafts.map((d) => (
          <TabsContent key={d.channel} value={d.channel} className="mt-4">
            <DraftReviewCard draft={d} cleanedText={cleanedText} onChanged={onChanged} />
          </TabsContent>
        ))}

        <TabsContent value="distribution" className="mt-4">
          <div className="rounded-surface border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <p>配信機能は未接続です。</p>
            <p className="mt-1">
              チャネル接続・予約投稿は{" "}
              <a href="/admin/channels" className="underline underline-offset-2">
                SNSの接続
              </a>{" "}
              画面で行います (別 agent 実装分)。
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * P4 (ai-studio-v2.md §7): image_generation ステージで生成された候補 4 枚から 1 枚を選ぶ
 * (skip 可)。選択すると x (先頭ツイート) / instagram の channel_drafts.content に
 * media_id として反映される (POST /api/ai/runs/{id}/select-image)。
 */
function ImageSelectionPanel({
  runId,
  candidates,
  onChanged,
}: {
  runId: string;
  candidates: RunImageCandidate[];
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const alreadySelected = candidates.find((c) => c.selected) ?? null;

  async function select(mediaId: string | null) {
    setIsBusy(true);
    try {
      const res = await postJson("/api/ai/runs/" + runId + "/select-image", { media_id: mediaId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(mediaId ? "画像を選択しました。" : "画像選択をスキップしました。");
      onChanged();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">SNS投稿用の画像候補 (X/Instagram)</h3>
        <Button size="sm" variant="outline" onClick={() => select(null)} disabled={isBusy}>
          スキップ
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {candidates.map((c) => (
          <button
            key={c.mediaId}
            onClick={() => select(c.mediaId)}
            disabled={isBusy}
            className={
              "relative overflow-hidden rounded-lg border-2 transition-colors " +
              (c.selected ? "border-primary" : "border-transparent hover:border-muted-foreground/40")
            }
          >
            {c.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- AI 生成画像の候補プレビュー (外部/動的 URL のため next/image 最適化対象外)
              <img src={c.url} alt="AI生成画像候補" className="aspect-square w-full object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                取得失敗
              </div>
            )}
            {c.selected && (
              <Badge className="absolute top-1 right-1" variant="default">
                選択中
              </Badge>
            )}
          </button>
        ))}
      </div>
      {!alreadySelected && (
        <p className="text-xs text-muted-foreground">
          1枚選択すると X (先頭ツイート) / Instagram の投稿画像として反映されます。Instagram は画像必須です。
        </p>
      )}
    </Surface>
  );
}

// [#127 R6a] 下書きレビューの状態を R0 status Badge variant へ意味写像する
// (承認=success / 却下=urgent / レビュー待ち=warning)。
function draftStatusBadgeVariant(status: string): "success" | "urgent" | "warning" {
  if (status === "approved") return "success";
  if (status === "rejected") return "urgent";
  return "warning";
}

function DraftReviewCard({ draft, cleanedText, onChanged }: { draft: DraftRow; cleanedText: string; onChanged: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const claims = Array.isArray(draft.claims) ? (draft.claims as Array<{ text: string; source: string; research_url: string | null }>) : [];
  const contentText = channelContentToText(draft.channel, draft.content);

  async function approve() {
    setIsBusy(true);
    try {
      const res = await postJson("/api/ai/drafts/" + draft.id + "/approve", {});
      if (!res.ok) toast.error(res.message);
      else {
        toast.success("承認しました。");
        onChanged();
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function reject() {
    setIsBusy(true);
    try {
      const res = await postJson("/api/ai/drafts/" + draft.id + "/reject", {});
      if (!res.ok) toast.error(res.message);
      else {
        toast.success("却下しました。");
        onChanged();
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function regenerate() {
    if (!instruction.trim()) {
      toast.error("修正指示を入力してください。");
      return;
    }
    setIsBusy(true);
    try {
      const res = await fetch(`/api/ai/drafts/${draft.id}/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.message ?? "再生成に失敗しました。");
        return;
      }
      toast.success("再生成しました。");
      onChanged();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant={draftStatusBadgeVariant(draft.status)}>{draft.status}</Badge>
        <span className="text-xs text-muted-foreground">revision {draft.current_revision}</span>
      </div>

      <DiffView oldText={cleanedText} newText={contentText} oldLabel="整文後の発言" newLabel="生成コンテンツ" />

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          事実主張 (claims) — 黄色は推測 (inference) 由来です。判定自体もAI出力であり完全ではありません。
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {claims.length === 0 && <li className="text-xs text-muted-foreground">claims がありません。</li>}
          {claims.map((c, i) => (
            <li
              key={i}
              className={
                "rounded px-2 py-1 " +
                (c.source === "inference"
                  ? "bg-status-warning-bg text-status-warning-fg"
                  : "bg-muted/40")
              }
            >
              {c.text}
              <span className="ml-2 text-xs text-muted-foreground">
                [{c.source}
                {c.research_url ? ` / ${c.research_url}` : ""}]
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">内容の編集</p>
          <Button size="sm" variant="outline" onClick={() => setIsEditing((v) => !v)}>
            {isEditing ? "編集を閉じる" : "編集する"}
          </Button>
        </div>
        {isEditing ? (
          <ManualEditForm draft={draft} onSaved={onChanged} />
        ) : (
          <div className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">{contentText}</div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-sm font-medium">再生成 (修正指示付き)</p>
        <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="例: もう少しカジュアルなトーンにしてください" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={regenerate} disabled={isBusy}>
            再生成
          </Button>
          <Button variant="destructive" onClick={reject} disabled={isBusy}>
            却下
          </Button>
          <Button onClick={approve} disabled={isBusy}>
            承認
          </Button>
        </div>
      </div>
    </div>
  );
}

/** チャネル別 content の主要フィールドだけを簡易編集するフォーム (JSON全体編集はしない) */
function ManualEditForm({ draft, onSaved }: { draft: DraftRow; onSaved: () => void }) {
  const content = draft.content as Record<string, unknown>;
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (draft.channel === "site_blog" || draft.channel === "note") {
      initial.title = String(content.title ?? "");
      initial.body_md = String(content.body_md ?? "");
    } else if (draft.channel === "instagram") {
      initial.caption = String(content.caption ?? "");
    } else if (draft.channel === "x") {
      const thread = Array.isArray(content.thread) ? (content.thread as Array<{ text: string }>) : [];
      initial.thread_text = thread.map((t) => t.text).join("\n---\n");
    }
    return initial;
  });
  const [isSaving, setIsSaving] = useState(false);

  function buildContent(): unknown {
    if (draft.channel === "site_blog") {
      return { ...content, title: fields.title, body_md: fields.body_md };
    }
    if (draft.channel === "note") {
      return { ...content, title: fields.title, body_md: fields.body_md };
    }
    if (draft.channel === "instagram") {
      return { ...content, caption: fields.caption };
    }
    if (draft.channel === "x") {
      const texts = fields.thread_text.split("\n---\n");
      const existingThread = Array.isArray(content.thread) ? (content.thread as Array<{ media_id: string | null }>) : [];
      return {
        ...content,
        thread: texts.map((text, i) => ({ text, media_id: existingThread[i]?.media_id ?? null })),
      };
    }
    return content;
  }

  async function save() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/ai/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: buildContent() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.message ?? "保存に失敗しました。");
        return;
      }
      toast.success("保存しました (人間編集の新しいrevisionを作成)。");
      onSaved();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {"title" in fields && (
        <Input value={fields.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} placeholder="タイトル" />
      )}
      {"body_md" in fields && (
        <Textarea
          value={fields.body_md}
          onChange={(e) => setFields((f) => ({ ...f, body_md: e.target.value }))}
          className="min-h-40"
        />
      )}
      {"caption" in fields && (
        <Textarea
          value={fields.caption}
          onChange={(e) => setFields((f) => ({ ...f, caption: e.target.value }))}
          className="min-h-32"
        />
      )}
      {"thread_text" in fields && (
        <Textarea
          value={fields.thread_text}
          onChange={(e) => setFields((f) => ({ ...f, thread_text: e.target.value }))}
          className="min-h-32"
          placeholder={"ツイートを --- で区切って入力"}
        />
      )}
      <Button size="sm" onClick={save} disabled={isSaving}>
        {isSaving ? "保存中..." : "保存 (人間編集として記録)"}
      </Button>
    </div>
  );
}
