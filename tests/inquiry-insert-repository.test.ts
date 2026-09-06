import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 公開 contact フォームの INSERT (anon RLS) 回帰テスト。
 *
 * 本番で「送信に失敗しました」が再現した原因: anon には contact_inquiries の INSERT ポリシーしか無く
 * SELECT ポリシーが無いため、`.insert().select("id")` (Prefer: return=representation) が PostgREST の
 * RLS チェックで 401「new row violates row-level security policy」になっていた。
 * 修正後は id をサーバ側で採番し、返却行を要求しない (select を呼ばない) INSERT にする。
 */

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase/public", () => ({
  createSupabasePublicClient: () => ({ from: fromMock }),
}));

const INPUT = {
  name: "山岸 太郎",
  email: "taro@example.com",
  tel: "+819012345678",
  inquiry_type: "construction" as const,
  item: "テスト品目",
  body: "テスト内容です。これで送信できるかな？",
  privacy_agreed: true as const,
};

describe("insertContactInquiry (anon INSERT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // supabase-js の insert() は thenable。select を付けない (return=minimal) 経路のみを用意する。
    insertMock.mockImplementation(() => Promise.resolve({ error: null }));
  });

  it("返却行を要求せず (select を呼ばず)、id をサーバ側で採番して行に含める", async () => {
    const { insertContactInquiry } = await import("@/modules/inquiry/internal/repository");

    const result = await insertContactInquiry(INPUT);

    expect(result.ok).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("contact_inquiries");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof row.id).toBe("string");
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.status).toBe("new");
    expect(row).toMatchObject({
      name: INPUT.name,
      email: INPUT.email,
      tel: INPUT.tel,
      inquiry_type: INPUT.inquiry_type,
      item: INPUT.item,
      body: INPUT.body,
    });
    // insert() の戻りに .select が生えていない = return=minimal で完結していることを保証
    if (result.ok) expect(result.value.id).toBe(row.id);
  });

  it("INSERT エラーは KMB-E901 として返す", async () => {
    insertMock.mockImplementation(() =>
      Promise.resolve({ error: { message: 'new row violates row-level security policy for table "contact_inquiries"' } }),
    );
    const { insertContactInquiry } = await import("@/modules/inquiry/internal/repository");

    const result = await insertContactInquiry(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E901");
      expect(result.detail).toContain("row-level security");
    }
  });
});
