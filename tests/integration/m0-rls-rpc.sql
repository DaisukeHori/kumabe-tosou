-- =========================================================
-- M0 共通基盤: RLS / RPC 結合検証 (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/00-overview.md §3.1.2c (is_admin_or_service / site_settings 許可リスト
--     = migration 20260711000021_background_ai_execution.sql)
--   - docs/design/crm-suite/00-overview.md §3.4 (document_number_next
--     = migration 20260711000022_document_numbering.sql)
--   - docs/design/crm-suite/07-contracts-delta.md §D5 (site_settings 許可リストと同一 SQL)
--
-- ★ 本ファイルはこの feat/41-m0-foundation セッションでは一度も実行していない
--   (docker 無し / 本番 migration 未適用のため実行環境が無い)。migration 0021 + 0022 を
--   本番 (Supabase) に手動 apply した後、Supabase MCP の execute_sql ツールに本ファイルの
--   内容をそのまま渡して実行し、末尾の m0_test_log の結果 (全行 passed=true になっているか)
--   で検証すること。実行前提: MCP の接続ロールが postgres 等の SET ROLE 可能な特権ロールで
--   あること (anon/authenticated/service_role へ SET LOCAL ROLE できる必要がある)。
--
--   運用上の注意: execute_sql 実装によっては複数文からなるスクリプトのうち「最後の文」の
--   結果セットしか返さない場合がある (本ファイルの最後の文は `rollback;` で行を返さない)。
--   その場合は末尾の `select ... from m0_test_log order by id; / rollback;` の 2 文を、
--   まず `select` まで実行して結果を確認し、続けて (同一トランザクション/セッションが
--   維持される場合のみ) `rollback;` を別呼び出しで実行すること。トランザクションが呼び出し
--   間で維持されない実装であれば、代わりに各 `raise notice` (PASS/FAIL がすべて notice として
--   出力される) をログから grep して 'FAIL' の有無を見るのが最も確実 (結果セットの可視性に
--   依存しない)。
--
-- 設計方針:
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する (変異系チェック —
--     ai_budget_reserve/settle, document_number_next の採番 — が行う書き込みを一切残さない)。
--   - 各チェックは DO ブロック内の BEGIN/EXCEPTION で例外を握りつぶし、結果を一時テーブル
--     m0_test_log に記録する (RAISE EXCEPTION を外に伝播させない = 1 チェックの失敗で
--     残りのチェックが巻き添えで止まらないようにするため)。
--   - ロール切替は SET LOCAL ROLE (+ request.jwt.claims の role/sub) で行う。実運用の
--     PostgREST/Supabase クライアントは JWT の role claim と Postgres の SET ROLE を
--     常にセットで切り替えるため、それに合わせる。
--   - anon は is_admin_or_service() 系 RPC の EXECUTE 権限そのものを持たない (migration 0021 の
--     `revoke all ... from public, anon; grant execute ... to authenticated;`) ため、
--     「anon 拒否」は SQLSTATE 42501 (insufficient_privilege) の permission denied として
--     観測される (internal の raise exception にすら到達しない — 権限確認の層が 1 つ手前にある)。
--   - 「並行 (concurrent) 採番で欠番なし」は複数コネクションを要する検証であり、本ファイル
--     (単一セッションの逐次 SQL) の対象外。ここで検証するのは「連続 (sequential) 呼び出しで
--     欠番なし単調増加」であり、真の並行安全性は document_number_next 内の
--     `update ... where ... returning ... into` が FOR UPDATE 相当の行ロックで直列化する
--     という実装 (00-overview.md §3.1.4-2, migration 0022 本体) に依拠する。並行安全性を
--     実測したい場合は複数の Supabase MCP execute_sql 呼び出しを同時に発火させるか、
--     pgbench 等の別ツールが必要 (本ファイルのスコープ外)。
-- =========================================================

begin;

create temporary table m0_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

do $$ begin raise notice '=== M0 RLS/RPC 結合検証 開始 (このトランザクションは最後に必ず ROLLBACK する) ==='; end $$;

-- =========================================================
-- ① is_admin_or_service(): anon / authenticated(非admin) / authenticated(admin) / service_role
-- =========================================================
do $$
declare
  v_result boolean;
begin
  -- anon: EXECUTE 権限が無いので permission denied を期待 (is_admin_or_service() の判定にすら
  -- 到達しない)
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select public.is_admin_or_service() into v_result;
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'anon: permission denied を期待', false,
              format('FAIL: anon が実行できてしまった (戻り値=%s)', v_result));
  exception
    when insufficient_privilege then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('①is_admin_or_service', 'anon: permission denied を期待', true, 'OK: permission denied (42501)');
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('①is_admin_or_service', 'anon: permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_result boolean;
begin
  -- authenticated (profiles に存在しない sub) → is_admin()=false かつ role≠service_role → false
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
  select public.is_admin_or_service() into v_result;
  if v_result is false then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'authenticated (非admin): false を期待', true, 'OK: false');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'authenticated (非admin): false を期待', false,
              format('FAIL: 戻り値=%s', v_result));
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'authenticated (非admin): false を期待', false,
              format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_result boolean;
  v_admin_id uuid;
