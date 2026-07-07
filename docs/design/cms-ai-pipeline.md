# 隈部塗装 CMS + AI コンテンツパイプライン 設計書

- 版: v2.0 (設計厳格化: モジュール契約分離 / Zod canonical / 認可拡張 / OAuth・SSE シーケンス / NFR 追加)
- 作成日: 2026-07-07
- 作成: Fable 5 (メインセッション直接執筆) + researcher (SNS API 調査 2026-07-07 実施)
- **姉妹文書 (canonical 分担)**: [docs/module-contracts.md](../module-contracts.md) — モジュール境界・値契約 (Zod)・facade・イベント・依存方向・結合シーケンスの正。本書は DDL・認可・状態・画面・受入基準の正。
- 対象リポジトリ: DaisukeHori/kumabe-tosou (`feat/nextjs-migration` ブランチ)
- 前提: Phase 0 (Next.js 15 モックアップ) 完了済み。全 14 ルート静的生成、コンテンツは全てハードコード。

---

## 0. 概要とスコープ

### 0.1 目的

1. **CMS 化 (Phase 1)** — サイト上の全コンテンツ (施工事例 / 読みもの / お知らせ / お客様の声 / 価格表 / 会社情報 / ヒーロー含む全写真) を自作 CMS (管理画面 `/admin`) から編集可能にする。
2. **AI コンテンツパイプライン (Phase 2)** — 「ペラペラ喋る or 書く → 文字起こし → リサーチ+脚色 → チャネル別文体変換 → Note / X / Instagram / 自サイトブログへ配信」を管理画面から実行できるようにする。

### 0.2 スコープ外 (本設計書で扱わないもの)

- 独自ドメイン取得・DNS 設定 (Vercel 導入後の運用作業)
- 本番写真の撮影・差し替え (CMS 完成後にメディアライブラリから実施)
- EC 決済 (shop の Stripe 接続は将来 Phase)
- 多言語対応

### 0.3 印刷出力

**該当なし。** 本システムは Web 完結であり、帳票・印刷物の出力要件は存在しない。将来、見積書 PDF 出力等が必要になった場合は別設計とする。

---

## 1. 全体アーキテクチャ

```
┌─────────────────────────────── Vercel ────────────────────────────────┐
│  Next.js 15 App Router                                                 │
│  ├── 公開サイト (/, /works, /notes, ... )    … Server Components       │
│  │     └── Supabase から published コンテンツを fetch + タグ再検証      │
│  ├── /admin/**                               … 管理画面 (要ログイン)   │
│  │     ├── CRUD 画面 (works/posts/voices/prices/media/settings)        │
│  │     └── /admin/studio  … AI パイプライン UI (録音→生成→レビュー→配信)│
│  └── Route Handlers (/api/**)                                          │
│        ├── /api/ai/*      … Claude API 呼び出し (SSE streaming)        │
│        ├── /api/transcribe … Whisper API 呼び出し                      │
│        └── /api/publish/* … X / Instagram / 自サイト配信               │
└───────────────┬───────────────────────────────────┬───────────────────┘
                │                                   │
        ┌───────▼────────────  Supabase  ───────────▼───────┐
        │ Postgres (RLS) … 全コンテンツ + パイプライン状態    │
        │ Auth           … 管理者ログイン (email+password)    │
        │ Storage        … media バケット (写真) / audio      │
        │ pg_cron + Edge Function … 予約投稿の定時実行         │
        │ Vault          … SNS トークン等シークレット          │
        └────────────────────────────────────────────────────┘
                │                    │                  │
        ┌───────▼──────┐   ┌────────▼───────┐  ┌───────▼────────┐
        │ Anthropic     │   │ OpenAI Whisper │  │ X API v2        │
        │ Claude API    │   │ (文字起こし)    │  │ Instagram Graph │
        │ (生成/リサーチ)│   │                │  │ note (半自動)    │
        └───────────────┘   └────────────────┘  └─────────────────┘
```

### 1.1 技術選定の根拠

| 項目 | 選定 | 根拠 |
|---|---|---|
| ホスティング | Vercel | 確定済み (堀さん指定)。Next.js との親和性最大 |
| BaaS | Supabase | 確定済み。Postgres + RLS + Auth + Storage + pg_cron が 1 サービスで揃う |
| 生成 AI | Claude API `claude-opus-4-8` | 文章品質最優先。adaptive thinking + streaming + structured outputs + server-side web_search を使用 |
| 文字起こし | OpenAI `gpt-4o-transcribe` ($0.006/分) | Claude API は音声入力非対応のため外部 STT が必要。品質優先方針により mini ではなく標準版を採用 (月 100 分でも $0.6 とコスト影響軽微)。MediaRecorder の webm を無変換で送信可 (調査確定) |
| 予約実行 | Supabase pg_cron + Edge Function | Vercel Hobby の cron は日次のみで分単位の予約投稿に不足。pg_cron は分単位可 |
| UI 部品 | 既存 shadcn/ui (base-ui 系) | Phase 0 資産の継続。管理画面用に table / dialog / tabs / sonner 等を追加 |

### 1.2 必要アカウント (堀さん側で新規作成するもの)

| サービス | 用途 | 必須時期 |
|---|---|---|
| Vercel | ホスティング | Phase 0 デプロイ時 (既定) |
| Supabase | DB/Auth/Storage | Phase 1 開始時 |
| Anthropic (Claude API) | 生成 AI | Phase 2 開始時 |
| OpenAI | Whisper 文字起こし | Phase 2 開始時 |
| X Developer | X 投稿 | Phase 2c。**新規は従量課金制** (投稿 $0.015/件、URL 付き $0.20/件) — developer.x.com で用途申請 + OAuth 2.0 クライアント設定 |
| Meta for Developers | Instagram 投稿 | Phase 2c (Instagram をプロアカウント化) |

---

## 2. データモデル (canonical DDL)

本節が **DDL の単一ソース** である。migration ファイルは本節から生成し、乖離した場合は本節を正とする。

### 2.1 ER 概観

```
profiles (管理者) ─┐
                   │ created_by
media ◄────────────┼──── works ──── work_images (junction, sort_order)
  ▲                ├──── posts (kind: reading/news/blog)
  │ hero/og 参照   ├──── voices
site_settings ─────┤
price_grades ──────┤     contact_inquiries
price_options ─────┘
                          ai_sources (音声/テキスト入力)
                            └── ai_runs (パイプライン実行)
                                  └── channel_drafts (チャネル別生成物)
                                        ├── draft_revisions (版履歴)
                                        └── channel_posts (配信記録)
channel_accounts (SNS 接続; トークンは Vault 参照)
style_profiles (チャネル別文体プロファイル)
```

### 2.2 DDL

```sql
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
  storage_path text not null unique,        -- media バケット内パス
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
```

### 2.3 全データパターン

各コンテンツ種別で想定される全パターンと表示挙動:

