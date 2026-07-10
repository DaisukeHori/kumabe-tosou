import { describe, expect, it } from "vitest";

/**
 * tester 検証 (2026-07-10): ai_draft_cleanup_run RPC
 * (supabase/migrations/20260710000016_ai_draft_cleanup.sql) の削除判定条件を検証する。
 *
 * この repo の vitest はプレーン Node 環境で DB を持たない (Supabase client を丸ごとモックする
 * 方針。tests/ai-providers-image-lineage.test.ts 等と同型) ため、SQL 関数そのものを CI 上で
 * 実行することはできない。そのため、実際の SQL 述語 (WHERE 句の AND 条件) を 1:1 で転記した
 * 純粋関数 (isAiDraftCleanupCandidate) をここに複製し、境界値を含む全パターンを固定して回帰させる。
 *
 * 実SQL相当性の担保 (このファイルはあくまで「複製が壊れていないか」の回帰用):
 * 2026-07-10、tester がローカル Postgres 16 (homebrew, docker 不使用) に最小スキーマ
 * (media / ai_image_generations / ai_image_generation_sources / work_images / works / posts /
 * voices / site_settings / page_media) を作成し、migration ファイルから
 * `ai_draft_cleanup_run` 関数定義を **awk で verbatim 抽出**して読み込み、
 * 下記と同一の 14 パターンを実データで INSERT → 実行 → DELETE 結果を確認済み
 * (一時クラスタは検証後に破棄。コミットには残していない)。
 *
 * その検証で **本物の SQL バグを発見**: `delete from media ... returning id, storage_path` が
 * RETURNS TABLE の出力列 `storage_path` と名前衝突し
 * "column reference "storage_path" is ambiguous" で **毎回失敗**していた
 * (=cron が起床するたびに全滅していたはずの実害バグ)。
 * `delete from media md ... returning md.id, md.storage_path` に修正し、再度同一 14 パターンで
 * PASS することを確認した上で migration ファイルに適用済み。
 *
 * SQL 側 (migration) を変更した場合は、この複製 (isAiDraftCleanupCandidate) も同時に
 * 更新すること。乖離すると本テストが検証として無意味になる。
 */

type MediaRow = {
  id: string;
  tags: string[];
  createdAt: Date;
};

type GenerationRow = {
  mediaId: string;
  isSelected: boolean;
};

type ReferenceSets = {
  workImages?: Set<string>;
  worksCover?: Set<string>;
  postsCover?: Set<string>;
  voicesPhoto?: Set<string>;
  siteSettingsMediaId?: Set<string>; // site_settings.value.media_id もしくは og_media_id
  pageMedia?: Set<string>;
  generationSources?: Set<string>; // ai_image_generation_sources.media_id
};

/**
 * ai_draft_cleanup_run の candidates CTE の WHERE 句 (AND 条件) を 1:1 転記したもの。
 * migration 本文 (20260710000016) 側の条件と行単位で対応させてあるので、
 * SQL を読みながら差分が無いか照合できる。
 */
function isAiDraftCleanupCandidate(media: MediaRow, cutoff: Date, generations: GenerationRow[], refs: ReferenceSets): boolean {
  // m.tags @> array['ai-draft']
  if (!media.tags.includes("ai-draft")) return false;
  // m.created_at < p_cutoff
  if (!(media.createdAt < cutoff)) return false;
  // exists (select 1 from ai_image_generations aig where aig.media_id = m.id and aig.is_selected = false)
  const hasUnselectedGeneration = generations.some((g) => g.mediaId === media.id && g.isSelected === false);
  if (!hasUnselectedGeneration) return false;
  // not exists (... work_images ...)
  if (refs.workImages?.has(media.id)) return false;
  // not exists (... works.cover_media_id ...)
  if (refs.worksCover?.has(media.id)) return false;
  // not exists (... posts.cover_media_id ...)
  if (refs.postsCover?.has(media.id)) return false;
  // not exists (... voices.photo_media_id ...)
  if (refs.voicesPhoto?.has(media.id)) return false;
  // not exists (... site_settings.value @> {media_id|og_media_id} ...)
  if (refs.siteSettingsMediaId?.has(media.id)) return false;
  // not exists (... page_media ...)
  if (refs.pageMedia?.has(media.id)) return false;
  // not exists (... ai_image_generation_sources ...)
  if (refs.generationSources?.has(media.id)) return false;
  return true;
}

