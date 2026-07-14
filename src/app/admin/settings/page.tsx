import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import { settingsFacade } from "@/modules/settings/facade";

import { SettingsTabs, type SettingsTabsData } from "./settings-forms";

export const metadata: Metadata = { title: "サイト設定" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [company, hero, seoDefaults, opsLimits, notifications, workCapacity, aiKeys] = await Promise.all([
    settingsFacade.getWithMeta("company"),
    settingsFacade.getWithMeta("hero"),
    settingsFacade.getWithMeta("seo_defaults"),
    settingsFacade.getWithMeta("ops_limits"),
    settingsFacade.getWithMeta("notifications"),
    settingsFacade.getWithMeta("work_capacity"),
    aiProvidersFacade.listKeys(),
  ]);

  const data: SettingsTabsData = {
    company: company.ok ? company.value : { value: null, updatedAt: null, isUnset: true },
    hero: hero.ok ? hero.value : { value: null, updatedAt: null, isUnset: true },
    seo_defaults: seoDefaults.ok ? seoDefaults.value : { value: null, updatedAt: null, isUnset: true },
    ops_limits: opsLimits.ok ? opsLimits.value : { value: null, updatedAt: null, isUnset: true },
    notifications: notifications.ok ? notifications.value : { value: null, updatedAt: null, isUnset: true },
    work_capacity: workCapacity.ok ? workCapacity.value : { value: null, updatedAt: null, isUnset: true },
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="サイト設定"
        description="会社情報・ヒーロー・SEO既定値・運用上限・通知設定・AI プロバイダを編集します (保存は楽観的排他)。"
      />
      <Surface className="p-6">
        <SettingsTabs data={data} aiKeys={aiKeys.ok ? aiKeys.value : []} />
      </Surface>
    </div>
  );
}
