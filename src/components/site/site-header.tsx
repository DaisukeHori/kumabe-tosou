import Link from "next/link";
import { MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export const NAV_ITEMS = [
  { no: "01", label: "ストーリー", href: "/story" },
  { no: "02", label: "会社案内", href: "/about" },
  { no: "03", label: "サービス・料金", href: "/service" },
  { no: "04", label: "素材対応", href: "/materials" },
  { no: "05", label: "色見本", href: "/colors" },
  { no: "06", label: "読みもの", href: "/notes" },
  { no: "07", label: "SHOP", href: "/shop" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-hair bg-primer/80 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="flex items-baseline gap-3 leading-none">
          <span className="text-xl font-bold tracking-[0.16em] text-carbon">
            隈部塗装
          </span>
          <span className="hidden font-mono text-[9px] font-semibold tracking-[0.3em] text-carbon-soft sm:inline">
            KUMABE TOSO
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-2 lg:flex">
          <NavigationMenu>
            <NavigationMenuList>
              {NAV_ITEMS.map((item) => (
                <NavigationMenuItem key={item.href}>
                  <NavigationMenuLink
                    render={<Link href={item.href} />}
                    className="gap-1.5 px-2.5 text-[13px] tracking-wider text-carbon hover:bg-carbon/5 focus:bg-carbon/5"
                  >
                    <span className="font-mono text-[10px] text-carbon-soft">
                      {item.no}
                    </span>
                    {item.label}
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
          <Button
            render={<Link href="/contact" />}
            className="ml-2 rounded-none bg-carbon px-4 tracking-[0.12em] text-paper hover:bg-carbon/85"
          >
            相談する
          </Button>
        </div>

        {/* Mobile nav */}
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="メニューを開く"
              />
            }
          >
            <MenuIcon className="size-5" />
          </SheetTrigger>
          <SheetContent side="right" className="bg-paper">
            <SheetHeader>
              <SheetTitle className="tracking-[0.16em]">隈部塗装</SheetTitle>
            </SheetHeader>
            <nav
              aria-label="メインナビゲーション"
              className="flex flex-col gap-1 px-4"
            >
              {NAV_ITEMS.map((item) => (
                <SheetClose
                  key={item.href}
                  render={<Link href={item.href} />}
                  className="flex items-baseline gap-3 border-b border-hair-soft py-3 text-sm tracking-wider text-carbon"
                >
                  <span className="font-mono text-[10px] text-carbon-soft">
                    {item.no}
                  </span>
                  {item.label}
                </SheetClose>
              ))}
              <SheetClose
                render={<Link href="/contact" />}
                className="mt-4 flex items-center justify-center bg-carbon py-3 text-sm tracking-[0.12em] text-paper"
              >
                相談する
              </SheetClose>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
