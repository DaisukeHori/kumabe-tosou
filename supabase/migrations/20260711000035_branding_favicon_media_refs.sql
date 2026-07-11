-- 20260711000035_branding_favicon_media_refs.sql
-- canonical: docs/design/crm-suite/05-site-settings.md §2.2 (裁定 J12 / 00-overview §10)
--
-- 本 migration が行うこと:
--   site_settings.branding.favicon_media_id (07-contracts-delta §D5) が media を参照するため、
--   media 参照 3 点セット (db-schema 調査 §8-12 の義務) に favicon_media_id チェックを追加する。
--   view / policy の再定義は DROP+CREATE 置換 (0008→0013→0015 の確立前例)。
--   1) media_admin_delete RLS ポリシーの置換
--   2) media_reference_summary view の置換
--   3) ai_draft_cleanup_run 関数の create or replace
--
-- 本 migration が行わないこと:
--   - site_settings のスキーマ変更 (キー追加は contracts.ts のみで DDL 不要)
--   - 'analytics' / 'branding' 行のシード INSERT (行なし = 既定 (null) の意味論。
--     05-site-settings.md §2.4 — page_media/page_text と同じ「差分のみ DB」原則)
--
-- 0028 (02-sales.md) との関係 (v1.2 整理): **なし**。旧 0028 (seal_media_id の 3 点セット置換) は
--   07-contracts-delta §D5 v1.2 (角印の branding-assets private バケット化 — seal_storage_path) により
--   「branding-assets バケット作成」に内容置換され (02-sales §2.3.3 v1.2)、media 参照 3 点セットを
--   置換する migration は本 0035 のみになった。seal_media_id は存在しない設計要素のため
--   条件を追加しない (旧 v1.1 の「0028 包含 + 逆時系列適用禁止」運用規則は前提消滅で撤回 — §2.5)。

-- =========================================================
-- 1) media_admin_delete RLS (現行: 20260710000015 §7) の DROP+CREATE 置換
--    追加: site_settings チェックに favicon_media_id (v1.2 — seal_media_id は 07 §D5 v1.2 で
--    廃止された設計要素のため追加しない)
-- =========================================================
drop policy if exists media_admin_delete on media;

create policy media_admin_delete on media
  for delete
  using (
    public.is_admin()
    and not exists (select 1 from work_images wi where wi.media_id = media.id)
    and not exists (select 1 from works w where w.cover_media_id = media.id)
    and not exists (select 1 from posts p where p.cover_media_id = media.id)
    and not exists (select 1 from voices v where v.photo_media_id = media.id)
    and not exists (
      select 1 from site_settings s
      where s.value @> jsonb_build_object('media_id', media.id::text)
         or s.value @> jsonb_build_object('og_media_id', media.id::text)
         or s.value @> jsonb_build_object('favicon_media_id', media.id::text)
    )
    and not exists (select 1 from page_media pm where pm.media_id = media.id)
    and not exists (select 1 from ai_image_generations aig where aig.media_id = media.id)
    and not exists (select 1 from ai_image_generation_sources aigs where aigs.media_id = media.id)
  );

-- =========================================================
-- 2) media_reference_summary view (現行: 20260710000015 §8) の DROP+CREATE 置換
--    (media_admin_delete と参照集合を常に一致させる — 確立規約)
-- =========================================================
drop view if exists public.media_reference_summary;

create view public.media_reference_summary
with (security_invoker = true) as
select
  m.id as media_id,
  (
    (select count(*) from work_images wi where wi.media_id = m.id)
    + (select count(*) from works w where w.cover_media_id = m.id)
    + (select count(*) from posts p where p.cover_media_id = m.id)
    + (select count(*) from voices v where v.photo_media_id = m.id)
    + (
        select count(*) from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
           or s.value @> jsonb_build_object('favicon_media_id', m.id::text)
      )
    + (select count(*) from page_media pm where pm.media_id = m.id)
    + (select count(*) from ai_image_generations aig where aig.media_id = m.id)
    + (select count(*) from ai_image_generation_sources aigs where aigs.media_id = m.id)
  )::int as reference_count
from media m;

grant select on public.media_reference_summary to anon, authenticated;

-- =========================================================
-- 3) ai_draft_cleanup_run (現行: 20260710000017) の create or replace
--    追加: site_settings チェックに favicon_media_id (v1.2 — seal_media_id は追加しない)
--    (0017 の教訓を維持: delete 対象に md エイリアス必須 — RETURNS TABLE の
--     storage_path 出力列との ambiguity 回避)
-- =========================================================
create or replace function public.ai_draft_cleanup_run(p_cutoff timestamptz default now() - interval '7 days')
returns table (media_id uuid, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select m.id, m.storage_path
    from media m
    where m.tags @> array['ai-draft']
      and m.created_at < p_cutoff
      and exists (
        select 1 from ai_image_generations aig
        where aig.media_id = m.id and aig.is_selected = false
      )
      and not exists (select 1 from work_images wi where wi.media_id = m.id)
      and not exists (select 1 from works w where w.cover_media_id = m.id)
      and not exists (select 1 from posts p where p.cover_media_id = m.id)
      and not exists (select 1 from voices v where v.photo_media_id = m.id)
      and not exists (
        select 1 from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
           or s.value @> jsonb_build_object('favicon_media_id', m.id::text)
      )
      and not exists (select 1 from page_media pm where pm.media_id = m.id)
      and not exists (select 1 from ai_image_generation_sources aigs where aigs.media_id = m.id)
  )
  delete from media md
  where md.id in (select id from candidates)
  returning md.id, md.storage_path;
end;
$$;

revoke execute on function public.ai_draft_cleanup_run(timestamptz) from public, anon, authenticated;
