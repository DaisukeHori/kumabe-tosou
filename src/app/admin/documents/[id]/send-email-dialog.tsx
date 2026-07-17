"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NoticePanel } from "@/app/admin/_ui";
import type { DocumentDetail } from "@/modules/sales/contracts";

import { sendDocumentEmailAction } from "../actions";
import { DOC_TYPE_LABEL } from "../_shared";

/** 既定件名 (issue-101 設計): 「【{issuer_name}】{帳票種別}のご送付 ({doc_no})」 */
function buildDefaultSubject(detail: DocumentDetail): string {
  const issuerName = detail.document.issuer_snapshot?.issuer_name ?? null;
  const prefix = issuerName ? `【${issuerName}】` : "";
  return `${prefix}${DOC_TYPE_LABEL[detail.document.doc_type]}のご送付 (${detail.document.doc_no ?? ""})`;
}

/** 既定本文 (issue-101 設計): 宛名の挨拶 + 帳票案内 + issuer 署名 */
function buildDefaultBody(detail: DocumentDetail): string {
  const doc = detail.document;
  const issuerName = doc.issuer_snapshot?.issuer_name ?? "";
  return [
    `${doc.billing_name} ${doc.billing_suffix}`,
    "",
    "いつもお世話になっております。",
    `${DOC_TYPE_LABEL[doc.doc_type]} (${doc.doc_no ?? ""}) をお送りいたします。添付の PDF をご確認ください。`,
    "",
    "ご不明な点がございましたら、お気軽にお問い合わせください。",
    "",
    issuerName,
  ].join("\n");
}

function attachmentFilename(detail: DocumentDetail): string {
  const doc = detail.document;
  return `${DOC_TYPE_LABEL[doc.doc_type]}_${doc.doc_no ?? ""}_v${doc.current_version}.pdf`;
}

/**
 * 帳票メール送付ダイアログ (issue #101 — 02-sales.md §18)。payment-dialog.tsx と同型の Dialog。
 * defaultRecipient=null (顧客に email 未登録) は警告バナー + 宛先手入力で送信可に degrade する
 * (facade 側の E621/E623 等のハードエラーとは扱いを分ける — UI 層の案内のみ)。
 * キーボード: Esc 閉じる (Dialog 標準) / Cmd(Ctrl)+Enter 送信。
 */
export function SendEmailDialog({
  open,
  onOpenChange,
  documentId,
  detail,
  defaultRecipient,
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  detail: DocumentDetail;
  defaultRecipient: string | null;
  customerId: string;
}) {
  const router = useRouter();
  const [to, setTo] = useState(defaultRecipient ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(() => buildDefaultSubject(detail));
  const [body, setBody] = useState(() => buildDefaultBody(detail));
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ダイアログは常駐 (open/onOpenChange で可視性のみ切替) のため、開くたびに最新の既定値で
  // 再シードする (PaymentDialog の balanceJpy 再シードと同じ地雷回避)。
  useEffect(() => {
    if (open) {
      setTo(defaultRecipient ?? "");
      setCc("");
      setSubject(buildDefaultSubject(detail));
      setBody(buildDefaultBody(detail));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultRecipient, detail.document.id, detail.document.current_version]);

  async function handleSubmit() {
    if (!to.trim()) {
      setError("宛先を入力してください。");
      return;
    }
    setIsPending(true);
    setError(null);
    const result = await sendDocumentEmailAction(documentId, {
      to: to.trim(),
      cc: cc.trim() || null,
      subject: subject.trim(),
      body,
      version: detail.document.current_version,
    });
    setIsPending(false);
    if (!result.ok) {
      setError(result.detail ?? `送信に失敗しました (${result.code})`);
      return;
    }
    onOpenChange(false);
    toast.success("メールを送信しました。");
    router.refresh();
  }

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSubmit();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, to, cc, subject, body]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] shadow-modal">
        <DialogHeader>
          <DialogTitle>メールで送付</DialogTitle>
          <DialogDescription>現行版 (v{detail.document.current_version}) の PDF を添付して送信します。</DialogDescription>
        </DialogHeader>

        {defaultRecipient === null && (
          <NoticePanel tone="warning">
            顧客にメールアドレスが未登録です。宛先を直接入力するか、
            <Link href={`/admin/customers/${customerId}`}>顧客情報を編集する</Link>
          </NoticePanel>
        )}

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="send-email-to">宛先</FieldLabel>
            <Input
              id="send-email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@example.com"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="send-email-cc">CC (任意)</FieldLabel>
            <Input id="send-email-cc" type="email" value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="send-email-subject">件名</FieldLabel>
            <Input
              id="send-email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="send-email-body">本文</FieldLabel>
            <Textarea
              id="send-email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-40"
              maxLength={5000}
            />
          </Field>
          <Field>
            <FieldLabel>添付 (現行版・読み取り専用)</FieldLabel>
            <p className="text-sm text-muted-foreground">{attachmentFilename(detail)}</p>
          </Field>
        </FieldGroup>

        <FieldError errors={error ? [{ message: error }] : undefined} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル (Esc)
          </Button>
          <Button type="button" disabled={isPending} onClick={() => void handleSubmit()}>
            {isPending ? "送信中..." : "送信する (Cmd/Ctrl+Enter)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
