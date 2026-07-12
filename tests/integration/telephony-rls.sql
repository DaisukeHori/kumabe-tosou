-- =========================================================
-- telephony (#56): calls / call_recordings / call_jobs RLS (列限定 UPDATE 含む) +
--                   call-audio Storage バケットポリシー + site_settings
--                   (business_hours/telephony) の service ctx 読取 結合検証
-- (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/04-telephony.md §2.2 (migration 20260711000032_telephony_core.sql 全文)
--   - docs/design/crm-suite/04-telephony.md §4.2 (RLS 認可総表 — calls の列限定 UPDATE 含む)
--   - docs/design/crm-suite/04-telephony.md §4.3 (Storage call-audio バケット。ポリシー無し=service専用)
--   - docs/design/crm-suite/07-contracts-delta.md §D5 (site_settings business_hours/telephony キー、
--     anon 可読キー許可リストは migration 20260711000021_background_ai_execution.sql)
--   - docs/design/crm-suite/07-contracts-delta.md §D8 (SettingsFacade.get(key, ctx?) の service ctx)
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / 本番未適用のため
--   実行環境が無い)。migration 20260711000023_crm_core.sql (customers — calls.customer_id の FK 先)
--   および本 Issue の migration 20260711000032_telephony_core.sql を本番 (Supabase) に手動 apply
--   した後、Supabase MCP の execute_sql ツールに本ファイルの内容をそのまま渡して実行し、
--   末尾の telephony_test_log の結果 (全行 passed=true。SKIPPED は許容) で検証すること。
--   実行前提・運用上の注意点は tests/integration/m0-rls-rpc.sql / crm-rls-merge.sql の
--   冒頭コメントと同じ (SET ROLE 可能な特権ロール接続が必要、複数文の結果セット可視性の
--   実装差異、トランザクション非維持時は raise notice を FAIL で grep する代替手段)。
--
--   storage.objects の列構成 (id/bucket_id/name/owner/metadata 等) は Supabase の内部実装に
--   依存するため、⑧ の service_role INSERT チェックは実行前に対象 Supabase プロジェクトの
--   実スキーマ (`select column_name, is_nullable, column_default from information_schema.columns
--   where table_schema='storage' and table_name='objects'`) と突き合わせ、必須列が変わっていない
--   ことを確認してから実行すること。
--
-- 設計方針 (m0-rls-rpc.sql / crm-rls-merge.sql の確立パターンを踏襲):
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。フィクスチャ (calls/
--     call_recordings/call_jobs/site_settings への INSERT) は一切残さない。
--   - 各チェックは DO ブロック内の BEGIN/EXCEPTION で例外を握りつぶし、結果を一時テーブル
--     telephony_test_log に記録する (1 チェックの失敗で残りのチェックが巻き添えで止まらないように)。
--   - ロール切替は SET LOCAL ROLE (+ request.jwt.claims の role/sub) で行う。
--   - フィクスチャ作成 (calls/call_recordings/call_jobs/site_settings の baseline 行) は
--     service_role で行う (RLS を bypass しないと作れないため — INSERT ポリシーが無い設計)。
--     これは「フィクスチャ準備の迂回」であり、以降の各セクションで実際に検証する anon/admin の
--     RLS 挙動そのものは service_role を経由せず、対象ロールへ SET LOCAL ROLE した状態で
--     直接 SQL を実行して確認する (service_role フィクスチャで検証自体を迂回しない)。
--   - admin ロールのテストは実在の profiles 行 (is_admin() が参照) を使う。実在の管理者行が
--     無い環境では該当チェックを SKIPPED として記録する (確立パターンと同じ扱い)。
-- =========================================================

begin;

create temporary table telephony_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

do $$ begin raise notice '=== telephony RLS/Storage/settings 結合検証 開始 (このトランザクションは最後に必ず ROLLBACK する) ==='; end $$;

create temporary table telephony_test_fixture (
  key text primary key,
  id uuid not null
);

-- =========================================================
-- ① フィクスチャ準備 (service_role — RLS bypass) + admin sub 決定
-- =========================================================
do $$
declare
  v_call_id uuid;
  v_recording_id uuid;
  v_job_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into calls (call_sid, direction, from_e164, from_raw, to_e164, twilio_status)
    values ('__telephony_test__CA0000000000000000000000000000001', 'inbound', '+819011112222', '+819011112222',
            '+81501234567', 'ringing')
    returning id into v_call_id;

  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_test__RE00000000000000000000000000001', 'dial',
            'https://api.twilio.com/__telephony_test__/rec1.wav', 30, 2)
    returning id into v_recording_id;

  insert into call_jobs (call_id, recording_id, status)
    values (v_call_id, v_recording_id, 'pending')
    returning id into v_job_id;

  insert into telephony_test_fixture(key, id) values
    ('call', v_call_id),
    ('recording', v_recording_id),
    ('job', v_job_id);

  insert into telephony_test_log(section, check_name, passed, detail)
    values ('①fixture', 'service_role: calls/call_recordings/call_jobs 各 1 行が作れること', true,
            format('OK: call=%s recording=%s job=%s', v_call_id, v_recording_id, v_job_id));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('①fixture', 'service_role: calls/call_recordings/call_jobs 各 1 行が作れること', false,
              format('FAIL: 想定外のエラー (以降の多くのチェックが前提を欠く): %s', sqlerrm));
    reset role;
