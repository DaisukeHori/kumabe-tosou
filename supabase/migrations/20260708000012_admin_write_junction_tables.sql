-- work_images / seed_manifest への admin 書き込み許可 (2026-07-08)
-- 経緯: 当初 service_role 専用 (ポリシー無し) としたが、service key を使わない
-- admin セッション運用 (bootstrap を SQL 直作成に変更した経緯と同じ) を成立させるため、
-- is_admin() に開放する。works 本体が admin 書き込み可である以上、その junction を
-- admin に開放してもセキュリティ境界は変わらない。seed_manifest は admin 専用運用台帳。

create policy work_images_admin_insert on work_images
  for insert with check (public.is_admin());
create policy work_images_admin_update on work_images
  for update using (public.is_admin()) with check (public.is_admin());
create policy work_images_admin_delete on work_images
  for delete using (public.is_admin());

create policy seed_manifest_admin_select on seed_manifest
  for select using (public.is_admin());
create policy seed_manifest_admin_insert on seed_manifest
  for insert with check (public.is_admin());
create policy seed_manifest_admin_delete on seed_manifest
  for delete using (public.is_admin());
