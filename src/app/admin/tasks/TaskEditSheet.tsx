"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCustomersAction, searchDealsAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import type { TaskListItem, TaskUpdateInput } from "@/modules/crm/contracts";

import { updateTaskAction } from "./actions";

/** タスク編集 Sheet (01-crm.md §8.4)。zTaskUpdateInput ベース。 */
export function TaskEditSheet({
  task,
  open,
  onOpenChange,
}: {
  task: TaskListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<TaskUpdateInput>({
    title: task.title,
    body: task.body,
    due_on: task.due_on,
    deal_id: task.deal?.id ?? null,
    customer_id: task.customer?.id ?? null,
  });
  const [dealItem, setDealItem] = useState<EntityPickerItem | null>(
    task.deal ? { id: task.deal.id, label: task.deal.title, sublabel: null } : null,
  );
  const [customerItem, setCustomerItem] = useState<EntityPickerItem | null>(
    task.customer ? { id: task.customer.id, label: task.customer.name, sublabel: null } : null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (form.title.trim() === "") {
      setError("タイトルを入力してください。");
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await updateTaskAction(task.id, form, task.updated_at);
    setIsSaving(false);
    if (!result.ok) {
      if (result.code === "KMB-E103") {
        setError("他の操作でこのやることが更新されています。再読み込みしてください。");
      } else {
        setError(result.detail ?? "保存に失敗しました。");
      }
      return;
    }
    toast.success("やることを保存しました。");
    onOpenChange(false);
    router.refresh();
  }

  useSaveShortcut(() => void handleSave(), open);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>やることを編集</SheetTitle>
          <SheetDescription>Cmd+S で保存、Esc で閉じます。</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <FieldGroup>
            <Field>
              <FieldLabel>タイトル</FieldLabel>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>期日</FieldLabel>
              <DatePicker value={form.due_on} onChange={(v) => setForm({ ...form, due_on: v })} />
            </Field>
            <Field>
              <FieldLabel>案件 (任意)</FieldLabel>
              <EntityPicker
                value={dealItem}
                onChange={(item) => {
                  setDealItem(item);
                  setForm({ ...form, deal_id: item?.id ?? null });
                }}
                search={searchDealsAction}
                placeholder="案件を検索"
              />
            </Field>
            <Field>
              <FieldLabel>顧客 (任意)</FieldLabel>
              <EntityPicker
                value={customerItem}
                onChange={(item) => {
                  setCustomerItem(item);
                  setForm({ ...form, customer_id: item?.id ?? null });
                }}
                search={searchCustomersAction}
                placeholder="顧客を検索"
              />
            </Field>
            <Field>
              <FieldLabel>メモ</FieldLabel>
              <Textarea value={form.body ?? ""} onChange={(e) => setForm({ ...form, body: e.target.value || null })} />
            </Field>
          </FieldGroup>
          <div className="flex gap-2">
            <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
              {isSaving ? "保存中..." : "保存 (Cmd+S)"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              キャンセル (Esc)
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
