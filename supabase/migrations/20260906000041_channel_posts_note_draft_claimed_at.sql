-- =========================================================
-- channel_posts.note_draft_claimed_at: note 下書き 'creating' 固着の回収 (2026-09-06 監査修正 #6)
-- canonical: docs/design/ai-studio-v2.md §8 (note 下書き自動化・MAJOR-3) / cms-ai-pipeline.md §8.3
--
-- 問題: DistributionFacade.createNoteDraft は CAS (none/failed/unknown → creating) で排他するが、
--   creating へ遷移した後にプロセスがクラッシュ (Vercel の実行時間上限・デプロイ切替等) すると
--   終端遷移 (created/failed/unknown) に到達せず、以後の呼び出しは CAS が常に失敗して
--   永久に「作成中」を返す (回収経路が無かった)。
--
-- 対策: creating へ遷移した時刻を note_draft_claimed_at に記録し、
--   「creating かつ claimed_at が 10 分超前 (旧行で null も含む)」を CAS の遷移元に含める
--   (repository.claimNoteDraftCreating)。回収した側は下書き一覧との照合 (reconcile) を経て
--   再作成するため、前回が実は成功していた場合も重複下書きを作らない。
-- =========================================================

alter table channel_posts
  add column if not exists note_draft_claimed_at timestamptz;

comment on column channel_posts.note_draft_claimed_at is
  'note_draft_status が creating に遷移した時刻。creating のまま 10 分超経過した行は固着とみなし claimNoteDraftCreating の CAS 遷移元に含める (回収側は reconcile 後に再作成)。';
