-- =========================================================
-- ビジュアルテキストエディタ T1: page_text (公開ページのテキストスロット差分)
-- canonical: docs/design/visual-text-editor.md §1 (DDL)
--
-- page_media (0013) と対称の設計。差分のみ保持し、行なし = registry (§2、
-- src/modules/page-media/text-registry.ts の TEXT_REGISTRY) の defaultText。
-- page_media と異なり join 相手 (media) が無いため、resolver 用の view は作らない
-- (素の 1 SELECT で足りる、§1 の記述通り)。
--
-- 「既定に戻す」= 行削除。text_override に null 概念は持たない (not null 制約)
-- ——page_media の media_id=null 相当の中間状態は、テキストには不要なため単純化する。
--
-- 本 migration は T1 実装時点では **適用しない** (DDL 定義のみ。DB 適用は別タスク)。
-- =========================================================

create table page_text (
  slot_key text primary key,           -- TEXT_REGISTRY (text-registry.ts) と 1:1
  text_override text not null,         -- null 概念は「行削除 = 既定に戻す」で表現する
  updated_at timestamptz not null default now()
);

create trigger handle_updated_at before update on page_text
  for each row execute procedure extensions.moddatetime (updated_at);

alter table page_text enable row level security;

create policy page_text_anon_select on page_text for select using (true);
create policy page_text_admin_insert on page_text for insert with check (public.is_admin());
create policy page_text_admin_update on page_text for update using (public.is_admin()) with check (public.is_admin());
create policy page_text_admin_delete on page_text for delete using (public.is_admin());

-- anon SELECT の割り切りは page_media (migration 0013 BLOCKER-v1.3) と同一判断:
-- 全列が公開 HTML にそのまま出る公開メタデータ (slot_key はレンダリング済み HTML から
-- 自明、text_override はそのまま画面に表示される文言そのもの)。
grant select on page_text to anon, authenticated;
grant insert, update, delete on page_text to authenticated;