end $$;

-- site_settings の business_hours/telephony フィクスチャ (既存値は壊さない — on conflict do nothing)
do $$
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into site_settings(key, value) values (
    'business_hours',
    '{"mon":{"open":"09:00","close":"18:00"},"tue":{"open":"09:00","close":"18:00"},
      "wed":{"open":"09:00","close":"18:00"},"thu":{"open":"09:00","close":"18:00"},
      "fri":{"open":"09:00","close":"18:00"},"sat":null,"sun":null,"holidays":[]}'::jsonb
  ) on conflict (key) do nothing;

  insert into site_settings(key, value) values (
    'telephony',
    '{"phone_number_e164":null,"twilio_number_sid":null,"forward_to_e164":null,
      "consent_announcement_enabled":true,"consent_announcement_text":null,
      "in_hours_greeting_text":null,"after_hours_greeting_text":null,
      "voicemail_max_seconds":120,"delete_twilio_recording_after_download":true,
      "max_processing_minutes":30}'::jsonb
  ) on conflict (key) do nothing;

  insert into telephony_test_log(section, check_name, passed, detail)
    values ('①fixture', 'service_role: site_settings (business_hours/telephony) が存在すること (非破壊 on conflict do nothing)',
            true, 'OK');

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('①fixture', 'service_role: site_settings (business_hours/telephony) が存在すること', false,
              format('FAIL: 想定外のエラー (⑨ の一部が前提を欠く): %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('①fixture', 'admin sub の決定 (profiles 実在行)', true,
              'SKIPPED: profiles に管理者行が無い環境 (bootstrap-admin 未実行) — admin セルの検証は以降すべて SKIPPED になる');
  else
    insert into telephony_test_fixture(key, id) values ('admin', v_admin_id)
      on conflict (key) do update set id = excluded.id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('①fixture', 'admin sub の決定 (profiles 実在行)', true, format('OK: admin_id=%s', v_admin_id));
  end if;
end $$;

-- =========================================================
-- ② 構造検証 (静的): RLS ポリシー存在 + 列限定 grant の列集合 + call-audio バケット/ポリシー
-- =========================================================
do $$
declare
  v_policy text;
  v_expected text[] := array['calls_admin_select', 'calls_admin_update',
                              'call_recordings_admin_select', 'call_jobs_admin_select'];
begin
  foreach v_policy in array v_expected loop
    if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('calls', 'call_recordings', 'call_jobs') and policyname = v_policy) then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('②構造', format('ポリシー %s が存在すること', v_policy), true, 'OK');
    else
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('②構造', format('ポリシー %s が存在すること', v_policy), false, 'FAIL: 存在しない');
    end if;
  end loop;

  -- INSERT/DELETE ポリシーが calls/call_recordings/call_jobs のいずれにも存在しないこと
  -- (書込は service 専用 — RLS ポリシー自体が無い設計であることの裏取り)
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename in ('calls', 'call_recordings', 'call_jobs')
                 and cmd in ('INSERT', 'DELETE')) then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'calls/call_recordings/call_jobs に INSERT/DELETE ポリシーが 1 つも存在しないこと', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'calls/call_recordings/call_jobs に INSERT/DELETE ポリシーが 1 つも存在しないこと', false,
              'FAIL: 想定外の INSERT/DELETE ポリシーが存在する');
  end if;
