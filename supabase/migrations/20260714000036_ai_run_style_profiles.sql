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
--   2) 【敵対的レビュー2件 MAJOR 修正】上記 1) の列追加は既存行への backfill を伴わないと、
--      デプロイ時点で pending/extracting/researching/drafting/image_generation/
--      ready_for_review のいずれかで進行中だった (= 既に '{}'::jsonb が入っている) run が
--      drafting ステージ到達時・regenerateDraft 実行時に必ず落ちる。
--      zStyleProfilesByChannel (ai-studio/contracts.ts) は z.record(zChannel, ...) で
--      4 チャネル (site_blog/note/x/instagram) 全キー必須の exhaustive スキーマのため、
--      facade.ts runOneStage / regenerateDraft の zStyleProfilesByChannel.parse(row.style_profiles)
--      が '{}' に対して例外を投げ、advanceRunDetailed の catch で KMB-E901 化 →
--      stage_attempts>=3 のリトライ終了後に status='failed'/KMB-E402 へ強制的に落ちる
--      (ready_for_review まで進んでいた run は regenerateDraft のたびに永続的に失敗し続ける)。
--      distribution/internal/default-style-profiles.ts の DEFAULT_STYLE_PROFILES と同一文言の
--      4 チャネル既定値で、列がまだ既定値 '{}' のままの既存行のみを backfill する
--      (admin が明示的に style_profiles を確定させた行は対象外 — 通常はこの時点で
--      '{}' のままの行は存在しないためこの条件は安全弁)。
--   3) ai_run_acquire_lease RPC の返り値に style_profiles を追加し、drafting ステージが
--      lease 取得結果からチャネル別文体プロファイルを読めるようにする。
--      migration 20260710000019 の定義を create or replace で拡張する
--      (既存の列名・型・runnable 判定・#variable_conflict 対策は不変。style_profiles の
--      追加のみ)。
--      【敵対的レビュー2 BLOCKER 修正】CREATE OR REPLACE FUNCTION は RETURNS TABLE の列を
--      末尾以外の位置に追加することを許さない (列の型/順序が変わると
--      "cannot change return type of existing function" で失敗する)。旧定義
--      (migration 20260710000019) は result_kind が最終列だったため、style_profiles は
--      result_kind の「手前」ではなく「後」(=真の末尾) に追加する。
-- =========================================================

-- ---------------------------------------------------------
-- 1) style_profiles 列 + 既存行の backfill
-- ---------------------------------------------------------
alter table ai_runs
  add column if not exists style_profiles jsonb not null default '{}'::jsonb;

comment on column ai_runs.style_profiles is
  'startRun 時点の DistributionFacade.getStyleProfiles() 結果 '
  '(Record<Channel, {tone_instructions, format_rules, example_output}>、4チャネル全件)。'
  'drafting ステージ・regenerateDraft が同一 run 内で一貫して参照する (Issue #20)。';

-- zStyleProfilesByChannel は 4 チャネル全キー必須の exhaustive スキーマ (z.record(zChannel, ...))
-- のため、上記 add column の既定値 '{}'::jsonb のままの既存行は drafting ステージ到達時・
-- regenerateDraft 実行時に必ず parse エラー (KMB-E901 → KMB-E402) になる。
-- distribution/internal/default-style-profiles.ts の DEFAULT_STYLE_PROFILES と同一文言で
-- backfill する (admin が既に style_profiles を確定済みの行は対象外)。
update ai_runs
set style_profiles = '{
  "site_blog": {
    "tone_instructions": "丁寧なですます調。専門用語には簡単な説明を添える。",
    "format_rules": "見出し2〜4個、1500〜3000字程度。SEOを意識したtitleにする。",
    "example_output": null
  },
  "note": {
    "tone_instructions": "一人称の語り口。体験談ベースで親しみやすく。",
    "format_rules": "2000〜4000字程度。ハッシュタグ3個程度。",
    "example_output": null
  },
  "x": {
    "tone_instructions": "簡潔に。絵文字は控えめに1個/ツイート程度。",
    "format_rules": "1ツイート120字目安、スレッドは1〜5個。ハッシュタグ最大2個。",
    "example_output": null
  },
  "instagram": {
    "tone_instructions": "写真映えを意識した、改行多めの読みやすい文体。",
    "format_rules": "キャプション300〜500字程度。ハッシュタグ10〜15個。",
    "example_output": null
  }
}'::jsonb
where style_profiles = '{}'::jsonb;

-- ---------------------------------------------------------
-- 2) ai_run_acquire_lease (migration 20260710000019 定義の create or replace)
-- ---------------------------------------------------------
-- CREATE OR REPLACE FUNCTION は RETURNS TABLE (OUT パラメータ) の行型を変更できないため
-- (42P13: cannot change return type of existing function)、先に既存定義を drop する。
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
  style_profiles jsonb
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
      null::boolean, null::text[], null::uuid, null::jsonb, null::jsonb, 'not_found'::text, null::jsonb;
    return;
  end if;

  if v_row.status not in ('pending', 'extracting', 'researching', 'drafting', 'image_generation') then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'terminal'::text, v_row.style_profiles;
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
      'exhausted'::text, v_row.style_profiles;
    return;
  end if;

  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.research_enabled, v_row.target_channels, v_row.source_id, v_row.brief, v_row.research_notes,
      'held'::text, v_row.style_profiles;
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
    'acquired'::text, v_row.style_profiles;
end;
$$;

revoke execute on function public.ai_run_acquire_lease(uuid) from public, anon;
grant execute on function public.ai_run_acquire_lease(uuid) to authenticated;
