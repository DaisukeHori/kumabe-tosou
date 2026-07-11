-- =========================================================
-- crm (#42): RLS / crm_merge_customers RPC / 終端ステージトリガ / 冪等 index 結合検証
-- (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/01-crm.md §2.2 (migration 20260711000023_crm_core.sql 全文)
--   - docs/design/crm-suite/01-crm.md §3.2 (テーブル認可 4 列マトリクス)
--   - docs/design/crm-suite/01-crm.md §4.2 (終端ステージ不変)
--   - docs/design/crm-suite/01-crm.md §6.4 (crm_merge_customers)
--   - docs/design/crm-suite/01-crm.md §11.3 (結合テストケース一覧)
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / 本番 migration
--   20260711000023_crm_core.sql 未適用のため実行環境が無い)。migration 0023 を本番
--   (Supabase) に手動 apply した後、Supabase MCP の execute_sql ツールに本ファイルの内容を
--   そのまま渡して実行し、末尾の crm_test_log の結果 (全行 passed=true) で検証すること。
--   実行前提: MCP の接続ロールが postgres 等の SET ROLE 可能な特権ロールであること
--   (tests/integration/m0-rls-rpc.sql と同じ運用注意点 — 複数文の結果セット可視性、
--   トランザクション維持の可否を含め、当該ファイル冒頭コメントを参照)。
--
-- 設計方針 (m0-rls-rpc.sql の確立パターンを踏襲):
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。crm_merge_customers が行う
--     多テーブル書き込み・INSERT した companies/customers/deals/activities/activity_links/
--     tasks/contact_inquiries は一切残さない。
--   - 各チェックは DO ブロック内の BEGIN/EXCEPTION で例外を握りつぶし、結果を一時テーブル
--     crm_test_log に記録する (1 チェックの失敗で残りのチェックが巻き添えで止まらないように)。
--   - ロール切替は SET LOCAL ROLE (+ request.jwt.claims の role/sub) で行う。
--   - admin ロールのテストは実在の profiles 行 (is_admin() = exists(profiles where id=auth.uid())
--     — 本アプリは単一 admin モデルで role 列に段階なし) を使う。profiles.id は
--     auth.users(id) への FK のため任意 uuid を新規 insert できない — 実在の管理者行が
--     無い環境では該当チェックを SKIPPED として記録する (m0-rls-rpc.sql と同じ扱い)。
--   - service_role によるフィクスチャ作成 (companies/customers/deals/activities/
--     activity_links/tasks/contact_inquiries の baseline 行) は RLS を bypass するため
--     常に成功する前提で組み立てる。
-- =========================================================

begin;

create temporary table crm_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

do $$ begin raise notice '=== crm RLS/RPC/トリガ/冪等index 結合検証 開始 (このトランザクションは最後に必ず ROLLBACK する) ==='; end $$;

-- =========================================================
-- 0. フィクスチャ準備 (service_role — RLS bypass)
-- =========================================================
create temporary table crm_test_fixture (
  key text primary key,
  id uuid not null
);

do $$
declare
  v_company_id uuid;
  v_customer_id uuid;
  v_deal_id uuid;
  v_activity_id uuid;
  v_inquiry_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into companies (name) values ('__crm_test__ 株式会社テスト') returning id into v_company_id;
  insert into customers (kind, name, email, tel_e164, company_id, lifecycle, source)
    values ('person', '__crm_test__ 顧客A', 'crmtest-a@example.com', '+819011110001', v_company_id, 'lead', 'manual')
    returning id into v_customer_id;
  insert into deals (title, customer_id, company_id, stage, source)
    values ('__crm_test__ 案件A', v_customer_id, v_company_id, 'inquiry', 'manual')
    returning id into v_deal_id;
  insert into activities (activity_type, occurred_at, title, body)
    values ('note', now(), '__crm_test__ メモ', '本文')
    returning id into v_activity_id;
  insert into contact_inquiries (name, email, inquiry_type, body, status)
    values ('__crm_test__ 問い合わせA', 'crmtest-inquiry@example.com', 'estimate', '本文', 'new')
    returning id into v_inquiry_id;

  insert into crm_test_fixture(key, id) values
    ('company', v_company_id),
    ('customer', v_customer_id),
    ('deal', v_deal_id),
    ('activity', v_activity_id),
    ('inquiry', v_inquiry_id);

  insert into crm_test_log(section, check_name, passed, detail)
    values ('0.fixture', 'service_role: baseline 行 (company/customer/deal/activity/inquiry) が作れること', true,
            format('OK: company=%s customer=%s deal=%s activity=%s inquiry=%s',
              v_company_id, v_customer_id, v_deal_id, v_activity_id, v_inquiry_id));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('0.fixture', 'service_role: baseline 行が作れること', false,
              format('FAIL: 想定外のエラー (以降の多くのチェックが前提を欠く): %s', sqlerrm));
    reset role;
end $$;

-- 以降で使う admin sub (実在の profiles 行) を決定
do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('0.fixture', 'admin sub の決定 (profiles 実在行)', true,
              'SKIPPED: profiles に管理者行が無い環境 (bootstrap-admin 未実行) — admin セルの検証は以降すべて SKIPPED になる');
  else
    insert into crm_test_fixture(key, id) values ('admin', v_admin_id)
      on conflict (key) do update set id = excluded.id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('0.fixture', 'admin sub の決定 (profiles 実在行)', true, format('OK: admin_id=%s', v_admin_id));
  end if;
end $$;

-- =========================================================
-- ① RLS: anon は 6 テーブル全操作を拒否される (companies/customers/deals/tasks は
--    revoke all、activities/activity_links も revoke all — §2.2。RLS フィルタではなく
--    grant 自体が無いため insufficient_privilege (42501) として観測される)
-- =========================================================
do $$
declare
  v_company_id uuid;
  v_customer_id uuid;
  v_deal_id uuid;
  v_activity_id uuid;
  v_tbl text;
  v_ok boolean;
begin
  select id into v_company_id from crm_test_fixture where key = 'company';
  select id into v_customer_id from crm_test_fixture where key = 'customer';
  select id into v_deal_id from crm_test_fixture where key = 'deal';
  select id into v_activity_id from crm_test_fixture where key = 'activity';

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  -- SELECT (6 テーブル)
  for v_tbl in select unnest(array['companies','customers','deals','activities','activity_links','tasks'])
  loop
    begin
      execute format('select count(*) from %I', v_tbl);
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', format('anon: SELECT %s は permission denied を期待', v_tbl), false,
                'FAIL: anon が SELECT できてしまった');
    exception
      when insufficient_privilege then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('①anon拒否', format('anon: SELECT %s は permission denied を期待', v_tbl), true, 'OK: 42501');
      when others then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('①anon拒否', format('anon: SELECT %s は permission denied を期待', v_tbl), false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
    end;
  end loop;

  -- INSERT (companies)
  begin
    insert into companies (name) values ('__crm_test__ anon insert');
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①anon拒否', 'anon: INSERT companies は permission denied を期待', false, 'FAIL: 挿入できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', 'anon: INSERT companies は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', 'anon: INSERT companies は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  -- UPDATE (customers)
  begin
    update customers set notes = 'anon tried' where id = v_customer_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①anon拒否', 'anon: UPDATE customers は permission denied を期待', false, 'FAIL: 更新できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', 'anon: UPDATE customers は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', 'anon: UPDATE customers は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  -- DELETE (tasks — admin にも許される最も権限の広いテーブルだが anon はそれでも拒否)
  begin
    delete from tasks where id = gen_random_uuid();
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①anon拒否', 'anon: DELETE tasks は permission denied を期待', false, 'FAIL: 削除文が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', 'anon: DELETE tasks は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('①anon拒否', 'anon: DELETE tasks は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①anon拒否', 'anon 拒否ブロック全体 (ロール切替等の予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ② RLS: admin (§3.2 のセルどおり)
--    companies/customers/deals: SELECT/INSERT/UPDATE 可・DELETE は revoke (permission denied)
--    activities: SELECT/INSERT 可、UPDATE/DELETE は activity_type='note' のみ (非 note は 0 行)
--    activity_links: SELECT/INSERT 可、UPDATE は revoke (permission denied)、DELETE は note リンクのみ
--    tasks: 全権
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_company_id uuid;
  v_customer_id uuid;
  v_deal_id uuid;
  v_activity_id uuid;
  v_count int;
  v_new_company_id uuid;
  v_new_customer_id uuid;
  v_new_deal_id uuid;
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'companies/customers/deals: SELECT/INSERT/UPDATE 可・DELETE 拒否', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;
  select id into v_company_id from crm_test_fixture where key = 'company';
  select id into v_customer_id from crm_test_fixture where key = 'customer';
  select id into v_deal_id from crm_test_fixture where key = 'deal';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- SELECT
  select count(*) into v_count from companies where id = v_company_id;
  select count(*) into v_count from customers where id = v_customer_id;
  select count(*) into v_count from deals where id = v_deal_id;
  insert into crm_test_log(section, check_name, passed, detail)
    values ('②admin', 'companies/customers/deals: SELECT 可', true, 'OK');

  -- INSERT (with check is_admin() を裏取り — §11.3 要求。現状は service_role フィクスチャ
  -- 経由の行しか無く、admin 自身の INSERT with check が通ることを未検証だった)
  insert into companies (name) values ('__crm_test__ admin insert会社')
    returning id into v_new_company_id;
  insert into customers (kind, name, lifecycle, source)
    values ('person', '__crm_test__ admin insert顧客', 'lead', 'manual')
    returning id into v_new_customer_id;
  insert into deals (title, customer_id, stage, source)
    values ('__crm_test__ admin insert案件', v_new_customer_id, 'inquiry', 'manual')
    returning id into v_new_deal_id;
  if v_new_company_id is not null and v_new_customer_id is not null and v_new_deal_id is not null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'companies/customers/deals: admin INSERT (with check is_admin()) が成立する', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'companies/customers/deals: admin INSERT (with check is_admin()) が成立する', false,
              'FAIL: INSERT が完了したが返却 id が空');
  end if;

  -- UPDATE
  update companies set notes = 'admin updated' where id = v_company_id;
  update customers set notes = 'admin updated' where id = v_customer_id;
  update deals set notes = 'admin updated' where id = v_deal_id;
  insert into crm_test_log(section, check_name, passed, detail)
    values ('②admin', 'companies/customers/deals: UPDATE 可', true, 'OK');

  -- DELETE は権限自体が revoke されている (permission denied) — companies/customers/deals 共通
  begin
    delete from companies where id = v_company_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'companies: DELETE は permission denied (revoke) を期待', false, 'FAIL: 削除できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'companies: DELETE は permission denied (revoke) を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'companies: DELETE は permission denied (revoke) を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    delete from customers where id = v_customer_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'customers: DELETE は permission denied (revoke) を期待', false, 'FAIL: 削除できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'customers: DELETE は permission denied (revoke) を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'customers: DELETE は permission denied (revoke) を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    delete from deals where id = v_deal_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'deals: DELETE は permission denied (revoke) を期待', false, 'FAIL: 削除できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'deals: DELETE は permission denied (revoke) を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'deals: DELETE は permission denied (revoke) を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'companies/customers/deals ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_activity_id uuid;
  v_note_id uuid;
  v_rows int;
  v_admin_note_id uuid;
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: UPDATE/DELETE は note 限定', true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;
  select id into v_activity_id from crm_test_fixture where key = 'activity'; -- activity_type='note'

  -- 比較用に non-note (system) の activity を service で用意
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into activities (activity_type, occurred_at, title, body, payload)
    values ('system', now(), '__crm_test__ system活動', null, '{"code":"crm_test.marker","detail":null}'::jsonb)
    returning id into v_note_id; -- 変数名は使い回すが中身は non-note の id
  insert into crm_test_fixture(key, id) values ('activity_system', v_note_id);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- INSERT (note, with check is_admin() を裏取り — §11.3 要求。現状は service_role フィクスチャ
  -- 経由の行しか無く、admin 自身の INSERT with check が通ることを未検証だった)
  insert into activities (activity_type, occurred_at, title, body)
    values ('note', now(), '__crm_test__ admin insertメモ', '本文')
    returning id into v_admin_note_id;
  if v_admin_note_id is not null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: admin INSERT (note, with check is_admin()) が成立する', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: admin INSERT (note, with check is_admin()) が成立する', false,
              'FAIL: INSERT が完了したが返却 id が空');
  end if;

  -- note の UPDATE は成立する (1 行更新)
  update activities set body = 'admin edited note' where id = v_activity_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: note の UPDATE は成立する', true, 'OK: 1 行更新');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: note の UPDATE は成立する', false, format('FAIL: 更新行数=%s', v_rows));
  end if;

  -- non-note (system) の UPDATE は RLS で 0 行 (エラーにはならない)
  update activities set body = 'admin tried to edit system' where id = v_note_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: non-note (system) の UPDATE は 0 行 (RLS フィルタ)', true, 'OK: 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: non-note (system) の UPDATE は 0 行 (RLS フィルタ)', false,
              format('FAIL: 更新行数=%s (拒否されるべき)', v_rows));
  end if;

  -- non-note (system) の DELETE も 0 行
  delete from activities where id = v_note_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: non-note (system) の DELETE は 0 行 (RLS フィルタ)', true, 'OK: 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities: non-note (system) の DELETE は 0 行 (RLS フィルタ)', false,
              format('FAIL: 削除行数=%s (拒否されるべき)', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activities ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_customer_id uuid;
  v_company_id uuid;
  v_activity_note_id uuid;
  v_activity_system_id uuid;
  v_link_note_id uuid;
  v_link_system_id uuid;
  v_admin_link_id uuid;
  v_rows int;
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: DELETE は note リンクのみ・UPDATE は revoke', true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;
  select id into v_customer_id from crm_test_fixture where key = 'customer';
  select id into v_company_id from crm_test_fixture where key = 'company';
  select id into v_activity_note_id from crm_test_fixture where key = 'activity';
  select id into v_activity_system_id from crm_test_fixture where key = 'activity_system';

  -- リンク 2 行 (note 側 / system 側) を service で用意
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into activity_links (activity_id, customer_id) values (v_activity_note_id, v_customer_id)
    returning id into v_link_note_id;
  insert into activity_links (activity_id, customer_id) values (v_activity_system_id, v_customer_id)
    returning id into v_link_system_id;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- INSERT (with check is_admin() を裏取り — §11.3 要求。現状は service_role フィクスチャ
  -- 経由の行しか無く、admin 自身の INSERT with check が通ることを未検証だった。company_id 側
  -- ターゲットを使い、既存の customer_id 側リンク (activity_links_customer_uniq) と衝突させない)
  insert into activity_links (activity_id, company_id) values (v_activity_note_id, v_company_id)
    returning id into v_admin_link_id;
  if v_admin_link_id is not null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: admin INSERT (with check is_admin()) が成立する', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: admin INSERT (with check is_admin()) が成立する', false,
              'FAIL: INSERT が完了したが返却 id が空');
  end if;

  -- UPDATE は table 権限が revoke されているため permission denied
  begin
    update activity_links set deal_id = null where id = v_link_note_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: UPDATE は permission denied (revoke) を期待', false, 'FAIL: 更新できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'activity_links: UPDATE は permission denied (revoke) を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('②admin', 'activity_links: UPDATE は permission denied (revoke) を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  -- DELETE: note にリンクした行は削除できる
  delete from activity_links where id = v_link_note_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: note リンクの DELETE は成立する', true, 'OK: 1 行削除');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: note リンクの DELETE は成立する', false, format('FAIL: 削除行数=%s', v_rows));
  end if;

  -- DELETE: system (non-note) にリンクした行は 0 行 (RLS フィルタ)
  delete from activity_links where id = v_link_system_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: non-note リンクの DELETE は 0 行 (RLS フィルタ)', true, 'OK: 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links: non-note リンクの DELETE は 0 行 (RLS フィルタ)', false,
              format('FAIL: 削除行数=%s (拒否されるべき)', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'activity_links ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_task_id uuid;
  v_rows int;
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'tasks: 全権 (SELECT/INSERT/UPDATE/DELETE)', true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  insert into tasks (title, origin) values ('__crm_test__ admin タスク', 'manual') returning id into v_task_id;
  update tasks set body = 'admin edited' where id = v_task_id;
  delete from tasks where id = v_task_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'tasks: INSERT/UPDATE/DELETE すべて成立する', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'tasks: INSERT/UPDATE/DELETE すべて成立する', false, format('FAIL: DELETE 行数=%s', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②admin', 'tasks ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ③ RLS: service_role は bypass (admin では拒否される non-note の activities/activity_links
--    UPDATE/DELETE も、service では成立することを確認する)
-- =========================================================
do $$
declare
  v_customer_id uuid;
  v_sys_activity_id uuid;
  v_rows int;
begin
  select id into v_customer_id from crm_test_fixture where key = 'customer';
  select id into v_sys_activity_id from crm_test_fixture where key = 'activity_system';
  if v_sys_activity_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③service bypass', 'service: non-note activities の UPDATE/DELETE が成立する', true,
              'SKIPPED: activity_system フィクスチャが無い (② admin ブロックが SKIPPED だった場合)');
    return;
  end if;

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update activities set body = 'service bypass edit' where id = v_sys_activity_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③service bypass', 'service: non-note activities の UPDATE が成立する (bypass)', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③service bypass', 'service: non-note activities の UPDATE が成立する (bypass)', false,
              format('FAIL: 更新行数=%s', v_rows));
  end if;

  delete from activities where id = v_sys_activity_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③service bypass', 'service: non-note activities の DELETE が成立する (bypass)', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③service bypass', 'service: non-note activities の DELETE が成立する (bypass)', false,
              format('FAIL: 削除行数=%s', v_rows));
  end if;

  -- companies の DELETE も service なら revoke の影響を受けず成立する (bypass はカラム grant にも及ぶ)
  declare
    v_tmp_company_id uuid;
  begin
    insert into companies (name) values ('__crm_test__ service専用削除') returning id into v_tmp_company_id;
    delete from companies where id = v_tmp_company_id;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('③service bypass', 'service: companies の DELETE (revoke対象) も成立する (bypass)', true, 'OK');
    else
      insert into crm_test_log(section, check_name, passed, detail)
        values ('③service bypass', 'service: companies の DELETE (revoke対象) も成立する (bypass)', false,
                format('FAIL: 削除行数=%s', v_rows));
    end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③service bypass', 'service bypass ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ crm_merge_customers RPC (§6.4)
