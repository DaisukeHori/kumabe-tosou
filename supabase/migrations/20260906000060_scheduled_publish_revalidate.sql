-- =========================================================
-- 予約公開の revalidate 起床ジョブ (pg_cron 毎分)
-- canonical: docs/design/cms-ai-pipeline.md §6.1 (予約公開は pg_cron が到来分を検知して
-- /api/revalidate を叩く) / §3.5 (/api/revalidate は x-revalidate-secret 認可)
--
-- 背景 (レビュー指摘):
--   works / posts / voices を status='published' + 未来の published_at で保存すると、
--   公開側の RLS / repository は `published_at <= now()` で除外するため「予約公開」として
--   振る舞うが、公開ページは unstable_cache (tag: works / posts:{kind} / voices) に
--   焼き付いており、published_at 到来時に誰も revalidateTag を呼ばないため、
--   公開ページ・sitemap に反映されなかった (次に admin が何か保存するまで出ない)。
--
-- 対策:
--   trigger_publish_worker (20260708000011) と同じ流儀で、Vault の cron_site_url と
--   cron_revalidate_secret を読み、直前 2 分以内に published_at が到来した行があれば
--   その tag だけを /api/revalidate へ net.http_post する関数を毎分 cron で回す。
--   窓を 2 分にしているのは cron の実行遅延で 1 分窓を取りこぼさないため
--   (同じ tag を 2 回 revalidate しても冪等で無害)。
--
-- ★★★ 適用手順 (本 migration 適用後、Supabase SQL Editor で必ず実行すること) ★★★
--   select vault_upsert_secret('cron_site_url', 'https://<本番 or Preview の実 URL>');  -- 既設なら不要
--   select vault_upsert_secret('cron_revalidate_secret', '<Vercel env REVALIDATE_SECRET と同じ値>');
-- 上記が未設定の間は raise notice するだけで安全にスキップする (cron ジョブは空振り)。
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_scheduled_publish_revalidate()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_tags text[];
  v_window interval := interval '2 minutes';
begin
  -- 到来分の tag を集める (公開側 unstable_cache のタグ体系: works / posts:{kind} / voices)
  select array_agg(distinct t.tag) into v_tags
  from (
    select 'works'::text as tag
    from works
    where status = 'published'
      and published_at > now() - v_window
      and published_at <= now()
    union all
    select 'posts:' || kind
    from posts
    where status = 'published'
      and published_at > now() - v_window
      and published_at <= now()
    union all
    select 'voices'::text
    from voices
    where status = 'published'
      and published_at > now() - v_window
      and published_at <= now()
  ) t;

  if v_tags is null or cardinality(v_tags) = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_revalidate_secret';

  if v_url is null or v_secret is null then
    raise notice 'cron_site_url / cron_revalidate_secret が Vault 未設定のため /api/revalidate 起床をスキップします (tags: %)', v_tags;
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/revalidate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-revalidate-secret', v_secret),
    body := jsonb_build_object('tags', to_jsonb(v_tags))
  );
end;
$$;

revoke execute on function public.trigger_scheduled_publish_revalidate() from public, anon, authenticated;

-- cron 登録 (既存ジョブがあれば張り替えられるよう unschedule してから schedule)
select cron.unschedule(jobid) from cron.job where jobname = 'kmb-scheduled-publish-revalidate';
select cron.schedule(
  'kmb-scheduled-publish-revalidate',
  '* * * * *',
  $$select public.trigger_scheduled_publish_revalidate();$$
);
