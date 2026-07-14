-- 20260711000031_scheduling_jobs.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.4 (00-overview §3.1.3 のジョブ表)
-- 本 migration が追加するもの:
--   1. trigger_calendar_sync_worker() / trigger_calendar_maintenance_worker()
--      (0011 の確立パターン: Vault 未設定なら raise notice で安全にスキップ)
--   2. pg_cron 登録 kmb-calendar-sync-worker (*/5) / kmb-calendar-maintenance-worker (日次 19:00 UTC = JST 04:00)
-- 前提: pg_cron / pg_net は 0011 で有効化済み。cron_site_url / cron_jobs_secret は Vault 手動設定運用

create or replace function public.trigger_calendar_sync_worker()
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
    raise notice 'trigger_calendar_sync_worker: Vault (cron_site_url / cron_jobs_secret) 未設定のためスキップ';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/calendar-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_calendar_sync_worker() from public, anon, authenticated;

create or replace function public.trigger_calendar_maintenance_worker()
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
    raise notice 'trigger_calendar_maintenance_worker: Vault 未設定のためスキップ';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/calendar-maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_calendar_maintenance_worker() from public, anon, authenticated;

-- 冪等登録 (unschedule → schedule の張り替え — 0011 前例)
select cron.unschedule(jobid) from cron.job where jobname = 'kmb-calendar-sync-worker';
select cron.schedule(
  'kmb-calendar-sync-worker',
  '*/5 * * * *',
  $$select public.trigger_calendar_sync_worker();$$
);

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-calendar-maintenance-worker';
select cron.schedule(
  'kmb-calendar-maintenance-worker',
  '0 19 * * *',
  $$select public.trigger_calendar_maintenance_worker();$$
);
