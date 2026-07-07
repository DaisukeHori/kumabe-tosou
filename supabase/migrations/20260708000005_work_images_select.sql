-- 修正: work_images に SELECT ポリシーが無く、公開サイト (anon) が施工事例の
-- 画像一覧を読めない / admin UI も編集時に読めない欠陥の修正。
-- anon: 親 works が公開状態の行のみ / admin: 全行。
-- 書き込みは引き続きポリシー無し (service 経由・ContentFacade)。

create policy work_images_anon_select on work_images
  for select
  using (
    exists (
      select 1 from works w
      where w.id = work_images.work_id
        and w.status = 'published'
        and w.published_at <= now()
    )
  );

create policy work_images_admin_select on work_images
  for select
  using (public.is_admin());
