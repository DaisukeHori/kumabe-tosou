import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/visual-media-editor.md §5.5b (Server Action 実装契約) / §6 (EditableTarget) /
 * §5.4 (サイドパネル)。
 *
 * settings-repository.test.ts / page-media-resolver.test.ts の vi.mock 方式に倣い、
 * facade / next/cache を最小限のフェイクに差し替えて actions.ts のロジックのみ検証する。
 */

const revalidatePath = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

const requireAdmin = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdmin(...args) },
}));

const setSlot = vi.fn();
const setSlotAltFn = vi.fn();
const listForAdmin = vi.fn();

const { HOME_HERO_SLOT } = vi.hoisted(() => ({
  HOME_HERO_SLOT: {
    key: "home.hero",
    page: "home",
    route: "/",
    label: "トップ / ヒーロー",
    defaultSrc: "/hero.jpg",
    altDefault: "深い艶で仕上げられた黒い車体",
    aspect: "hero",
    priority: true,
  },
}));

vi.mock("@/modules/page-media/facade", () => ({
  pageMediaFacade: {
    setSlot: (...args: unknown[]) => setSlot(...args),
    setSlotAlt: (...args: unknown[]) => setSlotAltFn(...args),
    listForAdmin: (...args: unknown[]) => listForAdmin(...args),
  },
  SLOT_REGISTRY: [HOME_HERO_SLOT],
}));

const setWorkCover = vi.fn();
const setVoicePhoto = vi.fn();
const setPostCover = vi.fn();
const setWorkImage = vi.fn();
const getWorkAdmin = vi.fn();
const getPostAdmin = vi.fn();
const listWorksAdmin = vi.fn();
const listVoicesAdmin = vi.fn();
const listPostsAdmin = vi.fn();
const listPublished = vi.fn();

vi.mock("@/modules/content/facade", () => ({
  contentFacade: {
    setWorkCover: (...args: unknown[]) => setWorkCover(...args),
    setVoicePhoto: (...args: unknown[]) => setVoicePhoto(...args),
    setPostCover: (...args: unknown[]) => setPostCover(...args),
    setWorkImage: (...args: unknown[]) => setWorkImage(...args),
    getWorkAdmin: (...args: unknown[]) => getWorkAdmin(...args),
    getPostAdmin: (...args: unknown[]) => getPostAdmin(...args),
    listWorksAdmin: (...args: unknown[]) => listWorksAdmin(...args),
    listVoicesAdmin: (...args: unknown[]) => listVoicesAdmin(...args),
    listPostsAdmin: (...args: unknown[]) => listPostsAdmin(...args),
    listPublished: (...args: unknown[]) => listPublished(...args),
  },
}));

import { listSidePanel, setImage, setSlotAlt } from "@/app/admin/visual/actions";

const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";
const WORK_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const VOICE_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, value: { userId: "admin-1" } });
});

