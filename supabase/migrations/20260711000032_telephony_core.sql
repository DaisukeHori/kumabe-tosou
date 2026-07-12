-- 20260711000032_telephony_core.sql
-- canonical: docs/design/crm-suite/04-telephony.md §2.2 (裁定 J2/J3)
-- 本 migration が追加するもの:
--   1) calls / call_recordings / call_jobs (telephony 所有 — 07-contracts-delta §D1)
--   2) RLS (admin read + calls の列限定 UPDATE / 他は service 書込) + 明示 revoke/grant
--      (0020 の教訓: RLS 有効化だけでは default privileges の grant が残るため revoke を全文明示)
--   3) index (worker スキャン / keyset 一覧 / 顧客逆引き)
--   4) Storage バケット call-audio (private・ポリシーなし = service 専用 + 署名 URL 再生。
--      公開バケット列挙の教訓 0006 により SELECT ポリシーは作らない — 00-overview §5.4)
-- 本 migration が行わないこと: RPC (0033) / pg_cron (0034) / settings キー (DDL 不要 —
--   business_hours / telephony キーは contracts 追加のみ、canonical は 07-contracts-delta §D5 + Δ2)
-- 前提: migration 20260711000023 (crm_core — customers テーブル) 適用済み (calls.customer_id の FK 先)

-- ---------------------------------------------------------
-- 1) calls — 通話 1 本 = 1 行 (call_sid unique = voice webhook の冪等キー)
-- ---------------------------------------------------------
create table calls (
  id uuid primary key default gen_random_uuid(),
  call_sid text not null unique,
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound')), -- 'outbound' は Phase 2 予約 (§16)。v1 で INSERT されない
  from_e164 text,           -- E.164 正規化済み発信番号。非通知/正規化不能は null (§6.1)
  from_raw text,            -- Twilio From 原文 (監査用。'anonymous' 等が入り得る)
  to_e164 text not null,    -- 着信番号 (E.164)。自番号照合はしない (§1.4)
  twilio_status text not null default 'ringing',
    -- Twilio CallStatus の外部語彙 (queued/ringing/in-progress/completed/busy/no-answer/failed/canceled)。
    -- 将来値の追加に耐えるため check を張らない (外部所有の語彙に DB check を張らない判断。
    -- 自モジュール所有の enum は全て check + Zod parity — §2.6)
  handling text
    check (handling in ('forwarded', 'voicemail', 'after_hours_voicemail', 'missed')),
    -- ルーティング結果 (zCallHandling と 1:1)。null = ringing 中の未確定 (§5.2)
  match_status text not null default 'pending'
    check (match_status in ('pending', 'matched', 'created', 'ambiguous', 'no_number', 'manual')),
    -- 顧客紐づけ状態 (§5.2.2)。ambiguous = KMB-E823 (手動確認待ち)
  customer_id uuid references customers(id) on delete set null, -- 跨モジュール FK (facade 経由アクセス)
  duration_seconds int check (duration_seconds >= 0),
  started_at timestamptz not null default now(),  -- 業務時刻。activity occurred_at の源
  ended_at timestamptz,
  twilio_cost_estimate_micro_usd bigint not null default 0 check (twilio_cost_estimate_micro_usd >= 0),
  ai_cost_micro_usd bigint not null default 0 check (ai_cost_micro_usd >= 0),
    -- 通話に紐づく全 call_jobs の AI 実測コスト合算 (µUSD)。JPY と混在禁止 (既存規約)
  memo text,                -- admin 手動メモ (列限定 UPDATE 対象)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table calls is
  '通話ログ (telephony 所有 — 04-telephony.md §2.2)。call_sid unique が webhook 冪等キー。'
  'INSERT/状態更新は service (webhook/worker)。admin は customer_id/match_status/memo の列限定 UPDATE のみ';
comment on column calls.twilio_status is
  'Twilio CallStatus 外部語彙 (check なし — 外部所有の値集合)。表示は zCallHandling/duration で行い本列は監査用';
comment on column calls.twilio_cost_estimate_micro_usd is
  'Twilio 側費用の概算 (µUSD、internal/cost.ts の単価表で算出)。請求額ではない (activity body に「概算」と明記)';

create index calls_started_at_idx on calls (started_at desc, id desc); -- 一覧 keyset
create index calls_from_e164_idx on calls (from_e164) where from_e164 is not null;
create index calls_customer_id_idx on calls (customer_id) where customer_id is not null;
create index calls_match_status_idx on calls (match_status) where match_status = 'ambiguous'; -- 要確認バッジ

create trigger handle_updated_at before update on calls
  for each row execute function extensions.moddatetime(updated_at);

alter table calls enable row level security;

create policy calls_admin_select on calls
  for select using (public.is_admin());
create policy calls_admin_update on calls
  for update using (public.is_admin()) with check (public.is_admin());
-- INSERT/DELETE ポリシーなし = admin 不可 (INSERT は service のみ / DELETE は不可 — 録音台帳の意味論 §5.3)

revoke all on calls from anon, authenticated;
grant select on calls to authenticated;
-- admin の UPDATE は列限定 (手動紐づけ 3 列のみ — 00-overview §5.2 の「customer_id 手動紐づけ・メモ列のみ」を
-- 列レベル grant で機械的に強制。updated_at は moddatetime trigger が設定するため grant 不要)
grant update (customer_id, match_status, memo) on calls to authenticated;

-- ---------------------------------------------------------
-- 2) call_recordings — 録音 1 本 = 1 行 (recording_sid unique = webhook 冪等キー)
-- ---------------------------------------------------------
create table call_recordings (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  recording_sid text not null unique,
  source text not null check (source in ('dial', 'voicemail')),
    -- dial = <Dial record-from-answer-dual> (2ch) / voicemail = <Record> (1ch)
  twilio_url text not null,       -- RecordingUrl (認証情報を含まない素の URL)
  duration_seconds int not null check (duration_seconds >= 0),
  channels int not null check (channels in (1, 2)),
  storage_path text,              -- call-audio バケット内パス。null = 未ダウンロード
  byte_size bigint check (byte_size >= 0),
  twilio_deleted_at timestamptz,  -- Twilio 側録音の削除完了時刻 (設定 ON 時。§6.5.1)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table call_recordings is
  '録音 (telephony 所有)。書込は service のみ。admin は SELECT + 署名 URL 再生 (Storage ポリシーなし)';

create index call_recordings_call_id_idx on call_recordings (call_id);

create trigger handle_updated_at before update on call_recordings
  for each row execute function extensions.moddatetime(updated_at);

alter table call_recordings enable row level security;

create policy call_recordings_admin_select on call_recordings
  for select using (public.is_admin());

revoke all on call_recordings from anon, authenticated;
grant select on call_recordings to authenticated;

-- ---------------------------------------------------------
-- 3) call_jobs — 通話後処理ジョブ (ai_runs 同型の lease 型ステージ機械。1 録音 = 1 ジョブ)
-- ---------------------------------------------------------
create table call_jobs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  recording_id uuid not null references call_recordings(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'downloading', 'transcribing', 'analyzing', 'linking', 'done', 'failed')),
    -- zCallJobStatus (07-contracts-delta §4.13) と 1:1 (parity テスト対象)。
    -- 意味論 = 「次に実行すべきステージ名」(ai_runs と同じ — §5.1)
  transcript jsonb,        -- zCallTranscript (§2.5)。transcribing commit で UPSERT
  analysis jsonb,          -- zCallAnalysis (§2.5)。analyzing commit で UPSERT
  link_result jsonb,       -- zCallJobLinkResult (§3.2.4)。linking commit で UPSERT
  transcript_partial jsonb, -- transcribing のセグメント別チェックポイント (zCallTranscriptCheckpoint — §6.5.2-4)。
                            -- lease 保持中の service 直接 UPDATE で追記 (heartbeat 同型、00-overview §3.1.4-8)。
                            -- transcript 確定後は参照されない (残置可)
  error_code text,         -- KMB-E コード (failed 時 / 非致命の警告記録)
  ai_cost_micro_usd bigint not null default 0 check (ai_cost_micro_usd >= 0),
    -- transcribe/generateText の実測コスト累積 (commit RPC の p_ai_cost_delta_micro_usd で加算)
  stage_attempts int not null default 0 check (stage_attempts >= 0),
  lease_expires_at timestamptz,   -- null = 未取得/解放済み
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recording_id)           -- 1 録音 = 1 ジョブ (registerRecording の冪等性の要)
);