| パターン | works | posts | voices | price | media |
|---|---|---|---|---|---|
| 0 件 | 「準備中」空状態表示 | セクションごと非表示 (news) / 空状態 (reading, blog) | セクション非表示 | シミュレータをエラー表示せず「価格はお問い合わせください」fallback | — |
| draft のみ | 公開側非表示 | 同左 | 同左 | is_active=false は非表示 | is_placeholder は公開可 (注記表示) |
| published + 画像なし | cover に既定プレースホルダ画像 | 同左 | 写真なしレイアウト | — | — |
| 本文が長大 (10万字) | 一覧は excerpt 切り詰め、詳細はそのまま | 同左 | body 500 字で clamp + 続きを読む | — | — |
| 絵文字・機種依存文字 | UTF-8 で保存・表示 (NFC 正規化して保存) | 同左 | 同左 | alt も同様 | — |
| slug 重複 | unique 制約で保存時エラー (KMB-E102) | 同左 | — | key unique | storage_path unique |
| published_at が未来 | 公開側で `published_at <= now()` filter → 予約公開として機能 | 同左 | 同左 | — | — |
| アーカイブ済み | 公開側非表示・admin では灰色表示 | 同左 | 同左 | is_active=false 同等 | 削除は参照ゼロ時のみ可 (KMB-E301) |

### 2.4 データ規約 (全カラム共通)

| 規約 | 内容 |
|---|---|
| タイムゾーン | DB は timestamptz (UTC) 保存。表示・入力 UI・scheduled_at の解釈はすべて **Asia/Tokyo**。API 境界は ISO 8601 offset 付き文字列 (zIsoDatetime) |
| テキスト正規化 | 保存前に **NFC 正規化 + 制御文字除去** (改行・タブは許容)。契約書 §4.1 の transform で一元適用 |
| slug | `^[a-z0-9]+(?:-[a-z0-9]+)*$`、3〜80 字。日本語タイトルからは AI が suggested_slug (英語) を提案、手動上書き可。自動生成失敗時は `{kind}-{nanoid(8)}` |
| 文字数上限 | title 120 / excerpt 300 / body 100,000 / alt 200 / voice body 2,000 / 問い合わせ body 5,000。**DDL の check 制約と Zod の両方に定義し、一致を結合テストで検証** (契約書 §3) |
| 画像 | アップロード時に長辺 2560px 上限へリサイズ。表示用 WebP + **Instagram 用 JPEG レンディション**を保持。1 ファイル 10MB 上限 (KMB-E302) |
| 音声 | webm/mp4、最長 15 分・50MB (クライアント制約)。OpenAI 送信単位は 25MB (KMB-E303) |
| ID | 全テーブル uuid (gen_random_uuid)。外部公開 URL に連番を使わない |
| ページネーション | offset ではなく keyset (created_at, id)。admin 一覧 50 件/頁、公開一覧 12 件/頁 |

### 2.5 JSONB カラム ↔ 型契約対応表

JSONB カラムは**必ず契約書 (module-contracts.md §4) のスキーマで validate してから書き込む**。生 JSON の直接書き込み禁止。

| カラム | canonical スキーマ (契約書 §4) |
|---|---|
| site_settings.value | SETTINGS_SCHEMAS[key] (§4.2) |
| ai_runs.brief | zBrief (§4.3) |
| ai_runs.research_notes | zResearchNotes (§4.3) |
| ai_runs.token_usage | zTokenUsage (§4.3) |
| channel_drafts.content / draft_revisions.content | CHANNEL_CONTENT_SCHEMAS[channel] (§4.4) |
| channel_posts.external_id (X) | zXExternalRef (§4.5) |
| channel_accounts.meta | zXAccountMeta / zInstagramAccountMeta / zNoteAccountMeta (§4.5) |
| SSE イベント | zRunProgressEvent (§4.6) |
| API リクエスト | zTranscribeReq 他 (§4.7) |

---

## 3. 認可マトリクスと RLS

### 3.1 ロール定義

| ロール | 実体 | 説明 |
|---|---|---|
| `anon` | 公開サイト訪問者 | Supabase anon key。読み取り専用 |
| `admin` | profiles に存在する認証済みユーザー | 堀さん / 隈部さん。当面 1〜2 名 |
| `service` | service_role key (サーバのみ) | Route Handler / Edge Function 内部処理。クライアントに露出禁止 |

### 3.2 認可マトリクス

| テーブル | anon SELECT | anon INSERT | admin SELECT | admin INSERT/UPDATE | admin DELETE | service |
|---|---|---|---|---|---|---|
| profiles | ✗ | ✗ | 自分のみ | 自分のみ UPDATE | ✗ | 全権 |
| media | published コンテンツから参照される分のみ (public bucket URL 経由) | ✗ | ✓ | ✓ | 参照ゼロのみ | 全権 |
| works / posts / voices | `status='published' and published_at <= now()` のみ | ✗ | ✓ | ✓ | draft のみ (published は archive で代替) | 全権 |
| price_grades / price_options | `is_active=true` のみ | ✗ | ✓ | ✓ | ✗ (is_active=false で代替) | 全権 |
| site_settings | ✓ (公開情報のみのため) | ✗ | ✓ | ✓ | ✗ | 全権 |
| contact_inquiries | ✗ | **✓ (フォーム送信)** | ✓ | ✓ (status 変更) | spam のみ | 全権 |
| ai_sources / ai_runs / channel_drafts / draft_revisions | ✗ | ✗ | ✓ | ✓ | ✗ | 全権 |
| channel_posts | ✗ | ✗ | ✓ | ✓ (cancel のみ; 状態遷移は §4.3 に従う) | ✗ | 全権 |
| channel_accounts | ✗ | ✗ | ✓ (トークンは含まれない) | ✓ | ✓ | 全権 |
| style_profiles | ✗ | ✗ | ✓ | ✓ | ✗ | 全権 |

### 3.3 RLS 実装方針

- 全テーブル `enable row level security`。
- admin 判定は `exists (select 1 from profiles where id = auth.uid())` を共通関数 `is_admin()` (security definer) に切り出す。
- `contact_inquiries` の anon INSERT は **rate limit を Route Handler 側で実施** (IP ごと 5 件/時, Upstash 等は使わず Vercel KV も使わず、簡易に Postgres で直近件数カウント)。RLS はカラム制約のみ (status='new' 固定)。
- SNS トークンは **テーブルに置かない**。Supabase Vault に保存し、Edge Function / Route Handler (service role) だけが `vault.decrypted_secrets` を読む。クライアントには auth_status のみ返す。

### 3.4 Storage バケット認可

| バケット | anon read | admin read | write | 削除 | 保持 |
|---|---|---|---|---|---|
| `media` (公開) | ✓ (公開 URL。published 参照が前提だが URL 秘匿はしない設計 — 秘匿必要な画像は置かない) | ✓ | Server Action (service role) 経由のみ。クライアント直アップロードは**署名付きアップロード URL** (TTL 5 分) で許可 | 参照ゼロ検証 (E301) 通過時のみ | 無期限 |
| `audio` (非公開) | ✗ | 署名付き URL (TTL 60 分) のみ | 同上 (署名付きアップロード) | 自動 | **90 日で自動削除** (pg_cron 日次)。raw_text / cleaned_text は DB に永続のため失われない |
| `backups` (非公開) | ✗ | ✗ (service のみ) | pg_cron (週次 dump) | 12 週分ローテーション | 84 日 |

### 3.5 API エンドポイント認可・契約一覧

Route Handlers (Server Actions 以外の HTTP 境界) の全量。リクエスト型は契約書 §4.7。

