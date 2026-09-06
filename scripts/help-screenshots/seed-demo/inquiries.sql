-- scripts/help-screenshots/seed-demo/inquiries.sql
-- ヘルプ (slug: inquiries) の撮影用デモデータ。Supabase 開発ブランチ help-screenshots 専用。
-- 架空の内容のみ。INSERT だけを行い、既存行の更新・削除はしない
-- (他の担当者が同時に撮影しているため)。
--
-- ねらい:
--   * 一覧の 1 行目がヘルプの主人公「田中さん」の見積もり相談になるようにする
--     (created_at を他のデモ行より新しくしている)
--   * 種類のちがい (施工依頼 / 見積もり相談 / 材料の質問 / その他) が並ぶようにする
--   * 状態のちがい (未対応 / 対応中 / 完了 / スパム) が並ぶようにする
begin;

insert into contact_inquiries (id, name, email, tel, inquiry_type, item, body, status, created_at, handled_at) values
  (
    '4d000001-0000-4000-8000-000000000001',
    '田中 健一',
    'tanaka.demo@example.com',
    '090-0000-1234',
    'estimate',
    '3Dプリント造形品 50個',
    E'はじめまして。ミナトデザインの田中と申します。\n3D プリントで作った小物 50 個の塗装をお願いしたいです。\n色はつや消しのグレー、納期は 3 週間ほどを希望しています。\n概算のお見積りをいただけますでしょうか。',
    'new',
    '2026-09-06T23:10:00Z',
    null
  ),
  (
    '4d000001-0000-4000-8000-000000000002',
    '小林 直樹',
    'kobayashi.demo@example.com',
    '090-0000-2345',
    'construction',
    '事務所の外壁',
    E'事務所の外壁の塗り替えをお願いしたいです。\n築 15 年で、南側の色あせが目立ってきました。\n一度見に来ていただけますか。',
    'new',
    '2026-09-06T22:40:00Z',
    null
  ),
  (
    '4d000001-0000-4000-8000-000000000003',
    '森 由美',
    'mori.demo@example.com',
    null,
    'material',
    null,
    E'屋外に置く看板の塗装を考えています。\n紫外線に強い塗料はどれになりますか。',
    'in_progress',
    '2026-09-06T21:30:00Z',
    null
  ),
  (
    '4d000001-0000-4000-8000-000000000004',
    '西村 亮',
    'nishimura.demo@example.com',
    '090-0000-4567',
    'other',
    null,
    E'先日は納品ありがとうございました。仕上がりに満足しています。',
    'done',
    '2026-09-05T08:00:00Z',
    '2026-09-05T09:00:00Z'
  ),
  (
    '4d000001-0000-4000-8000-000000000005',
    'AAA WEB PROMOTION',
    'no-reply.demo@example.com',
    null,
    'other',
    null,
    E'貴社サイトの検索順位を上げるサービスのご案内です。無料でお試しいただけます。',
    'spam',
    '2026-09-05T07:00:00Z',
    null
  )
on conflict (id) do nothing;

commit;
