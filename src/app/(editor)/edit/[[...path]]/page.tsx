import { notFound } from "next/navigation";

import { platformFacade } from "@/modules/platform/facade";

import { matchEditRoute, renderEditRouteBody } from "../page-map";

/**
 * 編集プレビュー専用ルート `/edit/**` (canonical: docs/design/visual-media-editor.md §5.3)。
 *
 * - force-dynamic: 毎リクエスト最新、Route Cache に載らない。
 * - platformFacade.requireAdmin() を必ず呼ぶ (middleware と合わせて defense in depth)。
 *   失敗時は notFound() (任意パスの反射をしない、脅威モデル §5.3 参照)。
 * - path を page-map (EDITABLE_ROUTES ホワイトリスト相当) で解決し、該当ページボディを
 *   editMode=true で描画する。照合失敗・対象コンテンツ不在は notFound()。
 */
export const dynamic = "force-dynamic";

export default async function EditPage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) notFound();

  const { path } = await params;
  const match = matchEditRoute(path);
  if (!match) notFound();

  const body = await renderEditRouteBody(match);
  if (body === null) notFound();

  return body;
}
