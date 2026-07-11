# 隈部塗装 CRM スイート — telephony モジュール設計書 (04-telephony)

- 版: v1.1 (2026-07-11: レビュー指摘反映版 — 00-overview.md v1.1 / 07-contracts-delta.md v1.6 / 設計裁定 J1〜J12 (特に J2/J3) 準拠。変更点は末尾更新履歴)
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **telephony モジュール (Twilio 050 着信 → 録音 → 転写 → AI 議事録 → タスク起票 → CRM タイムライン) の DDL・画面・状態機械の正**。上位 canonical は [00-overview.md](./00-overview.md) (M0 基盤・エラーコード帯・所有割当) と [07-contracts-delta.md](./07-contracts-delta.md) (値契約・facade 契約)。本書はそれらに従属し、逸脱しない (契約の再定義はせず「写経 + 注記」で参照する)。
- 姉妹文書:
  - 00-overview §3.1 — ExecutionContext / migration 0021 (予算 RPC 緩和) / lease 複製規約 §3.1.4 (8 要件)
  - 00-overview §3.3 — エラーコード採番 canonical (KMB-E801〜E839 帯)
  - 07-contracts-delta §D7 4.13 — telephony 値契約 canonical / §D8 — TelephonyFacade 契約
  - 01-crm.md — CrmFacade (matchCustomerByPhone / createTask / appendActivity) の親設計
- 入力資料: 設計ブリーフ R3 / 設計裁定書 J2・J3 / 調査 ext-twilio.md・ai-pipeline.md・integrations.md・db-schema.md・design-conventions.md / 実コード裏取り (migration 0019 全文・platform/contracts.ts・settings/facade.ts・platform/errors.ts)
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提:
  - migration 0001〜0020 適用済み。**M0 の 0021 (`is_admin_or_service()` + 予算 RPC 緩和) の本番適用が本モジュールの動作前提** (未適用だと service 文脈の AI 呼び出しが全滅する)
  - 本モジュールの migration 帯は **0032〜0034** (00-overview §10。帯固定・未使用分は返上)
  - 所有: テーブル `calls` / `call_recordings` / `call_jobs` + Storage バケット `call-audio`。エラーコード KMB-E801〜E839。公開 facade `TelephonyFacade`
  - Twilio 番号は未取得でもよい (Regulatory Bundle は外部クリティカルパス C1)。**実装・テストは署名モックで完走し、番号到着後に疎通のみ行う** (00-overview §15 R1)

---

## 0. 業務シナリオ

塗装職人 (熊部さん) の電話の一日を 4 部で描く。IT 用語は使わない。

### 0.1 現場で手が離せない昼下がり — 「電話を取れなくても、何も失わない」

午後、熊部さんは塗装ブースでマスクとグローブ姿。工房の電話が鳴るが、吹き付けの途中で手を止めるわけにはいかない。呼び出し音が数回続いたあと、電話の向こうでは落ち着いた声が流れる。「お電話ありがとうございます。品質向上のため、この通話は録音されます。ご用件を発信音のあとにお話しください」。お客さんは「ガンプラの MG サイズを 3 体、パール仕上げでお願いしたいんですが、納期を知りたくて。折り返しもらえますか。電話番号は…」と吹き込んで切る。熊部さんは何も操作していない。

### 0.2 昼休みに画面を開くと、全部そろっている

昼休み。スマホで管理画面の「通話」を開くと、さっきの電話が一番上に並んでいる。再生ボタンで声をそのまま聞き直せるし、その下には話した内容の全文と、「MG サイズ 3 体・パール仕上げの見積り依頼。納期回答の折り返しを希望」という要約が付いている。「やること」には「◯◯さんへ折り返し電話 (納期回答)」というメモが自動で入っている。しかもこの番号、以前パール仕上げを頼んでくれたあのお客さんだ — 相手のページを開けば、前回の作業内容も請求額も一列に並んでいる。熊部さんがやるのは、おにぎりを食べ終えてから折り返しの電話を 1 本かけることだけ。

### 0.3 夜の電話 — 「営業時間外です、でも用件は預かります」

夜 9 時、工房はもう真っ暗。それでも電話は鳴る。掛けてきた人には「本日の営業は終了しました。ご用件を発信音のあとにお話しください。翌営業日にご連絡いたします」と流れ、用件が預かられる。翌朝、管理画面には夜間の伝言が要約付きで待っている。時間外の電話を取り損ねて商機を逃す、ということがなくなる。

### 0.4 いつものお客さんから — 「もしもし、の前に履歴が出ている」

数ヶ月後、同じお客さんからまた電話。今度は手が空いていたので、転送された携帯で直接話せた。通話が終わると、この通話も録音・要約付きで相手の履歴に自動で追加される。「前回と同じ仕上げで、とおっしゃっていたな」— 記憶に頼らなくても、話した内容がぜんぶ残っている。電話代がいくらかかったかの目安も通話ごとに添えられているので、月末に「電話まわりでいくら使ったか」もすぐ分かる。

### 0.5 スコープ外 (v1 で扱わないもの)

| 項目 | 理由・扱い |
|---|---|
| クリックトゥコール発信 | 発信 2 レグ $0.185×2/min とコスト支配的 (ext-twilio §6)。**Phase 2 契約のみ予約** — §16 に契約全文。DDL は `calls.direction='outbound'` を check に含めて予約済み |
| リアルタイム AI 電話応対 (Media Streams / ConversationRelay) | 長寿命 WebSocket が必要で Vercel 不可 (ext-twilio §5.3)。Phase 2 (別ホスト前提)。§16 に境界のみ記載 |
| 通話中のライブ文字起こし表示 (`<Start><Transcription>`) | Vercel で受けられる (Webhook 配送型) が v1 の価値に対して過剰。Phase 1.5 候補として §16 に記録 |
| SMS 送受信 | 要求になし。対象外 |
| 話者分離モデル (`gpt-4o-transcribe-diarize`) | デュアルチャネル録音 (record-from-answer-dual) の物理チャネル分離で代替 (確実性が上 — ext-twilio §3.2)。留守電はモノラル 1 話者なので不要 |
| 0120 / 0ABJ 番号 | 営業経由のみ (J3)。設計は番号非依存 (§1.4) なので将来の切替に DDL 変更不要 |

### 0.6 印刷出力

**該当なし**。理由: 通話・議事録は帳票 (取引書類) ではなく、電子帳簿保存法の保存対象でもない。議事録の紙出力需要は現時点でゼロ (1 人工房・画面 + 音声再生で完結)。将来必要になれば通話詳細画面のブラウザ印刷 (print CSS) で足り、専用実装は行わない。帳票 PDF は 02-sales.md §印刷出力が正。

---

## 1. アーキテクチャとモジュール定義

### 1.1 責務と依存

```
Twilio (050 着信/録音)
   │  HTTP POST (X-Twilio-Signature)
   ▼
/api/telephony/{voice,status,recording-status}   … route handler (署名検証 = route の責務)
   │  TelephonyFacade.handleInboundCall / handleCallStatus / registerRecording ({mode:'service'})
   ▼
telephony モジュール ─────────────────────────────────────────────
  所有: calls / call_recordings / call_jobs (+Storage: call-audio)
  依存: platform (Result/ExecutionContext/normalizeJpPhoneToE164)
        ai-providers (transcribe / generateText — 直 SDK 禁止)
        crm (matchCustomerByPhone / createTask / appendActivity)
        settings (business_hours / telephony キーの read — §1.5 契約差分申請)
──────────────────────────────────────────────────────────────────
   ▲
   │  TelephonyFacade.advanceCallJob ({mode:'service'}, 1 呼び出し = 1 ステージ)
pg_cron 毎分 → POST /api/jobs/telephony (x-jobs-secret, 202+after(), maxDuration 300)
```

- **AI 呼び出しは全量 `aiProvidersFacade` + `ExecutionContext {mode:'service'}` のみ** (00-overview §3.1)。`openai` 等の SDK 直 import は禁止 (ESLint)。feature 名は `call-transcribe` / `call-analysis` の固有名、`refTable='call_jobs'` / `refId=call_jobs.id` を必ず付与
- **CRM への書き込みは CrmFacade のみ** (顧客マッチ / タスク起票 / タイムライン)。activities への直接 INSERT 禁止 (00-overview §3.2.3)
- **Twilio SDK (`twilio` npm) の直 import は `src/modules/telephony/internal/**` のみ** (eslint.config.mjs に AI SDK 制限と同型で追加 — 00-overview §2.2)。用途は `validateRequest` (署名検証。自前 HMAC 実装は非推奨 — ext-twilio §5.1) と `twiml.VoiceResponse` (XML エスケープ)。twilio は CJS のため `next.config.ts` の `serverExternalPackages` へ追加 (twitter-text の前例)
- worker 駆動は pg_cron → pg_net → route の確立パターン (advance 連打方式は不採用 — 裁定 J2)

### 1.2 ディレクトリ構成

```
src/modules/telephony/
  contracts.ts       … §3 の Zod 契約 (07-delta §4.13 の写経 + 本書 §3.2 の追加分)
  facade.ts          … TelephonyFacade (§7.1) + 契約外拡張 (§7.2)
  repository.ts      … calls/call_recordings/call_jobs への DB アクセス + RPC ラッパ
  internal/
    twilio-signature.ts … validateRequest ラッパ (twilio SDK import はここと twiml.ts のみ)
    twiml.ts            … TwiML 生成純関数 (営業時間分岐/同意/留守電/dial_result/recorded)
    business-hours.ts   … JST 営業時間判定純関数 (isWithinBusinessHours)
    twilio-api.ts       … 録音 DL / 録音削除の薄い fetch ラッパ (Basic 認証)
    segmenter.ts        … WAV 解析・チャネル分離・時間分割の純関数 (§6.5.2)
    stage-machine.ts    … call_jobs ステージ遷移純関数 (nextStatusAfterStage 等)
    lease.ts            … LEASE_TTL_MS=90_000 / HEARTBEAT_INTERVAL_MS=20_000 / RPC 生返り値の判別共用体変換
    cost.ts             … Twilio コスト概算純関数 (µUSD)
    worker.ts           … advanceCallJob の実体 (ステージ実装 §6.5)
    prompts.ts          … 転写用語集 / 議事録 system prompt
src/app/api/telephony/{voice,status,recording-status}/route.ts
src/app/api/jobs/telephony/route.ts
src/app/admin/calls/…    … §8 の画面
```

### 1.3 技術選定 (裁定準拠の確認表)

| 項目 | 選定 | 準拠 |
|---|---|---|
| 番号 | 050 (National, $4.75/月)。番号・SID は設定値 (§1.4) | J3 |
| 転写 | 事後処理型: recordingStatusCallback → pg_cron worker → `aiProvidersFacade.transcribe` (gpt-4o-transcribe 既定) | J3 / J2 |
| 話者分離 | `record-from-answer-dual` (転送通話) の WAV チャネル分離 (純 TS、ffmpeg 不使用 — §6.5.2)。留守電はモノラル | ext-twilio §3.2 |
| 議事録/タスク抽出 | `generateText` + responseSchema (runStructured 4 点セット: refusal→E403 / parse 失敗→E404 系→**KMB-E821 に変換**) | ai-pipeline §5.1 |
| ジョブ機構 | ai_runs 同型 lease/commit を**専用 RPC として複製** (`call_job_acquire_lease` / `call_job_commit_stage`、0019 雛形) | J2 / 00-overview §3.1.4 |
| 署名検証 | `twilio.validateRequest` + **BASE_URL 固定** (`NEXT_PUBLIC_SITE_URL` から組み立て。`request.url` は使わない) | J3 / ext-twilio §5.1 |
| 15 秒制約 | voice webhook の同期処理は「calls UPSERT + settings read + TwiML 生成」のみ | J3 |
| 障害時 | Twilio 番号設定の Fallback URL に静的 TwiML Bin (§6.7) | J3 |
| 秘匿情報 | `TWILIO_AUTH_TOKEN` は **env** (15 秒制約下で Vault RPC 往復を避ける — 00-overview §5.4 の確定事項)。Vault は使わない | 発注指示 |

### 1.4 番号非依存設計 (裁定 J3 ★確認 1 対応)

隈部塗装が法人か個人事業主かは未確定 (Twilio 日本番号は法人限定)。**どちらに転んでも設計・実装・DDL が壊れない**ように、電話番号と Twilio リソース ID をコード/DDL に一切焼き付けない:

1. 購入番号 (E.164) と番号 SID は settings `telephony` キー (§3.2.1) に保存。未設定でも管理画面はセットアップ案内 (KMB-E802 degrade) を出して他機能は動作
2. 着信処理は webhook の `To` パラメータを使い、自番号の照合はしない (番号を変えても webhook URL を差し替えるだけ)
3. 転送先番号 (熊部さんの携帯) も settings。未設定 = 全通話留守電 (それだけで業務が成立する構成 — §0.3)
4. env は `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` の 2 つのみ (認証情報であって番号ではない)
5. 万一 Twilio で番号が取得できない場合も、テーブル・契約・画面はプロバイダ固有ではない (CallSid 等の列名は Twilio 語彙だが、`call_sid` = 「外部通話 ID」の意味論で他プロバイダにも転用可能。ただし v1 では Twilio 前提の webhook 実装のみ)

### 1.5 契約差分の改訂申請 (07-contracts-delta v1.1 への提案 — 統合作業者向け) → **全 3 件 採用済み**

