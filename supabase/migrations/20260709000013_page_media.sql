-- =========================================================
-- ビジュアル画像エディタ V1: page_media (ページ装飾/ヒーロー画像スロット)
-- canonical: docs/design/visual-media-editor.md §2 (DDL) / §2.1 / §2.2 / §5.5 / §6.1
--
-- 本 migration が追加するもの (§2 の記述通り、DDL 追加は 1 テーブル + 1 view のみ):
--   1) page_media テーブル + trigger + RLS 4 ポリシー + grant
--   2) public.page_media_resolved view (resolver 用 join view)
--   3) media_reference_summary view (20260708000008) の DROP + CREATE 置換
--      (page_media 参照カウントを合算。§5.5 MAJOR-8 対応)
--   4) media_admin_delete RLS ポリシー (20260708000002) の DROP + CREATE 置換
--      (page_media 参照ゼロ判定を追加。§5.5 MAJOR-8 対応)
--   5) replace_work_image RPC (§6.1: work_images ギャラリー置換の atomic 契約)
--   6) site_settings.hero から media_id を除去する UPDATE (§1 BLOCKER-1: hero 画像を
--      page_media.home.hero に一本化。hero はテキストのみに縮退)
--
-- migration 連番は 0013 (現行 migration は 0001〜0012 の 12 本、§2 の記述通り)。
-- 一字一句 docs/design/visual-media-editor.md §2 / §6.1 の定義に従う。乖離があれば
-- 設計書を正とし本ファイルを直す。
-- =========================================================

-- =========================================================
-- 1) page_media テーブル
-- =========================================================
-- ページの装飾/ヒーロー画像スロット。slot_key はコード側の registry (§3、
-- src/modules/page-media/registry.ts) が正。
create table page_media (
  slot_key text primary key,          -- 'home.hero' | 'home.craft.1' 等 (§3 registry と 1:1)
  media_id uuid references media(id),  -- null = 既定画像 (default_src) を使用
  alt_override text,                   -- null = media.alt or registry.altDefault
  updated_at timestamptz not null default now()
);
-- default_src / page / section_label / aspect / sort_order 等の静的メタは DB に持たず
-- コード側の SLOT_REGISTRY (§3) が単一ソース。page_media は「差し替えられた分」だけを保持する。
--
-- BLOCKER-v1.3 対応 (updated_by 廃止):
--   v1.2 は「anon には view 経由でだけアクセスさせ base table へは direct grant しない」としたが、
--   security_invoker view は呼び出しロールが underlying table の SELECT 権限も要求するため矛盾していた。
--   さらに Supabase は default privileges で public スキーマの全テーブルに anon/authenticated へ
--   grant を発行するため、「grant しない」は現実の環境と不一致。
--   v1.3 の割り切り: page_media は全列が公開メタデータ (slot_key はレンダリング済み HTML から自明、
--   media_id は公開 URL に含まれる、alt は HTML に出る)。唯一の秘匿候補だった updated_by 列は
--   単一 admin サイトで監査価値が低いため列ごと廃止し、露出しうる秘匿情報をゼロにする。
--   anon は base table を直接 SELECT してもよい (RLS ポリシーで明示許可)。

create trigger handle_updated_at before update on page_media
  for each row execute procedure extensions.moddatetime (updated_at);

alter table page_media enable row level security;

create policy page_media_anon_select on page_media for select using (true);
create policy page_media_admin_insert on page_media for insert with check (public.is_admin());
create policy page_media_admin_update on page_media for update using (public.is_admin()) with check (public.is_admin());
create policy page_media_admin_delete on page_media for delete using (public.is_admin());

-- MINOR-v1.4: Supabase の default privileges に依存せず grant を明記 (移植性)
grant select on page_media to anon, authenticated;
grant insert, update, delete on page_media to authenticated;

-- =========================================================
-- 2) page_media_resolved view
-- =========================================================
-- resolver が 1 クエリで alt を得るための join view (利便目的であり、アクセス制御目的ではない)。
-- media は既存ポリシー media_anon_select (0002: using true) により anon SELECT 可のため、
-- security_invoker=true でも anon から全行読める。grant は 0008 の media_reference_summary の前例踏襲。
create or replace view public.page_media_resolved
with (security_invoker = true) as
select
  pm.slot_key,
  pm.media_id,
  pm.alt_override,
  m.alt as media_alt
from page_media pm
left join media m on m.id = pm.media_id;

