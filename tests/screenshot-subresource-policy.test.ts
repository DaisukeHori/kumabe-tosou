import { describe, expect, it } from "vitest";

/**
 * canonical: docs/design/ai-studio-v2.md §11 (SSRF 対策 MAJOR-5)。
 *
 * subresource-policy.ts の純関数のみを検証する (実 Chromium・実ネットワークは一切叩かない)。
 * capture.ts (puppeteer-core / @sparticuz/chromium / sharp を import する側) は経由しない。
 */

import {
  decideMainFrameDocumentRequest,
  isAllowedSubresource,
  isSameOriginAsSite,
} from "@/lib/screenshot/subresource-policy";

const OPTIONS = {
  siteOrigin: "https://yamagishi-tosou.example.com",
  storageOrigin: "https://abcdefgh.supabase.co",
};

describe("isAllowedSubresource: SSRF 対策 (§11 MAJOR-5)", () => {
  it("自オリジンの画像 URL は許可する", () => {
    expect(isAllowedSubresource("https://yamagishi-tosou.example.com/images/hero.webp", OPTIONS)).toBe(true);
  });

  it("自オリジンの script / stylesheet も許可する (オリジン一致のみで判定するため resourceType を問わない)", () => {
    expect(isAllowedSubresource("https://yamagishi-tosou.example.com/_next/static/app.js", OPTIONS)).toBe(true);
    expect(isAllowedSubresource("https://yamagishi-tosou.example.com/styles.css", OPTIONS)).toBe(true);
  });

  it("Supabase Storage オリジンの画像 URL は許可する", () => {
    expect(
      isAllowedSubresource(
        "https://abcdefgh.supabase.co/storage/v1/object/public/media/photo.webp",
        OPTIONS,
      ),
    ).toBe(true);
  });

  it("Supabase Storage と別のサブドメイン (プロジェクト違い) は拒否する", () => {
    expect(
      isAllowedSubresource("https://other-project.supabase.co/storage/v1/object/public/x.webp", OPTIONS),
    ).toBe(false);
  });

  it("外部 https URL (自オリジン・Storage 以外) は拒否する", () => {
    expect(isAllowedSubresource("https://evil.example/tracker.js", OPTIONS)).toBe(false);
  });

  it("同一ホストでもポート違いは別オリジンとして拒否する", () => {
    expect(isAllowedSubresource("https://yamagishi-tosou.example.com:8443/x.png", OPTIONS)).toBe(false);
  });

  it("同一ホストでもスキーム違い (http vs https) は別オリジンとして拒否する", () => {
    expect(isAllowedSubresource("http://yamagishi-tosou.example.com/x.png", OPTIONS)).toBe(false);
  });

  it("別ホスト (サブドメイン違い含む) は拒否する", () => {
    expect(isAllowedSubresource("https://cdn.yamagishi-tosou.example.com/x.png", OPTIONS)).toBe(false);
  });

  it("内部/メタデータサーバーを狙う URL (169.254.169.254 等) も自オリジン以外として拒否する", () => {
    expect(isAllowedSubresource("http://169.254.169.254/latest/meta-data/", OPTIONS)).toBe(false);
  });

  it("file: スキームは拒否する (http/https 以外の egress 手段)", () => {
    expect(isAllowedSubresource("file:///etc/passwd", OPTIONS)).toBe(false);
  });

  it("data: スキームは許可する (インラインデータでネットワーク egress が発生しないため)", () => {
    expect(isAllowedSubresource("data:image/png;base64,iVBORw0KGgo=", OPTIONS)).toBe(true);
  });

  it("blob: スキームは許可する (生成元コンテキストのメモリ内オブジェクト参照であり SSRF 経路にならないため)", () => {
    expect(isAllowedSubresource("blob:https://yamagishi-tosou.example.com/uuid-1234", OPTIONS)).toBe(true);
  });

  it("blob: URL 内に他オリジン文字列が埋め込まれていても許可する (blob URL は生成元コンテキストにスコープされ実データの取得元にはならないため)", () => {
    expect(isAllowedSubresource("blob:https://evil.example/uuid-9999", OPTIONS)).toBe(true);
  });

  it("パース不能な URL は fail-closed で拒否する", () => {
    expect(isAllowedSubresource("not a url", OPTIONS)).toBe(false);
  });

  it("空文字列は拒否する", () => {
    expect(isAllowedSubresource("", OPTIONS)).toBe(false);
  });
});

describe("isSameOriginAsSite: リダイレクト検証 (§11「リダイレクトは同一オリジンのみ許可」)", () => {
  const siteOrigin = OPTIONS.siteOrigin;

  it("最終 URL が自オリジンと一致すれば true", () => {
    expect(isSameOriginAsSite("https://yamagishi-tosou.example.com/about", siteOrigin)).toBe(true);
  });

  it("最終 URL が別オリジンにリダイレクトされていれば false (撮影前に拒否する対象)", () => {
    expect(isSameOriginAsSite("https://evil.example/about", siteOrigin)).toBe(false);
  });

  it("スキームだけ違う場合も別オリジンとして false", () => {
    expect(isSameOriginAsSite("http://yamagishi-tosou.example.com/about", siteOrigin)).toBe(false);
  });

  it("パース不能な URL は fail-closed で false", () => {
    expect(isSameOriginAsSite("not a url", siteOrigin)).toBe(false);
  });
});

describe("decideMainFrameDocumentRequest: リダイレクトの各ホップを自オリジンに限定する (§11)", () => {
  const siteOrigin = OPTIONS.siteOrigin;

  it("最初のナビゲーション (redirectChain 長 0) は URL を問わず continue (route-key.ts で検証済み)", () => {
    expect(decideMainFrameDocumentRequest("https://yamagishi-tosou.example.com/works", 0, siteOrigin)).toBe("continue");
  });

  it("自オリジンへのリダイレクトホップは continue", () => {
    expect(decideMainFrameDocumentRequest("https://yamagishi-tosou.example.com/works/new-slug", 1, siteOrigin)).toBe(
      "continue",
    );
  });

  it("別オリジンへのリダイレクトホップは abort (リダイレクト先へのリクエスト自体を発生させない)", () => {
    expect(decideMainFrameDocumentRequest("https://evil.example/collect", 1, siteOrigin)).toBe("abort");
  });

  it("内部メタデータサーバー等へのリダイレクトも abort", () => {
    expect(decideMainFrameDocumentRequest("http://169.254.169.254/latest/meta-data/", 1, siteOrigin)).toBe("abort");
  });

  it("スキーム / ポート違いは別オリジンとして abort", () => {
    expect(decideMainFrameDocumentRequest("http://yamagishi-tosou.example.com/works", 1, siteOrigin)).toBe("abort");
    expect(decideMainFrameDocumentRequest("https://yamagishi-tosou.example.com:8443/works", 2, siteOrigin)).toBe(
      "abort",
    );
  });

  it("多段リダイレクト (長 2 以上) でも各ホップごとに同じ判定を適用する", () => {
    expect(decideMainFrameDocumentRequest("https://yamagishi-tosou.example.com/a", 3, siteOrigin)).toBe("continue");
    expect(decideMainFrameDocumentRequest("https://cdn.yamagishi-tosou.example.com/a", 3, siteOrigin)).toBe("abort");
  });

  it("パース不能な URL のホップは fail-closed で abort", () => {
    expect(decideMainFrameDocumentRequest("not a url", 1, siteOrigin)).toBe("abort");
  });
});
