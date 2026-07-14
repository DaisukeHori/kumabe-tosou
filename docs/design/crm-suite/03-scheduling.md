# 隈部塗装 CRM スイート — scheduling モジュール設計書 (03-scheduling)

- 版: v1.1 (2026-07-11: レビュー指摘反映 — §19 更新履歴参照) / v1.0 (2026-07-11: 初版 — 全体設計 00-overview v1.0 / 07-contracts-delta v1.0 / 裁定 J1・J4・J8 準拠)
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **scheduling モジュール (工数管理・カレンダー・外部カレンダー双方向同期) の親設計**。DDL (migration 0029〜0031)・画面・状態機械・同期プロトコルの canonical は本書。上位 canonical は [00-overview.md](./00-overview.md) (M0 共通基盤・エラーコード採番・認可総表・モジュール割当) と [07-contracts-delta.md](./07-contracts-delta.md) (値契約 Zod・facade シグネチャ = module-contracts.md v2.8 差分)。**本書は上位 canonical を再定義しない** — 契約は引用 (写し) + 拡張のみ。
- 姉妹文書:
  - [00-overview.md](./00-overview.md) §3 (M0: ExecutionContext / エラーコード全表 / 共通スカラー)・§4.1/§4.5 (結合シーケンス)・§5 (認可総表)・§10 (割当表)
  - [07-contracts-delta.md](./07-contracts-delta.md) §D5 (work_capacity 設定キー)・§D7 4.12 (scheduling 値契約)・§D8 (SchedulingFacade)・§D10 7.7 (受注→ブロック生成)
  - [../cms-ai-pipeline.md](../cms-ai-pipeline.md) — 既存基盤 (DDL 規約・admin UI 共通仕様・lease 意味論) の正
  - 02-sales.md — `getDocumentLinesForBlocks` の供給側 (app 層合成の相手)
  - 01-crm.md — `appendActivity('work_log')` / deals の所有側
- 入力資料: 設計ブリーフ R2 / 設計裁定書 J1・J4・J8 / 調査 ext-calendar.md (Google/Graph 同期定石)・integrations.md (OAuth/Vault/cron/CAS 実装パターン)・db-schema.md (DB 規約)・admin-ui-auth.md (UI 規約)・design-conventions.md (章立て・チェックリスト)
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提: **M0 (migration 0021/0022 + ExecutionContext) と crm (0023〜0025)・sales (0026〜0028) の DDL が先行適用済み** (work_blocks が deals / documents へ FK を張るため。00-overview §11 Phase 3 の依存順序どおり)

---

## 0. 業務シナリオ

熊部さん (塗装職人・1 人工房) の仕事の流れを 4 部で描く。IT 用語は使わない。

### 0.1 受注すると、段取りが先に並ぶ

金曜の夕方、ガレージキットの塗装を正式に受けた。すると画面に「この仕事の段取り案を用意しました — 研磨 3 時間・下地 2 時間・塗装 4 時間・乾燥待ち 1 日・検品 1 時間」と並ぶ。仕事の中身 (グレードとサイズ) から、いつもの手順が自動で呼び出されている。熊部さんがやるのは、来週のカレンダーにそれらの札をぽんぽんと置いていくだけ。乾燥待ちの札は薄い色で表示され、「その間は手が空く」ことがひと目で分かる。

### 0.2 「今週あと何時間受けられるか」が常に見えている

月曜の朝、カレンダーの右上に「今週あと 12 時間」と出ている。週にどれだけ働くかはあらかじめ決めてあり (たとえば週 40 時間)、そこから置いた札のぶんが引かれていく。乾燥待ちは引かれない — 手を動かさないからだ。昼に新しい相談の電話が来たとき、画面をちらっと見て「再来週の頭なら着手できます」と即答できた。勘ではなく、埋まり具合がそのまま答えになっている。

### 0.3 いつものスマホのカレンダーにも写る

熊部さんは昔から Google のカレンダーで暮らしている。作業の札を置くと、数分後にはスマホのカレンダーに「隈部塗装 作業予定」という専用の欄として同じ予定が現れる。現場への移動中に「明日の塗装を午後にずらそう」とスマホ側で予定を動かすと、工房に戻る頃には管理画面のカレンダーも同じ形に直っている。逆にスマホ側でうっかり予定を消してしまっても、管理画面の札が勝手に消えることはない。「スマホ側で削除されています。どうしますか?」と確認してくれるので、誤操作で仕事が消える心配がない。

### 0.4 実績を入れると、次の見積りが賢くなる

水曜、塗装が終わった。札を開いて「実際にかかった時間: 5 時間」と入れる。予定は 4 時間だったから 1 時間の超過だ。この記録は案件のページに自動で書き込まれ、「この案件、予定 10 時間・実績 12 時間」という形で儲けの計算に反映される。数ヶ月後に同じようなキットの相談が来たとき、前回の実績が横に出るので「この種類は塗装を 5 時間で見よう」と値付けと納期の精度が上がっていく。熊部さんがやったのは、終わったら数字をひとつ入れる、それだけ。

### 0.5 スコープ外 (scheduling v1 で扱わないもの)

| 項目 | 理由・扱い |
|---|---|
| 複数リソース (スタッフ別カレンダー・リソース割当) | 裁定 J8。リソースは 1 人 (熊部さん) 固定。**resources テーブルは作らない**。拡張差分は §17.2 |
| push 通知 (Google watch / Graph subscriptions) | 裁定 J4。polling 主軸。push は「dirty → polling が拾う」契約で後付け (§8.9 に契約のみ予約) |
| 外部カレンダー本体 (主カレンダー) への書き込み | アプリ専用カレンダー方式 (J4)。主カレンダーは free/busy 参照のみ |
| 外部イベントの取り込み (外部→作業ブロック化) | アプリ専用カレンダー内に利用者が手で作った予定は同期対象外 (skip + ログ)。主カレンダーの予定は busy 帯表示のみ |
| 繰り返し予定 (recurring) の生成 | 作業ブロックは単発イベントのみ生成 (Graph 展開バグ・終日変換ズレの回避 — ext-calendar §3.4) |
| 終日イベント | 生成しない (Google `start.date` / Graph `isAllDay` の相互変換ズレ回避 — ext-calendar §3.4) |
| AI 呼び出し | 該当なし — scheduling は AiProvidersFacade を利用しない (自動提案配置は決定的アルゴリズム §7.4) |
| 勤怠・給与・原価単価マスタ | 対象外。粗利は「予定 h / 実績 h の合計」を deal 画面へ供給するまで (§7.3)。**裁定 J8「実績→案件の粗利計算にフィードバック」に対する縮小** (金額換算をしない) — 裁定の否定ではなく段階化だが、時間集計で足りるかは ★堀さん確認 (§18 R11)。金額化は settings に時間単価 1 個を足す小改訂で対応可能 |

### 0.6 印刷出力

**該当なし**。理由: 帳票 (見積/受注/納品/請求) の印刷は sales 所有 (02-sales.md §印刷出力が正)。scheduling の印刷需要 (週間予定表の紙出力) は発注要求になく、必要ならブラウザ印刷 (`window.print()` + print CSS) で代替可能なため v1 では専用実装を持たない。カレンダー画面は `@media print` で背景色を保った最低限の印刷崩れ防止のみ行う (受入基準外)。

---

## 1. モジュール定義と全体像

### 1.1 責務・所有 (00-overview §10 の割当どおり — 逸脱なし)

| 項目 | 内容 |
|---|---|
| 責務 | 作業種別マスタ / 標準工数テンプレート / 作業ブロック (拘束・非拘束) / 実績入力 / 週間キャパシティ / Google・Microsoft カレンダー双方向同期 |
| 所有テーブル | `work_types`, `work_templates`, `work_template_items`, `work_blocks`, `calendar_connections`, `calendar_event_links` |
| 所有エラーコード | KMB-E701〜E739 (個別割当は 00-overview §3.3。本書は E701〜E705 / E720〜E725 を使用、**新規コード追加なし**) |
| migration 帯 | **0029, 0030, 0031** (帯固定・未使用分返上なし — 3 本全部使用) |
| 公開 facade | `SchedulingFacade` (契約 6 メソッド = 07-contracts-delta §D8。+契約外拡張 §6.2) |
| Storage / Vault | Storage バケットなし。Vault: `calendar_google_oauth` / `calendar_microsoft_oauth` (固定名、J4) |
| nav | `/admin/calendar` 「カレンダー」(00-overview §2.4 で追加済み前提) |
| settings キー | `work_capacity` の**実装** (Zod canonical は 07-contracts-delta §D5。所有は settings — 本書は実装フェーズのみ担当 §3.4) |

### 1.2 ディレクトリ構成

```
src/modules/scheduling/
  contracts.ts        … 07-contracts-delta §D7 4.12 の写経 + 契約外拡張スキーマ (§3.2)
  facade.ts           … SchedulingFacade (契約 6 + 拡張。§6)
  repository.ts       … 所有 6 テーブルへの DB アクセス + Vault ラッパ複製 (integrations §2.2 の流儀)
  internal/
    template-expand.ts   … 明細→ブロック原案の純関数 (§7.1)
    capacity.ts          … 週間キャパシティ計算の純関数 (§7.2)
    auto-place.ts        … 自動提案配置の純関数 (§7.4)
    block-state.ts       … work_blocks 状態遷移ガード純関数 (§5.1)
    sync-engine.ts       … push/pull オーケストレーション (§8.4/8.5)
    echo.ts              … 自己エコー棄却の純関数 (§8.6)
    sync-state.ts        … calendar_event_links 遷移ガード純関数 (§5.3)
    sync-error-classify.ts … 確定エラー/結果不明の分類 (publish-error-classify.ts と同型を複製)
    google-api.ts        … Google Calendar API 薄い fetch ラッパ (SDK 不使用 — §1.4)
    ms-api.ts            … Microsoft Graph 薄い fetch ラッパ (同上)
    provider.ts          … provider 抽象 interface (§8.1)
    token.ts             … トークン refresh + CAS リース (§8.3)
    lease.ts             … リース TTL 定数 (SYNC_LEASE_TTL_MS 等) + 単体テスト対象
    vault-names.ts       … Vault 固定名 + secret 型 (§8.3)
```

### 1.3 依存方向と app 層合成 (00-overview §2.2/§2.3 に従う)

```
scheduling ──→ crm (CrmFacade.appendActivity('work_log') / deals FK 参照) / platform
scheduling ──→ settings (SettingsFacade.get('work_capacity') の read のみ — 07-contracts-delta §D2。
                          書込 (update) は /admin/settings の Server Action = app 層側で行う)
scheduling ──✗ sales   … import 禁止。受注明細は app 層が SalesFacade.getDocumentLinesForBlocks()
                          で取得し zGenerateBlocksInput として渡す (07-contracts-delta §7.7)
scheduling ──✗ pricing … import 禁止。テンプレート編集 UI の grade/size 候補は app 層 (page.tsx) が
                          PricingFacade から取得して props で渡す。grade_key/size_key は文字列参照 (FK なし)
admin UI / app 層 ──→ SchedulingFacade (拡張メソッド含む)
```

- **`googleapis` / `@microsoft/microsoft-graph-client` は import 全面禁止** (00-overview §2.2、ESLint 強制は M0 で導入済み)。カレンダー API は `internal/google-api.ts` / `internal/ms-api.ts` の薄い fetch ラッパ (distribution の x-api.ts 前例)
- activities への書き込みは `CrmFacade.appendActivity` のみ (直接 INSERT 禁止)
- deals / documents への **DB レベル FK は張ってよい** (posts.source_run_id の前例 — 00-overview §3.2.2)。コードアクセスは facade 経由

### 1.4 技術選定の根拠

| 項目 | 選定 | 根拠 |
|---|---|---|
| 同期方式 | **polling 主軸** (pg_cron 5 分 + Google syncToken / Graph deltaLink)。push は Phase 2 契約予約のみ | 裁定 J4。両ベンダー公式が「push は 100% 信頼できず polling 併用必須」と明言 (ext-calendar §2.1/§2.3)。1 ユーザー規模では polling 単独で成立し、チャネル/サブスクリプション更新ジョブの運用を丸ごと省ける |
| 書き込み先 | **アプリ専用カレンダー** (「隈部塗装 作業予定」)。主カレンダーは free/busy 参照のみ | 裁定 J4。専用カレンダー内は全部自アプリ発 → ループ防止が構造的に楽 (ext-calendar §3.4)。Google の初回フル同期も母数が小さい |
| Google スコープ | `calendar.app.created` + `calendar.freebusy` + `openid email` | 最小権限。app.created はアプリ作成カレンダーのみ管理 (作成・calendars.get 含む — 公式リファレンス実確認 2026-07-11)。free/busy は主カレンダーの busy 帯表示用。openid email は account_email 取得用 (token 応答の id_token から — 追加 API 呼び出し不要)。**calendarList 系 API は app.created では呼べない** (calendarList.list の許可スコープは calendar.readonly / calendar / calendar.calendarlist(.readonly) の 4 つのみ — 同日実確認) ため本設計は calendarList を全面不使用 (§8.1/§8.2/§8.8)。**app.created の sensitive 分類は未確認** (ext-calendar §6.1) — 実プロジェクトの Data Access ページで分類と API 能力を確認し、不都合なら `calendar.events` へフォールバック (§18 R4) |
| Microsoft スコープ | `Calendars.ReadWrite` + `offline_access` + `User.Read` (delegated) | カレンダー作成 + イベント CRUD を 1 スコープで充足。MSA (個人) 対応は delegated のみ (ext-calendar §1.3)。**getSchedule は MSA の delegated では Not supported** (Microsoft Learn 実確認 2026-07-11 — 調査 ext-calendar には未記載の制約) — busy 帯は主カレンダー calendarView からの合成フォールバックを併設 (§8.1、§18 R1) |
| API クライアント | SDK 不使用の薄い fetch ラッパ + `AbortSignal.timeout(15_000)` | 既存規約 (x-api.ts / instagram-api.ts 前例)。SDK 依存を増やさない (上位指示) |
| OAuth | 既存 `src/lib/oauth/pkce.ts` + `state-cookie.ts` (AES-256-GCM) 流用の 2 ルート構成 | X/Meta の実証済み基盤 (integrations §1.4)。実在確認済み (2026-07-11) |
| トークン保管 | Vault 固定名 `calendar_google_oauth` / `calendar_microsoft_oauth` (JSON) | 00-overview §5.4 / J4。**MSA refresh token はローテーション式 → 応答の refresh_token を毎回上書き保存** (拘束条件) |
| refresh 排他 | `token_refresh_lease_expires_at` の CAS リース (条件付き UPDATE) | channel_accounts 0010 と同型 (実在確認済み)。advisory lock 禁止 (pgbouncer) |
| worker 駆動 | pg_cron → pg_net → `/api/jobs/{calendar-sync,calendar-maintenance}` (x-jobs-secret, 202+after()) | 既存確立パターン (migration 0011/0017)。登録は自帯 0031 |
| カレンダー UI の DnD | Pointer Events 自作 (30 分グリッドスナップ)。DnD ライブラリは追加しない | 既存文化「recharts 等の依存追加をせず軽量自作」(ai-studio §9 前例) の踏襲。キーボード代替操作を必ず併設 (§10.2) |
| 時刻 | DB = timestamptz (UTC)。外部イベントは `timeZone: "Asia/Tokyo"` / `Tokyo Standard Time` を明示。終日イベントは作らない | 既存規約 + ext-calendar §3.4 の落とし穴回避 |

---

## 2. データモデル (canonical DDL — migration 0029/0030/0031)

### 2.1 ER 概観

```
price_grades / price_size_classes (pricing 所有 — key 文字列参照のみ、FK なし)
        ┆ grade_key / size_key (text)
work_templates ──< work_template_items >── work_types
                                              ▲  (FK。参照中の削除は E702 ガード)
deals (crm) ◄────── work_blocks ──────────────┘
documents (sales) ◄──┘ (source_document_id, on delete set null)
                       │ consumes_capacity は work_types から作成時スナップショット複製 (J8)
                       ▼
            calendar_event_links >── calendar_connections (provider PK: google|microsoft)
            (work_block_id × provider unique。         │ トークン実体は Vault
             etag/changeKey + last_written_hash        │ (calendar_google_oauth /
             = 自己エコー棄却の三点セット)               │  calendar_microsoft_oauth)
```

### 2.2 migration 0029 — scheduling コア (全文)

