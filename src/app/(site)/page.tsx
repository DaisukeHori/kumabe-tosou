import { pageMediaFacade } from "@/modules/page-media/facade";

import { HomePageBody } from "./page-body";

/**
 * 公開ルート ((site))。cached 経路: resolveAll() (unstable_cache 経由)。
 * request-time API は一切読まない (純 SSG 維持、docs/design/visual-media-editor.md §4.2)。
 */
export default async function Home() {
  const slotsResult = await pageMediaFacade.resolveAll();
  const slots = slotsResult.ok ? slotsResult.value : {};

  return <HomePageBody slots={slots} editMode={false} />;
}
