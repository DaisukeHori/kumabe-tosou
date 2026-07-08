"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// email/attempt は「失敗後にメールアドレス欄を再表示する」ための付随情報 (下記参照)。
export type LoginState = { error: string | null; email: string; attempt: number };

/**
 * /admin/login のログイン Server Action (設計書 §5.1)。
 * Supabase Auth の失敗 5 回で 15 分ロックは Supabase 標準機能に委ねる
 * (ここでは資格情報エラーをそのままメッセージ化するのみ)。
 *
 * React 19 の form action は「送信のたびに (成功/失敗を問わず) <form> をネイティブ
 * form.reset() でリセットする」ため、失敗時にメールアドレス欄まで空になり、
 * パスワードだけ直して再送信すると required 制約バリデーションで無言のまま
 * ブロックされる (直前のエラー表示が残ったままになるバグ)。
 * これを防ぐため、失敗時は送信された email と、再マウントを強制するための
 * attempt カウンタを state に含めて返す (login-form.tsx 側で
 * key={state.attempt} + defaultValue={state.email} として再表示に使う)。
 */
export async function loginAction(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextRaw = String(formData.get("next") ?? "/admin");
  const next = nextRaw.startsWith("/admin") ? nextRaw : "/admin";
  const attempt = prevState.attempt + 1;

  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください。", email, attempt };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "メールアドレスまたはパスワードが正しくありません。", email, attempt };
  }

  redirect(next);
}