```sql
-- 20260711000029_scheduling_core.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.2 (裁定 J8)
-- 本 migration が追加するもの:
--   1. work_types (作業種別マスタ。色コード付き、consumes_capacity で拘束/非拘束を型区別)
--   2. work_templates / work_template_items (標準工数テンプレート: grade×size → ブロックセット)
--   3. work_blocks (作業ブロック。consumes_capacity は作成時に work_types からスナップショット複製)
--   4. 既定作業種別 5 件の seed (冪等 — on conflict do nothing)
--   5. site_settings 'work_capacity' キーのバックフィル (Zod canonical は module-contracts v2.8 §4.2)
-- 本 migration が行わないこと: 外部同期テーブル (0030)・pg_cron 登録 (0031)
-- 適用前提: 0023 (crm: deals) / 0026 (sales: documents) 適用済み — work_blocks が FK を張るため
-- 値制約 (文字数上限・色コード形式・key 形式) は Zod (scheduling/contracts.ts) が唯一の正。
-- DB check は enum/status/非負/状態不変条件などの構造的制約に限定する (既存規約)。

-- =========================================================================
-- 1. work_types — 作業種別マスタ
-- =========================================================================
create table work_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  color text not null,
  consumes_capacity boolean not null default true,
  default_hours numeric(5,2) check (default_hours is null or default_hours >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table work_types is
  '作業種別マスタ (研磨/下地/塗装/乾燥/検品…)。key/color/label の値制約は zWorkTypeInput (Zod) が正';
comment on column work_types.consumes_capacity is
  'false = 非拘束 (乾燥待ち等。カレンダー上の期間は占めるが週間キャパを消費しない — 裁定 J8)。'
  'work_blocks へは作成時にスナップショット複製し、以後マスタ変更が既存ブロックへ波及しない';
comment on column work_types.default_hours is
  '単独ブロック作成時の既定時間。非拘束種別では「占有期間の目安 (時間)」の意味';

create trigger handle_updated_at before update on work_types
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 2. work_templates / work_template_items — 標準工数テンプレート
-- =========================================================================
create table work_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_key text,
  size_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table work_templates is
  '標準工数テンプレート (grade×size → ブロックセット)。grade_key/size_key は pricing の '
  'price_grades.key / price_size_classes.key を文字列参照 (FK なし — 契約 v2.8 §4.12。'
  'NULL = ワイルドカード。解決順序は 03-scheduling.md §7.1)';

-- アクティブなテンプレートは (grade_key, size_key) 組で一意 (NULL はワイルドカードとして '' に正規化)
create unique index work_templates_combo_active_uidx
  on work_templates (coalesce(grade_key, ''), coalesce(size_key, ''))
  where is_active;

create trigger handle_updated_at before update on work_templates
  for each row execute procedure extensions.moddatetime (updated_at);

create table work_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references work_templates(id) on delete cascade,
  work_type_id uuid not null references work_types(id),
  hours numeric(5,2) not null check (hours >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table work_template_items is
  'テンプレート明細。保存はテンプレート単位の全置換 (delete + insert) のため updated_at なし。'
  'work_type_id は FK — 参照中の work_types 削除は FK 違反 → repository が KMB-E702 に変換';

create index work_template_items_template_idx
  on work_template_items (template_id, sort_order);

-- =========================================================================
-- 3. work_blocks — 作業ブロック
-- =========================================================================
create table work_blocks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete set null,
  source_document_id uuid references documents(id) on delete set null,
  work_type_id uuid not null references work_types(id),
  title text,
  status text not null default 'backlog'
    check (status in ('backlog','scheduled','in_progress','done','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  planned_hours numeric(5,2) not null default 0 check (planned_hours >= 0),
  actual_hours numeric(5,2) check (actual_hours is null or actual_hours >= 0),
  performed_on date,
  consumes_capacity boolean not null,
  quantity numeric(7,2),
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- E701: 配置は starts/ends 同時 NULL または同時非 NULL、開始 < 終了
  constraint work_blocks_placement_pair check ((starts_at is null) = (ends_at is null)),
  constraint work_blocks_placement_order check (starts_at is null or ends_at > starts_at),
  -- 状態と配置の構造的不変条件 (§5.1)
  constraint work_blocks_backlog_unplaced check (status <> 'backlog' or starts_at is null),
  constraint work_blocks_active_placed
    check (status not in ('scheduled','in_progress') or starts_at is not null),
  constraint work_blocks_done_complete
    check (status <> 'done'
           or (actual_hours is not null and performed_on is not null and starts_at is not null))
);

comment on table work_blocks is
  '作業ブロック。1 リソース (熊部さん) 固定 — resources テーブルは作らない (裁定 J8)。'
  'title NULL = work_types.label から表示名を導出';
comment on column work_blocks.consumes_capacity is
  '作成時に work_types.consumes_capacity をスナップショット複製 (上位指示)。'
  '種別変更時のみ再スナップショット (repository)。キャパ計算はこの列だけを見る';
comment on column work_blocks.planned_hours is
  '拘束ブロック = 予定工数 (h)。非拘束ブロック = 占有期間の目安 (h)。キャパ計算は拘束のみ合算';
comment on column work_blocks.quantity is
  '原案生成時の由来明細の数量 (メモ)。テンプレ時間は数量で乗算しない (§7.1 の裁定)';

create index work_blocks_deal_idx on work_blocks (deal_id);
create index work_blocks_status_starts_idx on work_blocks (status, starts_at);
create index work_blocks_capacity_idx
  on work_blocks (starts_at) where starts_at is not null and consumes_capacity;

create trigger handle_updated_at before update on work_blocks
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 4. RLS — admin 全権 3 テーブル + work_blocks (00-overview §5.2 の総表どおり)
--    0015 パターン: 4 ポリシー + 明示 revoke + grant (RLS 有効化だけでは
--    default privileges の grant が残るため revoke を必ず書く — 0020 教訓)
-- =========================================================================
alter table work_types enable row level security;
create policy work_types_admin_select on work_types for select using (public.is_admin());
create policy work_types_admin_insert on work_types for insert with check (public.is_admin());
create policy work_types_admin_update on work_types for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_types_admin_delete on work_types for delete using (public.is_admin());
revoke all on work_types from anon;
grant select, insert, update, delete on work_types to authenticated;

alter table work_templates enable row level security;
create policy work_templates_admin_select on work_templates for select using (public.is_admin());
create policy work_templates_admin_insert on work_templates for insert with check (public.is_admin());
create policy work_templates_admin_update on work_templates for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_templates_admin_delete on work_templates for delete using (public.is_admin());
revoke all on work_templates from anon;
grant select, insert, update, delete on work_templates to authenticated;

alter table work_template_items enable row level security;
create policy work_template_items_admin_select on work_template_items for select using (public.is_admin());
create policy work_template_items_admin_insert on work_template_items for insert with check (public.is_admin());
create policy work_template_items_admin_update on work_template_items for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_template_items_admin_delete on work_template_items for delete using (public.is_admin());
revoke all on work_template_items from anon;
grant select, insert, update, delete on work_template_items to authenticated;

alter table work_blocks enable row level security;
create policy work_blocks_admin_select on work_blocks for select using (public.is_admin());
create policy work_blocks_admin_insert on work_blocks for insert with check (public.is_admin());
create policy work_blocks_admin_update on work_blocks for update
  using (public.is_admin()) with check (public.is_admin());
create policy work_blocks_admin_delete on work_blocks for delete using (public.is_admin());
revoke all on work_blocks from anon;
grant select, insert, update, delete on work_blocks to authenticated;
-- service (worker) は RLS bypass — 外部同期による starts_at/ends_at 更新に使用

-- =========================================================================
-- 5. 既定作業種別 seed (冪等。admin が後から編集/無効化してよい)
-- =========================================================================
insert into work_types (key, label, color, consumes_capacity, default_hours, sort_order) values
  ('sanding',    '研磨',     '#8d6e63', true,  3,  10),
  ('primer',     '下地',     '#78909c', true,  2,  20),
  ('painting',   '塗装',     '#a80f22', true,  4,  30),
  ('drying',     '乾燥待ち', '#bdbdbd', false, 24, 40),
  ('inspection', '検品',     '#2e7d32', true,  1,  50)
on conflict (key) do nothing;

-- =========================================================================
-- 6. settings 'work_capacity' キーのバックフィル (新キー = 新行 INSERT。既定 週 40 時間)
--    Zod canonical は module-contracts v2.8 §4.2 (zWorkCapacitySettings)。所有は settings
-- =========================================================================
insert into site_settings (key, value)
values ('work_capacity', jsonb_build_object('weekly_hours', 40))
on conflict (key) do nothing;
```

### 2.3 migration 0030 — 外部カレンダー同期 (全文)

```sql
-- 20260711000030_calendar_sync.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.3 (裁定 J4)
-- 本 migration が追加するもの:
--   1. calendar_connections (provider 単位の接続状態。トークン実体は Vault のみ)
--   2. calendar_event_links (work_block ↔ 外部イベントのマッピング + 出所マーキング +
--      自己エコー棄却の三点セット etag/changeKey・last_written_hash・external_updated_at)
-- 本 migration が行わないこと: pg_cron 登録 (0031)
-- 接続は「事業体で 1 接続」(裁定 J1) — provider を PK にし、per-user 行は持たない

-- =========================================================================
-- 1. calendar_connections
-- =========================================================================
create table calendar_connections (
  provider text primary key check (provider in ('google','microsoft')),
  status text not null default 'disconnected'
    check (status in ('disconnected','connected','expired','error')),
  vault_secret_name text,
  sync_token text,
  sync_page_cursor text,
  meta jsonb not null default '{}',
  token_refresh_lease_expires_at timestamptz,
  sync_lease_expires_at timestamptz,
  pull_requested_at timestamptz,
  last_pulled_at timestamptz,
  last_pushed_at timestamptz,
  last_full_resync_at timestamptz,
  last_error_code text,
  last_error_detail text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table calendar_connections is
  '外部カレンダー接続 (事業体で 1 接続/provider — 裁定 J1)。トークン実体は Vault のみ '
  '(calendar_google_oauth / calendar_microsoft_oauth 固定名 — 裁定 J4)。'
  'meta の型契約は zCalendarConnectionMeta (module-contracts v2.8 §4.12)';
comment on column calendar_connections.sync_token is
  'Google: events.list の nextSyncToken / Microsoft: deltaLink URL。NULL = 次回フル同期';
comment on column calendar_connections.sync_page_cursor is
  'フル同期/増分のページング途中カーソル (Google nextPageToken / Graph nextLink)。'
  '1 起床で完走しない場合の継続点 (nextSyncToken は最終ページのみ — ext-calendar §2.2 の事故対策)';
comment on column calendar_connections.token_refresh_lease_expires_at is
  'トークン refresh の CAS リース (channel_accounts 0010 と同型。advisory lock 禁止 — pgbouncer)';
comment on column calendar_connections.sync_lease_expires_at is
  'sync 実行の単一化リース (worker 多重起床対策。TTL 90 秒)';
comment on column calendar_connections.pull_requested_at is
  'Phase 2 push 通知 (webhook) が立てる dirty フラグ (§8.9 の後付け契約)。v1 では常に NULL';
comment on column calendar_connections.last_error_detail is
  'トークン・シークレットを含めないこと (maskSecretsInString を通してから保存 — Vault 規約)';

create trigger handle_updated_at before update on calendar_connections
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 2. calendar_event_links
-- =========================================================================
create table calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  work_block_id uuid not null references work_blocks(id) on delete cascade,
  provider text not null references calendar_connections(provider) on delete cascade,
  external_event_id text,
  external_ical_uid text,
  etag_or_change_key text,
  external_updated_at timestamptz,
  last_written_hash text,
  sync_status text not null default 'pending_push'
    check (sync_status in ('synced','pending_push','conflict','orphaned','deleted_externally')),
  push_attempts int not null default 0,
  push_claimed_at timestamptz,
  last_error_code text,
  last_pushed_at timestamptz,
  last_pulled_at timestamptz,
  deleted_externally_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_links_block_provider_uniq unique (work_block_id, provider),
  constraint calendar_event_links_provider_check check (provider in ('google','microsoft'))
);

comment on table calendar_event_links is
  'work_block ↔ 外部イベントのマッピング (双方向同期の核 — ext-calendar §3.1)。'
  '出所判定の一次ソースは本テーブル (external_event_id 照合)。'
  'Google は extendedProperties.private も併用、Graph は拡張プロパティ非依存 (既知問題のため)';
comment on column calendar_event_links.external_event_id is
  'NULL = まだ外部未作成 (pending_push で作成待ち)。作成応答で確定';
comment on column calendar_event_links.etag_or_change_key is
  'Google: etag / Graph: changeKey。書込直後の応答値を保存し、pull 時の自己エコー棄却と '
  '楽観排他 (If-Match) に使う';
comment on column calendar_event_links.last_written_hash is
  '自アプリが最後に書いた内容の sha256(canonical JSON {s,e,t})。エコー判定の第 3 手段 (§8.6)';
comment on column calendar_event_links.sync_status is
  '意味論は 03-scheduling.md §5.3。conflict + last_error_code=KMB-E724 は「結果不明・手動照合待ち」';
comment on column calendar_event_links.deleted_externally_at is
  '外部削除の検知時刻。ブロック本体は自動削除しない (即削除禁止 — 00-overview §6.2)';
comment on column calendar_event_links.push_claimed_at is
  'createEvent 直前に単一 UPDATE で刻印する claim (§8.4)。「claim 非 NULL + external_event_id NULL」'
  '= 結果不明の作成 (実行系 kill 疑い) — 再 create 前に findByLinkId 照合で二重イベントを防ぐ。成功時 NULL 化';

create unique index calendar_event_links_external_uidx
  on calendar_event_links (provider, external_event_id)
  where external_event_id is not null;
create index calendar_event_links_status_idx
  on calendar_event_links (provider, sync_status);

create trigger handle_updated_at before update on calendar_event_links
  for each row execute procedure extensions.moddatetime (updated_at);

-- =========================================================================
-- 3. RLS (00-overview §5.2 の総表どおり)
--    calendar_connections: admin 全権 + service (トークン refresh / 同期状態更新は bypass)
--    calendar_event_links: admin SELECT のみ。書き込みは service (worker / facade 内 service client)
-- =========================================================================
alter table calendar_connections enable row level security;
create policy calendar_connections_admin_select on calendar_connections for select using (public.is_admin());
create policy calendar_connections_admin_insert on calendar_connections for insert with check (public.is_admin());
create policy calendar_connections_admin_update on calendar_connections for update
  using (public.is_admin()) with check (public.is_admin());
create policy calendar_connections_admin_delete on calendar_connections for delete using (public.is_admin());
revoke all on calendar_connections from anon;
grant select, insert, update, delete on calendar_connections to authenticated;

alter table calendar_event_links enable row level security;
create policy calendar_event_links_admin_select on calendar_event_links for select using (public.is_admin());
-- INSERT/UPDATE/DELETE ポリシーは作らない = authenticated は書けない (service_role のみ)
revoke all on calendar_event_links from anon;
revoke insert, update, delete on calendar_event_links from authenticated;
grant select on calendar_event_links to authenticated;
```

### 2.4 migration 0031 — pg_cron 2 ジョブ登録 (全文)

```sql
-- 20260711000031_scheduling_jobs.sql
-- canonical: docs/design/crm-suite/03-scheduling.md §2.4 (00-overview §3.1.3 のジョブ表)
-- 本 migration が追加するもの:
--   1. trigger_calendar_sync_worker() / trigger_calendar_maintenance_worker()
--      (0011 の確立パターン: Vault 未設定なら raise notice で安全にスキップ)
--   2. pg_cron 登録 kmb-calendar-sync-worker (*/5) / kmb-calendar-maintenance-worker (日次 19:00 UTC = JST 04:00)
-- 前提: pg_cron / pg_net は 0011 で有効化済み。cron_site_url / cron_jobs_secret は Vault 手動設定運用

create or replace function public.trigger_calendar_sync_worker()
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
    raise notice 'trigger_calendar_sync_worker: Vault (cron_site_url / cron_jobs_secret) 未設定のためスキップ';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/calendar-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_calendar_sync_worker() from public, anon, authenticated;

create or replace function public.trigger_calendar_maintenance_worker()
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
    raise notice 'trigger_calendar_maintenance_worker: Vault 未設定のためスキップ';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/calendar-maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_calendar_maintenance_worker() from public, anon, authenticated;

-- 冪等登録 (unschedule → schedule の張り替え — 0011 前例)
select cron.unschedule(jobid) from cron.job where jobname = 'kmb-calendar-sync-worker';
select cron.schedule(
  'kmb-calendar-sync-worker',
  '*/5 * * * *',
  $$select public.trigger_calendar_sync_worker();$$
);

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-calendar-maintenance-worker';
select cron.schedule(
  'kmb-calendar-maintenance-worker',
  '0 19 * * *',
  $$select public.trigger_calendar_maintenance_worker();$$
);
```

### 2.5 全データパターン列挙 (⑤)

設計・テストで必ずカバーする現実パターン (00-overview §7 の scheduling 該当分を精密化):

| # | パターン | 設計上の受け止め |
|---|---|---|
| P1 | 乾燥待ち (非拘束) | `consumes_capacity=false` スナップショット。planned_hours = 占有期間目安 (例 24)。キャパ計算から除外。カレンダーは薄色ハッチ表示 (§10.2) |
| P2 | 通常の拘束作業 (研磨 3h 等) | planned_hours = 工数。キャパ消費。UI 配置既定は ends = starts + planned_hours |
| P3 | 配置スパン ≠ planned_hours | 3h 作業を 09:00-13:00 (昼休み跨ぎ) に置く。**キャパは planned_hours を合算** (スパンではない — §7.2 定義)。許容 |
| P4 | 週跨ぎブロック (金曜夜〜月曜の乾燥) | キャパ帰属は **starts_at が属する週** に全量。非拘束が大半のため実害なし (§7.2) |
| P5 | 明細に work_type_key あり | テンプレを引かず種別 1 ブロック直行 (hours = default_hours ?? 0) (§7.1) |
| P6 | 明細 grade×size がテンプレ完全一致 | テンプレ items 全展開 (N ブロック) |
| P7 | 部分一致フォールバック (grade のみ一致等) | (grade,size) → (grade,NULL) → (NULL,size) → (NULL,NULL) の順で解決 (§7.1) |
| P8 | 解決不能明細 (XL 個別見積り等) | skipped[] で返却 + 理由。**全滅時のみ KMB-E704** (07-contracts-delta §7.7) |
| P9 | quantity > 1 の明細 | テンプレ時間は**乗算しない**。quantity 列 + memo に記録し admin が調整 (§7.1 裁定。§18 R6) |
| P10 | 受注前の手動ブロック (deal なし) | deal_id NULL 可。work_log activity は**追記しない** (リンク先が無い — §7.3) |
| P11 | 案件 lost → 未着手ブロック | 自動では消さない。app 層が `cancelOpenBlocksForDeal` を**提案実行** (00-overview §6.2) |
| P12 | 実績の再入力 (done → done 訂正) | 上書き許可。work_log activity は初回のみ (冪等キーで再送は created:false — §7.3 注意点) |
| P13 | 未配置ブロックへの実績入力 | KMB-E705 拒否 |
| P14 | カレンダー未接続で運用 | 同期系は全て no-op。ブロック/キャパ/実績は完全動作 (graceful degradation) |
| P15 | Google だけ接続 / Microsoft だけ / 両方接続 | provider 単位に独立動作。links は (block, provider) 毎。両方接続時は両カレンダーへ push。**片方 provider での外部時刻変更は pull 取込時に他方 provider の link を pending_push 化して伝播** (§8.5 — 変更元 link には立てない。エコー防止) |
| P16 | 外部でブロック予定を移動 | pull で検知 → work_blocks.starts_at/ends_at を service 更新 (時刻・存在は外部が正 — §8.5) |
| P17 | 外部でブロック予定を削除 | `deleted_externally` マークのみ (即削除禁止)。UI で「未配置に戻す/キャンセル/再送」を選択 (§9.2) |
| P18 | 外部でタイトルを書き換え | 無視 (内容はアプリが正 — フィールド所有権分割 §8.5。次にアプリ側で更新した時に上書き) |
| P19 | アプリ専用カレンダー内に利用者が手で予定を作成 | 同期対象外 (skip + console ログ)。ブロック化しない (§0.5) |
| P20 | アプリ専用カレンダー自体を利用者が削除 | push/pull の 404 時は親カレンダー実在確認 (calendars.get / GET /me/calendars/{id}) で「イベントのみ 404」と区別 (§8.4) → カレンダー 404 なら**即時** connection status='error' + E723 (残り links はスキップ — 全 links を deleted_externally に誤マークしない)。maintenance も検知 (§8.8) → UI「専用カレンダーを作り直す」→ 再作成 + 全 links 再 push |
| P21 | syncToken/deltaLink 失効 (410 Gone) | KMB-E722 → フル再同期 (external_event_id / iCalUID / extendedProperties で照合、重複作成なし — §8.5) |
| P22 | Graph 無限ページング (recurrence 過多) | ページ上限 20 + 同一 skiptoken 再来検知 → KMB-E725 中断 (§8.5 安全弁) |
| P23 | push の結果不明 (timeout / 接続断) | KMB-E724 → sync_status='conflict' + 自動再開禁止。admin の「照合」操作で解決 (§8.7) |
| P24 | push の楽観排他競合 (412 / 409) | KMB-E721 → conflict → 次回 pull で外部変更取込 → pending_push 再送 (自動解決 — §8.4) |
| P25 | MSA refresh token ローテーション | token 応答の refresh_token を**毎回 Vault 上書き** (拘束条件 §8.3)。保存漏れ = 突然 invalid_grant |
| P26 | refresh 失敗 (invalid_grant) | connection status='expired' + KMB-E720 → UI 再連携バナー。ブロック操作は影響なし |
| P27 | 週のキャパ超過 (remaining < 0) | 負値を許容し赤字表示 (WeeklyCapacity.remaining_hours は負値あり得る — 契約明記) |
| P28 | work_capacity 未設定 (キー欠落) | 0029 バックフィル済みが前提。読めない場合は weekly_hours=40 を既定値でフォールバック + E101 ログ |
| P29 | 種別マスタの無効化 (is_active=false) | 既存ブロックは表示継続 (label/color は JOIN で取得)。新規原案生成の解決対象から除外 (E702/E704) |
| P30 | 参照中の work_type 削除 | FK 違反 → KMB-E702。UI は「無効化」を促す |
| P31 | 外部で同期対象イベントを終日イベント化 (Google `start.date` / Graph `isAllDay`) | 時刻変更として取り込まない (終日は非対応 — §0.5)。block は不変のまま当該 link を pending_push 化し、アプリの時刻付きイベントを再送して復元 (§8.5) |

