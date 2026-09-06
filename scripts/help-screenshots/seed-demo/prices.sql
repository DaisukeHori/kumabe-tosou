-- ヘルプ用デモデータ: /admin/prices (slug: prices)
-- 撮影ブランチ (help-screenshots) 専用。本番では実行しない。
-- 既存行の削除・更新はしない (INSERT + ON CONFLICT DO NOTHING のみ)。
--
-- 内容: グレード 3 種 × サイズ帯 4 段 (XL は個別見積もり) の価格行列、
--       数量値引き 2 段、オプション 3 種。公開サイトの見積りシミュレーターと
--       /admin/prices のプレビューが同じ数字を出す状態を作る。

insert into price_grades (key, label, description, sort_order, is_active) values
  ('standard', 'スタンダード', '単色仕上げ。展示用の標準グレード。', 0, true),
  ('premium',  'プレミアム',   '下地処理を厚めに。クリア層あり。',   1, true),
  ('show',     'ショーモデル', '研磨と塗り重ねを重ねた最上級仕上げ。', 2, true)
on conflict (key) do nothing;

insert into price_size_classes (key, label, max_mm, quote_only, sort_order) values
  ('s',  '〜120mm',  120,  false, 0),
  ('m',  '〜200mm',  200,  false, 1),
  ('l',  '〜300mm',  300,  false, 2),
  ('xl', '300mm超',  null, true,  3)
on conflict (key) do nothing;

insert into price_matrix (grade_key, size_key, price_min, price_max) values
  ('standard', 's',  3000,  4500),
  ('standard', 'm',  4500,  7000),
  ('standard', 'l',  7000, 11000),
  ('premium',  's',  5000,  7500),
  ('premium',  'm',  7500, 11000),
  ('premium',  'l', 11000, 17000),
  ('show',     's',  9000, 13000),
  ('show',     'm', 13000, 19000),
  ('show',     'l', 19000, 28000)
on conflict (grade_key, size_key) do nothing;

insert into price_quantity_tiers (min_qty, discount_rate, label) values
  (10, 0.15, '10個以上 -15%'),
  (30, 0.25, '30個以上 -25%')
on conflict (min_qty) do nothing;

insert into price_options (key, label, kind, value, sort_order, is_active) values
  ('express',      '特急仕上げ',   'multiplier', 1.5,  0, true),
  ('clear_coat',   'クリア仕上げ', 'multiplier', 1.2,  1, true),
  ('color_match',  '色合わせ',     'fixed',      3000, 2, true)
on conflict (key) do nothing;
