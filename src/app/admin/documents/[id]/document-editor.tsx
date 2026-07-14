"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Surface } from "@/app/admin/_ui";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { updateDealStageAction } from "@/app/admin/deals/actions";
import { DEAL_STAGE_REGISTRY } from "@/modules/crm/contracts";
import type { TaxCategory } from "@/modules/platform/contracts";
import { STANDARD_LINE_PRESETS, type DocumentDetail } from "@/modules/sales/contracts";
import { computeDocumentTotals } from "@/modules/sales/tax";

import {
  createPrintPreviewUrlAction,
  deleteDraftDocumentAction,
  issueDocumentAction,
  updateDraftDocumentAction,
} from "../actions";
import { DOC_TYPE_LABEL, TAX_CATEGORY_LABEL, formatJpy } from "../_shared";
// LineState/toLineState/toDocumentLineInput/nextKey は revision-dialog.tsx (訂正発行ダイアログ —
// §4.3-B) も同じ明細行の形を必要とするため ./line-editor-shared.ts に切り出して共有する
// (「同じ明細エディタを revision モードで再利用する」— canonical §8.4 注記の実装。
// トップレベルは [id]/page.tsx の mode 分岐 (draft=DocumentEditor / issued 以降=DocumentDetailView)
// のまま変えず、行編集ロジックのみを共通化する)。
import {
  blankLine,
  nextKey,
  toDocumentLineInput,
  toLineState,
  useLineRowKeyboard,
  workTypeSelectOptions,
  type LineState,
  type WorkTypeHintOption,
} from "./line-editor-shared";
import { SimulatorReferencePanel, type SimulatorReferenceData } from "./simulator-reference-panel";

