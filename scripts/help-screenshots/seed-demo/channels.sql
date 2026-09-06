-- scripts/help-screenshots/seed-demo/channels.sql
-- ヘルプ (slug: channels) の撮影用デモデータ。Supabase 開発ブランチ help-screenshots 専用。
-- 架空の内容のみ。INSERT だけを行い、既存行の更新・削除はしない
-- (他の担当者が同時に撮影しているため)。
--
-- 用意するもの:
--   * SNS の接続状態 3 件 (X = 接続済み / Instagram = 期限切れ / note = 接続済み)
--   * チャネル別文体プロファイル 4 件
--   * 配信キューの 6 行 (予約済み・配信済み・失敗・要人間照合・キャンセル)
begin;

-- 接続状態 (画面上部のカード)
insert into channel_accounts (channel, account_label, auth_status, meta, connected_at) values
  ('x', '@yamagishi_tosou', 'connected', '{}'::jsonb, '2026-08-20T02:00:00Z'),
  ('instagram', '@yamagishi.tosou', 'expired', '{"username":"yamagishi.tosou"}'::jsonb, '2026-06-01T02:00:00Z'),
  (
    'note',
    'やまぎし塗装',
    'connected',
    '{"profile_url":"https://note.com/yamagishi_tosou","cookie_saved_at":"2026-08-28T01:00:00Z"}'::jsonb,
    '2026-08-28T01:00:00Z'
  )
on conflict (channel) do nothing;

-- チャネル別の文体プロファイル (AI が文章を作るときの言葉づかいの指示)
insert into style_profiles (channel, tone_instructions, format_rules, example_output) values
  (
    'site_blog',
    E'ていねいな敬体で書きます。専門用語は初めて出たときにかんたんな言い換えを添えます。読者は塗装を初めて頼む人です。',
    E'見出しは h2 と h3 のみ。1 段落は 3 行まで。全体で 1200〜1800 字。最後に問い合わせへの一文を入れます。',
    E'## 塗る前の下準備\n\n仕上がりの差は、塗る前の準備で決まります。'
  ),
  (
    'note',
    E'現場のできごとを日記のように書きます。一人称は「わたし」。写真の説明を必ず添えます。',
    E'冒頭 3 行で内容が分かるようにします。全体で 800〜1200 字。ハッシュタグは 3 つまで。',
    E'今日は自動車パーツのつや消し塗装でした。'
  ),
  (
    'x',
    E'短くはっきり書きます。あおらない。絵文字は使いません。',
    E'1 投稿 140 字以内。ハッシュタグは 2 つまで。リンクは末尾に 1 本だけ。',
    E'つや消しの黒は、光の当たり方で表情が変わります。作例をブログに載せました。'
  ),
  (
    'instagram',
    E'写真が主役です。文章は写真の補足に徹します。',
    E'1〜3 行 + ハッシュタグ 5 つまで。1 行目に何の写真かを書きます。',
    E'3D プリントのフィギュアをつや消しグレーで塗りました。'
  )
on conflict (channel) do nothing;

-- 配信のもとになる原稿 (発信スタジオで作られたもの) の最小セット
insert into ai_sources (id, input_type, raw_text, cleaned_text, transcript_status) values
  (
    '4c000001-0000-4000-8000-000000000001',
    'text',
    'つや消し塗装の作例をまとめたい',
    'つや消し塗装の作例をまとめたい',
    'n/a'
  )
on conflict (id) do nothing;

insert into ai_runs (id, source_id, status, target_channels, brief) values
  (
    '4c000002-0000-4000-8000-000000000001',
    '4c000001-0000-4000-8000-000000000001',
    'completed',
    array['site_blog','note','x','instagram'],
    '{"topic":"つや消し塗装の作例"}'::jsonb
  ),
  -- 2 本目 (原稿は「1 回の作成につきチャネル 1 本まで」のため、配信済みの行用に分ける)
  (
    '4c000002-0000-4000-8000-000000000002',
    '4c000001-0000-4000-8000-000000000001',
    'completed',
    array['instagram'],
    '{"topic":"自動車パーツのつや消し"}'::jsonb
  )
on conflict (id) do nothing;

