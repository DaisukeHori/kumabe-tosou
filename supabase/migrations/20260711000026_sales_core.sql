-- 20260711000026_sales_core.sql
-- canonical: docs/design/crm-suite/02-sales.md §2.3.1 (裁定 J5)
-- 本 migration が追加するもの:
--   1. documents (帳票ヘッダ。4 種別×7 状態、発行後凍結 trigger、列単位 UPDATE grant)
--   2. document_lines (明細スナップショット。税額カラムなし — J5 の構造的強制)
--   3. payments (入金記録。消込 trigger が documents.status paid⇔issued を維持)
--   4. RPC document_save_draft (draft 保存の原子化 — v1.1)
-- 前提: 0021 (is_admin_or_service) / 0022 (document_number_next) / 0023 (deals) 適用済み
-- 設計判断の記録:
--   - 金額は bigint (zJpyAmount max 9,999,999,999 > int4)。値制約 (上限等) は Zod が正 (DDL は構造のみ)
--   - doc_no は draft で null、発行後は不変 (check + 凍結 trigger + 列 grant 除外の 3 重)
--   - payments に updated_at なし (不変。訂正 = DELETE + 再 INSERT — 00-overview §5.2)
--   - grant は必ず revoke all from anon, authenticated を先行 (v1.1 — default privileges の
--     テーブルレベル grant が残ると列単位 UPDATE grant が無効化される。0020/0022 の教訓の完全適用)

-- ---------- documents ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('quote', 'order', 'delivery', 'invoice')),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'accepted', 'declined', 'expired', 'paid', 'voided')),
  deal_id uuid not null references deals(id),
  source_document_id uuid references documents(id),  -- 派生元 (null = 起点)。on delete 制約なし (draft 削除時も系譜は残す → 参照先が draft 削除されるケースは派生規則上発生しない: 派生元は issued のみ)
  doc_no text unique,                                -- 発行時に document_number_next (M0 0022) で採番
  current_version int not null default 0 check (current_version >= 0),
  issue_date date,                                   -- JST 発行日 (書類の作成・交付日。取引年月日とは分離 — v1.1)
  transaction_date date,                             -- 取引年月日 (納品日/役務提供完了日 — v1.1。null = issue_date と同日扱い。
                                                     --   インボイス必須記載事項 2 と電帳法台帳 transaction_date の源。
                                                     --   「納品後、月末に請求」で発行日と取引日がずれるため issue_date と別列)
  valid_until date,                                  -- quote のみ (有効期限)
  billing_name text not null,                        -- 宛名スナップショット (作成時に deal の顧客/会社から複製、draft 中編集可)
  billing_suffix text not null default '様' check (billing_suffix in ('様', '御中')),
  billing_address text,
  site_name text,                                    -- 現場名 (塗装業慣行 — ext-hubspot B-11)
  site_address text,
  notes text,                                        -- 備考 (帳票に印字)
  tax_rounding text not null default 'floor' check (tax_rounding in ('floor', 'round', 'ceil')),
    -- 作成時に settings 'invoice_issuer'.tax_rounding を複製 (書類ごとに確定 — 設定変更が既存書類に波及しない)
  subtotal_jpy bigint not null default 0,            -- 税抜小計 (draft は保存ごと再計算、発行時に凍結)
  tax_summary jsonb not null default '[]',           -- zTaxSummary (書類×税率スナップショット — J5)
  total_jpy bigint not null default 0,               -- 税込合計
  issuer_snapshot jsonb,                             -- zIssuerSnapshot (発行時に settings から合成。draft は null)
  status_reason text,                                -- declined / voided の理由 (voided は必須 — facade 検証)
  issued_at timestamptz,                             -- 初回発行時刻 (以後不変)
  paid_at timestamptz,                               -- invoice 完済時刻 (payments trigger が維持)
  voided_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (doc_type = 'quote' or valid_until is null),
  check (status not in ('accepted', 'declined', 'expired') or doc_type = 'quote'),
  check (status <> 'paid' or doc_type = 'invoice'),
  check ((status = 'draft') = (doc_no is null)),
  check ((status = 'draft') = (issued_at is null)),
  check ((status = 'draft') = (current_version = 0)),
  check ((status = 'draft') = (issuer_snapshot is null))
);

comment on table documents is
  '帳票 (見積/受注/納品/請求)。派生は明細複製スナップショット、発行後は内容凍結 (KMB-E624)。canonical: 02-sales.md §2';
