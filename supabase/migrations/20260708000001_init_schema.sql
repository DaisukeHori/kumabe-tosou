-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: 初期スキーマ
-- canonical: docs/design/cms-ai-pipeline.md §2.2 (DDL)
-- 一字一句 §2.2 の定義に従う。乖離があれば設計書を正とし本ファイルを直す。
-- =========================================================

create extension if not exists moddatetime schema extensions;

-- =========================================================
-- 管理者
-- =========================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'admin' check (role in ('admin')), -- 将来 editor 追加余地
  created_at timestamptz not null default now()
);

-- =========================================================
-- メディア (全写真の一元管理)
-- =========================================================
create table media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,        -- media-originals バケット内パス (原本)。公開レンディション (WebP/JPEG) は派生パスで media バケットに生成 (§3.4)
  alt text not null default '',
  width int not null,
  height int not null,
  mime_type text not null,
  credit text,                              -- Unsplash 等の出典 (仮素材管理)
  is_placeholder boolean not null default true, -- 仮素材フラグ (実写差し替え管理)
  tags text[] not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- 施工事例
-- =========================================================
create table works (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  category text not null,                   -- 'vehicle' | 'small-item' | 'figure' 等 (自由入力+候補)
  body text not null default '',            -- Markdown
  process_note text,                        -- 工程 1 行 (「表面処理→プライマー→…」)
  cover_media_id uuid references media(id),
  status text not null default 'draft'
    check (status in ('draft','review','published','archived')),
  published_at timestamptz,
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table work_images (
  work_id uuid not null references works(id) on delete cascade,
  media_id uuid not null references media(id),
  sort_order int not null default 0,
  primary key (work_id, media_id)
);

-- =========================================================
-- 記事 (読みもの / お知らせ / AI ブログを統合)
-- =========================================================
create table posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  kind text not null check (kind in ('reading','news','blog')),
  -- reading: 旧 notes.html の技術記事 / news: お知らせ / blog: AI パイプライン産ブログ
  title text not null,
  excerpt text not null default '',
  body text not null default '',            -- Markdown
  cover_media_id uuid references media(id),
  status text not null default 'draft'
    check (status in ('draft','review','published','archived')),
  published_at timestamptz,
  source_run_id uuid,                       -- AI 産の場合 ai_runs.id (FK は後付け)
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- お客様の声
-- =========================================================
create table voices (
  id uuid primary key default gen_random_uuid(),
  customer_initial text not null,           -- 'K.T'
  region text not null,                     -- '福岡県'
  rating int not null check (rating between 1 and 5),
  body text not null,
  item text,                                -- 施工品目
  photo_media_id uuid references media(id),
  status text not null default 'draft'
    check (status in ('draft','review','published','archived')),
  published_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 価格表 (現 shop-simulator.tsx の PRICE_TABLE を正規化)
-- =========================================================
create table price_grades (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                 -- 'solid' | 'metallic' | 'pearl' 等
  label text not null,
  base_price int not null,                  -- 円
  description text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table price_options (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                 -- 'express' | 'quantity_tier_2' 等
  label text not null,
  kind text not null check (kind in ('multiplier','fixed')),
  value numeric not null,                   -- multiplier: 1.5 / fixed: 3000
  sort_order int not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- サイト設定 (会社情報・ヒーロー写真・SEO 既定値)
-- =========================================================
create table site_settings (
  key text primary key,                     -- 'company' | 'hero' | 'seo_defaults' 等
  value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
-- value の型契約 (canonical) は module-contracts.md §4.2 の SETTINGS_SCHEMAS。
-- key: 'company' | 'hero' | 'seo_defaults' | 'ops_limits' (課金ガード上限含む)。
-- 実装は src/modules/settings/contracts.ts (契約書と 1:1)。

-- =========================================================
-- お問い合わせ
-- =========================================================
create table contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  tel text,
  inquiry_type text not null,
  item text,
  body text not null,
  status text not null default 'new'
    check (status in ('new','in_progress','done','spam')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

-- 公開フォームの rate limit (§3.3)。IP は salt 付き SHA-256 hash で保存 (生 IP は保持しない)
create table rate_limits (
  ip_hash text not null,
  route text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (ip_hash, route, window_start)
);

-- =========================================================
-- AI パイプライン
-- =========================================================
create table ai_sources (
  id uuid primary key default gen_random_uuid(),
  input_type text not null check (input_type in ('audio','text')),
  audio_storage_path text,                  -- audio バケット (input_type='audio')
  raw_text text,                            -- 直接入力 or 文字起こし結果 (原文を不変保持・監査/差分用)
  cleaned_text text,                        -- Claude 整文後テキスト (フィラー除去・句読点・誤認識訂正)。パイプラインの実入力
  cleaned_at timestamptz,
  transcript_status text not null default 'n/a'
    check (transcript_status in ('n/a','pending','processing','done','cleaning','cleaned','failed')),
  duration_seconds int,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references ai_sources(id),
  status text not null default 'pending'
    check (status in ('pending','extracting','researching','drafting','ready_for_review','completed','failed','cancelled')),
  target_channels text[] not null,          -- {'site_blog','note','x','instagram'} の部分集合
  brief jsonb,                              -- 抽出された要旨・トピック・キーワード
  research_notes jsonb,                     -- web_search の結果サマリ+引用 URL
  error_code text,                          -- §9 のエラーコード
  token_usage jsonb,                        -- {input, output, cache_read} 実測記録
  lease_expires_at timestamptz,             -- stage 実行 lease (§7.6)。NULL = 未取得/解放済み
  stage_attempts int not null default 0,    -- 3 超で failed (KMB-E402)
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table channel_drafts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references ai_runs(id) on delete cascade,
  channel text not null check (channel in ('site_blog','note','x','instagram')),
  status text not null default 'generating'
    check (status in ('generating','needs_review','approved','rejected','superseded')),
  content jsonb not null default '{}',
  -- content の型契約 (canonical) は module-contracts.md §4.4 の CHANNEL_CONTENT_SCHEMAS。
  -- site_blog: zSiteBlogContent / note: zNoteContent / x: zXContent (重み付き字数 280) /
  -- instagram: zInstagramContent。Claude structured outputs の JSON Schema はここから生成。
  claims jsonb not null default '[]',       -- zClaim[] (契約書 §4.3)。生成出力 zChannelDraftOutput を content と分離保存 (§10 の inference マーカー用)
  current_revision int not null default 1,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, channel)
);

create table draft_revisions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references channel_drafts(id) on delete cascade,
  revision int not null,
  content jsonb not null,
  edited_by text not null check (edited_by in ('ai','human')),
  editor_id uuid references profiles(id),   -- human の場合
  created_at timestamptz not null default now(),
  unique (draft_id, revision)
);

create table channel_posts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references channel_drafts(id),
  channel text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','publishing','published','failed','cancelled','manual_required')),
  scheduled_at timestamptz not null default now(),
  published_at timestamptz,
  external_id text,                         -- tweet id / IG media id / 自サイト posts.id
  external_url text,
  tweet_count int,                          -- X: スレッド内ツイート数 (課金見積り用)
  url_count int,                            -- X: URL 付きツイート数 ($0.20/件)
  estimated_cost_cents int not null default 0, -- 課金ガードは当月合算で判定 (§8.2)
  attempt_count int not null default 0,
  last_error_code text,
  last_error_detail text,
  idempotency_key uuid not null default gen_random_uuid(), -- 二重投稿防止
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table channel_accounts (
  channel text primary key check (channel in ('x','instagram','note')),
  account_label text not null,              -- '@kumabe_tosou' 等表示用
  auth_status text not null default 'disconnected'
    check (auth_status in ('disconnected','connected','expired','error')),
  vault_secret_name text,                   -- Supabase Vault 上のシークレット名
  meta jsonb not null default '{}',         -- IG business account id 等の非秘匿メタ
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table style_profiles (
  channel text primary key check (channel in ('site_blog','note','x','instagram')),
  tone_instructions text not null,          -- 文体指示 (プロンプトに注入)
  format_rules text not null,               -- 構成ルール (字数/ハッシュタグ数/絵文字方針)
  example_output text,                      -- few-shot 用のお手本
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- seed 管理 (§12.1 のロールバック用)
-- =========================================================
create table seed_manifest (
  id bigint generated always as identity primary key,
  batch_id uuid not null,                   -- seed 実行 1 回 = 1 batch
  entity text not null,                     -- テーブル名 or 'storage:media' / 'storage:audio'
  ref_id text not null,                     -- 行 uuid or storage_path
  created_at timestamptz not null default now()
);
create index on seed_manifest (batch_id, id desc); -- 逆順ロールバック用

-- =========================================================
-- posts.source_run_id の FK 後付け (ai_runs 定義後)
-- =========================================================
alter table posts add constraint posts_source_run_fk foreign key (source_run_id) references ai_runs(id);

-- =========================================================
-- 共通規約 1) updated_at を持つ全テーブルに moddatetime trigger を付与
-- =========================================================
create trigger handle_updated_at before update on works
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on posts
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on voices
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on price_grades
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on price_options
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on site_settings
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on ai_runs
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on channel_posts
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on channel_accounts
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on style_profiles
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================
-- 共通規約 3) channel_posts.channel と channel_drafts.channel の一致検証 trigger
-- =========================================================
create or replace function public.check_channel_post_channel_match()
returns trigger
language plpgsql
as $$
declare
  v_draft_channel text;
begin
  select channel into v_draft_channel from channel_drafts where id = new.draft_id;

  if v_draft_channel is null then
    raise exception 'channel_posts.draft_id % が channel_drafts に存在しません', new.draft_id;
  end if;

  if v_draft_channel <> new.channel then
    raise exception 'channel_posts.channel (%) が channel_drafts.channel (%) と一致しません', new.channel, v_draft_channel;
  end if;

  return new;
end;
$$;

create trigger channel_posts_channel_match
  before insert or update of channel, draft_id on channel_posts
  for each row execute procedure public.check_channel_post_channel_match();

-- =========================================================
-- 公開クエリ用 index
-- =========================================================
create index works_status_published_at_idx on works (status, published_at desc);
create index posts_status_published_at_idx on posts (status, published_at desc);
create index voices_status_published_at_idx on voices (status, published_at desc);
create index channel_posts_status_scheduled_at_idx on channel_posts (status, scheduled_at);
create index media_tags_gin_idx on media using gin (tags);
