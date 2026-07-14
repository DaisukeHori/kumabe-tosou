import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/05-site-settings.md §4.3 (Server Actions 契約表) / §6.2。
 * issue-47.md テスト戦略 #2「tests/settings-actions.test.ts (新規作成)」。
 *
 * tests/calls-actions.test.ts / tests/visual-actions.test.ts の確立パターン (next/cache・
 * platformFacade.requireAdmin・facade 群を最小フェイクに差し替え、actions.ts のロジックのみ検証) を
 * 踏襲する。submitSettingsForm 自体もこのファイルのテスト対象 (revalidateTag 呼び出し・
 * requireAdmin ガード) なので @/app/admin/settings/actions は mock しない (calls-actions.test.ts と
 * 異なり、ここが直接の被験体)。zod スキーマ (zAnalyticsSettings 等) は実物を使う
 * (actions.ts が内部で import するため、モックの必要がない)。実 DB には一切触れない。
 */

const revalidatePath = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const settingsUpdateMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  SITE_SETTINGS_CACHE_TAG: "site_settings",
  settingsFacade: { update: (...args: unknown[]) => settingsUpdateMock(...args) },
}));

const getJpegRenditionUrlMock = vi.fn();
const getByIdMock = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: {
    getJpegRenditionUrl: (...args: unknown[]) => getJpegRenditionUrlMock(...args),
    getById: (...args: unknown[]) => getByIdMock(...args),
  },
}));

import {
  updateAnalyticsSettingsAction,
  updateBrandingSettingsAction,
  updateSeoDefaultsAction,
} from "@/app/admin/settings/actions";
import { SETTINGS_FORM_INITIAL_STATE } from "@/app/admin/settings/form-state";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
const EXPECTED_UPDATED_AT = "2026-07-14T00:00:00.000000+00:00";
// zod z.string().uuid() は third group が [1-8]、fourth group が [89abAB] 始まりを要求する
// (calls-actions.test.ts と同じ実在しうる形の uuid)。
const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("submitSettingsForm 共通経路 (updateAnalyticsSettingsAction を代表として検証)", () => {
  it("requireAdmin が失敗した場合は settingsFacade.update を呼ばずエラーを返す (KMB-E201)", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const fd = makeFormData({ ga4_measurement_id: "G-ABCD1234", expected_updated_at: EXPECTED_UPDATED_AT });

    const result = await updateAnalyticsSettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result).toEqual({ error: "ログインが必要です。", conflict: false, success: false });
    expect(settingsUpdateMock).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("不正な入力 (G- 形式でない) は KMB の zod エラーメッセージを返し update を呼ばない", async () => {
    const fd = makeFormData({ ga4_measurement_id: "UA-12345", expected_updated_at: EXPECTED_UPDATED_AT });

    const result = await updateAnalyticsSettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });

  it("成功時は revalidatePath('/admin/settings') と revalidateTag('site_settings') の両方を呼ぶ", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    const fd = makeFormData({ ga4_measurement_id: "G-ABCD1234", expected_updated_at: EXPECTED_UPDATED_AT });

    const result = await updateAnalyticsSettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result).toEqual({ error: null, conflict: false, success: true });
    expect(settingsUpdateMock).toHaveBeenCalledWith(
      "analytics",
      { ga4_measurement_id: "G-ABCD1234" },
      EXPECTED_UPDATED_AT,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
    expect(revalidateTag).toHaveBeenCalledWith("site_settings");
  });

  it("空欄保存で計測を無効化する (emptyToNull により null が渡る)", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    const fd = makeFormData({ ga4_measurement_id: "", expected_updated_at: EXPECTED_UPDATED_AT });

    const result = await updateAnalyticsSettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result.success).toBe(true);
    expect(settingsUpdateMock).toHaveBeenCalledWith("analytics", { ga4_measurement_id: null }, EXPECTED_UPDATED_AT);
  });

  it("KMB-E103 (楽観排他衝突) は conflict:true でそのまま返し revalidate しない", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: false, code: "KMB-E103" });
    const fd = makeFormData({ ga4_measurement_id: "G-ABCD1234", expected_updated_at: EXPECTED_UPDATED_AT });

    const result = await updateAnalyticsSettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result.conflict).toBe(true);
    expect(result.success).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("updateBrandingSettingsAction (§6.2 寸法 warning)", () => {
  function makeBrandingFormData(faviconMediaId: string): FormData {
    return makeFormData({ favicon_media_id: faviconMediaId, expected_updated_at: EXPECTED_UPDATED_AT });
  }

  it("正方形 128px 以上の画像は warning なしで保存成功する", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getByIdMock.mockResolvedValue({ ok: true, value: { width: 512, height: 512 } });

    const result = await updateBrandingSettingsAction(SETTINGS_FORM_INITIAL_STATE, makeBrandingFormData(MEDIA_ID));

    expect(result).toEqual({ error: null, conflict: false, success: true });
    expect(result.warning).toBeUndefined();
  });

  it("非正方形画像は保存は成功するが warning を返す (受入基準: 保存自体は成功)", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getByIdMock.mockResolvedValue({ ok: true, value: { width: 512, height: 300 } });

    const result = await updateBrandingSettingsAction(SETTINGS_FORM_INITIAL_STATE, makeBrandingFormData(MEDIA_ID));

    expect(result.success).toBe(true);
    expect(result.warning).toContain("正方形");
  });

  it("正方形だが128px未満の画像は warning を返す", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getByIdMock.mockResolvedValue({ ok: true, value: { width: 64, height: 64 } });

    const result = await updateBrandingSettingsAction(SETTINGS_FORM_INITIAL_STATE, makeBrandingFormData(MEDIA_ID));

    expect(result.success).toBe(true);
    expect(result.warning).toContain("正方形");
  });

  it("「既定に戻す」(favicon_media_id 空欄) での null 保存は寸法チェックをスキップする", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await updateBrandingSettingsAction(SETTINGS_FORM_INITIAL_STATE, makeBrandingFormData(""));

    expect(result).toEqual({ error: null, conflict: false, success: true });
    expect(settingsUpdateMock).toHaveBeenCalledWith("branding", { favicon_media_id: null }, EXPECTED_UPDATED_AT);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it("mediaFacade.getById が失敗した場合、寸法警告なしで既に成功した保存結果をそのまま返す (ベストエフォート)", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getByIdMock.mockResolvedValue({ ok: false, code: "KMB-E109" });

    const result = await updateBrandingSettingsAction(SETTINGS_FORM_INITIAL_STATE, makeBrandingFormData(MEDIA_ID));

    expect(result).toEqual({ error: null, conflict: false, success: true });
  });

  it("保存自体が失敗した場合 (E103 衝突) は寸法チェックを行わずそのまま返す", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: false, code: "KMB-E103" });

    const result = await updateBrandingSettingsAction(SETTINGS_FORM_INITIAL_STATE, makeBrandingFormData(MEDIA_ID));

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(getByIdMock).not.toHaveBeenCalled();
  });
});