describe("setImage: slot", () => {
  it("registry に存在しない slot_key は KMB-E107 を返し、facade を呼ばない", async () => {
    const result = await setImage({ type: "slot", slotKey: "home.nonexistent" }, MEDIA_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
    expect(setSlot).not.toHaveBeenCalled();
  });

  it("slot_key は有効だが media_id が不正な uuid のときは KMB-E101 を返す (修正3: E107 は slot_key 不正のみ)", async () => {
    const result = await setImage({ type: "slot", slotKey: "home.hero" }, "not-a-uuid");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setSlot).not.toHaveBeenCalled();
  });

  it("requireAdmin 失敗時は facade を呼ばず、requireAdmin の Result をそのまま返す", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await setImage({ type: "slot", slotKey: "home.hero" }, MEDIA_A);
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(setSlot).not.toHaveBeenCalled();
  });

  it("成功時は pageMediaFacade.setSlot を呼び、route の revalidatePath + tag page_media を発火する", async () => {
    setSlot.mockResolvedValue({ ok: true, value: undefined });
    const result = await setImage({ type: "slot", slotKey: "home.hero" }, MEDIA_A);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(setSlot).toHaveBeenCalledWith("home.hero", MEDIA_A);
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidateTag).toHaveBeenCalledWith("page_media");
  });

  it("mediaId=null (既定に戻す) も setSlot に渡す", async () => {
    setSlot.mockResolvedValue({ ok: true, value: undefined });
    await setImage({ type: "slot", slotKey: "home.hero" }, null);
    expect(setSlot).toHaveBeenCalledWith("home.hero", null);
  });

  it("facade がエラーを返したら revalidate せずそのまま返す", async () => {
    setSlot.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await setImage({ type: "slot", slotKey: "home.hero" }, MEDIA_A);
    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("setImage: content (work/voice/post cover CAS)", () => {
  it("old_media_id が uuid でない (不正な型) は KMB-E101 を返し facade を呼ばない", async () => {
    const result = await setImage(
      { type: "content", kind: "work", id: WORK_ID, oldMediaId: "not-a-uuid" },
      MEDIA_A,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setWorkCover).not.toHaveBeenCalled();
  });

  it("requireAdmin 失敗時は facade を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await setImage(
      { type: "content", kind: "work", id: WORK_ID, oldMediaId: null },
      MEDIA_A,
    );
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(setWorkCover).not.toHaveBeenCalled();
  });

  it("kind=work 成功時は setWorkCover→getWorkAdmin の順で呼び、/works 一覧+詳細+tag を revalidate する", async () => {
    setWorkCover.mockResolvedValue({ ok: true, value: undefined });
    getWorkAdmin.mockResolvedValue({ ok: true, value: { id: WORK_ID, slug: "work-07" } });

    const result = await setImage(
      { type: "content", kind: "work", id: WORK_ID, oldMediaId: MEDIA_A },
      MEDIA_B,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(setWorkCover).toHaveBeenCalledWith(WORK_ID, MEDIA_A, MEDIA_B);
    expect(getWorkAdmin).toHaveBeenCalledWith(WORK_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/works");
    expect(revalidatePath).toHaveBeenCalledWith("/works/work-07");
    expect(revalidateTag).toHaveBeenCalledWith("works");
  });

  it("kind=voice 成功時は setVoicePhoto を呼び、/voices + tag voices のみ revalidate する (slug 無し)", async () => {
    setVoicePhoto.mockResolvedValue({ ok: true, value: undefined });

    const result = await setImage(
      { type: "content", kind: "voice", id: VOICE_ID, oldMediaId: null },
      MEDIA_A,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(setVoicePhoto).toHaveBeenCalledWith(VOICE_ID, null, MEDIA_A);
    expect(revalidatePath).toHaveBeenCalledWith("/voices");
    expect(revalidateTag).toHaveBeenCalledWith("voices");
    expect(getWorkAdmin).not.toHaveBeenCalled();
  });

  it("kind=post 成功時は setPostCover→getPostAdmin の順で呼び、実 kind (blog) の path+tag を revalidate する", async () => {
    setPostCover.mockResolvedValue({ ok: true, value: undefined });
    getPostAdmin.mockResolvedValue({ ok: true, value: { id: POST_ID, slug: "new-color", kind: "blog" } });

    const result = await setImage(
      { type: "content", kind: "post", id: POST_ID, oldMediaId: MEDIA_A },
      MEDIA_B,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(setPostCover).toHaveBeenCalledWith(POST_ID, MEDIA_A, MEDIA_B);
    expect(revalidateTag).toHaveBeenCalledWith("posts:blog");
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).toHaveBeenCalledWith("/blog/new-color");
  });

  it("kind=post かつ実 kind=news (専用 path 無し) は tag のみ revalidate し path は呼ばない", async () => {
    setPostCover.mockResolvedValue({ ok: true, value: undefined });
    getPostAdmin.mockResolvedValue({ ok: true, value: { id: POST_ID, slug: "info-01", kind: "news" } });

    await setImage({ type: "content", kind: "post", id: POST_ID, oldMediaId: null }, MEDIA_A);

    expect(revalidateTag).toHaveBeenCalledWith("posts:news");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("kind=post かつ実 kind=reading は /notes 一覧+詳細+tag posts:reading を revalidate する", async () => {
    setPostCover.mockResolvedValue({ ok: true, value: undefined });
    getPostAdmin.mockResolvedValue({ ok: true, value: { id: POST_ID, slug: "note-01", kind: "reading" } });

    await setImage({ type: "content", kind: "post", id: POST_ID, oldMediaId: null }, MEDIA_A);

    expect(revalidateTag).toHaveBeenCalledWith("posts:reading");
    expect(revalidatePath).toHaveBeenCalledWith("/notes");
    expect(revalidatePath).toHaveBeenCalledWith("/notes/note-01");
  });

  it("kind=voice で facade がエラーを返したら revalidate しない", async () => {
    setVoicePhoto.mockResolvedValue({ ok: false, code: "KMB-E109" });
    const result = await setImage(
      { type: "content", kind: "voice", id: VOICE_ID, oldMediaId: MEDIA_A },
      MEDIA_B,
    );
    expect(result).toEqual({ ok: false, code: "KMB-E109" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("CAS 不一致 (KMB-E109) はそのまま返し revalidate しない", async () => {
    setWorkCover.mockResolvedValue({ ok: false, code: "KMB-E109" });
    const result = await setImage(
      { type: "content", kind: "work", id: WORK_ID, oldMediaId: MEDIA_A },
      MEDIA_B,
    );
    expect(result).toEqual({ ok: false, code: "KMB-E109" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(getWorkAdmin).not.toHaveBeenCalled();
  });
});

describe("setImage: work-image (work_images ギャラリー置換)", () => {
  it("old_media_id が uuid でなければ KMB-E101 を返し facade を呼ばない", async () => {
    const result = await setImage({ type: "work-image", workId: WORK_ID, oldMediaId: "bad" }, MEDIA_B);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setWorkImage).not.toHaveBeenCalled();
  });

  it("requireAdmin 失敗時は facade を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await setImage({ type: "work-image", workId: WORK_ID, oldMediaId: MEDIA_A }, MEDIA_B);
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(setWorkImage).not.toHaveBeenCalled();
  });

  it("成功時は setWorkImage→getWorkAdmin の順で呼び、/works 一覧+詳細+tag を revalidate する (削除時 mediaId=null も同様)", async () => {
    setWorkImage.mockResolvedValue({ ok: true, value: undefined });
    getWorkAdmin.mockResolvedValue({ ok: true, value: { id: WORK_ID, slug: "work-09" } });

    const result = await setImage({ type: "work-image", workId: WORK_ID, oldMediaId: MEDIA_A }, null);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(setWorkImage).toHaveBeenCalledWith(WORK_ID, MEDIA_A, null);
    expect(revalidatePath).toHaveBeenCalledWith("/works");
    expect(revalidatePath).toHaveBeenCalledWith("/works/work-09");
    expect(revalidateTag).toHaveBeenCalledWith("works");
  });

  it("KMB-E108 (同一 work に同 media が既存) はそのまま返し revalidate しない", async () => {
    setWorkImage.mockResolvedValue({ ok: false, code: "KMB-E108" });
    const result = await setImage({ type: "work-image", workId: WORK_ID, oldMediaId: MEDIA_A }, MEDIA_B);
    expect(result).toEqual({ ok: false, code: "KMB-E108" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(getWorkAdmin).not.toHaveBeenCalled();
  });
});

describe("setSlotAlt", () => {
  it("registry に存在しない slot_key は KMB-E107 を返す", async () => {
    const result = await setSlotAlt("home.nonexistent", "新しい alt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
    expect(setSlotAltFn).not.toHaveBeenCalled();
  });

  it("slot_key は有効だが alt が上限 (200字) 超過のときは KMB-E101 を返す (修正3: E107 は slot_key 不正のみ)", async () => {
    const result = await setSlotAlt("home.hero", "あ".repeat(201));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setSlotAltFn).not.toHaveBeenCalled();
  });

  it("requireAdmin 失敗時は facade を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await setSlotAlt("home.hero", "新しい alt");
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(setSlotAltFn).not.toHaveBeenCalled();
  });

  it("facade がエラーを返したら revalidate せずそのまま返す", async () => {
    setSlotAltFn.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await setSlotAlt("home.hero", "新しい alt");
    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("成功時は setSlotAlt を呼び、route を revalidate する", async () => {
    setSlotAltFn.mockResolvedValue({ ok: true, value: undefined });
    const result = await setSlotAlt("home.hero", "新しい alt");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(setSlotAltFn).toHaveBeenCalledWith("home.hero", "新しい alt");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidateTag).toHaveBeenCalledWith("page_media");
  });

  it("alt=null (自動決定に戻す) も許可する", async () => {
    setSlotAltFn.mockResolvedValue({ ok: true, value: undefined });
    await setSlotAlt("home.hero", null);
    expect(setSlotAltFn).toHaveBeenCalledWith("home.hero", null);
  });
});

describe("listSidePanel (§5.4 サイドパネル)", () => {
  it("requireAdmin 失敗時は facade を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await listSidePanel("/");
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listForAdmin).not.toHaveBeenCalled();
  });

  it("slot ルートは listForAdmin(route) の結果を写像し、contentGaps は空", async () => {
    listForAdmin.mockResolvedValue({
      ok: true,
      value: [
        {
          slot: HOME_HERO_SLOT,
          mediaId: MEDIA_A,
          alt: "カスタム alt",
          state: "custom",
        },
      ],
    });

    const result = await listSidePanel("/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots).toEqual([
      { slotKey: "home.hero", label: "トップ / ヒーロー", state: "custom", mediaId: MEDIA_A, alt: "カスタム alt" },
    ]);
    expect(result.value.contentGaps).toEqual([]);
  });

  it("/works ルートは cover_media_id=null の work のみ contentGaps に含める", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listWorksAdmin.mockResolvedValue({
      ok: true,
      value: {
        items: [
          { id: "w1", title: "施工例1", cover_media_id: null, status: "draft" },
          { id: "w2", title: "施工例2", cover_media_id: MEDIA_A, status: "published" },
        ],
        next_cursor: null,
      },
    });
    listPublished.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });

    const result = await listSidePanel("/works");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentGaps).toEqual([
      { kind: "work", id: "w1", title: "施工例1", status: "draft" },
    ]);
  });

  it("/works ルートは公開済み施工事例一覧 (§5.1a 2段ナビ) を works に含める", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listWorksAdmin.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });
    listPublished.mockResolvedValue({
      ok: true,
      value: {
        items: [
          { id: "w1", slug: "car-detail-01", title: "施工例1", category: "外装", body: "", process_note: null, cover_media_id: null, image_ids: [], published_at: "2026-01-01T00:00:00Z" },
        ],
        next_cursor: null,
      },
    });

    const result = await listSidePanel("/works");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listPublished).toHaveBeenCalledWith("work", expect.objectContaining({ cursor: null }));
    expect(result.value.works).toEqual([{ slug: "car-detail-01", title: "施工例1" }]);
  });

  it("/works 以外のルートでは listPublished を呼ばず works は常に空配列", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });

    const result = await listSidePanel("/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listPublished).not.toHaveBeenCalled();
    expect(result.value.works).toEqual([]);
  });

  it("/notes ルートは posts.kind='reading' を listPostsAdmin に渡す", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listPostsAdmin.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });

    await listSidePanel("/notes");
    expect(listPostsAdmin).toHaveBeenCalledWith("reading", expect.objectContaining({ cursor: null }));
  });

  it("/blog ルートは posts.kind='blog' を listPostsAdmin に渡す", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listPostsAdmin.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });

    await listSidePanel("/blog");
    expect(listPostsAdmin).toHaveBeenCalledWith("blog", expect.objectContaining({ cursor: null }));
  });

  it("/voices ルートは photo_media_id=null の voice のみ contentGaps に含める", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listVoicesAdmin.mockResolvedValue({
      ok: true,
      value: {
        items: [
          { id: "v1", customer_initial: "K.T", region: "横浜", photo_media_id: null, status: "published" },
        ],
        next_cursor: null,
      },
    });

    const result = await listSidePanel("/voices");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentGaps).toEqual([
      { kind: "voice", id: "v1", title: "K.T (横浜)", status: "published" },
    ]);
  });
});
