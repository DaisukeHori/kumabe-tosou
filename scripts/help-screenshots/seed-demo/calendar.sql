-- カレンダー (/admin/calendar, /templates, /types) ヘルプのスクリーンショット用デモデータ (追加のみ)。
-- 実行先: Supabase 開発ブランチ help-screenshots。既存行の更新・削除はしない。
--
-- 00-base.sql だけでは、カレンダーのヘルプで説明したい次の 4 点が写らないため足す。
--   1. 未配置トレイに札が 1 枚しかなく「自動で並べる」の説明が撮れない
--   2. 今週 (撮影日の週) の予定がまばらで、週の表が空に見える
--   3. 作業種別に「無効」の例が無く、無効の見せ方が説明できない
--   4. テンプレートに「(全対象)」「無効」の例が無い
--
-- 冪等: すべて固定 id + on conflict do nothing (2 回流しても増えない)。

-- ===== 未配置 (backlog) の作業ブロック =====
-- 受注済みの「小林様 自動車パーツ塗装」の残り工程。日程がまだ決まっていない状態。
insert into work_blocks (id, deal_id, work_type_id, title, status, starts_at, ends_at, planned_hours, consumes_capacity, memo) values
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b01', '5529654d-511e-4706-a1f4-e2ef74016abe', 'fe0a07bb-abf5-4570-b598-ca5113dca031', '下地(プライマー)', 'backlog', null, null, 1.5, true, 'サフェーサー2回。'),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b02', '5529654d-511e-4706-a1f4-e2ef74016abe', '78e626a8-4a9c-47f5-8f3d-bb455c40461b', '乾燥待ち', 'backlog', null, null, 12, false, '塗装のあと一晩置く。'),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b03', '5529654d-511e-4706-a1f4-e2ef74016abe', '82b58d7e-faff-4fe3-86b2-e30325227adc', '検品・仕上げ確認', 'backlog', null, null, 0.5, true, null),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b04', 'd151e5e5-0607-4d72-a6b3-aa570a6676cf', '9a0d2e00-8f9e-4bf1-aa38-b34e399fdf32', '3Dプリント造形 下研磨', 'backlog', null, null, 4, true, '50個。積層痕を落とす。'),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b05', null, '82b58d7e-faff-4fe3-86b2-e30325227adc', '工場の片づけ', 'backlog', null, null, 1, true, '案件とつながっていない予定の例。')
on conflict (id) do nothing;

-- ===== 今週 (2026-09-07 の週) に置いた作業ブロック =====
-- 週の表に色の違う札が並ぶようにする。乾燥 (非拘束) が夜をまたぐ例も入れる。
insert into work_blocks (id, deal_id, work_type_id, title, status, starts_at, ends_at, planned_hours, consumes_capacity, memo) values
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b11', 'd151e5e5-0607-4d72-a6b3-aa570a6676cf', 'fe0a07bb-abf5-4570-b598-ca5113dca031', '3Dプリント造形 下地', 'scheduled', '2026-09-09 13:00:00+09', '2026-09-09 14:30:00+09', 1.5, true, null),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b12', 'd151e5e5-0607-4d72-a6b3-aa570a6676cf', 'b350065d-d689-4ae0-ac7b-5e3c774599a7', '3Dプリント造形 本塗装', 'scheduled', '2026-09-11 09:00:00+09', '2026-09-11 12:00:00+09', 3, true, 'マット仕上げ。'),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b13', 'd151e5e5-0607-4d72-a6b3-aa570a6676cf', '78e626a8-4a9c-47f5-8f3d-bb455c40461b', '乾燥', 'scheduled', '2026-09-11 12:00:00+09', '2026-09-12 00:00:00+09', 12, false, null),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b14', '4a4efe29-6bb8-4c03-bfd1-8d4699bd79b2', '82b58d7e-faff-4fe3-86b2-e30325227adc', '検品', 'scheduled', '2026-09-10 15:00:00+09', '2026-09-10 15:30:00+09', 0.5, true, null),
  ('2f0a7a12-3f0a-4a1e-9a2f-1a0f7c3d5b15', 'f503b732-9c96-4dd4-aab8-ad17bf0196e6', '9a0d2e00-8f9e-4bf1-aa38-b34e399fdf32', '追加分の研磨', 'scheduled', '2026-09-09 09:00:00+09', '2026-09-09 11:00:00+09', 2, true, null)
on conflict (id) do nothing;

-- ===== 作業種別: 無効の例 =====
insert into work_types (id, key, label, color, consumes_capacity, default_hours, sort_order, is_active)
values ('5c1c2a80-6f4a-4d3c-9c2a-0f1d2e3a4b5c', 'demo_coating_old', '特殊コーティング (今は使わない)', '#0ea5e9', true, 2, 6, false)
on conflict (key) do nothing;

-- ===== テンプレート: 「(全対象)」と「無効」の例 =====
insert into work_templates (id, name, grade_key, size_key, is_active) values
  ('7d3c9a41-5b2e-4c8f-9d1a-6e2f3a4b5c6d', 'かんたん研磨＋塗装 (すべてのグレード)', null, null, true),
  ('7d3c9a41-5b2e-4c8f-9d1a-6e2f3a4b5c6e', '旧・特殊コーティングセット', 'demo_premium', 'demo_small', false)
on conflict (id) do nothing;

insert into work_template_items (id, template_id, work_type_id, hours, sort_order) values
  ('8e4d0b52-6c3f-4d90-8e2b-7f3a4b5c6d71', '7d3c9a41-5b2e-4c8f-9d1a-6e2f3a4b5c6d', '9a0d2e00-8f9e-4bf1-aa38-b34e399fdf32', 1.5, 1),
  ('8e4d0b52-6c3f-4d90-8e2b-7f3a4b5c6d72', '7d3c9a41-5b2e-4c8f-9d1a-6e2f3a4b5c6d', 'b350065d-d689-4ae0-ac7b-5e3c774599a7', 2, 2),
  ('8e4d0b52-6c3f-4d90-8e2b-7f3a4b5c6d73', '7d3c9a41-5b2e-4c8f-9d1a-6e2f3a4b5c6d', '82b58d7e-faff-4fe3-86b2-e30325227adc', 0.5, 3),
  ('8e4d0b52-6c3f-4d90-8e2b-7f3a4b5c6d74', '7d3c9a41-5b2e-4c8f-9d1a-6e2f3a4b5c6e', 'b350065d-d689-4ae0-ac7b-5e3c774599a7', 3, 1)
on conflict (id) do nothing;
