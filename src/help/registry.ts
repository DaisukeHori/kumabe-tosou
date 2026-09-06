import type { HelpDoc } from "./types";
import { HELP_SLUGS, type HelpSlug } from "./slugs";

/**
 * slug → ヘルプ本文の遅延 import 表。
 * canonical: docs/design/admin-help/README.md §3。
 *
 * - まだ書かれていないページは `{ status: "pending" }` のまま置いておく。
 *   /help/<slug> は「準備中」を表示し、リンク切れにはならない。
 * - 執筆できたら src/help/content/<slug>.tsx を作り、この表の 1 行を
 *   `{ status: "ready", load: () => import("./content/<slug>") }` に差し替える。
 * - import のパスは静的な文字列で書くこと (変数で組み立てるとバンドルに含まれない)。
 */
export type HelpRegistryEntry =
  | { status: "ready"; load: () => Promise<{ doc: HelpDoc }> }
  | { status: "pending" };

export const HELP_REGISTRY: Record<HelpSlug, HelpRegistryEntry> = {
  dashboard: { status: "ready", load: () => import("./content/dashboard") },
  works: { status: "ready", load: () => import("./content/works") },
  posts: { status: "ready", load: () => import("./content/posts") },
  voices: { status: "ready", load: () => import("./content/voices") },
  media: { status: "ready", load: () => import("./content/media") },
  visual: { status: "ready", load: () => import("./content/visual") },
  studio: { status: "ready", load: () => import("./content/studio") },
  channels: { status: "ready", load: () => import("./content/channels") },
  inquiries: { status: "ready", load: () => import("./content/inquiries") },
  calls: { status: "ready", load: () => import("./content/calls") },
  customers: { status: "ready", load: () => import("./content/customers") },
  deals: { status: "ready", load: () => import("./content/deals") },
  tasks: { status: "ready", load: () => import("./content/tasks") },
  documents: { status: "ready", load: () => import("./content/documents") },
  calendar: { status: "ready", load: () => import("./content/calendar") },
  "calendar-connections": { status: "ready", load: () => import("./content/calendar-connections") },
  "calendar-templates": { status: "ready", load: () => import("./content/calendar-templates") },
  "calendar-types": { status: "ready", load: () => import("./content/calendar-types") },
  prices: { status: "ready", load: () => import("./content/prices") },
  settings: { status: "ready", load: () => import("./content/settings") },
  costs: { status: "ready", load: () => import("./content/costs") },
  login: { status: "ready", load: () => import("./content/login") },
};

/** 本文が用意できている slug の一覧。 */
export function readyHelpSlugs(): HelpSlug[] {
  return HELP_SLUGS.filter((slug) => HELP_REGISTRY[slug].status === "ready");
}

/** まだ書かれていない slug の一覧 (テストの「未作成一覧」表示に使う)。 */
export function pendingHelpSlugs(): HelpSlug[] {
  return HELP_SLUGS.filter((slug) => HELP_REGISTRY[slug].status === "pending");
}

/** 本文を読み込む。未作成なら null (呼び出し側が「準備中」を表示する)。 */
export async function loadHelpDoc(slug: HelpSlug): Promise<HelpDoc | null> {
  const entry = HELP_REGISTRY[slug];
  if (entry.status !== "ready") return null;
  const mod = await entry.load();
  return mod.doc;
}
