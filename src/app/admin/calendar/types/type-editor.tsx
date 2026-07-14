"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import { zWorkTypeInput, type WorkTypeInput, type WorkTypeRow } from "@/modules/scheduling/contracts";

import { deleteWorkTypeAction, saveWorkTypeAction } from "../actions";

const GRID_COLS = "grid-cols-[auto_1fr_auto_auto_auto_auto_auto]";

/** 色入力 popover のプリセット 12 色 (§10.3)。work_types の既定 seed 色 + 汎用色を混在 */
const COLOR_PRESETS = [
  "#a80f22",
  "#8d6e63",
  "#78909c",
  "#bdbdbd",
  "#2e7d32",
  "#1565c0",
  "#f9a825",
  "#6a1b9a",
  "#00838f",
  "#c62828",
  "#4e342e",
  "#37474f",
];

function ColorInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="gap-2">
            <span className="size-4 rounded-full border border-border" style={{ backgroundColor: value }} />
            {value}
          </Button>
        }
      />
      <PopoverContent className="w-56">
        <div className="grid grid-cols-6 gap-2">
          {COLOR_PRESETS.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              onClick={() => {
                onChange(hex);
                setOpen(false);
              }}
              className="size-6 rounded-full border border-border"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
        <Input
          className="mt-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#a80f22"
        />
      </PopoverContent>
    </Popover>
  );
}

function WorkTypeFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: WorkTypeRow | null;
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
    setError,
    formState: { errors },
  } = useForm<WorkTypeInput>({
    resolver: zodResolver(zWorkTypeInput),
    defaultValues: editing ?? {
      key: "",
      label: "",
      color: "#a80f22",
      consumes_capacity: true,
      default_hours: null,
      sort_order: 0,
      is_active: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    reset(
      editing ?? {
        key: "",
        label: "",
        color: "#a80f22",
        consumes_capacity: true,
        default_hours: null,
        sort_order: 0,
        is_active: true,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  function onSubmit(values: WorkTypeInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await saveWorkTypeAction(values, editing?.id ?? null, editing?.updated_at ?? null);
      if (!result.ok) {
        if (result.code === "KMB-E101" && result.detail?.includes("key")) {
          setError("key", { message: result.detail });
          return;
        }
        setServerError(result.detail ?? `保存に失敗しました (${result.code})`);
        return;
      }
      toast.success("作業種別を保存しました。");
      onOpenChange(false);
      onSaved();
    });
  }

  const color = watch("color");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void handleSubmit(onSubmit)();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "作業種別を編集" : "作業種別を新規作成"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FieldGroup>
            <Field data-invalid={!!errors.key}>
              <FieldLabel htmlFor="wt-key">key</FieldLabel>
              <Input
                id="wt-key"
                {...register("key")}
                disabled={editing !== null}
                placeholder="sanding"
              />
              <FieldError errors={errors.key ? [errors.key] : undefined} />
            </Field>
            <Field data-invalid={!!errors.label}>
              <FieldLabel htmlFor="wt-label">表示名</FieldLabel>
              <Input id="wt-label" {...register("label")} />
              <FieldError errors={errors.label ? [errors.label] : undefined} />
            </Field>
            <Field>
              <FieldLabel>色</FieldLabel>
              <ColorInput value={color} onChange={(hex) => setValue("color", hex, { shouldValidate: true })} />
              <FieldError errors={errors.color ? [errors.color] : undefined} />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="wt-consumes"
                checked={watch("consumes_capacity")}
                onCheckedChange={(v) => setValue("consumes_capacity", v === true)}
              />
              <FieldLabel htmlFor="wt-consumes">拘束 (週間キャパを消費する)</FieldLabel>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={!!errors.default_hours}>
                <FieldLabel htmlFor="wt-default-hours">既定時間 (h、任意)</FieldLabel>
                <Input
                  id="wt-default-hours"
                  type="number"
                  step="0.25"
                  min={0}
                  {...register("default_hours", {
                    setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                  })}
                />
                <FieldError errors={errors.default_hours ? [errors.default_hours] : undefined} />
              </Field>
              <Field data-invalid={!!errors.sort_order}>
                <FieldLabel htmlFor="wt-sort-order">並び順</FieldLabel>
                <Input id="wt-sort-order" type="number" min={0} {...register("sort_order", { valueAsNumber: true })} />
                <FieldError errors={errors.sort_order ? [errors.sort_order] : undefined} />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Checkbox
                id="wt-active"
                checked={watch("is_active")}
                onCheckedChange={(v) => setValue("is_active", v === true)}
              />
              <FieldLabel htmlFor="wt-active">有効</FieldLabel>
            </Field>
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

export function TypeEditor({ initialWorkTypes }: { initialWorkTypes: WorkTypeRow[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkTypeRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(row: WorkTypeRow) {
    setEditing(row);
    setDialogOpen(true);
  }

  function handleDelete(row: WorkTypeRow) {
    startTransition(async () => {
      const result = await deleteWorkTypeAction(row.id);
      if (!result.ok) {
        if (result.code === "KMB-E702") {
          toast.error("使用中のため削除できません。無効化してください。");
          return;
        }
        toast.error(result.detail ?? `削除に失敗しました (${result.code})`);
        return;
      }
      toast.success("削除しました。");
      router.refresh();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (initialWorkTypes.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, initialWorkTypes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openEdit(initialWorkTypes[focusedIndex]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={openCreate}>
          新規作成
        </Button>
      </div>
      {initialWorkTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">作業種別がまだありません。</p>
      ) : (
        <DataTableShell>
          <DataTableHeaderRow
            columns={["色", "表示名 / key", "拘束", "既定h", "並び順", "有効", ""]}
            gridClassName={GRID_COLS}
          />
          <div
            role="listbox"
            aria-label="作業種別一覧"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            {initialWorkTypes.map((row, index) => (
              <div
                key={row.id}
                role="option"
                aria-selected={index === focusedIndex}
                onClick={() => openEdit(row)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
              >
                <span className="size-4 rounded-full border border-border" style={{ backgroundColor: row.color }} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{row.key}</div>
                </div>
                <Badge variant={row.consumes_capacity ? "default" : "outline"}>
                  {row.consumes_capacity ? "拘束" : "非拘束"}
                </Badge>
                <span className="text-xs text-muted-foreground">{row.default_hours ?? "-"}</span>
                <span className="text-xs text-muted-foreground">{row.sort_order}</span>
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

      <WorkTypeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