### 2.6 JSONB カラム ↔ 型契約対応表

| カラム | canonical スキーマ | 備考 |
|---|---|---|
| `calendar_connections.meta` | `zCalendarConnectionMeta` (module-contracts v2.8 §4.12 = 07-contracts-delta §D7) | account_email / app_calendar_id / token_expires_at (非秘匿コピー) / sync_window_start / sync_window_end。読み書き両方で parse |
| `site_settings.value` (key='work_capacity') | `zWorkCapacitySettings` (同 §4.2 = 07-contracts-delta §D5) | 所有は settings。実装フェーズのみ scheduling (§3.4) |

scheduling の他テーブルに JSONB カラムはない (トークンは Vault、同期メタは通常列)。

---

## 3. 値契約 (Zod)

### 3.1 canonical 契約の写し (07-contracts-delta §D7 4.12 — **canonical はあちら。ここは実装者向けの写しであり編集不可**)

```ts
// scheduling/contracts.ts (module-contracts v2.8 §4.12 の写経)
import { z } from "zod";
import { zDateOnly, zIsoDatetime, zShortText } from "@/modules/platform/contracts";

export const zWorkTypeInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/),    // 'sanding' / 'primer' / 'painting' / 'drying' / 'inspection'
  label: zShortText(30),
  color: z.string().regex(/^#[0-9a-f]{6}$/),     // カレンダー表示色
  consumes_capacity: z.boolean(),                // false = 非拘束 (乾燥待ち — 裁定 J8)
  default_hours: z.number().min(0).max(999).nullable(),
  sort_order: z.number().int().min(0).max(9999),
  is_active: z.boolean(),
}).strict();

/** 標準工数テンプレート (grade×size → ブロックセット。見積明細からの原案生成に使用) */
export const zWorkTemplateInput = z.object({
  name: zShortText(50),
  grade_key: z.string().min(1).max(30).nullable(),  // pricing の key を文字列で参照 (FK なし)。
  size_key: z.string().min(1).max(10).nullable(),   // 空文字不可 — NULL ワイルドカードと '' の衝突防止 (§10.3)
  is_active: z.boolean(),
  items: z.array(z.object({
    work_type_key: z.string().regex(/^[a-z0-9_]{2,30}$/),
    hours: z.number().min(0).max(999),
    sort_order: z.number().int().min(0).max(9999),
  }).strict()).min(1).max(30),
}).strict();

export const zWorkBlockStatus = z.enum(["backlog", "scheduled", "in_progress", "done", "cancelled"]);

export const zWorkBlockInput = z.object({
  deal_id: z.string().uuid().nullable(),
  work_type_id: z.string().uuid(),
  title: zShortText(80).nullable(),              // null = 種別ラベルから生成
  starts_at: zIsoDatetime.nullable(),            // null = 未配置 (backlog)
  ends_at: zIsoDatetime.nullable(),
  planned_hours: z.number().min(0).max(999),
  memo: z.string().max(1000).nullable(),
}).strict().refine(
  (v) => (v.starts_at === null) === (v.ends_at === null),
  "開始と終了は同時に指定するか、どちらも空にしてください (KMB-E701)",
).refine(
  (v) => v.starts_at === null || v.ends_at === null
    || new Date(v.starts_at).getTime() < new Date(v.ends_at).getTime(),
  "開始は終了より前である必要があります (KMB-E701)",
);
  // ペア制約 + 順序の refine は 07-contracts-delta v1.2 で canonical に追加済み — 写しを追随

/** 受注明細→ブロック原案生成 (app 層合成 — §7.7)。lines は SalesFacade から受け取る */
export const zGenerateBlocksInput = z.object({
  deal_id: z.string().uuid(),
  source_document_id: z.string().uuid(),
  lines: z.array(z.object({
    description: zShortText(200),
    work_type_key: z.string().max(30).nullable(),
    quantity: z.number().positive().max(99_999),
    grade_key: z.string().min(1).max(30).nullable(),  // 空文字不可 (zWorkTemplateInput と同一規則)
    size_key: z.string().min(1).max(10).nullable(),
  }).strict()).min(1).max(100),
}).strict();

export const zActualInput = z.object({
  actual_hours: z.number().min(0).max(999),
  performed_on: zDateOnly,
}).strict();

/* ---------- 外部カレンダー同期 (裁定 J4) ---------- */

export const zCalendarProvider = z.enum(["google", "microsoft"]);
export const zCalendarConnectionStatus = z.enum(["disconnected", "connected", "expired", "error"]);
export const zEventLinkSyncStatus = z.enum([
  "synced", "pending_push", "conflict", "orphaned", "deleted_externally",
]);

/** calendar_connections.meta (トークン実体は Vault のみ — calendar_google_oauth /
 *  calendar_microsoft_oauth。MSA の refresh token ローテーションは毎回上書き保存) */
export const zCalendarConnectionMeta = z.object({
  account_email: z.string().email().max(120),
  app_calendar_id: z.string().max(200).nullable(), // アプリ専用カレンダー (作成後に設定)
  token_expires_at: zIsoDatetime.nullable(),       // 非秘匿コピー (UI 表示用)
  sync_window_start: zDateOnly.nullable(),         // Graph ローリングウィンドウ
  sync_window_end: zDateOnly.nullable(),
}).strict();

export type CalendarSyncReport = {
  provider: z.infer<typeof zCalendarProvider>;
  pulled: number;      // 取り込んだ外部変更数 (エコー棄却後)
  echoes_rejected: number;
  pushed: number;      // 外部へ書き込んだブロック数
  conflicts: number;   // KMB-E721 相当 (再 pull 待ち)
  full_resync: boolean; // 410 (KMB-E722) でフル再同期を実施したか
};

export type WeeklyCapacity = {
  week_start: string;          // 月曜 (JST, zDateOnly)
  weekly_hours: number;        // settings 'work_capacity'
  booked_hours: number;        // 配置済み拘束ブロック合計 (consumes_capacity=true のみ)
  remaining_hours: number;     // = weekly_hours - booked_hours (負値あり得る)
};
```

DDL parity テスト対象 (`contracts-ddl-parity.test.ts` に追加): `zWorkBlockStatus` ↔ work_blocks.status check / `zCalendarProvider` ↔ 両テーブルの provider check / `zCalendarConnectionStatus` ↔ calendar_connections.status check / `zEventLinkSyncStatus` ↔ calendar_event_links.sync_status check。

### 3.2 契約外拡張スキーマ (canonical = 本書。contracts.ts に置くが module-contracts.md には載せない — facade 拡張規約)

自モジュールの admin UI (Server Actions) 専用の入力契約。**他モジュールから import 禁止**。

```ts
// scheduling/contracts.ts — 契約外拡張 (03-scheduling.md §3.2。他モジュールからの利用禁止)
import { z } from "zod";
import { zIsoDatetime, zShortText } from "@/modules/platform/contracts";

/** ブロック配置/移動 (placeBlock)。starts < ends は refine + DB check (E701) の二重検証 */
export const zPlaceBlockInput = z.object({
  starts_at: zIsoDatetime,
  ends_at: zIsoDatetime,
}).strict().refine(
  (v) => new Date(v.starts_at).getTime() < new Date(v.ends_at).getTime(),
  "開始は終了より前である必要があります (KMB-E701)",
);

/** ブロック編集 (updateBlock)。配置・状態・実績は専用メソッド経由のためここに含めない */
export const zUpdateWorkBlockInput = z.object({
  work_type_id: z.string().uuid(),   // 変更時は consumes_capacity を再スナップショット (§5.1)
  title: zShortText(80).nullable(),  // zWorkBlockInput.title と対称 (空文字不可 — title NULL=種別ラベル導出 §2.2 を空文字で壊さない)
  planned_hours: z.number().min(0).max(999),
  memo: z.string().max(1000).nullable(),
  deal_id: z.string().uuid().nullable(),
}).strict();

/** admin 操作で許す状態遷移 (transitionBlock)。全遷移表は §5.1 — repository で二重検証 */
export const zBlockTransition = z.enum(["in_progress", "cancelled"]);

/** カレンダー表示範囲の取得 (getCalendarRange / getExternalBusy) */
export const zCalendarRangeQuery = z.object({
  from: zIsoDatetime,
  to: zIsoDatetime,
}).strict().refine(
  (v) => {
    const ms = new Date(v.to).getTime() - new Date(v.from).getTime();
    return ms > 0 && ms < 62 * 24 * 60 * 60 * 1000; // Graph getSchedule の「62 日未満」制約 (ext-calendar §4)。62 日丁度は不可 (<)
  },
  "範囲は 62 日未満で指定してください",
);

/** 外部削除 (deleted_externally) の解決アクション (§9.2 resolveExternalDeletionAction) */
export const zExternalDeletionResolution = z.enum([
  "unschedule",    // ブロックを未配置 (backlog) に戻し、リンクを削除
  "cancel_block",  // ブロックを cancelled にし、リンクを削除
  "repush",        // 外部イベントを再作成 (external_event_id を捨てて pending_push)
]);

/** orphaned link の解決アクション (§9.2 resolveOrphanedLinkAction — §5.3/§10.4) */
export const zOrphanedLinkResolution = z.enum([
  "repush",       // 外部イベントを再作成 (external_event_id/etag/hash を捨てて pending_push)
  "delete_link",  // link 行のみ削除 (ブロックは触らない)
]);

/** 自動提案配置の要求 (§7.4)。対象は backlog ブロック集合 */
export const zProposePlacementInput = z.object({
  block_ids: z.array(z.string().uuid()).min(1).max(50),
  from: zIsoDatetime,                     // この時刻以降に置く (通常 = 今)
}).strict();
```

読み取りビュー型 (Zod 化しない — 既存規約 §4.9「DB 出力の正しさは repository + DDL が保証」):

```ts
// scheduling/contracts.ts — 読み取りビュー型 (TypeScript type のみ)
export type WorkTypeRow = {
  id: string; key: string; label: string; color: string;
  consumes_capacity: boolean; default_hours: number | null;
  sort_order: number; is_active: boolean; updated_at: string;
};

export type WorkTemplateView = {
  id: string; name: string; grade_key: string | null; size_key: string | null;
  is_active: boolean; updated_at: string;
  items: Array<{ work_type_id: string; work_type_key: string; work_type_label: string;
                 hours: number; sort_order: number }>;
};

export type WorkBlockView = {
  id: string; deal_id: string | null; deal_title: string | null;
  source_document_id: string | null;
  work_type_id: string; work_type_key: string; work_type_label: string; color: string;
  title: string | null; status: z.infer<typeof zWorkBlockStatus>;
  starts_at: string | null; ends_at: string | null;
  planned_hours: number; actual_hours: number | null; performed_on: string | null;
  consumes_capacity: boolean; quantity: number | null; memo: string | null;
  sync: Array<{ provider: "google" | "microsoft";
                sync_status: z.infer<typeof zEventLinkSyncStatus>;
                last_error_code: string | null }>;
  updated_at: string;
};

export type BusyInterval = { starts_at: string; ends_at: string }; // 外部 free/busy 帯 (§8.1)

export type DealWorkSummary = {
  deal_id: string;
  planned_total_hours: number;   // cancelled 除く全ブロック
  actual_total_hours: number;    // done のみ
  done_count: number; open_count: number; // open = backlog+scheduled+in_progress
  blocks: Array<Pick<WorkBlockView,
    "id" | "work_type_label" | "status" | "planned_hours" | "actual_hours" | "performed_on">>;
};

export type CalendarConnectionView = {
  provider: "google" | "microsoft";
  status: z.infer<typeof zCalendarConnectionStatus>;
  account_email: string | null; app_calendar_id: string | null;
  token_expires_at: string | null; last_pulled_at: string | null;
  last_error_code: string | null; connected_at: string | null;
};

export type SyncIssueItem = {
  link_id: string; provider: "google" | "microsoft";
  sync_status: z.infer<typeof zEventLinkSyncStatus>;
  last_error_code: string | null;
  block: Pick<WorkBlockView, "id" | "title" | "work_type_label" | "starts_at" | "ends_at" | "status">;
  deleted_externally_at: string | null;
};

export type PlacementProposal = {
  block_id: string; starts_at: string; ends_at: string;
  expected_updated_at: string;   // 提案生成時の block.updated_at — applyPlacementProposalsAction が
                                 // placeBlock(…, expectedUpdatedAt) へ透過 (楽観排他を形骸化させない §9.2)
};
```

### 3.3 internal スキーマ (外部 API 応答・Vault secret — internal/ に置く。境界を越えない)

外部 API 応答は自モジュール JSONB ではないため `.strict()` を課さず、業務利用フィールドのみ検証する (zod 既定の strip モード)。

```ts
// scheduling/internal/vault-names.ts
import { z } from "zod";

export const CALENDAR_VAULT_SECRET_NAMES = {
  google: "calendar_google_oauth",
  microsoft: "calendar_microsoft_oauth",
} as const; // 固定名 (裁定 J4 / 00-overview §5.4)。変更禁止

/** Vault に保存する JSON (00-overview §5.4 の {access_token, refresh_token, expires_at})。
 *  MSA はローテーション式のため token 応答のたびに全体を上書き保存する (§8.3) */
export const zCalendarVaultSecret = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }), // access_token の失効時刻 (ISO)
});
export type CalendarVaultSecret = z.infer<typeof zCalendarVaultSecret>;
```

```ts
// scheduling/internal/google-api.ts — 応答の最小 parse (業務利用分のみ。未知キーは strip)
import { z } from "zod";

export const zGoogleEvent = z.object({
  id: z.string(),
  status: z.string().optional(),                 // 'cancelled' = 削除
  etag: z.string().optional(),
  iCalUID: z.string().optional(),
  updated: z.string().optional(),
  summary: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  extendedProperties: z.object({
    private: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

export const zGoogleEventsListResponse = z.object({
  items: z.array(zGoogleEvent).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),          // 最終ページのみ (ext-calendar §2.2)
});

export const zGoogleFreeBusyResponse = z.object({
  calendars: z.record(z.string(), z.object({
    busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
  })),
});

export const zGoogleTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),          // refresh 時は返らないことがある (非ローテーション)
  id_token: z.string().optional(),               // openid email 要求時のみ。account_email の取得源 (§8.2)
});
```

```ts
// scheduling/internal/ms-api.ts — 同上 (Graph)
import { z } from "zod";

export const zGraphEvent = z.object({
  id: z.string().optional(),
  "@removed": z.object({ reason: z.string().optional() }).optional(), // delta の削除通知
  changeKey: z.string().optional(),
  iCalUId: z.string().optional(),
  lastModifiedDateTime: z.string().optional(),
  subject: z.string().optional(),
  isAllDay: z.boolean().optional(),              // 終日化検知 (P31 — §8.5)
  start: z.object({ dateTime: z.string(), timeZone: z.string() }).optional(),
  end: z.object({ dateTime: z.string(), timeZone: z.string() }).optional(),
});

export const zGraphDeltaResponse = z.object({
  value: z.array(zGraphEvent).default([]),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

export const zGraphScheduleResponse = z.object({
  value: z.array(z.object({
    scheduleItems: z.array(z.object({
      status: z.string().optional(),             // 'busy' | 'tentative' | ...
      start: z.object({ dateTime: z.string(), timeZone: z.string() }),
      end: z.object({ dateTime: z.string(), timeZone: z.string() }),
    })).default([]),
  })).default([]),
});

export const zGraphTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),          // MSA は毎回新しい値 → 必ず上書き保存 (§8.3)
});
```

### 3.4 settings `work_capacity` の実装 (Zod canonical = 07-contracts-delta §D5。所有 = settings)

- **本フェーズで実装する** (00-overview §10 の割当): `settings/contracts.ts` の `SETTINGS_SCHEMAS` に `work_capacity: zWorkCapacitySettings` を追加 (07-contracts-delta §D5 の写経 — 再定義しない)。バックフィル INSERT は 0029 §6 (本書所掌)
- `/admin/settings` に「週間稼働」タブを追加 (既存 `submitSettingsForm<K>` 共通関数に乗せる — settings/actions.ts 前例)。フォームは weekly_hours 数値入力 1 個 (0〜168、step 0.5) + 説明文「カレンダーの『今週あと N 時間』の分母になります」
- scheduling からの読み出しは `SettingsFacade.get('work_capacity')` 経由 (settings の facade — 直接テーブル参照禁止)。キー欠落/parse 失敗時は `{ weekly_hours: 40 }` にフォールバックし console.warn (P28)

---

## 4. 認可マトリクスと RLS (①)

### 4.1 ロール定義 (00-overview §5.1 と同一 — 4 列)

| ロール | 実体 | 本モジュールでの用途 |
|---|---|---|
| anon | 未ログイン | **全テーブル・全 API アクセス不可** (公開露出ゼロ) |
| admin | `is_admin()` (単一管理者) | 画面操作全般 (マスタ/ブロック/実績/接続管理) |
| service | service_role (RLS bypass) | sync worker / トークン refresh / calendar_event_links 書込 / 外部同期による work_blocks 時刻更新 |
| (将来: staff) | profiles.role 拡張 | §17.1 の差分方針。v1 実装しない |

### 4.2 テーブル別認可マトリクス (RLS ポリシー全文は §2.2/§2.3 の DDL が正)

| テーブル | anon | admin | service | 将来 staff (方針) | 備考 |
|---|---|---|---|---|---|
| work_types | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ (bypass) | R/W | 参照中の DELETE は FK 違反 → repository が KMB-E702 変換 |
| work_templates | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ | R/W | |
| work_template_items | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ | R/W | 保存はテンプレ単位全置換 |
| work_blocks | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ (同期の時刻更新) | R/W | 状態遷移は repository 二重検証 (§5.1)。DELETE は backlog/cancelled かつ外部未削除 link (external_event_id 非 NULL) なしの場合のみ repository ガード (E703 — §5.1-5) |
| calendar_connections | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ (token refresh / sync state) | ✗ | トークン実体は Vault のみ。接続は事業体 1 接続 (J1) — staff にも開放しない |
| calendar_event_links | ✗ | **SELECT のみ** | INSERT/UPDATE/DELETE (worker + facade 内 service client) | R | authenticated への insert/update/delete は grant 自体なし (0030 §3) |

facade 内の service client 使用箇所 (channel_posts の「作成・状態遷移は service 専用」前例と同型): `placeBlock` / `createBlock` (配置入力あり — §6.2) / `unscheduleBlock` / `transitionBlock(cancelled)` / `cancelOpenBlocksForDeal` (対象 scheduled の links を削除マーク — §6.2) / `resolveExternalDeletion` / `resolveOrphanedLink` / `resendConflictedLink` が calendar_event_links を upsert/更新する経路。admin セッションで `requireAdmin` 通過後に service client を用いる。`SUPABASE_SERVICE_ROLE_KEY` 未設定時は links 書込をスキップし console.warn (ブロック操作自体は成立 — P14 と同じ degrade)。

### 4.3 API エンドポイント認可 (00-overview §5.3 の scheduling 該当分の詳細)

