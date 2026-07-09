import Link from "next/link";

const MARQUEE_ITEMS = [
  "研磨 · 塗装 · 3Dプリント表面処理",
  "NATIONWIDE MAIL-IN",
  "OITA BUNGOTAKADA",
  "試作1点 — ブリッジ生産1,000個",
] as const;

const FOOTER_NAV = [
  { no: "00", label: "ホーム", href: "/" },
  { no: "01", label: "ストーリー", href: "/story" },
  { no: "02", label: "会社案内", href: "/about" },
  { no: "03", label: "サービス・料金", href: "/service" },
  { no: "04", label: "施工事例", href: "/works" },
  { no: "05", label: "お客様の声", href: "/voices" },
  { no: "06", label: "工程", href: "/process" },
  { no: "07", label: "素材対応", href: "/materials" },
  { no: "08", label: "色見本", href: "/colors" },
  { no: "09", label: "読みもの", href: "/notes" },
  { no: "10", label: "SHOP", href: "/shop" },
  { no: "11", label: "相談する", href: "/contact" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-hair bg-primer-deep text-carbon">
      <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <p className="text-lg font-bold tracking-[0.16em]">隈部塗装</p>
            <p className="mt-4 max-w-sm text-sm leading-7 text-carbon-mid">
              3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。
            </p>
          </div>
          <nav aria-label="フッターナビゲーション">
            <p className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              SITEMAP
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
              {FOOTER_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-baseline gap-2 text-sm text-carbon-mid transition-colors hover:text-carbon"
                  >
                    <span className="font-mono text-[10px] text-carbon-soft">
                      {item.no}
                    </span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              WORKSHOP
            </p>
            <address className="mt-4 text-sm not-italic leading-7 text-carbon-mid">
              隈部塗装(代表: 隈部 信之)
              <br />
              大分県豊後高田市
              <br />
              郵送受託・全国対応
            </address>
            <p className="mt-5 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              LEGAL
            </p>
            <Link
              href="/tokushoho"
              className="mt-2 block text-sm text-carbon-mid transition-colors hover:text-carbon"
            >
              特定商取引法に基づく表記
            </Link>
            <Link
              href="/privacy"
              className="mt-2 block text-sm text-carbon-mid transition-colors hover:text-carbon"
            >
              プライバシーポリシー
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
                    <span className="px-[1.4em]">{item}</span>
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
          KUMABE TOSO
        </p>

        <div className="mt-8 flex flex-col gap-2 border-t border-hair-soft pt-6 font-mono text-[11px] tracking-[0.14em] text-carbon-soft sm:flex-row sm:justify-between">
          <span>© 2026 KUMABE TOSO. ALL RIGHTS RESERVED.</span>
          <span>3D PRINT SURFACE FINISHING — OITA, JAPAN</span>
        </div>
        <p className="mt-6 font-mono text-[10px] leading-5 text-carbon-soft">
          掲載写真は Unsplash
          の商用利用可能なイメージ素材で、各写真のクレジットはキャプションに記載しています。これらは隈部塗装の工房・制作事例の写真ではなく、あくまでイメージです(実際の写真は準備中)。
        </p>
      </div>
    </footer>
  );
}
