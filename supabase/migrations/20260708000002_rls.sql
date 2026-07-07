-- =========================================================
-- 隈部塗装 CMS + AI コンテンツパイプライン: RLS
-- canonical: docs/design/cms-ai-pipeline.md §3.2 (認可マトリクス) / §3.3 (RLS 実装方針)
--
-- ---------------------------------------------------------
-- §3.2 マトリクスとポリシーの対応表 (突き合わせ用コメント)
-- ---------------------------------------------------------
-- テーブル                                    | anon SELECT                                  | anon INSERT          | admin SELECT | admin INSERT/UPDATE                  | admin DELETE            | service
-- -------------------------------------------|-----------------------------------------------|----------------------|--------------|----------------------------------------|--------------------------|--------
-- profiles                                    | ✗                                              | ✗                    | 自分のみ      | 自分のみ UPDATE (INSERT 無し)           | ✗                        | 全権 (bypass)
-- media                                       | 全行 SELECT 可 (公開レンディション前提)*        | ✗                    | ✓            | ✓                                       | 参照ゼロのみ (trigger 相当条件)| 全権 (bypass)
-- works                                       | status='published' and published_at<=now()     | ✗                    | ✓            | ✓                                       | status='draft' のみ      | 全権 (bypass)
-- posts                                       | 同上                                            | ✗                    | ✓            | ✓                                       | status='draft' のみ      | 全権 (bypass)
-- voices                                      | 同上                                            | ✗                    | ✓            | ✓                                       | status='draft' のみ      | 全権 (bypass)
-- price_grades                                | is_active=true                                  | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- price_options                               | is_active=true                                  | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- site_settings                               | 全行 (公開情報のみのため)                        | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- contact_inquiries                           | ✗                                              | ✓ (status='new' 固定) | ✓            | ✓ (status 変更)                         | status='spam' のみ       | 全権 (bypass)
-- rate_limits                                 | ✗ (ポリシー無し=拒否)                            | ✗ (同上)             | ✗ (同上)     | ✗ (同上)                                | ✗ (同上)                 | 全権 (bypass。service 専用)
-- ai_sources                                  | ✗                                              | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- ai_runs                                     | ✗                                              | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- channel_drafts                              | ✗                                              | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- draft_revisions                             | ✗                                              | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- channel_posts                               | ✗                                              | ✗                    | ✓            | UPDATE のみ・status='cancelled' 遷移限定 | ✗                        | 全権 (bypass。scheduled/publishing 等は worker=service が処理)
-- channel_accounts                            | ✗                                              | ✗                    | ✓            | ✓                                       | ✓                        | 全権 (bypass)
-- style_profiles                              | ✗                                              | ✗                    | ✓            | ✓                                       | ✗                        | 全権 (bypass)
-- work_images (§3.2 に明示無し・junction table) | ✗ (ポリシー無し=拒否)                            | ✗ (同上)             | ✗ (同上)     | ✗ (同上)                                | ✗ (同上)                 | 全権 (bypass。ContentFacade が service 経由で書込む前提)
-- seed_manifest (§3.2 に明示無し・内部台帳)     | ✗ (ポリシー無し=拒否)                            | ✗ (同上)             | ✗ (同上)     | ✗ (同上)                                | ✗ (同上)                 | 全権 (bypass。seed script のみ使用)
--
-- * media の anon SELECT は §3.2 原文では「published コンテンツから参照される分のみ」だが、
--   本 migration ではオーケストレーター指示に従い全行 SELECT 許可で実装 (詳細は実装報告を参照)。
-- =========================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid())
$$;

