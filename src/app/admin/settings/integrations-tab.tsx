"use client";

import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integration-credentials";

import { deleteIntegrationCredentialsAction, saveIntegrationCredentialsAction } from "./integrations-actions";
import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";

/**
 * /admin/settings「外部連携」タブ。外部サービスの認証情報 (OAuth クライアント / API キー) を
 * 管理画面から登録する。値の実体は @/lib/integration-credentials (server-only) が扱い、
 * このコンポーネントは状態 (IntegrationStatus) の表示と入力フォームのみを担う。
 *
 * 表示用のサービス定義 (ラベル・説明・登録先・URL) はサーバ側の ProviderSpec とは別に
 * ここで持つ (server-only モジュールは client から import できないため。provider の集合は
 * INTEGRATION_PROVIDERS と一致させること)。
 */

type UrlItem = { label: string; path: string };

interface ProviderView {
  name: string;
  description: string;
  /** 外部ポータルでの取得先 */
  portal: string;
  /** 識別子欄のラベル。null = 識別子なし (Resend) */
  publicIdLabel: string | null;
  secretLabel: string;
  secretRequired: boolean;
  requiresOAuth: boolean;
  urlsTitle: string | null;
  urls: UrlItem[];
  note?: string;
}

const PROVIDER_VIEWS: Record<IntegrationProvider, ProviderView> = {
  google_calendar: {
    name: "Google カレンダー",
    description: "Google カレンダーと予定を双方向同期します。カレンダー接続ページから各アカウントを接続できるようになります。",
    portal: "Google Cloud Console → API とサービス → 認証情報 → OAuth クライアント ID (種類: ウェブ アプリケーション)",
    publicIdLabel: "クライアント ID",
    secretLabel: "クライアント シークレット",
    secretRequired: true,
    requiresOAuth: true,
    urlsTitle: "承認済みのリダイレクト URI に登録する URL",
    urls: [{ label: "リダイレクト URI", path: "/api/oauth/google-calendar/callback" }],
  },
  ms_calendar: {
    name: "Microsoft (Outlook) カレンダー",
    description: "Microsoft 365 / Outlook のカレンダーと予定を同期します。カレンダー接続ページから接続できるようになります。",
    portal: "Microsoft Entra ID → アプリの登録 → 新規登録 (プラットフォーム: Web)。証明書とシークレットからクライアント シークレットを発行",
    publicIdLabel: "クライアント ID (アプリケーション ID)",
    secretLabel: "クライアント シークレット",
    secretRequired: true,
    requiresOAuth: true,
    urlsTitle: "リダイレクト URI に登録する URL",
    urls: [{ label: "リダイレクト URI", path: "/api/oauth/ms-calendar/callback" }],
  },
  x: {
    name: "X (旧 Twitter)",
    description: "施工事例やお知らせを X に自動投稿します。チャネル設定ページから X アカウントを接続できるようになります。",
    portal: "X Developer Portal → プロジェクトのアプリ → User authentication settings (OAuth 2.0, Type of App: Web App)",
    publicIdLabel: "クライアント ID",
    secretLabel: "クライアント シークレット (任意)",
    secretRequired: false,
    requiresOAuth: true,
    urlsTitle: "Callback URI / Redirect URL に登録する URL",
    urls: [{ label: "コールバック URL", path: "/api/oauth/x/callback" }],
    note: "シークレットは任意です (パブリッククライアントとして PKCE で接続する場合は空欄のまま保存できます)。",
  },
  meta: {
    name: "Meta (Instagram)",
    description: "Instagram (ビジネスアカウント) に施工事例を自動投稿します。チャネル設定ページから接続できるようになります。",
    portal: "Meta for Developers → アプリ → アプリ設定 → ベーシック (アプリ ID / app secret)",
    publicIdLabel: "アプリ ID",
    secretLabel: "app secret",
    secretRequired: true,
    requiresOAuth: true,
    urlsTitle: "有効な OAuth リダイレクト URI に登録する URL",
    urls: [{ label: "リダイレクト URI", path: "/api/oauth/meta/callback" }],
  },
  twilio: {
    name: "Twilio (電話)",
    description: "着信の自動応答・録音・不在着信の記録を行います。電話番号や応答メッセージは「電話」タブで設定します。",
    portal: "Twilio Console → Account Info (Account SID / Auth Token)",
    publicIdLabel: "Account SID",
    secretLabel: "Auth Token",
    secretRequired: true,
    requiresOAuth: false,
    urlsTitle: "Twilio Console の電話番号設定に登録する Webhook URL",
    urls: [
      { label: "Voice webhook (POST)", path: "/api/telephony/voice" },
      { label: "Status callback", path: "/api/telephony/status" },
      { label: "Recording status callback", path: "/api/telephony/recording-status" },
    ],
  },
  resend: {
    name: "Resend (メール送信)",
    description: "問い合わせ通知・配信失敗通知などのメールを送信します。",
    portal: "resend.com → API Keys で API キーを発行",
    publicIdLabel: null,
    secretLabel: "API キー",
    secretRequired: true,
    requiresOAuth: false,
    urlsTitle: null,
    urls: [],
    note: "メールは no-reply@<サイトのドメイン> から送信されます。Resend の Domains でサイトのドメインを追加し、DNS レコードの認証を完了させてください。",
  },
};

