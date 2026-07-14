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
  zWorkCapacitySettings,
  type SettingsKey,
  type SettingsValue,
} from "@/modules/settings/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import type { SettingsFormState } from "./form-state";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length === 0 ? null : s;
}

/**
 * #59 (telephony 画面): calls/actions.ts の saveTelephonySettingsAction / saveBusinessHoursAction が
 * 本ヘルパーを再利用するため export 化した (計画書 issue-59.md 未解決点#1 のデフォルト方針 —
 * canonical 04-telephony.md §7.4 が Server Actions の実装場所を `src/app/admin/calls/actions.ts` と
 * 明記しているため、フォーム描画は settings 配下でも保存アクションの本体は calls/actions.ts に置く)。
 */
export async function submitSettingsForm<K extends SettingsKey>(
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

/**
 * ops_limits は単一の site_settings 行 (JSONB) に x_monthly_post_limit (既存) と
 * AI 予算関連 3 フィールド (ai-studio-v2.md §1/§2、settings/contracts.ts zOpsLimits) が同居する。
 * 「運用上限」タブ (X 投稿上限のみ編集) と「AI」タブ (予算のみ編集) の 2 フォームに分かれるため、
 * 各フォームは自分が編集しない分のフィールドを hidden input で現在値のまま持ち回して
 * 他タブの値を上書きしないようにする (両フォームとも本関数の raw 組み立て方は同型)。
 */
export async function updateOpsLimitsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    x_monthly_post_limit: Number(formData.get("x_monthly_post_limit") ?? 0),
    ai_monthly_budget_micro_usd: Number(formData.get("ai_monthly_budget_micro_usd") ?? 0),
    ai_monthly_image_limit: Number(formData.get("ai_monthly_image_limit") ?? 0),
    ai_default_image_model: emptyToNull(formData.get("ai_default_image_model")),
  };
  return submitSettingsForm("ops_limits", zOpsLimits, raw, String(formData.get("expected_updated_at") ?? ""));
}

/** AI タブの予算サブフォーム (/admin/settings §6-3)。x_monthly_post_limit は hidden で現在値を保持する。 */
export async function updateAiBudgetAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    x_monthly_post_limit: Number(formData.get("x_monthly_post_limit") ?? 0),
    ai_monthly_budget_micro_usd: Number(formData.get("ai_monthly_budget_micro_usd") ?? 0),
    ai_monthly_image_limit: Number(formData.get("ai_monthly_image_limit") ?? 0),
    ai_default_image_model: emptyToNull(formData.get("ai_default_image_model")),
  };
  return submitSettingsForm("ops_limits", zOpsLimits, raw, String(formData.get("expected_updated_at") ?? ""));
}

/**
 * 「週間稼働」タブ (03-scheduling.md §3.4)。weekly_hours 数値入力 1 個のみ。
 * scheduling モジュールからの読み出しは SettingsFacade.get('work_capacity') 経由 (facade §6.2)。
 * 書込 (update) は所有モジュールの settings 側 Server Action で行う規約どおり、ここに置く。
 */
export async function updateWorkCapacityAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    weekly_hours: Number(formData.get("weekly_hours") ?? 0),
  };
  return submitSettingsForm(
    "work_capacity",
    zWorkCapacitySettings,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
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
