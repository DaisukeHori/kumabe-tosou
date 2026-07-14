"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import type { z } from "zod";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { mediaFacade } from "@/modules/media/facade";
import type { Result } from "@/modules/platform/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import {
  zAnalyticsSettings,
  zBrandingSettings,
  zCompanySettings,
  zHeroSettings,
  zInvoiceIssuerSettings,
  zNotificationSettings,
  zOpsLimits,
  zSeoDefaults,
  zWorkCapacitySettings,
  type SettingsKey,
  type SettingsValue,
} from "@/modules/settings/contracts";
import { SITE_SETTINGS_CACHE_TAG, settingsFacade } from "@/modules/settings/facade";

import type { SettingsFormState } from "./form-state";

/**
 * 角印画像の保存先 (02-sales.md §2.3.3 / migration 0028 コメント参照)。private バケット
 * 'branding-assets' への書込は「admin 設定タブ「請求書発行者」の Server Action が service client で
 * upload する」設計 (0028 のコメントに明記済み) ── sales facade を経由せず、この app 層
 * Server Action が直接 service client を使う (Storage バケットは Postgres テーブルではないため
 * module-contracts.md §2 の repository 境界 (ESLint no-restricted-imports) の対象外。
 * @/lib/supabase/service は module-scoped import ではなく、どのファイルからでも import 可)。
 * パスは固定 1 本 (`invoice-issuer/seal`, 拡張子なし) にして upsert:true で常に上書きする
 * (角印は事業者ごとに 1 枚のみで版管理も不要 — issued-documents のような不変台帳ではない。
 * migration 0028: 「角印は差し替え・削除が正当な運用」。固定パスなら再アップロードのたびに
 * ランダム名の孤児ファイルが Storage に溜まることもない)。拡張子を持たないパスでも Storage の
 * contentType メタデータで正しい MIME が返るため、<img src=署名URL> の表示に支障はない。
 */
const BRANDING_ASSETS_BUCKET = "branding-assets";
const INVOICE_ISSUER_SEAL_PATH = "invoice-issuer/seal";
// 未解決点4 (実装計画書 issue-51.md): canonical にサイズ/MIME 上限の明記なし。media/facade.ts の
// createUploadUrl (画像アップロードの既存上限 — 10MB) より厳しい 2MB を角印用に採用した
// (角印は小さな印影画像のはずで、10MB は明らかに過大 — 実装者判断。openIssues に記録)。
const SEAL_MAX_BYTES = 2 * 1024 * 1024;
const SEAL_ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

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
  // 05-site-settings.md §5.6 / issue #47: getPublicValue (unstable_cache, タグ "site_settings")
  // は書き込み側が revalidate する規約 (facade.ts の SITE_SETTINGS_CACHE_TAG コメント参照)。
  // 全キー共通のこの関数からタグ失効させることで、analytics/branding/seo_defaults 等
  // 公開側が参照するキーの保存が公開ページ (generateMetadata・GA 注入・/icon) に反映される。
  revalidateTag(SITE_SETTINGS_CACHE_TAG);
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

/** OG 画像の推奨サイズ (1200x630、1.91:1)。§6.2「OG 寸法逸脱」判定の基準値。 */
const OG_IMAGE_TARGET_RATIO = 1200 / 630;
/** 縦横比の許容誤差 (±10%)。canonical に明記なし — 実装者判断 (issue-47.md 成果物3-4 参照)。 */
const OG_IMAGE_RATIO_TOLERANCE = 0.1;

