import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * works/posts/voices の cover 画像表示。
 * published だが画像未設定の場合は「既定プレースホルダ」表示にする
 * (cms-ai-pipeline.md §2.3: 「published + 画像なし → cover に既定プレースホルダ画像」)。
 * 新規ファイル (既存コンポーネントは変更しない)。
 */
export function MediaCover({
  src,
  alt,
  aspect = "aspect-[4/3]",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
}: {
  src: string | null;
  alt: string;
  aspect?: string;
  sizes?: string;
}) {
  if (!src) {
    return (
      <div
        className={cn(
          "relative flex w-full items-center justify-center overflow-hidden bg-hair/40",
          aspect,
        )}
      >
        <span className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
          NO IMAGE
        </span>
      </div>
    );
  }

  return (
    <div className={cn("relative w-full overflow-hidden", aspect)}>
      <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
    </div>
  );
}