-- =========================================================
-- RLS 有効化 (全 19 テーブル)
-- =========================================================
alter table profiles enable row level security;
alter table media enable row level security;
alter table works enable row level security;
alter table work_images enable row level security;
alter table posts enable row level security;
alter table voices enable row level security;
alter table price_grades enable row level security;
alter table price_options enable row level security;
alter table site_settings enable row level security;
alter table contact_inquiries enable row level security;
alter table rate_limits enable row level security;
alter table ai_sources enable row level security;
alter table ai_runs enable row level security;
alter table channel_drafts enable row level security;
alter table draft_revisions enable row level security;
alter table channel_posts enable row level security;
alter table channel_accounts enable row level security;
alter table style_profiles enable row level security;
alter table seed_manifest enable row level security;

-- =========================================================
-- profiles: 自分の行のみ SELECT/UPDATE。INSERT は service のみ (ポリシー無し = RLS が拒否)
-- =========================================================
create policy profiles_self_select on profiles
  for select
  using (auth.uid() = id);

create policy profiles_self_update on profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- =========================================================
-- media: 全行 SELECT (公開レンディション前提)。admin は SELECT/INSERT/UPDATE 全権、
-- DELETE は参照ゼロ (work_images / works.cover / posts.cover / voices.photo /
-- site_settings.value 内の media_id 参照) の場合のみ
-- =========================================================
create policy media_anon_select on media
  for select
  using (true);

create policy media_admin_insert on media
  for insert
  with check (public.is_admin());

create policy media_admin_update on media
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy media_admin_delete on media
  for delete
  using (
    public.is_admin()
    and not exists (select 1 from work_images wi where wi.media_id = media.id)
    and not exists (select 1 from works w where w.cover_media_id = media.id)
    and not exists (select 1 from posts p where p.cover_media_id = media.id)
    and not exists (select 1 from voices v where v.photo_media_id = media.id)
    and not exists (
      select 1 from site_settings s
      where s.value @> jsonb_build_object('media_id', media.id::text)
         or s.value @> jsonb_build_object('og_media_id', media.id::text)
    )
  );

-- =========================================================
-- works / posts / voices: 公開状態のみ anon 参照可。admin は全権 (DELETE は draft のみ)
-- =========================================================
create policy works_anon_select on works
  for select
  using (status = 'published' and published_at <= now());

create policy works_admin_select on works
  for select
  using (public.is_admin());

create policy works_admin_insert on works
  for insert
  with check (public.is_admin());

create policy works_admin_update on works
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy works_admin_delete on works
  for delete
  using (public.is_admin() and status = 'draft');

create policy posts_anon_select on posts
  for select
  using (status = 'published' and published_at <= now());

create policy posts_admin_select on posts
  for select
  using (public.is_admin());

create policy posts_admin_insert on posts
  for insert
  with check (public.is_admin());

create policy posts_admin_update on posts
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy posts_admin_delete on posts
  for delete
  using (public.is_admin() and status = 'draft');

create policy voices_anon_select on voices
  for select
  using (status = 'published' and published_at <= now());

create policy voices_admin_select on voices
  for select
  using (public.is_admin());

create policy voices_admin_insert on voices
  for insert
  with check (public.is_admin());

create policy voices_admin_update on voices
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy voices_admin_delete on voices
  for delete
  using (public.is_admin() and status = 'draft');

-- =========================================================
-- price_grades / price_options: is_active=true のみ anon 参照可。admin 全権 (DELETE 不可)
-- =========================================================
create policy price_grades_anon_select on price_grades
  for select
  using (is_active = true);

create policy price_grades_admin_select on price_grades
  for select
  using (public.is_admin());

create policy price_grades_admin_insert on price_grades
  for insert
  with check (public.is_admin());

create policy price_grades_admin_update on price_grades
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy price_options_anon_select on price_options
  for select
  using (is_active = true);

create policy price_options_admin_select on price_options
  for select
  using (public.is_admin());

create policy price_options_admin_insert on price_options
  for insert
  with check (public.is_admin());

create policy price_options_admin_update on price_options
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- site_settings: 全行 anon SELECT 可 (公開情報のみのため)。admin 全権 (DELETE 不可)
-- =========================================================
create policy site_settings_anon_select on site_settings
  for select
  using (true);