comment on column documents.tax_summary is
  '税率区分別の集計スナップショット (zTaxSummary)。消費税は書類×税率ごと 1 回丸め — 明細行に税額を持たない (裁定 J5)';
comment on column documents.current_version is
  '発行版番号 (0=未発行)。issued_documents (document_id, version) と 1:1。RPC のみが更新';

create index documents_deal_idx on documents (deal_id);
create index documents_type_status_idx on documents (doc_type, status);
create index documents_issue_date_idx on documents (issue_date desc);
create index documents_created_idx on documents (created_at desc, id desc); -- keyset 一覧

create trigger handle_updated_at before update on documents
  for each row execute function extensions.moddatetime(updated_at);

-- 発行後凍結 trigger (KMB-E624)。訂正は document_apply_revision (0027) が
-- transaction-local GUC 'kmb.sales_revision_unlock' を立てて通過する
create or replace function public.documents_freeze_after_issue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'draft' then
    return new; -- draft 中は自由 (発行遷移 draft→issued もここを通る)
  end if;
  if old.status = 'voided' then
    raise exception 'KMB-E621: 取消済みの帳票は変更できません';
  end if;
  -- 入金記録のある invoice の取消を DB レベルで拒否 (v1.1 — facade の入金 0 件チェックと
  -- 部分入金 INSERT の TOCTOU レース対策。payments_apply の FOR UPDATE と本 UPDATE の
  -- 行ロックが直列化するため、この判定は常に最新の payments を見る)
  if new.status = 'voided' and old.doc_type = 'invoice'
     and exists (select 1 from payments where document_id = new.id) then
    raise exception 'KMB-E621: 入金記録のある請求書は取消できません (先に入金記録を削除してください)';
  end if;
  if coalesce(current_setting('kmb.sales_revision_unlock', true), '') = 'on' then
    return new; -- 訂正 RPC 経由のみ (0027 document_apply_revision)
  end if;
  -- 凍結対象外 = status / status_reason / voided_at / paid_at / current_version / updated_at
  if new.doc_type is distinct from old.doc_type
     or new.deal_id is distinct from old.deal_id
     or new.source_document_id is distinct from old.source_document_id
     or new.doc_no is distinct from old.doc_no
     or new.issue_date is distinct from old.issue_date
     or new.transaction_date is distinct from old.transaction_date
     or new.valid_until is distinct from old.valid_until
     or new.billing_name is distinct from old.billing_name
     or new.billing_suffix is distinct from old.billing_suffix
     or new.billing_address is distinct from old.billing_address
     or new.site_name is distinct from old.site_name
     or new.site_address is distinct from old.site_address
     or new.notes is distinct from old.notes
     or new.tax_rounding is distinct from old.tax_rounding
     or new.subtotal_jpy is distinct from old.subtotal_jpy
     or new.tax_summary is distinct from old.tax_summary
     or new.total_jpy is distinct from old.total_jpy
     or new.issuer_snapshot is distinct from old.issuer_snapshot
     or new.issued_at is distinct from old.issued_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'KMB-E624: 発行済み帳票の内容は変更できません (訂正は新版発行で行ってください)';
  end if;
  return new;
end;
$$;

create trigger documents_freeze_after_issue before update on documents
  for each row execute function public.documents_freeze_after_issue();

-- RLS: admin データ分類 (0015 パターン: 4 ポリシー + 明示 revoke/grant)
alter table documents enable row level security;

create policy documents_admin_select on documents
  for select using (public.is_admin());
create policy documents_admin_insert on documents
  for insert with check (public.is_admin() and status = 'draft');
create policy documents_admin_update on documents
  for update using (public.is_admin()) with check (public.is_admin());
create policy documents_admin_delete on documents
  for delete using (public.is_admin() and status = 'draft'); -- 発行後の DELETE 不可 (7 年保存)

-- v1.1: authenticated も必ず revoke する。default privileges のテーブルレベル ALL grant が
-- 残ったままだと (grant は加算的なため) 下の列単位 UPDATE grant が制限として機能しない
-- (0020 の実証 + M0 0022 document_sequences と同パターン)
revoke all on documents from anon, authenticated;
grant select, insert, delete on documents to authenticated;
-- 列単位 UPDATE grant: 採番/版/発行スナップショット系 (doc_no, current_version, issuer_snapshot,
-- issued_at, paid_at) は session から書けない (RPC/trigger 専用 — 構造的強制。
-- 上の revoke により列外 UPDATE は permission denied になる)
grant update (status, status_reason, voided_at, issue_date, transaction_date, valid_until,
              billing_name, billing_suffix, billing_address,
              site_name, site_address, notes, tax_rounding,
              subtotal_jpy, tax_summary, total_jpy)
  on documents to authenticated;

