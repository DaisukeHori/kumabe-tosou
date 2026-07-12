-- 20260711000029_scheduling_core.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.2 (裁定 J8)
-- 本 migration が追加するもの:
--   1. work_types (作業種別マスタ。色コード付き、consumes_capacity で拘束/非拘束を型区別)
--   2. work_templates / work_template_items (標準工数テンプレート: grade×size → ブロックセット)
--   3. work_blocks (作業ブロック。consumes_capacity は作成時に work_types からスナップショット複製)
--   4. 既定作業種別 5 件の seed (冪等 — on conflict do nothing)
--   5. site_settings 'work_capacity' キーのバックフィル (Zod canonical は module-contracts v2.8 §4.2)
-- 本 migration が行わないこと: 外部同期テーブル (0030)・pg_cron 登録 (0031)
-- 適用前提: 0023 (crm: deals) / 0026 (sales: documents) 適用済み — work_blocks が FK を張るため
-- 値制約 (文字数上限・色コード形式・key 形式) は Zod (scheduling/contracts.ts) が唯一の正。
-- DB check は enum/status/非負/状態不変条件などの構造的制約に限定する (既存規約)。
--
-- ロールバック手順 (14.1): 参照ゼロを確認の上、
--   delete from work_types where key in ('sanding','primer','painting','drying','inspection');
--   delete from site_settings where key = 'work_capacity';
--   drop table if exists work_blocks;
--   drop table if exists work_template_items;
--   drop table if exists work_templates;
--   drop table if exists work_types;

