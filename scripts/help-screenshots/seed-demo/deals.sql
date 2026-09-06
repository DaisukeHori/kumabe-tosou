-- 案件 (/admin/deals) ヘルプのスクリーンショット用デモデータ (追加のみ)。
-- 実行先: Supabase 開発ブランチ help-screenshots。既存行の更新・削除はしない。
--
-- 00-base.sql の案件だけでは、案件のヘルプで説明したい次の 3 点が写らないため足す。
--   1. 「納品済み」の列が空 (9 段のうち 1 段だけ例が無い)
--   2. 見込み完了日がどの案件にも入っておらず、期日超過の赤字が出ない
--   3. 受注書 (order) が 1 通も無く、「作業ブロックを用意」ボタンが出ない
--
-- 冪等: 同じ id なので 2 回流しても増えない (on conflict do nothing)。

-- ===== 追加の案件 =====
-- (a) 相談中の 3D プリント造形の塗装 (ヘルプのユースケースで使う筋書き)。見込み完了日あり。
insert into deals (id, title, customer_id, company_id, stage, amount_jpy, expected_close_on, source, notes)
values ('d151e5e5-0607-4d72-a6b3-aa570a6676cf', '田中様 3Dプリント造形50個の塗装', '11d6e02c-bde6-4f21-b2e5-44072c1870da', null, 'estimating', 180000, '2026-09-20', 'form', 'マット仕上げ希望。色見本を送付予定。')
on conflict (id) do nothing;

-- (b) 見込み完了日が過ぎている案件 (カンバンで日付が赤く出る例)。
insert into deals (id, title, customer_id, company_id, stage, amount_jpy, expected_close_on, source, notes)
values ('3b283256-ee9e-47ff-8d34-532baa3694da', '渡辺様 バイクタンク再塗装', '5c6090f8-85c4-4544-8591-ca990fb47087', null, 'quote_sent', 62000, '2026-08-28', 'phone', '見積り送付後、返事待ち。')
on conflict (id) do nothing;

-- (c) 「納品済み」の例 (法人)。won_at は受注に到達した日時。
insert into deals (id, title, customer_id, company_id, stage, amount_jpy, expected_close_on, won_at, source, notes)
values ('014f49bf-d59c-4356-93b0-030c12ad341a', '加藤様(大分プロトラボ) 試作品塗装 納品済み', 'a764a606-ce03-4029-9323-5be61675af9f', '2c937558-dd3a-4b4d-afdd-ccc43e3bc42c', 'delivered', 145000, '2026-09-12', '2026-08-05 10:00:00+09', 'manual', '請求書はまだ発行していない。')
on conflict (id) do nothing;

-- ===== 受注書 (order) =====
-- 00-base.sql の受注案件「小林様 自動車パーツ塗装 受注」(5529654d-...) に受注書を足す。
-- これがあると案件詳細の「作業ブロック」カードに「作業ブロックを用意」ボタンが出る
-- (受注書の明細 = 作業の内訳から、カレンダーの作業ブロックを自動で作る導線)。
-- 発行済み (issued) の帳票には明細を足せない (KMB-E624) ため、いったん下書き (draft) で
-- 作って明細を入れ、そのあと発行済みに変える順番で流す。
insert into documents (
  id, doc_type, status, deal_id, issue_date, transaction_date,
  billing_name, billing_suffix, billing_address, notes, tax_rounding,
  subtotal_jpy, tax_summary, total_jpy
) values (
  '6df4458d-7d9b-4ae7-9b41-122adc588bb5', 'order', 'draft', '5529654d-511e-4706-a1f4-e2ef74016abe',
  '2026-08-01', '2026-08-01',
  '小林 みどり', '様', '大分県杵築市6-7-8', 'ご注文ありがとうございます。', 'floor',
  109091, '[{"tax_category":"standard_10","taxable_jpy":109091,"tax_jpy":10909}]'::jsonb, 120000
) on conflict (id) do nothing;

