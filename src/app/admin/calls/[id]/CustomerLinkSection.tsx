"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { NoticePanel, Surface } from "@/app/admin/_ui";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CustomerListItem } from "@/modules/crm/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import type { KmbErrorCode } from "@/modules/platform/errors";
import type { CallMatchStatus } from "@/modules/telephony/contracts";

import { createCustomerForCallAction, linkCallToCustomerAction, searchCustomersForLinkAction } from "../actions";

/**
 * linkCallToCustomerAction 失敗時のトースト文言 (§7.2 telephony/facade.ts linkCallToCustomer)。
 *
 * 【判断根拠 — レビュー指摘 (MAJOR) 対応】linkCallToCustomer は calls の CAS 更新を先に成功させた
 * 後で crm 側 (appendActivity/relinkActivity) を呼ぶため、後段だけが失敗すると calls.customer_id
 * は新値のまま crm 側の activity_links が未反映という部分適用状態が起こり得る (2 モジュール間に
 * 真の原子性が無いため、facade 側でのロールバックは行っていない — facade.ts の linkCallToCustomer
 * 実装コメント参照)。admin が同じ操作を再実行すれば calls 側は既に新値なので CAS は再度成功し、
 * crm 側 (appendActivity は ref_table/ref_id で冪等) も追いつくため自己修復できる。E103 (楽観排他 —
 * この操作自体が calls 更新前に弾かれており部分適用は起きない) だけは既存どおり専用文言のまま、
 * それ以外は再読み込み+再試行を促す文言を付す (どの失敗理由でも無害な案内のため、実際には
 * 部分適用が起きていないケースに表示されても実害は無い)。
 */
function describeLinkFailure(code: KmbErrorCode): string {
  if (code === "KMB-E103") return "他の操作で更新されています。再読み込みしてください。";
  return `${getErrorInfo(code).message} 画面を再読み込みして紐づけ状況を確認し、変わっていなければ同じ操作をもう一度実行してください。`;
}

/**
 * 顧客紐づけセクション (04-telephony.md §8.2-6)。
 *
 * 【判断根拠 — 実装統合】canonical は matched/created/manual(非null)/manual(null)/ambiguous/no_number の
 * 6 パターンを個別に記述するが、UI 操作としては本質的に「customerId が非 null (紐づけ済み — 付け替え/
 * 解除ができる)」か「customerId が null (未紐づけ — 検索/新規作成ができる)」の 2 系統に収斂する。
 * pending (処理未達 — 6 パターンには無いが起こり得る過渡状態) も customerId は必ず null
 * (§5.2.2 不変条件) のため未紐づけ系統に含める。バナー文言のみ match_status で出し分けることで、
 * 6 パターン全ての「表示」要件を満たしつつ実装の分岐を単純化する (安全側 — 操作可能な範囲を
 * 恣意的に制限しない: pending 中の手動紐づけは repository.reflectLinkResultToCalls の
 * 保護ガードにより後続 worker が上書きしないことを確認済み)。
 */