本書の設計過程で、上位 canonical に**未記載だが必要**と判明した契約差分が 3 点あった。**裁定 (2026-07-11、07-contracts-delta v1.1「裁定記録」#5/#7/#2): Δ1〜Δ3 すべて採用・反映済み** (Δ1 → 07 §D2、Δ2 → 07 §D5 に zTelephonySettings の canonical 転記、Δ3 → 00-overview §3.3 に E807 登録)。実装着手の前提条件は満たされた (直接 module-contracts.md は触らない — 裁定 J10):

| # | 差分 | 内容 | 根拠 |
|---|---|---|---|
| Δ1 | §D2 依存方向に **`telephony ──→ settings (read: get のみ)`** を追加 | voice webhook (15 秒制約) 内で `settingsFacade.get("business_hours")` / `get("telephony")` を読む。`site_settings` は anon SELECT 可 + `SettingsFacade.get` は cookie 無しの anon クライアントでも成立することを実コードで確認済み (settings/facade.ts L42-65 — `createSupabaseServerClient` は anon key であり、セッション不要の read)。route での app 層合成にすると `handleInboundCall(input, ctx)` の D8 シグネチャに引数を足すことになり契約変更の規模が大きい。read 依存 1 本の追加が最小。**v1.1 注記: 「anon 全行 SELECT で成立」の前提は 07-delta v1.2 の anon 許可リスト化 (telephony キーは非公開 — §4.6) で telephony キーには適用されなくなった。read は D8 の `SettingsFacade.get(key, ctx?)` を handleInboundCall の service ctx で行う (§6.1)** | §6.1 |
| Δ2 | §D5 SETTINGS_SCHEMAS に **`telephony` キー** (zTelephonySettings、§3.2.1) を追加 | 録音同意アナウンス「既定 ON の設定項目」(J3 ★確認 4)・転送先・番号/SID (§1.4)・留守電長・Twilio 側録音削除方針は admin が画面で変えられる必要がある。telephony は設定テーブルを所有しない (D1 逸脱禁止) ため settings 所有キーが正 | §3.2.1 |
| Δ3 | 00-overview §3.3 エラーコード表に **KMB-E807** (通話ジョブの再実行対象外) を追加 | `retryCallJob` は failed のみ受け付ける。帯 E801〜E819 内の追加は「契約書更新が先」の規約どおり本申請で行う | §9 |

上記 3 点は承認済みのため本書の他章の記述はそのまま有効 (旧記載の「承認されない場合の代替」は不要になったが、参考として残す: Δ1 → route が 2 キーを読んで facade 拡張引数で渡す / Δ2 → 番号・転送先も env 化し同意文言は固定文言 / Δ3 → E803 に丸める)。なお Δ1 は裁定で**拡大適用**され、crm (notifications)・sales (invoice_issuer・company)・scheduling (work_capacity) の settings read も同時に §D2 へ明記された。

---

## 2. データモデル (canonical DDL)

### 2.1 ER 概観

```
customers (crm 所有) ◄─────────── calls.customer_id (nullable FK, on delete set null)
                                     │ 1
                                     │ *
                              call_recordings (recording_sid unique = webhook 冪等キー)
                                     │ 1
                                     │ 1  (unique (recording_id) = ジョブ生成の冪等キー)
                              call_jobs (lease 型ステージ機械: pending→downloading→transcribing
                                         →analyzing→linking→done/failed)
                                     ▲
        activities (crm 所有) ── ref_table='calls', ref_id=calls.id の 'call' activity
                                 (appendActivity の冪等キー。テーブル間 FK は張らない)
```

- 跨モジュール FK は `calls.customer_id → customers(id)` の 1 本のみ (posts.source_run_id の前例。コードアクセスは facade 経由 — 00-overview §3.2.2)
- `calls : call_recordings = 1 : N` (転送通話 + 留守電フォールバックで同一 CallSid に複数録音があり得る — データパターン §10-7)。ジョブは録音単位 (1 録音 = 1 ジョブ)
- activity への逆引きは `(activity_type='call', ref_table='calls', ref_id=calls.id)` (00-overview §3.2.3-3)。**通話 1 本 = activity 1 件** (録音が複数でも代表 1 件。§6.5.4)

### 2.2 migration 0032 — テーブル・RLS・index・Storage (全文)

```sql
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
```

### 2.3 migration 0033 — lease/commit/retry RPC (全文)

00-overview §3.1.4 の複製規約 8 要件を全て満たす (対応は §5.4 の表で自己検証。要件 8 の時間予算は worker/route 側 — §6.5.2-4/§7.3)。雛形は migration 0019 (`ai_run_acquire_lease` / `ai_run_commit_image_stage` — 実ファイル全文を裏取り済み)。ガードのみ `is_admin()` → `is_admin_or_service()` (0021 新設) に差し替える。

```sql
-- 20260711000033_telephony_job_rpc.sql
-- canonical: docs/design/crm-suite/04-telephony.md §2.3 (裁定 J2 / 00-overview §3.1.4)
-- 前提: migration 0021 (is_admin_or_service) 適用済み。
-- 本 migration が追加するもの:
--   1) call_job_acquire_lease — ai_run_acquire_lease (0019) の同型複製。
--      差分: 対象テーブル call_jobs / runnable 集合 / bootstrap pending→downloading /
--            attempts 枯渇コード KMB-E806 / ガード is_admin_or_service()
--   2) call_job_commit_stage — CAS commit (成果物 UPSERT + status 前進 + lease 解放 +
--      attempts=0 リセットを単一 UPDATE で原子的に。不一致は冪等 no-op)
--   3) call_job_retry — failed → pending (admin 再実行。00-overview §5.2「再実行操作は RPC 経由」)
-- 実障害教訓の反映 (0019 CRITICAL/BLOCKER):
--   - RETURNS TABLE を持つ関数は本体冒頭に #variable_conflict use_column 必須
--   - stage_attempts のリセットは commit の CAS UPDATE の SET 句のみ (no-op 経路ではリセットしない)
--   - 排他は FOR UPDATE 行ロック (advisory lock 禁止 — pgbouncer transaction pooling)

-- ---------------------------------------------------------
-- 1) lease 取得 (CAS)
-- ---------------------------------------------------------
create or replace function public.call_job_acquire_lease(p_job_id uuid)
returns table (
  id uuid,
  status text,
  lease_expires_at timestamptz,
  stage_attempts int,
  call_id uuid,
  recording_id uuid,
  transcript jsonb,
  analysis jsonb,
  result_kind text -- 'acquired' | 'held' | 'exhausted' | 'terminal' | 'not_found'
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row call_jobs%rowtype;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: call_job_acquire_lease requires admin or service_role';
  end if;

  -- FOR UPDATE 行ロックで CAS を直列化 (同時起床した 2 プロセス目はここで待ち、
  -- 1 プロセス目のコミット後の最新状態で判定される)
  select * into v_row from call_jobs where id = p_job_id for update;

  if not found then
    return query select p_job_id, null::text, null::timestamptz, null::int,
      null::uuid, null::uuid, null::jsonb, null::jsonb, 'not_found'::text;
    return;
  end if;

  if v_row.status not in ('pending', 'downloading', 'transcribing', 'analyzing', 'linking') then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'terminal'::text;
    return;
  end if;

  -- 3 回までは許容し、4 回目の試行になる時点で failed (KMB-E806 — E402 と同型) に倒す
  if v_row.stage_attempts >= 3 then
    update call_jobs
      set status = 'failed', error_code = 'KMB-E806', lease_expires_at = null
      where id = p_job_id
      returning * into v_row;
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'exhausted'::text;
    return;
  end if;

  if v_row.lease_expires_at is not null and v_row.lease_expires_at >= now() then
    return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
      v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'held'::text;
    return;
  end if;

  update call_jobs
    set
      lease_expires_at = now() + interval '90 seconds',
      stage_attempts = stage_attempts + 1,
      status = case when status = 'pending' then 'downloading' else status end
    where id = p_job_id
    returning * into v_row;

  return query select v_row.id, v_row.status, v_row.lease_expires_at, v_row.stage_attempts,
    v_row.call_id, v_row.recording_id, v_row.transcript, v_row.analysis, 'acquired'::text;
end;
$$;

revoke all on function public.call_job_acquire_lease(uuid) from public, anon;
grant execute on function public.call_job_acquire_lease(uuid) to authenticated;

-- ---------------------------------------------------------
-- 2) commit (CAS + 成果物 UPSERT + lease 解放 + attempts リセットを単一 UPDATE で原子的に)
-- ---------------------------------------------------------
create or replace function public.call_job_commit_stage(
  p_job_id uuid,
  p_expected_status text,
  p_next_status text,
  p_transcript jsonb default null,
  p_analysis jsonb default null,
  p_link_result jsonb default null,
  p_ai_cost_delta_micro_usd bigint default null,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_status text;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: call_job_commit_stage requires admin or service_role';
  end if;

  -- stage_attempts はステージ単位のリトライ回数。実際に status が前進した
  -- (= この UPDATE が行に影響した) 場合のみ 0 にリセットする。CAS 不一致の no-op 経路
  -- (下の v_updated_status is null 分岐) では触れない (0019 Codex BLOCKER の教訓)
  update call_jobs
  set
    status = p_next_status,
    transcript = coalesce(p_transcript, transcript),
    analysis = coalesce(p_analysis, analysis),
    link_result = coalesce(p_link_result, link_result),
    ai_cost_micro_usd = ai_cost_micro_usd + coalesce(p_ai_cost_delta_micro_usd, 0),
    error_code = coalesce(p_error_code, error_code),
    lease_expires_at = null,
    stage_attempts = 0
  where id = p_job_id
    and status = p_expected_status
  returning status into v_updated_status;

  if v_updated_status is null then
    -- 既に他の試行が commit 済み。冪等に現在値を返すのみ (成果物の再書き込みなし)
    select status into v_updated_status from call_jobs where id = p_job_id;
    return v_updated_status;
  end if;

  return v_updated_status;
end;
$$;

revoke all on function public.call_job_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, bigint, text
) from public, anon;
grant execute on function public.call_job_commit_stage(
  uuid, text, text, jsonb, jsonb, jsonb, bigint, text
) to authenticated;

-- ---------------------------------------------------------
-- 3) 再実行 (failed → pending。admin 操作の唯一の書込経路)
-- ---------------------------------------------------------
create or replace function public.call_job_retry(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: call_job_retry requires admin or service_role';
  end if;

  update call_jobs
    set status = 'pending', stage_attempts = 0, error_code = null, lease_expires_at = null
    where id = p_job_id and status = 'failed'
    returning status into v_status;

  if v_status is null then
    -- failed 以外への retry は業務エラー (KMB-E807 — §1.5 Δ3)。存在しない id も同経路
    raise exception 'KMB-E807: 再実行できるのは failed のジョブのみです';
  end if;

  return v_status; -- 'pending'
end;
$$;

revoke all on function public.call_job_retry(uuid) from public, anon;
grant execute on function public.call_job_retry(uuid) to authenticated;
```

heartbeat (lease 延長) は RPC 化しない: worker が service client で `update call_jobs set lease_expires_at = now() + 90s where id = ... and lease_expires_at is not null` を 20 秒毎に直接実行 (ai-studio と同じ判断 — 単純 CAS のため。0009:126-128 前例)。

### 2.4 migration 0034 — pg_cron ジョブ登録 (全文)

```sql
-- 20260711000034_telephony_cron.sql
-- canonical: docs/design/crm-suite/04-telephony.md §2.4 / 00-overview §3.1.3
-- 既存パターン (0011/0017) 完全踏襲: Vault (cron_site_url / cron_jobs_secret) 未設定なら
-- raise notice で安全にスキップ。登録は unschedule → schedule の張り替えで冪等。

create or replace function public.trigger_telephony_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_jobs_secret';
  if v_url is null or v_secret is null then
    raise notice 'trigger_telephony_worker: Vault (cron_site_url / cron_jobs_secret) 未設定のためスキップ';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/telephony',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_telephony_worker() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-telephony-worker';
select cron.schedule('kmb-telephony-worker', '* * * * *', $$select public.trigger_telephony_worker();$$);
```

### 2.5 JSONB カラム ↔ 型契約対応表

| カラム | canonical スキーマ | parse 位置 |
|---|---|---|
| call_jobs.transcript | `zCallTranscript` (07-contracts-delta §4.13) | commit 前 (worker) + 読み出し時 (facade/画面) の二段階 parse |
| call_jobs.analysis | `zCallAnalysis` (同上。AI 出力は runStructured 4 点セットで検証してから保存) | 同上 |
| call_jobs.link_result | `zCallJobLinkResult` (本書 §3.2.4 — telephony 所有の内部契約) | 同上 |
| call_jobs.transcript_partial | `zCallTranscriptCheckpoint` (本書 §3.2 — worker 内部契約。転写チェックポイント §6.5.2-4) | worker のみ (読み書きとも) |
| site_settings.business_hours | `zBusinessHoursSettings` (07-contracts-delta §D5 — settings 所有。再定義しない) | SettingsFacade.get 内 |
| site_settings.telephony | `zTelephonySettings` (07-contracts-delta §D5 — Δ2 採用済み。§3.2.1 は写し) | 同上 |

### 2.6 データ規約 (本モジュール分)

- 自モジュール所有の enum (direction / handling / match_status / call_jobs.status / call_recordings.source / channels) は **DB check ↔ Zod enum 1:1** で `contracts-ddl-parity.test.ts` に追加する。`twilio_status` のみ例外 (外部所有語彙 — §2.2 コメントに理由明記)
- 電話番号は保存前に `normalizeJpPhoneToE164()` (platform、M0) で E.164 化。正規化不能 (非通知 'anonymous' 等) は `from_e164 = null` + `from_raw` に原文保持
- 金額は **µUSD (bigint) のみ** (Twilio 概算・AI 実測とも)。JPY 整数 (帳票系) と混在しない。表示時のみ ¥ 換算 (概算注記付き、レートはコード定数 `USD_JPY_DISPLAY_RATE = 150` — 表示専用で保存しない)
- 時刻は timestamptz (UTC) 保存 + Asia/Tokyo 表示。営業時間判定 (§6.2) も JST 変換後に行う
- 一覧は keyset (started_at desc, id desc)、admin 50 件/頁
- DELETE 系: calls/call_recordings/call_jobs に admin DELETE ポリシーなし (通話履歴は事実記録 — §5.3)。将来の保存容量対策は §15 R6

---

## 3. 値契約 (Zod 完全記述 — `src/modules/telephony/contracts.ts`)

### 3.1 07-contracts-delta §4.13 からの写経 (canonical はそちら。再定義ではなく転記)

以下は 07-contracts-delta §D7 4.13 の全文をそのまま `contracts.ts` に写経する分 (乖離したら 07 が正)。

```ts
import { z } from "zod";
import { zShortText } from "@/modules/platform/contracts";

export const zCallDirection = z.enum(["inbound", "outbound"]); // outbound は Phase 2 予約
export const zCallHandling = z.enum(["forwarded", "voicemail", "after_hours_voicemail", "missed"]);
export const zCallJobStatus = z.enum([
  "pending", "downloading", "transcribing", "analyzing", "linking", "done", "failed",
]);

/** Twilio Voice webhook の受信契約 (application/x-www-form-urlencoded を parse した後の最小部分集合。
 *  署名検証 validateRequest は「全パラメータ変形なし」が必須のため route が生 params を保持し、
 *  本スキーマは検証後の業務利用分のみ) */
export const zInboundCallWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  From: z.string().max(30).nullable(),           // 非通知は null 化 (E.164 正規化は facade 内)
  To: z.string().max(30),
  CallStatus: z.string().max(30),
}).strict();

export const zRecordingWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  RecordingSid: z.string().min(10).max(64),
  RecordingUrl: z.string().url(),
  RecordingDuration: z.coerce.number().int().min(0),
  RecordingChannels: z.coerce.number().int().min(1).max(2),
}).strict();

/** 転写結果 (call_jobs.transcript jsonb)。デュアルチャネルは channel 0=相手 / 1=こちら */
export const zCallTranscript = z.object({
  segments: z.array(z.object({
    channel: z.number().int().min(0).max(1),
    index: z.number().int().min(0),
    text: z.string().max(50_000),
  }).strict()).max(200),
  full_text: z.string().max(200_000),
}).strict();

/** AI 議事録 (generateText + responseSchema の structured output。
 *  JSON Schema は z.toJSONSchema() で本スキーマから生成 — 手書き禁止) */
export const zCallMinutes = z.object({
  summary: z.string().min(1).max(2000),
  caller_intent: z.enum(["estimate_request", "order", "inquiry", "schedule", "complaint", "sales_call", "other"]),
  key_points: z.array(z.string().max(300)).max(20),
  customer_name_guess: z.string().max(60).nullable(),
  callback_required: z.boolean(),
  callback_note: z.string().max(300).nullable(),
}).strict();

export const zExtractedCallTask = z.object({
  title: zShortText(120),
  detail: z.string().max(1000).nullable(),
  due_hint: z.string().max(100).nullable(),      // 「明日中に折り返し」等。日付確定は admin
}).strict();

/** analyzing ステージの出力契約 (KMB-E821 の検証対象) */
export const zCallAnalysis = z.object({
  minutes: zCallMinutes,
  tasks: z.array(zExtractedCallTask).max(10),
}).strict();

export type CallListItem = {
  id: string;
  direction: z.infer<typeof zCallDirection>;
  from_e164: string | null;    // zTelE164 準拠 (非通知は null)
  customer_id: string | null;
  customer_name: string | null;
  handling: z.infer<typeof zCallHandling> | null;
  duration_seconds: number | null;
  job_status: z.infer<typeof zCallJobStatus> | null;
  started_at: string;
};
```

### 3.2 本書で追加する契約 (telephony 所有 + Δ2 申請分)

```ts
import { z } from "zod";
import { zDateOnly, zShortText, zTelE164 } from "@/modules/platform/contracts";

/* ---------- Δ2 (採用済み — 07-contracts-delta v1.1): settings 'telephony' キー (所有 settings、
   canonical は 07 §D5 に転記済み。以下はその写し。実装は settings/contracts.ts の SETTINGS_SCHEMAS に
   載せる — 本モジュールでは import のみ) ---------- */

/** 電話まわりの運用設定 (04-telephony.md §1.4 番号非依存設計 / 裁定 J3 ★確認 1・4)。
 *  全フィールド null/既定で「未設定でも壊れない」: 番号未購入でも保存可、
 *  forward_to null = 全通話留守電、announcement text null = コード内既定文言 */
export const zTelephonySettings = z.object({
  phone_number_e164: zTelE164.nullable(),        // 購入した 050 番号 (表示・Phase 2 発信用)
  twilio_number_sid: z.string().max(64).nullable(), // 番号リソース SID (PN...)。運用記録用
  forward_to_e164: zTelE164.nullable(),          // 営業時間内の転送先 (熊部さん携帯)。null = 転送なし→留守電
  consent_announcement_enabled: z.boolean(),     // 録音同意アナウンス (既定 true — 裁定 J3)
  consent_announcement_text: z.string().max(300).nullable(), // null = 既定文言 (internal/twiml.ts の定数)
  in_hours_greeting_text: z.string().max(300).nullable(),    // 営業時間内・転送なし時の留守電導入文言
  after_hours_greeting_text: z.string().max(300).nullable(), // 時間外アナウンス文言
  voicemail_max_seconds: z.number().int().min(30).max(600),  // <Record maxLength>。既定 120
  delete_twilio_recording_after_download: z.boolean(),       // 既定 true (ストレージ課金停止 — ext-twilio §2.2)
  max_processing_minutes: z.number().int().min(1).max(60),   // AI 処理する録音長の上限。既定 30。超過は KMB-E822
}).strict();

/* ---------- webhook 追加契約 (telephony 所有の route 契約) ---------- */

/** 通話終了 statusCallback (D8 handleCallStatus の入力を Zod 化)。
 *  webhook 契約共通則 (§6.1-5): route は署名検証後に「契約キーのみ pick + 欠落キーは null 補完」
 *  してから parse する (form-urlencoded はキー自体が欠落 = undefined になり得るため、
 *  .nullable() だけでは受けられない。欠落し得る数値フィールドは preprocess で undefined→null を吸収) */
export const zCallStatusWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  CallStatus: z.string().max(30),
  CallDuration: z.preprocess(
    v => v ?? null,
    z.coerce.number().int().min(0).nullable(),
  ), // 終了系イベント以外はパラメータごと欠落し得る (undefined → null)
}).strict();

/** <Dial action> callback (?step=dial_result — §6.1)。voicemail フォールバック判定に使う。
 *  DialCallDuration は Dial が応答されなかった場合 (busy/no-answer/failed/canceled) に
 *  Twilio がパラメータ自体を送らない想定 (★実装前に Twilio 公式 Doc の <Dial> action callback
 *  パラメータ表で欠落条件を裏取りし、本コメントに引用 URL を残すこと)。
 *  ここが parse 失敗すると留守電フォールバック (§10-2) が Fallback URL 切断に化けるため、
 *  欠落を必ず受けられる形にする (BLOCKER 級) */
export const zDialResultWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  DialCallStatus: z.enum(["completed", "answered", "busy", "no-answer", "failed", "canceled"]),
  DialCallDuration: z.preprocess(
    v => v ?? null,
    z.coerce.number().int().min(0).nullable(),
  ),
}).strict();

/* ---------- linking ステージの成果物 (call_jobs.link_result jsonb) ---------- */

/** linking の監査スナップショット。参照整合は持たせない (FK は calls.customer_id が正)。
 *  再実行時の冪等判定は appendActivity の (type, ref_table, ref_id) 一意性が担う */
export const zCallJobLinkResult = z.object({
  outcome: z.enum(["matched", "created", "ambiguous", "no_number"]), // calls.match_status へ反映した値
  customer_id: z.string().uuid().nullable(),
  activity_id: z.string().uuid().nullable(),  // ambiguous / no_number は null (activity 未作成)
  activity_created: z.boolean(),              // appendActivity の created フラグ (false = 再実行だった)
  task_ids: z.array(z.string().uuid()).max(10),
  warning: z.string().max(300).nullable(),    // 例: 'KMB-E823: 候補 2 件' (detail 要約)
}).strict();

/* ---------- transcribing チェックポイント (call_jobs.transcript_partial jsonb — worker 内部契約) ---------- */

/** セグメント単位の転写チェックポイント (00-overview §3.1.4-8 の実装 — §6.5.2-4)。
 *  (channel, index) が再開カーソル。完了セグメントのみ追記され、
 *  全完了時に zCallTranscript へ組み立てて commit する */
export const zCallTranscriptCheckpoint = z.object({
  segments: z.array(z.object({
    channel: z.number().int().min(0).max(1),
    index: z.number().int().min(0),
    text: z.string().max(50_000),
  }).strict()).max(200),
}).strict();

/* ---------- DB check ↔ Zod parity 用 enum (call_recordings — §2.6/§12.2 の parity テスト対象) ---------- */

export const zCallRecordingSource = z.enum(["dial", "voicemail"]); // 2ch='dial' / 1ch='voicemail' (§6.4-2)
export const zCallRecordingChannels = z.union([z.literal(1), z.literal(2)]);
```

以下の定数は **contracts.ts には置かない** (contracts.ts は他モジュールから import 可能な公開面であり、worker 内部定数を晒さない — 契約面の最小化)。所属は各 internal ファイルで、00-overview §3.1.4 要件 3「定数は複製先モジュールの internal/lease.ts」に従う (§1.2/§5.4 と一致):

```ts
// ---- internal/lease.ts (単体テスト対象 — §12.1 telephony-job-stage-machine) ----
export const CALL_JOB_LEASE_TTL_MS = 90_000;
export const CALL_JOB_HEARTBEAT_INTERVAL_MS = 20_000;
export const CALL_JOB_MAX_ATTEMPTS = 3;
export const TELEPHONY_WORKER_MAX_JOBS_PER_WAKE = 2; // 00-overview §3.1.3
export const TELEPHONY_WAKE_SOFT_BUDGET_MS = 240_000; // maxDuration 300s に対する安全予算 (00-overview §3.1.4-8)
export const TRANSCRIBE_SEGMENT_WORST_MS = 60_000;    // 1 セグメント転写の最悪想定 (§5.4-8 / §6.5.2-4)

// ---- internal/cost.ts ----
/** Twilio 単価表 (µUSD/分。2026-07 実測 — ext-twilio §1.4。改定時はここだけ更新) */
export const TWILIO_RATES_MICRO_USD_PER_MIN = {
  inbound_050: 10_000,        // $0.0100/min
  recording: 2_500,           // $0.0025/min
  forward_leg_mobile: 185_000, // $0.185/min (転送成立時のみ加算)
} as const;

// ---- internal/segmenter.ts (§6.5.2) ----
export const SEGMENT_MAX_SECONDS = 600;        // 1 セグメント 10 分
export const SEGMENT_OVERLAP_SECONDS = 2;      // 境界オーバーラップ (00-overview §15 R5)
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // OpenAI 25MB 上限 (E303 と同値)
```

### 3.3 JSON Schema 生成規約

- `zCallAnalysis` → `generateText` の `responseSchema` へ渡す JSON Schema は **zod v4 の `z.toJSONSchema(zCallAnalysis)`** のみ (手書き禁止・`zod-to-json-schema` 禁止 — 空スキーマを吐く実証済み)
- `.nullable()` フィールドが structured outputs で `["string","null"]` union になることを `telephony-contracts` 単体テストで検証 (ai-studio/internal/json-schema.ts の変換前例を踏襲)
- `as any` / `any` は全面禁止。RPC 生返り値は `internal/lease.ts` の判別共用体変換関数 (`interpretAcquireLeaseResult` 同型) で型付けする

---

## 4. 認可マトリクス (必須章 ①)

### 4.1 ロール定義 (00-overview §5.1 準拠・4 列)

| ロール | 実体 | 本モジュールでの接点 |
|---|---|---|
| anon | 未ログイン | **全面拒否** (公開サイトに telephony の露出なし) |
| admin | `is_admin()` (単一管理者) | 一覧/詳細閲覧・手動紐づけ・メモ・再実行 (RPC)・再生 (署名 URL)・設定編集 |
| service | service_role (RLS bypass) | webhook (calls/recordings INSERT・状態更新)・worker (ジョブ全書込)・署名 URL 発行 |
| (将来: staff) | profiles.role 拡張 | §4.7 の差分方針。v1 実装なし |

### 4.2 テーブル × ロール (RLS + 列レベル grant。ポリシー全文は §2.2 が正)

| テーブル | anon | admin | service | 将来 staff (方針) | 強制手段 |
|---|---|---|---|---|---|
| calls | ✗ | SELECT + **UPDATE は customer_id / match_status / memo 列のみ** | INSERT / UPDATE (webhook・worker) | R + 同列 W | RLS `calls_admin_select`/`calls_admin_update` + 列レベル `grant update (customer_id, match_status, memo)` + `revoke all from anon, authenticated` |
| call_recordings | ✗ | SELECT のみ | INSERT / UPDATE / DELETE | R | RLS `call_recordings_admin_select` + revoke/grant |
| call_jobs | ✗ | SELECT + 再実行は `call_job_retry` RPC のみ | INSERT / UPDATE (worker・RPC) | R | RLS `call_jobs_admin_select` + revoke/grant (書込ポリシーなし) |

00-overview §5.2 総表との差分は 1 点のみ: calls の admin UPDATE 列に **match_status を追加**している (総表は「customer_id 手動紐づけ・メモ列のみ」— 手動紐づけは customer_id と match_status='manual' の同時更新が必然のため 3 列が正)。00-overview §5.2 calls 行を 3 列表記へ更新する canonical 差分を申請する (それ以外は 1:1 一致)。

### 4.3 Storage

| バケット | anon | admin | service | 備考 |
|---|---|---|---|---|
| call-audio (private, 新設 0032) | ✗ | ✗ (直接アクセス不可 — ポリシーを一切作らない) | 書込 (`{call_id}/{recording_sid}.wav`, `upsert:true` — 同一内容の再 DL 冪等) + 署名 URL 発行 | 再生は `createRecordingPlaybackUrl` (admin 認証 → service client `createSignedUrl` TTL 10 分)。SELECT ポリシーを作らない理由 = 公開バケット列挙の教訓 0006 (00-overview §5.4) |

### 4.4 API エンドポイント

| エンドポイント | Method | 認可 | 主エラー | maxDuration |
|---|---|---|---|---|
| /api/telephony/voice (+`?step=dial_result` / `?step=recorded`) | POST | **X-Twilio-Signature** (`validateRequest` + BASE_URL 固定 — §6.1)。env 未設定 → 503 | E801 (403) / E802 (503) / E803 | 30 |
| /api/telephony/status | POST | 同上 | E801 / E803 / E804 | 30 |
| /api/telephony/recording-status | POST | 同上 | E801 / E803 / E805 | 60 |
| /api/jobs/telephony | POST | x-jobs-secret (JOBS_SECRET。未設定 503) — 既存 3 route と完全同型 | E201 (401) / E901 | 300 |

Server Actions (§7.4) は全て先頭 `requireAdmin()` + Zod parse (既存規約)。webhook ルートは middleware の rewrite 対象外であることを実装時に確認 (クエリ変形は署名検証を壊す — ext-twilio §5.1)。

### 4.5 RPC

| RPC | ガード | 呼び出し元 |
|---|---|---|
| call_job_acquire_lease / call_job_commit_stage | `is_admin_or_service()` | worker (service)。admin 直接呼び出しは想定しないが害なし (ガード通過) |
| call_job_retry | `is_admin_or_service()` | admin Server Action (session) / 将来の自動再実行 (service) |

3 本とも security definer + `set search_path = public` + 明示 revoke (public, anon) + grant to authenticated (service_role は revoke の影響を受けない — 0020 の理屈)。

### 4.6 env / Vault / 設定値

| 対象 | 分類 | 内容 |
|---|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | env (optional + `isTwilioConfigured()` + UI degrade) | 署名検証・録音 DL (Basic 認証)・録音削除。**Vault ではなく env** (15 秒制約下で Vault RPC 往復を避ける — 00-overview §5.4 確定)。`src/lib/env.ts` の zod スキーマに追加 (空文字→undefined preprocess 継承) |
| `NEXT_PUBLIC_SITE_URL` | env (既存) | 署名検証 URL の組み立て元 (BASE_URL 固定)。Twilio コンソールの webhook URL と完全一致必須 |
| settings `business_hours` / `telephony` | site_settings (キー別認可) | `business_hours` は公開キー (anon SELECT 許可リスト内)。**`telephony` は非公開キー** — forward_to_e164 (熊部さんの個人携帯) を含むため anon SELECT 不可 (migration 0021 の anon ポリシー許可リスト置換 — 07-delta §D5 / 00-overview §5.2)。webhook 経路の read は `SettingsFacade.get(key, ctx?)` を handleInboundCall の service ctx で行う (D8)。AUTH_TOKEN 等の認証情報はどのキーにも置かない |
| Vault | — | 本モジュールでは使用しない (cron の `cron_site_url`/`cron_jobs_secret` は既存共用) |

`TWILIO_AUTH_TOKEN` ローテーション時は一時的に旧トークン署名の webhook が 403 になる (セカンダリトークン併用検証は v1 スコープ外 — 運用手順書に「ローテーションは深夜に、Twilio 側切替→env 切替を連続実施」と記載。§15 R5)。

### 4.7 将来 staff 拡張時の差分 (裁定 J1)

- `calls_staff_select` / `call_recordings_staff_select` / `call_jobs_staff_select` を **追加** (is_admin 系ポリシーは置換しない)
- staff にも列限定 UPDATE (customer_id/match_status/memo) を開放するかは業務判断 (既定: 開放 — 電話対応は現場作業)
- Twilio 接続は staff 追加後も**事業体で 1 接続のまま** (per-user 番号にしない — J1)。転送先の複数化 (順次呼び出し) は settings `telephony.forward_to_e164` の配列化で吸収 (契約改訂が先)

---

## 5. 状態意味論・ライフサイクル (必須章 ④⑨)

### 5.1 call_jobs 状態機械 (本モジュールの中核)

```
pending ──(acquire で bootstrap)──► downloading ──► transcribing ──► analyzing ──► linking ──► done
   ▲                                    │                │               │            │
   │ (call_job_retry: failed→pending)   └────────────────┴───────────────┴────────────┘
   │                                         stage_attempts >= 3 (acquire 時判定)
 failed ◄────────────────────────────────────  KMB-E806 / 確定エラー即 failed (E822 等)
```

| status | 意味論 (「次に実行すべきステージ」) | ステージの仕事 | 成果物 (commit) |
|---|---|---|---|
| pending | 未着手。acquire が downloading へ bootstrap | — | — |
| downloading | Twilio から録音 DL → Storage 保存 → (設定 ON) Twilio 側削除 | 外部 I/O のみ (AI なし) | call_recordings.storage_path/byte_size (+twilio_deleted_at)。commit: expected='downloading' → next='transcribing' |
| transcribing | セグメント分割 → `transcribe` × N ({mode:'service'}) | AI (feature 'call-transcribe') | transcript (zCallTranscript) + ai_cost 加算。→ 'analyzing' |
| analyzing | `generateText` + responseSchema (zCallAnalysis) | AI (feature 'call-analysis') | analysis + ai_cost 加算。→ 'linking' |
| linking | 顧客マッチ → タスク起票 → activity 追記 → calls 反映 | CrmFacade 呼び出し (AI なし) | link_result + calls.customer_id/match_status/ai_cost。→ 'done' |
| done | 終端 (成功)。retry 不可 (terminal) | — | — |
| failed | 終端 (失敗)。`call_job_retry` で pending に戻せる唯一の状態 | — | error_code 保持 |

不変条件:

1. **status は commit RPC の CAS でのみ前進** (`where status = p_expected_status`)。二重 commit は冪等 no-op
2. **stage_attempts は acquire で +1、commit 成功時のみ 0** (no-op 経路ではリセットしない — 0019 BLOCKER)
3. **transcript / analysis / link_result は一度書かれたら worker は上書きしない** (coalesce による「null なら保持」+ 再実行時は既存成果物を再利用してステージをスキップ判定 — §6.5 各ステージ冒頭の再入ガード)
4. 確定不能エラー (予算 E407 / 処理上限 E822 / 全キー失敗 E408 連発) は attempts を待たず **worker が commit(next='failed', error_code)** で即 failed に倒してよい (E806 は「原因不明で 3 回失敗」の枯渇専用)
5. failed → pending は `call_job_retry` のみ (attempts/error_code リセット込み)。done は不可逆
6. クラッシュ再開: lease 自然失効 (90 秒) 後、次の起床が同ステージを再実行。各ステージは再入安全 (§6.5)
7. transcribing のみ**進捗 commit** (expected = next = 'transcribing') を持つ (00-overview §3.1.4-8)。成果はチェックポイント列 (transcript_partial) に保存済みで、進捗 commit は attempts リセット + lease 解放のみを担う (§6.5.2-4)。新規セグメントが 1 本も完了していない起床では進捗 commit しない (「無進捗 3 回で E806」の意味論を保つ)
8. 最終試行 (acquire 返り値 stage_attempts = 3) で同一の既知エラーが続く場合、worker は枯渇 (E806) を待たず、より特定的なコードで自ら commit(next='failed') してよい (例: downloading の 3 回目 404 → KMB-E805 — §6.5.1-2。診断性を E806 より優先)

### 5.2 calls の状態群 (直交する 3 軸)

calls は単一の状態機械ではなく、独立に遷移する 3 軸を持つ (混同しないこと):

**(a) twilio_status** — Twilio 所有の外部語彙 (ringing → in-progress → completed / busy / no-answer / failed / canceled)。webhook が上書きするだけで、アプリのロジック分岐には使わない (監査用)。

**(b) handling** — ルーティング結果 (zCallHandling と 1:1):

| handling | 意味論 | 設定される契機 |
|---|---|---|
| null | 着信直後 (未確定) | voice webhook (root) 時点 |
| forwarded | 営業時間内 + 転送先あり → `<Dial>` で転送 (成立) | `?step=dial_result` で DialCallStatus='completed'/'answered' |
| voicemail | 営業時間内の留守電 (転送なし or 転送不成立フォールバック) | root で転送なし分岐時 / dial_result で busy・no-answer・failed 時 |
| after_hours_voicemail | 時間外留守電 | root の時間外分岐時 |
| missed | 録音もつながりもなかった (発信者が録音前に切断等) | status callback で通話終了時、**handling が null のまま終了した場合のみ**確定 (§6.3 が正)。voicemail 系は録音有無を問わず missed へ倒さない — recording callback は status callback より後に届くのが通例で、「録音 0 件」を遷移条件にすると正常な留守電が誤判定される。録音なし留守電の区別は一覧の表示条件 (録音バッジなし) で表現し、handling 遷移には含めない |

不変条件: handling は null → 非 null の一方向。一度 forwarded になったら voicemail へ倒れない (dial_result より前に root で forwarded を書かない — dial_result で初めて確定する)。

**(c) match_status** — 顧客紐づけ (§6.5.4 linking の結果):

```
pending ──► matched   (tel_e164 一致 1 件 → calls.customer_id 設定 + activity)
        ──► created   (一致なし → lifecycle='lead' 顧客を新規作成 + activity)
        ──► ambiguous (複数一致 KMB-E823 → 自動確定しない。customer_id は null のまま)
        ──► no_number (from_e164 null → マッチ不能。終端)
ambiguous / matched / created / no_number ──► manual (admin が手動で紐づけ/付け替え — linkCallToCustomer)
manual ──► manual (解除: linkCallToCustomer(null) — customer_id を null 化。manual のまま「手動介入済み・未紐づけ」を表す)
```

不変条件 (v1.1 是正 — 解除操作 §7.2 と両立する形に再定義):

- `match_status in ('matched','created')` ⇒ `customer_id is not null`
- `match_status in ('pending','ambiguous','no_number')` ⇒ `customer_id is null`
- `match_status = 'manual'` は「admin が手動介入済み」の印で、customer_id は**非 null (紐づけ/付け替え済み) と null (解除済み) の両方があり得る**
- **manual は worker に対して終端**: linking (§6.5.4-5) は match_status='manual' の行の customer_id / match_status を上書きしない (解除・付け替えも admin のみ)

この整合は repository が書込時に検証する (DB check にはしない — customer_id の手動 UPDATE と match_status 更新が 1 文で来るとは限らないため facade が単一操作に閉じる)。

### 5.3 call_recordings / 音声データのライフサイクル

```
Twilio 上に録音生成 ──(recording-status webhook)──► call_recordings 行 (storage_path null)
  ──(downloading ステージ)──► call-audio バケット保存 (storage_path 設定)
  ──(設定 ON)──► Twilio 側削除 (twilio_deleted_at 記録。失敗しても job は前進 — ベストエフォート §6.5.1)
  ──► 以後不変。v1 に自動削除なし (容量は §14 で試算。将来のリテンションは §15 R6)
```

- 転写原文 (transcript) は**不変保存** (00-overview §8: 「転写原文は不変保存」)。議事録の再生成があっても transcript は上書きしない (retry で transcribing からやり直す場合を除く)
- calls / call_recordings / call_jobs に admin DELETE なし。誤配や個人情報削除要請への対応は service (開発者オペレーション) で行い、activities 側の 'call' activity は crm の不変規約に従う (note 以外不変)

### 5.4 lease 意味論 — 00-overview §3.1.4「複製規約 8 要件」との対応 (自己検証表)

| # | 要件 | 本設計での充足 |
|---|---|---|
| 1 | `#variable_conflict use_column` 必須 | call_job_acquire_lease 本体冒頭 (§2.3)。commit/retry は RETURNS text のため対象外だが同型維持 |
| 2 | FOR UPDATE 行ロック CAS (advisory lock 禁止) | acquire の `select ... for update` (§2.3) |
| 3 | lease TTL 90 秒 + heartbeat 20 秒 (定数は internal/lease.ts) | `CALL_JOB_LEASE_TTL_MS` / `CALL_JOB_HEARTBEAT_INTERVAL_MS` (§3.2) + 単体テスト (§12) |
| 4 | attempts >= 3 で failed + 専用コード。commit 成功時のみ attempts=0 | acquire の KMB-E806 分岐 / commit の SET 句 (§2.3) |
| 5 | commit = 成果物 UPSERT + status 前進 + lease 解放 + attempts リセットを単一 UPDATE (CAS)。不一致は冪等 no-op | call_job_commit_stage (§2.3) |
| 6 | ガードは `is_admin_or_service()` | 3 RPC とも (§2.3) |
| 7 | 予算 TTL 10 分以内に 1 AI 呼び出し。長い録音はセグメント直列 + セグメント毎 reserve | transcribe をセグメント単位で呼ぶ (router がセグメント毎に reserve/settle — §6.5.2)。1 セグメント ≤ 10 分音声 ≈ 転写 30-60 秒 ≪ 10 分 |
| 8 | 時間予算 (maxDuration 300 秒 = 起床 1 回の総予算): 残余予算ガード + 可変長ステージのチェックポイント | route の持ち越し判定 (2 件目は lease 取得前に判定・attempts 不計上 — §7.3) + transcribing のセグメント checkpoint / 進捗 commit (§6.5.2-4)。**時間予算の突合せ**: 最悪ケース = 60 分 dual 録音 = 2ch × 6 = 12 セグメント × 30-60 秒 = 360〜720 秒 > 300 秒 → 1 起床では収まらないため、TELEPHONY_WAKE_SOFT_BUDGET_MS (240 秒) で打ち切り→進捗 commit→次起床が checkpoint から再開、2〜4 起床で完走。進捗 commit が attempts をリセットするため枯渇 (E806) しない。既定 30 分 dual (6 セグメント = 180〜360 秒) も同機構で吸収 |

### 5.5 モジュール間の状態整合規則 (00-overview §6.2 の telephony 行の詳細)

| 規則 | 内容 |
|---|---|
| 通話 → 顧客 | 曖昧一致 (同番号複数顧客) は自動確定しない (E823 → match_status='ambiguous' → 手動確認 UI §8.2)。**顧客の自動作成 (created) は電話番号のみの lead** (email null 可 — crm の zCustomerInput refine は tel があれば通る) |
| 通話 → タイムライン | activity 'call' の冪等キーは (call, 'calls', calls.id)。**再実行しても二重掲載なし** (created:false)。ambiguous/no_number は activity を作らない (リンク先が確定しないため — 手動紐づけ時に作成) |
| 通話 → タスク | createTask は **source_activity_id 非 NULL 時 DB 冪等** (07-delta 裁定 #10: tasks の (source_activity_id, title) 一意 — 再送は既存 task_id)。matched/created 経路は activity_id を source_activity_id に渡すため**再実行安全 (重複根絶)** — worker は created フラグ等でスキップせず常に createTask を再実行する (§6.5.4-4)。**ambiguous/no_number 経路 (source_activity_id null) のみ** DB 冪等の対象外で、link_result commit 前のクラッシュ再入で重複があり得る (残余リスク — 重複時は admin が削除。§10-14 / §15 R3) |
| 実行系 | at-least-once + 冪等 commit (§3.1.4 準拠)。**結果不明の外部操作は「録音 DL (再実行安全)」「Twilio 録音削除 (冪等 DELETE)」のみ**で、カレンダー push (E724) のような手動照合対象なし |

---

## 6. 通話フロー詳細 (中核機能)

### 6.1 着信 webhook — POST /api/telephony/voice (15 秒制約)

```
Twilio ──POST (application/x-www-form-urlencoded)──► /api/telephony/voice[?step=...]
route の処理順 (この順序は不変):
 1. isTwilioConfigured() でなければ 503 (KMB-E802。TwiML を返さない → Twilio が Fallback URL へ)
 2. rawBody = await request.text() → URLSearchParams で parse。全パラメータを Record<string,string> 化
    (空値パラメータも脱落させない — 署名検証の頻出バグ。ext-twilio §5.1)
 3. 検証 URL = `${env.NEXT_PUBLIC_SITE_URL}${pathname}${search}` の固定組み立て
    (request.url は Vercel プロキシで http/内部ホストになるため使用禁止)
 4. twilio.validateRequest(TWILIO_AUTH_TOKEN, X-Twilio-Signature, 検証URL, params)
    → 不一致: 403 + KMB-E801 (console.error。body なし)
 5. 契約 parse の共通則 (status/recording-status も同一): 署名検証後、Record 全体を渡さず
    **契約キーのみを pick し、欠落キーは null 補完**してから Zod parse する。
    実 Twilio POST は AccountSid/ApiVersion/Direction/RecordingSource 等 10+ の未契約パラメータを
    含むため、.strict() 契約に生 params を渡すと unrecognized_keys で全 webhook が KMB-E803 になる。
    欠落キー (busy/no-answer の DialCallDuration 等) は null 補完 + 契約側 preprocess で吸収 (§3.2)
 6. step 分岐 (下表) → facade 呼び出し → TwiML を Content-Type: text/xml で 200 応答
[時間予算] cold start 込みで 15 秒以内。同期処理は「calls UPSERT (1 query) +
 settings read (2 query: business_hours / telephony) + TwiML 文字列生成」のみ。
 AI・録音 DL・CRM 連携は一切行わない (裁定 J3)
```

| step (query) | 契約 | facade | 応答 TwiML |
|---|---|---|---|
| (なし) = root | zInboundCallWebhook | `handleInboundCall(input, {mode:'service'})` | §6.2 の分岐 |
| `?step=dial_result` | zDialResultWebhook | 契約外拡張 `handleDialResult(input, ctx)` (§7.2) | completed/answered → `<Hangup/>` / それ以外 → 留守電 TwiML (§6.2-c) |
| `?step=recorded` | (CallSid のみ利用) | 契約外拡張 `handleRecorded(input, ctx)` | `<Say>ありがとうございました。失礼いたします。</Say><Hangup/>` |

- step を同一ルートのクエリで表現する理由: 00-overview §5.3 のエンドポイント一覧 (voice/status/recording-status の 3 本) を増やさない。クエリは署名検証 URL に含まれるため検証と両立する (Twilio は action URL のクエリを保持して署名する)
- `handleInboundCall` の内部: (1) `From` を `normalizeJpPhoneToE164()` — 失敗時 from_e164=null (2) calls UPSERT `on conflict (call_sid) do nothing` + 既存行取得 (Twilio の同一リクエスト再送で冪等) (3) `settingsFacade.get("business_hours", ctx)` / `get("telephony", ctx)` — **service ctx で read** (telephony キーは anon 非可読 — §4.6 / 07-delta §D5/D8)。**未設定 (KMB-E901) は既定値へ degrade** (business_hours 未設定 = 常に営業時間内 / telephony 未設定 = 転送なし・同意 ON・既定文言・120 秒。= ゼロ設定でも §0.3 の留守電が成立) (4) JST 判定 (§6.2) (5) handling 確定分 (voicemail / after_hours_voicemail) を calls に反映 (6) TwiML 文字列を返す
- 失敗時の応答方針: 署名 OK 後の内部エラー (DB 断等) は **500 を返す** → Twilio が Fallback URL (§6.7) の静的 TwiML を再生 (無音切断を防ぐ)

### 6.2 TwiML 仕様 (internal/twiml.ts — 純関数、単体テスト `telephony-twiml`)

**(a) 営業時間内 + 転送先あり (forwarded 経路)**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <!-- consent_announcement_enabled=true のとき (既定文言。★文言は堀さん確認 4 — settings で差替可) -->
  <Say language="ja-JP">お電話ありがとうございます。品質向上のため、この通話は録音されます。</Say>
  <Dial record="record-from-answer-dual"
        recordingStatusCallback="{BASE}/api/telephony/recording-status"
        recordingStatusCallbackEvent="completed"
        timeout="20"
        action="{BASE}/api/telephony/voice?step=dial_result" method="POST">
    <Number>{settings.telephony.forward_to_e164}</Number>
  </Dial>
</Response>
```

- `record-from-answer-dual`: 応答時点からデュアルチャネル録音 (ch0=発信者/ch1=応答側 — zCallTranscript の channel 意味論と 1:1)
- `action` 必須: Dial 終了後に Twilio が dial_result を POST し、**このレスポンスで通話の続きが決まる** (completed → Hangup / 不成立 → 留守電へフォールバック)。action を省略すると document 続行の曖昧さが残るため省略しない
- `timeout="20"`: 20 秒無応答で不成立 → 留守電へ

**(b) 営業時間内 + 転送先なし (voicemail 経路) / (c) dial_result 不成立フォールバック**

```xml
<Response>
  <Say language="ja-JP">お電話ありがとうございます。{同意アナウンス (ON 時)}
    ただいま作業中のため電話に出られません。ご用件を発信音のあとにお話しください。</Say>
  <Record maxLength="{voicemail_max_seconds}" playBeep="true" finishOnKey="#"
          recordingStatusCallback="{BASE}/api/telephony/recording-status"
          recordingStatusCallbackEvent="completed"
          action="{BASE}/api/telephony/voice?step=recorded" method="POST"/>
  <Say language="ja-JP">録音を確認できませんでした。失礼いたします。</Say>
</Response>
```

**(b)/(c) の差分 (v1.1 明確化)**: (c) dial_result 不成立フォールバックは (b) と同型だが**同意アナウンスを含めない** — root の (a) で consent `<Say>` を再生済みのため、(b) と共用すると発信者が同意文言を 2 回聞くことになる。twiml.ts の純関数は `fromDialFallback` フラグで分岐し、(c) は「ただいま電話に出られません。ご用件を発信音のあとにお話しください」のみ (単体テスト対象 — §12.1)。

**(d) 営業時間外 (after_hours_voicemail 経路)** — (b) と同型で導入文言のみ `after_hours_greeting_text` (既定: 「本日の営業は終了しました。ご用件を発信音のあとにお話しください。翌営業日にご連絡いたします。」)。

**営業時間の JST 判定** (`internal/business-hours.ts` — 純関数):

1. `now` を Asia/Tokyo へ変換 (`Intl.DateTimeFormat` ベース。ライブラリ追加なし)
2. `business_hours.holidays` (zDateOnly 配列) に当日 (JST) が含まれる → 時間外
3. 当曜日の `zDayHours` が null → 終日休み → 時間外
4. `open <= HH:MM < close` (文字列比較で安全 — "09:00" 形式は辞書順=時刻順)。**close が open 以下の設定 (深夜跨ぎ) は zBusinessHoursSettings では表現不能のため「時間外」に倒す** (塗装工房に深夜営業はない。制約として §10-16 に明記)
5. business_hours 未設定 → 常に時間内 (§6.1 degrade)

境界規約: open ちょうどは時間内、close ちょうどは時間外 (半開区間 `[open, close)`)。単体テストの境界値対象。

### 6.3 通話終了 — POST /api/telephony/status

```
zCallStatusWebhook parse → handleCallStatus(input, {mode:'service'}):
 1. call_sid で calls を検索。無ければ KMB-E804 を console.error し 200 応答
    (Twilio に 4xx/5xx を返しても意味がない — 業務エラーは吸収する)
 2. twilio_status / duration_seconds / ended_at (終了系イベント時 now()) を更新
 3. handling 確定: handling が null のまま終了 (root 応答後すぐ切断) → 'missed'。
    handling='voicemail'/'after_hours_voicemail' で終了 → そのまま (録音有無は問わない —
    録音なし留守電も「かかってきた事実」として一覧に残る)
 4. twilio_cost_estimate_micro_usd = estimateTwilioCostMicroUsd(duration, handling, 録音分)
    (internal/cost.ts — TWILIO_RATES_MICRO_USD_PER_MIN。分単位切り上げ。単体テスト対象)
```

Twilio の番号設定で statusCallback (completed イベント) を /api/telephony/status に向ける (運用手順 §13.1)。

### 6.4 録音完了 — POST /api/telephony/recording-status

```
zRecordingWebhook parse → registerRecording(input, {mode:'service'}):
 1. call_sid で calls を検索。無ければ最小行を defensive INSERT (call_sid/to_e164='unknown'
    相当ではなく webhook の To が無いので from/to 不明のプレースホルダ行。発生は理論上のみ —
    voice webhook が先行しなかった場合の防御。KMB-E804 を warning ログ)
 2. call_recordings INSERT (recording_sid unique)。conflict → 既存行 (webhook 再配信の冪等)
    source は RecordingChannels で判定 (2ch='dial' / 1ch='voicemail')
 3. call_jobs INSERT — status は RecordingDuration で分岐する単一規則 (v1.1 是正: 「ジョブを作らない」
    案は D8 契約 Result<{call_job_id}> を満たせないため廃止。§7.1/§10-9 と完全一致):
      - RecordingDuration = 0 (ビープ前切断等) → **status='done' の「空 done ジョブ」を INSERT**
        (transcript/analysis null のまま終端。転写対象なし。一覧は「録音なし」表示)
      - RecordingDuration > 0 → status='pending' で INSERT
 4. unique (recording_id) conflict → 既存 job を返す (冪等。既存行の status は書き換えない)
 5. 200 応答 { call_job_id } (Twilio は body を見ないが監査ログに残る)
処理は 2 INSERT のみ (即応答。202+after は不要)。録音 DL はここでやらない (worker の仕事)
```

recordingStatusCallbackEvent は "completed" のみ購読 (TwiML 属性で明示 — §6.2)。in-progress/absent は届かない。

### 6.5 ステージ実装仕様 (internal/worker.ts — advanceCallJob の実体)

worker 共通則: `advanceCallJob(jobId, {mode:'service'})` は **1 呼び出し = 1 ステージ**。`call_job_acquire_lease` → result_kind 分岐 (held/terminal/exhausted/not_found は即 return) → ステージ実行 (20 秒毎 heartbeat) → `call_job_commit_stage` (CAS)。ステージ内の**確定エラー**は commit(next='failed', error_code) で即終了、**不確定エラー** (ネットワーク断等) は throw せず return (lease 失効 → attempts 経由で再試行 → 3 回で E806)。

#### 6.5.1 downloading

1. **再入ガード**: call_recordings.storage_path が非 null なら DL をスキップして commit のみ (前回クラッシュが commit 直前だったケース)
2. `GET {twilio_url}.wav` (Basic 認証 AccountSid:AuthToken、`AbortSignal.timeout(60_000)`)。**.wav 固定** (dual は stereo WAV、voicemail は mono WAV。mp3 は使わない — チャネル分離とセグメント分割を純 TS で行うため §6.5.2)。404 → 確定エラー扱いにせず不確定 return で attempts 再試行 (Twilio 側の録音生成遅延があり得る)。**最終試行の検知 (§5.1 不変条件 8)**: acquire が返した stage_attempts が CALL_JOB_MAX_ATTEMPTS (=3、この試行が最後) のときに再び 404 なら、return して acquire の E806 (原因不明枯渇) に倒すのではなく **worker 自身が commit(next='failed', 'KMB-E805') で確定**させる (E805/E806 の使い分け §9 を成立させる唯一の経路 — worker は 404 回数を保持しないため。§12.1 テスト対象)
3. サイズガード: 200MB 超は KMB-E805 で failed (メモリ保護。8kHz/16bit stereo で約 100 分相当 — 実運用で到達しない)
4. Storage `call-audio/{call_id}/{recording_sid}.wav` へ `upsert:true` で保存 → call_recordings.storage_path/byte_size 更新 (service client 直 UPDATE — 自モジュール所有)
5. 設定 `delete_twilio_recording_after_download=true` なら `DELETE /2010-04-01/.../Recordings/{sid}` — **ベストエフォート** (失敗しても twilio_deleted_at null のまま前進。翌日以降の手動掃除リストは §8.2 に表示しない — ストレージ課金 $0.0005/min/月は微小)
6. commit('downloading' → 'transcribing')

#### 6.5.2 transcribing (セグメント設計)

1. **再入ガード**: transcript 非 null → commit のみ
2. 処理上限: recording.duration_seconds > `telephony.max_processing_minutes × 60` (既定 30 分) → commit(next='failed', 'KMB-E822') (録音は保存済みで再生可能 — AI 処理だけ諦める)
3. Storage から WAV を読み、`internal/segmenter.ts` で分解 (全て純 TS・ffmpeg 不使用):
   - RIFF ヘッダ解析 (fmt チャンク: audioFormat / channels / sampleRate / bitsPerSample)
   - **audioFormat=1 (PCM16) と 7 (μ-law) のみ対応** (Twilio 録音の実フォーマット)。μ-law は 256 エントリ LUT で PCM16 へ展開。それ以外 → KMB-E822 (分割不能)
   - stereo (channels=2) はサンプル・デインターリーブで ch0/ch1 の mono WAV に分離
   - 各チャネルを `SEGMENT_MAX_SECONDS` (600 秒) 窓 + `SEGMENT_OVERLAP_SECONDS` (2 秒) オーバーラップでフレーム境界スライス (mono 8kHz/16bit ≈ 0.96MB/分 → 1 セグメント ≈ 9.6MB ≪ 25MB)。生成後に各セグメントの byte 長を `TRANSCRIBE_MAX_BYTES` で最終ガード (超過は理論上ないが防御。超過 → E822)
   - **短い録音 (≤ 600 秒) はチャネル分離のみで無分割 1 セグメント** — 大半の通話はこの経路
4. セグメント直列で `aiProvidersFacade.transcribe({ feature: 'call-transcribe', filename: '{recording_sid}-c{ch}-s{idx}.wav', audioBase64, prompt: TERMINOLOGY_PROMPT, refTable: 'call_jobs', refId: jobId }, { mode: 'service' })` — **チェックポイント + 残余時間ガードつき** (00-overview §3.1.4-8。長録音が maxDuration 300 秒に収まらないため 1 起床で完結させない):
   - **(a) 再開カーソル**: ステージ冒頭に transcript_partial (zCallTranscriptCheckpoint) を repository で読み、(channel, index) が記録済みのセグメントはスキップ (転写済み成果と settle 済みコストを保全。再試行での二重課金を排除)
   - **(b) セグメント毎チェックポイント**: 1 セグメント完了ごとに transcript_partial へ追記 (lease 保持中の service 直接 UPDATE — heartbeat 同型。commit RPC は使わない)。クラッシュで失うのは処理中の 1 セグメント分のみ
   - **(c) 残余時間ガード**: 次セグメント開始前に「起床時からの経過 + TRANSCRIBE_SEGMENT_WORST_MS (60 秒) > TELEPHONY_WAKE_SOFT_BUDGET_MS (240 秒)」なら打ち切り、**進捗 commit** `commit_stage(expected='transcribing', next='transcribing', ai_cost_delta=この起床分)` で attempts リセット + lease 解放して return (次の起床が (a) から再開 — §5.1 不変条件 7)。この起床で新規セグメントが 1 本も完了していなければ進捗 commit せず return (attempts 消費)
   - **予算予約はセグメント毎に router 内で自動実行** (reserve TTL 10 分に対し 1 セグメント転写 ≈ 30-60 秒 — §5.4 要件 7)
   - E407 (予算超過) → commit(next='failed', 'KMB-E407') 即終了 (retry で翌月再実行可 — 00-overview §4.3。checkpoint 済みセグメントは retry 後も (a) で再利用される)
   - E408 (全キー失敗) → 不確定扱いで return (attempts 再試行)。3 回で E806
   - その他の転写失敗 → **KMB-E820 に変換**して 1 セグメント 1 回だけ再試行、それでも失敗なら commit failed('KMB-E820')
5. 全セグメント完了 → zCallTranscript 組み立て (checkpoint から): segments = [{channel, index, text}] (チャネル 0 → 1、index 昇順)、full_text = 時系列に「相手:」「こちら:」ラベルを付けず**チャネル順連結** (v1 は発話タイムスタンプを持たないため時系列交互整列はしない — 議事録 AI にはチャネル別全文で十分。制約として §11 に明記)。オーバーラップ境界の重複文言はそのまま (AI 側が吸収)
6. zCallTranscript.parse → commit('transcribing' → 'analyzing', transcript, ai_cost_delta=この起床分の Σ costMicroUsd)。transcript_partial は残置可 (以後参照されない。call_jobs.ai_cost の表示キャッシュはチェックポイント〜commit 間のクラッシュで僅かに欠け得るが、正は ai_usage_log — §6.6)

#### 6.5.3 analyzing

1. **再入ガード**: analysis 非 null → commit のみ
2. `generateText` (runStructured 4 点セット — ai-pipeline §5.1 の実証パターン):

```ts
const result = await aiProvidersFacade.generateText({
  // model 省略 = 管理画面で登録した最優先キーの default_model (キー未登録時は env フォールバック)
  feature: "call-analysis",
  system: CALL_ANALYSIS_SYSTEM_PROMPT, // 塗装工房の電話番。要約は敬体・固有名詞は転写のまま等。
    // 実運用の出力上限を prompt で指示: summary ≤ 400 字・key_points ≤ 8 件・tasks ≤ 5 件
    // (zCallAnalysis のスキーマ上限 ≈ 2 万字は防御的上限であり、生成目標ではない)
  messages: [{ role: "user", content: buildAnalysisPrompt(transcript, callMeta) }],
    // transcript.full_text は先頭 50_000 字に切り詰め (長大入力の暴走防止)。
    // callMeta = 通話日時 (JST)・handling・通話時間・発信番号の有無
  maxTokens: 8_000, // v1.1: 4_000 から引き上げ。prompt 上限 (上記) の実出力 ≪ 8_000 で、
    // 長話でも打切り (stopReason='max_tokens' → JSON 不完全 → E821 系統失敗) を起こさない余裕を持つ
  responseSchema: { name: "call_analysis", schema: z.toJSONSchema(zCallAnalysis) },
  refTable: "call_jobs",
  refId: jobId,
}, { mode: "service" });
```

3. 後処理 4 点セット: `!ok` → E407 は即 failed / E408 は不確定 return / `stopReason === 'refusal'` → **KMB-E821 で failed** (E403 のドメイン変換 — error_code に 'KMB-E821' を保存し detail に refusal を記録) / `stopReason === 'max_tokens'` (打切り) または JSON.parse 失敗・zCallAnalysis.safeParse 失敗 → **1 回だけ再生成**、再失敗で KMB-E821 failed (detail に stopReason を記録)
4. commit('analyzing' → 'linking', analysis, ai_cost_delta)

#### 6.5.4 linking (CrmFacade 経由 — 顧客マッチ / タスク / タイムライン)

1. **再入ガード**: link_result 非 null → commit のみ
2. 顧客マッチ (calls.from_e164 を使用):
   - from_e164 null → outcome='no_number'。activity/顧客作成なし。calls.match_status='no_number'
   - `CrmFacade.matchCustomerByPhone(from_e164, {mode:'service'})`
     - ok + 非 null → outcome='matched'、customer_id 確定
     - ok + null (一致なし) → `CrmFacade.createCustomer({ kind:'person', name: analysis.minutes.customer_name_guess ?? '電話のお客様 ' + 下4桁, tel_e164: from_e164, email: null, lifecycle:'lead', source:'phone', ... }, { force: true }, { mode: 'service' })` — force は「電話番号一致なし」を既に確認済みのため dedup 再判定不要。第 3 引数 ctx は 07-delta v1.1 (裁定 #3) で追加された契約 (worker は service 文脈)。outcome='created'
     - `KMB-E601` (複数一致 — crm 所有コード。01-crm §7.3: detail に候補 id 列挙) → **telephony が KMB-E823 へドメイン変換** (§9 変換表) して outcome='ambiguous'。**自動確定しない** (裁定準拠)。warning に detail 要約。calls.match_status='ambiguous' → §8.2 の手動確認 UI へ。E601 を不確定扱い (手順 7) に落とさないこと — 落とすと同番号複数顧客 (§10-8) の全ジョブが 3 回リトライの末 E806 failed になる
3. タイムライン (matched/created のみ):
   - `CrmFacade.appendActivity({ activity_type:'call', occurred_at: calls.started_at, title: 通話タイトル (§6.6), body: summary + コスト付記 (§6.6), payload: zCallActivityPayload 形 { call_id, direction:'inbound', duration_seconds, has_recording:true, summary: minutes.summary (2000 字切詰) }, ref_table:'calls', ref_id: calls.id, links:[{ customer_id, company_id:null, deal_id:null }] }, { mode:'service' })`
   - **duration_seconds の fallback (v1.1)**: zCallActivityPayload.duration_seconds は非 null 必須 (07-delta §4.10) だが calls.duration_seconds は nullable (statusCallback 未設定/未達のまま linking に到達し得る)。null 時は**録音 duration_seconds の合計で代替し、それも無ければ 0** (毎回 E604 → 3 回 → E806 の恒久失敗を防ぐ。「ゼロ設定でも壊れない」§1.4 の担保)
   - 冪等: 再実行は created:false で既存 activity_id が返る (二重掲載なし)
4. タスク起票 (v1.1 是正 — created:true ガードは廃止):
   - matched/created 経路: analysis.tasks (≤10) を順に `CrmFacade.createTask({ title, body: detail + (due_hint ? '(期日ヒント: ...)' : ''), due_on: null, deal_id: null, customer_id (matched/created 時), origin:'ai_call', source_activity_id: activity_id }, { mode:'service' })` を**常に再実行する** — 冪等は DB が担う (07-delta 裁定 #10 + v1.5: tasks の (source_activity_id, title) 一意 index (非部分一意・NULLS DISTINCT) で再送は既存 task_id が返る)。title は analyzing で commit 済みの analysis.tasks から取るためリトライ間で安定 (D8 の「非決定生成 title は先に永続化」前提を満たす)。activity 先行 → createTask の順序 (source_activity_id の取得に必須 — 07-delta §7.5) は不変。v1.0 の「activity created:true のときのみ起票」ガードは、appendActivity 成功後・createTask 完走前のクラッシュ (lease 失効 / maxDuration 打切り) で再入時 created:false となり**残りタスクが恒久喪失する at-most-once 化**のため廃止
   - ambiguous/no_number でもタスクは起票する (customer_id null・source_activity_id null。折り返し漏れの方が重罪) — この経路は source_activity_id null のため **DB 冪等の対象外** (NULLS DISTINCT — NULL キー行は互いに衝突しない = 常に新規)。再入ガードは link_result 有無のみで、link_result commit 前のクラッシュ再入では重複起票があり得る (残余リスク — §5.5 / §15 R3)
5. calls 反映 (service client): customer_id / match_status / ai_cost_micro_usd (call_jobs の累計を合算転記)
   - **手動確定の保護ガード (v1.1 — §5.2.2 不変条件)**: 反映前に現在値を確認し、`calls.match_status='manual'` (または customer_id 既設定かつ match_status が pending 以外) の場合は customer_id / match_status への反映を**スキップ**し link_result.warning にその旨を記録する (ai_cost の転記のみ行う)。E407 failed → admin 手動紐づけ → retry 再走 (§9) や同一通話 2 ジョブ (§10-15) で、worker の自動結果が admin の手動確定を上書きする事故を防ぐ (manual からの自動遷移は §5.2.2 に存在しない)
6. zCallJobLinkResult 組み立て → commit('linking' → 'done', link_result)
7. CrmFacade 呼び出しの失敗 (E603 等) → 不確定 return (attempts 再試行 → E806)。**顧客/タスク側の部分成功は再入ガードが吸収**

### 6.6 コスト記録 (通話コスト概算の activity 付記)

- activity の title: `電話 (着信) {顧客名 or 番号下4桁 or 番号非通知} {M分S秒}` (zShortText(120) 内)
- activity の body (payload ではなく本文 — zCallActivityPayload は canonical 固定のため拡張しない):

```
{minutes.summary}

— 要点 —
・{key_points 箇条書き}

（概算コスト: 約 ¥{(twilio_cost_estimate + ai_cost) × 150 / 1_000_000 を四捨五入} / 通話 {M分S秒}・AI 処理込み。請求確定額ではありません）
```

- calls.twilio_cost_estimate_micro_usd (§6.3) + calls.ai_cost_micro_usd (linking で合算転記) が数値の源泉。/admin/calls 詳細にも µUSD ベースの内訳を表示 (§8.2)
- AI コストの**確定記録は ai_usage_log** (router 内蔵 — feature 'call-transcribe' / 'call-analysis' で /admin/costs に自動集計)。本モジュールの列は表示用キャッシュであり、正は ai_usage_log (ref_table='call_jobs' で逆引き可能)

### 6.7 Fallback URL・障害時運用

| 障害 | 挙動 |
|---|---|
| voice webhook が 15 秒超過 / 5xx / 503 (env 未設定) | Twilio が番号設定の **Voice Fallback URL** を呼ぶ → 静的 TwiML Bin (Twilio コンソール管理): `<Response><Say language="ja-JP">ただいま電話が大変混み合っております。恐れ入りますが、しばらくたってからおかけ直しください。</Say></Response>`。**Fallback URL の設定は受入基準 T9** (§13.2) |
| recording-status の取りこぼし | Twilio は recording callback を限定リトライ。取りこぼした録音は「calls 行はあるが録音なし」として残る。日次の突き合わせ (Twilio Recordings List API) は v1 スコープ外 (§15 R4) |
| worker 停止 (JOBS_SECRET 未設定等) | ジョブは pending のまま滞留。ダッシュボード警告 (§8.4: 「30 分以上未処理の通話ジョブ N 件」) で検知 |
| Vercel リージョン障害 | 電話自体は Twilio 網で完結 (Fallback TwiML)。録音は Twilio 側に残る (削除は DL 後のみ) ため復旧後に worker が追い付く |

---

## 7. facade / Server Actions / API route / ジョブ仕様

### 7.1 TelephonyFacade (契約メソッド — 07-contracts-delta §D8 の写経 + エラー全列挙)

シグネチャは D8 が canonical (変更禁止)。戻り値は全て `Result<T>`。

```ts
export interface TelephonyFacade {
  handleInboundCall(input: InboundCallWebhook, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
  handleCallStatus(input: { CallSid: string; CallStatus: string; CallDuration: number | null },
    ctx: ExecutionContext): Promise<Result<void>>;
  registerRecording(input: RecordingWebhook, ctx: ExecutionContext):
    Promise<Result<{ call_job_id: string }>>;
  advanceCallJob(callJobId: string, ctx: ExecutionContext):
    Promise<Result<{ status: CallJobStatus }>>;
  retryCallJob(callJobId: string): Promise<Result<void>>;
  createRecordingPlaybackUrl(recordingId: string): Promise<Result<{ url: string; expires_at: string }>>;
}
```

| メソッド | 正常値 | 返し得るエラー (全列挙) | 備考 |
|---|---|---|---|
| handleInboundCall | { twiml } | **KMB-E802** (env 未設定 — route が 503 化) / **KMB-E803** (Zod 不一致) / **KMB-E901** (DB 断。route は 500 → Fallback) | 署名検証は route 責務 (E801 は facade に届かない)。settings 未設定は degrade しエラーにしない (§6.1) |
| handleCallStatus | void | E803 / **E804** (CallSid 不明 — route は 200 で吸収) / E901 | |
| registerRecording | { call_job_id } | E803 / **E805** (INSERT 失敗) / E901 | duration=0 は **status='done' の「空 done ジョブ」を 1 行 INSERT して call_job_id を返す** (§6.4-3 と同一規則。transcript/analysis null のまま done。一覧で「録音なし」表示 — §10-9)。D8 契約 `Result<{call_job_id}>` を常に満たす |
| advanceCallJob | { status } (commit 後の現在値) | **E806** (attempts 枯渇 — acquire が failed 化した直後の呼出応答) / **E804** (job 不明) / ステージ確定失敗は ok (status:'failed') で返る (error_code は行に記録) / E901 | held/terminal は ok (現在 status) — エラーにしない (worker が次を拾う) |
| retryCallJob | void | **E807** (failed 以外) / E804 (不存在 — RPC 例外を E807 と区別して変換) / E201/E202 (session 必須) | admin セッション専用 (ctx なし) |
| createRecordingPlaybackUrl | { url, expires_at } (TTL 10 分) | **E805** (storage_path null = 未 DL / 署名発行失敗) / E804 (recording 不明) / E201/E202 | requireAdmin → service client で createSignedUrl |

透過コード: AI 系の KMB-E407/E408 は facade 戻り値には現れない (worker がジョブの error_code に記録し、advanceCallJob は ok を返す)。画面は call_jobs.error_code を表示する。

### 7.2 契約外拡張 (facade.ts 内に「契約外拡張」コメント必須。他モジュールからの呼び出し禁止)

```ts
// ---- 契約外拡張 (admin UI / webhook 専用。04-telephony.md §7.2) ----
handleDialResult(input: DialResultWebhook, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
  // dial_result step (§6.1)。handling 確定 (forwarded / voicemail フォールバック)。E803/E804/E901
handleRecorded(input: { CallSid: string }, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
  // recorded step。お礼 + Hangup の固定 TwiML。E901
listCalls(input: { cursor: string | null; filter?: { handling?: CallHandling; needsReview?: boolean;
  jobFailed?: boolean } }): Promise<Result<Paged<CallListItem>>>;
  // keyset (started_at desc, id desc)。needsReview = match_status='ambiguous'。E201/E202/E901
getCallDetail(callId: string): Promise<Result<CallDetail>>;
  // calls + recordings + jobs (transcript/analysis/link_result parse 済み) の集約読み。E804/E201/E202
linkCallToCustomer(callId: string, customerId: string | null, expectedUpdatedAt: string):
  Promise<Result<void>>;
  // 手動紐づけ/付け替え/解除。楽観排他 updated_at 生文字列 (不一致 KMB-E103)。
  // customerId 非 null: calls.customer_id/match_status='manual' 更新 + appendActivity('call') (冪等) —
  //   ambiguous/no_number からの確定は appendActivity が新規作成 (created:true) して完結。
  //   **付け替え** (既存 activity あり = created:false) は appendActivity だけでは activity_links が
  //   旧顧客を指したままになる (冪等キー一致で links 更新はスキップされる — 01-crm §6.6) ため、
  //   続けて CrmFacade.relinkActivity(activity_id, [{customer_id, company_id:null, deal_id:null}])
  //   (07-delta v1.6 追加契約) で links を新顧客へ張り替える。E603 (顧客不存在 — crm から透過)
  // customerId null: 紐づけ解除 — match_status='manual' のまま customer_id null 化
  //   (§5.2.2 不変条件 v1.1: manual は customer_id null 可 = 「手動介入済み・未紐づけ」)。
  //   'call' activity が存在する場合は relinkActivity(activity_id, []) でリンクも全解除
  //   (誤マッチの通話が旧顧客のタイムラインに残り続けるのを防ぐ。activity 本体は不変 — crm 規約)
getTelephonySetupStatus(): Promise<Result<{ envConfigured: boolean; numberConfigured: boolean;
  forwardConfigured: boolean; staleJobs: number }>>;
  // 設定画面/バナー用 (E802 degrade 表示の判定素材)。staleJobs = 非終端 call_jobs のうち
  // created_at < now()-30min の滞留件数 (§8.4 と同一 query — getCallAlertCounts の stalled を流用)。
  // v1.0 の cronAlive (直近 10 分の worker 実行痕跡) は判定材料が存在しないため廃止 —
  // ジョブ 0 件の平常時に worker は痕跡を残さず (due 0 件なら DB 無書込 §7.3)、
  // cron 死活そのものは検知できない。名称も「滞留なし」の意味論に改めた
getCallAlertCounts(): Promise<Result<{ failed: number; needsReview: number; stalled: number }>>;
  // ダッシュボード集計 (§8.4)。failed = call_jobs.status='failed' 件数 / needsReview =
  // calls.match_status='ambiguous' 件数 / stalled = 非終端 + created_at < now()-30min 件数。
  // 呼び出し元は /admin ホーム (crm フェーズの app 層) — 拡張規約適合 (他モジュール facade からは呼ばない)。
  // E201/E202/E901
```

`CallDetail` は読み取りビュー型 (TypeScript type — Zod 化しない。§4.9 既存規約)。

### 7.3 route handler 仕様 (一覧)

| route | maxDuration | 実装骨子 |
|---|---|---|
| POST /api/telephony/voice | 30 | §6.1 の 6 手順。**同期応答** (after 不使用 — TwiML が応答本体) |
| POST /api/telephony/status | 30 | 署名検証 → handleCallStatus → 常に 200 (`<Response/>` 空 TwiML)。E804 は console.warn |
| POST /api/telephony/recording-status | 60 | 署名検証 → registerRecording → 200 JSON。同期 (2 INSERT のみ) |
| POST /api/jobs/telephony | 300 | 既存 /api/jobs/publish と完全同型: `isJobsSecretConfigured()` 503 → x-jobs-secret 401 → **202 + after()** で本体: due ジョブを最大 2 件選定 (`status in (非終端) and (lease null or 失効)` を created_at 昇順) → 各 job へ `advanceCallJob(id, {mode:'service'})` を**直列**実行 (同時 AI 呼び出しの予算競合を避ける)。**残余予算ガード (00-overview §3.1.4-8)**: 2 件目の開始前に経過時間を確認し、残余が 1 ステージの最悪想定を下回る場合は処理せず次起床へ持ち越す (**lease 取得前に判定するため stage_attempts に計上されない**)。例外は KMB-E901 console.error |

処理レイテンシの設計値: 1 ジョブ = 4 ステージ、毎分起床 × 1 ステージ/起床 → **通話終了から議事録・タスクまで約 4〜6 分** (§0.2 の「昼休みに見ると揃っている」を満たす。即時性が要る場合の advance 連打は不採用 — J2)。

### 7.4 Server Actions (`src/app/admin/calls/actions.ts` — 全て先頭 requireAdmin + Zod parse)

| action | 入力 | 呼び先 | エラー表示 |
|---|---|---|---|
| retryCallJobAction | { callJobId: uuid } | TelephonyFacade.retryCallJob | E807 → 「完了/処理中のジョブは再実行できません」トースト |
| createPlaybackUrlAction | { recordingId: uuid } | createRecordingPlaybackUrl | E805 → 「音声の準備ができていません (ダウンロード前)」 |
| linkCallToCustomerAction | { callId, customerId nullable, expectedUpdatedAt } | linkCallToCustomer | E103 → 再読込提示 / E603 → 顧客再選択 |
| searchCustomersForLinkAction | { query } | CrmFacade (顧客検索 — crm の契約外拡張を app 層から利用) | — |
| saveTelephonySettingsAction / saveBusinessHoursAction | zTelephonySettings / zBusinessHoursSettings + expectedUpdatedAt。**電話番号 2 欄 (phone_number_e164 / forward_to_e164) は action 冒頭で `normalizeJpPhoneToE164()` を通してから parse する** (00-overview §M0 の正規化規約。zTelE164 は +81 形式のみ受理のため「090-1234-5678」等の国内表記を直 parse すると弾かれる)。正規化不能時は「0X0-XXXX-XXXX の形式で入力してください」のフィールドエラー | SettingsFacade.update (所有 settings — telephony フェーズで実装するが書込先は settings) | E103 楽観排他 |

### 7.5 イベント表 (07-contracts-delta §D9 該当行の参照)

`telephony.call.inbound` / `telephony.recording.ready` / `telephony.job.due` の 3 行 (D9 canonical)。本書は行を追加しない。

---

## 8. 管理画面 UI 仕様

### 8.1 /admin/calls — 通話一覧

- **構成**: PageHeader (「通話」+ セットアップ状態バッジ) / フィルタ行 / DataTable (keyset 50 件 + 「さらに読み込む」) 。env 未設定時は Surface で degrade バナー「電話連携は未設定です。設定手順を見る →」(E802。既存の接続カード UX に準拠)
- **使用部品**: 既存 `src/app/admin/_ui/` の Surface / PageHeader / DataTable / StatusBadge。新規部品: `CallHandlingBadge` (handling 4 種 + 色) / `JobStatusBadge` (7 状態) / `AudioPlayerButton` (署名 URL 遅延取得 → `<audio controls>`)。shadcn 追加は 00-overview §2.4 の共通分 (dropdown-menu / popover / command) を流用し、本モジュール固有の CLI 追加なし
- **列**: 日時 (JST) / 相手 (顧客名リンク or E.164 表示 or 「番号非通知」) / 種別 (CallHandlingBadge) / 通話時間 / 処理状態 (JobStatusBadge + failed は error_code ツールチップ) / 要約冒頭 40 字 / 要確認バッジ (match_status='ambiguous')
- **フィルタ**: 種別 (handling) / 「要確認のみ」(ambiguous) / 「処理失敗のみ」(failed)。URL query に保持
- **キーボード操作** (E2E 必須チェックリスト対象):
  - `↑` `↓` 行フォーカス移動 / `Enter` 詳細を開く / `Esc` 詳細を閉じて一覧へ / `Tab` 論理順 (フィルタ → 表 → ページャ)
  - `r` フォーカス行の failed ジョブを再実行 (確認ダイアログ → Enter 確定 / Esc 取消)
  - `Cmd+S` は本画面では該当なし (保存対象なし — チェックリスト上「N/A (理由: 一覧は読み取り専用)」と記録)

### 8.2 /admin/calls/[id] — 通話詳細

- **構成 (上から)**:
  1. ヘッダ: 日時 / 相手 / handling / 通話時間 / コスト内訳ポップオーバー (Twilio 概算 + AI 実測、µUSD と ¥ 換算・「概算」注記 — §6.6)
  2. 音声プレイヤー: 録音ごとに 1 行 (source バッジ dial/voicemail + 長さ + 再生ボタン)。再生ボタン押下時に createPlaybackUrlAction → `<audio>` へ (TTL 10 分。期限切れは再取得)
  3. 議事録カード: summary / caller_intent バッジ / key_points 箇条書き / callback_required フラグ
  4. 起票タスク: link_result.task_ids から解決した一覧 (crm のタスクへのリンク)。「やること」画面と同じ行部品
  5. **全文タブ / 要約タブ** (差分表示仕様 §11): 全文タブは transcript.segments をチャネルラベル (「相手」「こちら」— voicemail は「相手」のみ) 付きで表示。**併記であり diff ではない**
  6. 顧客紐づけセクション:
     - matched/created/manual (customer_id 非 null): 顧客名 + 顧客ページへのリンク + 「付け替え」「解除」ボタン
     - **manual + customer_id null (解除済み — §5.2.2 v1.1)**: 「手動で紐づけを解除済み」表示 + 顧客検索 (command パレット) で再紐づけ
     - **ambiguous (要確認)**: 警告 Surface「同じ番号の顧客が複数います」+ 候補一覧 (crm 契約外拡張 `listCustomers({ q: from_e164 })` を server action (app 層) 経由で取得 — 候補の鮮度を DB に持たない §5.2.2。**matchCustomerByPhone の error detail 文字列から候補 UI を組み立てない** — detail は人間向け文字列で、候補一覧の契約は listCustomers が担う) + 選択 → linkCallToCustomerAction / 「新しい顧客として作る」
     - no_number: 「番号非通知のため自動紐づけできません」+ 顧客検索 (command パレット) で手動紐づけ
  7. 処理状態フッタ: call_jobs の status タイムライン (4 ステージのステッパー表示) / failed 時は error_code + recovery 文言 (§9) + 「再実行」ボタン
  8. メモ欄 (calls.memo。textarea + 保存 — 楽観排他)
- **キーボード**: `Esc` 一覧へ戻る / `Tab` 論理順 / `Space` 音声再生・停止 (プレイヤーフォーカス時) / `Cmd+S` メモ保存 / 候補選択リストは `↑` `↓` + `Enter`
- 顧客ページ (crm) 側のタイムラインには 'call' activity が並び、activity クリックで本画面へ遷移 (逆リンクは activities.ref_id = calls.id — 01-crm.md の部品)

### 8.3 サイト設定「電話・営業時間」タブ (/admin/settings 内 — 実装は本フェーズ、所有は settings)

- **営業時間** (business_hours): 曜日 7 行 × (営業/休み トグル + open/close の time input) + 臨時休業日 (date-picker で追加 / チップで削除、最大 200)。保存は saveBusinessHoursAction (楽観排他)
- **電話** (telephony): 番号 / 番号 SID / 転送先番号 / 同意アナウンス ON-OFF + 文言 (placeholder に既定文言) / 営業時間内・時間外の留守電文言 / 留守電最大秒数 / 「ダウンロード後に Twilio 側の録音を削除」トグル / AI 処理上限 (分)。番号 2 欄は国内表記で入力可 (placeholder「090-1234-5678 (自動で国際形式に変換されます)」— 保存時に normalizeJpPhoneToE164 §7.4。E.164 手入力は強制しない)
- セットアップチェックリスト表示 (getTelephonySetupStatus): env / 番号 / webhook URL (コピー用に 3 URL を表示) / Fallback URL 案内 / **録音メディアの Basic 認証有効化の案内 (§13.1-5 / T11)** / 処理の滞留 (staleJobs — 30 分超の未処理ジョブ件数。worker 停止の検知)。補助表示: 直近通話の通話時間が空のままの場合「statusCallback 設定 (§13.1-4) を確認してください」の注記 (設定漏れ検知 — §6.5.4-3 fallback の恒常化を防ぐ)。**Twilio コンソールでの設定作業 (webhook URL 貼り付け等) は user 主導**のため、画面に手順を明記する
- **キーボード**: `Tab` 論理順 / `Cmd+S` 保存 / time input は `↑` `↓` で 15 分刻み / `Esc` で未保存変更の破棄確認

### 8.4 ダッシュボード接点 (/admin ホーム — crm フェーズのダッシュボードに行を供給)

| 表示 | 条件 | 遷移先 |
|---|---|---|
| 「処理に失敗した通話 N 件」警告 | call_jobs.status='failed' | /admin/calls?filter=failed |
| 「顧客の確認待ち通話 N 件」 | calls.match_status='ambiguous' | /admin/calls?filter=needsReview |
| 「未処理の通話ジョブが滞留 (30 分超) N 件」 | 非終端 + created_at < now()-30min | 同上 (worker 停止の検知 — §6.7) |

集計 SQL は telephony repository が提供し、facade の契約外拡張 `getCallAlertCounts()` (§7.2 — 戻り値型付き) として公開する。ダッシュボード側 (crm フェーズの /admin ホーム = app 層) はこれを経由して読む。

---

## 9. エラーコード表 (必須章 ③)

採番 canonical は 00-overview §3.3 (KMB-E801〜E839 帯 = telephony 所有)。本表はメッセージ/recovery の詳細化 + 帯内追加 1 件 (E807 — §1.5 Δ3、**採用済み・00-overview §3.3 登録済み**)。errors.ts (KMB_ERRORS as const map) への登録文言:

| コード | category | message (admin 表示) | recovery |
|---|---|---|---|
| KMB-E801 | 8xx テレフォニー | 電話サービスからの通知の署名検証に失敗しました。 | 不正リクエストの可能性。頻発時は BASE_URL 設定と Twilio AuthToken の一致を確認 |
| KMB-E802 | 8xx テレフォニー | 電話連携が未設定です。 | 設定画面のセットアップチェックリストに従って env / 番号 / webhook を設定 |
| KMB-E803 | 8xx テレフォニー | 電話サービスからの通知の内容が想定と異なります。 | detail のパラメータ名を確認。Twilio 仕様変更の可能性 → 開発者へ |
| KMB-E804 | 8xx テレフォニー | 対象の通話が見つかりません。 | 画面を再読み込み。webhook の到達順序異常はログで確認 |
| KMB-E805 | 8xx テレフォニー | 録音の取得または保存に失敗しました。 | 自動で最大 3 回再試行されます。失敗が続く場合は Twilio 側の録音有無を確認 |
| KMB-E806 | 8xx テレフォニー | 通話の後処理が 3 回失敗しました。 | 詳細画面の「再実行」で最初からやり直せます。detail の直近エラーを確認 |
| KMB-E807 | 8xx テレフォニー | このジョブは再実行できません (失敗状態のジョブのみ再実行できます)。 | 処理中は完了を待つ。完了済みはやり直し不要 |
| KMB-E820 | 8xx テレフォニー | 文字起こしに失敗しました (分割後の再試行も失敗)。 | 録音は再生できます。「再実行」で再試行、続く場合は録音を聞いて手動でメモ |
| KMB-E821 | 8xx テレフォニー | 議事録の生成結果が不正です (AI 出力が契約と不一致、または生成拒否)。 | 自動再生成 1 回済み。「再実行」で再試行、続く場合は全文タブから手動要約 |
| KMB-E822 | 8xx テレフォニー | 録音が処理上限を超えています (長さ/形式の制約)。 | 録音の再生は可能。上限 (AI 処理する録音長) は設定画面で変更可 |
| KMB-E823 | 8xx テレフォニー | 同じ電話番号の顧客が複数見つかりました。 | 通話詳細の「顧客の確認」から手動で選択 |

変換・透過規則 (worker 内):

| 元コード | 変換先 | 規則 |
|---|---|---|
| KMB-E601 (matchCustomerByPhone 複数一致 — crm 所有コード) | **KMB-E823** | linking §6.5.4-2 のドメイン変換 (01-crm §7.3/P7 と対)。detail (候補 id 列挙) は link_result.warning に要約転記。E601 を不確定扱いに落とさない (§6.5.4-2) |
| KMB-E403 (refusal) / KMB-E404 相当 (JSON/Zod 不一致) / stopReason='max_tokens' (打切り) | **KMB-E821** | analyzing の runStructured 後処理 (§6.5.3)。1 回再生成後に確定。※refusal を E821 に一本化する扱いは 00-overview §3.3 (E821 説明は「JSON/Zod 不一致」のみで §4.5 は「refusal→E403」) と現状ずれており、**00-overview §3.3 E821 の説明に「refusal (E403)・max_tokens 打切りを含む」の追記を canonical 差分として申請する** (admin の recovery が同一「再実行」のため一本化が運用上合理的) → 00 v1.2 で反映済み |
| KMB-E405 相当 (転写失敗) | **KMB-E820** | transcribing (§6.5.2)。セグメント単位 1 回再試行後に確定 |
| KMB-E407 (予算超過) | **透過** (job.error_code='KMB-E407') | 即 failed。retry で翌月再実行可 |
| KMB-E408 (全キー失敗) | 変換しない (不確定扱い) | attempts 経由 → 3 回で KMB-E806 (detail に E408 履歴) |
| KMB-E303 | 使用しない | 25MB 制約は E822 に一本化 (E303 は ai-studio のアップロード文脈用) |

E808〜E819 / E824〜E839 は未使用のまま返上 (帯は telephony 予約継続)。

---

## 10. 全データパターン列挙 (必須章 ⑤)

設計・テストで必ずカバーする現実パターン (00-overview §7 の telephony 該当分 #6/#13/#14 を包含):

| # | パターン | 期待挙動 (検証章) |
|---|---|---|
| 1 | 営業時間内・転送成立 (熊部さんが携帯で応答) | handling='forwarded'、dual 録音 2ch、チャネル分離転写、activity 掲載 (§6.2a/6.5) |
| 2 | 営業時間内・転送呼び出し 20 秒無応答 | dial_result no-answer → 留守電フォールバック、handling='voicemail' (§6.2c) |
| 3 | 営業時間内・転送先未設定 | 即留守電 (§6.2b)。ゼロ設定運用の基本形 |
| 4 | 営業時間外の着信 | after_hours_voicemail + 時間外文言 (§6.2d)。臨時休業日 (holidays) も同経路 |
| 5 | 番号非通知 (From='anonymous') | from_e164 null / match_status='no_number' / activity なし / タスクは起票 (§6.5.4) |
| 6 | 既存顧客と 1 件一致 | matched → calls.customer_id + タイムライン掲載 (§0.4) |
| 7 | 一致なし → 新規リード | created → lifecycle='lead', source='phone', 名前は AI 推測 or 番号下 4 桁 (§6.5.4) |
| 8 | **同番号で複数顧客 (家族・会社代表番号)** | ambiguous (KMB-E823) → 自動確定せず要確認 UI (§8.2)。job は done |
| 9 | 録音 0 秒 (ビープ前切断) / 無言留守電 | duration=0 → 空 done ジョブ (§6.4-3)。無言 (短秒) は転写空文字 → 議事録 summary が「無言の可能性」になる (プロンプトで指示) |
| 10 | webhook 重複配信 (Twilio at-least-once) | call_sid / recording_sid unique + job unique(recording_id) + appendActivity 冪等 — 二重取込なし (§6.1/6.4) |
| 11 | **15 分/25MB 超の長録音** (30 分の長話) | セグメント分割転写 (10 分窓 + 2 秒オーバーラップ §6.5.2)。1 起床に収まらない分は**チェックポイント + 進捗 commit で複数起床にまたがって完走** (§6.5.2-4 / §5.4-8 — maxDuration 300 秒でも E806 に倒れない)。E822 は分割不能 (未知フォーマット) か上限 (既定 30 分) 超過のみ |
| 12 | AI 予算超過中の着信 | 録音・保存は完走、job は E407 failed。翌月 retry で議事録復元可 (§6.5.2) |
| 13 | AI が生成拒否 / 出力不正 | E821 failed。全文タブは見える (転写まで成功していれば) (§6.5.3) |
| 14 | worker クラッシュ後の再開 | lease 失効 → 同ステージ再実行。activity 冪等 / タスクは matched/created 経路 = DB 冪等 (source_activity_id + title 一意) で**重複なし**。**ambiguous/no_number 経路 (source_activity_id null) のみ link_result commit 前クラッシュで重複があり得る** (§5.5 / §15 R3 — admin 削除で対応)。転写は checkpoint 再開 (§6.5.2-4) |
| 15 | 同一通話に録音 2 本 (転送録音 + フォールバック留守電) | call_recordings 2 行・job 2 本。activity は先に linking へ達した job が作成し、後続は created:false (通話 1 = activity 1) (§2.1) |
| 16 | 深夜営業設定 (open > close) | 表現不能 → 時間外扱い (§6.2 判定 4)。設定画面にバリデーション注記 |
| 17 | 未対応録音フォーマット (PCM/μ-law 以外) | segmenter が E822 で failed。録音再生は可能 (§6.5.2-3) |
| 18 | Twilio 側録音削除の失敗 | ベストエフォート — job は前進、twilio_deleted_at null のまま (§6.5.1-5) |

---

## 11. 差分表示仕様 (必須章 ⑩)

00-overview §8 の割当どおり:

| 対象 | 仕様 |
|---|---|
| 議事録 vs 通話全文 | **差分ではなく併記** — 通話詳細 (§8.2) の「要約」「全文」タブ切替。転写原文 (transcript) は不変保存で、議事録の再生成 (retry) をしても全文タブの内容源は transcript のまま。チャネルラベル (相手/こちら) を付けて表示。v1 は発話タイムスタンプを持たないため時系列の交互整列はしない (チャネル別ブロック表示 — §6.5.2-5 の制約明記) |
| その他 (calls/jobs の版間差分) | **該当なし** — 通話・録音・転写は不変の事実記録で版を持たない (編集可能なのは calls.memo と手動紐づけのみで、履歴需要なし — 1 人運用・監査は activities 側で担保)。理由付き「該当なし」は既存 §0.3 前例に従う |

---

## 12. テスト戦略 (必須章 ② — implementer+tester ペア・2 回連続 PASS を可能にする粒度)

00-overview §9.2 の telephony 行 (必須 4 単体 + 結合 2 対象) を包含し、ファイル単位まで具体化する。

### 12.1 単体テスト (Vitest — 実 DB なし)

| テストファイル | 対象 (純関数) | 必須ケース |
|---|---|---|
| `tests/telephony-twiml.test.ts` | internal/twiml.ts | 営業内転送 / 転送なし留守電 / 時間外 / 同意 ON-OFF / 文言 null→既定文言 / **(c) dial フォールバックは同意アナウンスなし (fromDialFallback — §6.2)** / XML エスケープ (文言に `<>&` を含む設定) / callback URL 組み立て (BASE 固定) |
| `tests/telephony-business-hours.test.ts` | internal/business-hours.ts | 曜日 7 種 / open 境界 (時間内) / close 境界 (時間外) / holidays 一致 / null 曜日 / 未設定 degrade / **JST 変換 (UTC 15:00 = JST 翌 00:00 の日付跨ぎ)** / open>close → 時間外 |
| `tests/telephony-signature.test.ts` | internal/twilio-signature.ts + route の URL 組み立て | 正署名 PASS / 改竄 FAIL / 空値パラメータ含み PASS / クエリ付き URL (step=dial_result) / env 未設定分岐 |
| `tests/telephony-segmenter.test.ts` | internal/segmenter.ts | mono PCM 無分割 / stereo デインターリーブ (L/R 既知波形の分離検証) / μ-law LUT 展開 / 10 分窓 + 2 秒オーバーラップの境界フレーム / 25MB 最終ガード / 未知 audioFormat → E822 判定 / 不正 RIFF ヘッダ |
| `tests/telephony-job-stage-machine.test.ts` | internal/stage-machine.ts + internal/lease.ts | nextStatusAfterStage 全遷移 / RPC 生返り値 → 判別共用体変換 (acquired/held/exhausted/terminal/not_found) / 定数値 (TTL 90s・heartbeat 20s・attempts 3) |
| `tests/telephony-cost.test.ts` | internal/cost.ts | 単価表 × handling 3 種 / 分単位切り上げ / 0 秒 / µUSD→¥ 表示換算 (概算注記) |
| `tests/telephony-contracts.test.ts` | contracts.ts | zCallAnalysis の z.toJSONSchema 出力 (nullable → union) / zRecordingWebhook の coerce / **webhook 欠落キー: DialCallDuration 欠落 (busy/no-answer)・CallDuration 欠落 (非終了イベント) → pick + null 補完 + preprocess で parse PASS (§6.1-5/§3.2)** / **余剰パラメータ込みの実 Twilio 形 Record → 契約キー pick 後 parse PASS (.strict() 検証)** / zTelephonySettings 既定・境界 / **国内表記「090-1234-5678」→ normalizeJpPhoneToE164 → zTelE164 PASS・正規化不能はフィールドエラー (§7.4)** / zCallJobLinkResult の outcome×customer_id 整合 refine は持たないことの確認 (repository 検証項目の明示 — §5.2.2 v1.1 の manual 例外含む) |
| `tests/telephony-worker.test.ts` | internal/worker.ts (facade モック + fetch モック) | 各ステージの再入ガード (成果物ありスキップ) / E407 即 failed / E408 不確定 return / refusal・max_tokens→E821 / **E601 受領 → E823 変換 + ambiguous (不確定 return にしない — §6.5.4-2)** / **linking はタスクを常に再実行 (created:false でもスキップしない — §6.5.4-4)** / ambiguous 時 activity なし+タスクあり / **match_status='manual' の行への calls 反映スキップ (手動確定保護 — §6.5.4-5)** / **duration null 時の payload fallback (録音合計 → 0 — §6.5.4-3)** / **transcribing: checkpoint 再開 (partial 済セグメントのスキップ)・残余時間ガードで進捗 commit (同 status)・無進捗 return は commit しない (§6.5.2-4)** / **最終試行 (stage_attempts=3) の 404 → 自ら E805 failed commit (§6.5.1-2)** |

### 12.2 契約 parity (`tests/contracts-ddl-parity.test.ts` へ追加)

- calls.direction / calls.handling / calls.match_status / call_jobs.status / call_recordings.source / call_recordings.channels の DB check ↔ Zod (enum / literal union) 1:1 (zCallRecordingSource / zCallRecordingChannels — §3.2)
- twilio_status が**意図的に check なし**であることの注記 (テスト対象外の明示)

### 12.3 結合テスト (supabase start — 実 DB)

| 対象 | 検証セル |
|---|---|
| call_job_acquire_lease RPC | acquired (pending→downloading bootstrap) / held (lease 保持中) / exhausted (attempts=3 → failed KMB-E806) / terminal (done/failed) / not_found / **anon・authenticated(非 admin) で raise** / service で成功 / admin で成功 |
| call_job_commit_stage RPC | CAS 一致で前進 + attempts=0 + lease null / 不一致 no-op (attempts 不変・成果物不変) / ai_cost 累積加算 / 二重 commit 冪等 |
| call_job_retry RPC | failed→pending / done へは E807 raise / anon 拒否 |
| RLS マトリクス §4.2 全セル | anon/admin/service の 3 クライアントで SELECT/INSERT/UPDATE/DELETE。**admin UPDATE の列限定** (memo は通る / twilio_status 直接更新は permission denied) |
| webhook 冪等 | 同一 voice webhook 2 連投 → calls 1 行 / 同一 recording-status 2 連投 → recordings 1 行 + jobs 1 行 / **duration=0 録音 → status='done' の空ジョブ 1 行 (二重配信でも 1 行 — §6.4-3)** / **status callback: handling='voicemail' のまま終了 (録音未着) → handling 不変 / handling null で終了 → 'missed' (§5.2/§6.3)** |
| appendActivity 統合 (crm と結合) | linking 相当の appendActivity 2 回 → created:false / 'call' payload の二段階 parse |

### 12.4 結合 (API — msw で外部モック。外部 API 実呼び出しは CI 禁止)

- /api/telephony/voice: 署名正/負 (403) / env 未設定 (503) / step 3 分岐の TwiML 応答検証 / **?step=dial_result: busy/no-answer の実 Twilio 形ペイロード (DialCallDuration 欠落 + AccountSid 等の余剰パラメータ込み) → 200 + 留守電フォールバック TwiML (E803 にならないこと — §6.1-5)**
- /api/jobs/telephony: secret 正/負 / 202 応答 / after() 内で最大 2 件処理 (msw で Twilio DL・AI をモック) / **残余予算不足時の 2 件目持ち越し (lease 未取得のまま — §7.3)**
- 録音 DL: Basic 認証ヘッダ / 404 リトライ分類

### 12.5 E2E・本番前 (人が実行)

- Chrome MCP: /admin/calls 一覧→詳細→再生→手動紐づけ→再実行の一巡 + **キーボード全項目 (↑↓/Tab/Enter/Esc/Space/r/Cmd+S — §8 の定義どおり。N/A 項目は理由記録)**
- 実機通話 (C1/C2 解消後): 受入基準 §13.2 の T5〜T8

運用: implementer+tester ペア、修正→再検証ループ、**2 回連続 PASS で完了**。カバレッジ: 契約/状態遷移ガード/segmenter/business-hours は分岐 100%、他 80% 目安。

---

## 13. 移行計画と受入基準 (必須章 ⑦)

### 13.1 移行

**データ移行は該当なし** — 所有 3 テーブルは全て新規で、既存データからの取込元が存在しない (通話履歴は Twilio 契約後にしか発生しない)。既存 contact_inquiries の CRM 取込は 00-overview §14.1 (crm 側) の管轄。

**環境セットアップ手順 (user 主導 + 実装者の運用手順書化が受入対象)**:

1. Twilio Regulatory Bundle 承認 → 050 番号購入 (C1)
2. Vercel env: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (+既存 C2 一式: SUPABASE_SERVICE_ROLE_KEY / JOBS_SECRET / AI キー)
3. migration 0032→0033→0034 を本番 apply (手動 — HANDOFF §3 の運用。0021 適用済み確認が先)
4. Twilio 番号設定: Voice webhook = `{SITE_URL}/api/telephony/voice` (POST) / statusCallback = `/api/telephony/status` / **Fallback URL = 静的 TwiML Bin (§6.7)**
5. **Twilio コンソール Voice 設定で「録音メディア URL の HTTP Basic 認証 (Enforce HTTP Auth on Media URLs)」を有効化 — 本番前必須 (受入基準 T11)**。既定は無効で、RecordingUrl は推測困難だが**未認証で取得可能**な状態が既定 (本書内の「Basic 認証」記述 §6.5.1-2 等はすべて DL 時の API 認証であり、アカウント側の匿名アクセス遮断とは別物)。worker 停止・E805・cron 未設定で Twilio 側に未削除録音が残った際、URL が DB/ログ/Twilio Debugger から漏れても Supabase の認可を通らず録音を取得される経路を遮断する (R8)
6. /admin/settings で営業時間・電話設定を保存 (★同意文言は堀さん確認 4 の結果を反映)

### 13.2 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| T1 | migration 0032〜0034 適用後、RLS マトリクス §4.2 全セルが 3 ロールで期待どおり (列限定 UPDATE 含む) | 結合テスト + 本番 SQL 実測 |
| T2 | call_job_acquire_lease/commit/retry が §12.3 の全分岐で PASS (service/admin/anon) | 結合テスト |
| T3 | 署名検証: 正負・空値パラメータ・step クエリ付きの全ケース PASS | 結合 API テスト |
| T4 | 契約 parity (6 enum — §12.2) PASS + 既存全テストが PASS のまま | CI |
| T5 | 実機: 営業時間内着信→ (転送設定時) 携帯が鳴る / 20 秒無応答→留守電に落ちる | 実機通話 (C1/C2 後) |
| T6 | 実機: 留守電 1 本で「録音再生 + 全文 + 要約 + タスク + タイムライン掲載」が通話終了から 10 分以内に揃う (00-overview A6 と同値) | 実機通話 |
| T7 | 実機: 既知顧客の番号から発信→ matched で顧客ページのタイムラインに載る / 未知番号→ lead 顧客が作られる | 実機通話 |
| T8 | 予算上限を一時的に $0 にして着信→ job が E407 failed になり、上限復元後 retry で done まで完走 | 実機 or ステージング |
| T9 | Fallback URL 設定済みで、/api/telephony/voice を意図的に 503 化しても発信者にアナウンスが流れる | 実機通話 |
| T10 | /admin/calls のキーボードチェックリスト全 PASS (N/A は理由記録) | E2E |
| T11 | Twilio 録音メディアの Basic 認証有効化済み: RecordingUrl への**未認証 GET = 401 / AccountSid:AuthToken の Basic 認証付き GET = 200** を実測 (§13.1-5) | 実機 (C1 後、録音 1 本で確認) |

---

## 14. 規模見積り (必須章 ⑧)

| 区分 | ファイル | 概算行数 (実装+テスト) |
|---|---|---|
| DDL/RPC/cron | migrations 0032/0033/0034 | 550 |
| contracts | telephony/contracts.ts (+settings への zTelephonySettings/zBusinessHoursSettings 配線) | 300 |
| facade/repository | facade.ts / repository.ts | 700 |
| internal | twiml / business-hours / signature / twilio-api / segmenter / stage-machine / lease / cost / worker / prompts | 1,300 |
| routes | telephony×3 + jobs/telephony | 300 |
| 画面 | /admin/calls (一覧/詳細/actions) + 設定タブ 2 面 + ダッシュボード集計 | 1,100 |
| テスト | §12.1〜12.4 (単体 8 + parity + 結合) | 1,600 |
| **計** | | **約 5,850** (00-overview §13 の 〜5,000 に対し +15%: 設定タブ 2 面と segmenter を精査した増分。許容範囲と判断) |

ランニングコスト (月 100 着信 × 5 分・転送なし): 番号 $4.75 + 着信 $5.00 + 録音 $1.25 + 転写 $3.00×2ch=$6.00 (デュアル分離で ext-twilio 試算の 2 倍) + 議事録 ~$0.5 ≈ **$17.5/月 (~¥2,600)**。転送 ON で +$92.5 (支配的 — 設定画面に注記)。AI 分は既存 ops_limits 予算 ($50/月) の枠内で feature 別に /admin/costs へ自動可視化。

---

## 15. リスクと要確認事項

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | Twilio Bundle 審査遅延 / 個人事業で番号不可 (★確認 1) | 本番開始遅延 | 番号非依存設計 (§1.4)。実装・テストは署名モックで完走 (00-overview R1) |
| R2 | 長録音の分割転写品質 (境界の文切れ) | 議事録精度 | 2 秒オーバーラップ + E822 degrade (録音再生で人間確認)。00-overview R5 |
| R3 | linking のタスク重複 (at-least-once 残余) | 重複「やること」 | **matched/created 経路は根絶済み** — 07-delta v1.1 (裁定 #10) で createTask を DB レベル冪等化 (tasks の (source_activity_id, title) 一意 — 01-crm 0023。再送は既存 task_id)。worker はガードなしで常に再実行する (§6.5.4-4)。**ambiguous/no_number 経路は残余リスク** — source_activity_id null のため index の対象外で、link_result commit 前クラッシュの再入で重複起票があり得る (発生時は admin が削除 — §10-14)。恒久策 (call_id 由来の決定的冪等キー等の crm 契約拡張) は Phase 2 候補 |
| R4 | recording-status 取りこぼし (Twilio リトライ枯渇) | 録音はあるが未処理 | v1 は許容 (calls 行で気付ける)。日次突き合わせ job は Phase 2 候補。Twilio 側に残る未取込録音は Media Basic 認証 (T11) で匿名アクセス遮断済み |
| R5 | TWILIO_AUTH_TOKEN ローテーション時の署名断 | 短時間の webhook 403 | 運用手順化 (§4.6)。Fallback URL で発信者体験は維持 |
| R6 | call-audio の容量増 (WAV 無期限保持) | Storage 費 | 5 分通話 stereo ≈ 9.6MB、月 100 本 ≈ 1GB/月。1 年 ~12GB は許容。リテンション設定は将来課題 (§5.3) |
| R7 | settings read を webhook 経路に含める (Δ1) ことによる DB 依存 | DB 断で TwiML 不能 | 500 → Fallback URL で degrade (§6.1-失敗方針)。settings 2 キーは 1 行 SELECT × 2 で軽量 |
| R8 | 単一 admin のまま録音・個人連絡先 (個人情報) を扱う | 情報管理 | private バケット + 署名 URL TTL 10 分 + トークン/URL をログに出さない (既存 Vault 規約と同水準)。録音同意アナウンス既定 ON (★確認 4)。**転送先個人携帯 (forward_to_e164) は anon 非可読** (site_settings 許可リスト化 — §4.6 / 07-delta §D5)。**Twilio 側録音は Media Basic 認証で匿名アクセス遮断** (§13.1-5 / T11) |

---

## 16. Phase 2 契約予約 (スコープ外章 — 実装しない。契約だけ記す)

### 16.1 クリックトゥコール発信 (方式 A: REST 2 レグ — ext-twilio §4.1)

v2 で TelephonyFacade へ追加する契約 (07-contracts-delta の将来改訂で D8 へ):

```ts
// Phase 2 予約 (04-telephony.md §16.1。v1 では実装・export しない)
startOutboundCall(input: { customer_id: string; to_e164: string }): Promise<Result<{ call_id: string }>>;
  // calls INSERT (direction='outbound') → Twilio calls.create({ to: 転送先(熊部さん携帯), from: 自番号,
  //   url: voice?step=outbound_bridge }) → 応答後 <Dial> で顧客へ接続。
  // エラー帯: KMB-E808〜 (発信不可番号 0120 等 / callerId 制約 — ext-twilio §1.5)
```

DDL 予約済み: `calls.direction check ('inbound','outbound')` / zCallDirection / zCallActivityPayload.direction。**v1 のコードは 'outbound' を一切 INSERT しない** (repository がガード)。

### 16.2 リアルタイム系 (契約の境界のみ)

- ライブ文字起こし (`<Start><Transcription>`, Google ja-JP): Webhook 配送型のため Vercel で受けられる。追加 route `/api/telephony/transcription` + calls への live_transcript 列が想定差分 (Phase 1.5)
- AI 電話番 (ConversationRelay): WebSocket 常駐が必要 → **Vercel 外の常駐サービス前提** (00-overview §0.5)。telephony モジュールとの境界は「常駐サービス → /api/telephony/* への HTTP 通知」に限定する (DB 直書き禁止を契約に明記予定)

---

## 17. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 |
|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §4 (4 列総表 + Storage + API + RPC + env + staff 差分 §4.7) |
| ② テスト戦略表 (単体+結合、ペア 2 連続 PASS 粒度) | §12 (単体 8 ファイル + parity + 結合 DB/API + E2E。00-overview §9.2 の必須 4 単体を包含) |
| ③ エラーコード表 | §9 (E801〜E823 + E807 (承認済み) + 変換・透過規則。採番 canonical は 00-overview §3.3) |
| ④ ライフサイクル | §5 (call_jobs / calls 3 軸 / 録音・音声データ) + §6 (シーケンス) |
| ⑤ 全データパターン列挙 | §10 (18 パターン) |
| ⑥ 印刷出力仕様 | §0.6 — **該当なし + 理由** (帳票でない・電帳法対象外・需要なし) |
| ⑦ 移行受入基準 | §13 (移行該当なしの理由 + セットアップ手順 + T1〜T10) |
| ⑧ 規模見積り | §14 (ファイル別 + ランニングコスト) |
| ⑨ 状態意味論 | §5.1〜5.2 (ASCII 図 + 意味論表 + 不変条件) + §5.4 (lease 8 要件対応表) |
| ⑩ 差分表示仕様 | §11 (全文/要約タブ併記 + 該当なし部の理由) |
| モジュール契約 (全プロジェクト規約) | §1.5 (契約差分 Δ1〜Δ3 — 07-delta v1.1 で採用済み) + §3.1/§7.1 (07-contracts-delta 写経・再定義なし) |
| 値契約 (Zod canonical) | §3 (完全 TypeScript・.strict()・z.toJSONSchema のみ・any 禁止) |
| 非機能要件 | §7.3 (レイテンシ 4〜6 分) / §6.1 (15 秒予算) / §14 (コスト) / §15 (リスク) |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.1 | 2026-07-11 | レビュー指摘反映 (32 件 → 統合 22 件)。§1.5 Δ1 成立条件の是正 (anon 許可リスト化準拠) / §2.2 transcript_partial 列追加 / §2.5・§3.2 zCallTranscriptCheckpoint・時間予算定数 / §4.2 00-overview §5.2 との差分明示 (match_status 列 — canonical 更新申請) / §4.6 telephony キー非公開化 / §5.1 不変条件 7 (進捗 commit)・8 (最終試行の特定コード確定) / §5.2 missed 条件の一義化 (§6.3 が正) / §5.2.2 不変条件再定義 (manual = customer_id null 可・worker 終端) / §5.4 8 要件化 + 時間予算突合せ / §5.5・§10-14・§15 R3 のタスク冪等記述統一 (matched/created 根絶・ambiguous/no_number 残余) / §6.1 webhook parse 共通則 (契約キー pick + null 補完)・settings service ctx read / §6.2 (c) 同意二重再生の排除 / §6.4 duration=0 の単一規則化 (空 done ジョブ — §7.1/§10-9 と統一) / §6.5.1 404 最終試行 E805 の実装規約 / §6.5.2 セグメント checkpoint + 残余時間ガード + 進捗 commit (00-overview §3.1.4-8) / §6.5.3 maxTokens 8000 + prompt 出力上限 + max_tokens 打切り→E821 / §6.5.4 E601→E823 変換・duration fallback・タスク常時再実行・manual 保護ガード / §7.1 registerRecording 行の是正 / §7.2 linkCallToCustomer の relinkActivity 連携 (付け替え/解除の links 張り替え — 07-delta v1.6)・cronAlive→staleJobs・getCallAlertCounts 追加 / §7.3 残余予算ガード / §7.4・§8.3 電話番号の正規化入力 / §8.2 manual+null 表示・候補一覧の listCustomers 化 / §9 E601 行追加・E821 canonical 追記申請 / §12 テスト網の拡充 / §13.1-5・T11 Twilio Media Basic 認証 / §15 R3/R4/R8 更新 |
| v1.0 | 2026-07-11 | 初版。裁定 J2/J3 準拠 — 着信 TwiML (営業時間 JST 分岐/同意/留守電)・デュアルチャネル録音・call_jobs lease 型 4 ステージ (0019 雛形複製 RPC 全文)・セグメント分割転写・runStructured 議事録・CrmFacade 連携 (E823 手動)・番号非依存設計・契約差分 Δ1〜Δ3 申請 |





