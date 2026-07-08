import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  review: "レビュー待ち",
  published: "公開中",
  archived: "アーカイブ",
};

// content モジュール共通の 4 ステータス (works/posts/voices) を色分け表示する。
// 既存の shadcn Badge variant (default/secondary/destructive/outline) だけでは
// 4状態を区別しづらいため、outline + 背景色の上書きで色付けする
// (admin/channels/page.tsx で既に emerald/amber 系の直書きクラスを使っている
//  前例に倣う)。
const STATUS_CLASS: Record<string, string> = {
  draft: "border-transparent bg-muted text-muted-foreground",
  review: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  published:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  archived: "border-transparent bg-muted text-muted-foreground/70",
};

/** 施工事例/記事/お客様の声で共通の下書き/レビュー待ち/公開中/アーカイブの色付きバッジ */
export function ContentStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap font-medium", STATUS_CLASS[status] ?? "")}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