-- =========================================================================
-- 1. work_types — 作業種別マスタ
-- =========================================================================
create table work_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  color text not null,
  consumes_capacity boolean not null default true,
  default_hours numeric(5,2) check (default_hours is null or default_hours >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table work_types is
  '作業種別マスタ (研磨/下地/塗装/乾燥/検品…)。key/color/label の値制約は zWorkTypeInput (Zod) が正';
comment on column work_types.consumes_capacity is
  'false = 非拘束 (乾燥待ち等。カレンダー上の期間は占めるが週間キャパを消費しない — 裁定 J8)。'
  'work_blocks へは作成時にスナップショット複製し、以後マスタ変更が既存ブロックへ波及しない';
comment on column work_types.default_hours is
  '単独ブロック作成時の既定時間。非拘束種別では「占有期間の目安 (時間)」の意味';

create trigger handle_updated_at before update on work_types
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 2. work_templates / work_template_items — 標準工数テンプレート
-- =========================================================================
create table work_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_key text,
  size_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table work_templates is
  '標準工数テンプレート (grade×size → ブロックセット)。grade_key/size_key は pricing の '
  'price_grades.key / price_size_classes.key を文字列参照 (FK なし — 契約 v2.8 §4.12。'
  'NULL = ワイルドカード。解決順序は 03-scheduling.md §7.1)';

-- アクティブなテンプレートは (grade_key, size_key) 組で一意 (NULL はワイルドカードとして '' に正規化)
create unique index work_templates_combo_active_uidx
  on work_templates (coalesce(grade_key, ''), coalesce(size_key, ''))
  where is_active;

create trigger handle_updated_at before update on work_templates
  for each row execute procedure extensions.moddatetime (updated_at);

create table work_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references work_templates(id) on delete cascade,
  work_type_id uuid not null references work_types(id),
  hours numeric(5,2) not null check (hours >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table work_template_items is
  'テンプレート明細。保存はテンプレート単位の全置換 (delete + insert) のため updated_at なし。'
  'work_type_id は FK — 参照中の work_types 削除は FK 違反 → repository が KMB-E702 に変換';

create index work_template_items_template_idx
  on work_template_items (template_id, sort_order);

-- =========================================================================
-- 3. work_blocks — 作業ブロック
-- =========================================================================
create table work_blocks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete set null,
  source_document_id uuid references documents(id) on delete set null,
  work_type_id uuid not null references work_types(id),
  title text,
  status text not null default 'backlog'
    check (status in ('backlog','scheduled','in_progress','done','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  planned_hours numeric(5,2) not null default 0 check (planned_hours >= 0),
  actual_hours numeric(5,2) check (actual_hours is null or actual_hours >= 0),
  performed_on date,
  consumes_capacity boolean not null,
  quantity numeric(7,2),
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- E701: 配置は starts/ends 同時 NULL または同時非 NULL、開始 < 終了
  constraint work_blocks_placement_pair check ((starts_at is null) = (ends_at is null)),
  constraint work_blocks_placement_order check (starts_at is null or ends_at > starts_at),
  -- 状態と配置の構造的不変条件 (§5.1)
  constraint work_blocks_backlog_unplaced check (status <> 'backlog' or starts_at is null),
  constraint work_blocks_active_placed
    check (status not in ('scheduled','in_progress') or starts_at is not null),
  constraint work_blocks_done_complete
    check (status <> 'done'
           or (actual_hours is not null and performed_on is not null and starts_at is not null))
);

comment on table work_blocks is
  '作業ブロック。1 リソース (熊部さん) 固定 — resources テーブルは作らない (裁定 J8)。'
  'title NULL = work_types.label から表示名を導出';
comment on column work_blocks.consumes_capacity is
  '作成時に work_types.consumes_capacity をスナップショット複製 (上位指示)。'
  '種別変更時のみ再スナップショット (repository)。キャパ計算はこの列だけを見る';
comment on column work_blocks.planned_hours is
  '拘束ブロック = 予定工数 (h)。非拘束ブロック = 占有期間の目安 (h)。キャパ計算は拘束のみ合算';
comment on column work_blocks.quantity is
  '原案生成時の由来明細の数量 (メモ)。テンプレ時間は数量で乗算しない (§7.1 の裁定)';

create index work_blocks_deal_idx on work_blocks (deal_id);
create index work_blocks_status_starts_idx on work_blocks (status, starts_at);
create index work_blocks_capacity_idx
  on work_blocks (starts_at) where starts_at is not null and consumes_capacity;

create trigger handle_updated_at before update on work_blocks
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 4. RLS — admin 全権 3 テーブル + work_blocks (00-overview §5.2 の総表どおり)
--    0015 パターン: 4 ポリシー + 明示 revoke + grant (RLS 有効化だけでは
--    default privileges の grant が残るため revoke を必ず書く — 0020 教訓)
-- =========================================================================
alter table work_types enable row level security;
create policy work_types_admin_select on work_types for select using (public.is_admin());
create policy work_types_admin_insert on work_types for insert with check (public.is_admin());
create policy work_types_admin_update on work_types for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_types_admin_delete on work_types for delete using (public.is_admin());
revoke all on work_types from anon;
grant select, insert, update, delete on work_types to authenticated;

alter table work_templates enable row level security;
create policy work_templates_admin_select on work_templates for select using (public.is_admin());
create policy work_templates_admin_insert on work_templates for insert with check (public.is_admin());
create policy work_templates_admin_update on work_templates for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_templates_admin_delete on work_templates for delete using (public.is_admin());
revoke all on work_templates from anon;
grant select, insert, update, delete on work_templates to authenticated;

alter table work_template_items enable row level security;
create policy work_template_items_admin_select on work_template_items for select using (public.is_admin());
create policy work_template_items_admin_insert on work_template_items for insert with check (public.is_admin());
create policy work_template_items_admin_update on work_template_items for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_template_items_admin_delete on work_template_items for delete using (public.is_admin());
revoke all on work_template_items from anon;
grant select, insert, update, delete on work_template_items to authenticated;

alter table work_blocks enable row level security;
create policy work_blocks_admin_select on work_blocks for select using (public.is_admin());
create policy work_blocks_admin_insert on work_blocks for insert with check (public.is_admin());
create policy work_blocks_admin_update on work_blocks for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_blocks_admin_delete on work_blocks for delete using (public.is_admin());
revoke all on work_blocks from anon;
grant select, insert, update, delete on work_blocks to authenticated;
-- service (worker) は RLS bypass — 外部同期による starts_at/ends_at 更新に使用

-- =========================================================================
-- 5. 既定作業種別 seed (冪等。admin が後から編集/無効化してよい)
-- =========================================================================
insert into work_types (key, label, color, consumes_capacity, default_hours, sort_order) values
  ('sanding',    '研磨',     '#8d6e63', true,  3,  10),
  ('primer',     '下地',     '#78909c', true,  2,  20),
  ('painting',   '塗装',     '#a80f22', true,  4,  30),
  ('drying',     '乾燥待ち', '#bdbdbd', false, 24, 40),
  ('inspection', '検品',     '#2e7d32', true,  1,  50)
on conflict (key) do nothing;

-- =========================================================================
-- 6. settings 'work_capacity' キーのバックフィル (新キー = 新行 INSERT。既定 週 40 時間)
--    Zod canonical は module-contracts v2.8 §4.2 (zWorkCapacitySettings)。所有は settings
-- =========================================================================
insert into site_settings (key, value)
values ('work_capacity', jsonb_build_object('weekly_hours', 40))
on conflict (key) do nothing;
