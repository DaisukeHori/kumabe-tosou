-- =========================================================
-- 20260711000024_crm_digest_cron.sql
-- canonical: docs/design/crm-suite/01-crm.md §2.3 (00-overview §3.1.3 の kmb-crm-digest-worker 行)
-- 本 migration が追加するもの: trigger_crm_digest_worker() + pg_cron 登録 (日次 JST 07:00)
-- 前提: 0011 で pg_cron / pg_net 有効化済み。Vault の cron_site_url / cron_jobs_secret は
--       既存運用のものを共用 (新規 Vault キーなし)
-- 本 migration が行わないこと: 新規テーブル・RLS (該当なし。関数登録のみ)
-- =========================================================

create or replace function public.trigger_crm_digest_worker()
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
    raise notice 'cron_site_url / cron_jobs_secret が Vault 未設定のため /api/jobs/crm-digest 起床をスキップします';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/jobs/crm-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.trigger_crm_digest_worker() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-crm-digest-worker';
select cron.schedule('kmb-crm-digest-worker', '0 22 * * *', $$select public.trigger_crm_digest_worker();$$);
-- 0 22 UTC = JST 07:00 (00-overview §3.1.3 の表と 1:1)
