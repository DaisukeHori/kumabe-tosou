import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

import { CalendarSecondaryTabs } from "../_ui/secondary-tabs";
import { TypeEditor } from "./type-editor";

export const metadata: Metadata = { title: "作業種別 | カレンダー" };
export const dynamic = "force-dynamic";

/**
 * /admin/calendar/types (03-scheduling.md §10.3)。
 * #52 で実装済みの listWorkTypes/saveWorkType/deleteWorkType facade を使う CRUD 画面のみを
 * この Issue (#53) で追加する (facade 側は既存、UI だけの追加 — 実装計画書の地雷3の推奨対応)。
 */
export default async function AdminCalendarTypesPage() {
  const schedulingFacade = createSchedulingFacade();
  const result = await schedulingFacade.listWorkTypes(true);
  const workTypes = result.ok ? result.value : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="作業種別" description="研磨・下地・塗装などの作業種別マスタ。色とキャパ消費有無を設定します。" />
      <CalendarSecondaryTabs />
      {!result.ok && (
        <p className="text-sm text-destructive">一覧の取得に失敗しました ({result.code})。再読み込みしてください。</p>
      )}
      <Surface className="p-6">
        <TypeEditor initialWorkTypes={workTypes} />
      </Surface>
    </div>
  );
}
