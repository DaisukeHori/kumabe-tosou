-- =========================================================
-- AI スタジオ v2: 画像生成カスケード (P3) — ai-draft 掃除 cron
-- canonical: docs/design/ai-studio-v2.md §4 (「選択されなかった画像は 7 日後に pg_cron で
--            自動削除 (ai-draft タグ + 参照ゼロのもの)」) / 契約書 v2.5 §1 (ai-providers 所有)
--
-- 本 migration が追加するもの:
--   1) ai_draft_cleanup_run(p_cutoff) RPC: 削除候補の特定 + media 行の削除を 1 トランザクションで
--      実行する (security definer)。判定条件:
--        - media.tags に 'ai-draft' を含む
--        - media.created_at が p_cutoff (既定 7 日前) より古い
--        - 対応する ai_image_generations 行が is_selected=false (選択されなかった画像)
--        - work_images / works.cover / posts.cover / voices.photo / site_settings(media_id,
--          og_media_id) / page_media / ai_image_generation_sources のいずれからも参照されていない
--          (media_reference_summary view はこの生成元 ai_image_generations 自身の参照も
--          カウントしてしまうため、掃除判定には使えない — 生成画像は必ず自分自身の
--          ai_image_generations.media_id から参照されているため reference_count が常に >=1 になり、
--          view をそのまま使うと絶対に削除対象にならない。本関数はその穴を避けるため専用の
--          存在チェックを組み立てている)
--      削除は media 行のみ (ai_image_generations.media_id は on delete set null のため監査ログは残る。
--      ai_image_generation_sources.media_id は NOT NULL FK のため、参照ありの画像は上記の
--      not exists 判定で確実に除外される — 削除時に FK 違反にならない)。
--   2) pg_cron 起床 (毎日 18:00 UTC = 03:00 JST): /api/jobs/cleanup-ai-drafts を
--      shared secret (Vault: cron_site_url / cron_jobs_secret。20260708000011 で登録済みの
--      ものを再利用。追加の Vault 設定は不要)。
-- =========================================================

create or replace function public.ai_draft_cleanup_run(p_cutoff timestamptz default now() - interval '7 days')
returns table (media_id uuid, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select m.id, m.storage_path
    from media m
    where m.tags @> array['ai-draft']
      and m.created_at < p_cutoff
      and exists (
        select 1 from ai_image_generations aig
        where aig.media_id = m.id and aig.is_selected = false
      )
      and not exists (select 1 from work_images wi where wi.media_id = m.id)
      and not exists (select 1 from works w where w.cover_media_id = m.id)
      and not exists (select 1 from posts p where p.cover_media_id = m.id)
      and not exists (select 1 from voices v where v.photo_media_id = m.id)
      and not exists (
        select 1 from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
      )
      and not exists (select 1 from page_media pm where pm.media_id = m.id)
      and not exists (select 1 from ai_image_generation_sources aigs where aigs.media_id = m.id)
  )
  -- tester 検証 (2026-07-10) 対応: RETURNS TABLE の出力列名が storage_path のため、
  -- エイリアス無しの unqualified "returning id, storage_path" は PL/pgSQL 変数
  -- (storage_path 出力列) と衝突し "column reference is ambiguous" で毎回失敗していた
  -- (ローカル Postgres 16 で実行して確認)。delete 対象に md エイリアスを付けて明示的に
  -- 修飾することで解消する。
  delete from media md
  where md.id in (select id from candidates)
  returning md.id, md.storage_path;
end;
$$;

-- service_role 専用 (cron ワーカーのみが呼ぶ。vault_delete_secret 等と同じ「public/anon/authenticated
-- から revoke するだけ」の規約 — Supabase では service_role がこの revoke の影響を受けない)。
revoke execute on function public.ai_draft_cleanup_run(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------
-- /api/jobs/cleanup-ai-drafts 起床 (毎日 18:00 UTC = 03:00 JST)
-- Vault シークレット (cron_site_url / cron_jobs_secret) は 20260708000011 で登録済みのものを再利用。
-- ---------------------------------------------------------
create or replace function public.trigger_ai_draft_cleanup_worker()
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
    raise notice 'cron_site_url / cron_jobs_secret が Vault 未設定のため /api/jobs/cleanup-ai-drafts 起床をスキップします';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/jobs/cleanup-ai-drafts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.trigger_ai_draft_cleanup_worker() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-ai-draft-cleanup-worker';
select cron.schedule('kmb-ai-draft-cleanup-worker', '0 18 * * *', $$select public.trigger_ai_draft_cleanup_worker();$$);
