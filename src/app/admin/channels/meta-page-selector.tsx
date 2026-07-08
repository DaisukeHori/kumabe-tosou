"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { finalizeMetaConnectionAction } from "./actions";
import { CHANNELS_FORM_INITIAL_STATE } from "./form-state";

export function MetaPageSelector({ pages }: { pages: { id: string; name: string }[] }) {
  const [state, action, isPending] = useActionState(finalizeMetaConnectionAction, CHANNELS_FORM_INITIAL_STATE);

  useEffect(() => {
    if (state.success) toast.success("Instagram を接続しました。");
  }, [state.success]);

  if (pages.length === 0) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        Facebook ページが見つかりませんでした。Instagram プロアカウントと Facebook ページの紐付けを確認してください。
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background p-4">
      <h2 className="font-heading text-sm font-semibold">Instagram: ページを選択</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        紐付ける Facebook ページを選択してください (契約書 §7.4)。
      </p>
      <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
        <Select name="page_id" items={pages.map((p) => ({ value: p.id, label: p.name }))}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="ページを選択" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={isPending}>
          {isPending ? "接続中..." : "このページで接続する"}
        </Button>
      </form>
      {state.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
