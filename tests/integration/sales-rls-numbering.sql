-- =========================================================
-- sales (#48): documents/document_lines/payments RLS + document_save_draft RPC +
--   3 trigger (documents_freeze_after_issue / document_lines_draft_guard / payments_apply) +
--   document_number_next 再検証、結合検証 (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/02-sales.md §2.3.1 (migration 20260711000026_sales_core.sql 全文)
--   - docs/design/crm-suite/02-sales.md §3.2 (RLS テーブル認可マトリクス)
--   - docs/design/crm-suite/02-sales.md §5.3 (document_save_draft RPC 仕様)
--   - docs/design/crm-suite/02-sales.md §13.3 (結合テストケース一覧)
--   - 実装計画書 (scratchpad/plans/issue-48.md) §「テスト戦略」「結合(supabase start 実DB)」
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / migration
--   20260711000026_sales_core.sql が本番へ未適用のため実行環境が無い。加えて本 migration は
--   0023_crm_core.sql の deals テーブルに依存するため #42 マージ後でないと適用不可)。
--   migration 0021/0022/0023/0026 を本番 (Supabase) に手動 apply した後、Supabase MCP の
--   execute_sql ツールに本ファイルの内容をそのまま渡して実行し、末尾の sales_test_log の結果
--   (全行 passed=true) で検証すること。実行前提: MCP の接続ロールが postgres 等の SET ROLE
--   可能な特権ロールであること (tests/integration/m0-rls-rpc.sql と同じ運用注意点 — 複数文の
--   結果セット可視性、トランザクション維持の可否を含め当該ファイル冒頭コメントを参照)。
--
-- 設計方針 (m0-rls-rpc.sql / crm-rls-merge.sql の確立パターンを踏襲):
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。フィクスチャ (customers/
--     deals/documents/document_lines/payments) 及び document_number_next の採番消費は
--     一切残さない。
--   - 各チェックは (可能な限り) 独立した DO ブロック、またはブロック内で更に nested
--     begin/exception (= 独立した savepoint) に分割し、1 チェックの失敗が他のチェックの
--     ログ記録を savepoint rollback で巻き添えにしないようにする。
--   - ロール切替は SET LOCAL ROLE (+ request.jwt.claims の role/sub) で行う。
--   - service_role は RLS を bypass する (BYPASSRLS 属性 — crm-rls-merge.sql と同じ前提)。
--     フィクスチャ作成・issued 状態への直接遷移 (document_finalize_issue 相当の RPC は #50
--     未実装のため、本ファイルでは service_role の直接 UPDATE で「発行済み」状態を模擬する —
--     documents_freeze_after_issue trigger は old.status='draft' のときは何でも通すため、
--     一括 UPDATE で status/doc_no/current_version/issued_at/issuer_snapshot を同時に
--     'issued' 側へ遷移させれば CHECK 制約・trigger のどちらにも抵触しない) に用いる。
--   - GUC 'kmb.sales_revision_unlock' 経由の訂正パス (document_apply_revision — 0027=#50) は
--     本 Issue の対象外 (実装計画書「注意4」)。本ファイルはこの GUC を一切使用しない。
--   - 「並行 (concurrent) 採番」は複数コネクションが必要なため対象外 (m0-rls-rpc.sql と同じ
--     理由)。ここでは document_number_next の「sales フェーズでの動作再確認」として、admin
--     セッション (service_role だけでなく authenticated admin からも呼べること) と doc_type
--     ごとの連番のみ簡易確認する。
-- =========================================================

begin;

create temporary table sales_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

create temporary table sales_test_fixture (
  key text primary key,
  id uuid not null
);

do $$ begin raise notice '=== sales RLS/RPC/トリガ 結合検証 開始 (このトランザクションは最後に必ず ROLLBACK する) ==='; end $$;

-- =========================================================
-- ① フィクスチャ準備 (service_role — RLS bypass): customer / deal(quote 用・invoice 用×2)
--    + admin profile 探索 (m0/crm と同じ「実在の管理者行が無い環境は SKIPPED」方針)
-- =========================================================
do $$
declare
  v_customer_id uuid;
  v_deal_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into customers (kind, name, lifecycle, source)
    values ('person', '__sales_test__ 顧客', 'customer', 'manual')
    returning id into v_customer_id;
  insert into sales_test_fixture (key, id) values ('customer', v_customer_id);

  insert into deals (title, customer_id, source)
    values ('__sales_test__ 案件', v_customer_id, 'manual')
    returning id into v_deal_id;
  insert into sales_test_fixture (key, id) values ('deal', v_deal_id);

  insert into sales_test_log (section, check_name, passed, detail)
    values ('①fixture', 'service_role: customer/deal フィクスチャが作成できること', true,
            format('OK: customer=%s deal=%s', v_customer_id, v_deal_id));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('①fixture', 'service_role: customer/deal フィクスチャが作成できること', false,
              format('FAIL: 想定外のエラー (以降の全チェックの前提が崩れる): %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('①fixture', 'admin profile 探索', true,
              'SKIPPED: profiles に管理者行が無い環境 (bootstrap-admin 未実行)。admin セッションを要する以降のチェックは全て SKIPPED になる');
  else
    insert into sales_test_fixture (key, id) values ('admin', v_admin_id);
    insert into sales_test_log (section, check_name, passed, detail)
      values ('①fixture', 'admin profile 探索', true, format('OK: admin_id=%s', v_admin_id));
  end if;
end $$;

-- =========================================================
-- ② anon: documents / document_lines / payments いずれも grant 自体が無い (permission denied)。
--    site_settings (許可リストで anon select 可) とは異なり、sales 3 テーブルは
--    「revoke all on <table> from anon, authenticated」の後 authenticated にのみ grant するため、
--    anon は SELECT すら実行できない (RLS フィルタ以前の権限チェックで拒否される)
-- =========================================================
do $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform count(*) from documents;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: documents SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: documents SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;
  begin
    perform count(*) from document_lines;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: document_lines SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: document_lines SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;
  begin
    perform count(*) from payments;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon: payments SELECT は permission denied を期待', false, 'FAIL: anon が実行できてしまった');
  exception
    when insufficient_privilege then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('②anon拒否', 'anon: payments SELECT は permission denied を期待', true, 'OK: permission denied (42501)');
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('②anon拒否', 'anon 拒否確認 (ロール切替等の予期せぬ失敗)', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ③ documents RLS: admin INSERT は status='draft' 限定 (documents_admin_insert の with_check)。
--    draft の正当 INSERT が成功することも併せて確認し、以後のチェックで使う draft を 2 件作る
--    (draft1 = 明細ガード/自由編集/カスケード削除テスト用、draft2 = 後段で「発行」させる quote)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_deal_id uuid;
  v_bogus_id uuid;
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  select id into v_deal_id from sales_test_fixture where key = 'deal';
  if v_admin_id is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('③documents insert制限', 'admin: status=issued を明示指定した INSERT は拒否される', true, 'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  begin
    insert into documents (
      doc_type, status, deal_id, doc_no, current_version, issued_at, issuer_snapshot,
      billing_name
    ) values (
      'quote', 'issued', v_deal_id, 'Q-2026-9999', 1, now(), '{}'::jsonb, '__sales_test__ 不正issued直挿入'
    ) returning id into v_bogus_id;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('③documents insert制限', 'admin: status=issued を明示指定した INSERT は拒否される', false,
              format('FAIL: 挿入できてしまった (id=%s)', v_bogus_id));
  exception
    when insufficient_privilege then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('③documents insert制限', 'admin: status=issued を明示指定した INSERT は拒否される', true,
                'OK: row-level security policy 違反 (42501)');
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('③documents insert制限', 'admin: status=issued を明示指定した INSERT は拒否される', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('③documents insert制限', 'admin: status=issued 直挿入拒否確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_deal_id uuid;
  v_draft1 uuid;
  v_draft2 uuid;
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  select id into v_deal_id from sales_test_fixture where key = 'deal';
  if v_admin_id is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('③documents insert制限', 'admin: 既定 (status=draft) の正当 INSERT は成功する', true, 'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  insert into documents (doc_type, deal_id, billing_name)
    values ('quote', v_deal_id, '__sales_test__ draft1 (明細/カスケード用)')
    returning id into v_draft1;
  insert into documents (doc_type, deal_id, billing_name)
    values ('quote', v_deal_id, '__sales_test__ draft2 (発行予定)')
    returning id into v_draft2;

  insert into sales_test_fixture (key, id) values ('draft1', v_draft1);
  insert into sales_test_fixture (key, id) values ('draft2', v_draft2);
  insert into sales_test_log (section, check_name, passed, detail)
    values ('③documents insert制限', 'admin: 既定 (status=draft) の正当 INSERT は成功する', true,
            format('OK: draft1=%s draft2=%s', v_draft1, v_draft2));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('③documents insert制限', 'admin: draft INSERT (以降のチェックの前提フィクスチャ)', false,
              format('FAIL: 想定外のエラー (以降の draft1/draft2 依存チェックは全滅する): %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ④ documents 列単位 UPDATE grant: doc_no 等の採番/版/発行系は session から書けない
--    (permission denied)。一方 notes 等の内容列は draft であれば admin セッションから書ける
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_draft1 uuid;
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  select id into v_draft1 from sales_test_fixture where key = 'draft1';
  if v_admin_id is null or v_draft1 is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('④列grant', 'admin: doc_no の直接 UPDATE は permission denied を期待', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  begin
    update documents set doc_no = 'Q-2026-0001' where id = v_draft1;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('④列grant', 'admin: doc_no の直接 UPDATE は permission denied を期待', false, 'FAIL: 更新できてしまった');
  exception
    when insufficient_privilege then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('④列grant', 'admin: doc_no の直接 UPDATE は permission denied を期待', true, 'OK: permission denied (42501)');
  end;

  begin
    update documents set notes = '__sales_test__ 内容列は書ける' where id = v_draft1;
    if found then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('④列grant', 'admin: notes (grant 済み列) の UPDATE は成功する (draft のため trigger も通過)', true, 'OK');
    else
      insert into sales_test_log (section, check_name, passed, detail)
        values ('④列grant', 'admin: notes (grant 済み列) の UPDATE は成功する (draft のため trigger も通過)', false,
                'FAIL: 0 行更新 (RLS/対象不在の可能性)');
    end if;
  exception
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('④列grant', 'admin: notes (grant 済み列) の UPDATE は成功する (draft のため trigger も通過)', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('④列grant', '列単位 grant 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑤ document_number_next: sales フェーズでの再確認 (簡易)。authenticated admin からも
--    呼べること + doc_type ごとの連番が +1 で単調増加すること (真の並行安全性・欠番なし網羅は
--    m0-rls-rpc.sql ④が対象 — ここでは重複検証しない)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_seq_1 int;
  v_seq_2 int;
  v_doc_no_2 text;
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  if v_admin_id is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑤採番再検証', 'admin: document_number_next を呼べて連番が +1 されること', true, 'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select seq into v_seq_1 from public.document_number_next('delivery', 2031); -- 未使用年で他テストと非干渉
  select doc_no, seq into v_doc_no_2, v_seq_2 from public.document_number_next('delivery', 2031);

  if v_seq_2 = v_seq_1 + 1 and v_doc_no_2 = format('D-2031-%s', lpad(v_seq_2::text, 4, '0')) then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑤採番再検証', 'admin: document_number_next を呼べて連番が +1 されること', true,
              format('OK: %s → %s (%s)', v_seq_1, v_seq_2, v_doc_no_2));
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑤採番再検証', 'admin: document_number_next を呼べて連番が +1 されること', false,
              format('FAIL: seq %s → %s, doc_no=%s', v_seq_1, v_seq_2, v_doc_no_2));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑤採番再検証', 'admin: document_number_next 呼び出し (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑥ document_save_draft RPC: CAS 不一致 E103 / 原子置換 + ordinality 採番 (0 始まり連番) /
--    0 行許容 / 非 draft 対象 E624
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_draft1 uuid;
  v_before_updated_at timestamptz;
  v_header jsonb;
  v_lines jsonb;
  v_new_updated_at timestamptz;
  v_line_count int;
  v_positions int[];
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  select id into v_draft1 from sales_test_fixture where key = 'draft1';
  if v_admin_id is null or v_draft1 is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑥save_draft', 'document_save_draft (CAS/原子置換/ordinality)', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select updated_at into v_before_updated_at from documents where id = v_draft1;

  v_header := jsonb_build_object(
    'issue_date', null, 'transaction_date', null, 'valid_until', null,
    'billing_name', '__sales_test__ draft1 (save_draft後)', 'billing_suffix', '様',
    'billing_address', null, 'site_name', null, 'site_address', null, 'notes', null,
    'tax_rounding', 'floor'
  );
  v_lines := jsonb_build_array(
    jsonb_build_object('description', '明細A', 'quantity', 1, 'unit', '式', 'unit_price_jpy', 1000,
      'amount_jpy', 1000, 'tax_category', 'standard_10', 'work_type_key', null, 'source', null),
    jsonb_build_object('description', '明細B', 'quantity', 2, 'unit', '個', 'unit_price_jpy', 500,
      'amount_jpy', 1000, 'tax_category', 'standard_10', 'work_type_key', null, 'source', null),
    jsonb_build_object('description', '明細C', 'quantity', 1, 'unit', '式', 'unit_price_jpy', -200,
      'amount_jpy', -200, 'tax_category', 'standard_10', 'work_type_key', null, 'source', null)
  );

  -- (a) CAS 不一致 (古い updated_at のまま送信) → KMB-E103
  begin
    select new_updated_at into v_new_updated_at
      from public.document_save_draft(
        v_draft1, v_before_updated_at - interval '1 hour', v_header, v_lines, 1800, '[]'::jsonb, 1800);
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑥save_draft', 'CAS 不一致 (stale updated_at) → KMB-E103 を期待', false, 'FAIL: 例外にならず実行できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E103%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑥save_draft', 'CAS 不一致 (stale updated_at) → KMB-E103 を期待', true, format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑥save_draft', 'CAS 不一致 (stale updated_at) → KMB-E103 を期待', false,
                  format('FAIL: 想定外のエラー (E103 を含まない): %s', sqlerrm));
      end if;
  end;

  -- (b) 正当な CAS で保存: ヘッダ更新 + 明細 3 行が ordinality で 0,1,2 の position に採番されること
  begin
    select new_updated_at into v_new_updated_at
      from public.document_save_draft(
        v_draft1, v_before_updated_at, v_header, v_lines, 1800, '[]'::jsonb, 1800);
    select array_agg(position order by position) into v_positions from document_lines where document_id = v_draft1;
    select count(*) into v_line_count from document_lines where document_id = v_draft1;
    if v_new_updated_at is not null and v_line_count = 3 and v_positions = array[0, 1, 2] then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑥save_draft', '正当な CAS: ヘッダ更新 + 明細 3 行が position 0,1,2 で原子置換されること', true,
                format('OK: new_updated_at=%s positions=%s', v_new_updated_at, v_positions));
    else
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑥save_draft', '正当な CAS: ヘッダ更新 + 明細 3 行が position 0,1,2 で原子置換されること', false,
                format('FAIL: line_count=%s positions=%s', v_line_count, v_positions));
    end if;
  exception
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑥save_draft', '正当な CAS: ヘッダ更新 + 明細 3 行が position 0,1,2 で原子置換されること', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
      v_new_updated_at := null;
  end;

  -- (c) 0 行許容: 直前の保存で得た updated_at を使い、p_lines を空配列にして再保存 → 明細 0 行
  begin
    if v_new_updated_at is null then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑥save_draft', '0 行許容: p_lines=[] で明細が全削除されること', true, 'SKIPPED: 直前の保存が失敗したため前提が無い');
    else
      select new_updated_at into v_new_updated_at
        from public.document_save_draft(v_draft1, v_new_updated_at, v_header, '[]'::jsonb, 0, '[]'::jsonb, 0);
      select count(*) into v_line_count from document_lines where document_id = v_draft1;
      if v_line_count = 0 then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑥save_draft', '0 行許容: p_lines=[] で明細が全削除されること', true, 'OK: line_count=0');
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑥save_draft', '0 行許容: p_lines=[] で明細が全削除されること', false, format('FAIL: line_count=%s', v_line_count));
      end if;
    end if;
  exception
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑥save_draft', '0 行許容: p_lines=[] で明細が全削除されること', false, format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑥save_draft', 'document_save_draft 一連 (ロール切替等の予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑦ 発行状態への遷移 (service_role による直接 UPDATE — document_finalize_issue 相当の RPC は
--    #50 未実装のため模擬。documents_freeze_after_issue は old.status='draft' のとき無条件に
--    通す設計のため、単一 UPDATE で全発行系列を同時に埋めれば CHECK 制約・trigger のどちらも
--    通過する)。issuedQuote (quote, 明細/課金なし・void テスト用) / issuedInvoice (invoice,
--    total_jpy=10000・入金テスト用) / issuedOrder (order, 非invoice入金拒否テスト用) /
--    draftInvoice (invoice のまま・未発行入金拒否テスト用) の 4 種を用意する
-- =========================================================
do $$
declare
  v_deal_id uuid;
  v_draft2 uuid;
  v_issued_invoice uuid;
  v_issued_order uuid;
  v_draft_invoice uuid;
  v_doc_no text;
begin
  select id into v_deal_id from sales_test_fixture where key = 'deal';
  select id into v_draft2 from sales_test_fixture where key = 'draft2';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- draft2 (quote) → issuedQuote
  select doc_no into v_doc_no from public.document_number_next('quote', 2032);
  update documents set
    status = 'issued', doc_no = v_doc_no, current_version = 1, issued_at = now(), issuer_snapshot = '{}'::jsonb
    where id = v_draft2;
  insert into sales_test_fixture (key, id) values ('issuedQuote', v_draft2);

  -- invoice を新規 draft 作成 → issuedInvoice (total_jpy=10000)
  insert into documents (doc_type, deal_id, billing_name, total_jpy)
    values ('invoice', v_deal_id, '__sales_test__ issuedInvoice', 10000)
    returning id into v_issued_invoice;
  select doc_no into v_doc_no from public.document_number_next('invoice', 2032);
  update documents set
    status = 'issued', doc_no = v_doc_no, current_version = 1, issued_at = now(), issuer_snapshot = '{}'::jsonb
    where id = v_issued_invoice;
  insert into sales_test_fixture (key, id) values ('issuedInvoice', v_issued_invoice);

  -- order を新規 draft 作成 → issuedOrder (非 invoice への入金拒否テスト用)
  insert into documents (doc_type, deal_id, billing_name)
    values ('order', v_deal_id, '__sales_test__ issuedOrder')
    returning id into v_issued_order;
  select doc_no into v_doc_no from public.document_number_next('order', 2032);
  update documents set
    status = 'issued', doc_no = v_doc_no, current_version = 1, issued_at = now(), issuer_snapshot = '{}'::jsonb
    where id = v_issued_order;
  insert into sales_test_fixture (key, id) values ('issuedOrder', v_issued_order);

  -- draft のままの invoice (未発行への入金拒否テスト用)
  insert into documents (doc_type, deal_id, billing_name, total_jpy)
    values ('invoice', v_deal_id, '__sales_test__ draftInvoice', 5000)
    returning id into v_draft_invoice;
  insert into sales_test_fixture (key, id) values ('draftInvoice', v_draft_invoice);

  insert into sales_test_log (section, check_name, passed, detail)
    values ('⑦発行フィクスチャ', 'service_role: issuedQuote/issuedInvoice/issuedOrder/draftInvoice が作成できること', true,
            format('OK: issuedQuote=%s issuedInvoice=%s issuedOrder=%s draftInvoice=%s',
              v_draft2, v_issued_invoice, v_issued_order, v_draft_invoice));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑦発行フィクスチャ', 'service_role: 発行済みフィクスチャ 4 種作成 (以降の⑧⑨⑩⑪が全滅する重大失敗)', false,
              format('FAIL: 想定外のエラー: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑧ documents_freeze_after_issue: 発行済みの内容列 UPDATE → KMB-E624 (代表 3 列以上・
--    transaction_date 込み) / status 系 (status/status_reason/voided_at) は通過 / voided 後は
--    status 変更含め全拒否 KMB-E621 / draft は自由 (draft1 は⑥で既に直接 UPDATE 成功済みのため
--    ここでは draft2 相当の issuedQuote を voided に遷移させた上での再検証に用いる)
-- =========================================================
do $$
declare
  v_issued_invoice uuid;
begin
  select id into v_issued_invoice from sales_test_fixture where key = 'issuedInvoice';
  if v_issued_invoice is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑧凍結trigger', '発行済み内容列 (billing_name/transaction_date/billing_address) UPDATE → E624', true,
              'SKIPPED: 発行フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    update documents set
      billing_name = '__sales_test__ 改ざん',
      transaction_date = current_date,
      billing_address = '改ざん住所'
      where id = v_issued_invoice;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑧凍結trigger', '発行済み内容列 (billing_name/transaction_date/billing_address) UPDATE → E624', false,
              'FAIL: 更新できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E624%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑧凍結trigger', '発行済み内容列 (billing_name/transaction_date/billing_address) UPDATE → E624', true,
                  format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑧凍結trigger', '発行済み内容列 (billing_name/transaction_date/billing_address) UPDATE → E624', false,
                  format('FAIL: 想定外のエラー (E624 を含まない): %s', sqlerrm));
      end if;
  end;

  begin
    update documents set status_reason = '__sales_test__ 理由のみ更新' where id = v_issued_invoice;
    if found then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑧凍結trigger', '発行済みでも status_reason 単独更新は通過する (凍結対象外)', true, 'OK');
    else
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑧凍結trigger', '発行済みでも status_reason 単独更新は通過する (凍結対象外)', false, 'FAIL: 0 行更新');
    end if;
  exception
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑧凍結trigger', '発行済みでも status_reason 単独更新は通過する (凍結対象外)', false, format('FAIL: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑧凍結trigger', '凍結trigger内容列/status系 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_issued_quote uuid;
begin
  select id into v_issued_quote from sales_test_fixture where key = 'issuedQuote';
  if v_issued_quote is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑧凍結trigger', 'issuedQuote を voided に遷移 (status 系更新の成功) → 以後は全拒否 (E621) になること', true,
              'SKIPPED: 発行フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    update documents set status = 'voided', status_reason = '__sales_test__ 取消', voided_at = now()
      where id = v_issued_quote;
    if found then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑧凍結trigger', 'issued → voided (status 系更新) は成功する', true, 'OK');
    else
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑧凍結trigger', 'issued → voided (status 系更新) は成功する', false, 'FAIL: 0 行更新');
    end if;
  exception
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑧凍結trigger', 'issued → voided (status 系更新) は成功する', false, format('FAIL: %s', sqlerrm));
  end;

  begin
    update documents set status_reason = '__sales_test__ voided 後の再更新' where id = v_issued_quote;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑧凍結trigger', 'voided 後はいかなる UPDATE も KMB-E621 で拒否される', false, 'FAIL: 更新できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E621%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑧凍結trigger', 'voided 後はいかなる UPDATE も KMB-E621 で拒否される', true, format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑧凍結trigger', 'voided 後はいかなる UPDATE も KMB-E621 で拒否される', false,
                  format('FAIL: 想定外のエラー (E621 を含まない): %s', sqlerrm));
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑧凍結trigger', 'voided 遷移+以後拒否 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑨ document_lines_draft_guard: 発行済み文書への明細 INSERT/UPDATE/DELETE → KMB-E624 /
--    draft (draft1) では自由 / 親 draft の DELETE cascade は素通しされる (v_status is null 分岐)
-- =========================================================
do $$
declare
  v_issued_invoice uuid;
  v_line_id uuid;
begin
  select id into v_issued_invoice from sales_test_fixture where key = 'issuedInvoice';
  if v_issued_invoice is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', '発行済み文書への明細 INSERT → KMB-E624', true, 'SKIPPED: 発行フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    insert into document_lines (document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category)
      values (v_issued_invoice, 0, '__sales_test__ 不正明細', 1, '式', 1000, 1000, 'standard_10');
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', '発行済み文書への明細 INSERT → KMB-E624', false, 'FAIL: 挿入できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E624%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑨明細draftガード', '発行済み文書への明細 INSERT → KMB-E624', true, format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑨明細draftガード', '発行済み文書への明細 INSERT → KMB-E624', false,
                  format('FAIL: 想定外のエラー (E624 を含まない): %s', sqlerrm));
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', '発行済み明細 INSERT 拒否確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_draft1 uuid;
  v_line_id uuid;
begin
  select id into v_draft1 from sales_test_fixture where key = 'draft1';
  if v_draft1 is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', 'draft では明細 INSERT/UPDATE/DELETE が自由にできること', true, 'SKIPPED: draft1 フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into document_lines (document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category)
    values (v_draft1, 0, '__sales_test__ draft1 自由編集明細', 1, '式', 1000, 1000, 'standard_10')
    returning id into v_line_id;
  update document_lines set description = '__sales_test__ 更新後' where id = v_line_id;
  delete from document_lines where id = v_line_id;

  if not exists (select 1 from document_lines where id = v_line_id) then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', 'draft では明細 INSERT/UPDATE/DELETE が自由にできること', true, 'OK: 3 操作とも成功');
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', 'draft では明細 INSERT/UPDATE/DELETE が自由にできること', false, 'FAIL: DELETE が反映されていない');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', 'draft 自由編集 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_draft1 uuid;
  v_line_count_before int;
begin
  select id into v_draft1 from sales_test_fixture where key = 'draft1';
  if v_draft1 is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', '親 draft の DELETE (cascade) が document_lines_draft_guard に阻まれず素通しされること', true,
              'SKIPPED: draft1 フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into document_lines (document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category)
    values (v_draft1, 0, '__sales_test__ cascade削除対象明細', 1, '式', 1000, 1000, 'standard_10');
  select count(*) into v_line_count_before from document_lines where document_id = v_draft1;

  begin
    delete from documents where id = v_draft1; -- 明細も cascade で消える
    if v_line_count_before > 0 and not exists (select 1 from document_lines where document_id = v_draft1)
       and not exists (select 1 from documents where id = v_draft1) then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑨明細draftガード', '親 draft の DELETE (cascade) が document_lines_draft_guard に阻まれず素通しされること', true,
                format('OK: 親+明細%s件が例外なく削除された', v_line_count_before));
    else
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑨明細draftガード', '親 draft の DELETE (cascade) が document_lines_draft_guard に阻まれず素通しされること', false,
                'FAIL: 削除後も行が残っている');
    end if;
  exception
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑨明細draftガード', '親 draft の DELETE (cascade) が document_lines_draft_guard に阻まれず素通しされること', false,
                format('FAIL: cascade 削除が例外で失敗した (v_status is null 分岐が機能していない可能性): %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑨明細draftガード', '親 cascade 削除 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑩ payments_apply: 部分入金→維持 / 完済→paid+paid_at / 超過→KMB-E625 /
--    DELETE→paid⇔issued 自動復帰 / 非invoiceへの入金→KMB-E623 / 未発行への入金→KMB-E621 /
--    UPDATE grant が無い (不変) → permission denied
-- =========================================================
do $$
declare
  v_issued_invoice uuid;
  v_payment1 uuid;
  v_payment2 uuid;
  v_status text;
  v_paid_at timestamptz;
begin
  select id into v_issued_invoice from sales_test_fixture where key = 'issuedInvoice';
  if v_issued_invoice is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '部分入金→完済→超過→DELETE復帰 一連', true, 'SKIPPED: 発行フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (a) 部分入金 (4000 / 10000): status は issued のまま
  insert into payments (document_id, paid_on, amount_jpy, method)
    values (v_issued_invoice, current_date, 4000, 'bank_transfer')
    returning id into v_payment1;
  select status, paid_at into v_status, v_paid_at from documents where id = v_issued_invoice;
  if v_status = 'issued' and v_paid_at is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '部分入金 (4000/10000): status は issued のまま維持される', true, 'OK');
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '部分入金 (4000/10000): status は issued のまま維持される', false,
              format('FAIL: status=%s paid_at=%s', v_status, v_paid_at));
  end if;

  -- (b) 残額ちょうど (6000) を入金 → 完済 paid + paid_at セット
  insert into payments (document_id, paid_on, amount_jpy, method)
    values (v_issued_invoice, current_date, 6000, 'cash')
    returning id into v_payment2;
  select status, paid_at into v_status, v_paid_at from documents where id = v_issued_invoice;
  if v_status = 'paid' and v_paid_at is not null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '残額ちょうど (6000) 入金: status=paid かつ paid_at がセットされる', true,
              format('OK: paid_at=%s', v_paid_at));
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '残額ちょうど (6000) 入金: status=paid かつ paid_at がセットされる', false,
              format('FAIL: status=%s paid_at=%s', v_status, v_paid_at));
  end if;

  -- (c) 完済後の追加入金 (1円でも) → KMB-E625
  begin
    insert into payments (document_id, paid_on, amount_jpy, method) values (v_issued_invoice, current_date, 1, 'other');
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '完済後の追加入金 (超過) → KMB-E625', false, 'FAIL: 挿入できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E625%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑩消込trigger', '完済後の追加入金 (超過) → KMB-E625', true, format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑩消込trigger', '完済後の追加入金 (超過) → KMB-E625', false,
                  format('FAIL: 想定外のエラー (E625 を含まない): %s', sqlerrm));
      end if;
  end;

  -- (d) 直近入金 (6000) を DELETE → paid から issued へ自動復帰 (paid_at は null に戻る)
  delete from payments where id = v_payment2;
  select status, paid_at into v_status, v_paid_at from documents where id = v_issued_invoice;
  if v_status = 'issued' and v_paid_at is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '入金 DELETE (paid→issued の残高割れ) で自動復帰する', true, 'OK');
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '入金 DELETE (paid→issued の残高割れ) で自動復帰する', false,
              format('FAIL: status=%s paid_at=%s', v_status, v_paid_at));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '部分入金→完済→超過→DELETE復帰 一連 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_issued_order uuid;
