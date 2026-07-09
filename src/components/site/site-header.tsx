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
import { MotionNavLink } from "@/components/motion/nav-link";
import { PaintProgress } from "@/components/motion/paint-progress";

export const NAV_ITEMS = [
  { no: "01", label: "ストーリー", href: "/story" },
  { no: "02", label: "会社案内", href: "/about" },
  { no: "03", label: "サービス・料金", href: "/service" },
  { no: "04", label: "施工事例", href: "/works" },
  { no: "05", label: "お客様の声", href: "/voices" },
  { no: "06", label: "素材対応", href: "/materials" },
  { no: "07", label: "色見本", href: "/colors" },
  { no: "08", label: "読みもの", href: "/notes" },
  { no: "09", label: "SHOP", href: "/shop" },
] as const;

export function SiteHeader() {
  return (
    <header className="kt-vt-header sticky top-0 z-50 border-b border-hair bg-primer/80 backdrop-blur-md">
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
                    render={<MotionNavLink href={item.href} />}
                    className="kt-nav-link gap-1.5 rounded-none px-2.5 text-[13px] tracking-wider hover:bg-transparent focus:bg-transparent"
                  >
                    <span className="kt-nav-no font-mono text-[10px] text-carbon-soft">
                      {item.no}
                    </span>
                    {item.label}
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
          <Button
            variant="outline"
            render={<Link href="/contact" />}
            className="kt-btn-brush kt-btn-brush--cta ml-2 rounded-none border-carbon bg-transparent px-4 tracking-[0.12em] text-carbon hover:bg-transparent hover:text-paper focus-visible:text-paper"
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
                  render={<MotionNavLink href={item.href} />}
                  className="kt-nav-link-m flex items-baseline gap-3 border-b border-hair-soft py-3 text-sm tracking-wider text-carbon"
                >
                  <span className="kt-nav-no font-mono text-[10px] text-carbon-soft">
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
      <PaintProgress />
    </header>
  );
}
