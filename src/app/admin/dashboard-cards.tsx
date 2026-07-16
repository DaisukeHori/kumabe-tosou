import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

import { Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardActionItem, DashboardActionTone } from "@/app/admin/dashboard-kpi-format";

/**
 * [#119 R2] 「今日の仕事」ダッシュボードのプレゼンテーション部品。
 *
 * page.tsx (Server Component) は async default 以外を export できないため、カード部品は
 * このファイルに切り出す (ページ配下・admin scope 専用)。すべて R0 のトークン/variant/Surface
 * を使い、任意値クラスは書かない。データ取得やロジックは持たず、渡された値を描画するだけ。
 */

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

/** アクションカード左端の優先度色 (R0 status トークンへ写像。urgent=ブランド赤)。 */
const ACTION_TONE_BORDER: Record<DashboardActionTone, string> = {
  urgent: "border-l-primary",
  warning: "border-l-status-warning-fg",
  info: "border-l-status-info-fg",
  success: "border-l-status-success-fg",
};

/** 「次にやること」1件=1カード。番号バッジ+見出し+補足+遷移ボタン。 */
export function ActionCard({ item, index }: { item: DashboardActionItem; index: number }) {
  return (
    <Surface
      className={cn(
        "flex flex-col gap-4 border-l-4 p-5 sm:flex-row sm:items-center",
        ACTION_TONE_BORDER[item.tone],
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-badge font-extrabold text-white">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label font-bold text-foreground">{item.title}</p>
        <p className="mt-0.5 text-table text-muted-foreground">{item.description}</p>
      </div>
      <Button render={<Link href={item.href} />} className="shrink-0 self-start sm:self-auto">
        {item.actionLabel}
      </Button>
    </Surface>
  );
}

/** アクションが無い日の平常表示 (縮退ではなく「順調」の肯定的な状態)。 */
export function ActionEmptyState() {
  return (
    <Surface className="flex items-center gap-3 border-l-4 border-l-status-success-fg p-5">
      <span className="text-lg" aria-hidden>
        ✓
      </span>
      <div>
        <p className="text-label font-bold text-foreground">今すぐ対応が必要なことはありません</p>
        <p className="mt-0.5 text-table text-muted-foreground">
          順調です。下の数字で全体の状況を確認できます。
        </p>
      </div>
    </Surface>
  );
}

/** KPI 数値タイル。ラベル+大きな値+補足バッジ/ヒント。href 指定時はカード全体がリンク。 */
export function KpiTile({
  label,
  value,
  href,
  hint,
  badge,
  urgentValue = false,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  hint?: ReactNode;
  badge?: { text: ReactNode; variant: BadgeVariant };
  urgentValue?: boolean;
}) {
  const body = (
    <Surface
      className={cn(
        "flex h-full flex-col gap-1 p-4",
        href && "transition-colors hover:bg-muted",
      )}
    >
      <span className="text-meta font-semibold text-admin-text-meta">{label}</span>
      <span className={cn("text-page-title", urgentValue && "text-status-urgent-fg")}>{value}</span>
      {badge ? (
        <span className="mt-1">
          <Badge variant={badge.variant}>{badge.text}</Badge>
        </span>
      ) : null}
      {hint ? <span className="text-meta text-muted-foreground">{hint}</span> : null}
    </Surface>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/** KPI グリッドの小見出し + 4/3 カラムのグリッド枠。 */
export function KpiSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-meta font-semibold tracking-wide text-admin-text-meta">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}
