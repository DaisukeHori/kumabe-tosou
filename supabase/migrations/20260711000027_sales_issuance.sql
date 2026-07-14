-- 20260711000027_sales_issuance.sql
-- canonical: docs/design/crm-suite/02-sales.md §2.3.2 (裁定 J5 — 電帳法 append-only 台帳)
-- 本 migration が追加するもの:
--   1. issued_documents 台帳 (append-only: RLS 書込ポリシーなし + revoke + trigger で
--      service_role さえ UPDATE/DELETE 拒否。真実性の確保 — ext-hubspot B-12)
--   2. Storage bucket 'issued-documents' (private、ポリシーなし = service 専用 + 署名 URL 配布)
--      + storage.objects の不変 trigger (v1.1 — service_role の UPDATE/DELETE も構造的に拒否)
--   3. service 専用補助テーブル 3 種 (v1.1): print_tokens (ワンタイム消費 §7.3) /
--      pdf_render_lock (PDF 直列化 lease §7.4-1) / document_revision_stagings (訂正 staging §4.3-B)
--   4. RPC: document_finalize_issue / document_append_version / document_apply_revision
--      (発行・版追加・訂正の原子性を担保。#variable_conflict use_column 必須 — 0019 教訓)
-- 前提: 0026 適用済み

-- ---------- issued_documents ----------
create table issued_documents (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  doc_no text not null,                              -- zDocumentNo (Q/J/D/I-YYYY-NNNN)
  doc_type text not null check (doc_type in ('quote', 'order', 'delivery', 'invoice')),
  version int not null check (version >= 1),         -- 1 始まり。documents.current_version と 1:1
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), -- PDF の SHA-256 (hex)
  transaction_date date not null,                    -- 取引年月日 (電帳法 検索 3 項目 その 1)
  counterparty text not null,                        -- 取引先 (検索 3 項目 その 2) = billing_name
  total_jpy bigint not null,                         -- 金額 (検索 3 項目 その 3、税込)
  storage_path text not null unique,                 -- documents/{document_id}/v{n}-{sha256 先頭8}.pdf
  supersedes uuid references issued_documents(id),   -- 置き換える旧版の行 (v1 は null)。旧行は不変
  content_snapshot jsonb not null,                   -- zIssuedContentSnapshot (版差分表示 §11 + 積上げ計算根拠 B-4)
  issued_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (document_id, version)
);

comment on table issued_documents is
  '電帳法 発行控え台帳。append-only (UPDATE/DELETE は trigger で全ロール拒否)。訂正は新行の supersedes が旧行を参照。7 年保存 = 物理削除機能を持たない';
comment on column issued_documents.content_snapshot is
  '発行時点の帳票内容の完全スナップショット (zIssuedContentSnapshot — 02-sales.md §5.2)。版間差分表示 (§11) と消費税積上げ計算の根拠資料に使う';

create index issued_documents_search_idx
  on issued_documents (transaction_date, total_jpy);           -- 電帳法 検索 3 項目 (範囲)
create index issued_documents_counterparty_idx
  on issued_documents (counterparty);                          -- 取引先検索
create index issued_documents_doc_no_idx on issued_documents (doc_no);

-- append-only の物理強制 (service_role は RLS を bypass するため trigger で守る — gap-pdf §5)
create or replace function public.issued_documents_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'KMB-E627: issued_documents は append-only です (訂正は新版の追加で行う)';
end;
$$;

create trigger issued_documents_append_only
  before update or delete on issued_documents
  for each row execute function public.issued_documents_append_only();

alter table issued_documents enable row level security;
create policy issued_documents_admin_select on issued_documents
  for select using (public.is_admin());
-- INSERT/UPDATE/DELETE ポリシーは作らない (書込は下記 security definer RPC のみ)
revoke all on issued_documents from anon, authenticated; -- v1.1: revoke 先行の統一規約 (0026 と同旨)
grant select on issued_documents to authenticated;

-- ---------- Storage bucket ----------
insert into storage.buckets (id, name, public)
values ('issued-documents', 'issued-documents', false)
on conflict (id) do nothing;
-- ポリシーは一切作らない: 書込は service client (RLS bypass) + upsert:false 固定、
-- 閲覧は service が発行する署名 URL のみ (公開バケット列挙の教訓 0006 / call-audio と同分類)。
-- 00-overview §5.4 の「INSERT ポリシーのみ (UPDATE/DELETE を作らない)」の安全側解釈:
-- 直接アップロード経路を持たないため INSERT ポリシー自体も不要 — 禁止要件 (UPDATE/DELETE
-- ポリシーを作らない) は満たす。

