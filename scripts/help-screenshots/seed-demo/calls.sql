-- scripts/help-screenshots/seed-demo/calls.sql
-- ヘルプ (slug: calls) の撮影用デモデータ。Supabase 開発ブランチ help-screenshots 専用。
-- 架空の内容のみ。INSERT だけを行い、既存行の更新・削除はしない
-- (他の担当者が同時に撮影しているため)。
--
-- ねらい:
--   * 一覧の 1 行目を「留守電 → 文字起こし済み → 要約あり」の完成形にする
--     (通話詳細の説明でいちばん見せたい状態)
--   * 「処理に失敗した通話」を 1 件用意して、再実行ボタンの説明に使う
--   * 電話から自動で作られた「やること」への導線 (起票タスク) を写せるようにする
begin;

-- 1) 留守電 → 文字起こし・要約まで終わった通話 (顧客に自動で紐づいた例)
insert into calls (
  id, call_sid, direction, from_e164, from_raw, to_e164, twilio_status, handling,
  match_status, customer_id, duration_seconds, started_at, ended_at,
  twilio_cost_estimate_micro_usd, ai_cost_micro_usd, memo, created_at, updated_at
) values (
  '4ca11001-0000-4000-8000-000000000001',
  'CAhelp000000000000000000000001',
  'inbound',
  '+819000000101',
  '09000000101',
  '+815000000000',
  'completed',
  'after_hours_voicemail',
  'matched',
  '11d6e02c-bde6-4f21-b2e5-44072c1870da',
  96,
  '2026-09-06T11:20:00Z',
  '2026-09-06T11:21:36Z',
  21000,
  9400,
  null,
  '2026-09-06T11:20:00Z',
  '2026-09-06T11:24:00Z'
);

insert into call_recordings (
  id, call_id, recording_sid, source, twilio_url, duration_seconds, channels,
  storage_path, byte_size, created_at, updated_at
) values (
  '4ca11001-0000-4000-8000-000000000011',
  '4ca11001-0000-4000-8000-000000000001',
  'REhelp000000000000000000000001',
  'voicemail',
  'https://api.example.com/2010-04-01/Accounts/ACdemo/Recordings/REhelp000000000000000000000001',
  96,
  2,
  'call-audio/4ca11001-0000-4000-8000-000000000001.wav',
  1536000,
  '2026-09-06T11:22:00Z',
  '2026-09-06T11:22:00Z'
);

-- 電話の内容から自動で作られた「やること」(origin='ai_call')。
-- 通話詳細の「起票タスク」リンクと、やること一覧の「電話AI」バッジの両方で使う。
insert into tasks (id, title, body, due_on, status, origin, deal_id, customer_id, created_at, updated_at) values
  (
    '4ca11001-0000-4000-8000-000000000021',
    '田中様へ見積書を送る (メタリックレッド塗装)',
    E'留守電の内容から自動で作成しました。\n・つや消しではなくメタリックレッドを希望\n・数量は 50 個、納期は 3 週間ほど',
    '2026-09-08',
    'open',
    'ai_call',
    null,
    '11d6e02c-bde6-4f21-b2e5-44072c1870da',
    '2026-09-06T11:24:00Z',
    '2026-09-06T11:24:00Z'
  ),
  (
    '4ca11001-0000-4000-8000-000000000022',
    '田中様に折り返しの電話をする',
    '留守電の内容から自動で作成しました。夕方以降が希望とのことです。',
    '2026-09-07',
    'open',
    'ai_call',
    null,
    '11d6e02c-bde6-4f21-b2e5-44072c1870da',
    '2026-09-06T11:24:00Z',
    '2026-09-06T11:24:00Z'
  );

