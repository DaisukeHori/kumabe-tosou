-- =========================================================
-- 外部サービスの認証情報を管理画面から設定できるようにする (integration_credentials)
-- canonical: docs/design/crm-suite/05-site-settings.md §9 (本 migration で追記)
--
-- 背景:
--   Google / Microsoft カレンダー、X / Instagram (Meta)、Twilio、Resend の client_id / secret は
--   これまで Vercel の環境変数 (GOOGLE_CALENDAR_CLIENT_ID 等) でしか設定できず、納品先の管理者が
--   自分で接続を有効化できなかった。ai_provider_keys (20260710000015) と同じ「非機微情報は
--   テーブル、機微情報は Vault」の分離で、管理画面 (/admin/settings?tab=integrations) から
--   設定・更新・削除できるようにする。
--
-- 解決順序 (src/lib/integration-credentials.ts):
--   1) 本テーブルに行があればそれを使う (secret は Vault の secret_vault_name から読む)
--   2) 無ければ従来どおり環境変数にフォールバック (既存環境の互換維持)
--
-- 権限: 読み書きは service role (Server Action / Route Handler 内) のみ。RLS は admin の SELECT
--   だけ許可し (デバッグ用途)、INSERT/UPDATE/DELETE は service role 専用。anon は revoke。
-- =========================================================

create table if not exists integration_credentials (
  provider text primary key
    check (provider in ('google_calendar', 'ms_calendar', 'x', 'meta', 'twilio', 'resend')),
  public_id text,                     -- client_id / app_id / account_sid (非機微)。resend は null
  secret_vault_name text unique,      -- 実際の secret は Vault (vault_upsert_secret)。null = 未設定
  secret_last4 text,                  -- 管理画面の「設定済み (****xxxx)」表示用 (非機微)
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table integration_credentials is
  '外部サービス (カレンダー / SNS / 電話 / メール) の OAuth クライアント・API 資格情報。secret は Vault 参照のみ保持。env フォールバック付きで src/lib/integration-credentials.ts が解決する';

create trigger integration_credentials_updated_at
  before update on integration_credentials
  for each row execute procedure extensions.moddatetime (updated_at);

alter table integration_credentials enable row level security;

create policy integration_credentials_admin_select
  on integration_credentials for select
  using (public.is_admin());

revoke all on integration_credentials from anon;
grant select on integration_credentials to authenticated;