| エンドポイント | Method | 認可 | リクエスト型 | 成功応答 | 主エラー |
|---|---|---|---|---|---|
| /api/transcribe | POST | admin セッション | zTranscribeReq | { raw_text } | E303, E405 |
| /api/ai/clean | POST | admin | zCleanReq | zCleanedTranscript | E401-403, E406 |
| /api/ai/runs | POST | admin | zStartRunReq | { run_id } | E101, E401 |
| /api/ai/runs/[id]/stream | GET | admin | — | SSE (zRunProgressEvent) | E402 |
| /api/ai/drafts/[id]/regenerate | POST | admin | zRegenerateReq | { revision } | E401-404 |
| /api/publish/schedule | POST | admin | zScheduleReq | { post_ids } | E101, E505 |
| /api/oauth/x/start | GET | admin | — | 302 → x.com | E201 |
| /api/oauth/x/callback | GET | admin (+state cookie) | query (code, state) | 302 → /admin/channels | E501, E503 |
| /api/revalidate | POST | **shared secret ヘッダ** (`x-revalidate-secret`) | zRevalidateReq | { revalidated } | 401 |
| Edge Fn: publish-worker | — | pg_cron → `net.http_post` (service role key)。外部から呼べないよう **shared secret 必須** | — | — | E5xx |

- CRUD は Server Actions (form 境界)。全 Action の先頭で `requireAdmin()` + Zod parse を必須とする (契約書 §5 の facade 経由)。
- `contact_inquiries` の anon INSERT だけが例外 (InquiryFacade.submit + rate limit §3.3)。

### 3.6 Vault アクセス規約

- **書き込み**: security definer の RPC (`vault_upsert_secret(name, value)`) のみ。呼び出し元は OAuth callback (Route Handler, service role) と publish-worker (refresh 時)。
- **読み出し**: publish-worker のみ (`vault.decrypted_secrets`)。Next.js 側では読まない (X 投稿はすべて worker 経由のため不要)。
- **命名**: `sns_x_oauth` (JSON: access/refresh/expires_at) / `sns_instagram_token`。
- **禁止**: トークンをログ・エラー詳細 (last_error_detail 含む)・クライアント応答に出力すること。E2E でも実トークンをフィクスチャに書かない。
- **ローテーション**: X refresh token は使い捨て → refresh 実行は advisory lock で単一化し、新 access+refresh を同一トランザクションで上書き (契約書 §7.2)。

---

## 4. ライフサイクルと状態意味論

### 4.1 コンテンツ状態 (works / posts / voices 共通)

```
draft ──→ review ──→ published ──→ archived
  ▲          │            │
  └──────────┘            └──→ (published に戻す = 再公開可)
```

| 状態 | 意味論 | 公開側 | 編集 |
|---|---|---|---|
| `draft` | 執筆中。公開の意図なし | 非表示 | 自由 |
| `review` | 公開前の最終確認待ち (AI 産コンテンツは必ずここを通る) | 非表示 | 自由 |
| `published` | 公開。`published_at <= now()` で表示、未来なら予約公開 | 表示 | 編集可 (即時反映+revalidate) |
| `archived` | 公開終了。URL は 410 相当 (Next.js は notFound) | 非表示 | 再公開のみ可 |

**不変条件**: `published_at` は published へ遷移した最初の時刻を保持し、編集では変わらない (更新日時は updated_at)。archived → published の復帰では元の published_at を維持する。

### 4.2 AI 実行状態 (ai_runs)

```
pending → extracting → researching → drafting → ready_for_review → completed
   │           │            │            │              │
   └───────────┴────────────┴────────────┴──→ failed    └──→ cancelled
```

- `researching` はリサーチ有効時のみ通過 (スキップ可)。
- `completed` = 全対象チャネルの draft が approved / rejected いずれかで決着した状態。
- `failed` は error_code (§9) を必ず伴う。再実行は新しい ai_run を作る (immutable log)。

### 4.3 配信状態 (channel_posts)

```
scheduled → publishing → published
    │            │
    │            ├──→ failed ──(手動リトライ: attempt_count+1)──→ scheduled
    │            └──→ manual_required   … note 等 API 投稿不能チャネル
    └──→ cancelled
```

| 状態 | 意味論 |
|---|---|
| `scheduled` | `scheduled_at` 到来を pg_cron が待っている |
| `publishing` | Edge Function が API 呼び出し中。**この状態で 10 分超停滞したら watchdog が failed に倒す** (二重投稿防止のため idempotency_key で外部照会してから) |
| `published` | external_id / external_url 記録済み。終端 |
| `failed` | last_error_code 記録。自動リトライは **しない** (SNS の二重投稿リスク > 遅延リスク)。admin が内容確認の上、手動リトライ |
| `manual_required` | note 用。コピペ支援画面へ誘導し、admin が「投稿済み」を手動マークすると published へ |
| `cancelled` | 終端 |

### 4.4 周辺リソースのライフサイクル

**media (画像)**

```
uploaded ──→ in_use (参照 > 0) ⇄ unused (参照 0) ──→ deleted
   │ is_placeholder=true (仮素材)
   └─ 実写差し替え: 新 media 追加 → 参照付け替え → 旧 media 削除 (admin UI が 3 手順を一括支援、
      付け替え完了時に参照元コンテンツのタグを一括 revalidate — 契約書 §6 media.replaced)
```

- 参照カウントは work_images / works.cover / posts.cover / voices.photo / site_settings (hero, og) を横断集計する view で算出。
- 削除は参照ゼロ検証 (E301) + Storage オブジェクト削除を同一処理で。孤児オブジェクト (DB 行なし Storage あり) は週次 pg_cron で検出レポート。

**audio (音声)**

```
uploaded → transcribed → cleaned → (90 日経過) purged
```

- purge は Storage オブジェクト削除 + ai_sources.audio_storage_path を null 化。raw_text / cleaned_text は DB に残るため、パイプライン再実行・監査は引き続き可能 (音声の再文字起こしのみ不可)。

**channel_accounts (SNS 接続)**

```
disconnected → connected ⇄ expired → connected (再接続)
                   │
                   └→ error (API 側の恒久エラー; 手動対応)
```

- expired 検知時 (§8.2) は該当チャネルの scheduled 全件に警告フラグ。再接続後、admin が明示的に再スケジュール (自動再開しない — 古い予約の誤発射防止)。

---

## 5. 管理画面 (/admin) 画面設計

### 5.1 共通仕様

- 認証: Supabase Auth (email + password)。middleware.ts で `/admin/**` を保護。未認証は `/admin/login` へ。
- レイアウト: 左サイドナビ (Dashboard / 事例 / 記事 / 声 / 価格 / メディア / 問い合わせ / AI スタジオ / チャネル / 設定)。
- 全一覧画面: 検索 + status filter + ページネーション (50 件)。
- **キーボード操作** (メモリ: E2E キーボードチェックリスト適用): 一覧で ↑↓ 行移動 / Enter 詳細 / Esc モーダル閉じ / Cmd+S 保存 / Tab 順序論理的。E2E で全キー検証必須。
- 保存は楽観的排他: `updated_at` を hidden で送り、サーバで不一致なら KMB-E103 (他者更新検知) を返して差分提示。

### 5.2 画面一覧

