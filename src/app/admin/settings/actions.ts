"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import {
  zCompanySettings,
  zHeroSettings,
  zNotificationSettings,
  zOpsLimits,
  zSeoDefaults,
  type SettingsKey,
  type SettingsValue,
} from "@/modules/settings/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import type { SettingsFormState } from "./form-state";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length === 0 ? null : s;
}

async function submitSettingsForm<K extends SettingsKey>(
  key: K,
  schema: z.ZodType<SettingsValue<K>>,
  raw: unknown,
  expectedUpdatedAtRaw: string,
): Promise<SettingsFormState> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return { error: getErrorInfo(admin.code).message, conflict: false, success: false };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
      conflict: false,
      success: false,
    };
  }

  // expectedUpdatedAtRaw は DB から読んだマイクロ秒精度の ISO 文字列 (hidden field)。
  // Date を経由すると精度が落ちて .eq が恒久的に不一致になるため、生文字列のまま渡す。
  const result = await settingsFacade.update(key, parsed.data, expectedUpdatedAtRaw);

  if (!result.ok) {
    if (result.code === "KMB-E103") {
      return {
        error: "他の人がこの内容を更新しています。ページを再読み込みして最新の内容を確認してください。",
        conflict: true,
        success: false,
      };
    }
    return { error: result.detail ?? getErrorInfo(result.code).message, conflict: false, success: false };
  }

  revalidatePath("/admin/settings");
  return { error: null, conflict: false, success: true };
}

export async function updateCompanySettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    representative: String(formData.get("representative") ?? ""),
    address: String(formData.get("address") ?? ""),
    tel: emptyToNull(formData.get("tel")),
    email: emptyToNull(formData.get("email")),
    founded: emptyToNull(formData.get("founded")),
    business_hours: emptyToNull(formData.get("business_hours")),
  };
  return submitSettingsForm("company", zCompanySettings, raw, String(formData.get("expected_updated_at") ?? ""));
}

export async function updateHeroSettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    heading: String(formData.get("heading") ?? ""),
    subheading: String(formData.get("subheading") ?? ""),
    cta_label: String(formData.get("cta_label") ?? ""),
    cta_href: String(formData.get("cta_href") ?? ""),
  };
  return submitSettingsForm("hero", zHeroSettings, raw, String(formData.get("expected_updated_at") ?? ""));
}

export async function updateSeoDefaultsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    title_template: String(formData.get("title_template") ?? ""),
    description: String(formData.get("description") ?? ""),
    og_media_id: String(formData.get("og_media_id") ?? ""),
  };
  return submitSettingsForm(
    "seo_defaults",
    zSeoDefaults,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
}

export async function updateOpsLimitsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    x_monthly_post_limit: Number(formData.get("x_monthly_post_limit") ?? 0),
  };
  return submitSettingsForm("ops_limits", zOpsLimits, raw, String(formData.get("expected_updated_at") ?? ""));
}

export async function updateNotificationsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    inquiry_to: String(formData.get("inquiry_to") ?? ""),
    on_publish_failure: formData.get("on_publish_failure") === "on",
  };
  return submitSettingsForm(
    "notifications",
    zNotificationSettings,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
}
