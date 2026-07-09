import type { Metadata } from "next";

import { isAllowedLoginNext } from "./next-path";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ログイン | 隈部塗装 CMS",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm next={next && isAllowedLoginNext(next) ? next : "/admin"} />;
}
