-- 20260715000001_customers_custom_fields.sql
-- canonical: docs/design/crm-suite/01-crm.md §2.2 追記 (v1.3 — Issue #98)
--
-- 本 migration が行うこと:
--   1. customers.custom_fields jsonb 列の追加 (順序保持の {label,value} ペア配列。
--      文字数上限・重複ラベル・要素 shape は Zod (crm/contracts.ts zCustomerCustomFields) が
--      唯一の正 — DDL check は jsonb_typeof='array' の構造整合のみ)
--   2. crm_merge_customers RPC の全文差し替え (署名不変: uuid, uuid, timestamptz)。
--      「勝者の空欄のみ敗者から補完」ブロックに custom_fields 統合を追加 —
--      winner のラベルを優先し、loser のうち winner に同名ラベルが無い要素のみ末尾に append
--
-- 本 migration が行わないこと:
--   RLS 追加・grant 変更・index 追加 (既存 customers 3 ポリシーが列を包含。
--   検索対象外のため GIN index も v1 では張らない — 01-crm.md §98 リスク3)
--
-- 前提: 0023 (crm_core — customers テーブル・crm_merge_customers RPC) 適用済み
-- 冪等: add column if not exists / drop+add constraint / create or replace function
-- =========================================================

alter table customers
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;

comment on column customers.custom_fields is
  '顧客カスタム項目 (契約外拡張 — 01-crm.md §5.2 zCustomerCustomFields)。順序保持のため '
  '{label,value} ペアの配列。文字数上限・重複ラベル拒否は Zod のみが正、本 check は構造整合のみ';

alter table customers drop constraint if exists customers_custom_fields_is_array;
alter table customers add constraint customers_custom_fields_is_array
  check (jsonb_typeof(custom_fields) = 'array');

-- =========================================================
-- crm_merge_customers: custom_fields 統合を追加 (§6.4 準拠)。他ブロックは 0023 から不変。
-- =========================================================
create or replace function public.crm_merge_customers(
  p_winner_id uuid,
  p_loser_id uuid,
  p_expected_winner_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner customers%rowtype;
  v_loser customers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission denied: crm_merge_customers requires admin';
  end if;
  -- CAS 引数の NULL ガード (v1.1): plpgsql の IF は NULL を false 扱いするため、NULL のまま
  -- 進むと下の updated_at 等値比較が無音でバイパスされる。取り消し不可操作の防御を先に確定する
  if p_winner_id is null or p_loser_id is null or p_expected_winner_updated_at is null then
    raise exception 'KMB-E101: マージの引数が不足しています (winner/loser/expected_updated_at は必須)';
  end if;
  if p_winner_id = p_loser_id then
    raise exception 'KMB-E608: 同一の顧客同士はマージできません';
  end if;

  -- FOR UPDATE 行ロックで直列化 (advisory lock 禁止 — pgbouncer)。id 順に取得しデッドロック回避
  if p_winner_id < p_loser_id then
    select * into v_winner from customers where id = p_winner_id for update;
    select * into v_loser  from customers where id = p_loser_id  for update;
  else
    select * into v_loser  from customers where id = p_loser_id  for update;
    select * into v_winner from customers where id = p_winner_id for update;
  end if;

  if v_winner.id is null or v_loser.id is null then
    raise exception 'KMB-E603: マージ対象の顧客が見つかりません';
  end if;
  if v_winner.merged_into_customer_id is not null or v_loser.merged_into_customer_id is not null then
    raise exception 'KMB-E608: マージ済みの顧客を再度マージすることはできません';
  end if;
  if v_winner.updated_at <> p_expected_winner_updated_at then
    raise exception 'KMB-E103: 顧客情報が他の操作で更新されています。再読み込みしてやり直してください';
  end if;

  -- crm 所有テーブルの参照付け替え (他モジュール所有 (calls 等) は触らない — read 時に merged_into で解決)
  update deals set customer_id = p_winner_id where customer_id = p_loser_id;
  update tasks set customer_id = p_winner_id where customer_id = p_loser_id;

  -- activity_links: 勝者側に同一 activity のリンクが既にある行は残すと一意違反になるため付け替えず削除
  update activity_links al
    set customer_id = p_winner_id
    where al.customer_id = p_loser_id
      and not exists (
        select 1 from activity_links w
        where w.activity_id = al.activity_id and w.customer_id = p_winner_id
      );
  delete from activity_links where customer_id = p_loser_id;

  -- 勝者の空欄のみ敗者から補完 (非 NULL 項目は勝者優先)。custom_fields は v1.3 追加 —
  -- winner のラベルを優先し、loser のうち winner に同名ラベルが無い要素のみ末尾に append
  -- (Zod 上限 50 超過は書き込み自体は成功させ、次回編集 Sheet 保存時に E101 で行削除を促す — §98 リスク1)
  update customers set
    email      = coalesce(email, v_loser.email),
    tel_e164   = coalesce(tel_e164, v_loser.tel_e164),
    name_kana  = coalesce(name_kana, v_loser.name_kana),
    address    = coalesce(address, v_loser.address),
    company_id = coalesce(company_id, v_loser.company_id),
    custom_fields = v_winner.custom_fields || coalesce(
      (
        select jsonb_agg(e)
        from jsonb_array_elements(v_loser.custom_fields) e
        where not exists (
          select 1 from jsonb_array_elements(v_winner.custom_fields) w
          where w->>'label' = e->>'label'
        )
      ),
      '[]'::jsonb
    )
  where id = p_winner_id;

  -- 勝者 lifecycle の再評価 (v1.1 — §4.1 意味論との整合): 敗者が customer、または付け替えで
  -- won 実績 (won_at 非 NULL — registry を SQL に複製しない DB 内マーカー) の deal が勝者配下に
  -- 来た場合、lead の勝者を customer へ昇格する (customer/archived の勝者は据え置き)
  update customers set lifecycle = 'customer'
  where id = p_winner_id
    and lifecycle = 'lead'
    and (v_loser.lifecycle = 'customer'
         or exists (select 1 from deals d where d.customer_id = p_winner_id and d.won_at is not null));

  -- 敗者は archived + 転送ポインタ (check 制約 customers_merged_is_archived と整合)
  update customers set lifecycle = 'archived', merged_into_customer_id = p_winner_id
  where id = p_loser_id;
end;
$$;

revoke all on function public.crm_merge_customers(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.crm_merge_customers(uuid, uuid, timestamptz) to authenticated;