end $$;

do $$
declare
  v_cols text;
begin
  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'calls' and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_cols = 'customer_id,match_status,memo' then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'calls: authenticated の UPDATE 列限定 grant が customer_id/match_status/memo の 3 列ちょうどであること',
              true, format('OK: %s', v_cols));
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'calls: authenticated の UPDATE 列限定 grant が customer_id/match_status/memo の 3 列ちょうどであること',
              false, format('FAIL: 実際の列集合=%s', coalesce(v_cols, '(なし)')));
  end if;
end $$;

do $$
declare
  v_has_anon boolean;
  v_has_calls_insert boolean;
  v_has_recordings_update boolean;
  v_has_jobs_update boolean;
begin
  select exists(select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name in ('calls', 'call_recordings', 'call_jobs') and grantee = 'anon')
    into v_has_anon;
  select exists(select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'calls' and grantee = 'authenticated' and privilege_type = 'INSERT')
    into v_has_calls_insert;
  select exists(select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'call_recordings' and grantee = 'authenticated' and privilege_type = 'UPDATE')
    into v_has_recordings_update;
  select exists(select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'call_jobs' and grantee = 'authenticated' and privilege_type = 'UPDATE')
    into v_has_jobs_update;

  if not v_has_anon then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'anon は calls/call_recordings/call_jobs に一切 grant を持たないこと (明示 revoke 済み)', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'anon は calls/call_recordings/call_jobs に一切 grant を持たないこと (明示 revoke 済み)', false,
              'FAIL: anon に何らかの grant が残存している');
  end if;

  if not v_has_calls_insert and not v_has_recordings_update and not v_has_jobs_update then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'authenticated は calls への INSERT / call_recordings・call_jobs への UPDATE grant を持たないこと', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'authenticated は calls への INSERT / call_recordings・call_jobs への UPDATE grant を持たないこと', false,
              format('FAIL: calls.INSERT=%s call_recordings.UPDATE=%s call_jobs.UPDATE=%s',
                v_has_calls_insert, v_has_recordings_update, v_has_jobs_update));
  end if;
end $$;

do $$
declare
  v_public boolean;
  v_policy_count int;
