# トラック設計書: X/SNSコミュニティ運用・作例活用・信頼構築 (key=x-community-trust)

- 設計者: Fable / 日付: 2026-07-18
- 対象項目: #51 SNS投稿パフォーマンス分析 / #50 SNS受信箱 / P12' X運用支援 / P7' ビフォーアフター写真管理 / #104 口コミ依頼自動化 / P17' 作例公開許諾 / P13' クラファン案件管理 / #98 NPS/CSAT自動配信
- 依存トラック: `fulfillment-ops-loop`(納品完了= deals.stage `delivered` 到達のトリガーを借用。ただし本設計は日次スキャンのフォールバックを持ち、単独でも成立する)
- 規約: docs/module-contracts.md v2.9。migration は `supabase/migrations/`(現39本・日付採番)。admin UI は `.admin-theme` + `src/app/admin/_ui/` 共通小物。

---

## 0. v2レポートの該当判定(根拠行)

| 項目 | v2判定(hubspot-gap-report-v2.md) |
|---|---|
| #51 | L120: 「無」。**高**(旧:中→高)— Xが最大の集客チャネル。作例投稿のどれが依頼に繋がるかの測定は広告費ゼロ集客の核。規模M |
| #50 | L121: 「無(配信専用)」。**高** — 作家からの相談・依頼はXのDM/リプで始まることが多い。受注の入口(X APIのコスト/制約は要確認)。規模L |
| P12' | L303: 一部(X投稿チャネル接続済み `distribution/contracts.ts:120`。受信・メンション監視・許諾追跡は無)。**高** |
| P7' | L298: 一部(works=事例CMS・media基盤は既存 `content/contracts.ts`。案件紐付け写真と転用導線は無)。**高** — 積層痕Before→鏡面Afterは業態最強の営業資産 |
| #104 | L178: 「無」。**高**(対象媒体を変更)— GBPクチコミではなく納品後トリガーで「作例公開許諾+Xでの言及・引用依頼」へ。P7'/P17'と連動 |
| P17' | L308: 「無」(works/voicesスキーマ `content/contracts.ts:29-41,55-66` に許諾・同意フィールドなし)。**中** — 版権が絡む世界。P7'/P12'の前提 |
| P13' | L304: 「無」(`deals` テーブル `crm_core.sql:68-89` に自己参照FKなし)。中〜高 — 勝負試作→ブリッジ生産の商流 |
| #98 | L181: 「無」。中 — 納品後アンケート(#104・P13回りの基盤) |
| §5チャネル優先度 | L346-347: X=優先2位(P7'が弾薬庫、P12'が運用、P17'が許諾、#51が転換測定)、クラファン露出=優先3位(P13'/P17') |

---

## 1. 現状調査(実コード。file:line 付き)

### 1.1 distribution モジュール(SNS 接続・配信 — #51/#50/P12' の土台)

- チャネル接続は X/Instagram/note の3種: `zAccountChannel = z.enum(["x","instagram","note"])`(src/modules/distribution/contracts.ts:120)。認証状態は `zChannelAuthStatus = ["disconnected","connected","expired","error"]`(同:116)。
- 投稿状態機械: `zChannelPostStatus = ["scheduled","publishing","published","failed","cancelled","manual_required"]`(同:105-112)。X は external_id にスレッド再開情報 `zXExternalRef {tweet_ids, last_completed_index}`(同:10-15)。
- `ChannelPostView` は既に `tweet_count / url_count / estimated_cost_cents / attempt_count / last_error_*` を持つ(同:145-165)が、**インプレッション・いいね等の実績メトリクスは一切持たない**。
- facade: `DistributionFacade`(src/modules/distribution/facade.ts:68-82)+ `DistributionFacadeExtended`(同:84-127)。`listChannelPosts / retryFailed / resolveManualRequired / listChannelAccounts / completeXOAuthCallback` 等。worker は `runPublishWorkerBatch, runWatchdogSweep` を re-export(同:60)。
- X API クライアントは**書き込み+認証のみ**: `postTweet`(src/modules/distribution/internal/x-api.ts:26)、`refreshXToken`(同:55)、`exchangeXAuthorizationCode`(同:95)、`getXUserInfo`(同:138)。**読み取り系(mentions/DM/metrics)は未実装**。
- エラーコード帯: distribution = KMB-E5xx(docs/module-contracts.md:45)。実使用は E501〜E506(worker.ts / facade.ts / ops-limits.ts で確認)。**E507以降が未使用**。
- 課金ガード: `zOpsLimits.x_monthly_post_limit`(src/modules/settings/contracts.ts:62)+ `getMonthlyXPostCount`(facade.ts:72)。settings キー追加は DDL 不要(module-contracts.md:348 — 新規キーは seed もバックフィルもしない。初回保存で行作成、行なしは既定値へ degrade)。
- admin UI: `/admin/channels`(src/app/admin/channels/ — page.tsx, channel-posts-queue.tsx, connection-cards.tsx, style-profile-forms.tsx。R6a で再スタイル済み)。

### 1.2 cron / ジョブ基盤(自動化の流用元)

- pg_cron 登録済みジョブ: `kmb-publish-worker`(毎分)・`kmb-watchdog-worker`(5分毎)(20260708000011_pg_cron_jobs.sql:91-92)、`kmb-ai-draft-cleanup-worker`(日次)(20260710000017:104)、`kmb-crm-digest-worker`(JST07:00)(20260711000024:39)、scheduling×2(20260711000031:63,70)、`kmb-telephony-worker`(毎分)(20260711000034:49)。
- 起床パターン: `trigger_crm_digest_worker()` が Vault の `cron_site_url`/`cron_jobs_secret` を読んで `net.http_post` → `/api/jobs/crm-digest`(20260711000024_crm_digest_cron.sql:11-34)。**新規 Vault キー不要で完全流用可**。
- `/api/jobs/crm-digest/route.ts` は `x-jobs-secret` 検証 → 202 応答 → `after()` で本体実行。**app 層が crmFacade と salesFacade を合成する前例**(crm→sales の依存を作らない合成点、route.ts:20-26)。ジョブ route 一覧: calendar-maintenance / calendar-sync / cleanup-ai-drafts / crm-digest / publish / telephony / watchdog(src/app/api/jobs/)。

### 1.3 crm モジュール(deals・activities — P13'/#104/#98 の土台)

- `deals`: stage check は `'inquiry'...'delivered','invoiced','paid','lost'`(20260711000023_crm_core.sql:74-77)。**親子案件の自己参照FKなし・クラファン関連列なし**(同:68-89)。終端ステージ不変は DB トリガで二重防御(同:108-121)。
- `DEAL_STAGE_REGISTRY` の `delivered: {label:"納品済み", probability:100, isWon:true}`(src/modules/crm/contracts.ts:37)。**deals に delivered_at 列は無い**(won_at は ordered 初到達のみ、crm_core.sql:80)。
- `activities`: activity_type check = `note/call/email/form_submission/simulator_estimate/document_event/work_log/task_event/system`(crm_core.sql の activities 定義)。冪等キー `(activity_type, ref_table, ref_id)` 一意。他モジュールからの書き込みは `CrmFacade.appendActivity` のみ(テーブルコメントで直接 INSERT 禁止)。
- facade: `updateDealStage`(src/modules/crm/facade.ts:159)・`intakeFromInquiry / intakeFromSimulator`(同:145-146)・`createCustomer`(同:148)・`createDeal`(同:158)・`appendActivity`(同:161)。**SNS DM からのリード化は createCustomer + createDeal の合成で実現できる**。
- エラーコード: crm = E601〜E619。**実使用は E601〜E611**(E611 = 住所自動補完失敗 — `src/modules/platform/errors.ts:224`。使用箇所は app 層 `src/app/admin/customers/actions.ts:166-176` のため modules 配下 grep では漏れる。00-overview §3.3 にも登録済み)。空きは E612〜E619 の 8 個で、うち E612(sfa 紹介元)/E613-E614(commerce 匿名化)は growth 統合の他トラック割当済み — 本トラックは **E615/E616** を使う(00-統合設計.md)。
- digest: `crmFacade.collectDigest` + `isDigestEmpty`(facade.ts から export、route.ts:4)。

### 1.4 content / media(works CMS・写真 — P7'/P17' の土台)

- `works`: slug/title/category/body/process_note/cover_media_id/status/published_at/sort_order(20260708000001_init_schema.sql:39-54)。`work_images (work_id, media_id, sort_order)`(同:56-61)。`voices` は customer_initial/region/rating/body/item/photo_media_id(同:87-101)。**works/voices とも deal への参照列・許諾列は無い**。
- content の入力契約: `zWorkInput`(src/modules/content/contracts.ts:29-41、image_ids 配列で work_images へ展開)・`zVoiceInput`(同:55-66)。admin CRUD 拡張は facade 内で契約拡張済み(同:143-157 のコメント)。
- media facade: `createUploadUrl / completeUpload / list / getById / listByTags / getJpegRenditionUrl`(src/modules/media/facade.ts:35-93)。media テーブルは `tags text[]`・`is_placeholder` を持つ(init_schema.sql:30-31)。**案件(deal)と写真を結ぶテーブルは存在しない**。deal 添付系テーブルも migration 全 grep でゼロ(#147 は未実装)。
- admin UI: `/admin/works`(WorkForm.tsx 等)、`/admin/deals/[id]` はカード集積型(DealOverviewCard / DealDocumentsCard / DealWorkSummaryCard / DealStageBar 等 — src/app/admin/deals/[id]/)。

### 1.5 メール送信(Resend — #104/#98 の送信手段)

- 前例2つ: `inquiry/internal/notify.ts`(ベストエフォート通知)と `sales/internal/email.ts`(帳票メール。**Result 返却で失敗を握り潰さない**。fromAddress()/escapeHtml() は「許容された重複実装」とコメント明記 — sales/internal/email.ts:9-16)。送信台帳は sales 所有 `document_emails`(20260714000036_sales_document_emails.sql)。
- **#100 メール統合(08-email.md v2)が emails/email_attachments テーブルと E840-859 を予約済**。本トラックは汎用受信/送信台帳を作らず、sales/internal/email.ts と同型の**モジュール内 internal 送信 + 自モジュール所有の依頼テーブルに送信結果を記録**する方式を踏襲する(#100 が M3 まで進んだら EmailFacade 経由に差し替え可能な形)。

### 1.6 nav-badges / inquiry

- nav-badges は所有テーブルなしの読み取り専用横断集計。E001/E002 使用(src/modules/nav-badges grep)。対象は contact_inquiries/calls/tasks に限定(module-contracts.md:51)— 受信箱バッジ追加は契約追記が必要。
- `contact_inquiries` に referrer/UTM 列は無い(init_schema.sql の contact_inquiries 定義)。投稿→問い合わせの自動帰属は #80(紹介元トラッキング、別トラック)の所掌。

### 1.7 X API の外部制約(設計前提)

- X API v2 Free ティアは**書き込みのみ**(現行の投稿機能は Free で動く)。メンション取得(`GET /2/users/:id/mentions`)・DM(`GET /2/dm_events`)・ツイートメトリクス(`non_public_metrics` 付き lookup)は **Basic 以上の有料プラン**が必要(価格・上限は変動があるため実装時に要再確認 — v2レポート L121/L303 の「要確認」と同旨)。
- → 本設計は **「API 未加入でも手動運用で完結し、加入したらジョブが自動で動き出す」二段構え**を全項目の共通原則にする(1人工房が月額固定費を先払いしないで済む)。ティアは settings 新キー `sns_ops.x_api_tier` で宣言し、読み取り系ジョブは free では no-op。

---

## 2. モジュール配置の全体方針

| 項目 | 所属モジュール | 理由 |
|---|---|---|
| #51 / #50 / P12'(の同期・受信部) | **distribution 拡張** | channel_accounts のトークン・X API クライアント・worker/cron 基盤をそのまま使う。E5xx 帯に E507+ の空きあり |
| P17' / P7' / #104 / #98 | **新モジュール `engagement`** | 「作例の許諾・写真素材・納品後フィードバック」は crm(顧客/案件)とも content(CMS)とも異なる関心。crm の空き E612-619(8個。E611 は使用済み)は他トラック割当分を除くと残 3 個しかなく、ここに足すと帯が即枯渇し、01-crm.md の親設計スコープも逸脱する。nav-badges 新設(#129)の前例どおり、小さく独立させる |
| P13' | **crm 拡張** | 親子案件(deals 自己参照)とクラファン付帯情報は案件そのものの属性。E615/E616 を使用(E611 は #113 で使用済み・E612-E614 は他トラック割当 — 00-統合設計.md) |
| works.source_deal_id 等の列追加 | content 所有 migration | テーブル所有原則(§1)に従い所有モジュール側で変更 |

**engagement モジュール新設の要点**(module-contracts.md v2.9 → v3.0 追記が必要):

- 所有テーブル: `publication_consents`, `deal_photos`, `feedback_requests`
- エラーコード帯: **KMB-E680〜E699**(E650-E700 の未割当帯のうち前半 E650-679 は並行トラック fulfillment が取るため後半を使用 — 00-統合設計.md の全体割当。#100 予約の E840-859 とは非重複)
- facade: `EngagementFacade`
- 依存方向: engagement → crm(appendActivity・deal 読み取り)/ media(写真 URL)/ settings(通知宛先)。content・distribution からは **app 層合成でのみ**接続(逆依存を作らない — crm-digest route の前例 1.2 と同じ)。

**エラーコード割当**(敵対レビューで E611 の既使用が判明したため crm 分を E615/E616 へ、engagement 帯を E680-699 へ是正済み。以下は全て現行未使用)

| コード | 意味 |
|---|---|
| KMB-E507 | X API 読み取り系がプラン未加入/権限不足で利用不可(sns_ops.x_api_tier=free 時の明示拒否含む) |
| KMB-E508 | SNS 同期の確定失敗(API がエラーを確定応答) |
| KMB-E509 | 受信箱アイテムの状態遷移不正(converted 済みの再変換等) |
| KMB-E510 | メトリクス手動入力の対象不正(published 以外の投稿等) |
| KMB-E615 | 親子案件リンク不正(自己参照・循環・2階層超・終端ステージの親) |
| KMB-E616 | クラファン情報の入力不正(URL 形式・日付順序) |
| KMB-E680 | 公開トークン不正/期限切れ |
| KMB-E681 | 回答済みへの再回答 |
| KMB-E682 | 許諾の状態遷移不正(revoked からの再 grant 等) |
| KMB-E683 | フィードバック依頼の重複作成(冪等 — 既存行を返す) |
| KMB-E684 | 案件写真リンク不正(deal/media 不存在・重複) |
| KMB-E685 | 許諾なし公開ガード(scope 不足のまま works 公開/SNS 転用を試行) |

**migration 採番**(現最新 20260715000002。日付ベースで続番):

| ファイル | 内容 | Issue |
|---|---|---|
| 20260720000001_sns_metrics.sql | channel_post_metrics + sns_sync_state + cron(kmb-sns-sync-worker) | D |
| 20260721000001_engagement_consents.sql | publication_consents + RLS | A |
| 20260722000001_deal_photos.sql | deal_photos + RLS | B |
| 20260722000002_works_source_deal.sql | works.source_deal_id / voices.source_deal_id | B |
| 20260723000001_feedback_requests.sql | feedback_requests + RLS(cron は crm-digest 便乗のため追加なし) | C |
| 20260724000001_sns_inbox.sql | sns_inbox_items + RLS | E |
| 20260725000001_crm_deal_crowdfunding.sql | deals.parent_deal_id + deal_crowdfunding | G |

(適用運用は memory の方針どおり: docker 無し・本番適用後 execute_sql 検証)

---

## 3. 項目別設計

### 3.1 P17' 作例公開許諾・掲載権管理【最初に実装 — P7'/P12'/#104 の前提】

**目的**: ガレキ・版権物が絡む顧客作品を「許諾の記録なしに公開する事故」を構造的に防ぐ。1人工房では「誰に何を許可されたか」が頭の中にしかなく、X で伸びた投稿ほど後から揉める。案件単位の許諾レコード1枚で、works 公開・X 投稿・クラファン素材提供の全てのゲートにする。

**スコープ**: 案件単位の許諾レコード(範囲・クレジット・版権メモ)/admin での手動記録/公開フォーム(トークン URL)での顧客セルフ回答/deal タイムラインへの記録。
**非スコープ**: 電子署名・PDF 同意書生成/works 複数案件の合成許諾/顧客ポータル(#100 系)。

**DDL**(20260721000001_engagement_consents.sql):

```sql
create table publication_consents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  status text not null default 'not_asked'
    check (status in ('not_asked','requested','granted','denied','revoked')),
  scope_site boolean not null default false,          -- 自社サイト works/voices 掲載
  scope_sns boolean not null default false,           -- X/Instagram 投稿・引用RP
  scope_note boolean not null default false,          -- note 記事
  scope_crowdfunding boolean not null default false,  -- クラファンページ素材提供
  credit_display text not null default 'none'
    check (credit_display in ('none','handle','real_name','anonymous')),
  credit_text text,            -- '@handle' / '作家名' の表記そのもの
  credit_url text,
  is_licensed_item boolean not null default false,    -- 版権物 (当日版権等)
  license_note text,           -- 版権元・許諾条件 (当日版権の期限等)
  evidence_note text,          -- 許諾を得た経緯 (DMのURL・口頭日付等)
  token text unique,           -- 公開フォーム /c/[token]。null = 未発行
  token_expires_at timestamptz,
  requested_at timestamptz,
  replied_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index publication_consents_deal_uniq on publication_consents (deal_id);
create trigger handle_updated_at before update on publication_consents
  for each row execute function extensions.moddatetime(updated_at);
-- RLS: admin 全操作 + service 全操作 (is_admin_or_service)。anon/authenticated へは revoke all
-- (公開フォームは service client 経由の route handler のみが token で 1 行引く)
```

不変条件: `granted` は scope_* の少なくとも1つが true(CHECK ではなく facade 検証 — 部分許諾は scope で表現)。`revoked` 後の編集は E682(再依頼は新 token 発行で `requested` に戻すのみ可)。

**契約(engagement/contracts.ts)**:

```ts
export const zConsentScope = z.object({
  scope_site: z.boolean(), scope_sns: z.boolean(),
  scope_note: z.boolean(), scope_crowdfunding: z.boolean(),
}).strict();

export const zConsentInput = zConsentScope.extend({
  status: z.enum(["not_asked","requested","granted","denied","revoked"]),
  credit_display: z.enum(["none","handle","real_name","anonymous"]),
  credit_text: zShortText(100).nullable(),
  credit_url: z.string().url().max(300).nullable(),
  is_licensed_item: z.boolean(),
  license_note: zShortText(500).nullable(),
  evidence_note: zShortText(500).nullable(),
}).strict();

/** 公開フォーム /c/[token] の顧客入力 (status は grant/deny のみ) */
export const zConsentFormSubmission = zConsentScope.extend({
  decision: z.enum(["grant","deny"]),
  credit_display: z.enum(["none","handle","real_name","anonymous"]),
  credit_text: zShortText(100).nullable(),
  comment: zShortText(500).nullable(),
}).strict();

export type ConsentView = { /* 行の全カラム射影 + deal_title */ };
```

**facade(EngagementFacade)**:

```ts
getConsentByDeal(dealId: string): Promise<Result<ConsentView | null>>;
upsertConsent(dealId: string, input: ConsentInput,
  expectedUpdatedAt: string | null): Promise<Result<{ id: string }>>;   // CAS は E103 共用
issueConsentRequestToken(dealId: string):
  Promise<Result<{ token: string; url: string }>>;   // status→requested, 有効期限60日
getConsentByToken(token: string): Promise<Result<ConsentView>>;         // E680
submitConsentByToken(token: string, input: ConsentFormSubmission):
  Promise<Result<void>>;                                                // E680/E681/E682
/** 転用ガード (app 層から呼ぶ)。scope を満たさなければ E685 */
assertConsentedFor(dealId: string,
  scope: "site" | "sns" | "note" | "crowdfunding"): Promise<Result<void>>;
```

`submitConsentByToken` 成功時は `crmFacade.appendActivity`(activity_type:'system'、ref_table:'publication_consents'、冪等キーで再送安全)で deal タイムラインに「公開許諾: 回答あり(SNS○/サイト○…)」を記録する。**監査粒度の明示的裁定**: 冪等 unique index `activities(activity_type, ref_table, ref_id)`(crm_core.sql:151)+ consent が deal 1 行固定のため、activity は**最初の回答 1 件のみ**タイムラインに残る。revoked→再 grant 等の以後の遷移は activities に積まれない — 遷移の履歴は publication_consents 行(status/requested_at/replied_at/evidence_note)が保持し、1人工房の監査需要はこれで足りるとする(版権トラブルで遷移ログが必要になったら consent_events 追記テーブルを後付けする、を将来の逃げ道として記録)。

**画面**: `/admin/deals/[id]` に **DealConsentCard** を追加(DealDocumentsCard と同列のカード)。status-badge(granted=緑/requested=黄/denied・revoked=赤/not_asked=灰)、scope のチェック表示、「許諾依頼リンクを発行」ボタン(URL コピー — メール送信は #104 が自動化)。公開フォームは `/c/[token]`(公開ルート。会社ロゴ+案件タイトル+チェックボックス4つ+クレジット希望+送信。site 公開系と同じ Tailwind 語彙)。

**ジョブ**: なし(#104 が送信を自動化する。本 Issue は手動リンク共有まで)。

**受入基準**:
- [ ] deal 詳細に許諾カードが出て、手動で granted/denied を記録できる(CAS 楽観排他つき)
- [ ] 「依頼リンク発行」で status=requested + token 付き URL が得られ、/c/[token] で顧客が回答すると scope・クレジットが保存され replied_at が入る
- [ ] 期限切れ token は E680、回答済み再送信は E681 でフォームがエラー表示
- [ ] 回答時に deal タイムラインへ system activity が1件(再送しても1件)追加される
- [ ] revoked にすると assertConsentedFor が全 scope で E685 を返す
- [ ] module-contracts.md に engagement モジュール(所有3テーブル・E680-699)の追記が同 PR に含まれる

**テスト方針**: 状態遷移表(not_asked→requested→granted/denied、granted→revoked、revoked→requested のみ可)の unit テスト/token 期限・再回答の facade テスト(repo モック)/contracts-ddl-parity テストに status・credit_display の enum を追加。

---

### 3.2 P7' ビフォーアフター写真管理 → 事例・クラファン素材化

**目的**: 「積層痕だらけの Before → 鏡面 After」を撮った瞬間に案件へ紐付け、許諾が取れたらワンクリックで works 事例(とX投稿の弾)になる。現状は写真がスマホと media ライブラリに散在し、事例化のたびに探し直している(=事例が増えない=P12'の弾切れ)。

**スコープ**: deal への写真紐付け(before/process/after の工程タグ+キャプション)/deal 詳細のアップロード UI/works への転用(下書き生成)/選択写真の JPEG 一括ダウンロード(クラファン先方渡し用)。
**非スコープ**: 指示書 PDF 等の汎用添付(=#147、fulfillment-ops-loop 側。**衝突回避**: 本テーブルは写真+工程タグ特化。#147 が汎用 `deal_attachments` を作る場合も用途が異なるため共存可 — 実装順が逆になった場合は #147 側 kind='photo' への統合を検討する調整ポイントとして Issue に明記)/自動画像補正・透かし。

**DDL**(20260722000001_deal_photos.sql + 20260722000002_works_source_deal.sql):

```sql
create table deal_photos (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  media_id uuid not null references media(id),
  phase text not null check (phase in ('before','process','after')),
  caption text,                       -- '600番研磨後' 等
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index deal_photos_deal_media_uniq on deal_photos (deal_id, media_id);
create index deal_photos_deal_idx on deal_photos (deal_id, phase, sort_order);
-- RLS: admin/service のみ (公開は works 転用後に content 側の既存経路で行う)

-- content 所有分 (別ファイル):
alter table works  add column source_deal_id uuid references deals(id) on delete set null;
alter table voices add column source_deal_id uuid references deals(id) on delete set null;
create index works_source_deal_idx  on works (source_deal_id)  where source_deal_id is not null;
create index voices_source_deal_idx on voices (source_deal_id) where source_deal_id is not null;
```

media の参照カウント(`assertDeletable` E301 — media/facade.ts:222)が deal_photos を参照集計に含むよう、**現行定義 = `20260711000035_branding_favicon_media_refs.sql`(0008 ではない — 0035 が favicon/branding 参照を追加した再定義版)を基点に、`media_reference_summary` view(0035:53-76)と `media_admin_delete` RLS ポリシー(0035:28-30)の両方**を 20260722000001 で deal_photos 込みに再置換する(削除事故防止)。0035:51 の「**view と RLS の参照集合を常に一致させる — 確立規約**」に従う: view だけ更新すると RLS 側が deal_photos を知らず、precheck を迂回した DELETE が生 FK エラー(→E901)になり受入基準の E301 が満たせない。0008 を基点にすると 0035 の branding/favicon 参照が消える退行になる点に注意。

**契約**:

```ts
export const zDealPhotoInput = z.object({
  deal_id: z.string().uuid(),
  media_id: z.string().uuid(),
  phase: z.enum(["before","process","after"]),
  caption: zShortText(100).nullable(),
  sort_order: z.number().int().min(0).max(9999),
}).strict();

export type DealPhotoView = {
  id: string; deal_id: string; media_id: string;
  phase: "before" | "process" | "after";
  caption: string | null; sort_order: number; created_at: string;
};
/** works 転用の素材束 (作成自体は app 層が contentFacade に渡す — content への依存を作らない) */
export type WorkScaffold = {
  suggested_title: string;          // deal.title から
  suggested_category: string;
  body_md: string;                  // Before/After 見出し+キャプション入り雛形
  cover_media_id: string | null;    -- after 先頭
  image_ids: string[];              // before→process→after 順
  source_deal_id: string;
};
```

**facade**:

```ts
listDealPhotos(dealId: string): Promise<Result<DealPhotoView[]>>;
addDealPhoto(input: DealPhotoInput): Promise<Result<{ id: string }>>;    // E684 (重複/不存在)
updateDealPhoto(id: string, patch: { phase?; caption?; sort_order? }): Promise<Result<void>>;
removeDealPhoto(id: string): Promise<Result<void>>;
buildWorkScaffold(dealId: string): Promise<Result<WorkScaffold>>;        // 写真0枚は E684
```

**画面**: `/admin/deals/[id]` に **DealPhotosCard**。3カラム(Before/工程/After)のサムネイルグリッド。アップロードは media の既存 `createUploadUrl → completeUpload`(facade.ts:89-93)を使い、完了後 `addDealPhoto`。既存 media-picker.tsx(_ui)で登録済み画像の紐付けも可。カード右上に2ボタン:
- 「事例にする」→ `assertConsentedFor(dealId,'site')`(E685 なら許諾カードへ誘導するダイアログ)→ `buildWorkScaffold` → `/admin/works/new?from_deal=...` に下書きプリフィル(既存 WorkForm を流用、source_deal_id を hidden で保持)
- 「一括ダウンロード」→ 選択写真の JPEG レンディション(`getJpegRenditionUrl`)を zip ストリームで返す admin route(クラファン先方へ渡す素材)

works 側: WorkForm に「元案件」表示(read-only リンク)。公開遷移時、source_deal_id があれば app 層 action で `assertConsentedFor('site')` を再検証(E685 でブロック — 許諾が後から revoked された場合の防波堤)。

**ジョブ**: なし。

**受入基準**:
- [ ] deal 詳細で写真をアップロード/既存 media から紐付けでき、before/process/after と並び順を編集できる
- [ ] 同一 media の二重紐付けは E684
- [ ] 「事例にする」で works 下書きが画像順序(before→after)・キャプション込みの body 雛形付きで生成され、source_deal_id が保存される
- [ ] 許諾 scope_site が無い deal では事例化がブロックされ、許諾カードへの導線が出る(E685 文言)
- [ ] source_deal_id 付き works の publish 時にも許諾を再検証する
- [ ] deal_photos で参照中の media は削除できない(E301)
- [ ] 一括ダウンロードで選択写真の zip が取得できる

**テスト方針**: buildWorkScaffold の並び・雛形生成 unit / E685 ガードの action テスト / parity テスト(phase enum)。zip route は手動確認(1人工房・低リスク)。

---

### 3.3 #104 口コミ依頼自動化(作例公開許諾+X言及依頼)+ #98 NPS/CSAT 自動配信【同一基盤】

**目的**: 納品後の「感想ください+作品写真使わせてください+良ければ X で @メンションください」を毎回手で書いている(または忘れている)。delivered 到達を起点に、(1) NPS アンケート、(2) 許諾+X言及依頼、を適切な間隔で自動送信し、回答をそのまま voices(お客様の声)と publication_consents に流し込む。**依頼→回答→資産化(voices/works/X引用)が人手ゼロで一周する**のが狙い。

**スコープ**: feedback_requests テーブル/納品後スキャンによる依頼作成(冪等)/crm-digest ジョブ便乗の送信/公開回答ページ(NPS: /f/[token])/#104 は 3.1 の許諾フォーム(/c/[token])へ誘導+回答後に X intent リンク提示/回答の digest 掲載/高評価回答の voices 下書き転用導線。
**非スコープ**: SMS 送信/多段リマインド(1回送って終わり — 1人工房でクレーム対応コストを増やさない)/#100 の emails テーブルへの記録(#100 実装後に engagement/internal/email.ts を EmailFacade 呼び出しへ差し替える移行メモを Issue に残す)。

**DDL**(20260723000001_feedback_requests.sql):

```sql
create table feedback_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  kind text not null check (kind in ('nps','review_x')),
  status text not null default 'scheduled'
    check (status in ('scheduled','sent','responded','skipped','expired','failed')),
  token text not null unique,
  scheduled_for date not null,          -- nps: 検知日+3日 / review_x: +7日
  sent_to text,                         -- 送信時の宛先スナップショット
  sent_at timestamptz,
  responded_at timestamptz,
  expires_at timestamptz not null,      -- 発行から60日
  send_error text,
  nps_score int check (nps_score between 0 and 10),
  response_comment text,
  x_mention_url text,                   -- 顧客が貼った言及ポスト URL (手動追記も可)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index feedback_requests_deal_kind_uniq on feedback_requests (deal_id, kind);
create index feedback_requests_due_idx on feedback_requests (status, scheduled_for);
-- RLS: admin/service のみ。公開回答は service client route が token で引く
```

`(deal_id, kind)` 一意が **納品トリガーの冪等キー**。Track2 のトリガーが何度発火しても、日次スキャンと二重に走っても、依頼は deal×種別で1件。

**トリガー設計(Track2 依存の吸収)**:
- 正: fulfillment-ops-loop の delivered トリガー(形態未確定)から `engagementFacade.scheduleForDeal(dealId, {mode:'service'})` を呼んでもらう(app 層配線)。単票経路は `crmFacade.getDealRef`→`getCustomerRef`(CustomerRef に email あり — crm/contracts.ts:280)で成立する。
- フォールバック(本トラック単独で成立)— **所有境界の是正(敵対レビュー M1)**: deals は crm 所有で、跨モジュール呼出可能な base `CrmFacade` には ID 指定の単票参照しか無く(facade.ts:145-172)、`listDeals` を持つ `CrmFacadeExtended` は他モジュールから呼出禁止。engagement が deals をステージ横断スキャンすると直クエリ = 所有違反になる。よって:
  1. **base `CrmFacade` に service-ctx の列挙 read を 1 本新設**: `listDeliveredDealsForFollowup(sinceDays: number, ctx: ExecutionContext): Result<Array<{ deal_id: string; stage: DealStage; customer_id: string; customer_email: string | null }>>`(`stage in ('delivered','invoiced','paid') and created_at > now()-interval 'N days'` + 顧客 email 射影のみ。module-contracts §5 への追記を Issue C に含める)。
  2. **engagement 側の署名を候補受け取り型に変更**: `scheduleForDeliveredDeals(candidates: DeliveredDealCandidate[], ctx)` — 列挙は行わず、feedback_requests 未作成の候補に2行(nps/review_x)を作るだけ。
  3. **合成は app 層(crm-digest route)**が行う(既存の crm+sales 合成と同型)。
  deals に delivered_at が無い(1.3)ため、scheduled_for は**検知日**+オフセットで近似(日次スキャンなので最大1日の遅れ。1人工房では許容)。email 無し顧客は status='skipped' で作成(「送っていない」ことが見える)。

**送信**: 新規 cron は張らず、`/api/jobs/crm-digest/route.ts` の `after()` に app 層合成で追加(1.2 の crm→sales 合成と同じ前例。**digest の早期 return — collectDigest 失敗 / isDigestEmpty — に巻き込まれない独立 try/catch ブロックとして配置**):
```
const candidates = await crmFacade.listDeliveredDealsForFollowup(90, {mode:'service'})
await engagementFacade.scheduleForDeliveredDeals(candidates.value, {mode:'service'})
await engagementFacade.dispatchDueRequests({mode:'service'})   // scheduled_for <= today を送信
```
送信は `engagement/internal/email.ts`(sales/internal/email.ts:9-16 と同型の Resend・Result 返却)。nps メール = /f/[token]、review_x メール = 「作品を作例として紹介させてください(/c/[token])+よろしければ @kumabe_tosou へのメンションで完成報告を」— consent token は 3.1 の `issueConsentRequestToken` を facade 内部で連結発行。失敗は status='failed' + send_error(digest に「送信失敗 n 件」)。

**契約・facade**:

```ts
export const zNpsSubmission = z.object({
  score: z.number().int().min(0).max(10),
  comment: zShortText(2000).nullable(),
}).strict();

scheduleForDeal(dealId: string, ctx: ExecutionContext): Promise<Result<{ created: number }>>;
scheduleForDeliveredDeals(candidates: DeliveredDealCandidate[], ctx): Promise<Result<{ created: number; skipped: number }>>;
  // 列挙は行わない — 候補は app 層が crmFacade.listDeliveredDealsForFollowup で取得して渡す (所有境界)
dispatchDueRequests(ctx): Promise<Result<{ sent: number; failed: number }>>;
getRequestByToken(token: string): Promise<Result<FeedbackRequestView>>;      // E680
submitNpsByToken(token: string, input: NpsSubmission): Promise<Result<void>>; // E680/E681
attachMentionUrl(requestId: string, url: string): Promise<Result<void>>;
listFeedbackRequests(filter: { status?; kind?; cursor; limit }): Promise<Result<Paged<FeedbackRequestView>>>;
```

回答時は appendActivity(system)で deal タイムラインに「NPS 9点・コメントあり」を冪等記録。

**画面**: `/admin/feedback`(新規・サイドナビ「お客様の反応」)。data-table で 依頼一覧(kind/status バッジ・スコア・コメント抜粋・言及URL)。行アクション: 「お客様の声の下書きにする」→ 既存 `zVoiceInput` へプリフィル(`/admin/voices/new?from_feedback=...`、rating=NPS を 5 段階へ丸め、source_deal_id 設定)— content への依存は app 層合成。スコア 0-6(批判者)は行を赤系 status-badge で強調(電話フォロー判断は人間)。公開ページ `/f/[token]` は 0-10 ボタン+コメント1枠のみ(スマホ前提・30秒で終わる)。回答後サンクス画面: 9-10 の推奨者にだけ X intent リンク(`https://x.com/intent/post?text=...@kumabe_tosou...`)を表示(#104 の言及依頼を NPS 側でも回収)。

**受入基準**:
- [ ] delivered 以降の deal に日次で nps/review_x 依頼が各1件だけ作られる(再実行・Track2 トリガー併用でも増えない)
- [ ] email 無し顧客は skipped で作成され、digest に件数が出る
- [ ] scheduled_for 到来分が JST07:00 のジョブで送信され、sent_at/sent_to が記録される。送信失敗は failed + send_error
- [ ] /f/[token] で回答すると score/comment が保存され、再回答は E681、期限切れは E680
- [ ] 9-10 回答のサンクス画面に X intent リンクが出る
- [ ] review_x メールの許諾リンクから回答すると publication_consents に反映される(3.1 経由)
- [ ] /admin/feedback から voices 下書きへ転用でき、voices.source_deal_id が入る
- [ ] E840-859・emails テーブルには一切触れていない(#100 競合なし)

**テスト方針**: scheduleForDeliveredDeals の冪等 unit(repo モックで2回実行→created 0)/score→rating 丸めの unit/parity(kind/status enum)/送信本文はスナップショットテスト。実送信は本番 Resend で手動1通確認(結合ハーネス無しの方針どおり)。

---

### 3.4 #51 SNS 投稿パフォーマンス分析

**目的**: 「どの作例投稿が伸びて、どれが依頼に繋がったか」を数字で持つ。X の analytics 画面を毎回見に行く運用は続かない。published な channel_posts にメトリクスのスナップショットを蓄積し、発信スタジオ内で「伸びた投稿ランキング」を見られるようにする。広告出稿判断(§5 優先2位)の前提データ。

**スコープ**: channel_post_metrics(時系列スナップショット)/API 同期 worker(Basic 以上のみ)/**手動入力**(free ティアの現実解 — X の自分のポストの表示数値を転記)/発信スタジオの「分析」タブ/works への UTM 付きリンク定型(投稿本文用)。
**非スコープ**: 問い合わせ・成約への自動帰属(#80 紹介元トラッキングの所掌 — contact_inquiries に referrer 列が無いことは 1.6 で確認済み)/Instagram/note のメトリクス(v1 は X のみ。テーブルは channel 非依存で設計し将来 check 拡張)/フォロワー数推移。

**DDL**(20260720000001_sns_metrics.sql):

```sql
create table channel_post_metrics (
  id uuid primary key default gen_random_uuid(),
  channel_post_id uuid not null references channel_posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  source text not null check (source in ('api','manual')),
  impressions int check (impressions is null or impressions >= 0),  -- free/manual は null 可
  likes int not null default 0,
  reposts int not null default 0,
  replies int not null default 0,
  quotes int not null default 0,
  bookmarks int,
  url_clicks int,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index channel_post_metrics_post_idx on channel_post_metrics (channel_post_id, captured_at desc);

create table sns_sync_state (          -- 同期カーソル+最終結果 (distribution 所有)
  channel text not null,
  kind text not null check (kind in ('metrics','mentions','dm')),
  since_cursor text,
  last_synced_at timestamptz,
  last_error_code text,
  last_error_detail text,
  updated_at timestamptz not null default now(),
  primary key (channel, kind)
);
-- RLS: 両テーブル admin read / service write (worker)。cron:
--   trigger_sns_sync_worker() (0024 と同型・Vault 共用) + kmb-sns-sync-worker '*/30 * * * *'
--   → POST /api/jobs/sns-sync (x-jobs-secret)。free ティア時は即 no-op (E507 は投げず skip ログ)
```

**settings 新キー `sns_ops`**(DDL 不要 — 1.1 の前例どおり):

```ts
export const zSnsOpsSettings = z.object({
  x_api_tier: z.enum(["free","basic","pro"]),          // 既定 'free'
  metrics_sync_enabled: z.boolean(),                    // 既定 false
  inbox_sync_enabled: z.boolean(),                      // 既定 false (#50 で使用)
  hashtag_presets: z.array(zShortText(60)).max(30),     // P12' で使用
  mention_watch_queries: z.array(zShortText(120)).max(5), // P12' で使用
}).strict();
```

**同期仕様**: worker(`runSnsSyncBatch` — publish worker と同じく facade から re-export)は published な X 投稿のうち published_at が 30 日以内のものを対象に、前回スナップショットから 24h 以上経過した投稿のみ `GET /2/tweets?ids=...&tweet.fields=public_metrics,non_public_metrics` で取得(x-api.ts に `getTweetsMetrics` を追加。トークン更新は既存 `refreshXToken` 流用)。プラン不足の 403 は sns_sync_state に E507 記録して停止(毎回叩いて課金・凍結を招かない)。

**契約・facade(distribution 拡張)**:

```ts
export const zManualMetricsInput = z.object({
  impressions: z.number().int().min(0).nullable(),
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
  bookmarks: z.number().int().min(0).nullable(),
  url_clicks: z.number().int().min(0).nullable(),
}).strict();

// DistributionFacadeExtended へ追加
recordManualMetrics(channelPostId: string, input: ManualMetricsInput): Promise<Result<void>>; // published 以外は E510
listPostPerformance(filter: { channel?: AccountChannel; sinceDays: 7|30|90; cursor; limit })
  : Promise<Result<Paged<PostPerformanceView>>>;   // 投稿×最新スナップショット+前回比
getSnsSyncStates(): Promise<Result<SnsSyncStateView[]>>;
```

**画面**: `/admin/channels` に underline-tabs「分析」を追加。data-table: 投稿(本文先頭40字+external_url リンク)/公開日/表示数/いいね/RP/リプ/ブクマ/最終取得。ソートは表示数・いいね。free ティア時は notice-panel「X API 未加入のため自動取得は無効です。行の『数値を入力』から転記できます」+ 行内 manual 入力ダイアログ。上部に meter-bar で「今月の投稿数 / x_monthly_post_limit」(既存 `getMonthlyXPostCount` 流用)。UTM 定型: 投稿詳細に「works リンク(UTM 付き)をコピー」ボタン(`?utm_source=x&utm_medium=social&utm_content=<post_id>` — GA4 は R5/05 系で導入済みの analytics 設定を利用。DB 帰属は #80 に委譲)。

**受入基準**:
- [ ] published な X 投稿に手動でメトリクスを記録でき、分析タブで最新値・履歴が見える
- [ ] x_api_tier=basic + metrics_sync_enabled で 30 分毎 worker が 24h 間隔スナップショットを取り、sns_sync_state に成功時刻が入る
- [ ] プラン不足 403 で E507 が記録され、以後の自動試行が止まる(手動同期ボタンで再開可)
- [ ] free ティアでは worker が API を一切呼ばない
- [ ] published 以外への手動入力は E510
- [ ] /api/jobs/sns-sync は x-jobs-secret 無しで 401

**テスト方針**: 24h デデュープ判定と対象選定の unit(repo モック)/x-api レスポンス fixture のパース unit/403→E507 停止の worker unit/parity(source/kind enum)。

---

### 3.5 #50 SNS 受信箱(コメント/DM)

**目的**: 受注の入口である X のリプ・メンション・DM を admin に集約し、「見た/返した/リード化した」を管理する。X アプリ内で流れて消える依頼の取りこぼしが直接の売上機会損失。inquiry(フォーム)・telephony(電話)と並ぶ第3の入口を CRM に接続する。

**スコープ**: sns_inbox_items(v1 は X のみ)/メンション・リプの API 同期(Basic 以上)+**手動起票**(free の現実解: DM を見て「受信箱に記録」)/状態管理(unread→read→replied/converted/archived)/リード化(customer+deal 作成)/nav バッジ。
**非スコープ**: アプリ内からの返信送信(v1 は X への deep link で外部返信 — DM 送信 API はコスト・凍結リスクに見合わない)/Instagram コメント・note コメント(テーブルは拡張可能に)/自動返信・AI 下書き(将来 ai-studio 合成)。

**DDL**(20260724000001_sns_inbox.sql):

```sql
create table sns_inbox_items (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('x')),
  item_type text not null check (item_type in ('mention','reply','quote','dm')),
  external_id text,                    -- 手動起票は null (API 同期行は必須)
  thread_external_id text,             -- DM 会話 id / 会話ルート tweet id
  author_external_id text,
  author_handle text not null,         -- '@xxx' (手動起票の必須キー)
  author_name text,
  body text not null,
  external_url text,
  occurred_at timestamptz not null,
  status text not null default 'unread'
    check (status in ('unread','read','replied','converted','archived')),
  converted_customer_id uuid references customers(id) on delete set null,
  converted_deal_id uuid references deals(id) on delete set null,
  source text not null default 'api' check (source in ('api','manual')),
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),      -- 手動起票者 / null = worker
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sns_inbox_items_external_uniq
  on sns_inbox_items (channel, item_type, external_id);   -- 非部分一意 (NULLS DISTINCT — 手動行は衝突しない。crm_core の冪等 index 原則踏襲)
create index sns_inbox_items_status_idx on sns_inbox_items (status, occurred_at desc);
-- RLS: admin/service のみ
```

**同期仕様**: 3.4 の同じ worker(`/api/jobs/sns-sync`)に kind='mentions'(`GET /2/users/:id/mentions`、since_id は sns_sync_state.since_cursor)と kind='dm'(`GET /2/dm_events`)を追加。inbox_sync_enabled=false または free ティアは skip。取得行は external_id 冪等 upsert(再取得しても増えない)。自分の投稿への通常リプはスレッド文脈(referenced_tweets)から item_type='reply'、引用は 'quote' に分類。

**契約・facade(distribution 拡張)**:

```ts
export const zInboxManualInput = z.object({
  item_type: z.enum(["mention","reply","quote","dm"]),
  author_handle: zShortText(50),
  author_name: zShortText(100).nullable(),
  body: zShortText(2000),
  external_url: z.string().url().max(300).nullable(),
  occurred_at: zIsoDatetime,
}).strict();
export const zInboxStatusAction = z.enum(["read","replied","archived","unread"]);

listInboxItems(filter: { status?; item_type?; cursor; limit }): Promise<Result<Paged<SnsInboxItemView>>>;
createInboxItemManual(input: InboxManualInput): Promise<Result<{ id: string }>>;
updateInboxStatus(id: string, action: InboxStatusAction): Promise<Result<void>>;  // converted への手動遷移・converted からの変更は E509
markInboxConverted(id: string, link: { customer_id: string; deal_id: string | null }): Promise<Result<void>>;
```

**リード化フロー(app 層合成 — intakeFromInquiry の精神を踏襲)**: 受信箱の行アクション「リード化」→ ダイアログで既存顧客検索(entity-picker 流用)or 新規(`crmFacade.createCustomer` — email/tel 不明の X 作家が普通なので、kind='person'・notes に @handle 記録。**E607(email か電話必須)は手動作成例外の既存仕様に乗る**)→ 任意で `createDeal`(source:'manual'、notes に投稿 URL)→ `markInboxConverted` → `appendActivity`(system、ref=sns_inbox_items 行、冪等)で deal/customer タイムラインに原文を残す。

**nav バッジ(機構の一本化)**: 既存 nav-badges の流儀(contact_inquiries/calls/tasks を直接 count)に揃える — nav-badges facade に `snsInbox: number`(unread count)を追加し、**sns_inbox_items を count のみで直読み**する。module-contracts.md:51 の対象テーブル列挙に sns_inbox_items を追記(count のみ・行取得しない原則は維持)。新コード **KMB-E003**。**distribution facade に countUnreadInbox は設けない**(二重機構を作らない — 所有 facade 経由 count と nav-badges 直 count のどちらかに寄せる裁定で後者を採用)。

**画面**: `/admin/channels` に underline-tabs「受信箱」(サイドナビのバッジは 発信スタジオ に合算)。data-table: 種別バッジ/差出人(@handle)/本文抜粋/経過時間/status。行クリックで詳細ドロワー: 原文全文+「Xで開く」(external_url)+「返信済みにする」+「リード化」。free ティア時は notice-panel +「手動で記録」ボタン(zInboxManualInput フォーム)。converted 行は顧客/案件へのリンク表示。

**受入基準**:
- [ ] 手動起票→未読バッジ増加→read/replied/archived の遷移ができる
- [ ] リード化で customer(+任意 deal)が作られ、タイムラインに原文 activity が入り、行が converted になる。同じ行の再リード化は E509
- [ ] basic + inbox_sync_enabled でメンション/リプ/引用が同期され、再実行しても重複しない(external_id 冪等)
- [ ] since_cursor が進み、全量再取得しない
- [ ] free ティアでは API を呼ばない。プラン不足 403 は E507 記録で自動停止
- [ ] nav バッジに未読件数が出る(0 件で非表示 — 既存バッジと同挙動)

**テスト方針**: mentions/dm fixture パース+分類(reply/quote判定)の unit/冪等 upsert の repo unit/E509 遷移表 unit/nav-badges の snsInbox count 統合(既存 E001/E002 テストと同型)。

---

### 3.6 P12' X(Twitter)コミュニティ運用支援

**目的**: X 運用の「定型のなさ」を潰す。投稿のたびにハッシュタグを考え、許諾を確認しに DM を遡る状態から、(1) 発信スタジオでのハッシュタグ・定型の一元管理、(2) 配信キュー・下書きへの許諾状態バッジ表示、(3) 顧客作品の引用 RP を許諾追跡と結び付ける、まで持っていく。**#50/#51/P17' の接着層**であり、独自テーブルはほぼ持たない。

**スコープ**: sns_ops.hashtag_presets / mention_watch_queries の設定 UI/works・deal 起点の「Xに投稿」導線(既存 ai-studio 配信パイプラインへの入口)/配信キュー・draft への許諾バッジ(source_deal_id 経由)/受信箱の quote/mention から「引用RP 許諾依頼」→ publication_consents(scope_sns)へ接続。
**非スコープ**: 投稿の自動生成強化(ai-studio 側の所掌)/フォロー管理・リスト管理/予約最適時刻の提案。

**実装**(新テーブルなし。migration 不要):
1. **設定**: `/admin/settings` の設定ハブ(R4b)に「SNS運用」セクション追加 — zSnsOpsSettings(3.4)の hashtag_presets(タグ编集 UI・pill-toggle 流用)と mention_watch_queries。
2. **投稿導線**: `/admin/works/[id]` と DealPhotosCard に「Xで発信」ボタン → 既存 ai-studio 発信フロー(/admin/studio)へ work/写真を初期素材として渡す(既存 zChannelDraft の media_ids 経路 — module-contracts.md:477 — を流用。app 層でプリフィルするだけ)。ボタン押下時に `assertConsentedFor(dealId,'sns')` を検証し、未許諾は E685 ダイアログ(許諾カードへ誘導)。deal 由来でない works は無条件可。
3. **許諾バッジ**: channel-posts-queue.tsx の行に、draft→work→source_deal_id を辿れる場合のみ「許諾済/未許諾」status-badge を表示(app 層で engagementFacade.getConsentByDeal を合成)。
4. **引用RP 追跡**: 受信箱(3.5)の quote/mention 行のドロワーに「作品引用の許諾を依頼」ボタン → 対象 deal を entity-picker で選び `issueConsentRequestToken` → DM 用定型文(リンク入り)をクリップボードへ(DM 送信自体は手動 — 非スコープ原則)。
5. **ハッシュタグ適用**: ai-studio の X 向け draft 編集画面に hashtag_presets のワンタップ挿入 chips(settings 読むだけ)。

**受入基準**:
- [ ] 設定でハッシュタグ候補・監視クエリを保存でき、draft 編集画面から1タップ挿入できる
- [ ] works/deal 写真から発信フローに入れ、未許諾 deal 由来はブロック+誘導される
- [ ] 配信キューに許諾バッジが出る(deal 由来投稿のみ)
- [ ] 受信箱から許諾依頼トークンを発行し、定型文をコピーできる

**テスト方針**: 許諾バッジの合成ロジック(draft→work→deal 解決)の unit/settings スキーマ parity。UI 導線は手動確認。

---

### 3.7 P13' クラファンプラットフォーム案件管理

**目的**: 「勝負試作(Makuake 掲載用1体)→ ブリッジ生産(リターン量産)」を親子案件として1本の商流で見る。掲載ページの URL・スケジュール(公開日/終了日/リターン納期)・クレジット獲得状況を案件に持たせ、§5 優先3位チャネル「クラファン露出」の営業(掲載クレジット獲得)を仕組みにする。試作→量産の転換率が KPI になる。

**スコープ**: deals.parent_deal_id(1階層)/deal_crowdfunding 付帯情報/deal 詳細のカード+親子ナビ/一覧・かんばんの CF バッジ/クレジット獲得は P17' の scope_crowdfunding と連動表示。
**非スコープ**: プラットフォーム API 連携・支援額スクレイピング/リターン個数と受注明細の自動リンク(量産案件の明細は既存 work_templates/expandLinesToBlocks の通常フロー)/3階層以上の案件ツリー。

**DDL**(20260725000001_crm_deal_crowdfunding.sql):

```sql
alter table deals add column parent_deal_id uuid references deals(id) on delete set null;
alter table deals add constraint deals_no_self_parent
  check (parent_deal_id is null or parent_deal_id <> id);
create index deals_parent_idx on deals (parent_deal_id) where parent_deal_id is not null;

create table deal_crowdfunding (
  deal_id uuid primary key references deals(id) on delete cascade,
  platform text not null
    check (platform in ('makuake','campfire','greenfunding','kibidango','other')),
  project_url text,
  project_title text,
  launch_on date,
  end_on date,
  reward_due_on date,        -- リターン量産の納品期限 (scheduling の納期はあくまで受注明細側が正)
  credit_status text not null default 'none'
    check (credit_status in ('none','requested','granted','published')),
  credit_note text,          -- '塗装: 隈部塗装' の掲載箇所メモ
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: crm 既存テーブルと同一 (admin 3分類 + service)
```

多段禁止(親が更に親を持つ場合は E615)・終端 stage(lost)の deal を親に指定は E615 — アプリ層検証(DB は自己参照 CHECK のみ。1人運用で DB トリガまでは過剰)。

**契約・facade(crm 拡張)**:

```ts
export const zDealCrowdfundingInput = z.object({
  platform: z.enum(["makuake","campfire","greenfunding","kibidango","other"]),
  project_url: z.string().url().max(300).nullable(),
  project_title: zShortText(120).nullable(),
  launch_on: zDateOnly.nullable(),
  end_on: zDateOnly.nullable(),
  reward_due_on: zDateOnly.nullable(),
  credit_status: z.enum(["none","requested","granted","published"]),
  credit_note: zShortText(200).nullable(),
  notes: zShortText(1000).nullable(),
}).strict().refine(v => !v.launch_on || !v.end_on || v.launch_on <= v.end_on,
  "公開日は終了日以前にしてください (KMB-E616)");

// CrmFacadeExtended へ追加
setDealParent(dealId: string, parentDealId: string | null,
  expectedUpdatedAt: string): Promise<Result<void>>;                     // E615
listChildDeals(dealId: string): Promise<Result<DealSummaryView[]>>;
upsertDealCrowdfunding(dealId: string, input: DealCrowdfundingInput,
  expectedUpdatedAt: string | null): Promise<Result<void>>;              // CAS=E103, 入力=E616
getDealCrowdfunding(dealId: string): Promise<Result<DealCrowdfundingView | null>>;
```

**画面**: `/admin/deals/[id]` に **DealCrowdfundingCard**(platform バッジ・project_url リンク・3日付・credit_status バッジ。P17' 実装済みなら scope_crowdfunding の許諾状態も併記)。DealOverviewCard に親案件リンク/子案件リスト(「量産案件を作成」ボタン = DealForm を親 ID・顧客プリフィルで開く)。deals-table/deals-kanban に「CF」pill と親子アイコン。reward_due_on が7日以内なら crm digest の既存「やること」感覚で collectDigest に「CF リターン納期接近」行を追加(crm 内完結なので合成不要)。

**受入基準**:
- [ ] 案件にクラファン情報を記録・編集できる(CAS 排他・日付順序 E616)
- [ ] 親子リンクを張れ、自己参照・2階層・lost 親は E615
- [ ] 子案件作成ボタンで顧客・親がプリフィルされた新規フォームが開く
- [ ] 一覧・かんばんで CF 案件と親子関係が識別できる
- [ ] reward_due_on 接近が日次 digest に載る
- [ ] 終端ステージ不変トリガ等の既存 deals 挙動が退行しない(parent_deal_id 追加が既存 zDealInput の strict を壊さない — 契約は optional 追加)

**テスト方針**: E615 判定(自己/循環/多段/lost親)の unit/zDealCrowdfundingInput refine の unit/digest 行追加の collectDigest unit/parity(platform/credit_status enum)。

---

## 4. Issue 分割案(1 Issue = 1 PR)

| # | タイトル案 | 含む項目 | 依存 | 規模 |
|---|---|---|---|---|
| A | feat(engagement): 作例公開許諾・掲載権管理 — engagement モジュール新設+許諾フォーム(P17') | P17'(publication_consents・DealConsentCard・/c/[token]・E680-699 帯の契約書追記) | なし | **M** |
| B | feat(engagement): 案件ビフォーアフター写真管理と works 事例化導線(P7') | P7'(deal_photos・works/voices.source_deal_id・事例化・zip 書き出し・E685 ガード) | A | **M** |
| C | feat(engagement): 納品後フィードバック自動配信 — NPS+作例許諾+X言及依頼(#104+#98) | #104, #98(feedback_requests・crm-digest 便乗送信・/f/[token]・voices 転用) | A(・fulfillment-ops-loop のトリガーは任意配線。フォールバックあり) | **M** |
| D | feat(distribution): SNS 投稿パフォーマンス分析 — メトリクス基盤+分析タブ(#51) | #51(channel_post_metrics・sns_sync_state・sns_ops 設定キー・kmb-sns-sync-worker・手動入力) | なし | **M** |
| E | feat(distribution): SNS 受信箱 — メンション/DM 集約とリード化(#50) | #50(sns_inbox_items・同期 kind 追加・受信箱タブ・リード化合成・nav バッジ E003) | D(worker/設定基盤) | **L** |
| F | feat(app): X 運用支援 — ハッシュタグ定型・許諾バッジ・引用RP追跡(P12') | P12'(設定 UI・投稿導線・配信キューバッジ・引用RP→許諾接続。migration なし) | A, E(D は間接) | **S** |
| G | feat(crm): クラファン案件管理 — 親子案件+プロジェクト情報(P13') | P13'(deals.parent_deal_id・deal_crowdfunding・カード・digest 行) | なし | **M** |

- 並列可能: {A, D, G} を第1波で同時着手可。第2波 {B, C, E}、最後に F(接着層)。
- 全 Issue 共通の完了条件: module-contracts.md への追記(engagement 新設は A、facade 拡張は各自)/contracts-ddl-parity テスト更新/`.admin-theme` トークン+ _ui 小物の流用(新規スタイル発明禁止)/E840-859・emails テーブル不使用。**加えて明示**: D は §1 所有マトリクスへの distribution 所有テーブル行(channel_post_metrics/sns_sync_state)+ §4.2 SETTINGS_SCHEMAS への `sns_ops` 追記、E は sns_inbox_items 所有行+nav-badges 対象テーブル列挙(:51)への追記、C は base CrmFacade `listDeliveredDealsForFollowup` の §5 追記、を各 Issue の完了条件に含める。
- **migration 採番注意**: 本書のファイル名(20260720〜20260725)は fulfillment トラックの仮採番と衝突するプレースホルダ — 実採番は 00-統合設計.md の全体割当表と `ls supabase/migrations` の当日最大 NN+1 に従う。
- Issue 本文には本設計書の該当節(§3.x)をそのまま貼れる詳細度で起票する(起票承認は不要 — memory 方針)。

## 5. リスクと判断点(オーケストレーターへの申し送り)

1. **X API 有料プラン**: #50/#51 の自動同期は Basic 以上が前提。設計は free で完結する手動経路を全て持つため、**加入判断は運用開始後に伸びを見てからで良い**(sns_ops.x_api_tier を切り替えるだけ)。
2. **#147(案件添付)との境界**: deal_photos は写真+工程タグ特化。fulfillment-ops-loop 側が汎用 deal_attachments を設計する場合、Issue B 着手前に「photos を attachments の kind に統合するか併存か」を1度だけ裁定してほしい(本設計は併存で成立)。
3. **delivered トリガー**: Track2 のトリガー形態が確定したら Issue C の `scheduleForDeal` を配線する。未確定でも日次スキャンで機能は成立(最大1日遅延)。
4. **engagement モジュール新設**: crm 帯の残弾温存と 01-crm.md スコープ維持のための判断。module-contracts.md v3.0 追記が Issue A に含まれる。
