"use client";

import Link from "next/link";

import {
  dispatchShopSelectGrade,
  type Grade,
} from "@/components/site/shop-simulator";

/*
  legacy/shop.html の <a class="btn" href="#sim" data-service="base"> の移植。
  クリックでシミュレータのグレードを事前選択してから #sim へスクロールする。
*/
export function ServiceSimLink({
  grade,
  className,
  children,
}: {
  grade: Grade;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href="#sim"
      className={className}
      onClick={() => dispatchShopSelectGrade(grade)}
    >
      {children}
    </Link>
  );
}
