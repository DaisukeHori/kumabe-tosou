import { Reveal } from "@/components/site/reveal";

/**
 * 公開一覧の 0 件状態 (cms-ai-pipeline.md §2.3)。
 * DB 未投入 / 該当コンテンツなしをエラーではなく「準備中」として表示する。
 * works/notes/blog/voices の各一覧ページで共用する (新規ファイル。既存コンポーネントは変更しない)。
 */
export function EmptyState({
  label = "STATUS — PREPARING",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <Reveal as="div" className="border border-hair bg-paper p-8 sm:p-10">
      <span className="font-mono text-[11px] tracking-[0.22em] text-soul">{label}</span>
      <p className="mt-5 text-[15px] leading-[2.1] text-carbon-mid">{children}</p>
    </Reveal>
  );
}