grant select on public.page_media_resolved to anon, authenticated;

-- =========================================================
-- 3) media_reference_summary view (20260708000008) の DROP + CREATE 置換
-- =========================================================
-- §5.5 MAJOR-8: page_media からの参照もカウントに合算する。旧定義 (0008) に
-- page_media の集計項を 1 つ追加しただけで、他の項・出力列は不変。
drop view if exists public.media_reference_summary;

create view public.media_reference_summary
with (security_invoker = true) as
select
  m.id as media_id,
  (
    (select count(*) from work_images wi where wi.media_id = m.id)
    + (select count(*) from works w where w.cover_media_id = m.id)
    + (select count(*) from posts p where p.cover_media_id = m.id)
    + (select count(*) from voices v where v.photo_media_id = m.id)
    + (
        select count(*) from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
      )
    + (select count(*) from page_media pm where pm.media_id = m.id)
  )::int as reference_count
from media m;

grant select on public.media_reference_summary to anon, authenticated;

-- =========================================================
-- 4) media_admin_delete RLS ポリシー (20260708000002) の DROP + CREATE 置換
-- =========================================================
-- §5.5 MAJOR-8: page_media から参照されている media は削除不可にする。旧定義 (0002) に
-- page_media の参照ゼロ判定を 1 条件追加しただけで、他の条件は不変。
drop policy if exists media_admin_delete on media;

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
    and not exists (select 1 from page_media pm where pm.media_id = media.id)
  );

-- =========================================================
-- 5) replace_work_image RPC (§6.1: work_images ギャラリー置換の atomic 契約)
-- =========================================================
-- sort_order はクライアントから受け取らない。Server (本 RPC) が対象行から読み直して維持する。
-- setWorkImage (ContentFacade) はこの RPC のみを呼ぶ。
create or replace function public.replace_work_image(
  p_work_id uuid,
  p_old_media_id uuid,
  p_new_media_id uuid   -- null は「削除」
)
returns void
language plpgsql
security invoker  -- admin RLS (migration 0012 の is_admin() 書き込みポリシー) を適用する
set search_path = public
as $$
declare
  v_sort_order int;
begin
  -- 1) 対象行を FOR UPDATE でロック取得。存在しなければエラー
  select sort_order into v_sort_order
  from work_images
  where work_id = p_work_id and media_id = p_old_media_id
  for update;

  if not found then
    raise exception 'KMB-E109: work_images(%, %) not found', p_work_id, p_old_media_id;
  end if;

  -- 2) 削除ケース
  if p_new_media_id is null then
    delete from work_images where work_id = p_work_id and media_id = p_old_media_id;
    return;
  end if;

  -- 3) 同一 work_id に new_media_id が既に存在すると PK (work_id, media_id) 一意違反。
  --    409 相当のエラーで返し、UI が「既に追加されている画像です」と表示。
  if exists (
    select 1 from work_images
    where work_id = p_work_id and media_id = p_new_media_id
  ) then
    raise exception 'KMB-E108: work_images(%, %) already exists', p_work_id, p_new_media_id;
  end if;

  -- 4) delete + insert を同一トランザクションで (関数全体が 1 tx)
  delete from work_images where work_id = p_work_id and media_id = p_old_media_id;
  insert into work_images (work_id, media_id, sort_order)
  values (p_work_id, p_new_media_id, v_sort_order);

exception
  -- MAJOR-v1.3: 事前 exists チェックをすり抜ける同時挿入 (別トランザクションが同じ
  -- p_new_media_id を先に insert) は PK unique_violation になる。E108 に正規化する。
  when unique_violation then
    raise exception 'KMB-E108: work_images(%, %) already exists (concurrent insert)', p_work_id, p_new_media_id;
end;
$$;

revoke execute on function public.replace_work_image(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_work_image(uuid, uuid, uuid) to authenticated;
-- 実行は admin セッションを想定。RLS は work_images への is_admin() 書き込みポリシー (migration 0012) で担保。
-- (revoke/grant パターンは 0009 ai_run_* の前例踏襲)

-- =========================================================
-- 6) site_settings.hero の media_id 除去 (§1 BLOCKER-1: hero 画像を page_media.home.hero
--    に一本化。既存行があれば value から media_id を除去し、hero はテキストのみに縮退)
-- =========================================================
update site_settings
   set value = value - 'media_id'
 where key = 'hero'
   and value ? 'media_id';
