-- 20260906000051_telephony_task_ids_checkpoint.sql
-- canonical: docs/design/crm-suite/04-telephony.md §6.5.4 手順 4 (タスク起票) / 00-overview §3.1.4-8 (チェックポイント)
-- 目的: linking ステージのタスク起票を冪等にする。matched/created 経路は crm 側の
--   (source_activity_id, title) 一意 index が二重起票を防ぐが、ambiguous / no_number 経路は
--   activity を作らず source_activity_id が null のため index が効かず、commit 前クラッシュ → 再入の
--   たびに同じタスクが増殖していた。transcript_partial と同型のチェックポイント列を追加し、
--   worker は createTask 1 件ごとに起票済み task_id (analysis.tasks の順) を保存、再入時は再利用する。
-- 書込は lease 保持中の service 直接 UPDATE (lease_token 一致 — migration 20260906000050)。
alter table call_jobs add column if not exists task_ids_checkpoint jsonb;

comment on column call_jobs.task_ids_checkpoint is
  'linking のタスク起票チェックポイント (uuid 文字列の配列、analysis.tasks と同順)。commit 前クラッシュ再入時に再利用して二重起票を防ぐ。link_result.task_ids 確定後は参照されない (残置可)';
