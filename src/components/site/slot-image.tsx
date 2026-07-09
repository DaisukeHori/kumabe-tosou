import Image from "next/image";

import { cn } from "@/lib/utils";
import { SLOT_REGISTRY, type PageSlot } from "@/modules/page-media/facade";
import type { ResolvedSlot } from "@/modules/page-media/contracts";

import { slotEditableAttrs } from "./editable-attrs";

/**
 * ページスロット画像コンポーネント (canonical: docs/design/visual-media-editor.md §4.2)。
 *
 * - context は使わない (RSC で不可)。slotKey + resolved + editMode を props で受け取る。
 * - registry (SLOT_REGISTRY) から aspect/sizes/priority を引き `<Image>` を描画する。
 * - editMode===true のときだけ data-editable-slot / data-editable-media /
 *   data-editable-default を出力する (公開 (site) ページは常に editMode=false を渡すため、
 *   公開 HTML に data 属性のコードパス自体が存在しない — §4.3)。
 * - resolved.src が null (= 未来枠かつ未設定) のときは MediaCover 準拠の
 *   「NO IMAGE」プレースホルダを表示する。editMode のときは「画像を設定」の導線も添える
 *   (実際のクリック処理は /admin/visual 側 (V2b) の責務)。
 */

type SlotAspect = PageSlot["aspect"];

const ASPECT_CONFIG: Record<SlotAspect, { className: string; sizes: string }> = {
  hero: { className: "aspect-[21/9]", sizes: "(max-width: 1240px) 100vw, 1240px" },
  band219: { className: "aspect-[21/9]", sizes: "(max-width: 1240px) 100vw, 1240px" },
  card34: { className: "aspect-[3/4]", sizes: "(max-width: 640px) 100vw, 400px" },
  card32: { className: "aspect-[3/2]", sizes: "(max-width: 640px) 100vw, 600px" },
  square: { className: "aspect-square", sizes: "(max-width: 640px) 100vw, 600px" },
};

const SLOTS_BY_KEY: ReadonlyMap<string, PageSlot> = new Map(SLOT_REGISTRY.map((s) => [s.key, s]));

export function SlotImage({
  slotKey,
  resolved,
  editMode,
  className,
}: {
  slotKey: string;
  resolved: ResolvedSlot;
  editMode: boolean;
  className?: string;
}) {
  const slot = SLOTS_BY_KEY.get(slotKey);
  if (!slot) {
    // registry に無い slot_key。ページボディからの誤った slotKey 指定を早期に発見するため
    // 安全側で明示的に落とす (公開ページの突合が正しければ到達しない)。
    throw new Error(`[SlotImage] SLOT_REGISTRY に存在しない slot_key です: ${slotKey}`);
  }

  const { className: aspectClass, sizes } = ASPECT_CONFIG[slot.aspect];
  const editableAttrs = slotEditableAttrs(slotKey, resolved, editMode);

  if (!resolved.src) {
    return (
      <div
        className={cn(
          "relative flex w-full cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden bg-hair/40",
          aspectClass,
          className,
        )}
        {...editableAttrs}
      >
        <span className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
          NO IMAGE
        </span>
        {editMode ? (
          <span className="font-mono text-[9px] tracking-[0.14em] text-soul">
            画像を設定
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("relative w-full overflow-hidden", aspectClass, className)} {...editableAttrs}>
      <Image
        src={resolved.src}
        alt={resolved.alt}
        fill
        priority={slot.priority}
        sizes={sizes}
        className="object-cover"
      />
    </div>
  );
}