-- =========================================================

-- ④-1 anon: EXECUTE 権限が無い (revoke all on function ... from public, anon)
do $$
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform public.crm_merge_customers(gen_random_uuid(), gen_random_uuid(), now());
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', 'anon: permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('④merge RPC', 'anon: permission denied を期待', true, 'OK: 42501');
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('④merge RPC', 'anon: permission denied を期待', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ④-2 非 admin authenticated: is_admin() ガードで拒否 ('permission denied: ... requires admin')
do $$
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
    perform public.crm_merge_customers(gen_random_uuid(), gen_random_uuid(), now());
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '非admin authenticated: internal permission denied を期待', false,
              'FAIL: 非admin が実行できてしまった');
  exception
    when others then
      if sqlerrm like '%requires admin%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', '非admin authenticated: internal permission denied を期待', true,
                  format('OK: %s', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', '非admin authenticated: internal permission denied を期待', false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ④-3 自己マージ E608
do $$
declare
  v_admin_id uuid;
  v_customer_id uuid;
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  select id into v_customer_id from crm_test_fixture where key = 'customer';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '自己マージ (winner=loser) → KMB-E608 を期待', true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
    perform public.crm_merge_customers(v_customer_id, v_customer_id, now());
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '自己マージ (winner=loser) → KMB-E608 を期待', false, 'FAIL: 例外にならず実行できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E608%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', '自己マージ (winner=loser) → KMB-E608 を期待', true, format('OK: %s', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', '自己マージ (winner=loser) → KMB-E608 を期待', false,
                  format('FAIL: 想定外のエラー (E608 を含まない): %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '自己マージブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- ④-4 CAS 不一致 E103
do $$
declare
  v_admin_id uuid;
  v_winner_id uuid;
  v_loser_id uuid;
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', 'CAS 不一致 (expected_winner_updated_at 誤り) → KMB-E103 を期待', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into customers (kind, name, lifecycle, source) values ('person', '__crm_test__ CAS勝者', 'lead', 'manual')
    returning id into v_winner_id;
  insert into customers (kind, name, lifecycle, source) values ('person', '__crm_test__ CAS敗者', 'lead', 'manual')
    returning id into v_loser_id;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
    -- わざと過去の (誤った) updated_at を渡す
    perform public.crm_merge_customers(v_winner_id, v_loser_id, now() - interval '1 hour');
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', 'CAS 不一致 (expected_winner_updated_at 誤り) → KMB-E103 を期待', false,
              'FAIL: 例外にならず実行できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E103%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', 'CAS 不一致 (expected_winner_updated_at 誤り) → KMB-E103 を期待', true,
                  format('OK: %s', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', 'CAS 不一致 (expected_winner_updated_at 誤り) → KMB-E103 を期待', false,
                  format('FAIL: 想定外のエラー (E103 を含まない): %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', 'CAS 不一致ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- ④-5 正常系 + リンク衝突削除 + lifecycle 再評価 + 敗者 archived 化 + マージ済み再マージ E608
do $$
declare
  v_admin_id uuid;
  v_winner_id uuid;
  v_loser_id uuid;
  v_winner_updated_at timestamptz;
  v_deal_id uuid;
  v_task_id uuid;
  v_shared_activity_id uuid;
  v_loser_only_activity_id uuid;
  v_winner_link_id uuid;
  v_loser_link_shared_id uuid;
  v_loser_link_only_id uuid;
  v_after customers%rowtype;
  v_deal_after deals%rowtype;
  v_task_after tasks%rowtype;
  v_link_count int;
  v_ok boolean := true;
  v_detail text := '';
begin
  select id into v_admin_id from crm_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '正常系: 付替+補完+lifecycle再評価+敗者archived', true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;

  -- フィクスチャ: winner(lead, email なし) / loser(customer, email あり) を用意し、
  -- loser 配下に deal(非 won)/task/activity_link(勝者側にも同一activityの既存リンクあり=衝突)/
  -- activity_link(勝者側に無い方=単純付替) を用意する
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into customers (kind, name, email, lifecycle, source)
    values ('person', '__crm_test__ マージ勝者', null, 'lead', 'manual')
    returning id, updated_at into v_winner_id, v_winner_updated_at;
  insert into customers (kind, name, email, lifecycle, source)
    values ('person', '__crm_test__ マージ敗者', 'loser-only@example.com', 'customer', 'manual')
    returning id into v_loser_id;

  insert into deals (title, customer_id, stage, source) values ('__crm_test__ 敗者配下の案件', v_loser_id, 'inquiry', 'manual')
    returning id into v_deal_id;
  insert into tasks (title, customer_id, origin) values ('__crm_test__ 敗者配下のタスク', v_loser_id, 'manual')
    returning id into v_task_id;

  insert into activities (activity_type, occurred_at, title) values ('note', now(), '__crm_test__ 共有活動')
    returning id into v_shared_activity_id;
  insert into activities (activity_type, occurred_at, title) values ('note', now(), '__crm_test__ 敗者専用活動')
    returning id into v_loser_only_activity_id;

  -- 衝突ケース: 勝者・敗者の両方が同じ activity にリンク済み → マージ後は敗者側リンクを削除
  insert into activity_links (activity_id, customer_id) values (v_shared_activity_id, v_winner_id)
    returning id into v_winner_link_id;
  insert into activity_links (activity_id, customer_id) values (v_shared_activity_id, v_loser_id)
    returning id into v_loser_link_shared_id;
  -- 単純付替ケース: 敗者のみがリンクしている activity → 勝者へ付け替え
  insert into activity_links (activity_id, customer_id) values (v_loser_only_activity_id, v_loser_id)
    returning id into v_loser_link_only_id;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
  perform public.crm_merge_customers(v_winner_id, v_loser_id, v_winner_updated_at);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 検証は service で読む (RLS の影響を受けない生の状態を見るため)
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select * into v_after from customers where id = v_winner_id;
  select * into v_deal_after from deals where id = v_deal_id;
  select * into v_task_after from tasks where id = v_task_id;

  if v_deal_after.customer_id <> v_winner_id then
    v_ok := false; v_detail := v_detail || 'deal 付替失敗; ';
  end if;
  if v_task_after.customer_id <> v_winner_id then
    v_ok := false; v_detail := v_detail || 'task 付替失敗; ';
  end if;
  if v_after.email <> 'loser-only@example.com' then
    v_ok := false; v_detail := v_detail || format('email 補完失敗 (got=%s); ', v_after.email);
  end if;
  -- lifecycle 再評価: 敗者が customer だったため lead→customer に昇格するはず
  if v_after.lifecycle <> 'customer' then
    v_ok := false; v_detail := v_detail || format('lifecycle 再評価失敗 (got=%s); ', v_after.lifecycle);
  end if;

  select count(*) into v_link_count from activity_links where activity_id = v_shared_activity_id;
  if v_link_count <> 1 then
    v_ok := false; v_detail := v_detail || format('衝突リンクの削除失敗 (残存件数=%s、期待=1); ', v_link_count);
  else
    select count(*) into v_link_count from activity_links
      where activity_id = v_shared_activity_id and customer_id = v_winner_id;
    if v_link_count <> 1 then
      v_ok := false; v_detail := v_detail || '衝突リンクが勝者側で残っていない; ';
    end if;
  end if;

  select count(*) into v_link_count from activity_links
    where activity_id = v_loser_only_activity_id and customer_id = v_winner_id;
  if v_link_count <> 1 then
    v_ok := false; v_detail := v_detail || format('単純付替リンクの失敗 (件数=%s); ', v_link_count);
  end if;

  declare
    v_loser_after customers%rowtype;
  begin
    select * into v_loser_after from customers where id = v_loser_id;
    if v_loser_after.lifecycle <> 'archived' or v_loser_after.merged_into_customer_id <> v_winner_id then
      v_ok := false; v_detail := v_detail || format('敗者 archived 化失敗 (lifecycle=%s, merged_into=%s); ',
        v_loser_after.lifecycle, v_loser_after.merged_into_customer_id);
    end if;
  end;

  if v_ok then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '正常系: 付替+補完+lifecycle再評価+衝突リンク削除+敗者archived', true, 'OK: 全項目一致');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '正常系: 付替+補完+lifecycle再評価+衝突リンク削除+敗者archived', false, format('FAIL: %s', v_detail));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- マージ済み再マージ E608 (敗者を今度は winner 側にして再度マージを試みる)
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
    perform public.crm_merge_customers(v_loser_id, v_winner_id, v_winner_updated_at);
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', 'マージ済み顧客の再マージ → KMB-E608 を期待', false, 'FAIL: 例外にならず実行できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E608%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', 'マージ済み顧客の再マージ → KMB-E608 を期待', true, format('OK: %s', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('④merge RPC', 'マージ済み顧客の再マージ → KMB-E608 を期待', false,
                  format('FAIL: 想定外のエラー (E608 を含まない): %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④merge RPC', '正常系ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑤ deals 終端ステージ不変トリガ (KMB-E602)
-- =========================================================
do $$
declare
  v_deal_id uuid;
  v_customer_id uuid;
begin
  select id into v_customer_id from crm_test_fixture where key = 'customer';

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into deals (title, customer_id, stage, source) values ('__crm_test__ 終端トリガ用', v_customer_id, 'inquiry', 'manual')
    returning id into v_deal_id;
  update deals set stage = 'paid' where id = v_deal_id; -- 終端到達 (lost_reason 不要な終端)
  reset role;
  perform set_config('request.jwt.claims', '', true);

  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update deals set stage = 'estimating' where id = v_deal_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑤終端ステージ', 'paid → estimating への変更は KMB-E602 で拒否される', false,
              'FAIL: 例外にならず変更できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E602%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('⑤終端ステージ', 'paid → estimating への変更は KMB-E602 で拒否される', true, format('OK: %s', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('⑤終端ステージ', 'paid → estimating への変更は KMB-E602 で拒否される', false,
                  format('FAIL: 想定外のエラー (E602 を含まない): %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- from===to (paid→paid) は noop として許可される (is distinct from が false になり trigger 内 if を通らない)
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update deals set stage = 'paid' where id = v_deal_id;
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑤終端ステージ', 'paid → paid (noop) は許可される', true, 'OK: 例外にならず更新できた');
  exception
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑤終端ステージ', 'paid → paid (noop) は許可される', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑤終端ステージ', '終端ステージブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑥ 冪等一意 index (非部分・WHERE 無し) の on_conflict 動作 + NULLS DISTINCT
--    (§2.2 冒頭「冪等 index の設計原則」 — 部分一意にすると 42P10 になる、が本旨。
--     ここでは非部分一意で正しく on_conflict が機能すること、および NULL キー行同士は
--     衝突しないことを確認する)
-- =========================================================
do $$
declare
  v_inquiry_id uuid;
  v_deal_1 uuid;
  v_deal_2 uuid;
  v_rows int;
begin
  select id into v_inquiry_id from crm_test_fixture where key = 'inquiry';
  select id into v_deal_1 from crm_test_fixture where key = 'deal'; -- 既存 (source_inquiry_id は NULL)

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- deals_source_inquiry_uniq (非部分一意): 同一 source_inquiry_id の 2 回目 INSERT は
  -- on conflict do nothing で 0 行、既存行 SELECT で回収できる
  insert into deals (title, customer_id, source, source_inquiry_id)
    select '__crm_test__ 取込1回目', c.id, 'form', v_inquiry_id
    from crm_test_fixture c where c.key = 'customer'
    on conflict (source_inquiry_id) do nothing
    returning id into v_deal_2;
  if v_deal_2 is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'deals_source_inquiry_uniq: 1 回目 INSERT が成立すること (前提)', false, 'FAIL: 1 回目から 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'deals_source_inquiry_uniq: 1 回目 INSERT が成立すること (前提)', true, 'OK');

    insert into deals (title, customer_id, source, source_inquiry_id)
      select '__crm_test__ 取込2回目 (同一inquiry)', c.id, 'form', v_inquiry_id
      from crm_test_fixture c where c.key = 'customer'
      on conflict (source_inquiry_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'deals_source_inquiry_uniq: 2 回目 (同一 inquiry) は on_conflict で 0 行 (42P10 にならない)', true,
                'OK: 0 行 (非部分一意で正しく機能)');
    else
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'deals_source_inquiry_uniq: 2 回目 (同一 inquiry) は on_conflict で 0 行 (42P10 にならない)', false,
                format('FAIL: 挿入行数=%s (重複挿入されてしまった)', v_rows));
    end if;

    -- 既存行 SELECT で回収できること
    select count(*) into v_rows from deals where source_inquiry_id = v_inquiry_id;
    if v_rows = 1 then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'deals_source_inquiry_uniq: 既存行 SELECT で 1 件回収できる', true, 'OK');
    else
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'deals_source_inquiry_uniq: 既存行 SELECT で 1 件回収できる', false, format('FAIL: 件数=%s', v_rows));
    end if;
  end if;

  -- NULLS DISTINCT: source_inquiry_id が NULL の deal は何度 INSERT しても衝突しない
  insert into deals (title, customer_id, source, source_inquiry_id)
    select '__crm_test__ 手動案件1', c.id, 'manual', null from crm_test_fixture c where c.key = 'customer'
    on conflict (source_inquiry_id) do nothing;
  insert into deals (title, customer_id, source, source_inquiry_id)
    select '__crm_test__ 手動案件2', c.id, 'manual', null from crm_test_fixture c where c.key = 'customer'
    on conflict (source_inquiry_id) do nothing;
  select count(*) into v_rows from deals where title in ('__crm_test__ 手動案件1', '__crm_test__ 手動案件2');
  if v_rows = 2 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'deals_source_inquiry_uniq: source_inquiry_id が NULL の行同士は衝突しない (NULLS DISTINCT)', true,
              'OK: 2 行とも挿入できた');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'deals_source_inquiry_uniq: source_inquiry_id が NULL の行同士は衝突しない (NULLS DISTINCT)', false,
              format('FAIL: 挿入できた行数=%s (期待=2)', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'deals_source_inquiry_uniq ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_activity_id_1 uuid;
  v_activity_id_2 uuid;
  v_rows int;
  v_note_marker uuid := gen_random_uuid();
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- activities_ref_idem_uniq (activity_type, ref_table, ref_id): 同一キーの 2 回目は on_conflict で 0 行
  insert into activities (activity_type, occurred_at, title, ref_table, ref_id)
    values ('form_submission', now(), '__crm_test__ 冪等1回目', 'contact_inquiries', v_note_marker)
    on conflict (activity_type, ref_table, ref_id) do nothing
    returning id into v_activity_id_1;
  if v_activity_id_1 is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activities_ref_idem_uniq: 1 回目 INSERT が成立すること (前提)', false, 'FAIL: 1 回目から 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activities_ref_idem_uniq: 1 回目 INSERT が成立すること (前提)', true, 'OK');

    insert into activities (activity_type, occurred_at, title, ref_table, ref_id)
      values ('form_submission', now(), '__crm_test__ 冪等2回目', 'contact_inquiries', v_note_marker)
      on conflict (activity_type, ref_table, ref_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'activities_ref_idem_uniq: 同一 (type,ref_table,ref_id) の 2 回目は 0 行', true, 'OK');
    else
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'activities_ref_idem_uniq: 同一 (type,ref_table,ref_id) の 2 回目は 0 行', false,
                format('FAIL: 挿入行数=%s', v_rows));
    end if;
  end if;

  -- ref_id が NULL (note 等) は重複挿入可
  insert into activities (activity_type, occurred_at, title) values ('note', now(), '__crm_test__ note重複1')
    returning id into v_activity_id_1;
  insert into activities (activity_type, occurred_at, title) values ('note', now(), '__crm_test__ note重複2')
    returning id into v_activity_id_2;
  if v_activity_id_1 is not null and v_activity_id_2 is not null and v_activity_id_1 <> v_activity_id_2 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activities_ref_idem_uniq: ref_id が NULL の note は重複挿入可 (NULLS DISTINCT)', true,
              'OK: 2 行とも挿入できた');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activities_ref_idem_uniq: ref_id が NULL の note は重複挿入可 (NULLS DISTINCT)', false,
              'FAIL: 2 行目が挿入できなかった');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activities_ref_idem_uniq ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_task_id_1 uuid;
  v_rows int;
  v_source_activity_id uuid;
