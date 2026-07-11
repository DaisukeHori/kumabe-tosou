-- =========================================================
-- crm (#43): activities 冪等 / relinkActivity の DB プリミティブ / deals.source_inquiry_id 冪等 /
--            trigger_crm_digest_worker (Vault 未設定スキップ) 結合検証
-- (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/01-crm.md §6.6 (appendActivity の実装手順・冪等 INSERT)
--   - docs/design/crm-suite/01-crm.md §6.7 (relinkActivity の実装手順)
--   - docs/design/crm-suite/01-crm.md §2.3 (migration 20260711000024_crm_digest_cron.sql 全文)
--   - docs/design/crm-suite/01-crm.md §11.3 (結合テストケース一覧 — #2-2 facade+digest worker 分)
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / 本番 migration
--   20260711000023_crm_core.sql・20260711000024_crm_digest_cron.sql 未適用のため実行環境が無い)。
--   両 migration を本番 (Supabase) に手動 apply した後、Supabase MCP の execute_sql ツールに
--   本ファイルの内容をそのまま渡して実行し、末尾の crm_test_log の結果 (全行 passed=true) で
--   検証すること。tests/integration/crm-rls-merge.sql (#42) と同じ運用注意点 (SET ROLE 可能な
--   特権ロールでの実行・複数文の結果セット可視性) を前提とする。
--
-- 設計方針 (crm-rls-merge.sql の確立パターンを完全踏襲):
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。
--   - 各チェックは DO ブロック内の BEGIN/EXCEPTION で例外を握りつぶし、crm_test_log に記録する。
--   - relinkActivity 自体は facade (TypeScript) の service 実行ロジックであり RPC ではないため、
--     本ファイルでは facade が組み立てる SQL 操作列 (DELETE activity_links → 冪等 INSERT) を
--     service_role で直接再現し、DB 側のプリミティブ (activity_links_*_uniq の冪等性・
--     activities_ref_idem_uniq の NULLS DISTINCT 挙動) が facade の前提どおりに機能することを
--     検証する (facade 層のバリデーション・監査追記ロジックそのものは対象外 — それは
--     tests/crm-intake.test.ts 等の TypeScript 単体テストが担う)。
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

create temporary table crm_test_fixture (
  key text primary key,
  id uuid not null
);

do $$ begin raise notice '=== crm activities冪等/relink プリミティブ/digest cron 結合検証 開始 (末尾で必ず ROLLBACK する) ==='; end $$;

-- =========================================================
-- 0. フィクスチャ準備 (service_role — RLS bypass)
-- =========================================================
do $$
declare
  v_customer_a uuid;
  v_customer_b uuid;
  v_deal_a uuid;
  v_inquiry_a uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into customers (kind, name, email, lifecycle, source)
    values ('person', '__crm_idem_test__ 顧客A', 'crm-idem-a@example.com', 'lead', 'manual')
    returning id into v_customer_a;
  insert into customers (kind, name, email, lifecycle, source)
    values ('person', '__crm_idem_test__ 顧客B', 'crm-idem-b@example.com', 'lead', 'manual')
    returning id into v_customer_b;
  insert into deals (title, customer_id, stage, source)
    values ('__crm_idem_test__ 案件A', v_customer_a, 'inquiry', 'manual')
    returning id into v_deal_a;
  insert into contact_inquiries (name, email, inquiry_type, body, status)
    values ('__crm_idem_test__ 問い合わせA', 'crm-idem-inquiry@example.com', 'estimate', '本文', 'new')
    returning id into v_inquiry_a;

  insert into crm_test_fixture(key, id) values
    ('customer_a', v_customer_a),
    ('customer_b', v_customer_b),
    ('deal_a', v_deal_a),
    ('inquiry_a', v_inquiry_a);

  insert into crm_test_log(section, check_name, passed, detail)
    values ('0.fixture', 'service_role: baseline 行が作れること', true,
            format('OK: customer_a=%s customer_b=%s deal_a=%s inquiry_a=%s', v_customer_a, v_customer_b, v_deal_a, v_inquiry_a));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('0.fixture', 'service_role: baseline 行が作れること', false,
              format('FAIL: 想定外のエラー (以降の多くのチェックが前提を欠く): %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ① activities 冪等 INSERT (§6.6 手順5 — activity_type,ref_table,ref_id の非部分一意 index)
-- =========================================================
do $$
declare
  v_customer_a uuid;
  v_activity_1 uuid;
  v_activity_2 uuid;
  v_count int;
begin
  select id into v_customer_a from crm_test_fixture where key = 'customer_a';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 1 回目: form_submission (ref_table/ref_id あり) を新規作成
  insert into activities (activity_type, occurred_at, title, payload, ref_table, ref_id)
    values ('form_submission', now(), '__crm_idem_test__ 相談', '{"inquiry_id":"00000000-0000-0000-0000-000000000000","inquiry_type":"estimate","excerpt":"x"}'::jsonb,
            'contact_inquiries', (select id from crm_test_fixture where key = 'inquiry_a'))
    returning id into v_activity_1;

  -- 2 回目: 同一 (activity_type, ref_table, ref_id) — upsert(ignoreDuplicates) 相当を
  -- on conflict do nothing で再現し、0 行応答から既存行 SELECT で回収する repository の方式を検証
  insert into activities (activity_type, occurred_at, title, payload, ref_table, ref_id)
    values ('form_submission', now(), '__crm_idem_test__ 相談(2回目)', '{"inquiry_id":"00000000-0000-0000-0000-000000000000","inquiry_type":"estimate","excerpt":"y"}'::jsonb,
            'contact_inquiries', (select id from crm_test_fixture where key = 'inquiry_a'))
    on conflict (activity_type, ref_table, ref_id) do nothing
    returning id into v_activity_2;

  select count(*) into v_count from activities
    where activity_type = 'form_submission' and ref_table = 'contact_inquiries'
      and ref_id = (select id from crm_test_fixture where key = 'inquiry_a');

  if v_activity_2 is null and v_count = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①activities冪等', '同一 ref の二重 INSERT は 0 行応答・行数 1 のまま (repository は既存行 SELECT で回収)', true,
              format('OK: 1回目 id=%s, 2回目は競合で 0 行, 行数=%s', v_activity_1, v_count));
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①activities冪等', '同一 ref の二重 INSERT は 0 行応答・行数 1 のまま', false,
              format('FAIL: 2回目のid=%s (null期待), 行数=%s (1期待)', v_activity_2, v_count));
  end if;

  -- ref_id が NULL (note 等) は重複挿入可 (NULLS DISTINCT)
  insert into activities (activity_type, occurred_at, title, body) values ('note', now(), '__crm_idem_test__ メモ1', 'a');
  insert into activities (activity_type, occurred_at, title, body) values ('note', now(), '__crm_idem_test__ メモ2', 'b');
  select count(*) into v_count from activities where activity_type = 'note' and title like '__crm_idem_test__%';
  if v_count = 2 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①activities冪等', 'ref_id が NULL (note) は重複挿入可 (NULLS DISTINCT)', true, format('OK: 2件挿入できた'));
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①activities冪等', 'ref_id が NULL (note) は重複挿入可', false, format('FAIL: 挿入できた件数=%s (2期待)', v_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('①activities冪等', 'ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ② activity_links 冪等 + relinkActivity の DB プリミティブ (§6.7 手順4: DELETE → 冪等 INSERT)
-- =========================================================
do $$
declare
  v_customer_a uuid;
  v_customer_b uuid;
  v_activity_1 uuid;
  v_link_count int;
begin
  select id into v_customer_a from crm_test_fixture where key = 'customer_a';
  select id into v_customer_b from crm_test_fixture where key = 'customer_b';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into activities (activity_type, occurred_at, title, body) values ('call', now(), '__crm_idem_test__ 通話', null)
    returning id into v_activity_1;

  -- 初期リンク: customer_a
  insert into activity_links (activity_id, customer_id) values (v_activity_1, v_customer_a);

  select count(*) into v_link_count from activity_links where activity_id = v_activity_1;
  if v_link_count = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '初期リンク 1 件作成', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '初期リンク 1 件作成', false, format('FAIL: 件数=%s', v_link_count));
  end if;

  -- relinkActivity 相当: 全削除 → customer_b へ張り替え (§6.7 手順4)
  delete from activity_links where activity_id = v_activity_1;
  insert into activity_links (activity_id, customer_id) values (v_activity_1, v_customer_b)
    on conflict (customer_id, activity_id) do nothing;

  select count(*) into v_link_count from activity_links where activity_id = v_activity_1 and customer_id = v_customer_b;
  if v_link_count = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '置換 (customer_a → customer_b): DELETE+INSERT で旧リンクが消え新リンクのみ残る', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '置換後のリンク件数', false, format('FAIL: customer_b への件数=%s (1期待)', v_link_count));
  end if;

  select count(*) into v_link_count from activity_links where activity_id = v_activity_1 and customer_id = v_customer_a;
  if v_link_count = 0 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '旧リンク (customer_a) が残っていないこと', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '旧リンク (customer_a) が残っていないこと', false, format('FAIL: 残存件数=%s', v_link_count));
  end if;

  -- 全解除 (links=[]) — DELETE のみ、再 INSERT なし
  delete from activity_links where activity_id = v_activity_1;
  select count(*) into v_link_count from activity_links where activity_id = v_activity_1;
  if v_link_count = 0 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '全解除 (links=[]) 後は 0 件', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '全解除後の件数', false, format('FAIL: 件数=%s', v_link_count));
  end if;

  -- 同一リンクの冪等再 INSERT (created:false 相当 — activity_links_customer_uniq)
  insert into activity_links (activity_id, customer_id) values (v_activity_1, v_customer_a);
  insert into activity_links (activity_id, customer_id) values (v_activity_1, v_customer_a)
    on conflict (customer_id, activity_id) do nothing;
  select count(*) into v_link_count from activity_links where activity_id = v_activity_1 and customer_id = v_customer_a;
  if v_link_count = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '同一リンクの二重 INSERT は 1 件のまま (activity_links_customer_uniq)', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', '同一リンクの二重 INSERT 件数', false, format('FAIL: 件数=%s (1期待)', v_link_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('②relink プリミティブ', 'ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ③ deals.source_inquiry_id 冪等 (取込冪等の土台 — §2.2 冒頭「冪等 index の設計原則」)
