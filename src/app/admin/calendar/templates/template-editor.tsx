"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import {
  zWorkTemplateInput,
  type WorkTemplateInput,
  type WorkTemplateView,
  type WorkTypeRow,
} from "@/modules/scheduling/contracts";

import { deleteWorkTemplateAction, saveWorkTemplateAction } from "../actions";

const GRID_COLS = "grid-cols-[1fr_auto_auto_auto_auto_auto]";
/** grade/size Select の「空欄 (全対象)」の sentinel。null と空文字の衝突を避けるため送信直前に null へ正規化する (§10.3 の地雷) */
const ALL_SENTINEL = "__all__";

type KeyLabel = { key: string; label: string };

function toWorkTemplateInput(view: WorkTemplateView | null): WorkTemplateInput {
  if (!view) {
    return { name: "", grade_key: null, size_key: null, is_active: true, items: [{ work_type_key: "", hours: 1, sort_order: 0 }] };
  }
  return {
    name: view.name,
    grade_key: view.grade_key,
    size_key: view.size_key,
    is_active: view.is_active,
    items: view.items.map((i) => ({ work_type_key: i.work_type_key, hours: i.hours, sort_order: i.sort_order })),
  };
}

function TemplateFormDialog({
  open,
  onOpenChange,
  editing,
  workTypes,
  grades,
  sizes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: WorkTemplateView | null;
  workTypes: WorkTypeRow[];
  grades: KeyLabel[];
  sizes: KeyLabel[];
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    control,
    formState: { errors },
  } = useForm<WorkTemplateInput>({
    resolver: zodResolver(zWorkTemplateInput),
    defaultValues: toWorkTemplateInput(editing),
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    reset(toWorkTemplateInput(editing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  function onSubmit(values: WorkTemplateInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await saveWorkTemplateAction(values, editing?.id ?? null, editing?.updated_at ?? null);
      if (!result.ok) {
        setServerError(result.detail ?? `保存に失敗しました (${result.code})`);
        return;
      }
      toast.success("テンプレートを保存しました。");
      onOpenChange(false);
      onSaved();
    });
  }

  const gradeKey = watch("grade_key");
  const sizeKey = watch("size_key");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent
        className="sm:max-w-[560px] shadow-modal"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void handleSubmit(onSubmit)();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "テンプレートを編集" : "テンプレートを新規作成"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="tmpl-name">名称</FieldLabel>
              <Input id="tmpl-name" {...register("name")} />
              <FieldError errors={errors.name ? [errors.name] : undefined} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>グレード</FieldLabel>
                <Select
                  items={[{ value: ALL_SENTINEL, label: "(全対象)" }, ...grades.map((g) => ({ value: g.key, label: g.label }))]}
                  value={gradeKey ?? ALL_SENTINEL}
                  onValueChange={(v) => setValue("grade_key", v === ALL_SENTINEL ? null : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SENTINEL}>(全対象)</SelectItem>
                    {grades.map((g) => (
                      <SelectItem key={g.key} value={g.key}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>サイズ帯</FieldLabel>
                <Select
                  items={[{ value: ALL_SENTINEL, label: "(全対象)" }, ...sizes.map((s) => ({ value: s.key, label: s.label }))]}
                  value={sizeKey ?? ALL_SENTINEL}
                  onValueChange={(v) => setValue("size_key", v === ALL_SENTINEL ? null : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SENTINEL}>(全対象)</SelectItem>
                    {sizes.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field orientation="horizontal">
              <Checkbox
                id="tmpl-active"
                checked={watch("is_active")}
                onCheckedChange={(v) => setValue("is_active", v === true)}
              />
              <FieldLabel htmlFor="tmpl-active">有効</FieldLabel>
            </Field>

            <div className="space-y-2">
              <FieldLabel>明細 (作業ブロックのセット)</FieldLabel>
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <Select
                      items={workTypes.map((wt) => ({ value: wt.key, label: wt.label }))}
                      value={watch(`items.${index}.work_type_key`) || undefined}
                      onValueChange={(v) => v && setValue(`items.${index}.work_type_key`, v)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="種別" />
                      </SelectTrigger>
                      <SelectContent>
                        {workTypes.map((wt) => (
                          <SelectItem key={wt.key} value={wt.key}>
                            {wt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.25"
                      min={0}
                      className="w-24"
                      placeholder="時間"
                      {...register(`items.${index}.hours`, { valueAsNumber: true })}
                    />
                    <Input
                      type="number"
                      min={0}
                      className="w-20"
                      placeholder="並び順"
                      {...register(`items.${index}.sort_order`, { valueAsNumber: true })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                      disabled={fields.length <= 1}
                    >
                      削除
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ work_type_key: workTypes[0]?.key ?? "", hours: 1, sort_order: fields.length })}
              >
                明細を追加
              </Button>
              <FieldError errors={errors.items ? [errors.items as { message?: string }] : undefined} />
            </div>
          </FieldGroup>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル (Esc)
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "保存中..." : "保存 (Cmd+S)"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateEditor({
  initialTemplates,
  workTypes,
  grades,
  sizes,
}: {
  initialTemplates: WorkTemplateView[];
  workTypes: WorkTypeRow[];
  grades: KeyLabel[];
  sizes: KeyLabel[];
}) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkTemplateView | null>(null);
  const [isPending, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(row: WorkTemplateView) {
    setEditing(row);
    setDialogOpen(true);
  }

  function handleDelete(row: WorkTemplateView) {
    startTransition(async () => {
      const result = await deleteWorkTemplateAction(row.id);
      if (!result.ok) {
        toast.error(result.detail ?? `削除に失敗しました (${result.code})`);
        return;
      }
      toast.success("削除しました。");
      router.refresh();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (initialTemplates.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, initialTemplates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openEdit(initialTemplates[focusedIndex]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={openCreate} disabled={workTypes.length === 0}>
          新規作成
        </Button>
      </div>
      {workTypes.length === 0 && (
        <p className="text-sm text-muted-foreground">先に作業種別を登録してください。</p>
      )}
      {initialTemplates.length === 0 ? (
        <p className="text-sm text-muted-foreground">テンプレートがまだありません。</p>
      ) : (
        <DataTableShell>
          <DataTableHeaderRow columns={["名称", "グレード", "サイズ", "明細数", "有効", ""]} gridClassName={GRID_COLS} />
          <div
            role="listbox"
            aria-label="テンプレート一覧"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            {initialTemplates.map((row, index) => (
              <div
                key={row.id}
                role="option"
                aria-selected={index === focusedIndex}
                onClick={() => openEdit(row)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
              >
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-xs text-muted-foreground">{row.grade_key ?? "(全対象)"}</span>
                <span className="text-xs text-muted-foreground">{row.size_key ?? "(全対象)"}</span>
                <span className="text-xs text-muted-foreground">{row.items.length}</span>
                <Badge variant={row.is_active ? "default" : "outline"}>{row.is_active ? "有効" : "無効"}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(row);
                  }}
                >
                  削除
                </Button>
              </div>
            ))}
          </div>
        </DataTableShell>
      )}

      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        workTypes={workTypes}
        grades={grades}
        sizes={sizes}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