insert into channel_drafts (id, run_id, channel, status, content, claims) values
  (
    '4c000003-0000-4000-8000-000000000001',
    '4c000002-0000-4000-8000-000000000001',
    'note',
    'approved',
    jsonb_build_object(
      'title', 'つや消し塗装の作例 — 光の当たり方で表情が変わります',
      'body_md', E'今日は 3D プリントのフィギュアをつや消しグレーで塗りました。\n\nつや消しは光をやわらかく返すので、形のふくらみがよく見えます。\n\n下準備では、積層のあとを紙やすりで消してから脱脂をしています。ここを飛ばすと塗料がはじきます。\n\n乾燥はブースで一晩。翌日に仕上がりを確認してからお渡ししています。',
      'hashtags', jsonb_build_array('塗装', 'つや消し', '3Dプリント')
    ),
    '[]'::jsonb
  ),
  (
    '4c000003-0000-4000-8000-000000000002',
    '4c000002-0000-4000-8000-000000000001',
    'x',
    'approved',
    jsonb_build_object(
      'tweets', jsonb_build_array(jsonb_build_object('text', 'つや消しの黒は、光の当たり方で表情が変わります。作例をブログに載せました。', 'media_id', null))
    ),
    '[]'::jsonb
  ),
  (
    '4c000003-0000-4000-8000-000000000003',
    '4c000002-0000-4000-8000-000000000001',
    'instagram',
    'approved',
    jsonb_build_object(
      'caption', E'3D プリントのフィギュアをつや消しグレーで塗りました。',
      'hashtags', jsonb_build_array('塗装', 'つや消し'),
      'media_id', null
    ),
    '[]'::jsonb
  ),
  (
    '4c000003-0000-4000-8000-000000000004',
    '4c000002-0000-4000-8000-000000000001',
    'site_blog',
    'approved',
    jsonb_build_object(
      'title', 'つや消し塗装の作例',
      'body_md', E'## つや消しの見え方\n\n光をやわらかく返すので、形のふくらみがよく見えます。',
      'excerpt', 'つや消し塗装の作例をまとめました。'
    ),
    '[]'::jsonb
  ),
  -- 配信済みの行に使う 2 本目の Instagram 原稿。
  -- (配信中・予約済み・配信済み・要人間照合の行は、原稿 1 本につき 1 行までという決まりがあるため)
  (
    '4c000003-0000-4000-8000-000000000005',
    '4c000002-0000-4000-8000-000000000002',
    'instagram',
    'approved',
    jsonb_build_object(
      'caption', E'自動車パーツをつや消しブラックで塗りました。',
      'hashtags', jsonb_build_array('塗装', 'つや消し'),
      'media_id', null
    ),
    '[]'::jsonb
  )
on conflict (id) do nothing;

-- 配信キュー (状態のちがいが一目で分かるように 6 行)
insert into channel_posts (
  id, draft_id, channel, status, scheduled_at, published_at, external_url,
  estimated_cost_cents, attempt_count, last_error_code, last_error_detail,
  note_draft_status, note_draft_url, created_at
) values
  (
    '4c000004-0000-4000-8000-000000000001',
    '4c000003-0000-4000-8000-000000000002',
    'x', 'scheduled', '2026-09-10T09:00:00Z', null, null,
    0, 0, null, null, 'none', null, '2026-09-06T01:00:00Z'
  ),
  (
    '4c000004-0000-4000-8000-000000000002',
    '4c000003-0000-4000-8000-000000000003',
    'instagram', 'scheduled', '2026-09-11T09:00:00Z', null, null,
    0, 0, null, null, 'none', null, '2026-09-06T00:50:00Z'
  ),
  (
    '4c000004-0000-4000-8000-000000000003',
    '4c000003-0000-4000-8000-000000000001',
    'note', 'manual_required', '2026-09-06T04:00:00Z', null, null,
    0, 1, null, null, 'none', null, '2026-09-06T00:40:00Z'
  ),
  (
    '4c000004-0000-4000-8000-000000000004',
    '4c000003-0000-4000-8000-000000000002',
    'x', 'failed', '2026-09-05T09:00:00Z', null, null,
    -- 失敗の記号は「投稿先」と対応させる (X = KMB-E501 / Instagram = KMB-E502)。
    -- ヘルプ FAQ「エラーの列に KMB-E501 のような記号が出ました」と内容を合わせている。
    0, 3, 'KMB-E501', 'X への送信が時間切れになりました (相手のサービスが混み合っています)',
    'none', null, '2026-09-05T00:30:00Z'
  ),
  (
    '4c000004-0000-4000-8000-000000000005',
    '4c000003-0000-4000-8000-000000000005',
    'instagram', 'published', '2026-09-04T09:00:00Z', '2026-09-04T09:00:12Z',
    'https://www.instagram.com/p/demo-help-0001/',
    0, 1, null, null, 'none', null, '2026-09-04T00:20:00Z'
  ),
  (
    '4c000004-0000-4000-8000-000000000006',
    '4c000003-0000-4000-8000-000000000001',
    'note', 'cancelled', '2026-09-03T09:00:00Z', null, null,
    0, 0, null, null, 'none', null, '2026-09-03T00:10:00Z'
  )
on conflict (id) do nothing;

-- 既に投入済みの環境向け (自分が入れた撮影用の行だけを対象にした訂正)。
update channel_posts
   set last_error_code = 'KMB-E501'
 where id = '4c000004-0000-4000-8000-000000000004'
   and last_error_code = 'KMB-E502';

commit;