comment on table call_jobs is
  '通話後処理ジョブ (04-telephony.md §5.1)。lease/commit は RPC 専用 (0033)、'
  'admin は SELECT + call_job_retry RPC のみ。worker は service';
comment on column call_jobs.status is
  '「次に実行すべきステージ」。pending は acquire 時に downloading へ bootstrap (ai_runs の pending→extracting と同型)';

create index call_jobs_due_idx on call_jobs (created_at)
  where status in ('pending', 'downloading', 'transcribing', 'analyzing', 'linking');
  -- worker の due スキャン (非終端のみの部分 index)
create index call_jobs_call_id_idx on call_jobs (call_id);
create index call_jobs_failed_idx on call_jobs (updated_at desc) where status = 'failed'; -- ダッシュボード警告

create trigger handle_updated_at before update on call_jobs
  for each row execute function extensions.moddatetime(updated_at);

alter table call_jobs enable row level security;

create policy call_jobs_admin_select on call_jobs
  for select using (public.is_admin());
-- INSERT/UPDATE/DELETE ポリシーなし: 書込は service (worker) と security definer RPC のみ

revoke all on call_jobs from anon, authenticated;
grant select on call_jobs to authenticated;

-- ---------------------------------------------------------
-- 4) Storage バケット call-audio (private。ポリシーを一切作らない = service 専用)
--    admin の再生は createRecordingPlaybackUrl (facade) が service client で署名 URL を発行 (§7.1)
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do nothing;