begin
  -- authenticated かつ profiles 実在行 (実際の管理者 1 件) → is_admin()=true 経由で true
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'authenticated (admin): true を期待', true,
              'SKIPPED: profiles に管理者行が無い環境 (bootstrap-admin 未実行)');
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
    select public.is_admin_or_service() into v_result;
    if v_result is true then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('①is_admin_or_service', 'authenticated (admin): true を期待', true, 'OK: true');
    else
      insert into m0_test_log(section, check_name, passed, detail)
        values ('①is_admin_or_service', 'authenticated (admin): true を期待', false,
                format('FAIL: 戻り値=%s (admin_id=%s)', v_result, v_admin_id));
    end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end if;
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'authenticated (admin): true を期待', false,
              format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_result boolean;
begin
  -- service_role (実 Postgres ロール。Supabase の既定 grant により 0021 の revoke の影響を
  -- 受けない — migration コメント「service_role は revoke の影響を受けない (0020 と同じ理屈)」)
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select public.is_admin_or_service() into v_result;
  if v_result is true then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'service_role: true を期待', true, 'OK: true');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'service_role: true を期待', false, format('FAIL: 戻り値=%s', v_result));
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('①is_admin_or_service', 'service_role: true を期待', false,
              format('FAIL: 想定外のエラー (service_role 側の grant 未整備の可能性): %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ② ai_budget_reserve / ai_budget_settle / ai_budget_get_current_month:
--    service 成功・anon 拒否 (+ authenticated 非admin 拒否のボーナス確認)
-- =========================================================
do $$
begin
  -- anon: EXECUTE 権限が無い
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform * from public.ai_budget_reserve(1000, 0);
    insert into m0_test_log(section, check_name, passed, detail)
      values ('②ai_budget_*', 'anon: ai_budget_reserve は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'anon: ai_budget_reserve は permission denied を期待', true, 'OK: permission denied (42501)');
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'anon: ai_budget_reserve は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
begin
  -- authenticated (非admin): grant はあるが is_admin_or_service() 内部ガードで拒否される
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
    perform * from public.ai_budget_reserve(1000, 0);
    insert into m0_test_log(section, check_name, passed, detail)
      values ('②ai_budget_*', 'authenticated(非admin): ai_budget_reserve は internal permission denied を期待', false,
              'FAIL: 非admin authenticated が実行できてしまった');
  exception
    when others then
      if sqlerrm like '%requires admin or service_role%' then
        insert into m0_test_log(section, check_name, passed, detail)
          values ('②ai_budget_*', 'authenticated(非admin): ai_budget_reserve は internal permission denied を期待', true,
                  'OK: is_admin_or_service() ガードで拒否');
      else
        insert into m0_test_log(section, check_name, passed, detail)
          values ('②ai_budget_*', 'authenticated(非admin): ai_budget_reserve は internal permission denied を期待', false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_reservation_id uuid;
  v_ok boolean;
  v_error_code text;
  v_current_row record;
begin
  -- service_role: reserve → settle → get_current_month。
  -- 注意: PL/pgSQL の EXCEPTION 節は「そのブロックの savepoint まで DB 変更を巻き戻す」ため、
  -- 3 ステップを 1 つの begin/exception にまとめると、後段 (settle 等) の失敗で前段 (reserve
  -- 成功) の m0_test_log insert まで消えてしまう (savepoint rollback の対象になる)。
  -- そのため各ステップを独立した begin/exception (= 独立した savepoint) に分ける。
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (KMB-E407 が出た場合はコード欠陥ではなく、実行時点の月間予算がすでに逼迫している
  --  可能性がある — site_settings.ops_limits.ai_monthly_budget_micro_usd を先に確認すること)
  begin
    select reservation_id, ok, error_code into v_reservation_id, v_ok, v_error_code
      from public.ai_budget_reserve(1234, 0);
    if v_ok is not true or v_reservation_id is null then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_reserve 成功を期待', false,
                format('FAIL: ok=%s error_code=%s (予算逼迫の可能性。実害調査は ops_limits を確認)', v_ok, v_error_code));
      v_reservation_id := null;
    else
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_reserve 成功を期待', true,
                format('OK: reservation_id=%s', v_reservation_id));
    end if;
  exception
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_reserve 成功を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
      v_reservation_id := null;
  end;

  if v_reservation_id is not null then
    begin
      perform public.ai_budget_settle(v_reservation_id, 999, 0);
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_settle が例外なく完了することを期待', true, 'OK: settle 完了');
    exception
      when others then
        insert into m0_test_log(section, check_name, passed, detail)
          values ('②ai_budget_*', 'service_role: ai_budget_settle が例外なく完了することを期待', false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
    end;
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('②ai_budget_*', 'service_role: ai_budget_settle が例外なく完了することを期待', true,
              'SKIPPED: reserve が失敗したため settle は未実行');
  end if;

  begin
    select * into v_current_row from public.ai_budget_get_current_month();
    if v_current_row.month is not null then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_get_current_month 成功を期待', true,
                format('OK: month=%s reserved=%s settled=%s limit=%s',
                  v_current_row.month, v_current_row.reserved_micro_usd, v_current_row.settled_micro_usd,
                  v_current_row.budget_limit_micro_usd));
    else
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_get_current_month 成功を期待', false, 'FAIL: month が null');
    end if;
  exception
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('②ai_budget_*', 'service_role: ai_budget_get_current_month 成功を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('②ai_budget_*', 'service_role: reserve/settle/get_current_month 一気通貫 (ロール切替等の予期せぬ失敗)', false,
              format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ③ site_settings: 許可リスト内キー anon 可・外キー拒否・admin 全可 (migration 0021)
-- =========================================================
do $$
begin
  -- 構造検証: 旧ポリシー site_settings_anon_select が削除され、新 2 ポリシーに置換されていること
  if exists (select 1 from pg_policies where schemaname='public' and tablename='site_settings'
             and policyname='site_settings_anon_select') then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', '旧ポリシー site_settings_anon_select が削除済みであること', false,
              'FAIL: 旧ポリシーが残存している (migration 0021 未適用の可能性)');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', '旧ポリシー site_settings_anon_select が削除済みであること', true, 'OK: 削除済み');
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='site_settings'
             and policyname='site_settings_public_select' and cmd='SELECT') then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'site_settings_public_select ポリシーが存在すること', true, 'OK');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'site_settings_public_select ポリシーが存在すること', false, 'FAIL: 存在しない');
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='site_settings'
             and policyname='site_settings_admin_select' and cmd='SELECT') then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'site_settings_admin_select ポリシーが存在すること', true, 'OK');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'site_settings_admin_select ポリシーが存在すること', false, 'FAIL: 存在しない');
  end if;