create policy site_settings_admin_insert on site_settings
  for insert
  with check (public.is_admin());

create policy site_settings_admin_update on site_settings
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- contact_inquiries: anon は INSERT のみ (status='new' 固定)。admin 全権
-- (DELETE は status='spam' のみ)
-- =========================================================
create policy contact_inquiries_anon_insert on contact_inquiries
  for insert
  with check (status = 'new');

create policy contact_inquiries_admin_select on contact_inquiries
  for select
  using (public.is_admin());

create policy contact_inquiries_admin_update on contact_inquiries
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy contact_inquiries_admin_delete on contact_inquiries
  for delete
  using (public.is_admin() and status = 'spam');

-- =========================================================
-- rate_limits: anon/authenticated とも直接アクセス不可。ポリシーを作らない
-- (service_role のみが RLS を bypass してアクセス)
-- =========================================================

-- =========================================================
-- ai_sources / ai_runs / channel_drafts / draft_revisions: admin 全権 (DELETE 不可)。
-- anon アクセス不可
-- =========================================================
create policy ai_sources_admin_select on ai_sources
  for select
  using (public.is_admin());

create policy ai_sources_admin_insert on ai_sources
  for insert
  with check (public.is_admin());

create policy ai_sources_admin_update on ai_sources
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy ai_runs_admin_select on ai_runs
  for select
  using (public.is_admin());

create policy ai_runs_admin_insert on ai_runs
  for insert
  with check (public.is_admin());

create policy ai_runs_admin_update on ai_runs
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy channel_drafts_admin_select on channel_drafts
  for select
  using (public.is_admin());

create policy channel_drafts_admin_insert on channel_drafts
  for insert
  with check (public.is_admin());

create policy channel_drafts_admin_update on channel_drafts
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy draft_revisions_admin_select on draft_revisions
  for select
  using (public.is_admin());

create policy draft_revisions_admin_insert on draft_revisions
  for insert
  with check (public.is_admin());

create policy draft_revisions_admin_update on draft_revisions
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- channel_posts: admin SELECT 全権。UPDATE は cancel 遷移のみ許可
-- (scheduled/publishing/published 等の状態遷移は worker=service が処理・§4.3)。
-- admin INSERT / DELETE は無し (作成は DistributionFacade 経由の service 処理)
-- =========================================================
create policy channel_posts_admin_select on channel_posts
  for select
  using (public.is_admin());

create policy channel_posts_admin_cancel_update on channel_posts
  for update
  using (public.is_admin())
  with check (public.is_admin() and status = 'cancelled');

-- =========================================================
-- channel_accounts: admin 全権 (トークン実体は含まれない。Vault 参照名のみ)
-- =========================================================
create policy channel_accounts_admin_select on channel_accounts
  for select
  using (public.is_admin());

create policy channel_accounts_admin_insert on channel_accounts
  for insert
  with check (public.is_admin());

create policy channel_accounts_admin_update on channel_accounts
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy channel_accounts_admin_delete on channel_accounts
  for delete
  using (public.is_admin());

-- =========================================================
-- style_profiles: admin 全権 (DELETE 不可)
-- =========================================================
create policy style_profiles_admin_select on style_profiles
  for select
  using (public.is_admin());

create policy style_profiles_admin_insert on style_profiles
  for insert
  with check (public.is_admin());

create policy style_profiles_admin_update on style_profiles
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- work_images / seed_manifest: §3.2 マトリクスに明示無し。
-- ポリシーを作らない (service_role のみアクセス。ContentFacade / seed script が担当)
-- =========================================================

-- =========================================================
-- service_role は RLS を bypass するため、上記いずれのテーブルにも
-- service 向けの個別ポリシーは不要 (Supabase の仕様上デフォルトで全権)
-- =========================================================