| 画面 | パス | 主要機能 |
|---|---|---|
| ログイン | /admin/login | email+password。失敗 5 回で 15 分ロック (Supabase 標準) |
| ダッシュボード | /admin | 未処理問い合わせ数 / review 待ち数 / 直近配信結果 / 仮素材残数 |
| 施工事例一覧・編集 | /admin/works, /admin/works/[id] | CRUD + 画像複数添付 (drag&drop 並べ替え) + プレビュー |
| 記事一覧・編集 | /admin/posts, /admin/posts/[id] | kind タブ (reading/news/blog)。Markdown エディタ + プレビュー |
| お客様の声 | /admin/voices | CRUD。星・地域・品目 |
| 価格表 | /admin/prices | grades / options のインライン編集。**変更プレビュー: 変更前後の見積り例 3 パターンを並記して確認後に保存** |
| メディア | /admin/media | グリッド一覧 / アップロード (自動リサイズ・WebP 変換 + **Instagram 用 JPEG レンディション保持** — IG Graph API は JPEG のみ対応) / alt 編集 / is_placeholder 管理 / 参照元表示 |
| 問い合わせ | /admin/inquiries | 一覧 + status 変更。スパムマーク |
| **AI スタジオ** | /admin/studio | §7 のパイプライン UI。録音 / テキスト入力 → 実行 → レビュー → 配信予約 |
| チャネル管理 | /admin/channels | X / Instagram の接続 (OAuth) / note ラベル管理 / style_profiles 編集 |
| サイト設定 | /admin/settings | 会社情報 / ヒーロー / SEO 既定値のフォーム編集 |

### 5.3 AI スタジオ画面フロー

```
[1 入力]           [1.5 整文確認]         [2 実行中]            [3 レビュー]           [4 配信]
音声録音ボタン  →  Claude 整文結果を   →  進行ステップ表示  →  チャネル別タブ     →  チャネルごとに
(MediaRecorder)    raw との差分付きで      extracting…           ├ 差分ビュー (§10)     即時 or 日時指定
or テキスト直書き   確認・手修正            researching…          ├ インライン編集       note は手順ガイド
チャネル選択        (誤認識をここで潰す)    drafting… (SSE で     └ 承認 / 却下 / 再生成
リサーチ on/off                            逐次表示)
```

- 録音: `MediaRecorder` (audio/webm;codecs=opus)。最長 15 分・50MB 上限。アップロード後に即時文字起こし → **Claude 整文 (stage 1.5)** → raw との差分表示付きで人間が確認・修正してから実行 (誤認識・整文の意味改変をパイプラインに流さない)。テキスト直書きの場合も整文は任意適用可 (skip 可)。
- 再生成: 修正指示テキストを添えて該当チャネルのみ再実行。draft_revisions に ai 版として積む。

---

## 6. 公開サイト連携

### 6.1 データ取得と再検証

- 公開ページは Server Components で Supabase (anon key) から fetch。`unstable_cache` + **タグ方式**: `works` / `posts:reading` / `posts:news` / `posts:blog` / `voices` / `prices` / `settings`。
- admin の保存アクション (Server Actions) 完了時に `revalidateTag()` を呼ぶ → 公開側は即時反映。
- 予約公開 (`published_at` が未来) は pg_cron (毎分) が到来分を検知して Next.js の revalidate Webhook (`/api/revalidate`, secret 付き) を叩く。

### 6.2 ダミー → CMS の置換ポイント

| 現在 (Phase 0) | 置換先 |
|---|---|
| `/works` のハードコード 6 カード | works テーブル + `/works/[slug]` 詳細ページ新設 |
| `/voices` のハードコード 3 件 | voices テーブル |
| `/notes` のベタ書き 7 記事 | posts (kind='reading') + `/notes/[slug]` 詳細ページ新設 (**既存アンカー URL からの redirect 対応**) |
| お知らせ (現在なし) | posts (kind='news') をトップに新設セクション |
| AI ブログ (現在なし) | posts (kind='blog') → `/blog`, `/blog/[slug]` 新設 |
| shop-simulator の PRICE_TABLE 定数 | price_grades / price_options を SSR で注入 (クライアント fetch しない) |
| layout.tsx の会社情報 / JSON-LD | site_settings.company |
| hero.jpg / 各ページ画像 | media テーブル + Supabase Storage 公開 URL (next/image remotePatterns 追加) |
| contact フォームの console.log | contact_inquiries INSERT (Server Action) + 完了画面 |

### 6.3 SEO 継続条件

- 既存 14 ルートの URL は変えない。sitemap.ts は DB から動的生成に置換 (works/notes/blog の詳細 URL を追加)。
- 詳細ページの metadata は `generateMetadata()` で DB から生成。OGP 画像は cover_media の公開 URL。

---

## 7. AI コンテンツパイプライン

### 7.1 ステージ設計

| # | ステージ | 実装 | モデル/API | 入出力 |
|---|---|---|---|---|
| 1 | 文字起こし | `/api/transcribe` Route Handler | OpenAI `gpt-4o-transcribe` | audio → raw_text (ai_sources) |
| 1.5 | **整文 (クリーンアップ)** | `/api/ai/clean` | `claude-opus-4-8` + structured outputs | raw_text → cleaned_text (フィラー除去・句読点付与・専門用語誤認識の訂正候補)。**意味の追加・削除は禁止と system で明示**。人間が差分確認後に確定 |
| 2 | 要旨抽出 | `/api/ai/extract` | `claude-opus-4-8` + structured outputs | cleaned_text → brief {主題, トピック[], 対象読者, キーワード[], 事実主張[]} |
| 3 | リサーチ (任意) | `/api/ai/research` | `claude-opus-4-8` + `web_search_20260209` server tool | brief → research_notes {補強事実[], 引用 URL[], 訂正候補[]} |
| 4 | チャネル別脚色 | `/api/ai/draft` (チャネルごと並列) | `claude-opus-4-8` + structured outputs + streaming | brief + research + style_profile → channel content JSON |
| 5 | 人間レビュー | /admin/studio UI | — | 差分表示 (§10) + 編集 + 承認 |
| 6 | 配信 | pg_cron + Edge Function `publish-worker` | X API / IG Graph API / posts INSERT | channel_posts 遷移 (§4.3) |

### 7.2 Claude API 実装規約

```typescript
// 生成呼び出しの標準形 (src/lib/ai/client.ts)
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic(); // ANTHROPIC_API_KEY は Vercel env

// チャネル別ドラフト生成 — streaming + structured outputs
const stream = anthropic.messages.stream({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  system: [
    { type: "text", text: BRAND_SYSTEM_PROMPT,            // 固定 (キャッシュ前提: 変数を入れない)
      cache_control: { type: "ephemeral" } },
  ],
  output_config: { format: { type: "json_schema", schema: CHANNEL_SCHEMA[channel] } },
  messages: [{ role: "user", content: buildUserPrompt(brief, research, styleProfile) }],
});
```

