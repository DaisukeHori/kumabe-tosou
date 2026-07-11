-- =========================================================
-- CRM スイート M0 共通基盤: 帳票採番 RPC (裁定 J5)
-- canonical: docs/design/crm-suite/00-overview.md §3.4 (本節が canonical DDL。テーブル所有は sales)
--
-- 書類番号は `Q-2026-0001` 形式 (書類種別プレフィクス + 発行年 (JST) + 4 桁連番)。
-- 欠番許容の単調増加 — 採番後に帳票作成が失敗しても番号は戻さない (説明可能な欠番は実務上許容 —
-- ext-hubspot B-8)。連番は (doc_type, 年) ごとに独立。
--
-- 前提: migration 20260711000021 (is_admin_or_service) 適用済み。
-- =========================================================

create table document_sequences (
  doc_type text not null check (doc_type in ('quote', 'order', 'delivery', 'invoice')),
  fiscal_year int not null check (fiscal_year between 2000 and 2999),
  last_seq int not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now(),
  primary key (doc_type, fiscal_year)
);

comment on table document_sequences is
  '書類採番カウンタ (書類種別×年)。欠番許容の単調増加。直接アクセス禁止 (RPC 専用)';

create trigger handle_updated_at before update on document_sequences
  for each row execute procedure extensions.moddatetime (updated_at);

-- service 専用分類: RLS 有効 + ポリシーなし + 明示 revoke (0020 の教訓 — RLS だけでは
-- default privileges の grant が残る)
alter table document_sequences enable row level security;
revoke all on document_sequences from anon, authenticated;

-- =========================================================
-- document_number_next RPC (#variable_conflict use_column 必須 — 0019 CRITICAL の再発防止規約。
-- 00-overview.md §3.1.4-1)
-- =========================================================
create or replace function public.document_number_next(p_doc_type text, p_year int)
returns table (doc_no text, seq int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_prefix text;
  v_seq int;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_number_next requires admin or service_role';
  end if;
  if p_doc_type not in ('quote', 'order', 'delivery', 'invoice') then
    raise exception 'KMB-E622: 不正な書類種別です (%)', p_doc_type;
  end if;

  v_prefix := case p_doc_type
    when 'quote' then 'Q'
    when 'order' then 'J'      -- 受注 (Juchuu)。O は 0 と紛らわしいため不採用
    when 'delivery' then 'D'
    when 'invoice' then 'I'
  end;

  insert into document_sequences (doc_type, fiscal_year)
  values (p_doc_type, p_year)
  on conflict (doc_type, fiscal_year) do nothing;

  -- FOR UPDATE 行ロックで同時採番を直列化 (advisory lock 禁止 — pgbouncer transaction pooling)
  update document_sequences
    set last_seq = last_seq + 1
    where doc_type = p_doc_type and fiscal_year = p_year
    returning last_seq into v_seq;

  return query select
    format('%s-%s-%s', v_prefix, p_year, lpad(v_seq::text, 4, '0')),
    v_seq;
end;
$$;

revoke all on function public.document_number_next(text, int) from public, anon;
grant execute on function public.document_number_next(text, int) to authenticated;
