import { describe, expect, it } from "vitest";

import {
  escapeLikePattern,
  ilikeContainsFilter,
  quotePostgrestValue,
} from "@/lib/postgrest-filter";

/**
 * PostgREST .or() フィルタ値のクォート/エスケープ (src/lib/postgrest-filter.ts)。
 * カンマ・括弧を含む検索語で複合フィルタ構文が壊れないことが目的。
 */
describe("escapeLikePattern", () => {
  it("% _ \\ をバックスラッシュでエスケープする", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("c:\\dir")).toBe("c:\\\\dir");
  });

  it("その他の文字 (カンマ・括弧・引用符) は触らない", () => {
    expect(escapeLikePattern('a,b(c)"d"')).toBe('a,b(c)"d"');
  });
});

describe("quotePostgrestValue", () => {
  it("値を二重引用符で囲む", () => {
    expect(quotePostgrestValue("abc")).toBe('"abc"');
  });

  it("カンマ・括弧・ドットは引用符内でそのまま保持される", () => {
    expect(quotePostgrestValue("山田, 太郎 (株).jp")).toBe('"山田, 太郎 (株).jp"');
  });

  it("内部の \" と \\ をエスケープする", () => {
    expect(quotePostgrestValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quotePostgrestValue("back\\slash")).toBe('"back\\\\slash"');
  });

  it("\\ を先に処理するため \\\" の組み合わせでも二重エスケープにならない", () => {
    // 入力: \"  → 期待: \\\"  (バックスラッシュ 2 個 + エスケープ済み引用符)
    expect(quotePostgrestValue('\\"')).toBe('"\\\\\\""');
  });
});

describe("ilikeContainsFilter", () => {
  it("column.ilike.\"%q%\" の形を返す", () => {
    expect(ilikeContainsFilter("name", "太郎")).toBe('name.ilike."%太郎%"');
  });

  it("カンマ・括弧を含む検索語でもフィルタ区切りとして漏れない", () => {
    const f = ilikeContainsFilter("name", "a,b(c)");
    expect(f).toBe('name.ilike."%a,b(c)%"');
    // 引用符の外側にカンマ・括弧が出ないこと
    expect(f.replace(/"[^"]*"/, "")).toBe("name.ilike.");
  });

  it("LIKE パターン文字と引用符の両方が順にエスケープされる", () => {
    // LIKE エスケープで % → \%、_ → \_、\ → \\ になり、その後の引用符クォートで
    // バックスラッシュが二重化 (\% → \\%) し、" は \" になる。
    expect(ilikeContainsFilter("email", '50%_"x"\\')).toBe(
      'email.ilike."%50\\\\%\\\\_\\"x\\"\\\\\\\\%"',
    );
  });

  it("複数列を連結しても .or() 用の区切りが保たれる", () => {
    const q = "a,b";
    const joined = [ilikeContainsFilter("name", q), ilikeContainsFilter("kana", q)].join(",");
    expect(joined).toBe('name.ilike."%a,b%",kana.ilike."%a,b%"');
  });
});
