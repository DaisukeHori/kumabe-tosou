-- scripts/help-screenshots/seed-demo/media.sql
-- ヘルプ (slug: media) の撮影用デモ画像の投入記録。Supabase 開発ブランチ help-screenshots 専用。
--
-- 画像は実ファイル (Storage) が必要なため、この SQL だけでは再現できない。
-- 実際の投入は次のコマンドで行う (原本アップロード → 表示用画像の生成 → 行の追加 をまとめて行う):
--
--   BOOTSTRAP_ADMIN_EMAIL=help-admin@example.com BOOTSTRAP_ADMIN_PASSWORD=help-screenshots-2026 \
--     npx tsx --env-file=.env.local scripts/help-screenshots/seed-demo/media-seed.ts
--
-- 下の INSERT は「そのとき何が入ったか」の記録 (行だけを別環境に写したいとき用)。
-- storage_path の実ファイルが無いとサムネイルは表示されない。
-- 追加のみ。既存行の更新・削除はしない (他の担当者が同時に撮影しているため)。
begin;

insert into media (id, storage_path, alt, width, height, mime_type, credit, is_placeholder, tags) values
  ('4d000001-0000-4000-8000-000000000001','help-demo/4d000001-0000-4000-8000-000000000001.png','塗装が仕上がったフィギュアを正面から撮った写真',1200,900,'image/png','熊部塗装',false,array['フィギュア','完成写真']),
  ('4d000001-0000-4000-8000-000000000002','help-demo/4d000001-0000-4000-8000-000000000002.png','フィギュアに下塗りをしている作業中の写真',1200,900,'image/png','熊部塗装',false,array['フィギュア','作業風景']),
  ('4d000001-0000-4000-8000-000000000003','help-demo/4d000001-0000-4000-8000-000000000003.png','小物パーツを並べて仕上がりを確認している写真',1200,900,'image/png','熊部塗装',false,array['小物','完成写真']),
  ('4d000001-0000-4000-8000-000000000004','help-demo/4d000001-0000-4000-8000-000000000004.png','塗装が終わった自動車パーツを台に載せた写真',1200,900,'image/png','熊部塗装',false,array['自動車パーツ','完成写真']),
  ('4d000001-0000-4000-8000-000000000005','help-demo/4d000001-0000-4000-8000-000000000005.png','自動車パーツの下地処理をしている写真',1200,900,'image/png','熊部塗装',false,array['自動車パーツ','作業風景']),
  ('4d000001-0000-4000-8000-000000000006','help-demo/4d000001-0000-4000-8000-000000000006.png','塗装ブースで吹き付けをしている作業風景',1200,900,'image/png','熊部塗装',false,array['作業風景']),
  ('4d000001-0000-4000-8000-000000000007','help-demo/4d000001-0000-4000-8000-000000000007.png','工房を外から撮った写真',1200,900,'image/png','熊部塗装',false,array['工房']),
  ('4d000001-0000-4000-8000-000000000008','help-demo/4d000001-0000-4000-8000-000000000008.png','看板の色を試し塗りした板の写真 (差し替え予定)',1200,900,'image/png',null,true,array['仮素材'])
on conflict (id) do nothing;

commit;
