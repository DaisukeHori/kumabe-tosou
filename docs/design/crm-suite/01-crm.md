# 隈部塗装 CRM スイート — crm モジュール設計書 (01-crm)

- 版: v1.2 (2026-07-11: **07-contracts-delta v1.2〜v1.7 追随** — relinkActivity の実装意味論 (§6.7 新設)・getCustomerRef/getDealRef/getDealRefs の契約メソッド表追記・§1.2 の ai-providers 将来枠記述の stale 是正。変更点は末尾更新履歴)。旧: v1.1 (2026-07-11: レビュー反映版 — 00-overview v1.0 / 07-contracts-delta v1.1 準拠)
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **crm モジュール (customers / companies / deals / activities / activity_links / tasks) の DDL・画面・状態機械・facade 実装意味論の正**。上位 canonical は [00-overview.md](./00-overview.md) (M0 共通基盤・エラーコード採番・認可総表・モジュール割当) と [07-contracts-delta.md](./07-contracts-delta.md) (値契約 Zod・facade シグネチャ・結合シーケンス = module-contracts.md v2.8 差分)。本書は両書と矛盾しない範囲で詳細化する (逸脱時は上位が正)。
- 姉妹文書 (canonical 分担):
  - 00-overview §3.2.3 — activities タイムライン・ハブ統合契約 (本書は実装意味論のみ詳細化、契約の再定義なし)
  - 00-overview §3.3 — エラーコード採番 canonical (KMB-E601〜E619 = crm 帯)
  - 07-contracts-delta §D7 (§4.10) — crm の値契約 Zod canonical (`ACTIVITY_PAYLOAD_SCHEMAS` / `DEAL_STAGE_REGISTRY` / `zCustomerInput` ほか — **本書で再定義しない**)
  - 07-contracts-delta §D8 — `CrmFacade` 契約シグネチャ canonical
  - 02-sales.md / 03-scheduling.md / 04-telephony.md — appendActivity の各発生源 (書き手側) の親設計
- 入力資料: 設計ブリーフ (R1)・設計裁定書 J1/J2/J7/J9/J10/J11・調査 (ext-hubspot-invoice / db-schema / repo-map / admin-ui-auth / design-conventions)
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提: migration 0021 (is_admin_or_service) / 0022 (採番) 適用済み (M0 = Phase 1 完了)。crm の migration 帯は **0023〜0025** (00-overview §10)

---

## 0. 業務シナリオとスコープ

塗装職人 (熊部さん) から見た「顧客・案件・やること」の日常を 4 部で描く。IT 用語は使わない。

### 0.1 相談が一列に並ぶ — 「朝、管理画面を開くと名簿ができている」

夜のうちにホームページから相談が 2 件、料金シミュレーターから 1 件届いていた。朝、熊部さんが管理画面の「顧客」を開くと、3 人の名前と連絡先がすでに名簿に載っている。誰が・どこから・何の相談で来たのかが 1 行ずつ整理され、「案件」の板には「相談」の列に 3 枚の札が並んでいる。シミュレーター経由の 1 件には、選んだグレード・サイズ・個数と概算金額まで添えられている。以前も頼んでくれた田中さんからの再依頼は、新しい名簿が増えるのではなく、**田中さんの既存のページに新しい相談として積まれる**。同姓同名や家族で同じメールを使っている場合は勝手に統合せず、別の名簿として登録した上で「似た人がいます」の目印が付くので、間違って混ざる心配はない (目印を見て、同一人物だと確認できたときだけ自分の手で統合する — §6.3)。

### 0.2 相手の顔がすぐ分かる — 「1 人のページに全部の歴史」

日中、田中さんから電話がかかってくる。田中さんのページを開くと、最初の問い合わせ・過去の見積書・作業にかかった時間・前回の電話の録音と要約・自分で書いたメモが、**上から新しい順に 1 本の帯**になって並んでいる。「前回はパール仕上げで 3 週間でしたね」と即答できる。電話を切ったら、話した内容をメモとして 1 行書き足すだけ。フォームの送信や書類の発行は勝手に帯へ載るので、自分で書くのは本当にメモだけでいい。

### 0.3 案件は板の上を進む — 「今月いくらになりそうかが見える」

「案件」を開くと、横に「相談 → 見積作成 → 見積送付 → 受注 → 製作中 → 納品済み → 請求済み → 入金済み」の列が並んだ板がある。札 (案件) を右の列へ動かすだけで進捗が変わる。見積書を正式に送ると札はひとりでに「見積送付」へ動く提案が出る。断られた案件は理由を一言添えて「失注」に落とす — 理由が貯まると「何で負けたか」があとから見える。板の上には**列ごとの金額の合計と、成約見込みを掛けた「見込み合計」**が出ているので、新しい相談を受けるかどうかの判断が数字でできる (これは板の上の全案件の加重合計であり、「今月入る金額」ではない — §8.6)。

### 0.4 やることは向こうから来る — 「朝 7 時のダイジェスト」

留守番電話に「寸法を測ってほしい」と入っていた。昼に画面を見ると、「やること」に「田中さんに折り返して寸法を確認する」が**自動で追加されている** (電話の内容から機械が書き起こした下書き)。フォームから相談が来たときも「折り返し連絡」が自動で載る。毎朝 7 時には「期限を過ぎたやること・今日のやること・返事待ちの相談」がメールで 1 通届くので、管理画面を開き忘れても取りこぼさない。終わったものはチェックひとつで消える。熊部さんが自分で「やること」を思い出して書く場面は、ほとんどない。

### 0.5 スコープ (in) — HubSpot の本質の縮約対応表

ext-hubspot A-12「1 人塗装工房が本当に使う範囲」への縮約を、HubSpot の概念 ↔ 本設計の対応で確定する:

| HubSpot の概念 | 本設計での縮約 | 根拠 |
|---|---|---|
| Contacts (email dedup) | `customers` (email/tel_e164 の repository dedup + E601/force。DB unique にしない) | A-3。メールなし高齢施主・家族共用メールの実在 (00-overview §7-1,5) |
| Companies (domain dedup / primary company) | `companies` + `customers.company_id` (nullable FK、primary 1 社のみ)。domain dedup 不採用 | A-4。法人少数 |
| Deals + Pipeline + Stage (probability / isClosed) | `deals` (v1 単一パイプライン 'default')。probability/is_won/is_lost は **コード registry** (`DEAL_STAGE_REGISTRY`)、DB check はステージ key のみ | A-5。HubSpot MCP で isClosed が DB メタとして扱いにくかった実測知見とも整合 |
| Engagements タイムライン (ポリモーフィック) | `activities` + `activity_links` (1 行 1 対象の実 FK)。**全モジュール共通ハブ** (00-overview §3.2.3) | A-6。配列 FK 禁止規約 |
| Tasks (期日 / 自動生成) | `tasks` (期日・origin=manual/ai_call/form/system)。担当者・キュー・リマインダー種別は持たない (1 人固定) | A-7 |
| フォーム → contact UPSERT → deal/task 自動化 + 流入元 | `intakeFromInquiry` / `intakeFromSimulator` (§6.5)。流入元 = `source` 列 (form/simulator/phone/manual/migration) | A-8 |
| レポート 4 枚 | ダッシュボード KPI 4 カード (§8.6): 未対応リード / 加重パイプライン / 期日超過やること / 今週のやること | A-10 |
| Line Items / Quotes / Invoices | **sales 所有** (02-sales.md)。crm は deal ↔ documents の FK 受け側のみ | A-11 |
| 捨てるもの | Tickets / Leads オブジェクト / association labels / task queue / スコアリング / custom objects / チーム権限 | A-12「捨ててよいもの」 |

### 0.6 スコープ外

| 項目 | 理由・扱い |
|---|---|
| メール連携 (activity_type 'email') | 裁定 J7。DB check と Zod enum には 'email' を含める (Phase 2 で migration 不要) が、v1 は `appendActivity` が挿入拒否 (KMB-E604) |
| 複数パイプライン | v1 は `pipeline='default'` 固定 (check 制約)。通販/施工の分離が必要になったら check 拡張 + registry 拡張 (§15.2) |
| 発信通話 (クリックトゥコール) の起票 | telephony Phase 2。`zCallActivityPayload.direction='outbound'` は契約予約済み |
| 担当者 (owner) 概念・staff 権限 | 裁定 J1。§3.6 に拡張差分のみ |
| 顧客ポータル (顧客自身のログイン) | 対象外。認可モデルに顧客ロールを作らない |
| プッシュ/LINE 通知 | 通知は日次ダイジェストメール (Resend ベストエフォート) のみ |
| activity の版管理・編集履歴 | note 以外は不変、note も履歴なし (§10 の理由参照) |

### 0.7 印刷出力

**該当なし**。理由: 帳票 (見積書・受注書・納品書・請求書) の印刷出力は sales モジュール所有であり 02-sales.md §印刷出力が正 (00-overview §0.6)。crm 所有の画面 (顧客一覧・カンバン・タイムライン・やること) は 1 人運用の画面確認で業務が完結し、法令上の保存・交付義務 (電帳法/インボイス) の対象データを含まないため、紙出力要件を持たない。deal 詳細から帳票 PDF を開く導線は §8.3 に定義するが、PDF 生成自体は `SalesFacade.createSignedPdfUrl` の消費であり本書のスコープ外。

---

## 1. モジュール定義と全体像

### 1.1 責務とディレクトリ

**crm** — 顧客 (個人/法人担当者)・会社・案件 (パイプライン/ステージ)・活動タイムライン (全モジュール共通ハブ)・タスク・リード取込 (フォーム/シミュレーター/通話) を所有する。他モジュールがタイムラインへ書く唯一の経路は `CrmFacade.appendActivity` であり、activities / activity_links への直接クエリは crm repository のみ (ESLint + レビューで強制、00-overview §2.2)。

```
src/modules/crm/
  contracts.ts          … 契約書 v2.8 §4.10 の写経 (canonical) + 契約外拡張スキーマ (§5.2)
  facade.ts             … CrmFacade (契約 §D8) + 契約外拡張 (「契約外拡張」コメント必須)
  repository.ts         … 6 テーブルへの唯一の DB アクセス層
  internal/
    dedup.ts            … 重複候補検索の純関数 + 検索クエリ (§6.3)
    intake.ts           … リード取込の冪等シーケンス (§6.5)
    stage-machine.ts    … canTransitionDealStage / won_at・lifecycle 昇格判定 (純関数、§4.2)
    task-machine.ts     … タスク遷移ガード (純関数、§4.3)
    activity.ts         … payload 二段階 parse / 冪等 INSERT / タイトル自動生成
    timeline-cursor.ts  … (occurred_at, id) keyset カーソルの encode/decode (純関数)
    digest.ts           … ダイジェスト集計 (JST 境界判定は純関数分離)
    notify.ts           … Resend ダイジェストメール (inquiry/internal/notify.ts と同型、E902)
    jst.ts              … Asia/Tokyo 日付境界ヘルパ (純関数)
```

### 1.2 依存方向 (00-overview §2.2 の crm 分)

