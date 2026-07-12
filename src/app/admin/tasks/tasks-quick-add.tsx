"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchDealsAction } from "@/app/admin/_ui/entity-search-actions";

import { createTaskAction } from "./actions";

/**
 * やることのクイック追加行 (01-crm.md §8.4)。Input title + date-picker due_on +
 * 任意の案件 command ピッカー。Enter で createTaskAction。origin='manual' 固定。
 * 顧客/案件詳細ページ (customer_id/deal_id 固定) からも再利用できるよう props で制御する。
 */
export function TasksQuickAdd({
  defaultCustomerId = null,
  defaultDealId = null,
  showDealPicker = true,
}: {
  defaultCustomerId?: string | null;
  defaultDealId?: string | null;
  showDealPicker?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [dealItem, setDealItem] = useState<EntityPickerItem | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (title.trim() === "") return;
    setIsPending(true);
    const result = await createTaskAction({
      title: title.trim(),
      body: null,
      due_on: dueOn,
      deal_id: defaultDealId ?? dealItem?.id ?? null,
      customer_id: defaultCustomerId,
      origin: "manual",
      source_activity_id: null,
    });
    setIsPending(false);
    if (!result.ok) {
      toast.error(result.detail ?? "追加に失敗しました。");
      return;
    }
    toast.success("やることを追加しました。");
    setTitle("");
    setDueOn(null);
    setDealItem(null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isPending) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder="やることを入力して Enter"
        className="min-w-48 flex-1"
      />
      <DatePicker value={dueOn} onChange={setDueOn} placeholder="期日 (任意)" className="w-40" />
      {showDealPicker && !defaultDealId && (
        <EntityPicker
          value={dealItem}
          onChange={setDealItem}
          search={searchDealsAction}
          placeholder="案件 (任意)"
          className="w-48"
        />
      )}
      <Button type="button" disabled={isPending || title.trim() === ""} onClick={() => void handleSubmit()}>
        追加
      </Button>
    </div>
  );
}
