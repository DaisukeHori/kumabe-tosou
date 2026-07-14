import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { createPricingFacade } from "@/modules/pricing/facade";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

import { CalendarSecondaryTabs } from "../_ui/secondary-tabs";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "工数テンプレート | カレンダー" };
export const dynamic = "force-dynamic";

/**
 * /admin/calendar/templates (03-scheduling.md §10.3)。
 * grade/size Select の候補は app 層 (本 page.tsx) が PricingFacade.getActivePriceTable() から
 * 取得して props で渡す (pricing の import は page.tsx のみ許可 — §1.3)。
 */
export default async function AdminCalendarTemplatesPage() {
  const schedulingFacade = createSchedulingFacade();
  const pricingFacade = createPricingFacade();

  const [templatesResult, workTypesResult, priceTableResult] = await Promise.all([
    schedulingFacade.listWorkTemplates(true),
    schedulingFacade.listWorkTypes(false),
    pricingFacade.getActivePriceTable(),
  ]);

  const templates = templatesResult.ok ? templatesResult.value : [];
  const workTypes = workTypesResult.ok ? workTypesResult.value : [];
  const grades = priceTableResult.ok ? priceTableResult.value.grades.filter((g) => g.is_active) : [];
  const sizes = priceTableResult.ok ? priceTableResult.value.size_classes : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="工数テンプレート"
        description="グレード×サイズから作業ブロックのセットを自動生成するための標準工数テンプレートです。"
      />
      <CalendarSecondaryTabs />
      {!templatesResult.ok && (
        <p className="text-sm text-destructive">一覧の取得に失敗しました ({templatesResult.code})。再読み込みしてください。</p>
      )}
      <Surface className="p-6">
        <TemplateEditor
          initialTemplates={templates}
          workTypes={workTypes}
          grades={grades.map((g) => ({ key: g.key, label: g.label }))}
          sizes={sizes.map((s) => ({ key: s.key, label: s.label }))}
        />
      </Surface>
    </div>
  );
}
