-- 見積書・請求書ヘルプ (slug: documents) 用の追加デモデータ。
-- 00-base.sql の後に流す。既存行の削除・更新はしない (追加のみ)。
--
-- 目的:
--   1) 版履歴が 2 行 + 送信履歴が 2 行ある発行済みの見積 (Q-2026-0101) を作る。
--      → 「再出力 (版+1)」「メールで送付」「前の版と比較」の説明に使う。
--   2) 一部だけ入金された請求書 (I-2026-0101) を作る。
--      → 入金ダイアログの「残高が最初から入っている」ことと、入金履歴の説明に使う。
-- どちらも架空の会社・金額のみ。番号は 0101 番台で採番機と衝突しない位置に置く。
--
-- 宛名 (billing_name / billing_address) は、案件 f503b732... の顧客が持つ請求先情報
-- (有限会社豊後カスタムパーツ / 〒879-0614 大分県豊後高田市本町1-1) とそろえてある。
-- 新規作成フォームの宛名プレビューと同じ文字列になるので、ヘルプの画像どうしで食い違わない。
begin;
-- 発行済み帳票の明細 INSERT ガードをこのトランザクションに限り解除 (00-base.sql と同じ)。
select set_config('kmb.sales_revision_unlock', 'on', true);

-- ===== 1) 発行済みの見積 (2 版 + メール 2 通) =====
insert into documents (
  id, doc_type, status, deal_id, doc_no, current_version,
  issue_date, transaction_date, valid_until,
  billing_name, billing_suffix, billing_address, site_name, site_address, notes,
  tax_rounding, subtotal_jpy, tax_summary, total_jpy, issuer_snapshot, issued_at, paid_at
) values (
  'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01',
  'quote', 'issued', 'f503b732-9c96-4dd4-aab8-ad17bf0196e6', 'Q-2026-0101', 2,
  '2026-08-20', '2026-08-20', '2026-09-19',
  '有限会社豊後カスタムパーツ', '御中', '〒879-0614 大分県豊後高田市本町1-1', '豊後カスタムパーツ様 工場', '〒879-0614 大分県豊後高田市本町1-1',
  '数量が増える場合はご相談ください。',
  'floor', 260000,
  '[{"tax_category":"standard_10","taxable_jpy":260000,"tax_jpy":26000}]'::jsonb, 286000,
  '{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"}'::jsonb,
  '2026-08-20 10:00:00+09', null
) on conflict (id) do nothing;

insert into document_lines (id, document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category, work_type_key) values
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1b01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 0, '3Dプリント部品 研磨 (積層痕消し)', 50, '個', 2000, 100000, 'standard_10', 'demo_sanding'),
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1b02', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 1, '下地処理 (プライマー)', 50, '個', 1200, 60000, 'standard_10', 'demo_primer'),
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1b03', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 2, '塗装 (自動車グレード仕上げ)', 50, '個', 1800, 90000, 'standard_10', 'demo_painting'),
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1b04', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 3, '梱包・配送費', 1, '式', 10000, 10000, 'standard_10', null)
on conflict (id) do nothing;

