-- =========================================================
-- AI スタジオ v2: フルページスクショ基盤の Storage バケット (P2)
-- canonical: docs/design/ai-studio-v2.md §5 (フルページスクショ基盤)・§11 (セキュリティ)
--
-- 本 migration が追加するもの:
--   1) ai-context バケット (非公開・一時保存。§5「一時保存 (Storage ai-context/ 512KB 目標)」)
--   2) admin only RLS (select/insert/update/delete)。ai_provider_keys 等と同型の
--      「anon 不可・admin のみ」方針 (§11「サイトコンテンツ由来のテキストを system prompt に
--      入れない」と同じ思想で、生成物を含む本バケットも公開しない)
--
-- 判断点 (オーケストレーターへ報告済み): 設計書 §5 原文は「Storage ai-context/」とだけ言及し、
-- バケット作成 DDL 自体は明記していない。20260708000003_storage.sql (media/media-originals/
-- audio/backups) と同じパターンで新規バケットとして追加した。本 migration は作成のみで
-- 適用は行わない (実装タスクの禁止事項: DB 適用)。
-- =========================================================

insert into storage.buckets (id, name, public)
values ('ai-context', 'ai-context', false)
on conflict (id) do nothing;

create policy ai_context_admin_select on storage.objects
  for select
  using (
    bucket_id = 'ai-context'
    and auth.role() = 'authenticated'
    and public.is_admin()
  );

create policy ai_context_admin_insert on storage.objects
  for insert
  with check (
    bucket_id = 'ai-context'
    and auth.role() = 'authenticated'
    and public.is_admin()
  );

create policy ai_context_admin_update on storage.objects
  for update
  using (
    bucket_id = 'ai-context'
    and auth.role() = 'authenticated'
    and public.is_admin()
  )
  with check (
    bucket_id = 'ai-context'
    and auth.role() = 'authenticated'
    and public.is_admin()
  );

create policy ai_context_admin_delete on storage.objects
  for delete
  using (
    bucket_id = 'ai-context'
    and auth.role() = 'authenticated'
    and public.is_admin()
  );