begin
  select public into v_public from storage.buckets where id = 'call-audio';
  if v_public is false then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'call-audio バケットが存在し public=false であること', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'call-audio バケットが存在し public=false であること', false,
              format('FAIL: public=%s (バケット自体が無い場合は null)', v_public));
  end if;

  -- 公開バケット列挙の教訓 (0006) により call-audio 用のポリシーは意図的に一切作らない
  -- (backups バケット — migration 20260708000006 — と同型の判断)。qual/with_check の
  -- テキストに 'call-audio' を含むポリシーが 1 件も無いことを確認する。
  select count(*) into v_policy_count from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%call-audio%' or coalesce(with_check, '') like '%call-audio%');
  if v_policy_count = 0 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'storage.objects に call-audio を参照するポリシーが 1 件も存在しないこと (意図的な設計)', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'storage.objects に call-audio を参照するポリシーが 1 件も存在しないこと (意図的な設計)', false,
              format('FAIL: %s 件の call-audio 参照ポリシーが存在する (0006 の教訓に反する)', v_policy_count));
  end if;
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('②構造', 'call-audio バケット/ポリシー構造検証 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
end $$;

-- =========================================================
-- ③ RLS: anon は calls/call_recordings/call_jobs の全操作を拒否される (grant 自体が無いため
--    insufficient_privilege (42501) として観測される — RLS フィルタより手前の層)
-- =========================================================
do $$
declare
  v_call_id uuid;
  v_tbl text;
begin
  select id into v_call_id from telephony_test_fixture where key = 'call';

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  for v_tbl in select unnest(array['calls', 'call_recordings', 'call_jobs'])
  loop
    begin
      execute format('select count(*) from %I', v_tbl);
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('③anon拒否', format('anon: SELECT %s は permission denied を期待', v_tbl), false,
                'FAIL: anon が SELECT できてしまった');
    exception
      when insufficient_privilege then
        insert into telephony_test_log(section, check_name, passed, detail)
          values ('③anon拒否', format('anon: SELECT %s は permission denied を期待', v_tbl), true, 'OK: 42501');
      when others then
        insert into telephony_test_log(section, check_name, passed, detail)
          values ('③anon拒否', format('anon: SELECT %s は permission denied を期待', v_tbl), false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
    end;
  end loop;

  begin
    update calls set memo = 'anon tried' where id = v_call_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('③anon拒否', 'anon: UPDATE calls (許可列 memo でも) は permission denied を期待', false,
              'FAIL: 更新できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('③anon拒否', 'anon: UPDATE calls (許可列 memo でも) は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('③anon拒否', 'anon: UPDATE calls (許可列 memo でも) は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    insert into calls (call_sid, to_e164) values ('__telephony_test__anon_insert', '+81501234567');
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('③anon拒否', 'anon: INSERT calls は permission denied を期待', false, 'FAIL: 挿入できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('③anon拒否', 'anon: INSERT calls は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('③anon拒否', 'anon: INSERT calls は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('③anon拒否', 'anon 拒否ブロック全体 (ロール切替等の予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ RLS: admin (authenticated) — calls SELECT 可・列限定 UPDATE 可 (3 列)・非許可列 UPDATE 拒否・
--    INSERT 拒否・DELETE 拒否
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_call_id uuid;
  v_rows int;
begin
  select id into v_admin_id from telephony_test_fixture where key = 'admin';
  select id into v_call_id from telephony_test_fixture where key = 'call';
  if v_admin_id is null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'calls: SELECT可・列限定UPDATE可・非許可列UPDATE拒否・INSERT/DELETE拒否', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- SELECT
  select count(*) into v_rows from calls where id = v_call_id;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: SELECT 可', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: SELECT 可', false, format('FAIL: count=%s', v_rows));
  end if;

  -- 列限定 UPDATE (許可 3 列)
  update calls set customer_id = null, match_status = 'manual', memo = '__telephony_test__ admin memo'
    where id = v_call_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: 許可 3 列 (customer_id/match_status/memo) の UPDATE が成立する', true, 'OK: 1 行更新');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: 許可 3 列 (customer_id/match_status/memo) の UPDATE が成立する', false,
              format('FAIL: 更新行数=%s', v_rows));
  end if;

  -- 非許可列 (handling) の UPDATE は列レベル grant により permission denied
  begin
    update calls set handling = 'missed' where id = v_call_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: 非許可列 (handling) の UPDATE は permission denied (列 grant 無し) を期待', false,
              'FAIL: 更新できてしまった (列レベル grant が機能していない — 最重要地雷)');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('④admin/calls', 'admin: 非許可列 (handling) の UPDATE は permission denied (列 grant 無し) を期待', true,
                'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('④admin/calls', 'admin: 非許可列 (handling) の UPDATE は permission denied (列 grant 無し) を期待', false,
                format('FAIL: 想定外のエラー (42501 以外): %s', sqlerrm));
  end;

  -- INSERT (grant 自体が無い)
  begin
    insert into calls (call_sid, to_e164) values ('__telephony_test__admin_insert', '+81501234567');
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: INSERT calls は permission denied (grant 無し) を期待', false,
              'FAIL: 挿入できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('④admin/calls', 'admin: INSERT calls は permission denied (grant 無し) を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('④admin/calls', 'admin: INSERT calls は permission denied (grant 無し) を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  -- DELETE (grant 自体が無い)
  begin
    delete from calls where id = v_call_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'admin: DELETE calls は permission denied (grant 無し) を期待', false,
              'FAIL: 削除できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('④admin/calls', 'admin: DELETE calls は permission denied (grant 無し) を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('④admin/calls', 'admin: DELETE calls は permission denied (grant 無し) を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('④admin/calls', 'calls admin ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑤ RLS: admin (authenticated) — call_recordings SELECT可・INSERT/UPDATE/DELETE拒否
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_recording_id uuid;
  v_call_id uuid;
  v_rows int;
begin
  select id into v_admin_id from telephony_test_fixture where key = 'admin';
  select id into v_recording_id from telephony_test_fixture where key = 'recording';
  select id into v_call_id from telephony_test_fixture where key = 'call';
  if v_admin_id is null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'call_recordings: SELECT可・INSERT/UPDATE/DELETE拒否', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select count(*) into v_rows from call_recordings where id = v_recording_id;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'admin: SELECT 可', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'admin: SELECT 可', false, format('FAIL: count=%s', v_rows));
  end if;

  begin
    insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
      values (v_call_id, '__telephony_test__admin_insert', 'voicemail', 'https://x/y.wav', 10, 1);
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'admin: INSERT call_recordings は permission denied を期待', false,
              'FAIL: 挿入できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑤admin/recordings', 'admin: INSERT call_recordings は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑤admin/recordings', 'admin: INSERT call_recordings は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    update call_recordings set storage_path = '__telephony_test__/x.wav' where id = v_recording_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'admin: UPDATE call_recordings は permission denied を期待', false,
              'FAIL: 更新できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑤admin/recordings', 'admin: UPDATE call_recordings は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑤admin/recordings', 'admin: UPDATE call_recordings は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    delete from call_recordings where id = v_recording_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'admin: DELETE call_recordings は permission denied を期待', false,
              'FAIL: 削除できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑤admin/recordings', 'admin: DELETE call_recordings は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑤admin/recordings', 'admin: DELETE call_recordings は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑤admin/recordings', 'call_recordings admin ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑥ RLS: admin (authenticated) — call_jobs SELECT可・INSERT/UPDATE/DELETE拒否
--    (書込は service (worker) と security definer RPC のみ — RPC 自体は #57 の migration 0033)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_job_id uuid;
  v_call_id uuid;
  v_recording_id uuid;
  v_rows int;
begin
  select id into v_admin_id from telephony_test_fixture where key = 'admin';
  select id into v_job_id from telephony_test_fixture where key = 'job';
  select id into v_call_id from telephony_test_fixture where key = 'call';
  select id into v_recording_id from telephony_test_fixture where key = 'recording';
  if v_admin_id is null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'call_jobs: SELECT可・INSERT/UPDATE/DELETE拒否', true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select count(*) into v_rows from call_jobs where id = v_job_id;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'admin: SELECT 可', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'admin: SELECT 可', false, format('FAIL: count=%s', v_rows));
  end if;

  begin
    insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_recording_id, 'pending');
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'admin: INSERT call_jobs は permission denied を期待', false, 'FAIL: 挿入できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑥admin/jobs', 'admin: INSERT call_jobs は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑥admin/jobs', 'admin: INSERT call_jobs は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    update call_jobs set status = 'failed' where id = v_job_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'admin: UPDATE call_jobs は permission denied を期待 (lease/commit は RPC 専用)', false,
              'FAIL: 更新できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑥admin/jobs', 'admin: UPDATE call_jobs は permission denied を期待 (lease/commit は RPC 専用)', true,
                'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑥admin/jobs', 'admin: UPDATE call_jobs は permission denied を期待 (lease/commit は RPC 専用)', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  begin
    delete from call_jobs where id = v_job_id;
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'admin: DELETE call_jobs は permission denied を期待', false, 'FAIL: 削除できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑥admin/jobs', 'admin: DELETE call_jobs は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑥admin/jobs', 'admin: DELETE call_jobs は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑥admin/jobs', 'call_jobs admin ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑦ RLS: service_role は calls/call_recordings/call_jobs の全操作が成立する (bypass。
--    admin では拒否される非許可列 UPDATE (handling) や INSERT/DELETE も、service では成立する)
-- =========================================================
do $$
declare
  v_call_id uuid;
  v_recording_id uuid;
  v_job_id uuid;
  v_rows int;
begin
  select id into v_call_id from telephony_test_fixture where key = 'call';
  select id into v_recording_id from telephony_test_fixture where key = 'recording';
  select id into v_job_id from telephony_test_fixture where key = 'job';

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- admin では拒否された非許可列 (handling/twilio_status) の UPDATE も service なら成立する
  update calls set handling = 'voicemail', twilio_status = 'completed' where id = v_call_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service: calls の非許可列 (handling/twilio_status) UPDATE も成立する (bypass)', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service: calls の非許可列 (handling/twilio_status) UPDATE も成立する (bypass)', false,
              format('FAIL: 更新行数=%s', v_rows));
  end if;

  update call_jobs set status = 'downloading' where id = v_job_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service: call_jobs の UPDATE (RPC 専用列含む) が成立する (bypass)', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service: call_jobs の UPDATE (RPC 専用列含む) が成立する (bypass)', false,
              format('FAIL: 更新行数=%s', v_rows));
  end if;

  delete from call_jobs where id = v_job_id;
  delete from call_recordings where id = v_recording_id;
  delete from calls where id = v_call_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service: calls/call_recordings/call_jobs の DELETE (revoke対象) も成立する (bypass)', true,
              'OK: フィクスチャ後片付け完了');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service: calls/call_recordings/call_jobs の DELETE (revoke対象) も成立する (bypass)', false,
              format('FAIL: calls 削除行数=%s', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑦service bypass', 'service bypass ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;
-- (注: フィクスチャは ⑦ 末尾で service_role により削除済みだが、本トランザクション自体を
--  末尾で必ず ROLLBACK するため、削除しなかった場合でも本番データへの残置は発生しない)

-- =========================================================
-- ⑧ Storage: call-audio バケットは anon/authenticated からアクセス不可 (ポリシー無し)。
--    service_role は bypass でアクセス可能 (createRecordingPlaybackUrl の署名 URL 発行経路)
-- =========================================================
do $$
declare
  v_count int;
begin
  -- anon: SELECT はエラーにならず 0 行 (storage.objects 自体への基本 grant はあるが、
  -- call-audio を許可する RLS ポリシーが無いため全行フィルタされる想定)。
  -- 環境によっては storage.objects への基本 grant 自体が anon に無く permission denied に
  -- なる可能性もあるため、どちらの結果も「call-audio の中身が見えない」という意味で PASS とする。
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into v_count from storage.objects where bucket_id = 'call-audio';
    if v_count = 0 then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'anon: call-audio 配下のオブジェクトが見えないこと', true, 'OK: 0 行 (RLS フィルタ)');
    else
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'anon: call-audio 配下のオブジェクトが見えないこと', false,
                format('FAIL: %s 件見えてしまった (ポリシー漏れの可能性)', v_count));
    end if;
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'anon: call-audio 配下のオブジェクトが見えないこと', true, 'OK: permission denied (42501)');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'anon: call-audio 配下のオブジェクトが見えないこと', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'anon storage ブロック全体 (ロール切替等の予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_count int;
begin
  select id into v_admin_id from telephony_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'admin (authenticated): call-audio 配下のオブジェクトが見えないこと', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
  begin
    select count(*) into v_count from storage.objects where bucket_id = 'call-audio';
    if v_count = 0 then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'admin (authenticated): call-audio 配下のオブジェクトが見えないこと (直接アクセス不可。' ||
                '再生は createRecordingPlaybackUrl の署名 URL 経由のみ)', true, 'OK: 0 行 (RLS フィルタ)');
    else
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'admin (authenticated): call-audio 配下のオブジェクトが見えないこと', false,
                format('FAIL: %s 件見えてしまった (ポリシー漏れの可能性)', v_count));
    end if;
  exception
    when insufficient_privilege then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'admin (authenticated): call-audio 配下のオブジェクトが見えないこと', true,
                'OK: permission denied (42501)');
    when others then
      insert into telephony_test_log(section, check_name, passed, detail)
        values ('⑧storage', 'admin (authenticated): call-audio 配下のオブジェクトが見えないこと', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'admin storage ブロック全体 (ロール切替等の予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- service_role: bypass で call-audio へ書込/削除できること (実運用は録音 DL worker — #57/#58 —
-- が担うが、本 Issue の scope は「service なら書ける」という bypass の裏取りのみ)
do $$
declare
  v_object_id uuid;
  v_rows int;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into storage.objects (bucket_id, name) values ('call-audio', '__telephony_test__/dummy.wav')
    returning id into v_object_id;
  if v_object_id is not null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'service: call-audio への INSERT が成立する (bypass)', true, format('OK: id=%s', v_object_id));
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'service: call-audio への INSERT が成立する (bypass)', false, 'FAIL: 返却 id が空');
  end if;

  delete from storage.objects where id = v_object_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'service: call-audio の DELETE が成立する (bypass、後片付け)', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'service: call-audio の DELETE が成立する (bypass、後片付け)', false,
              format('FAIL: 削除行数=%s', v_rows));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    -- storage.objects の必須列/トリガがこのプロジェクトの実スキーマと異なる場合ここに来る。
    -- ファイル冒頭の注記どおり実行前に information_schema.columns を確認すること。
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑧storage', 'service: call-audio への INSERT/DELETE が成立する (bypass)', false,
              format('FAIL: 想定外のエラー (storage.objects の実スキーマ差異の可能性): %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑨ site_settings: business_hours (anon 可読) / telephony (anon 不可読・admin/service 可読)
--    — SettingsFacade.get(key, ctx) の service ctx 読取経路 (07-delta §D8) が DB レベルで
--    成立することの裏取り。business_hours は migration 0021 の anon 可読許可リストに含まれる、
--    telephony は含まれない (電話番号等の機微情報のため — §D5)。
-- =========================================================
do $$
declare
  v_count int;
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  select count(*) into v_count from site_settings where key = 'business_hours';
  if v_count = 1 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'anon: business_hours (許可リスト内) を読める', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'anon: business_hours (許可リスト内) を読める', false, format('FAIL: count=%s', v_count));
  end if;

  select count(*) into v_count from site_settings where key = 'telephony';
  if v_count = 0 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'anon: telephony (許可リスト外・機微情報) は 0 行', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'anon: telephony (許可リスト外・機微情報) は 0 行', false, format('FAIL: count=%s', v_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'anon ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_count int;
begin
  select id into v_admin_id from telephony_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'admin: business_hours/telephony どちらも読める (site_settings_admin_select)', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
  select count(*) into v_count from site_settings where key in ('business_hours', 'telephony');
  if v_count = 2 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'admin: business_hours/telephony どちらも読める (site_settings_admin_select)', true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'admin: business_hours/telephony どちらも読める (site_settings_admin_select)', false,
              format('FAIL: count=%s', v_count));
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'admin ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_count int;
begin
  -- service_role (SettingsFacade.get(key, {mode:'service'}) が実際に使うロール — RLS を
  -- bypass するため anon 可読リストの制約を受けず telephony/business_hours どちらも読める。
  -- voice webhook は anon 起点だが facade 内部は必ず service client を使う設計 — 04 §6.1 手順 3)
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_count from site_settings where key in ('business_hours', 'telephony');
  if v_count = 2 then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings',
              'service_role: business_hours/telephony どちらも読める (SettingsFacade.get(key, {mode:"service"}) の裏取り)',
              true, 'OK');
  else
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings',
              'service_role: business_hours/telephony どちらも読める (SettingsFacade.get(key, {mode:"service"}) の裏取り)',
              false, format('FAIL: count=%s', v_count));
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_test_log(section, check_name, passed, detail)
      values ('⑨site_settings', 'service_role ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、フィクスチャ (calls/
-- call_recordings/call_jobs/site_settings への INSERT) はすべて破棄される。実行者は
-- 以下の SELECT 結果で passed=false の行が無いことを確認する)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from telephony_test_log;
  raise notice '=== telephony RLS/Storage/settings 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from telephony_test_log
order by id;

rollback;
