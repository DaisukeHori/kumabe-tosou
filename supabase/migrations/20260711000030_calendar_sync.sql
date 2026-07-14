-- 20260711000030_calendar_sync.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.3 (裁定 J4)
-- 本 migration が追加するもの:
--   1. calendar_connections (provider 単位の接続状態。トークン実体は Vault のみ)
--   2. calendar_event_links (work_block ↔ 外部イベントのマッピング + 出所マーキング +
--      自己エコー棄却の三点セット etag/changeKey・last_written_hash・external_updated_at)
-- 本 migration が行わないこと: pg_cron 登録 (0031)
-- 接続は「事業体で 1 接続」(裁定 J1) — provider を PK にし、per-user 行は持たない

-- =========================================================================
-- 1. calendar_connections
-- =========================================================================
create table calendar_connections (
  provider text primary key check (provider in ('google','microsoft')),
  status text not null default 'disconnected'
    check (status in ('disconnected','connected','expired','error')),
  vault_secret_name text,
  sync_token text,
  sync_page_cursor text,
  meta jsonb not null default '{}',
  token_refresh_lease_expires_at timestamptz,
  sync_lease_expires_at timestamptz,
  pull_requested_at timestamptz,
  last_pulled_at timestamptz,
  last_pushed_at timestamptz,
  last_full_resync_at timestamptz,
  last_error_code text,
  last_error_detail text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table calendar_connections is
  '外部カレンダー接続 (事業体で 1 接続/provider — 裁定 J1)。トークン実体は Vault のみ '
  '(calendar_google_oauth / calendar_microsoft_oauth 固定名 — 裁定 J4)。'
  'meta の型契約は zCalendarConnectionMeta (module-contracts v2.8 §4.12)';
comment on column calendar_connections.sync_token is
  'Google: events.list の nextSyncToken / Microsoft: deltaLink URL。NULL = 次回フル同期';
comment on column calendar_connections.sync_page_cursor is
  'フル同期/増分のページング途中カーソル (Google nextPageToken / Graph nextLink)。'
  '1 起床で完走しない場合の継続点 (nextSyncToken は最終ページのみ — ext-calendar §2.2 の事故対策)';
comment on column calendar_connections.token_refresh_lease_expires_at is
  'トークン refresh の CAS リース (channel_accounts 0010 と同型。advisory lock 禁止 — pgbouncer)';
comment on column calendar_connections.sync_lease_expires_at is
  'sync 実行の単一化リース (worker 多重起床対策。TTL 90 秒)';
comment on column calendar_connections.pull_requested_at is
  'Phase 2 push 通知 (webhook) が立てる dirty フラグ (§8.9 の後付け契約)。v1 では常に NULL';
comment on column calendar_connections.last_error_detail is
  'トークン・シークレットを含めないこと (maskSecretsInString を通してから保存 — Vault 規約)';

create trigger handle_updated_at before update on calendar_connections
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 2. calendar_event_links
-- =========================================================================
create table calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  work_block_id uuid not null references work_blocks(id) on delete cascade,
  provider text not null references calendar_connections(provider) on delete cascade,
  external_event_id text,
  external_ical_uid text,
  etag_or_change_key text,
  external_updated_at timestamptz,
  last_written_hash text,
  sync_status text not null default 'pending_push'
    check (sync_status in ('synced','pending_push','conflict','orphaned','deleted_externally')),
  push_attempts int not null default 0,
  push_claimed_at timestamptz,
  last_error_code text,
  last_pushed_at timestamptz,
  last_pulled_at timestamptz,
  deleted_externally_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_links_block_provider_uniq unique (work_block_id, provider),
  constraint calendar_event_links_provider_check check (provider in ('google','microsoft'))
);

comment on table calendar_event_links is
  'work_block ↔ 外部イベントのマッピング (双方向同期の核 — ext-calendar §3.1)。'
  '出所判定の一次ソースは本テーブル (external_event_id 照合)。'
  'Google は extendedProperties.private も併用、Graph は拡張プロパティ非依存 (既知問題のため)';
comment on column calendar_event_links.external_event_id is
  'NULL = まだ外部未作成 (pending_push で作成待ち)。作成応答で確定';
comment on column calendar_event_links.etag_or_change_key is
  'Google: etag / Graph: changeKey。書込直後の応答値を保存し、pull 時の自己エコー棄却と '
  '楽観排他 (If-Match) に使う';
comment on column calendar_event_links.last_written_hash is
  '自アプリが最後に書いた内容の sha256(canonical JSON {s,e,t})。エコー判定の第 3 手段 (§8.6)';
comment on column calendar_event_links.sync_status is
  '意味論は 03-scheduling.md §5.3。conflict + last_error_code=KMB-E724 は「結果不明・手動照合待ち」';
comment on column calendar_event_links.deleted_externally_at is
  '外部削除の検知時刻。ブロック本体は自動削除しない (即削除禁止 — 00-overview §6.2)';
comment on column calendar_event_links.push_claimed_at is
  'createEvent 直前に単一 UPDATE で刻印する claim (§8.4)。「claim 非 NULL + external_event_id NULL」'
  '= 結果不明の作成 (実行系 kill 疑い) — 再 create 前に findByLinkId 照合で二重イベントを防ぐ。成功時 NULL 化';

create unique index calendar_event_links_external_uidx
  on calendar_event_links (provider, external_event_id)
  where external_event_id is not null;
create index calendar_event_links_status_idx
  on calendar_event_links (provider, sync_status);

create trigger handle_updated_at before update on calendar_event_links
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 3. RLS (00-overview §5.2 の総表どおり)
--    calendar_connections: admin 全権 + service (トークン refresh / 同期状態更新は bypass)
--    calendar_event_links: admin SELECT のみ。書き込みは service (worker / facade 内 service client)
-- =========================================================================
alter table calendar_connections enable row level security;
create policy calendar_connections_admin_select on calendar_connections for select using (public.is_admin());
create policy calendar_connections_admin_insert on calendar_connections for insert with check (public.is_admin());
create policy calendar_connections_admin_update on calendar_connections for update
  using (public.is_admin()) with check (public.is_admin());
create policy calendar_connections_admin_delete on calendar_connections for delete using (public.is_admin());
revoke all on calendar_connections from anon;
grant select, insert, update, delete on calendar_connections to authenticated;

alter table calendar_event_links enable row level security;
create policy calendar_event_links_admin_select on calendar_event_links for select using (public.is_admin());
-- INSERT/UPDATE/DELETE ポリシーは作らない = authenticated は書けない (service_role のみ)
revoke all on calendar_event_links from anon;
revoke insert, update, delete on calendar_event_links from authenticated;
grant select on calendar_event_links to authenticated;
