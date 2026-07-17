import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/admin-redesign/移行設計.md §4 (P6 6c 行)・§6 / GitHub Issue #129。
 * navBadgesFacade.getNavBadgeCounts の集計・認可・失敗時非表示縮退・タイムアウト縮退を検証する。
 *
 * getSessionAndClient / platformFacade.isAdmin / nav-badges/repository をモックし実 DB には
 * 接続しない (tests/crm-timeline-facade-degrade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const isAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: {
    isAdmin: (...args: unknown[]) => isAdminMock(...args),
  },
}));

const countUnhandledInquiriesMock = vi.fn();
const countReviewCallsMock = vi.fn();
const countDueOrOverdueTasksMock = vi.fn();
vi.mock("@/modules/nav-badges/repository", () => ({
  countUnhandledInquiries: (...args: unknown[]) => countUnhandledInquiriesMock(...args),
  countReviewCalls: (...args: unknown[]) => countReviewCallsMock(...args),
  countDueOrOverdueTasks: (...args: unknown[]) => countDueOrOverdueTasksMock(...args),
}));

import { NAV_BADGE_TIMEOUT_MS } from "@/modules/nav-badges/contracts";
import { navBadgesFacade } from "@/modules/nav-badges/facade";

const FAKE_CLIENT = { marker: "session-client" };

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: FAKE_CLIENT, user: { id: "user-1" } });
  isAdminMock.mockResolvedValue(true);
  countUnhandledInquiriesMock.mockResolvedValue({ ok: true, value: 0 });
  countReviewCallsMock.mockResolvedValue({ ok: true, value: 0 });
  countDueOrOverdueTasksMock.mockResolvedValue({ ok: true, value: 0 });
});

describe("navBadgesFacade.getNavBadgeCounts — 集計", () => {
  it("3 種の count を 1 回で束ねて返し、各 count に session client を渡す (DB 側集計へ委譲)", async () => {
    countUnhandledInquiriesMock.mockResolvedValue({ ok: true, value: 3 });
    countReviewCallsMock.mockResolvedValue({ ok: true, value: 2 });
    countDueOrOverdueTasksMock.mockResolvedValue({ ok: true, value: 5 });

    const result = await navBadgesFacade.getNavBadgeCounts();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ inquiries: 3, calls: 2, tasks: 5 });

    expect(countUnhandledInquiriesMock).toHaveBeenCalledTimes(1);
    expect(countReviewCallsMock).toHaveBeenCalledTimes(1);
    expect(countDueOrOverdueTasksMock).toHaveBeenCalledTimes(1);
    expect(countUnhandledInquiriesMock).toHaveBeenCalledWith(FAKE_CLIENT);
    expect(countReviewCallsMock).toHaveBeenCalledWith(FAKE_CLIENT);
    expect(countDueOrOverdueTasksMock).toHaveBeenCalledWith(FAKE_CLIENT);
  });

  it("0 件はそのまま 0 で返す (非表示化は UI 側の責務。facade は実数を返す)", async () => {
    const result = await navBadgesFacade.getNavBadgeCounts();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ inquiries: 0, calls: 0, tasks: 0 });
  });
});

describe("navBadgesFacade.getNavBadgeCounts — 認可", () => {
  it("未認証 (user なし) は KMB-E201 を返し、count を一切呼ばない", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: FAKE_CLIENT, user: null });

    const result = await navBadgesFacade.getNavBadgeCounts();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E201");
    expect(countUnhandledInquiriesMock).not.toHaveBeenCalled();
    expect(countReviewCallsMock).not.toHaveBeenCalled();
    expect(countDueOrOverdueTasksMock).not.toHaveBeenCalled();
  });

  it("非 admin は KMB-E202 を返し、count を一切呼ばない (権限なしを 0 件に化けさせない)", async () => {
    isAdminMock.mockResolvedValue(false);

    const result = await navBadgesFacade.getNavBadgeCounts();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E202");
    expect(countUnhandledInquiriesMock).not.toHaveBeenCalled();
  });
});

describe("navBadgesFacade.getNavBadgeCounts — 失敗時非表示縮退", () => {
  it("いずれか 1 つの count が err なら集計全体を KMB-E001 で失敗させる (全非表示に倒す。握り潰し禁止)", async () => {
    countUnhandledInquiriesMock.mockResolvedValue({ ok: true, value: 4 });
    countReviewCallsMock.mockResolvedValue({ ok: false, code: "KMB-E001", detail: "calls down" });
    countDueOrOverdueTasksMock.mockResolvedValue({ ok: true, value: 1 });

    const result = await navBadgesFacade.getNavBadgeCounts();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E001");
    expect(result.detail).toContain("calls down");
  });

  it("count 関数が例外を投げても KMB-E001 に丸めて Result で返す (レイアウトを壊さない)", async () => {
    countDueOrOverdueTasksMock.mockRejectedValue(new Error("unexpected boom"));

    const result = await navBadgesFacade.getNavBadgeCounts();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E001");
  });
});

describe("navBadgesFacade.getNavBadgeCounts — タイムアウト縮退", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("集計が性能予算 (NAV_BADGE_TIMEOUT_MS) を超過すると KMB-E002 で失敗する", async () => {
    vi.useFakeTimers();
    // 3 count のうち 1 つでも解決しないと Promise.all は永久保留 → タイムアウトが勝つ。
    countUnhandledInquiriesMock.mockResolvedValue({ ok: true, value: 1 });
    countReviewCallsMock.mockReturnValue(new Promise(() => {}));
    countDueOrOverdueTasksMock.mockResolvedValue({ ok: true, value: 1 });

    const pending = navBadgesFacade.getNavBadgeCounts();
    await vi.advanceTimersByTimeAsync(NAV_BADGE_TIMEOUT_MS + 50);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E002");
  });

  it("タイムアウト確定後に内部 Promise が遅れて reject しても unhandledRejection にならず E002 を返す", async () => {
    // 回帰ガード: withTimeout が then(onFulfilled, onRejected) を同期アタッチし、settle 済みへの
    // 遅延 reject を no-op に抑える設計が壊れると、タイムアウト後に遅れて reject する内部 count/認可の
    // rejection が未処理になる。ここでその未処理 rejection が発生しないことを明示的に確認する。
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    vi.useFakeTimers();
    try {
      // count の 1 つを、テスト内から後で reject できる deferred にする (タイムアウトを先に勝たせる)。
      let rejectReview!: (err: unknown) => void;
      const reviewPending = new Promise<never>((_, reject) => {
        rejectReview = reject;
      });
      countUnhandledInquiriesMock.mockResolvedValue({ ok: true, value: 1 });
      countReviewCallsMock.mockReturnValue(reviewPending);
      countDueOrOverdueTasksMock.mockResolvedValue({ ok: true, value: 1 });

      const pending = navBadgesFacade.getNavBadgeCounts();
      // タイムアウトを先に発火させて勝者を確定 (E002)。
      await vi.advanceTimersByTimeAsync(NAV_BADGE_TIMEOUT_MS + 50);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code).toBe("KMB-E002");

      // タイムアウト確定**後**に内部 count が遅れて reject する。
      rejectReview(new Error("late boom"));
      // 内部 Promise.all → collectNavBadgeCounts の rejection をマイクロタスクで伝播させる。
      await Promise.resolve();
      await Promise.resolve();
      // 実タイマーへ戻し、(もし未処理なら) unhandledRejection が emit される event loop turn を与える。
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 0));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });
});
