import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMAS, zAnalyticsSettings, zBrandingSettings } from "@/modules/settings/contracts";

/**
 * #45 (05-site-settings.md §12.1): SETTINGS_SCHEMAS への analytics/branding 追加の
 * map 登録確認 + 最低限の parse 境界テスト (DB 接続不要)。
 * analytics/branding の parse 境界詳細テストは #47 (管理画面) が追加してもよい。
 */
describe("SETTINGS_SCHEMAS 登録確認 (analytics/branding)", () => {
  it("SETTINGS_SCHEMAS.analytics が zAnalyticsSettings と同一である", () => {
    expect(SETTINGS_SCHEMAS.analytics).toBe(zAnalyticsSettings);
  });

  it("SETTINGS_SCHEMAS.branding が zBrandingSettings と同一である", () => {
    expect(SETTINGS_SCHEMAS.branding).toBe(zBrandingSettings);
  });
});

describe("zAnalyticsSettings", () => {
  it("有効な G- 計測 ID を受け付ける", () => {
    const result = zAnalyticsSettings.safeParse({ ga4_measurement_id: "G-ABC1234" });
    expect(result.success).toBe(true);
  });

  it("ga4_measurement_id が null (計測無効) を受け付ける", () => {
    const result = zAnalyticsSettings.safeParse({ ga4_measurement_id: null });
    expect(result.success).toBe(true);
  });

  it("G- で始まらない値は拒否する", () => {
    const result = zAnalyticsSettings.safeParse({ ga4_measurement_id: "UA-12345" });
    expect(result.success).toBe(false);
  });

  it("英数字 4〜16 文字の範囲外は拒否する (短すぎ)", () => {
    const result = zAnalyticsSettings.safeParse({ ga4_measurement_id: "G-AB" });
    expect(result.success).toBe(false);
  });

  it("未知のキー (契約外拡張) は .strict() で拒否する", () => {
    const result = zAnalyticsSettings.safeParse({
      ga4_measurement_id: "G-ABC1234",
      extra_key: "not allowed",
    });
    expect(result.success).toBe(false);
  });
});

describe("zBrandingSettings", () => {
  it("favicon_media_id に有効な uuid を受け付ける", () => {
    const result = zBrandingSettings.safeParse({
      favicon_media_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("favicon_media_id に null (既定 favicon にフォールバック) を受け付ける", () => {
    const result = zBrandingSettings.safeParse({ favicon_media_id: null });
    expect(result.success).toBe(true);
  });

  it("favicon_media_id が uuid でない文字列は拒否する", () => {
    const result = zBrandingSettings.safeParse({ favicon_media_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("未知のキー (契約外拡張) は .strict() で拒否する", () => {
    const result = zBrandingSettings.safeParse({
      favicon_media_id: null,
      seal_media_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });
});