| エンドポイント | Method | 認可 | 主エラー |
|---|---|---|---|
| /api/oauth/google-calendar/start | GET | admin セッション (`requireAdmin`) + `isGoogleCalendarConfigured()` + PKCE + 暗号化 state cookie `kmb_gcal_oauth` (TTL 10 分) | E201/E202/E901 |
| /api/oauth/google-calendar/callback | GET | admin セッション + state 照合。失敗は `/admin/calendar/connections?cal_error=<code>` へリダイレクト (throw しない — OAuth UX 規約) | E720 |
| /api/oauth/ms-calendar/start | GET | 同上 (cookie `kmb_mscal_oauth`) | E201/E202/E901 |
| /api/oauth/ms-calendar/callback | GET | 同上 | E720 |
| /api/jobs/calendar-sync | POST | `x-jobs-secret` (未設定 503 KMB-E901 / 不一致 401 KMB-E201)。202 + after() | E201/E901 |
| /api/jobs/calendar-maintenance | POST | 同上 | E201/E901 |

Server Actions (§9.2) は全て先頭 `requireAdmin()` + Zod parse (既存規約。works/actions.ts の歴史的例外は踏襲しない)。

### 4.4 Vault / env / Storage

| 対象 | 内容 |
|---|---|
| Vault `calendar_google_oauth` | JSON `zCalendarVaultSecret`。書込 = OAuth callback + refresh 時 (`vault_upsert_secret` RPC、service client)。読出 = worker / facade 同期経路のみ (`vault_read_secret`)。**UI・クライアント・公開ページからの到達経路を作らない**。ログ/last_error_detail への出力禁止 (maskSecretsInString を通す) |
| Vault `calendar_microsoft_oauth` | 同上。**MSA ローテーション: token 応答を受けるたび refresh_token を含む JSON 全体を上書き保存** (拘束条件) |
| env 追加 (`src/lib/env.ts`、optional + 空文字→undefined preprocess 継承) | `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` / `MS_CALENDAR_CLIENT_ID` / `MS_CALENDAR_CLIENT_SECRET` + `isGoogleCalendarConfigured()` / `isMsCalendarConfigured()`。未設定時は接続カードに「環境変数が未設定です」degrade バナー |
| Storage | 該当なし (scheduling はバケットを所有しない) |

### 4.5 将来 staff 差分 (裁定 J1 — 00-overview §5.5 の共通骨子に対する本モジュール分)

- work_types / templates / blocks: staff R/W ポリシー**追加** (is_admin 置換禁止)。実績入力は staff の主業務になるため W 必須
- calendar_connections: **staff に開放しない** (外部接続は事業体 1 接続のまま — J1)。接続管理は admin 専用継続
- calendar_event_links: staff R のみ
- 複数リソース化 (staff 毎のブロック割当) は §17.2 (resources テーブル新設を伴う別改訂)

---

## 5. 状態意味論・ライフサイクル (④⑨)

### 5.1 work_blocks 状態機械

```
                    placeBlock                start           recordActual
   backlog ────────────────────► scheduled ─────► in_progress ────────► done
     ▲  │                          │   ▲              │                  │
     │  │ cancel                   │   │ unschedule   │ cancel           │ recordActual
     │  └────────► cancelled ◄─────┘   │ (backlog へ) │                  │ (訂正: done→done)
     │                  ▲              │              ▼                  ▼
     └──(復活なし。作り直す)            └────────── cancelled          (終端に近いが訂正可)
```

許可遷移表 (repository `assertBlockTransition` — `internal/block-state.ts` の純関数で二重検証。RLS は遷移を制限しない):

| from \ to | backlog | scheduled | in_progress | done | cancelled |
|---|---|---|---|---|---|
| backlog | — | ✅ placeBlock | ✗ | ✗ (E705: 未配置に実績不可) | ✅ |
| scheduled | ✅ unschedule (+外部イベント削除) | ✅ placeBlock (移動) | ✅ 着手 | ✅ recordActual | ✅ |
| in_progress | ✗ (E703) | ✗ 状態は戻さない (時刻変更は placeBlock で可 — in_progress 維持) | — | ✅ recordActual | ✅ |
| done | ✗ (E703) | ✗ (E703) | ✗ (E703) | ✅ recordActual (実績訂正) | ✗ (E703) |
| cancelled | ✗ (E703 — 終端。作り直す) | ✗ | ✗ | ✗ | — |

| 状態 | 意味論 | 配置 (starts/ends) | キャパ計上 | 外部カレンダー |
|---|---|---|---|---|
| backlog | 原案生成直後 / 未配置 | NULL 必須 (DB check) | しない | イベントなし |
| scheduled | カレンダー配置済み | 非 NULL 必須 | consumes_capacity=true なら計上 | push 対象 (pending_push → synced) |
| in_progress | 着手済み | 非 NULL | 計上 | 維持 |
| done | 実績確定 (actual_hours + performed_on 必須 — DB check) | 非 NULL 維持 | 計上 (実施済みも週内消費) | 維持 (削除しない — 履歴) |
| cancelled | 中止 (終端) | 任意 (配置痕を保持) | **しない** | 外部イベント削除 + link 削除 |

不変条件:

1. `consumes_capacity` は作成時スナップショット。**work_types 側の変更は既存ブロックに波及しない** (上位指示)。ブロックの種別変更 (`updateBlock`) 時のみ新種別から再スナップショット
2. 配置ペア制約 (E701) と状態×配置整合は DB check + Zod refine の二重検証 (§2.2)
3. done の実績値は上書き訂正可 (P12)。ただし work_log activity は初回確定時のみ追記 (§7.3)
4. cancelled は終端。復活は新規ブロック作成で行う (immutable log 原則の簡易版)
5. 削除 (物理 DELETE) は backlog / cancelled のみ (repository ガード E703)。done は履歴として削除不可。**加えて external_event_id 非 NULL の calendar_event_links が残るブロックは物理 DELETE を拒否 (E703)** — cascade で link 行が消えると external_event_id を知る手段が失われ、外部イベントが検出不能な永久残置 (ゴースト予定) になるため。削除マーク (pending_push) が次回 sync で消化され link が消えた後に削除可能になる (§5.3-6)
6. createBlock は配置入力 (starts/ends 非 NULL) ありのとき backlog を経ず status='scheduled' で直接生成する (§6.2 — 遷移表の例外。status='backlog' のまま INSERT すると DB check `work_blocks_backlog_unplaced` に違反するため)

### 5.2 calendar_connections 状態機械

```
disconnected ──(OAuth callback 成功 + アプリ専用カレンダー確保)──► connected
     ▲                                                              │ ▲
     │ disconnect (admin。Vault secret 削除 + links cascade 削除)     │ │ 再連携 (OAuth やり直し)
     ├──────────────────────────────────────────────────────────────┤ │
     │                        invalid_grant / refresh 失敗 (E720)    ▼ │
     │                                                           expired
     │                        専用カレンダー消失等の確定異常 (E723)     │
     └───────────────────────── error ◄─────────────────────────────┘
                                  │ (「作り直す」操作 or 再連携で connected へ)
```

| 状態 | 意味論 | sync worker の扱い | UI |
|---|---|---|---|
| disconnected | 未接続 (行なし or 切断済み) | 対象外 | 「接続する」ボタン |
| connected | トークン健全・同期稼働 | pull + push 実行 | アカウント/最終同期表示 |
| expired | refresh token 失効 (invalid_grant) — KMB-E720 | **スキップ** (自動リトライしない) | 「再連携が必要です」バナー |
| error | 確定異常 (専用カレンダー消失 = P20 等) — KMB-E723 | スキップ | 原因表示 + 「専用カレンダーを作り直す」/「再連携」 |

不変条件: `vault_secret_name` は provider 固定名以外を取らない。`meta.app_calendar_id` は connected 中は非 NULL。disconnect 時は Vault secret をベストエフォート削除 (`vault_delete_secret`) し、行は status='disconnected' で残す (PK 行の再利用。**meta.app_calendar_id は消さない** — calendarList 系 API を使わない本設計 (§1.4) では再接続時の既存カレンダー発見手段が保存済み id への calendars.get / GET /me/calendars/{id} しかないため §8.2)。connections 行 DELETE は links を cascade 削除するため「完全初期化」操作のみに使う。

### 5.3 calendar_event_links 同期状態機械 (⑨ 精密版)

```
                 (placeBlock / repush)                push 成功
  [リンクなし] ────────────────► pending_push ──────────────────► synced
                                   ▲  │ │                          │ │ │
        pull で外部変更取込 (再送要) │  │ │ push 412/409 (E721)      │ │ │
                                   │  │ └────────► conflict ◄──────┘ │ │
                                   │  │ push 結果不明 (E724)   │       │ │
                                   │  │ push 確定失敗×3 (E723) │       │ │
                                   │  │                       │       │ │
                                   └──┴───── (照合/pull 解決) ─┘       │ │
                                                                      │ │
      外部で削除 (cancelled/@removed) ────────► deleted_externally ◄───┘ │
        (admin が unschedule/cancel/repush で解決 — link 削除 or 再送)     │
                                                                        │
      追跡不能 (外部でカレンダー間移動等、iCalUID でも発見不能) ── orphaned ◄─┘
        (admin が repush or link 削除で解決)
```

| sync_status | 意味論 | 成立条件 | 離脱条件 |
|---|---|---|---|
| pending_push | アプリ側に未送信の変更がある | placeBlock/移動/repush 操作。external_event_id NULL = 新規作成待ち | push 成功 → synced |
| synced | 外部と一致 (etag/changeKey 保存済み) | push 成功 or pull 取込完了 | アプリ側変更 → pending_push / 外部変更 → 取込後 synced 維持 |
| conflict | 整合が取れていない。**last_error_code で 3 亜種を区別**: E721 = 楽観排他競合 (自動解決可) / E723 = 確定エラー 3 回 (手動リトライ) / E724 = **結果不明 (自動再開禁止)** | push 時 412/409、timeout、attempts 枯渇 | E721: 次回 pull → pending_push 再送 (自動)。E723/E724: admin 操作 (§8.7) |
| deleted_externally | 外部でイベント削除を検知。**ブロックは触らない** (即削除禁止 — 00-overview §6.2) | pull で cancelled/@removed | admin の 3 択操作 (§9.2)。自動遷移なし |
| orphaned | 外部イベントを追跡不能 (id 消失・別カレンダー移動で iCalUID でも未発見) | フル再同期時の照合不能 | admin の repush or link 削除 |

不変条件:

1. `(work_block_id, provider)` は一意 — 1 ブロック 1 provider 1 リンク
2. `(provider, external_event_id)` は部分一意 — 外部イベントの二重採用を DB が拒否 (フル再同期の重複防止)
3. **conflict + E724 の link は worker が自動処理しない** (自動再開禁止 — E506 と同思想)。解決は admin の「照合」操作のみ (§8.7)
4. `etag_or_change_key` / `last_written_hash` / `external_updated_at` の三点は push/pull 応答受領時に必ず原子更新 (単一 UPDATE)
5. push は per-link で `push_attempts` を数え、確定エラー 3 回で conflict (E723)。**成功時のみ 0 リセット** (0019 BLOCKER 教訓の適用)
6. リンク削除は「外部イベント削除成功後」(external_event_id NULL の未 push リンクは外部 API を呼ばず行削除のみ — §8.4) または admin 解決操作のみ。**external_event_id 非 NULL の link を持つブロックの物理 DELETE は repository が拒否する (E703 — §5.1-5)**: cascade 削除で link 行ごと external_event_id が消えると外部イベントの残置を事後検出する手段がない (pull では P19 の手作りイベント扱いで skip され続ける) ため、事後検出ではなく**事前拒否**で守る

### 5.4 モジュール間の状態整合規則 (00-overview §6.2 の scheduling 該当分)

| 規則 | 内容 |
|---|---|
| 案件 → ブロック | deal が lost になったら app 層 (crm の案件画面) が `cancelOpenBlocksForDeal(dealId)` を**提案実行** (自動では消さない)。backlog/scheduled のみ対象、in_progress/done は触らない |
| ブロック → 案件 | 初回 placeBlock 成功時、deal.stage='ordered' なら UI が「製作中に進めますか?」トースト提案 → app 層が `CrmFacade.updateDealStage(dealId, 'in_production', ...)`。**scheduling facade は deal.stage を直接更新しない** |
| 実績 → タイムライン | recordActual (初回確定) → `CrmFacade.appendActivity('work_log', ref=work_blocks.id)` (§7.3)。冪等キー = (work_log, work_blocks, block_id) |
| 外部カレンダー → ブロック | 時刻・存在は外部の直近操作が正 / 内容 (タイトル・種別・案件紐づけ) はアプリが正 (フィールド所有権分割 — §8.5)。外部削除は deleted_externally マークのみ |
| 結果不明の外部書込 | E724 → 手動照合 (自動再開禁止)。§8.7 |

### 5.5 周辺リソースのライフサイクル

| リソース | 生成 | 更新 | 消滅 |
|---|---|---|---|
| Vault secret (`calendar_*_oauth`) | OAuth callback | refresh のたび上書き (MSA は必須、Google も expires_at 更新) | disconnect でベストエフォート削除 |
| アプリ専用カレンダー (外部) | callback 時に保存済み `meta.app_calendar_id` を実在検証→なければ作成 (`ensureAppCalendar` — calendarList 不使用 §8.2) | — | アプリからは削除しない。利用者が削除した場合は P20 (error → 作り直し) |
| 外部イベント | push (pending_push 消化) | push (If-Match 付き) | block cancelled/unschedule 時に削除。結果不明は E724 |
| sync_token / deltaLink | 初回フル同期完了時 | 増分のたび更新 | 410 で破棄→フル再同期 / Graph 窓切り直しで再取得 |

---

## 6. facade 公開メソッド

戻り値はすべて `Result<T>` (platform/contracts.ts)。楽観排他は `expectedUpdatedAt` の**生文字列比較** (Date 経由禁止 — 既存教訓)。

### 6.1 契約メソッド (module-contracts v2.8 §5 = 07-contracts-delta §D8。**シグネチャ変更禁止**)

```ts
// scheduling/facade.ts (03-scheduling.md が親設計。契約 canonical は module-contracts v2.8 §5)
export interface SchedulingFacade {
  generateBlocksFromLines(input: GenerateBlocksInput):
    Promise<Result<{ block_ids: string[]; skipped: Array<{ description: string; reason: string }> }>>;
  placeBlock(blockId: string, startsAt: string, endsAt: string, expectedUpdatedAt: string):
    Promise<Result<void>>;
  recordActual(blockId: string, input: ActualInput, expectedUpdatedAt: string):
    Promise<Result<void>>;
  getWeeklyCapacity(weekStart: string): Promise<Result<WeeklyCapacity>>;
  runCalendarSync(ctx: ExecutionContext): Promise<Result<CalendarSyncReport[]>>;
  runCalendarMaintenance(ctx: ExecutionContext): Promise<Result<void>>;
}
```

| メソッド | 実行文脈 | 処理要旨 | 返し得るエラー (全列挙) |
|---|---|---|---|
| `generateBlocksFromLines` | session | Zod parse → deal 存在確認 → 行ごとにテンプレ解決 (§7.1) → work_blocks 一括 INSERT (status='backlog'、consumes_capacity スナップショット) → 解決不能行は skipped[] | KMB-E101 (入力不正) / E201・E202 / **E702** (deal・種別の参照不整合、FK 違反) / **E704** (全行解決不能) / E901 (DB 異常) |
| `placeBlock` | session | 遷移ガード (§5.1) → CAS UPDATE (updated_at 一致) → 接続済み provider の links を pending_push で upsert (service client。未設定時は skip + warn) | E101 / **E701** (starts≥ends・片側 NULL) / **E703** (done/cancelled への配置) / E103 (楽観排他) / E201・E202 / E901 |
| `recordActual` | session | 遷移ガード (scheduled/in_progress/done のみ — §5.1) → CAS UPDATE (actual_hours/performed_on/status='done') → **初回確定時のみ** `CrmFacade.appendActivity('work_log', ctx 省略=session)` (deal_id NULL はスキップ)。activity 失敗は E902 ログのみ (実績確定は成立。maintenance が冪等再送で自己修復 — §8.8) | E101 / **E705** (backlog/cancelled への実績) / E103 / E201・E202 / E901 |
| `getWeeklyCapacity` | session | weekStart (JST 月曜) 検証 → settings 'work_capacity' 読み → 拘束ブロック合算 (§7.2) | E101 (weekStart が月曜でない) / E201・E202 / E901 |
| `runCalendarSync` | **service 専用** (`ctx.mode==='service'` 必須) | 接続ごとに sync リース取得 → push → pull → report[] (§8.4/8.5)。**provider 単位の業務エラー (E720〜E725) は connection/link に記録し Result は ok を維持** — Result エラーはインフラ異常のみ | E901 (service client 生成不可 / JOBS 前提未整備)。`ctx.mode==='session'` で呼ばれたら E202 |
| `runCalendarMaintenance` | service 専用 | トークン健全性 / Graph 窓切り直し / 整合性検査 (§8.8) | E901 / E202 (同上) |

### 6.2 契約外拡張メソッド (canonical = 本書。**他モジュールから呼ぶこと禁止** — admin UI / app 層専用。facade.ts 内に「契約外拡張 (03-scheduling.md §6.2)」コメント必須)