-- ---------- document_lines ----------
-- 明細スナップショット。税額カラムは存在しない (裁定 J5 の DDL レベル強制。
-- contracts-ddl-parity テストが「tax を含む列名の不存在」を検証する — §13.2)
create table document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  position int not null check (position >= 0),
  description text not null,
  quantity numeric(8,2) not null check (quantity > 0),
  unit text not null,                                -- 個 / 式 / ㎡ / m / 缶 …
  unit_price_jpy bigint not null,                    -- 負 = 値引き行 (リピート免除等)
  amount_jpy bigint not null,                        -- 既定 = round(quantity × unit_price)。編集可 (税抜)
  tax_category text not null
    check (tax_category in ('standard_10', 'reduced_8', 'zero', 'exempt')),
  work_type_key text,                                -- scheduling ブロック生成ヒント (FK なし — 疎結合)
  source jsonb,                                      -- pricing 由来スナップショット {grade_key, size_key, option_keys} (nullable)
  created_at timestamptz not null default now(),
  unique (document_id, position)
);

comment on table document_lines is
  '帳票明細 (スナップショット)。税額カラムを持たない — 税は書類×税率ごと 1 回丸め (裁定 J5)。draft 保存は全行置換 (delete+insert)';

create index document_lines_document_idx on document_lines (document_id, position);

-- 親が draft のときのみ書き込み可 (発行後の明細不変 — KMB-E624)。
-- 訂正 RPC は GUC で通過。親 DELETE の cascade 中は親行が見えなくなるため素通し
create or replace function public.document_lines_draft_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from documents
    where id = coalesce(new.document_id, old.document_id);
  if v_status is null then
    return coalesce(new, old); -- 親 cascade 削除中
  end if;
  if v_status <> 'draft'
     and coalesce(current_setting('kmb.sales_revision_unlock', true), '') <> 'on' then
    raise exception 'KMB-E624: 発行済み帳票の明細は変更できません';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger document_lines_draft_guard
  before insert or update or delete on document_lines
  for each row execute function public.document_lines_draft_guard();

alter table document_lines enable row level security;
create policy document_lines_admin_select on document_lines
  for select using (public.is_admin());
create policy document_lines_admin_insert on document_lines
  for insert with check (public.is_admin());
create policy document_lines_admin_update on document_lines
  for update using (public.is_admin()) with check (public.is_admin());
create policy document_lines_admin_delete on document_lines
  for delete using (public.is_admin());
revoke all on document_lines from anon, authenticated; -- v1.1: revoke 先行の統一規約 (documents と同旨)
grant select, insert, update, delete on document_lines to authenticated;

-- ---------- payments ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id), -- invoice のみ (trigger 検証)。cascade なし (issued は削除不可)
  paid_on date not null,                              -- 入金日 (JST)
  amount_jpy bigint not null check (amount_jpy > 0),
  method text not null check (method in ('bank_transfer', 'cash', 'other')),
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

comment on table payments is
  '入金記録 (手動消込 — 銀行 API 連携はスコープ外)。不変 (訂正 = DELETE + 再 INSERT)。trigger が残高検証 (KMB-E625) と documents.status paid⇔issued を維持';

create index payments_document_idx on payments (document_id);
create index payments_paid_on_idx on payments (paid_on desc);

-- 消込 trigger: 親 invoice を FOR UPDATE で直列化し、残高超過拒否 + 完済/復帰の状態維持。
-- security definer — paid_at 列は session の UPDATE grant 外のため (documents の列 grant 参照)
create or replace function public.payments_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents%rowtype;
  v_sum bigint;