const NATIVE_SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const TAX_ROUNDING_LABEL: Record<"floor" | "round" | "ceil", string> = { floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" };

/**
 * 帳票編集 (draft) 画面本体 (§8.3)。WorkForm の mode パターン — [id]/page.tsx が
 * document.status === 'draft' のときだけこのコンポーネントをレンダーする
 * (issued 以降は document-detail.tsx — 新規コンポーネント乱造禁止の指示どおり同一ルート内で分岐)。
 */
export function DocumentEditor({
  detail,
  dealId,
  simulatorReference,
  workTypeOptions,
}: {
  detail: DocumentDetail;
  dealId: string;
  simulatorReference: SimulatorReferenceData | null;
  /**
   * 明細「作業種別ヒント」Select の候補 (アクティブな作業種別)。取得元は page.tsx が
   * schedulingFacade.listWorkTypes() から合成する (app 層合成 — §1.3、templates/page.tsx が
   * PricingFacade.getActivePriceTable() を合成する前例と同型)。
   * null = 取得失敗 (Result.ok===false) — エラーを握り潰さず、生 Input へ fallback する
   * (空 select への degrade は既存 work_type_key を「不明」枠へ落とすため禁止 — Issue #97)。
   */
  workTypeOptions: WorkTypeHintOption[] | null;
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
  const [taxRounding, setTaxRounding] = useState<"floor" | "round" | "ceil">(doc.tax_rounding);
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    detail.lines.length > 0 ? detail.lines.map(toLineState) : [],
  );
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(doc.updated_at);
  const [isSaving, setIsSaving] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueConfirmOpen, setIssueConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const totals = useMemo(() => computeDocumentTotals(lines.map(toDocumentLineInput), taxRounding), [lines, taxRounding]);

  function buildInput() {
    return {
      issue_date: issueDate,
      transaction_date: transactionDate,
      valid_until: doc.doc_type === "quote" ? validUntil : null,
      billing_name: billingName,
      billing_suffix: billingSuffix,
      billing_address: billingAddress.trim() || null,
      site_name: siteName.trim() || null,
      site_address: siteAddress.trim() || null,
      notes: notes.trim() || null,
      tax_rounding: taxRounding,
      lines: lines.map(toDocumentLineInput),
    };
  }

  /** 保存 (Cmd+S)。成功時は expectedUpdatedAt を更新して返す (発行前の自動保存が再利用する)。 */
  async function handleSave(): Promise<string | null> {
    setIsSaving(true);
    setError(null);
    const result = await updateDraftDocumentAction(doc.id, buildInput(), expectedUpdatedAt);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.detail ?? `保存に失敗しました (${result.code})`);
      return null;
    }
    setExpectedUpdatedAt(result.value.updated_at);
    toast.success("保存しました。");
    return result.value.updated_at;
  }

  useSaveShortcut(() => void handleSave(), !issueConfirmOpen && !deleteConfirmOpen);

  async function handlePreview() {
    const result = await createPrintPreviewUrlAction(doc.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function handleIssue() {
    setIsIssuing(true);
    setError(null);
    // 発行前に必ず自動保存し、印字内容と画面表示のズレを防ぐ (地雷回避: 未保存の編集を残したまま
    // 発行すると発行された PDF の内容が画面と食い違う)。
    const savedAt = await handleSave();
    if (savedAt === null) {
      setIsIssuing(false);
      setIssueConfirmOpen(false);
      return;
    }
    const result = await issueDocumentAction(doc.id, dealId, savedAt);
    setIsIssuing(false);
    setIssueConfirmOpen(false);
    if (!result.ok) {
      setError(result.detail ?? `発行に失敗しました (${result.code})`);
      return;
    }
    const stageMsg = result.value.dealStage
      ? ` / 案件を『${DEAL_STAGE_REGISTRY[result.value.dealStage.to].label}』にしました`
      : result.value.dealStageSkippedReason
        ? ` (${result.value.dealStageSkippedReason})`
        : "";
    toast.success(`${result.value.doc_no} を発行しました${stageMsg}`, {
      action: result.value.dealStage
        ? {
            label: "元に戻す",
            onClick: () => {
              const stage = result.value.dealStage!;
              void updateDealStageAction(dealId, stage.from, stage.dealUpdatedAt).then((r) => {
                if (!r.ok) {
                  toast.error(r.detail ?? "元に戻せませんでした。");
                  return;
                }
                router.refresh();
              });
            },
          }
        : undefined,
    });
    router.refresh();
  }

  async function handleDelete() {
    setIsDeleting(true);
    const result = await deleteDraftDocumentAction(doc.id, expectedUpdatedAt);
    setIsDeleting(false);
    setDeleteConfirmOpen(false);
    if (!result.ok) {
      toast.error(result.detail ?? `削除に失敗しました (${result.code})`);
      return;
    }
    toast.success("下書きを削除しました。");
    router.push("/admin/documents");
  }

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

  function addLine(atIndex?: number) {
    setLines((prev) => {
      const blank = blankLine();
      if (atIndex === undefined) return [...prev, blank];
      const next = [...prev];
      next.splice(atIndex + 1, 0, blank);
      return next;
    });
  }

  function insertPreset(preset: (typeof STANDARD_LINE_PRESETS)[number]) {
    setLines((prev) => [
      ...prev,
      {
        _key: nextKey(),
        description: preset.label,
        quantity: "1",
        unit: preset.unit,
        unit_price_jpy: String(preset.unit_price_jpy),
        amount_jpy: String(preset.unit_price_jpy),
        _manual: false,
        tax_category: preset.tax_category,
        work_type_key: "",
        source: null,
      },
    ]);
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

  // キーボード操作 (§8.7): Cmd/Ctrl+Enter 行追加 / Cmd/Ctrl+Backspace 行削除 / Alt+↑↓ 行並べ替え。
  // ↑↓ (無修飾) は品名 (テキスト) セルのみで行移動に使う — 数量/単価は type=number のネイティブ
  // スピナー (↑↓で増減) を優先するため、ここでは奪わない実装者判断 (安全側 — openIssues 記録)。
  // revision-dialog.tsx (訂正発行) も同じフックを使って配線する (line-editor-shared.ts 側で共有)。
  const { descriptionRefs, handleRowKeyDown } = useLineRowKeyboard({ addLine, removeLine, moveLine });

  return (
    <div className="flex flex-col gap-6">
      {simulatorReference && <SimulatorReferencePanel data={simulatorReference} currentTotalJpy={totals.total_jpy} />}

      <Surface className="p-6">
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="doc-billing-name">宛名</FieldLabel>
              <div className="flex gap-2">
                <Input id="doc-billing-name" value={billingName} onChange={(e) => setBillingName(e.target.value)} maxLength={80} />
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
              <FieldLabel htmlFor="doc-billing-address">宛先住所</FieldLabel>
              <Input id="doc-billing-address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} maxLength={200} />
            </Field>
            <Field>
              <FieldLabel htmlFor="doc-site-name">現場名</FieldLabel>
              <Input id="doc-site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} maxLength={80} />
            </Field>
            <Field>
              <FieldLabel htmlFor="doc-site-address">現場住所</FieldLabel>
              <Input id="doc-site-address" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} maxLength={200} />
            </Field>
            <Field>
              <FieldLabel>発行日 (空 = 発行時の今日)</FieldLabel>
              <DatePicker value={issueDate} onChange={setIssueDate} />
            </Field>
            {doc.doc_type === "quote" && (
              <Field>
                <FieldLabel>有効期限 (空 = 発行時に既定日数で自動設定)</FieldLabel>
                <DatePicker value={validUntil} onChange={setValidUntil} />
              </Field>
            )}
            <Field>
              <FieldLabel>取引年月日 (任意、空 = 発行日と同日)</FieldLabel>
              <DatePicker value={transactionDate} onChange={setTransactionDate} />
            </Field>
            <Field>
              <FieldLabel htmlFor="doc-tax-rounding">端数処理</FieldLabel>
              <select
                id="doc-tax-rounding"
                className={NATIVE_SELECT_CLASS}
                value={taxRounding}
                onChange={(e) => setTaxRounding(e.target.value as "floor" | "round" | "ceil")}
              >
                {(["floor", "round", "ceil"] as const).map((m) => (
                  <option key={m} value={m}>
                    {TAX_ROUNDING_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="doc-notes">備考</FieldLabel>
            <Textarea id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
        </FieldGroup>
      </Surface>

      <Surface className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">明細</h2>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>定型行を挿入</DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STANDARD_LINE_PRESETS.map((p) => (
                  <DropdownMenuItem key={p.label} onClick={() => insertPreset(p)}>
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="outline" size="sm" onClick={() => addLine()}>
              行を追加 (Cmd+Enter)
            </Button>
          </div>
        </div>

        {workTypeOptions === null && (
          <p className="mb-2 text-xs text-destructive">
            作業種別一覧の取得に失敗したため、作業種別ヒントは直接入力してください。
          </p>
        )}

        <div className="overflow-x-auto">
          <div className="grid min-w-[860px] grid-cols-[2fr_0.7fr_0.6fr_1fr_1fr_1.1fr_1fr_auto] gap-2 border-b border-border pb-2 text-xs font-medium text-muted-foreground">
            <span>品名</span>
            <span>数量</span>
            <span>単位</span>
            <span>単価</span>
            <span>金額</span>
            <span>税区分</span>
            <span>作業種別ヒント</span>
            <span />
          </div>
          {lines.length === 0 && <p className="py-4 text-sm text-muted-foreground">明細がありません。「行を追加」から追加してください。</p>}
          {lines.map((line, index) => (
            <div
              key={line._key}
              onKeyDown={(e) => handleRowKeyDown(e, index)}
              className="grid min-w-[860px] grid-cols-[2fr_0.7fr_0.6fr_1fr_1fr_1.1fr_1fr_auto] items-center gap-2 border-b border-border py-1.5"
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
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  aria-label="金額"
                  value={line.amount_jpy}
                  onChange={(e) => updateLine(index, { amount_jpy: e.target.value, _manual: true })}
                />
                {line._manual && (
                  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                    手動
                  </Badge>
                )}
              </div>
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
              {workTypeOptions !== null ? (
                <select
                  aria-label="作業種別ヒント"
                  className={NATIVE_SELECT_CLASS}
                  value={line.work_type_key}
                  onChange={(e) => updateLine(index, { work_type_key: e.target.value })}
                >
                  {workTypeSelectOptions(workTypeOptions, line.work_type_key).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  aria-label="作業種別ヒント"
                  value={line.work_type_key}
                  onChange={(e) => updateLine(index, { work_type_key: e.target.value })}
                  maxLength={30}
                  placeholder="任意"
                />
              )}
              <Button type="button" variant="ghost" size="icon-sm" aria-label="行を削除" onClick={() => removeLine(index)}>
                <span aria-hidden>🗑</span>
              </Button>
            </div>
          ))}
        </div>
      </Surface>

      <Surface className="flex flex-col gap-1 p-6 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">小計</span>
          <span>{formatJpy(totals.subtotal_jpy)}</span>
        </div>
        {totals.tax_summary.map((t) => (
          <div key={t.tax_category} className="flex justify-between text-muted-foreground">
            <span>{TAX_CATEGORY_LABEL[t.tax_category]} 対象額 {formatJpy(t.taxable_jpy)}</span>
            <span>消費税 {formatJpy(t.tax_jpy)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-border pt-1 text-base font-semibold">
          <span>合計</span>
          <span>{formatJpy(totals.total_jpy)}</span>
        </div>
      </Surface>

      <FieldError errors={error ? [{ message: error }] : undefined} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? "保存中..." : "保存 (Cmd+S)"}
        </Button>
        <Button type="button" variant="outline" onClick={() => void handlePreview()}>
          印刷プレビュー
        </Button>
        <Button type="button" onClick={() => setIssueConfirmOpen(true)}>
          発行
        </Button>
        <Button type="button" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
          削除
        </Button>
      </div>

      <Dialog open={issueConfirmOpen} onOpenChange={setIssueConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{DOC_TYPE_LABEL[doc.doc_type]}を発行しますか</DialogTitle>
            <DialogDescription>番号を採番し PDF を確定保存します。発行後は内容を変更できません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIssueConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" disabled={isIssuing} onClick={() => void handleIssue()}>
              {isIssuing ? "発行中..." : "発行する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>下書きを削除しますか</DialogTitle>
            <DialogDescription>この操作は元に戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" disabled={isDeleting} onClick={() => void handleDelete()}>
              {isDeleting ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
