import { describe, expect, it } from "vitest";

import {
  computeWindowStart,
  extractClientIp,
  hashIp,
  isHoneypotFilled,
  isRateLimited,
  isSubmittedTooFast,
  RATE_LIMIT_MAX_PER_HOUR,
} from "@/components/contact/spam-guard";

/**
 * contact フォームのスパム対策・rate limit ロジックの単体テスト
 * (cms-ai-pipeline.md §3.3)。時刻はすべて引数として注入可能な設計になっているため、
 * 実時計に依存せず境界値を検証できる。
 */

describe("isHoneypotFilled", () => {
  it("空文字・空白のみは honeypot 未入力として扱う", () => {
    expect(isHoneypotFilled("")).toBe(false);
    expect(isHoneypotFilled("   ")).toBe(false);
  });

  it("何か入力されていれば bot とみなす", () => {
    expect(isHoneypotFilled("http://spam.example")).toBe(true);
  });
});

describe("isSubmittedTooFast", () => {
  it("表示から3秒未満の送信は bot とみなす (境界値: 2999ms)", () => {
    const formRenderedAt = 1_000_000;
    expect(
      isSubmittedTooFast({ formRenderedAt, submittedAt: formRenderedAt + 2999 }),
    ).toBe(true);
  });

  it("ちょうど3000msは許可する (境界値)", () => {
    const formRenderedAt = 1_000_000;
    expect(
      isSubmittedTooFast({ formRenderedAt, submittedAt: formRenderedAt + 3000 }),
    ).toBe(false);
  });

  it("3秒以上経過していれば bot 扱いしない", () => {
    const formRenderedAt = 1_000_000;
    expect(
      isSubmittedTooFast({ formRenderedAt, submittedAt: formRenderedAt + 10_000 }),
    ).toBe(false);
  });

  it("閾値 (minMs) を注入できる", () => {
    const formRenderedAt = 0;
    expect(
      isSubmittedTooFast({ formRenderedAt, submittedAt: 500, minMs: 1000 }),
    ).toBe(true);
    expect(
      isSubmittedTooFast({ formRenderedAt, submittedAt: 1500, minMs: 1000 }),
    ).toBe(false);
  });
});

describe("computeWindowStart (rate limit の 1 時間集計単位)", () => {
  it("同じ時間帯 (UTC) の異なる分・秒は同じ window_start に floor される", () => {
    const a = new Date("2026-07-08T10:00:00.000Z");
    const b = new Date("2026-07-08T10:59:59.999Z");
    expect(computeWindowStart(a).toISOString()).toBe(computeWindowStart(b).toISOString());
    expect(computeWindowStart(a).toISOString()).toBe("2026-07-08T10:00:00.000Z");
  });

  it("時が変わると window_start も変わる", () => {
    const a = new Date("2026-07-08T10:59:59.999Z");
    const b = new Date("2026-07-08T11:00:00.000Z");
    expect(computeWindowStart(a).toISOString()).not.toBe(computeWindowStart(b).toISOString());
  });
});

describe("isRateLimited", () => {
  it(`${RATE_LIMIT_MAX_PER_HOUR} 件未満は許可、${RATE_LIMIT_MAX_PER_HOUR} 件以上は拒否 (境界値)`, () => {
    expect(isRateLimited(RATE_LIMIT_MAX_PER_HOUR - 1)).toBe(false);
    expect(isRateLimited(RATE_LIMIT_MAX_PER_HOUR)).toBe(true);
    expect(isRateLimited(RATE_LIMIT_MAX_PER_HOUR + 1)).toBe(true);
  });

  it("上限を明示的に注入できる", () => {
    expect(isRateLimited(2, 3)).toBe(false);
    expect(isRateLimited(3, 3)).toBe(true);
  });
});

describe("hashIp", () => {
  it("同じ IP + salt は同じ hash になる (決定的)", () => {
    expect(hashIp("203.0.113.1", "salt-a")).toBe(hashIp("203.0.113.1", "salt-a"));
  });

  it("salt が違えば hash も変わる (生 IP を保持しないための salt 付与)", () => {
    expect(hashIp("203.0.113.1", "salt-a")).not.toBe(hashIp("203.0.113.1", "salt-b"));
  });

  it("IP が違えば hash も変わる", () => {
    expect(hashIp("203.0.113.1", "salt-a")).not.toBe(hashIp("203.0.113.2", "salt-a"));
  });

  it("生の IP 文字列を含まない (SHA-256 hex 64桁)", () => {
    const hash = hashIp("203.0.113.1", "salt-a");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.1");
  });
});

describe("extractClientIp", () => {
  it("x-forwarded-for の先頭 IP を採用する (プロキシ経由の複数 IP)", () => {
    expect(extractClientIp("203.0.113.1, 10.0.0.1", null)).toBe("203.0.113.1");
  });

  it("x-forwarded-for が無ければ x-real-ip を使う", () => {
    expect(extractClientIp(null, "203.0.113.9")).toBe("203.0.113.9");
  });

  it("どちらも無ければ unknown を返す", () => {
    expect(extractClientIp(null, null)).toBe("unknown");
    expect(extractClientIp("", "")).toBe("unknown");
  });
});
