-- =========================================================
-- ai_runs lease の所有者トークン + held 判定順 + commit 成功時の error_code クリア
-- (2026-09-06 監査修正 #8 / #10)
-- canonical: docs/design/cms-ai-pipeline.md §7.6 (lease 意味論)
--
-- 本 migration が変更するもの:
--   1) ai_runs.lease_token uuid 列を追加。ai_run_acquire_lease が acquire ごとに gen_random_uuid()
--      で発行し返す。heartbeat / releaseLeaseAfterFailure (repository.ts の plain UPDATE) と
--      commit RPC はこの値の一致を条件に含めるため、lease 失効後に別プロセスが取り直した lease を
--      古いプロセスが延長・解放・commit できない (従来は run_id だけで一致していた)。
--   2) ai_run_acquire_lease の判定順: 「lease 保持中 (held)」を「stage_attempts >= 3 (exhausted)」
--      より先に判定する。従来は 3 回目の試行が実行中 (lease 保持中) に別プロセスが advance すると
--      held ではなく exhausted に倒れ、実行中の run を failed (KMB-E402) にしてしまっていた。
--   3) ai_run_commit_stage / ai_run_commit_image_stage: 成功 commit では error_code を
--      p_error_code で上書きする (null なら null)。従来は coalesce(p_error_code, error_code) で
--      前回失敗時の error_code が成功後も残り、UI が「失敗」と誤表示していた
--      (image_generation の部分失敗は p_error_code に値を渡すため、その場合は引き続き記録される)。
--      加えて p_lease_token (default null = 旧呼び出し互換) が渡された場合は一致を CAS 条件に含める。
--      commit 成功時は lease_token も null に戻す。
--
-- ガードは既存定義 (20260714000036 / 20260710000019) と同じ is_admin() のまま
-- (advance は admin セッションの route からのみ呼ばれる)。
-- tests/ai-studio-stage-machine.test.ts のシミュレータは本 migration の意味論に合わせて更新済み。
-- =========================================================

alter table ai_runs
  add column if not exists lease_token uuid;

comment on column ai_runs.lease_token is
  'stage 実行 lease の所有者トークン (§7.6)。ai_run_acquire_lease が発行し、heartbeat/解放/commit はこの値の一致を条件に含める。NULL = 未取得/解放済み。';

-- ---------------------------------------------------------
-- 1) ai_run_acquire_lease (20260714000036 定義の置き換え)
-- ---------------------------------------------------------
-- RETURNS TABLE の行型を変更するため drop → create (42P13 回避。20260714000036 と同じ手順)。
drop function if exists public.ai_run_acquire_lease(uuid);