insert into issued_documents (
  id, document_id, doc_no, doc_type, version, sha256, transaction_date, counterparty, total_jpy, storage_path, content_snapshot, issued_at
) values (
  'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1c01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 'Q-2026-0101', 'quote', 1,
  '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f801',
  '2026-08-20', '有限会社豊後カスタムパーツ', 286000,
  'documents/c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01/v1-demo0101.pdf',
  '{"doc_type":"quote","doc_no":"Q-2026-0101","version":1,"issue_date":"2026-08-20","transaction_date":"2026-08-20","valid_until":"2026-09-19","billing_name":"有限会社豊後カスタムパーツ","billing_suffix":"御中","billing_address":"〒879-0614 大分県豊後高田市本町1-1","site_name":"豊後カスタムパーツ様 工場","site_address":"〒879-0614 大分県豊後高田市本町1-1","notes":"数量が増える場合はご相談ください。","tax_rounding":"floor","issuer":{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"},"lines":[{"position":0,"description":"3Dプリント部品 研磨 (積層痕消し)","quantity":50,"unit":"個","unit_price_jpy":2000,"amount_jpy":100000,"tax_category":"standard_10"},{"position":1,"description":"下地処理 (プライマー)","quantity":50,"unit":"個","unit_price_jpy":1200,"amount_jpy":60000,"tax_category":"standard_10"},{"position":2,"description":"塗装 (自動車グレード仕上げ)","quantity":50,"unit":"個","unit_price_jpy":1800,"amount_jpy":90000,"tax_category":"standard_10"},{"position":3,"description":"梱包・配送費","quantity":1,"unit":"式","unit_price_jpy":10000,"amount_jpy":10000,"tax_category":"standard_10"}],"subtotal_jpy":260000,"tax_summary":[{"tax_category":"standard_10","taxable_jpy":260000,"tax_jpy":26000}],"total_jpy":286000}'::jsonb,
  '2026-08-20 10:00:00+09'
) on conflict (id) do nothing;

insert into issued_documents (
  id, document_id, doc_no, doc_type, version, sha256, transaction_date, counterparty, total_jpy, storage_path, content_snapshot, issued_at
) values (
  'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1c02', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 'Q-2026-0101', 'quote', 2,
  '2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80912',
  '2026-08-20', '有限会社豊後カスタムパーツ', 286000,
  'documents/c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01/v2-demo0101.pdf',
  '{"doc_type":"quote","doc_no":"Q-2026-0101","version":2,"issue_date":"2026-08-20","transaction_date":"2026-08-20","valid_until":"2026-09-19","billing_name":"有限会社豊後カスタムパーツ","billing_suffix":"御中","billing_address":"〒879-0614 大分県豊後高田市本町1-1","site_name":"豊後カスタムパーツ様 工場","site_address":"〒879-0614 大分県豊後高田市本町1-1","notes":"数量が増える場合はご相談ください。","tax_rounding":"floor","issuer":{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"},"lines":[{"position":0,"description":"3Dプリント部品 研磨 (積層痕消し)","quantity":50,"unit":"個","unit_price_jpy":2000,"amount_jpy":100000,"tax_category":"standard_10"},{"position":1,"description":"下地処理 (プライマー)","quantity":50,"unit":"個","unit_price_jpy":1200,"amount_jpy":60000,"tax_category":"standard_10"},{"position":2,"description":"塗装 (自動車グレード仕上げ)","quantity":50,"unit":"個","unit_price_jpy":1800,"amount_jpy":90000,"tax_category":"standard_10"},{"position":3,"description":"梱包・配送費","quantity":1,"unit":"式","unit_price_jpy":10000,"amount_jpy":10000,"tax_category":"standard_10"}],"subtotal_jpy":260000,"tax_summary":[{"tax_category":"standard_10","taxable_jpy":260000,"tax_jpy":26000}],"total_jpy":286000}'::jsonb,
  '2026-08-21 09:30:00+09'
) on conflict (id) do nothing;

insert into document_emails (id, document_id, issued_document_id, to_email, cc_email, subject, body, status, provider_message_id, sent_at) values
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1d01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1c01',
   'matsumoto.demo@example.com', null, '【山岸塗装】見積のご送付 (Q-2026-0101)',
   E'有限会社豊後カスタムパーツ 御中\n\nいつもお世話になっております。\n見積 (Q-2026-0101) をお送りいたします。', 'sent', 'demo-message-0101-v1', '2026-08-20 10:20:00+09'),
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1d02', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1a01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e1c02',
   'matsumoto.demo@example.com', null, '【山岸塗装】見積のご送付 (Q-2026-0101)',
   E'有限会社豊後カスタムパーツ 御中\n\n先ほどの見積を刷り直しましたので、あらためてお送りいたします。', 'sent', 'demo-message-0101-v2', '2026-08-21 09:40:00+09')
