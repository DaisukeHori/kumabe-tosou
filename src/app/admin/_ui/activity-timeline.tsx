"use client";

import { useState } from "react";
import Link from "next/link";
import type { z } from "zod";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CalculatorIcon,
  CheckSquareIcon,
  FileTextIcon,
  HammerIcon,
  InboxIcon,
  InfoIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  TrashIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Surface } from "@/app/admin/_ui/surface";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCustomersAction, searchDealsAction } from "@/app/admin/_ui/entity-search-actions";
import { cn } from "@/lib/utils";
import {
  INQUIRY_TYPE_LABEL,
  zCallActivityPayload,
  zEmailActivityPayload,
  zFormSubmissionActivityPayload,
  zSimulatorEstimateActivityPayload,
  zSystemActivityPayload,
  zTaskEventActivityPayload,
  zWorkLogActivityPayload,
  type DocumentEventActivityPayload,
  type TimelineItem,
  type TimelineTarget,
} from "@/modules/crm/contracts";

import {
  addNoteAction,
  deleteNoteAction,
  loadMoreTimelineAction,
  relinkNoteAction,
  updateNoteAction,
} from "./timeline-actions";

type CallPayload = z.infer<typeof zCallActivityPayload>;
type EmailPayload = z.infer<typeof zEmailActivityPayload>;
type FormSubmissionPayload = z.infer<typeof zFormSubmissionActivityPayload>;
type SimulatorEstimatePayload = z.infer<typeof zSimulatorEstimateActivityPayload>;
type WorkLogPayload = z.infer<typeof zWorkLogActivityPayload>;
type TaskEventPayload = z.infer<typeof zTaskEventActivityPayload>;
type SystemPayload = z.infer<typeof zSystemActivityPayload>;

const jpy = new Intl.NumberFormat("ja-JP");

