-- =========================================================
-- telephony: pg_cron ジョブ登録
-- canonical: docs/design/crm-suite/04-telephony.md §2.4 / 00-overview.md §3.1.3
--
-- 前提: migration 20260711000021_background_ai_execution.sql (is_admin_or_service()) が
-- 本番適用済みであること (04-telephony.md §2.3/§13.1 の前提)。roadmap メモ
-- (project-kumabe-crm-suite.md) によれば 0021 は Wave2 (#41, PR#69) で本番適用済みと記録されている。
--
-- 本 migration が追加するもの:
--   1) trigger_telephony_worker() 関数: Vault (cron_site_url / cron_jobs_secret) から
--      サイト URL と共有シークレットを読み、POST /api/jobs/telephony を叩く。
--      既存パターン (20260708000011_pg_cron_jobs.sql / 20260710000017_ai_draft_cleanup.sql) と
--      完全踏襲 — Vault 未設定時は raise notice で安全にスキップする (エラーにしない)。
--   2) cron.unschedule → cron.schedule の張り替えで 'kmb-telephony-worker' ジョブを毎分登録。
--      初回適用時は unschedule 対象が 0 件で正常 (エラーにならない)。
--
-- 本 migration が行わないこと: テーブル DDL / RPC 追加 (0032/0033 で完結済み)。
-- 適用は堀さんの運用 (Supabase MCP apply_migration、project ixvfhxbfpdquwktsnmqy のみ)。
-- 実装者・テスターは本ファイルを作成するのみで、本番適用は行わない (HANDOFF 運用)。
-- =========================================================

create or replace function public.trigger_telephony_worker()
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
    raise notice 'trigger_telephony_worker: Vault (cron_site_url / cron_jobs_secret) 未設定のためスキップ';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/telephony',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_telephony_worker() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-telephony-worker';
select cron.schedule('kmb-telephony-worker', '* * * * *', $$select public.trigger_telephony_worker();$$);