export async function updateSeoDefaultsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    title_template: String(formData.get("title_template") ?? ""),
    description: String(formData.get("description") ?? ""),
    og_media_id: String(formData.get("og_media_id") ?? ""),
  };
  const result = await submitSettingsForm(
    "seo_defaults",
    zSeoDefaults,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
  if (!result.success) return result;

  // 保存成功後のベストエフォート後処理 (issue-47.md 成果物3-4 の設計判断: submitSettingsForm の
  // シグネチャは変えず、共通関数の戻り値をこの Action 内で受け取ってから warning を上書きする。
  // canonical (05-site-settings.md §4.3/§6.2) は warning を返す仕様のみ明記し、共通関数と
  // 各 Action の分担方法までは規定していないため実装者判断 — 理由: submitSettingsForm は他 8
  // Action からも呼ばれる共通ルートであり、JPEG ensure や寸法判定という seo_defaults 固有の
  // 責務をそこに混ぜると他キーの保存経路にまで影響する変更になってしまう)。
  // JPEG ensure/寸法チェックの失敗はここでは保存を失敗させない (result.success は変えない) —
  // 既に site_settings への書き込みは完了しているため、ここで ok:false 相当を返すと
  // 「保存できたのに失敗したように見える」誤報告になる。
  const ensureResult = await mediaFacade.getJpegRenditionUrl(raw.og_media_id);
  if (!ensureResult.ok) {
    console.error("[settings/actions] OG 画像の JPEG 変換 (ensure) に失敗しました:", ensureResult.detail);
    // JPEG ensure 失敗と寸法警告が両方発生しうる場合は ensure 失敗を優先 (early return)。
    // canonical に優先順位の明記なし — 実装コスト最小の単純な early return を採用
    // (issue-47.md 未解決点#3 の判断をそのまま踏襲)。
    return { ...result, warning: "OG 画像の JPEG 変換に失敗しました。再保存で再試行されます。" };
  }

  const media = await mediaFacade.getById(raw.og_media_id);
  // getById 失敗 (media 行が見つからない等) は寸法警告を出さずにスキップ — ベストエフォートで
  // あり、保存自体は既に成功しているため、ここでの二次取得失敗をユーザーへ露呈しない。
  if (media.ok) {
    const ratio = media.value.width / media.value.height;
    const deviation = Math.abs(ratio - OG_IMAGE_TARGET_RATIO) / OG_IMAGE_TARGET_RATIO;
    if (deviation > OG_IMAGE_RATIO_TOLERANCE) {
      return {
        ...result,
        warning: "OG 画像の縦横比が推奨サイズ (1200×630, 1.91:1) から外れています。",
      };
    }
  }
  return result;
}

/** 「計測」タブ (05-site-settings.md §6.2 AnalyticsForm)。GA4 測定 ID 1 項目のみ、空欄で計測無効。 */
export async function updateAnalyticsSettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = { ga4_measurement_id: emptyToNull(formData.get("ga4_measurement_id")) };
  return submitSettingsForm(
    "analytics",
    zAnalyticsSettings,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
}

/**
 * 「ブランディング」タブ (05-site-settings.md §6.2 BrandingForm)。favicon の media 参照 1 項目。
 * 寸法警告 (非正方形/128px未満) は保存を失敗させない — submitSettingsForm の戻り値をここで
 * 受け取ってから warning を上書きする設計 (updateSeoDefaultsAction と同型。issue-47.md
 * 成果物3-3 の判断根拠も同様: 共通関数のシグネチャを変えずに済み、warning 判定はキー固有の
 * 責務として各 Action に閉じ込められる)。
 */
export async function updateBrandingSettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const faviconMediaId = emptyToNull(formData.get("favicon_media_id"));
  const result = await submitSettingsForm(
    "branding",
    zBrandingSettings,
    { favicon_media_id: faviconMediaId },
    String(formData.get("expected_updated_at") ?? ""),
  );
  // 「既定に戻す」(favicon_media_id = null) での保存は寸法チェック対象外。
  if (!result.success || !faviconMediaId) return result;

  const media = await mediaFacade.getById(faviconMediaId);
  // getById 失敗はベストエフォートでスキップ (保存自体は既に成功済み — 誤報告を避ける)。
  if (!media.ok) return result;
  const { width, height } = media.value;
  if (width !== height || Math.min(width, height) < 128) {
    return {
      ...result,
      warning: "もう少し正方形に近い画像がおすすめです (推奨: 512×512 以上の正方形 PNG)。",
    };
  }
  return result;
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

