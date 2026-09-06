-- =========================================================
-- channel_posts: 同一 draft の重複予約防止 (2026-09-06 監査修正 #2)
-- canonical: docs/design/cms-ai-pipeline.md §4.3 / §8.2、docs/module-contracts.md §5 distribution
--
-- 問題: schedulePosts は draft 単位で channel_posts を insert するが、同じ draft を含む予約
--   リクエストを二度送ると (UI の二重送信・複数タブ) 同一 draft の active な行が複数できて
--   worker が同じ内容を二度投稿しうる。idempotency_key は行ごとに gen_random_uuid() される
--   自システム内の二重取得防止用であり、draft 単位の重複は防げない。
--
-- 対策: draft_id に対する partial unique index。対象は「有効な予約」とみなす状態集合
--   (scheduled / publishing / published / manual_required)。failed / cancelled は再予約を
--   許すため対象外 (同じ draft を failed 後に再予約するのは正当な運用)。
--   違反 (23505) は distribution/repository.ts の pgErrorToResult が KMB-E102 に変換する。
--   facade.schedulePosts は entries 内の draft_id 重複と既存 active 行を事前チェックして
--   同じ KMB-E102 を返す (本 index は最終防衛線)。
--
-- 注: 既に重複行が存在する環境では本 migration が失敗する。その場合は重複側の行を
--   cancelled に遷移させてから再適用する (運用手順。自動削除はしない — 投稿済みかもしれないため)。
-- =========================================================

-- 事前チェック: 既存の重複行があれば index 作成の unique_violation より分かりやすいメッセージで停止する
-- (是正クエリを message に含める。自動で cancelled にはしない — 投稿済みの行かもしれないため)
do $$
declare
  v_dups int;
begin
  select count(*) into v_dups from (
    select draft_id
    from channel_posts
    where status in ('scheduled', 'publishing', 'published', 'manual_required')
    group by draft_id
    having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception using
      errcode = 'unique_violation',
      message = format(
        'KMB-E102: channel_posts に同一 draft の有効な予約が重複している draft が %s 件あります。'
        || '重複側を cancelled に遷移させてから再適用してください: '
        || 'select draft_id, count(*) from channel_posts where status in '
        || '(''scheduled'',''publishing'',''published'',''manual_required'') group by 1 having count(*) > 1;',
        v_dups);
  end if;
end $$;

create unique index if not exists channel_posts_active_draft_uniq
  on channel_posts (draft_id)
  where status in ('scheduled', 'publishing', 'published', 'manual_required');

comment on index channel_posts_active_draft_uniq is
  '同一 draft の有効な予約 (scheduled/publishing/published/manual_required) は 1 件まで。failed/cancelled 後の再予約は許可。違反は KMB-E102。';
