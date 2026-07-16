-- 20260715000002_customers_billing_shipping.sql
-- canonical: docs/design/crm-suite/01-crm.md §2.2 追記 (v1.4 — 顧客の請求先/配送先)
--
-- 本 migration が行うこと:
--   1. customers.billing_info / shipping_info jsonb 列の追加 (nullable — NULL = 未設定)。
--      ブロック構造 {postal_code, address, tel_e164, name, suffix}・文字数・郵便番号 7 桁・E.164 は
--      Zod (crm/contracts.ts zCustomerAddressBlock) が唯一の正 — DDL check は
--      jsonb_typeof='object' の構造整合のみ (#98 custom_fields と同パターン)
--   2. crm_merge_customers RPC の全文差し替え (署名不変: uuid, uuid, timestamptz)。
--      「勝者の空欄のみ敗者から補完」ブロックにブロック単位 coalesce を追加
--
-- 本 migration が行わないこと:
--   RLS 追加・grant 変更・index 追加 (既存 customers 3 ポリシーが列を包含。検索対象外のため
--   GIN index も張らない — #98 と同判断)。documents (sales 所有) の変更は一切なし
--
-- 前提: 20260715000001 (custom_fields) 適用済み
-- 冪等: add column if not exists / drop+add constraint / create or replace function
-- =========================================================

alter table customers
  add column if not exists billing_info jsonb,
  add column if not exists shipping_info jsonb;

comment on column customers.billing_info is
  '請求先ブロック (契約外拡張 — 01-crm.md §5.2 zCustomerAddressBlock)。'
  '{postal_code(7桁数字), address, tel_e164, name, suffix(様/御中)}。NULL = 未設定 (空オブジェクトを保存しない)。'
  '形式・上限は Zod のみが正、本 check は構造整合のみ。帳票初期値への複製規則は 02-sales.md §6.1';

comment on column customers.shipping_info is
  '配送先 (施工先) ブロック。構造・規約は billing_info と同一 (ただし suffix は帳票の site_* には使わない)。'
  'documents.site_name / site_address の初期値の源 (帳票側で上書き可)';

alter table customers drop constraint if exists customers_billing_info_is_object;
alter table customers add constraint customers_billing_info_is_object
  check (billing_info is null or jsonb_typeof(billing_info) = 'object');

alter table customers drop constraint if exists customers_shipping_info_is_object;
alter table customers add constraint customers_shipping_info_is_object
  check (shipping_info is null or jsonb_typeof(shipping_info) = 'object');

-- =========================================================
-- crm_merge_customers: billing_info / shipping_info のブロック coalesce を追加。
-- 他ブロックは 20260715000001 から一字一句不変 (全文をここに複製する)。
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
  if p_winner_id is null or p_loser_id is null or p_expected_winner_updated_at is null then
    raise exception 'KMB-E101: マージの引数が不足しています (winner/loser/expected_updated_at は必須)';
  end if;
  if p_winner_id = p_loser_id then
    raise exception 'KMB-E608: 同一の顧客同士はマージできません';
  end if;

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

  update deals set customer_id = p_winner_id where customer_id = p_loser_id;
  update tasks set customer_id = p_winner_id where customer_id = p_loser_id;

  update activity_links al
    set customer_id = p_winner_id
    where al.customer_id = p_loser_id
      and not exists (
        select 1 from activity_links w
        where w.activity_id = al.activity_id and w.customer_id = p_winner_id
      );
  delete from activity_links where customer_id = p_loser_id;

  update customers set
    email      = coalesce(email, v_loser.email),
    tel_e164   = coalesce(tel_e164, v_loser.tel_e164),
    name_kana  = coalesce(name_kana, v_loser.name_kana),
    address    = coalesce(address, v_loser.address),
    company_id = coalesce(company_id, v_loser.company_id),
    billing_info  = coalesce(billing_info, v_loser.billing_info),
    shipping_info = coalesce(shipping_info, v_loser.shipping_info),
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

  update customers set lifecycle = 'customer'
  where id = p_winner_id
    and lifecycle = 'lead'
    and (v_loser.lifecycle = 'customer'
         or exists (select 1 from deals d where d.customer_id = p_winner_id and d.won_at is not null));

  update customers set lifecycle = 'archived', merged_into_customer_id = p_winner_id
  where id = p_loser_id;
end;
$$;

revoke all on function public.crm_merge_customers(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.crm_merge_customers(uuid, uuid, timestamptz) to authenticated;