on conflict (id) do nothing;

-- ===== 2) 一部だけ入金された請求書 =====
insert into documents (
  id, doc_type, status, deal_id, doc_no, current_version,
  issue_date, transaction_date, valid_until,
  billing_name, billing_suffix, billing_address, site_name, site_address, notes,
  tax_rounding, subtotal_jpy, tax_summary, total_jpy, issuer_snapshot, issued_at, paid_at
) values (
  'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2a01',
  'invoice', 'issued', 'f503b732-9c96-4dd4-aab8-ad17bf0196e6', 'I-2026-0101', 1,
  '2026-08-31', '2026-08-31', null,
  '有限会社豊後カスタムパーツ', '御中', '〒879-0614 大分県豊後高田市本町1-1', '豊後カスタムパーツ様 工場', '〒879-0614 大分県豊後高田市本町1-1',
  '着手金として半額をご請求いたします。',
  'floor', 150000,
  '[{"tax_category":"standard_10","taxable_jpy":150000,"tax_jpy":15000}]'::jsonb, 165000,
  '{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"}'::jsonb,
  '2026-08-31 10:00:00+09', null
) on conflict (id) do nothing;

insert into document_lines (id, document_id, position, description, quantity, unit, unit_price_jpy, amount_jpy, tax_category, work_type_key) values
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2b01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2a01', 0, '3Dプリント部品 塗装一式 (着手金)', 1, '式', 150000, 150000, 'standard_10', null)
on conflict (id) do nothing;

insert into issued_documents (
  id, document_id, doc_no, doc_type, version, sha256, transaction_date, counterparty, total_jpy, storage_path, content_snapshot, issued_at
) values (
  'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2c01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2a01', 'I-2026-0101', 'invoice', 1,
  '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b',
  '2026-08-31', '有限会社豊後カスタムパーツ', 165000,
  'documents/c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2a01/v1-demo0201.pdf',
  '{"doc_type":"invoice","doc_no":"I-2026-0101","version":1,"issue_date":"2026-08-31","transaction_date":"2026-08-31","valid_until":null,"billing_name":"有限会社豊後カスタムパーツ","billing_suffix":"御中","billing_address":"〒879-0614 大分県豊後高田市本町1-1","site_name":"豊後カスタムパーツ様 工場","site_address":"〒879-0614 大分県豊後高田市本町1-1","notes":"着手金として半額をご請求いたします。","tax_rounding":"floor","issuer":{"issuer_name":"山岸塗装","registration_number":"T0000000000000","address":"〒879-0614 大分県豊後高田市来縄3036-1","tel":"090-9478-5028","email":"info@example.com","seal_storage_path":null,"bank_account":{"bank_name":"おおいた信用金庫","branch_name":"豊後高田支店","account_type":"ordinary","account_number":"1234567","account_holder_kana":"ヤマギシトソウ"},"transfer_fee_note":"振込手数料はお客様のご負担でお願いします。"},"lines":[{"position":0,"description":"3Dプリント部品 塗装一式 (着手金)","quantity":1,"unit":"式","unit_price_jpy":150000,"amount_jpy":150000,"tax_category":"standard_10"}],"subtotal_jpy":150000,"tax_summary":[{"tax_category":"standard_10","taxable_jpy":150000,"tax_jpy":15000}],"total_jpy":165000}'::jsonb,
  '2026-08-31 10:00:00+09'
) on conflict (id) do nothing;

insert into payments (id, document_id, paid_on, amount_jpy, method, memo) values
  ('c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2e01', 'c0a8f3d2-7e11-4a63-9b41-2f6d5c8e2a01', '2026-09-03', 55000, 'bank_transfer', '一部入金 (残りは月末予定)')
on conflict (id) do nothing;

commit;
