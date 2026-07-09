import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/visual-media-editor.md §5.5b (Server Action 実装契約) / §6 (EditableTarget) /
 * §5.4 (サイドパネル)。テキスト関連 (setSlotText / listSidePanel の texts) は
 * docs/design/visual-text-editor.md §5 (Server Action 実装契約 / 失効セット / サイドパネル)。
 *
 * settings-repository.test.ts / page-media-resolver.test.ts の vi.mock 方式に倣い、
 * facade / next/cache を最小限のフェイクに差し替えて actions.ts のロジックのみ検証する。
 * zSetTextReq (contracts.ts) はモックせず実物を使うため、slot_key には実際の TEXT_REGISTRY
 * (text-registry.ts) に存在するキーを使う (home.craft.heading / notes.cta.heading /
 * shared.cta.consult)。一方 pageMediaFacade からの再 export である TEXT_REGISTRY/EDITABLE_ROUTES は
 * revalidateTextRoute (actions.ts) が失効対象を決めるための参照であり、モックの最小フィクスチャに
 * 差し替える (画像側の SLOT_REGISTRY フィクスチャと同じ方式)。
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
const setTextFn = vi.fn();
const listTextsForAdmin = vi.fn();

const {
  HOME_HERO_SLOT,
  HOME_CRAFT_TEXT_SLOT,
  NOTES_CTA_TEXT_SLOT,
  SHARED_CTA_TEXT_SLOT,
  CHROME_FOOTER_COMBINED_TEXT_SLOT,
  TEST_EDITABLE_ROUTES,
} = vi.hoisted(() => ({
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
    // 以下 3 件は text-registry.ts の実データと同一 (zSetTextReq は実物を使うため、
    // 存在する slot_key・maxLen・kind・affectedRoutes/affectsAllRoutes を一致させる)。
    HOME_CRAFT_TEXT_SLOT: {
      key: "home.craft.heading",
      page: "home",
      route: "/",
      label: "トップ / CRAFT 見出し",
      kind: "text",
      maxLen: 24,
      defaultText: "3つの技術を、ひとりで持つ。",
    },
    NOTES_CTA_TEXT_SLOT: {
      key: "notes.cta.heading",
      page: "notes",
      route: "/notes",
      label: "読みもの / CTA帯 見出し (一覧・詳細で共有)",
      kind: "lines",
      maxLen: 44,
      defaultText: "読んで気になったことは、\nそのまま聞いてください。",
      maxLines: 2,
      affectedRoutes: ["/notes", "notes/[slug]"],
    },
    SHARED_CTA_TEXT_SLOT: {
      key: "shared.cta.consult",
      page: "shared",
      route: "/",
      label: "共通 / 「相談する」ボタン",
      kind: "text",
      maxLen: 8,
      defaultText: "相談する",
      affectsAllRoutes: true,
    },
    // affectedRoutes と affectsAllRoutes の併用ケース (実 registry には現状存在しないが、
    // revalidateTextRoute の実装が「両方指定」でも安全 (重複 revalidatePath が害にならない)
    // ことを確認するための合成フィクスチャ。key は zSetTextReq が実物の TEXT_REGISTRY
    // (text-registry.ts) に対して検証するため、実在する chrome.footer.tagline
    // (kind=multiline, maxLen=80, maxLines 未設定) を流用する。
    CHROME_FOOTER_COMBINED_TEXT_SLOT: {
      key: "chrome.footer.tagline",
      page: "chrome",
      route: "/",
      label: "共通 / フッター事業紹介文",
      kind: "multiline",
      maxLen: 80,
      defaultText:
        "3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。",
      affectedRoutes: ["/works"],
      affectsAllRoutes: true,
    },
    TEST_EDITABLE_ROUTES: ["/", "/notes", "/works", "notes/[slug]", "works/[slug]", "blog/[slug]"],
  }));

