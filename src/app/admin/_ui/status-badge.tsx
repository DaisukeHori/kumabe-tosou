import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  review: "レビュー待ち",
  published: "公開中",
  archived: "アーカイブ",
};

// [#117 R0] content モジュール共通の 4 ステータス (works/posts/voices) を、
// shadcn Badge に追加したステータス variant (globals.css の --color-status-*) へ
// 載せ替える。以前の emerald/amber 直書きクラスは廃止し、トークン経由で色付けする。
const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success"> = {
  draft: "neutral",
  review: "warning",
  published: "success",
  archived: "neutral",
};

/** 施工事例/記事/お客様の声で共通の下書き/レビュー待ち/公開中/アーカイブの色付きバッジ */
export function ContentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} className="whitespace-nowrap">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
