-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: advance (lease 型 stage 実行) RPC
-- canonical: docs/design/cms-ai-pipeline.md §7.6 (lease 意味論) /
--            docs/module-contracts.md §7.1 (結合シーケンス: AI 実行)
--
-- Wave2-E 実装メモ (オーケストレーターへの報告事項。乖離は 2 点):
--
-- 1) ai_runs.research_enabled 列を追加した (既存 DDL に無かった)。
--    zStartRunReq.research (契約書 §4.7) を起点に、advance() が「researching を
--    スキップするか」を stage 単位で判定する必要があるが、ai_runs には research
--    フラグを永続化する列が存在しなかった (§2.2 DDL に無い抜け穴)。追加は
--    non-breaking (nullable ではなく not null default false の追加列) のため
--    後方互換。契約書 §2.2 の DDL 更新が必要 (要オーケストレーター反映)。
--
-- 2) lease 取得 (CAS) 自体も本 migration の RPC (ai_run_acquire_lease) として実装した。
--    設計書 §7.6 のポンチ絵は「lease 取得は単純な CAS UPDATE」と書いているが、
--    実際には (a) status='pending' → 'extracting' への bootstrap 分岐、
--    (b) stage_attempts のアトミックな +1、の 2 点が supabase-js のクエリビルダでは
--    表現できない (生の CASE 式・列インクリメントを送れない)。そのため lease 取得も
--    「同一トランザクション内で SELECT ... FOR UPDATE → 判定 → UPDATE」を行う
--    security definer 関数として実装する。指示にある「commit RPC」とは別関数だが、
--    同じ §7.6 の要件 (取得の原子性) を満たすための実装上の必然であり、
--    lease 意味論そのものの変更ではない。
--
-- status の意味論 (実装で確定した解釈。設計書の状態遷移図 §4.2 と矛盾しない):
--   ai_runs.status が 'extracting' | 'researching' | 'drafting' の場合、
--   「そのステージが現在の担当ステージである (これから実行される、または
--   クラッシュ後に再試行される対象)」を表す。'pending' → 'extracting' の
--   bootstrap は初回 lease 取得時に行い、以降はそのステージの commit 時に
--   次のステージ名 (或いは 'ready_for_review') へ前進する。
-- =========================================================

alter table ai_runs
  add column if not exists research_enabled boolean not null default false;

comment on column ai_runs.research_enabled is
  'zStartRunReq.research (契約書 §4.7) の永続化。advance() が researching stage を'
  '実行するかどうかの判定に使う (§7.6)。Wave2-E で追加 (契約書 §2.2 に元々の定義なし)。';

-- ---------------------------------------------------------
-- lease 取得 (CAS)。§7.6:
--   UPDATE ai_runs SET lease_expires_at=now()+90s, stage_attempts=stage_attempts+1
--   WHERE (lease_expires_at IS NULL OR lease_expires_at < now())
--     AND status IN (実行可能状態)
--   を、status='pending' → 'extracting' の bootstrap 分岐込みでアトミックに行う。
-- ---------------------------------------------------------
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
  result_kind text -- 'acquired' | 'held' | 'exhausted' | 'terminal' | 'not_found'
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ai_runs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission denied: ai_run_acquire_lease requires admin';
  end if;

  -- 行ロック (FOR UPDATE) により、同時に呼ばれた 2 プロセス目はここで待たされ、
  -- 1 プロセス目のコミット後の最新状態を見て判定することになる (原子性の担保)。
  select * into v_row from ai_runs where id = p_run_id for update;

  if not found then
    return query select p_run_id, null::text, null::timestamptz, null::int,
      null::boolean, null::text[], null::uuid, null::jsonb, null::jsonb, 'not_found'::text;
    return;
  end if;

  if v_row.status not in ('pending', 'extracting', 'researching') then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'terminal'::text;
    return;
  end if;

  -- stage_attempts > 3 → failed (KMB-E402、§7.6)。3 回までは許容し、4 回目の
  -- 試行になるはずだった時点で failed に倒す。
  if v_row.stage_attempts >= 3 then
    update ai_runs
      set status = 'failed', error_code = 'KMB-E402', lease_expires_at = null
      where id = p_run_id
      returning * into v_row;
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'exhausted'::text;
    return;
  end if;

  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'held'::text;
    return;
  end if;

  update ai_runs
    set
      lease_expires_at = now() + interval '90 seconds',
      stage_attempts = stage_attempts + 1,
      status = case when status = 'pending' then 'extracting' else status end
    where id = p_run_id
    returning * into v_row;

  return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
    v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
    'acquired'::text;
end;
$$;

revoke execute on function public.ai_run_acquire_lease(uuid) from public, anon;
grant execute on function public.ai_run_acquire_lease(uuid) to authenticated;

-- ---------------------------------------------------------
-- heartbeat (lease 延長)。20 秒毎に呼ぶ想定。lease を保持中のみ延長する
-- 単純な CAS のため RPC 化は不要 (advance ハンドラから直接 UPDATE を発行)。
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- 成果物 commit + status 前進 + lease 解放 (§7.6 / §7.1 の本体)。
-- p_expected_status と現在の status が一致しない場合は「既に他の試行が commit
-- 済み」とみなし、実際の書き込みは行わず現在の status を返すのみ (冪等)。
-- channel_drafts / draft_revisions への書き込みは UNIQUE 制約 (run_id, channel) /
-- (draft_id, revision) により UPSERT で冪等 (§7.6)。
-- ---------------------------------------------------------
create or replace function public.ai_run_commit_stage(
  p_run_id uuid,
  p_expected_status text,
  p_next_status text,
  p_brief jsonb default null,
  p_research_notes jsonb default null,
  p_token_usage_delta jsonb default null,
  p_channel_drafts jsonb default null, -- [{channel, content, claims}]
  p_error_code text default null
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
    error_code = coalesce(p_error_code, error_code),
    lease_expires_at = null
  where id = p_run_id
    and status = p_expected_status
  returning status into v_updated_status;

  if v_updated_status is null then
    -- 既に他の試行 (前回のクラッシュ後の別プロセス等) が commit 済み。
    -- 冪等に現在値を返すのみで、成果物の再書き込みはしない (二重 revision 防止)。
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
  uuid, text, text, jsonb, jsonb, jsonb, jsonb, text
) from public, anon;
grant execute on function public.ai_run_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb, text
) to authenticated;