function useFormFeedback(state: SettingsFormState, label: string) {
  useEffect(() => {
    if (state.success) toast.success(`${label}の認証情報を保存しました。`);
  }, [state.success, label]);
}

function formatUpdatedAt(updatedAt: string | null): string {
  return updatedAt ? new Date(updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "-";
}

function CopyableUrl({ label, url }: { label: string; url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL をコピーしました。");
    } catch {
      toast.error("コピーできませんでした。URL を選択してコピーしてください。");
    }
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <Button type="button" size="xs" variant="outline" onClick={copy}>
          コピー
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationStatus }) {
  if (status.source === "db") return <Badge variant="success">設定済み (管理画面)</Badge>;
  if (status.source === "env") return <Badge variant="info">設定済み (環境変数)</Badge>;
  return <Badge variant="neutral">未設定</Badge>;
}

function IntegrationCard({
  status,
  siteUrl,
  oauthEnabled,
}: {
  status: IntegrationStatus;
  siteUrl: string;
  oauthEnabled: boolean;
}) {
  const view = PROVIDER_VIEWS[status.provider];
  const [state, action, isPending] = useActionState<SettingsFormState, FormData>(
    (_prev, formData) => saveIntegrationCredentialsAction(status.provider, formData),
    SETTINGS_FORM_INITIAL_STATE,
  );
  useFormFeedback(state, view.name);
  const [isDeleting, startDelete] = useTransition();

  const hasValues = status.source !== "none";
  const oauthDisabled = view.requiresOAuth && hasValues && !oauthEnabled;
  const incomplete = hasValues && !status.configured && !oauthDisabled;
  const idPrefix = `integration-${status.provider}`;

  function runDelete() {
    if (
      !window.confirm(
        `${view.name} の認証情報 (管理画面で保存した値) を削除しますか?\n削除後、環境変数に値があればそちらが使われます。`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const result = await deleteIntegrationCredentialsAction(status.provider);
      if (result.error) toast.error(result.error);
      else toast.success(`${view.name} の認証情報を削除しました。`);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{view.name}</h3>
          <StatusBadge status={status} />
        </div>
        <FieldDescription>{view.description}</FieldDescription>
        {oauthDisabled && (
          <p role="status" className="text-xs text-status-warning-fg">
            OAuth 機能が無効です (Preview 環境または管理者による停止)。値は保存されていますが、接続は行えません。
          </p>
        )}
        {incomplete && (
          <p role="status" className="text-xs text-status-warning-fg">
            必須項目が揃っていないため、この連携はまだ有効になっていません。
          </p>
        )}
        {status.source === "db" && (
          <p className="text-xs text-muted-foreground">最終更新: {formatUpdatedAt(status.updatedAt)}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <p>
          <span className="font-medium text-foreground">取得先: </span>
          {view.portal}
        </p>
        {view.urlsTitle && (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-foreground">{view.urlsTitle}</p>
            {view.urls.map((u) => (
              <CopyableUrl key={u.path} label={u.label} url={`${siteUrl}${u.path}`} />
            ))}
          </div>
        )}
        {view.note && <p>{view.note}</p>}
      </div>

      <form action={action} className="max-w-xl">
        <FieldGroup>
          {view.publicIdLabel && (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-public-id`}>{view.publicIdLabel}</FieldLabel>
              <Input
                id={`${idPrefix}-public-id`}
                name="publicId"
                defaultValue={status.publicId ?? ""}
                maxLength={200}
                autoComplete="off"
                required
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-secret`}>{view.secretLabel}</FieldLabel>
            <Input
              id={`${idPrefix}-secret`}
              name="secret"
              type="password"
              maxLength={500}
              autoComplete="new-password"
              placeholder={
                status.source === "db" && status.secretSet
                  ? `設定済み (末尾 ****${status.secretLast4 ?? ""})。変更する場合のみ入力`
                  : undefined
              }
            />
            {status.source === "db" && status.secretSet && (
              <FieldDescription>空欄のまま保存すると、保存済みのシークレットを維持します。</FieldDescription>
            )}
          </Field>
        </FieldGroup>
        <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" disabled={isPending || isDeleting}>
            {isPending ? "保存中..." : "保存"}
          </Button>
          {status.source === "db" && (
            <Button type="button" variant="destructive" onClick={runDelete} disabled={isPending || isDeleting}>
              {isDeleting ? "削除中..." : "削除"}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

export function IntegrationsTab({
  statuses,
  siteUrl,
  oauthEnabled,
}: {
  statuses: IntegrationStatus[];
  siteUrl: string;
  /** OAuth 接続機能のスイッチ (Preview 環境や管理者による停止で false)。page.tsx がサーバ側で解決する。 */
  oauthEnabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold">外部サービスの認証情報</h3>
        <FieldDescription>
          カレンダー同期・SNS 自動投稿・電話・メール送信に使う外部サービスの認証情報を登録します。
          ここで保存した値が最優先で使われ、未登録のサービスは環境変数の値 (あれば) が使われます。
          シークレットは暗号化して保存され、保存後は末尾 4 桁のみ表示されます。
        </FieldDescription>
      </div>
      {statuses.map((status) => (
        <IntegrationCard key={status.provider} status={status} siteUrl={siteUrl} oauthEnabled={oauthEnabled} />
      ))}
    </div>
  );
}