- **モデル**: `claude-opus-4-8` (文章品質最優先の方針)。要旨抽出のような軽処理も同一モデルで統一し、プロンプトキャッシュ効率を優先。コストが問題化したら抽出のみ `claude-haiku-4-5` へ降格を検討。
- **thinking**: adaptive。`budget_tokens` は使用しない (4.8 では 400 エラー)。
- **sampling params**: `temperature` / `top_p` / `top_k` は送らない (4.8 で 400)。表現の多様性はプロンプトで制御。
- **structured outputs**: `output_config.format` (旧 `output_format` は使わない)。チャネル別スキーマは Zod → JSON Schema 変換で単一ソース化。
- **streaming**: 全生成呼び出しで必須 (Vercel Function timeout 対策 + UX)。SSE で /admin/studio に逐次転送。
- **プロンプトキャッシュ**: BRAND_SYSTEM_PROMPT (事業説明・禁止事項・用語集) を先頭固定 + cache_control。style_profile などの可変部は messages 側に置く。
- **リサーチ**: server-side `web_search_20260209` を tools に宣言 (dynamic filtering 内蔵、code_execution の併宣言はしない)。`max_uses: 8` 上限。引用 URL を research_notes に保存し、レビュー画面で人間が検証できるようにする。
- **エラー処理**: SDK の型付き例外で分岐 (`RateLimitError` → retry-after 尊重 1 回だけ再試行 / `APIStatusError` 5xx → KMB-E402 / それ以外 → KMB-E401)。`stop_reason === 'refusal'` は KMB-E403 として UI に「表現を変えて再実行してください」を表示。

### 7.3 文字起こし (OpenAI STT)

- モデル: `gpt-4o-transcribe` ($0.006/分)。品質優先方針により mini 版 ($0.003/分) ではなく標準版。将来コスト最適化する場合のみ `gpt-4o-mini-transcribe` に切替 (env で切替可能に実装)。
- `/api/transcribe`: Supabase Storage の署名付き URL から音声を取得し OpenAI API へ。結果を ai_sources.raw_text に保存。
- 形式: MediaRecorder の webm (Chrome) / mp4 (Safari) はいずれも OpenAI 対応形式のため **変換不要** (調査確定)。
- 上限: 25MB (OpenAI 制約)。超過時はクライアントで事前分割 (10 分単位) して連結。§5.3 の 15 分・50MB 上限はこの分割前提。
- 精度対策: 専門用語 (ソウルレッド、プライマー、耐候クリア等) を prompt パラメータで注入。
- 代替: Deepgram Nova-3 (日本語 WER 5-8%、$0.0043〜/分) が最安帯だが、アカウント数を増やさない方針で OpenAI に統一 (画像生成等の将来利用も見込む)。

### 7.4 プロンプト設計方針

- **BRAND_SYSTEM_PROMPT** (固定): 隈部塗装の事業内容 / 一人称 / 禁止表現 (誇大広告・効果保証・他社比較) / 事実でないことを書かない / 引用元の明記ルール。
- **style_profiles** (DB、admin が編集可能): チャネル別の tone + format。初期値:
  - site_blog: 丁寧なですます調、見出し 2〜4 個、1500〜3000 字、SEO を意識した title
  - note: 一人称の語り口、体験談ベース、2000〜4000 字、ハッシュタグ 3 個
  - x: 1 ツイート 120 字目安、スレッド 1〜5 個、絵文字は控えめ 1 個/ツイート、ハッシュタグ最大 2
  - instagram: キャプション 300〜500 字、改行多め、ハッシュタグ 10〜15、画像候補を media タグから提案
- **ハルシネーション対策**: brief.事実主張[] にない事実を書く場合は research_notes の引用付き事実のみ許可、と system で明示。レビュー画面に「AI が追加した事実」ハイライト (§10)。

### 7.5 実行環境の制約

- 生成 (stage 2-4) は Vercel Route Handler で実行。streaming 応答のため Vercel の function 時間制限に抵触しにくいが、`maxDuration = 300` を明示 (Fluid Compute)。
- 配信 (stage 6) は Supabase Edge Function。pg_cron `* * * * *` (毎分) → `select net.http_post(...)` で publish-worker を起動 → scheduled 到来分を処理。1 回の起動で最大 5 件処理 (X rate limit 保護)。

### 7.6 SSE 生成の切断・再開意味論

- **stage 単位の冪等性**: 各 stage は開始時に ai_runs.status を CAS 更新 (契約書 §7.1)。CAS が 0 行なら他プロセスが実行中とみなし、そのコネクションは監視 (delta 転送) のみ行う。
- **切断時**: SSE 切断で Vercel Function が終了した場合、途中の stage は未 commit のためやり直し対象。クライアント再接続時にサーバが `snapshot` イベント (契約書 §4.6) で DB 上の完了済み状態を送り、pending の stage から再開実行する。
- **watchdog**: 15 分無進捗 (updated_at 停滞) の run は pg_cron (5 分毎) が failed (KMB-E402) に倒す。UI は「再実行」導線を出す (新 run 作成、§4.2 の immutable log 原則)。
- **並行実行**: 同一 source に対する run の並行作成は許可 (比較実験用途)。ただし UI は実行中 run がある場合に確認ダイアログを出す。

### 7.7 X OAuth 2.0 (PKCE) 接続シーケンス

正規シーケンスは契約書 §7.3 が canonical。本書では設計判断のみ記す:

- **PKCE 必須** (調査確定: app-only トークンでは投稿不可)。scope は `tweet.read tweet.write users.read offline.access` (offline.access が refresh token 発行条件)。
- **state / code_verifier の保管**: サーバセッションを持たないため、暗号化 httpOnly cookie (TTL 10 分, SameSite=Lax)。callback で state 不一致は KMB-E501。
- **redirect URI**: `{NEXT_PUBLIC_SITE_URL}/api/oauth/x/callback` を X App 設定に事前登録。Preview 環境では OAuth 接続機能を無効化 (本番 URL のみ登録し、環境変数 `OAUTH_ENABLED` でガード)。
- **refresh 戦略**: X の refresh token は使い捨て (ローテーション式)。publish-worker が有効期限 10 分前を検知したら advisory lock 下で refresh し、新ペアを同一トランザクションで Vault 上書き (§3.6)。lock 待ちのプロセスは更新後のトークンを再読して続行。
- **Instagram**: 長期トークン (60 日) を使用。worker が期限 7 日前に自動延長 (`GET /refresh_access_token`)。延長失敗は auth_status='expired'。

---

## 8. SNS チャネル統合仕様

> **注**: 本節の API 制約・料金は 2026-07-07 の Web 調査 (researcher、公式 Doc 優先) で確定済み。ただし X の従量課金制は 2026-02 移行直後で流動的なため、**Phase 2c 着手時に公式 Pricing ページを再確認**すること。

### 8.1 チャネル別方式

| チャネル | 方式 | 認証 | 制約・前提 (調査確定) |
|---|---|---|---|
| 自サイトブログ | posts テーブル INSERT (内部) | 不要 | 即時。失敗要因ほぼなし |
| X | API v2 `POST /2/tweets` (スレッドは in_reply_to 連結) | **OAuth 2.0 Authorization Code + PKCE** + `tweet.write` スコープ (app-only トークンでは投稿不可)。refresh token を Vault 保存 | 新規開発者は**従量課金制** (2026-02〜): 投稿 $0.015/件、**URL 付き $0.20/件**。ブログ告知ツイートは URL 必須のため 1 スレッド ≈ $0.2〜0.25。月 20 スレッドで $5 前後。画像添付上限は要実装時確認 (公式未確定) |
| Instagram | Graph API Content Publishing (container 作成 → publish) | Meta App + Instagram **プロアカウント + Facebook ページ紐付け必須**。`instagram_business_basic` + `instagram_business_content_publish` 権限。長期トークンを Vault 保存 | 画像は **JPEG のみ・公開 URL 必須** → Supabase Storage 公開バケット + JPEG レンディション (§5.2) で充足。**24h で 100 件上限** (カルーセル 1 件扱い)。他者アカウント運用は App Review (2〜4 週間) 必須、自社アカウントのみなら省略可能性あり (要実機確認 → R2) |
| note | **半自動 (manual_required)** | なし | **公式投稿 API なし (確定)**。非公式 API は 2026-05 の reCAPTCHA 導入で不安定 + 規約リスクのため不採用。§8.3 のコピペ支援フロー |

