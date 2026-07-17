"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import type { TaxCategory } from "@/modules/platform/contracts";
import type { DocumentDetail } from "@/modules/sales/contracts";
import { computeDocumentTotals } from "@/modules/sales/tax";

import { reviseAndReissueDocumentAction } from "../actions";
import { TAX_CATEGORY_LABEL, formatJpy } from "../_shared";
import { blankLine, toDocumentLineInput, toLineState, useLineRowKeyboard, type LineState } from "./line-editor-shared";

const NATIVE_SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * 訂正発行ダイアログ (§4.3-B)。§8.3 の明細エディタと同じ行編集ロジック
 * (line-editor-shared.ts) を再利用する「revision モード」。tax_rounding は凍結のため編集項目に
 * 出さない (丸め方式の変更は void + 再発行 — §5.2 zReviseDocumentInput 注記)。
 */
export function RevisionDialog({
  open,
  onOpenChange,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: DocumentDetail;
}) {
  const router = useRouter();
  const doc = detail.document;

  const [billingName, setBillingName] = useState(doc.billing_name);
  const [billingSuffix, setBillingSuffix] = useState<"様" | "御中">(doc.billing_suffix);
  const [billingAddress, setBillingAddress] = useState(doc.billing_address ?? "");
  const [siteName, setSiteName] = useState(doc.site_name ?? "");
  const [siteAddress, setSiteAddress] = useState(doc.site_address ?? "");
  const [issueDate, setIssueDate] = useState<string | null>(doc.issue_date);
  const [transactionDate, setTransactionDate] = useState<string | null>(doc.transaction_date);
  const [validUntil, setValidUntil] = useState<string | null>(doc.valid_until);
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [lines, setLines] = useState<LineState[]>(() => detail.lines.map(toLineState));
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ダイアログは常駐 (open/onOpenChange で可視性のみ切替) するため、useState の初期値は初回マウント
  // 時にしか使われない。同一帳票に対して 2 回目以降の「訂正発行…」を開いたときに前回の訂正内容が
  // 残ったまま (直前の訂正で更新された最新の detail を反映しない) にならないよう、開くたびに
  // 最新の detail から再シードする (payment-dialog.tsx と同型の地雷回避)。
  useEffect(() => {
    if (open) {
      setBillingName(doc.billing_name);
      setBillingSuffix(doc.billing_suffix);
      setBillingAddress(doc.billing_address ?? "");
      setSiteName(doc.site_name ?? "");
      setSiteAddress(doc.site_address ?? "");
      setIssueDate(doc.issue_date);
      setTransactionDate(doc.transaction_date);
      setValidUntil(doc.valid_until);
      setNotes(doc.notes ?? "");
      setLines(detail.lines.map(toLineState));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detail]);

  const totals = useMemo(
    () => computeDocumentTotals(lines.map(toDocumentLineInput), doc.tax_rounding),
    [lines, doc.tax_rounding],
  );

  function updateLine(index: number, patch: Partial<LineState>) {
    setLines((prev) => {
      const next = [...prev];
      const current = { ...next[index], ...patch };
      if (!current._manual && (patch.quantity !== undefined || patch.unit_price_jpy !== undefined)) {
        const qty = Number(current.quantity) || 0;
        const price = Number(current.unit_price_jpy) || 0;
        current.amount_jpy = String(Math.round(qty * price));
      }
      next[index] = current;
      return next;
    });
  }

  // atIndex 省略時は末尾に追加 (「行を追加」ボタンの従来動作)。指定時はその行の直後に挿入
  // (Cmd+Enter — §8.7 — document-editor.tsx の addLine と同型)。
  function addLine(atIndex?: number) {
    setLines((prev) => {
      const blank = blankLine();
      if (atIndex === undefined) return [...prev, blank];
      const next = [...prev];
      next.splice(atIndex + 1, 0, blank);
      return next;
    });
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function moveLine(index: number, direction: -1 | 1) {
    setLines((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  }

  // キーボード操作 (§8.7): document-editor.tsx (draft編集) と同じ共有フック
  // (レビュー地雷回避: 訂正発行ダイアログにキーボードショートカットが未配線だった問題への対応)。
  const { descriptionRefs, handleRowKeyDown } = useLineRowKeyboard({ addLine, removeLine, moveLine });

  async function handleSubmit() {
    if (!issueDate) {
      setError("発行日を入力してください。");
      return;
    }
    if (lines.length === 0) {
      setError("明細を1行以上入力してください。");
      return;
    }
    setIsPending(true);
    setError(null);
    const result = await reviseAndReissueDocumentAction(
      doc.id,
      {
        issue_date: issueDate,
        transaction_date: transactionDate,
        valid_until: doc.doc_type === "quote" ? validUntil : null,
        billing_name: billingName,
        billing_suffix: billingSuffix,
        billing_address: billingAddress.trim() || null,
        site_name: siteName.trim() || null,
        site_address: siteAddress.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map(toDocumentLineInput),
      },
      doc.updated_at,
    );
    setIsPending(false);
    if (!result.ok) {
      setError(result.detail ?? `訂正発行に失敗しました (${result.code})`);
      return;
    }
    onOpenChange(false);
    toast.success(`訂正発行しました (v${result.value.version})。`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl shadow-modal">
        <DialogHeader>
          <DialogTitle>訂正発行</DialogTitle>
          <DialogDescription>内容を修正して新しい版として再発行します (書類番号は維持)。</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rev-billing-name">宛名</FieldLabel>
                <div className="flex gap-2">
                  <Input id="rev-billing-name" value={billingName} onChange={(e) => setBillingName(e.target.value)} maxLength={80} />
                  <select
                    aria-label="敬称"
                    className={NATIVE_SELECT_CLASS}
                    value={billingSuffix}
                    onChange={(e) => setBillingSuffix(e.target.value as "様" | "御中")}
                  >
                    <option value="様">様</option>
                    <option value="御中">御中</option>
                  </select>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="rev-billing-address">宛先住所</FieldLabel>
                <Input id="rev-billing-address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} maxLength={200} />
              </Field>
              <Field>
                <FieldLabel htmlFor="rev-site-name">現場名</FieldLabel>
                <Input id="rev-site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} maxLength={80} />
              </Field>
              <Field>
                <FieldLabel htmlFor="rev-site-address">現場住所</FieldLabel>
                <Input id="rev-site-address" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} maxLength={200} />
              </Field>
              <Field>
                <FieldLabel>発行日</FieldLabel>
                <DatePicker value={issueDate} onChange={setIssueDate} />
              </Field>
              {doc.doc_type === "quote" && (
                <Field>
                  <FieldLabel>有効期限</FieldLabel>
                  <DatePicker value={validUntil} onChange={setValidUntil} />
                </Field>
              )}
              <Field>
                <FieldLabel>取引年月日 (任意)</FieldLabel>
                <DatePicker value={transactionDate} onChange={setTransactionDate} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="rev-notes">備考</FieldLabel>
              <Textarea id="rev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </Field>
          </FieldGroup>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-meta font-bold text-admin-text-label">明細</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => addLine()}>
                行を追加 (Cmd+Enter)
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {lines.map((line, index) => (
                <div
                  key={line._key}
                  onKeyDown={(e) => handleRowKeyDown(e, index)}
                  className="grid grid-cols-[2fr_0.6fr_0.5fr_0.8fr_0.8fr_1fr_auto] items-center gap-1.5"
                >
                  <Input
                    ref={(el) => {
                      descriptionRefs.current[index] = el;
                    }}
                    data-line-col="description"
                    aria-label="品名"
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    maxLength={200}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    aria-label="数量"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  />
                  <Input aria-label="単位" value={line.unit} onChange={(e) => updateLine(index, { unit: e.target.value })} maxLength={10} />
                  <Input
                    type="number"
                    aria-label="単価"
                    value={line.unit_price_jpy}
                    onChange={(e) => updateLine(index, { unit_price_jpy: e.target.value })}
                  />
                  <Input
                    type="number"
                    aria-label="金額"
                    value={line.amount_jpy}
                    onChange={(e) => updateLine(index, { amount_jpy: e.target.value, _manual: true })}
                  />
                  <select
                    aria-label="税区分"
                    className={NATIVE_SELECT_CLASS}
                    value={line.tax_category}
                    onChange={(e) => updateLine(index, { tax_category: e.target.value as TaxCategory })}
                  >
                    {(["standard_10", "reduced_8", "zero", "exempt"] as const).map((c) => (
                      <option key={c} value={c}>
                        {TAX_CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="行を削除" onClick={() => removeLine(index)}>
                    <span aria-hidden>🗑</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm font-medium tabular-nums">合計 {formatJpy(totals.total_jpy)}</p>
        </div>

        <FieldError errors={error ? [{ message: error }] : undefined} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="button" disabled={isPending} onClick={() => void handleSubmit()}>
            {isPending ? "発行中..." : "訂正発行する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