-- 発行済み PDF の不変性を構造で強制 (v1.1): service_role は RLS を bypass するため、
-- 「ポリシーを作らない + upsert:false 規約」だけでは将来の service 経路・保守スクリプトの
-- 誤上書き/削除を防げない。issued_documents 台帳と同水準の trigger ガードを storage.objects に置く
create or replace function public.issued_documents_storage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(old.bucket_id, '') = 'issued-documents' then
    raise exception 'KMB-E627: issued-documents バケットのオブジェクトは変更・削除できません (電帳法 7 年不変保存)';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger issued_documents_storage_guard
  before update or delete on storage.objects
  for each row execute function public.issued_documents_storage_guard();
-- 適用注意: storage.objects への trigger 作成には storage スキーマの権限が必要。
-- supabase migration (postgres ロール) で失敗する場合は Studio SQL (supabase_storage_admin) で
-- 同文を適用し、適用済みであることを 14.2-1 の手順で確認する

-- ---------- print_tokens (印刷トークンのワンタイム消費 — v1.1、§7.3) ----------
create table print_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'), -- sha256(トークン全文) の hex
  document_id uuid not null references documents(id),
  purpose text not null check (purpose in ('pdf', 'preview')),       -- pdf = 発行/再出力/訂正の撮影用、preview = admin 印刷プレビュー
  payload jsonb,                                                     -- {doc_no} (発行フロー) / {staging_id} (訂正フロー)。null = 現 DB 値のみ描画
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table print_tokens is
  '/print 用トークンのワンタイム消費台帳 (v1.1 — 02-sales.md §7.3)。発行 = internal/print-token.ts、消費 = /print route (どちらも service client)。期限切れ行は発行時にベストエフォート掃除';
alter table print_tokens enable row level security;
revoke all on print_tokens from anon, authenticated; -- ポリシーなし + revoke = service 専用

-- ---------- pdf_render_lock (PDF 生成のグローバル直列化 lease — v1.1、§7.4-1) ----------
create table pdf_render_lock (
  id int primary key check (id = 1),                 -- singleton 行
  locked_until timestamptz not null default '-infinity',
  locked_by text
);
insert into pdf_render_lock (id) values (1);
comment on table pdf_render_lock is
  'PDF 生成の同時実行 1 (J5) をインスタンス横断で保証する lease (v1.1 — 02-sales.md §7.4-1)。advisory lock は pgbouncer のため使わない。クラッシュは locked_until 経過で自然回復';
alter table pdf_render_lock enable row level security;
revoke all on pdf_render_lock from anon, authenticated; -- service 専用

-- ---------- document_revision_stagings (訂正発行の staging — v1.1、§4.3-B) ----------
create table document_revision_stagings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  header jsonb not null,                             -- zReviseDocumentInput のヘッダ部 (lines を除く)
  lines jsonb not null,                              -- zDocumentLineInput[] (配列順 = position)
  subtotal_jpy bigint not null,
  tax_summary jsonb not null,
  total_jpy bigint not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
comment on table document_revision_stagings is
  '訂正発行の staging (v1.1 — 02-sales.md §4.3-B)。訂正内容を documents に書く前に隔離し、PDF 生成後に document_apply_revision が単一トランザクションで確定・削除する。孤児行 (PDF 失敗) は次回訂正時にベストエフォート掃除';
alter table document_revision_stagings enable row level security;
revoke all on document_revision_stagings from anon, authenticated; -- service 専用 (facade repository が service client で読み書き)

