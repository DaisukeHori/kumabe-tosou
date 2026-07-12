-- 20260711000033_telephony_job_rpc.sql
-- canonical: docs/design/crm-suite/04-telephony.md §2.3 (裁定 J2 / 00-overview §3.1.4)
-- 前提: migration 0021 (is_admin_or_service) 適用済み。
-- 本 migration が追加するもの:
--   1) call_job_acquire_lease — ai_run_acquire_lease (0019) の同型複製。
--      差分: 対象テーブル call_jobs / runnable 集合 / bootstrap pending→downloading /
--            attempts 枯渇コード KMB-E806 / ガード is_admin_or_service()
--   2) call_job_commit_stage — CAS commit (成果物 UPSERT + status 前進 + lease 解放 +
--      attempts=0 リセットを単一 UPDATE で原子的に。不一致は冪等 no-op)
--   3) call_job_retry — failed → pending (admin 再実行。00-overview §5.2「再実行操作は RPC 経由」)
-- 実障害教訓の反映 (0019 CRITICAL/BLOCKER):
--   - RETURNS TABLE を持つ関数は本体冒頭に #variable_conflict use_column 必須
--   - stage_attempts のリセットは commit の CAS UPDATE の SET 句のみ (no-op 経路ではリセットしない)
--   - 排他は FOR UPDATE 行ロック (advisory lock 禁止 — pgbouncer transaction pooling)

-- ---------------------------------------------------------
-- 1) lease 取得 (CAS)
-- ---------------------------------------------------------
create or replace function public.call_job_acquire_lease(p_job_id uuid)
returns table (
  id uuid,
  status text,
  lease_expires_at timestamptz,
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

  -- FOR UPDATE 行ロックで CAS を直列化 (同時起床した 2 プロセス目はここで待ち、
  -- 1 プロセス目のコミット後の最新状態で判定される)
  select * into v_row from call_jobs where id = p_job_id for update;

  if not found then
    return query select p_job_id, null::text, null::timestamptz, null::int,
      null::uuid, null::uuid, null::jsonb, null::jsonb, 'not_found'::text;
    return;
  end if;

  if v_row.status not in ('pending', 'downloading', 'transcribing', 'analyzing', 'linking') then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'terminal'::text;
    return;
  end if;

  -- 3 回までは許容し、4 回目の試行になる時点で failed (KMB-E806 — E402 と同型) に倒す
  if v_row.stage_attempts >= 3 then
    update call_jobs
      set status = 'failed', error_code = 'KMB-E806', lease_expires_at = null
      where id = p_job_id
      returning * into v_row;
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'exhausted'::text;
    return;
  end if;

  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'held'::text;
    return;
  end if;

  update call_jobs
    set
      lease_expires_at = now() + interval '90 seconds',
      stage_attempts = stage_attempts + 1,
      status = case when status = 'pending' then 'downloading' else status end
    where id = p_job_id
    returning * into v_row;

  return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
    v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'acquired'::text;
end;
$$;

revoke all on function public.call_job_acquire_lease(uuid) from public, anon;
grant execute on function public.call_job_acquire_lease(uuid) to authenticated;

-- ---------------------------------------------------------
-- 2) commit (CAS + 成果物 UPSERT + lease 解放 + attempts リセットを単一 UPDATE で原子的に)
-- ---------------------------------------------------------
create or replace function public.call_job_commit_stage(
  p_job_id uuid,
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

  -- stage_attempts はステージ単位のリトライ回数。実際に status が前進した
  -- (= この UPDATE が行に影響した) 場合のみ 0 にリセットする。CAS 不一致の no-op 経路
  -- (下の v_updated_status is null 分岐) では触れない (0019 Codex BLOCKER の教訓)
  update call_jobs
  set
    status = p_next_status,
    transcript = coalesce(p_transcript, transcript),
    analysis = coalesce(p_analysis, analysis),
    link_result = coalesce(p_link_result, link_result),
    ai_cost_micro_usd = ai_cost_micro_usd + coalesce(p_ai_cost_delta_micro_usd, 0),
    error_code = coalesce(p_error_code, error_code),
    lease_expires_at = null,
    stage_attempts = 0
  where id = p_job_id
    and status = p_expected_status
  returning status into v_updated_status;

  if v_updated_status is null then
    -- 既に他の試行が commit 済み。冪等に現在値を返すのみ (成果物の再書き込みなし)
    select status into v_updated_status from call_jobs where id = p_job_id;
    return v_updated_status;
  end if;

  return v_updated_status;
end;
$$;

revoke all on function public.call_job_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, bigint, text
) from public, anon;
grant execute on function public.call_job_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, bigint, text
) to authenticated;

-- ---------------------------------------------------------
-- 3) 再実行 (failed → pending。admin 操作の唯一の書込経路)
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
    set status = 'pending', stage_attempts = 0, error_code = null, lease_expires_at = null
    where id = p_job_id and status = 'failed'
    returning status into v_status;

  if v_status is null then
    -- failed 以外への retry は業務エラー (KMB-E807 — §1.5 Δ3)。存在しない id も同経路
    raise exception 'KMB-E807: 再実行できるのは failed のジョブのみです';
  end if;

  return v_status; -- 'pending'
end;
$$;

revoke all on function public.call_job_retry(uuid) from public, anon;
grant execute on function public.call_job_retry(uuid) to authenticated;
