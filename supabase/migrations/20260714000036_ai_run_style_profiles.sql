-- =========================================================
-- Issue #20: DistributionFacade.getStyleProfiles → AiStudioFacade.startRun 合成配線
-- canonical: docs/module-contracts.md §5 DistributionFacade.getStyleProfiles (契約書 v2.2 記載分)
--            docs/design/ai-studio-v2.md / ai-studio/internal/prompts.ts の旧コメント
--            (「ai-studio モジュールは distribution モジュールに依存できない」制約から
--             style_profiles を BRAND_SYSTEM_PROMPT 側に暫定ハードコードしていた箇所の正式解)
--
-- 本 migration が変更するもの:
--   1) ai_runs.style_profiles jsonb 列を新設 (既定 '{}')。POST /api/ai/runs (app 層の
--      route handler) が DistributionFacade.getStyleProfiles() の結果
--      (Record<Channel, StyleProfile>、4 チャネル全件) を取得し、
--      AiStudioFacade.startRun の引数として渡して確定保存する
--      (ai-studio → distribution の import を作らない合成パターン)。
--      run の生存期間中 (drafting ステージの再試行・regenerateDraft の再生成を含む) は
--      startRun 時点の style_profiles を使い続ける (admin が生成の途中で編集しても
--      同一 run 内では一貫させる意図的な設計 — 実装報告参照)。
--   2) ai_run_acquire_lease RPC の返り値に style_profiles を追加し、drafting ステージが
--      lease 取得結果からチャネル別文体プロファイルを読めるようにする。
--      migration 20260710000019 の定義を create or replace で拡張する
--      (既存の列名・型・runnable 判定・#variable_conflict 対策は不変。style_profiles の
--      追加のみ)。
-- =========================================================

-- ---------------------------------------------------------
-- 1) style_profiles 列
-- ---------------------------------------------------------
alter table ai_runs
  add column if not exists style_profiles jsonb not null default '{}'::jsonb;

comment on column ai_runs.style_profiles is
  'startRun 時点の DistributionFacade.getStyleProfiles() 結果 '
  '(Record<Channel, {tone_instructions, format_rules, example_output}>、4チャネル全件)。'
  'drafting ステージ・regenerateDraft が同一 run 内で一貫して参照する (Issue #20)。';

-- ---------------------------------------------------------
-- 2) ai_run_acquire_lease (migration 20260710000019 定義の create or replace)
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
  style_profiles jsonb,
  result_kind text -- 'acquired' | 'held' | 'exhausted' | 'terminal' | 'not_found'
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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
      null::boolean, null::text[], null::uuid, null::jsonb, null::jsonb, null::jsonb, 'not_found'::text;
    return;
  end if;

  if v_row.status not in ('pending', 'extracting', 'researching', 'drafting', 'image_generation') then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      v_row.style_profiles, 'terminal'::text;
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
      v_row.style_profiles, 'exhausted'::text;
    return;
  end if;

  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      v_row.style_profiles, 'held'::text;
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
    v_row.style_profiles, 'acquired'::text;
end;
$$;

revoke execute on function public.ai_run_acquire_lease(uuid) from public, anon;
grant execute on function public.ai_run_acquire_lease(uuid) to authenticated;
