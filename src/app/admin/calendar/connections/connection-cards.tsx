"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarConnectionStatus, CalendarConnectionView, CalendarProvider } from "@/modules/scheduling/contracts";

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

type ProviderCardConfig = {
  provider: CalendarProvider;
  label: string;
  startPath: string;
  /**
   * 切断確認ダイアログの文言。Microsoft は disconnect → 再接続で外部側の旧イベントが
   * 二重表示され得るリスクがある (03-scheduling.md §18 R10 — MS には Google の
   * kumabe_block_id のような link 再構築キーが無いため §8.5 の再構築で救えない)。
   * Google 側は #54 の既存文言をそのまま踏襲する。
   */
  disconnectConfirmMessage: string;
  /**
   * 静的注記 (env 未設定時とは別に常時表示する provider 固有の注記)。Microsoft は
   * busy 帯取得が getSchedule → calendarView 合成フォールバック → 最終 degrade の
   * 3 段構成であり (§8.1 表 / §18 R1)、MSA (個人 Outlook) では getSchedule 自体が
   * "Not supported" のため実質フォールバック運用になる。ms-api.ts の実装コメントで
   * 「この場合の UI 注記表示は本 Issue (#54) のスコープ外」と明記されていたため、
   * #55 でここに静的注記を追加する (動的なフォールバック発動検知はバックエンドに
   * 専用フィールドが無く、追加は本 Issue のスコープ外の契約変更になるため見送り —
   * 安全側の簡略化として計画書が明示的に許容している方針)。
   */
  staticNote: string | null;
};

const PROVIDER_CONFIG: ProviderCardConfig[] = [
  {
    provider: "google",
    label: "Google カレンダー",
    startPath: "/api/oauth/google-calendar/start",
    disconnectConfirmMessage: "Google カレンダーとの接続を切断しますか？ (外部カレンダー本体・作成済みの予定は削除されません)",
    staticNote: null,
  },
  {
    provider: "microsoft",
    label: "Microsoft カレンダー (Outlook)",
    startPath: "/api/oauth/ms-calendar/start",
    disconnectConfirmMessage:
      "Microsoft カレンダーとの接続を切断しますか？ (外部カレンダー本体・作成済みの予定は削除されません。" +
      "再接続する場合、古い予定が重複して表示されることがあるため、必要に応じて手動で削除してください)",
    staticNote:
      "個人 Outlook (Microsoft アカウント) では空き時間の取得方法が制限される場合があり、" +
      "その場合は予定の内容から空き時間を推定する簡易的な方法に自動的に切り替わります。",
  },
];

/**
 * /admin/calendar/connections の provider カード (03-scheduling.md §10.4)。
 * `/admin/channels` の ChannelConnectionCards (connection-cards.tsx) 前例を踏襲。
 * #54 で Google 枠、#55 で Microsoft 枠を実装 (config 配列を共有し 1 つの Card コンポーネントで描画)。
 */
export function CalendarConnectionCards({
  connections,
  googleEnabled,
  msEnabled,
}: {
  connections: CalendarConnectionView[];
  googleEnabled: boolean;
  msEnabled: boolean;
}) {
  const enabledByProvider: Record<CalendarProvider, boolean> = { google: googleEnabled, microsoft: msEnabled };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PROVIDER_CONFIG.map((config) => (
        <ProviderCard
          key={config.provider}
          config={config}
          connection={connections.find((c) => c.provider === config.provider) ?? null}
          enabled={enabledByProvider[config.provider]}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  config,
  connection,
  enabled,
}: {
  config: ProviderCardConfig;
  connection: CalendarConnectionView | null;
  enabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    if (!window.confirm(config.disconnectConfirmMessage)) {
      return;
    }
    startTransition(async () => {
      const result = await disconnectCalendarAction(config.provider);
      if (!result.ok) {
        toast.error(result.detail ?? `切断に失敗しました (${result.code})`);
        return;
      }
      toast.success(`${config.label}との接続を切断しました。`);
    });
  }

  return (
    <Surface className="p-4">
      <div className="flex items-center justify-between">
        <p className="font-heading text-sm font-semibold">{config.label}</p>
        <Badge variant={statusBadgeVariant(connection?.status ?? "disconnected")}>
          {STATUS_LABEL[connection?.status ?? "disconnected"]}
        </Badge>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>アカウント</dt>
          <dd className="truncate">{connection?.account_email ?? "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>アプリ専用カレンダー</dt>
          <dd className="truncate">{connection?.app_calendar_id ?? "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>トークン有効期限</dt>
          <dd>{formatDateTime(connection?.token_expires_at ?? null)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>最終取込</dt>
          <dd>{formatDateTime(connection?.last_pulled_at ?? null)}</dd>
        </div>
        {connection?.last_error_code && (
          <div className="flex justify-between gap-2 text-destructive">
            <dt>エラー</dt>
            <dd>{connection.last_error_code}</dd>
          </div>
        )}
      </dl>
      {config.staticNote && <p className="mt-2 text-xs text-muted-foreground">{config.staticNote}</p>}
      {!enabled && (
        <p className="mt-2 text-xs text-amber-600">
          OAuth 未設定です (OAUTH_ENABLED / {config.provider === "google" ? "GOOGLE_CALENDAR_CLIENT_ID" : "MS_CALENDAR_CLIENT_ID"} 等の env を設定してください)。
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {enabled ? (
          <a href={config.startPath} className={cn(buttonVariants({ size: "sm" }))}>
            {connection?.status === "connected" || connection?.status === "expired" ? "再連携" : "接続する"}
          </a>
        ) : (
          <Button size="sm" disabled>
            接続する
          </Button>
        )}
        {connection && connection.status !== "disconnected" && (
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleDisconnect}>
            切断
          </Button>
        )}
      </div>
    </Surface>
  );
}
