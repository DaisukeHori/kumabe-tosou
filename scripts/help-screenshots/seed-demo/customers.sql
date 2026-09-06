-- 顧客ヘルプ (slug: customers) 用の追加デモデータ。
-- 00-base.sql の後に流す。既存行の削除・更新はしない (追加のみ)。
--
-- 目的: 「重複の統合」の説明用に、田中 一郎さん (00-base.sql) と同姓同名で
--       電話から自動登録された 2 件目をわざと作る。
insert into customers (
  id, kind, name, name_kana, email, tel_e164, company_id, address,
  lifecycle, source, custom_fields, billing_info, shipping_info
) values (
  'ed7df172-7940-400b-a705-126e45e8188a',
  'person',
  '田中 一郎',
  'タナカ イチロウ',
  null,
  '+819000000131',
  null,
  '大分県別府市北浜1-2-3',
  'lead',
  'phone',
  '[]'::jsonb,
  null,
  null
)
on conflict (id) do nothing;
