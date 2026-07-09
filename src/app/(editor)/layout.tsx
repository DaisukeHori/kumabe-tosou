import type { Metadata } from "next";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { PaperNoise } from "@/components/motion/paper-noise";

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

export default function EditorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <PaperNoise />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
