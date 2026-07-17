"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { NoticePanel, Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChannelAccountView, ChannelAuthStatus } from "@/modules/distribution/contracts";

import { saveNoteSessionCookieAction, updateNoteAccountAction } from "./actions";
import { CHANNELS_FORM_INITIAL_STATE } from "./form-state";

// note セッション Cookie の実測有効期間 (research/ai-studio-v2/note-posting.md): 約30日
const NOTE_COOKIE_EXPIRY_DAYS = 30;

const AUTH_STATUS_LABEL: Record<ChannelAuthStatus, string> = {
  disconnected: "未接続",
  connected: "接続済み",
  expired: "要再接続 (失効)",
  error: "エラー",
};

// [#127 R6a] 接続状態を R0 status Badge variant へ意味写像する
// (接続済=success / 失効=warning / エラー=urgent / 未接続=neutral)。
function authStatusBadgeVariant(status: ChannelAuthStatus): "success" | "warning" | "urgent" | "neutral" {
  if (status === "connected") return "success";
  if (status === "error") return "urgent";
  if (status === "expired") return "warning";
  return "neutral";
}

function findAccount(accounts: ChannelAccountView[], channel: string): ChannelAccountView | null {
  return accounts.find((a) => a.channel === channel) ?? null;
}

export function ChannelConnectionCards({
  accounts,
  xEnabled,
  metaEnabled,
}: {
  accounts: ChannelAccountView[];
  xEnabled: boolean;
  metaEnabled: boolean;
}) {
  const x = findAccount(accounts, "x");
  const instagram = findAccount(accounts, "instagram");
  const note = findAccount(accounts, "note");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Surface className="p-4">
          <div className="flex items-center justify-between">
            <p className="font-heading text-sm font-semibold">X (旧 Twitter)</p>
            <Badge variant={authStatusBadgeVariant(x?.auth_status ?? "disconnected")}>
              {AUTH_STATUS_LABEL[x?.auth_status ?? "disconnected"]}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{x?.account_label ?? "未接続"}</p>
          {!xEnabled && (
            <p className="mt-2 text-xs text-status-warning-fg">
              OAuth 未設定です (OAUTH_ENABLED / X_CLIENT_ID 等の env を設定してください)。
            </p>
          )}
          {xEnabled ? (
            <a href="/api/oauth/x/start" className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
              {x?.auth_status === "connected" ? "再接続" : "接続する"}
            </a>
          ) : (
            <Button size="sm" className="mt-3" disabled>
              接続する
            </Button>
          )}
        </Surface>

        <Surface className="p-4">
          <div className="flex items-center justify-between">
            <p className="font-heading text-sm font-semibold">Instagram</p>
            <Badge variant={authStatusBadgeVariant(instagram?.auth_status ?? "disconnected")}>
              {AUTH_STATUS_LABEL[instagram?.auth_status ?? "disconnected"]}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{instagram?.account_label ?? "未接続"}</p>
          {!metaEnabled && (
            <p className="mt-2 text-xs text-status-warning-fg">
              OAuth 未設定です (OAUTH_ENABLED / META_APP_ID 等の env を設定してください)。
            </p>
          )}
          {metaEnabled ? (
            <a href="/api/oauth/meta/start" className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
              {instagram?.auth_status === "connected" ? "再接続" : "接続する"}
            </a>
          ) : (
            <Button size="sm" className="mt-3" disabled>
              接続する
            </Button>
          )}
        </Surface>
      </div>

      <NoteAccountCard note={note} />
    </div>
  );
}

/** cookie_saved_at (~30日目安) から残り日数を計算する。保存記録が無い/不正なら null */
function cookieDaysRemaining(cookieSavedAt: unknown): number | null {
  if (typeof cookieSavedAt !== "string") return null;
  const savedAt = new Date(cookieSavedAt);
  if (Number.isNaN(savedAt.getTime())) return null;
  const expiresAt = savedAt.getTime() + NOTE_COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
}

