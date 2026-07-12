-- =========================================================
-- scheduling (#52): work_types/work_templates/work_template_items/work_blocks の
--   RLS (0015パターン: anon全拒否 / admin 4操作可 / service bypass) + seed 5件冪等性 +
--   site_settings.work_capacity バックフィル存在確認、結合検証 (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/03-scheduling.md §2.2 (migration 20260711000029_scheduling_core.sql 全文)
--   - docs/design/crm-suite/03-scheduling.md §4.2 (RLS テーブル認可マトリクス)
--   - docs/design/crm-suite/03-scheduling.md §13.2 (テストファイル×子Issue対応)
--   - 実装計画書 (scratchpad/plans/issue-52.md) §「テスト戦略」§「結合」
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / migration
--   20260711000029_scheduling_core.sql が本番へ未適用のため実行環境が無い。加えて本 migration は
--   0023_crm_core.sql (deals) と 0026_sales_core.sql (documents) に依存するため、#42/#48 の
--   本番適用後でないと適用不可)。
--   migration 0021〜0026/0029 を本番 (Supabase) に手動 apply した後、Supabase MCP の
--   execute_sql ツールに本ファイルの内容をそのまま渡して実行し、末尾の scheduling_test_log の
--   結果 (全行 passed=true) で検証すること。
--
-- 設計方針 (tests/integration/sales-rls-numbering.sql / crm-rls-merge.sql の確立パターンを踏襲):
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。フィクスチャ (customers/
--     deals/documents/work_types/work_templates/work_template_items/work_blocks) 及び
--     work_types seed 5 件の再 INSERT (on conflict do nothing なので実質無害) は一切残さない。
--   - 各チェックは独立した DO ブロックに分割し、1 チェックの失敗が他チェックのログ記録を
--     巻き添えにしないようにする (savepoint 相当は各 DO ブロック内の nested begin/exception)。
--   - ロール切替は SET LOCAL ROLE (+ request.jwt.claims の role/sub) で行う。
--   - service_role は RLS を bypass する (BYPASSRLS 属性)。フィクスチャ作成 (customer/deal/
--     document) と work_types/work_templates/work_template_items/work_blocks の service 経路
--     動作確認の両方に用いる。service_role フィクスチャで anon/admin チェックを迂回しない —
--     ②③の各チェックは実際に anon / authenticated ロールへ SET LOCAL ROLE してから実行する。
-- =========================================================

begin;

create temporary table scheduling_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

create temporary table scheduling_test_fixture (
  key text primary key,
  id uuid not null
);

do $$ begin raise notice '=== scheduling RLS/seed/backfill 結合検証 開始 (このトランザクションは最後に必ず ROLLBACK する) ==='; end $$;

-- =========================================================
-- ① フィクスチャ準備 (service_role — RLS bypass): customer/deal/document(draft) + work_type +
--    admin profile 探索 (m0/crm/sales と同じ「実在の管理者行が無い環境は SKIPPED」方針)
-- =========================================================
do $$
declare
  v_customer_id uuid;
  v_deal_id uuid;
  v_document_id uuid;
  v_work_type_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into customers (kind, name, lifecycle, source)
    values ('person', '__scheduling_test__ 顧客', 'customer', 'manual')
    returning id into v_customer_id;
  insert into scheduling_test_fixture (key, id) values ('customer', v_customer_id);

  insert into deals (title, customer_id, source)
    values ('__scheduling_test__ 案件', v_customer_id, 'manual')
    returning id into v_deal_id;
  insert into scheduling_test_fixture (key, id) values ('deal', v_deal_id);

  insert into documents (doc_type, deal_id, billing_name)
    values ('quote', v_deal_id, '__scheduling_test__ draft')
    returning id into v_document_id;
  insert into scheduling_test_fixture (key, id) values ('document', v_document_id);

  select id into v_work_type_id from work_types where key = 'sanding';
  if v_work_type_id is not null then
    insert into scheduling_test_fixture (key, id) values ('work_type_sanding', v_work_type_id);
  end if;

  insert into scheduling_test_log (section, check_name, passed, detail)
    values ('①fixture', 'service_role: customer/deal/document フィクスチャが作成できること', true,
            format('OK: customer=%s deal=%s document=%s sanding=%s',
              v_customer_id, v_deal_id, v_document_id, v_work_type_id));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('①fixture', 'service_role: customer/deal/document フィクスチャが作成できること', false,
              format('FAIL: 想定外のエラー (以降の全チェックの前提が崩れる): %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('①fixture', 'admin profile 探索', true,
              'SKIPPED: profiles に管理者行が無い環境 (bootstrap-admin 未実行)。admin セッションを要する以降のチェックは全て SKIPPED になる');
  else
    insert into scheduling_test_fixture (key, id) values ('admin', v_admin_id);
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('①fixture', 'admin profile 探索', true, format('OK: admin_id=%s', v_admin_id));
  end if;
end $$;

-- =========================================================
-- ② anon: work_types / work_templates / work_template_items / work_blocks いずれも
--    grant 自体が無い (permission denied) — 「revoke all ... from anon」の後 authenticated
--    にのみ grant しているため、RLS フィルタ以前の権限チェックで拒否される
-- =========================================================
do $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  begin
    perform count(*) from work_types;
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: work_types SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: work_types SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;

  begin
    perform count(*) from work_templates;
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: work_templates SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: work_templates SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;

  begin
    perform count(*) from work_template_items;
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: work_template_items SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: work_template_items SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;

  begin
    perform count(*) from work_blocks;
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: work_blocks SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: work_blocks SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;

  -- anon は INSERT も同様に拒否される (代表として work_types のみ確認)
  begin
    insert into work_types (key, label, color, consumes_capacity, sort_order)
      values ('__scheduling_test_anon__', 'anon禁止', '#000000', true, 999);
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: work_types INSERT は permission denied を期待', false, 'FAIL: anon が挿入できてしまった');
  exception
    when insufficient_privilege then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: work_types INSERT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon 拒否確認 (ロール切替等の予期せぬ失敗)', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ③ admin (authenticated + is_admin() 成立): work_types に対して SELECT/INSERT/UPDATE/DELETE
--    の 4 操作すべてが行えること (§4.2 admin 全権)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_new_id uuid;
  v_selected_count int;
begin
  select id into v_admin_id from scheduling_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_types', 'admin: work_types SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  insert into work_types (key, label, color, consumes_capacity, default_hours, sort_order)
    values ('__scheduling_test_admin__', '__scheduling_test__ 種別', '#123456', true, 1.5, 999)
    returning id into v_new_id;

  select count(*) into v_selected_count from work_types where id = v_new_id;

  update work_types set label = '__scheduling_test__ 種別(更新後)' where id = v_new_id;

  delete from work_types where id = v_new_id;

  if v_selected_count = 1 and not exists (select 1 from work_types where id = v_new_id) then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_types', 'admin: work_types SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'OK: 4 操作とも成功');
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_types', 'admin: work_types SELECT/INSERT/UPDATE/DELETE が一通り行えること', false,
              'FAIL: いずれかの操作が反映されていない');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_types', 'admin: work_types 4操作確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_new_id uuid;
  v_selected_count int;
