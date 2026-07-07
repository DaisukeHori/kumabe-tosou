-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: Storage バケット + ポリシー
-- canonical: docs/design/cms-ai-pipeline.md §3.4 (Storage バケット認可)
-- =========================================================

insert into storage.buckets (id, name, public)
values
  ('media-originals', 'media-originals', false),
  ('media', 'media', true),
  ('audio', 'audio', false),
  ('backups', 'backups', false)
on conflict (id) do nothing;

-- =========================================================
-- media (公開 — レンディション専用): anon SELECT 可
-- =========================================================
create policy media_bucket_anon_select on storage.objects
  for select
  using (bucket_id = 'media');

-- =========================================================
-- media-originals / audio (非公開原本・音声): authenticated かつ is_admin() のみ SELECT
-- (署名付き URL 発行自体は service 経由。ここは直接アクセス時の RLS)
-- =========================================================
create policy media_originals_admin_select on storage.objects
  for select
  using (
    bucket_id = 'media-originals'
    and auth.role() = 'authenticated'
    and public.is_admin()
  );

create policy audio_admin_select on storage.objects
  for select
  using (
    bucket_id = 'audio'
    and auth.role() = 'authenticated'
    and public.is_admin()
  );

-- =========================================================
-- media / media-originals / audio への書き込みは is_admin() のみ。
-- 実際のアップロードは署名付き URL (service 経由発行) を使うため、
-- ここは直接アクセス経路への防御。backups は GitHub Actions (service) 専用のためポリシー無し
-- =========================================================
create policy content_buckets_admin_insert on storage.objects
  for insert
  with check (
    bucket_id in ('media', 'media-originals', 'audio')
    and public.is_admin()
  );

create policy content_buckets_admin_update on storage.objects
  for update
  using (
    bucket_id in ('media', 'media-originals', 'audio')
    and public.is_admin()
  )
  with check (
    bucket_id in ('media', 'media-originals', 'audio')
    and public.is_admin()
  );

create policy content_buckets_admin_delete on storage.objects
  for delete
  using (
    bucket_id in ('media', 'media-originals', 'audio')
    and public.is_admin()
  );

-- backups バケットは anon/admin いずれの read/write も不可 (service のみ・§3.4)。
-- ポリシーを作らない (service_role の bypass のみでアクセス)
