import Link from "next/link";

import { SlotText } from "@/components/site/slot-text";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

const MARQUEE_ITEMS = [
  { text: "研磨 · 塗装 · 3Dプリント表面処理", slotKey: "common.footer.marquee.1" },
  { text: "NATIONWIDE MAIL-IN", slotKey: "common.footer.marquee.2" },
  { text: "OITA BUNGOTAKADA", slotKey: "common.footer.marquee.3" },
  { text: "試作1点 — ブリッジ生産1,000個", slotKey: "common.footer.marquee.4" },
] as const;

const FOOTER_NAV = [
  {
    no: "00",
    label: "ホーム",
    href: "/",
    noSlotKey: "common.footer.nav.1.no",
    labelSlotKey: "common.footer.nav.1.label",
  },
  {
    no: "01",
    label: "ストーリー",
    href: "/story",
    noSlotKey: "common.footer.nav.2.no",
    labelSlotKey: "common.footer.nav.2.label",
  },
  {
    no: "02",
    label: "会社案内",
    href: "/about",
    noSlotKey: "common.footer.nav.3.no",
    labelSlotKey: "common.footer.nav.3.label",
  },
  {
    no: "03",
    label: "サービス・料金",
    href: "/service",
    noSlotKey: "common.footer.nav.4.no",
    labelSlotKey: "common.footer.nav.4.label",
  },
  {
    no: "04",
    label: "施工事例",
    href: "/works",
    noSlotKey: "common.footer.nav.5.no",
    labelSlotKey: "common.footer.nav.5.label",
  },
  {
    no: "05",
    label: "お客様の声",
    href: "/voices",
    noSlotKey: "common.footer.nav.6.no",
    labelSlotKey: "common.footer.nav.6.label",
  },
  {
    no: "06",
    label: "工程",
    href: "/process",
    noSlotKey: "common.footer.nav.7.no",
    labelSlotKey: "common.footer.nav.7.label",
  },
  {
    no: "07",
    label: "素材対応",
    href: "/materials",
    noSlotKey: "common.footer.nav.8.no",
    labelSlotKey: "common.footer.nav.8.label",
  },
  {
    no: "08",
    label: "色見本",
    href: "/colors",
    noSlotKey: "common.footer.nav.9.no",
    labelSlotKey: "common.footer.nav.9.label",
  },
  {
    no: "09",
    label: "読みもの",
    href: "/notes",
    noSlotKey: "common.footer.nav.10.no",
    labelSlotKey: "common.footer.nav.10.label",
  },
  {
    no: "10",
    label: "SHOP",
    href: "/shop",
    noSlotKey: "common.footer.nav.11.no",
    labelSlotKey: "common.footer.nav.11.label",
  },
  {
    no: "11",
    label: "相談する",
    href: "/contact",
    noSlotKey: "common.footer.nav.12.no",
    labelSlotKey: "common.footer.nav.12.label",
  },
] as const;

/**
 * chrome.footer.tagline (route 横断の共有スロット) の配線 (canonical:
 * docs/design/visual-text-editor.md §4.1 MAJOR-1)。kind=multiline のため SlotText の
 * root は常に div (v1.1 仕様) — 元は <p> だった要素を SlotText に丸ごと差し替える。
 * v2 Wave 1 (W1-1): マーキー/フッターナビ/住所/LEGAL/コピーライト/写真クレジット注記も
 * common.footer.* スロットとして配線する (`texts` = resolveAllTexts() の全件を丸ごと
 * 受け取り、内部で slotKey ごとに引く)。
 */