begin
  select id into v_admin_id from scheduling_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_templates', 'admin: work_templates SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  insert into work_templates (name, grade_key, size_key)
    values ('__scheduling_test__ テンプレ', '__scheduling_test_grade__', '__scheduling_test_size__')
    returning id into v_new_id;

  select count(*) into v_selected_count from work_templates where id = v_new_id;

  update work_templates set name = '__scheduling_test__ テンプレ(更新後)' where id = v_new_id;

  delete from work_templates where id = v_new_id;

  if v_selected_count = 1 and not exists (select 1 from work_templates where id = v_new_id) then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_templates', 'admin: work_templates SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'OK: 4 操作とも成功');
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_templates', 'admin: work_templates SELECT/INSERT/UPDATE/DELETE が一通り行えること', false,
              'FAIL: いずれかの操作が反映されていない');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_templates', 'admin: work_templates 4操作確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_template_id uuid;
  v_work_type_id uuid;
  v_new_item_id uuid;
  v_selected_count int;
begin
  select id into v_admin_id from scheduling_test_fixture where key = 'admin';
  select id into v_work_type_id from scheduling_test_fixture where key = 'work_type_sanding';
  if v_admin_id is null or v_work_type_id is null then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_template_items', 'admin: work_template_items SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'SKIPPED: 管理者行または sanding 種別が無い環境 (seed 未適用の可能性)');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  insert into work_templates (name, grade_key, size_key)
    values ('__scheduling_test__ テンプレ(items用)', '__scheduling_test_grade2__', '__scheduling_test_size2__')
    returning id into v_template_id;

  insert into work_template_items (template_id, work_type_id, hours, sort_order)
    values (v_template_id, v_work_type_id, 2.5, 10)
    returning id into v_new_item_id;

  select count(*) into v_selected_count from work_template_items where id = v_new_item_id;

  update work_template_items set hours = 3.0 where id = v_new_item_id;

  delete from work_template_items where id = v_new_item_id;

  -- 後片付け (テンプレート本体)
  delete from work_templates where id = v_template_id;

  if v_selected_count = 1 and not exists (select 1 from work_template_items where id = v_new_item_id) then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_template_items', 'admin: work_template_items SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'OK: 4 操作とも成功');
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_template_items', 'admin: work_template_items SELECT/INSERT/UPDATE/DELETE が一通り行えること', false,
              'FAIL: いずれかの操作が反映されていない');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_template_items', 'admin: work_template_items 4操作確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_deal_id uuid;
  v_document_id uuid;
  v_work_type_id uuid;
  v_new_id uuid;
  v_selected_count int;
