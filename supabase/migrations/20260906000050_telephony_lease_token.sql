-- 20260906000050_telephony_lease_token.sql
-- canonical: docs/design/crm-suite/04-telephony.md §2.3 (lease/commit RPC) / §5.4 要件 3
-- 目的: call_jobs の heartbeat / checkpoint (transcript_partial) / commit が「lease 保持者本人」で
--   あることを検証していなかった穴を塞ぐ。旧実装の CAS は `id = ... and lease_expires_at is not null`
--   のみだったため、lease 失効後に別プロセスが再取得した行を旧保持者の heartbeat が延長し続け、
--   2 プロセスが同一 lease を共有し得た (checkpoint の古い値での上書き・commit の横取りも同様)。
-- 本 migration が行うこと:
--   1) call_jobs.lease_token uuid 列を追加 (null = 未取得/解放済み)
--   2) call_job_acquire_lease: acquired 時に gen_random_uuid() でトークンを発行し RETURNS TABLE に含める
--      (返り値の列構成が変わるため drop → create。acquired 以外では他者のトークンを漏らさず null を返す)
--   3) call_job_commit_stage: p_lease_token を追加し CAS WHERE に `lease_token = p_lease_token` を加える
--      (旧 8 引数版は drop。成功時は lease_token も null に解放)
--   4) call_job_retry / exhausted 経路: lease 解放時に lease_token も null 化
-- heartbeat / checkpoint は引き続き RPC 化せず worker が service client で直接 UPDATE するが、
-- WHERE に `lease_token = <acquire で得た値>` を必ず含める (repository.ts heartbeatCallJobLease /
-- updateCallJobTranscriptPartial / updateCallJobTaskIdsCheckpoint)。
-- 前提: migration 20260711000033 (telephony_job_rpc) 適用済み。

-- ---------------------------------------------------------
-- 1) 列追加
-- ---------------------------------------------------------
alter table call_jobs add column if not exists lease_token uuid;

comment on column call_jobs.lease_token is
  'lease 保持者トークン (04-telephony.md §2.3)。acquire RPC が発行し、heartbeat/checkpoint/commit の CAS WHERE で一致を要求する。null = 未取得/解放済み';

-- ---------------------------------------------------------
-- 2) lease 取得 (CAS) — RETURNS TABLE に lease_token を追加
-- ---------------------------------------------------------
drop function if exists public.call_job_acquire_lease(uuid);

create function public.call_job_acquire_lease(p_job_id uuid)
returns table (
  id uuid,
  status text,
  lease_expires_at timestamptz,
  lease_token uuid,
  stage_attempts int,
  call_id uuid,
  recording_id uuid,
  transcript jsonb,
  analysis jsonb,
  result_kind text -- 'acquired' | 'held' | 'exhausted' | 'terminal' | 'not_found'
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row call_jobs%rowtype;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: call_job_acquire_lease requires admin or service_role';
  end if;

  select * into v_row from call_jobs where id = p_job_id for update;

  if not found then
    return query select p_job_id, null::text, null::timestamptz, null::uuid, null::int,
      null::uuid, null::uuid, null::jsonb, null::jsonb, 'not_found'::text;
    return;
  end if;

  if v_row.status not in ('pending', 'downloading', 'transcribing', 'analyzing', 'linking') then
    -- 他者のトークンは返さない (acquired 以外は null)
    return query select v_row.id, v_row.status, v_row.lease_expires_at, null::uuid, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'terminal'::text;
    return;
  end if;

  if v_row.stage_attempts >= 3 then
    update call_jobs
      set status = 'failed', error_code = 'KMB-E806', lease_expires_at = null, lease_token = null
      where id = p_job_id
      returning * into v_row;
    return query select v_row.id, v_row.status, v_row.lease_expires_at, null::uuid, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'exhausted'::text;
    return;
  end if;

  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, null::uuid, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'held'::text;
    return;
  end if;

  update call_jobs
    set
      lease_expires_at = now() + interval '90 seconds',
      lease_token = gen_random_uuid(), -- 取得のたびに新トークン (失効した旧保持者の書込を無効化)
      stage_attempts = stage_attempts + 1,
      status = case when status = 'pending' then 'downloading' else status end
    where id = p_job_id
    returning * into v_row;

  return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.lease_token, v_row.stage_attempts,
    v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'acquired'::text;
end;
$$;

revoke all on function public.call_job_acquire_lease(uuid) from public, anon;
grant execute on function public.call_job_acquire_lease(uuid) to authenticated;

-- ---------------------------------------------------------
-- 3) commit — p_lease_token を CAS 条件に追加 (旧 8 引数版は drop)
-- ---------------------------------------------------------
drop function if exists public.call_job_commit_stage(uuid, text, text, jsonb, jsonb, jsonb, bigint, text);

create function public.call_job_commit_stage(
  p_job_id uuid,
  p_lease_token uuid,
  p_expected_status text,
  p_next_status text,
  p_transcript jsonb default null,
  p_analysis jsonb default null,
  p_link_result jsonb default null,
  p_ai_cost_delta_micro_usd bigint default null,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_status text;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: call_job_commit_stage requires admin or service_role';
  end if;

  -- lease_token 不一致 (= 失効後に他プロセスが再取得済み、または解放済み) は status 不一致と同じく
  -- 冪等 no-op 経路に落ちる。stage_attempts のリセットは CAS が成立した SET 句のみ (0019 教訓)
  update call_jobs
  set
    status = p_next_status,
    transcript = coalesce(p_transcript, transcript),
    analysis = coalesce(p_analysis, analysis),
    link_result = coalesce(p_link_result, link_result),
    ai_cost_micro_usd = ai_cost_micro_usd + coalesce(p_ai_cost_delta_micro_usd, 0),
    error_code = coalesce(p_error_code, error_code),
    lease_expires_at = null,
    lease_token = null,
    stage_attempts = 0
  where id = p_job_id
    and status = p_expected_status
    and lease_token = p_lease_token
  returning status into v_updated_status;

  if v_updated_status is null then
    select status into v_updated_status from call_jobs where id = p_job_id;
    return v_updated_status;
  end if;

  return v_updated_status;
end;
$$;

revoke all on function public.call_job_commit_stage(
  uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint, text
) from public, anon;
grant execute on function public.call_job_commit_stage(
  uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint, text
) to authenticated;

-- ---------------------------------------------------------
-- 4) 再実行 — lease 解放時に lease_token も null 化 (シグネチャ不変)
-- ---------------------------------------------------------
create or replace function public.call_job_retry(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: call_job_retry requires admin or service_role';
  end if;

  update call_jobs
    set status = 'pending', stage_attempts = 0, error_code = null, lease_expires_at = null, lease_token = null
    where id = p_job_id and status = 'failed'
    returning status into v_status;

  if v_status is null then
    raise exception 'KMB-E807: 再実行できるのは failed のジョブのみです';
  end if;

  return v_status;
end;
$$;

revoke all on function public.call_job_retry(uuid) from public, anon;
grant execute on function public.call_job_retry(uuid) to authenticated;