function formatDateHeading(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s}秒`;
}

/**
 * ISO 日時 → JST 暦日 (YYYY-MM-DD)。date-picker.tsx と同じ「+9h してから UTC 成分を読む」方式
 * (internal/jst.ts と同じアルゴリズムだが、crm/internal は UI から import 不可 — MODULES 境界 —
 * のためここでも純粋な数値計算として再実装する)。`toISOString().slice(0,10)` を直接使うと
 * UTC 変換で JST の日付がずれる地雷を踏むため、必ずこの関数を経由すること。
 */
function isoToJstDateOnly(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** note 編集ボックスのタイトル自動導出 (deriveNoteTitle と同じ規則の再実装 — facade はサーバー
 *  専用モジュールのためクライアントコンポーネントから import できない。§6.6 末尾規則: 本文
 *  1 行目の先頭 60 字、空なら「メモ」)。 */
function deriveNoteTitleLocal(body: string): string {
  const firstLine = body.split(/\r\n|\r|\n/)[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) return "メモ";
  return trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed;
}

const DOC_TYPE_LABEL: Record<DocumentEventActivityPayload["doc_type"], string> = {
  quote: "見積書",
  order: "受注書",
  delivery: "納品書",
  invoice: "請求書",
};
const DOC_EVENT_LABEL: Record<DocumentEventActivityPayload["event"], string> = {
  issued: "発行",
  reissued: "再発行",
  accepted: "承諾",
  declined: "却下",
  expired: "期限切れ",
  paid: "完済",
  payment_recorded: "入金記録",
  voided: "取消",
};

function ActivityIcon({ type }: { type: TimelineItem["activity_type"] }) {
  const cls = "size-4 shrink-0 text-muted-foreground";
  switch (type) {
    case "note":
      return <PencilIcon className={cls} />;
    case "call":
      return <PhoneIcon className={cls} />;
    case "email":
      return <MailIcon className={cls} />;
    case "form_submission":
      return <InboxIcon className={cls} />;
    case "simulator_estimate":
      return <CalculatorIcon className={cls} />;
    case "document_event":
      return <FileTextIcon className={cls} />;
    case "work_log":
      return <HammerIcon className={cls} />;
    case "task_event":
      return <CheckSquareIcon className={cls} />;
    case "system":
    default:
      return <InfoIcon className={cls} />;
  }
}

/**
 * activity_type 別レンダラ (01-crm.md §8.5)。payload は facade (listTimeline) で parse 済み。
 * TimelineItem.payload は判別共用体として型付けされていないため、activity_type で分岐した後は
 * 対応する Zod スキーマの infer 型へ明示キャスト (any は使わない — 契約書のスキーマそのものから
 * 導出した具体型のみ)。ref_table は未知の値でも安全に無視する (R3 — リンクなし表示に degrade)。
 */
function ActivityBody({ item }: { item: TimelineItem }) {
  if (item.payload_error !== null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <AlertTriangleIcon className="size-4 shrink-0" />
        表示できない記録 (KMB-E604)
      </div>
    );
  }

  switch (item.activity_type) {
    case "note":
      return item.body ? <p className="whitespace-pre-wrap text-sm">{item.body}</p> : null;

    case "call": {
      const p = item.payload as CallPayload;
      return (
        <div className="text-sm">
          <p>
            {p.direction === "inbound" ? "着信" : "発信"} / {formatDuration(p.duration_seconds)}
            {p.has_recording && (
              <Badge variant="outline" className="ml-2">
                録音あり
              </Badge>
            )}
          </p>
          {p.summary && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.summary}</p>}
          {item.ref_id && (
            <Link href="/admin/calls" className="mt-1 inline-block text-xs underline underline-offset-4">
              通話詳細へ →
            </Link>
          )}
        </div>
      );
    }

    case "form_submission": {
      const p = item.payload as FormSubmissionPayload;
      return (
        <div className="text-sm">
          <p>
            <Badge variant="outline">{INQUIRY_TYPE_LABEL[p.inquiry_type]}</Badge>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.excerpt}</p>
          <Link href="/admin/inquiries" className="mt-1 inline-block text-xs underline underline-offset-4">
            問い合わせ一覧へ →
          </Link>
        </div>
      );
    }

    case "simulator_estimate": {
      const p = item.payload as SimulatorEstimatePayload;
      const e = p.estimate;
      return (
        <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
          <p>
            {e.grade_label} / {e.size_label} / {e.quantity} 個
          </p>
          <p className="mt-1 text-muted-foreground">
            概算: {e.quote_only ? "個別見積" : `¥${jpy.format(e.total_min)} 〜 ¥${jpy.format(e.total_max)}`}
          </p>
          {p.price_note && <p className="mt-1 text-xs text-muted-foreground">{p.price_note}</p>}
        </div>
      );
    }

    case "document_event": {
      const p = item.payload as DocumentEventActivityPayload;
      return (
        <div className="text-sm">
          <p>
            {DOC_TYPE_LABEL[p.doc_type]} {p.doc_no} — {DOC_EVENT_LABEL[p.event]}
          </p>
          <p className="mt-1 text-muted-foreground">¥{jpy.format(p.total_jpy)}</p>
          <Link href="/admin/documents" className="mt-1 inline-block text-xs underline underline-offset-4">
            帳票詳細へ →
          </Link>
        </div>
      );
    }

    case "work_log": {
      const p = item.payload as WorkLogPayload;
      return (
        <div className="text-sm">
          <p>{p.work_type_label}</p>
          <p className="mt-1 text-muted-foreground">
            予定 {p.planned_hours}h / 実績 {p.actual_hours}h ({p.performed_on})
          </p>
        </div>
      );
    }

    case "task_event": {
      const p = item.payload as TaskEventPayload;
      const eventLabel = p.event === "created" ? "作成" : p.event === "completed" ? "完了" : "取消";
      return (
        <div className="text-sm">
          <p>
            {item.title} ({eventLabel})
          </p>
          <Link href="/admin/tasks" className="mt-1 inline-block text-xs underline underline-offset-4">
            やること一覧へ →
          </Link>
        </div>
      );
    }

    case "system": {
      const p = item.payload as SystemPayload;
      const isWarning = p.code === "lead.intake.ambiguous";
      return (
        <div
          className={cn(
            "text-sm",
            isWarning && "rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-400",
          )}
        >
          <p>{item.title}</p>
          {p.detail && <p className="mt-1 text-muted-foreground">{p.detail}</p>}
        </div>
      );
    }

    case "email": {
      const p = item.payload as EmailPayload;
      return (
        <div className="text-sm">
          <p>
            {p.direction === "outbound" ? "送信" : "受信"}
            {p.to && <span className="text-muted-foreground"> — 宛先 {p.to}</span>}
          </p>
          <p className="mt-1 text-muted-foreground">{p.subject}</p>
          {p.document_id && (
            <Link
              href={`/admin/documents/${p.document_id}`}
              className="mt-1 inline-block text-xs underline underline-offset-4"
            >
              帳票詳細へ →
            </Link>
          )}
        </div>
      );
    }

    default:
      return <p className="text-sm text-muted-foreground">{item.title}</p>;
  }
}

function NoteEditor({
  target,
  item,
  onDone,
}: {
  target: TimelineTarget;
  item: TimelineItem;
  onDone: (nextUpdatedAt: string | null) => void;
}) {
  const [body, setBody] = useState(item.body ?? "");
  const [occurredAt, setOccurredAt] = useState(isoToJstDateOnly(item.occurred_at));
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    const occurredAtIso = new Date(`${occurredAt}T00:00:00+09:00`).toISOString();
    const result = await updateNoteAction(
      target,
      item.id,
      { title: deriveNoteTitleLocal(body), body, occurred_at: occurredAtIso },
      item.updated_at,
    );
    setIsSaving(false);
    if (!result.ok) {
      if (result.code === "KMB-E103") {
        toast.error("他の操作でこのメモが更新されています。ページを再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "保存に失敗しました。");
      }
      return;
    }
    toast.success("メモを更新しました。");
    onDone(null);
  }

  useSaveShortcut(() => void handleSave(), true);

  return (
    <div className="flex flex-col gap-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24" autoFocus />
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker value={occurredAt} onChange={(v) => setOccurredAt(v ?? occurredAt)} className="w-40" />
        <Button type="button" size="sm" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? "保存中..." : "保存 (Cmd+S)"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(null)}>
          キャンセル (Esc)
        </Button>
      </div>
    </div>
  );
}

function RelinkDialog({
  target,
  item,
  open,
  onOpenChange,
  onDone,
}: {
  target: TimelineTarget;
  item: TimelineItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"customer" | "deal">("customer_id" in target ? "customer" : "deal");
  const [picked, setPicked] = useState<EntityPickerItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleConfirm() {
    if (!picked) return;
    setIsSaving(true);
    const newTarget: TimelineTarget = kind === "customer" ? { customer_id: picked.id } : { deal_id: picked.id };
    const result = await relinkNoteAction(item.id, newTarget, [target, newTarget]);
    setIsSaving(false);
    if (!result.ok) {
      toast.error(result.detail ?? "付け替えに失敗しました。");
      return;
    }
    toast.success("リンク先を付け替えました。");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>メモのリンク先を付け替える</DialogTitle>
          <DialogDescription>このメモを別の顧客/案件に付け替えます (現在のリンクは置き換えられます)。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === "customer" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setKind("customer");
                setPicked(null);
              }}
            >
              顧客
            </Button>
            <Button
              type="button"
              variant={kind === "deal" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setKind("deal");
                setPicked(null);
              }}
            >
              案件
            </Button>
          </div>
          <EntityPicker
            value={picked}
            onChange={setPicked}
            search={kind === "customer" ? searchCustomersAction : searchDealsAction}
            placeholder={kind === "customer" ? "顧客を検索" : "案件を検索"}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="button" disabled={!picked || isSaving} onClick={() => void handleConfirm()}>
            {isSaving ? "処理中..." : "付け替える"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityTimeline({
  target,
  initialItems,
  initialNextCursor,
}: {
  target: TimelineTarget;
  initialItems: TimelineItem[];
  initialNextCursor: string | null;
}) {
  const [items, setItems] = useState<TimelineItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [noteBody, setNoteBody] = useState("");
  const [noteOccurredAt, setNoteOccurredAt] = useState<string>(() => isoToJstDateOnly(new Date().toISOString()));
  const [isAddingNote, setIsAddingNote] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingItem, setDeletingItem] = useState<TimelineItem | null>(null);
  const [relinkingItem, setRelinkingItem] = useState<TimelineItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleAddNote() {
    if (noteBody.trim() === "") {
      toast.error("メモの本文を入力してください。");
      return;
    }
    setIsAddingNote(true);
    const occurredAtIso = new Date(`${noteOccurredAt}T00:00:00+09:00`).toISOString();
    const result = await addNoteAction({ target, body: noteBody, occurred_at: occurredAtIso });
    setIsAddingNote(false);
    if (!result.ok) {
      toast.error(result.detail ?? "メモの追加に失敗しました。");
      return;
    }
    toast.success("メモを追加しました。");
    setNoteBody("");
    const refreshed = await loadMoreTimelineAction(target, null);
    if (refreshed.ok) {
      setItems(refreshed.value.items);
      setNextCursor(refreshed.value.next_cursor);
    }
  }

  useSaveShortcut(() => void handleAddNote(), editingId === null);

  async function handleLoadMore() {
    setIsLoadingMore(true);
    const result = await loadMoreTimelineAction(target, nextCursor);
    setIsLoadingMore(false);
    if (!result.ok) {
      toast.error(result.detail ?? "追加読み込みに失敗しました。");
      return;
    }
    setItems((prev) => [...prev, ...result.value.items]);
    setNextCursor(result.value.next_cursor);
  }

  async function handleDelete() {
    if (!deletingItem) return;
    setIsDeleting(true);
    const result = await deleteNoteAction(target, deletingItem.id);
    setIsDeleting(false);
    if (!result.ok) {
      toast.error(result.detail ?? "削除に失敗しました。");
      return;
    }
    toast.success("メモを削除しました。");
    setItems((prev) => prev.filter((i) => i.id !== deletingItem.id));
    setDeletingItem(null);
  }

  // occurred_at 降順 (facade が既にその順で返す) をそのまま JST 日付見出しでグルーピングする。
  const groups: Array<{ heading: string; items: TimelineItem[] }> = [];
  for (const item of items) {
    const heading = formatDateHeading(item.occurred_at);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.items.push(item);
    else groups.push({ heading, items: [item] });
  }

  return (
    <div className="flex flex-col gap-4">
      <Surface className="flex flex-col gap-2 p-3">
        <Textarea
          placeholder="メモを入力 (1 行目がタイトルになります)"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          className="min-h-20"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DatePicker value={noteOccurredAt} onChange={(v) => setNoteOccurredAt(v ?? noteOccurredAt)} className="w-40" />
          <Button type="button" size="sm" disabled={isAddingNote} onClick={() => void handleAddNote()}>
            {isAddingNote ? "追加中..." : "メモを追加 (Cmd+S)"}
          </Button>
        </div>
      </Surface>

      {items.length === 0 && <p className="text-sm text-muted-foreground">まだ記録がありません。</p>}

      {groups.map((group) => (
        <div key={group.heading} className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">{group.heading}</p>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <Surface key={item.id} className="p-3">
                {editingId === item.id ? (
                  <NoteEditor
                    target={target}
                    item={item}
                    onDone={() => {
                      setEditingId(null);
                      void loadMoreTimelineAction(target, null).then((r) => {
                        if (r.ok) {
                          setItems(r.value.items);
                          setNextCursor(r.value.next_cursor);
                        }
                      });
                    }}
                  />
                ) : (
                  <div className="flex items-start gap-2.5">
                    <ActivityIcon type={item.activity_type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(item.occurred_at)}</span>
                      </div>
                      <div className="mt-1">
                        <ActivityBody item={item} />
                      </div>
                    </div>
                    {item.editable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" />}>
                          <span aria-hidden>⋯</span>
                          <span className="sr-only">操作</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingId(item.id)}>
                            <PencilIcon /> 編集
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRelinkingItem(item)}>
                            リンク先を変更
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeletingItem(item)}>
                            <TrashIcon /> 削除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </Surface>
            ))}
          </div>
        </div>
      ))}

      {nextCursor && (
        <Button type="button" variant="outline" disabled={isLoadingMore} onClick={() => void handleLoadMore()}>
          {isLoadingMore ? "読み込み中..." : "さらに読み込む"}
        </Button>
      )}

      <Dialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>メモを削除しますか</DialogTitle>
            <DialogDescription>この操作は取り消せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingItem(null)}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" disabled={isDeleting} onClick={() => void handleDelete()}>
              {isDeleting ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {relinkingItem && (
        <RelinkDialog
          target={target}
          item={relinkingItem}
          open={!!relinkingItem}
          onOpenChange={(open) => !open && setRelinkingItem(null)}
          onDone={() => {
            setRelinkingItem(null);
            void loadMoreTimelineAction(target, null).then((r) => {
              if (r.ok) {
                setItems(r.value.items);
                setNextCursor(r.value.next_cursor);
              }
            });
          }}
        />
      )}
    </div>
  );
}