begin
  select id into v_admin_id from scheduling_test_fixture where key = 'admin';
  select id into v_deal_id from scheduling_test_fixture where key = 'deal';
  select id into v_document_id from scheduling_test_fixture where key = 'document';
  select id into v_work_type_id from scheduling_test_fixture where key = 'work_type_sanding';
  if v_admin_id is null or v_work_type_id is null then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_blocks', 'admin: work_blocks SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'SKIPPED: 管理者行または sanding 種別が無い環境 (seed 未適用の可能性)');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  insert into work_blocks (deal_id, source_document_id, work_type_id, title, planned_hours, consumes_capacity, quantity, memo)
    values (v_deal_id, v_document_id, v_work_type_id, '__scheduling_test__ ブロック', 3, true, 1, '数量 1')
    returning id into v_new_id;

  select count(*) into v_selected_count from work_blocks where id = v_new_id;

  update work_blocks set memo = '__scheduling_test__ 更新後' where id = v_new_id;

  delete from work_blocks where id = v_new_id;

  if v_selected_count = 1 and not exists (select 1 from work_blocks where id = v_new_id) then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_blocks', 'admin: work_blocks SELECT/INSERT/UPDATE/DELETE が一通り行えること', true,
              'OK: 4 操作とも成功 (status既定=backlog・starts_at/ends_at NULL のため work_blocks_backlog_unplaced 制約も通過)');
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_blocks', 'admin: work_blocks SELECT/INSERT/UPDATE/DELETE が一通り行えること', false,
              'FAIL: いずれかの操作が反映されていない');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('③admin全権-work_blocks', 'admin: work_blocks 4操作確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ service_role: RLS bypass の確認 (代表として work_types。RLS ポリシー・grant の
--    どちらにも依存せず操作できること — BYPASSRLS 属性)
-- =========================================================
do $$
declare
  v_new_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into work_types (key, label, color, consumes_capacity, sort_order)
    values ('__scheduling_test_service__', '__scheduling_test__ service種別', '#654321', false, 998)
    returning id into v_new_id;

  if exists (select 1 from work_types where id = v_new_id) then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('④service bypass', 'service_role: work_types への INSERT/SELECT が RLS bypass で成功する', true, 'OK');
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('④service bypass', 'service_role: work_types への INSERT/SELECT が RLS bypass で成功する', false, 'FAIL: 反映されていない');
  end if;

  delete from work_types where id = v_new_id;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('④service bypass', 'service_role bypass 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑤ seed 冪等性: work_types の既定 5 件 (sanding/primer/painting/drying/inspection) が
--    存在し、migration 0029 §5 の INSERT 文をそのまま再実行しても重複行が増えないこと
--    (on conflict (key) do nothing)
-- =========================================================
do $$
declare
  v_count_before int;
  v_count_after int;
  v_seed_present int;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select count(*) into v_seed_present from work_types
    where key in ('sanding', 'primer', 'painting', 'drying', 'inspection');

  select count(*) into v_count_before from work_types;

  insert into work_types (key, label, color, consumes_capacity, default_hours, sort_order) values
    ('sanding',    '研磨',     '#8d6e63', true,  3,  10),
    ('primer',     '下地',     '#78909c', true,  2,  20),
    ('painting',   '塗装',     '#a80f22', true,  4,  30),
    ('drying',     '乾燥待ち', '#bdbdbd', false, 24, 40),
    ('inspection', '検品',     '#2e7d32', true,  1,  50)
  on conflict (key) do nothing;

  select count(*) into v_count_after from work_types;

  if v_seed_present = 5 and v_count_after = v_count_before then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑤seed冪等性', '既定 work_types 5件が存在し、再INSERTしても行数が変わらないこと', true,
              format('OK: seed_present=%s count_before=%s count_after=%s', v_seed_present, v_count_before, v_count_after));
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑤seed冪等性', '既定 work_types 5件が存在し、再INSERTしても行数が変わらないこと', false,
              format('FAIL: seed_present=%s (期待5) count_before=%s count_after=%s', v_seed_present, v_count_before, v_count_after));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑤seed冪等性', 'seed 冪等性確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑥ site_settings.work_capacity バックフィル存在確認 (migration 0029 §6)。値の Zod 検証は
