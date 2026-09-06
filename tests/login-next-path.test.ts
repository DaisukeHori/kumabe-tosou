import { describe, expect, it } from "vitest";

import { isAllowedLoginNext, loginReasonMessage } from "@/app/admin/login/next-path";

/**
 * canonical: docs/design/visual-media-editor.md §5.3 (MINOR-v1.4)。
 * ログイン後の戻り先 (next パラメータ) は /admin /edit prefix の相対パスのみを許可し、
 * オープンリダイレクトを防ぐ。V2a 独立検証で追加したエッジケーステスト
 * (絶対 URL / プロトコル相対 URL / /admin 以外の拒否)。
 */
describe("isAllowedLoginNext", () => {
  it("/admin 配下は許可される", () => {
    expect(isAllowedLoginNext("/admin")).toBe(true);
    expect(isAllowedLoginNext("/admin/settings")).toBe(true);
  });

  it("/edit 配下は許可される", () => {
    expect(isAllowedLoginNext("/edit")).toBe(true);
    expect(isAllowedLoginNext("/edit/about")).toBe(true);
  });

  it("絶対 URL (http/https) は拒否される", () => {
    expect(isAllowedLoginNext("https://evil.com")).toBe(false);
    expect(isAllowedLoginNext("http://evil.com/admin")).toBe(false);
  });

  it("プロトコル相対 URL (//evil.com) は拒否される", () => {
    expect(isAllowedLoginNext("//evil.com")).toBe(false);
    expect(isAllowedLoginNext("//evil.com/admin")).toBe(false);
  });

  it("/admin /edit 以外の相対パスは拒否される", () => {
    expect(isAllowedLoginNext("/")).toBe(false);
    expect(isAllowedLoginNext("/works")).toBe(false);
    expect(isAllowedLoginNext("/../admin")).toBe(false);
  });

  it("空文字は拒否される", () => {
    expect(isAllowedLoginNext("")).toBe(false);
  });

  it("javascript: スキーム等は拒否される", () => {
    expect(isAllowedLoginNext("javascript:alert(1)")).toBe(false);
  });
});

/**
 * requireAdminPage (src/app/admin/_lib/require-admin-page.ts) が KMB-E202 を `reason=forbidden`
 * として /admin/login に送る経路の説明文言。ログインし直しても解決しないことを利用者に伝える。
 */
describe("loginReasonMessage", () => {
  it("forbidden は「管理者として登録されていない」旨の文言を返す", () => {
    const msg = loginReasonMessage("forbidden");
    expect(msg).not.toBeNull();
    expect(msg).toContain("管理者として登録されていません");
  });

  it("reason なし / 未知の reason は null (何も表示しない)", () => {
    expect(loginReasonMessage(undefined)).toBeNull();
    expect(loginReasonMessage(null)).toBeNull();
    expect(loginReasonMessage("")).toBeNull();
    expect(loginReasonMessage("expired")).toBeNull();
  });
});
