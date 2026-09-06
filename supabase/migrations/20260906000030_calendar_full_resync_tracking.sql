-- 20260906000030_calendar_full_resync_tracking.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.3 / §8.5 (フル再同期の逆方向突合)
-- 本 migration が追加するもの:
--   1. calendar_connections.full_resync_started_at
--      フル再同期ラウンド (sync_token=NULL からの開始) の開始時刻。ラウンドが複数起床にまたがる場合
--      (ページ上限で sync_page_cursor 保存 → 次起床で継続) でも、ラウンド完了時の orphaned 判定を
--      「link.last_pulled_at < full_resync_started_at (または NULL)」で行えるようにする。
--      旧実装はプロセス内メモリの観測集合で突合していたため、起床をまたぐと前起床で観測済みの link が
--      一括で誤 orphaned 化していた。ラウンド完了時に NULL へ戻す。
-- 本 migration が行わないこと: calendar_event_links.last_pulled_at の追加 (0030 で作成済み。
--   pull が観測した link に毎回刻む既存列をそのまま観測マーカーとして使う)。

alter table calendar_connections
  add column if not exists full_resync_started_at timestamptz;

comment on column calendar_connections.full_resync_started_at is
  'フル再同期ラウンドの開始時刻 (§8.5 逆方向突合の基準)。ラウンド中のみ非 NULL。'
  '完了時に calendar_event_links.last_pulled_at がこれより古い (または NULL) link だけを orphaned 化し、NULL に戻す';
