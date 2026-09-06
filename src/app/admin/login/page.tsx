import type { Metadata } from "next";

import { isAllowedLoginNext, loginReasonMessage } from "./next-path";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ログイン | 山岸塗装 CMS",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return (
    <LoginForm
      next={next && isAllowedLoginNext(next) ? next : "/admin"}
      notice={loginReasonMessage(reason)}
    />
  );
}
