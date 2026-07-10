import { Reveal } from "@/components/site/reveal";
import { textEditableAttrs } from "@/components/site/editable-attrs";

/**
 * 公開一覧の 0 件状態 (cms-ai-pipeline.md §2.3)。
 * DB 未投入 / 該当コンテンツなしをエラーではなく「準備中」として表示する。
 * works/notes/blog/voices の各一覧ページで共用する (新規ファイル。既存コンポーネントは変更しない)。
 *
 * v2 Wave 1 (works): `label` ("STATUS — PREPARING" 等) をビジュアルテキストエディタで
 * 編集可能にするため、page-blocks.tsx の SectionMark/CtaBand と同型の capability-only
 * 追加 (`labelSlotKey` + `editMode`、共に optional・既定は従来通り data-editable-text を
 * 出さない) を行う。既存呼び出し側 (blog/notes/voices) は無改修で後方互換。
 */
export function EmptyState({
  label = "STATUS — PREPARING",
  labelSlotKey,
  editMode = false,
  children,
}: {
  label?: string;
  labelSlotKey?: string;
  editMode?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Reveal as="div" className="border border-hair bg-paper p-8 sm:p-10">
      <span
        className="font-mono text-[11px] tracking-[0.22em] text-soul"
        {...(labelSlotKey ? textEditableAttrs(labelSlotKey, editMode) : {})}
      >
        {label}
      </span>
      <p className="mt-5 text-[15px] leading-[2.1] text-carbon-mid">{children}</p>
    </Reveal>
  );
}