create or replace function public.ai_run_acquire_lease(p_run_id uuid)
returns table (
  id uuid,
  status text,
  lease_expires_at timestamptz,
  stage_attempts int,
  research_enabled boolean,
  target_channels text[],
  source_id uuid,
  brief jsonb,
  research_notes jsonb,
  result_kind text, -- 'acquired' | 'held' | 'exhausted' | 'terminal' | 'not_found'
  style_profiles jsonb,
  lease_token uuid  -- acquired のときのみ非 null
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row ai_runs%rowtype;
  v_token uuid;
begin
  if not public.is_admin() then
    raise exception 'permission denied: ai_run_acquire_lease requires admin';
  end if;

  -- 行ロック (FOR UPDATE) により、同時に呼ばれた 2 プロセス目はここで待たされ、
  -- 1 プロセス目のコミット後の最新状態を見て判定することになる (原子性の担保)。
  select * into v_row from ai_runs where id = p_run_id for update;

  if not found then
    return query select p_run_id, null::text, null::timestamptz, null::int,
      null::boolean, null::text[], null::uuid, null::jsonb, null::jsonb, 'not_found'::text, null::jsonb, null::uuid;
    return;
  end if;

  if v_row.status not in ('pending', 'extracting', 'researching', 'drafting', 'image_generation') then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'terminal'::text, v_row.style_profiles, null::uuid;
    return;
  end if;

  -- held 判定を exhausted より先に行う (#8)。実行中 (lease 保持中) の run を、並行 advance が
  -- stage_attempts の上限判定で failed に倒してしまわないため。
  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'held'::text, v_row.style_profiles, null::uuid;
    return;
  end if;

  -- stage_attempts > 3 → failed (KMB-E402、§7.6)。3 回までは許容し、4 回目の
  -- 試行になるはずだった時点で failed に倒す。
  if v_row.stage_attempts >= 3 then
    update ai_runs
      set status = 'failed', error_code = 'KMB-E402', lease_expires_at = null, lease_token = null
      where id = p_run_id
      returning * into v_row;
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'exhausted'::text, v_row.style_profiles, null::uuid;
    return;
  end if;

  v_token := gen_random_uuid();
  update ai_runs
    set
      lease_expires_at = now() + interval '90 seconds',
      lease_token = v_token,
      stage_attempts = stage_attempts + 1,
      status = case when status = 'pending' then 'extracting' else status end
    where id = p_run_id
    returning * into v_row;

  return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
    v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
    'acquired'::text, v_row.style_profiles, v_row.lease_token;
end;
$$;

revoke execute on function public.ai_run_acquire_lease(uuid) from public, anon;
grant execute on function public.ai_run_acquire_lease(uuid) to authenticated;

-- ---------------------------------------------------------
-- 2) ai_run_commit_image_stage (20260710000019 定義の置き換え。引数追加のため drop → create)
-- ---------------------------------------------------------
drop function if exists public.ai_run_commit_image_stage(uuid, text, text, jsonb, text);

create or replace function public.ai_run_commit_image_stage(
  p_run_id uuid,
  p_expected_status text,
  p_next_status text,
  p_image_candidates jsonb default null,
  p_error_code text default null,
  p_lease_token uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_status text;
begin
  if not public.is_admin() then
    raise exception 'permission denied: ai_run_commit_image_stage requires admin';
  end if;

  -- stage_attempts はステージ単位のリトライ回数であり、実際に status が前進した
  -- (= このUPDATEが行に影響した) 場合のみ 0 にリセットする。CAS 不一致による
  -- no-op 経路 (下の v_updated_status is null 分岐) では触れない (冪等性を壊さない)。
  -- error_code は成功 commit で p_error_code に上書き (null なら null、#10)。
  update ai_runs
  set
    status = p_next_status,
    image_candidates = coalesce(p_image_candidates, image_candidates),
    error_code = p_error_code,
    lease_expires_at = null,
    lease_token = null,
    stage_attempts = 0
  where id = p_run_id
    and status = p_expected_status
    and (p_lease_token is null or lease_token = p_lease_token)
  returning status into v_updated_status;

  if v_updated_status is null then
    select status into v_updated_status from ai_runs where id = p_run_id;
    return v_updated_status;
  end if;

  return v_updated_status;
end;
$$;

revoke execute on function public.ai_run_commit_image_stage(uuid, text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.ai_run_commit_image_stage(uuid, text, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------
-- 3) ai_run_commit_stage (20260710000019 定義の置き換え。引数追加のため drop → create)
--    channel_drafts / draft_revisions への書き込みロジックは 0019 のものを完全に保持。
--    変更点: error_code = p_error_code (coalesce 廃止)、lease_token 条件と null 化、p_lease_token 追加。
-- ---------------------------------------------------------
drop function if exists public.ai_run_commit_stage(uuid, text, text, jsonb, jsonb, jsonb, jsonb, text);

create or replace function public.ai_run_commit_stage(
  p_run_id uuid,
  p_expected_status text,
  p_next_status text,
  p_brief jsonb default null,
  p_research_notes jsonb default null,
  p_token_usage_delta jsonb default null,
  p_channel_drafts jsonb default null, -- [{channel, content, claims}]
  p_error_code text default null,
  p_lease_token uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_status text;
  v_draft_id uuid;
  v_item jsonb;
begin
  if not public.is_admin() then
    raise exception 'permission denied: ai_run_commit_stage requires admin';
  end if;

  update ai_runs
  set
    status = p_next_status,
    brief = coalesce(p_brief, brief),
    research_notes = coalesce(p_research_notes, research_notes),
    token_usage = case
      when p_token_usage_delta is null then token_usage
      else jsonb_build_object(
        'input_tokens',
          coalesce((token_usage->>'input_tokens')::bigint, 0)
            + coalesce((p_token_usage_delta->>'input_tokens')::bigint, 0),
        'output_tokens',
          coalesce((token_usage->>'output_tokens')::bigint, 0)
            + coalesce((p_token_usage_delta->>'output_tokens')::bigint, 0),
        'cache_read_input_tokens',
          coalesce((token_usage->>'cache_read_input_tokens')::bigint, 0)
            + coalesce((p_token_usage_delta->>'cache_read_input_tokens')::bigint, 0),
        'cache_creation_input_tokens',
          coalesce((token_usage->>'cache_creation_input_tokens')::bigint, 0)
            + coalesce((p_token_usage_delta->>'cache_creation_input_tokens')::bigint, 0),
        'web_search_requests',
          coalesce((token_usage->>'web_search_requests')::bigint, 0)
            + coalesce((p_token_usage_delta->>'web_search_requests')::bigint, 0)
      )
    end,
    error_code = p_error_code,
    lease_expires_at = null,
    lease_token = null,
    stage_attempts = 0
  where id = p_run_id
    and status = p_expected_status
    and (p_lease_token is null or lease_token = p_lease_token)
  returning status into v_updated_status;

  if v_updated_status is null then
    -- 既に他の試行 (前回のクラッシュ後の別プロセス等) が commit 済み、または lease_token 不一致
    -- (lease 失効後に別プロセスが取り直した)。冪等に現在値を返すのみで、成果物の再書き込みはしない
    -- (二重 revision 防止)。stage_attempts もこの経路では触れない。
    select status into v_updated_status from ai_runs where id = p_run_id;
    return v_updated_status;
  end if;

  if p_channel_drafts is not null then
    for v_item in select * from jsonb_array_elements(p_channel_drafts)
    loop
      insert into channel_drafts (run_id, channel, status, content, claims, current_revision)
      values (
        p_run_id,
        v_item->>'channel',
        'needs_review',
        v_item->'content',
        coalesce(v_item->'claims', '[]'::jsonb),
        1
      )
      on conflict (run_id, channel) do update
        set content = excluded.content,
            claims = excluded.claims,
            status = 'needs_review'
      returning id into v_draft_id;

      insert into draft_revisions (draft_id, revision, content, edited_by)
      values (v_draft_id, 1, v_item->'content', 'ai')
      on conflict (draft_id, revision) do update
        set content = excluded.content;
    end loop;
  end if;

  return v_updated_status;
end;
$$;

revoke execute on function public.ai_run_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, uuid
) from public, anon;
grant execute on function public.ai_run_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, uuid
) to authenticated;
