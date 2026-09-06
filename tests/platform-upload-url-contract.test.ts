import { describe, expect, it } from "vitest";

import { isAllowedUploadContentType, zCreateUploadUrlReq } from "@/modules/platform/contracts";

/**
 * zCreateUploadUrlReq (契約書 §4.7 / cms-ai-pipeline.md §3.5 /api/upload-url) の kind 別 MIME 検証。
 *
 * 回帰: 旧スキーマは content_type を長さ 100 以下の任意文字列として受理していたため、
 * kind=media (media-originals バケット) に text/html 等を署名付き URL で置けた。
 * media は image/*、audio は audio/* のみ受理する。
 */

const MEDIA_BASE = { kind: "media" as const, filename: "photo.png", content_type: "image/png", size_bytes: 1024 };
const AUDIO_BASE = { kind: "audio" as const, filename: "memo.webm", content_type: "audio/webm", size_bytes: 1024 };

function messages(input: unknown): string[] {
  const parsed = zCreateUploadUrlReq.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
}

describe("isAllowedUploadContentType", () => {
  it("media は image/* のみ", () => {
    expect(isAllowedUploadContentType("media", "image/png")).toBe(true);
    expect(isAllowedUploadContentType("media", "IMAGE/JPEG")).toBe(true);
    expect(isAllowedUploadContentType("media", "image/webp; q=1")).toBe(true);
    expect(isAllowedUploadContentType("media", "audio/webm")).toBe(false);
    expect(isAllowedUploadContentType("media", "text/html")).toBe(false);
    expect(isAllowedUploadContentType("media", "image/")).toBe(false);
    expect(isAllowedUploadContentType("media", "")).toBe(false);
  });

  it("audio は audio/* のみ", () => {
    expect(isAllowedUploadContentType("audio", "audio/webm")).toBe(true);
    expect(isAllowedUploadContentType("audio", "audio/mpeg")).toBe(true);
    expect(isAllowedUploadContentType("audio", "image/png")).toBe(false);
    expect(isAllowedUploadContentType("audio", "video/mp4")).toBe(false);
  });
});

describe("zCreateUploadUrlReq: kind 別 MIME 制約", () => {
  it("kind=media + image/* は通る", () => {
    expect(zCreateUploadUrlReq.safeParse(MEDIA_BASE).success).toBe(true);
  });

  it("kind=audio + audio/* は通る", () => {
    expect(zCreateUploadUrlReq.safeParse(AUDIO_BASE).success).toBe(true);
  });

  it("kind=media に text/html は拒否 (path は content_type)", () => {
    const parsed = zCreateUploadUrlReq.safeParse({ ...MEDIA_BASE, content_type: "text/html" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0].path).toEqual(["content_type"]);
      expect(parsed.error.issues[0].message).toContain("content_type");
    }
  });

  it("kind=media に audio/* は拒否、kind=audio に image/* は拒否", () => {
    expect(zCreateUploadUrlReq.safeParse({ ...MEDIA_BASE, content_type: "audio/webm" }).success).toBe(false);
    expect(zCreateUploadUrlReq.safeParse({ ...AUDIO_BASE, content_type: "image/png" }).success).toBe(false);
  });

  it("前段 (型 / サイズ上限) に issue がある場合は MIME の issue を重ねて報告しない (when)", () => {
    // サイズ上限違反 + MIME 違反: 先行 refine の issue のみ
    const overSize = messages({ ...MEDIA_BASE, content_type: "text/html", size_bytes: 11 * 1024 * 1024 });
    expect(overSize).toHaveLength(1);
    expect(overSize[0]).toContain("サイズ上限");

    // 型エラー (size_bytes 0) + MIME 違反: 型エラーのみ
    const typeError = messages({ ...MEDIA_BASE, content_type: "text/html", size_bytes: 0 });
    expect(typeError.some((m) => m.includes("content_type"))).toBe(false);
  });

  it("既存のサイズ上限 (audio 50MB / media 10MB) は維持", () => {
    expect(zCreateUploadUrlReq.safeParse({ ...MEDIA_BASE, size_bytes: 10 * 1024 * 1024 }).success).toBe(true);
    expect(zCreateUploadUrlReq.safeParse({ ...MEDIA_BASE, size_bytes: 10 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(zCreateUploadUrlReq.safeParse({ ...AUDIO_BASE, size_bytes: 50 * 1024 * 1024 }).success).toBe(true);
    expect(zCreateUploadUrlReq.safeParse({ ...AUDIO_BASE, size_bytes: 50 * 1024 * 1024 + 1 }).success).toBe(false);
  });
});
