"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";

/**
 * 帳票一覧の検索 input (§8.2 `?q=` / §8.7: `/` フォーカス・Esc クリア)。
 * URL クエリを唯一の真実として使う既存規約 (§8.1) どおり、入力は debounce (300ms) して
 * `?q=` を書き換えるだけで自前の state を持たない (再読み込み・共有 URL の一貫性を保つため)。
 */
export function DocumentsSearch({ initialQuery, type, status }: { initialQuery: string; type: string; status: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setValue(initialQuery), [initialQuery]);

  function pushQuery(q: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (q.trim()) params.set("q", q.trim());
    else params.delete("q");
    params.delete("cursor");
    router.push(`/admin/documents?${params.toString()}`);
  }

  return (
    <Input
      data-documents-search
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => pushQuery(e.target.value), 300);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setValue("");
          pushQuery("");
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="書類番号・宛名で検索 (/)"
      className="w-64"
      aria-label="帳票を検索"
      // type/status は再検索時も維持する (URLSearchParams 経由でそのまま残るため props としては
      // 未使用に見えるが、pushQuery が searchParams 全体をコピーしているため実質的に効いている —
      // 明示的に受け取ることで呼び出し側の意図を読みやすくする)
      key={`${type}-${status}`}
    />
  );
}