begin
  select * into v_doc from documents
    where id = coalesce(new.document_id, old.document_id)
    for update; -- 同時入金を直列化 (advisory lock 禁止 — pgbouncer)
  if not found then
    raise exception 'KMB-E623: 対象の請求書が見つかりません';
  end if;
  if v_doc.doc_type <> 'invoice' then
    raise exception 'KMB-E623: 入金は請求書 (invoice) にのみ記録できます';
  end if;

  if tg_op = 'INSERT' then
    if v_doc.status not in ('issued', 'paid') then
      raise exception 'KMB-E621: 発行済みの請求書にのみ入金を記録できます (現在: %)', v_doc.status;
    end if;
    select coalesce(sum(amount_jpy), 0) into v_sum
      from payments where document_id = new.document_id;
    if v_sum + new.amount_jpy > v_doc.total_jpy then
      raise exception 'KMB-E625: 入金合計が請求金額を超えます (残高 % 円)',
        v_doc.total_jpy - v_sum;
    end if;
    if v_sum + new.amount_jpy = v_doc.total_jpy then
      update documents set status = 'paid', paid_at = now()
        where id = new.document_id;
    end if;
    return new;
  else -- DELETE
    if v_doc.status = 'voided' then
      raise exception 'KMB-E621: 取消済みの請求書の入金記録は変更できません';
    end if;
    select coalesce(sum(amount_jpy), 0) into v_sum
      from payments where document_id = old.document_id and id <> old.id;
    if v_doc.status = 'paid' and v_sum < v_doc.total_jpy then
      update documents set status = 'issued', paid_at = null
        where id = old.document_id;
    end if;
    return old;
  end if;
end;
$$;

create trigger payments_apply before insert or delete on payments
  for each row execute function public.payments_apply();

alter table payments enable row level security;
create policy payments_admin_select on payments
  for select using (public.is_admin());
create policy payments_admin_insert on payments
  for insert with check (public.is_admin());
create policy payments_admin_delete on payments
  for delete using (public.is_admin());
-- v1.1: authenticated からも revoke 先行。これにより「UPDATE grant なし = 不変」が
-- permission denied として実際に強制される (revoke なしでは default privileges の UPDATE grant が
-- 残り、RLS ポリシー不在の 0 行更新で静かに素通りするだけだった)
revoke all on payments from anon, authenticated;
grant select, insert, delete on payments to authenticated; -- UPDATE grant なし (不変)

-- ---------- RPC: draft 保存 (CAS + ヘッダ + 明細全行置換の原子化 — v1.1) ----------
-- PostgREST 経由の複数ステートメント (delete → insert → update) は独立トランザクションで
-- 原子性がなく、(a) 明細置換が CAS 検証前に適用される楽観排他の破れ、(b) delete 成功後の
-- insert 失敗による明細全消失、が起き得るため RPC 化する。GUC 不要 (draft は凍結対象外)
create or replace function public.document_save_draft(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_header jsonb,      -- zUpdateDraftDocumentInput のヘッダ部 (lines を除く全キー必須で渡す)
  p_lines jsonb,       -- zDocumentLineInput[] (配列順 = position。RPC が ordinality で採番 — 契約に position は無い)
  p_subtotal_jpy bigint,
  p_tax_summary jsonb,
  p_total_jpy bigint
)
returns table (new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_save_draft requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'KMB-E624: 発行済み帳票の内容は変更できません (訂正は新版発行で行ってください)';
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;

  update documents set
    issue_date = (p_header->>'issue_date')::date,
    transaction_date = (p_header->>'transaction_date')::date,
    valid_until = (p_header->>'valid_until')::date,
    billing_name = p_header->>'billing_name',
    billing_suffix = p_header->>'billing_suffix',
    billing_address = p_header->>'billing_address',
    site_name = p_header->>'site_name',
    site_address = p_header->>'site_address',
    notes = p_header->>'notes',
    tax_rounding = p_header->>'tax_rounding',
    subtotal_jpy = p_subtotal_jpy,
    tax_summary = p_tax_summary,
    total_jpy = p_total_jpy
  where id = p_document_id;

  delete from document_lines where document_id = p_document_id;
  insert into document_lines
    (document_id, position, description, quantity, unit,
     unit_price_jpy, amount_jpy, tax_category, work_type_key, source)
  select
    p_document_id,
    (t.ord - 1)::int,
    t.elem->>'description',
    (t.elem->>'quantity')::numeric,
    t.elem->>'unit',
    (t.elem->>'unit_price_jpy')::bigint,
    (t.elem->>'amount_jpy')::bigint,
    t.elem->>'tax_category',
    t.elem->>'work_type_key',
    nullif(t.elem->'source', 'null'::jsonb)
  from jsonb_array_elements(p_lines) with ordinality as t(elem, ord);
  -- p_lines 0 件は許容 (quote_only 原案 — §2.4 パターン 5。発行時 E620 で止まる)

  return query select d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_save_draft(uuid, timestamptz, jsonb, jsonb, bigint, jsonb, bigint) from public, anon;
grant execute on function public.document_save_draft(uuid, timestamptz, jsonb, jsonb, bigint, jsonb, bigint) to authenticated;
