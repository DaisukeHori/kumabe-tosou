-- 20260906000031_calendar_connection_token_expires_at.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §8.3 手順 3 (refresh 成功時の meta.token_expires_at 更新)
-- 本 migration が追加するもの:
--   1. set_calendar_connection_token_expires_at(p_provider, p_expires_at)
--      calendar_connections.meta の token_expires_at キーだけを jsonb マージ (meta || {...}) で更新する
--      RPC。read-modify-write だと同時に走る他の meta 更新 (sync_window の切り直し等) を巻き戻す
--      恐れがあるため、単一 UPDATE の jsonb 結合で原子的に行う。service_role 専用 (worker の token.ts)。

create or replace function public.set_calendar_connection_token_expires_at(
  p_provider text,
  p_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update calendar_connections
     set meta = meta || jsonb_build_object('token_expires_at', to_jsonb(p_expires_at))
   where provider = p_provider;
$$;

revoke all on function public.set_calendar_connection_token_expires_at(text, timestamptz) from public, anon, authenticated;
