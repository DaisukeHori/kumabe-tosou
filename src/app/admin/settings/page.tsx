import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { getEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import { settingsFacade } from "@/modules/settings/facade";
import { telephonyFacade } from "@/modules/telephony/facade";

import { SettingsTabs, type SettingsTabsData } from "./settings-forms";

export const metadata: Metadata = { title: "サイト設定" };
export const dynamic = "force-dynamic";

const BRANDING_ASSETS_BUCKET = "branding-assets";
const SEAL_PREVIEW_SIGNED_URL_TTL_SECONDS = 300; // 5分 (sales facade の resolvePrintView と同じ TTL — §10.6)

/**
 * 角印プレビュー用の署名 URL 解決 (§8.6)。branding-assets は private バケットのため MediaPicker の
 * ような公開 URL を持たない — サーバ側 (Server Component) でこの Page から直接署名 URL を発行する
 * (専用 Server Action を新設せず、page.tsx の初回ロード時に解決する簡潔な設計を選んだ ── 実装計画書
 * issue-51.md「未解決点」に明記の無い実装者判断。プレビューは保存後の revalidatePath で
 * 自動的に最新化される)。失敗は角印プレビュー非表示に degrade するのみ (法的要件ではない — §10.6)。
 */
async function resolveSealPreviewUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  try {
    const serviceClient = createSupabaseServiceClient();
    const { data, error } = await serviceClient.storage
      .from(BRANDING_ASSETS_BUCKET)
      .createSignedUrl(storagePath, SEAL_PREVIEW_SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export default async function AdminSettingsPage() {
  const [
    company,
    hero,
    seoDefaults,
    opsLimits,
    notifications,
    workCapacity,
    telephony,
    businessHours,
    invoiceIssuer,
    aiKeys,
    setupStatus,
  ] = await Promise.all([
    settingsFacade.getWithMeta("company"),
    settingsFacade.getWithMeta("hero"),
    settingsFacade.getWithMeta("seo_defaults"),
    settingsFacade.getWithMeta("ops_limits"),
    settingsFacade.getWithMeta("notifications"),
    settingsFacade.getWithMeta("work_capacity"),
    settingsFacade.getWithMeta("telephony"),
    settingsFacade.getWithMeta("business_hours"),
    settingsFacade.getWithMeta("invoice_issuer"),
    aiProvidersFacade.listKeys(),
    telephonyFacade.getTelephonySetupStatus(),
  ]);

  const data: SettingsTabsData = {
    company: company.ok ? company.value : { value: null, updatedAt: null, isUnset: true },
    hero: hero.ok ? hero.value : { value: null, updatedAt: null, isUnset: true },
    seo_defaults: seoDefaults.ok ? seoDefaults.value : { value: null, updatedAt: null, isUnset: true },
    ops_limits: opsLimits.ok ? opsLimits.value : { value: null, updatedAt: null, isUnset: true },
    notifications: notifications.ok ? notifications.value : { value: null, updatedAt: null, isUnset: true },
    work_capacity: workCapacity.ok ? workCapacity.value : { value: null, updatedAt: null, isUnset: true },
    telephony: telephony.ok ? telephony.value : { value: null, updatedAt: null, isUnset: true },
    business_hours: businessHours.ok ? businessHours.value : { value: null, updatedAt: null, isUnset: true },
    invoice_issuer: invoiceIssuer.ok ? invoiceIssuer.value : { value: null, updatedAt: null, isUnset: true },
  };

  const sealPreviewUrl = await resolveSealPreviewUrl(
    invoiceIssuer.ok ? (invoiceIssuer.value.value?.seal_storage_path ?? null) : null,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="サイト設定"
        description="会社情報・ヒーロー・SEO既定値・運用上限・通知設定・電話・営業時間・請求書発行者・AI プロバイダを編集します (保存は楽観的排他)。"
      />
      <Surface className="p-6">
        <SettingsTabs
          data={data}
          aiKeys={aiKeys.ok ? aiKeys.value : []}
          telephonySetupStatus={setupStatus.ok ? setupStatus.value : null}
          siteUrl={getEnv().NEXT_PUBLIC_SITE_URL}
          sealPreviewUrl={sealPreviewUrl}
        />
      </Surface>
    </div>
  );
}