### 8.2 共通配信規約

- **冪等性**: publish-worker は投稿前に `idempotency_key` で channel_posts を再確認し、`publishing` へ CAS 更新 (`update ... where status='scheduled'` の affected rows = 1 のときだけ進む)。X/IG 応答の external_id を必ず保存。
- **失敗時**: 自動リトライしない (§4.3)。エラー本文を last_error_detail に保存し、ダッシュボードに通知バッジ。
- **課金ガード (X)**: 従量課金のため月間投稿数の上限を site_settings に持ち (初期値 100 件/月)、超過時は scheduled への遷移をブロックして警告 (KMB-E505)。channel_posts の月間 published 集計で判定。
- **トークン失効**: publish-worker が 401 を受けたら channel_accounts.auth_status='expired' に更新し、該当チャネルの scheduled を全部 manual_required 相当の警告表示に。admin が再接続後に手動で再スケジュール。

### 8.3 note 半自動フロー

1. channel_posts が `manual_required` で作られる。
2. /admin/studio の配信タブに「note へコピー」ボタン: タイトル / 本文 (note の Markdown 方言に整形済み) / ハッシュタグを個別コピー + note の投稿画面を新規タブで開く。
3. admin が投稿後、投稿 URL を貼り付けて「投稿済みにする」→ published へ遷移 (external_url 記録)。

### 8.4 X スレッド分割規約

- draft の `thread[]` は生成時点で **X の重み付き字数** (半角 1・全角 2・URL 一律 23、上限 280 = 全角換算 140) を `weightedTweetLength()` (単体テスト付き、サロゲートペア・絵文字 weight 2 対応) で算出し、zXTweet (契約書 §4.4) の refinement で検証。超過は KMB-E404 で自動再生成 1 回。
- 投稿は先頭から順に、前ツイートの id を `reply.in_reply_to_tweet_id` に指定。途中失敗時は **そこで停止**し、投稿済み id 群を external_id (JSON) に記録して failed へ (途中から再開できるよう attempt 情報を保持)。

---

## 9. エラーコード体系

形式: `KMB-E<カテゴリ 1 桁><連番 2 桁>`。ユーザー(admin)向けメッセージ / ログ詳細 / 復旧アクションを src/lib/errors.ts で一元定義。

| コード | カテゴリ | 意味 | 復旧アクション |
|---|---|---|---|
| KMB-E101 | 1xx 入力検証 | Zod validation 失敗 | フォームにフィールド単位で表示 |
| KMB-E102 | | slug/key 一意制約違反 | 別の slug を提案表示 |
| KMB-E103 | | 楽観的排他失敗 (他者更新) | 最新版との差分を提示し選択させる |
| KMB-E201 | 2xx 認証認可 | 未認証 | /admin/login へ |
| KMB-E202 | | RLS 拒否 (権限なし) | 権限確認の案内 |
| KMB-E301 | 3xx メディア | 参照中メディアの削除 | 参照元一覧を表示 |
| KMB-E302 | | アップロード形式/サイズ不正 | 対応形式の案内 |
| KMB-E303 | | 音声 25MB/15 分超過 | 分割の案内 |
| KMB-E401 | 4xx AI | Claude API 呼び出し失敗 (4xx) | 内容修正の上再実行 |
| KMB-E402 | | Claude API 一時障害 (5xx/529) | 時間を置いて再実行 |
| KMB-E403 | | refusal (安全性による拒否) | 表現を変えて再実行 |
| KMB-E404 | | 生成物スキーマ/文字数制約違反 | 自動再生成 1 回 → 失敗なら手動 |
| KMB-E405 | | 文字起こし (gpt-4o-transcribe) 失敗 | 音声再アップロード or テキスト入力 |
| KMB-E406 | | 整文が意味改変を検出 (自己検証 NG) | raw_text のまま人間修正へフォールバック |
| KMB-E501 | 5xx 配信 | X API エラー | detail 確認 → 手動リトライ |
| KMB-E502 | | Instagram API エラー | 同上 |
| KMB-E503 | | トークン失効 | チャネル再接続 |
| KMB-E504 | | スレッド途中失敗 | 続きから再開 |
| KMB-E505 | | X 月間投稿上限超過 (課金ガード) | 上限見直し or 翌月まで待機 |
| KMB-E901 | 9xx システム | 予期しない例外 | ログ (Vercel) 確認 |

---

## 10. 差分表示仕様 (AI 生成物レビュー)

### 10.1 表示対象

| 比較軸 | 用途 |
|---|---|
| raw_text vs cleaned_text | 整文 (stage 1.5) の確認。フィラー除去・誤認識訂正が意味を変えていないかの検証 |
| 元発言 (cleaned_text) vs チャネル draft | AI がどこを脚色・追加したかの俯瞰 |
| draft revision N-1 vs N | 再生成・人間編集の変更点 |
| 「AI が追加した事実」ハイライト | brief.事実主張[] に由来しない文にマーカー + research 引用の有無を表示 |

### 10.2 実装

- ライブラリ: `diff` (jsdiff) の `diffChars` を日本語向けに使用 (単語分割は不要、文字単位で十分)。段落単位でチャンク化してから文字 diff (巨大 diff の視認性対策)。
- 表示: 追加=緑下線、削除=赤取り消し線。「変更のみ表示」トグル。revision セレクタ (v1…vN) で任意 2 版比較。
- 「AI 追加事実」判定: draft 生成時に structured output で `claims: [{text, source: 'speech'|'research'|'inference'}]` を同時出力させ、`inference` 由来の文を UI で黄色マーカー。**判定自体も AI 出力であり完全ではない旨を UI に常時注記**。

---

## 11. テスト戦略

メモリ規約適用: implementer + tester ペア、修正→再検証ループ、**2 回連続 PASS で完了**。単体 + 結合の両方を作る。

| レイヤ | ツール | 対象 | 合格基準 |
|---|---|---|---|
| 単体 | Vitest | Zod スキーマ (全 content JSON) / 価格計算 / X 字数カウント (URL 23 字換算含む) / slug 生成 / 状態遷移ガード関数 / diff チャンク化 | 全ケース green、エッジ (絵文字・サロゲートペア字数) 含む |
| 結合 (DB) | Vitest + `supabase start` (ローカル) | RLS: §3.2 マトリクスの **全セル** を anon/admin/service の 3 クライアントで検証 / 楽観的排他 / published_at filter | マトリクスと実挙動の完全一致 |
| 結合 (API) | Vitest + msw (Claude/Whisper/X/IG をモック) | パイプライン状態遷移 / エラーコード分岐 / 冪等性 (同一 idempotency_key の二重実行) / スレッド途中失敗再開 | §4 の遷移図から外れる遷移が発生しない |
| E2E | Playwright (ローカル) | admin ログイン→各 CRUD→公開側反映 / AI スタジオ (モック AI) の全フロー / **キーボードチェックリスト全項目 (↑↓/Tab/Enter/Esc/Cmd+S)** | 全シナリオ + 全キー PASS |
| AI 品質 (regression) | golden file + 手動評点 | 代表入力 3 本 × 4 チャネルの生成物を保存し、プロンプト変更時に再生成して人間比較 | 堀さん評点 3/5 以上 |
| 本番前 | Chrome MCP 実機 E2E | Vercel Preview 上で主要フロー + 実 API 疎通 (X はテストアカウント) | 完成品納品の条件 |

