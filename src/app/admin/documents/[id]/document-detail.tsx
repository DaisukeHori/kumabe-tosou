"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import { FieldError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Surface } from "@/app/admin/_ui";
import type { DocType, DocumentDetail, DocumentListItem } from "@/modules/sales/contracts";

import {
  acceptQuoteAction,
  createPdfUrlAction,
  declineQuoteAction,
  deletePaymentAction,
  deriveDocumentAction,
  reissueDocumentAction,
  voidDocumentAction,
} from "../actions";
import { canGenerateBlocks, DOC_TYPE_LABEL, DocumentStatusBadge, formatJpy } from "../_shared";
import { GenerateBlocksButton } from "../generate-blocks-button";
import { PaymentDialog } from "./payment-dialog";
import { RevisionDialog } from "./revision-dialog";
import { SendEmailDialog } from "./send-email-dialog";
import { VersionDiffDialog } from "./version-diff-dialog";

const DERIVE_LABEL: Record<DocType, string> = {
  quote: "見積にする",
  order: "受注にする",
  delivery: "納品書にする",
  invoice: "請求書にする",
};

// canonical (02-sales.md §4.1/§4.2) の状態機械の一部を UI のボタン活性判定のためだけに写す。
// internal/state.ts (sales モジュール内部) は ESLint モジュール境界により app 層から import できない
// ため、ここは「ボタンを出すかどうか」の表示専用判定に留める — 実際の遷移可否は facade
// (acceptQuote/declineQuote/voidDocument) が session client 側で必ず再検証する (このガードは
// 二重チェックであり、ここが間違っていても不正な遷移が通ることはない)。
function canAccept(docType: DocType, status: string) {
  return docType === "quote" && (status === "issued" || status === "expired");
}
function canDecline(docType: DocType, status: string) {
  return docType === "quote" && status === "issued";
}
function canVoid(docType: DocType, status: string) {
  return status === "issued" || (docType === "quote" && (status === "accepted" || status === "expired"));
}
function canReissue(status: string) {
  return status === "issued" || status === "accepted" || status === "paid";
}
function canRevise(status: string) {
  return status === "issued" || status === "accepted";
}
// canGenerateBlocks (実装計画書 issue-61.md 成果物2) は Issue #96 で `../_shared` へ export
// 移動した (`DealWorkSummaryCard.tsx` からも同一判定を再利用するため — 2 箇所で判定がズレることを
// 防ぐ)。ここでは import して使うのみ。
// issue #101 (02-sales.md §18): メール送付は発行済み系状態のみ (draft は非表示 — facade 直呼びは KMB-E621)。
function canSendEmail(status: string) {
  return status === "issued" || status === "accepted" || status === "paid";
}

export type Lineage = { ancestors: DocumentListItem[]; descendants: DocumentListItem[] };

/**
 * 帳票詳細 (issued 以降) 画面本体 (§8.4)。WorkForm の mode パターン — [id]/page.tsx が
 * document.status !== 'draft' のときだけこのコンポーネントをレンダーする。
 */