-- =========================================================
do $$
declare
  v_customer_a uuid;
  v_inquiry_a uuid;
  v_deal_1 uuid;
  v_deal_2 uuid;
  v_count int;
begin
  select id into v_customer_a from crm_test_fixture where key = 'customer_a';
  select id into v_inquiry_a from crm_test_fixture where key = 'inquiry_a';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into deals (title, customer_id, stage, source, source_inquiry_id)
    values ('__crm_idem_test__ 取込案件1回目', v_customer_a, 'inquiry', 'form', v_inquiry_a)
    returning id into v_deal_1;

  insert into deals (title, customer_id, stage, source, source_inquiry_id)
    values ('__crm_idem_test__ 取込案件2回目', v_customer_a, 'inquiry', 'form', v_inquiry_a)
    on conflict (source_inquiry_id) do nothing
    returning id into v_deal_2;

  select count(*) into v_count from deals where source_inquiry_id = v_inquiry_a;

  if v_deal_2 is null and v_count = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③deals冪等', '同一 source_inquiry_id の二重 INSERT は conflict (1件のまま)', true,
              format('OK: 1回目 id=%s, 行数=%s', v_deal_1, v_count));
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③deals冪等', '同一 source_inquiry_id の二重 INSERT', false,
              format('FAIL: 2回目id=%s (null期待), 行数=%s (1期待)', v_deal_2, v_count));
  end if;

  -- source_inquiry_id が NULL の手動案件は何件でも共存できる (NULLS DISTINCT)
  insert into deals (title, customer_id, stage, source) values ('__crm_idem_test__ 手動案件1', v_customer_a, 'inquiry', 'manual');
  insert into deals (title, customer_id, stage, source) values ('__crm_idem_test__ 手動案件2', v_customer_a, 'inquiry', 'manual');
  select count(*) into v_count from deals where title like '__crm_idem_test__ 手動案件%';
  if v_count = 2 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③deals冪等', 'source_inquiry_id が NULL の手動案件は複数共存できる', true, 'OK');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③deals冪等', 'source_inquiry_id が NULL の手動案件は複数共存できる', false, format('FAIL: 件数=%s (2期待)', v_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('③deals冪等', 'ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ trigger_crm_digest_worker (Vault 未設定なら raise notice で安全にスキップ — 例外にならない)
--    (migration 20260711000024_crm_digest_cron.sql 適用済み前提)
-- =========================================================
do $$
declare
  v_fn_exists boolean;
  v_has_url boolean;
  v_has_secret boolean;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'trigger_crm_digest_worker'
  ) into v_fn_exists;

  if not v_fn_exists then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'trigger_crm_digest_worker() の存在確認', true,
              'SKIPPED: migration 20260711000024 が未適用の環境 (関数が存在しない) — 本チェックは適用後に再実行すること');
  else
    -- net.http_post は pg_net の非同期ワーカー経由で発火するため、本ファイル冒頭の
    -- begin;...rollback; では取り消せない (トランザクション外の副作用)。Vault に
    -- cron_site_url/cron_jobs_secret が本番運用向けに既に設定済みの環境でこの関数を
    -- 無条件に perform すると、"検証" のつもりで実際に /api/jobs/crm-digest への
    -- HTTP 起床 (=本物のダイジェストメール送信) を引き起こしてしまう (crm-digest-merge
    -- 系の地雷と同種の「意図せぬ本番副作用」)。Vault が未設定の場合のみ実際に perform し、
    -- 設定済みの場合は SKIPPED として安全側に倒す (crm-rls-merge.sql の「実在の管理者行が
    -- 無い環境では SKIPPED」と同じ運用)。
    select exists(select 1 from vault.decrypted_secrets where name = 'cron_site_url') into v_has_url;
    select exists(select 1 from vault.decrypted_secrets where name = 'cron_jobs_secret') into v_has_secret;

    if v_has_url and v_has_secret then
      insert into crm_test_log(section, check_name, passed, detail)
        values ('④digest cron', 'trigger_crm_digest_worker() の呼び出しが例外を投げない (Vault 未設定でも安全にスキップ)', true,
                'SKIPPED: 本番運用の Vault シークレットが既に設定済みのため、無条件 perform すると実際に net.http_post が飛び本物のダイジェストメール送信を誘発する (トランザクション ROLLBACK では取り消せない副作用)。カットオーバー前 (Vault 未設定) の環境で検証するか、cron_site_url/cron_jobs_secret を一時的に削除して再実行すること。');
    else
      execute 'set local role service_role';
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      -- Vault に cron_site_url/cron_jobs_secret が未設定の場合、関数は例外を投げず
      -- raise notice のみで正常終了する設計 (§2.3 全文)。例外が飛ばないこと自体が検証対象
      -- (「安全にスキップ」の実測)。net.http_post 分岐には到達しないため副作用は無い。
      perform public.trigger_crm_digest_worker();
      insert into crm_test_log(section, check_name, passed, detail)
        values ('④digest cron', 'trigger_crm_digest_worker() の呼び出しが例外を投げない (Vault 未設定でも安全にスキップ)', true,
                'OK: 例外なく完了');
      reset role;
      perform set_config('request.jwt.claims', '', true);
    end if;
  end if;
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'trigger_crm_digest_worker() の呼び出しが例外を投げない', false,
              format('FAIL: 想定外の例外 (Vault 未設定時は raise notice のみのはず): %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④' kmb-crm-digest-worker が cron.job にちょうど 1 件登録されていること (unschedule→schedule の冪等性。
--    migration 0024 を再適用しても重複登録されないことの確認 — 適用直後・再適用後の両方で実行すること)
-- =========================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from cron.job where jobname = 'kmb-crm-digest-worker';
  if v_count = 1 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'kmb-crm-digest-worker が cron.job にちょうど 1 件登録されていること', true, 'OK: 1件');
  elsif v_count = 0 then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'kmb-crm-digest-worker が cron.job にちょうど 1 件登録されていること', true,
              'SKIPPED: migration 20260711000024 が未適用 (cron.job に未登録)');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'kmb-crm-digest-worker が cron.job にちょうど 1 件登録されていること', false,
              format('FAIL: %s 件 (unschedule→schedule の冪等性が壊れ重複登録されている)', v_count));
  end if;
end $$;

do $$
declare
  v_authenticated_can boolean := true;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.trigger_crm_digest_worker();
  exception
    when insufficient_privilege then
      v_authenticated_can := false;
    when undefined_function then
      v_authenticated_can := null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_authenticated_can is null then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'authenticated からの実行は拒否される (service/cron 専用)', true,
              'SKIPPED: migration 20260711000024 未適用');
  elsif v_authenticated_can = false then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'authenticated からの実行は拒否される (revoke execute ... from ... authenticated)', true, 'OK: 42501');
  else
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'authenticated からの実行は拒否される', false, 'FAIL: authenticated から実行できてしまった');
  end if;
exception
  when others then
    insert into crm_test_log(section, check_name, passed, detail)
      values ('④digest cron', 'authenticated 拒否ブロック全体 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、上記の書き込みはすべて破棄される)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from crm_test_log;
  raise notice '=== crm activities冪等/relink プリミティブ/digest cron 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from crm_test_log
order by id;

rollback;
