-- =========================================================
-- 20260711000023_crm_core.sql
-- canonical: docs/design/crm-suite/01-crm.md §2.2 (裁定 J1/J9/J10)
-- 本 migration が追加するもの:
--   1. crm 所有 6 テーブル (companies, customers, deals, activities, activity_links, tasks)
--   2. RLS (admin 3 分類 + activities の note 限定 UPDATE/DELETE) + 明示 revoke/grant
--   3. 冪等キー一意 index (activities ほか — 非部分。§冪等 index 設計原則参照) / マージ用 RPC crm_merge_customers
--   4. deals 終端ステージ不変の BEFORE UPDATE トリガ (アプリ層 stage-machine との二重防御)
-- 本 migration が行わないこと: pg_cron 登録 (0024)・既存テーブルの変更 (なし)
-- 前提: 0021 (is_admin_or_service) 適用済み
-- =========================================================

-- ---------------------------------------------------------
-- companies (会社: 工務店/元請/管理会社など少数の法人)
-- ---------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_kana text,
  tel_e164 text,          -- E.164。形式検証は Zod (zTelE164) が正
  address text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table companies is '会社 (crm 所有)。個人施主は行を持たない。domain dedup は不採用 (法人少数)';

create trigger handle_updated_at before update on companies
  for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------
-- customers (顧客: 個人施主 / 法人担当者)
-- ---------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'person' check (kind in ('person', 'company_contact')),
  name text not null,
  name_kana text,
  email text,             -- nullable (メールなし高齢施主)。unique にしない (家族共用メール) — dedup は repository (KMB-E601)
  tel_e164 text,          -- E.164 保存。入力正規化は normalizeJpPhoneToE164() (platform)
  company_id uuid references companies(id) on delete set null,
  address text,
  notes text,
  lifecycle text not null default 'lead' check (lifecycle in ('lead', 'customer', 'archived')),
  source text not null check (source in ('form', 'simulator', 'phone', 'manual', 'migration')),
  merged_into_customer_id uuid references customers(id) on delete set null,
  created_by uuid references profiles(id),   -- null = service 文脈 (取込/telephony) 起点
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_no_self_merge check (merged_into_customer_id is null or merged_into_customer_id <> id),
  constraint customers_merged_is_archived check (merged_into_customer_id is null or lifecycle = 'archived')
);
comment on column customers.merged_into_customer_id is
  'マージで統合された先 (§6.4)。非 NULL 行は名簿・dedup 候補から除外し、参照解決時に終端まで辿る';

create trigger handle_updated_at before update on customers
  for each row execute function extensions.moddatetime(updated_at);

create index customers_email_idx on customers (lower(email)) where email is not null;
create index customers_tel_idx on customers (tel_e164) where tel_e164 is not null;
create index customers_company_idx on customers (company_id) where company_id is not null;
create index customers_list_idx on customers (created_at desc, id desc);   -- keyset

-- ---------------------------------------------------------
-- deals (案件)
-- ---------------------------------------------------------
create table deals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  customer_id uuid not null references customers(id),
  company_id uuid references companies(id) on delete set null,
  pipeline text not null default 'default' check (pipeline in ('default')),
  stage text not null default 'inquiry' check (stage in (
    'inquiry', 'estimating', 'quote_sent', 'ordered',
    'in_production', 'delivered', 'invoiced', 'paid', 'lost'
  )),
  amount_jpy bigint check (amount_jpy is null or amount_jpy >= 0),  -- 円整数 (µUSD 混在禁止)。上限は Zod
  expected_close_on date,
  won_at timestamptz,     -- ordered 初到達時に 1 回だけ記録、以後不変 (§4.2 不変条件)
  lost_reason text,
  source text not null check (source in ('form', 'simulator', 'phone', 'manual', 'migration')),
  source_inquiry_id uuid references contact_inquiries(id) on delete set null,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deals_lost_requires_reason check (stage <> 'lost' or lost_reason is not null)
);
comment on column deals.source_inquiry_id is
  '取込元の問い合わせ (参照 FK のみ — inquiry 所有は不変)。取込の冪等キー + /admin/inquiries の「リード化済み」判定';
comment on column deals.stage is
  'probability / is_won / is_lost は DB に持たない — crm/contracts.ts の DEAL_STAGE_REGISTRY が正 (契約書 v2.8 §4.10)';

create trigger handle_updated_at before update on deals
  for each row execute function extensions.moddatetime(updated_at);

create index deals_customer_idx on deals (customer_id);
create index deals_stage_idx on deals (stage, created_at desc);
create index deals_company_idx on deals (company_id) where company_id is not null;
-- 非部分一意 (NULLS DISTINCT — source_inquiry_id NULL の手動案件は衝突しない)。
-- 部分一意にしない理由は §2.2 冒頭「冪等 index の設計原則」
create unique index deals_source_inquiry_uniq on deals (source_inquiry_id);