```ts
// ---- 作業種別 / テンプレート ----
listWorkTypes(includeInactive?: boolean): Promise<Result<WorkTypeRow[]>>;
saveWorkType(input: WorkTypeInput, id: string | null, expectedUpdatedAt: string | null):
  Promise<Result<{ work_type_id: string }>>;
  // id null = 新規。key 重複は E101 (detail: 'key が重複しています')
deleteWorkType(id: string): Promise<Result<void>>;                    // 参照ありは E702 (FK 変換)
listWorkTemplates(includeInactive?: boolean): Promise<Result<WorkTemplateView[]>>;
saveWorkTemplate(input: WorkTemplateInput, id: string | null, expectedUpdatedAt: string | null):
  Promise<Result<{ template_id: string }>>;
  // items は全置換。work_type_key 解決不能 / アクティブ combo 重複は E702 / E101
deleteWorkTemplate(id: string): Promise<Result<void>>;

// ---- ブロック CRUD / 遷移 ----
createBlock(input: WorkBlockInput): Promise<Result<{ block_id: string }>>;
  // status 導出規則 (§5.1-6): 配置入力 (starts/ends 非 NULL) あり → status='scheduled' で作成し
  // 接続済み provider の links を pending_push で upsert (placeBlock と同処理 — 既定 'backlog' の
  // まま INSERT すると DB check work_blocks_backlog_unplaced 違反で必ず失敗する)。なし → 'backlog'。
  // E101 / E701 / E702 (work_type 不在・無効) / E201・E202
updateBlock(blockId: string, input: UpdateWorkBlockInput, expectedUpdatedAt: string):
  Promise<Result<void>>;   // 種別変更時 consumes_capacity 再スナップショット。E101/E103/E702/E703(done 編集不可)
unscheduleBlock(blockId: string, expectedUpdatedAt: string): Promise<Result<void>>;
  // scheduled → backlog。外部イベント削除は links を pending 削除マーク → 次回 sync (E703/E103)
transitionBlock(blockId: string, to: z.infer<typeof zBlockTransition>, expectedUpdatedAt: string):
  Promise<Result<void>>;   // 'in_progress' | 'cancelled'。E703/E103
deleteBlock(blockId: string): Promise<Result<void>>;
  // backlog/cancelled のみ。加えて external_event_id 非 NULL の link が残る場合も E703
  // (cascade による外部イベント永久残置の防止 — §5.1-5/§5.3-6。次回 sync が削除マークを消化し
  //  link が消えた後に再実行で削除可。UI は「外部カレンダーへの反映待ちです」と案内)
cancelOpenBlocksForDeal(dealId: string): Promise<Result<{ cancelled: number }>>;
  // backlog+scheduled を一括 cancelled (00-overview §6.2 の提案実行)。scheduled だったブロックの
  // links は削除マーク (sync_status='pending_push' — §8.4 の削除判定で外部イベントも削除される。
  // §5.1 cancelled 行の「外部イベント削除 + link 削除」の実現経路)。E201・E202/E901

// ---- 読み取り (カレンダー/一覧/集計) ----
getCalendarRange(query: z.infer<typeof zCalendarRangeQuery>): Promise<Result<WorkBlockView[]>>;
getBacklogBlocks(p: Pagination): Promise<Result<Paged<WorkBlockView>>>;  // keyset 50 件
getDealWorkSummary(dealId: string): Promise<Result<DealWorkSummary>>;    // 案件画面の予実差 (app 層が呼ぶ)
getExternalBusy(query: z.infer<typeof zCalendarRangeQuery>): Promise<Result<BusyInterval[]>>;
  // 主カレンダーの free/busy 帯 (§8.1)。未接続 = 空配列 (エラーにしない)。E720 は expired 時のみ

// ---- 自動提案配置 (§7.4) ----
proposeBlockPlacement(input: z.infer<typeof zProposePlacementInput>):
  Promise<Result<PlacementProposal[]>>;  // 提案のみ (永続化しない)。E101/E702

// ---- 接続管理 / 同期運用 ----
getCalendarConnections(): Promise<Result<CalendarConnectionView[]>>;
disconnectCalendar(provider: z.infer<typeof zCalendarProvider>): Promise<Result<void>>;
  // status='disconnected' + Vault ベストエフォート削除 + links 削除。外部カレンダー本体と
  // meta.app_calendar_id は残す (再接続時に calendars.get で実在検証して引き継ぐ — §5.2/§8.2)。
  // 再接続後の旧イベント二重表示: Google は kumabe_block_id による link 再構築 (§8.5) で構造的に
  // 防止。Microsoft は再構築キーが無いため確認ダイアログで「再接続時は古い予定の手動削除が
  // 必要になることがあります」と注記 (§18 R10)
listSyncIssues(): Promise<Result<SyncIssueItem[]>>;
  // deleted_externally / conflict / orphaned の一覧 (バッジ・解決 UI 用)
resolveExternalDeletion(linkId: string, action: z.infer<typeof zExternalDeletionResolution>):
  Promise<Result<void>>;   // §9.2。E101/E703 (対象 link が deleted_externally でない)
reconcilePushUnknown(linkId: string): Promise<Result<{ resolved: boolean }>>;
  // E724 **専用**の手動照合 (§8.7)。Google: privateExtendedProperty 検索 / MS: transactionId 再送。
  // 照合失敗 (API 到達不能) は E723/E724 を返し conflict 継続
resendConflictedLink(linkId: string): Promise<Result<void>>;
  // conflict + KMB-E723 (確定エラー 3 回) の「再送」(§8.7/§10.4)。push_attempts=0 +
  // sync_status='pending_push' に戻すだけの軽量 DB 操作 (外部 API は呼ばない —
  // reconcilePushUnknown と流用しない)。E101 / E703 (対象 link が conflict+E723 でない)
resolveOrphanedLink(linkId: string, action: z.infer<typeof zOrphanedLinkResolution>):
  Promise<Result<void>>;
  // orphaned の解決 (§5.3/§10.4)。repush = external_event_id/etag/hash を破棄して pending_push /
  // delete_link = link 行のみ削除 (ブロックは触らない)。E101 / E703 (対象 link が orphaned でない)
requestSyncNow(): Promise<Result<{ reports: CalendarSyncReport[]; skipped_running: boolean }>>;
  // 「今すぐ同期」。requireAdmin 通過後に runCalendarSync({mode:'service'}) を内部委譲。
  // 手動実行の縮小上限 = push 5 links + pull 5 ページ/provider (Server Action の実行時間内に
  // 収める — actions.ts は export const maxDuration = 60 を明示 §9.2。残りは 5 分毎 worker が継続)。
  // sync リース (§8.5) が取れなかった provider は skip し skipped_running=true — UI は
  // 「同期が進行中です。しばらくしてから再実行してください」を表示 (「取込 0」と誤解させない)
```

---

## 7. 中核ロジック仕様

### 7.1 テンプレート解決とブロック原案生成 (`internal/template-expand.ts` — 純関数)

入力: `zGenerateBlocksInput.lines[]` + アクティブな work_types / work_templates (items 込み)。出力: ブロック原案配列 + skipped 配列。**DB 非依存の純関数** (単体テスト対象)。

解決順序 (行ごと):

1. `work_type_key` が非 NULL → アクティブな work_types から key 一致を検索
   - 一致 → **1 ブロック** (planned_hours = `default_hours ?? 0`、title = `${label}: ${description 先頭 40 字}`)
   - 不一致 (存在しない/無効) → skipped (reason: `作業種別 '${key}' が見つからないか無効です`)
2. `work_type_key` NULL → テンプレートカスケード解決 (最初に一致したもの):
   `(grade_key, size_key)` 完全一致 → `(grade_key, NULL)` → `(NULL, size_key)` → `(NULL, NULL)`
   - 一致 → items を sort_order 順に**全展開** (item ごとに 1 ブロック。planned_hours = item.hours、title = `${種別label}: ${description 先頭 40 字}`)
   - 全段不一致 → skipped (reason: `テンプレート未定義 (grade=${grade_key ?? '-'} × size=${size_key ?? '-'})`)
3. 各ブロック共通: status='backlog'、deal_id / source_document_id / quantity (行の数量) / consumes_capacity = 種別スナップショット
4. **数量は乗算しない** (裁定 — P9): テンプレ時間は「1 案件分の段取り」であり数量比例しない (段取り費と同じ考え方)。quantity 列 + memo `数量 ${quantity}` で可視化し admin が調整。※堀さん確認事項 (§18 R6)

戻り値: `{ blocks: [...], skipped: [...] }`。facade は blocks 空 + skipped 非空なら **KMB-E704** (全滅時のみ — 07-contracts-delta §7.7)、blocks 非空なら INSERT して skipped を戻り値に同梱 (部分成功は成功)。

### 7.2 週間キャパシティ計算 (`internal/capacity.ts` — 純関数 + repository の 1 クエリ)

**定義 (裁定 J8 の解釈を確定)**:

```
week_start   = JST 月曜 00:00 (入力は zDateOnly。月曜以外は E101)
week_end     = week_start + 7 日
booked_hours = Σ planned_hours
               where consumes_capacity = true
                 and status in ('scheduled','in_progress','done')
                 and starts_at ∈ [week_start, week_end)   … JST→UTC 変換後の timestamptz 比較
remaining_hours = weekly_hours (settings 'work_capacity') − booked_hours   … 負値許容 (P27)
```

- **planned_hours を合算する** (配置スパンではない — P3)。理由: 昼休み跨ぎ等でスパン > 工数が常態であり、「あと何時間受けられるか」は工数ベースが実態に合う
- 週跨ぎブロックは starts_at の属する週に全量帰属 (P4)。拘束ブロックはほぼ日中数時間で跨がないため単純規則を採る
- done も計上 (その週の消費実績)。cancelled / backlog は除外
- SQL は `date_trunc` 相当を JS 側で行わず、facade が week_start/end を UTC ISO に解決して repository へ渡す (Asia/Tokyo 変換はコード側 1 箇所 — `internal/capacity.ts` の `resolveWeekRangeJst()`)
- 表示先: /admin/calendar ヘッダの容量チップ (§10.2) + ダッシュボード KPI (Phase 5 統合 — 00-overview §9.3)

### 7.3 実績入力と粗利フィードバック

```
admin: ブロック詳細ダイアログ「実績を入れる」 (actual_hours + performed_on)
→ recordActual(blockId, input, expectedUpdatedAt)
  1. 遷移ガード: scheduled/in_progress → done (初回) / done → done (訂正 — P12)
  2. CAS UPDATE (updated_at 生文字列一致): actual_hours / performed_on / status='done'
  3. 初回確定 (旧 status ≠ 'done') かつ deal_id 非 NULL のとき:
     CrmFacade.appendActivity({
       activity_type: 'work_log',
       occurred_at: `${performed_on}T12:00:00+09:00`,   // 実施日の正午 JST 固定 (決定的)
       title: `作業実績: ${work_type_label}`,
       body: null,
       payload: { work_block_id, work_type_key, work_type_label,
                  planned_hours, actual_hours, performed_on },   // zWorkLogActivityPayload
       ref_table: 'work_blocks', ref_id: blockId,
       links: [{ customer_id: null, company_id: null, deal_id }],
     })
     - 冪等: (work_log, work_blocks, blockId) — worker 再実行/二重クリックでも二重掲載なし
     - 失敗時: KMB-E902 で console.error のみ (実績確定は成立)。maintenance が直近 7 日の
       done ブロックへ冪等再送して自己修復 (§8.8)
  4. 訂正 (done→done) は activity を再送しない (冪等キューにより created:false になるだけで
     payload は更新されない)。タイムライン上の数字は初回確定値のまま — 最新の予実は
     deal 画面が getDealWorkSummary で work_blocks から直接取得するため実害なし (P12)
→ 案件粗利への反映: 01-crm.md の案件詳細画面が app 層で getDealWorkSummary(dealId) を呼び
  「予定 Σh / 実績 Σh / 差分」を表示。金額換算 (時間単価) は v1 スコープ外 (§0.5)
```

### 7.4 自動提案配置 (`internal/auto-place.ts` — 純関数)

「自動で並べる」ボタン (§10.2) の裏側。**提案のみ生成し、確定は admin が置く** (proposeBlockPlacement → UI プレビュー → 一括 placeBlock)。

アルゴリズム (greedy earliest-fit、決定的):

1. 入力: 対象 backlog ブロック (原案生成順 = created_at, id 昇順)、開始起点 from、既存配置ブロック (拘束のみ)、外部 busy 帯 (取得済みなら)、作業時間帯
2. 作業時間帯: 09:00〜18:00 JST 固定 (v1)。settings 'business_hours' が実装されたら (telephony フェーズ) それを優先参照 — 参照のみで依存は settings facade 経由
3. 拘束ブロック: 作業時間帯内の空き (既存拘束ブロック・busy 帯・先行提案と非重複) に 30 分スナップで earliest-fit。planned_hours が 1 日の残り時間を超える場合は翌営業日に送る (**分割しない** — v1)
4. 非拘束ブロック (乾燥待ち等): 直前の提案ブロック終了時刻から planned_hours 時間の連続スパン (夜間・週末を跨いでよい — 手が空く時間のため重複制約なし)
5. 順序: 入力順を保持 (研磨→下地→塗装→乾燥→検品のテンプレ順)。**依存関係グラフは持たない** (テンプレの sort_order が事実上の工程順)
6. 14 日先まで探索して置けない場合はそのブロック以降を提案なし (UI に「置けませんでした」表示)

### 7.5 受注確定 → ブロック生成の結合シーケンス (再掲 — canonical は 00-overview §4.1 / 07-contracts-delta §7.7)

```
Server Action (sales の受注 UI — app 層):
  SalesFacade.getDocumentLinesForBlocks(受注id)
    → { description, work_type_key, quantity, grade_key, size_key }[]
  → SchedulingFacade.generateBlocksFromLines({ deal_id, source_document_id: 受注id, lines })
    → { block_ids, skipped }
  → UI: 「作業ブロックを N 件用意しました (M 件は対象外)」→ /admin/calendar へ誘導
[異常] 全滅 (E704) → 受注は成立のまま、手動ブロック作成へ誘導 (トースト)
[注記] scheduling は sales を import しない。grade_key/size_key は document_lines.source
       スナップショット由来 (02-sales.md §契約)。source が NULL の明細は grade/size 両 NULL で
       渡ってくる → テンプレ (NULL,NULL) にフォールバック or skipped (P8)
```

---

## 8. 外部カレンダー同期詳細 (裁定 J4)

### 8.1 provider 抽象 (`internal/provider.ts`)

```ts
// scheduling/internal/provider.ts — google/microsoft の共通抽象 (契約は internal に閉じる)
import type { CalendarVaultSecret } from "./vault-names";

export type ExternalEventInput = {
  linkId: string;              // 出所マーキング (Google: extendedProperties / MS: transactionId)
  title: string;
  startsAt: string;            // ISO (UTC)。書込時に Asia/Tokyo 表記へ変換
  endsAt: string;
};

export type ExternalEventChange = {
  externalEventId: string;
  etagOrChangeKey: string | null;
  icalUid: string | null;
  externalUpdatedAt: string | null;
  title: string | null;
  startsAt: string | null;     // removed=true / isAllDay=true のとき null
  endsAt: string | null;
  removed: boolean;            // Google: status='cancelled' / Graph: @removed
  isAllDay: boolean;           // 終日化検知 (Google: start.date のみ / Graph: isAllDay=true) — P31。
                               // 時刻としては取り込まず §8.5 が pending_push 化して再送復元
  appLinkId: string | null;    // 出所マーキングから復元できた場合 (Google のみ確実)
  appBlockId: string | null;   // kumabe_block_id (Google のみ)。再接続後の link 再構築用 (§8.5)
};

export type PullPage = {
  changes: ExternalEventChange[];
  nextPageCursor: string | null;   // 継続あり
  nextSyncToken: string | null;    // ラウンド完了 (最終ページのみ)
};

export type WriteOutcome = {
  externalEventId: string;
  etagOrChangeKey: string | null;
  externalUpdatedAt: string | null;
  icalUid: string | null;
};

/** 例外規約: HTTP 応答を受信できた確定エラーは ConfirmedApiError (status 保持)。
 *  fetch 例外 (timeout/断) はそのまま throw → sync-engine が E724 (結果不明) に分類。
 *  410 は GoneError、401 は AuthExpiredError として型で区別する */
export interface CalendarProviderAdapter {
  ensureAppCalendar(secret: CalendarVaultSecret, knownCalendarId: string | null): Promise<string>;
    // 保存済み id を calendars.get / GET /me/calendars/{id} で実在検証 → 404/未保存なら新規作成。
    // calendarList 系 API は呼ばない (app.created スコープで呼べない — §1.4)
  createEvent(calendarId: string, input: ExternalEventInput, secret: CalendarVaultSecret): Promise<WriteOutcome>;
  updateEvent(calendarId: string, externalEventId: string, input: ExternalEventInput,
              ifMatch: string | null, secret: CalendarVaultSecret): Promise<WriteOutcome>; // 412/409 → ConflictError
  deleteEvent(calendarId: string, externalEventId: string, secret: CalendarVaultSecret): Promise<void>; // 404/410 は成功扱い
  pullChanges(calendarId: string, syncToken: string | null, pageCursor: string | null,
              window: { start: string; end: string } | null, secret: CalendarVaultSecret): Promise<PullPage>;
  findByLinkId(calendarId: string, linkId: string, secret: CalendarVaultSecret):
    Promise<ExternalEventChange | null>;  // E724 照合用 (Google: privateExtendedProperty 検索 /
                                          // MS: null 固定 — transactionId 再送で代替 §8.7)
  getBusy(range: { start: string; end: string }, secret: CalendarVaultSecret): Promise<Array<{ start: string; end: string }>>;
  refreshTokens(secret: CalendarVaultSecret, env: ProviderEnv): Promise<CalendarVaultSecret>;
    // MSA: 応答の refresh_token を必ず新 secret に反映 (呼び出し側が Vault 上書き)
}
```

| 操作 | Google (`google-api.ts`) | Microsoft (`ms-api.ts`) |
|---|---|---|
| アプリ専用カレンダー | `POST /calendar/v3/calendars` {summary:"隈部塗装 作業予定", timeZone:"Asia/Tokyo"}。既存確認は保存済み `meta.app_calendar_id` への `calendars.get` (app.created で可 — §1.4。**calendarList は不使用** — 許可スコープ外で 403 になる) | 既存確認は保存済み id へ `GET /me/calendars/{id}` (未保存時のみ `GET /me/calendars?$filter=name eq '隈部塗装 作業予定'`) → なければ `POST /me/calendars` |
| 作成 | `POST /calendars/{id}/events`。`extendedProperties.private = { kumabe_link_id, kumabe_block_id, kumabe_origin: "app" }` (key ≤44 字制約内。block_id は再接続後の link 再構築キー — §8.5) | `POST /me/calendars/{id}/events`。**`transactionId: "kmb-{linkId}"`** (リトライ二重作成防止 — ext-calendar §3.3) |
| 更新 | `PUT /calendars/{id}/events/{eid}` + `If-Match: {etag}` → 412 で ConflictError | `PATCH /me/events/{eid}` + `If-Match: {changeKey}` → 412 で ConflictError |
| 削除 | `DELETE /calendars/{id}/events/{eid}` (404/410 = 成功扱い) | `DELETE /me/events/{eid}` (同) |
| 増分 pull | `GET /calendars/{id}/events?syncToken=…&pageToken=…&maxResults=250`。**timeMin/timeMax は付けない** (syncToken と併用不可 — アプリ専用カレンダーで母数が小さいため全量でよい)。初回はパラメータ同一のフル list。**nextSyncToken は最終ページのみ** | `GET /me/calendars/{id}/calendarView/delta?startDateTime=…&endDateTime=…` → nextLink/deltaLink。**時間窓必須** (今日−30 日〜+180 日、切り直しは §8.8) |
| 削除通知 | `status: "cancelled"` のイベント | `@removed` アノテーション |
| busy 帯 | `POST /freeBusy` {items:[{id:'primary'}]} | `POST /me/calendar/getSchedule` {schedules:[account_email], availabilityViewInterval:30} (62 日未満 — zCalendarRangeQuery が保証)。**MSA の delegated では Not supported (§1.4)**: 403 / `MailboxNotEnabledForRESTAPI` 等の確定失敗時は主カレンダー `GET /me/calendarView?startDateTime=…&endDateTime=…` から busy 帯を合成するフォールバック (Calendars.ReadWrite で可 — 自動配置の過剰予約を防ぐ)。それも失敗なら busy 帯なしで degrade + 接続カードに注記 (§18 R1) |
| 時刻表記 | `start: { dateTime, timeZone: "Asia/Tokyo" }` | `start: { dateTime, timeZone: "Tokyo Standard Time" }` + 読み時 `Prefer: outlook.timezone="Tokyo Standard Time"` |

fetch 共通: `AbortSignal.timeout(15_000)`、429/403 rateLimit は 1 回だけ指数バックオフ後リトライ (それ以上は確定エラー扱い)、レスポンス parse は §3.3 の zod。

### 8.2 OAuth 接続シーケンス (X 前例と同型の 2 ルート構成 — integrations §1.1)

