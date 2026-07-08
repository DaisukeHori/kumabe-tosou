-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: pg_cron 起床ジョブ
-- canonical: docs/design/cms-ai-pipeline.md §1.1 (予約実行) / §7.5 / 契約書 §7.2
--
-- 本 migration は pg_cron + pg_net を有効化し、毎分 /api/jobs/publish、
-- 5 分毎に /api/jobs/watchdog を HTTP 起床する。
--
-- ★★★ 適用手順 (本 migration 適用後、Supabase SQL Editor で必ず実行すること) ★★★
-- URL と共有シークレットは本ファイルにハードコードしない (git に実値を残さないため)。
-- Vault にサイト URL とシークレットを保存してから cron を有効化する:
--
--   select vault_upsert_secret('cron_site_url', 'https://<本番 or Preview の実 URL>');
--   select vault_upsert_secret('cron_jobs_secret', '<Vercel env JOBS_SECRET と同じ値>');
--
-- 上記 2 つの Vault シークレットが未設定の間、trigger_publish_worker() /
-- trigger_watchdog_worker() は何もせず raise notice するだけで安全にスキップする
-- (cron ジョブ自体は登録されるが空振りする)。
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------
-- /api/jobs/publish 起床 (毎分)
-- ---------------------------------------------------------
create or replace function public.trigger_publish_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_jobs_secret';

  if v_url is null or v_secret is null then
    raise notice 'cron_site_url / cron_jobs_secret が Vault 未設定のため /api/jobs/publish 起床をスキップします';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/jobs/publish',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.trigger_publish_worker() from public, anon, authenticated;

-- ---------------------------------------------------------
-- /api/jobs/watchdog 起床 (5 分毎)
-- ---------------------------------------------------------
create or replace function public.trigger_watchdog_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_jobs_secret';

  if v_url is null or v_secret is null then
    raise notice 'cron_site_url / cron_jobs_secret が Vault 未設定のため /api/jobs/watchdog 起床をスキップします';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/jobs/watchdog',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.trigger_watchdog_worker() from public, anon, authenticated;

-- ---------------------------------------------------------
-- cron 登録 (既存ジョブがあれば張り替えられるよう unschedule してから schedule)
-- ---------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'kmb-publish-worker';
select cron.unschedule(jobid) from cron.job where jobname = 'kmb-watchdog-worker';

select cron.schedule('kmb-publish-worker', '* * * * *', $$select public.trigger_publish_worker();$$);
select cron.schedule('kmb-watchdog-worker', '*/5 * * * *', $$select public.trigger_watchdog_worker();$$);
