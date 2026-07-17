# トラック詳細設計: 受付導線・メール基盤・自動応答 (key=intake-comms-foundation)

- 版: v1.0 (2026-07-18) / 設計担当: Fable
- 対象項目: P16' / #103 / #33 / #3 / #32 / #53(→スコープ裁定で除外) / #2 / #5 / #54 / P18'
- 前提: 1人工房・過剰設計禁止。docs/module-contracts.md v2.9 準拠(facade/contracts/repository 分離・Result 型・エラーコード帯所有)。
- 本書は設計のみ。migration 検証は「本番適用後 execute_sql 検証」運用(docker なし)に従う。

---

## 0. 現状調査(実コード根拠・file:line)

### 0.1 問い合わせ受付(inquiry モジュール)

| 事実 | 根拠 |
|---|---|
| 公開フォーム入力契約は name/email/tel/inquiry_type('construction'\|'estimate'\|'material'\|'other')/item/body/privacy_agreed のみ。添付・材質・寸法フィールドは無い | `src/modules/inquiry/contracts.ts:10-24` |
| `InquiryFacade.submit` = anon が触る唯一の書き込み。保存成功後 `notifyInquiryReceived` を void で呼ぶベストエフォート通知(失敗は KMB-E902 ログのみ) | `src/modules/inquiry/facade.ts:37-50` |
| 通知メールは **管理者宛のみ**(宛先 = site_settings 'notifications'.inquiry_to)。**顧客宛の自動返信は存在しない** | `src/modules/inquiry/internal/notify.ts:112-148`(宛先取得 50-72) |
| 差出人は `no-reply@<NEXT_PUBLIC_SITE_URL のホスト名>` をコード導出。ドメイン認証前提の env 上書き手段は無い | `src/modules/inquiry/internal/notify.ts:31-38` |
| contact_inquiries DDL: name/email/tel/inquiry_type/item/body/status/handled_at のみ。添付テーブル無し | `supabase/migrations/20260708000001_init_schema.sql:144-156` |
| スパム対策 = honeypot + 送信最小時間 + IP rate limit(rate_limits テーブル、salt 付き SHA-256) | `src/components/contact/actions.ts:17-25`, `supabase/migrations/20260708000001_init_schema.sql:159-165` |
| フォーム UI は react-hook-form + shadcn Field 群。ファイル入力なし | `src/components/contact/contact-form.tsx:1-80` |
| シミュレーター発リードは `/api/shop/lead` で InquiryFacade.submit → CrmFacade.intakeFromSimulator → SalesFacade.createDraftQuoteFromEstimate の app 層合成(anon 起点・service 実行) | `src/app/api/shop/lead/route.ts:24-36` |
| inquiry の所有エラーコードは E105(+E101 共用)。**E104 / E106 は全帯で未使用**(grep で使用 0 件 — E101×278, E102×18, E103×50, E105×6, E107×15, E108×2, E109×19) | `docs/module-contracts.md:40`(所有表)+ src/docs 全文 grep |

### 0.2 メール送信基盤(Resend)

| 事実 | 根拠 |
|---|---|
| Resend 送信実装は 2 箇所: inquiry 通知(ベストエフォート)と sales 帳票メール(Result 返却・document_emails 台帳記録)。`fromAddress()`/`escapeHtml()` は「許容された重複実装」として二重定義 | `src/modules/inquiry/internal/notify.ts:31-38`, `src/modules/sales/internal/email.ts:9-16,30-37` |
| `RESEND_API_KEY` は任意 env。`isResendConfigured()` で有無判定 | `src/lib/env.ts:38,108-110` |
| 帳票メールの送信台帳 document_emails は migration 0036 で存在(sales 所有) | `docs/module-contracts.md:47` |
| **一斉配信・購読管理・テンプレート・オプトアウトの実装は皆無**(モジュール・テーブルとも無し) | `src/modules/` 一覧(outreach/mail 系モジュール不在)+ migration 全 39 本に該当 DDL 無し |
| 通知設定は site_settings 'notifications' キー = **`{ inquiry_to, on_publish_failure }` の 2 フィールド**(`.strict()`)。Slack/Teams webhook 設定は無い。settings-forms.tsx の通知フォームは on_publish_failure も既に描画している | `src/modules/settings/contracts.ts:77-84,165` |

### 0.3 ジョブ・cron 基盤(流用元)

| 事実 | 根拠 |
|---|---|
| pg_cron + pg_net → Vault(cron_site_url / cron_jobs_secret)→ `/api/jobs/*` POST(x-jobs-secret)→ 202 即応 + `after()` 実行、が確立パターン | `supabase/migrations/20260711000024_crm_digest_cron.sql:20-39`, `src/app/api/jobs/publish/route.ts:13-36` |
| 既存 job route は publish(毎分)/crm-digest(日次 JST07:00)/telephony/calendar-sync/watchdog/cleanup-ai-drafts 等 6 本 | `src/app/api/jobs/` 一覧 |
| distribution の配信キュー(channel_posts を毎分バッチで claim して外部 API 実行、1 回最大 5 件)は一斉配信ワーカーの直接の雛形 | `src/app/api/jobs/publish/route.ts:26-28`(runPublishWorkerBatch) |

### 0.4 Storage・アップロード

| 事実 | 根拠 |
|---|---|
| バケットは media(public)/media-originals/audio 等。**INSERT/UPDATE/DELETE は全て admin 限定** — anon がアップロードできるバケットは存在しない | `supabase/migrations/20260708000003_storage.sql:6-10,46-67` |
| 署名付きアップロード URL 発行は `/api/upload-url`(**requireAdmin 必須**)。uuid プレフィックス + ファイル名サニタイズの規約あり | `src/app/api/upload-url/route.ts:21-44` |

### 0.5 顧客・価格(受信者選定と自動判定の土台)

