-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: Supabase Vault RPC
-- canonical: docs/design/cms-ai-pipeline.md §3.6 (Vault アクセス規約)
-- =========================================================

create extension if not exists supabase_vault;

-- name (vault_secret_name) を指定して、無ければ作成・あれば上書き (service 専用)。
-- 呼び出し元: OAuth callback (service role) / publish-worker のトークン refresh (service role)。
create or replace function public.vault_upsert_secret(p_name text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;

  if v_id is null then
    v_id := vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(v_id, p_secret, p_name);
  end if;

  return v_id;
end;
$$;

revoke execute on function public.vault_upsert_secret(text, text) from public, anon, authenticated;