- crm → platform (Result / requireAdmin / 共通スカラー / ExecutionContext) / **settings (`SettingsFacade.get` の read のみ — ダイジェスト宛先 'notifications'。07-delta v1.1 D2 で明記済み)**。**ai-providers への依存はなし** (v1.2 是正 — 07-delta §D2 v1.2 で crm→ai-providers の辺自体が削除済み。旧「契約書 §2 に将来枠として記載済み」は stale: 将来枠の記載は存在しない。AI 補助を実装する時点で 07 改訂として辺を追加する)。ESLint の MODULES 依存許可も crm → settings read を含めて設定する
- sales / scheduling / telephony → crm (`appendActivity` / `matchCustomerByPhone` / `createTask` / `updateDealStage` / 顧客・案件参照)
- pricing → crm の依存は**作らない** (シミュレーター取込は /api/shop/lead route の app 層合成 — 00-overview §4.2)
- inquiry → crm の依存も**作らない**。contact フォームの取込は `src/components/contact/actions.ts` (app 層 Server Action) が `InquiryFacade.submit` 成功後に `CrmFacade.intakeFromInquiry` を呼ぶ合成 (§7.3)
- ESLint: `MODULES` 配列への `"crm"` 追加は M0 (#1-1) で実施済み前提

### 1.3 既存 contact_inquiries との統合裁定 — 「併存」で確定

| 判断点 | 裁定 | 根拠 |
|---|---|---|
| テーブル所有 | **inquiry 所有のまま移管しない** | 00-overview §3.2.1 (上位確定)。所有境界を動かすと inquiry の rate limit / 通知 / admin 画面 (稼働中) を全部巻き込む |
| 問い合わせ→リードの関係 | contact_inquiries は「受信箱 (原本)」、crm は「名簿と案件 (業務台帳)」の**併存 2 層**。取込は inquiry_id を activity payload (`zFormSubmissionActivityPayload.inquiry_id`) と `deals.source_inquiry_id` (参照 FK) に記録して逆引き可能にする | 原本を書き換えない = 既存データを壊さない移行の大前提 |
| /admin/inquiries 画面 | 現行のまま維持 + 「リード化」ボタンを追加 (§8.7)。inquiry status の意味論 (new/in_progress/done/spam) は変更しない | 既存 UX 無変更 |
| 既存データの取込 | **任意・推奨のスクリプト移行** (migration ではない)。1 トランザクション + seed_manifest + 逆順ロールバック (§12) | 00-overview §14.1 |
| 新規問い合わせ | 送信時に自動取込 (app 層合成、§7.3)。**取込失敗は問い合わせ保存を巻き戻さない** | 00-overview §4.2 [異常] |

### 1.4 ナビゲーション追加 (crm 分)

nav 6 項目は **M0 (#1-2) で一括追加済み前提** (00-overview §2.4/§3.6-8 — リンク先未実装でも置く既存運用)。本フェーズでの nav 追加作業はなく、以下は crm 分 3 項目の確認用 (「ダッシュボード」直後):

```ts
{ href: "/admin/customers", label: "顧客" },
{ href: "/admin/deals",     label: "案件" },
{ href: "/admin/tasks",     label: "やること" },
```

middleware matcher は `/admin/:path*` のまま変更不要。

---

## 2. データモデル (canonical DDL)

### 2.1 ER 概観

```
companies ◄─────── customers (company_id nullable, merged_into_customer_id 自己参照)
                     ▲    ▲
                     │    └────────────── deals (customer_id not null / company_id nullable /
                     │                           source_inquiry_id → contact_inquiries [参照 FK])
                     │                      ▲
 activities ── activity_links ──────────────┘   … customer | company | deal のどれか厳密に 1 つ (1 行 1 対象)
     ▲   (一意: 冪等キー (activity_type, ref_table, ref_id) — NULLS DISTINCT で ref なし行は衝突しない)
     │
   tasks (deal_id / customer_id / source_activity_id いずれも nullable)
```

設計原則 (00-overview §3.2 の再掲 + 本書追加分):

- 配列 FK 禁止。ポリモーフィック参照は `activity_links` の 3 本 nullable FK + `num_nonnulls = 1` check
- 顧客 dedup は DB unique にしない (repository 判定 E601 + force、§6.3)
- **`deals.source_inquiry_id` (本書追加)**: 取込の冪等キー兼「リード化済み」判定用の跨モジュール参照 FK。跨モジュール FK は `posts.source_run_id` / `documents.deal_id` と同じ確立前例 (00-overview §3.2.2)。コードアクセスは crm repository のみ (inquiry のデータは読まない — FK 整合のためだけに張る)
- **`customers.merged_into_customer_id` (本書追加)**: マージで負けた顧客の転送ポインタ (§6.4)。他モジュールが保持する旧 customer_id (calls.customer_id 等) を UPDATE せず read 時に解決するための装置 (テーブル所有境界を跨ぐ UPDATE をしない)
- 文字数上限・形式 (email / E.164) は Zod が唯一の正。DDL check は enum/status/構造的整合のみ (`contracts-ddl-parity.test.ts` 対象は §11.2 に列挙)

### 2.2 migration 0023 — crm コア DDL 全文

ファイル名: `supabase/migrations/20260711000023_crm_core.sql` (適用は Supabase MCP / SQL Editor 手動 — HANDOFF §3 運用)。

**冪等 index の設計原則 (v1.1 是正 — repository 実装規約)**: 冪等 INSERT に使う一意 index (activities_ref_idem_uniq / deals_source_inquiry_uniq / tasks_source_activity_title_key / activity_links_*_uniq) は**部分一意 (WHERE 句付き) にしない**。理由: 本書の repository 層は supabase-js (PostgREST) であり (§1.1)、PostgREST の `on_conflict` パラメータは列名しか渡せず index_predicate (WHERE 句) を表現できない。PostgreSQL の ON CONFLICT 推論は部分一意 index に対して述語の明示が必須のため、部分一意のままでは全 INSERT が 42P10 (no unique or exclusion constraint matching...) で失敗する (プランニングエラーであり重複時に限らない)。非部分の一意 index でも **NULLS DISTINCT (PG 既定) により NULL キー行は互いに衝突しない**ため、旧部分述語 (`where ref_id is not null` 等) と意味論は同一。repository の冪等 INSERT は `upsert(..., { onConflict: "<列リスト>", ignoreDuplicates: true })` (page-media repository の確立パターン) を正とし、DO NOTHING は行を返さないため**競合時は続けて既存行 SELECT** で id を回収する (INSERT + 23505 捕捉でも可 — どちらかに統一)。

```sql
-- =========================================================
-- 20260711000023_crm_core.sql
-- canonical: docs/design/crm-suite/01-crm.md §2.2 (裁定 J1/J9/J10)
-- 本 migration が追加するもの:
--   1. crm 所有 6 テーブル (companies, customers, deals, activities, activity_links, tasks)
--   2. RLS (admin 3 分類 + activities の note 限定 UPDATE/DELETE) + 明示 revoke/grant
--   3. 冪等キー一意 index (activities ほか — 非部分。§冪等 index 設計原則参照) / マージ用 RPC crm_merge_customers
--   4. deals 終端ステージ不変の BEFORE UPDATE トリガ (アプリ層 stage-machine との二重防御)
-- 本 migration が行わないこと: pg_cron 登録 (0024)・既存テーブルの変更 (なし)
-- 前提: 0021 (is_admin_or_service) 適用済み
-- =========================================================

-- ---------------------------------------------------------
-- companies (会社: 工務店/元請/管理会社など少数の法人)
-- ---------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_kana text,
  tel_e164 text,          -- E.164。形式検証は Zod (zTelE164) が正
  address text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table companies is '会社 (crm 所有)。個人施主は行を持たない。domain dedup は不採用 (法人少数)';

create trigger handle_updated_at before update on companies
  for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------
-- customers (顧客: 個人施主 / 法人担当者)
-- ---------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'person' check (kind in ('person', 'company_contact')),
  name text not null,
  name_kana text,
  email text,             -- nullable (メールなし高齢施主)。unique にしない (家族共用メール) — dedup は repository (KMB-E601)
  tel_e164 text,          -- E.164 保存。入力正規化は normalizeJpPhoneToE164() (platform)
  company_id uuid references companies(id) on delete set null,
  address text,
  notes text,
  lifecycle text not null default 'lead' check (lifecycle in ('lead', 'customer', 'archived')),
  source text not null check (source in ('form', 'simulator', 'phone', 'manual', 'migration')),
  merged_into_customer_id uuid references customers(id) on delete set null,
  created_by uuid references profiles(id),   -- null = service 文脈 (取込/telephony) 起点
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_no_self_merge check (merged_into_customer_id is null or merged_into_customer_id <> id),
  constraint customers_merged_is_archived check (merged_into_customer_id is null or lifecycle = 'archived')
);
comment on column customers.merged_into_customer_id is
  'マージで統合された先 (§6.4)。非 NULL 行は名簿・dedup 候補から除外し、参照解決時に終端まで辿る';

create trigger handle_updated_at before update on customers
  for each row execute function extensions.moddatetime(updated_at);

create index customers_email_idx on customers (lower(email)) where email is not null;
create index customers_tel_idx on customers (tel_e164) where tel_e164 is not null;
create index customers_company_idx on customers (company_id) where company_id is not null;
create index customers_list_idx on customers (created_at desc, id desc);   -- keyset

-- ---------------------------------------------------------
-- deals (案件)
-- ---------------------------------------------------------
create table deals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  customer_id uuid not null references customers(id),
  company_id uuid references companies(id) on delete set null,
  pipeline text not null default 'default' check (pipeline in ('default')),
  stage text not null default 'inquiry' check (stage in (
    'inquiry', 'estimating', 'quote_sent', 'ordered',
    'in_production', 'delivered', 'invoiced', 'paid', 'lost'
  )),
  amount_jpy bigint check (amount_jpy is null or amount_jpy >= 0),  -- 円整数 (µUSD 混在禁止)。上限は Zod
  expected_close_on date,
  won_at timestamptz,     -- ordered 初到達時に 1 回だけ記録、以後不変 (§4.2 不変条件)
  lost_reason text,
  source text not null check (source in ('form', 'simulator', 'phone', 'manual', 'migration')),
  source_inquiry_id uuid references contact_inquiries(id) on delete set null,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deals_lost_requires_reason check (stage <> 'lost' or lost_reason is not null)
);
comment on column deals.source_inquiry_id is
  '取込元の問い合わせ (参照 FK のみ — inquiry 所有は不変)。取込の冪等キー + /admin/inquiries の「リード化済み」判定';
comment on column deals.stage is
  'probability / is_won / is_lost は DB に持たない — crm/contracts.ts の DEAL_STAGE_REGISTRY が正 (契約書 v2.8 §4.10)';

create trigger handle_updated_at before update on deals
  for each row execute function extensions.moddatetime(updated_at);

create index deals_customer_idx on deals (customer_id);
create index deals_stage_idx on deals (stage, created_at desc);
create index deals_company_idx on deals (company_id) where company_id is not null;
-- 非部分一意 (NULLS DISTINCT — source_inquiry_id NULL の手動案件は衝突しない)。
-- 部分一意にしない理由は §2.2 冒頭「冪等 index の設計原則」
create unique index deals_source_inquiry_uniq on deals (source_inquiry_id);

-- 終端ステージ不変 (§4.2「paid / lost からの遷移は一切不可」) の DB レベル二重ガード。
-- アプリ層 canTransitionDealStage が第一防御だが、直接 SQL / Studio 手動操作 / 将来バッチが
-- repository を迂回する経路を DB でも封じる (deals_lost_requires_reason 等の CHECK と同じ防御水準)
create or replace function public.deals_guard_terminal_stage()
returns trigger
language plpgsql
as $$
begin
  if old.stage in ('paid', 'lost') and new.stage is distinct from old.stage then
    raise exception 'KMB-E602: 終端ステージ (入金済み/失注) からは変更できません';
  end if;
  return new;
end;
$$;

create trigger deals_terminal_stage_guard before update of stage on deals
  for each row execute function public.deals_guard_terminal_stage();

-- ---------------------------------------------------------
-- activities (活動タイムライン — 全モジュール共通ハブ。00-overview §3.2.3 が統合契約)
-- ---------------------------------------------------------
create table activities (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null check (activity_type in (
    'note', 'call', 'email', 'form_submission', 'simulator_estimate',
    'document_event', 'work_log', 'task_event', 'system'
  )),  -- 'email' は Phase 2 予約 (J7)。check には含め (Phase 2 で migration 不要)、v1 挿入は facade が拒否 (KMB-E604)
  occurred_at timestamptz not null,   -- 業務時刻 (通話開始/発行日時)。表示は occurred_at 降順 keyset
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,  -- 契約: ACTIVITY_PAYLOAD_SCHEMAS[activity_type] (契約書 v2.8 §4.10)
  ref_table text,
  ref_id uuid,
  created_by uuid references profiles(id),     -- null = service 文脈 (telephony worker 等)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_ref_pair check ((ref_table is null) = (ref_id is null))
);
comment on table activities is
  'タイムライン・ハブ。他モジュールの書き込みは CrmFacade.appendActivity のみ (直接 INSERT 禁止 — ESLint/レビュー強制)。編集/削除は note のみ';

create trigger handle_updated_at before update on activities
  for each row execute function extensions.moddatetime(updated_at);

-- 冪等キー (00-overview §3.2.3-2): 同一 ref の再送 (webhook リトライ/worker 再実行) は既存行を返す。
-- 非部分一意 (NULLS DISTINCT により ref_id NULL の note 等は衝突しない — §2.2 冒頭「冪等 index の設計原則」)
create unique index activities_ref_idem_uniq
  on activities (activity_type, ref_table, ref_id);
create index activities_timeline_idx on activities (occurred_at desc, id desc);

-- ---------------------------------------------------------
-- activity_links (activity ↔ {customer|company|deal} の 1 行 1 対象リンク)
-- ---------------------------------------------------------
create table activity_links (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint activity_links_one_target check (num_nonnulls(customer_id, company_id, deal_id) = 1)
);
comment on table activity_links is
  '1 つの activity を顧客と案件の両方に載せる場合は 2 行 (00-overview §3.2.2)。updated_at なし (不変行)';

-- 重複リンク防止 + タイムライン逆引きの両用 (対象列を先頭に置く)。
-- 非部分一意 (NULLS DISTINCT — 対象列 NULL の行は衝突しない。§2.2 冒頭「冪等 index の設計原則」)
create unique index activity_links_customer_uniq
  on activity_links (customer_id, activity_id);
create unique index activity_links_company_uniq
  on activity_links (company_id, activity_id);
create unique index activity_links_deal_uniq
  on activity_links (deal_id, activity_id);
create index activity_links_activity_idx on activity_links (activity_id);

-- ---------------------------------------------------------
-- tasks (やること)
-- ---------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  due_on date,            -- JST 日付 (zDateOnly)。時刻は持たない (1 人運用に時刻粒度は過剰)
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  origin text not null check (origin in ('manual', 'ai_call', 'form', 'system')),
  deal_id uuid references deals(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  source_activity_id uuid references activities(id) on delete set null,  -- AI 起票/フォーム起票の出所
  completed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_done_has_completed_at check (status <> 'done' or completed_at is not null)
);

create trigger handle_updated_at before update on tasks
  for each row execute function extensions.moddatetime(updated_at);

create index tasks_status_due_idx on tasks (status, due_on);
create index tasks_deal_idx on tasks (deal_id) where deal_id is not null;
create index tasks_customer_idx on tasks (customer_id) where customer_id is not null;
-- createTask の冪等キー (07-contracts-delta v1.1 裁定 #10): AI 起票/フォーム起票のリトライ
-- (lease 失効跨ぎクラッシュ含む) による二重起票を DB レベルで根絶。createTask は
-- source_activity_id 非 NULL 時 upsert(ignoreDuplicates) → 競合時は既存行 SELECT で task_id を返す。
-- 非部分一意 (NULLS DISTINCT — 手動タスク (source_activity_id NULL) は同題でも衝突しない。
-- §2.2 冒頭「冪等 index の設計原則」)。source_activity_id 検索の index も本 unique index が兼ねる (prefix 走査)
create unique index tasks_source_activity_title_key on tasks (source_activity_id, title);

-- =========================================================
-- RLS (00-overview §5.2 の crm 行を全文化)
-- 規約: enable RLS + {table}_{role}_{action} 命名 + 明示 revoke/grant
-- (RLS 有効化だけでは default privileges の grant が残る — 0020 の教訓)
-- service_role は RLS bypass (revoke の影響も受けない)
-- =========================================================

-- companies: admin SELECT/INSERT/UPDATE (DELETE なし)
alter table companies enable row level security;
revoke all on companies from anon;
revoke delete on companies from authenticated;
grant select, insert, update on companies to authenticated;
create policy companies_admin_select on companies for select using (public.is_admin());
create policy companies_admin_insert on companies for insert with check (public.is_admin());
create policy companies_admin_update on companies for update
  using (public.is_admin()) with check (public.is_admin());

-- customers: admin SELECT/INSERT/UPDATE (DELETE なし — archived で論理)
alter table customers enable row level security;
revoke all on customers from anon;
revoke delete on customers from authenticated;
grant select, insert, update on customers to authenticated;
create policy customers_admin_select on customers for select using (public.is_admin());
create policy customers_admin_insert on customers for insert with check (public.is_admin());
create policy customers_admin_update on customers for update
  using (public.is_admin()) with check (public.is_admin());

-- deals: admin SELECT/INSERT/UPDATE (DELETE なし)。ステージ遷移は repository 二重検証 (§4.2)
alter table deals enable row level security;
revoke all on deals from anon;
revoke delete on deals from authenticated;
grant select, insert, update on deals to authenticated;
create policy deals_admin_select on deals for select using (public.is_admin());
create policy deals_admin_insert on deals for insert with check (public.is_admin());
create policy deals_admin_update on deals for update
  using (public.is_admin()) with check (public.is_admin());

-- activities: admin SELECT/INSERT + UPDATE/DELETE は type='note' のみ
-- (channel_posts_admin_cancel_update と同型の状態限定ポリシー — 00-overview §3.2.3-5)
alter table activities enable row level security;
revoke all on activities from anon;
grant select, insert, update, delete on activities to authenticated;
create policy activities_admin_select on activities for select using (public.is_admin());
create policy activities_admin_insert on activities for insert with check (public.is_admin());
create policy activities_admin_update on activities for update
  using (public.is_admin() and activity_type = 'note')
  with check (public.is_admin() and activity_type = 'note');
create policy activities_admin_delete on activities for delete
  using (public.is_admin() and activity_type = 'note');

-- activity_links: admin SELECT/INSERT + DELETE は note のリンク付け替えのみ (UPDATE なし)
alter table activity_links enable row level security;
revoke all on activity_links from anon;
revoke update on activity_links from authenticated;
grant select, insert, delete on activity_links to authenticated;
create policy activity_links_admin_select on activity_links for select using (public.is_admin());
create policy activity_links_admin_insert on activity_links for insert with check (public.is_admin());
create policy activity_links_admin_delete on activity_links for delete
  using (
    public.is_admin()
    and exists (
      select 1 from activities a
      where a.id = activity_links.activity_id and a.activity_type = 'note'
    )
  );

-- tasks: admin 全権 (service は AI 起票 — bypass)
alter table tasks enable row level security;
revoke all on tasks from anon;
grant select, insert, update, delete on tasks to authenticated;
create policy tasks_admin_select on tasks for select using (public.is_admin());
create policy tasks_admin_insert on tasks for insert with check (public.is_admin());
create policy tasks_admin_update on tasks for update
  using (public.is_admin()) with check (public.is_admin());
create policy tasks_admin_delete on tasks for delete using (public.is_admin());

-- =========================================================
-- crm_merge_customers: 顧客マージ (§6.4)。
-- Supabase JS はマルチステートメント TX を張れないため、多テーブル原子更新は
-- RPC で行う (replace_work_image の前例)。activity_links に admin UPDATE
-- ポリシーが無い (不変行) ため security definer + is_admin() ガード型を採用。
-- 楽観排他は timestamptz 引数の等値比較 (PostgREST の ISO 文字列は µs 無損失で
-- timestamptz に parse される。text キャスト比較は表記揺れで誤爆するため不採用)。
-- =========================================================
create or replace function public.crm_merge_customers(
  p_winner_id uuid,
  p_loser_id uuid,
  p_expected_winner_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner customers%rowtype;
  v_loser customers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission denied: crm_merge_customers requires admin';
  end if;
  -- CAS 引数の NULL ガード (v1.1): plpgsql の IF は NULL を false 扱いするため、NULL のまま
  -- 進むと下の updated_at 等値比較が無音でバイパスされる。取り消し不可操作の防御を先に確定する
  if p_winner_id is null or p_loser_id is null or p_expected_winner_updated_at is null then
    raise exception 'KMB-E101: マージの引数が不足しています (winner/loser/expected_updated_at は必須)';
  end if;
  if p_winner_id = p_loser_id then
    raise exception 'KMB-E608: 同一の顧客同士はマージできません';
  end if;

  -- FOR UPDATE 行ロックで直列化 (advisory lock 禁止 — pgbouncer)。id 順に取得しデッドロック回避
  if p_winner_id < p_loser_id then
    select * into v_winner from customers where id = p_winner_id for update;
    select * into v_loser  from customers where id = p_loser_id  for update;
  else
    select * into v_loser  from customers where id = p_loser_id  for update;
    select * into v_winner from customers where id = p_winner_id for update;
  end if;

  if v_winner.id is null or v_loser.id is null then
    raise exception 'KMB-E603: マージ対象の顧客が見つかりません';
  end if;
  if v_winner.merged_into_customer_id is not null or v_loser.merged_into_customer_id is not null then
    raise exception 'KMB-E608: マージ済みの顧客を再度マージすることはできません';
  end if;
  if v_winner.updated_at <> p_expected_winner_updated_at then
    raise exception 'KMB-E103: 顧客情報が他の操作で更新されています。再読み込みしてやり直してください';
  end if;

  -- crm 所有テーブルの参照付け替え (他モジュール所有 (calls 等) は触らない — read 時に merged_into で解決)
  update deals set customer_id = p_winner_id where customer_id = p_loser_id;
  update tasks set customer_id = p_winner_id where customer_id = p_loser_id;

  -- activity_links: 勝者側に同一 activity のリンクが既にある行は残すと一意違反になるため付け替えず削除
  update activity_links al
    set customer_id = p_winner_id
    where al.customer_id = p_loser_id
      and not exists (
        select 1 from activity_links w
        where w.activity_id = al.activity_id and w.customer_id = p_winner_id
      );
  delete from activity_links where customer_id = p_loser_id;

  -- 勝者の空欄のみ敗者から補完 (非 NULL 項目は勝者優先)
  update customers set
    email      = coalesce(email, v_loser.email),
    tel_e164   = coalesce(tel_e164, v_loser.tel_e164),
    name_kana  = coalesce(name_kana, v_loser.name_kana),
    address    = coalesce(address, v_loser.address),
    company_id = coalesce(company_id, v_loser.company_id)
  where id = p_winner_id;

  -- 勝者 lifecycle の再評価 (v1.1 — §4.1 意味論との整合): 敗者が customer、または付け替えで
  -- won 実績 (won_at 非 NULL — registry を SQL に複製しない DB 内マーカー) の deal が勝者配下に
  -- 来た場合、lead の勝者を customer へ昇格する (customer/archived の勝者は据え置き)
  update customers set lifecycle = 'customer'
  where id = p_winner_id
    and lifecycle = 'lead'
    and (v_loser.lifecycle = 'customer'
         or exists (select 1 from deals d where d.customer_id = p_winner_id and d.won_at is not null));

  -- 敗者は archived + 転送ポインタ (check 制約 customers_merged_is_archived と整合)
  update customers set lifecycle = 'archived', merged_into_customer_id = p_winner_id
  where id = p_loser_id;
end;
$$;

revoke all on function public.crm_merge_customers(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.crm_merge_customers(uuid, uuid, timestamptz) to authenticated;
```

### 2.3 migration 0024 — crm-digest worker の pg_cron 登録 全文

ファイル名: `supabase/migrations/20260711000024_crm_digest_cron.sql`。0011 の確立パターンを完全踏襲 (Vault 未設定なら raise notice で安全スキップ)。

```sql
-- =========================================================
-- 20260711000024_crm_digest_cron.sql
-- canonical: docs/design/crm-suite/01-crm.md §7.2 (00-overview §3.1.3 の kmb-crm-digest-worker 行)
-- 本 migration が追加するもの: trigger_crm_digest_worker() + pg_cron 登録 (日次 JST 07:00)
-- 前提: 0011 で pg_cron / pg_net 有効化済み。Vault の cron_site_url / cron_jobs_secret は
--       既存運用のものを共用 (新規 Vault キーなし)
-- =========================================================

create or replace function public.trigger_crm_digest_worker()
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
    raise notice 'cron_site_url / cron_jobs_secret が Vault 未設定のため /api/jobs/crm-digest 起床をスキップします';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/jobs/crm-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.trigger_crm_digest_worker() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kmb-crm-digest-worker';
select cron.schedule('kmb-crm-digest-worker', '0 22 * * *', $$select public.trigger_crm_digest_worker();$$);
-- 0 22 UTC = JST 07:00 (00-overview §3.1.3 の表と 1:1)
```

### 2.4 migration 割当と返上

| 番号 | 内容 | 状態 |
|---|---|---|
| 0023 | crm コア DDL + RLS + crm_merge_customers | §2.2 |
| 0024 | crm-digest の pg_cron 登録 | §2.3 |
| 0025 | — | **返上** (未使用。帯は固定のため他モジュールは詰めない — 00-overview §10 割当規則) |

既存 contact_inquiries の取込は **migration ではなくスクリプト** (`scripts/crm-intake-inquiries.ts`、§12.1) — DDL 変更を伴わず、実行任意・冪等・ロールバック可能であるため (seed-from-legacy.ts と同じ運用区分)。

### 2.5 データ規約 (crm 全カラム共通)

- テキストは Zod の `nfc` transform (NFC 正規化 + 制御文字除去) を通してから保存 (platform 共通)
- 電話番号は保存前に `normalizeJpPhoneToE164()` (platform/text.ts、M0) で E.164 化。生の国内表記 (090-…) を DB に入れない
- email は保存時に `trim().toLowerCase()` (dedup の比較キーと表示を一致させる。lower index と対)
- 金額 (deals.amount_jpy) は **円整数** (bigint)。AI コスト µUSD と混在禁止
- 日付 (due_on / expected_close_on) は date 型 + JST 解釈 (zDateOnly)。時刻 (occurred_at / won_at / completed_at) は timestamptz (UTC 保存、Asia/Tokyo 表示)
- 一覧の keyset: 名簿・案件・タスク = (created_at, id)、タイムライン = **(occurred_at, id)** (§5.2 の crm 専用カーソル)
- 楽観排他: updated_at の**生文字列** hidden 往復 → 不一致 KMB-E103 (既存規約)。RPC 境界のみ timestamptz 引数比較 (§2.2 の crm_merge_customers コメント参照)

### 2.6 JSONB カラム ↔ 型契約対応表

| カラム | canonical スキーマ | 参照 |
|---|---|---|
| activities.payload | `ACTIVITY_PAYLOAD_SCHEMAS[activity_type]` (discriminated map、全 payload `.strict()`) | 契約書 v2.8 §4.10 = 07-contracts-delta §D7。読み書き両方で二段階 parse (KMB-E604) |

crm の他テーブルに JSONB カラムはない (構造化できる属性はすべて列で持つ)。

### 2.7 全データパターン列挙

設計・テスト・UI で必ずカバーする現実パターン (00-overview §7 の crm 該当分 + 本書追加分):

| # | パターン | 設計上の受け止め |
|---|---|---|
| P1 | メールなし・電話のみの高齢施主 | customers.email NULL / tel_e164 が dedup 第 2 キー。名簿検索は電話番号でもヒット |
| P2 | 法人 (工務店/元請) の担当者 | kind='company_contact' + company_id。deal.company_id にも複製して帳票宛名の素材にする |
| P3 | 個人施主 (会社なし) | company_id NULL が主系。会社欄は UI で畳む |
| P4 | 同一人物の再問い合わせ | email/tel 一致 → 既存顧客に取込、**deal だけ新規作成** (§6.5)。顧客は増えない |
| P5 | 家族共用メール (同 email 別人) | dedup は候補提示 (E601) + force 作成。DB unique にしない根拠。intake (人間不在) は複数一致時に既存へ自動採用せず新規 lead + 後確認マーカー (§6.3 — v1.1 是正) |
| P6 | 番号非通知・公衆電話からの着信 | matchCustomerByPhone は入力 NULL を受けない (telephony 側で skip)。calls.from_e164 NULL は crm に到達しない |
| P7 | 同一電話番号が複数顧客に一致 (事務所代表番号) | matchCustomerByPhone が KMB-E601 + 候補 detail (telephony が E823 に変換して手動確認へ — §6.1) |
| P8 | 連絡先ゼロの手動顧客 (現金取引の常連) | zCustomerInput refine: source='manual' のみ email/tel 両 NULL 許可。それ以外は KMB-E607 |
| P9 | 見積のみで終わる案件 (失注) | markDealLost (理由必須、check 制約 deals_lost_requires_reason)。lost は終端 |
| P10 | 電話一本で即受注 (見積を飛ばす) | ステージ前方ジャンプ許可 (inquiry → ordered 直行、§4.2) |
| P11 | ステージの誤操作訂正 (戻す) | 非終端間の後退遷移許可。won_at は不変のまま (§4.2 不変条件) |
| P12 | XL (個別見積り) のシミュレーター送信 | quote_only=true → amount_jpy NULL の deal (金額なしでも板に載る)。payload にスナップショット保持 |
| P13 | webhook / worker の再送・二重実行 | appendActivity 冪等キー (activity_type, ref_table, ref_id) → created:false。intake は §6.5 の冪等シーケンス |
| P14 | マージ後に旧顧客の電話番号から着信 | 敗者の tel を勝者が補完済み or 転送ポインタ解決 (§6.3-4) で勝者にヒット |
| P15 | 同一 activity を顧客と案件の両方に表示 | activity_links 2 行 (リンク規約 §6.6.4) |
| P16 | タスクの期日なし (「いつか」) | due_on NULL 許容。やること画面では「期日なし」グループに表示、ダイジェスト対象外 |
| P17 | 取込直後に admin が同じ人を手動作成しようとする | createCustomer が E601 候補提示 → 既存を開く導線 (§8.2) |

---

## 3. 認可マトリクスと RLS

### 3.1 ロール定義

00-overview §5.1 に従う (anon / admin / service / 将来 staff)。crm 固有の追加ロールなし。

### 3.2 テーブル認可 (4 列)

RLS ポリシー全文は §2.2 が正。本表は総覧:

| テーブル | anon | admin | service | 将来 staff (方針) |
|---|---|---|---|---|
| companies | ✗ | SELECT / INSERT / UPDATE (DELETE なし) | ○ (bypass) | R/W |
| customers | ✗ | SELECT / INSERT / UPDATE (DELETE なし — archived で論理削除) | ○ (取込/電話リード作成) | R/W |
| deals | ✗ | SELECT / INSERT / UPDATE (DELETE なし)。ステージ遷移は repository 二重検証 | ○ (取込) | R/W |
| activities | ✗ | SELECT / INSERT + **UPDATE/DELETE は activity_type='note' のみ** | ○ (facade 経由の appendActivity) | R + note W |
| activity_links | ✗ | SELECT / INSERT + **DELETE は note のリンクのみ** (UPDATE なし — 不変行。直接操作の制約であり、非 note の張り替えは facade 経由の relinkActivity = service 実行 + 監査 — §6.7 v1.2) | ○ (relinkActivity の全置換含む) | R |
| tasks | ✗ | SELECT / INSERT / UPDATE / DELETE | ○ (AI 起票 origin='ai_call') | R/W |

### 3.3 RPC 認可

| RPC | ガード | 呼び出し元 |
|---|---|---|
| crm_merge_customers(uuid, uuid, timestamptz) | security definer + 冒頭 `is_admin()` + revoke from public, anon + grant to authenticated | crm repository (admin セッション) のみ |
| trigger_crm_digest_worker() | security definer + revoke from public, anon, authenticated (= service/cron 専用) | pg_cron のみ |

### 3.4 API エンドポイント / Server Action 認可

| エンドポイント / Action | Method | 認可 | 主エラー |
|---|---|---|---|
| /api/jobs/crm-digest | POST | x-jobs-secret (JOBS_SECRET。未設定 503 / 不一致 401)。202 + after() | E201 相当 401 / E901 |
| /admin/customers・deals・tasks 配下の全 Server Action | — | 先頭 `platformFacade.requireAdmin()` + Zod parse (works/actions.ts の歴史的例外は踏襲しない) | E201 / E202 / E101 |
| intakeInquiryAction (/admin/inquiries「リード化」) | — | requireAdmin + Zod | E201 / E607 / E603 |
| contact フォーム送信 (既存 Server Action への追記) | — | 既存の honeypot / 送信最小時間 / rate limit のまま (認可追加なし)。取込は submit 成功後のベストエフォート | E607 (ログのみ) |

facade の intake 系 2 メソッドは **anon 起点 (公開フォーム / /api/shop/lead) から呼ばれるため requireAdmin を課さず、内部で常に service client を使用**する (§6.1 の実行文脈表)。入口の防御は route/Action 側の rate limit + Zod + honeypot が担う (contact 実装済み / shop lead は 06-simulator 設計)。

### 3.5 Storage / Vault

**該当なし**。crm は Storage バケット・Vault シークレットを所有しない (通話音声は telephony、帳票 PDF は sales、ダイジェストの宛先は settings 'notifications' 既存キーを読むだけ)。

### 3.6 staff 拡張時の差分 (裁定 J1 の共通骨子への追記)

00-overview §5.5 の手順に加え、crm 固有の差分: ① tasks に `assignee uuid references profiles(id)` 列追加 (v1 は列自体を作らない — 単一運用者に担当概念は無意味) ② activities.created_by が staff の場合の note 編集権 (自分の note のみ UPDATE に絞るポリシー追加) ③ ダイジェストメールの宛先を profile 別に分岐。いずれも既存ポリシーの**追加**で実現でき、置換は不要。

---

## 4. ライフサイクルと状態意味論

### 4.1 customers.lifecycle

```
lead ──────→ customer ──────→ archived
  │              ▲                │
  └──────────────┼────────────────┘  (全遷移許可 — 手動変更は自由)
                 └── 自動昇格: 案件が won 系ステージに初到達した時 (§4.2)
```

| 状態 | 意味論 | 名簿既定表示 | dedup 候補 |
|---|---|---|---|
| lead | 見込み客 (取込直後・取引実績なし) | ○ | ○ |
| customer | 取引実績あり (won 案件を 1 件以上持つ、または手動昇格) | ○ | ○ |
| archived | 論理削除 (取引終了/重複統合の敗者)。一覧の既定フィルタから除外 | フィルタで表示可 | ○ (検索対象に含める。**merged_into 非 NULL の行は一致しても敗者行自身を候補提示せず、終端解決した勝者を返す** — §6.3) |

不変条件:

1. lifecycle は業務ワークフローではなく**名簿の分類**である。3 値間の手動遷移はすべて許可 (遷移ガードなし、エラーコード不要)
2. 自動昇格は lead → customer の一方向のみ (won 到達時)。customer → lead への自動降格はしない
3. `merged_into_customer_id` 非 NULL ⇒ lifecycle='archived' (DB check)。マージの取り消し機能は持たない (再作成で対応 — §6.4)
4. 物理 DELETE は存在しない (RLS/grant とも不許可)

### 4.2 deals.stage (canonical — 00-overview §6.1 の詳細化)

```
inquiry → estimating → quote_sent → ordered → in_production → delivered → invoiced → paid (終端)
   │           │            │          │            │             │           │
   └───────────┴────────────┴──────────┴────────────┴─────────────┴───────────┴──→ lost (終端。理由必須)

前方ジャンプ: 任意の前方ステージへ直行可 (例: inquiry → ordered — P10)
後退:        非終端ステージ間は自由 (誤操作訂正 — P11)
終端:        paid / lost からは updateDealStage / markDealLost では一切遷移不可 (KMB-E602)。
             復帰は reopenDeal 専用経路のみ (v1.2 — §4.2-8 参照。KMB-E609、admin専権・理由必須・
             system activity監査)
```

| ステージ | 意味論 | probability | won/lost | 主な到達経路 |
|---|---|---|---|---|
| inquiry | 相談が届いた (取込直後) | 10 | — | intake (form/simulator/手動) |
| estimating | 見積作成中 | 30 | — | 手動 |
| quote_sent | 見積送付済み | 60 | — | app 層提案 (quote issued イベント) |
| ordered | 受注 (won 確定) | 100 | won | app 層提案 (order issued) / 手動 |
| in_production | 製作中 | 100 | won | 手動 / ブロック配置 (Phase 5 提案) |
| delivered | 納品済み | 100 | won | app 層提案 (delivery issued) |
| invoiced | 請求済み | 100 | won | app 層提案 (invoice issued) |
| paid | 入金済み (終端) | 100 | won | app 層提案 (invoice_paid) |
| lost | 失注 (終端) | 0 | lost | markDealLost のみ (理由必須) |

probability / isWon / isLost / label の値は `DEAL_STAGE_REGISTRY` (契約書 v2.8 §4.10) が唯一の正。DB には持たない。

**遷移ガード (crm/internal/stage-machine.ts の純関数 — 単体テスト必須)**:

```
canTransitionDealStage(from, to):   ← ガード節は上から順に評価 (先に一致した節が勝つ)
  from === to                          → { kind: 'noop' }        (冪等 — ok を返し UPDATE しない。
                                                                  (paid,paid) / (lost,lost) も noop — 終端判定より優先)
  from ∈ {paid, lost}                  → { kind: 'invalid' }     (KMB-E602: 終端。(paid,lost)/(lost,paid) もここ)
  to === 'lost'                        → { kind: 'needs_reason' } (updateDealStage では KMB-E602。markDealLost 専用経路)
  それ以外                              → { kind: 'ok' }
```

9×9 マトリクスの期待値 (§11.2 テストの正): from===to の 9 セル = noop (終端同士含む) / from∈{paid,lost} かつ from≠to の 16 セル = invalid / from∉{paid,lost} かつ to='lost' の 7 セル = needs_reason / 残り 49 セル = ok。

不変条件:

1. **won_at は won 系ステージ (isWon=true) への初到達時に 1 回だけ記録し、以後どの遷移でも変更しない** (後退しても消さない)。判定は registry の isWon で行う (ordered 直行でなく inquiry→in_production 等の変則ジャンプでも成立)
2. **isWon 系ステージへの遷移成功時は常に**、deal の customer.lifecycle が 'lead' なら 'customer' へ自動昇格 (repository が同一操作内で実施)。「初到達時のみ」の一度きり判定にしない理由 (v1.1): deals UPDATE と customers UPDATE は 2 文の逐次実行で TX を張れず (supabase-js)、間で失敗すると won_at 記録済みのため一度きり判定では昇格が再試行されない。冪等条件 (won 系遷移のたびに lead なら昇格) にすることで後続遷移が自然に補修する。それでも残る欠落 (以後遷移が発生しないケース) は許容 — lifecycle は名簿分類であり手動遷移自由 (§4.1) で回復できる
3. lost_reason は stage='lost' の間必ず非 NULL (DB check)。lost 以外へは書かない (markDealLost 専用)
4. amount_jpy の「受注時に見積 total で確定上書き」(00-overview §6.1) は **app 層の責務**: `SalesFacade.issueDocument` の戻り値 event.total_jpy を使い、Server Action が `updateDeal` (契約外) → `updateDealStage` の順に呼ぶ (§7.3)
5. ステージ変更はタイムラインに activity を残さない (§10 の理由と同根: 1 人運用に stage 監査履歴は過剰。帳票イベント activity が実質の節目記録になる)。**例外 (v1.2 — #102)**: reopenDeal (終端からの再開) だけは system activity (code='deal.reopened') を必ず積む。再開は稀かつ「KPI・失注分析の信頼」への影響が大きい高リスク操作であるため、通常のステージ変更とは扱いを分ける意図的な裁定
6. 帳票と案件のステージ乖離は許容 (00-overview §6.2)。提案遷移を admin が拒否してもエラーにしない
7. **終端不変は DB でも二重に守る (v1.1)**: BEFORE UPDATE トリガ `deals_terminal_stage_guard` (§2.2) が paid/lost からのステージ変更を KMB-E602 で拒否する。deals_lost_requires_reason 等の CHECK と同じ防御水準に揃え、repository を迂回する経路 (直接 SQL / Studio 手動操作 / 将来バッチ) からも状態機械を保護する。**reopenDeal (v1.2) の RPC だけが transaction-local GUC (`kmb.crm_reopen_unlock`) でこのトリガを一時的に通過できる** (migration 20260714000036 — documents_freeze_after_issue の `kmb.sales_revision_unlock` (02-sales §2.3 DDL 全文) と同型のパターン。直接 SQL / Studio 手動操作は引き続き KMB-E602 で拒否され、二重防御は維持)

### 4.2-8 reopenDeal (終端ステージの案件再開 — v1.2, Issue #102)

**背景**: v1.1 は「lost からの復帰遷移は設けない (新規案件を作り直す)」と裁定していたが、実運用で (a) 入金済み確定ダイアログの誤操作からの永久ロック (b) sales 側 §4.3-C の請求取消正規経路 (入金記録全削除→issued自動復帰→voidDocument→再発行) があるのに deal.stage=paid だけが手詰まり (c) lost 誤操作時のタイムライン・帳票参照の分断、の 3 点が「使いづらすぎる」との実運用フィードバックで顕在化し、本裁定を **上書き** する。電帳法上の不変要件 (issued_documents append-only・documents 発行後凍結・payments 不変) は sales 側 3 層で完結しており deal.stage はパイプライン管理ラベルにすぎない (00-overview §6.2 の乖離許容裁定と整合) ため、deal.stage の再開は会計・電帳法整合性を壊さない。

**設計方針**: updateDealStage / markDealLost / canTransitionDealStage の許可遷移集合・9×9 マトリクス・kanban / DealStageBar のガードは**一切変更しない** (誤操作防止は維持)。再開だけを明示的な専用経路 `reopenDeal` に隔離し、DB トリガ側も RPC 限定の transaction-local GUC バイパスで守る (§4.2 不変条件7)。

**ガード関数 (`internal/stage-machine.ts` の純関数 — 単体テスト必須、canTransitionDealStage とは独立)**:

```
canReopenDeal(from, to):
  from ∈ {paid, lost} かつ to ∈ 非終端7値   → { kind: 'ok' }
  それ以外 (終端→終端の (paid,paid)/(lost,lost)/(paid,lost)/(lost,paid) を含む) → { kind: 'invalid' } (KMB-E609)
```

9×9 マトリクスの期待値: from∈{paid,lost} かつ to∈非終端7値 の 14 セル = ok / 残り 67 セル = invalid。

**facade.reopenDeal(dealId, input: ReopenDealInput, expectedUpdatedAt) → Result<{ updated_at: string }>** (契約外拡張 — §6.2):

1. `zReopenDealInput` parse (E101)
2. `getDealById` → 不在 E603
3. `canReopenDeal(deal.stage, input.to_stage)` — invalid は KMB-E609
4. `crm_reopen_deal` RPC 呼び出し (§2.2 の RPC 定義。CAS 不一致は E103、DB 側の再検証で invalid は E609 — アプリ層とのガード二重化)
5. RPC 成功後、監査 activity を追記: `appendActivity` 相当の直接呼び出し (`crm_merge_customers` 成功後の 'customer.merged' 追記 — facade.ts mergeCustomers と同前例) — `{ activity_type: 'system', payload: { code: 'deal.reopened', detail: '<遷移元label>→<遷移先label>: <理由>' }, ref_table: null, ref_id: null }` + `links=[{deal_id}]`。ref_table/ref_id を null にするのは、非 null にすると (activity_type, ref_table, ref_id) の冪等キーにより同一 deal の 2 回目以降の再開が「既存行を返す (dedup)」扱いになってしまうため — 再開ごとに新しい activity 行を必ず積む。追記失敗は console.warn のみで主操作 (再開) は成功のまま返す (updateDealStage の lifecycle 昇格失敗時と同じ「握り潰さず明示ログ」パターン)
6. won_at は RPC 側で SET しない (不変条件1維持)。lost_reason は RPC が null クリア (理由は監査 activity に退避 — deals 行から「一度 lost だった履歴」は直接辿れなくなるが、必要なら activities(code='deal.reopened') から集計可能、という許容)

**UI (§8.3 参照)**: 案件詳細ヘッダに「案件を再開…」ボタン (paid/lost のときのみ表示) → `ReopenDealDialog` (戻し先ステージ select + 理由 textarea 必須)。paid からの入金記録有無チェックは行わない (00-overview §6.2 の乖離許容裁定と整合。請求書自体の取消は 02-sales §4.3-C の既存経路)。

**旧 v1.1 運用ガイド (superseded)**: 「lost からの復帰遷移は設けない。誤操作した場合は同じ顧客で新規案件を作成し、旧案件の notes に経緯を残す」は本節 (v1.2 reopenDeal) により **上書き・非推奨**。旧ガイドはタイムライン・帳票参照が旧 deal に分断され実用に耐えないという実運用フィードバックで撤回された。

### 4.3 tasks.status

```
open ──→ done          (completeTask。completed_at 記録)
  │        │
  │        └──→ open   (reopenTask。completed_at クリア — 誤操作訂正)
  └────→ cancelled     (cancelTask。終端 — KMB-E606)
```

| 状態 | 意味論 | ダイジェスト/バッジ対象 |
|---|---|---|
| open | 未完了。due_on < JST 今日 なら「期日超過」 | ○ |
| done | 完了 (completed_at 保持)。reopen 可 | ✗ |
| cancelled | 取り消し (終端)。reopen 不可 | ✗ |

不変条件: status='done' ⇔ completed_at 非 NULL (DB check + repository)。done→done / open→open は冪等 no-op (ok)。cancelled からの一切の遷移は KMB-E606。

**task_event activity の冪等規約 (本書の設計裁定 — 冪等 index との整合)**: `task_event` は created / completed / cancelled の 3 イベントを持つが、冪等キーは (activity_type, ref_table, ref_id) の 3 つ組であるため、同一 task_id を ref にすると 2 個目以降のイベントが冪等キー衝突で挿入できない。よって:

- `task_event(created)` … ref=(tasks, task_id) で**冪等キーあり** (service 文脈の AI 起票・フォーム起票のリトライで二重作成を防ぐ本命ケース)
- `task_event(completed / cancelled)` … **ref_table/ref_id = NULL** (冪等キーなし)。発生源は admin 操作の CAS 内 1 回のみでリトライ経路が存在しないため冪等キー不要。payload.task_id で逆引きは可能

### 4.4 activities の不変性

- note 以外の activity は**作成後不変** (RLS で UPDATE/DELETE を note に限定 — §2.2)。訂正が必要な誤記録は発生源 (calls / documents / work_blocks) 側の再実行・訂正で新 activity が積まれる
- note は編集・削除可 (E605 は note 以外への変更操作)。note のリンク付け替え = activity_links の DELETE + INSERT (note のみ RLS 許可)。**非 note のリンク付け替えは唯一 `relinkActivity` (契約メソッド — §6.7 v1.2) 経由**: activity 本体は不変のまま links のみ全置換 (service 実行 + 'system' 監査)。不変性の対象は activities 行であり、リンク (参照) の訂正は許す — 通話の誤マッチ修正 (04 §7.2) が根拠用途
- occurred_at = 業務時刻 / created_at = 記録時刻の 2 本立て (00-overview §3.2.3-4)。note の occurred_at は作成時刻を既定とし、UI から過去日時に変更可能 (「昨日の電話のメモ」を後から書く)

### 4.5 モジュール間の状態整合 (crm 視点の再掲)

| 相手 | 規則 |
|---|---|
| sales | 帳票イベントは deal.stage を直接更新しない。app 層が戻り値 event で updateDealStage を呼ぶ (提案遷移、拒否可) |
| scheduling | deal が ordered に到達する受注合成 Action (00-overview §4.1 が正 — §7.3-6) が受注明細から作業ブロック原案を生成する (crm は updateDealStage の提供側。crm から scheduling を呼ばない)。deal が lost になったら未着手ブロックの一括キャンセルを**提案** (Phase 5 の Server Action 合成) |
| telephony | 顧客曖昧一致 (P7) は crm が E601 を返し、telephony が E823 に変換して手動確認 UI へ |

---

## 5. 値契約 (Zod)

### 5.1 canonical 参照表 (再定義禁止 — 契約書 v2.8 §4.10 = 07-contracts-delta §D7)

`src/modules/crm/contracts.ts` の冒頭は契約書 §4.10 の**写経** (乖離時は契約書が正)。本書はコードを再掲しない:

| スキーマ / 定数 | 用途 | 本書の関連節 |
|---|---|---|
| `zCustomerLifecycle` / `zLeadSource` / `zDealStage` / `zTaskStatus` / `zTaskOrigin` | DDL check と 1:1 の enum (parity テスト対象) | §2.2 / §11.2 |
| `DEAL_STAGE_REGISTRY` | ステージ意味論 (label/probability/isWon/isLost) のコード registry | §4.2 |
| `zCustomerInput` / `zCompanyInput` / `zDealInput` / `zTaskInput` | 作成入力 (E607 refine 含む) | §6.1 |
| `zNoteActivityPayload` 〜 `zSystemActivityPayload` / `ACTIVITY_PAYLOAD_SCHEMAS` / `ActivityType` / `ActivityPayload<T>` | activities.payload の discriminated map (9 種、全 `.strict()`) | §6.6 |
| `zSimEstimateSnapshot` | pricing 型の構造的同型 (import しない — 循環回避の定石) | §6.5 |
| `zAppendActivityInput` | appendActivity 入力 (payload は z.unknown() → 二段階 parse) | §6.6 |
| `zLeadContact` / `zIntakeFromInquiryInput` / `zIntakeFromSimulatorInput` | リード取込入力 | §6.5 |

### 5.2 契約外拡張スキーマ (crm/contracts.ts 追記分 — admin UI / 自モジュール専用)

他モジュールからの import 禁止 (必要になったら 07-contracts-delta の改訂で契約書 §4.10 へ昇格)。完全定義:

```ts
import { z } from "zod";
import { zDateOnly, zIsoDatetime, zShortText, zTelE164 } from "@/modules/platform/contracts";
// 同一ファイル上部 (契約書 §4.10 写経部) から: zCustomerLifecycle, zDealStage ほか

/* ============================================================
 * 契約外拡張 (01-crm.md §5.2)。admin UI / crm 内部専用。
 * 他モジュールから import してはならない (契約昇格は 07-contracts-delta 改訂が先)。
 * ============================================================ */

/** 顧客更新 (楽観排他の expectedUpdatedAt は facade 引数で別渡し) */
export const zCustomerUpdateInput = z.object({
  kind: z.enum(["person", "company_contact"]),
  name: zShortText(80),
  name_kana: z.string().max(120).nullable(),
  email: z.string().email().max(120).nullable(),
  tel_e164: zTelE164.nullable(),
  company_id: z.string().uuid().nullable(),
  address: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
  lifecycle: zCustomerLifecycle,          // 全遷移許可 (§4.1)
}).strict();
export type CustomerUpdateInput = z.infer<typeof zCustomerUpdateInput>;

/** 会社更新 (作成は canonical の zCompanyInput) */
export const zCompanyUpdateInput = z.object({
  name: zShortText(80),
  name_kana: z.string().max(120).nullable(),
  tel_e164: zTelE164.nullable(),
  address: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
}).strict();
export type CompanyUpdateInput = z.infer<typeof zCompanyUpdateInput>;

/** 顧客一覧フィルタ (ページングは platform の zPagination を併用) */
export const zCustomerListFilter = z.object({
  q: z.string().max(80).nullable(),       // 名前/かな/email/電話の部分一致 (電話は E.164 正規化後に前方一致)
  // 'active' = lead + customer (既定 — §4.1「archived は一覧の既定フィルタから除外」と一致させる。v1.1 是正)
  lifecycle: z.union([zCustomerLifecycle, z.literal("all"), z.literal("active")]).default("active"),
  include_merged: z.boolean().default(false), // merged_into 非 NULL 行の表示 (既定除外)
}).strict();
export type CustomerListFilter = z.infer<typeof zCustomerListFilter>;

/** 案件更新 (ステージ/失注は専用メソッド — 本スキーマに stage を含めない) */
export const zDealUpdateInput = z.object({
  title: zShortText(120),
  company_id: z.string().uuid().nullable(),
  amount_jpy: z.number().int().min(0).max(9_999_999_999).nullable(),
  expected_close_on: zDateOnly.nullable(),
  notes: z.string().max(10_000).nullable(),
}).strict();
export type DealUpdateInput = z.infer<typeof zDealUpdateInput>;

/** 案件一覧フィルタ */
export const zDealListFilter = z.object({
  q: z.string().max(80).nullable(),
  stage: z.union([zDealStage, z.literal("all"), z.literal("open")]).default("open"),
  // 'open' = 終端 (paid/lost) 以外
}).strict();
export type DealListFilter = z.infer<typeof zDealListFilter>;

/** 失注 (updateDealStage(to='lost') は KMB-E602 — 本入力の専用メソッドのみが lost へ落とせる) */
export const zMarkDealLostInput = z.object({
  reason: zShortText(200),
}).strict();
export type MarkDealLostInput = z.infer<typeof zMarkDealLostInput>;

/**
 * 終端ステージ (入金済み/失注) の案件再開 (§4.2 v1.2 — Issue #102)。zMarkDealLostInput と同型
 * (理由必須の単一入力)。to_stage は zDealInput.stage の「zDealStage の部分集合 enum」の前例に倣い
 * 非終端 7 値のみ (paid/lost への「再開」は無意味 — canReopenDeal が同じ集合で二重防御)
 */
export const zReopenDealInput = z.object({
  to_stage: z.enum([
    "inquiry", "estimating", "quote_sent", "ordered", "in_production", "delivered", "invoiced",
  ]),
  reason: zShortText(200),
}).strict();
export type ReopenDealInput = z.infer<typeof zReopenDealInput>;

/** 顧客マージ (§6.4)。winner = 残す側 */
export const zMergeCustomersInput = z.object({
  winner_id: z.string().uuid(),
  loser_id: z.string().uuid(),
}).strict().refine(v => v.winner_id !== v.loser_id, "同一の顧客同士はマージできません (KMB-E608)");
export type MergeCustomersInput = z.infer<typeof zMergeCustomersInput>;

/** note activity の編集 (note 以外は KMB-E605) */
export const zNoteUpdateInput = z.object({
  title: zShortText(120),
  body: z.string().max(10_000).nullable(),
  occurred_at: zIsoDatetime,              // 過去日時への変更可 (§4.4)
}).strict();
export type NoteUpdateInput = z.infer<typeof zNoteUpdateInput>;

/** タスク更新 */
export const zTaskUpdateInput = z.object({
  title: zShortText(120),
  body: z.string().max(2000).nullable(),
  due_on: zDateOnly.nullable(),
  deal_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
}).strict();
export type TaskUpdateInput = z.infer<typeof zTaskUpdateInput>;

/** タスク一覧フィルタ */
export const zTaskListFilter = z.object({
  status: z.union([zTaskStatus, z.literal("all")]).default("open"),
  scope: z.enum(["all", "overdue", "today", "week", "no_due"]).default("all"), // JST 判定 (internal/jst.ts)
}).strict();
export type TaskListFilter = z.infer<typeof zTaskListFilter>;

/** タイムライン取得対象 (厳密に 1 対象) */
export const zTimelineTarget = z.union([
  z.object({ customer_id: z.string().uuid() }).strict(),
  z.object({ company_id: z.string().uuid() }).strict(),
  z.object({ deal_id: z.string().uuid() }).strict(),
]);
export type TimelineTarget = z.infer<typeof zTimelineTarget>;

/** タイムライン keyset ページング。カーソルは base64("<occurred_at ISO>|<id>")
 *  (platform zPagination は created_at 基準のため crm 専用に分離。
 *   encode/decode は internal/timeline-cursor.ts — 単体テスト対象) */
export const zTimelinePagination = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export type TimelinePagination = z.infer<typeof zTimelinePagination>;

/** inquiry 種別 → 案件タイトル/取込ラベルの対応 (INQUIRY_TYPE_LABEL — UI/intake 共用)。
 *  訳語は既存 src/modules/inquiry/internal/notify.ts の INQUIRY_TYPE_LABELS と同一文字列 (v1.1 是正 —
 *  通知メールと CRM 画面で同じ inquiry_type に別ラベルを見せない)。inquiry internal は import 不可の
 *  ため定義の重複は構造上やむを得ない — 文言を変えるときは必ず両方を同時更新すること */
export const INQUIRY_TYPE_LABEL: Record<"construction" | "estimate" | "material" | "other", string> = {
  construction: "施工依頼",
  estimate: "見積もり相談",
  material: "材料に関する質問",
  other: "その他",
};
```

### 5.3 読み取りビュー型 (Zod 化しない — 契約書 §4.9 の規約どおり repository + DDL が正しさを保証)

```ts
import type { z } from "zod";
// 契約書 §4.10 から: ActivityType, DealStage ほか

export type CustomerListItem = {
  id: string;
  kind: "person" | "company_contact";
  name: string;
  name_kana: string | null;
  email: string | null;
  tel_e164: string | null;
  company_name: string | null;       // companies JOIN (crm 所有内)
  lifecycle: "lead" | "customer" | "archived";
  source: "form" | "simulator" | "phone" | "manual" | "migration";
  open_deal_count: number;           // stage ∉ {paid, lost} の件数
  created_at: string;
  updated_at: string;                // 楽観排他用の生文字列
};

export type CustomerDetail = CustomerListItem & {
  address: string | null;
  notes: string | null;
  company_id: string | null;
  merged_into_customer_id: string | null;
  created_by: string | null;
};

export type CompanyListItem = {
  id: string;
  name: string;
  name_kana: string | null;
  tel_e164: string | null;
  address: string | null;
  customer_count: number;
  updated_at: string;
};

export type DealListItem = {
  id: string;
  title: string;
  customer_id: string;
  customer_name: string;
  company_name: string | null;
  stage: DealStage;
  amount_jpy: number | null;
  expected_close_on: string | null;
  source: "form" | "simulator" | "phone" | "manual" | "migration";
  created_at: string;
  updated_at: string;
};

export type DealDetail = DealListItem & {
  pipeline: "default";
  won_at: string | null;
  lost_reason: string | null;
  source_inquiry_id: string | null;
  notes: string | null;
};

/** カンバン 1 列 (§8.3)。probability/label は registry から UI が引く */
export type DealKanbanColumn = {
  stage: DealStage;
  total_jpy: number;                 // 列内 amount_jpy 合計 (NULL は 0 扱い)
  deals: DealListItem[];
};

export type TimelineItem = {
  id: string;
  activity_type: ActivityType;
  occurred_at: string;
  title: string;
  body: string | null;
  payload: ActivityPayload<ActivityType>;  // repository が ACTIVITY_PAYLOAD_SCHEMAS で parse 済み (KMB-E604 検出)
  ref_table: string | null;
  ref_id: string | null;
  editable: boolean;                 // activity_type === 'note'
  updated_at: string;
};

export type TaskListItem = {
  id: string;
  title: string;
  body: string | null;
  due_on: string | null;
  status: "open" | "done" | "cancelled";
  origin: "manual" | "ai_call" | "form" | "system";
  deal: { id: string; title: string } | null;
  customer: { id: string; name: string } | null;
  overdue: boolean;                  // JST 判定済み
  updated_at: string;
};

/** 日次ダイジェスト (§7.2)。sales 章は Phase 5 配線までは null (graceful degrade) */
export type CrmDigest = {
  generated_on: string;              // zDateOnly (JST)
  overdue_tasks: TaskListItem[];
  today_tasks: TaskListItem[];
  awaiting_leads: DealListItem[];    // stage='inquiry' の全件 (取込直後含む)
  sales: {
    expiring_quotes: Array<{ document_id: string; doc_no: string; valid_until: string; total_jpy: number }>;
    unpaid_invoices: Array<{ document_id: string; doc_no: string; issue_date: string; balance_jpy: number }>;
  } | null;
};

/** ダッシュボード KPI (§8.6) */
export type CrmDashboardKpi = {
  awaiting_lead_count: number;       // stage='inquiry' の deal 数
  weighted_pipeline_jpy: number;     // Σ floor(amount_jpy × probability / 100)、stage ∉ {paid, lost}
  overdue_task_count: number;
  week_open_task_count: number;      // 今週 (JST 月曜起点) が期日の open タスク数
};
```

### 5.4 型の流れ (DB ↔ Zod ↔ API ↔ UI)

| 方向 | 経路 |
|---|---|
| 入力 (作成/更新) | UI フォーム (react-hook-form + zodResolver、契約と同一スキーマ) → Server Action (requireAdmin + 同一スキーマ re-parse) → facade (同一スキーマ parse — 三重だが単一定義) → repository INSERT/UPDATE |
| 入力 (payload) | 発生源 facade → `zAppendActivityInput` (外側) → `ACTIVITY_PAYLOAD_SCHEMAS[type]` (内側) の二段階 parse → jsonb 保存 |
| 出力 (一覧/詳細) | repository (型付き select、DDL が正) → ビュー型 (§5.3、Zod 非経由) → Server Component props → Client |
| 出力 (payload) | jsonb → repository 読み出し時に `ACTIVITY_PAYLOAD_SCHEMAS[type].parse` (壊れた payload の早期検出 = E604 ログ + タイムラインでは「表示できない記録」フォールバック描画) |

---

## 6. facade 仕様

### 6.1 契約メソッド (契約書 v2.8 §D8 — シグネチャ不変。本節は実装意味論とエラー全列挙)

実行文脈の規約: `ctx?: ExecutionContext` を持つメソッドのみ service 文脈から呼べる。**intake 系 2 メソッドは例外的に「常に service client で実行」** (公開 route が呼び出し元のため。§3.4)。

| メソッド | 実行文脈 | 意味論 (要点) | 返すエラー (Result.code 全列挙) |
|---|---|---|---|
| `intakeFromInquiry(input)` | 内部で常に service | §6.5 の冪等シーケンス。顧客 dedup → deal (source_inquiry_id 冪等) → activity 'form_submission' → 折り返しタスク。戻り値 `{customer_id, deal_id}` | E101 (Zod) / E607 (連絡先欠落) / E603 (inquiry FK 不成立) / E901 (service key 未設定・DB 障害) |
| `intakeFromSimulator(input)` | 同上 | 同上 + activity 'simulator_estimate' (payload = `zSimEstimateSnapshot`)。deal.amount_jpy = estimate.total_max (quote_only は NULL — P12)、source='simulator' | 同上 + E604 (snapshot parse 不一致) |
| `createCustomer(input, opts?)` | session | dedup 検索 (§6.3)。候補あり + force なし → E601 (detail = 候補 id/名前の列挙)。`opts.force: true` で強制作成 | E101 / E601 / E603 (company_id 不在) / E201・E202 (未認証/非 admin) / E901 |
| `matchCustomerByPhone(telE164, ctx?)` | session / service | **全顧客 (マージ敗者行含む) から tel_e164 完全一致検索し、一致行の merged_into を終端解決して勝者 id 集合に dedupe** (§6.3 — v1.1 是正: 旧規定「merged_into IS NULL から検索」では敗者側にしか残らない旧番号がヒットせず P14 が成立しなかった) → 0 件: `ok(null)` / 1 件: `ok({customer_id})` / 複数: **E601 + detail に候補 id 列挙** (telephony が E823 へドメイン変換 — P7) | E101 (E.164 形式不正) / E601 / E901 |
| `getCustomerRef(customerId, ctx?)` (v1.2 — 07 v1.2 昇格) | session / service | 跨モジュール read の最小射影 (`CustomerRef` — 07 §4.10。**v1.7 で address 追加** = 02-sales の billing_address 複製の源)。**merged_into 終端解決込み** (§6.3 手順 3 と同一ヘルパ — 旧 id で呼んでも勝者の現行値を返す。R4 の telephony 表示系解決経路)。詳細ビュー getCustomer (§6.2) とは別物 — 他モジュールは本メソッドのみ呼べる | E101 / E603 (不在) / E201・E202 (session 時) / E901 |
| `getDealRef(dealId, ctx?)` (v1.2 — 07 v1.2 昇格) | session / service | 最小射影 `DealRef` (07 §4.10 — customer/company の name・kind・address (v1.7) と stage・updated_at)。updated_at は 02-sales §7.1-2 のステージ提案適用が CAS に使う生文字列。customer は merged_into 終端解決済みの現行値 | E101 / E603 / E201・E202 (session 時) / E901 |
| `getDealRefs(dealIds, ctx?)` (v1.2 — 07 v1.7 batch 追加) | session / service | getDealRef の batch 版 — 02-sales listDocuments (keyset 50 件/頁) の deal_title 解決を 1 呼び出しで行い N+1 を回避。**不在 id は結果から除外** (エラーにしない — 呼び出し側が id で突き合わせ)。空配列入力は `ok([])`。実装は IN 句 1 クエリ + 終端解決 (customers への追加 SELECT は解決対象がある場合のみ) | E101 / E201・E202 (session 時) / E901 |
| `createDeal(input)` | session | zDealInput parse → customer/company 存在確認 → INSERT (stage は input のまま、既定 'inquiry')。**customer が kind='company_contact' かつ input.company_id NULL なら customer.company_id を自動補完して INSERT** (P2「deal.company_id にも複製」の実装点 — v1.1 明確化。UI 側の自動セットは §8.3) | E101 / E603 / E201・E202 / E901 |
| `updateDealStage(dealId, to, expectedUpdatedAt)` | session | §4.2 の遷移ガード (順序評価 — from===to は終端同士含め noop ok・UPDATE なし)。won 初到達で won_at 記録 + lifecycle 昇格を同一操作で実施。**from 非終端で to='lost' は常に E602** (markDealLost 専用 — detail に誘導文言。v1.1 是正: 旧記述「to='lost' は常に E602」は (lost,lost) noop と矛盾し §11.2 の 9×9 期待値が確定しなかった — §4.2 のマトリクスが正)。from 終端かつ to 相違も E602 (terminal) | E602 / E103 (CAS) / E603 (deal 不在) / E201・E202 / E901 |
| `appendActivity(input, ctx?)` | session / service | §6.6。二段階 parse → 冪等 INSERT → links INSERT。戻り値 `{activity_id, created}` | E604 (email 型 v1 拒否・payload 不一致) / E603 (リンク先不在) / E101 / E201・E202 (session 時) / E901 |
| `relinkActivity(activityId, links, ctx?)` (v1.2 — 07 v1.6 D8 追加。実装意味論は §6.7) | session / service | activity_links の**全置換** (activity 本体は不変。`links=[]` で全解除)。用途は telephony の通話「付け替え/解除」のみ (04 §7.2 linkCallToCustomer)。置換は crm repository の **service 実行** + 監査 'system' activity (code:'activity.relinked') 追記 — §6.7 | E101 (links 形式不正) / E603 (activity/リンク先不在) / E201・E202 (session 時) / E901 |
| `createTask(input, ctx?)` | session / service | zTaskInput parse → INSERT (source_activity_id 非 NULL 時は `upsert(onConflict="source_activity_id,title", ignoreDuplicates)` → 競合時は既存行 SELECT で冪等 — 07-delta v1.1 裁定 #10 + §2.2 冪等 index 設計原則) → `task_event(created)` activity (ref=(tasks,id) 冪等) を deal/customer リンク付きで追記 | E101 / E603 (deal/customer/source_activity 不在) / E201・E202 (session 時) / E901 |
| `completeTask(taskId, expectedUpdatedAt)` | session | §4.3。open→done (completed_at=now)。done→done は no-op ok。`task_event(completed)` (ref なし) 追記 | E606 (cancelled 終端) / E103 / E603 / E201・E202 / E901 |

補足:

- E201/E202 は session 実行時に facade 冒頭の `getSessionAndClient()` 失敗で返る (service 文脈では発生しない)
- appendActivity の詳細規約は 00-overview §3.2.3 (1〜6) が統合契約。本書 §6.6 はその実装手順
- **createTask の title 安定性 (呼び出し元への前提条件 — v1.1 明文化)**: 冪等キーが (source_activity_id, title) の完全一致であるため、**非決定的に生成される title (LLM 生成等) はリトライ間で同一に保つこと** — 生成結果を先に永続化してから createTask を呼ぶ (04-telephony は call_jobs.analysis を analyzing ステージで確定・永続化してから linking で参照する確立手順)。title が呼び出しごとに揺れると冪等が破れ重複タスクが生成される

### 6.2 契約外拡張メソッド (facade.ts に「契約外拡張 (01-crm.md §6.2)」コメント必須。他モジュールから呼出禁止)

すべて session 実行 (requireAdmin 相当のセッション検証を facade 冒頭で実施)。ctx 付きは明記:

| メソッド | シグネチャ | エラー |
|---|---|---|
| listCustomers | `(filter: CustomerListFilter, p: Pagination) => Promise<Result<Paged<CustomerListItem>>>` | E101 / E201・E202 / E901 |
| getCustomer | `(id: string) => Promise<Result<CustomerDetail>>` — merged_into 非 NULL 時もそのまま返す (UI が転送バナー表示 §8.2) | E603 / E201・E202 / E901 |
| updateCustomer | `(id, input: CustomerUpdateInput, expectedUpdatedAt: string) => Promise<Result<void>>` | E101 / E103 / E603 / E201・E202 / E901 |
| mergeCustomers | `(input: MergeCustomersInput, expectedWinnerUpdatedAt: string) => Promise<Result<void>>` — §6.4 | E608 / E603 / E103 / E201・E202 / E901 |
| listCompanies / getCompany / createCompany / updateCompany | 会社 CRUD (作成入力は canonical zCompanyInput) | E101 / E103 / E603 / E201・E202 / E901 |
| listDeals | `(filter: DealListFilter, p: Pagination) => Promise<Result<Paged<DealListItem>>>` | E101 / E201・E202 / E901 |
| listDealsKanban | `() => Promise<Result<DealKanbanColumn[]>>` — 非終端 7 列は全件、paid/lost は直近 20 件 | E201・E202 / E901 |
| getDeal | `(id) => Promise<Result<DealDetail>>` | E603 / E201・E202 / E901 |
| updateDeal | `(id, input: DealUpdateInput, expectedUpdatedAt) => Promise<Result<{ updated_at: string }>>` — v1.1: 更新後の updated_at (moddatetime 反映値) を返す。§7.3-3 の updateDeal → updateDealStage 連鎖が getDeal 再読込 (レース窓) なしで新 CAS 値を得るため | E101 / E103 / E603 / E201・E202 / E901 |
| markDealLost | `(id, input: MarkDealLostInput, expectedUpdatedAt) => Promise<Result<void>>` — stage='lost' + lost_reason を単一 UPDATE (CAS)。終端からは E602 | E101 / E602 / E103 / E603 / E201・E202 / E901 |
| reopenDeal (v1.2 — #102) | `(dealId, input: ReopenDealInput, expectedUpdatedAt) => Promise<Result<{ updated_at: string }>>` — §4.2-8。終端 (paid/lost) の案件を非終端 7 ステージへ再開する専用経路。`canReopenDeal` ガード → `crm_reopen_deal` RPC (GUC 限定 DB バイパス) → 成功後 system activity ('deal.reopened') を追記 (失敗は console.warn のみ、主操作は成功のまま返す) | E101 / E609 / E103 / E603 / E201・E202 / E901 |
| findDealByInquiry | `(inquiryId: string) => Promise<Result<{ deal_id: string } | null>>` — 「リード化済み」判定 (§8.7) | E201・E202 / E901 |
| listTimeline | `(target: TimelineTarget, p: TimelinePagination) => Promise<Result<Paged<TimelineItem>>>` — occurred_at 降順 keyset | E101 / E603 / E201・E202 / E901 |
| updateNoteActivity | `(id, input: NoteUpdateInput, expectedUpdatedAt) => Promise<Result<void>>` — note 以外は E605 | E101 / E605 / E103 / E603 / E201・E202 / E901 |
| deleteNoteActivity | `(id) => Promise<Result<void>>` — note 以外は E605 (RLS も二重拒否) | E605 / E603 / E201・E202 / E901 |
| relinkNoteActivity | `(id, links: TimelineTarget[]) => Promise<Result<void>>` — note のみ。links 全削除→再作成 | E605 / E603 / E101 / E201・E202 / E901 |
| listTasks | `(filter: TaskListFilter, p: Pagination) => Promise<Result<Paged<TaskListItem>>>` | E101 / E201・E202 / E901 |
| updateTask | `(id, input: TaskUpdateInput, expectedUpdatedAt) => Promise<Result<void>>` | E101 / E103 / E603 / E606 (cancelled への編集) / E201・E202 / E901 |
| cancelTask | `(id, expectedUpdatedAt) => Promise<Result<void>>` — open→cancelled + task_event(cancelled) | E606 / E103 / E603 / E201・E202 / E901 |
| reopenTask | `(id, expectedUpdatedAt) => Promise<Result<void>>` — done→open。cancelled は E606 | E606 / E103 / E603 / E201・E202 / E901 |
| getDashboardKpi | `() => Promise<Result<CrmDashboardKpi>>` — SQL 集計 (クライアント集計禁止規約) + registry 掛け算はコード側 | E201・E202 / E901 |
| collectDigest | `(ctx: ExecutionContext) => Promise<Result<CrmDigest>>` — service 専用 (worker)。sales 章は null 固定 (Phase 5 で route 合成 §7.2) | E901 |
| sendDailyDigest | `(digest: CrmDigest, ctx: ExecutionContext) => Promise<Result<void>>` — Resend ベストエフォート。宛先 = settings 'notifications'.inquiry_to。失敗は E902 を**ログのみ** (Result は ok) | E901 (settings 読取不能のみ) |

### 6.3 dedup アルゴリズム (internal/dedup.ts — 純関数部は単体テスト必須)

```
findDuplicateCandidates(email, telE164):
  対象母集団: customers 全行 — archived もマージ敗者 (merged_into 非 NULL) も検索対象に含める (P14)
    (v1.1 是正: 旧規定「WHERE merged_into_customer_id IS NULL」は敗者行を最初から検索除外して
     しまい、直後の「ポインタ解決」が構造的に到達不能だった。マージ RPC の勝者補完は coalesce の
     ため、勝者が自分の tel/email を持つ場合は敗者の連絡先が敗者行にしか残らない — 旧番号着信・
     旧メール再問い合わせで重複顧客が再生する欠陥)
  1. email 非 NULL → lower(email) 完全一致を検索
  2. telE164 非 NULL → tel_e164 完全一致を検索
  3. 一致行のうち merged_into_customer_id 非 NULL の行は終端解決 (下記) して勝者 id に置換
     — 敗者行自身は候補として提示しない (§4.1 の表)
  4. 3 の結果を id で dedupe → 候補リスト (id, name, lifecycle, 一致キー種別)
```

利用点ごとの挙動:

| 利用点 | 候補 0 件 | 候補 1 件 | 候補 2 件以上 |
|---|---|---|---|
| createCustomer (force なし) | 作成 | **E601** (detail に候補) | **E601** (同) |
| createCustomer (force あり) | 作成 | 作成 | 作成 |
| intake (§6.5 — 人間不在) | lifecycle='lead' で新規作成 | 既存顧客を採用 (email 一致を tel 一致より優先) | **既存には自動で寄せず lifecycle='lead' で新規作成** + `system` activity (code='lead.intake.ambiguous', detail=候補 id 列挙, ref=(contact_inquiries, inquiry_id)) を新規 lead/deal のタイムラインに積んで人間の後確認に回す (同一人物と確認できたら手動マージ §6.4 で寄せる)。取込は止めない。v1.1 是正 — 旧規定「updated_at 最新の 1 件を採用」は家族共用メールで別人の既存顧客に新規相談・見積・通話が自動で積まれ、§0.1「勝手に統合しない」と矛盾。note 以外の activity はリンク付け替え不能 (§4.4) で誤紐づけの事後是正が効かないため、予防 (新規 lead) に倒す |
| matchCustomerByPhone | ok(null) | ok({customer_id}) | E601 (telephony が E823 に変換) |

マージ済みポインタの終端解決 (手順 3): `merged_into_customer_id` を終端 (NULL になるまで、上限 5 hop — 循環は DB check `customers_no_self_merge` + マージ済み再マージ禁止で構造上発生しないが防御) まで辿って勝者 id に置換する。matchCustomerByPhone (§6.1) も同じ「全顧客検索 → 終端解決 → 勝者集合に dedupe」で実装する。

### 6.4 顧客マージ仕様 (重複マージ — 要求 R1)

- 入口: 顧客詳細の「重複を統合」/ E601 候補ダイアログの「この顧客に統合」(§8.2)
- 実体: `crm_merge_customers` RPC (§2.2) — 単一 TX で ① deals/tasks の customer_id 付け替え ② activity_links の付け替え (勝者側に同一 activity のリンクがある行は削除 = 重複防止) ③ 勝者の空欄補完 (email/tel/かな/住所/会社 — 勝者の非 NULL 値優先) ④ 敗者を archived + merged_into ポインタ
- RPC 成功後、facade が `appendActivity('system', { code: 'customer.merged', detail: '<敗者名> を統合' }, ref=(customers, loser_id), links=[{customer_id: winner_id}])` を追記 (冪等キーにより再実行安全)。この追記が失敗しても マージ自体は成立 (E902 相当のログのみ — タイムライン欠落は許容)
- **触らないもの**: 他モジュール所有の FK (calls.customer_id 等)。表示時の解決は各所有モジュールが `CrmFacade` の read (matchCustomerByPhone / getCustomer) を通ることで担保 (境界注意 → §15/openIssues)
- 取り消し不可 (敗者の notes/name 等は上書きされないため、必要なら敗者を手動で再作成)。UI は確認ダイアログで「元に戻せません」を明示

### 6.5 リード取込の冪等シーケンス (internal/intake.ts)

多テーブル書込だが Supabase JS でトランザクションを張れないため、**各ステップを冪等にした at-least-once シーケンス**で設計する (再呼び出し・二重クリックに耐える。順序が本質):

```
intakeFromInquiry / intakeFromSimulator (input):
  0. zIntakeFrom*Input parse (E101)。contact.tel を normalizeJpPhoneToE164() (失敗は null 化)
     → email も tel も null なら E607
  1. 冪等マーカー確認 (v1.1 是正 — 旧「短絡」を「補修モード」に変更): activities WHERE
     activity_type='form_submission' AND ref_table='contact_inquiries' AND ref_id=inquiry_id
     → 存在: 手順 2〜3 を下記の再解決に置き換え、手順 4〜6 は**必ず再実行**する:
       (a) customer/deal の再解決 — links 逆引きを第一候補とし、links 欠損 (activity INSERT 直後の
           クラッシュ) 時は deals.source_inquiry_id 逆引き → deal.customer_id で回収。customer も
           未解決なら手順 2 の顧客解決を実行
       (b) deal がどこにも無い場合 (§12.1 の「deal なし取込」= done 移行行) は解決済み customer で
           手順 3 から deal を新規作成する。この分岐は §8.7 の済み判定 (マーカー併用) により通常 UI
           からは到達しない — 到達 = admin/API が明示的に案件化を再要求した操作として扱う
       旧規定「links から逆引きして手順 5 だけ再実行」は、(i) 手順 4 の activity INSERT と links
       INSERT の間で落ちるとリンク欠損 (どのタイムラインにも出ない activity) が恒久化し、
       (ii) simulator 経路で form_submission 後・simulator_estimate 前に落ちると見積 payload が
       永久欠落し、(iii) deal なし取込では戻り値 {customer_id, deal_id} を満たせないため撤回
  2. 顧客解決: §6.3 の intake 行 — 0 件 = lifecycle='lead' で新規作成 / 1 件 = 既存顧客を採用
     (email 一致を tel 一致より優先。**採用行が手動 archived なら lifecycle='lead' に戻す** —
     再問い合わせ = 取引再開のシグナル。マージ敗者は §6.3 の終端解決で勝者に置換済み — v1.1 明記) /
     複数 = **既存に自動で寄せず lifecycle='lead' で新規作成** (v1.1 是正 — §6.3 の表)
  3. deal 作成 (冪等): upsert(onConflict="source_inquiry_id", ignoreDuplicates — §2.2 冪等 index
     設計原則) → 競合時は既存行 SELECT で回収
     - title: `${INQUIRY_TYPE_LABEL[type]} — ${contact.name}` (simulator は「シミュレーター見積 — ○○」)
     - stage='inquiry' / source='form'|'simulator' / amount_jpy: simulator のみ total_max (quote_only は NULL)
  4. activity 追記 (appendActivity 内部呼び — 冪等キーで再送安全。created:false でも links は
     冪等 upsert で必ず補完される — §6.6 v1.1):
     - 'form_submission' payload={inquiry_id, inquiry_type, excerpt} ref=(contact_inquiries, inquiry_id)
       links=[{customer_id}, {deal_id}]
     - (simulator のみ) 'simulator_estimate' payload={estimate, price_note: null} ref=(contact_inquiries, inquiry_id)
       links=[{customer_id}, {deal_id}]
       ※ price_note は v1 常に null (v1.1 明記 — zIntakeFromSimulatorInput に供給経路がない。
         価格表版の記録は Phase 2 で /api/shop/lead からの供給 + 07-delta 契約改訂をセットで行う)
     - (手順 2 が複数一致だった時のみ) 'system' payload={code:'lead.intake.ambiguous', detail=候補 id 列挙}
       ref=(contact_inquiries, inquiry_id) links=[{customer_id}, {deal_id}] — §8.5 の警告色レンダラで
       人間の後確認へ (確認後に同一人物なら手動マージ §6.4 で寄せる)
     ※ occurred_at = 問い合わせ送信時刻 (route から渡る。省略時 now)
  5. 折り返しタスク (補修可能な冪等): tasks WHERE source_activity_id=<form_submission id> が
     なければ作成 — title「折り返し連絡: ${contact.name} (${INQUIRY_TYPE_LABEL[type]})」,
     origin='form', due_on = JST 翌日, deal_id/customer_id 紐づけ
     → createTask 内部で task_event(created) も冪等追記
  6. {customer_id, deal_id} を返す
[途中失敗] どのステップで落ちても再呼び出しで残りが補完される (1 の補修モードが links・
  simulator_estimate・タスクまで必ず再確認する点が要 — at-least-once の自己修復)。
  呼び出し元 (route/Action) は失敗時 KMB-E9xx をログし、問い合わせ保存は巻き戻さない (00-overview §4.2)
```

### 6.6 appendActivity の実装手順 (統合契約 00-overview §3.2.3 の実装詳細)

1. `zAppendActivityInput` parse (E101)
2. `activity_type === 'email'` → **E604** (Phase 2 予約 — detail「メール連携は未対応です」)
3. `ACTIVITY_PAYLOAD_SCHEMAS[activity_type].parse(input.payload)` — 失敗 E604 (二段階 parse の内側)
4. links の対象存在確認 (SELECT id) — 不在 E603。links 内の customer が merged_into 保持 → 終端解決して勝者にリンク
5. INSERT: ref_id 非 NULL 時は `upsert(onConflict="activity_type,ref_table,ref_id", ignoreDuplicates)` (§2.2 冪等 index 設計原則 — 非部分一意 index に対する PostgREST 実行可能形) → 競合時は既存行 SELECT で activity_id を回収し `created: false`。ref_id NULL (note 等) は常に新規
6. activity_links の冪等 INSERT (`upsert(onConflict, ignoreDuplicates)` — activity_links_*_uniq)。**created:false でも必ず実行する** (v1.1 是正 — 手順 5 と 6 の間のクラッシュ後の再送で links を自己修復するため。旧規定「競合時は links 追加もスキップ」は、リンク欠損 activity (どのタイムラインにも表示されない・§6.5 手順 1 の逆引きも不能) を恒久化し、§6.5 [途中失敗] の at-least-once 主張と矛盾するため撤回。links INSERT 自体が冪等なのでスキップする必然性がない)
7. 戻り値 `{activity_id, created: true|false}`

**リンク規約 (推奨 — 各発生源設計書への申し送り)**: 対象が判明している限り customer と deal の**両方**にリンクする (顧客ページ・案件ページ双方のタイムラインに載せるため)。company リンクは company_contact 経由の案件のみ任意。

**note のタイトル自動生成 (UI 補助)**: note 作成 UI は本文のみ入力させ、title = 本文 1 行目の先頭 60 字 (空なら「メモ」)。internal/activity.ts の純関数 `deriveNoteTitle(body)` (単体テスト対象)。

### 6.7 relinkActivity の実装手順 (v1.2 — 07-delta v1.6 D8 の契約追加、実装意味論は本書所掌)

**存在理由**: appendActivity の冪等ヒット (created:false) は links を「補完」するだけで旧リンクを外せない (§6.6-6)。telephony の通話付け替え (誤マッチ修正) 後も 'call' activity が旧顧客のタイムラインに残り続けるため、その除去経路を契約化したのが relinkActivity (07 v1.6)。呼び出し元は 04-telephony §7.2 `linkCallToCustomer` のみ (v1 時点。他用途は 07 改訂が先)。

再紐づけ規則 (facade 実装手順):

1. `links` の各要素を parse — 1 行につき対象は厳密に 1 つ (num_nonnulls=1 — 07 §7.9 と同一 refine)。違反は E101。`links=[]` は全解除として合法
2. activity の存在確認 (SELECT id, activity_type) — 不在 E603。**対象 activity_type の制限はしない** (システム生成 activity の「リンク」は本体と別物 — §4.4 の不変性は activities 行に対する規約で、リンクの張り替えは記録の訂正ではなく参照の訂正)。ただし v1 の呼び出し元が扱うのは 'call' のみ
3. links 内の customer は merged_into を終端解決して勝者に置換 (§6.3 手順 3 — appendActivity 手順 4 と同一)。リンク先の存在確認 — 不在 E603
4. **全置換を service 実行で行う**: crm repository が service client で `DELETE FROM activity_links WHERE activity_id = $1` → 新 links を冪等 INSERT (`upsert(onConflict, ignoreDuplicates)` — activity_links_*_uniq)。RLS の admin DELETE 制限「note のリンクのみ」(§2.2 / §3.2) は**直接操作 (relinkNoteActivity §6.2 経由の UI 操作) に対する制約であり不変** — 本メソッドは facade 経由の監査つき置換のため RLS を widen せず service 実行で通す (RLS 変更なし = migration 不要。07 v1.6 の設計判断)
5. **監査**: 置換成功後に `appendActivity('system', { code: 'activity.relinked', detail: '旧: [<旧リンク要約>] → 新: [<新リンク要約>]' }, ref_table='activities/relinked', ref_id=null, links=<新リンク先 (全解除時は旧リンク先)>)` を追記する。ref_id=null で冪等対象外 (毎回新規行 — 付け替えは都度の操作記録が正)。この監査追記が失敗しても置換自体は成立 (§6.4 マージの監査と同じ縮退 — ログのみ)
6. 戻り値 `Result<void>`

DELETE と INSERT の間のクラッシュは「リンクなし activity」を残すが、(a) 呼び出し元 (04 §7.2) の操作は再実行可能 (楽観排他は calls.updated_at 側で担保)、(b) タイムライン逆引きはリンクなしを安全に表示しない (degrade — §6.5 手順 1 と同じ耐性) ため、トランザクション化 (RPC 化) は v1 では行わない (単一ユーザー操作の低頻度経路 — 発生時は同操作の再実行で自己修復)。

テスト (実装 Issue #2-2 に追加 — §11.3): 置換 (旧 1 件→新 1 件) / 全解除 (links=[]) / merged 顧客への置換 (終端解決) / 不在 activity・不在顧客 E603 / 2 対象リンク E101 / 監査 'system' 行の追記確認 / DELETE 後 INSERT 前クラッシュ相当 (手動 DELETE) からの再実行修復。

---

## 7. Server Actions・API route・ジョブ

### 7.1 Server Actions 一覧 (全 Action 先頭 `requireAdmin()` + Zod parse + revalidatePath)

| Action (配置) | 入力 (Zod) | facade 呼び出し | revalidate |
|---|---|---|---|
| createCustomerAction (`admin/customers/actions.ts`) | zCustomerInput + force: boolean | createCustomer | /admin/customers, /admin |
| updateCustomerAction | zCustomerUpdateInput + expectedUpdatedAt | updateCustomer | /admin/customers, /admin/customers/[id] |
| mergeCustomersAction | zMergeCustomersInput + expectedWinnerUpdatedAt | mergeCustomers | /admin/customers 全域 |
| createCompanyAction / updateCompanyAction | zCompanyInput / zCompanyUpdateInput | createCompany / updateCompany | /admin/customers |
| addNoteAction (`admin/_ui/timeline-actions.ts` 共用) | { body, occurred_at, target: TimelineTarget } | appendActivity('note') — title は deriveNoteTitle | 呼出元パス |
| updateNoteAction / deleteNoteAction / relinkNoteAction | zNoteUpdateInput ほか | updateNoteActivity / deleteNoteActivity / relinkNoteActivity | 同上 |
| createDealAction (`admin/deals/actions.ts`) | zDealInput | createDeal | /admin/deals, /admin |
| updateDealAction | zDealUpdateInput + expectedUpdatedAt | updateDeal | /admin/deals/[id] |
| updateDealStageAction | { deal_id, to: zDealStage } + expectedUpdatedAt | updateDealStage | /admin/deals, /admin |
| markDealLostAction | zMarkDealLostInput + expectedUpdatedAt | markDealLost | /admin/deals, /admin |
| createTaskAction (`admin/tasks/actions.ts`) | zTaskInput | createTask | /admin/tasks, /admin |
| completeTaskAction / cancelTaskAction / reopenTaskAction | { task_id } + expectedUpdatedAt | completeTask / cancelTask / reopenTask | /admin/tasks, /admin |
| updateTaskAction | zTaskUpdateInput + expectedUpdatedAt | updateTask | /admin/tasks |
| intakeInquiryAction (`admin/inquiries/actions.ts` 追記) | { inquiry_id } — inquiry 行から zIntakeFromInquiryInput を組み立て | intakeFromInquiry | /admin/inquiries, /admin/customers, /admin/deals |

### 7.2 /api/jobs/crm-digest (route handler — `src/app/api/jobs/crm-digest/route.ts`)

`src/app/api/jobs/publish/route.ts` と同型 (00-overview §3.1.3 規約):

```
POST /api/jobs/crm-digest        maxDuration = 60
  1. isJobsSecretConfigured() でなければ 503
  2. x-jobs-secret ≠ JOBS_SECRET → 401
  3. 202 を即応答し after() で本体:
     a. digest = await crmFacade.collectDigest({ mode: "service" })
        - overdue_tasks: status='open' AND due_on < JST今日
        - today_tasks:   status='open' AND due_on = JST今日
        - awaiting_leads: deals stage='inquiry' (作成日昇順)
        - sales: null (v1。Phase 5 で本 route が sales の契約外拡張
          `markExpiredQuotes({mode:'service'})` → `getSalesDigest({mode:'service'})`
          (02-sales §6.2 が正 — 07-delta v1.1 裁定 #8 で確定、旧提案シグネチャは破棄) を
          app 層合成で呼んで埋める — crm→sales 依存は作らない。route 骨格は本フェーズで
          sales 部分を facade 存在チェックで skip、sales フェーズで配線有効化 (裁定 #9 = Δs3))
     b. 全リスト空なら送信スキップ (空メールを毎朝送らない)
     c. await crmFacade.sendDailyDigest(digest, { mode: "service" })
        - Resend (internal/notify.ts、inquiry の notifyInquiryReceived と同型)
        - 宛先: settings 'notifications'.inquiry_to / RESEND 未設定・送信失敗は KMB-E902 ログのみ
     d. 例外は KMB-E901 で console.error (route は既に 202 済み)
```

冪等性: 同日に多重起床しても同内容メールが再送されるだけで DB 破壊なし (digest は read-only)。多重送信の抑止は行わない (pg_cron 日次 1 回で実用十分)。

### 7.3 app 層合成の接続点 (crm が受ける/出す配線)

| # | 接続点 | 実装位置 | シーケンス |
|---|---|---|---|
| 1 | contact フォーム → リード | `src/components/contact/actions.ts` (既存 Server Action に追記) | `inquiryFacade.submit` 成功後 `crmFacade.intakeFromInquiry({ inquiry_id, contact: {name, email, tel}, inquiry_type, body_excerpt: body 先頭 300 字 })`。**失敗しても submit の成功応答は変えない** (console.error + ダッシュボード「取込漏れ」表示は inquiry 側 status で代替 — §8.7 の手動リード化が回収経路) |
| 2 | シミュレーター → リード + 見積原案 | `/api/shop/lead` (06-simulator 所有) | 00-overview §4.2。crm は intakeFromSimulator の提供側 |
| 3 | 帳票イベント → ステージ提案 | sales 系 Server Action (02-sales 所有) | issueDocument / recordPayment の戻り値 event → (受注時のみ) `getDeal` で現行値 + updated_at を取得 → `crmFacade.updateDeal(dealId, { ...現行値, amount_jpy: event.total_jpy }, expectedUpdatedAt)` (zDealUpdateInput は全項目置換型のため現行値をエコーする — v1.1 明記) → **updateDeal が返す新 updated_at (§6.2 v1.1)** を `crmFacade.updateDealStage(dealId, 提案ステージ, 新 updated_at)` に渡す (getDeal 再読込を挟まない — レース窓を作らない)。amount 上書きは ordered 遷移時のみ (00-overview §6.1 不変条件) |
| 4 | 通話 → 顧客/タスク/タイムライン | telephony worker (04-telephony 所有) | matchCustomerByPhone → (なし) createCustomer 相当の lead 作成は **intake ではなく createCustomer(source='phone', ctx service 相当)** … telephony は §D8 の契約メソッドのみ使用。曖昧一致 E601→E823 変換 |
| 5 | lost → ブロック一括キャンセル提案 | Phase 5 の deals Server Action | markDealLost 成功後、SchedulingFacade の一括キャンセル (03 定義) を呼ぶ合成。v1 はトースト誘導のみ |
| 6 | 受注確定 (ordered) → 作業ブロック原案 (v1.1 追記 — R2「受注が決まると作業ブロックが生成される」の起点) | 「受注にする」Server Action (02-sales 所有。**00-overview §4.1 が合成手順の正**) | deriveDocument → issueDocument → `crmFacade.updateDealStage(dealId, 'ordered', …)` → getDocumentLinesForBlocks → `SchedulingFacade.generateBlocksFromLines` (全滅 E704 でも受注は成立 — 手動作成へ誘導)。crm は updateDealStage の提供側のみ (crm→sales/scheduling 依存は作らない)。配線は Phase 3s/3c、E2E 受入は該当フェーズの受入基準 |

注: #4 で telephony が lead 顧客を作る経路は service 文脈での実行が必要 — **解消済み**: 07-contracts-delta v1.1 (裁定 #3) で `createCustomer(input, opts?, ctx?: ExecutionContext)` に契約改訂済み。telephony worker は `ctx: {mode:'service'}` を渡して呼ぶ (既存の 2 引数呼び出しは不変)。

**#1 の D6 (公開書込は API route 経由) との整合 (v1.1 明記)**: D6 の趣旨は「ブラウザから Supabase へ anon 直接書込させない」こと。contact フォームは**既存の** Server Action (server 側実行) が honeypot / 送信最小時間 / rate limit を実装済みであり (src/components/contact/actions.ts 実測)、intake 追記はその server 側処理の末尾に乗る — anon 直接書込は発生せず D6 の趣旨を満たす。**新規露出**のシミュレーターは route handler (/api/shop/lead — 06-simulator §6.4、D6 どおり)。稼働中の contact を route handler へ作り替える改修は回帰リスクと引き換えに防御水準が変わらないため行わない (最小変更)。将来 route 化する場合も合成順序 (submit 成功後 intake、失敗は巻き戻さない) は不変。

**spam 事後判定と CRM の同期 (v1.1 明記)**: #1 の自動取込は inquiry status='new' の段階 (送信直後) で走るため、admin が**後から** spam 判定した問い合わせ (既存 RLS `contact_inquiries_admin_delete` は status='spam' の削除を許可 — 運用上想定される経路) は既に customers/deals/tasks/activities が生成済みになる。v1 は自動同期を作らない (inquiry↔crm の依存を双方向とも張らない境界維持) — **spam 判定時は CRM 側の手動クリーンアップが必要**: findDealByInquiry → 案件を「失注 (理由: スパム)」・顧客をアーカイブ・タスクを取消。リスクと将来拡張は §15.1 R6。

---

## 8. 管理画面 UI 仕様

### 8.1 共通仕様

- 全ページ `export const dynamic = "force-dynamic"` / `metadata.title` / searchParams await / facade 経由データ取得 / keyset 50 件 / 状態フィルタは URL クエリ (admin-ui-auth §5.3 の既存規約)
- 部品: `src/app/admin/_ui/` の Surface / PageHeader / DataTableShell / DataTableHeaderRow / dataTableRowClassName + shadcn (Table / Dialog / Sheet / Select / Field 系 / Badge / Tabs / Input / Textarea / Checkbox) + sonner toast
- **shadcn CLI 追加 (crm Issue #2-3 の受入基準に明記)**: `dropdown-menu` (行アクション・カンバンカードメニュー) / `popover` + `calendar` + `date-picker` (due_on / expected_close_on 入力) / `command` (顧客・案件の紐づけピッカー)
- フォーム: react-hook-form + zodResolver (契約と同一スキーマ)。エラーは toast + FieldError 併用 (works 型のインラインバナーではなく inquiries 以降の推奨形)
- 楽観排他: updated_at 生文字列 hidden 往復。E103 は「他の操作で更新されています。再読み込みしてください」バナー + 再読込ボタン
- 金額表示: `Intl.NumberFormat("ja-JP")` + 「円」。日時表示: Asia/Tokyo
- **キーボード操作 (全画面共通の必須チェックリスト — E2E で全キー検証)**: ↑↓ = 行/カード移動、Enter = 詳細/決定、Esc = ダイアログ/シート閉じ・選択解除、Cmd/Ctrl+S = 保存、Tab = 論理順フォーカス。画面固有キーは各節に追記

### 8.2 /admin/customers (顧客)

**一覧 (`page.tsx` + `customers-table.tsx`)**

- 構成: PageHeader (title「顧客」/ description に操作説明 / actions =「新規顧客」ボタン) → 検索行 (Input `?q=` — 名前/かな/email/電話) + lifecycle フィルタ (Link + Badge: 有効 (既定 = lead+customer — §5.2 'active')/すべて/見込み/取引中/アーカイブ) → DataTableShell の一覧
- 列: 名前 (かな併記) / 連絡先 (email・電話) / 会社 / 状態 Badge / 進行中案件数 / 登録日。行クリック or Enter → 詳細へ
- タブ (shadcn Tabs): 「顧客」/「会社」— 会社タブは CompanyListItem 一覧 + 行クリックで会社 Sheet (§8.2 会社)
- キーボード: 共通 + `/` で検索フォーカス

**新規/編集フォーム (`customers/new/page.tsx`, `[id]/edit` は詳細内 Sheet)**

- zCustomerInput (新規) / zCustomerUpdateInput (編集) を zodResolver で共用。kind 切替で会社選択 (command ピッカー — 会社名インクリメンタル検索 + 「新しい会社を作る」)
- **E601 (重複候補) の専用 UX**: 送信 → E601 なら Dialog「似ている顧客がいます」— 候補ごとに [開く] [この顧客に統合] [それでも新規作成 (force)] の 3 択 (P5/P17)。Esc で編集に戻る

**顧客詳細 (`customers/[id]/page.tsx`) — 2 カラム**

- 左 (プロフィール): 基本情報カード (編集 Sheet を開く「編集」ボタン) / 進行中案件リスト (DealListItem、行クリックで案件詳細へ) / open タスクリスト (チェックで complete) / 操作 dropdown-menu (「重複を統合」→ 統合 Dialog (相手を command 検索 → 確認 →mergeCustomersAction)、「アーカイブ」)
- 右 (タイムライン): ActivityTimeline 部品 (§8.5) + メモ追加ボックス (最上部固定。Textarea + Cmd+S 送信 = addNoteAction)
- マージ済み顧客 (merged_into 非 NULL) を開いた場合: 上部に警告バナー「この顧客は○○に統合されました → [統合先を開く]」、全編集操作を無効化
- 会社 Sheet: 会社プロフィール + 所属顧客一覧 + 会社リンクのタイムライン (v1 は company リンク activity が少ない想定のためシート内簡易表示)

### 8.3 /admin/deals (案件)

**カンバン (`page.tsx` + `deals-kanban.tsx` — 既定ビュー)**

- 列 = 非終端 7 ステージ (inquiry〜invoiced)。各列ヘッダ: `DEAL_STAGE_REGISTRY[stage].label` + 件数 + 金額合計。右端に「入金済み / 失注」の折りたたみ列 (直近 20 件)
- ボード上部サマリー: 加重パイプライン合計 (Σ floor(amount×probability/100)) — 業務シナリオ 0.3 の「見込み合計」(v1.1 改名 — §8.6)
- カード: タイトル / 顧客名 / 金額 / 期日 (expected_close_on、超過は赤)。ドラッグで列間移動 → updateDealStageAction (E602/E103 は toast + 元位置に戻す)。**lost 列へのドロップは理由 Dialog (markDealLostAction) を挟む**
- 表示切替 (Tabs): カンバン / テーブル (`?view=table` — DealListItem の DataTable、stage フィルタ + 検索)
- キーボード (カンバン固有): ←→ = 列フォーカス移動、↑↓ = 列内カード移動、**Shift+→ / Shift+← = フォーカスカードのステージを隣へ移動** (updateDealStageAction。lost へは移動不可 — dropdown から「失注にする」)、Enter = 詳細、Esc = フォーカス解除

**新規フォーム**: zDealInput。顧客は command ピッカー (名前/電話検索、「新しい顧客を作る」インライン)。stage 初期値 inquiry。**company_contact 顧客を選ぶと会社欄を自動セット** (P2 — facade 側でも未指定時に customer.company_id を自動補完 §6.1。v1.1 明確化)

**案件詳細 (`deals/[id]/page.tsx`) — 2 カラム**

- 左: ステージバー (9 ステージの横並び。クリックで遷移 = updateDealStageAction、終端・lost は不活性。**終端 (paid/lost) のときは「再開はヘッダの『案件を再開…』から」の 1 行ヒントを表示** — v1.2 #102) / 概要カード (金額・見込み%・期日・顧客・会社・流入元・失注理由) + 編集 Sheet / open タスク + 「やることを追加」 / **帳票セクション (Phase 3s で配線: SalesFacade の deal 別帳票一覧 + PDF リンク。v1 はプレースホルダ「帳票機能は準備中」)** / **作業ブロックセクション (Phase 3c 配線。同様)**
- 右: ActivityTimeline (deal リンク分) + メモ追加ボックス
- ヘッダ actions: dropdown-menu (「失注にする」→ 理由 Dialog / 「受注にする」→ Phase 3s 以降は 00-overview §4.1 の受注合成 Action、v1 は updateDealStage のみ)。**終端 (paid/lost) のときは dropdown-menu の代わりに「案件を再開…」ボタン → `ReopenDealDialog` (戻し先ステージ select + 理由必須 textarea。§4.2-8) — v1.2 #102。#61 の BLOCKER 教訓に従い ReopenDealDialog・LostReasonDialog はいずれも deal.stage の変化と無関係に常時マウント (isTerminal で表示切替するのはボタン/dropdown-menu のみ)**

### 8.4 /admin/tasks (やること)

- 構成: PageHeader (actions =「追加」) → クイック追加行 (Input title + date-picker due_on + 任意の案件 command ピッカー。Enter で createTaskAction) → グループ表示: **期日超過 (赤) / 今日 / 今週 / それ以降 / 期日なし** (JST 判定) → 完了済み/取消は `?status=done|cancelled|all` フィルタで表示
- 行: Checkbox (クリック or Space で completeTaskAction — 即時反映 + toast「元に戻す」で reopenTaskAction) / タイトル / 紐づく案件・顧客リンク / 期日 / origin バッジ (「電話AI」「フォーム」「手動」「システム」)
- 行アクション dropdown: 編集 (Sheet) / 取り消し (cancelTaskAction — 確認 Dialog「元に戻せません」)
- キーボード: 共通 + Space = 完了トグル

### 8.5 ActivityTimeline 共通部品 (`src/app/admin/_ui/activity-timeline.tsx` + `timeline-actions.ts`)

crm の顧客/案件/会社ページで使い、Phase 3t 以降は通話詳細 (04-telephony) からも流用される**タイムライン描画の単一実装**:

- 入力 props: `target: TimelineTarget` + 初期ページ (Server Component が listTimeline で取得して渡す)。「さらに読み込む」で Server Action 経由の追加ページ取得 (occurred_at keyset)
- 行の描画は activity_type 別レンダラ (discriminated switch — payload は parse 済み TimelineItem):
  - `note`: 本文 + 編集/削除 (dropdown、note のみ表示 — editable フラグ)
  - `call`: 方向・時間 (`duration_seconds` 分秒表示)・要約 (summary)。録音再生と全文は /admin/calls 詳細へのリンク (ref_id) — 音声プレーヤはタイムラインに埋め込まない (telephony の署名 URL 発行を経るため)
  - `form_submission`: 種別ラベル (INQUIRY_TYPE_LABEL) + excerpt + /admin/inquiries への逆リンク
  - `simulator_estimate`: グレード/サイズ/個数/概算レンジのサマリーカード (payload.estimate を整形)
  - `document_event`: 書類種別 + doc_no + event ラベル (発行/再発行/承諾/…) + 金額。/admin/documents 詳細リンク (Phase 3s 以降活性)
  - `work_log`: 種別ラベル + 予定 h vs 実績 h + 実施日
  - `task_event`: 「やること『…』を作成/完了/取消」1 行 (payload.task_id で /admin/tasks へ)
  - `system`: code 別の穏当な文言 (lead.intake.ambiguous は警告色 +「候補を確認」導線)
  - **未知 payload (parse 失敗)**: 「表示できない記録 (KMB-E604)」フォールバック行 (クラッシュさせない — §5.4)
- 表示: occurred_at 降順、日付見出し (JST) でグループ。アイコンは lucide (note=Pencil, call=Phone, form=Inbox, estimate=Calculator, document=FileText, work=Hammer, task=CheckSquare, system=Info)
- メモ追加ボックス: Textarea (1 行目がタイトルになる旨 placeholder) + occurred_at (既定 now、date-picker で変更可) + Cmd+S / 送信ボタン

### 8.6 ダッシュボード KPI 拡張 (/admin — 既存カード群に 4 枚追加)

| カード | 値 (getDashboardKpi) | クリック遷移 |
|---|---|---|
| 未対応の相談 | awaiting_lead_count (stage='inquiry') | /admin/deals (カンバン inquiry 列へ) |
| 見込み合計 (加重) | weighted_pipeline_jpy (¥表示)。v1.1 改名 — 旧称「今月の期待値」は expected_close_on の月フィルタを持たない全 open 案件の加重合計に対して過大表示を誘導する誤名 (半年先の案件も合算される)。当月限定の第 2 集計が必要になったら expected_close_on = 当月 (JST) の絞り込みを別カードとして追加する | /admin/deals |
| 期限切れのやること | overdue_task_count (赤系強調) | /admin/tasks (期日超過グループ) |
| 今週のやること | week_open_task_count | /admin/tasks |

集計は repository の SQL (count / sum group by stage) — probability 乗算のみコード側 (registry が DB に無いため)。描画は既存 KPI カード部品の流用 (新規チャート依存なし)。

### 8.7 /admin/inquiries への「リード化」追加 (既存画面の最小変更)

- 一覧行 + 詳細 Dialog に「リード化」ボタンを追加。済み判定は 2 段 (v1.1 是正): ① `findDealByInquiry(inquiry_id)` 非 null →「リード化済み → 案件を開く」② null でも form_submission 冪等マーカー (ref=inquiry_id) が存在 (§12.1 の「deal なし取込」= done 移行行) →「取込済み (案件なし) → 顧客を開く」でボタン不活性。source_inquiry_id 単独判定 (旧規定) だと done 移行行でボタンが活性のまま残り、押下すると何年も前に完了した問い合わせに折り返しタスクと案件が起票される。deal なし取込の顧客に案件が本当に必要なら顧客ページから手動で案件を作る
- 押下 → intakeInquiryAction: inquiry 行の name/email/tel/inquiry_type/body から zIntakeFromInquiryInput を組み立てて intakeFromInquiry → 成功 toast「顧客と案件を作成しました → 開く」
- 自動取込 (§7.3-1) 導入後もこのボタンは残す (取込失敗の回収経路・過去分の個別取込)

---

## 9. エラーコード (crm 帯 KMB-E601〜E619)

00-overview §3.3 が採番 canonical。本表は recovery 文言 (errors.ts 登録内容) の詳細化。**E608 は本書からの帯内追加提案 → 承認済み** (07-contracts-delta v1.1 裁定 #1、00-overview §3.3 に登録済み)。errors.ts への登録は従来どおり #2-1 の受入条件に含める:

| コード | 意味 | ユーザー向けメッセージ | recovery (復旧アクション) |
|---|---|---|---|
| KMB-E601 | 顧客の重複候補あり (email/電話一致) | 似ている顧客がすでに登録されています | 候補を確認し、既存を開く / 統合する / force で新規作成 |
| KMB-E602 | 案件ステージ遷移が不正 | この状態からは変更できません | 終端 (入金済み/失注) は変更不可。失注は「失注にする」(理由入力) から |
| KMB-E603 | アソシエーション先が存在しない | 紐づけ先が見つかりません | 一覧を再読み込みして対象を選び直す |
| KMB-E604 | activity payload が契約と不一致 ('email' の v1 挿入含む) | 記録の形式が不正です | 発生源モジュールの不具合 — ログの detail を確認 (admin 操作では通常発生しない) |
| KMB-E605 | 編集不可 activity への変更操作 | この記録は編集できません (メモのみ編集可) | 訂正はメモを追記する |
| KMB-E606 | タスク状態遷移が不正 (cancelled は終端) | 取り消し済みのやることは変更できません | 必要なら新しいやることを作成 |
| KMB-E607 | リード取込の連絡先欠落 | メールアドレスか電話番号のどちらかが必要です | 連絡先を入力して再送 (手動顧客作成は除外 — P8) |
| KMB-E608 (承認済み — 07-delta v1.1 #1) | 顧客マージ不正 (自己/マージ済み対象) | この組み合わせでは統合できません | 統合済み顧客は選べません。統合先 (残す側) を確認 |
| KMB-E609 (v1.2 — #102) | 案件の再開が不正 (終端以外からの再開/再開先が非終端7ステージ外/理由なし — §4.2-8 reopenDeal) | 案件の再開が不正です | 再開は終端 (入金済み/失注) からのみ・戻し先は非終端ステージのみ・理由入力が必須です |
| E610〜E619 | — (予約。帯内追加は契約書更新が先) | — | — |

共用コード: E101 (Zod 入力不正) / E103 (楽観排他) / E201・E202 (認証・認可) / E901・E902 (システム/通知)。SQL からの送出 (`crm_merge_customers` / `crm_reopen_deal`) は `raise exception 'KMB-EXXX: ...'` の先頭埋め込み規約 (replace_work_image 前例) — TS 側はメッセージ先頭をパースして Result.code に変換する。

---

## 10. 差分表示仕様

**該当なし** (00-overview §8 の裁定を継承)。理由:

1. activities は note 以外不変であり「版」が存在しない。note は編集可だが**編集履歴を持たない** — 1 人運用で自分のメモの監査需要がなく、電帳法等の法定保存対象は帳票 (sales 所有・版管理あり) のみ
2. deals のステージ・金額は現在値のみで版管理しない。節目の客観記録は document_event / work_log activity が担う (§4.2 不変条件 5)
3. 見積原案 vs シミュレーター入力の突き合わせ表示は 02-sales.md §差分表示の所掌 (crm は simulator_estimate payload の保持のみ)

---

## 11. テスト戦略 (implementer + tester ペア・2 回連続 PASS を可能にする粒度)

### 11.1 レイヤ表

| レイヤ | 対象 | 手段 |
|---|---|---|
| 単体 (Vitest、実 DB なし) | dedup 判定 / ステージ遷移ガード / タスク遷移 / payload 二段階 parse / intake シーケンス分岐 / タイムラインカーソル / JST 境界 / KPI 計算 / note タイトル導出 | 純関数を internal/ に切り出して直接テスト (ai-studio-lease.test.ts 様式) |
| 契約 parity | DDL check ↔ Zod enum の 1:1 | tests/contracts-ddl-parity.test.ts に追加 |
| 結合 (supabase start) | RLS 全セル / activities 冪等 / crm_merge_customers RPC / source_inquiry_id 一意 | anon/admin/service 3 クライアント |
| E2E (Playwright / Chrome MCP) | 顧客→案件→タスクの一気通貫 + キーボード全項目 | 本番前に人が実行 |

### 11.2 単体テスト (ファイル別ケース列挙 — 各 Issue の受入基準に転記)

| ファイル | 必須ケース |
|---|---|
| tests/crm-dedup.test.ts | email のみ一致 / tel のみ一致 / 両方一致 (dedupe) / 大文字 email 正規化一致 / **マージ敗者行の一致 → 勝者 id への置換 (敗者行自身は候補に出ない)** / intake の複数一致 → **新規 lead 作成 + ambiguous 判定** / 単一一致が手動 archived → 採用 + lead 復帰判定 / force バイパス / マージポインタ終端解決 (1 hop / 上限超) (v1.1 — §6.3 是正に追随) |
| tests/crm-stage-machine.test.ts | 9×9 全組合せの canTransitionDealStage (noop / terminal / needs_reason / ok) / won_at 初到達判定 (isWon 系全 5 ステージ、変則ジャンプ inquiry→in_production 含む) / 再 won で won_at 不変 / lifecycle 昇格判定 (lead のみ昇格) |
| tests/crm-task-machine.test.ts | open→done / done→open / open→cancelled / cancelled→* 全拒否 (E606) / done→done 冪等 no-op / completed_at 整合 |
| tests/crm-activity-payloads.test.ts | 9 type × 正常 parse / 各 type の必須欠落・未知キー (.strict()) 拒否 / 'email' の v1 拒否 (E604) / zAppendActivityInput の links 0 件・2 対象リンク拒否 / ref_table・ref_id 片側 NULL 拒否 |
| tests/crm-intake.test.ts | マーカー既存 → 補修モード (links 欠損の逆引き回収 / simulator_estimate 補完 / タスク補修の再実行) / マーカー既存 + deal なし → deal 再作成分岐 (§6.5-1b) / 連絡先両 NULL → E607 / tel 正規化失敗 → null 化して email 続行 / simulator の amount (total_max / quote_only→NULL) + price_note null 固定 / タイトル生成 (INQUIRY_TYPE_LABEL 4 種) / excerpt 300 字切詰め (v1.1 — §6.5 是正に追随) |
| tests/crm-timeline-cursor.test.ts | encode→decode 往復 / occurred_at 同時刻の id タイブレーク順序 / 不正カーソルの安全な棄却 (先頭ページ扱い) |
| tests/crm-jst.test.ts | JST 今日/今週 (月曜起点) 境界: UTC 15:00 前後 (= JST 0:00 跨ぎ) / 週跨ぎ / overdue 判定 |
| tests/crm-kpi.test.ts | weighted_pipeline (amount NULL 行 / lost・paid 除外 / floor 丸め) / digest 集計の空→送信スキップ判定 |
| tests/crm-note-title.test.ts | 1 行目 60 字切詰め / 空本文 →「メモ」/ 改行のみ |
| tests/contracts-ddl-parity.test.ts (追記) | customers.kind / lifecycle / source、deals.pipeline / stage、activities.activity_type、tasks.status / origin ↔ Zod enum の 1:1 |

### 11.3 結合テスト (supabase start — migration 0023/0024 適用済み DB)

| 対象 | ケース |
|---|---|
| RLS マトリクス (§3.2 全セル) | anon: 6 テーブル全操作拒否 / admin: 許可セル成立 + customers・companies・deals・activities (非 note)・activity_links の DELETE/UPDATE 拒否セル / service: bypass 成立 |
| activities 冪等 | 同一 (type, ref_table, ref_id) の二重 append → 2 回目 created:false・行数 1・**links は 2 回目でも補完される** (activity 挿入後 links 前クラッシュの再送シナリオ) / 並行 2 接続同時 upsert(ignoreDuplicates) → 片方 0 行応答 → 既存行 SELECT 回収 (§2.2 の方式で成立 — v1.1) / ref_id NULL は重複挿入可 |
| crm_merge_customers RPC | 正常系 (deals/tasks/links 付け替え + 空欄補完 + archived 化) / リンク衝突時の削除 / 自己マージ E608 / マージ済み再マージ E608 / expected_updated_at 不一致 E103 / 非 admin 実行拒否 / anon 実行拒否 |
| relinkActivity (v1.2 — §6.7) | 置換 (旧→新) / 全解除 (links=[]) / merged 顧客の終端解決 / 不在 activity・顧客 E603 / 2 対象リンク E101 / 監査 'system' (code:'activity.relinked') 追記 / DELETE 後クラッシュ相当からの再実行修復 |
| deals.source_inquiry_id | 同一 inquiry_id の二重 INSERT → conflict (取込冪等の土台) |
| trigger_crm_digest_worker | Vault 未設定で raise notice スキップ (例外にならない) |

### 11.4 E2E (Phase 2 受入 — キーボードチェックリスト必須)

1. 顧客作成 (重複候補 Dialog → force) → 顧客詳細でメモ追加 (Cmd+S) → 案件作成 → カンバンで Shift+→ ステージ前進 → 失注 Dialog (理由必須) → タスク quick-add → Space 完了 → タイムラインに task_event が並ぶ
2. /admin/inquiries「リード化」→ 済み表示切替 → 顧客/案件に form_submission が載る
3. キーボード全項目: ↑↓ / ←→ (カンバン) / Tab / Enter / Esc / Cmd+S / Space / `/` 検索 — **全 PASS 後のみ「完成」報告** (全プロジェクト規約)

### 11.5 実装 Issue との対応 (00-overview §11 Phase 2)

| Issue | 含むテスト (2 回連続 PASS 対象) |
|---|---|
| #2-1 DDL + contracts + repository | parity 追記 / crm-dedup / crm-activity-payloads / RLS 結合 / merge RPC 結合 |
| #2-2 facade + digest worker | crm-stage-machine / crm-task-machine / crm-intake / crm-jst / crm-kpi / activities 冪等結合 / digest worker 結合 |
| #2-3 画面 + ダッシュボード | crm-timeline-cursor / crm-note-title / E2E + キーボード全項目 |

---

## 12. 移行計画と受入基準

### 12.1 既存 contact_inquiries の CRM 取込 (任意・推奨 — スクリプト移行)

`scripts/crm-intake-inquiries.ts` (tsx 実行、service role。migration ではない — §2.4):

```
1. 対象: contact_inquiries 全件 (status='spam' は除外)
2. 1 トランザクション相当の逐次処理 + seed_manifest 記録 (batch_id 共通。entity =
   'customers' | 'deals' | 'activities' | 'activity_links' | 'tasks', ref_id = 作成行 id)
3. 各行を intakeFromInquiry と同じ冪等シーケンス (§6.5) に流す。ただし:
   - source='migration' / 折り返しタスクは status IN ('new','in_progress') のみ作成
   - status='done' → 顧客 lifecycle='customer'、deal は作らない (過去完了案件を捏造しない)。
     これは「deal なし取込」— form_submission activity は customer リンクのみで作成する。
     判別は「マーカーあり + findDealByInquiry null」で機械的に可能 (§8.7 の済み判定が併用する
     ため、後から「リード化」ボタンで完了済み問い合わせに案件・折り返しタスクが捏造されることは
     ない — v1.1 是正)
   - status IN ('new','in_progress') → lifecycle='lead' + deal (stage='inquiry')
   - occurred_at = contact_inquiries.created_at (歴史時刻を保持)
   - manifest の記録順は customers → deals → activities → activity_links → tasks を厳守
     (逆順削除の FK 整合の土台 — 手順 5(c))
4. 冪等: form_submission の冪等キー (ref=inquiry_id) により再実行は skip 報告 (件数集計を出力)
5. ロールバック: scripts/rollback-seed.ts が batch_id の seed_manifest を逆順削除
   — 対象は本スクリプトが作成した行のみ。contact_inquiries は一切変更しない。
   **前提タスク (v1.1 是正 — 取込スクリプトと同一 PR の受入条件に含める)**:
   (a) rollback-seed.ts の ENTITY_TABLE に customers / deals / activities / activity_links /
       tasks (いずれも pk='id') を追加する。現行実装 (l.13-24) は crm エンティティを一切知らず、
       未知 entity は console.warn で DB 削除をスキップしたまま seed_manifest 行だけ削除して
       成功ログを出す (l.71-92) — 実データが本番に残留するのに「rolled back」と報告され、
       追跡証跡 (manifest) も消えるため batch_id での再ロールバックが不可能になる誤ロールバック
   (b) 同スクリプトの未知 entity 分岐を「seed_manifest を残して失敗計上 (fail-fast)」へ防御的に
       修正する (既存バグの是正 — 将来のエンティティ追加漏れでも無音破壊しない)
   (c) 削除順序: deals.customer_id は on delete 句なし (NO ACTION) のため customers より先に
       tasks / activity_links / activities / deals を消す必要がある。seed_manifest の id desc
       (= 挿入の逆順) がこの順序を担保する — 手順 3 の記録順厳守が前提 (暗黙依存の明文化)
```

### 12.2 受入基準 (番号付き + 検証方法)

| # | 基準 | 検証方法 |
|---|---|---|
| C1 | migration 0023/0024 適用後、既存 156+ 件テストが全 PASS (既存テーブル無変更の証明) | vitest run |
| C2 | RLS: anon が 6 テーブルの select/insert/update/delete 全拒否、admin が §3.2 のセルどおり、service が bypass | 結合テスト (3 ロール) + 本番 SQL 実測 |
| C3 | appendActivity の冪等: 同一 ref 二重呼びで行数 1・created:false | 結合テスト |
| C4 | **取込前後で contact_inquiries の行数・全列値が不変** (原本非破壊) | 取込スクリプト前後の `select count(*), md5(string_agg(...))` 比較 |
| C5 | 取込結果: spam 除外 / done→customer (deal なし) / new・in_progress→lead+deal / email・tel dedup で同一人物が 1 顧客に集約 | ステージング実行 + SQL 検証 |
| C6 | 取込の再実行が全件 skip (新規行 0) を報告する | スクリプト 2 回実行 |
| C7 | ロールバックで取込作成行が 0 になり、contact_inquiries と既存テーブルは不変。**前提: rollback-seed.ts の ENTITY_TABLE に crm 5 エンティティが登録済み + 未知 entity fail-fast 化 (§12.1 手順 5)** — 検証は manifest 消化数の一致だけでなく **crm 5 テーブルの実行後 count(*)=0 を直接 SQL で確認** (旧実装は削除スキップでも成功ログを出すため、ログだけでは PASS 誤認する) | rollback-seed 実行 + 5 テーブル count 検証 + C4 同様の比較 |
| C8 | /admin/inquiries「リード化」→ 済み表示 → 顧客・案件・タイムライン・タスクが揃う | E2E (§11.4-2) |
| C9 | kmb-crm-digest-worker が本番で JST 07:00 に起床し、期日超過タスクがある朝にメールが届く (ない朝は届かない) | 本番 cron 実測 (C2 env 解消後) |
| C10 | キーボードチェックリスト全 PASS | E2E (§11.4-3) |

---

## 13. 規模見積り

00-overview §13 の Phase 2 crm = 〜7,000 行の内訳 (実装 + テスト):

| 対象 | 概算行数 |
|---|---|
| migration 0023 (DDL + RLS + merge RPC) / 0024 (cron) | 450 / 60 |
| contracts.ts (canonical 写経 + 契約外 §5.2 + ビュー型) | 550 |
| repository.ts (6 テーブル + 集計 + RPC 呼び出し変換) | 850 |
| facade.ts (契約 13 + 契約外 22 メソッド — v1.2: getCustomerRef/getDealRef/getDealRefs/relinkActivity の 07 v1.2〜v1.7 追加分を計上) | 750 |
| internal/ (dedup / intake / stage-machine / task-machine / activity / cursor / digest / notify / jst) | 650 |
| /api/jobs/crm-digest route | 80 |
| 画面: customers (一覧+詳細+フォーム+マージ) / deals (カンバン+テーブル+詳細) / tasks / ActivityTimeline 部品 / inquiries リード化 / ダッシュボード KPI | 1,100 / 1,300 / 550 / 450 / 100 / 150 |
| Server Actions (3 画面 + timeline 共用) | 450 |
| scripts/crm-intake-inquiries.ts | 250 |
| テスト (単体 9 ファイル + parity 追記 + 結合) | 約 1,900 |
| **合計** | **約 9,600 (00-overview の 7,000 に対し +37%)** |

超過理由: カンバン UI とマージ RPC/UX が overview 見積り時点より具体化したため。品質基準は落とさず、実装順で #2-3 内の会社 Sheet・テーブルビューを後続コミットに分割可能 (機能削減はしない — 時間効率と品質を交換しない規約)。

---

## 14. 非機能要件

- 一覧/タイムラインの応答: keyset + §2.2 の複合 index で 50 件ページを 100ms 級 (数千行規模では index 走査のみ)。件数想定: 顧客 〜1,000 / 案件 〜2,000 / activities 〜20,000 / tasks 〜5,000 (5 年運用) — すべて単一 Postgres で余裕
- カンバンは非終端全件を 1 クエリ (stage index) で取得。1,000 件超で劣化したら列ごと keyset に切替 (拡張余地としてコメント)
- digest worker: read-only + メール 1 通、maxDuration 60 で十分。多重起床は無害 (§7.2)
- 監視: digest 失敗 (E901/E902) は console.error → Vercel ログ。追加の監視基盤は持たない (既存方針)
- バックアップ: 既存の backups バケット運用に crm テーブルも自動包含 (pg_dump ベース — 追加作業なし)

---

## 15. リスク・将来拡張・堀さん確認

### 15.1 リスク

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | SUPABASE_SERVICE_ROLE_KEY 未投入 (00-overview C2) のまま公開フォーム取込を有効化 | intake が全滅 (問い合わせ保存は無事) | intake 内で `isServiceRoleConfigured()` 確認 → 未設定は E901 + console.error のみ (submit 成功は不変)。/admin/inquiries の手動リード化が回収経路 |
| R2 | intake の非トランザクション性 (§6.5) | 途中失敗で一時的な欠け (deal のみ等) | 全ステップ冪等 + マーカー短絡がタスク補修を含む設計。再実行 (手動リード化ボタン) で自己修復 |
| R3 | 冪等キーの 3 つ組 (type, ref_table, ref_id) と多イベント型 (task_event) の相性 | 2 個目イベントが挿入不能 | §4.3 の裁定 (created のみ ref 付き) で解消。document_event 等の他モジュール多イベント型は **07-delta v1.1 裁定 #4 (= 02-sales Δs2) で解消済み**: 実レコード ref (issued_documents/payments) + 状態遷移は合成 ref_table (`documents/`+event)。付帯要件: タイムラインの ref 逆引き (ActivityTimeline 部品) は**未知の ref_table 値を安全に無視** (リンクなし表示に degrade) すること — #2-3 受入条件 |
| R4 | マージが他モジュール FK (calls.customer_id) を触らない | 通話一覧に archived 顧客名が残る | merged_into ポインタ + read 側解決 (§6.4)。04-telephony の表示系が getCustomer/merged 解決を通すことを申し送り |
| R5 | E608 が契約書 (07-delta) 未登録のまま実装着手 | エラーコード所有規約違反 | **解消済み** — 07-delta v1.1 (裁定 #1) + 00-overview §3.3 登録済み。残タスクは errors.ts 登録のみ (#2-1 受入条件、§9) |
| R6 | spam 事後判定と CRM の非同期 (§7.3 注 — v1.1) | admin が後から spam 判定した問い合わせ由来の lead/deal/task が名簿・板に残る | honeypot / 送信最小時間 / rate limit が前段で大半を遮断 (spam が contact_inquiries に保存される事例は稀)。残存分は手動クリーンアップ (失注「スパム」+ 顧客アーカイブ + タスク取消 — §7.3 注)。件数が問題化したら inquiry の spam 更新 Action からの app 層合成 (findDealByInquiry → markDealLost + archive) を契約外拡張として追加 (Phase 2 候補) |

### 15.2 将来拡張 (契約に予約済み/構造上あと付け可能)

- 'email' activity (J7 Phase 2): DB check・Zod enum 登録済み。appendActivity の拒否分岐を外し、レンダラを足すだけ
- 複数パイプライン: deals.pipeline の check 拡張 + `DEAL_STAGE_REGISTRY` のパイプライン別 map 化 + カンバンのパイプライン切替タブ
- staff: §3.6
- リマインダー個別通知: tasks に remind_at を足し digest worker を毎時化 (pg_cron 変更のみ)

### 15.3 堀さん確認 (crm 分)

1. ダイジェストメールの宛先 — settings 'notifications'.inquiry_to の共用でよいか (専用宛先が必要なら settings キー追加は不要で notifications 拡張を 07-delta 改訂)
2. 既存 contact_inquiries の一括取込 (§12.1) を実行するか (任意。実行しない場合も新規分は自動取込される)
3. カンバンの列構成 — 9 ステージ案 (§4.2) の名称が現場感覚に合うか (label は registry 変更のみで差し替え可)

---

## 16. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 |
|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §3 (4 列テーブル + RPC + API/Action + staff 差分。RLS 全文 = §2.2) |
| ② テスト戦略表 (単体+結合) | §11 (レイヤ表 + ファイル別ケース列挙 + Issue 対応 — ペア 2 連続 PASS 粒度) |
| ③ エラーコード表 | §9 (E601〜E608 + recovery 文言。採番 canonical は 00-overview §3.3) |
| ④ ライフサイクル | §4 (customer/deal/task/activity の 4 本 + モジュール間整合) |
| ⑤ 全データパターン列挙 | §2.7 (P1〜P17) |
| ⑥ 印刷出力仕様 | §0.7 — **該当なし + 理由明記** (帳票印刷は 02-sales 所有) |
| ⑦ 移行受入基準 | §12 (併存裁定 + snapshot/rollback スクリプト + C1〜C10) |
| ⑧ 規模見積り | §13 (内訳 + overview 総表との差異説明) |
| ⑨ 状態意味論 | §4 (ASCII 図 + 意味論表 + 不変条件 + 遷移ガード純関数) |
| ⑩ 差分表示仕様 | §10 — **該当なし + 理由明記** |
| モジュール契約 (全プロジェクト規約) | §1 / §5.1 / §6.1 (契約書 v2.8 §4.10・§D8 を参照のみ — 再定義なし)。E608 は 07-delta v1.1 で承認済み (§9) |
| 値契約 (Zod canonical) | §5 (canonical 参照表 + 契約外拡張の完全 TS + ビュー型 + 型の流れ) |
| 非機能要件 | §14 |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.2 | 2026-07-11 | **07-contracts-delta v1.2〜v1.7 への追随** (final-check V14〜V16)。**§6.1**: 契約メソッド表に `getCustomerRef` / `getDealRef` (07 v1.2 昇格 — 最小射影・merged 終端解決込み) と `getDealRefs` (07 v1.7 batch — 不在 id 除外・空配列 ok([])・N+1 回避) を追記、`relinkActivity` (07 v1.6) を追記。**§6.7 新設**: relinkActivity の実装意味論 — 全置換手順 (parse → 存在確認 → merged 終端解決 → service 実行の DELETE + 冪等 INSERT) / RLS の「note のみ DELETE」は直接操作の制約のままとし RLS を widen しない設計判断 / 監査 'system' activity (code:'activity.relinked'、ref_id=null で毎回記録) / 非トランザクションの縮退根拠。**§3.2/§4.4**: activity_links の認可行と不変性規約に relinkActivity 経路を明記 (不変性の対象は activities 行であり、リンクの訂正は facade 経由で許す)。**§11.3**: relinkActivity 結合テスト行を追加。**§13**: facade 行を契約 13 メソッドに更新 (+50 行)。**§1.2**: 「ai-providers は契約書 §2 に将来枠として記載済み」の stale 記述を是正 (07 §D2 v1.2 で辺自体が削除済み — 将来枠の記載は存在しない) |
| v1.1 | 2026-07-11 | レビュー反映 (BLOCKER 3 / MAJOR 9 / MINOR 系多数)。**§2.2**: 冪等 index を非部分一意化 (PostgREST の on_conflict は index_predicate を表現できず部分一意では全 INSERT が 42P10 — 設計原則として明文化)・deals 終端ステージ不変の BEFORE UPDATE トリガ追加・crm_merge_customers の CAS NULL ガード + 勝者 lifecycle 再評価。**§0.1/§6.3/§6.5**: intake 複数一致は既存採用をやめ新規 lead + ambiguous マーカーに変更 (家族共用メールの履歴混入防止)・dedup 母集団を全顧客に拡大しマージ敗者行の終端解決を到達可能に是正・archived 単一一致は lead 復帰。**§6.5/§6.6**: マーカー短絡を補修モード化 (links/simulator_estimate/タスクの backfill)・appendActivity は created:false でも links を必ず補完・price_note v1 null 固定。**§6.1**: matchCustomerByPhone 検索母集団是正・updateDealStage の (lost,lost) noop 明確化・createDeal の company_id 自動補完・createTask title 安定性の前提条件。**§6.2/§7.3**: updateDeal が新 updated_at を返す (ステージ提案連鎖のレース解消)・受注合成 (ordered→ブロック原案) の接続点 #6 追記・D6 整合と spam 事後判定の運用注記。**§4.1/§4.2/§5.2**: 既定フィルタ 'active' 化・won 昇格の冪等条件化・9×9 マトリクス期待値確定・誤失注の回復運用ガイド・INQUIRY_TYPE_LABEL を notify.ts と統一。**§8.6/§8.7**: KPI カード「今月の期待値」→「見込み合計 (加重)」改名・リード化済み判定をマーカー併用 2 段に是正。**§12**: done 行 = deal なし取込の明文化・rollback-seed.ts ENTITY_TABLE 拡張 + fail-fast 化 + FK 削除順序を受入条件化 (C7 に count 検証追加)。**§15**: R6 (spam 非同期) 追加。**§1.2**: crm→settings read 依存を明記。版行を 07-delta v1.1 準拠に是正。§11 テストケースを各是正に追随 |
| v1.0 | 2026-07-11 | 初版。00-overview v1.0 / 07-contracts-delta v1.0 準拠。migration 0023/0024 (0025 返上)、contact_inquiries 併存裁定、マージ RPC、intake 冪等シーケンス、task_event 冪等裁定、E608 追加提案 |