vi.mock("@/modules/page-media/facade", () => ({
  pageMediaFacade: {
    setSlot: (...args: unknown[]) => setSlot(...args),
    setSlotAlt: (...args: unknown[]) => setSlotAltFn(...args),
    listForAdmin: (...args: unknown[]) => listForAdmin(...args),
    setText: (...args: unknown[]) => setTextFn(...args),
    listTextsForAdmin: (...args: unknown[]) => listTextsForAdmin(...args),
  },
  SLOT_REGISTRY: [HOME_HERO_SLOT],
  TEXT_REGISTRY: [
    HOME_CRAFT_TEXT_SLOT,
    NOTES_CTA_TEXT_SLOT,
    SHARED_CTA_TEXT_SLOT,
    CHROME_FOOTER_COMBINED_TEXT_SLOT,
  ],
  EDITABLE_ROUTES: TEST_EDITABLE_ROUTES,
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

import { listSidePanel, setImage, setSlotAlt, setSlotText } from "@/app/admin/visual/actions";

const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";
const WORK_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const VOICE_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, value: { userId: "admin-1" } });
  // listSidePanel は毎回 listTextsForAdmin も呼ぶため、明示的に上書きしないテストのための既定値。
  listTextsForAdmin.mockResolvedValue({ ok: true, value: [] });
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

describe("setSlotText (visual-text-editor.md §5)", () => {
  it("TEXT_REGISTRY に存在しない slot_key は KMB-E107 を返し facade を呼ばない", async () => {
    const result = await setSlotText("home.nonexistent", "テスト");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
    expect(setTextFn).not.toHaveBeenCalled();
  });

  it("slot_key は有効だが maxLen 超過のときは KMB-E101 を返す (E107 は slot_key 不正のみ)", async () => {
    // home.craft.heading: maxLen=24
    const result = await setSlotText("home.craft.heading", "あ".repeat(25));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setTextFn).not.toHaveBeenCalled();
  });

  it("kind=text の改行は KMB-E101 を返す", async () => {
    const result = await setSlotText("shared.cta.consult", "相談\nする");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setTextFn).not.toHaveBeenCalled();
  });

  it("空文字列 (または空白のみ) は KMB-E101 を返す", async () => {
    const result = await setSlotText("home.craft.heading", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(setTextFn).not.toHaveBeenCalled();
  });

  it("requireAdmin 失敗時は facade を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await setSlotText("home.craft.heading", "新しい見出し");
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(setTextFn).not.toHaveBeenCalled();
  });

  it("facade がエラーを返したら revalidate せずそのまま返す", async () => {
    setTextFn.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await setSlotText("home.craft.heading", "新しい見出し");
    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("成功時は pageMediaFacade.setText を呼び、route の revalidatePath + tag page_text を発火する", async () => {
    setTextFn.mockResolvedValue({ ok: true, value: undefined });
    const result = await setSlotText("home.craft.heading", "新しい見出し");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(setTextFn).toHaveBeenCalledWith("home.craft.heading", "新しい見出し");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidateTag).toHaveBeenCalledWith("page_text");
  });

  it("text=null (既定に戻す) も setText に渡す", async () => {
    setTextFn.mockResolvedValue({ ok: true, value: undefined });
    await setSlotText("home.craft.heading", null);
    expect(setTextFn).toHaveBeenCalledWith("home.craft.heading", null);
  });

  it("CRLF は正規化 (\\n) された上で zSetTextReq 検証・facade 呼び出しが行われる", async () => {
    setTextFn.mockResolvedValue({ ok: true, value: undefined });
    // notes.cta.heading: kind=lines, maxLen=44, maxLines=2
    await setSlotText("notes.cta.heading", "1行目\r\n2行目");
    expect(setTextFn).toHaveBeenCalledWith("notes.cta.heading", "1行目\n2行目");
  });

  it("affectedRoutes を持つスロットは route に加えて追加の path も revalidate する (notes.cta.heading)", async () => {
    setTextFn.mockResolvedValue({ ok: true, value: undefined });
    await setSlotText("notes.cta.heading", "新しい見出し\n続き");
    expect(revalidatePath).toHaveBeenCalledWith("/notes");
    expect(revalidatePath).toHaveBeenCalledWith("/notes/[slug]", "page");
    expect(revalidateTag).toHaveBeenCalledWith("page_text");
  });

  it("affectsAllRoutes を持つスロットは EDITABLE_ROUTES 全体を revalidate する (shared.cta.consult)", async () => {
    setTextFn.mockResolvedValue({ ok: true, value: undefined });
    await setSlotText("shared.cta.consult", "相談する");
    for (const route of TEST_EDITABLE_ROUTES) {
      // EDITABLE_ROUTES の動的パターンは先頭 "/" 無し表記 ("notes/[slug]" 等) のため、
      // revalidatePath 呼び出し時の正規化後 ("/notes/[slug]") と比較する。
      const path = route.startsWith("/") ? route : `/${route}`;
      if (path.includes("[")) {
        expect(revalidatePath).toHaveBeenCalledWith(path, "page");
      } else {
        expect(revalidatePath).toHaveBeenCalledWith(path);
      }
    }
    expect(revalidateTag).toHaveBeenCalledWith("page_text");
  });

  it("affectedRoutes と affectsAllRoutes を併用するスロットは両方の失効セットを (重複含め) 呼んでもエラーにならない (chrome.footer.tagline)", async () => {
    setTextFn.mockResolvedValue({ ok: true, value: undefined });
    // chrome.footer.tagline: kind=multiline, maxLen=80 (v1.3 tester フィクスチャの併用ケース)
    const result = await setSlotText("chrome.footer.tagline", "新しい事業紹介文です。");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(setTextFn).toHaveBeenCalledWith("chrome.footer.tagline", "新しい事業紹介文です。");

    // affectedRoutes ("/works") は affectsAllRoutes の EDITABLE_ROUTES 展開にも含まれる
    // (TEST_EDITABLE_ROUTES に "/works" が入っている) ため、revalidatePath("/works") は
    // 2 回 (affectedRoutes ループ分 + affectsAllRoutes ループ分) 呼ばれる。
    // revalidatePath は同一パスの複数回呼び出しを許容する冪等 API のため、
    // 「呼ばれたことがある」の確認に加え、呼び出し回数が減っていない (=両方の失効経路が
    // 実際に実行された) ことも明示的に確認する。
    const worksCalls = revalidatePath.mock.calls.filter(([path]) => path === "/works").length;
    expect(worksCalls).toBeGreaterThanOrEqual(2);

    // 基本の route ("/") + affectedRoutes ("/works") + affectsAllRoutes (EDITABLE_ROUTES 全体) が
    // すべて失効対象に含まれる。
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/works");
    for (const route of TEST_EDITABLE_ROUTES) {
      const path = route.startsWith("/") ? route : `/${route}`;
      if (path.includes("[")) {
        expect(revalidatePath).toHaveBeenCalledWith(path, "page");
      } else {
        expect(revalidatePath).toHaveBeenCalledWith(path);
      }
    }
    expect(revalidateTag).toHaveBeenCalledWith("page_text");
  });
});

