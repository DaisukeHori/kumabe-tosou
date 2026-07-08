import { describe, expect, it } from "vitest";

import { chunkedDiff, onlyChangedChunks } from "@/app/admin/studio/diff";

/**
 * 差分チャンク化の単体テスト (canonical: docs/design/cms-ai-pipeline.md §10.2)。
 * 「段落単位でチャンク化してから文字 diff」の共通接頭辞/接尾辞アルゴリズムを検証する。
 */
describe("studio diff (chunkedDiff)", () => {
  it("完全に同一のテキストは全チャンクが変更なし", () => {
    const text = "段落1\n\n段落2";
    const chunks = chunkedDiff(text, text);
    expect(chunks.every((c) => !c.changed)).toBe(true);
    expect(chunks.map((c) => c.parts[0].value)).toEqual(["段落1", "段落2"]);
  });

  it("中間の段落だけが変わった場合、前後は変更なしチャンクとして分離される", () => {
    const oldText = "共通の冒頭\n\n古い中身\n\n共通の末尾";
    const newText = "共通の冒頭\n\n新しい中身\n\n共通の末尾";
    const chunks = chunkedDiff(oldText, newText);
    expect(chunks[0]).toEqual({ changed: false, parts: [{ value: "共通の冒頭" }] });
    expect(chunks[chunks.length - 1]).toEqual({ changed: false, parts: [{ value: "共通の末尾" }] });
    const changedChunks = chunks.filter((c) => c.changed);
    expect(changedChunks).toHaveLength(1);
    const addedText = changedChunks[0].parts.filter((p) => p.added).map((p) => p.value).join("");
    const removedText = changedChunks[0].parts.filter((p) => p.removed).map((p) => p.value).join("");
    // diffChars は文字単位の最小差分を返すため、共通の文字 ("い" 等) は
    // added/removed のどちらにも現れないことがある。差分の方向性のみ検証する。
    expect(addedText).toContain("新");
    expect(removedText).toContain("古");
  });

  it("全く異なるテキストは単一の changed チャンクになる", () => {
    const chunks = chunkedDiff("これは元の文章です", "全く別の文章になりました");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].changed).toBe(true);
  });

  it("巨大な絵文字混じりテキストでも例外を投げない (サロゲートペア境界)", () => {
    const oldText = "😀".repeat(500) + "\n\n通常の段落";
    const newText = "😀".repeat(499) + "😢" + "\n\n通常の段落";
    expect(() => chunkedDiff(oldText, newText)).not.toThrow();
  });

  it("onlyChangedChunks は変更ありチャンクのみを返す (変更のみ表示トグル)", () => {
    const oldText = "共通\n\n古い";
    const newText = "共通\n\n新しい";
    const chunks = chunkedDiff(oldText, newText);
    const filtered = onlyChangedChunks(chunks);
    expect(filtered.every((c) => c.changed)).toBe(true);
    expect(filtered.length).toBeLessThan(chunks.length);
  });

  it("一方が空文字列でも例外を投げない", () => {
    expect(() => chunkedDiff("", "新規追加テキスト")).not.toThrow();
    expect(() => chunkedDiff("削除されるテキスト", "")).not.toThrow();
  });

  it("両方空文字列は差分なし (変更チャンクを生成しない)", () => {
    const chunks = chunkedDiff("", "");
    expect(chunks.every((c) => !c.changed)).toBe(true);
  });
});
