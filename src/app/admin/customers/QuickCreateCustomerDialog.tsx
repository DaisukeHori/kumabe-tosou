"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import type { EntityPickerItem } from "@/app/admin/_ui/entity-picker";

import { createCustomerAction } from "./actions";
import { parseDuplicateCandidates } from "./duplicate-candidates";

/**
 * 案件フォーム等の顧客 command ピッカーから使う「新しい顧客を作る」インライン作成 (01-crm.md §8.3)。
 * 最小項目 (名前 + メール/電話いずれか) のみ。E601 (重複候補) はここでは簡易表示に留め、
 * 候補を [使う] で選択するか、[それでも新規作成] で force する 2 択とする
 * (詳細な統合導線はフル機能の /admin/customers/new フォームに譲る — v1 の割り切り)。
 */
export function QuickCreateCustomerDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onCreated: (item: EntityPickerItem) => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string }[] | null>(null);

  function reset() {
    setName(initialName);
    setEmail("");
    setTel("");
    setError(null);
    setCandidates(null);
  }

  async function submit(force: boolean) {
    if (name.trim() === "") {
      setError("名前を入力してください。");
      return;
    }
    if (email.trim() === "" && tel.trim() === "") {
      setError("メールか電話番号のどちらかを入力してください。");
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await createCustomerAction(
      {
        kind: "person",
        name: name.trim(),
        name_kana: null,
        email: email.trim() || null,
        tel_raw: tel.trim() || null,
        company_id: null,
        address: null,
        notes: null,
        lifecycle: "lead",
        source: "manual",
      },
      force,
    );
    setIsSaving(false);
    if (!result.ok) {
      if (result.code === "KMB-E601") {
        setCandidates(parseDuplicateCandidates(result.detail));
        return;
      }
      setError(result.detail ?? "作成に失敗しました。");
      return;
    }
    toast.success("顧客を作成しました。");
    onCreated({ id: result.value.customer_id, label: name.trim(), sublabel: email.trim() || tel.trim() || null });
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新しい顧客を作る</DialogTitle>
          <DialogDescription>名前とメールか電話番号のどちらかを入力してください。</DialogDescription>
        </DialogHeader>

        {candidates ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">似ている顧客が見つかりました。</p>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">{c.name}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onCreated({ id: c.id, label: c.name, sublabel: null });
                      onOpenChange(false);
                      reset();
                    }}
                  >
                    使う
                  </Button>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCandidates(null)}>
                入力に戻る
              </Button>
              <Button type="button" variant="destructive" disabled={isSaving} onClick={() => void submit(true)}>
                {isSaving ? "作成中..." : "それでも新規作成する"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <FieldGroup>
              <Field>
                <FieldLabel>名前</FieldLabel>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
              <Field>
                <FieldLabel>メールアドレス</FieldLabel>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>電話番号</FieldLabel>
                <Input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="090-1234-5678" />
              </Field>
            </FieldGroup>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                キャンセル
              </Button>
              <Button type="button" disabled={isSaving} onClick={() => void submit(false)}>
                {isSaving ? "作成中..." : "作成する"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