export function SiteFooter({
  texts,
  editMode,
}: {
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <footer className="kt-footer-ticks border-t border-hair bg-primer-deep text-carbon">
      <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <SlotText
              slotKey="common.footer.brand"
              resolved={texts["common.footer.brand"]}
              editMode={editMode}
              as="p"
              className="text-lg font-bold tracking-[0.16em]"
            />
            <SlotText
              slotKey="chrome.footer.tagline"
              resolved={texts["chrome.footer.tagline"]}
              editMode={editMode}
              className="mt-4 max-w-sm text-sm leading-7 text-carbon-mid"
            />
          </div>
          <nav aria-label="フッターナビゲーション">
            <SlotText
              slotKey="common.footer.sitemap.label"
              resolved={texts["common.footer.sitemap.label"]}
              editMode={editMode}
              as="p"
              className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            />
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
              {FOOTER_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-baseline gap-2 text-sm text-carbon-mid transition-colors hover:text-carbon"
                  >
                    <SlotText
                      slotKey={item.noSlotKey}
                      resolved={texts[item.noSlotKey]}
                      editMode={editMode}
                      className="font-mono text-[10px] text-carbon-soft"
                    />
                    <SlotText
                      slotKey={item.labelSlotKey}
                      resolved={texts[item.labelSlotKey]}
                      editMode={editMode}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <SlotText
              slotKey="common.footer.workshop.label"
              resolved={texts["common.footer.workshop.label"]}
              editMode={editMode}
              as="p"
              className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            />
            <SlotText
              slotKey="common.footer.address"
              resolved={texts["common.footer.address"]}
              editMode={editMode}
              as="address"
              className="mt-4 text-sm not-italic leading-7 text-carbon-mid"
            />
            <SlotText
              slotKey="common.footer.legal.label"
              resolved={texts["common.footer.legal.label"]}
              editMode={editMode}
              as="p"
              className="mt-5 font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            />
            <Link
              href="/tokushoho"
              className="mt-2 block text-sm text-carbon-mid transition-colors hover:text-carbon"
            >
              <SlotText
                slotKey="common.footer.legal.tokushoho"
                resolved={texts["common.footer.legal.tokushoho"]}
                editMode={editMode}
              />
            </Link>
            <Link
              href="/privacy"
              className="mt-2 block text-sm text-carbon-mid transition-colors hover:text-carbon"
            >
              <SlotText
                slotKey="common.footer.legal.privacy"
                resolved={texts["common.footer.legal.privacy"]}
                editMode={editMode}
              />
            </Link>
          </div>
        </div>

        <div
          className="kt-marquee mt-10 overflow-hidden border-y border-hair py-3.5"
          aria-hidden="true"
        >
          <div className="kt-marquee-track kt-marquee-track--footer font-mono text-[11px] tracking-[0.14em] text-carbon-mid">
            {[0, 1].map((rep) => (
              <span key={rep} className="flex items-center">
                {MARQUEE_ITEMS.map((item, i) => (
                  <span key={`${rep}-${i}`} className="flex items-center">
                    <span className="px-[1.4em]">
                      <SlotText
                        slotKey={item.slotKey}
                        resolved={texts[item.slotKey]}
                        editMode={editMode}
                      />
                    </span>
                    <span className="px-[1.4em] text-soul">✳</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <p
          aria-hidden="true"
          className="kt-footer-giant mt-8 select-none overflow-hidden whitespace-nowrap font-mono text-[clamp(40px,9vw,110px)] font-semibold leading-none tracking-[0.08em]"
        >
          <SlotText
            slotKey="common.footer.giant"
            resolved={texts["common.footer.giant"]}
            editMode={editMode}
          />
        </p>

        <div className="mt-8 flex flex-col gap-2 border-t border-hair-soft pt-6 font-mono text-[11px] tracking-[0.14em] text-carbon-soft sm:flex-row sm:justify-between">
          <SlotText
            slotKey="common.footer.copyright"
            resolved={texts["common.footer.copyright"]}
            editMode={editMode}
          />
          <SlotText
            slotKey="common.footer.copyright.sub"
            resolved={texts["common.footer.copyright.sub"]}
            editMode={editMode}
          />
        </div>
        <SlotText
          slotKey="common.footer.creditNote"
          resolved={texts["common.footer.creditNote"]}
          editMode={editMode}
          className="mt-6 font-mono text-[10px] leading-5 text-carbon-soft"
        />
      </div>
    </footer>
  );
}
