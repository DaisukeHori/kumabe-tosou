import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/module-contracts.md §5 (inquiry.submit — DB 保存成功後にベストエフォート通知)。
 *
 * inquiryFacade.submit の通知メール fire-and-forget を検証する。Vercel では応答返却後に関数が凍結され
 * `void notify()` の Promise が打ち切られ得るため、next/server の after() でリクエスト完了後の実行を
 * 予約する。after() はリクエストスコープ外 (plain Vitest 等) では同期 throw するため、その場合は
 * 従来どおりの void 呼び出しにフォールバックすることも確認する。
 *   - after が使える文脈: after(cb) で予約し、cb 実行時に notifyInquiryReceived が呼ばれる
 *   - after が throw する文脈: notifyInquiryReceived を直接 (同期的に) 起動する
 *   - INSERT 失敗時は通知を予約せずエラーをそのまま返す
 */

const afterMock = vi.fn();
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (...args: unknown[]) => afterMock(...args) };
});

const insertContactInquiryMock = vi.fn();
vi.mock("@/modules/inquiry/internal/repository", () => ({
  insertContactInquiry: (...args: unknown[]) => insertContactInquiryMock(...args),
}));

const notifyInquiryReceivedMock = vi.fn();
vi.mock("@/modules/inquiry/internal/notify", () => ({
  notifyInquiryReceived: (...args: unknown[]) => notifyInquiryReceivedMock(...args),
}));

vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: vi.fn(),
}));

import { inquiryFacade } from "@/modules/inquiry/facade";
import type { InquiryInput } from "@/modules/inquiry/contracts";

const INPUT: InquiryInput = {
  name: "山田太郎",
  email: "yamada@example.com",
  tel: null,
  inquiry_type: "estimate",
  item: null,
  body: "見積もりをお願いします。塗装面積は約100平米です。",
  privacy_agreed: true,
};

describe("inquiryFacade.submit の通知 fire-and-forget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterMock.mockReset();
    insertContactInquiryMock.mockResolvedValue({ ok: true, value: { id: "inquiry-1" } });
    notifyInquiryReceivedMock.mockResolvedValue(undefined);
  });

  it("after() が使える文脈: after にコールバックを渡し、応答前には通知を起動しない", async () => {
    const result = await inquiryFacade.submit(INPUT);

    expect(result).toEqual({ ok: true, value: { id: "inquiry-1" } });
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(notifyInquiryReceivedMock).not.toHaveBeenCalled();

    // Next.js がリクエスト完了後にコールバックを実行する → 通知が走る
    const cb = afterMock.mock.calls[0][0] as () => Promise<void>;
    await cb();
    expect(notifyInquiryReceivedMock).toHaveBeenCalledTimes(1);
    expect(notifyInquiryReceivedMock).toHaveBeenCalledWith(INPUT, "inquiry-1");
  });

  it("after() がリクエストスコープ外で throw する文脈: 従来どおり直接 notify を起動し submit は成功のまま", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });

    const result = await inquiryFacade.submit(INPUT);

    expect(result).toEqual({ ok: true, value: { id: "inquiry-1" } });
    expect(notifyInquiryReceivedMock).toHaveBeenCalledTimes(1);
    expect(notifyInquiryReceivedMock).toHaveBeenCalledWith(INPUT, "inquiry-1");
  });

  it("フォールバック経路で notify が reject しても submit は成功のまま (unhandled にしない)", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("outside a request scope");
    });
    notifyInquiryReceivedMock.mockRejectedValue(new Error("resend down"));

    const result = await inquiryFacade.submit(INPUT);

    expect(result.ok).toBe(true);
  });

  it("INSERT 失敗時は通知を予約せずエラーをそのまま返す", async () => {
    insertContactInquiryMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const result = await inquiryFacade.submit(INPUT);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
    expect(afterMock).not.toHaveBeenCalled();
    expect(notifyInquiryReceivedMock).not.toHaveBeenCalled();
  });

  it("入力不正 (KMB-E101) では INSERT も通知も行わない", async () => {
    const result = await inquiryFacade.submit({ ...INPUT, body: "短い" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E101");
    expect(insertContactInquiryMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });
});