export function DocumentDetailView({
  detail,
  dealTitle,
  dealId,
  dealUpdatedAt,
  lineage,
  defaultRecipient,
  customerId,
}: {
  detail: DocumentDetail;
  dealTitle: string;
  dealId: string;
  dealUpdatedAt: string;
  lineage: Lineage;
  /** #101: 顧客の登録 email (未登録は null — SendEmailDialog が警告バナー + 手入力に degrade)。 */
  defaultRecipient: string | null;
  customerId: string;
}) {
  const router = useRouter();
  const doc = detail.document;

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [focusedVersionIndex, setFocusedVersionIndex] = useState(0);
  const [focusedPaymentIndex, setFocusedPaymentIndex] = useState(0);
  const versionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void handleOpenPdf(doc.current_version);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.current_version]);

  async function handleAccept() {
    setIsPending(true);
    setError(null);
    const result = await acceptQuoteAction(doc.id, doc.updated_at);
    setIsPending(false);
    if (!result.ok) {
      setError(result.detail ?? `承諾に失敗しました (${result.code})`);
      return;
    }
    toast.success("見積を承諾にしました。");
    router.refresh();
  }

  async function handleDecline() {
    setIsPending(true);
    const result = await declineQuoteAction(doc.id, declineReason.trim() || null, doc.updated_at);
    setIsPending(false);
    setDeclineOpen(false);
    if (!result.ok) {
      toast.error(result.detail ?? `辞退の記録に失敗しました (${result.code})`);
      return;
    }
    toast.success("見積を辞退にしました。");
    router.refresh();
  }

  async function handleVoid() {
    if (!voidReason.trim()) {
      setError("取消理由を入力してください。");
      return;
    }
    setIsPending(true);
    const result = await voidDocumentAction(doc.id, voidReason.trim(), doc.updated_at);
    setIsPending(false);
    setVoidOpen(false);
    if (!result.ok) {
      toast.error(result.detail ?? `取消に失敗しました (${result.code})`);
      return;
    }
    toast.success("取消しました。");
    router.refresh();
  }

  async function handleReissue() {
    setIsPending(true);
    const result = await reissueDocumentAction(doc.id, doc.updated_at);
    setIsPending(false);
    if (!result.ok) {
      toast.error(result.detail ?? `再出力に失敗しました (${result.code})`);
      return;
    }
    toast.success(`再出力しました (v${result.value.version})。`);
    router.refresh();
  }

  async function handleDerive(to: DocType) {
    setIsPending(true);
    const result = await deriveDocumentAction({ source_document_id: doc.id, to_type: to });
    setIsPending(false);
    if (!result.ok) {
      toast.error(result.detail ?? `作成に失敗しました (${result.code})`);
      return;
    }
    router.push(`/admin/documents/${result.value.document_id}`);
  }

  async function handleOpenPdf(version: number) {
    const result = await createPdfUrlAction(doc.id, version);
    if (!result.ok) {
      toast.error(result.detail ?? `PDF の取得に失敗しました (${result.code})`);
      return;
    }
    window.open(result.value.url, "_blank", "noopener,noreferrer");
  }

  async function handleDeletePayment(paymentId: string) {
    const result = await deletePaymentAction(paymentId, doc.id);
    if (!result.ok) {
      toast.error(result.detail ?? `削除に失敗しました (${result.code})`);
      return;
    }
    toast.success("入金記録を削除しました。残高に反映されます。");
    router.refresh();
  }

  function handleVersionsKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedVersionIndex((i) => Math.min(i + 1, detail.versions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedVersionIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const v = detail.versions[focusedVersionIndex];
      if (v) void handleOpenPdf(v.version);
    }
  }

  function handlePaymentsKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedPaymentIndex((i) => Math.min(i + 1, detail.payments.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedPaymentIndex((i) => Math.max(i - 1, 0));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Surface className="flex flex-col gap-2 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{doc.doc_no ?? DOC_TYPE_LABEL[doc.doc_type]}</h1>
          <DocumentStatusBadge status={doc.status} />
          <Badge variant="outline">{DOC_TYPE_LABEL[doc.doc_type]}</Badge>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            宛名: <span className="text-foreground">{doc.billing_name}{doc.billing_suffix}</span>
          </span>
          <span>
            案件:{" "}
            <Link href={`/admin/deals/${dealId}`} className="text-foreground underline underline-offset-4">
              {dealTitle}
            </Link>
          </span>
          <span>
            金額: <span className="text-foreground">{formatJpy(doc.total_jpy)}</span>
          </span>
          <span>発行日: <span className="text-foreground">{doc.issue_date ?? "—"}</span></span>
          {doc.doc_type === "invoice" && (
            <span>
              残高: <span className="text-foreground font-medium">{formatJpy(detail.balance_jpy)}</span>
            </span>
          )}
        </div>

        {(lineage.ancestors.length > 0 || lineage.descendants.length > 0) && (
          <nav aria-label="系譜" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {lineage.ancestors.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5">
                <Link href={`/admin/documents/${a.id}`} className="underline underline-offset-4">
                  {a.doc_no ?? DOC_TYPE_LABEL[a.doc_type]}
                </Link>
                <span aria-hidden>→</span>
              </span>
            ))}
            <span className="font-medium text-foreground">{doc.doc_no ?? "(このドキュメント)"}</span>
            {lineage.descendants.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5">
                <span aria-hidden>→</span>
                <Link href={`/admin/documents/${d.id}`} className="underline underline-offset-4">
                  {d.doc_no ?? DOC_TYPE_LABEL[d.doc_type]}
                </Link>
              </span>
            ))}
          </nav>
        )}
      </Surface>

      <div className="flex flex-wrap gap-2">
        {canAccept(doc.doc_type, doc.status) && (
          <Button type="button" disabled={isPending} onClick={() => void handleAccept()}>
            承諾にする
          </Button>
        )}
        {canDecline(doc.doc_type, doc.status) && (
          <Button type="button" variant="outline" onClick={() => setDeclineOpen(true)}>
            辞退にする
          </Button>
        )}
        {detail.derivable_to.map((to) => (
          <Button key={to} type="button" variant="outline" disabled={isPending} onClick={() => void handleDerive(to)}>
            {DERIVE_LABEL[to]}
          </Button>
        ))}
        {canGenerateBlocks(doc.doc_type, doc.status) && (
          <GenerateBlocksButton documentId={doc.id} dealId={dealId} />
        )}
        {doc.doc_type === "invoice" && doc.status === "issued" && (
          <Button type="button" onClick={() => setPaymentOpen(true)}>
            入金を記録
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => void handleOpenPdf(doc.current_version)}>
          PDF を開く (Cmd/Ctrl+P)
        </Button>
        {canSendEmail(doc.status) && (
          <Button type="button" variant="outline" onClick={() => setSendEmailOpen(true)}>
            メールで送付
          </Button>
        )}
        {canReissue(doc.status) && (
          <Button type="button" variant="outline" disabled={isPending} onClick={() => void handleReissue()}>
            再出力 (版+1)
          </Button>
        )}
        {canRevise(doc.status) && (
          <Button type="button" variant="outline" onClick={() => setRevisionOpen(true)}>
            訂正発行…
          </Button>
        )}
        {canVoid(doc.doc_type, doc.status) && (
          <Button type="button" variant="destructive" onClick={() => setVoidOpen(true)}>
            取消
          </Button>
        )}
      </div>

      <FieldError errors={error ? [{ message: error }] : undefined} />

      <Surface className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">版履歴</h2>
          {detail.versions.length >= 2 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setDiffOpen(true)}>
              前の版と比較
            </Button>
          )}
        </div>
        {detail.versions.length === 0 && <p className="text-sm text-muted-foreground">版がありません。</p>}
        {detail.versions.length > 0 && (
          <div
            ref={versionsRef}
            role="listbox"
            aria-label="版履歴"
            tabIndex={0}
            onKeyDown={handleVersionsKeyDown}
            className="flex flex-col divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            {detail.versions.map((v, index) => (
              <div
                key={v.issued_document_id}
                role="option"
                aria-selected={index === focusedVersionIndex}
                onClick={() => void handleOpenPdf(v.version)}
                onMouseEnter={() => setFocusedVersionIndex(index)}
                className={`grid cursor-pointer grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-2 py-2 text-xs ${index === focusedVersionIndex ? "bg-soul/5" : ""}`}
              >
                <span className="font-medium">v{v.version}</span>
                <span className="text-muted-foreground">{new Date(v.issued_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
                <span className="text-muted-foreground">{v.sha256.slice(0, 8)}</span>
                <span className="underline underline-offset-4">PDF</span>
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Surface className="p-6">
        <h2 className="mb-3 text-sm font-medium">送信履歴</h2>
        {detail.emails.length === 0 && <p className="text-sm text-muted-foreground">送信履歴がありません。</p>}
        {detail.emails.length > 0 && (
          <div className="flex flex-col divide-y divide-border">
            {detail.emails.map((e) => (
              <div key={e.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-2 py-2 text-xs">
                <span className="text-muted-foreground">
                  {new Date(e.sent_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </span>
                <span className="truncate">
                  {e.to_email} — {e.subject}
                </span>
                <span className="font-medium">v{e.version}</span>
                <Badge variant={e.status === "failed" ? "destructive" : "outline"}>
                  {e.status === "failed" ? "失敗" : "送信済み"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Surface>

      {doc.doc_type === "invoice" && (
        <Surface className="p-6">
          <h2 className="mb-3 text-sm font-medium">入金履歴</h2>
          {detail.payments.length === 0 && <p className="text-sm text-muted-foreground">入金記録がありません。</p>}
          {detail.payments.length > 0 && (
            <div
              role="listbox"
              aria-label="入金履歴"
              tabIndex={0}
              onKeyDown={handlePaymentsKeyDown}
              className="flex flex-col divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              {detail.payments.map((p, index) => (
                <div
                  key={p.id}
                  role="option"
                  aria-selected={index === focusedPaymentIndex}
                  onMouseEnter={() => setFocusedPaymentIndex(index)}
                  className={`grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-3 px-2 py-2 text-xs ${index === focusedPaymentIndex ? "bg-soul/5" : ""}`}
                >
                  <span>{p.paid_on}</span>
                  <span className="font-medium">{formatJpy(p.amount_jpy)}</span>
                  <span className="text-muted-foreground">{{ bank_transfer: "振込", cash: "現金", other: "その他" }[p.method]}</span>
                  <span className="truncate text-muted-foreground">{p.memo ?? ""}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void handleDeletePayment(p.id)}>
                    削除
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Surface>
      )}

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>見積を辞退にしますか</DialogTitle>
            <DialogDescription>理由は任意です。</DialogDescription>
          </DialogHeader>
          <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} maxLength={500} placeholder="理由 (任意)" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeclineOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" disabled={isPending} onClick={() => void handleDecline()}>
              辞退にする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消しますか</DialogTitle>
            <DialogDescription>取消理由は必須です。この操作は元に戻せません。</DialogDescription>
          </DialogHeader>
          <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={500} placeholder="取消理由 (必須)" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVoidOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => void handleVoid()}>
              取消する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        documentId={doc.id}
        dealId={dealId}
        dealUpdatedAt={dealUpdatedAt}
        balanceJpy={detail.balance_jpy}
      />

      <RevisionDialog open={revisionOpen} onOpenChange={setRevisionOpen} detail={detail} />

      <VersionDiffDialog open={diffOpen} onOpenChange={setDiffOpen} documentId={doc.id} versions={detail.versions} />

      <SendEmailDialog
        open={sendEmailOpen}
        onOpenChange={setSendEmailOpen}
        documentId={doc.id}
        detail={detail}
        defaultRecipient={defaultRecipient}
        customerId={customerId}
      />
    </div>
  );
}