export function CustomerLinkSection({
  callId,
  customerId,
  customerName,
  matchStatus,
  fromE164,
  expectedUpdatedAt,
}: {
  callId: string;
  customerId: string | null;
  customerName: string | null;
  matchStatus: CallMatchStatus;
  fromE164: string | null;
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState(fromE164 ?? "");
  const [results, setResults] = useState<CustomerListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!searchOpen) return;
    setIsSearching(true);
    const timer = setTimeout(() => {
      void searchCustomersForLinkAction({ query }).then((result) => {
        setIsSearching(false);
        if (result.ok) {
          setResults(result.value.items);
        } else {
          toast.error(getErrorInfo(result.code).message);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, searchOpen]);

  function openSearch() {
    setQuery(fromE164 ?? "");
    setResults([]);
    setSearchOpen(true);
  }

  function handleSelect(selectedCustomerId: string) {
    startTransition(async () => {
      const result = await linkCallToCustomerAction({
        callId,
        customerId: selectedCustomerId,
        expectedUpdatedAt,
      });
      if (!result.ok) {
        toast.error(describeLinkFailure(result.code));
        return;
      }
      toast.success("顧客に紐づけました。");
      setSearchOpen(false);
      router.refresh();
    });
  }

  function handleUnlink() {
    startTransition(async () => {
      const result = await linkCallToCustomerAction({ callId, customerId: null, expectedUpdatedAt });
      if (!result.ok) {
        toast.error(describeLinkFailure(result.code));
        return;
      }
      toast.success("紐づけを解除しました。");
      router.refresh();
    });
  }

  function handleCreateAndLink() {
    if (newName.trim().length === 0) {
      toast.error("お名前を入力してください。");
      return;
    }
    startTransition(async () => {
      const createResult = await createCustomerForCallAction({ name: newName.trim(), telE164: fromE164 });
      if (!createResult.ok) {
        toast.error(getErrorInfo(createResult.code).message);
        return;
      }
      const linkResult = await linkCallToCustomerAction({
        callId,
        customerId: createResult.value.customer_id,
        expectedUpdatedAt,
      });
      if (!linkResult.ok) {
        toast.error(`顧客は作成しましたが紐づけに失敗しました: ${describeLinkFailure(linkResult.code)}`);
        return;
      }
      toast.success("新しい顧客を作成して紐づけました。");
      setCreateOpen(false);
      setSearchOpen(false);
      setNewName("");
      router.refresh();
    });
  }

  if (customerId !== null) {
    return (
      <Surface className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-medium text-foreground">顧客紐づけ</h3>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            顧客: <Link href={`/admin/customers/${customerId}`} className="underline underline-offset-4">{customerName ?? "(名称不明)"}</Link>
          </span>
          <Button variant="outline" size="sm" onClick={openSearch} disabled={isPending}>
            付け替え
          </Button>
          <Button variant="outline" size="sm" onClick={handleUnlink} disabled={isPending}>
            解除
          </Button>
        </div>
        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          query={query}
          setQuery={setQuery}
          results={results}
          isSearching={isSearching}
          isPending={isPending}
          onSelect={handleSelect}
          onCreateNew={() => setCreateOpen(true)}
        />
        <CreateCustomerDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          name={newName}
          setName={setNewName}
          telE164={fromE164}
          isPending={isPending}
          onSubmit={handleCreateAndLink}
        />
      </Surface>
    );
  }

  const banner =
    matchStatus === "ambiguous"
      ? { tone: "warn" as const, text: "同じ電話番号の顧客が複数見つかりました。候補から選ぶか、新しい顧客を作成してください。" }
      : matchStatus === "manual"
        ? { tone: "info" as const, text: "手動で紐づけを解除済みです。" }
        : matchStatus === "no_number"
          ? { tone: "info" as const, text: "番号非通知のため自動紐づけできません。" }
          : { tone: "info" as const, text: "まだ処理中です (顧客の紐づけ待ち)。先に手動で紐づけることもできます。" };

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-medium text-foreground">顧客紐づけ</h3>
      {banner.tone === "warn" ? (
        <NoticePanel tone="warning">{banner.text}</NoticePanel>
      ) : (
        <p className="text-sm text-muted-foreground">{banner.text}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={openSearch} disabled={isPending}>
          顧客を検索して紐づける
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} disabled={isPending}>
          新しい顧客として作る
        </Button>
      </div>
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        query={query}
        setQuery={setQuery}
        results={results}
        isSearching={isSearching}
        isPending={isPending}
        onSelect={handleSelect}
        onCreateNew={() => setCreateOpen(true)}
      />
      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        name={newName}
        setName={setNewName}
        telE164={fromE164}
        isPending={isPending}
        onSubmit={handleCreateAndLink}
      />
    </Surface>
  );
}

function SearchDialog({
  open,
  onOpenChange,
  query,
  setQuery,
  results,
  isSearching,
  isPending,
  onSelect,
  onCreateNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  results: CustomerListItem[];
  isSearching: boolean;
  isPending: boolean;
  onSelect: (customerId: string) => void;
  onCreateNew: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>顧客を検索</DialogTitle>
          <DialogDescription>↑↓ で選択、Enter で紐づけ、Esc で閉じます。</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-lg border">
          <CommandInput placeholder="名前・電話番号で検索" value={query} onValueChange={setQuery} />
          <CommandList>
            {!isSearching && results.length === 0 && <CommandEmpty>該当する顧客がいません。</CommandEmpty>}
            <CommandGroup>
              {results.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  disabled={isPending}
                  onSelect={() => onSelect(c.id)}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.tel_e164 ?? c.email ?? ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる (Esc)
          </Button>
          <Button variant="outline" onClick={onCreateNew}>
            新しい顧客として作る
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateCustomerDialog({
  open,
  onOpenChange,
  name,
  setName,
  telE164,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  setName: (v: string) => void;
  telE164: string | null;
  isPending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新しい顧客として作る</DialogTitle>
          <DialogDescription>
            {telE164 ? `電話番号 ${telE164} を引き継ぎます。` : "この通話は番号非通知のため電話番号は登録されません。"}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-customer-name">お名前</FieldLabel>
            <Input
              id="new-customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? "作成中..." : "作成して紐づける"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
