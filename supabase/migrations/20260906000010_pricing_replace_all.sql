-- 価格表 (pricing) の FK 是正 + 全置換 RPC (admin /admin/prices の保存を単一トランザクション化)。
--
-- 背景 (レビュー指摘):
--  1) price_matrix.size_key の FK (20260708000007_pricing_v2) に on delete cascade が無く、
--     サイズ帯を削除すると行列セルが残っていて FK 違反 (23503) で保存が失敗した。
--     grade_key 側も on update cascade が無く、グレード key を変更すると既存セルが旧 key を
--     参照したままになり同様に失敗した。
--  2) savePricingAction は grades → sizes → matrix → tiers → options の 5 テーブルを別々の
--     PostgREST 呼び出しで書いていたため、途中で失敗すると部分的に書き込まれた状態が残り
--     (非原子)、かつ unstable_cache('prices') の失効も行われずに旧表が焼き付いた。
--
-- 対策:
--  - FK を drop / add で付け直す (制約名は Postgres 既定の <table>_<column>_fkey)。
--  - pricing_replace_all(jsonb): 5 テーブルの置換を 1 つの security definer 関数にまとめ、
--    plpgsql 関数 = 単一トランザクションとして全件成功 or 全件ロールバックにする。
--    is_admin() ガード付き (crm_merge_customers / crm_reopen_deal と同パターン)。
--    grades の楽観排他 (expected_updated_at 不一致 → KMB-E103) はここで判定する。

-- ---------------------------------------------------------
-- 1) FK の付け直し
-- ---------------------------------------------------------
alter table price_matrix drop constraint if exists price_matrix_size_key_fkey;
alter table price_matrix add constraint price_matrix_size_key_fkey
  foreign key (size_key) references price_size_classes(key)
  on update cascade on delete cascade;

alter table price_matrix drop constraint if exists price_matrix_grade_key_fkey;
alter table price_matrix add constraint price_matrix_grade_key_fkey
  foreign key (grade_key) references price_grades(key)
  on update cascade on delete cascade;

