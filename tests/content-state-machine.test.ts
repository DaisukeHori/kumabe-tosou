import { describe, expect, it } from "vitest";

import { guardTransition } from "@/modules/content/internal/state-machine";

/**
 * cms-ai-pipeline.md §4.1 の全遷移 + 不正遷移拒否を検証する。
 *
 * ```
 * draft ──→ review ──→ published ──→ archived
 *   ▲          │            │
 *   └──────────┘            └──→ (published に戻す = 再公開可)
 * ```
 */

const NOW = new Date("2026-07-08T00:00:00.000Z");
const FUTURE = new Date("2026-08-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");
const ORIGINAL_PUBLISHED_AT = "2026-05-01T00:00:00.000Z";

describe("guardTransition: 正常な遷移", () => {
  it("draft → review", () => {
    const result = guardTransition({
      currentStatus: "draft",
      currentPublishedAt: null,
      to: "review",
      requestedPublishedAt: null,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, value: { status: "review", publishedAt: null } });
  });

  it("review → draft (差し戻し)", () => {
    const result = guardTransition({
      currentStatus: "review",
      currentPublishedAt: null,
      to: "draft",
      requestedPublishedAt: null,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, value: { status: "draft", publishedAt: null } });
  });

  it("review → published (published_at 未指定 = 即時公開、now を採用)", () => {
    const result = guardTransition({
      currentStatus: "review",
      currentPublishedAt: null,
      to: "published",
      requestedPublishedAt: null,
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "published", publishedAt: NOW.toISOString() },
    });
  });

  it("review → published (未来日時指定 = 予約公開、指定日時をそのまま採用)", () => {
    const result = guardTransition({
      currentStatus: "review",
      currentPublishedAt: null,
      to: "published",
      requestedPublishedAt: FUTURE.toISOString(),
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "published", publishedAt: FUTURE.toISOString() },
    });
  });

  it("review → published (過去日時指定は即時扱いに丸める = now を採用)", () => {
    const result = guardTransition({
      currentStatus: "review",
      currentPublishedAt: null,
      to: "published",
      requestedPublishedAt: PAST.toISOString(),
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "published", publishedAt: NOW.toISOString() },
    });
  });

  it("published → archived (published_at は不変)", () => {
    const result = guardTransition({
      currentStatus: "published",
      currentPublishedAt: ORIGINAL_PUBLISHED_AT,
      to: "archived",
      requestedPublishedAt: null,
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "archived", publishedAt: ORIGINAL_PUBLISHED_AT },
    });
  });

  it("archived → published (復帰: 元の published_at を維持する)", () => {
    const result = guardTransition({
      currentStatus: "archived",
      currentPublishedAt: ORIGINAL_PUBLISHED_AT,
      to: "published",
      requestedPublishedAt: null,
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "published", publishedAt: ORIGINAL_PUBLISHED_AT },
    });
  });
});

describe("guardTransition: 不正な遷移の拒否 (KMB-E101)", () => {
  const invalidTransitions: Array<{
    label: string;
    currentStatus: "draft" | "review" | "published" | "archived";
    to: "draft" | "review" | "published" | "archived";
  }> = [
    { label: "draft → published (review を飛ばす)", currentStatus: "draft", to: "published" },
    { label: "draft → archived", currentStatus: "draft", to: "archived" },
    { label: "draft → draft (自己遷移)", currentStatus: "draft", to: "draft" },
    { label: "review → review (自己遷移)", currentStatus: "review", to: "review" },
    { label: "review → archived (published を飛ばす)", currentStatus: "review", to: "archived" },
    { label: "published → draft", currentStatus: "published", to: "draft" },
    { label: "published → review", currentStatus: "published", to: "review" },
    { label: "published → published (自己遷移)", currentStatus: "published", to: "published" },
    { label: "archived → draft", currentStatus: "archived", to: "draft" },
    { label: "archived → review", currentStatus: "archived", to: "review" },
    { label: "archived → archived (自己遷移)", currentStatus: "archived", to: "archived" },
  ];

  for (const { label, currentStatus, to } of invalidTransitions) {
    it(label, () => {
      const result = guardTransition({
        currentStatus,
        currentPublishedAt: null,
        to,
        requestedPublishedAt: null,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("KMB-E101");
    });
  }
});

describe("guardTransition: published_at 指定に関する不正入力の拒否", () => {
  it("archived → published で published_at を指定すると拒否される (元の日時を維持する仕様のため)", () => {
    const result = guardTransition({
      currentStatus: "archived",
      currentPublishedAt: ORIGINAL_PUBLISHED_AT,
      to: "published",
      requestedPublishedAt: FUTURE.toISOString(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("published → archived で published_at を指定すると拒否される", () => {
    const result = guardTransition({
      currentStatus: "published",
      currentPublishedAt: ORIGINAL_PUBLISHED_AT,
      to: "archived",
      requestedPublishedAt: FUTURE.toISOString(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("draft → review で published_at を指定すると拒否される", () => {
    const result = guardTransition({
      currentStatus: "draft",
      currentPublishedAt: null,
      to: "review",
      requestedPublishedAt: FUTURE.toISOString(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });

  it("review → draft で published_at を指定すると拒否される", () => {
    const result = guardTransition({
      currentStatus: "review",
      currentPublishedAt: null,
      to: "draft",
      requestedPublishedAt: FUTURE.toISOString(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
  });
});