```
admin /admin/calendar/connections 「Google と接続」
→ GET /api/oauth/google-calendar/start
  1. requireAdmin / isGoogleCalendarConfigured() (未設定 503 E901)
  2. PKCE 生成 (src/lib/oauth/pkce.ts) + state
  3. state+codeVerifier を AES-256-GCM httpOnly cookie 'kmb_gcal_oauth' (TTL 10 分)
  4. https://accounts.google.com/o/oauth2/v2/auth へ 307:
     scope = "openid email
              https://www.googleapis.com/auth/calendar.app.created
              https://www.googleapis.com/auth/calendar.freebusy"   (§1.4 — openid email は account_email 用)
     access_type=offline & prompt=consent (refresh_token を確実に得る) & code_challenge (S256)
→ GET /api/oauth/google-calendar/callback?code&state
  1. requireAdmin → cookie 復号 + state 照合 (不一致 → ?cal_error=KMB-E720)
  2. POST https://oauth2.googleapis.com/token (code + verifier) → zGoogleTokenResponse
     refresh_token 無し → KMB-E720 で失敗扱い (X 前例の E501 相当)
  3. account_email の取得: Google は token 応答の id_token (openid email — §1.4) の email claim
     から取得 (追加 API 呼び出し不要。userinfo も calendarList も呼ばない — app.created では
     calendarList が 403 になるため)。MS は GET /me の mail ?? userPrincipalName (User.Read)
  4. ensureAppCalendar(secret, 既存 meta.app_calendar_id ?? null) → app_calendar_id
     (保存済み id があれば calendars.get で実在検証のみ — 再接続時も calendarList 検索はしない §5.2。
      404/未保存なら新規作成)
  5. vault_upsert_secret('calendar_google_oauth', JSON zCalendarVaultSecret) (service client)
  6. calendar_connections UPSERT (provider='google', status='connected',
     vault_secret_name, meta { account_email, app_calendar_id, token_expires_at,
     sync_window_*: null }, sync_token=null ← 次回 sync が初回フル同期)
  7. /admin/calendar/connections?cal_connected=google へ 307 + cookie 削除
```

Microsoft は同型 (`kmb_mscal_oauth` cookie / authority `https://login.microsoftonline.com/common` / scope `offline_access Calendars.ReadWrite User.Read` / meta.sync_window_start/end を今日−30 日〜+180 日で初期化)。エラーは throw せず query param で返す UX 規約を踏襲。

### 8.3 トークン管理 (`internal/token.ts`)

X の `getValidXAccessToken` (integrations §3.1) の移植:

1. Vault 読み → `expires_at` まで **5 分超** 残っていれば現行 access_token を使用
2. 期限接近 → CAS リース: `update calendar_connections set token_refresh_lease_expires_at = now() + interval '30 seconds' where provider = $1 and (token_refresh_lease_expires_at is null or token_refresh_lease_expires_at < now())` — affected=1 のみ refresh 実行。取れなければ 1.5 秒 sleep → Vault 再読 (他プロセスが更新済み想定)
3. refresh 実行: `grant_type=refresh_token` → 新 secret を構成して **Vault 全体上書き**
   - **Google**: 応答に refresh_token が無ければ既存値を維持 (非ローテーション)
   - **Microsoft (MSA)**: 応答の refresh_token を**必ず**採用 (ローテーション式 — 拘束条件。応答に無い場合のみ既存値維持) + meta.token_expires_at 更新
4. finally でリース解放 (NULL に戻す)
5. `invalid_grant` / 400 系の確定失敗 → connection status='expired' + last_error_code='KMB-E720' → UI 再連携バナー。**自動リトライしない**
6. **`invalid_client` は E720 と区別する** (MS クライアントシークレットの最長 24 ヶ月失効 — §18 R9): connection status='error' + last_error_code='KMB-E723' + detail「クライアントシークレットの更新 (env) が必要です」。再連携では直らないため再連携バナーへ誘導しない (誤誘導防止)

### 8.4 push (アプリ → 外部。`internal/sync-engine.ts`)

対象: `sync_status='pending_push'` の links (provider 毎、1 起床あたり最大 20 件、created_at 昇順)。

```
for link in pending_push:
  block = link.work_block
  case:
    block.status in ('scheduled','in_progress','done') and starts_at 非 NULL:
      external_event_id が NULL →
        push_claimed_at 非 NULL (前回実行が createEvent 後・link 更新前に kill された疑い — §2.3)
          → 再 create の前に findByLinkId で照合: 発見 → その external_event_id/etag を採用して
            update 経路へ (二重イベント防止)。未発見 (MS は findByLinkId=null だが transactionId
            再送が二重作成を防ぐ) → create へ進む
        単一 UPDATE で push_claimed_at=now() を刻印 (claim) → createEvent (出所マーキング付き)
      非 NULL               → updateEvent (If-Match: etag_or_change_key)
      成功 → 単一 UPDATE: external_event_id / etag_or_change_key / external_updated_at /
             external_ical_uid / last_written_hash = sha256({s,e,t} 正規化後 — §8.6) / last_pushed_at=now()
             / sync_status='synced' / push_attempts=0 (成功時のみリセット) / push_claimed_at=NULL
    block が unschedule/cancelled 由来の削除マーク (repository が sync_status='pending_push'
      + 専用フラグ列は持たず「block.starts_at IS NULL or status='cancelled'」で判定):
      external_event_id が NULL (一度も push されていない) → 外部 API を呼ばず link 行削除のみ
        (deleteEvent(null) の不正呼び出しを防ぐ明示分岐 — §13.2 テスト対象)
      非 NULL → deleteEvent → 成功 (404/410 含む) → link 行削除
  エラー分類 (internal/sync-error-classify.ts — publish-error-classify と同型):
    412/409 (ConflictError)      → sync_status='conflict' + last_error_code='KMB-E721'
                                    (次回 pull が外部変更を取り込んだ後、自動で pending_push 再送)
    404                          → **親カレンダー実在確認で 2 分岐** (P20 — イベント 404 と
                                    カレンダー 404 は同じ 404 で返るため区別必須):
                                    calendars.get / GET /me/calendars/{id} がカレンダー 404
                                    → connection status='error' + 'KMB-E723'、この provider の
                                      残り links はスキップ (全 links の誤 deleted_externally 化と
                                      「スマホ側で削除されています」誤表示を防ぐ)
                                    カレンダー実在 (イベントのみ 404)
                                    → sync_status='deleted_externally' + deleted_externally_at
    401 (AuthExpiredError)       → refresh 1 回 → 再試行 → なお 401 → connection 'expired' (E720)、
                                    この provider の残り links はスキップ
    その他 4xx/5xx (確定エラー)   → push_attempts+1。>=3 → 'conflict' + 'KMB-E723' (手動リトライ待ち)
    timeout / ネットワーク断 (結果不明) → 'conflict' + 'KMB-E724'。push_attempts は増やさない。
                                    **自動再開禁止** (§8.7 の照合のみが解除経路)
```

冪等性: 作成は **push_claimed_at claim が一次防御** (§2.3 — create 直前に単一 UPDATE で刻印・成功時 NULL 化。「claim 非 NULL + external_event_id NULL」= 実行系 kill (after() の 60 秒打ち切り等) の疑いとして再 create 前に findByLinkId 照合)。加えて Google = 出所マーキング (kumabe_link_id) による pull 時吸収 + E724 照合、MS = `transactionId` でサーバ側防止。`(provider, external_event_id)` 部分一意が最後の砦。

### 8.5 pull (外部 → アプリ)

```
connection ごと (status='connected' のみ):
  sync リース取得: sync_lease_expires_at の CAS (TTL 90 秒)。取れなければ skip (多重起床対策。
    requestSyncNow 経由なら skipped_running=true で報告 — §6.2)。**解放は sync-engine の
    finally で必ず NULL に戻す** (§8.3 token リースと同流儀。TTL 失効頼みにしない)
  cursor = sync_page_cursor ?? null / token = sync_token ?? null (null = フル同期)
  loop (最大 20 ページ / 起床):
    page = adapter.pullChanges(app_calendar_id, token, cursor, window, secret)
    410 Gone → KMB-E722: sync_token/sync_page_cursor を NULL 化 → フル再同期を即時開始
               (report.full_resync=true。links は保持 — 照合キーは external_event_id/iCalUID/
                出所マーキングの 3 経路。部分一意 index が二重採用を拒否)
    Graph 安全弁: 同一 skiptoken が 2 回連続 or 20 ページ超過 → KMB-E725:
               connection.last_error_code='KMB-E725' + **cursor と sync_token (deltaLink) を両方破棄**
               + 中断。同一 JST 日内は当該 provider の pull を skip (バックオフ — 同じ deltaLink 系列で
               5 分毎に同一バグを踏む空転を防ぐ)。復旧経路は日次 maintenance (§8.8) が
               last_error_code='KMB-E725' を発火条件として窓を切り直し → フル再同期 (E722 と同経路)
    各 change:
      link = links[provider, external_event_id] ?? links[provider, ical_uid 照合]
             ?? (Google のみ) appLinkId (出所マーキング) → link_id 直接解決
      appLinkId 解決した link が**別の** external_event_id を既に持つ場合 (kill 後再 create 等で
        生まれた重複イベント): link の既存 id を正とし、change 側のイベントを deleteEvent
        (重複掃除 — 部分一意 index は二重採用を防ぐだけで外部の重複表示は消えないため)
      link なし → Google で kumabe_origin='app' かつ appBlockId (kumabe_block_id) が実在の
        配置済みブロックを指し、(block, provider) に link が無い場合は link を**再構築**
        (external_event_id/etag を採用し synced — disconnect→再接続後の二重イベント防止 §6.2)。
        それ以外は外部生イベント (P19): skip + console ログ (report 対象外)
      link あり:
        自己エコー判定 (§8.6) → エコー → echoes_rejected++ / continue
        removed → sync_status='deleted_externally' + deleted_externally_at=now()
                  (エラーコードは付さない — 異常ではなく状態)。block は不変 (即削除禁止)
        終日化 (isAllDay — P31) → 時刻としては取り込まない。block 不変のまま当該 link を
                  'pending_push' 化し、アプリの時刻付きイベントを次回 push で再送して復元
        時刻変更 → work_blocks.starts_at/ends_at を service client で更新 (updated_at が進む
                  が placeBlock 経路ではないため**変更元 link には** pending_push を立てない —
                  エコー防止)。**変更元以外の接続済み provider の link は 'pending_push' 化**
                  (P15 の両方向伝播 — 両 provider 接続時、他方カレンダーへも 5 分 + 1 実行以内
                  (§16) に反映。§8.8 の日次自己修復に依存させない)。
                  link: etag/changeKey/external_updated_at 更新 + last_pulled_at + sync_status:
                    'synced' のまま / 'conflict'(E721) だった場合 → 'pending_push' に戻し
                    アプリ側内容 (タイトル等) を次回 push で再送 (E721 の自動解決)
        タイトルのみ変更 → 内容はアプリが正 (P18): etag 類だけ記録し block は不変
  ラウンド完了 (nextSyncToken / deltaLink 受領) → sync_token 更新 + sync_page_cursor=NULL
  **フル再同期のラウンド完了時のみ** (410/E722・窓切り直し・再接続後初回 — sync_token=NULL からの
  ラウンド): 開始時に snapshot した既存 link 集合 (external_event_id 非 NULL) のうち今回の全件で
  **未観測**のものを sync_status='orphaned' へ遷移 (逆方向突合 — §5.3 orphaned の生成経路。
  token 失効中に外部で削除/別カレンダー移動されたイベントの検出。removed として観測済みのものは
  deleted_externally が優先。Graph は sync_window 外の starts_at を持つ block の link を突合対象外
  とする — 窓外の未来/過去イベントを誤 orphaned 化しない)
  途中終了 (ページ上限) → sync_page_cursor 保存 (次起床で継続。**nextSyncToken 最終ページ問題
  への対策** — 途中放棄して最初からやり直さない。フル再同期の逆方向突合もラウンド完了まで持ち越す)
  connection.last_pulled_at=now()
```

フィールド所有権 (競合解決の原則 — ext-calendar §3.3): **時刻と存在は外部の直近操作が正 / タイトル・種別・案件紐づけ・工数はアプリが正**。last-writer-wins は時刻のみに適用。

### 8.6 自己エコー棄却 (`internal/echo.ts` — 純関数)

pull した change がアプリ自身の直前 push の反響かを 3 段で判定 (いずれか成立で棄却):

1. `change.etagOrChangeKey === link.etag_or_change_key` (push 応答で保存した値と同一 = 変化なし)
2. `change.externalUpdatedAt <= link.last_pushed_at + 5 秒マージン` **かつ** `sha256({s, e, t}) === link.last_written_hash`。**hash 前の正規化必須** (push 書込時・pull 判定時とも同一の純関数を通す): s/e は **UTC エポック ms へ正規化** — push は Asia/Tokyo 表記で書き、pull は provider 依存の表記 (Google = offset 付き RFC3339 / Graph = 小数 7 桁 + timeZone 別フィールド) で返るため、文字列のまま hash すると同一時刻でも恒常的に不一致になり rule2 が死ぬ。t は trim 後
3. removed change について: 直前にアプリが deleteEvent した link (行削除済み) は link 不在で自然に skip

判定関数: `isSelfEcho(change, link): boolean` — 入力/出力とも plain object。境界値 (マージン丁度・hash 不一致で updated だけ古い等) を単体テストで固定する (§13)。

### 8.7 結果不明 (KMB-E724) と手動照合 (00-overview §6.2「自動再開禁止」の実装)

- 発生: push の timeout / ネットワーク断 (応答を受信できていない — 外部に書けたか不明)
- 処置: `sync_status='conflict'` + `last_error_code='KMB-E724'`。**worker は以後この link を自動処理しない**
- UI: /admin/calendar/connections の「同期の問題」一覧 (§10.4) に表示。「照合して再開」ボタン → `reconcilePushUnknown(linkId)`:
  - **Google**: `events.list?privateExtendedProperty=kumabe_link_id%3D{linkId}` で検索 (syncToken 非併用の単発クエリ)。発見 → 外部 id/etag を採用し synced。未発見 → pending_push に戻して再送
  - **Microsoft**: `transactionId` により再送が二重作成にならないため、pending_push に戻して再送 (= 照合を再送で代替。既に作成済みなら Graph が既存イベントを返す)
- E723 (確定エラー 3 回) の link も同じ一覧に出し、「再送」ボタン → `resendConflictedLink(linkId)` (§6.2) で push_attempts=0 + pending_push に戻す (admin 明示操作)。外部 API を呼ばない軽量 DB 操作であり、外部照合を行う reconcilePushUnknown (E724 専用) とはメソッドを分離する — 流用すると E723 に不要な privateExtendedProperty 検索が走る

### 8.8 runCalendarMaintenance (日次 JST 04:00)

| 検査 | 内容 | 異常時 |
|---|---|---|
| トークン健全性 | connected の各 provider で refresh を空実行 (期限 24h 以内のもののみ)。MSA はこれが「90 日非アクティブ失効」の延命を兼ねる | invalid_grant → 'expired' + E720 (バナー) |
| Graph ローリングウィンドウ | `meta.sync_window_end − 今日 < 90 日` **または `last_error_code='KMB-E725'`** (安全弁発動の復旧 — §8.5) → 窓を今日−30 日〜+180 日へ切り直し、deltaLink 破棄 → 計画的フル再同期 (E722 と同経路、last_full_resync_at 記録。完了時に E725 をクリア) | — |
| アプリ専用カレンダー実在 | `calendars.get(app_calendar_id)` / `GET /me/calendars/{id}` で 404 → P20 (calendarList 不使用 — §1.4) | status='error' + E723 → UI「作り直す」 |
| push 漏れ自己修復 | scheduled/in_progress/done かつ starts_at 非 NULL のブロックで、接続済み provider の link が無い/last_pushed_at < block.updated_at のものを pending_push で upsert (placeBlock 時の service client 不調の取りこぼし回収)。**加えて cancelled / starts_at NULL のブロックに external_event_id 非 NULL の link が pending_push 以外で残る場合も pending_push 化** (削除マークの取りこぼし回収 — cancelOpenBlocksForDeal 等の書込不調時の自己修復 §6.2) | — |
| work_log 再送 | 直近 7 日の done ブロック (deal_id 非 NULL) へ appendActivity を冪等再送 (created:false が正常) — §7.3 の自己修復 | 失敗は E902 ログ |
| 滞留警告 | pending_push が 1 時間超滞留 / conflict (E723/E724) / deleted_externally の件数を集計 → ダッシュボード警告 (Phase 5) | — |

### 8.9 Phase 2: push 通知の後付け契約 (v1 実装しない — 裁定 J4 の「dirty → polling」)

- 受け口 (予約): `POST /api/webhooks/google-calendar` (X-Goog-Channel-Token 照合) / `POST /api/webhooks/ms-calendar` (validationToken エコー + clientState 照合)。**処理は `calendar_connections.pull_requested_at = now()` を立てるだけ** (0030 で列は確保済み)
- sync worker 側の対応 (v1 から実装しておく安全な範囲): pull_requested_at 非 NULL の接続を優先処理し、処理後 NULL 化。v1 では常に NULL のため挙動不変
- チャネル/サブスクリプション更新ジョブ (Google watch 再作成・Graph PATCH 延長) は Phase 2 で maintenance に追加する。polling は Phase 2 以後も**廃止しない** (取りこぼし保険 — 公式推奨構成)

---

## 9. Server Actions・API route・ジョブ仕様

### 9.1 API route

| route | 仕様 |
|---|---|
| `POST /api/jobs/calendar-sync` | `maxDuration = 60`。`isJobsSecretConfigured()` 未設定 503 (E901) / `x-jobs-secret` 不一致 401 (E201) / 202 即応 + `after()` で `schedulingFacade.runCalendarSync({ mode: "service" })`。結果 report を console.log、エラーは KMB-E901 console.error (publish route と完全同型) |
| `POST /api/jobs/calendar-maintenance` | 同型。`runCalendarMaintenance({ mode: "service" })` |
| `GET /api/oauth/google-calendar/start` / `callback` | §8.2。`export const dynamic = "force-dynamic"` |
| `GET /api/oauth/ms-calendar/start` / `callback` | 同上 |

### 9.2 Server Actions (`src/app/admin/calendar/actions.ts` ほか。全て先頭 `requireAdmin()` + Zod parse。actions.ts は `export const maxDuration = 60` を明示 — requestSyncNowAction の手動同期上限 (§6.2) と併せて実行時間を保証)

