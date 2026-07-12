-- =========================================================
-- telephony (#57): call_job_acquire_lease / call_job_commit_stage / call_job_retry
--                   の RLS/CAS 結合検証 (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/04-telephony.md §2.3 (migration 20260711000033_telephony_job_rpc.sql 全文)
--   - docs/design/crm-suite/04-telephony.md §5.1 (call_jobs 状態表)
--   - docs/design/crm-suite/00-overview.md §3.1.4 (複製規約8要件 — #variable_conflict use_column /
--     FOR UPDATE行ロック / attempts>=3失敗 / commit成功時のみattempts=0リセット 等)
--   - docs/design/crm-suite/00-overview.md §3.1.2c (is_admin_or_service — migration 0021)
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / 本番未適用のため
--   実行環境が無い)。migration 20260711000021_background_ai_execution.sql (is_admin_or_service) →
--   20260711000022 → 20260711000023 (customers) → 20260711000026 → 20260711000029/
--   20260711000032_telephony_core.sql (calls/call_recordings/call_jobs DDL) →
--   20260711000033_telephony_job_rpc.sql (本 Issue) の順で本番 (Supabase) に手動 apply した後、
--   Supabase MCP の execute_sql ツールに本ファイルの内容をそのまま渡して実行し、末尾の
--   telephony_job_rpc_test_log の結果 (全行 passed=true。SKIPPED は許容) で検証すること。
--   実行前提・運用上の注意点 (SET ROLE 可能な特権ロール接続が必要、複数文の結果セット可視性の
--   実装差異、トランザクション非維持時は raise notice を FAIL で grep する代替手段) は
--   tests/integration/m0-rls-rpc.sql / telephony-rls.sql の冒頭コメントと同じ。
--
-- 設計方針 (m0-rls-rpc.sql / telephony-rls.sql の確立パターンを踏襲):
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。フィクスチャ (calls/
--     call_recordings/call_jobs への INSERT、および RPC 経由の全 UPDATE) は一切残さない。
--   - 各チェックは DO ブロック内の BEGIN/EXCEPTION で例外を握りつぶし、結果を一時テーブル
--     telephony_job_rpc_test_log に記録する (1 チェックの失敗で残りのチェックが巻き添えで
--     止まらないように)。
--   - ロール切替は SET LOCAL ROLE (+ request.jwt.claims の role/sub) で行う。
--   - フィクスチャ作成 (calls/call_recordings/call_jobs の baseline 行) は service_role で行う
--     (INSERT ポリシーが無い設計のため)。これは「フィクスチャ準備の迂回」であり、以降の各
--     セクションで実際に検証する 3 RPC の権限/CAS 挙動そのものは service_role フィクスチャで
--     迂回せず、対象ロールへ SET LOCAL ROLE した状態で直接 RPC を呼んで確認する。
--   - anon は 3 RPC いずれも EXECUTE 権限そのものを持たない (migration 0033 の
--     `revoke all ... from public, anon; grant execute ... to authenticated;`) ため、
--     「anon 拒否」は SQLSTATE 42501 (insufficient_privilege) として観測される (RPC 内部の
--     is_admin_or_service() ガードにすら到達しない)。authenticated (非admin) は EXECUTE 権限は
--     あるため実際に関数本体が走り、内部ガードの `raise exception '...requires admin or
--     service_role'` (SQLSTATE 既定 P0001) で拒否される — m0-rls-rpc.sql §② と同じ区別。
--   - admin ロールのテストは実在の profiles 行 (is_admin() が参照) を使う。実在の管理者行が
--     無い環境では該当チェックを SKIPPED として記録する (確立パターンと同じ扱い)。
-- =========================================================

begin;

create temporary table telephony_job_rpc_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

do $$ begin raise notice '=== telephony call_job_* RPC 結合検証 開始 (このトランザクションは最後に必ず ROLLBACK する) ==='; end $$;

create temporary table telephony_job_rpc_fixture (
  key text primary key,
  id uuid not null
);

-- =========================================================
-- ① フィクスチャ準備 (service_role — RLS bypass) + admin sub 決定
--    各シナリオ用に call_jobs を個別に用意する:
--      job_pending    : 'pending' (acquire の bootstrap + held 検証用)
--      job_exhausted  : 'downloading', stage_attempts=3 (exhausted 検証用)
--      job_terminal   : 'done' (terminal 検証用)
--      job_commit_cas : 'downloading' (commit の CAS 一致/不一致/二重commit冪等検証用、別ジョブ)
--      job_failed     : 'failed', stage_attempts=2, error_code='KMB-E806' (retry 成功検証用)
--      job_done_retry : 'done' (retry の KMB-E807 検証用)
-- =========================================================
do $$
declare
  v_call_id uuid;
  v_rec_id uuid;
  v_job_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into calls (call_sid, direction, from_e164, from_raw, to_e164, twilio_status)
    values ('__telephony_job_rpc_test__CA00000000000000000000000001', 'inbound', '+819011112222',
            '+819011112222', '+81501234567', 'completed')
    returning id into v_call_id;
  insert into telephony_job_rpc_fixture(key, id) values ('call', v_call_id);

  -- job_pending
  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_job_rpc_test__RE_pending', 'voicemail',
            'https://api.twilio.com/__telephony_job_rpc_test__/pending.wav', 20, 1)
    returning id into v_rec_id;
  insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_rec_id, 'pending')
    returning id into v_job_id;
  insert into telephony_job_rpc_fixture(key, id) values ('job_pending', v_job_id);

  -- job_exhausted (stage_attempts を 3 まで先取りしておく — acquire の exhausted 分岐を誘発)
  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_job_rpc_test__RE_exhausted', 'voicemail',
            'https://api.twilio.com/__telephony_job_rpc_test__/exhausted.wav', 20, 1)
    returning id into v_rec_id;
  insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_rec_id, 'pending')
    returning id into v_job_id;
  update call_jobs set status = 'downloading', stage_attempts = 3, lease_expires_at = null where id = v_job_id;
  insert into telephony_job_rpc_fixture(key, id) values ('job_exhausted', v_job_id);

  -- job_terminal (既に done — acquire の terminal 分岐を誘発)
  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_job_rpc_test__RE_terminal', 'voicemail',
            'https://api.twilio.com/__telephony_job_rpc_test__/terminal.wav', 20, 1)
    returning id into v_rec_id;
  insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_rec_id, 'done')
    returning id into v_job_id;
  insert into telephony_job_rpc_fixture(key, id) values ('job_terminal', v_job_id);

  -- job_commit_cas ('downloading' — commit の CAS/二重commit検証用、acquire は経由しない)
  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_job_rpc_test__RE_commit_cas', 'voicemail',
            'https://api.twilio.com/__telephony_job_rpc_test__/commit_cas.wav', 20, 1)
    returning id into v_rec_id;
  insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_rec_id, 'pending')
    returning id into v_job_id;
  update call_jobs
    set status = 'downloading', stage_attempts = 1, lease_expires_at = now() + interval '90 seconds'
    where id = v_job_id;
  insert into telephony_job_rpc_fixture(key, id) values ('job_commit_cas', v_job_id);

  -- job_failed ('failed' — retry 成功 (failed→pending) 検証用)
  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_job_rpc_test__RE_failed', 'voicemail',
            'https://api.twilio.com/__telephony_job_rpc_test__/failed.wav', 20, 1)
    returning id into v_rec_id;
  insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_rec_id, 'pending')
    returning id into v_job_id;
  update call_jobs
    set status = 'failed', stage_attempts = 2, error_code = 'KMB-E806', lease_expires_at = null
    where id = v_job_id;
  insert into telephony_job_rpc_fixture(key, id) values ('job_failed', v_job_id);

  -- job_done_retry ('done' — retry の KMB-E807 (failed 以外への retry) 検証用)
  insert into call_recordings (call_id, recording_sid, source, twilio_url, duration_seconds, channels)
    values (v_call_id, '__telephony_job_rpc_test__RE_done_retry', 'voicemail',
            'https://api.twilio.com/__telephony_job_rpc_test__/done_retry.wav', 20, 1)
    returning id into v_rec_id;
  insert into call_jobs (call_id, recording_id, status) values (v_call_id, v_rec_id, 'done')
    returning id into v_job_id;
  insert into telephony_job_rpc_fixture(key, id) values ('job_done_retry', v_job_id);

  insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
    values ('①fixture', 'service_role: 6 シナリオ分の call_recordings/call_jobs が作れること', true, 'OK');

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('①fixture', 'service_role: フィクスチャ作成 (想定外のエラー、以降の多くのチェックが前提を欠く)',
              false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('①fixture', 'admin sub の決定 (profiles 実在行)', true,
              'SKIPPED: profiles に管理者行が無い環境 (bootstrap-admin 未実行) — admin セルの検証は以降すべて SKIPPED になる');
  else
    insert into telephony_job_rpc_fixture(key, id) values ('admin', v_admin_id)
      on conflict (key) do update set id = excluded.id;
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('①fixture', 'admin sub の決定 (profiles 実在行)', true, format('OK: admin_id=%s', v_admin_id));
  end if;
end $$;

-- =========================================================
-- ② call_job_acquire_lease: anon (EXECUTE権限無し) / authenticated(非admin、内部ガード) の拒否
-- =========================================================
do $$
declare
  v_job_id uuid;
begin
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_pending';

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform * from public.call_job_acquire_lease(v_job_id);
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('②acquire拒否', 'anon: call_job_acquire_lease は permission denied を期待', false,
              'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('②acquire拒否', 'anon: call_job_acquire_lease は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('②acquire拒否', 'anon: call_job_acquire_lease は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
  begin
    perform * from public.call_job_acquire_lease(v_job_id);
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('②acquire拒否', 'authenticated(非admin): call_job_acquire_lease は internal permission denied を期待',
              false, 'FAIL: 非admin authenticated が実行できてしまった');
  exception
    when others then
      if sqlerrm like '%requires admin or service_role%' then
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('②acquire拒否', 'authenticated(非admin): call_job_acquire_lease は internal permission denied を期待',
                  true, 'OK: is_admin_or_service() ガードで拒否');
      else
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('②acquire拒否', 'authenticated(非admin): call_job_acquire_lease は internal permission denied を期待',
                  false, format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('②acquire拒否', 'acquire 拒否ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ③ call_job_acquire_lease: service_role/admin 成功フロー — not_found/acquired(bootstrap)/held/
--    exhausted(attempts>=3→failed/KMB-E806)/terminal の全 result_kind
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_job_id uuid;
  v_row record;
begin
  select id into v_admin_id from telephony_job_rpc_fixture where key = 'admin';
  if v_admin_id is null then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'call_job_acquire_lease: not_found/acquired/held/exhausted/terminal 全分岐',
              true, 'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- not_found: 存在しない job_id
  select * into v_row from public.call_job_acquire_lease(gen_random_uuid());
  if v_row.result_kind = 'not_found' then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: 存在しない job_id → result_kind=not_found', true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: 存在しない job_id → result_kind=not_found', false,
              format('FAIL: result_kind=%s', v_row.result_kind));
  end if;

  -- acquired: job_pending ('pending' → bootstrap で 'downloading' へ、stage_attempts 0→1)
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_pending';
  select * into v_row from public.call_job_acquire_lease(v_job_id);
  if v_row.result_kind = 'acquired' and v_row.status = 'downloading' and v_row.stage_attempts = 1
     and v_row.lease_expires_at is not null and v_row.lease_expires_at > now() then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功',
              'admin: pending job を acquire → result_kind=acquired、status=downloading (bootstrap)、attempts=1、lease>now()',
              true, format('OK: lease_expires_at=%s', v_row.lease_expires_at));
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: pending job を acquire → bootstrap 成功を期待', false,
              format('FAIL: result_kind=%s status=%s attempts=%s lease=%s',
                v_row.result_kind, v_row.status, v_row.stage_attempts, v_row.lease_expires_at));
  end if;

  -- held: 直前に acquire したばかりの job_pending を lease 失効前に再 acquire
  select * into v_row from public.call_job_acquire_lease(v_job_id);
  if v_row.result_kind = 'held' and v_row.stage_attempts = 1 then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功',
              'admin: lease 保持中 (90秒以内) の job を再 acquire → result_kind=held、attempts は増えない',
              true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: lease 保持中の job を再 acquire → held を期待', false,
              format('FAIL: result_kind=%s attempts=%s', v_row.result_kind, v_row.stage_attempts));
  end if;

  -- exhausted: job_exhausted (stage_attempts=3 で先取り済み) → acquire 自身が failed/KMB-E806 に倒す
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_exhausted';
  select * into v_row from public.call_job_acquire_lease(v_job_id);
  if v_row.result_kind = 'exhausted' and v_row.status = 'failed' then
    -- acquire の返り値だけでなく、実テーブルの error_code/lease_expires_at も直接確認する
    perform 1 from call_jobs where id = v_job_id and status = 'failed' and error_code = 'KMB-E806'
      and lease_expires_at is null;
    if found then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('③acquire成功',
                'admin: stage_attempts>=3 の job を acquire → result_kind=exhausted、実テーブルも status=failed/error_code=KMB-E806/lease解放',
                true, 'OK');
    else
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('③acquire成功', 'admin: exhausted 後の実テーブル状態 (status=failed/error_code=KMB-E806/lease null)',
                false, 'FAIL: 実テーブルが期待値と一致しない');
    end if;
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: stage_attempts>=3 の job を acquire → exhausted を期待', false,
              format('FAIL: result_kind=%s status=%s', v_row.result_kind, v_row.status));
  end if;

  -- terminal: job_terminal (既に done)
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_terminal';
  select * into v_row from public.call_job_acquire_lease(v_job_id);
  if v_row.result_kind = 'terminal' and v_row.status = 'done' then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: 既に done の job を acquire → result_kind=terminal (status=done のまま透過)',
              true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'admin: done の job を acquire → terminal を期待', false,
              format('FAIL: result_kind=%s status=%s', v_row.result_kind, v_row.status));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('③acquire成功', 'acquire 成功フローブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ call_job_commit_stage: anon (EXECUTE権限無し) / authenticated(非admin、内部ガード) の拒否
-- =========================================================
do $$
declare
  v_job_id uuid;
begin
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_commit_cas';

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.call_job_commit_stage(v_job_id, 'downloading', 'transcribing');
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('④commit拒否', 'anon: call_job_commit_stage は permission denied を期待', false,
              'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('④commit拒否', 'anon: call_job_commit_stage は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('④commit拒否', 'anon: call_job_commit_stage は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
  begin
    perform public.call_job_commit_stage(v_job_id, 'downloading', 'transcribing');
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('④commit拒否', 'authenticated(非admin): call_job_commit_stage は internal permission denied を期待',
              false, 'FAIL: 非admin authenticated が実行できてしまった');
  exception
    when others then
      if sqlerrm like '%requires admin or service_role%' then
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('④commit拒否', 'authenticated(非admin): call_job_commit_stage は internal permission denied を期待',
                  true, 'OK: is_admin_or_service() ガードで拒否');
      else
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('④commit拒否', 'authenticated(非admin): call_job_commit_stage は internal permission denied を期待',
                  false, format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('④commit拒否', 'commit 拒否ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑤ call_job_commit_stage: service_role/admin 成功フロー — CAS一致で前進+成果物UPSERT+
--    attempts=0リセット+lease解放 / CAS不一致は冪等no-op(attempts不変) / 二重commit冪等 /
--    ai_cost_micro_usd 累積加算
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_job_id uuid;
  v_status text;
  v_row record;
begin
  select id into v_admin_id from telephony_job_rpc_fixture where key = 'admin';
  if v_admin_id is null then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功', 'call_job_commit_stage: CAS一致/不一致/二重commit/ai_cost累積', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_commit_cas';
  -- 前提確認: job_commit_cas は ①フィクスチャで status='downloading', stage_attempts=1,
  -- lease_expires_at=now()+90s に設定済み (acquire を経由していない直接セットアップ)

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- CAS 一致: expected_status='downloading' (現在値と一致) → 前進 + transcript UPSERT +
  -- ai_cost_micro_usd 加算 + attempts=0 リセット + lease 解放
  select public.call_job_commit_stage(
    v_job_id, 'downloading', 'transcribing',
    p_transcript => '{"text":"テスト文字起こし"}'::jsonb,
    p_ai_cost_delta_micro_usd => 1500
  ) into v_status;

  select * into v_row from call_jobs where id = v_job_id;
  if v_status = 'transcribing' and v_row.status = 'transcribing' and v_row.stage_attempts = 0
     and v_row.lease_expires_at is null and v_row.transcript = '{"text":"テスト文字起こし"}'::jsonb
     and v_row.ai_cost_micro_usd = 1500 then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功',
              'admin: CAS一致 (downloading→transcribing) → 前進+transcript UPSERT+ai_cost加算+attempts=0+lease解放',
              true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功', 'admin: CAS一致 commit の結果検証', false,
              format('FAIL: 返り値=%s status=%s attempts=%s lease=%s transcript=%s ai_cost=%s',
                v_status, v_row.status, v_row.stage_attempts, v_row.lease_expires_at, v_row.transcript,
                v_row.ai_cost_micro_usd));
  end if;

  -- CAS 不一致 (= 二重commit冪等): 既に 'transcribing' に前進済みなのに expected_status='downloading'
  -- (古い値) で再度 commit を試みる → no-op で現在値 'transcribing' を返すのみ。attempts は
  -- 0 のまま変化しない (0019 Codex BLOCKER の教訓: no-op 分岐では絶対に触らない)
  update call_jobs set stage_attempts = 2 where id = v_job_id; -- no-op でも触られないことを検証するため意図的に非0にしておく
  select public.call_job_commit_stage(
    v_job_id, 'downloading', 'transcribing', -- 古い expected_status (CAS不一致を意図的に起こす)
    p_transcript => '{"text":"上書きされてはいけない"}'::jsonb
  ) into v_status;

  select * into v_row from call_jobs where id = v_job_id;
  if v_status = 'transcribing' and v_row.status = 'transcribing' and v_row.stage_attempts = 2
     and v_row.transcript = '{"text":"テスト文字起こし"}'::jsonb then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功',
              'admin: CAS不一致 (expected=downloading だが現在値は transcribing) → 冪等no-op、attempts不変(2のまま)、成果物も上書きされない',
              true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功', 'admin: CAS不一致 no-op の検証', false,
              format('FAIL: 返り値=%s status=%s attempts=%s (2 を期待) transcript=%s',
                v_status, v_row.status, v_row.stage_attempts, v_row.transcript));
  end if;
  update call_jobs set stage_attempts = 0 where id = v_job_id; -- 後続の正当な commit 用に戻す

  -- 正しい expected_status での commit → 前進し attempts=0 リセット (二重commit冪等の後半:
  -- 同じ 'transcribing→analyzing' commit を 2 回連続で送っても 2 回目は no-op になることを確認)
  select public.call_job_commit_stage(v_job_id, 'transcribing', 'analyzing') into v_status;
  select public.call_job_commit_stage(v_job_id, 'transcribing', 'analyzing') into v_status; -- 2回目 (CAS不一致=no-op)

  select * into v_row from call_jobs where id = v_job_id;
  if v_status = 'analyzing' and v_row.status = 'analyzing' and v_row.stage_attempts = 0 then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功',
              'admin: 同一 commit (transcribing→analyzing) を連続2回送っても2回目は冪等no-opで結果は変わらない',
              true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功', 'admin: 二重commit冪等の検証', false,
              format('FAIL: 返り値=%s status=%s attempts=%s', v_status, v_row.status, v_row.stage_attempts));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑤commit成功', 'commit 成功フローブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑥ call_job_retry: anon (EXECUTE権限無し) / authenticated(非admin、内部ガード) の拒否
-- =========================================================
do $$
declare
  v_job_id uuid;
begin
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_failed';

  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.call_job_retry(v_job_id);
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑥retry拒否', 'anon: call_job_retry は permission denied を期待', false,
              'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('⑥retry拒否', 'anon: call_job_retry は permission denied を期待', true, 'OK: 42501');
    when others then
      insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
        values ('⑥retry拒否', 'anon: call_job_retry は permission denied を期待', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()::text), true);
  begin
    perform public.call_job_retry(v_job_id);
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑥retry拒否', 'authenticated(非admin): call_job_retry は internal permission denied を期待',
              false, 'FAIL: 非admin authenticated が実行できてしまった');
  exception
    when others then
      if sqlerrm like '%requires admin or service_role%' then
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('⑥retry拒否', 'authenticated(非admin): call_job_retry は internal permission denied を期待',
                  true, 'OK: is_admin_or_service() ガードで拒否');
      else
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('⑥retry拒否', 'authenticated(非admin): call_job_retry は internal permission denied を期待',
                  false, format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑥retry拒否', 'retry 拒否ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑦ call_job_retry: service_role/admin 成功フロー — failed→pending成功 / done→KMB-E807 raise /
--    存在しない id→KMB-E807 raise (同一経路)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_job_id uuid;
  v_status text;
  v_row record;
begin
  select id into v_admin_id from telephony_job_rpc_fixture where key = 'admin';
  if v_admin_id is null then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑦retry成功', 'call_job_retry: failed→pending成功/done→E807/not_found→E807', true,
              'SKIPPED: admin 行が無い環境');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  -- failed→pending 成功 (attempts=0 リセット、error_code/lease もクリア)
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_failed';
  select public.call_job_retry(v_job_id) into v_status;
  select * into v_row from call_jobs where id = v_job_id;
  if v_status = 'pending' and v_row.status = 'pending' and v_row.stage_attempts = 0
     and v_row.error_code is null and v_row.lease_expires_at is null then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑦retry成功', 'admin: failed job を retry → pending に戻り attempts=0/error_code=null/lease=null',
              true, 'OK');
  else
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑦retry成功', 'admin: failed→pending retry の結果検証', false,
              format('FAIL: 返り値=%s status=%s attempts=%s error_code=%s lease=%s',
                v_status, v_row.status, v_row.stage_attempts, v_row.error_code, v_row.lease_expires_at));
  end if;

  -- done→KMB-E807 (failed 以外への retry は業務エラー)
  select id into v_job_id from telephony_job_rpc_fixture where key = 'job_done_retry';
  begin
    perform public.call_job_retry(v_job_id);
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑦retry成功', 'admin: done job を retry → KMB-E807 raise を期待', false,
              'FAIL: done job が retry できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E807%' then
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('⑦retry成功', 'admin: done job を retry → KMB-E807 raise を期待', true, 'OK');
      else
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('⑦retry成功', 'admin: done job を retry → KMB-E807 raise を期待', false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;

  -- 存在しない id→KMB-E807 (failed 以外と同一経路、SQL コメント参照)
  begin
    perform public.call_job_retry(gen_random_uuid());
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑦retry成功', 'admin: 存在しない job_id を retry → KMB-E807 raise を期待', false,
              'FAIL: 存在しない id で成功してしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E807%' then
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('⑦retry成功', 'admin: 存在しない job_id を retry → KMB-E807 raise を期待 (failed以外と同一経路)',
                  true, 'OK');
      else
        insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
          values ('⑦retry成功', 'admin: 存在しない job_id を retry → KMB-E807 raise を期待', false,
                  format('FAIL: 想定外のエラー: %s', sqlerrm));
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into telephony_job_rpc_test_log(section, check_name, passed, detail)
      values ('⑦retry成功', 'retry 成功フローブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、フィクスチャ (calls/
-- call_recordings/call_jobs への INSERT、および 3 RPC が行った全 UPDATE) はすべて破棄される。
-- 実行者は以下の SELECT 結果で passed=false の行が無いことを確認する)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from telephony_job_rpc_test_log;
  raise notice '=== telephony call_job_* RPC 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from telephony_job_rpc_test_log
order by id;

rollback;
