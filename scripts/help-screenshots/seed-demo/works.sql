-- scripts/help-screenshots/seed-demo/works.sql
-- ヘルプ (slug: works) の撮影用デモデータ。Supabase 開発ブランチ help-screenshots 専用。
-- 架空の内容のみ。INSERT だけを行い、既存行の更新・削除はしない
-- (他の担当者が同時に撮影しているため)。
--
-- 状態 (下書き / レビュー待ち / 公開中) の 3 つの画面を、既存デモ行を書き換えずに
-- 撮れるようにするための追加行。
begin;

insert into works (id, slug, title, category, body, process_note, status, published_at, sort_order) values
  (
    '3f000001-0000-4000-8000-000000000001',
    'help-work-draft',
    'エアブラシ作品 マット仕上げ',
    'small-item',
    E'展示用のエアブラシ作品を、光を抑えたマット (つや消し) で仕上げました。\n\n積層痕を研磨で消してから、下地・本塗り・トップコートの順に重ねています。',
    '研磨→下地→塗装→つや消しクリア',
    'draft',
    null,
    10
  ),
  (
    '3f000001-0000-4000-8000-000000000002',
    'help-work-review',
    'ヘルメット キャンディレッド塗装',
    'vehicle',
    E'3D プリントのヘルメット外装を、深みのあるキャンディレッドで塗装しました。\n\n赤の下に銀を敷き、透ける赤を上から重ねて色の深さを出しています。',
    '研磨→下地→銀→キャンディレッド→クリア',
    'review',
    null,
    11
  )
on conflict (slug) do nothing;

commit;