| Action | 入力 (Zod) | facade 呼び出し | 成功時 revalidate |
|---|---|---|---|
| `saveWorkTypeAction` | zWorkTypeInput + id/expectedUpdatedAt | saveWorkType | /admin/calendar/types |
| `deleteWorkTypeAction` | uuid | deleteWorkType (E702 → 「無効化してください」トースト) | 同上 |
| `saveWorkTemplateAction` | zWorkTemplateInput + id/expectedUpdatedAt | saveWorkTemplate | /admin/calendar/templates |
| `deleteWorkTemplateAction` | uuid | deleteWorkTemplate | 同上 |
| `createBlockAction` | zWorkBlockInput | createBlock | /admin/calendar |
| `placeBlockAction` | blockId + zPlaceBlockInput + expectedUpdatedAt | placeBlock | /admin/calendar |
| `unscheduleBlockAction` | blockId + expectedUpdatedAt | unscheduleBlock | 同上 |
| `updateBlockAction` | blockId + zUpdateWorkBlockInput + expectedUpdatedAt | updateBlock | 同上 |
| `transitionBlockAction` | blockId + zBlockTransition + expectedUpdatedAt | transitionBlock | 同上 |
| `deleteBlockAction` | blockId | deleteBlock | 同上 |
| `recordActualAction` | blockId + zActualInput + expectedUpdatedAt | recordActual | /admin/calendar + /admin/deals/[id] |
| `generateBlocksAction` | (sales 側 actions.ts — app 層合成 §7.5。本表は参照のみ) | SalesFacade → SchedulingFacade | /admin/calendar |
| `proposePlacementAction` | zProposePlacementInput | proposeBlockPlacement (副作用なし) | — |
| `applyPlacementProposalsAction` | PlacementProposal[] (再 Zod: uuid + zIsoDatetime 対 + expected_updated_at) | placeBlock(…, expected_updated_at) を順次 — 提案生成後の他更新は E103 で検知 (途中失敗は中断し件数返却) | /admin/calendar |
| `disconnectCalendarAction` | zCalendarProvider | disconnectCalendar | /admin/calendar/connections |
| `resolveExternalDeletionAction` | linkId + zExternalDeletionResolution | resolveExternalDeletion | 同上 + /admin/calendar |
| `reconcilePushUnknownAction` | linkId | reconcilePushUnknown (E724 専用 — §8.7) | 同上 |
| `resendConflictedLinkAction` | linkId | resendConflictedLink (E723 専用 — §8.7) | 同上 |
| `resolveOrphanedLinkAction` | linkId + zOrphanedLinkResolution | resolveOrphanedLink (§5.3/§10.4) | 同上 + /admin/calendar |
| `requestSyncNowAction` | — | requestSyncNow (report をトースト表示。skipped_running=true は「同期が進行中です」— §6.2) | /admin/calendar |
| `cancelOpenBlocksForDealAction` | dealId | cancelOpenBlocksForDeal (crm の案件画面から — app 層) | /admin/deals/[id] + /admin/calendar |

`resolveExternalDeletionAction` の 3 択の意味 (P17):

- `unschedule`: block → backlog (starts/ends NULL 化) + link 削除。「予定は消えたが仕事は残っている」
- `cancel_block`: block → cancelled + link 削除。「仕事ごと無くなった」
- `repush`: link の external_event_id/etag/hash を破棄して pending_push。「消されたのは誤操作 — 復元する」

### 9.3 ジョブ (pg_cron — 登録は 0031 §2.4)

| jobname | 周期 | 起床先 | 上限 |
|---|---|---|---|
| `kmb-calendar-sync-worker` | `*/5 * * * *` | POST /api/jobs/calendar-sync | push 20 links + pull 20 ページ / provider / 起床 |
| `kmb-calendar-maintenance-worker` | `0 19 * * *` (JST 04:00) | POST /api/jobs/calendar-maintenance | — |

---

## 10. 管理画面 UI 仕様

共通規約 (admin-ui-auth §4/§5 準拠): `export const dynamic = "force-dynamic"` / `metadata.title` / searchParams は await / データ取得は facade / `Surface`・`PageHeader`・`DataTableShell` (`src/app/admin/_ui/`) / トーストは sonner / フォームは react-hook-form + zodResolver (contracts の Zod 共用) / 楽観排他 hidden updated_at 生文字列。

**shadcn 追加分 (本モジュール Issue の受入基準に明記 — J11)**: `popover` / `calendar` / `date-picker` / `dropdown-menu` (いずれも現状未導入を実測確認済み。`command` は crm 側 Issue)。

### 10.1 画面一覧

| ルート | ナビ | 内容 |
|---|---|---|
| `/admin/calendar` | カレンダー | 週/月ビュー + 未配置トレイ + キャパチップ (§10.2) |
| `/admin/calendar/types` | (カレンダー内タブリンク) | 作業種別マスタ (§10.3) |
| `/admin/calendar/templates` | 同上 | 工数テンプレート (§10.3) |
| `/admin/calendar/connections` | 同上 | 外部カレンダー接続 + 同期の問題 (§10.4) |

4 画面の先頭に共通のセカンダリタブ (`Tabs` 部品、リンク遷移): 予定表 / 作業種別 / テンプレート / 外部連携。

### 10.2 `/admin/calendar` (中核画面)

構成 (Server Component が `getCalendarRange` + `getBacklogBlocks` + `getWeeklyCapacity` + `getExternalBusy` + `listSyncIssues` を並列取得 → Client `CalendarBoard` へ):

```
┌ PageHeader「カレンダー」 desc=キーボード操作説明
│  actions: [今週あと 12.0 時間] チップ (remaining<0 は赤字) / [今すぐ同期] / [ブロックを作る]
├ セカンダリタブ (予定表 | 作業種別 | テンプレート | 外部連携)
├ ツールバー: [◀ 前週] [今日] [翌週 ▶]  [週|月] 切替 (Tabs)  期間ラベル  同期問題バッジ (N 件 → connections へ)
├ ┌─────────── 週ビュー (grid: 時刻列 + 7 日列, 30 分行, 07:00〜21:00 表示・全日スクロール) ──────────┐
│ │ ブロック札: work_type.color 塗り + タイトル + planned_hours。選択中 = border-l-soul          │
│ │ 非拘束 (consumes_capacity=false): 斜線ハッチ + 60% 透明 + ⏳ 接頭辞 (P1)                       │
│ │ 外部 busy 帯: 灰色帯 (読み取り専用、クリック不可)                                              │
│ │ deleted_externally の link を持つブロック: 赤点線枠 + ⚠ (クリックで解決ダイアログ)              │
│ └───────────────────────────────────────────────────────────────────────────────────────┘
├ 未配置トレイ (右サイド w-64): backlog 一覧 (種別色チップ + タイトル + h)。[自動で並べる] ボタン
└ 月ビュー: 日セルに種別色ドット + 件数。日クリック → その週の週ビューへ
```

操作:

- **ドラッグ配置**: 未配置トレイ → グリッドへ Pointer DnD (30 分スナップ)。ドロップ = `placeBlockAction` (ends = starts + planned_hours 既定)。既存札のドラッグ = 移動、下端ドラッグ = ends_at 変更 (リサイズ)
- **自動で並べる**: `proposePlacementAction` → 提案札を半透明プレビュー表示 → [確定] で `applyPlacementProposalsAction` / [やめる] で破棄 (§7.4)
- **ブロック詳細 Dialog** (札クリック / Enter): 案件リンク・種別 (Select)・タイトル・予定 h・メモ・配置 (date-picker + 時刻 Select 30 分刻み — キーボードでの配置経路)・状態操作ボタン群 [着手] [実績を入れる] [未配置に戻す] [キャンセル]。実績入力サブフォーム: actual_hours (step 0.25) + performed_on (date-picker、既定=今日 JST)。予実差を「予定 4.0h / 実績 5.0h (+1.0h)」で常時表示
- **同期状態**: 札の右下に provider アイコン (G/M) + sync_status ドット (synced=緑 / pending_push=黄 / conflict=橙 / deleted_externally=赤)

キーボード操作 (E2E 必須チェックリスト — 全項目):

| キー | 動作 |
|---|---|
| ↑ / ↓ | 未配置トレイ・ブロック一覧の行移動 |
| ← / → | 週ビューで選択札の日移動 (placeBlockAction。楽観排他付き) |
| Shift + ↑/↓ | 選択札を 30 分前後へ移動 |
| Enter | 選択札の詳細 Dialog を開く |
| Esc | Dialog / プレビューを閉じる |
| Cmd/Ctrl + S | Dialog 内フォーム保存 |
| Tab | 論理順フォーカス (ツールバー → トレイ → グリッド → Dialog) |
| T | 「今日」へジャンプ |
| W / M | 週 / 月ビュー切替 |

### 10.3 `/admin/calendar/types` / `/admin/calendar/templates`

