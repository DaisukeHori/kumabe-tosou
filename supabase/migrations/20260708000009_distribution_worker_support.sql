-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: distribution worker 支援
-- canonical: docs/design/cms-ai-pipeline.md §3.6 (Vault アクセス規約) / §7.7 (X refresh) / §8.2
-- 既存 migration (0001 DDL / 0004 vault_upsert_secret) に対する追加分のみ。
-- =========================================================

-- ---------------------------------------------------------
-- Vault 読み出し RPC (§3.6: 「読み出しは worker route (service role) のみ、
-- vault.decrypted_secrets を RPC 経由で参照」)。0004 の vault_upsert_secret と対になる読み出し版。
-- ---------------------------------------------------------
create or replace function public.vault_read_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = p_name;
  return v_secret;
end;
$$;

revoke execute on function public.vault_read_secret(text) from public, anon, authenticated;

-- ---------------------------------------------------------
-- channel_accounts: X refresh token ローテーションの単一実行制御用リース列。
-- 設計書 §7.7 は「advisory lock で単一実行」と記すが、Supabase 接続は PostgREST 経由の
-- プール接続 (pgbouncer transaction pooling 等) のため、セッション単位の
-- pg_advisory_lock/unlock は呼び出しごとに別接続に当たり得て前提が壊れる
-- (実装上の理由でオーケストレーターへ報告済み)。
-- 本プロジェクトで実績のある ai_runs.lease_expires_at と同じ CAS リース方式に置き換える:
-- 同じく「期限切れなら再取得可能」な楽観的排他であり、同時実行を直列化する目的は満たす。
-- =========================================================
alter table channel_accounts
  add column if not exists token_refresh_lease_expires_at timestamptz;

-- ---------------------------------------------------------
-- channel_posts: 課金ガード集計 (§8.2 当月 published+publishing+scheduled の合算) の
-- 効率化用複合 index。既存 channel_posts_status_scheduled_at_idx (status, scheduled_at) は
-- channel での絞り込みを含まないため追加する。
-- ---------------------------------------------------------
create index if not exists channel_posts_channel_status_scheduled_at_idx
  on channel_posts (channel, status, scheduled_at);
