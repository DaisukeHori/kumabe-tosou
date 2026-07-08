-- =========================================================
-- media 参照カウント view (Wave 1-A: /admin/media の参照元表示・削除ガード用)
-- canonical: docs/design/cms-ai-pipeline.md §4.4
--   「参照カウントは work_images / works.cover / posts.cover / voices.photo /
--    site_settings (hero, og) を横断集計する view で算出」
--
-- 既存の media_admin_delete RLS ポリシー (20260708000002_rls.sql) が同じ判定条件を
-- 個別行の DELETE 時に USING 句で適用している。本 view はその「集計版」であり、
-- 判定ロジックの正はあくまで RLS 側 (実際の削除ガードは RLS が担う)。
-- 本 view は admin UI の表示用 (削除前に参照件数を提示する) 目的に限定する。
--
-- security_invoker=true: 呼び出しロールの RLS で works/posts/voices/site_settings を
-- 評価する。admin セッション (is_admin()=true) では admin_select 系ポリシーにより
-- 全件が見えるため、集計値は admin にとって正確になる。
-- =========================================================

create or replace view public.media_reference_summary
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
      )
  )::int as reference_count
from media m;

grant select on public.media_reference_summary to anon, authenticated;
