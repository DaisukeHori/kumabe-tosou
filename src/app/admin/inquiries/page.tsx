import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { inquiryFacade } from "@/modules/inquiry/facade";
import type { InquiryStatus } from "@/modules/inquiry/contracts";

import { InquiriesTable } from "./inquiries-table";

export const metadata: Metadata = { title: "問い合わせ" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS: { value: InquiryStatus | "all"; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "new", label: "未対応" },
  { value: "in_progress", label: "対応中" },
  { value: "done", label: "完了" },
  { value: "spam", label: "スパム" },
];

export default async function AdminInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { status: statusParam, cursor } = await searchParams;
  const status: InquiryStatus | "all" =
    statusParam && ["new", "in_progress", "done", "spam"].includes(statusParam)
      ? (statusParam as InquiryStatus)
      : "all";

  const result = await inquiryFacade.list(status, { cursor: cursor ?? null, limit: 50 });
  const items = result.ok ? result.value.items : [];
  const nextCursor = result.ok ? result.value.next_cursor : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">問い合わせ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          一覧の行は ↑↓ で移動、Enter で詳細を開き、ステータス変更後 Cmd+S で保存、Esc で閉じます。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link key={f.value} href={f.value === "all" ? "/admin/inquiries" : `/admin/inquiries?status=${f.value}`}>
            <Badge variant={status === f.value ? "default" : "outline"} className="cursor-pointer px-3 py-1">
              {f.label}
            </Badge>
          </Link>
        ))}
      </div>

      {!result.ok && (
        <p className="text-sm text-destructive">一覧の取得に失敗しました: {result.detail ?? result.code}</p>
      )}

      <InquiriesTable items={items} />

      {nextCursor && (
        <div>
          <Link
            href={`/admin/inquiries?status=${status}&cursor=${encodeURIComponent(nextCursor)}`}
            className="text-sm underline underline-offset-4"
          >
            次の50件へ →
          </Link>
        </div>
      )}
    </div>
  );
}