describe("updateSeoDefaultsAction (§6.2 JPEG ensure + 寸法 warning)", () => {
  function makeSeoFormData(overrides: Record<string, string> = {}): FormData {
    return makeFormData({
      title_template: "%s | くまべ塗装",
      description:
        "熊本の外壁塗装専門店。無料相談から施工、アフターフォローまで一貫して丁寧に対応します。品質と安心をお届けし、住まいの美しさを長く保ちます。",
      og_media_id: MEDIA_ID,
      expected_updated_at: EXPECTED_UPDATED_AT,
      ...overrides,
    });
  }

  it("JPEG ensure 成功 + 推奨比率 (1200x630) 内なら warning なしで保存成功する", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getJpegRenditionUrlMock.mockResolvedValue({ ok: true, value: "https://example.com/og.jpg" });
    getByIdMock.mockResolvedValue({ ok: true, value: { width: 1200, height: 630 } });

    const result = await updateSeoDefaultsAction(SETTINGS_FORM_INITIAL_STATE, makeSeoFormData());

    expect(result).toEqual({ error: null, conflict: false, success: true });
    expect(result.warning).toBeUndefined();
    expect(getJpegRenditionUrlMock).toHaveBeenCalledWith(MEDIA_ID);
  });

  it("JPEG ensure 失敗時は保存を失敗させず warning を返す (ensure 失敗を優先表示)", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getJpegRenditionUrlMock.mockResolvedValue({ ok: false, code: "KMB-E902", detail: "convert failed" });

    const result = await updateSeoDefaultsAction(SETTINGS_FORM_INITIAL_STATE, makeSeoFormData());

    expect(result.success).toBe(true);
    expect(result.warning).toContain("JPEG 変換");
    // ensure 失敗時は寸法取得 (getById) まで進まない (early return — 優先順位の判断根拠)。
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it("縦横比が推奨サイズから10%超逸脱している場合は寸法 warning を返す", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getJpegRenditionUrlMock.mockResolvedValue({ ok: true, value: "https://example.com/og.jpg" });
    // 1:1 (正方形) は 1200x630 (1.91:1) から大きく逸脱する。
    getByIdMock.mockResolvedValue({ ok: true, value: { width: 800, height: 800 } });

    const result = await updateSeoDefaultsAction(SETTINGS_FORM_INITIAL_STATE, makeSeoFormData());

    expect(result.success).toBe(true);
    expect(result.warning).toContain("縦横比");
  });

  it("縦横比の逸脱が許容誤差 (±10%) 以内なら warning を出さない", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getJpegRenditionUrlMock.mockResolvedValue({ ok: true, value: "https://example.com/og.jpg" });
    // 1200x630 の比 1.905 に対し 1150x630 は比 1.825 (逸脱率 ≈4.2% < 10%)。
    getByIdMock.mockResolvedValue({ ok: true, value: { width: 1150, height: 630 } });

    const result = await updateSeoDefaultsAction(SETTINGS_FORM_INITIAL_STATE, makeSeoFormData());

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("mediaFacade.getById が失敗した場合、寸法警告なしで保存成功結果をそのまま返す (ベストエフォート)", async () => {
    settingsUpdateMock.mockResolvedValue({ ok: true, value: undefined });
    getJpegRenditionUrlMock.mockResolvedValue({ ok: true, value: "https://example.com/og.jpg" });
    getByIdMock.mockResolvedValue({ ok: false, code: "KMB-E109" });

    const result = await updateSeoDefaultsAction(SETTINGS_FORM_INITIAL_STATE, makeSeoFormData());

    expect(result).toEqual({ error: null, conflict: false, success: true });
  });

  it("保存自体が失敗した場合 (バリデーションエラー) は JPEG ensure を呼ばずそのまま返す", async () => {
    const result = await updateSeoDefaultsAction(
      SETTINGS_FORM_INITIAL_STATE,
      makeSeoFormData({ description: "短すぎ" }),
    );

    expect(result.success).toBe(false);
    expect(getJpegRenditionUrlMock).not.toHaveBeenCalled();
    expect(settingsUpdateMock).not.toHaveBeenCalled();
  });
});