-- 終端ステージ不変 (§4.2「paid / lost からの遷移は一切不可」) の DB レベル二重ガード。
-- アプリ層 canTransitionDealStage が第一防御だが、直接 SQL / Studio 手動操作 / 将来バッチが
-- repository を迂回する経路を DB でも封じる (deals_lost_requires_reason 等の CHECK と同じ防御水準)
create or replace function public.deals_guard_terminal_stage()
returns trigger
language plpgsql
as $$
begin
  if old.stage in ('paid', 'lost') and new.stage is distinct from old.stage then
    raise exception 'KMB-E602: 終端ステージ (入金済み/失注) からは変更できません';
  end if;
  return new;
end;
$$;

create trigger deals_terminal_stage_guard before update of stage on deals
  for each row execute function public.deals_guard_terminal_stage();

-- ---------------------------------------------------------
-- activities (活動タイムライン — 全モジュール共通ハブ。00-overview §3.2.3 が統合契約)
-- ---------------------------------------------------------
create table activities (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null check (activity_type in (
    'note', 'call', 'email', 'form_submission', 'simulator_estimate',
    'document_event', 'work_log', 'task_event', 'system'
  )),  -- 'email' は Phase 2 予約 (J7)。check には含め (Phase 2 で migration 不要)、v1 挿入は facade が拒否 (KMB-E604)
  occurred_at timestamptz not null,   -- 業務時刻 (通話開始/発行日時)。表示は occurred_at 降順 keyset
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,  -- 契約: ACTIVITY_PAYLOAD_SCHEMAS[activity_type] (契約書 v2.8 §4.10)
  ref_table text,
  ref_id uuid,
  created_by uuid references profiles(id),     -- null = service 文脈 (telephony worker 等)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_ref_pair check ((ref_table is null) = (ref_id is null))
);
comment on table activities is
  'タイムライン・ハブ。他モジュールの書き込みは CrmFacade.appendActivity のみ (直接 INSERT 禁止 — ESLint/レビュー強制)。編集/削除は note のみ';

create trigger handle_updated_at before update on activities
  for each row execute function extensions.moddatetime(updated_at);

-- 冪等キー (00-overview §3.2.3-2): 同一 ref の再送 (webhook リトライ/worker 再実行) は既存行を返す。
-- 非部分一意 (NULLS DISTINCT により ref_id NULL の note 等は衝突しない — §2.2 冒頭「冪等 index の設計原則」)
create unique index activities_ref_idem_uniq
  on activities (activity_type, ref_table, ref_id);
create index activities_timeline_idx on activities (occurred_at desc, id desc);

-- ---------------------------------------------------------
-- activity_links (activity ↔ {customer|company|deal} の 1 行 1 対象リンク)
-- ---------------------------------------------------------
create table activity_links (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint activity_links_one_target check (num_nonnulls(customer_id, company_id, deal_id) = 1)
);
comment on table activity_links is
  '1 つの activity を顧客と案件の両方に載せる場合は 2 行 (00-overview §3.2.2)。updated_at なし (不変行)';

-- 重複リンク防止 + タイムライン逆引きの両用 (対象列を先頭に置く)。
-- 非部分一意 (NULLS DISTINCT — 対象列 NULL の行は衝突しない。§2.2 冒頭「冪等 index の設計原則」)
create unique index activity_links_customer_uniq
  on activity_links (customer_id, activity_id);
create unique index activity_links_company_uniq
  on activity_links (company_id, activity_id);
create unique index activity_links_deal_uniq
  on activity_links (deal_id, activity_id);
create index activity_links_activity_idx on activity_links (activity_id);

-- ---------------------------------------------------------
-- tasks (やること)
-- ---------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  due_on date,            -- JST 日付 (zDateOnly)。時刻は持たない (1 人運用に時刻粒度は過剰)
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  origin text not null check (origin in ('manual', 'ai_call', 'form', 'system')),
  deal_id uuid references deals(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  source_activity_id uuid references activities(id) on delete set null,  -- AI 起票/フォーム起票の出所
  completed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_done_has_completed_at check (status <> 'done' or completed_at is not null)
);

create trigger handle_updated_at before update on tasks
  for each row execute function extensions.moddatetime(updated_at);

