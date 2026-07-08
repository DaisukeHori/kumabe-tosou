-- 価格モデル v2 (設計書 §2.2 / 契約書 §4.8 v2.1)
-- legacy 実構造: グレード×サイズ行列 (価格レンジ) + 数量自動値引き + XL 個別見積もり

create table price_size_classes (
  key text primary key,
  label text not null,
  max_mm int,
  quote_only boolean not null default false,
  sort_order int not null default 0
);

create table price_matrix (
  grade_key text not null references price_grades(key) on delete cascade,
  size_key text not null references price_size_classes(key),
  price_min int not null check (price_min >= 0),
  price_max int not null,
  primary key (grade_key, size_key),
  check (price_max >= price_min)
);

create table price_quantity_tiers (
  min_qty int primary key check (min_qty >= 2),
  discount_rate numeric not null check (discount_rate > 0 and discount_rate < 1),
  label text not null
);

alter table price_grades drop column base_price;

alter table price_size_classes enable row level security;
alter table price_matrix enable row level security;
alter table price_quantity_tiers enable row level security;

create policy price_size_classes_anon_select on price_size_classes
  for select using (true);
create policy price_size_classes_admin_insert on price_size_classes
  for insert with check (public.is_admin());
create policy price_size_classes_admin_update on price_size_classes
  for update using (public.is_admin()) with check (public.is_admin());
create policy price_size_classes_admin_delete on price_size_classes
  for delete using (public.is_admin());

create policy price_matrix_anon_select on price_matrix
  for select using (true);
create policy price_matrix_admin_insert on price_matrix
  for insert with check (public.is_admin());
create policy price_matrix_admin_update on price_matrix
  for update using (public.is_admin()) with check (public.is_admin());
create policy price_matrix_admin_delete on price_matrix
  for delete using (public.is_admin());

create policy price_quantity_tiers_anon_select on price_quantity_tiers
  for select using (true);
create policy price_quantity_tiers_admin_insert on price_quantity_tiers
  for insert with check (public.is_admin());
create policy price_quantity_tiers_admin_update on price_quantity_tiers
  for update using (public.is_admin()) with check (public.is_admin());
create policy price_quantity_tiers_admin_delete on price_quantity_tiers
  for delete using (public.is_admin());
