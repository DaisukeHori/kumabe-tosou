-- =========================================================
-- AI スタジオ v2 P4: SNS 画像生成ステージ (ai_runs に image_generation を追加)
-- canonical: docs/design/ai-studio-v2.md §7 (SNS 生成の画像統合) / §12 P4
--            docs/module-contracts.md v2.6 §4.6 (zRunStage/zRunStatus に image_generation 実追加)
--            docs/design/cms-ai-pipeline.md §7.6 (advance/lease 方式)
--
-- 本 migration が変更するもの:
--   1) ai_runs.status の check 制約に 'image_generation' を追加 (drafting の後・
--      ready_for_review の前の任意ステージ)。既存の status 値・行データは保持 (非破壊)。
--   2) ai_runs.image_candidates jsonb 列を新設 ([{media_id, selected}]、既定 '[]')。
--      image_generation ステージが生成した候補画像 (最大4件) の保持先。
--      判断点 (オーケストレーターへ報告済み): 「候補として run に紐付け (既存の draft/候補
--      保持構造に合わせる。無ければ最小の候補テーブル or channel_drafts のメタに)」との指示に
--      対し、ai-providers 所有の ai_image_generations (画像カスケード専用 — 系譜 parent_id/
--      root_id・7日 cron 掃除対象の 'ai-draft' タグが前提) を SNS 候補にも転用すると意味論が
--      混線する (カスケード系譜と無関係な候補が同テーブルに混在する) ため、ai-studio 所有の
--      ai_runs に「最小の候補保持列」として追加した。選択済みの 1 枚は
--      channel_drafts.content (x: thread[0].media_id / instagram: media_ids) に反映される。
--   3) ai_run_acquire_lease の runnable 判定を拡張 (image_generation 対応)。
--      **P4 で発見した既存バグの修正 (オーケストレーターへ報告事項)**: migration 0009 の
--      実装は `status not in ('pending','extracting','researching')` を「非 runnable
--      (terminal 扱い)」の判定に使っており、'drafting' が誤って含まれていなかった
--      (ai-studio/internal/stage-machine.ts の RUNNABLE_STATUSES は 'drafting' を含む設計。
--      researching→drafting 遷移直後の 2 回目の advance() 呼び出しで drafting stage が
--      一切実行されず 'terminal' 応答になり、advanceRunDetailed がそれを「既に advance 済み」
--      として何もせず返してしまう — drafting が永久に実行されない停滞バグだった)。
--      image_generation 追加と同時に 'drafting' も runnable 集合に含めて修正する
--      (同じ関数を書き換えるため、別 migration に切り出すより安全)。
--   4) ai_run_commit_image_stage RPC 新設。image_generation ステージ専用の CAS commit
--      (既存 ai_run_commit_stage は channel_drafts 書き込みロジックを抱えた drafting 専用の
--      形をしているため、シグネチャを汚さず新規関数として追加する)。
-- =========================================================

-- ---------------------------------------------------------
-- 1) status check 制約の拡張
-- ---------------------------------------------------------
alter table ai_runs
  drop constraint if exists ai_runs_status_check;

alter table ai_runs
  add constraint ai_runs_status_check
  check (status in (
    'pending', 'extracting', 'researching', 'drafting', 'image_generation',
    'ready_for_review', 'completed', 'failed', 'cancelled'
  ));

-- ---------------------------------------------------------
-- 2) image_candidates 列
-- ---------------------------------------------------------
alter table ai_runs
  add column if not exists image_candidates jsonb not null default '[]'::jsonb;

comment on column ai_runs.image_candidates is
  'image_generation ステージが生成した候補画像 (最大4件): [{media_id, selected}]。'
  '選択された1枚は channel_drafts.content (x.thread[0].media_id / instagram.media_ids) に'
  '反映される (ai-studio-v2.md §7、P4)。';

-- ---------------------------------------------------------
-- 3) lease 取得 (CAS) の runnable 集合修正 + image_generation 対応
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

  -- P4 修正: 'drafting' と 'image_generation' を runnable 集合に追加
  -- (旧: 'pending','extracting','researching' のみ — 'drafting' 欠落バグ、上記コメント参照)。
  if v_row.status not in ('pending', 'extracting', 'researching', 'drafting', 'image_generation') then
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
-- 4) image_generation stage 専用の commit RPC (CAS + lease 解放 + candidates 保存)。
--    p_expected_status と現在の status が一致しない場合は「既に他の試行が commit 済み」
--    とみなし、実際の書き込みは行わず現在の status を返すのみ (ai_run_commit_stage と同型の冪等性)。
-- ---------------------------------------------------------
create or replace function public.ai_run_commit_image_stage(
  p_run_id uuid,
  p_expected_status text,
  p_next_status text,
  p_image_candidates jsonb default null,
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
  if not public.is_admin() then
    raise exception 'permission denied: ai_run_commit_image_stage requires admin';
  end if;

  update ai_runs
  set
    status = p_next_status,
    image_candidates = coalesce(p_image_candidates, image_candidates),
    error_code = coalesce(p_error_code, error_code),
    lease_expires_at = null
  where id = p_run_id
    and status = p_expected_status
  returning status into v_updated_status;

  if v_updated_status is null then
    select status into v_updated_status from ai_runs where id = p_run_id;
    return v_updated_status;
  end if;

  return v_updated_status;
end;
$$;

revoke execute on function public.ai_run_commit_image_stage(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.ai_run_commit_image_stage(uuid, text, text, jsonb, text) to authenticated;
