-- ヘルプ用デモデータ: /admin/calendar/connections (slug: calendar-connections)
-- 撮影ブランチ (help-screenshots) 専用。本番では実行しない。
-- 既存行の削除・更新はしない (INSERT + ON CONFLICT DO NOTHING のみ)。
--
-- 内容:
--   * Google / Microsoft の接続を「接続中」で作る (アカウント・アプリ専用カレンダー・
--     トークン有効期限・最終取込が画面に出る)。
--   * 「同期の問題」表に、行アクションが 4 パターンすべて出る link を作る:
--       deleted_externally           → 未配置に戻す / キャンセルする / 作り直して再送
--       conflict + KMB-E724          → 照合して再開
--       conflict + KMB-E723          → 再送
--       orphaned                     → 再送 / リンクを削除
--     参照する work_blocks は calendar.sql が投入済みの予定 (架空データ)。

insert into calendar_connections
  (provider, status, vault_secret_name, meta, last_pulled_at, last_pushed_at, last_error_code, connected_at)
values
  (
    'google', 'connected', 'calendar_google_tokens',
    jsonb_build_object(
      'account_email', 'info@yamagishi-tosou.example.jp',
      'app_calendar_id', 'yamagishi-tosou-works@group.calendar.example',
      'token_expires_at', '2026-09-06T23:40:00+09:00',
      'sync_window_start', '2026-08-01',
      'sync_window_end', '2026-12-31'
    ),
    '2026-09-06T09:05:00+09:00', '2026-09-06T09:05:00+09:00', null, '2026-07-14T10:20:00+09:00'
  ),
  (
    'microsoft', 'connected', 'calendar_microsoft_tokens',
    jsonb_build_object(
      'account_email', 'yamagishi@yamagishi-tosou.example.jp',
      'app_calendar_id', 'AAMkAGYAAAoZDOFAAA=',
      'token_expires_at', '2026-09-06T22:10:00+09:00',
      'sync_window_start', '2026-08-01',
      'sync_window_end', '2026-12-31'
    ),
    '2026-09-06T09:05:00+09:00', '2026-09-06T08:40:00+09:00', null, '2026-08-03T19:05:00+09:00'
  )
on conflict (provider) do nothing;

insert into calendar_event_links
  (id, work_block_id, provider, external_event_id, external_ical_uid, etag_or_change_key,
   sync_status, push_attempts, last_error_code, last_pushed_at, last_pulled_at, deleted_externally_at)
values
  -- 外部 (Google) 側で予定が消されたのに気づいた行。
  ('7c1f0a10-0001-4a10-9f01-ca1e00000001', '14887eb3-80c9-4cd4-b5fc-81007905399c', 'google',
   'demo_evt_honto_0908', 'demo_evt_honto_0908@google.example', '"demo-etag-1"',
   'deleted_externally', 1, null, '2026-09-04T11:00:00+09:00', '2026-09-06T09:05:00+09:00',
   '2026-09-06T09:05:00+09:00'),
  -- 送ったが結果を確認できなかった行 (照合が必要)。
  ('7c1f0a10-0002-4a10-9f01-ca1e00000002', 'd2413797-fb1b-4c06-a783-02895da973f1', 'google',
   null, null, null,
   'conflict', 2, 'KMB-E724', '2026-09-06T08:58:00+09:00', null, null),
  -- 送信そのものに失敗した行 (再送でやり直す)。
  ('7c1f0a10-0003-4a10-9f01-ca1e00000003', 'd31fc41f-8a40-4293-939b-83717fae3a49', 'microsoft',
   'demo_evt_honto_0910', 'demo_evt_honto_0910@outlook.example', 'demo-changekey-3',
   'conflict', 3, 'KMB-E723', '2026-09-06T08:59:00+09:00', '2026-09-06T09:05:00+09:00', null),
  -- 外部の予定と結び付きが切れた行 (孤立)。
  ('7c1f0a10-0004-4a10-9f01-ca1e00000004', 'eb67b3da-73b4-4128-87a9-eace2602ba47', 'microsoft',
   'demo_evt_tenken_0912', null, null,
   'orphaned', 1, null, '2026-09-02T18:10:00+09:00', '2026-09-06T09:05:00+09:00', null)
on conflict (work_block_id, provider) do nothing;
