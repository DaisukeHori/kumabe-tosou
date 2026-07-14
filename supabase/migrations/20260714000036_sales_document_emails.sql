-- 20260714000036_sales_document_emails.sql
-- canonical: docs/design/crm-suite/02-sales.md §18「帳票のメール送付 (J7 Phase 2)」の実装 (Issue #101)
--
-- 本 migration が追加するもの:
--   document_emails — 帳票メール送付の送信台帳 (追記専用)。PDF「添付」方式での送付結果
--   (成功/失敗いずれも) を記録する。activities (crm) の冪等キー (activity_type, ref_table, ref_id)
--   では同一帳票への 2 通目以降の送信が既存行に collapse してしまうため、送信ごとに一意な行を持つ
--   専用台帳として新設する (issue-101 設計「このテーブルを設ける理由」参照)。
--
-- 前提: 0026 (documents) / 0027 (issued_documents) 適用済み。
-- activities.activity_type check 制約への 'email' 追加は不要 (20260711000023_crm_core.sql:129-131 で
-- Phase 2 分として登録済み)。documents/issued_documents 側の DDL 変更も不要。

create table document_emails (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete restrict,
  issued_document_id uuid not null references issued_documents(id) on delete restrict,
  to_email text not null,
  cc_email text null,
  subject text not null,
  body text not null,
  status text not null check (status in ('sent', 'failed')),
  error_detail text null,        -- failed 時の Resend エラー/例外メッセージ
  provider_message_id text null, -- Resend の message id (sent 時)
  sent_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

comment on table document_emails is
  '帳票メール送付の送信台帳 (追記専用)。1 送信 = 1 行 (成功/失敗いずれも記録)。案件タイムラインへは
   crm.activities (activity_type=''email'') にも合成イベントとして記録するが、送信失敗は
   activities には残せない (appendActivity は成功送信のみ呼ぶ) ため、本台帳が正の記録となる';
comment on column document_emails.issued_document_id is
  '送付した PDF の版 (issued_documents.id)。同一 document_id への複数回送信・複数版送信を区別する';
comment on column document_emails.error_detail is
  'status=''failed'' の場合の Resend API エラー / 例外メッセージ (KMB-E644 の detail と同一)';

create index document_emails_document_idx on document_emails (document_id, sent_at desc);

alter table document_emails enable row level security;
create policy document_emails_admin_select on document_emails
  for select using (public.is_admin());
create policy document_emails_admin_insert on document_emails
  for insert with check (public.is_admin());
-- UPDATE/DELETE ポリシーは作らない (追記専用の送信台帳 — companies/customers と異なり訂正不要)。
revoke all on document_emails from anon, authenticated; -- v1.1 revoke 先行の統一規約 (0026/0027 と同旨)
grant select, insert on document_emails to authenticated;