const NOW = new Date("2026-07-10T00:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000); // p_cutoff 既定値と同じ 7 日前
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000 - extraMs);

describe("ai_draft_cleanup_run 削除判定条件 (AND 全条件・実 Postgres 16 で cross-check 済み)", () => {
  it("baseline: ai-draft タグ + 未選択 + 参照ゼロ + 7日経過 → 削除対象になる", () => {
    const media: MediaRow = { id: "m1", tags: ["ai-generated", "ai-draft"], createdAt: daysAgo(8) };
    const generations: GenerationRow[] = [{ mediaId: "m1", isSelected: false }];
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, {})).toBe(true);
  });

  it("境界: 6日23時間 (7日未満) → 削除対象にならない", () => {
    const media: MediaRow = { id: "m2", tags: ["ai-generated", "ai-draft"], createdAt: daysAgo(6, 23 * 60 * 60 * 1000) };
    const generations: GenerationRow[] = [{ mediaId: "m2", isSelected: false }];
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, {})).toBe(false);
  });

  it("境界: 7日と1分経過 → 削除対象になる", () => {
    const media: MediaRow = { id: "m3", tags: ["ai-generated", "ai-draft"], createdAt: daysAgo(7, 60 * 1000) };
    const generations: GenerationRow[] = [{ mediaId: "m3", isSelected: false }];
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, {})).toBe(true);
  });

  it("選択済み (is_selected=true) だが ai-draft タグが残存 → 絶対に削除しない", () => {
    const media: MediaRow = { id: "m4", tags: ["ai-generated", "ai-draft"], createdAt: daysAgo(8) };
    const generations: GenerationRow[] = [{ mediaId: "m4", isSelected: true }];
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, {})).toBe(false);
  });

  it("他の生成の参照画像として ai_image_generation_sources から参照されている → 削除しない", () => {
    const media: MediaRow = { id: "m5", tags: ["ai-generated", "ai-draft"], createdAt: daysAgo(8) };
    const generations: GenerationRow[] = [{ mediaId: "m5", isSelected: false }];
    const refs: ReferenceSets = { generationSources: new Set(["m5"]) };
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, refs)).toBe(false);
  });

  it.each([
    ["work_images", { workImages: new Set(["m6"]) }],
    ["works.cover_media_id", { worksCover: new Set(["m6"]) }],
    ["posts.cover_media_id", { postsCover: new Set(["m6"]) }],
    ["voices.photo_media_id", { voicesPhoto: new Set(["m6"]) }],
    ["site_settings (media_id/og_media_id)", { siteSettingsMediaId: new Set(["m6"]) }],
    ["page_media", { pageMedia: new Set(["m6"]) }],
  ] as [string, ReferenceSets][])("%s から参照されている → 削除しない", (_label, refs) => {
    const media: MediaRow = { id: "m6", tags: ["ai-generated", "ai-draft"], createdAt: daysAgo(8) };
    const generations: GenerationRow[] = [{ mediaId: "m6", isSelected: false }];
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, refs)).toBe(false);
  });

  it("ai-draft タグが無い (ai-generated のみ) → 未選択かつ7日経過でも削除しない", () => {
    const media: MediaRow = { id: "m7", tags: ["ai-generated"], createdAt: daysAgo(8) };
    const generations: GenerationRow[] = [{ mediaId: "m7", isSelected: false }];
    expect(isAiDraftCleanupCandidate(media, CUTOFF, generations, {})).toBe(false);
  });

  it("ai_image_generations 行が無い (AI 生成由来ではない media に手動で ai-draft タグが付いている) → 削除しない", () => {
    const media: MediaRow = { id: "m8", tags: ["ai-draft"], createdAt: daysAgo(8) };
    expect(isAiDraftCleanupCandidate(media, CUTOFF, [], {})).toBe(false);
  });
});
