-- =========================================================
-- work_images の全置換 RPC (施工事例フォームのギャラリー保存を単一トランザクション化)
-- canonical: docs/design/cms-ai-pipeline.md §2.2 (work_images DDL) / §6.1
--
-- 背景 (レビュー指摘):
--   ContentFacade.createWork / updateWork のギャラリー保存 (repository.replaceWorkImages) は
--   PostgREST の delete → insert の 2 呼び出しで実装されており、insert が FK 違反 (存在しない
--   media_id) や一時障害で失敗すると delete だけが残ってギャラリーが空になる (非原子)。
--
-- 対策:
--   pricing_replace_all (20260906000010) と同パターンの security definer 関数
--   work_images_replace(p_work_id, p_media_ids) に delete + insert をまとめ、plpgsql 関数 =
--   単一トランザクションとして全件成功 or 全件ロールバックにする。is_admin() ガード付き。
--   sort_order は配列の順序 (0 始まり) で採番する。
--   FK 違反 (media が存在しない) は 'KMB-E101: ...' で raise し、repository が Result に写像する。
-- =========================================================

create or replace function public.work_images_replace(p_work_id uuid, p_media_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_distinct int;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'permission denied: work_images_replace requires admin';
  end if;
  if p_work_id is null or p_media_ids is null then
    raise exception 'KMB-E101: work_id と media_ids は必須です';
  end if;

  -- PK (work_id, media_id) 違反を事前に E101 として返す (同じ画像の二重指定)
  select count(distinct m) into v_distinct from unnest(p_media_ids) as m;
  if v_distinct <> cardinality(p_media_ids) then
    raise exception 'KMB-E101: 同じ画像が複数回指定されています';
  end if;

  if not exists (select 1 from works where id = p_work_id) then
    raise exception 'KMB-E101: 参照先が存在しません: works(%)', p_work_id;
  end if;

  delete from work_images where work_id = p_work_id;

  insert into work_images (work_id, media_id, sort_order)
  select p_work_id, t.media_id, (t.ord - 1)::int
  from unnest(p_media_ids) with ordinality as t(media_id, ord);

exception
  when foreign_key_violation then
    -- media_id の参照先が無い。関数全体が 1 tx のため delete も巻き戻る。
    raise exception 'KMB-E101: 参照先が存在しません: %', sqlerrm;
end;
$$;

revoke execute on function public.work_images_replace(uuid, uuid[]) from public, anon;
grant execute on function public.work_images_replace(uuid, uuid[]) to authenticated;
