"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { changePasswordAction } from "./account-actions";
import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";

/**
 * /admin/settings「アカウント」タブ。ログイン中ユーザーのパスワード変更フォーム。
 * 検証 (8〜128 文字・確認一致・現在と同一不可) はサーバ側 (account-actions.ts) が正とし、
 * ここでは minLength/maxLength の補助のみ行う。
 */
export function AccountTab({ email }: { email: string | null }) {
  const [state, action, isPending] = useActionState<SettingsFormState, FormData>(
    changePasswordAction,
    SETTINGS_FORM_INITIAL_STATE,
  );
  useEffect(() => {
    if (state.success) toast.success("パスワードを変更しました。");
  }, [state.success]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold">ログイン情報</h3>
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">メールアドレス: </span>
          <span className="font-medium">{email ?? "-"}</span>
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold">パスワード変更</h3>
          <FieldDescription>
            現在のパスワードで再確認した上で、新しいパスワードに変更します (8〜128 文字)。
          </FieldDescription>
        </div>
        {/* React 19 の form action は送信後に form をリセットするため、成功時にパスワード欄が自動で空になる */}
        <form action={action} className="max-w-md">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="account-current-password">現在のパスワード</FieldLabel>
              <Input
                id="account-current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-new-password">新しいパスワード</FieldLabel>
              <Input
                id="account-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-confirm-password">新しいパスワード (確認)</FieldLabel>
              <Input
                id="account-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
          </FieldGroup>
          <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
          <Button type="submit" disabled={isPending} className="mt-6">
            {isPending ? "変更中..." : "パスワードを変更"}
          </Button>
        </form>
      </section>
    </div>
  );
}
