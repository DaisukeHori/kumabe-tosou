import type { Metadata } from "next";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { PaperNoise } from "@/components/motion/paper-noise";
import { pageMediaFacade } from "@/modules/page-media/facade";
import type { ResolvedText } from "@/modules/page-media/contracts";

/**
 * `/edit/**` (編集プレビュー専用ルート) のレイアウト。
 * canonical: docs/design/visual-media-editor.md §5.3。
 *
 * - (site) と同じ SiteHeader/Footer 構成にして、iframe 越しに見たときの見た目を一致させる。
 * - metadata.robots で index/follow を禁止 (admin 限定の編集プレビューであり検索に出さない)。
 * - LocalBusiness JSON-LD は公開 (site) レイアウト固有のものなのでここには含めない
 *   (編集プレビューは検索エンジンに出ないため構造化データは不要)。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * shared.cta.consult / chrome.footer.tagline の配線 (canonical:
 * docs/design/visual-text-editor.md §4.1 MAJOR-1)。/edit は resolveAllTextsFresh()
 * (キャッシュ非経由) を editMode=true で SiteHeader/SiteFooter に渡す。
 */
export default async function EditorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const textsResult = await pageMediaFacade.resolveAllTextsFresh();
  const texts = textsResult.ok ? textsResult.value : {};
  const ctaText: ResolvedText = texts["shared.cta.consult"];
  const footerTagline: ResolvedText = texts["chrome.footer.tagline"];

  return (
    <>
      <PaperNoise />
      <SiteHeader ctaText={ctaText} editMode={true} />
      <main className="flex-1">{children}</main>
      <SiteFooter footerTagline={footerTagline} editMode={true} />
    </>
  );
}