/**
 * 角印画像の Storage アップロード (02-sales.md §8.6 / #51)。MediaPicker/media モジュールは
 * 使わない (v1.2 是正の核心 — 07-contracts-delta §D5: media は anon 全行 SELECT + public バケット
 * のため社印が匿名取得可能になる事故を防ぐため。branding-assets は private バケット)。
 * "use server" ファイルは async 関数以外を export できないため非 export の内部ヘルパとする。
 */
async function uploadInvoiceIssuerSeal(file: File): Promise<Result<{ storagePath: string }>> {
  if (file.size === 0) {
    return { ok: false, code: "KMB-E101", detail: "画像ファイルを選択してください。" };
  }
  if (file.size > SEAL_MAX_BYTES) {
    return { ok: false, code: "KMB-E302", detail: "角印画像は 2MB 以内にしてください。" };
  }
  if (!SEAL_ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false, code: "KMB-E302", detail: "角印画像は PNG または JPEG 形式のみアップロードできます。" };
  }

  let serviceClient: ReturnType<typeof createSupabaseServiceClient>;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await serviceClient.storage.from(BRANDING_ASSETS_BUCKET).upload(INVOICE_ISSUER_SEAL_PATH, buffer, {
    contentType: file.type,
    upsert: true, // 角印は差し替え・削除が正当な運用 (issued-documents と異なり不変ではない — migration 0028)
  });
  if (error) {
    return { ok: false, code: "KMB-E901", detail: error.message };
  }
  return { ok: true, value: { storagePath: INVOICE_ISSUER_SEAL_PATH } };
}

/**
 * 「請求書発行者」タブの保存 (02-sales.md §8.6)。角印画像は同一フォーム内の `<input type="file">`
 * (`seal_image`) から任意で受け取る ── 未選択なら hidden field `seal_storage_path` (現在値) を
 * そのまま使う。1 フォーム = 1 submitSettingsForm 呼び出しに統合したのは、角印アップロードと
 * 他フィールド保存を別 Server Action に分離すると「アップロード成功後に他フィールド保存フォームの
 * updated_at が古くなり次の保存が KMB-E103 になる」楽観排他の競合を構造的に踏むため
 * (実装計画書 issue-51.md の角印アップロード節「注意・地雷」参照 ── 単一フォーム化はその節が
 * 挙げた 2 案のうち安全側 [競合が原理的に起きない] を選んだ実装者判断)。
 */
export async function updateInvoiceIssuerSettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return { error: getErrorInfo(admin.code).message, conflict: false, success: false };
  }

  let sealStoragePath = emptyToNull(formData.get("seal_storage_path"));
  const sealFile = formData.get("seal_image");
  if (sealFile instanceof File && sealFile.size > 0) {
    const uploaded = await uploadInvoiceIssuerSeal(sealFile);
    if (!uploaded.ok) {
      return {
        error: uploaded.detail ?? getErrorInfo(uploaded.code).message,
        conflict: false,
        success: false,
      };
    }
    sealStoragePath = uploaded.value.storagePath;
  }

  const bankAccountEnabled = formData.get("bank_account_enabled") === "on";
  const raw = {
    issuer_name: String(formData.get("issuer_name") ?? ""),
    registration_number: emptyToNull(formData.get("registration_number")),
    tax_rounding: String(formData.get("tax_rounding") ?? "floor"),
    bank_account: bankAccountEnabled
      ? {
          bank_name: String(formData.get("bank_name") ?? ""),
          branch_name: String(formData.get("branch_name") ?? ""),
          account_type: String(formData.get("account_type") ?? "ordinary"),
          account_number: String(formData.get("account_number") ?? ""),
          account_holder_kana: String(formData.get("account_holder_kana") ?? ""),
        }
      : null,
    transfer_fee_note: emptyToNull(formData.get("transfer_fee_note")),
    seal_storage_path: sealStoragePath,
    quote_valid_days: Number(formData.get("quote_valid_days") ?? 30),
  };
  return submitSettingsForm(
    "invoice_issuer",
    zInvoiceIssuerSettings,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
}
