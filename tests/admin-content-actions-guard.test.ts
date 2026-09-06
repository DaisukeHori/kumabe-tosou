import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /admin/{works,posts,voices} の Server Actions が先頭で platformFacade.requireAdmin() を
 * 呼ぶこと (契約書 §3.5「全 Action の先頭で requireAdmin() + Zod parse」)。
 *
 * 回帰: 旧実装は「platform 未実装のため未接続」コメントのまま requireAdmin を呼ばず、
 * middleware (Cookie の有無) + RLS だけに依拠していた。認証済みだが profiles に無い
 * ユーザー (KMB-E202) が Action を直接叩けた。
 *
 * prices-actions.test.ts と同じく platformFacade / contentFacade を vi.mock で差し替える。
 */

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const facadeMock = vi.hoisted(() => ({
  createWork: vi.fn(),
  updateWork: vi.fn(),
  transitionWork: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  transitionPost: vi.fn(),
  createVoice: vi.fn(),
  updateVoice: vi.fn(),
  transitionVoice: vi.fn(),
}));
vi.mock("@/modules/content/facade", () => ({ contentFacade: facadeMock }));

import { createPostAction, transitionPostAction, updatePostAction } from "@/app/admin/posts/actions";
import { createVoiceAction, transitionVoiceAction, updateVoiceAction } from "@/app/admin/voices/actions";
import { createWorkAction, transitionWorkAction, updateWorkAction } from "@/app/admin/works/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
const NOT_ADMIN = { ok: false as const, code: "KMB-E202" as const };
const NOT_AUTHED = { ok: false as const, code: "KMB-E201" as const };

const WORK_INPUT = {
  slug: "black-tank",
  title: "黒タンク",
  category: "tank",
  body: "本文",
  process_note: null,
  cover_media_id: null,
  image_ids: [],
  sort_order: 0,
};
const POST_INPUT = {
  slug: "hello",
  kind: "reading" as const,
  title: "タイトル",
  excerpt: "抜粋",
  body: "本文",
  cover_media_id: null,
};
const VOICE_INPUT = {
  customer_initial: "K.T",
  region: "福岡",
  rating: 5,
  body: "とても良かった",
  item: null,
  photo_media_id: null,
  sort_order: 0,
};
const TRANSITION = { to: "review" as const, published_at: null };
const UPDATED_AT = "2026-09-01T00:00:00.000Z";

type ActionCase = { name: string; run: () => Promise<{ ok: boolean; code?: string }>; facadeFn: keyof typeof facadeMock };

const CASES: ActionCase[] = [
  { name: "createWorkAction", run: () => createWorkAction(WORK_INPUT), facadeFn: "createWork" },
  { name: "updateWorkAction", run: () => updateWorkAction("w-1", WORK_INPUT, UPDATED_AT), facadeFn: "updateWork" },
  { name: "transitionWorkAction", run: () => transitionWorkAction("w-1", TRANSITION, UPDATED_AT), facadeFn: "transitionWork" },
  { name: "createPostAction", run: () => createPostAction(POST_INPUT), facadeFn: "createPost" },
  { name: "updatePostAction", run: () => updatePostAction("p-1", POST_INPUT, UPDATED_AT), facadeFn: "updatePost" },
  { name: "transitionPostAction", run: () => transitionPostAction("p-1", TRANSITION, UPDATED_AT), facadeFn: "transitionPost" },
  { name: "createVoiceAction", run: () => createVoiceAction(VOICE_INPUT), facadeFn: "createVoice" },
  { name: "updateVoiceAction", run: () => updateVoiceAction("v-1", VOICE_INPUT, UPDATED_AT), facadeFn: "updateVoice" },
  { name: "transitionVoiceAction", run: () => transitionVoiceAction("v-1", TRANSITION, UPDATED_AT), facadeFn: "transitionVoice" },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(facadeMock)) fn.mockResolvedValue({ ok: true, value: { id: "x", updated_at: UPDATED_AT } });
});

describe.each(CASES)("$name は requireAdmin() を先頭で呼ぶ", ({ run, facadeFn }) => {
  it("非 admin (KMB-E202) はそのまま返し、facade を呼ばない", async () => {
    requireAdminMock.mockResolvedValue(NOT_ADMIN);

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.code).toBe("KMB-E202");
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(facadeMock[facadeFn]).not.toHaveBeenCalled();
  });

  it("未認証 (KMB-E201) も同様に facade を呼ばない", async () => {
    requireAdminMock.mockResolvedValue(NOT_AUTHED);

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.code).toBe("KMB-E201");
    expect(facadeMock[facadeFn]).not.toHaveBeenCalled();
  });

  it("admin なら facade を 1 回呼ぶ", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_OK);

    const result = await run();

    expect(result.ok).toBe(true);
    expect(facadeMock[facadeFn]).toHaveBeenCalledTimes(1);
  });
});

describe("requireAdmin は Zod parse より前に評価される", () => {
  it("非 admin かつ入力不正でも KMB-E202 (E101 ではない) を返す", async () => {
    requireAdminMock.mockResolvedValue(NOT_ADMIN);

    const result = await createWorkAction({ ...WORK_INPUT, slug: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E202");
  });
});
