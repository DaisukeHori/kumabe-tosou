import Image from "next/image";

import { cn } from "@/lib/utils";

import { contentEditableAttrs, type ContentKind } from "./editable-attrs";

/**
 * works/posts/voices の cover 画像表示。
 * published だが画像未設定の場合は「既定プレースホルダ」表示にする
 * (cms-ai-pipeline.md §2.3: 「published + 画像なし → cover に既定プレースホルダ画像」)。
 *
 * V2a (docs/design/visual-media-editor.md §4.2): editMode=true のとき kind/id/mediaId から
 * data-editable-content="{kind}:{id}:cover" + data-editable-media を出力する
 * (data-editable-media は §6 の CAS 用 old_media_id としてオーバーレイが読む)。
 * editMode/kind/id を渡さない既存の呼び出しは従来どおり (data 属性なし)。
 */
export function MediaCover({
  src,
  alt,
  aspect = "aspect-[4/3]",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  editMode = false,
  kind,
  id,
  mediaId = null,
}: {
  src: string | null;
  alt: string;
  aspect?: string;
  sizes?: string;
  editMode?: boolean;
  kind?: ContentKind;
  id?: string;
  mediaId?: string | null;
}) {
  const editableAttrs = kind && id ? contentEditableAttrs(kind, id, mediaId, editMode) : {};

  if (!src) {
    return (
      <div
        className={cn(
          "relative flex w-full items-center justify-center overflow-hidden bg-hair/40",
          aspect,
        )}
        {...editableAttrs}
      >
        <span className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
          NO IMAGE
        </span>
      </div>
    );
  }

  return (
    <div className={cn("relative w-full overflow-hidden", aspect)} {...editableAttrs}>
      <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
    </div>
  );
}
