/**
 * body (Markdown) の最小レンダラ。
 *
 * posts/works の body は管理画面 (Wave 2 以降) から Markdown として保存される想定だが、
 * 本格的な Markdown パーサ (remark 等) の導入は本タスク (Wave1-D: 公開側 DB 接続) の
 * スコープ外の新規重量級依存追加にあたるため、見出し・段落・改行・**強調** のみを
 * 対応する軽量レンダラを自前実装する (dangerouslySetInnerHTML は使わず、React 要素として
 * 組み立てるため XSS のリスクがない)。表・リンク等の高度な記法は素のテキストとして表示される。
 */
export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return (
    <>
      {blocks.map((block, i) => {
        const heading2 = block.match(/^##\s+(.*)$/);
        const heading1 = block.match(/^#\s+(.*)$/);
        if (heading2) {
          return (
            <h3 key={i} className="text-lg font-bold tracking-wider text-carbon">
              {renderInline(heading2[1])}
            </h3>
          );
        }
        if (heading1) {
          return (
            <h2 key={i} className="text-xl font-bold tracking-wider text-carbon">
              {renderInline(heading1[1])}
            </h2>
          );
        }
        return <p key={i}>{renderInline(block)}</p>;
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  lines.forEach((line, li) => {
    const segments = line.split(/(\*\*[^*]+\*\*)/g);
    segments.forEach((seg, si) => {
      if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
        nodes.push(<strong key={`${li}-${si}`}>{seg.slice(2, -2)}</strong>);
      } else if (seg.length > 0) {
        nodes.push(<span key={`${li}-${si}`}>{seg}</span>);
      }
    });
    if (li < lines.length - 1) {
      nodes.push(<br key={`${li}-br`} />);
    }
  });
  return nodes;
}