insert into document_lines (id, document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category, work_type_key) values
  ('15c958b3-0492-4aba-8da1-7bbe707a7577', '6df4458d-7d9b-4ae7-9b41-122adc588bb5', 0, '自動車パーツ 研磨', 2, '時間', 20000, 40000, 'standard_10', 'demo_sanding'),
  ('453923d8-dfe2-4924-a7e8-16f023d2bd7e', '6df4458d-7d9b-4ae7-9b41-122adc588bb5', 1, '自動車パーツ 本塗装', 3, '時間', 20000, 60000, 'standard_10', 'demo_painting'),
  ('f996d645-d1c7-4f31-905c-09f6a23cad7e', '6df4458d-7d9b-4ae7-9b41-122adc588bb5', 2, '梱包・配送費', 1, '式', 9091, 9091, 'standard_10', null)
on conflict (id) do nothing;

update documents set
  status='issued', doc_no='J-2026-0002', current_version=1, issued_at='2026-08-01 09:00:00+09',
  issuer_snapshot='{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"}'::jsonb
where id='6df4458d-7d9b-4ae7-9b41-122adc588bb5' and status='draft';

-- 発行控え台帳 (00-base.sql の見積書と同じ形で 1 行だけ足す)。
insert into issued_documents (id, document_id, doc_no, doc_type, version, sha256, transaction_date, counterparty, total_jpy, storage_path, content_snapshot, issued_at)
values (
  'c99293ca-623c-41b0-948e-30790f1c41ee', '6df4458d-7d9b-4ae7-9b41-122adc588bb5', 'J-2026-0002', 'order', 1,
  '3f1b0c8de4a5b2971d6f40c8ab35e7d219c4f80b6ea31d5c7f9028ab4d1e6c73', '2026-08-01', '小林 みどり', 120000,
  'documents/6df4458d-7d9b-4ae7-9b41-122adc588bb5/v1-3f1b0c8d.pdf',
  '{"doc_type":"order","doc_no":"J-2026-0002","version":1,"issue_date":"2026-08-01","transaction_date":"2026-08-01","valid_until":null,"billing_name":"小林 みどり","billing_suffix":"様","billing_address":"大分県杵築市6-7-8","site_name":null,"site_address":null,"notes":"ご注文ありがとうございます。","tax_rounding":"floor","issuer":{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"},"lines":[{"position":0,"description":"自動車パーツ 研磨","quantity":2,"unit":"時間","unit_price_jpy":20000,"amount_jpy":40000,"tax_category":"standard_10"},{"position":1,"description":"自動車パーツ 本塗装","quantity":3,"unit":"時間","unit_price_jpy":20000,"amount_jpy":60000,"tax_category":"standard_10"},{"position":2,"description":"梱包・配送費","quantity":1,"unit":"式","unit_price_jpy":9091,"amount_jpy":9091,"tax_category":"standard_10"}],"subtotal_jpy":109091,"tax_summary":[{"tax_category":"standard_10","taxable_jpy":109091,"tax_jpy":10909}],"total_jpy":120000}'::jsonb,
  '2026-08-01 09:00:00+09'
) on conflict (id) do nothing;

-- ===== 追加案件のタイムライン (詳細画面の見た目を空にしないため) =====
insert into activities (id, activity_type, occurred_at, title, body) values
  ('9b0c135d-65de-4441-9b5b-7737792e64dd', 'note', '2026-09-02 10:00:00+09', '3Dプリント造形50個の塗装について相談', 'マット仕上げ希望。まず色見本を送ることになった。')
on conflict (id) do nothing;
insert into activity_links (id, activity_id, deal_id) values
  ('21109945-7ace-4367-bc91-a3d472ce2d44', '9b0c135d-65de-4441-9b5b-7737792e64dd', 'd151e5e5-0607-4d72-a6b3-aa570a6676cf')
on conflict (id) do nothing;
insert into activity_links (id, activity_id, customer_id) values
  ('167862ed-cfb9-4a07-88db-16768760c3ea', '9b0c135d-65de-4441-9b5b-7737792e64dd', '11d6e02c-bde6-4f21-b2e5-44072c1870da')
on conflict (id) do nothing;