insert into call_jobs (
  id, call_id, recording_id, status, transcript, analysis, link_result,
  error_code, ai_cost_micro_usd, stage_attempts, created_at, updated_at
) values (
  '4ca11001-0000-4000-8000-000000000031',
  '4ca11001-0000-4000-8000-000000000001',
  '4ca11001-0000-4000-8000-000000000011',
  'done',
  jsonb_build_object(
    'segments', jsonb_build_array(
      jsonb_build_object('channel', 0, 'index', 0,
        'text', 'お世話になります。ミナトデザインの田中です。'),
      jsonb_build_object('channel', 0, 'index', 1,
        'text', '先日ご相談した３Ｄプリントの小物５０個の塗装の件でお電話しました。'),
      jsonb_build_object('channel', 0, 'index', 2,
        'text', '色なんですが、つや消しのグレーではなく、メタリックレッドに変更したいです。'),
      jsonb_build_object('channel', 0, 'index', 3,
        'text', '納期は３週間ほどで、お見積りをいただけると助かります。'),
      jsonb_build_object('channel', 0, 'index', 4,
        'text', '折り返しは夕方以降だと出られます。よろしくお願いします。'),
      jsonb_build_object('channel', 1, 'index', 0,
        'text', 'ただいま電話に出ることができません。発信音のあとにご用件をお話しください。')
    ),
    'full_text', 'お世話になります。ミナトデザインの田中です。先日ご相談した３Ｄプリントの小物５０個の塗装の件でお電話しました。色なんですが、つや消しのグレーではなく、メタリックレッドに変更したいです。納期は３週間ほどで、お見積りをいただけると助かります。折り返しは夕方以降だと出られます。よろしくお願いします。'
  ),
  jsonb_build_object(
    'minutes', jsonb_build_object(
      'summary', E'３Ｄプリント小物５０個の塗装について、色をつや消しグレーからメタリックレッドへ変更したいというご連絡です。\n納期は３週間ほどを希望されており、見積書の送付を求められています。折り返しは夕方以降が希望です。',
      'caller_intent', 'estimate_request',
      'key_points', jsonb_build_array(
        '色をつや消しグレーからメタリックレッドへ変更したい',
        '数量は５０個のまま、納期は３週間ほどを希望',
        '見積書を送ってほしい',
        '折り返しの電話は夕方以降が良い'
      ),
      'customer_name_guess', '田中',
      'callback_required', true,
      'callback_note', '夕方以降に折り返し希望'
    ),
    'tasks', jsonb_build_array(
      jsonb_build_object('title', '田中様へ見積書を送る (メタリックレッド塗装)',
        'detail', '数量５０個・納期３週間', 'due_hint', '今週中'),
      jsonb_build_object('title', '田中様に折り返しの電話をする',
        'detail', '夕方以降が希望', 'due_hint', '明日まで')
    )
  ),
  jsonb_build_object(
    'outcome', 'matched',
    'customer_id', '11d6e02c-bde6-4f21-b2e5-44072c1870da',
    'activity_id', null,
    'activity_created', false,
    'task_ids', jsonb_build_array(
      '4ca11001-0000-4000-8000-000000000021',
      '4ca11001-0000-4000-8000-000000000022'
    ),
    'warning', null
  ),
  null,
  9400,
  1,
  '2026-09-06T11:22:00Z',
  '2026-09-06T11:24:00Z'
);

-- 2) 文字起こしに失敗した通話 (再実行ボタンの説明用。顧客もまだ紐づいていない)
insert into calls (
  id, call_sid, direction, from_e164, from_raw, to_e164, twilio_status, handling,
  match_status, customer_id, duration_seconds, started_at, ended_at,
  twilio_cost_estimate_micro_usd, ai_cost_micro_usd, memo, created_at, updated_at
) values (
  '4ca11001-0000-4000-8000-000000000002',
  'CAhelp000000000000000000000002',
  'inbound',
  '+819000000131',
  '09000000131',
  '+815000000000',
  'completed',
  'voicemail',
  'pending',
  null,
  47,
  '2026-09-06T02:40:00Z',
  '2026-09-06T02:40:47Z',
  12000,
  0,
  null,
  '2026-09-06T02:40:00Z',
  '2026-09-06T02:43:00Z'
);

insert into call_recordings (
  id, call_id, recording_sid, source, twilio_url, duration_seconds, channels,
  storage_path, byte_size, created_at, updated_at
) values (
  '4ca11001-0000-4000-8000-000000000012',
  '4ca11001-0000-4000-8000-000000000002',
  'REhelp000000000000000000000002',
  'voicemail',
  'https://api.example.com/2010-04-01/Accounts/ACdemo/Recordings/REhelp000000000000000000000002',
  47,
  1,
  'call-audio/4ca11001-0000-4000-8000-000000000002.wav',
  752000,
  '2026-09-06T02:41:00Z',
  '2026-09-06T02:41:00Z'
);

insert into call_jobs (
  id, call_id, recording_id, status, transcript, analysis, link_result,
  error_code, ai_cost_micro_usd, stage_attempts, created_at, updated_at
) values (
  '4ca11001-0000-4000-8000-000000000032',
  '4ca11001-0000-4000-8000-000000000002',
  '4ca11001-0000-4000-8000-000000000012',
  'failed',
  null,
  null,
  null,
  'KMB-E820',
  0,
  3,
  '2026-09-06T02:41:00Z',
  '2026-09-06T02:43:00Z'
);

commit;
