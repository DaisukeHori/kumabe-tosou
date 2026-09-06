"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { loginAction, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { error: null, email: "", attempt: 0 };

export function LoginForm({ next, notice = null }: { next: string; notice?: string | null }) {
  const [state, formAction, isPending] = useActionState(loginAction, INITIAL_STATE);

  return (
    // [#118 R1] モックの login 画面トーン (中央カード 360px / R0 トークン)。
    // フォームのロジック (useActionState / next hidden / key リマウント) は不変。
    <Card data-help="login-card" className="w-full max-w-[360px] shadow-surface">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-base font-extrabold text-sidebar-accent-foreground"
            aria-hidden="true"
          >
            山
          </div>
          <div className="leading-tight">
            <CardTitle className="text-[15px] font-extrabold">山岸塗装 しごと管理</CardTitle>
            <CardDescription className="text-xs text-admin-text-meta">管理者ログイン</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {notice ? (
          // requireAdminPage が reason=forbidden (KMB-E202: 非 admin) で送ってきた場合の説明
          <p
            role="status"
            data-help="login-notice"
            className="mb-4 rounded-md border border-admin-border bg-muted px-3 py-2 text-xs text-admin-text-meta"
          >
            {notice}
          </p>
        ) : null}
        <form action={formAction}>
          <input type="hidden" name="next" value={next} />
          <FieldGroup>
            <Field data-invalid={!!state.error}>
              <FieldLabel htmlFor="login-email">メールアドレス</FieldLabel>
              {/*
                React 19 の form action は送信のたびに (成功/失敗を問わず) <form> を
                ネイティブ form.reset() でリセットする。この Input が uncontrolled の
                ままだと、1 回目の送信でパスワードを間違えた際に email 欄まで空になり、
                正しいパスワードだけ入力し直して再送信しても HTML5 の required 制約
                バリデーションで無言のままブロックされ、直前のエラー表示だけが
                残り続けて「ログインしても直らない」ように見えるバグがあった。
                key={state.attempt} で送信ごとに再マウントさせ、
                defaultValue={state.email} で直前に送信された値を復元することで、
                reset で消えた値を再送信のたびに埋め直す。
              */}
              <Input
                key={state.attempt}
                id="login-email"
                data-help="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={state.email}
                aria-invalid={!!state.error}
              />
            </Field>
            <Field data-invalid={!!state.error}>
              <FieldLabel htmlFor="login-password">パスワード</FieldLabel>
              <Input
                id="login-password"
                data-help="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={!!state.error}
              />
              <FieldError
                data-help="login-error"
                errors={state.error ? [{ message: state.error }] : undefined}
              />
            </Field>
          </FieldGroup>
          <Button data-help="login-submit" type="submit" disabled={isPending} className="mt-6 w-full font-bold">
            {isPending ? "ログイン中..." : "ログイン"}
          </Button>
        </form>
        <p data-help="login-forgot" className="mt-4 text-xs text-admin-text-meta">
          パスワードを忘れた場合は管理担当者に連絡してください。
        </p>
        {/* ヘルプ (docs/design/admin-help/README.md §2): ログイン画面には ? ボタンを出さず、
            ここから「ログインできないとき」のヘルプへ誘導する (/help/login は未ログインでも開ける)。 */}
        <p className="mt-1 text-xs">
          <Link
            href="/help/login"
            data-help="login-help-link"
            target="kmb-help"
            className="text-admin-text-meta underline underline-offset-4"
          >
            ログインできないとき
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
