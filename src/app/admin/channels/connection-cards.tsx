"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChannelAccountView, ChannelAuthStatus } from "@/modules/distribution/contracts";

import { updateNoteAccountAction } from "./actions";
import { CHANNELS_FORM_INITIAL_STATE } from "./form-state";

const AUTH_STATUS_LABEL: Record<ChannelAuthStatus, string> = {
  disconnected: "未接続",
  connected: "接続済み",
  expired: "要再接続 (失効)",
  error: "エラー",
};

function authStatusBadgeVariant(status: ChannelAuthStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "connected") return "default";
  if (status === "expired" || status === "error") return "destructive";
  return "outline";
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
    <div className="grid gap-4 md:grid-cols-3">
      <Surface className="p-4">
        <div className="flex items-center justify-between">
          <p className="font-heading text-sm font-semibold">X (旧 Twitter)</p>
          <Badge variant={authStatusBadgeVariant(x?.auth_status ?? "disconnected")}>
            {AUTH_STATUS_LABEL[x?.auth_status ?? "disconnected"]}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{x?.account_label ?? "未接続"}</p>
        {!xEnabled && (
          <p className="mt-2 text-xs text-amber-600">
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
          <p className="mt-2 text-xs text-amber-600">
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

      <NoteAccountCard note={note} />
    </div>
  );
}

function NoteAccountCard({ note }: { note: ChannelAccountView | null }) {
  const [state, action, isPending] = useActionState(updateNoteAccountAction, CHANNELS_FORM_INITIAL_STATE);

  useEffect(() => {
    if (state.success) toast.success("note の設定を保存しました。");
  }, [state.success]);

  const profileUrl = typeof note?.meta.profile_url === "string" ? note.meta.profile_url : "";

  return (
    <Surface className="p-4">
      <div className="flex items-center justify-between">
        <p className="font-heading text-sm font-semibold">note (半自動)</p>
        <Badge variant={authStatusBadgeVariant(note?.auth_status ?? "disconnected")}>
          {AUTH_STATUS_LABEL[note?.auth_status ?? "disconnected"]}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        公式投稿 API が無いため、コピペ支援 (配信キュー内) で手動投稿します。
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
    </Surface>
  );
}
