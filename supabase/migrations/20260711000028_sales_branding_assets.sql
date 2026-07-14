-- 20260711000028_sales_branding_assets.sql
-- canonical: docs/design/crm-suite/02-sales.md §2.3.3 (07-contracts-delta §D5 v1.2 —
--   invoice_issuer.seal_storage_path の保存先バケット)
-- 本 migration が行うこと: 角印画像用の private Storage bucket 'branding-assets' を作成する
-- 本 migration が行わないこと (v1.2 内容置換):
--   - 旧 0028 の media 参照 3 点セットへの seal_media_id 追記 — seal は media 参照ではなく
--     なったため不要 (3 点セットの置換は 0035 = favicon 分のみ)
--   - DDL 変更 (site_settings への key 追加は契約のみ — 既存規約)

insert into storage.buckets (id, name, public)
values ('branding-assets', 'branding-assets', false)
on conflict (id) do nothing;
-- ポリシーは一切作らない (private):
--   書込 = admin 設定タブ「請求書発行者」(§8.6) の Server Action が service client で upload
--   読出 = PDF 生成・/print 描画 (§10.6) が server 側で解決する署名 URL のみ
--   (公開バケット列挙の教訓 0006 / issued-documents・call-audio と同分類)。
-- issued-documents と異なり不変 trigger は置かない — 角印は差し替え・削除が正当な運用
-- (過去帳票の角印は PDF に焼き込み済みで issued-documents 台帳が不変保全する)
