import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/ai-studio-v2.md §5 (フルページスクショ基盤) / §11 (SSRF 対策)。
 *
 * routeKey の検証・URL 組み立てロジック (src/lib/screenshot/route-key.ts) のみを検証する。
 * 実 Chromium・実 API は一切叩かない (page-media/facade の EDITABLE_ROUTES はモックに差し替え、
 * env も固定値に差し替える)。
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://kumabe-tosou.example.com" }),
}));

vi.mock("@/modules/page-media/facade", () => ({
  EDITABLE_ROUTES: ["/", "/about", "/notes", "works/[slug]", "notes/[slug]"],
}));

import { buildScreenshotTargetUrl, validateRouteKey, zScreenshotRequest } from "@/lib/screenshot/route-key";

describe("zScreenshotRequest", () => {
  it("routeKey が空文字列は拒否する", () => {
    expect(zScreenshotRequest.safeParse({ routeKey: "" }).success).toBe(false);
  });

  it("routeKey 以外の余分なフィールドは strict() で拒否する", () => {
    expect(zScreenshotRequest.safeParse({ routeKey: "/about", url: "https://evil.example" }).success).toBe(
      false,
    );
  });

  it("正常な routeKey 文字列は受け付ける (実在確認は validateRouteKey の責務)", () => {
    expect(zScreenshotRequest.safeParse({ routeKey: "/about" }).success).toBe(true);
  });
});

describe("validateRouteKey: SSRF 対策 (§11 MAJOR-5)", () => {
  it("EDITABLE_ROUTES に実在する静的ルートは受け付ける", () => {
    const result = validateRouteKey("/about");
    expect(result).toEqual({ ok: true, value: "/about" });
  });

  it("絶対 URL (スキーム付き) は拒否する", () => {
    const result = validateRouteKey("https://evil.example/phish");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("javascript: スキームも拒否する (スキーム全般を拒否)", () => {
    const result = validateRouteKey("javascript:alert(1)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("プロトコル相対 URL (//) は拒否する", () => {
    const result = validateRouteKey("//evil.example/about");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("クエリ付き入力は拒否する", () => {
    const result = validateRouteKey("/about?x=1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("フラグメント付き入力は拒否する", () => {
    const result = validateRouteKey("/about#section");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("エンコード済みスラッシュ (%2F) は拒否する", () => {
    const result = validateRouteKey("/about%2F..%2Fadmin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("エンコード済みバックスラッシュ (%5C) は拒否する", () => {
    const result = validateRouteKey("/about%5C..");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("生バックスラッシュは拒否する", () => {
    const result = validateRouteKey("/about\\..\\admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("動的ルートパターン ([slug] を含む) は本フェーズ未対応として拒否する", () => {
    const result = validateRouteKey("works/[slug]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("EDITABLE_ROUTES に存在しない静的パスは KMB-E107 (未知の routeKey) を返す", () => {
    const result = validateRouteKey("/nonexistent-route");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
  });

  it("先頭 '/' の無い相対パスは拒否する ('/' 始まりの静的ルートのみ許可)", () => {
    const result = validateRouteKey("about");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
  });

  it("パストラバーサル ('..' セグメント) は EDITABLE_ROUTES の完全一致比較で拒否する (KMB-E107)", () => {
    const result = validateRouteKey("/about/../secret");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
  });

  it("パストラバーサル (ルート直下からの脱出) も拒否する (KMB-E107)", () => {
    const result = validateRouteKey("/../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
  });

  it("制御文字 (タブ) を含む文字列は拒否する (WHATWG URL が除去し host injection を招き得るため)", () => {
    const result = validateRouteKey("/\t/evil.example/x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("制御文字 (改行) を含む文字列は拒否する", () => {
    const result = validateRouteKey("/about\n/evil.example");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("制御文字 (CR) を含む文字列は拒否する", () => {
    const result = validateRouteKey("/about\r/evil.example");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("二重エンコードされたスラッシュ (%252f) も EDITABLE_ROUTES の完全一致比較で拒否する", () => {
    const result = validateRouteKey("/about%252f..%252fadmin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
  });
});

describe("buildScreenshotTargetUrl: 常に SITE_URL のオリジンに解決される", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常な routeKey は SITE_URL 配下の絶対 URL になる", () => {
    const result = buildScreenshotTargetUrl("/about");
    expect(result).toEqual({ ok: true, value: "https://kumabe-tosou.example.com/about" });
  });

  it("ルート ('/') も SITE_URL のトップページに解決される", () => {
    const result = buildScreenshotTargetUrl("/");
    expect(result).toEqual({ ok: true, value: "https://kumabe-tosou.example.com/" });
  });

  it("不正な routeKey (絶対 URL) は URL を組み立てず検証エラーをそのまま返す", () => {
    const result = buildScreenshotTargetUrl("https://evil.example/about");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("不正な routeKey (//) はサーバー側で SITE_URL 以外のオリジンに解決されない", () => {
    // '//evil.example/about' を new URL(path, base) にそのまま渡すと 'https://evil.example/about'
    // に解決されてしまう (base の scheme を引き継ぐだけでホストは書き換わる) ため、
    // validateRouteKey の SUSPICIOUS_PATTERNS で事前に弾かれていることを確認する。
    const result = buildScreenshotTargetUrl("//evil.example/about");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("タブ文字混入による host injection (WHATWG URL の制御文字除去仕様) は URL 構築前に拒否される", () => {
    // new URL("/\t/evil.example/x", base) は WHATWG URL のパース仕様上タブが除去され
    // "https://evil.example/x" に解決されてしまう (下記アサーションで実測)。
    // buildScreenshotTargetUrl はこの入力を validateRouteKey の段階で拒否し、
    // 危険な new URL() 呼び出しに到達しないことを確認する。
    const dangerousInput = "/\t/evil.example/x";
    expect(new URL(dangerousInput, "https://kumabe-tosou.example.com").host).toBe("evil.example");

    const result = buildScreenshotTargetUrl(dangerousInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });
});
