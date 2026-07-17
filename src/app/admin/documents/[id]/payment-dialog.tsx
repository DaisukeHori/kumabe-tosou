"use client";

import { useEffect, useState } from "react";
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
import { updateDealStageAction } from "@/app/admin/deals/actions";
import type { PaymentInput } from "@/modules/sales/contracts";

import { recordPaymentAction } from "../actions";
import { formatJpy } from "../_shared";

const NATIVE_SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function jstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/**
 * 入金記録ダイアログ (§8.5)。完済到達時は「入金済みになりました」トースト + 案件ステージの
 * **確認ダイアログ** (§7.1-2 v1.1 — paid は終端で undo 不可のため自動適用しない)。
 * E625 (残高超過) はダイアログ内インラインエラー。
 */
export function PaymentDialog({
  open,
  onOpenChange,
  documentId,
  dealId,
  dealUpdatedAt,
  balanceJpy,
  docNo,
  targetName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  dealId: string;
  /** 案件の現在の updated_at (楽観排他)。ページ描画時点の値 — 完済確認ダイアログの
   *  updateDealStageAction 呼び出しに使う。 */
  dealUpdatedAt: string;
  balanceJpy: number;
  /** 入金対象の書類番号 (任意)。一覧起動時など、開いた時点でどの書類に記録するか目視確認するための表示。 */
  docNo?: string | null;
  /** 入金対象の請求先/宛名 (任意)。docNo と併せて対象書類を識別するための表示。 */
  targetName?: string;
}) {
  const router = useRouter();
  const [paidOn, setPaidOn] = useState<string | null>(jstToday());
  const [amount, setAmount] = useState(String(Math.max(balanceJpy, 0)));
  const [method, setMethod] = useState<PaymentInput["method"]>("bank_transfer");
  const [memo, setMemo] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paidConfirmOpen, setPaidConfirmOpen] = useState(false);
  const [isApplyingPaidStage, setIsApplyingPaidStage] = useState(false);

  // ダイアログはアンマウントされず (open/onOpenChange で可視性のみ切替) 常駐するため、useState の
  // 初期値は初回マウント時にしか使われない。§8.5「金額 (既定=残高プリフィル)」を毎回再現するには
  // 開くたびに最新の balanceJpy 等で再シードする必要がある (地雷: T9 の「部分入金→完済」のように
  // 同一ダイアログを連続して開く操作で、2 回目に古い残高が既定表示されるバグを防ぐ)。
  useEffect(() => {
    if (open) {
      setPaidOn(jstToday());
      setAmount(String(Math.max(balanceJpy, 0)));
      setMethod("bank_transfer");
      setMemo("");
      setError(null);
    }
  }, [open, balanceJpy]);

  async function handleSubmit() {
    if (!paidOn) {
      setError("入金日を入力してください。");
      return;
    }
    const amountJpy = Number(amount);
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      setError("金額は1円以上で入力してください。");
      return;
    }

    setIsPending(true);
    setError(null);
    const result = await recordPaymentAction({
      document_id: documentId,
      paid_on: paidOn,
      amount_jpy: Math.round(amountJpy),
      method,
      memo: memo.trim() || null,
    });
    setIsPending(false);
    if (!result.ok) {
      setError(result.detail ?? `入金の記録に失敗しました (${result.code})`);
      return;
    }

    onOpenChange(false);
    if (result.value.invoice_paid) {
      toast.success("入金済みになりました。");
      setPaidConfirmOpen(true);
    } else {
      const newBalance = balanceJpy - Math.round(amountJpy);
      toast.success(`入金を記録しました (残高 ${formatJpy(Math.max(newBalance, 0))})`);
      router.refresh();
    }
  }

  async function handleConfirmPaidStage() {
    setIsApplyingPaidStage(true);
    const result = await updateDealStageAction(dealId, "paid", dealUpdatedAt);
    setIsApplyingPaidStage(false);
    setPaidConfirmOpen(false);
    if (!result.ok) {
      toast.error(result.detail ?? "案件のステージ変更に失敗しました。入金記録自体は保存済みです。");
    } else {
      toast.success("案件を『入金済み』にしました。");
    }
    router.refresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px] shadow-modal">
          <DialogHeader>
            <DialogTitle>入金を記録</DialogTitle>
            <DialogDescription>残高 {formatJpy(balanceJpy)} に対する入金を記録します。</DialogDescription>
            {(docNo != null || (targetName != null && targetName !== "")) && (
              <p className="text-sm text-muted-foreground" data-payment-target>
                対象:{" "}
                <span className="font-medium text-foreground">{docNo ?? "（番号未確定）"}</span>
                {targetName ? <span className="text-foreground"> — {targetName}</span> : null}
              </p>
            )}
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>入金日</FieldLabel>
              <DatePicker value={paidOn} onChange={setPaidOn} />
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-amount">金額</FieldLabel>
              <Input id="payment-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-method">方法</FieldLabel>
              <select
                id="payment-method"
                className={NATIVE_SELECT_CLASS}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentInput["method"])}
              >
                <option value="bank_transfer">振込</option>
                <option value="cash">現金</option>
                <option value="other">その他</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-memo">メモ (任意)</FieldLabel>
              <Textarea
                id="payment-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={200}
                placeholder="複数請求への一括振込を分割記録する場合は出所をここに"
              />
            </Field>
          </FieldGroup>
          <FieldError errors={error ? [{ message: error }] : undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="button" disabled={isPending} onClick={() => void handleSubmit()}>
              {isPending ? "記録中..." : "記録する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paidConfirmOpen} onOpenChange={setPaidConfirmOpen}>
        <DialogContent className="sm:max-w-[560px] shadow-modal">
          <DialogHeader>
            <DialogTitle>案件を『入金済み』にしますか</DialogTitle>
            <DialogDescription>
              この操作は取り消せません (入金記録に訂正の可能性がある場合は後から適用できます)。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPaidConfirmOpen(false);
                router.refresh();
              }}
            >
              あとで
            </Button>
            <Button type="button" disabled={isApplyingPaidStage} onClick={() => void handleConfirmPaidStage()}>
              {isApplyingPaidStage ? "変更中..." : "入金済みにする"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