-- ---------- RPC: 発行の確定 (採番済み doc_no + PDF 保存済みの後、DB 状態を原子的に確定) ----------
create or replace function public.document_finalize_issue(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_doc_no text,
  p_issue_date date,
  p_subtotal_jpy bigint,
  p_tax_summary jsonb,
  p_total_jpy bigint,
  p_issuer_snapshot jsonb,
  p_sha256 text,
  p_storage_path text,
  p_counterparty text,
  p_content_snapshot jsonb
)
returns table (issued_document_id uuid, doc_version int, new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
  v_line_count int;
  v_ledger_id uuid;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_finalize_issue requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'KMB-E621: draft 以外は発行できません (現在: %)', v_doc.status;
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;
  select count(*) into v_line_count from document_lines where document_id = p_document_id;
  if v_line_count = 0 then
    raise exception 'KMB-E620: 明細が 0 行のため発行できません';
  end if;

  begin
    update documents set
      status = 'issued',
      doc_no = p_doc_no,
      issue_date = p_issue_date,
      issued_at = now(),
      current_version = 1,
      subtotal_jpy = p_subtotal_jpy,
      tax_summary = p_tax_summary,
      total_jpy = p_total_jpy,
      issuer_snapshot = p_issuer_snapshot
    where id = p_document_id;

    insert into issued_documents (
      document_id, doc_no, doc_type, version, sha256,
      transaction_date, counterparty, total_jpy, storage_path,
      supersedes, content_snapshot, created_by
    ) values (
      p_document_id, p_doc_no, v_doc.doc_type, 1, p_sha256,
      coalesce(v_doc.transaction_date, p_issue_date), -- v1.1: 取引年月日は transaction_date が正 (null = 発行日と同日)
      p_counterparty, p_total_jpy, p_storage_path,
      null, p_content_snapshot, auth.uid()
    ) returning id into v_ledger_id;
  exception when unique_violation then
    raise exception 'KMB-E622: 書類番号または保存パスが重複しました (%)', p_doc_no;
  end;

  return query
    select v_ledger_id, 1, d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_finalize_issue(uuid, timestamptz, text, date, bigint, jsonb, bigint, jsonb, text, text, text, jsonb) from public, anon;
grant execute on function public.document_finalize_issue(uuid, timestamptz, text, date, bigint, jsonb, bigint, jsonb, text, text, text, jsonb) to authenticated;

-- ---------- RPC: 版の追加 (再出力・訂正発行の台帳 append + current_version 前進) ----------
create or replace function public.document_append_version(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_sha256 text,
  p_storage_path text,
  p_counterparty text,
  p_content_snapshot jsonb
)
returns table (issued_document_id uuid, doc_version int, new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
  v_version int;
  v_supersedes uuid;
  v_ledger_id uuid;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_append_version requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status not in ('issued', 'accepted', 'paid') then
    raise exception 'KMB-E621: この状態の帳票は再発行できません (現在: %)', v_doc.status;
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;

  v_version := v_doc.current_version + 1;
  select id into v_supersedes from issued_documents
    where document_id = p_document_id and version = v_doc.current_version;
  if v_supersedes is null then
    raise exception 'KMB-E627: 台帳に現行版 (v%) が見つかりません', v_doc.current_version;
  end if;

  begin
    insert into issued_documents (
      document_id, doc_no, doc_type, version, sha256,
      transaction_date, counterparty, total_jpy, storage_path,
      supersedes, content_snapshot, created_by
    ) values (
      p_document_id, v_doc.doc_no, v_doc.doc_type, v_version, p_sha256,
      coalesce(v_doc.transaction_date, v_doc.issue_date), -- v1.1: 取引年月日の分離
      p_counterparty, v_doc.total_jpy, p_storage_path,
      v_supersedes, p_content_snapshot, auth.uid()
    ) returning id into v_ledger_id;
  exception when unique_violation then
    raise exception 'KMB-E627: 版番号または保存パスが重複しました (v%)', v_version;
  end;

  update documents set current_version = v_version where id = p_document_id;

  return query
    select v_ledger_id, v_version, d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_append_version(uuid, timestamptz, text, text, text, jsonb) from public, anon;
grant execute on function public.document_append_version(uuid, timestamptz, text, text, text, jsonb) to authenticated;

-- ---------- RPC: 訂正発行の原子確定 (凍結 trigger を GUC で通過する唯一の経路) ----------
-- v1.1: 旧 2 段階 (内容置換 RPC → PDF → append_version) は RPC 成功直後のプロセス死で
-- 「documents の内容 ≠ 台帳最新版」の乖離を電帳法保存対象で許容してしまうため廃止。
-- 訂正内容は document_revision_stagings に隔離し、staging 内容で PDF を生成・保存した後に
-- 本 RPC が documents 更新 + 明細置換 + 台帳 append + current_version 前進を
-- 単一トランザクションで確定する (§4.3-B)。途中失敗で残るのは staging 行と孤児 PDF のみで
-- documents/台帳は無傷 (再実行で回復 — 乖離状態が存在しない)
create or replace function public.document_apply_revision(
  p_document_id uuid,
  p_expected_updated_at timestamptz,
  p_staging_id uuid,   -- document_revision_stagings.id (facade が事前 INSERT — §4.3-B)
  p_sha256 text,       -- staging 内容で生成済みの PDF の SHA-256
  p_storage_path text,
  p_content_snapshot jsonb -- zIssuedContentSnapshot (facade が staging から合成)
)
returns table (issued_document_id uuid, doc_version int, new_updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_doc documents%rowtype;
  v_staging document_revision_stagings%rowtype;
  v_payment_count int;
  v_version int;
  v_supersedes uuid;
  v_ledger_id uuid;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_apply_revision requires admin or service_role';
  end if;
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'KMB-E621: 帳票が見つかりません';
  end if;
  if v_doc.status not in ('issued', 'accepted') then
    raise exception 'KMB-E621: この状態の帳票は訂正できません (現在: %)', v_doc.status;
  end if;
  if v_doc.updated_at <> p_expected_updated_at then
    raise exception 'KMB-E103: 帳票が他の操作で更新されています';
  end if;
  if v_doc.doc_type = 'invoice' then
    select count(*) into v_payment_count from payments where document_id = p_document_id;
    if v_payment_count > 0 then
      raise exception 'KMB-E621: 入金記録のある請求書は訂正できません (入金を削除するか、取消して再発行してください)';
    end if;
  end if;
  select * into v_staging from document_revision_stagings
    where id = p_staging_id and document_id = p_document_id;
  if not found then
    raise exception 'KMB-E621: 訂正内容 (staging) が見つかりません';
  end if;
  if jsonb_array_length(v_staging.lines) = 0 then
    raise exception 'KMB-E620: 明細が 0 行の訂正はできません';
  end if;

  v_version := v_doc.current_version + 1;
  select id into v_supersedes from issued_documents
    where document_id = p_document_id and version = v_doc.current_version;
  if v_supersedes is null then
    raise exception 'KMB-E627: 台帳に現行版 (v%) が見つかりません', v_doc.current_version;
  end if;

  -- transaction-local GUC: 本トランザクション内でのみ凍結 trigger を解除 (pgbouncer 安全)
  perform set_config('kmb.sales_revision_unlock', 'on', true);

  update documents set
    issue_date = (v_staging.header->>'issue_date')::date,
    transaction_date = (v_staging.header->>'transaction_date')::date,
    valid_until = (v_staging.header->>'valid_until')::date,
    billing_name = v_staging.header->>'billing_name',
    billing_suffix = v_staging.header->>'billing_suffix',
    billing_address = v_staging.header->>'billing_address',
    site_name = v_staging.header->>'site_name',
    site_address = v_staging.header->>'site_address',
    notes = v_staging.header->>'notes',
    subtotal_jpy = v_staging.subtotal_jpy,
    tax_summary = v_staging.tax_summary,
    total_jpy = v_staging.total_jpy,
    current_version = v_version
  where id = p_document_id;

  delete from document_lines where document_id = p_document_id;
  insert into document_lines
    (document_id, position, description, quantity, unit,
     unit_price_jpy, amount_jpy, tax_category, work_type_key, source)
  select
    p_document_id,
    (t.ord - 1)::int,  -- v1.1: 契約 (zDocumentLineInput) は position を持たないため ordinality で採番
    t.elem->>'description',
    (t.elem->>'quantity')::numeric,
    t.elem->>'unit',
    (t.elem->>'unit_price_jpy')::bigint,
    (t.elem->>'amount_jpy')::bigint,
    t.elem->>'tax_category',
    t.elem->>'work_type_key',
    nullif(t.elem->'source', 'null'::jsonb)
  from jsonb_array_elements(v_staging.lines) with ordinality as t(elem, ord);

  begin
    insert into issued_documents (
      document_id, doc_no, doc_type, version, sha256,
      transaction_date, counterparty, total_jpy, storage_path,
      supersedes, content_snapshot, created_by
    ) values (
      p_document_id, v_doc.doc_no, v_doc.doc_type, v_version, p_sha256,
      coalesce((v_staging.header->>'transaction_date')::date, (v_staging.header->>'issue_date')::date),
      v_staging.header->>'billing_name', v_staging.total_jpy, p_storage_path,
      v_supersedes, p_content_snapshot, auth.uid()
    ) returning id into v_ledger_id;
  exception when unique_violation then
    raise exception 'KMB-E627: 版番号または保存パスが重複しました (v%)', v_version;
  end;

  delete from document_revision_stagings where id = p_staging_id;

  return query
    select v_ledger_id, v_version, d.updated_at from documents d where d.id = p_document_id;
end;
$$;

revoke all on function public.document_apply_revision(uuid, timestamptz, uuid, text, text, jsonb) from public, anon;
grant execute on function public.document_apply_revision(uuid, timestamptz, uuid, text, text, jsonb) to authenticated;