--    settings/contracts.ts (#53 が SETTINGS_SCHEMAS 登録) の管轄のため、ここでは
--    「行が存在し weekly_hours=40 であること」の DB レベル確認のみ行う
-- =========================================================
do $$
declare
  v_weekly_hours numeric;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select (value->>'weekly_hours')::numeric into v_weekly_hours
    from site_settings where key = 'work_capacity';

  if v_weekly_hours = 40 then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑥work_capacityバックフィル', 'site_settings.work_capacity = {weekly_hours:40} が存在すること', true,
              format('OK: weekly_hours=%s', v_weekly_hours));
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑥work_capacityバックフィル', 'site_settings.work_capacity = {weekly_hours:40} が存在すること', false,
              format('FAIL: weekly_hours=%s (行が無い場合は null)', v_weekly_hours));
  end if;

  -- 再バックフィル (on conflict do nothing) しても既存値が上書きされないこと
  insert into site_settings (key, value)
    values ('work_capacity', jsonb_build_object('weekly_hours', 999))
    on conflict (key) do nothing;

  select (value->>'weekly_hours')::numeric into v_weekly_hours
    from site_settings where key = 'work_capacity';

  if v_weekly_hours = 40 then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑥work_capacityバックフィル', '再バックフィル (on conflict do nothing) で既存値が上書きされないこと', true,
              format('OK: weekly_hours=%s (999で上書きされていない)', v_weekly_hours));
  else
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑥work_capacityバックフィル', '再バックフィル (on conflict do nothing) で既存値が上書きされないこと', false,
              format('FAIL: weekly_hours=%s', v_weekly_hours));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑥work_capacityバックフィル', 'work_capacity バックフィル確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑦ work_types 削除時の FK 違反 (23503): work_template_items から参照中の work_type は
--    削除できないこと (repository.deleteWorkType が KMB-E702 に変換する対象の DB レベル確認)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_work_type_id uuid;
  v_template_id uuid;
begin
  select id into v_admin_id from scheduling_test_fixture where key = 'admin';
  select id into v_work_type_id from scheduling_test_fixture where key = 'work_type_sanding';
  if v_admin_id is null or v_work_type_id is null then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑦FK違反', '参照中の work_type 削除は FK 違反 (23503) になること', true,
              'SKIPPED: 管理者行または sanding 種別が無い環境');
    return;
  end if;

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into work_templates (name, grade_key, size_key)
    values ('__scheduling_test__ FK検証用テンプレ', '__scheduling_test_grade3__', '__scheduling_test_size3__')
    returning id into v_template_id;
  insert into work_template_items (template_id, work_type_id, hours, sort_order)
    values (v_template_id, v_work_type_id, 1, 10);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  begin
    delete from work_types where id = v_work_type_id;
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑦FK違反', '参照中の work_type 削除は FK 違反 (23503) になること', false, 'FAIL: 削除できてしまった');
  exception
    when foreign_key_violation then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('⑦FK違反', '参照中の work_type 削除は FK 違反 (23503) になること', true, 'OK: foreign_key_violation (23503)');
    when others then
      insert into scheduling_test_log (section, check_name, passed, detail)
        values ('⑦FK違反', '参照中の work_type 削除は FK 違反 (23503) になること', false,
                format('FAIL: 想定外のエラー (23503 以外): %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 後片付け (service_role で item→template を削除。work_type 本体は seed のため残す)
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  delete from work_template_items where template_id = v_template_id;
  delete from work_templates where id = v_template_id;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into scheduling_test_log (section, check_name, passed, detail)
      values ('⑦FK違反', 'work_type FK違反確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、上記の書き込み系チェック
-- — customers/deals/documents/work_types/work_templates/work_template_items/work_blocks
-- フィクスチャ — はすべて破棄される。実行者は以下の SELECT 結果で passed=false の行が無いことを
-- 確認する)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from scheduling_test_log;
  raise notice '=== scheduling RLS/seed/backfill 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from scheduling_test_log
order by id;

rollback;
