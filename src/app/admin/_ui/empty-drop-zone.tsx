import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * [#117 R0] 破線の空状態 / ドロップゾーン。かんばんの空列、画像未設定の
 * プレースホルダ等で共用する。破線枠は --input、面は --color-admin-well の淡い塗り。
 */
export function EmptyDropZone({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-surface border-2 border-dashed border-input bg-admin-well/40 px-6 py-10 text-center text-label text-muted-foreground",
        className,
      )}
    >
      {icon ? <div className="text-admin-text-faint">{icon}</div> : null}
      {children}
    </div>
  );
}