| 事実 | 根拠 |
|---|---|
| customers.email は nullable・**非 unique**(家族共用メール許容)。lifecycle('lead'/'customer'/'archived')・source あり。タグ列は無い(custom_fields jsonb は 0715 追加) | `supabase/migrations/20260711000023_crm_core.sql`(create table customers)、`20260715000001_customers_custom_fields.sql:21` |
| price_size_classes に `max_mm`(null=上限なし/個別見積) — 寸法→サイズクラス自動判定は既存データで可能 | `supabase/migrations/20260708000007_pricing_v2.sql:4-10`, `src/modules/pricing/contracts.ts:119-129` |
| simulator 見積スナップショット(grade×size×qty)と form_submission/simulator_estimate の activity payload は crm 契約に確立済み | `src/modules/crm/contracts.ts:132-153,186-197` |
| 材質(PLA/レジン等)の構造化マスタは**どこにも無い**。'material' は問い合わせ種別 enum の一値のみ | `src/modules/crm/contracts.ts:126,469-472` grep |
| 公開サイトに /materials ページ(対応材料の文言)と /contact が既存 | `src/app/` 一覧 |

### 0.6 #100(メール統合)の確定スコープ — #53 の重複確認結果

| 事実 | 根拠 |
|---|---|
| 08-email.md は **v2 要件確定(2026-07-17)**。B1=Resend Inbound(受信専用サブドメイン)採用 | `docs/design/crm-suite/08-email.md:1-3` |
| **送信控え(BCC 運用)は Phase 2 に「含める」と確定済み(OQ-2)**。控え用アドレスは inbound アドレスを共用 | `08-email.md:36`(§0.4 スコープ確定) |
| emails/email_attachments テーブル・match_status 状態機械・/admin/emails・mail モジュール(KMB-E840〜E859)・`/api/mail/inbound` まで確定 | `08-email.md:64-66,141,336-347` |
| 帳票メール(outbound)・document_emails は #100 の対象外として明記(変更しない) | `08-email.md:43,76-77` |

**裁定: #53(BCC/転送アドレスによるメール自動ロギング)は #100 Phase 2 に完全内包されている。本トラックでは実装しない**(§1.1 参照)。

---

## 1. トラック全体方針

### 1.1 スコープ裁定(#53 と #100 の境界)