**AI 呼び出しのモック方針**: 単体・結合・E2E では実 API を呼ばない (msw で SSE 含め record/replay)。実 API を叩くのは AI 品質 regression と本番前 E2E のみ。

### 11.1 フェーズ × テスト対応

| フェーズ | 必須テスト (完了条件に含む) |
|---|---|
| 1a | migration 適用 (clean → up)、RLS マトリクス全セル (§3.2)、Storage バケット認可 (§3.4)、`contracts-ddl-parity.test.ts` (DDL check ↔ Zod 一致)、seed 照合 (A7) + ロールバック検証 (§12.1) |
| 1b | 全 contracts 単体 (境界値・NFC・絵文字)、CRUD E2E (キーボード全項目含む)、楽観的排他 (E103)、価格プレビュー計算 |
| 1c | 移行前後スナップショット比較 (A1)、URL 網羅 crawl (A2)、revalidateTag 反映 (A4)、予約公開の時刻境界 (JST/UTC 変換) |
| 2a | stage 冪等性 (CAS 二重実行)、SSE 切断→再接続復元 (§7.6)、watchdog、25MB 分割 |
| 2b | diff 単体 (§10; 巨大 diff・絵文字)、revision 履歴、承認フロー E2E、inference マーカー表示 |
| 2c | OAuth モック (state 不一致・token 交換失敗)、refresh ローテーション競合 (advisory lock)、冪等性 (idempotency_key)、スレッド途中失敗再開 (E504)、課金ガード (E505)、`weightedTweetLength` 全境界 |
| 2d | 予約投稿の分単位精度、期限切れトークン時の scheduled 保護 (B4)、通知バッジ集計 |

### 11.2 CI 方針

- **GitHub Actions**: push 時に lint + typecheck + 単体 + 結合 (supabase local を service container で起動)。E2E (Playwright) はローカル実行 (CI 時間節約。main マージ前に手元で必須実行)。
- カバレッジ基準: contracts / 価格計算 / weightedTweetLength / 状態遷移ガードは**分岐 100%**。その他は 80% 目安 (数値はゲートにせず、レビューで判断)。
- ※ 「GitHub Actions 不使用」は salon-pos-app 限定の規約であり本プロジェクトには適用しない。不要なら削る (堀さん判断)。

---

## 12. 移行計画と受入基準

### 12.1 移行手順 (Phase 1)

1. Supabase プロジェクト作成 (堀さん) → project_id 共有。
2. migration 適用 (§2 DDL) + RLS + Vault セットアップ。
3. **seed スクリプト** (`scripts/seed-from-legacy.ts`): Phase 0 のハードコードコンテンツ (works 6 / voices 3 / notes 7 記事 / PRICE_TABLE / 会社情報 / 画像 14 枚) をパースして DB + Storage へ投入。全件 `status='published'`、`is_placeholder=true`。
   - **スナップショット + ロールバック** (一括書き込み規約適用): 投入は 1 トランザクション + `seed_manifest` テーブル (投入した行 id / Storage パスを記録)。`scripts/rollback-seed.ts` が manifest 逆順で削除 (DB → Storage の順)。
   - **冪等性**: slug / storage_path の unique 衝突を検知したら該当項目を skip して報告 (上書きしない)。再実行安全。
   - ソースはハードコード TSX を手動転記した `scripts/seed-data/*.ts` (型は契約書 §4 のスキーマで検証してから投入)。AST パースはしない (6+3+7 件は手動転記の方が確実)。
4. 公開ページを DB fetch へ切替 (§6.2)。
5. 受入検証 (§12.2) → merge → Vercel 本番反映。

### 12.2 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| A1 | 移行後の公開側 HTML が移行前と実質同一 (文言・画像・並び順) | 全 14 ルートのレンダリング結果を移行前後でスナップショット比較。差分は意図されたもの (詳細ページ新設等) のみ |
| A2 | 既存 URL が 1 本も 404 にならない | sitemap 全 URL + notes 内アンカーを crawl |
| A3 | Lighthouse Performance/SEO が移行前スコア -5 以内 | 移行前後で計測 |
| A4 | admin で works を 1 件編集→保存→公開側に 5 秒以内反映 | 手動 + E2E |
| A5 | RLS マトリクス全セル PASS | §11 結合テスト |
| A6 | contact フォーム送信 → inquiries に記録 → admin で閲覧 | E2E |
| A7 | seed 投入データの件数・本文完全一致 | seed 後の DB dump と legacy 抽出の照合スクリプト |

### 12.3 Phase 2 受入基準 (抜粋)

- B1: 5 分音声 → 4 チャネル draft 生成が 5 分以内に ready_for_review 到達。
- B2: 承認なしに外部 SNS へ一切送信されない (コードレビュー + E2E で担保)。
- B3: X スレッド投稿が全件成功、途中失敗時に残りが二重投稿されない (モックで注入試験)。
- B4: トークン失効時に scheduled が誤送信されず警告表示される。

---

## 13. フェーズ分割と規模見積り

| フェーズ | 内容 | 新規テーブル | 新規画面 | 概算規模 | 依存 |
|---|---|---|---|---|---|
| **1a** | Supabase 基盤: migration / RLS / Auth / Storage / seed | 11 | login のみ | M (2-3 千行, migration+seed 中心) | Supabase アカウント |
| **1b** | admin CRUD (works/posts/voices/prices/media/inquiries/settings) | — | 9 | L (6-8 千行) | 1a |
| **1c** | 公開側 DB 接続 + 詳細ページ + revalidate + 受入検証 | — | 3 (詳細) | M (2-3 千行) | 1a (1b と並行可) |
| **2a** | AI スタジオ: 録音 / Whisper / extract / draft (SSE) | 4 (ai_*) | 1 (studio) | L (4-6 千行) | 1a, Anthropic/OpenAI アカウント |
| **2b** | レビュー UI: 差分表示 / revision / 承認フロー | 2 | studio 内 | M (2-3 千行) | 2a |
| **2c** | X / Instagram 接続 + publish-worker + note 半自動 | 2 | 1 (channels) | L (4-5 千行) | 2b, X/Meta アカウント |
| **2d** | 予約投稿 (pg_cron) + ダッシュボード統合 + 本番 E2E | — | — | S-M (1-2 千行) | 2c |

- 実装は **implementer + tester ペア** をフェーズごとに配置 (メモリ規約)。1b はモジュール境界 (契約書 §1 のモジュール単位) で implementer 3 並列 + worktree 分離。
- **全フェーズ共通の着手条件**: docs/module-contracts.md の該当契約 (Zod / facade / 依存方向) を確認してから実装。契約にない型・境界を実装内で発明しない。契約変更が必要なら契約書 §8 の手順 (文書先行) に従う。
- 1a の成果物に ESLint 境界ルール (契約書 §2) と `contracts-ddl-parity.test.ts` を含める。
- 全体で DDL 18 テーブル (§2.2 の全定義: platform 1 / コンテンツ系 8 / 問い合わせ 1 / AI 4 / 配信 3 / seed 1)、admin 12 画面、公開新設 3 ルート。

