import type { Metadata } from "next";

import { settingsFacade } from "@/modules/settings/facade";

import { SettingsTabs, type SettingsTabsData } from "./settings-forms";

export const metadata: Metadata = { title: "サイト設定" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [company, hero, seoDefaults, opsLimits, notifications] = await Promise.all([
    settingsFacade.getWithMeta("company"),
    settingsFacade.getWithMeta("hero"),
    settingsFacade.getWithMeta("seo_defaults"),
    settingsFacade.getWithMeta("ops_limits"),
    settingsFacade.getWithMeta("notifications"),
  ]);

  const data: SettingsTabsData = {
    company: company.ok ? company.value : { value: null, updatedAt: null, isUnset: true },
    hero: hero.ok ? hero.value : { value: null, updatedAt: null, isUnset: true },
    seo_defaults: seoDefaults.ok ? seoDefaults.value : { value: null, updatedAt: null, isUnset: true },
    ops_limits: opsLimits.ok ? opsLimits.value : { value: null, updatedAt: null, isUnset: true },
    notifications: notifications.ok ? notifications.value : { value: null, updatedAt: null, isUnset: true },
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">サイト設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          会社情報・ヒーロー・SEO既定値・運用上限・通知設定を編集します。保存は楽観的排他 (他の人が更新済みの場合は警告を表示) です。
        </p>
      </div>
      <SettingsTabs data={data} />
    </div>
  );
}