create index tasks_status_due_idx on tasks (status, due_on);
create index tasks_deal_idx on tasks (deal_id) where deal_id is not null;
create index tasks_customer_idx on tasks (customer_id) where customer_id is not null;
-- createTask の冪等キー (07-contracts-delta v1.1 裁定 #10): AI 起票/フォーム起票のリトライ
-- (lease 失効跨ぎクラッシュ含む) による二重起票を DB レベルで根絶。createTask は
-- source_activity_id 非 NULL 時 upsert(ignoreDuplicates) → 競合時は既存行 SELECT で task_id を返す。
-- 非部分一意 (NULLS DISTINCT — 手動タスク (source_activity_id NULL) は同題でも衝突しない。
-- §2.2 冒頭「冪等 index の設計原則」)。source_activity_id 検索の index も本 unique index が兼ねる (prefix 走査)
create unique index tasks_source_activity_title_key on tasks (source_activity_id, title);

-- =========================================================
-- RLS (00-overview §5.2 の crm 行を全文化)
-- 規約: enable RLS + {table}_{role}_{action} 命名 + 明示 revoke/grant
-- (RLS 有効化だけでは default privileges の grant が残る — 0020 の教訓)
-- service_role は RLS bypass (revoke の影響も受けない)
-- =========================================================

-- companies: admin SELECT/INSERT/UPDATE (DELETE なし)
alter table companies enable row level security;
revoke all on companies from anon;
revoke delete on companies from authenticated;
grant select, insert, update on companies to authenticated;
create policy companies_admin_select on companies for select using (public.is_admin());
create policy companies_admin_insert on companies for insert with check (public.is_admin());
create policy companies_admin_update on companies for update
  using (public.is_admin()) with check (public.is_admin());

-- customers: admin SELECT/INSERT/UPDATE (DELETE なし — archived で論理)
alter table customers enable row level security;
revoke all on customers from anon;
revoke delete on customers from authenticated;
grant select, insert, update on customers to authenticated;
create policy customers_admin_select on customers for select using (public.is_admin());
create policy customers_admin_insert on customers for insert with check (public.is_admin());
create policy customers_admin_update on customers for update
  using (public.is_admin()) with check (public.is_admin());

-- deals: admin SELECT/INSERT/UPDATE (DELETE なし)。ステージ遷移は repository 二重検証 (§4.2)
alter table deals enable row level security;
revoke all on deals from anon;
revoke delete on deals from authenticated;
grant select, insert, update on deals to authenticated;
create policy deals_admin_select on deals for select using (public.is_admin());
create policy deals_admin_insert on deals for insert with check (public.is_admin());
create policy deals_admin_update on deals for update
  using (public.is_admin()) with check (public.is_admin());

-- activities: admin SELECT/INSERT + UPDATE/DELETE は type='note' のみ
-- (channel_posts_admin_cancel_update と同型の状態限定ポリシー — 00-overview §3.2.3-5)
alter table activities enable row level security;
revoke all on activities from anon;
grant select, insert, update, delete on activities to authenticated;
create policy activities_admin_select on activities for select using (public.is_admin());
create policy activities_admin_insert on activities for insert with check (public.is_admin());
create policy activities_admin_update on activities for update
  using (public.is_admin() and activity_type = 'note')
  with check (public.is_admin() and activity_type = 'note');
create policy activities_admin_delete on activities for delete
  using (public.is_admin() and activity_type = 'note');

-- activity_links: admin SELECT/INSERT + DELETE は note のリンク付け替えのみ (UPDATE なし)
alter table activity_links enable row level security;
revoke all on activity_links from anon;
revoke update on activity_links from authenticated;
grant select, insert, delete on activity_links to authenticated;
create policy activity_links_admin_select on activity_links for select using (public.is_admin());
create policy activity_links_admin_insert on activity_links for insert with check (public.is_admin());
create policy activity_links_admin_delete on activity_links for delete
  using (
    public.is_admin()
    and exists (
      select 1 from activities a
      where a.id = activity_links.activity_id and a.activity_type = 'note'
    )
  );

-- tasks: admin 全権 (service は AI 起票 — bypass)
alter table tasks enable row level security;
revoke all on tasks from anon;
grant select, insert, update, delete on tasks to authenticated;
create policy tasks_admin_select on tasks for select using (public.is_admin());
create policy tasks_admin_insert on tasks for insert with check (public.is_admin());
create policy tasks_admin_update on tasks for update
  using (public.is_admin()) with check (public.is_admin());
create policy tasks_admin_delete on tasks for delete using (public.is_admin());

-- =========================================================
-- crm_merge_customers: 顧客マージ (§6.4)。
-- Supabase JS はマルチステートメント TX を張れないため、多テーブル原子更新は
-- RPC で行う (replace_work_image の前例)。activity_links に admin UPDATE
-- ポリシーが無い (不変行) ため security definer + is_admin() ガード型を採用。
-- 楽観排他は timestamptz 引数の等値比較 (PostgREST の ISO 文字列は µs 無損失で
-- timestamptz に parse される。text キャスト比較は表記揺れで誤爆するため不採用)。
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

  -- 勝者の空欄のみ敗者から補完 (非 NULL 項目は勝者優先)
  update customers set
    email      = coalesce(email, v_loser.email),
    tel_e164   = coalesce(tel_e164, v_loser.tel_e164),
    name_kana  = coalesce(name_kana, v_loser.name_kana),
    address    = coalesce(address, v_loser.address),
    company_id = coalesce(company_id, v_loser.company_id)
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
