-- =========================================================
-- sales (#49): SalesFacade 状態遷移 (acceptQuote/declineQuote/voidDocument の CAS UPDATE) +
--   voidDocument 入金存在ガード + appendActivity 合成 ref 冪等性、結合検証
--   (再現可能アーティファクト — 未実行)
--
-- canonical:
--   - docs/design/crm-suite/02-sales.md §4.1/§4.2 (documents.status 状態機械図・意味論表)
--   - docs/design/crm-suite/02-sales.md §6.2 (acceptQuote/declineQuote/voidDocument の実装手順)
--   - docs/design/crm-suite/02-sales.md §13.3 (結合テストケース一覧)
--   - 実装計画書 (scratchpad/plans/issue-49.md) §「テスト戦略」→「結合テスト」
--
-- ★ 本ファイルはこのセッションでは一度も実行していない (docker 無し / migration
--   20260711000026_sales_core.sql が本番へ未適用の可能性があるため実行環境が無い)。
--   本番へ 0021/0022/0023/0026 が適用済みであることを Supabase MCP の list_migrations で
--   確認した後、本ファイルの内容をそのまま execute_sql に渡して実行し、末尾の
--   sales_state_test_log の全行 passed=true を確認すること。運用注意点は
--   tests/integration/sales-rls-numbering.sql (#48) 冒頭コメントと同一。
--
-- 設計方針・スコープ (sales-rls-numbering.sql / crm-activities-idempotency-relink-digest.sql の
-- 確立パターンを踏襲):
--   - facade.ts は TypeScript であり SQL から直接呼べないため、facade の
--     acceptQuote/declineQuote/voidDocument (repository.updateDocumentStatusWithCas) が実際に
--     発行する CAS UPDATE 文 (`update documents set status=.., status_reason=.., voided_at=..
--     where id=.. and updated_at=..`) を authenticated admin ロールでそのまま再現し、
--     DB 制約 (CHECK・trigger) と整合するかを検証する。「遷移可否そのもの」(canTransition の
--     判定) は facade 側の TypeScript 責務であり DB 側は判定しない ―― これは設計上の事実であって
--     漏れではない (下記 ⑥⑦ で明示的に検証・文書化する)。DB が実際に強制するのは
--     (a) 発行後の内容凍結 (E624)、(b) voided 後の完全凍結 (E621)、(c) 入金ありinvoiceの
--     取消拒否 (E621)、(d) doc_type と status の組み合わせ CHECK (accepted/declined/expired は
--     quote のみ・paid は invoice のみ) の 4 つのみ。
--   - deriveDocument の E623 判定 (派生元の許可表外・状態条件外) は facade ロジックのみで守られ
--     DB 側に対応する CHECK 制約は無い (source_document_id は documents.id への参照制約のみ)。
--     本ファイル ⑧ でこの事実を実際に INSERT して確認し、「facade の単体テスト
--     (tests/sales-facade.test.ts の deriveDocument E623 分岐) が実質的な唯一の防波堤である」
--     ことを記録する。
--   - service_role による直接 UPDATE で「発行済み」状態を模擬する手法は
--     sales-rls-numbering.sql §⑦ と同一 (documents_freeze_after_issue は old.status='draft' の
--     UPDATE を無条件に通す設計のため、1 回の UPDATE で発行系列を同時に埋めれば CHECK・trigger
--     のどちらにも抵触しない)。
--   - appendActivity の合成 ref 冪等性検証は crm-activities-idempotency-relink-digest.sql §① と
--     同型 (activities_ref_idem_uniq への on conflict do nothing → 0 行応答 → 既存行 SELECT で
--     回収する repository/facade の設計と同じプリミティブを直接 INSERT で再現)。
--   - 全体を 1 トランザクションに包み、末尾で必ず ROLLBACK する。
-- =========================================================

begin;

create temporary table sales_state_test_log (
  id serial primary key,
  section text not null,
  check_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);

create temporary table sales_state_test_fixture (
  key text primary key,
  id uuid not null
);

do $$ begin raise notice '=== sales #49 状態遷移/入金ガード/appendActivity冪等 結合検証 開始 (末尾で必ず ROLLBACK する) ==='; end $$;

-- =========================================================
-- 0. フィクスチャ準備 (service_role): customer/deal + admin profile 探索
-- =========================================================
do $$
declare
  v_customer_id uuid;
  v_deal_id uuid;
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into customers (kind, name, lifecycle, source)
    values ('person', '__sales_state_test__ 顧客', 'customer', 'manual')
    returning id into v_customer_id;
  insert into deals (title, customer_id, source)
    values ('__sales_state_test__ 案件', v_customer_id, 'manual')
    returning id into v_deal_id;
  insert into sales_state_test_fixture (key, id) values ('customer', v_customer_id), ('deal', v_deal_id);

  insert into sales_state_test_log (section, check_name, passed, detail)
    values ('0.fixture', 'service_role: customer/deal フィクスチャが作成できること', true,
            format('OK: customer=%s deal=%s', v_customer_id, v_deal_id));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('0.fixture', 'service_role: customer/deal フィクスチャ (以降全滅する重大失敗)', false,
              format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from profiles order by created_at asc limit 1;
  if v_admin_id is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('0.fixture', 'admin profile 探索', true,
              'SKIPPED: profiles に管理者行が無い環境。admin セッションを要する以降のチェックは全て SKIPPED になる');
  else
    insert into sales_state_test_fixture (key, id) values ('admin', v_admin_id);
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('0.fixture', 'admin profile 探索', true, format('OK: admin_id=%s', v_admin_id));
  end if;
end $$;

-- =========================================================
-- 1. 発行済みフィクスチャ 4 種 (service_role の直接 UPDATE — sales-rls-numbering.sql §⑦と同型):
--    issuedQuoteA (accept用) / issuedQuoteB (decline用) / issuedInvoiceNoPay (入金なし取消用) /
--    issuedInvoiceWithPay (入金あり取消拒否用、入金 1 件追加)
-- =========================================================
do $$
declare
  v_deal_id uuid;
  v_quote_a uuid;
  v_quote_b uuid;
  v_invoice_no_pay uuid;
  v_invoice_with_pay uuid;
  v_doc_no text;
begin
  select id into v_deal_id from sales_state_test_fixture where key = 'deal';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into documents (doc_type, deal_id, billing_name) values ('quote', v_deal_id, '__sales_state_test__ quoteA')
    returning id into v_quote_a;
  select doc_no into v_doc_no from public.document_number_next('quote', 2033);
  update documents set status='issued', doc_no=v_doc_no, current_version=1, issued_at=now(), issuer_snapshot='{}'::jsonb
    where id = v_quote_a;
  insert into sales_state_test_fixture (key, id) values ('quoteA', v_quote_a);

  insert into documents (doc_type, deal_id, billing_name) values ('quote', v_deal_id, '__sales_state_test__ quoteB')
    returning id into v_quote_b;
  select doc_no into v_doc_no from public.document_number_next('quote', 2033);
  update documents set status='issued', doc_no=v_doc_no, current_version=1, issued_at=now(), issuer_snapshot='{}'::jsonb
    where id = v_quote_b;
  insert into sales_state_test_fixture (key, id) values ('quoteB', v_quote_b);

  insert into documents (doc_type, deal_id, billing_name, total_jpy)
    values ('invoice', v_deal_id, '__sales_state_test__ invoice入金なし', 10000)
    returning id into v_invoice_no_pay;
  select doc_no into v_doc_no from public.document_number_next('invoice', 2033);
  update documents set status='issued', doc_no=v_doc_no, current_version=1, issued_at=now(), issuer_snapshot='{}'::jsonb
    where id = v_invoice_no_pay;
  insert into sales_state_test_fixture (key, id) values ('invoiceNoPay', v_invoice_no_pay);

  insert into documents (doc_type, deal_id, billing_name, total_jpy)
    values ('invoice', v_deal_id, '__sales_state_test__ invoice入金あり', 10000)
    returning id into v_invoice_with_pay;
  select doc_no into v_doc_no from public.document_number_next('invoice', 2033);
  update documents set status='issued', doc_no=v_doc_no, current_version=1, issued_at=now(), issuer_snapshot='{}'::jsonb
    where id = v_invoice_with_pay;
  insert into payments (document_id, paid_on, amount_jpy, method)
    values (v_invoice_with_pay, current_date, 3000, 'bank_transfer'); -- 部分入金 (issued のまま維持)
  insert into sales_state_test_fixture (key, id) values ('invoiceWithPay', v_invoice_with_pay);

  insert into sales_state_test_log (section, check_name, passed, detail)
    values ('1.発行フィクスチャ', 'service_role: quoteA/quoteB/invoiceNoPay/invoiceWithPay(部分入金3000) 作成', true,
            format('OK: %s / %s / %s / %s', v_quote_a, v_quote_b, v_invoice_no_pay, v_invoice_with_pay));

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('1.発行フィクスチャ', 'service_role: 発行済みフィクスチャ 4 種作成 (以降②〜⑦が全滅する重大失敗)', false,
              format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 2. acceptQuote 相当の CAS UPDATE (quoteA: issued→accepted)。facade.acceptQuote が発行する文と
--    完全に同型: `update documents set status=$1, status_reason=null, voided_at=null
--    where id=$2 and updated_at=$3 returning *`
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_quote_a uuid;
  v_before_updated_at timestamptz;
  v_row_count int;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_quote_a from sales_state_test_fixture where key = 'quoteA';
  if v_admin_id is null or v_quote_a is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('2.acceptQuote', 'quoteA: issued→accepted (CAS一致)', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select updated_at into v_before_updated_at from documents where id = v_quote_a;

  update documents set status = 'accepted', status_reason = null, voided_at = null
    where id = v_quote_a and updated_at = v_before_updated_at;
  get diagnostics v_row_count = row_count;

  if v_row_count = 1 and (select status from documents where id = v_quote_a) = 'accepted' then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('2.acceptQuote', 'quoteA: issued→accepted (CAS一致) は成功する', true, 'OK: 1行更新');
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('2.acceptQuote', 'quoteA: issued→accepted (CAS一致) は成功する', false, format('FAIL: row_count=%s', v_row_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('2.acceptQuote', 'quoteA: issued→accepted (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 3. CAS 不一致 (stale updated_at) は 0 行応答になる (facade.repository の resolveCasMiss 経路。
--    quoteB を対象に、わざと古い updated_at で declineQuote 相当の UPDATE を試みる)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_quote_b uuid;
  v_row_count int;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_quote_b from sales_state_test_fixture where key = 'quoteB';
  if v_admin_id is null or v_quote_b is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('3.CAS不一致', 'quoteB: stale updated_at での declineQuote 相当 UPDATE は 0 行', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  update documents set status = 'declined', status_reason = '__sales_state_test__ 辞退理由', voided_at = null
    where id = v_quote_b and updated_at = (now() - interval '1 hour'); -- 確実に不一致
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 and (select status from documents where id = v_quote_b) = 'issued' then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('3.CAS不一致', 'quoteB: stale updated_at での UPDATE は 0 行 (repository.resolveCasMiss が KMB-E103 に変換する前提)', true,
              'OK: 0行更新・status は issued のまま');
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('3.CAS不一致', 'quoteB: stale updated_at での UPDATE は 0 行', false, format('FAIL: row_count=%s', v_row_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('3.CAS不一致', 'quoteB: CAS不一致確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 4. declineQuote 相当の正当な CAS UPDATE (quoteB: issued→declined、status_reason 付き)
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_quote_b uuid;
  v_before_updated_at timestamptz;
  v_row_count int;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_quote_b from sales_state_test_fixture where key = 'quoteB';
  if v_admin_id is null or v_quote_b is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('4.declineQuote', 'quoteB: issued→declined (CAS一致・理由付き)', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select updated_at into v_before_updated_at from documents where id = v_quote_b;
  update documents set status = 'declined', status_reason = '__sales_state_test__ 辞退理由', voided_at = null
    where id = v_quote_b and updated_at = v_before_updated_at;
  get diagnostics v_row_count = row_count;

  if v_row_count = 1 and (select status, status_reason from documents where id = v_quote_b) is not distinct from ('declined', '__sales_state_test__ 辞退理由') then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('4.declineQuote', 'quoteB: issued→declined (CAS一致・理由付き) は成功する', true, 'OK');
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('4.declineQuote', 'quoteB: issued→declined (CAS一致・理由付き) は成功する', false, format('FAIL: row_count=%s', v_row_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('4.declineQuote', 'quoteB: declineQuote相当UPDATE (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 5. voidDocument 相当の CAS UPDATE — 入金なし invoice は成功する
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_invoice_no_pay uuid;
  v_before_updated_at timestamptz;
  v_row_count int;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_invoice_no_pay from sales_state_test_fixture where key = 'invoiceNoPay';
  if v_admin_id is null or v_invoice_no_pay is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('5.voidDocument', 'invoiceNoPay: issued→voided (入金なし) は成功する', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select updated_at into v_before_updated_at from documents where id = v_invoice_no_pay;
  update documents set status = 'voided', status_reason = '__sales_state_test__ 取消理由', voided_at = now()
    where id = v_invoice_no_pay and updated_at = v_before_updated_at;
  get diagnostics v_row_count = row_count;

  if v_row_count = 1 and (select status from documents where id = v_invoice_no_pay) = 'voided' then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('5.voidDocument', 'invoiceNoPay: issued→voided (入金なし) は成功する', true, 'OK');
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('5.voidDocument', 'invoiceNoPay: issued→voided (入金なし) は成功する', false, format('FAIL: row_count=%s', v_row_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('5.voidDocument', 'invoiceNoPay: void相当UPDATE (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 6. voidDocument 相当の CAS UPDATE — 【受入基準】入金ありの invoice は
--    documents_freeze_after_issue trigger により KMB-E621 で拒否される
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_invoice_with_pay uuid;
  v_before_updated_at timestamptz;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_invoice_with_pay from sales_state_test_fixture where key = 'invoiceWithPay';
  if v_admin_id is null or v_invoice_with_pay is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('6.voidDocument入金ガード', 'invoiceWithPay: issued→voided (入金あり) は KMB-E621 で拒否される', true,
              'SKIPPED: 前提フィクスチャなし');
    return;
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  select updated_at into v_before_updated_at from documents where id = v_invoice_with_pay;

  begin
    update documents set status = 'voided', status_reason = '__sales_state_test__ 入金あり取消試行', voided_at = now()
      where id = v_invoice_with_pay and updated_at = v_before_updated_at;
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('6.voidDocument入金ガード', 'invoiceWithPay: issued→voided (入金あり) は KMB-E621 で拒否される', false,
              'FAIL: 更新できてしまった (入金存在ガードが機能していない)');
  exception
    when others then
      if sqlerrm like '%KMB-E621%' then
        insert into sales_state_test_log (section, check_name, passed, detail)
          values ('6.voidDocument入金ガード', 'invoiceWithPay: issued→voided (入金あり) は KMB-E621 で拒否される', true,
                  format('OK: %s', sqlerrm));
      else
        insert into sales_state_test_log (section, check_name, passed, detail)
          values ('6.voidDocument入金ガード', 'invoiceWithPay: issued→voided (入金あり) は KMB-E621 で拒否される', false,
                  format('FAIL: 想定外のエラー (E621 を含まない): %s', sqlerrm));
      end if;
  end;

  -- 拒否後も status は issued のまま (部分更新されていないこと)
  if (select status from documents where id = v_invoice_with_pay) = 'issued' then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('6.voidDocument入金ガード', 'invoiceWithPay: 拒否後も status は issued のまま (トランザクション境界で巻き戻る)', true, 'OK');
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('6.voidDocument入金ガード', 'invoiceWithPay: 拒否後も status は issued のまま', false,
              format('FAIL: status=%s', (select status from documents where id = v_invoice_with_pay)));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('6.voidDocument入金ガード', '入金ありinvoice取消拒否確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 7. voided は完全終端: ⑤で voided にした invoiceNoPay へのその後の状態系 UPDATE (accepted 等
--    無意味な値であっても) は KMB-E621 で全拒否される
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_invoice_no_pay uuid;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_invoice_no_pay from sales_state_test_fixture where key = 'invoiceNoPay';
  if v_admin_id is null or v_invoice_no_pay is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('7.voided終端', 'voided後の再UPDATE (どんな値でも) は KMB-E621', true, 'SKIPPED: 前提フィクスチャなし');
    return;
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  begin
    update documents set status_reason = '__sales_state_test__ voided後の再更新試行' where id = v_invoice_no_pay;
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('7.voided終端', 'voided後の再UPDATE (どんな値でも) は KMB-E621', false, 'FAIL: 更新できてしまった');
  exception
    when others then
      if sqlerrm like '%KMB-E621%' then
        insert into sales_state_test_log (section, check_name, passed, detail)
          values ('7.voided終端', 'voided後の再UPDATE (どんな値でも) は KMB-E621', true, format('OK: %s', sqlerrm));
      else
        insert into sales_state_test_log (section, check_name, passed, detail)
          values ('7.voided終端', 'voided後の再UPDATE (どんな値でも) は KMB-E621', false,
                  format('FAIL: 想定外のエラー (E621を含まない): %s', sqlerrm));
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('7.voided終端', 'voided終端確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 8. 【設計境界の文書化】canTransition の遷移可否そのものは facade (TypeScript) のみが判定し、
--    DB は「doc_type × status の組み合わせ CHECK」しか強制しない。これを 2 パターンで実測する:
--    (a) CHECK 制約が実際に効くケース (order の status を 'accepted' にする — 契約上 quote 限定)
--    (b) CHECK 制約が効かない (=DB は許してしまう) ケース (quote を draft→voided に直接 UPDATE —
--        §4.1 図にこのエッジは無いが、old.status='draft' 分岐は無条件に通すため DB は拒否しない)
--    (b) は「FAIL」ではなく「facade の canTransition 単体テスト (tests/sales-doc-state.test.ts) が
--    実質的な唯一の防波堤である」という設計事実の記録として passed=true でログする。
-- =========================================================
do $$
declare
  v_admin_id uuid;
  v_deal_id uuid;
  v_order_id uuid;
  v_doc_no text;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_deal_id from sales_state_test_fixture where key = 'deal';
  if v_admin_id is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(a) order(issued)へstatus=''accepted''のUPDATEはCHECK制約で拒否される', true, 'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into documents (doc_type, deal_id, billing_name) values ('order', v_deal_id, '__sales_state_test__ order (CHECK確認用)')
    returning id into v_order_id;
  select doc_no into v_doc_no from public.document_number_next('order', 2033);
  update documents set status='issued', doc_no=v_doc_no, current_version=1, issued_at=now(), issuer_snapshot='{}'::jsonb
    where id = v_order_id;
  insert into sales_state_test_fixture (key, id) values ('orderForCheck', v_order_id);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);

  begin
    update documents set status = 'accepted' where id = v_order_id;
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(a) order(issued)へstatus=''accepted''のUPDATEはCHECK制約で拒否される', false,
              'FAIL: 更新できてしまった (doc_type×status CHECK が機能していない)');
  exception
    when check_violation then
      insert into sales_state_test_log (section, check_name, passed, detail)
        values ('8.設計境界', '(a) order(issued)へstatus=''accepted''のUPDATEはCHECK制約で拒否される', true,
                format('OK: check_violation (%s)', sqlerrm));
    when others then
      insert into sales_state_test_log (section, check_name, passed, detail)
        values ('8.設計境界', '(a) order(issued)へstatus=''accepted''のUPDATEはCHECK制約で拒否される', false,
                format('FAIL: 想定外のエラー種別 (check_violation を期待): %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(a) CHECK制約確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

do $$
declare
  v_admin_id uuid;
  v_deal_id uuid;
  v_draft_quote uuid;
  v_row_count int;
begin
  select id into v_admin_id from sales_state_test_fixture where key = 'admin';
  select id into v_deal_id from sales_state_test_fixture where key = 'deal';
  if v_admin_id is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(b) quote(draft)→voided の直接UPDATEはDB側では拒否されない (facade単体テストが唯一の防波堤)', true,
              'SKIPPED: 管理者行なし');
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_admin_id::text), true);
  insert into documents (doc_type, deal_id, billing_name) values ('quote', v_deal_id, '__sales_state_test__ draft→voided確認用')
    returning id into v_draft_quote;

  update documents set status = 'voided', status_reason = '__sales_state_test__ draftから直接voided', voided_at = now()
    where id = v_draft_quote;
  get diagnostics v_row_count = row_count;

  -- CHECK/trigger のどちらにも抵触せず成功してしまう想定 (§4.1 図に無いエッジだが DB は拒否しない)。
  -- これは「バグ」ではなく「facade の canTransition が唯一の防波堤である」設計事実の記録。
  if v_row_count = 1 then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(b) quote(draft)→voided の直接UPDATEはDB側では拒否されない (facade単体テストが唯一の防波堤)', true,
              'OK (想定どおり): DB は拒否せず 1 行更新できた。tests/sales-doc-state.test.ts の ' ||
              'canTransition("quote","draft","voided")===false と tests/sales-facade.test.ts の voidDocument E621 分岐が ' ||
              '実運用でこのエッジを塞ぐ唯一の層であることを示す');
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(b) quote(draft)→voided の直接UPDATE挙動確認', false,
              format('FAIL: 想定と異なり row_count=%s (DB側の挙動が変化した可能性 — 要再確認)', v_row_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('8.設計境界', '(b) draft→voided挙動確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 9. 【設計境界の文書化】deriveDocument の E623 (許可表外・状態条件外の派生) も DB 側に対応する
--    CHECK は無い (source_document_id は documents.id への参照制約のみ)。draft 状態の quote を
--    参照する draft (= facade なら E623 で拒否するケース) が生 INSERT では成功することを確認し、
--    「facade の deriveDocument E623 分岐 (tests/sales-facade.test.ts) が唯一の防波堤である」ことを
--    記録する
-- =========================================================
do $$
declare
  v_deal_id uuid;
  v_draft_source uuid;
  v_derived uuid;
begin
  select id into v_deal_id from sales_state_test_fixture where key = 'deal';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into documents (doc_type, deal_id, billing_name) values ('quote', v_deal_id, '__sales_state_test__ E623確認用draft派生元')
    returning id into v_draft_source;

  begin
    insert into documents (doc_type, deal_id, source_document_id, billing_name)
      values ('order', v_deal_id, v_draft_source, '__sales_state_test__ draft元からの派生 (facadeならE623)')
      returning id into v_derived;
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('9.設計境界', 'deriveDocumentのE623 (draft状態の派生元) はDB側では拒否されない (facade単体テストが唯一の防波堤)', true,
              format('OK (想定どおり): DB は拒否せず INSERT できた (derived=%s)。tests/sales-facade.test.ts の ' ||
                     'deriveDocument E623 分岐 (draft状態) が実運用でこのケースを塞ぐ唯一の層であることを示す', v_derived));
  exception
    when others then
      insert into sales_state_test_log (section, check_name, passed, detail)
        values ('9.設計境界', 'deriveDocumentのE623挙動確認 (予期せぬ失敗)', false,
                format('FAIL: 想定と異なりINSERTが例外になった (DB側にCHECKが追加された可能性 — 要再確認): %s', sqlerrm));
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('9.設計境界', 'deriveDocument E623確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- 10. appendActivity 合成 ref の冪等性 (crm-activities-idempotency-relink-digest.sql §①と同型)。
--     recordDocumentEventActivity が使う (activity_type='document_event',
--     ref_table='documents/{event}', ref_id=document_id) の組を activities_ref_idem_uniq へ
--     二重 INSERT し、2 回目が 0 行応答 (on conflict do nothing) になることを確認する
-- =========================================================
do $$
declare
  v_quote_a uuid;
  v_activity_1 uuid;
  v_activity_2 uuid;
  v_count int;
begin
  select id into v_quote_a from sales_state_test_fixture where key = 'quoteA';
  if v_quote_a is null then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('10.appendActivity冪等', 'documents/accepted 合成refの二重INSERTは2回目0行 (activities_ref_idem_uniq)', true,
              'SKIPPED: quoteA フィクスチャなし');
    return;
  end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into activities (activity_type, occurred_at, title, payload, ref_table, ref_id)
    values ('document_event', now(), '__sales_state_test__ 見積承諾',
            jsonb_build_object('document_id', v_quote_a, 'doc_type', 'quote', 'doc_no', 'Q-2033-0001',
                                'event', 'accepted', 'total_jpy', 0, 'version', null),
            format('documents/%s', 'accepted'), v_quote_a)
    returning id into v_activity_1;

  insert into activities (activity_type, occurred_at, title, payload, ref_table, ref_id)
    values ('document_event', now(), '__sales_state_test__ 見積承諾(2回目送信)',
            jsonb_build_object('document_id', v_quote_a, 'doc_type', 'quote', 'doc_no', 'Q-2033-0001',
                                'event', 'accepted', 'total_jpy', 0, 'version', null),
            format('documents/%s', 'accepted'), v_quote_a)
    on conflict (activity_type, ref_table, ref_id) do nothing
    returning id into v_activity_2;

  select count(*) into v_count from activities
    where activity_type = 'document_event' and ref_table = 'documents/accepted' and ref_id = v_quote_a;

  if v_activity_2 is null and v_count = 1 then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('10.appendActivity冪等', 'documents/accepted 合成refの二重INSERTは2回目0行 (activities_ref_idem_uniq)', true,
              format('OK: 1回目 id=%s, 2回目は競合で0行, 行数=%s', v_activity_1, v_count));
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('10.appendActivity冪等', 'documents/accepted 合成refの二重INSERTは2回目0行 (activities_ref_idem_uniq)', false,
              format('FAIL: 2回目のid=%s (null期待), 行数=%s (1期待)', v_activity_2, v_count));
  end if;

  -- 同一 document の別イベント (ref_table が異なる) は衝突しない (documents/accepted と
  -- documents/declined は composite ref の第2要素が異なるため別レコードとして共存できる)
  insert into activities (activity_type, occurred_at, title, payload, ref_table, ref_id)
    values ('document_event', now(), '__sales_state_test__ 別イベント(declined)扱いの確認',
            jsonb_build_object('document_id', v_quote_a, 'doc_type', 'quote', 'doc_no', 'Q-2033-0001',
                                'event', 'declined', 'total_jpy', 0, 'version', null),
            'documents/declined', v_quote_a);
  select count(*) into v_count from activities where ref_id = v_quote_a and activity_type = 'document_event';
  if v_count = 2 then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('10.appendActivity冪等', '同一documentでもref_table(event)が異なれば別レコードとして共存する', true,
              format('OK: 合計%s件 (accepted 1 + declined 1)', v_count));
  else
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('10.appendActivity冪等', '同一documentでもref_table(event)が異なれば別レコードとして共存する', false,
              format('FAIL: 合計%s件 (2件を期待)', v_count));
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
exception
  when others then
    insert into sales_state_test_log (section, check_name, passed, detail)
      values ('10.appendActivity冪等', 'appendActivity冪等性確認 (予期せぬ失敗)', false, format('FAIL: %s', sqlerrm));
    reset role;
end $$;

-- =========================================================
-- サマリ (このトランザクションは末尾で必ず ROLLBACK するため、上記の全書き込みは破棄される)
-- =========================================================
do $$
declare
  v_total int;
  v_failed int;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from sales_state_test_log;
  raise notice '=== sales #49 状態遷移/入金ガード/appendActivity冪等 結合検証 終了: 全 % 件中 % 件失敗 ===', v_total, v_failed;
end $$;

select id, section, check_name, passed, detail
from sales_state_test_log
order by id;

rollback;