begin
  select id into v_issued_order from sales_test_fixture where key = 'issuedOrder';
  if v_issued_order is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '非 invoice (order) への入金 → KMB-E623', true, 'SKIPPED: 発行フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    insert into payments (document_id, paid_on, amount_jpy, method) values (v_issued_order, current_date, 1000, 'cash');
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '非 invoice (order) への入金 → KMB-E623', false, 'FAIL: 挿入できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E623%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑩消込trigger', '非 invoice (order) への入金 → KMB-E623', true, format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑩消込trigger', '非 invoice (order) への入金 → KMB-E623', false,
                  format('FAIL: 想定外のエラー (E623 を含まない): %s', sqlerrm));
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '非invoice入金拒否 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_draft_invoice uuid;
begin
  select id into v_draft_invoice from sales_test_fixture where key = 'draftInvoice';
  if v_draft_invoice is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '未発行 (draft) invoice への入金 → KMB-E621', true, 'SKIPPED: 発行フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    insert into payments (document_id, paid_on, amount_jpy, method) values (v_draft_invoice, current_date, 1000, 'cash');
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '未発行 (draft) invoice への入金 → KMB-E621', false, 'FAIL: 挿入できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E621%' then
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑩消込trigger', '未発行 (draft) invoice への入金 → KMB-E621', true, format('OK: %s', sqlerrm));
      else
        insert into sales_test_log (section, check_name, passed, detail)
          values ('⑩消込trigger', '未発行 (draft) invoice への入金 → KMB-E621', false,
                  format('FAIL: 想定外のエラー (E621 を含まない): %s', sqlerrm));
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑩消込trigger', '未発行入金拒否 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑪ payments UPDATE grant が存在しないこと (訂正は DELETE + 再 INSERT。UPDATE grant 自体を
--    revoke しているため、RLS ポリシー云々の前に permission denied になる — v1.1 の教訓)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_issued_invoice uuid;
  v_payment_id uuid;
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  select id into v_issued_invoice from sales_test_fixture where key = 'issuedInvoice';
  if v_admin_id is null or v_issued_invoice is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑪payments不変', 'admin: payments の UPDATE は permission denied を期待 (UPDATE grant なし)', true,
              'SKIPPED: 前提フィクスチャなし');
    return;
  end if;

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_payment_id from payments where document_id = v_issued_invoice limit 1;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_payment_id is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑪payments不変', 'admin: payments の UPDATE は permission denied を期待 (UPDATE grant なし)', true,
              'SKIPPED: ⑩で入金行が残っていない (全て DELETE 済みの可能性)');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  begin
    update payments set amount_jpy = 1 where id = v_payment_id;
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑪payments不変', 'admin: payments の UPDATE は permission denied を期待 (UPDATE grant なし)', false,
              'FAIL: 更新できてしまった (不変制約が破れている)');
  exception
    when insufficient_privilege then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑪payments不変', 'admin: payments の UPDATE は permission denied を期待 (UPDATE grant なし)', true,
                'OK: permission denied (42501)');
    when others then
      insert into sales_test_log (section, check_name, passed, detail)
        values ('⑪payments不変', 'admin: payments の UPDATE は permission denied を期待 (UPDATE grant なし)', false,
                format('FAIL: 想定外のエラー: %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑪payments不変', 'payments UPDATE 拒否確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- ⑫ documents DELETE は draft 限定 (issued/voided は RLS が 0 行に絞る。エラーにはならず
--    黙って 0 行 — RLS フィルタの一般的挙動。draft (draft2 は既に issuedQuote へ遷移済みのため
--    ここでは新規に draft を 1 件作って検証する)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_deal_id uuid;
  v_issued_invoice uuid;
  v_new_draft uuid;
  v_deleted_count int;
begin
  select id into v_admin_id from sales_test_fixture where key = 'admin';
  select id into v_deal_id from sales_test_fixture where key = 'deal';
  select id into v_issued_invoice from sales_test_fixture where key = 'issuedInvoice';
  if v_admin_id is null then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑫DELETE制限', 'admin: DELETE は draft 限定 (issued は 0 行 / draft は成功)', true, 'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  delete from documents where id = v_issued_invoice;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count = 0 then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑫DELETE制限', 'admin: issued 文書の DELETE は RLS に阻まれ 0 行 (エラーにはならない)', true, 'OK: 0 行');
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑫DELETE制限', 'admin: issued 文書の DELETE は RLS に阻まれ 0 行 (エラーにはならない)', false,
              format('FAIL: %s 行削除できてしまった (7年保存規約の違反)', v_deleted_count));
  end if;

  insert into documents (doc_type, deal_id, billing_name) values ('quote', v_deal_id, '__sales_test__ DELETE用draft')
    returning id into v_new_draft;
  delete from documents where id = v_new_draft;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count = 1 then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑫DELETE制限', 'admin: draft 文書の DELETE は成功する', true, 'OK: 1 行削除');
  else
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑫DELETE制限', 'admin: draft 文書の DELETE は成功する', false, format('FAIL: %s 行', v_deleted_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_test_log (section, check_name, passed, detail)
      values ('⑫DELETE制限', 'DELETE draft限定 確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、上記の書き込み系チェック
-- — customers/deals/documents/document_lines/payments フィクスチャ・document_number_next の
-- 採番消費 — はすべて破棄される。実行者は以下の SELECT 結果で passed=false の行が無いことを
-- 確認する)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from sales_test_log;
  raise notice '=== sales RLS/RPC/トリガ 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from sales_test_log
order by id;

rollback;
