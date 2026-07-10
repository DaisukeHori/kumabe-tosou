import Link from "next/link";

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
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

export const NAV_ITEMS = [
  {
    no: "01",
    label: "ストーリー",
    href: "/story",
    noSlotKey: "common.header.nav.1.no",
    labelSlotKey: "common.header.nav.1.label",
  },
  {
    no: "02",
    label: "会社案内",
    href: "/about",
    noSlotKey: "common.header.nav.2.no",
    labelSlotKey: "common.header.nav.2.label",
  },
  {
    no: "03",
    label: "サービス・料金",
    href: "/service",
    noSlotKey: "common.header.nav.3.no",
    labelSlotKey: "common.header.nav.3.label",
  },
  {
    no: "04",
    label: "施工事例",
    href: "/works",
    noSlotKey: "common.header.nav.4.no",
    labelSlotKey: "common.header.nav.4.label",
  },
  {
    no: "05",
    label: "お客様の声",
    href: "/voices",
    noSlotKey: "common.header.nav.5.no",
    labelSlotKey: "common.header.nav.5.label",
  },
  {
    no: "06",
    label: "素材対応",
    href: "/materials",
    noSlotKey: "common.header.nav.6.no",
    labelSlotKey: "common.header.nav.6.label",
  },
  {
    no: "07",
    label: "色見本",
    href: "/colors",
    noSlotKey: "common.header.nav.7.no",
    labelSlotKey: "common.header.nav.7.label",
  },
  {
    no: "08",
    label: "読みもの",
    href: "/notes",
    noSlotKey: "common.header.nav.8.no",
    labelSlotKey: "common.header.nav.8.label",
  },
  {
    no: "09",
    label: "SHOP",
    href: "/shop",
    noSlotKey: "common.header.nav.9.no",
    labelSlotKey: "common.header.nav.9.label",
  },
] as const;

/**
 * shared.cta.consult (route 横断の共有スロット) の配線 (canonical:
 * docs/design/visual-text-editor.md §4.1 MAJOR-1)。デスクトップ nav・モバイル nav の
 * 両方に同一スロットが登場するため、hotspot id はエディタ側 (T2b) が ordinal で分離する。
 * v2 Wave 1 (W1-1): ブランド名/ナビラベル/ナビ番号も common.header.* スロットとして配線する
 * (`texts` = resolveAllTexts() の全件を丸ごと受け取り、内部で slotKey ごとに引く)。
 */
export function SiteHeader({
  texts,
  editMode,
}: {
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <header className="kt-vt-header kt-header-edge sticky top-0 z-50 border-b border-hair bg-primer/80 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="flex items-baseline gap-3 leading-none">
          <SlotText
            slotKey="common.header.brand"
            resolved={texts["common.header.brand"]}
            editMode={editMode}
            className="text-xl font-bold tracking-[0.16em] text-carbon"
          />
          <SlotText
            slotKey="common.header.brand.en"
            resolved={texts["common.header.brand.en"]}
            editMode={editMode}
            className="hidden font-mono text-[9px] font-semibold tracking-[0.3em] text-carbon-soft sm:inline"
          />
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
                    <SlotText
                      slotKey={item.noSlotKey}
                      resolved={texts[item.noSlotKey]}
                      editMode={editMode}
                      className="kt-nav-no font-mono text-[10px] text-carbon-soft"
                    />
                    <SlotText
                      slotKey={item.labelSlotKey}
                      resolved={texts[item.labelSlotKey]}
                      editMode={editMode}
                    />
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
            <SlotText
              slotKey="shared.cta.consult"
              resolved={texts["shared.cta.consult"]}
              editMode={editMode}
            />
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
            <span className="kt-nav-toggle" aria-hidden="true">
              <span />
              <span />
            </span>
          </SheetTrigger>
          <SheetContent side="right" className="bg-paper">
            <SheetHeader>
              <SheetTitle className="tracking-[0.16em]">
                <SlotText
                  slotKey="common.header.brand"
                  resolved={texts["common.header.brand"]}
                  editMode={editMode}
                />
              </SheetTitle>
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
                  <SlotText
                    slotKey={item.noSlotKey}
                    resolved={texts[item.noSlotKey]}
                    editMode={editMode}
                    className="kt-nav-no font-mono text-[10px] text-carbon-soft"
                  />
                  <SlotText
                    slotKey={item.labelSlotKey}
                    resolved={texts[item.labelSlotKey]}
                    editMode={editMode}
                  />
                </SheetClose>
              ))}
              <SheetClose
                render={<Link href="/contact" />}
                className="mt-4 flex items-center justify-center bg-carbon py-3 text-sm tracking-[0.12em] text-paper"
              >
                <SlotText
                  slotKey="shared.cta.consult"
                  resolved={texts["shared.cta.consult"]}
                  editMode={editMode}
                />
              </SheetClose>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
      <PaintProgress />
    </header>
  );
}