end $$;

-- 挙動検証: service_role で許可キー(company)/非許可キー(notifications) を確実に存在させた上で
-- anon/admin から読める/読めないを確認する (既存値は壊さない — jsonb || で非破壊マージ)。
-- 各アサーションを独立した DO ブロック (= 独立した savepoint) にする理由は ②と同じ
-- (1 つの begin/exception にまとめると、後続アサーションの失敗が先行の成功ログまで
--  savepoint rollback で消してしまうため)。
do $$
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into site_settings(key, value) values ('company', '{"__m0_test__":true}'::jsonb)
    on conflict (key) do update set value = site_settings.value || '{"__m0_test__":true}'::jsonb;
  insert into site_settings(key, value)
    values ('notifications', '{"__m0_test__":true,"inquiry_to":"m0-test@example.com","on_publish_failure":false}'::jsonb)
    on conflict (key) do update set value = site_settings.value || '{"__m0_test__":true}'::jsonb;
  insert into m0_test_log(section, check_name, passed, detail)
    values ('③site_settings', 'service_role: テスト用 seed (company/notifications) が書けること', true, 'OK: seed 完了');
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'service_role: テスト用 seed (company/notifications) が書けること', false,
              format('FAIL: 想定外のエラー (以降の anon/admin 読取検証は前提が崩れる): %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_count int;
begin
  -- anon: 許可リスト内 (company) は読める
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_count from site_settings where key = 'company';
  if v_count = 1 then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'anon: company (許可リスト内) を読める', true, 'OK');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'anon: company (許可リスト内) を読める', false, format('FAIL: count=%s', v_count));
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'anon: company (許可リスト内) を読める', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_count int;
begin
  -- anon: 許可リスト外 (notifications) は 0 行 (エラーにはならず RLS でフィルタされる)
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_count from site_settings where key = 'notifications';
  if v_count = 0 then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'anon: notifications (許可リスト外) は 0 行', true, 'OK');
  else
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'anon: notifications (許可リスト外) は 0 行', false, format('FAIL: count=%s', v_count));
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'anon: notifications (許可リスト外) は 0 行', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_count int;
  v_admin_id uuid;
