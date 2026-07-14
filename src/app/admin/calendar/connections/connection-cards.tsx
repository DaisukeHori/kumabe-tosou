"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarConnectionStatus, CalendarConnectionView } from "@/modules/scheduling/contracts";

import { disconnectCalendarAction } from "../actions";

const STATUS_LABEL: Record<CalendarConnectionStatus, string> = {
  disconnected: "未接続",
  connected: "接続中",
  expired: "要再連携",
  error: "エラー",
};

function statusBadgeVariant(status: CalendarConnectionStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "connected") return "default";
  if (status === "expired" || status === "error") return "destructive";
  return "outline";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/**
 * /admin/calendar/connections の provider カード (03-scheduling.md §10.4)。
 * `/admin/channels` の ChannelConnectionCards (connection-cards.tsx) 前例を踏襲。
 * この Issue (#54) では Google のみ中身を実装し、Microsoft は「未実装」枠のみ (#55 が中身を足す)。
 */
export function CalendarConnectionCards({
  connections,
  googleEnabled,
}: {
  connections: CalendarConnectionView[];
  googleEnabled: boolean;
}) {
  const google = connections.find((c) => c.provider === "google") ?? null;
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    if (!window.confirm("Google カレンダーとの接続を切断しますか？ (外部カレンダー本体・作成済みの予定は削除されません)")) {
      return;
    }
    startTransition(async () => {
      const result = await disconnectCalendarAction("google");
      if (!result.ok) {
        toast.error(result.detail ?? `切断に失敗しました (${result.code})`);
        return;
      }
      toast.success("Google カレンダーとの接続を切断しました。");
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Surface className="p-4">
        <div className="flex items-center justify-between">
          <p className="font-heading text-sm font-semibold">Google カレンダー</p>
          <Badge variant={statusBadgeVariant(google?.status ?? "disconnected")}>
            {STATUS_LABEL[google?.status ?? "disconnected"]}
          </Badge>
        </div>
        <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>アカウント</dt>
            <dd className="truncate">{google?.account_email ?? "-"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>アプリ専用カレンダー</dt>
            <dd className="truncate">{google?.app_calendar_id ?? "-"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>トークン有効期限</dt>
            <dd>{formatDateTime(google?.token_expires_at ?? null)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>最終取込</dt>
            <dd>{formatDateTime(google?.last_pulled_at ?? null)}</dd>
          </div>
          {google?.last_error_code && (
            <div className="flex justify-between gap-2 text-destructive">
              <dt>エラー</dt>
              <dd>{google.last_error_code}</dd>
            </div>
          )}
        </dl>
        {!googleEnabled && (
          <p className="mt-2 text-xs text-amber-600">
            OAuth 未設定です (OAUTH_ENABLED / GOOGLE_CALENDAR_CLIENT_ID 等の env を設定してください)。
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {googleEnabled ? (
            <a href="/api/oauth/google-calendar/start" className={cn(buttonVariants({ size: "sm" }))}>
              {google?.status === "connected" || google?.status === "expired" ? "再連携" : "接続する"}
            </a>
          ) : (
            <Button size="sm" disabled>
              接続する
            </Button>
          )}
          {google && google.status !== "disconnected" && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={handleDisconnect}>
              切断
            </Button>
          )}
        </div>
      </Surface>

      <Surface className="p-4 opacity-60">
        <div className="flex items-center justify-between">
          <p className="font-heading text-sm font-semibold">Microsoft カレンダー (Outlook)</p>
          <Badge variant="outline">未実装</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Microsoft カレンダー連携は今後のアップデートで対応予定です。</p>
        <div className="mt-3">
          <Button size="sm" disabled>
            接続する
          </Button>
        </div>
      </Surface>
    </div>
  );
}
