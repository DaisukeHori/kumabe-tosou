"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ActivityTimeline } from "@/app/admin/_ui/activity-timeline";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";

import { getCompanySheetDataAction, type CompanySheetData } from "./company-sheet-actions";
import { updateCompanyAction, type CompanyUpdateFormInput } from "./actions";

/**
 * 会社プロフィール + 所属顧客一覧 + 会社リンクのタイムライン (01-crm.md §8.2 末尾)。
 * 独立ルートを持たない client Sheet — 開いたときに `getCompanySheetDataAction` で取得する。
 */
export function CompanySheet({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<CompanySheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<CompanyUpdateFormInput | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load(id: string) {
    setIsLoading(true);
    setError(null);
    void getCompanySheetDataAction(id).then((result) => {
      setIsLoading(false);
      if (!result.ok) {
        setError(result.detail ?? "取得に失敗しました。");
        return;
      }
      setData(result.value);
      setForm({
        name: result.value.company.name,
        name_kana: result.value.company.name_kana,
        tel_raw: result.value.company.tel_e164,
        address: result.value.company.address,
        notes: result.value.company.notes,
      });
    });
  }

  useEffect(() => {
    if (open && companyId) {
      setData(null);
      setIsEditing(false);
      load(companyId);
    }
  }, [open, companyId]);

  async function handleSave() {
    if (!companyId || !data || !form) return;
    setIsSaving(true);
    const result = await updateCompanyAction(companyId, form, data.company.updated_at);
    setIsSaving(false);
    if (!result.ok) {
      if (result.code === "KMB-E103") {
        toast.error("他の操作でこの会社が更新されています。再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "保存に失敗しました。");
      }
      return;
    }
    toast.success("会社情報を保存しました。");
    setIsEditing(false);
    load(companyId);
  }

  useSaveShortcut(() => void handleSave(), isEditing);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* [#121 R3b] CustomerEditSheet と同じ右スライド 420px + --shadow-sheet に統一。 */}
      <SheetContent className="w-[420px] max-w-[90%] overflow-y-auto shadow-sheet data-[side=right]:sm:max-w-[90%]">
        <SheetHeader>
          <SheetTitle>{data?.company.name ?? "会社"}</SheetTitle>
          <SheetDescription>会社プロフィール・所属顧客一覧・タイムライン (Esc で閉じます)</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          {isLoading && <p className="text-label text-muted-foreground">読み込み中...</p>}
          {error && <p className="text-label text-destructive">取得に失敗しました: {error}</p>}

          {data && form && (
            <>
              {isEditing ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel>会社名</FieldLabel>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel>かな</FieldLabel>
                    <Input
                      value={form.name_kana ?? ""}
                      onChange={(e) => setForm({ ...form, name_kana: e.target.value || null })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>電話番号</FieldLabel>
                    <Input
                      value={form.tel_raw ?? ""}
                      onChange={(e) => setForm({ ...form, tel_raw: e.target.value || null })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>住所</FieldLabel>
                    <Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value || null })} />
                  </Field>
                  <Field>
                    <FieldLabel>メモ</FieldLabel>
                    <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={isSaving} onClick={() => void handleSave()}>
                      {isSaving ? "保存中..." : "保存 (Cmd+S)"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                      キャンセル
                    </Button>
                  </div>
                </FieldGroup>
              ) : (
                <div className="flex flex-col gap-1 text-label">
                  <p className="text-muted-foreground">
                    {data.company.tel_e164 ?? "電話番号なし"} / {data.company.address ?? "住所なし"}
                  </p>
                  {data.company.notes && <p className="whitespace-pre-wrap text-foreground">{data.company.notes}</p>}
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                      編集
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-label font-bold text-foreground">所属顧客 ({data.customers.length}{data.customersNextCursor ? "+" : ""})</h3>
                {data.customers.length === 0 ? (
                  <p className="text-label text-muted-foreground">所属する顧客がいません。</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-admin-divider rounded-lg border border-border">
                    {data.customers.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/admin/customers/${c.id}`}
                          className="flex items-center justify-between px-3 py-2 text-label hover:bg-muted"
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 text-meta text-muted-foreground">{c.open_deal_count} 件進行中</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-label font-bold text-foreground">タイムライン</h3>
                <ActivityTimeline
                  target={{ company_id: data.company.id }}
                  initialItems={data.timeline}
                  initialNextCursor={data.timelineNextCursor}
                />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
