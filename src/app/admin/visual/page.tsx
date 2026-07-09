import type { Metadata } from "next";

import { PageHeader } from "@/app/admin/_ui";
import { listMediaForPicker } from "@/app/admin/_ui/media-picker-data";
import { EDITABLE_ROUTES } from "@/modules/page-media/facade";

import { VisualEditor, type PageTab } from "./visual-editor";

export const metadata: Metadata = { title: "ビジュアル編集" };
export const dynamic = "force-dynamic";

/**
 * route → ページ表示名。SLOT_REGISTRY (page-media/registry.ts) はスロット単位のラベル
 * (例: "トップ / ヒーロー") しか持たないため、タブ用のページ単位ラベルはここで管理する。
 * 未知の route (今後 EDITABLE_ROUTES に追加された場合) は route 文字列そのものへフォールバックし、
 * タブが消えたり build が壊れたりしないようにする (§5.3a: EDITABLE_ROUTES が canonical)。
 */
const PAGE_LABELS: Record<string, string> = {
  "/": "トップ",
  "/story": "ストーリー",
  "/about": "会社案内",
  "/service": "サービス・料金",
  "/works": "施工事例",
  "/voices": "お客様の声",
  "/materials": "素材対応",
  "/colors": "色見本",
  "/notes": "読みもの",
  "/blog": "ブログ",
  "/shop": "SHOP",
  "/process": "工程",
  "/contact": "相談する",
};

/** EDITABLE_ROUTES からページ選択タブを生成する。動的 detail パターン ("works/[slug]" 等) は
 *  iframe に直接ロードできないため除外する (一覧ページ側の data-editable-content で編集可能)。*/
function buildPageTabs(): PageTab[] {
  const seen = new Set<string>();
  const tabs: PageTab[] = [];
  for (const route of EDITABLE_ROUTES) {
    if (route.includes("[")) continue;
    if (seen.has(route)) continue;
    seen.add(route);
    tabs.push({ route, label: PAGE_LABELS[route] ?? route });
  }
  return tabs;
}

export default async function VisualEditorPage() {
  const tabs = buildPageTabs();
  const initialRoute = tabs[0]?.route ?? "/";
  const media = await listMediaForPicker(100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ビジュアル編集"
        description="ページ上の写真をクリックして差し替えます。ホットスポットは Tab で移動、Enter で選択、Esc で閉じます。"
      />
      {tabs.length === 0 ? (
        <p className="text-sm text-destructive">編集可能なページがありません。</p>
      ) : (
        <VisualEditor
          tabs={tabs}
          initialRoute={initialRoute}
          initialMediaItems={media.items}
          initialMediaNextCursor={media.nextCursor}
        />
      )}
    </div>
  );
}