---

## 14. ランニングコスト試算

前提: 月間 AI 実行 20 本 (音声平均 5 分)、各 4 チャネル生成、再生成率 50%。

| 項目 | 単価 | 月額概算 |
|---|---|---|
| Vercel | Hobby $0 (商用利用は Pro $20 推奨) | $0〜20 |
| Supabase | Free (500MB DB / 1GB Storage) で当面充足、超過で Pro $25 | $0〜25 |
| Claude API (`claude-opus-4-8` $5/$25 per MTok) | 1 実行 ≈ in 70K (整文含む・キャッシュ込) + out 25K ≈ $1.0 × 30 実行 (再生成込) | ≈ $30 |
| Claude web_search | リサーチ有効時のみ。1 実行 8 検索上限 | 数 $ |
| gpt-4o-transcribe | $0.006/分 × 5 分 × 20 本 = 100 分 | ≈ $0.6 |
| X API (従量課金) | URL 付き投稿 $0.20/件。月 20 スレッド (各 1〜3 ツイート、先頭のみ URL) | ≈ $5〜10 |
| Meta Graph API | 無料 | $0 |

**合計は月 $35〜60 (Vercel/Supabase 無料枠なら AI+X のみで $30〜40)** が目安。X は投稿数に比例するため §8.2 の課金ガードで上限管理する。

---

## 15. リスクと要確認事項

| # | リスク / 未確定 | 影響 | 対応 |
|---|---|---|---|
| R1 | X API 従量課金の細部 (画像添付上限・旧 Free tier 経過措置の有無は情報源間で不一致) | 月額コスト・2c の実装方式 | 料金体系は確定済み (§8.1)。細部は Phase 2c 着手時に公式 Pricing を再確認。コスト超過時は課金ガード (§8.2) + X も半自動 (§8.3 流用) へフォールバック可能な設計 |
| R2 | Instagram App Review: 自社アカウントのみの運用で審査省略できるかが情報源により曖昧 | 2c のスケジュール (審査必要なら +2〜4 週間) | Meta App 作成時に実機確認。審査必要と判明したら 2c を X 先行で進め IG を後追いに |
| R3 | note の公式 API なし (確定) | note のみ半自動 | §8.3 で設計済み。非公式 API は reCAPTCHA + 規約リスクで不採用決定 |
| R4 | Whisper の日本語専門用語誤認識 | 生成品質 | prompt へ用語注入 + 文字起こし確認ステップを必須化済み (§5.3) |
| R5 | AI の事実捏造 | ブランド毀損 | inference マーカー (§10.2) + 必ず人間承認 (§4.3) + BRAND_SYSTEM_PROMPT 禁止事項 |
| R6 | SNS トークンの漏洩 | アカウント乗っ取り | Vault 保管 + service role 限定アクセス + クライアント非露出 (§3.3) |
| R7 | Vercel Hobby の商用利用規約 | 規約違反 | 公開運用開始時に Pro 移行を推奨 |
| R8 | 二重投稿 | 信用低下 | idempotency_key + CAS + 自動リトライ禁止 (§8.2) |

---

## 16. 非機能要件

### 16.1 性能目標

| 対象 | 目標 | 計測 |
|---|---|---|
| 公開ページ LCP | ≤ 2.5s (モバイル 4G 想定) | Lighthouse (受入 A3 と併用) |
| 公開ページ TTFB | ≤ 600ms (キャッシュヒット時) | Vercel Analytics |
| admin 初期表示 | ≤ 3s | 手動計測 |
| AI 実行 (5 分音声 → 4 チャネル) | ≤ 5 分 (B1) | ai_runs のタイムスタンプ |
| 保存 → 公開反映 | ≤ 5s (A4) | E2E |

### 16.2 監視・通知

- **ログ**: Vercel (Next.js) + Supabase (DB/Edge Fn)。エラーコード (KMB-E*) を構造化ログに必ず含め、コードで検索可能にする。
- **失敗通知**: Phase 1〜2c はダッシュボードバッジ (配信失敗数 / 未処理問い合わせ数 / expired チャネル)。Phase 2d でメール通知 (Resend) を追加するか堀さん判断 (アカウント +1 のため)。
- **定期ジョブの死活**: pg_cron ジョブは `cron.job_run_details` を週次で admin ダッシュボードに表示 (静かな停止の検知)。

### 16.3 バックアップ・復旧

- 週次 `pg_dump` を Storage `backups/` に保存 (12 週ローテーション、pg_cron)。
- 本番運用開始 (実写差し替え・実問い合わせ受付開始) と同時に **Supabase Pro へ移行し PITR 有効化を推奨**。それまでは週次 dump が唯一の復旧手段である旨を明記。
- 復旧手順: dump からのリストア → Storage は media が公開バケットで消失リスク低 (誤削除は E301 ガードで防止)。audio は 90 日で消える設計のため復旧対象外。

### 16.4 容量管理

- Supabase Free 枠: DB 500MB / Storage 1GB。audio 90 日削除 (§4.4) と画像 2560px リサイズ (§2.4) で当面充足。使用量を admin ダッシュボードに月次表示し、80% 超で警告。

---

## 17. 設計チェックリスト適合表

堀さん品質基準 (必須 10 章 + モジュール契約規約) との対応:

| チェック項目 | 対応箇所 |
|---|---|
| 認可マトリクス | §3.2 (DB) + §3.4 (Storage) + §3.5 (API) + §3.6 (Vault) |
| テスト戦略表 | §11 + §11.1 (フェーズ対応) + §11.2 (CI) |
| エラーコード | §9 (所有は契約書 §1) |
| ライフサイクル | §4.1〜4.3 (コンテンツ/AI/配信) + §4.4 (media/audio/アカウント) |
| 全データパターン | §2.3 + §2.4 (データ規約) |
| 印刷出力 | §0.3 (該当なし明記) |
| 移行受入基準 | §12 (snapshot+rollback 含む) |
| 規模見積り | §13 |
| 状態意味論 | §4.1〜4.4 + §7.6 (SSE 再開) |
| 差分表示仕様 | §10 |
| **モジュール契約 (全プロジェクト規約)** | **docs/module-contracts.md** (境界/依存方向/facade/イベント/結合シーケンス) |
| **値契約 (Zod canonical)** | 契約書 §4 + 本書 §2.5 (JSONB 対応表) |
| 非機能要件 | §16 |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-07-07 | 初版 draft |
| v1.0 | 2026-07-07 | SNS API 調査反映 (X 従量課金 / IG 制約 / note API なし確定) |
| v1.1 | 2026-07-07 | 整文ステージ (stage 1.5) 追加 (ユーザー指摘) |
| v2.0 | 2026-07-07 | 設計厳格化 (ユーザー指摘): module-contracts.md 分離 / Zod canonical 化 / Storage・API・Vault 認可 / 周辺ライフサイクル / OAuth・SSE シーケンス / X 字数規約修正 (重み付き 280) / seed rollback / NFR / CI 方針 |
| v2.1 | 2026-07-07 | スキーマ完了監査: 契約書 §4.8 (CRUD 入力契約) / §4.9 (facade 補助型) 追加、zRunStage から cleaning 除去 (状態機械と整合)、seed_manifest DDL 追加、テーブル数 18 に訂正 |
