-- 20260714000036_crm_deal_reopen.sql
-- canonical: docs/design/crm-suite/01-crm.md §4.2 v1.2 (Issue #102)
--
-- 本 migration が行うこと:
--   終端ステージ (入金済み/失注) の deals.stage を「ハードロック→監査付きソフトロック」に緩和する。
--   直接 SQL / Studio 手動操作 / 将来バッチは引き続き KMB-E602 で拒否される (§4.2-7 の二重防御は維持) —
--   再開だけを専用 RPC (crm_reopen_deal) に隔離し、その RPC の中でのみ deals_guard_terminal_stage
--   トリガを transaction-local GUC で通過させる (documents_freeze_after_issue の
--   'kmb.sales_revision_unlock' (20260711000026 L95-97) + document_apply_revision
--   (20260711000027) と同型のパターンを crm に移植)。
--   1) deals_guard_terminal_stage() の create or replace (GUC バイパス追加)
--   2) 新 RPC public.crm_reopen_deal (security definer + is_admin() ガード。
--      crm_merge_customers (20260711000023 L297-381) と同パターン)。won_at は facade が
--      shouldRecordWonAt (§4.2 不変条件1 と同一の判定関数) で計算した結果を p_won_at として渡し、
--      RPC は「既存値があれば絶対に上書きしない」の二重防御のみを担う (isWon の唯一の正である
--      DEAL_STAGE_REGISTRY を SQL 側に複製しないための設計 — レビュー是正: lost 案件のうち
--      lost に落ちる前に一度も won 系ステージへ到達していなかったもの (won_at が null のまま) を
--      won 系ステージ (ordered/in_production/delivered/invoiced) へ再開すると、それが正に「初到達」
--      であり won_at を記録しないと §4.2 不変条件1 が破れる — v1 はこのケースで won_at を
--      SET しない設計だったが誤りだった)
--
-- 本 migration が行わないこと:
--   - テーブル・列の追加/変更 (deals は既存カラムのみ使用)
--   - updateDealStage / markDealLost / canTransitionDealStage の許可遷移集合の変更 (誤操作防止は維持)
--   - sales 側 (documents 凍結 / issued_documents append-only / payments 消込) への一切の変更

-- =========================================================
-- 1) deals_guard_terminal_stage (現行: 20260711000023 §2.2) の create or replace
--    GUC 'kmb.crm_reopen_unlock' が 'on' の間のみ終端ガードを通過する (transaction-local —
--    perform set_config(..., true) の第3引数 is_local=true によりトランザクション外へ漏れない)
-- =========================================================
create or replace function public.deals_guard_terminal_stage()
returns trigger
language plpgsql
as $$
begin
  if old.stage in ('paid', 'lost') and new.stage is distinct from old.stage then
    if coalesce(current_setting('kmb.crm_reopen_unlock', true), '') = 'on' then
      return new; -- 再開 RPC 経由のみ (crm_reopen_deal)
    end if;
    raise exception 'KMB-E602: 終端ステージ (入金済み/失注) からは変更できません';
  end if;
  return new;
end;
$$;

-- =========================================================
-- 2) crm_reopen_deal: 終端ステージ (入金済み/失注) の案件再開 RPC (§4.2 v1.2)
--    security definer + is_admin() ガード (crm_merge_customers 0023 L297-381 と同パターン)。
--    FOR UPDATE 行ロックで直列化 (advisory lock 禁止規約)。
--    lost_reason は常に null クリア (deals_lost_requires_reason check
--    「stage<>'lost' or lost_reason is not null」と整合 — 理由は呼び出し側 (facade) が監査
--    activity に退避する)。
--    won_at (レビュー是正): p_won_at は facade の shouldRecordWonAt (§4.2 不変条件1 の判定
--    関数そのもの) が計算した「このタイミングで新規記録すべき won_at 値 (該当しなければ null)」。
--    RPC は coalesce(v_deal.won_at, p_won_at) で「既存値があれば p_won_at を無視し絶対に
--    上書きしない (不変条件1 の『以後変更しない』)」を保証する二重防御のみを担う。
--    旧設計は「won_at は SET しない」だったが、lost に落ちる前に一度も won 系ステージへ
--    到達していなかった (won_at が null のまま失注した) 案件を won 系ステージ
--    (ordered/in_production/delivered/invoiced) へ再開するケースは won_at にとって正に「初到達」
--    であり、SET しないままだと isWon なのに won_at=null という不整合行が残り不変条件1を破る。
-- =========================================================
create or replace function public.crm_reopen_deal(
  p_deal_id uuid,
  p_to_stage text,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_won_at timestamptz
)
returns table (new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal deals%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission denied: crm_reopen_deal requires admin';
  end if;
  -- CAS 引数含む NULL ガード (crm_merge_customers v1.1 の教訓と同根拠 — plpgsql の IF は NULL を
  -- false 扱いするため、NULL のまま進むと下の判定が無音でバイパスされる)。p_won_at は
  -- 「記録しない」を意味する正当な NULL 値のため、このガードには含めない。
  if p_deal_id is null or p_to_stage is null or p_reason is null or p_expected_updated_at is null then
    raise exception 'KMB-E101: 再開の引数が不足しています (deal_id/to_stage/reason/expected_updated_at は必須)';
  end if;

  select * into v_deal from deals where id = p_deal_id for update;
  if not found then
    raise exception 'KMB-E603: 対象の案件が見つかりません';
  end if;
  if v_deal.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 案件情報が他の操作で更新されています。再読み込みしてやり直してください';
  end if;
  if v_deal.stage not in ('paid', 'lost') then
    raise exception 'KMB-E609: 終端ステージ (入金済み/失注) の案件のみ再開できます (現在: %)', v_deal.stage;
  end if;
  if p_to_stage not in (
    'inquiry', 'estimating', 'quote_sent', 'ordered', 'in_production', 'delivered', 'invoiced'
  ) then
    raise exception 'KMB-E609: 再開先は非終端ステージのみ指定できます';
  end if;
  if btrim(p_reason) = '' then
    raise exception 'KMB-E609: 再開理由を入力してください';
  end if;

  -- transaction-local GUC: 本トランザクション内でのみ終端ガードを解除 (pgbouncer 安全)
  perform set_config('kmb.crm_reopen_unlock', 'on', true);

  update deals set
    stage = p_to_stage,
    lost_reason = null,
    won_at = coalesce(v_deal.won_at, p_won_at)
  where id = p_deal_id;

  return query
    select d.updated_at from deals d where d.id = p_deal_id;
end;
$$;

revoke all on function public.crm_reopen_deal(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.crm_reopen_deal(uuid, text, text, timestamptz, timestamptz) to authenticated;
