import { describe, expect, it } from "vitest";

import { secretEquals } from "@/lib/secret-compare";

/**
 * 共有シークレットの定数時間比較 (src/lib/secret-compare.ts)。
 * /api/jobs/* の x-jobs-secret と /api/revalidate の x-revalidate-secret が共通で使う。
 */
describe("secretEquals", () => {
  it("同一文字列なら true", () => {
    expect(secretEquals("correct-secret", "correct-secret")).toBe(true);
  });

  it("不一致なら false (先頭一致・末尾一致いずれも)", () => {
    expect(secretEquals("correct-secreT", "correct-secret")).toBe(false);
    expect(secretEquals("Xorrect-secret", "correct-secret")).toBe(false);
  });

  it("長さが違っても例外にならず false (sha256 で固定長に潰してから比較)", () => {
    expect(secretEquals("short", "a-much-longer-secret-value")).toBe(false);
    expect(secretEquals("a-much-longer-secret-value", "short")).toBe(false);
    expect(secretEquals("", "secret")).toBe(false);
  });

  it("expected が未設定/空なら provided に関わらず常に false", () => {
    expect(secretEquals("", undefined)).toBe(false);
    expect(secretEquals("", "")).toBe(false);
    expect(secretEquals("anything", undefined)).toBe(false);
    expect(secretEquals(undefined, undefined)).toBe(false);
  });

  it("provided が null/undefined なら false", () => {
    expect(secretEquals(null, "secret")).toBe(false);
    expect(secretEquals(undefined, "secret")).toBe(false);
  });

  it("マルチバイト文字も正しく比較できる", () => {
    expect(secretEquals("秘密🔑", "秘密🔑")).toBe(true);
    expect(secretEquals("秘密🔑", "秘密🔒")).toBe(false);
  });
});
