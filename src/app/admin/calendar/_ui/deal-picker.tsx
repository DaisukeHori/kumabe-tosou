"use client";

import { useEffect, useState, useTransition } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DealListItem } from "@/modules/crm/contracts";

import { searchDealsForCalendarAction } from "../actions";

/**
 * 案件リンクの選択 (block 作成/編集フォーム用の簡易コンボボックス)。
 * crm/deals 側に専用の combobox 部品が存在しない (実装計画書の実測: /admin/deals は未実装の
 * 並行 Issue) ため、command.tsx (shadcn、既存導入済み) を使って最小構成で自作する。
 * 検索は searchDealsForCalendarAction (crmFacade.listDeals のラッパ) をサーバー側で叩く。
 */
export function DealPicker({
  value,
  selectedLabel,
  onChange,
}: {
  value: string | null;
  selectedLabel: string | null;
  onChange: (dealId: string | null, label: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealListItem[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await searchDealsForCalendarAction(query);
        setResults(result.ok ? result.value : []);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query]);

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="truncate text-sm">{selectedLabel ?? value}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="案件リンクを解除" onClick={() => onChange(null, null)}>
          <XIcon />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>案件を選択 (任意)</PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="案件名で検索..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{isPending ? "検索中..." : "該当する案件がありません"}</CommandEmpty>
            {results.map((deal) => (
              <CommandItem
                key={deal.id}
                value={deal.id}
                onSelect={() => {
                  onChange(deal.id, deal.title);
                  setOpen(false);
                }}
              >
                <div className="min-w-0">
                  <div className="truncate">{deal.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{deal.customer_name}</div>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