-- ---------------------------------------------------------
-- 2) pricing_replace_all: 5 テーブルの原子的置換
--    p_payload = {
--      grades:  [{id: uuid|null, expected_updated_at: text|null, key, label, description, sort_order, is_active}],
--      sizes:   [{key, label, max_mm, quote_only, sort_order}],
--      matrix:  [{grade_key, size_key, price_min, price_max}],
--      tiers:   [{min_qty, discount_rate, label}],
--      options: [{id: uuid|null, key, label, kind, value, sort_order, is_active}]
--    }
--    grades / options は「payload に無い既存行を削除しない」(従来の upsert 系と同じ意味論 —
--    is_active=false で無効化する運用)。sizes / matrix / tiers は payload で全置換する。
--    処理順: grades (key 変更は FK の on update cascade で matrix に伝播) → sizes (削除は
--    on delete cascade で matrix に伝播) → matrix → tiers → options。
-- ---------------------------------------------------------
create or replace function public.pricing_replace_all(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grade record;
  v_option record;
  v_updated int;
begin
  if not public.is_admin() then
    raise exception 'permission denied: pricing_replace_all requires admin';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload->'grades') <> 'array'
     or jsonb_typeof(p_payload->'sizes') <> 'array'
     or jsonb_typeof(p_payload->'matrix') <> 'array'
     or jsonb_typeof(p_payload->'tiers') <> 'array'
     or jsonb_typeof(p_payload->'options') <> 'array' then
    raise exception 'KMB-E101: 価格表の入力形式が不正です (grades/sizes/matrix/tiers/options は配列必須)';
  end if;

  -- grades: 1 件ずつ楽観排他 (id + expected_updated_at) を伴って更新 / 新規作成
  for v_grade in
    select * from jsonb_to_recordset(p_payload->'grades') as g(
      id uuid,
      expected_updated_at timestamptz,
      key text,
      label text,
      description text,
      sort_order int,
      is_active boolean
    )
  loop
    if v_grade.id is not null then
      update price_grades set
        key = v_grade.key,
        label = v_grade.label,
        description = coalesce(v_grade.description, ''),
        sort_order = v_grade.sort_order,
        is_active = v_grade.is_active
      where id = v_grade.id
        and (v_grade.expected_updated_at is null or updated_at = v_grade.expected_updated_at);
      get diagnostics v_updated = row_count;
      if v_updated = 0 then
        raise exception 'KMB-E103: グレード (%) が他の変更と競合しました。再読み込みしてやり直してください', v_grade.key;
      end if;
    else
      insert into price_grades (key, label, description, sort_order, is_active)
      values (v_grade.key, v_grade.label, coalesce(v_grade.description, ''), v_grade.sort_order, v_grade.is_active);
    end if;
  end loop;

  -- sizes: payload に無い行は削除 (matrix は on delete cascade)、残りは upsert
  delete from price_size_classes s
  where not exists (
    select 1 from jsonb_array_elements(p_payload->'sizes') e where e->>'key' = s.key
  );
  insert into price_size_classes (key, label, max_mm, quote_only, sort_order)
  select key, label, max_mm, quote_only, sort_order
  from jsonb_to_recordset(p_payload->'sizes') as s(
    key text, label text, max_mm int, quote_only boolean, sort_order int
  )
  on conflict (key) do update set
    label = excluded.label,
    max_mm = excluded.max_mm,
    quote_only = excluded.quote_only,
    sort_order = excluded.sort_order;

  -- matrix: payload に無いセルは削除、残りは upsert (grade_key/size_key は上の cascade 反映後)
  delete from price_matrix m
  where not exists (
    select 1 from jsonb_array_elements(p_payload->'matrix') e
    where e->>'grade_key' = m.grade_key and e->>'size_key' = m.size_key
  );
  insert into price_matrix (grade_key, size_key, price_min, price_max)
  select grade_key, size_key, price_min, price_max
  from jsonb_to_recordset(p_payload->'matrix') as c(
    grade_key text, size_key text, price_min int, price_max int
  )
  on conflict (grade_key, size_key) do update set
    price_min = excluded.price_min,
    price_max = excluded.price_max;

  -- tiers: 全置換
  delete from price_quantity_tiers t
  where not exists (
    select 1 from jsonb_array_elements(p_payload->'tiers') e where (e->>'min_qty')::int = t.min_qty
  );
  insert into price_quantity_tiers (min_qty, discount_rate, label)
  select min_qty, discount_rate, label
  from jsonb_to_recordset(p_payload->'tiers') as t(
    min_qty int, discount_rate numeric, label text
  )
  on conflict (min_qty) do update set
    discount_rate = excluded.discount_rate,
    label = excluded.label;

  -- options: id 有無で update / insert (明示的な楽観排他は課さない — 従来仕様)
  for v_option in
    select * from jsonb_to_recordset(p_payload->'options') as o(
      id uuid,
      key text,
      label text,
      kind text,
      value numeric,
      sort_order int,
      is_active boolean
    )
  loop
    if v_option.id is not null then
      update price_options set
        key = v_option.key,
        label = v_option.label,
        kind = v_option.kind,
        value = v_option.value,
        sort_order = v_option.sort_order,
        is_active = v_option.is_active
      where id = v_option.id;
      get diagnostics v_updated = row_count;
      if v_updated = 0 then
        raise exception 'KMB-E101: オプション (%) の更新対象が見つかりません', v_option.key;
      end if;
    else
      insert into price_options (key, label, kind, value, sort_order, is_active)
      values (v_option.key, v_option.label, v_option.kind, v_option.value, v_option.sort_order, v_option.is_active);
    end if;
  end loop;
end;
$$;

revoke execute on function public.pricing_replace_all(jsonb) from public, anon;
grant execute on function public.pricing_replace_all(jsonb) to authenticated;
