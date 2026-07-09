"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { isCurrentPath } from "./path-current";

/**
 * 現在地属性付き Link。SiteHeader (Server Component) から
 * NavigationMenuLink / SheetClose の render prop に渡して使う。
 * data-current / aria-current は globals.css の .kt-nav-link 系が拾う。
 */
export function MotionNavLink({
  href,
  ...props
}: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const hrefStr =
    typeof href === "string" ? href : (href.pathname ?? "");
  const current = isCurrentPath(pathname, hrefStr);

  return (
    <Link
      href={href}
      data-current={current ? "true" : undefined}
      aria-current={current ? "page" : undefined}
      {...props}
    />
  );
}