begin
  select id into v_source_activity_id from crm_test_fixture where key = 'activity';

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- tasks_source_activity_title_key (source_activity_id, title)
  insert into tasks (title, origin, source_activity_id)
    values ('__crm_test__ AI起票タスク', 'ai_call', v_source_activity_id)
    on conflict (source_activity_id, title) do nothing
    returning id into v_task_id_1;
  if v_task_id_1 is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'tasks_source_activity_title_key: 1 回目 INSERT が成立すること (前提)', false, 'FAIL: 1 回目から 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'tasks_source_activity_title_key: 1 回目 INSERT が成立すること (前提)', true, 'OK');

    insert into tasks (title, origin, source_activity_id)
      values ('__crm_test__ AI起票タスク', 'ai_call', v_source_activity_id)
      on conflict (source_activity_id, title) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'tasks_source_activity_title_key: 同一 (source_activity_id,title) の 2 回目は 0 行', true, 'OK');
    else
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'tasks_source_activity_title_key: 同一 (source_activity_id,title) の 2 回目は 0 行', false,
                format('FAIL: 挿入行数=%s', v_rows));
    end if;
  end if;

  -- source_activity_id が NULL (手動タスク) は同題でも重複挿入可
  insert into tasks (title, origin, source_activity_id) values ('__crm_test__ 手動同題', 'manual', null);
  insert into tasks (title, origin, source_activity_id) values ('__crm_test__ 手動同題', 'manual', null);
  select count(*) into v_rows from tasks where title = '__crm_test__ 手動同題';
  if v_rows = 2 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'tasks_source_activity_title_key: source_activity_id が NULL の同題は重複挿入可', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'tasks_source_activity_title_key: source_activity_id が NULL の同題は重複挿入可', false,
              format('FAIL: 挿入できた行数=%s (期待=2)', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'tasks_source_activity_title_key ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_activity_id uuid;
  v_customer_id uuid;
  v_link_id uuid;
  v_rows int;
begin
  select id into v_customer_id from crm_test_fixture where key = 'customer';

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into activities (activity_type, occurred_at, title) values ('note', now(), '__crm_test__ リンク冪等用')
    returning id into v_activity_id;

  -- activity_links_customer_uniq (customer_id, activity_id)
  insert into activity_links (activity_id, customer_id) values (v_activity_id, v_customer_id)
    on conflict (customer_id, activity_id) do nothing
    returning id into v_link_id;
  if v_link_id is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activity_links_customer_uniq: 1 回目 INSERT が成立すること (前提)', false, 'FAIL: 1 回目から 0 行');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activity_links_customer_uniq: 1 回目 INSERT が成立すること (前提)', true, 'OK');

    insert into activity_links (activity_id, customer_id) values (v_activity_id, v_customer_id)
      on conflict (customer_id, activity_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'activity_links_customer_uniq: 同一 (customer_id,activity_id) の 2 回目は 0 行', true, 'OK');
    else
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑥冪等index', 'activity_links_customer_uniq: 同一 (customer_id,activity_id) の 2 回目は 0 行', false,
                format('FAIL: 挿入行数=%s', v_rows));
    end if;
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑥冪等index', 'activity_links_customer_uniq ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑦ activities_ref_pair check 制約 (§2.2: constraint activities_ref_pair
--    check ((ref_table is null) = (ref_id is null)))。RLS では防げない DB CHECK
--    自体の境界検証。service_role (RLS bypass) 配下でも ref_table/ref_id の
--    片側のみ非 NULL の INSERT は 23514 (check_violation) で拒否されることを確認する
--    (tests/crm-activity-payloads.test.ts の該当ケースコメントが本ブロックの結果を前提にする)
-- =========================================================
do $$
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (a) ref_table のみ非 NULL・ref_id が NULL
  begin
    insert into activities (activity_type, occurred_at, title, ref_table, ref_id)
      values ('note', now(), '__crm_test__ ref_pair違反a', 'contact_inquiries', null);
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑦activities_ref_pair', 'ref_table のみ非NULL・ref_id が NULL は check_violation を期待', false,
              'FAIL: 例外にならず挿入できてしまった');
  exception
    when check_violation then
      if sqlerrm like '%activities_ref_pair%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('⑦activities_ref_pair', 'ref_table のみ非NULL・ref_id が NULL は check_violation を期待', true,
                  format('OK: 23514 (%s)', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('⑦activities_ref_pair', 'ref_table のみ非NULL・ref_id が NULL は check_violation を期待', false,
                  format('FAIL: check_violation だが activities_ref_pair 由来ではない: %s', sqlerrm));
      end if;
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑦activities_ref_pair', 'ref_table のみ非NULL・ref_id が NULL は check_violation を期待', false,
                format('FAIL: 想定外のエラー (23514 以外): %s', sqlerrm));
  end;

  -- (b) ref_id のみ非 NULL・ref_table が NULL
  begin
    insert into activities (activity_type, occurred_at, title, ref_table, ref_id)
      values ('note', now(), '__crm_test__ ref_pair違反b', null, gen_random_uuid());
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑦activities_ref_pair', 'ref_id のみ非NULL・ref_table が NULL は check_violation を期待', false,
              'FAIL: 例外にならず挿入できてしまった');
  exception
    when check_violation then
      if sqlerrm like '%activities_ref_pair%' then
        insert into crm_test_log(section, check_name, passed, detail)
          values ('⑦activities_ref_pair', 'ref_id のみ非NULL・ref_table が NULL は check_violation を期待', true,
                  format('OK: 23514 (%s)', sqlerrm));
      else
        insert into crm_test_log(section, check_name, passed, detail)
          values ('⑦activities_ref_pair', 'ref_id のみ非NULL・ref_table が NULL は check_violation を期待', false,
                  format('FAIL: check_violation だが activities_ref_pair 由来ではない: %s', sqlerrm));
      end if;
    when others then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('⑦activities_ref_pair', 'ref_id のみ非NULL・ref_table が NULL は check_violation を期待', false,
                format('FAIL: 想定外のエラー (23514 以外): %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('⑦activities_ref_pair', 'activities_ref_pair ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、上記の書き込みは
-- すべて破棄される。実行者は以下の SELECT 結果で passed=false の行が無いことを確認する)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from crm_test_log;
  raise notice '=== crm RLS/RPC/トリガ/冪等index 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from crm_test_log
order by id;

rollback;