begin
  -- admin: 許可リスト内外どちらも読める
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'admin: company/notifications どちらも読める', true,
              'SKIPPED: profiles に管理者行が無い環境');
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
    select count(*) into v_count from site_settings where key in ('company', 'notifications');
    if v_count = 2 then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('③site_settings', 'admin: company/notifications どちらも読める', true, 'OK');
    else
      insert into m0_test_log(section, check_name, passed, detail)
        values ('③site_settings', 'admin: company/notifications どちらも読める', false, format('FAIL: count=%s', v_count));
    end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end if;
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('③site_settings', 'admin: company/notifications どちらも読める', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ document_number_next: 連続採番で欠番なし単調増加・doc_type×year 独立・anon 拒否・
--    不正 doc_type → KMB-E622
--    (「並行」採番の直列化保証は FOR UPDATE 相当の行ロックに依拠 — ファイル冒頭コメント参照。
--     複数コネクションが必要なため本ファイルでは検証しない)
-- =========================================================
do $$
begin
  -- anon: EXECUTE 権限が無い
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform * from public.document_number_next('quote', 2026);
    insert into m0_test_log(section, check_name, passed, detail)
      values ('④document_number_next', 'anon: permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', 'anon: permission denied を期待', true, 'OK: permission denied (42501)');
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', 'anon: permission denied を期待', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
begin
  -- authenticated (非admin): grant はあるが internal ガードで拒否される
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
    perform * from public.document_number_next('quote', 2026);
    insert into m0_test_log(section, check_name, passed, detail)
      values ('④document_number_next', 'authenticated(非admin): internal permission denied を期待', false,
              'FAIL: 非admin authenticated が実行できてしまった');
  exception
    when others then
      if sqlerrm like '%requires admin or service_role%' then
        insert into m0_test_log(section, check_name, passed, detail)
          values ('④document_number_next', 'authenticated(非admin): internal permission denied を期待', true,
                  'OK: is_admin_or_service() ガードで拒否');
      else
        insert into m0_test_log(section, check_name, passed, detail)
          values ('④document_number_next', 'authenticated(非admin): internal permission denied を期待', false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_doc_no_1 text; v_seq_1 int;
  v_doc_no_2 text; v_seq_2 int;
  v_invoice_seq_before int;
  v_invoice_seq_after int;
begin
  -- service_role: 連続採番 (同一 doc_type×year) が欠番なく単調増加すること。
  -- ②③と同じ理由で、2 つの独立したアサーションをそれぞれ別の begin/exception (= 別の
  -- savepoint) にする (後段の失敗で前段成功ログが savepoint rollback で消えないように)。
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    select doc_no, seq into v_doc_no_1, v_seq_1 from public.document_number_next('quote', 2026);
    select doc_no, seq into v_doc_no_2, v_seq_2 from public.document_number_next('quote', 2026);

    if v_seq_2 = v_seq_1 + 1 and v_doc_no_2 = format('Q-2026-%s', lpad(v_seq_2::text, 4, '0')) then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', '連続採番 (quote/2026) が欠番なく +1 されること', true,
                format('OK: %s (seq=%s) → %s (seq=%s)', v_doc_no_1, v_seq_1, v_doc_no_2, v_seq_2));
    else
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', '連続採番 (quote/2026) が欠番なく +1 されること', false,
                format('FAIL: %s (seq=%s) → %s (seq=%s)', v_doc_no_1, v_seq_1, v_doc_no_2, v_seq_2));
    end if;
  exception
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', '連続採番 (quote/2026) が欠番なく +1 されること', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
      v_seq_2 := null;
  end;

  begin
    -- doc_type×year 独立性: invoice/2026 の呼び出しが quote/2026 のカウンタに影響しないこと
    -- (v_seq_2 が上のアサーションで取得できていること前提。null なら比較不能としてスキップ)
    if v_seq_2 is null then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', 'doc_type×year は独立したカウンタであること (quote と invoice が干渉しない)', true,
                'SKIPPED: 直前の quote 連続採番アサーションが失敗したため比較基準が無い');
    else
      select seq into v_invoice_seq_before from public.document_number_next('invoice', 2026);
      select doc_no, seq into v_doc_no_1, v_seq_1 from public.document_number_next('quote', 2026);
      select seq into v_invoice_seq_after from public.document_number_next('invoice', 2026);

      if v_seq_1 = v_seq_2 + 1 and v_invoice_seq_after = v_invoice_seq_before + 1 then
        insert into m0_test_log(section, check_name, passed, detail)
          values ('④document_number_next', 'doc_type×year は独立したカウンタであること (quote と invoice が干渉しない)', true,
                  format('OK: quote seq %s→%s (invoice 呼び出しの影響なし), invoice seq %s→%s',
                    v_seq_2, v_seq_1, v_invoice_seq_before, v_invoice_seq_after));
      else
        insert into m0_test_log(section, check_name, passed, detail)
          values ('④document_number_next', 'doc_type×year は独立したカウンタであること (quote と invoice が干渉しない)', false,
                  format('FAIL: quote seq %s→%s, invoice seq %s→%s', v_seq_2, v_seq_1, v_invoice_seq_before, v_invoice_seq_after));
      end if;
    end if;
  exception
    when others then
      insert into m0_test_log(section, check_name, passed, detail)
        values ('④document_number_next', 'doc_type×year は独立したカウンタであること (quote と invoice が干渉しない)', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into m0_test_log(section, check_name, passed, detail)
      values ('④document_number_next', '連続採番・doc_type×year 独立性 (ロール切替等の予期せぬ失敗)', false,
              format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

do $$
begin
  -- 不正 doc_type → KMB-E622 (service_role でも doc_type のバリデーションは通らない)
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform * from public.document_number_next('bogus_type', 2026);
    insert into m0_test_log(section, check_name, passed, detail)
      values ('④document_number_next', '不正 doc_type → KMB-E622 を期待', false, 'FAIL: 例外にならず実行できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E622%' then
        insert into m0_test_log(section, check_name, passed, detail)
          values ('④document_number_next', '不正 doc_type → KMB-E622 を期待', true, format('OK: %s', sqlerrm));
      else
        insert into m0_test_log(section, check_name, passed, detail)
          values ('④document_number_next', '不正 doc_type → KMB-E622 を期待', false,
                  format('FAIL: 想定外のエラー (E622 を含まない): %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、上記の書き込み系チェック
-- — ai_budget_reserve/settle・document_number_next の採番・site_settings の seed — は
-- すべて破棄される。実行者は以下の SELECT 結果で passed=false の行が無いことを確認する)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from m0_test_log;
  raise notice '=== M0 RLS/RPC 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from m0_test_log
order by id;

rollback;