function NoteAccountCard({ note }: { note: ChannelAccountView | null }) {
  const [state, action, isPending] = useActionState(updateNoteAccountAction, CHANNELS_FORM_INITIAL_STATE);
  const [cookieState, cookieAction, isCookiePending] = useActionState(
    saveNoteSessionCookieAction,
    CHANNELS_FORM_INITIAL_STATE,
  );

  useEffect(() => {
    if (state.success) toast.success("note の設定を保存しました。");
  }, [state.success]);
  useEffect(() => {
    if (cookieState.success) toast.success("note セッション Cookie を保存しました。");
  }, [cookieState.success]);

  const profileUrl = typeof note?.meta.profile_url === "string" ? note.meta.profile_url : "";
  const hasCookie = Boolean(note?.meta.cookie_saved_at);
  const daysRemaining = cookieDaysRemaining(note?.meta.cookie_saved_at);

  return (
    <Surface className="p-4">
      <div className="flex items-center justify-between">
        <p className="font-heading text-sm font-semibold">note</p>
        <Badge variant={authStatusBadgeVariant(note?.auth_status ?? "disconnected")}>
          {AUTH_STATUS_LABEL[note?.auth_status ?? "disconnected"]}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        公式投稿 API が無いため、コピペ支援 (配信キュー内) に加えて非公式 API による
        「下書き作成まで」の自動化に対応しています (公開は手動)。
      </p>

      <form action={action} className="mt-3">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="note-account-label" className="text-xs">
              表示名 (例: @kumabe_tosou)
            </FieldLabel>
            <Input
              id="note-account-label"
              name="account_label"
              defaultValue={note?.account_label ?? ""}
              maxLength={50}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="note-profile-url" className="text-xs">
              プロフィール URL (任意)
            </FieldLabel>
            <Input id="note-profile-url" name="profile_url" defaultValue={profileUrl} placeholder="https://note.com/..." />
          </Field>
        </FieldGroup>
        {state.error && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
        <Button type="submit" size="sm" className="mt-3" disabled={isPending}>
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>

      <NoticePanel tone="warning" title="下書き自動作成のリスク (常時表示)" className="mt-4 text-xs">
        非公式 API を使用しています。note 側の仕様変更・規約運用により、予告なくアカウント停止
        (売上金没収を含む) のリスクがあります。下書き作成のみ (公開は行いません) のため
        相対的にリスクは低いですが、ゼロではありません。ご了承のうえご利用ください。
      </NoticePanel>

      <form action={cookieAction} className="mt-4">
        <Field>
          <FieldLabel htmlFor="note-session-cookie" className="text-xs">
            note セッション Cookie (下書き自動作成用・任意)
          </FieldLabel>
          <Textarea
            id="note-session-cookie"
            name="cookie"
            rows={3}
            placeholder="_note_session_v5=...; note_gql_auth_token=...; XSRF-TOKEN=..."
            className="font-mono text-xs"
          />
          <FieldDescription>
            note.com にログインした状態でブラウザの DevTools (Network タブ) から任意のリクエストの
            Cookie ヘッダ値をそのままコピーして貼り付けてください。Vault に暗号化保存され、
            画面に平文で表示されることはありません。有効期間の目安は約 {NOTE_COOKIE_EXPIRY_DAYS} 日で、
            期限が近づいたら再登録が必要です (reCAPTCHA v3 必須化により自動更新はできません)。
          </FieldDescription>
        </Field>
        {hasCookie && (
          <p className="mt-2 text-xs text-muted-foreground">
            {daysRemaining !== null
              ? daysRemaining > 0
                ? `登録済み (あと約 ${daysRemaining} 日で失効の目安)`
                : "登録済み (有効期限の目安を過ぎています。再登録を推奨します)"
              : "登録済み"}
          </p>
        )}
        {cookieState.error && <p className="mt-2 text-xs text-destructive">{cookieState.error}</p>}
        <Button type="submit" size="sm" variant="outline" className="mt-3" disabled={isCookiePending}>
          {isCookiePending ? "保存中..." : "Cookie を保存"}
        </Button>
      </form>
    </Surface>
  );
}