- **#53 は本トラックから除外**。08-email.md §0.4(OQ-2 確定)が BCC 控えロギングを Phase 2 スコープに含めており、テーブル(emails)・モジュール(mail, E840-859)・照合(matchCustomerByEmail)・UI(/admin/emails)まで確定済み。本トラックで別実装すると二重基盤になる。
- 本トラックが新設する**送信系**は #100 の**受信系**と衝突しない: #100 は「document_emails / sendDocumentEmail は変更しない」(08-email.md:76-77)と outbound 側を明示的に不変扱いしており、本トラックの outbound 追加(自動返信・一斉配信)は同じ位置づけ。E840-859 帯は使用しない。
- 唯一の接点は **DNS**(#33): 送信ドメイン認証(SPF/DKIM/DMARC)は organizational domain に効くため、#100 の受信専用サブドメイン(MX)より**先に p=none で観測を始めるのが正順**。#33 の受入基準に「#100 の受信サブドメイン追加を妨げない(サブドメイン MX は DMARC 対象外レコードとして独立)」を含める。

### 1.2 モジュール配置と新設帯

| 項目 | 配置 | 理由 |
|---|---|---|
| P16'(添付フォーム)・#103・#2・#54 | **inquiry 拡張**(+settings キー追加) | 全てフォーム受付パイプラインの延長。inquiry は contact_inquiries/rate_limits 所有(module-contracts.md:40) |
| #3・#32・#5 | **新モジュール `outreach`**(一斉配信・購読管理・テンプレート) | crm(顧客ハブ)にもsales(帳票)にも属さない独立関心事。mail モジュール新設(08-email.md §7)と同じ前例に従う |
| P18'(材質ナレッジ) | **pricing 拡張** | 見積/受付時の判定マスタ = 価格マスタ群(price_grades/price_size_classes)と同じ「公開 read + admin CRUD」パターン。simulator/フォームからの消費経路も同じ |
| #33 | env + docs(runbook)+ 送信 3 箇所の from 一元化 | コード変更は極小。主作業は DNS |

**エラーコード新設**(module-contracts.md 改訂が先、の規約に従い Issue 内で契約書改訂を含める):

- inquiry: **KMB-E104**「添付の検証失敗(種別/サイズ/枚数/発行スロット不一致)」— 1xx 帯内の未使用番号(§0.1 で使用 0 件確認済)。
- outreach: **KMB-E860〜E879 を新帯として割当**(E840-859 は mail 予約済のため直後の未予約帯。並行トラックとの帯衝突は 00-統合設計.md の全体割当表で解消済み: dataio=E880-899 / seo=E740-759 / fulfillment=E650-679 / engagement=E680-699)。
  - E860 テンプレート不在/変数展開失敗 E861 キャンペーン状態遷移違反 E862 対象受信者 0 件 E863 Resend 未設定(sales E644 同型) E864 購読解除トークン不正 E865 送信バッチ実行失敗 **E866 UNSUBSCRIBE_TOKEN_SECRET 未設定**(E863 の二義的使用を避けるため分離)E867-879 予約(未使用分は返上 — telephony 帯運用の先例)。
  - **canonical 登録先**: 新帯 E860-879 の帯予約は **00-overview.md §3.3 の帯予約表への追記が必須**(現表は telephony E839 まで — #100 が E840-859 で同様の追記を要したのと同型)。依存辺 outreach→crm は module-contracts.md §2 の依存グラフ(明示列挙 line73-95)への**新辺追加**が必要。改訂ルーティングは **07-contracts-delta.md 集約(裁定 J10)を正**とし、module-contracts.md を直接編集しない(00-overview:946 の規約 — 本書の「module-contracts.md 改訂」表現はすべて 07-delta 経由と読み替える)。
- pricing(P18')は E101/E103 共用のままで足りる(CRUD 検証のみ。適合警告はエラーではなく表示)。

### 1.3 migration 採番

現行 head は `20260715000002_customers_billing_shipping.sql`。直近 2 本は「日付 + 日内連番」方式(20260715000001, 20260715000002)に移行しているため、本トラックも **`<実装日>0000NN`(日内連番)** で採番する。本書では仮に実装日を X として `202607XX0000NN` と表記(Issue 順に N を採る)。**並行トラック衝突注意**: 過去に `20260714000036` が 3 本並存した事故があるため、migration 作成前に必ず `ls supabase/migrations` で当日最大 NN+1 を取り、全トラック横断の順序は 00-統合設計.md の migration 全体割当表に従う。

### 1.4 送信メールの 3 分類(本トラックの背骨)

| 分類 | 例 | オプトアウト対象 | 台帳 |
|---|---|---|---|
| 管理者通知 | 問い合わせ受信通知(既存)・Slack 通知(#54) | 対象外 | 不要(ログのみ) |
| トランザクション(顧客宛) | 自動返信(#103)・帳票メール(既存 sales) | **対象外**(特定電子メール法の広告宣伝メールに非該当) | 自動返信はログのみ(1人工房で台帳過剰)・帳票は document_emails 既存 |
| マーケティング(顧客宛) | 一斉配信(#3) | **必須**(#32) | email_campaign_recipients(新設) |

---

## 2. 項目別設計

### 2.1 #33 送信ドメイン認証(SPF/DKIM/DMARC)— 高・S

**目的**: 見積・納期回答・自動返信・発送通知が全てメールで届く業態の到達率確保。現状は `no-reply@<ホスト名>` をドメイン未認証のまま Resend に渡しており(notify.ts:31-38)、独自ドメイン運用時に DKIM/SPF 不整合で迷惑メール行きになるリスクがそのまま残っている。

**スコープ**: Resend でのドメイン認証 + Cloudflare DNS レコード追加(runbook 化)+ 差出人アドレスの env 一元化。
**非スコープ**: DMARC レポート解析ツール(受信箱で目視)/BIMI/#100 の受信サブドメイン設定(向こうの M0')。

**DDL**: なし。

**契約・コード変更**:
- `src/lib/env.ts`: `MAIL_FROM_ADDRESS`(任意, `z.string().email().optional()` + emptyToUndefined)と `isMailFromConfigured()` を追加。
- `mailFromAddress(): string` を lib(env.ts 隣接の `src/lib/mail-from.ts` 等)に新設: `MAIL_FROM_ADDRESS ?? "no-reply@" + host(NEXT_PUBLIC_SITE_URL)`(既存導出をフォールバックとして温存)。
- 既存 2 箇所の `fromAddress()`(inquiry/internal/notify.ts:31-38, sales/internal/email.ts:30-37)をこれに置換。「許容された重複実装」は 2 箇所までの暫定だったが、本トラックで outreach が 3 箇所目になるため lib へ昇格する(モジュール間 internal import 禁止に抵触しない lib 配置。module-contracts.md へ注記追記)。

**運用手順(Issue に runbook として同梱)**:
1. Resend ダッシュボードで独自ドメインを追加 → 提示された DKIM(`resend._domainkey` TXT)・Return-Path 用 SPF(`send.<domain>` の TXT + MX)を Cloudflare に登録。
2. `_dmarc.<domain>` TXT `v=DMARC1; p=none; rua=mailto:<集約先>` を登録(観測 2 週間 → `p=quarantine` へ引き上げ)。
3. Vercel env に `MAIL_FROM_ADDRESS=no-reply@<認証済みドメイン>` を設定。

**受入基準**:
- [ ] Gmail 宛て実送信のヘッダで `spf=pass dkim=pass dmarc=pass`(Authentication-Results)を確認
- [ ] 差出人が MAIL_FROM_ADDRESS になる(問い合わせ通知・帳票メールの両方)
- [ ] env 未設定環境では従来どおりホスト名導出で degrade(既存テスト green のまま)
- [ ] `_dmarc` は p=none で開始し、runbook に引き上げ条件が明記されている
- [ ] #100 の受信サブドメイン(MX)追加を妨げない構成であることを runbook に注記

**テスト方針**: `mailFromAddress()` の unit(env 有/無/不正 URL フォールバック)。実送信確認は mail-tester.com + Gmail ヘッダ目視(手動受入)。

---

### 2.2 P18' 材質×塗料適合ナレッジ — 中・M(pricing 拡張)

**目的**: 「ナイロンは密着が難しい」等の暗黙知をマスタ化し、**受けてはいけない案件を入口(フォーム/見積)で弾く**。リワーク削減 = 1人工房の時間を守る機能。P16' フォームの材質セレクトの選択肢マスタを兼ねる。

**スコープ**: 材質マスタ + 材質×塗料系統の適合ルール + admin CRUD + 公開 read(フォーム警告用)。
**非スコープ**: 調色レシピ(別トラック)/公開 /materials ページの動的化(将来この マスタを流用可、と注記のみ)/見積金額への自動反映。

**DDL**(`202607XX0000NN_pricing_materials.sql`):

```sql
create table materials (
  key text primary key,              -- 'pla' | 'petg' | 'abs' | 'asa' | 'resin' | 'nylon' | ...
  label text not null,               -- 表示名 (PLA / レジン(光造形) 等)
  overall text not null default 'ok' check (overall in ('ok','caution','ng')),
    -- フォーム警告用の総合判定 (ルール明細の最悪値を admin 保存時に手動確定 — 自動集計 trigger は過剰設計)
  public_note text,                  -- フォームに出す注意文 ("密着処理が必要なため要相談" 等)
  active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);
create table material_paint_rules (
  id uuid primary key default gen_random_uuid(),
  material_key text not null references materials(key) on delete cascade,
  paint_system text not null check (paint_system in ('lacquer','urethane','acrylic','primer')),
  verdict text not null check (verdict in ('ok','caution','ng')),
  pretreatment text,                 -- 前処理条件 (足付け#400/プライマー指定 等)
  note text,
  unique (material_key, paint_system)
);
-- RLS: anon/authenticated SELECT (materials は active=true のみ anon)、admin 全操作
--      price_grades と同じ「公開価格マスタ」パターン (0002/0007 踏襲)
```

**契約**(pricing/contracts.ts 追記):

```ts
export const zMaterialInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/),
  label: zShortText(30),
  overall: z.enum(["ok","caution","ng"]),
  public_note: zShortText(200).nullable(),
  active: z.boolean(),
  sort_order: z.number().int().min(0),
}).strict();
export const zMaterialPaintRuleInput = z.object({
  material_key: z.string(), paint_system: z.enum(["lacquer","urethane","acrylic","primer"]),
  verdict: z.enum(["ok","caution","ng"]),
  pretreatment: zShortText(200).nullable(), note: zShortText(200).nullable(),
}).strict();
```

facade(PricingFacade 拡張): `listMaterials(includeInactive?)` / `upsertMaterial(input)` / `deleteMaterial(key)` / `listPaintRules(materialKey)` / `upsertPaintRule(input)` / `deletePaintRule(id)`。エラーは E101(検証)/E103(楽観排他は updated_at 慣行)/E901。公開側は `listMaterials(false)` を site-public から read(依存方向 `site-public → pricing` は既存辺)。

**UI**: `/admin/prices` に「材質」タブ追加(既存の価格表画面が grade/size/option をタブで持つ構造に相乗り — R系リデザインの underline-tabs 語彙)。行 = 材質、展開で塗料系統別ルール編集。verdict は status-badge(ok=success/caution=warning/ng=destructive)の既存語彙。

**ジョブ**: なし。

**受入基準**:
- [ ] 材質 6 種(PLA/PETG/ABS/ASA/レジン/ナイロン)を seed(初期データ migration 同梱、文言は空でも可)
- [ ] admin で材質とルールの CRUD ができ、非 active は公開 read に出ない
- [ ] anon から materials(active)と material_paint_rules が SELECT できる(RLS テスト)
- [ ] P16' フォーム(2.3)が本マスタをセレクト肢として消費できる facade シグネチャになっている

**テスト方針**: contracts の Zod unit / repository の RLS 前提はモック client で facade 分岐 unit(既存 pricing テストの型に従う)。

---

### 2.3 P16' 写真/データ添付つき依頼フォーム — 高・L(inquiry 拡張)

**目的**: 「これ塗れますか?いくら?」に写真 1 枚で答える導線。見積往復を減らし成約を速める。現状は本文テキストのみ(contracts.ts:10-24)で、写真は別途メール往復になっている。

**スコープ**: 公開フォームへの画像添付(最大 5 枚 × 10MB、jpeg/png/webp/heic)+ 材質セレクト(P18' マスタ)+ 最長寸法入力 + サイズクラス自動判定表示 + admin 問い合わせ詳細での添付閲覧 + 孤児ファイル掃除 cron。contact フォームとシミュレーターリードフォームの両方から使える共有ウィジェット(MVP は contact フォーム接続、シミュレーター側は同 Issue 内で入力欄のみ追加)。
**非スコープ**: 3D データ(STL 等)の受領(画像のみ。データ入稿は容量・ウイルス面で別検討と注記)/画像の自動解析/顧客ポータル。

**DDL**(`202607XX0000NN_inquiry_attachments.sql`):

```sql
-- private バケット (anon ポリシーなし = service 経由の署名 URL のみ。0003 の admin 系とも分離)
insert into storage.buckets (id, name, public) values ('inquiry-uploads','inquiry-uploads', false);
create policy inquiry_uploads_admin_select on storage.objects for select
  using (bucket_id = 'inquiry-uploads' and public.is_admin());

create table inquiry_attachments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references contact_inquiries(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes int not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index on inquiry_attachments (inquiry_id);

alter table contact_inquiries
  add column material_key text,          -- FK は張らない (pricing 所有テーブルへの跨モジュール FK 回避 — snapshot 同様 key 文字列保持)
  add column size_longest_mm int check (size_longest_mm is null or size_longest_mm > 0);
-- RLS: inquiry_attachments は admin SELECT + service INSERT のみ (anon 不可)
```

**アップロードフロー**(admin 専用 `/api/upload-url`(route.ts:21-26)は流用不可のため公開版を新設):
1. `POST /api/inquiry/upload-url`(anon): body `{ filename, mime_type, size_bytes }`。ガード = 既存 `checkAndRecordRateLimit`(src/components/contact/rate-limit.server.ts:32。**現行は閾値が固定 5 回/時(spam-guard.ts:12 の RATE_LIMIT_MAX_PER_HOUR 既定)なので、第 4 引数 `maxPerHour?: number`(既定 5 = 後方互換)を追加する署名変更を本 Issue に含める**。route キー `'inquiry-upload'`、上限 20 回/時)+ mime/size の申告値検証(違反 = **KMB-E104**)。service client で `inquiry-uploads` バケットに `pending/<uuid>-<safeName>` の署名付きアップロード URL を発行(uuid プレフィックス + サニタイズは upload-url/route.ts:38-43 の規約踏襲)。
2. クライアントが PUT アップロード(進捗表示)。
3. フォーム送信時、`attachments: [{storage_path, file_name, mime_type, size_bytes}]`(max 5)を InquiryInput 拡張として送る。
4. `InquiryFacade.submit` 内で検証: 各 path が `pending/` プレフィックスであること・件数上限に加え、**service client で Storage 実体のメタデータを取得し、実 `metadata.size` / 実 `content-type` を zInquiryAttachmentInput の境界で再検証する(発行時のクライアント申告値は信用しない — 署名 URL の PUT 時に Content-Type/実体は詐称可能)。さらに実体の先頭バイトをマジックナンバー照合(jpeg/png/webp/heic のシグネチャ)して偽装 mime を拒否する。不一致・照合失敗 = KMB-E104**(送信自体を失敗させる — 添付は主コンテンツのため best-effort にしない)。inquiry INSERT 後に inquiry_attachments INSERT + Storage 上を `saved/<inquiry_id>/...` へ move(孤児判定を単純化)。

**契約**(inquiry/contracts.ts 拡張 — zInquiryInput は公開契約のため 07-delta 経由で module-contracts.md 改訂を先行):

```ts
export const zInquiryAttachmentInput = z.object({
  storage_path: z.string().max(300).regex(/^pending\//),
  file_name: zShortText(100),
  mime_type: z.enum(["image/jpeg","image/png","image/webp","image/heic"]),
  size_bytes: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict();
// zInquiryInput に追加 (全て optional — 既存 contact フォーム後方互換):
//   attachments: z.array(zInquiryAttachmentInput).max(5).default([])
//   material_key: z.string().max(30).nullable().default(null)
//   size_longest_mm: z.number().int().positive().max(2000).nullable().default(null)
```

facade 拡張: `listAttachments(inquiryId): Promise<Result<InquiryAttachmentRow[]>>`(admin。閲覧用署名 URL は admin 画面の server component で service 発行)。

**UI**:
- 公開: contact-form.tsx にドロップゾーン(admin の empty-drop-zone.tsx と同じ視覚語彙の公開版を components/contact 配下に新設 — admin/_ui は admin 専用のため import しない)。材質セレクト(P18' マスタ、overall≠'ok' なら public_note を warning 表示。'ng' でも送信は止めない — 「要相談」誘導が商機)。最長寸法入力 → price_size_classes.max_mm(pricing facade read)で「サイズクラス: M(〜150mm)目安 ¥X〜¥Y」を即時表示。**フォームにはグレード選択が無いため、金額は「全 active グレード横断の min〜max レンジ」— computeEstimate(grade×判定 size×qty=1)を全グレードで回して算出**する(仮グレード決め打ちはしない)。判定サイズクラスが quote_only、または寸法が最大クラスの max_mm を超える(= null 上限クラス該当)場合は金額を出さず「個別お見積り」表示に分岐(price_size_classes の quote_only 列を表示ロジックに含める)。
- admin: `/admin/inquiries/[id]`(既存詳細)に添付サムネイルグリッド + 材質/寸法表示。材質が caution/ng ならヘッダに status-badge 警告。
- crm 連携: 既存 `zFormSubmissionActivityPayload`(crm/contracts.ts)に添付枚数・material_key を載せるかは crm 契約改訂が要るため**本 Issue では inquiry 側表示のみ**とし、payload 拡張は非スコープ(将来 #147 案件添付で統合)。

**ジョブ**: 既存 cleanup 系(cleanup-ai-drafts)と同型で、`/api/jobs/cleanup-ai-drafts` に相乗りせず **inquiry-uploads の `pending/` 24h 超を削除する処理を watchdog か新設日次 job に追加**(推奨: 既存 crm-digest と同時刻の日次 1 本 `/api/jobs/inquiry-cleanup`、pg_cron 登録は 0024 パターン)。

**受入基準**:
- [ ] 画像 3 枚添付で送信 → contact_inquiries + inquiry_attachments 3 行 + saved/ へ move 済み
- [ ] mime 偽装(拡張子 jpg・実体 text — submit 時のマジックナンバー照合で検出)・実体 11MB(申告値でなく Storage 実体サイズ)・6 枚・未発行 path は KMB-E104 で拒否
- [ ] anon はバケットの list/select 不可(署名 URL のみ)。admin 詳細でサムネイル表示・原寸 DL 可
- [ ] 材質 'ng' 選択で警告文表示のうえ送信可能。管理画面に警告バッジ
- [ ] 寸法入力でサイズクラスと概算レンジが表示される(price_size_classes 変更に追随)
- [ ] pending/ 孤児が翌日 cron で消える。添付なし送信は従来どおり成功(後方互換)
- [ ] rate limit 超過で 429 相当の応答(既存 E105 慣行)

**テスト方針**: zInquiryAttachmentInput unit(境界値)/facade.submit の添付検証分岐(service client モック)/upload-url route の rate limit・mime 検証 unit。Storage 実挙動は本番適用後 execute_sql + 手動送信で確認(結合運用方針どおり)。

---

### 2.4 #103 顧客宛自動返信 + #2 条件分岐 — 高・S+中・M(inquiry 拡張 + settings)

**目的**: フォーム=受注の玄関口。「受け付けました+目安納期」1 通で離脱率が変わる(v2 レポート #103 行)。現状は管理者宛のみ(notify.ts:112-148)。#2 は「種別ごとに返信内容と誘導先を変える」ことの最小実装として同一基盤で実現する。

**スコープ**: inquiry_type 別の自動返信テンプレート(settings キー)+ 送信処理 + admin 設定 UI + プレースホルダ差し込み。#2 = 種別別テンプレート出し分け + 種別別の定型誘導ブロック(estimate→シミュレーター URL、material→対応材料ページ URL、P16' 添付あり→受領枚数明記)。
**非スコープ**: 汎用ワークフロービルダー(#11、レポートで XL・低優先)/営業時間外の出し分け/多段ステップメール(MA は #4 で将来)。

**DDL**: なし(site_settings 新キー。§4.2 の「新規キーは seed もバックフィルもしない — admin 初回保存で行作成、行なし時は degrade」規約に従う。module-contracts.md:348 の確立パターン)。

**契約**(settings/contracts.ts に追加、SETTINGS_SCHEMAS へ `auto_reply` キー登録):

```ts
export const zAutoReplyTemplate = z.object({
  subject: zShortText(120),
  body: z.string().max(5000),       // プレースホルダ: {{name}} のみ (過剰変数は設けない)
}).strict();
export const zAutoReplySettings = z.object({
  enabled: z.boolean(),                              // 全体スイッチ (既定 false — 行なし degrade と同義)
  default: zAutoReplyTemplate,
  by_type: z.record(
    z.enum(["construction","estimate","material","other"]),
    zAutoReplyTemplate.nullable(),                   // null = default を使う
  ),
}).strict();
```

**処理**(inquiry/internal/auto-reply.ts 新設): `submit` 成功後、`notifyInquiryReceived` と並んで `void sendAutoReply(input, inquiryId)` をベストエフォート実行(失敗 = KMB-E902 ログのみ — 管理者通知と同格の設計。facade.ts:46-48 の慣行)。
- from = `mailFromAddress()`(#33)。**replyTo = notifications.inquiry_to**(顧客が返信すると工房に届く)。
- テンプレ解決: `by_type[inquiry_type] ?? default`。enabled=false または settings 行なしなら送らない(degrade)。settings(auto_reply/company/notifications)の読み出しは **SettingsFacade.get 経由を正**とする(既存 notify.ts:62-66 の service 直クエリは許容逸脱だが、新キー auto_reply では踏襲しない — settings 所有の規約 module-contracts §2 line80)。
- 本文組み立て: テンプレ本文 + 種別別定型ブロック(estimate: シミュレーター URL / material: /materials URL — コード内定数で開始し、必要になったら settings 化)+ 添付受領行(P16' 実装後: 「お写真 N 枚を受け取りました」)+ 署名(settings 'company' から社名・住所を差し込み)。
- オプトアウト対象外(トランザクションメール — §1.4)。ただし連続投稿への多重返信を防ぐため、同一 email への自動返信は 1 時間 1 通に抑制(rate_limits を route キー `'auto-reply'` で流用 — 新テーブル不要。**注意: rate_limits の PK は ip_hash 起点のため、ip_hash 列に `sha256(salt + lower(email))` を入れる(値は email 正規化ハッシュ — 実装コメントで明示)。閾値 1 回/時は §2.3 で追加する maxPerHour 引数に 1 を渡す**)。

**UI**: `/admin/settings` の通知まわり(settings-forms.tsx)に「自動返信」セクション追加: 全体スイッチ / 既定テンプレ / 種別別上書き(4 種、null=既定を使う)/「テスト送信」ボタン(inquiry_to 宛て)。

**受入基準**:
- [ ] enabled=true でフォーム送信者に自動返信が届く(件名・本文に {{name}} 展開)
- [ ] 種別 estimate はシミュレーター誘導、material は対応材料誘導が本文に入る(#2)
- [ ] 種別別上書きが null の種別は default が使われる
- [ ] enabled=false / settings 行なし / RESEND 未設定では送信スキップ(submit は成功のまま・E902 ログ)
- [ ] 同一アドレス連投で 2 通目以降が抑制される
- [ ] 自動返信の失敗が submit 結果に影響しない(既存 inquiry-notify テストの型で検証)

**テスト方針**: tests/inquiry-notify.test.ts と同型の unit(テンプレ解決・degrade 分岐・抑制)。settings スキーマの Zod unit。実送信は手動受入。

---

### 2.5 #54 Slack 通知連携 — 中・S(settings 拡張 + inquiry)

**目的**: 塗装ブース作業中(手が塗料まみれ)でも新規問い合わせを即知る。メール通知より通知音・スマホ通知の即時性が高い。

**スコープ**: Slack Incoming Webhook への通知(問い合わせ受信時 — contact/シミュレーター両経路とも facade.submit 内のため 1 箇所で両取り)+ 設定 UI + テスト送信。
**非スコープ**: Teams(Incoming Webhook 廃止過渡期。Workflows URL でも同 POST 形が使える旨を注記するのみ)/Slack 側からの操作(双方向)/他イベント(入金・発送等 — 各トラックが後日この notify を呼ぶ)。

**DDL**: なし。**契約**: `zNotificationSettings`(settings/contracts.ts:77-79)に `slack_webhook_url: z.string().url().max(300).nullable().optional()` を追加(**optional 必須** — 既存行 `{inquiry_to}` の parse を壊さない。0013/0015 の「既存キー行への項目追加」前例に従いバックフィル不要のまま)。

**処理**(inquiry/internal/slack-notify.ts 新設): `notifyInquiryReceived` と並ぶ第 3 のベストエフォート呼び出し。`fetch(webhook_url, {method:'POST', body: JSON.stringify({text})})`、timeout 3s(AbortController)。text = 「新しい問い合わせ: 種別/名前/抜粋 + 管理画面 URL」。失敗は KMB-E902 ログのみ。

**UI**: settings-forms.tsx の通知フォームに URL 入力 + 「テスト送信」ボタン(server action)。

**受入基準**:
- [ ] URL 設定済みでフォーム送信 → Slack にメッセージ(種別・名前・管理画面リンク)
- [ ] URL 未設定/不通でも submit 成功・メール通知は独立して届く
- [ ] テスト送信ボタンで疎通確認できる(失敗時は notice-panel でエラー表示)
- [ ] 既存 notifications 行(slack_webhook_url なし)が parse エラーにならない

**テスト方針**: fetch モックで payload/timeout/失敗 degrade の unit。zNotificationSettings 後方互換 parse の unit。

---

### 2.6 #32 メール購読/オプトアウト管理 — 高・M(outreach 新設・前半)

**目的**: 一斉配信(#3)の法的前提(特定電子メール法: オプトアウト導線・送信者表示の義務)。#3 より**先に**基盤として入れる。

**スコープ**: オプトアウト台帳 + HMAC トークン式の公開解除導線(ワンクリック対応)+ admin での配信可否表示/手動切替。オプトアウトの単位は **メールアドレス**(customers.email は非 unique・家族共用があるため customer_id 単位では漏れる — 0.5 の実測根拠)。
**非スコープ**: 複数購読タイプ(ニュースレター/新色案内の区分 — 1人工房では 'marketing' 1 種で開始、列は将来拡張可能な形にする)/ダブルオプトイン(既存顧客への案内が主用途)。

**DDL**(`202607XX0000NN_outreach_core.sql` の一部):

```sql
create table email_optouts (
  email_lc text primary key,          -- lower(trim(email))
  scope text not null default 'marketing' check (scope in ('marketing')),  -- 将来拡張用
  source text not null check (source in ('link','one_click','admin','bounce','complaint')),
  -- 'bounce'/'complaint' は将来の Resend webhook 接続 (別 Issue) 用の予約値。
  -- 本トラックに populate 経路は無く、当面稼働するのは admin / link / one_click のみ
  reason text,
  created_at timestamptz not null default now()
);
-- RLS: admin SELECT/DELETE、INSERT は admin + service (公開解除は service 経由)
```

**契約**(outreach/contracts.ts 新設):

```ts
export const zOptOutInput = z.object({
  email: z.string().email().max(120),
  source: z.enum(["link","one_click","admin","bounce","complaint"]),
  reason: zShortText(200).nullable(),
}).strict();
// トークン: base64url(email_lc) + "." + HMAC-SHA256(email_lc, UNSUBSCRIBE_TOKEN_SECRET) 先頭 16byte hex
//   — DB 不要の決定的トークン。env は lib/env.ts に任意追加、未設定時は解除導線を出さない (E866。Resend 未設定の E863 とはコード分離)
```

facade(OutreachFacade 一部): `isOptedOut(email): Result<boolean>` / `setOptOut(input): Result<void>` / `removeOptOut(email): Result<void>`(admin 訂正用)/ `buildUnsubscribeUrl(email): string | null` / `verifyUnsubscribeToken(email, token): boolean`(純関数)。トークン不正 = **KMB-E864**。

**公開導線**:
- `GET /unsubscribe?e=<b64>&t=<hmac>`(site-public ページ): トークン検証 → 確認ボタン 1 つのページ → POST(server action, service client)で email_optouts INSERT(冪等 upsert)。完了文言のみ。
- `POST /api/outreach/unsubscribe`(RFC 8058 One-Click 用): List-Unsubscribe-Post 対応。ボディ不問、トークン検証のみで即解除。
- 配信メール(#3)には `List-Unsubscribe: <mailto:…>, <https://…>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` ヘッダと本文末尾の解除リンクを**必ず**入れる(#3 側の受入基準に連動)。

**UI**: `/admin/customers/[id]`(既存詳細)に「案内メール: 配信中/停止中」バッジ + 切替(source='admin')。一覧への列追加はしない(1人運用で不要)。

**受入基準**:
- [ ] 解除リンク → 確認 → 解除、が 2 タップで完了し、以後 #3 の送信対象から外れる
- [ ] One-Click POST(メーラーの購読解除ボタン)で即解除される
- [ ] トークン改竄は E864 で拒否(メールアドレスの当て推量で他人を解除できない)
- [ ] admin から停止/再開でき、activities には記録しない(crm 契約を触らない — 将来 #145 監査ログで)
- [ ] UNSUBSCRIBE_TOKEN_SECRET 未設定環境では #3 の送信自体をブロック(**E866** — 解除導線なし配信を構造的に不可能にする)

**テスト方針**: トークン生成/検証の純関数 unit(改竄・別 email・大文字小文字)/optout upsert 冪等 unit。公開ページは route 単位の smoke。

---

### 2.7 #3 メール一斉配信 + #5 テンプレート — 高・M + 中・S(outreach 後半)

**目的**: リピート顧客(造形作家・BtoB)への新グレード/新色/受付再開の案内。メール中心ビジネスの主要打ち手(v2 レポート #3 行)。X がフロー、メールがストックの再訪導線。

**スコープ**: テンプレート CRUD(#5)+ キャンペーン(下書き→予約→送信→完了)+ 受信者スナップショット + 毎分ワーカー送信 + テスト送信 + 結果表示。宛先選定 = lifecycle フィルタ(customer/lead)+ 手動除外(1人工房のリード量なら十分。タグ・セグメントは非スコープ)。**既定 audience は 'customer' のみとし、'lead' は UI で明示チェックを要するオプトイン**(特定電子メール法: フォーム提供者は「通知した者」枠で defensible だが、既定に含めない方が安全)。
**非スコープ**: 開封/クリック計測(#6/#23 系 — Resend の open tracking は将来スイッチ)/A/B(#7)/HTML リッチエディタ(プレーンテキスト + 自動段落 HTML。sales/internal/email.ts:47-53 の textToHtml と同型)/MA ワークフロー(#4)。

**DDL**(`202607XX0000NN_outreach_core.sql` 続き):

```sql
create table email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_text text not null,            -- {{name}} と {{unsubscribe_url}} (後者は送信時必須自動挿入)
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table email_campaigns (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references email_templates(id) on delete set null,
  subject text not null,              -- テンプレからのスナップショット (後からのテンプレ編集に影響されない)
  body_text text not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','canceled','failed')),
  scheduled_at timestamptz,
  started_at timestamptz, finished_at timestamptz,
  audience jsonb not null default '{}'::jsonb,   -- {lifecycles:['customer'], exclude_customer_ids:[...]}
  sent_count int not null default 0, failed_count int not null default 0, skipped_count int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  email text not null,
  name text not null,                            -- 差し込み用スナップショット
  status text not null default 'pending'
    check (status in ('pending','sent','failed','skipped_optout','skipped_invalid')),
  provider_message_id text, error_detail text, sent_at timestamptz,
  unique (campaign_id, email)                    -- 家族共用メールの重複送信を構造的に防止
);
create index on email_campaign_recipients (campaign_id, status);
-- RLS: 全テーブル admin CRUD + service (worker)。anon 不可
```

**契約**(outreach/contracts.ts 続き・facade シグネチャ):

```ts
export const zTemplateInput = z.object({ name: zShortText(60), subject: zShortText(120),
  body_text: z.string().max(10_000) }).strict();
export const zAudience = z.object({
  lifecycles: z.array(z.enum(["lead","customer"])).min(1),
  exclude_customer_ids: z.array(z.string().uuid()).max(200).default([]),
}).strict();

export interface OutreachFacade {
  // #5 テンプレート
  listTemplates(includeArchived: boolean): Promise<Result<TemplateRow[]>>;
  createTemplate(input: TemplateInput): Promise<Result<{ id: string }>>;
  updateTemplate(id: string, input: TemplateInput, updatedAt: string): Promise<Result<void>>; // E103
  archiveTemplate(id: string, updatedAt: string): Promise<Result<void>>;
  // #3 キャンペーン
  createCampaign(input: { template_id: string | null; subject: string; body_text: string;
    audience: Audience }): Promise<Result<{ id: string }>>;
  previewAudience(audience: Audience): Promise<Result<{ count: number; sample: {name: string; email: string}[] }>>;
    // count は customers 行数。実送信は email unique で dedup されるため家族共用メールがあると
    // 実送信数 < count になる — UI 表示は「最大 N 件」の含意にする
    // customers から email 非 null・非 archived・merged_into 無し・optout 除外で解決 (CrmFacade 越しでなく
    // outreach repository の read は不可 — customers は crm 所有。CrmFacade に listMailableCustomers(filter) を
    // 1 メソッド追加する (crm 契約改訂・E601-619 帯内でエラー追加不要)。依存方向 outreach→crm は sales→crm と同型
  sendTest(campaignId: string, to: string): Promise<Result<void>>;                    // E863/E860
  scheduleCampaign(id: string, scheduledAt: string, updatedAt: string): Promise<Result<void>>;
    // draft→scheduled のみ可 (それ以外 E861)。この時点で recipients へスナップショット展開 + E862 (0 件) ガード
  cancelCampaign(id: string, updatedAt: string): Promise<Result<void>>;               // scheduled→canceled のみ
  getCampaign(id): ...; listCampaigns(pagination): ...; listRecipients(campaignId, pagination): ...;
  runSendBatch(): Promise<Result<{ processed: number }>>;                             // service 専用 (worker)
}
```

**ワーカー**(distribution の毎分パターン移植 — publish/route.ts:13-36 と 0024 の cron 登録が雛形):
- pg_cron 毎分 → `POST /api/jobs/outreach`(x-jobs-secret)→ 202 + `after()` → `runSendBatch()`。
- バッチ: `scheduled_at <= now()` の scheduled を sending へ CAS → recipients の pending を **50 件/回** claim(`update ... where id in (select ... for update skip locked)` RPC — telephony job RPC 0033 の先例)。各件: optout 再チェック(スナップショット後の解除を尊重)→ {{name}}/{{unsubscribe_url}} 展開 → Resend 送信(List-Unsubscribe ヘッダ付き)→ 行更新。pending 0 で sent 確定 + 集計列更新。
- レート: 50 件/分は**スループット絞り(API バースト回避)であり、日次上限の担保ではない**。Resend 無料枠は 100 通/日のため、対象 100 件超のキャンペーンは有料プラン(3,000 通/月〜)が前提条件 — 予約時に previewAudience 件数が 100 件超なら「Resend プランをご確認ください」警告を表示する(日次会計の自前実装はしない。超過時は Resend 側 429 を E865 として failed 行に記録し翌日以降の手動再送に委ねる)。1 バッチ失敗はリトライ 1 回まで、以後 failed 行として残す(E865 ログ)。

**UI**: `/admin/outreach`(新規、nav「お客さんを作る」グループ(create-customers)に「お知らせ配信」で追加 — `src/app/admin/nav-items.ts:46-59`。`_ui/` 配下ではない点に注意)。
- 一覧: キャンペーン(status-badge: 下書き/予約済み/送信中/送信完了/中止/失敗)+ テンプレタブ(underline-tabs)。
- 作成: テンプレ選択 or 直書き → 宛先条件 → `previewAudience`(件数 + サンプル 5 件)→ テスト送信 → 予約(日時 or 今すぐ=now)。data-table・page-header 等 admin/_ui の既存小物で構成。
- 詳細: 受信者テーブル(status 別フィルタ)+ 再送はしない(failed は手動フォロー — 1人工房の規模)。

**受入基準**:
- [ ] テンプレ作成→キャンペーン作成→プレビュー件数→テスト送信→予約→毎分ワーカーで全件送信→sent 確定、が一巡する
- [ ] optout 済みアドレスは skipped_optout になり送信されない(スナップショット後の解除も反映)
- [ ] 同一メールアドレスの家族共用顧客 2 人に対し送信は 1 通(unique 制約)
- [ ] 全配信メールに解除リンク + List-Unsubscribe/One-Click ヘッダ + 会社名・住所(settings 'company')が入る
- [ ] {{unsubscribe_url}} を含まない本文は送信時に自動で末尾挿入される(欠落配信が構造的に不可能)
- [ ] scheduled→canceled 可・sending 以降は不可(E861)。対象 0 件は予約不可(E862)
- [ ] RESEND_API_KEY 未設定では予約不可(E863)。UNSUBSCRIBE_TOKEN_SECRET 未設定でも予約不可(E866)
- [ ] ワーカー多重起動でも二重送信しない(skip locked + status CAS)

**テスト方針**: 状態遷移(E861 全パターン)・宛先解決(archived/merged/email null 除外・optout)・差し込み展開の unit。claim RPC は SQL レビュー + 本番適用後 execute_sql で挙動確認(既存運用)。送信は Resend モック。

---

## 3. Issue 分割案(1 Issue = 1 PR)

| # | タイトル案 | 含む項目 | 依存 | 規模 |
|---|---|---|---|---|
| I-1 | 送信ドメイン認証と差出人一元化(SPF/DKIM/DMARC + MAIL_FROM_ADDRESS) | #33 | なし(最優先・他の全メール Issue の土台) | **S** |
| I-2 | 問い合わせ自動返信・種別分岐・Slack 通知(settings 拡張含む) | #103 + #2 + #54 | なし(I-1 が先だと到達性が担保されるが並行可) | **M** |
| I-3 | 材質×塗料適合マスタ(pricing: materials + material_paint_rules + 価格表タブ) | P18' | なし | **M** |
| I-4 | 写真添付つき依頼フォーム(inquiry-uploads バケット + inquiry_attachments + 公開 upload-url + admin 表示 + 掃除 cron) | P16' | I-3(材質セレクト)。I-2 実装済みなら自動返信に添付枚数を反映(soft) | **L** |
| I-5 | outreach モジュール新設 + 購読解除基盤(E860-879 帯登録 + email_optouts + /unsubscribe + One-Click) | #32 | I-1 | **M** |
| I-6 | メール一斉配信 + テンプレート(campaigns/templates/recipients + 毎分ワーカー + /admin/outreach + CrmFacade.listMailableCustomers) | #3 + #5 | I-5 | **L** |
| — | (除外)BCC/転送メール自動ロギング | #53 | **#100 Phase 2 に完全内包**(08-email.md §0.4 OQ-2 確定)。本トラックでは実装しない | — |

- 並列可能: I-1 / I-2 / I-3 は同時着手可。I-4 は I-3 後、I-5 は I-1 後、I-6 は I-5 後。クリティカルパスは I-1→I-5→I-6。
- 各 Issue は着手時に契約改訂(所有表・エラーコード帯・zInquiryInput 公開契約)を **07-contracts-delta.md 集約(裁定 J10)経由**で PR 先頭コミットに含める(module-contracts.md を直接編集しない — 00-overview:946)。E860 帯は 00-overview §3.3 帯予約表へ、outreach→crm 辺は module-contracts §2 依存グラフへ、それぞれ delta で反映する(§1.2 参照)。
- 07-contracts-delta.md 対象: I-4(zInquiryInput 拡張)・I-5(E860 帯新設 + outreach 所有表)・I-6(CrmFacade 1 メソッド追加 + outreach→crm 辺)。

## 4. 受入の全体確認(トラック横断)

- [ ] E840-859 を一切使用していない(grep で 0 件)
- [ ] emails / email_attachments テーブル・mail モジュール名を作成していない(#100 予約の尊重)
- [ ] 顧客宛メール(自動返信・一斉配信)の差出人が全て mailFromAddress() 経由で統一されている
- [ ] マーケメールのみオプトアウト対象で、トランザクションメール(自動返信・帳票)は対象外(§1.4 の分類どおり)
