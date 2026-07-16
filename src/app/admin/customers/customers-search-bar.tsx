"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { PillToggle } from "@/app/admin/_ui";
import type { CustomerLifecycle } from "@/modules/crm/contracts";

export type LifecycleFilterValue = CustomerLifecycle | "all" | "active";

/**
 * 検索欄 + lifecycle フィルタ (01-crm.md §8.2)。`/` キーでの検索フォーカスは document レベルの
 * keydown listener が必要 (計画書注記) — page.tsx (Server Component) では張れないため、この
 * client wrapper に置く。
 */
export function CustomersSearchBar({
  q,
  lifecycle,
  tab,
  filters,
}: {
  q: string;
  lifecycle: LifecycleFilterValue;
  tab: "customers" | "companies";
  filters: { value: LifecycleFilterValue; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function buildHref(nextQ: string, nextLifecycle: LifecycleFilterValue): string {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextLifecycle !== "active") params.set("lifecycle", nextLifecycle);
    if (tab !== "customers") params.set("tab", tab);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => router.replace(buildHref(next, lifecycle)), 300);
        }}
        placeholder="名前・かな・メール・電話で検索 ( / )"
        className="max-w-sm text-control"
        aria-label="顧客検索"
      />
      {/* lifecycle フィルタは顧客一覧クエリにのみ効く。会社タブでは listCompanies へ渡らない
          死にフィルタのため非表示にする (#121 カバレッジ監査 追補・ユーザー承認済み)。 */}
      {tab === "customers" && (
        <PillToggle
          ariaLabel="状態で絞り込み"
          items={filters.map((f) => ({
            key: f.value,
            label: f.label,
            href: buildHref(value, f.value),
            active: lifecycle === f.value,
          }))}
        />
      )}
    </div>
  );
}