- **types**: `DataTableShell` 一覧 (色スウォッチ / label / key / 拘束・非拘束 Badge / 既定 h / 並び順 / 有効)。行 Enter or クリック → 編集 Dialog (react-hook-form + zWorkTypeInput)。フィールド順は表示名→色→拘束→既定時間/並び順→有効→「詳細設定」折りたたみ (既定 閉。key を格納)。色入力は `popover` 内プリセットパレット 12 色 (日本語色名付き aria-label/title、選択中は ring 表示、矢印キーで移動) + hex Input (blur/Enter 時に小文字化/#補完/3桁展開で正規化、不一致は日本語エラー表示のみでフォーム値を汚染しない)。共通部品は `src/app/admin/_ui/color-picker.tsx` の `ColorPicker` (Issue #93)。新規作成時は表示名から key を自動生成 (`generateWorkTypeKey` — ASCII ラベルはスラッグ化、非 ASCII は `wt_` + タイムスタンプへフォールバック。手動編集後は上書きしない)。新規作成後の key は変更不可 (表示のみ — ブロック/テンプレの参照キーのため。Issue #97)。削除は E702 時に「使用中のため無効化してください」トースト
- **templates**: 一覧 (name / grade_key / size_key / 明細数 / 有効)。編集 Dialog: name / grade Select / size Select (**候補は app 層 page.tsx が PricingFacade.getActivePriceTable() から取得して props 渡し** — §1.3。空欄 = 全対象) / items 行エディタ (種別 Select + hours + 並び順、行追加/削除、`dropdown-menu` で行操作)。アクティブ combo 重複は E101 インラインエラー。**grade/size Select の「空欄 (全対象)」は必ず `null` に正規化して送信する** (空文字 `''` は zWorkTemplateInput の min(1) が E101 で拒否 — §3.1。`''` は部分一意 index の coalesce では NULL と同一視される一方 §7.1 カスケード解決では別値になるため、契約レベルで排除する)
- キーボード: ↑↓/Enter/Esc/Cmd+S (共通)

### 10.4 `/admin/calendar/connections`

- provider カード ×2 (Google / Microsoft — /admin/channels の connection-cards 前例): status Badge (未接続/接続中/要再連携/エラー) / account_email / アプリ専用カレンダー名 / token_expires_at / last_pulled_at / [接続する|再連携|切断] / env 未設定時は degrade バナー
- query param フィードバック: `?cal_connected=google` → toast.success / `?cal_error=KMB-E720` → toast.error (エラーコード → getErrorInfo メッセージ)
- **同期の問題** セクション (`listSyncIssues`): 表 (ブロック / provider / 状態 / エラー / 検知時刻) + 行アクション:
  - deleted_externally → [未配置に戻す] [キャンセルする] [作り直して再送] (3 択 — §9.2)
  - conflict + E724 → [照合して再開]
  - conflict + E723 → [再送]
  - orphaned → [再送] [リンクを削除]
- [今すぐ同期] → report トースト「取込 3 / 反映 2 / エコー棄却 4 / 競合 0」

### 10.5 他画面への露出 (参照のみ — 実装は各所有画面の Issue)

- `/admin` ダッシュボード: 「今週あと N 時間」KPI カード (Phase 5 統合 — 00-overview §9.3)
- `/admin/deals/[id]` (crm): 予実サマリ (getDealWorkSummary) + [作業ブロックを見る] リンク + lost 時の一括キャンセル提案 (§5.4)
- `/admin/settings`: 「週間稼働」タブ (§3.4)

### 10.6 モバイル対応 (最小レスポンシブ仕様 — ブリーフ絶対条件「スマホ/PC で 10 秒で操作」)

予定の**閲覧**の主動線はスマホ側の Google/Outlook カレンダーアプリ (§0.3) に逃がすが、**実績入力 (§0.4)・同期問題の解決 (§10.4)・未配置ブロックの配置はアプリ UI でしか完結しない**ため、モバイル幅 (< md 768px) の最小仕様を定める:

- `/admin/calendar` はモバイル時 **日ビュー + リスト**に切替 (7 日グリッドは描画しない): 日送りヘッダ (◀ 今日 ▶) + 当日ブロック札の時刻順リスト + キャパチップ。未配置トレイは下部アコーディオン
- 配置は**ドラッグ不要の代替経路のみ**: 未配置札の [この日に置く] ボタン → 日 (date-picker) + 開始時刻 (30 分刻み Select) のシート → `placeBlockAction`。Pointer DnD はタッチではスクロールと競合するため md 未満で無効化 (キーボード代替 §10.2 と同思想のタッチ代替)
- ブロック詳細 Dialog はモバイルでは全画面シート。**実績入力 (actual_hours + performed_on) と状態操作ボタン群をファーストビュー内**に置く (「終わったら数字をひとつ入れる」を 10 秒で完結)
- `/admin/calendar/connections` の解決アクション (3 択 / 照合 / 再送) はモバイル幅で 1 列に折り返し、全ボタンがタップ可能であること
- タップターゲット 44px 平方以上。md 以上 (PC) の週グリッド仕様 (§10.2) は変更なし

---

## 11. エラーコード表 (③ — 採番 canonical は 00-overview §3.3。**本書は recovery 文言の詳細化のみ・追加なし**)

| コード | 意味 | 主な発生箇所 | admin 向けメッセージ / 復旧アクション |
|---|---|---|---|
| KMB-E701 | ブロック時間帯が不正 (開始 ≥ 終了 / 片側のみ NULL) | placeBlock / createBlock / DB check | 「開始と終了を見直してください」— フィールドエラー表示 |
| KMB-E702 | 作業種別/テンプレートの参照不整合 (無効化済み・不在・使用中削除・FK 違反) | 原案生成 / マスタ保存・削除 | 「使用中または無効な種別です。無効化するか別の種別を選んでください」 |
| KMB-E703 | ブロック状態遷移が不正 (§5.1 の遷移表外。done の削除・**外部未削除 link が残るブロックの物理削除** (§5.1-5)・link 解決操作の対象状態不一致 等) | transitionBlock / deleteBlock / placeBlock / resolveExternalDeletion・resolveOrphanedLink・resendConflictedLink | 「この状態では実行できません」— 現在状態を添えて表示 (外部未削除 link は「外部カレンダーへの反映待ちです」) |
| KMB-E704 | 明細→ブロック原案生成で対応テンプレート/種別が解決不能 (**全滅時のみ**) | generateBlocksFromLines | 「段取りを自動生成できませんでした。テンプレートを登録するか手動で作成してください」 |
| KMB-E705 | 実績入力の対象状態が不正 (未配置/キャンセル済みへの実績) | recordActual | 「先にカレンダーへ配置してから実績を入れてください」 |
| KMB-E720 | カレンダー未接続または接続失効 (invalid_grant・refresh 不能) | OAuth callback / refresh / sync | 「カレンダーの再連携が必要です」— connections 画面の再連携ボタンへ誘導 |
| KMB-E721 | 外部書込の競合 (etag/changeKey 不一致 = 412/409) | push | 自動解決 (次回 pull → 再送)。UI は conflict ドットのみ |
| KMB-E722 | 同期トークン失効 (410 Gone) | pull | 自動でフル再同期。report.full_resync=true。連発時のみ警告 |
| KMB-E723 | 外部カレンダー API の確定エラー (4xx/5xx 3 回・専用カレンダー消失・invalid_client = MS シークレット失効 §8.3-6) | push / maintenance / token refresh | 「同期に失敗しました」— [再送] (resendConflictedLink) / [作り直す] / シークレット失効時は env 更新 (§18 R9 — 再連携では直らない) |
| KMB-E724 | 外部同期の結果不明 (timeout/接続断)。**自動再開禁止** | push | 「反映結果を確認できませんでした」— [照合して再開] (§8.7) |
| KMB-E725 | 同期ループ安全弁発動 (ページ上限 20 / 同一トークン再来) | pull (Graph 主) | 自動で中断 (sync_token/cursor 破棄 + 当日 pull バックオフ) → **日次 maintenance の窓切り直し + フル再同期で自動復旧** (§8.5/§8.8 — 発火条件に E725 を含む)。連発時は要調査警告 |
| (共用) KMB-E101 | 入力検証エラー (key 重複・weekStart 非月曜・combo 重複含む) | 全 Action | フィールドエラー |
| (共用) KMB-E103 | 楽観排他競合 (updated_at 不一致) | 更新系全部 | 「他の操作と競合しました。再読み込みしてください」 |
| (共用) KMB-E201/E202 | 未認証 / 非管理者 | 全 Action・route | ログイン誘導 |
| (共用) KMB-E901/E902 | インフラ異常 / 通知系ベストエフォート失敗 | worker・facade | ログ + ダッシュボード警告 |

errors.ts への登録は M0 (00-overview §3.6-6) で一括実施済みが前提。本書の文言は `KMB_ERRORS` の message/recovery に反映する。

## 12. 差分表示仕様 (⑩)

**該当なし** (00-overview §8 の裁定どおり)。理由: 作業ブロックは現在値のみで版管理せず (1 人運用で監査需要がなく、電帳法対象は帳票のみ)、activity ('work_log') も不変。予定 h vs 実績 h の並記 (§10.2 詳細 Dialog / §10.5 deal 画面) は「差分表示」ではなく併記表示であり、版間 diff 機構は持たない。外部カレンダーとの差異は sync_status ドット + 同期の問題一覧 (§10.4) で表現し、フィールド単位の diff ビューは作らない (v1)。

---

## 13. テスト戦略 (② — implementer+tester ペア・2 回連続 PASS を可能にする粒度)

### 13.1 レイヤ表

| レイヤ | 対象 | 手段 |
|---|---|---|
| 単体 (Vitest、実 DB なし) | テンプレ展開 / キャパ計算 / エコー棄却 / 状態遷移ガード×2 / 自動提案配置 / 外部 API ラッパ (fetch モック) / トークン refresh (MSA ローテーション) | 純関数 + fetch モック |
| 契約 parity | §3.1 記載の 4 enum ↔ DDL check | `contracts-ddl-parity.test.ts` 追加 |
| 結合 (DB、supabase start) | RLS マトリクス §4.2 全セル (anon/admin/service 3 クライアント) / links の unique 制約 / work_blocks の check 制約 / 楽観排他 CAS / settings 'work_capacity' backfill | 実 DB |
| 結合 (API、msw) | OAuth start/callback (state 不一致・refresh_token 欠落) / /api/jobs/* secret / sync engine E2E (Google・Graph を msw でモック: 410・412・timeout・無限ページング) | **外部 API 実呼び出しは CI 禁止** (既存規約) |
| E2E (Playwright / Chrome MCP) | §13.3。キーボード全項目必須 | 本番前に人が実行 |

### 13.2 テストファイル × 子 Issue 対応 (00-overview §9.2 の必須 4 本を含む)

| 子 Issue | テストファイル | 必須ケース (受入基準に転記) |
|---|---|---|
| #3c-1 DDL+種別/テンプレ | `tests/scheduling-template-expand.test.ts` | work_type_key 直行 / カスケード 4 段 / 無効種別除外 / 数量非乗算 (P9) / 全滅→空 blocks / 部分 skip 理由文言 |
| 〃 | `tests/scheduling-ddl-parity` (contracts-ddl-parity 追加分) | 4 enum 一致 |
| 〃 | `tests/scheduling-rls.integration.test.ts` | §4.2 全セル×3 ロール (links の authenticated INSERT 拒否含む) / seed 冪等 / work_capacity バックフィル |
| #3c-2 ブロック+キャパ+画面 | `tests/scheduling-capacity.test.ts` | JST 週境界 (月曜 00:00 丁度・日曜 23:59) / 非拘束除外 / done 計上 / cancelled 除外 / 負残 / 非月曜 E101 / キー欠落フォールバック (P28) |
| 〃 | `tests/scheduling-block-state.test.ts` | §5.1 遷移表全セル (25 組) / E701 ペア検証 / done 訂正許可 / 削除ガード (外部未削除 link 残置ブロックの DELETE 拒否 E703 含む — §5.1-5) / createBlock の status 導出 (配置入力→scheduled §5.1-6) |
| 〃 | `tests/scheduling-auto-place.test.ts` | earliest-fit / 30 分スナップ / 営業時間外回避 / 非拘束の夜間跨ぎ / 14 日探索打ち切り / busy 帯回避 |
| 〃 | `tests/scheduling-actual.integration.test.ts` | recordActual → appendActivity 冪等 (二重確定で created:false) / deal なしスキップ / E705 |
| #3c-3 Google 同期 | `tests/scheduling-echo-reject.test.ts` | etag 一致 / hash+マージン一致 / マージン境界 (5s 丁度) / 非エコー通過 / removed 判定 / **時刻表記揺れの正規化** (offset 付き ISO vs 小数 7 桁+TZ 別フィールドで hash 一致 — §8.6) |
| 〃 | `tests/scheduling-sync-state.test.ts` | §5.3 遷移ガード全パス (E721 自動復帰 / E724 自動処理禁止 / deleted_externally 3 択) |
| 〃 | `tests/scheduling-google-api.test.ts` (fetch モック) | nextSyncToken 最終ページのみ / pageToken 継続 / 410→GoneError / If-Match 412→ConflictError / privateExtendedProperty 検索 / timeout→結果不明分類 / start.date → isAllDay change (P31) |
| 〃 | `tests/scheduling-sync-engine.integration.test.ts` (msw+DB) | push→pull エコー 0 / 410 フル再同期で重複 0 (部分一意) / **フル再同期の逆方向突合で未観測 link → orphaned** (§8.5) / E724 → 照合解決 / push claim (create 後 kill 注入) → findByLinkId 照合で二重作成なし (§8.4) / 削除待ち未 push link (external_event_id NULL) は外部 API 非呼出で行削除 (§8.4) / push 404 のカレンダー 404 / イベント 404 分岐 (P20) / 両 provider 接続時の外部時刻変更 → 他方 link pending_push 伝播 (P15) / push 漏れ自己修復 (削除マーク取りこぼし回収含む) |
| 〃 | `tests/scheduling-token-refresh.test.ts` | CAS リース単一実行 / 期限マージン / invalid_grant→expired |
| #3c-4 Microsoft 同期 | `tests/scheduling-ms-api.test.ts` | deltaLink/nextLink / @removed / 窓必須 / 同一 skiptoken 検知 E725 (sync_token 破棄 + 当日バックオフ §8.5) / ページ上限 / transactionId 付与 / **MSA refresh_token 毎回上書き** / isAllDay 検知 (P31) / **getSchedule 失敗 → calendarView busy 合成フォールバック** (§8.1) / invalid_client → E723 分類 (§8.3-6) |
| 〃 | (sync-engine.integration に provider=microsoft のケース追加) | resyncRequired 410 / 窓切り直し |

カバレッジ: 契約/計算/状態遷移ガードは分岐 100%、その他 80% 目安 (既存規約)。運用: implementer+tester ペア、修正→再検証ループ、**2 回連続 PASS で完了**。

### 13.3 E2E チェックリスト (本番前・人が実行)

1. 種別追加 → テンプレ作成 → (sales で受注) → ブロック生成 → ドラッグ配置 → Google アプリ専用カレンダーに 5 分内反映
2. Google 側で予定を移動 → 5 分内にアプリへ逆同期・エコーループなし (受入 A8 のモジュール分)
3. Google 側で予定を削除 → 赤点線 + 解決 3 択が全部機能
4. 実績入力 → 案件タイムラインに work_log が 1 件だけ載る (二重確定しても増えない)
5. キャパチップが手計算と一致 (拘束のみ・非拘束除外)
6. **キーボード全項目** (§10.2 の表を上から全部 — E2E キーボードチェックリスト規約)
7. Microsoft 接続 (実機検証 C4 解消後): 接続 → push → 外部移動 → 逆同期 → refresh 2 回後もトークン有効 (ローテーション保存の証明)
8. モバイルビューポート (390×844): 日ビュー表示 → [この日に置く] で配置 → 実績入力 → 同期問題の解決操作が全てスマホ幅で完結する (§10.6)

---

## 14. 移行計画と受入基準 (⑦)

### 14.1 移行手順

既存データの移行は**なし** (全テーブル新規。既存 works/deals 等への変更なし)。0029 の seed (種別 5 件) と work_capacity バックフィルは冪等 (`on conflict do nothing`) で、ロールバックは `delete from work_types where key in (...) and (参照ゼロ)` + `delete from site_settings where key='work_capacity'` の逆順スクリプトを migration ヘッダに注記する (seed_manifest は使わない — マスタ 5 行のみのため過剰)。

適用順序: 0021〜0028 (M0/crm/sales) → **0029 → 0030 → 0031** (帯内順序固定。0029 は deals/documents FK のため 0023/0026 適用済みが前提 — §2.2 ヘッダに明記)。本番適用は手動 (HANDOFF §3 運用)。

### 14.2 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| C1 | 0029〜0031 適用後、既存テスト全 PASS + parity 4 enum PASS | CI |
| C2 | RLS: §4.2 の全セルが 3 クライアント検証で期待どおり (特に calendar_event_links の authenticated 書込拒否) | 結合テスト |
| C3 | 受注明細 → ブロック原案が生成され、skipped 理由が表示される (全滅時 E704) | 結合 + 実機 |
| C4 | キャパシティ: 拘束 3h×2 + 非拘束 24h 配置で booked=6.0 / 非拘束が含まれない | 結合テスト + 実機 |
| C5 | 配置 → 5 分以内に Google アプリ専用カレンダーへ反映 → 外部移動 → 5 分以内に逆同期 → **エコー再送ゼロ** (report.echoes_rejected として観測) | 実機 (受入 A8) |
| C6 | 外部削除 → ブロックは消えず deleted_externally 表示 → 3 択が全部機能 | 実機 |
| C7 | 410 を強制 (トークン破棄) → フル再同期で外部イベント・link の重複ゼロ + **token 失効中に外部削除されたイベントの link が orphaned として検出される** (§8.5 逆方向突合) | 結合 (msw) + 実機 |
| C8 | push timeout 注入 → E724 conflict → 「照合して再開」で解決・二重イベントなし | 結合 (msw) |
| C9 | 実績入力 → deal タイムラインに work_log 1 件 (冪等)。予実サマリが deal 画面に出る | 実機 |
| C10 | pg_cron 2 ジョブが cron.job に登録され、Vault 未設定時は raise notice で空振り | 本番 SQL 実測 |
| C11 | MSA: refresh 2 回連続後も同期継続 (ローテーション上書きの証明) | 実機 (C4 解消後) |
| C12 | キーボード操作 §10.2 全 PASS | E2E |

---

## 15. 規模見積り (⑧ — 00-overview §13 の scheduling 行 〜7,500 の内訳)

| 子 Issue | 内容 | 概算 (実装+テスト行) |
|---|---|---|
| #3c-1 | DDL 0029 + contracts 写経/拡張 + repository + 種別/テンプレ画面 + parity/RLS テスト | 〜1,600 |
| #3c-2 | ブロック CRUD/状態機械 + キャパ + カレンダー画面 (週/月/DnD/Dialog/自動提案) + shadcn 4 部品導入 | 〜2,700 |
| #3c-3 | 0030/0031 + OAuth Google 2 ルート + token/vault + provider 抽象 + google-api + sync-engine (push/pull/エコー/410/E724) + connections 画面 + jobs route ×2 | 〜2,200 |
| #3c-4 | ms-api + Graph delta/窓切り直し/E725 + MSA ローテーション + msw テスト | 〜1,000 |
| **計** | | **〜7,500** |

ランニングコスト増分: $0 (Google Calendar API / Microsoft Graph とも無料枠内 — 1 ユーザー × 5 分 polling ≒ 576 req/日/provider。ext-calendar §5.5)。

---

## 16. 非機能要件

| 項目 | 目標 |
|---|---|
| 同期反映遅延 | アプリ→外部 / 外部→アプリとも 5 分 + 1 実行 (polling 周期) 以内。「今すぐ同期」で即時 |
| sync 1 起床の実行時間 | 60 秒以内 (maxDuration)。超過見込み分は sync_page_cursor / pending 残で次起床継続 (途中放棄しない) |
| カレンダー画面初期表示 | 週ビュー 2 週分 + トレイ + キャパで facade 4 呼び出し並列、目標 < 1.5s (force-dynamic) |
| 可用性 (外部障害時) | ブロック/キャパ/実績は外部カレンダー障害と完全independent (P14)。同期のみ degrade |
| 監視 | worker は console.log に report / KMB-E9xx を console.error (Vercel logs)。滞留・失効はダッシュボード警告 (Phase 5) |
| モバイル操作性 | 実績入力・配置 (ドラッグ不要の代替経路)・同期問題解決がスマホ幅 (390px) で完結 (§10.6)。中核操作は 10 秒以内 (ブリーフ絶対条件) |
| データ量前提 | ブロック 〜2,000 行/年・links 同等・イベント数百/カレンダー — index 設計 (§2.2/2.3) で十分 |

---

## 17. 拡張章 (v1 では実装しない差分の設計)

### 17.1 staff ロール追加時 (裁定 J1 — 00-overview §5.5 の骨子適用)

§4.5 のとおり。RLS は is_admin() ポリシーを残したまま staff ポリシーを**追加**。calendar_connections は admin 専用継続 (事業体 1 接続)。

### 17.2 複数リソース化 (裁定 J8 — 本章は設計メモのみ、テーブルは作らない)

1. `resources` テーブル新設 (id / name / color / weekly_hours / is_active) + `work_blocks.resource_id` (nullable FK、NULL = 既定リソース) を追加 migration で導入
2. キャパシティは (resource, week) 単位に変更 — `getWeeklyCapacity(weekStart, resourceId?)` へ後方互換拡張。settings 'work_capacity' は既定リソースの値として残す (キー意味論は 07-contracts-delta 改訂)
3. カレンダー UI はリソース行スイムレーン化。外部同期は**事業体 1 接続のまま** (J1) — リソース毎イベントはタイトル接頭辞 `[名前]` で区別し、per-user 接続は導入しない
4. 契約変更 (zWorkBlockInput への resource_id 追加等) は module-contracts 改訂が先 (v2.9)

### 17.3 push 通知 (Phase 2) — §8.9 に契約予約済み。チャネル更新ジョブは maintenance へ追加

---

## 18. リスクと要確認事項

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | MSA (個人 Outlook) の未確認アプリ同意ブロック + **getSchedule が MSA delegated では Not supported** (Microsoft Learn 実確認 2026-07-11 — 調査 ext-calendar §4 に未記載の制約) | Microsoft 同期不可 / MSA では busy 帯取得が常に失敗 | Google 先行 (J4)。C4 (Entra 登録 + 実機同意検証) を早期化。契約は provider 抽象で吸収済み。busy 帯は calendarView 合成フォールバック + 最終 degrade を実装 (§8.1) — 熊部さんのアカウント種別 (M365 or MSA) は J4 ★確認 3 のとおり未確定のため両対応 |
| R2 | Google Testing ステータスの refresh token 7 日失効 | 同期が週次で死ぬ | In production 化 (未審査警告許容) を既定運用 (C3)。E720 検知 → 再連携バナーで運用継続は可能 |
| R3 | Graph calendarView/delta の無限ページング既知バグ | sync 起床の空転 | ページ上限 20 + 同一 skiptoken 検知 (E725) を初期実装に内蔵 (§8.5) |
| R4 | `calendar.app.created` スコープの分類/挙動が未確認 (ext-calendar §6.1) | Google 審査方針・スコープ変更 | Cloud Console の Data Access で実測 → 不都合なら `calendar.events` へフォールバック (アダプタは calendarId 抽象で無変更。審査観点のみ変化) |
| R5 | 利用者がアプリ専用カレンダー自体を削除 | push 全滅 | P20: maintenance 検知 → status='error' → 「作り直す」で再作成 + 全 links 再 push |
| R6 | 原案生成の「数量非乗算」裁定が実態と合わない可能性 | 工数過小見積り | ★堀さん確認 (§7.1)。テンプレ時間は数量に依らない前提。合わなければ「数量比例 (係数)」を種別属性として追加する改訂 (契約変更なしで DDL 追加可) |
| R7 | 外部同期による work_blocks.updated_at 前進が admin の楽観排他と競合 (外部移動直後の編集で E103) | 稀な保存失敗 | E103 の標準文言で再読み込み誘導 (許容)。頻発時は同期更新を別列 (synced_at) 化する改訂余地 |
| R8 | work_log activity が実績訂正で古い値のまま (P12) | タイムライン表示の古さ | deal 画面の予実は work_blocks 直読みで常に最新。許容と明記。不都合なら crm 契約に activity 更新経路を追加 (v2.9) |
| R9 | **Microsoft クライアントシークレットの最長 24 ヶ月失効** (ext-calendar §1.3 — 運用組込必須。Google に同種失効はない非対称) | 失効すると token refresh が invalid_client で全滅。再連携しても直らない | §8.3-6 で invalid_client を E723 (要 env 更新) として E720 (再連携) と区別。シークレット作成時に失効日をカレンダー登録 + HANDOFF に env 更新手順を記載 |
| R10 | disconnect → 再接続で Microsoft 側の旧イベントが二重表示 (links 削除により旧イベントは P19 skip で掃除されない) | 利用者のカレンダーに同じ予定が 2 枚並ぶ | Google は kumabe_block_id による link 再構築 (§8.5) で構造的に防止。MS は再構築キーが無いため disconnect 確認ダイアログで「再接続時は古い予定の手動削除が必要になることがあります」と注記 (§6.2)。実害は表示のみ |
| R11 | 粗利フィードバックが時間集計止まり (金額換算なし — §0.5 の裁定 J8 縮小) | 「実績→案件の粗利計算にフィードバック」(J8) / 「原価・利益率にフィードバック」(ブリーフ R2) の充足が時間ベースに留まる | ★堀さん確認: 予定 Σh/実績 Σh の時間集計で v1 は足りるか。不足なら settings 'work_capacity' に hourly_cost_jpy (nullable) を 1 個追加して粗利額を併記する小改訂 (07-contracts-delta §D5 の 1 キー改訂のみで対応可 — §0.5) |

---

## 19. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 |
|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §4 (4 列テーブル + API + Vault/env + staff 差分 §4.5/§17.1)。RLS 全文 = §2.2/§2.3 DDL |
| ② テスト戦略表 (単体+結合) | §13 (レイヤ表 + テストファイル×子 Issue 対応 + E2E。ペア 2 連続 PASS 粒度) |
| ③ エラーコード表 | §11 (E701〜E705 / E720〜E725 + 共用コード。採番 canonical は 00-overview §3.3、**追加なし**) |
| ④ ライフサイクル | §5 (3 状態機械 + 周辺リソース §5.5) + §8 (同期プロトコル) |
| ⑤ 全データパターン列挙 | §2.5 (P1〜P31) |
| ⑥ 印刷出力仕様 | §0.6 — **該当なし + 理由明記** (帳票は sales 所有 / 週間予定表はブラウザ印刷で代替) |
| ⑦ 移行受入基準 | §14 (移行なしの根拠 + C1〜C12 検証方法付き) |
| ⑧ 規模見積り | §15 (子 Issue 別内訳 〜7,500 行 + ランニングコスト $0) |
| ⑨ 状態意味論 | §5.1〜5.3 (ASCII 図 + 意味論表 + 不変条件 — 特に §5.3 同期状態機械を精密記述) + §5.4 整合規則 |
| ⑩ 差分表示仕様 | §12 — **該当なし + 理由明記** (版管理なし / 予実は併記表示) |
| モジュール契約 (全プロジェクト規約) | §1.1/§1.3 + 契約は 07-contracts-delta §D7/D8 参照 (直接編集なし・再定義なし・新規コード追加なし) |
| 値契約 (Zod canonical) | §3 (canonical 写し §3.1 + 契約外拡張 §3.2 + internal §3.3 + settings キー §3.4) + §2.6 JSONB 対応表 |
| 非機能要件 | §16 |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07-11 | 初版。裁定 J1/J4/J8・00-overview v1.0・07-contracts-delta v1.0 準拠。migration 0029〜0031 (コア DDL / 同期テーブル / pg_cron 2 ジョブ)、単一リソース (resources テーブルなし)、consumes_capacity 作成時スナップショット、アプリ専用カレンダー + polling 主軸 (syncToken/deltaLink + 410 フル再同期 + Graph 安全弁 E725)、自己エコー棄却三点セット、E724 手動照合、Vault 固定名 + MSA ローテーション毎回上書き、外部削除 deleted_externally マークのみ、work_log は CrmFacade.appendActivity 経由 |
| v1.1 | 2026-07-11 | レビュー指摘反映 (BLOCKER 2 / MAJOR 群 / MINOR 群)。**Google スコープ整合** (§1.4/§8.1/§8.2/§5.2/§5.5/§8.8 — calendarList 全面不使用、openid email で account_email、ensureAppCalendar は保存済み id の calendars.get 検証)・**getSchedule MSA 非対応の calendarView フォールバック** (§1.4/§8.1/§18 R1)・**P15 両方向伝播を §8.5 に実装** (pull 時刻取込で他方 provider link を pending_push 化)・**外部イベント残置の構造的防止** (external_event_id 非 NULL link 残置ブロックの物理 DELETE 拒否 E703 — §5.1/§5.3/§4.2/§6.2 deleteBlock、cancelOpenBlocksForDeal の links 削除マーク、未 push link の削除は外部 API 非呼出 §8.4)・**push 404 のカレンダー/イベント 2 分岐** (§8.4 = P20)・**push claim (push_claimed_at) による create 二重防止** (§2.3/§8.4) + appLinkId 重複掃除 (§8.5)・**E725 復旧経路** (sync_token 破棄 + 当日バックオフ + maintenance 発火条件へ追加 — §8.5/§8.8/§11)・**orphaned の生成 (フル再同期の逆方向突合 §8.5) と解決 (resolveOrphanedLink) / E723 再送 (resendConflictedLink) の facade/Action 新設** (§3.2/§6.2/§8.7/§9.2/§10.4)・**モバイル最小仕様 §10.6 新設** (+§13.3-8/§16)・requestSyncNow の手動上限とリース衝突報告 (§6.2/§9.2)・createBlock の status 導出規則 (§5.1-6/§6.2)・エコー hash の時刻正規化 (§8.6)・invalid_client=E723 区別 (§8.3-6/§18 R9)・disconnect→再接続の重複対策 (kumabe_block_id 再構築 §8.1/§8.5、§18 R10)・grade/size の空文字禁止 min(1) (§3.1 = 07-contracts-delta v1.4 改訂と対、§10.3 正規化)・zWorkBlockInput 写しへ v1.2 refine 追随 (§3.1)・PlacementProposal.expected_updated_at の Action 透過 (§3.2/§9.2)・moddatetime を既存慣習 execute procedure へ統一 (§2.2/§2.3)・J8 縮小の明記 (§0.5/§18 R11)・P31 終日化・62 日未満境界・title 対称・§1.3 settings 依存 (v1.1 前半適用分) |