describe("listSidePanel (§5.4 サイドパネル、テキストは visual-text-editor.md §5)", () => {
  it("requireAdmin 失敗時は facade を呼ばない (listTextsForAdmin も含む)", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await listSidePanel("/");
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listForAdmin).not.toHaveBeenCalled();
    expect(listTextsForAdmin).not.toHaveBeenCalled();
  });

  it("listTextsForAdmin がエラーを返したらそのまま返す", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listTextsForAdmin.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await listSidePanel("/");
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
  });

  it("texts は listTextsForAdmin(route) の結果を isDefault→state (default/custom) に写像する", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listTextsForAdmin.mockResolvedValue({
      ok: true,
      value: [
        { slot: HOME_CRAFT_TEXT_SLOT, text: "編集済みの見出し", isDefault: false },
        { slot: SHARED_CTA_TEXT_SLOT, text: "相談する", isDefault: true },
      ],
    });

    const result = await listSidePanel("/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.texts).toEqual([
      {
        slotKey: "home.craft.heading",
        label: "トップ / CRAFT 見出し",
        kind: "text",
        maxLen: 24,
        maxLines: null,
        state: "custom",
        text: "編集済みの見出し",
      },
      {
        slotKey: "shared.cta.consult",
        label: "共通 / 「相談する」ボタン",
        kind: "text",
        maxLen: 8,
        maxLines: null,
        state: "default",
        text: "相談する",
      },
    ]);
  });

  it("maxLines を持つスロット (kind=lines) は maxLines をそのまま透過する", async () => {
    listForAdmin.mockResolvedValue({ ok: true, value: [] });
    listPostsAdmin.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });
    listTextsForAdmin.mockResolvedValue({
      ok: true,
      value: [{ slot: NOTES_CTA_TEXT_SLOT, text: "行1\n行2", isDefault: false }],
    });

    const result = await listSidePanel("/notes");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.texts[0]).toMatchObject({ slotKey: "notes.cta.heading", maxLines: 2, kind: "lines" });
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
