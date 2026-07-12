"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { EntityPickerItem, EntityPickerSearchResult } from "./entity-search-actions";

export type { EntityPickerItem };

type Props = {
  value: EntityPickerItem | null;
  onChange: (item: EntityPickerItem | null) => void;
  search: (q: string) => Promise<EntityPickerSearchResult>;
  placeholder?: string;
  emptyText?: string;
  createLabel?: string;
  onCreate?: (query: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
};

/**
 * 汎用「command ピッカー」(#44 計画書 §「entity-picker.tsx」)。顧客/会社/案件のインクリメンタル
 * 検索を Controlled Popover+Command で行う。v1 方針: 全件ロードは不可 — 開いたときに直近 N 件
 * (search("") 相当) をロードし、入力のたびに Server Action で絞り込む非同期方式。debounce 200ms。
 */
export function EntityPicker({
  value,
  onChange,
  search,
  placeholder = "検索して選択...",
  emptyText = "見つかりません",
  createLabel,
  onCreate,
  disabled,
  className,
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<EntityPickerItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeqRef.current;
      void search(query).then((result) => {
        if (seq !== requestSeqRef.current) return; // 古いレスポンスは無視 (レース対策)
        setItems(result.items);
        setError(result.error);
        setIsLoading(false);
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems([]);
      setError(null);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("flex items-center gap-1.5", className)}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="w-full min-w-0 justify-between font-normal"
              {...rest}
            />
          }
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
            {value ? value.label : placeholder}
          </span>
          <ChevronsUpDownIcon className="ml-1.5 size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        {value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="選択解除"
            onClick={() => onChange(null)}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            {error && (
              <div className="px-3 py-4 text-center text-xs text-destructive">検索に失敗しました: {error}</div>
            )}
            {!error && !isLoading && items.length === 0 && <CommandEmpty>{emptyText}</CommandEmpty>}
            {!error && (
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="truncate text-xs text-muted-foreground">{item.sublabel}</span>
                      )}
                    </div>
                    {value?.id === item.id && <CheckIcon className="ml-2 size-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {onCreate && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__create__${query}`}
                    onSelect={() => {
                      onCreate(query);
                      setOpen(false);
                    }}
                  >
                    {createLabel ?? "新しく作る"}
                    {query.trim() && <span className="ml-1 text-muted-foreground">「{query.trim()}」</span>}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
