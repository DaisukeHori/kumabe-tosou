import { describe, expect, it } from "vitest";

import {
  buildRevalidateBody,
  buildRevalidateHeaders,
  buildRevalidateRequestUrl,
  parseTagsArg,
  requireRevalidateSecret,
  resolveTargetUrl,
} from "../scripts/revalidate-tags";

/**
 * scripts/revalidate-tags.ts の純関数単体テスト
 * (docs/design/crm-suite/06-simulator.md §16.2 S1-3 に対応する P1〜P3 の受入条件の一部)。
 * URL/ヘッダ/ボディ組み立てと secret 未設定時の fail-closed のみを検証する
 * (§6.3: 単体テストは純関数部のみ。fetch を伴う main() の実行は対象外)。
 */

describe("parseTagsArg", () => {
  it("引数を渡さない場合はエラーになる", () => {
    expect(() => parseTagsArg([])).toThrow();
  });

  it("1 個以上の tag をそのまま返す", () => {
    expect(parseTagsArg(["prices"])).toEqual(["prices"]);
    expect(parseTagsArg(["prices", "works"])).toEqual(["prices", "works"]);
  });
});

describe("requireRevalidateSecret (fail-closed)", () => {
  it("未設定 (undefined) はエラーになる", () => {
    expect(() => requireRevalidateSecret(undefined)).toThrow();
  });

  it("空文字もエラーになる", () => {
    expect(() => requireRevalidateSecret("")).toThrow();
  });

  it("設定済みならそのまま返す", () => {
    expect(requireRevalidateSecret("s3cr3t")).toBe("s3cr3t");
  });
});

describe("resolveTargetUrl", () => {
  it("REVALIDATE_TARGET_URL が優先される", () => {
    expect(
      resolveTargetUrl({
        targetUrlEnv: "https://target.example.com",
        siteUrlEnv: "https://site.example.com",
      }),
    ).toBe("https://target.example.com");
  });

  it("REVALIDATE_TARGET_URL 省略時は NEXT_PUBLIC_SITE_URL にフォールバックする", () => {
    expect(
      resolveTargetUrl({ targetUrlEnv: undefined, siteUrlEnv: "https://site.example.com" }),
    ).toBe("https://site.example.com");
  });

  it("両方未設定はエラーになる", () => {
    expect(() => resolveTargetUrl({ targetUrlEnv: undefined, siteUrlEnv: undefined })).toThrow();
  });
});

describe("buildRevalidateRequestUrl", () => {
  it("ベース URL の末尾に /api/revalidate を付与する", () => {
    expect(buildRevalidateRequestUrl("https://kumabe-tosou.vercel.app")).toBe(
      "https://kumabe-tosou.vercel.app/api/revalidate",
    );
  });

  it("末尾スラッシュがあっても二重にならない", () => {
    expect(buildRevalidateRequestUrl("https://kumabe-tosou.vercel.app/")).toBe(
      "https://kumabe-tosou.vercel.app/api/revalidate",
    );
  });
});

describe("buildRevalidateHeaders", () => {
  it("content-type と x-revalidate-secret を含む", () => {
    expect(buildRevalidateHeaders("s3cr3t")).toEqual({
      "content-type": "application/json",
      "x-revalidate-secret": "s3cr3t",
    });
  });
});

describe("buildRevalidateBody", () => {
  it("tags 配列をそのまま { tags } に包む", () => {
    expect(buildRevalidateBody(["prices"])).toEqual({ tags: ["prices"] });
    expect(buildRevalidateBody(["prices", "works"])).toEqual({ tags: ["prices", "works"] });
  });
});
