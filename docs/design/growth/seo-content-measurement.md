# トラック設計書: 計測・SEO/AEO・コンテンツ強化 (key=seo-content-measurement)

- 作成: 2026-07-18 / 設計担当: Fable
- 対象項目: #18 UTM/流入元トラッキング(高) / #127 GSC連携(高・#120統合) / #121 AEO(高) / #96 FAQ(高) / #27 広告CVイベント(中) / #117 URLリダイレクト管理(中) / #124 リンク切れ・SEOヘルスチェック(中) / #129 ブランドボイス(中) / #119 SEO推奨/監査(中)
- 参照: hubspot-gap-report-v2.md L74/L85/L180/L195-200/§5(L338-361)、docs/module-contracts.md v2.9、docs/design/crm-suite/00-overview.md §3.3
- 制約: 1人工房。担当者/ロール系は凍結。#100 メール統合 (E840-859、emails/email_attachments) と重複・矛盾しない。

---

## 0. 現状調査 (file:line 付き・実コード裏取り)

### 0.1 計測・流入元まわり

- **GA4 は実装済み**: `settings` の `zAnalyticsSettings.ga4_measurement_id` (src/modules/settings/contracts.ts:88-90)。タグ注入は `(site)/layout.tsx` のみで `meta.gaId ? <GoogleAnalytics gaId={...}/> : null` (src/app/(site)/layout.tsx:96-99、production のみ非 null)。**イベント送信 (CV 計測) は皆無** — `sendGAEvent` 等の呼び出しはリポジトリに存在しない。
- **流入元は 5 値 enum のみ**: `customers.source` / `deals.source` は `check (source in ('form','simulator','phone','manual','migration'))` (supabase/migrations/20260711000023_crm_core.sql:46, 82)。UTM・referrer・gclid を保持する列/クッキー/取得コードは無い。
- **問い合わせ受付**: `contact_inquiries` は name/email/tel/inquiry_type/item/body/status のみ (supabase/migrations/20260708000001_init_schema.sql:144-156)。入力契約 `zInquiryInput` は `.strict()` で UTM 系フィールド無し (src/modules/inquiry/contracts.ts:10-23)。受付は `InquiryFacade.submit` (src/modules/inquiry/facade.ts:23,37-50)。
- **シミュレータ発リード**: `POST /api/shop/lead` が InquiryFacade.submit → CrmFacade.intakeFromSimulator → SalesFacade.createDraftQuoteFromEstimate を app 層合成 (src/app/api/shop/lead/route.ts — 合成実体は L213-247)。crm 取込は `intakeFromInquiry` / `intakeFromSimulator` (src/modules/crm/facade.ts:145-146)。スパムガード (honeypot/rate_limits 流用) は同 route L4-12。
- **rate_limits テーブル**が公開フォーム共通で存在 (init_schema.sql:159-165)。

### 0.2 SEO/コンテンツ基盤

- **sitemap は DB 駆動で実装済み**: 静的 14 ルート + published works/notes/blog を動的追加 (src/app/sitemap.ts:16-31, 47-74)。
- **robots.ts**: `userAgent:"*"` allow "/" で /admin,/edit,/print のみ disallow (src/app/robots.ts:6-17)。AI クローラも現状ブロックしていない (明示指定は無い)。
- **JSON-LD は LocalBusiness 1 種のみ**: `buildLocalBusinessJsonLd` を (site) layout で注入 (src/app/(site)/layout.tsx:21, 82-85)。FAQPage/Service/HowTo/BreadcrumbList/sameAs は無い。
- **SEO 既定値**: `zSeoDefaults` (title_template/description/og_media_id) のみ (src/modules/settings/contracts.ts:49-58)。これが v2 レポート #119「一部(既定値設定のみ)」の実体。
- **コンテンツ型**: content モジュールは works/posts/voices を所有 (docs/module-contracts.md §1 L37)。`posts.kind` は `check (kind in ('reading','news','blog'))` (init_schema.sql:69)、契約は `zPostKind` (src/modules/content/contracts.ts:27)。**FAQ 型は存在しない**。
- **revalidate 基盤**: `POST /api/revalidate` (x-revalidate-secret、revalidateTag) が実装済み (src/app/api/revalidate/route.ts:25-50)。
- **middleware は /admin,/edit 限定 matcher** (src/middleware.ts:44-46)。公開系パスに middleware は走らない → リダイレクトは middleware 拡張ではなく別方式が必要 (§3.6)。

### 0.3 外部接続・ジョブ・AI 基盤 (流用対象)

- **Google OAuth (PKCE) の完成形**: `/api/oauth/google-calendar/start|callback` — state/code_verifier を暗号化 httpOnly cookie、scope 最小、`access_type=offline&prompt=consent` (src/app/api/oauth/google-calendar/start/route.ts:42-55)。refresh token は Vault 保管 (`calendar_connections.vault_secret_name` — supabase/migrations/20260711000030_calendar_sync.sql:18、vault RPC は 20260708000004)。**GSC はこの型をそのまま流用できる**。
- **pg_cron → net.http_post → /api/jobs/** の型: `cron.schedule('kmb-crm-digest-worker','0 22 * * *', ...)` + `net.http_post` (supabase/migrations/20260711000024_crm_digest_cron.sql:28,39)。ジョブ側は `x-jobs-secret` 検証 (route.ts:38-41) + 202 + `after()` (route.ts:43)。既存 jobs: calendar-maintenance/calendar-sync/cleanup-ai-drafts/crm-digest/publish/telephony/watchdog。
- **ブランドボイスの現状 = チャネル別 style_profiles のみ**: distribution 所有の `style_profiles` テーブル (src/modules/distribution/repository.ts:14,609-628)、`DistributionFacade.getStyleProfiles()/updateStyleProfile()` (src/modules/distribution/facade.ts:81,97-98)。生成時は app 層 (POST /api/ai/runs) が取得して `ai_runs.style_profiles` jsonb にスナップショット保存 (supabase/migrations/20260714000036_ai_run_style_profiles.sql)。同 migration の教訓: **exhaustive スキーマの列追加は進行中 run を殺す → 新列は「空 = 無効」の寛容スキーマにする**。
- **横断ブランド定義は無い**: settings の SETTINGS_SCHEMAS は company〜telephony の 11 キー (src/modules/settings/contracts.ts:160-172)。ミッション/トーン/NG ワード等のキーは無い。

### 0.4 管理画面 IA・エラーコード帯

- ナビは 6 グループ 14 項目。追加はグループ items 配下のみ可 (裁定 J14 — src/app/admin/nav-items.ts:14-16)。「①お客さんを作る」= ホームページ更新 / 発信スタジオ / SNSの接続 (nav-items.ts:52-57)。
- 「ホームページ更新」ハブは SiteSecondaryTabs 5 タブ (src/app/admin/_ui/site-secondary-tabs.tsx:17-26)。共通小物: PageHeader/UnderlineTabs/DataTable/StatusBadge/NoticePanel/Surface/MeterBar 等 (src/app/admin/_ui/)。
- エラーコード帯: crm は E601〜E611 まで割当済 (00-overview.md:408-418)、帯予約は同 :456。E840-859 は #100 メールに予約済 (使用禁止)。**新モジュールへの新帯付与は nav-badges (E0xx 新設) の前例あり** (module-contracts.md §1 L51)。
- migration 最終番号: `20260715000002_customers_billing_shipping.sql` (supabase/migrations/ 現 39 本、日付ベース)。

---

## 1. 全体アーキテクチャ方針

### 1.1 新モジュール `seo` を 1 つだけ新設

GSC 連携 (#127)・SEO 監査/ヘルス (#119/#124)・リダイレクト (#117) は同一データパイプライン/同一管理画面なので、**`seo` モジュール 1 つに集約**する (モジュール乱立させない)。

| 項目 | 所有モジュール | 理由 |
|---|---|---|
| #18 UTM | platform (値契約) + inquiry/crm (列追加) | attribution は問い合わせ/案件の属性。共有スカラーは platform/contracts.ts の前例 (zTelE164) に従う |
| #27 広告CV | app 層 (クライアントイベント) + settings (キー拡張) | DB 無し。GA4 基盤の末端拡張 |
| #96 FAQ | content | works/posts/voices と同型の CMS エンティティ |
| #127 GSC | **seo (新設)** | 外部接続 + 時系列データ所有 |
| #119 監査 / #124 ヘルス | **seo** | GSC データ + 自サイトクロールの findings を同一テーブルで管理 |
| #117 リダイレクト | **seo** | SEO 保全機能。同一管理画面 |
| #121 AEO | app 層 ((site) ページ + route handlers) | JSON-LD/llms.txt はコード。設定は settings キー 1 個 |
| #129 ブランドボイス | settings (キー)。ai-studio は settingsFacade.get を直接 read | ai-studio → settings は module-contracts §2 で**許可済みの依存**であり、実コードも既に import 済み (ai-studio/facade.ts:7, :298 の ops_limits) — 新列・新 migration 不要 (§2.8) |

### 1.2 seo モジュールの契約書登録案 (module-contracts.md §1 追記)

| モジュール | 責務 | 所有テーブル | 所有エラーコード | 公開 facade |
|---|---|---|---|---|
| `seo` | GSC 接続/検索クエリ同期・SEO 監査/ヘルスチェック・URL リダイレクト | seo_connections, gsc_query_stats, seo_findings, url_redirects | **KMB-E740〜E759 (新帯)** | SeoFacade |

- 帯採番の根拠: scheduling E739 と telephony E801 の間の未割当帯 **E740 起点**(当初案の E860-879 は並行トラック outreach が使用、E880-899 は dataio — 00-統合設計.md の全体割当で衝突解消。E840-859 の #100 予約は不変)。nav-badges の「新帯新設」前例に従い、実装前に module-contracts.md(07-contracts-delta 経由)+ 00-overview §3.3 帯予約表を先に改訂する。
- 依存方向: seo → platform/settings のみ。content/inquiry/crm へは**依存しない** (FAQ 化導線は URL プリフィルのみ、流入レポートは app 層合成 — §3.1)。

### 1.3 エラーコード割当 (KMB-E740〜E759 内)

| コード | 意味 | recovery |
|---|---|---|
| KMB-E740 | GSC 未接続 / 接続失効 (要再認可) | 管理画面から再接続 |
| KMB-E741 | GSC API 呼び出し失敗 (quota/5xx — 一時) | 次回 cron で自動リトライ。連続失敗は status='error' + last_error |
| KMB-E742 | リダイレクト入力不正 (自己参照/予約パス /admin・/api・/edit・/print/形式不正) | 入力修正 |
| KMB-E743 | リダイレクト from_path 重複 | 既存行を編集 |
| KMB-E744 | ヘルスチェック二重起動 / クロール上限超過で打ち切り | 実行中の完了待ち。上限超過は部分結果を保存済み |
| KMB-E745 | finding 状態遷移不正 (open/done/dismissed 以外への遷移等) | 入力修正 |

E746-E759 は帯内予約 (未使用)。検証エラーは既存どおり KMB-E101、未認証 E201、DB 例外 E901 を共用。

### 1.4 migration 採番 (現 39 本の末尾 20260715000002 に続く日付ベース)

| # | ファイル | 内容 |
|---|---|---|
| 1 | `20260718000001_attribution.sql` | contact_inquiries.attribution jsonb / deals.attribution jsonb (#18) |
| 2 | `20260718000002_faqs.sql` | faqs テーブル + RLS (#96) |
| 3 | `20260718000003_seo_core.sql` | seo_connections / gsc_query_stats / seo_findings / url_redirects + RLS (#127/#119/#124/#117) |
| 4 | `20260718000004_seo_cron.sql` | pg_cron 2 本 (seo-sync 日次 / seo-health 週次) |
(#129 ブランドボイスは §2.8 の設計変更により **migration 不要**になった — 当初案の `ai_runs.brand_voice` 列は廃止)

適用運用は MEMORY の方針どおり: docker 無し。本番適用後に execute_sql で検証。**注意**: 上記 20260718 系の番号は並行トラック (fulfillment 等) と衝突しうるプレースホルダ — 実採番は 00-統合設計.md の migration 全体割当表と `ls supabase/migrations` の当日最大 NN+1 に従う。

---

## 2. 項目別設計

## 2.1 #18 UTM/流入元トラッキング (高・M)

### 目的 (1人工房での効き方)
「検索・X・クラファン・紹介のどこから問い合わせが来たか」を**自動で**残す。§5 の計測第 1 段階そのもの。広告費・発信時間の配分判断が勘から実測になる。手作業ゼロ (訪問時に cookie、CV 時にサーバが自動添付)。

### スコープ / 非スコープ
- スコープ: first/last タッチの取得・保存、問い合わせ/シミュレータリードへの添付、crm 取込での deals への引き継ぎ、admin 表示 (問い合わせ詳細・案件詳細)、流入×成約の集計レポート。
- 非スコープ: ページビュー毎の DB 記録 (GA4 の仕事)、マルチタッチ配分モデル、`customers.source`/`deals.source` の 5 値 enum 変更 (**触らない** — 既存の冪等取込・帯域を壊さない。attribution は別列)、同意バナー (第一者 cookie のみ。プライバシーポリシー追記で対応)。

### 実装方式
1. **取得**: `(site)/layout.tsx` に client component `<AttributionCapture />` を 1 個追加。初回訪問時に `utm_source/medium/campaign/term/content`・`gclid`・`document.referrer`・landing_path を読み、cookie `kmb_src` (JSON `{f: Touch, l: Touch}`、maxAge 90 日、SameSite=Lax、httpOnly でない) に保存。f (first) は既存なら不変、l (last) は UTM か外部 referrer があるたび上書き。referrer のみの場合は source=referrer ホスト名、medium='referral' に正規化。パラメータ無し直帰は `('(direct)','(none)')`。
2. **添付 (サーバ側・クライアント改修不要)**: 問い合わせ server action (src/components/contact/actions.ts) と `/api/shop/lead` route が `cookies()` / `request.cookies` から `kmb_src` を読み、`zAttribution.safeParse` 成功時のみ渡す (失敗は null — 保存は成功のまま)。
3. **引き継ぎ**: `IntakeFromInquiryInput` / `IntakeFromSimulatorInput` に `attribution: Attribution | null` を追加し、intake 時に `deals.attribution` へコピー (customers には持たせない — 顧客は複数案件で流入が変わりうる)。
4. **手動取込経路の配線 (主力チャネルの欠落防止 — 必須)**: 問い合わせフォーム経路の deal は送信時ではなく**後日 admin が手動で** `intakeInquiryAction` (src/app/admin/inquiries/actions.ts:47-61) から作られ、その時点で訪問者 cookie は存在しない。入力契約に attribution を足すだけでは**問い合わせ経由の deal が永久に attribution=null** になる。必ず次の 3 点を配線する: (a) inquiry facade の読み取り (`InquiryRow` / 一覧・詳細 read) に persist 済み `contact_inquiries.attribution` を追加して admin action が拾えるようにする、(b) `IntakeInquiryActionInput` (actions.ts:38-45) に attribution を追加し、action が inquiry 行から読んだ値を `zIntakeFromInquiryInput` に載せる、(c) 受入基準にこの経路のテストを含める (下記)。

### DDL (20260718000001_attribution.sql)
```sql
alter table contact_inquiries add column attribution jsonb;  -- null = 計測前の既存行/直帰
comment on column contact_inquiries.attribution is
  'zAttribution (platform/contracts.ts)。{f,l} の first/last タッチ。null = 不明';
alter table deals add column attribution jsonb;
create index deals_attribution_source_idx on deals ((attribution->'l'->>'source'));
```
RLS 変更不要 (既存行ポリシーの列追加のみ)。

### 契約 (platform/contracts.ts に追加 — zTelE164 と同格の共有値契約)
```ts
export const zAttributionTouch = z.object({
  ts: zIsoDatetime,
  source: z.string().max(100).nullable(),     // utm_source / referrer ホスト / '(direct)'
  medium: z.string().max(50).nullable(),      // cpc/organic/referral/social/'(none)'
  campaign: z.string().max(100).nullable(),
  term: z.string().max(200).nullable(),
  content: z.string().max(100).nullable(),
  gclid: z.string().max(200).nullable(),
  referrer: z.string().max(500).nullable(),
  landing_path: z.string().max(300).nullable(),
}).strict();
export const zAttribution = z.object({
  f: zAttributionTouch.nullable(),
  l: zAttributionTouch.nullable(),
}).strict();
export type Attribution = z.infer<typeof zAttribution>;
```
facade シグネチャ変更:
```ts
// inquiry (facade.ts) — 第 2 引数追加 (省略可・後方互換)
submit(input: InquiryInput, opts?: { attribution: Attribution | null }): Promise<Result<{ id: string }>>;
// crm (contracts.ts) — 両 intake 入力に optional 追加
zIntakeFromInquiryInput = z.object({ ...既存, attribution: zAttribution.nullable().default(null) })
```
新エラーコード不要 (不正 attribution は捨てて null — 受付を落とさない)。

### 集計レポート (app 層合成 — nav-badges 型の facade 追加はしない)
- `InquiryFacade.aggregateAttribution(range)` → `{source, medium, inquiries}[]` (自テーブルのみ)
- `CrmFacade.aggregateDealAttribution(range)` → `{source, medium, deals, won, won_amount}[]` (自テーブルのみ。won_amount は deals.amount 合計)
- /admin/seo「計測」タブがこの 2 つを合成 (`/api/shop/lead` の app 層合成と同型)。§5 第 3 段階「金額ベース評価」がこの表で読める。

### 画面
- /admin/inquiries 詳細: 流入バッジ (`source / medium / campaign`、StatusBadge 流用)。
- /admin/deals 詳細: 同上。
- /admin/seo?tab=traffic: 期間フィルタ + source×medium 別の 問い合わせ数/案件数/受注数/受注金額 テーブル (DataTable)。

### 受入基準
- [ ] `?utm_source=google&utm_medium=cpc&gclid=x` で着地→トップから /contact に遷移して送信した問い合わせに f=l=google/cpc と gclid が保存される
- [ ] 2 回目訪問 (X から) で f は初回のまま、l が x/social に更新される
- [ ] cookie 無し送信でも問い合わせ保存・crm 取込が成功する (attribution=null)
- [ ] シミュレータリード (/api/shop/lead) 経由の deal に attribution が引き継がれる
- [ ] **問い合わせ→(後日の手動取込)で作った deal にも contact_inquiries.attribution が引き継がれる**(主力チャネル経路 — 実装方式 4 の配線検証)
- [ ] 壊れた cookie (不正 JSON/検証失敗) で送信しても 200 (E101 にしない)
- [ ] admin 問い合わせ詳細・案件詳細に流入元が表示される
- [ ] プライバシーポリシー (/privacy) に計測 cookie の記載を追記
- [ ] 既存の intake 冪等性 (deals_source_inquiry_uniq) が回帰しない

### テスト方針
- unit: UTM/referrer→Touch 正規化 (referrer 分類・direct 判定・上書き規則)、zAttribution 境界。
- unit: submit/intake が attribution null/不正で degrade すること (facade テストの既存モック流用)。
- 適用後: execute_sql で列存在 + 実送信 1 件の jsonb 形状確認。

## 2.2 #27 広告コンバージョンイベント (中・S — #18 が前提)

### 目的
ニッチ検索広告 (完全一致少額) を始めた瞬間から CV が Google 広告に見えている状態を先に作る。主測定点は**フォーム送信とシミュレータ見積完了** (§5: 電話 CV は補助に降格・Twilio 番号の媒体別割当てはしない)。

### スコープ / 非スコープ
- スコープ: GA4 イベント送信 (`generate_lead`=フォーム送信成功 / シミュレータリード送信成功、`sim_estimate_complete`=見積結果表示、value=見積額・currency=JPY)、Google 広告コンバージョンタグ (AW-) の任意設定。
- 非スコープ: Google Ads API でのオフライン CV アップロード (gclid は #18 で保存済み — 将来拡張の弾として明記)、媒体別電話番号、X/Meta 広告ピクセル (出稿していない)。

### 実装
- `@next/third-parties/google` の `sendGAEvent` を成功ハンドラで呼ぶ薄い util `src/app/_lib/track.ts` (gaId 無効時は no-op)。呼び出し 3 点: contact-form.tsx 成功時 / shop-simulator の見積完了時 / リード送信成功時。
- settings キー拡張 (DDL 不要 — §4.2 の前例どおりキー追加は契約変更のみ):
```ts
export const zAnalyticsSettings = z.object({
  ga4_measurement_id: z.string().regex(/^G-[A-Z0-9]{4,16}$/).nullable(),
  google_ads_conversion_id: z.string().regex(/^AW-\d{9,11}$/).nullable().default(null), // null = AW タグ注入しない。default(null) で既存行のキー欠落を補完
}).strict();
```
後方互換の方式は**設計時点で確定**する: `google_ads_conversion_id: z.string().regex(/^AW-\d{9,11}$/).nullable().default(null)` とする(上記コード例のとおり `.default(null)` を付ける)。`.strict()` は「未知キーの拒否」であり、**キー欠落は `.default()` が補完して通る**ため、キーを持たない既存 `analytics` 行の再 parse は壊れない(0036 の寛容化と同じ判断。`.catch(null)` は不正値も握り潰すため採らない)。同じ注意は §2.8 brand_voice にも適用済み。
- AW タグは (site)/layout.tsx の GoogleAnalytics 隣に `GoogleTagManager` ではなく `<Script>` 1 本 (conversion_id 非 null 時のみ)。Google 広告側は「GA4 インポート」を第一選択とし、AW 直タグは保険 (README/管理画面ヘルプに手順 3 行)。

### 受入基準
- [ ] production 相当で問い合わせ送信成功時に GA4 `generate_lead` が飛ぶ (value 無し)
- [ ] シミュレータ見積完了時に `sim_estimate_complete` (value=概算額) が飛ぶ
- [ ] シミュレータリード送信成功時に `generate_lead` (value=概算額) が飛ぶ
- [ ] gaId 無効 (非 production/未設定) では一切送信しない・エラーも出ない
- [ ] google_ads_conversion_id 設定時のみ AW スクリプトが載る (admin/edit/print には構造的に載らない)

### テスト方針
- unit: track util の no-op ガード。E2E は手動 (GA4 DebugView) — 受入チェックに手順を書く。

## 2.3 #96 ナレッジベース/FAQ (高・M)

### 目的
「対応材料は?」「梱包方法は?」「納期は?」への回答時間をゼロに近づけ (URL を返すだけ)、同時にニッチ検索/AI 検索の着地面を作る。#127 のクエリ→FAQ 化の受け皿。

### スコープ / 非スコープ
- スコープ: faqs テーブル + content facade CRUD + 公開 /faq (カテゴリ別一覧、FAQPage JSON-LD) + admin 編集 (ホームページ更新ハブ 6 番目のタブ) + sitemap 追加 + 問い合わせからの FAQ 化導線。
- 非スコープ: 全文検索、多言語、記事型ナレッジ (posts.kind='blog' が既にある)、AI 自動回答 bot、FAQ 個別ページ (/faq/[slug] は v1 では作らずアンカーリンク — 件数が育ってから検討)。

### DDL (20260718000002_faqs.sql)
```sql
create table faqs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  question text not null,
  answer text not null,                       -- markdown (zMarkdown)
  category text not null,                     -- 自由テキスト 30 字 (works.category と同運用)
  sort_order int not null default 0,
  status text not null default 'draft'
    check (status in ('draft','review','published','archived')),  -- works/posts/voices と同一 enum (init_schema:48 と 1:1)
  source_inquiry_id uuid references contact_inquiries(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: works と同型 — anon は status='published' のみ select、authenticated 全権 (0002 の既存パターンに従う)
```
content 所有テーブルに faqs を追加 (module-contracts.md §1 L37 改訂)。source_inquiry_id の跨ぎ FK は deals.source_inquiry_id (crm_core.sql:83) の前例に従う。

### 契約 (content/contracts.ts)
```ts
export const zFaqInput = z.object({
  slug: zSlug,
  question: zShortText(120),
  answer: zMarkdown,
  category: zShortText(30),
  sort_order: z.number().int().min(0).max(9999),
  source_inquiry_id: z.string().uuid().nullable(),
}).strict();
export type PublishedFaq = { id: string; slug: string; question: string; answer: string;
  category: string; sort_order: number; published_at: string };
```
ContentFacade 追加メソッド (posts と同型):
```ts
createFaq(input: FaqInput): Promise<Result<{ id: string }>>;
updateFaq(id: string, input: FaqInput): Promise<Result<void>>;
transitionFaq(id: string, t: StatusTransition): Promise<Result<void>>;  // 既存 zStatusTransition 流用
listFaqsAdmin(...): / getPublishedFaqs(): Promise<Result<PublishedFaq[]>>;
```
エラーコードは content 既存共用 (E101 検証 / E901)。新コード不要。

### 画面
- 公開 /faq: (site) 配下。カテゴリ見出し + アコーディオン (details/summary で JS 依存なし)。FAQPage JSON-LD (mainEntity=published 全件)。sitemap.ts STATIC_ROUTES に `/faq` (priority 0.8)、revalidateTag 'faqs' で公開反映 (api/revalidate 流用)。/contact と /service から「よくある質問」導線。
- admin /admin/faqs: SiteSecondaryTabs に 6 番目タブ「よくある質問」追加 (site-secondary-tabs.tsx:17 の SITE_TABS へ)。一覧 (DataTable: 質問/カテゴリ/状態/並び順) + 編集フォーム。works/posts の既存画面パターンを踏襲。
- 問い合わせ→FAQ 化: /admin/inquiries 詳細に「FAQ にする」ボタン → `/admin/faqs/new?inquiry=<id>` で question に body 要約をプリフィル + source_inquiry_id 自動設定 (リンクのみ。facade 跨ぎ呼び出し無し)。

### 初期コンテンツ
実装 Issue に seed は含めない (コンテンツは熊部さん+発信スタジオで作る)。ただし受入で「材料/梱包/納期/価格/品質/修正」の 6 カテゴリ×2 問以上を投入して公開確認する。

### 受入基準
- [ ] admin で FAQ 作成→公開→ /faq に表示、下書き/archived は非表示 (anon RLS で担保)
- [ ] /faq に FAQPage JSON-LD が published 全件で出力される (リッチリザルトテスト合格)
- [ ] sitemap に /faq が載る
- [ ] 問い合わせ詳細から FAQ 下書きが 1 クリックで作れ、source_inquiry_id が繋がる
- [ ] slug 重複は保存時にエラー表示 (unique 違反 → E901 を画面文言に変換)
- [ ] contracts-ddl-parity テストが faqs.status check と zContentStatus の一致を検証する

### テスト方針
- unit: zFaqInput 境界、facade CRUD (posts テストのパターン流用)、公開射影に answer の markdown がそのまま入ること。
- 適用後: execute_sql で RLS (anon で draft が読めない) を実測。

## 2.4 #127 Google Search Console 連携 (高・M — #120 統合)

### 目的
唯一の検索集客面の実測データ (どのクエリで表示され・どこで CTR を落としているか) を毎日自動で取り込み、「クエリ→FAQ/記事ネタ」への還流を管理画面 1 面で完結させる。

### スコープ / 非スコープ
- スコープ: OAuth 接続 (webmasters.readonly)、Search Analytics (date×query×page) の日次同期、保持 16 ヶ月、管理画面「検索の見え方」(トップ/上昇/取りこぼしクエリ)、FAQ 化・スタジオ記事化への導線。
- 非スコープ: URL 検査 API・sitemap 送信 API (手動で足りる)、GA4 Data API 取り込み (GA4 画面で見る)、Bing/その他 WMT。

### 接続 (google-calendar OAuth の型を流用)
- `/api/oauth/gsc/start|callback`: PKCE + 暗号化 state cookie (src/lib/oauth/ の既存 util をそのまま利用)。scope: `openid email https://www.googleapis.com/auth/webmasters.readonly`、`access_type=offline&prompt=consent`。
- callback で refresh token を Vault 保存 (vault RPC 20260708000004 流用)、`seo_connections` に 1 行 upsert。サイト一覧 API (`GET https://www.googleapis.com/webmasters/v3/sites`) から NEXT_PUBLIC_SITE_URL に一致する property (URL prefix / sc-domain) を自動選択、複数候補時は管理画面で選択。
- env: `GOOGLE_SEARCH_CONSOLE_CLIENT_ID/SECRET` (calendar と別 credential でも同一でも可 — env で吸収)。

### DDL (20260718000003_seo_core.sql の一部)
```sql
create table seo_connections (
  provider text primary key check (provider in ('gsc')),
  site_url text not null,                    -- 'sc-domain:...' or 'https://...'
  account_email text,
  vault_secret_name text,                    -- refresh token (calendar_connections と同方式)
  status text not null default 'connected'
    check (status in ('connected','expired','error','disconnected')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table gsc_query_stats (
  date date not null,
  query text not null,
  page text not null,
  clicks int not null default 0,
  impressions int not null default 0,
  ctr double precision not null default 0,
  position double precision not null default 0,
  primary key (date, query, page)
);
create index gsc_query_stats_query_idx on gsc_query_stats (query, date desc);
-- RLS: 両テーブルとも authenticated select / service 全権。anon 不可 (検索クエリは非公開運用データ)
```

### 同期ジョブ
- `POST /api/jobs/seo-sync` (x-jobs-secret、202+after — crm-digest と同型)。処理: 直近 28 日分 (GSC 側の確定遅延 2-3 日を考慮し endDate=today-2) を dimensions=[date,query,page]、rowLimit=25000 ページングで取得 → `(date,query,page)` upsert。500 日超の行を削除 (保持 16 ヶ月)。結果を seo_connections.last_synced_at/last_error に記録。
- cron (20260718000004): `cron.schedule('kmb-seo-sync-worker','0 19 * * *', ...)` = JST 04:00 日次。net.http_post は crm_digest_cron.sql:28 の型を流用。
- token refresh 失敗 (invalid_grant) → status='expired' + E740。API 5xx/quota → E741 で当日分スキップ (次回 cron が同レンジを再取得するため自己回復)。

### facade (seo/facade.ts)
```ts
export interface SeoFacade {
  getGscStatus(): Promise<Result<{ status: ConnStatus; site_url: string | null;
    account_email: string | null; last_synced_at: string | null; last_error: string | null }>>;
  disconnectGsc(): Promise<Result<void>>;                       // 行 status='disconnected' + Vault secret 削除
  syncGsc(): Promise<Result<{ upserted: number; deleted: number; range: [string, string] }>>; // job 専用 (service)。未接続 E740 / API失敗 E741
  listQueryStats(q: { days: 7|28|90; order: "clicks"|"impressions"; cursor?: string })
    : Promise<Result<Paged<QueryStatAgg>>>;                     // query 単位に集計した射影
  getSearchInsights(): Promise<Result<SearchInsights>>;         // §2.5 の推奨抽出と共用
}
```

### 画面 (/admin/seo — 新設。§3.7 の IA 参照)
- タブ「検索の見え方」: 接続カード (未接続時は接続ボタン / 接続済は property・最終同期・手動同期ボタン) + クエリテーブル (期間 7/28/90 日、クリック/表示/CTR/平均掲載順位、DataTable)。
- 各クエリ行のアクション: 「FAQ を作る」→ `/admin/faqs/new?q=<query>` (question プリフィル) / 「スタジオで記事化」→ `/admin/studio?text=<query 群>` (テキストソースのプリフィル — ai_sources は text 入力対応済み)。いずれも URL リンクのみで facade 跨ぎ無し。

### 受入基準
- [ ] OAuth 接続→property 自動選択→ seo_connections 1 行が connected になる
- [ ] 手動同期で gsc_query_stats に (date,query,page) 行が入り、再実行しても行数が増殖しない (upsert 冪等)
- [ ] cron 定義が migration に含まれ、x-jobs-secret 不一致は 401
- [ ] refresh token 失効時に画面へ「再接続してください」(E740) が出る
- [ ] クエリ一覧から FAQ 新規画面に質問文がプリフィルされる
- [ ] 500 日より古い行が同期時に削除される

### テスト方針
- unit: GSC API レスポンス→行変換 (fetch モック)、レンジ計算 (endDate=today-2)、E740/E741 分岐。
- 適用後: 本番接続で 1 回同期し execute_sql で行数・PK 重複なしを確認。

## 2.5 #119 SEO推奨/監査/スコアリング + #124 リンク切れ・ヘルスチェック (中・M — 同一パイプライン)

### 目的
「次に何を直せば/書けば検索が伸びるか」を毎週月曜に自動でリスト化する。1人工房なので**点数ではなく行動リスト** (finding = 1 行 = 1 アクション) に徹する。

### スコープ / 非スコープ
- スコープ: 週次ヘルスチェック (自サイトクロール: HTTP エラー・内部リンク切れ・title/description 欠落/重複/長さ)、GSC 由来の推奨 (低 CTR 高表示・順位 4-20 の惜しいクエリ・着地ページ無しクエリ=コンテンツギャップ)、findings の open/done/dismissed 管理。
- 非スコープ: Lighthouse/CWV 計測 (Vercel Analytics と Search Console で見る)、外部被リンク分析、キーワード順位トラッカー (GSC position で代替)、100 点満点スコア。

### DDL (20260718000003_seo_core.sql の一部)
```sql
create table seo_findings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'broken_internal_link',  -- #124: <a href> 内部リンクが 404/リダイレクト先消失
    'http_error',            -- #124: sitemap 記載 URL が非 200
    'missing_description',   -- #124: description 欠落
    'duplicate_title',       -- #124: title 重複
    'title_length',          -- #124: title 30 字超過等
    'low_ctr',               -- #119: 表示>=200/28d かつ CTR < 1% (閾値は定数)
    'striking_distance',     -- #119: 平均掲載順位 4〜20 のクエリ (あと一歩)
    'content_gap'            -- #119: 表示ありクエリに対応する着地ページの clicks が 0
  )),
  severity text not null check (severity in ('error','warn','info')),
  target text not null,                       -- URL または query
  detail jsonb not null default '{}'::jsonb,  -- kind 別の根拠 (リンク元 URL、数値等)
  dedup_key text not null unique,             -- kind + target の正規化キー (再検出は upsert で last_seen 更新)
  status text not null default 'open' check (status in ('open','done','dismissed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index seo_findings_status_idx on seo_findings (status, severity, last_seen_at desc);
-- RLS: authenticated select/update(status のみ) / service 全権
```

### ジョブ
- `POST /api/jobs/seo-health` (x-jobs-secret、202+after)。手順:
  1. 自サイトの sitemap.xml を fetch → URL 列挙 (上限 300。超過は E744 記録で打ち切り — 現規模は 20 未満)。
  2. 各 URL を fetch (並列 5・timeout 10s)、status/title/description/内部 `<a href>` を抽出。
  3. 内部リンクの解決先を HEAD 検査 (重複排除)。
  4. GSC 推奨: gsc_query_stats 直近 28 日を SQL 集計して low_ctr / striking_distance / content_gap を抽出 (GSC 未接続なら skip — degrade)。
  5. findings を dedup_key で upsert (既存 open は last_seen_at 更新 / 消えた finding は自動 close しない — done は人間が押す。dismissed は再検出でも復活させない)。
- cron: `cron.schedule('kmb-seo-health-worker','30 19 * * 0', ...)` = JST 月曜 04:30 週次。二重起動は pg advisory lock 相当の実行中フラグで E744。

### facade (seo/facade.ts 追加分)
```ts
runHealthCheck(): Promise<Result<{ checked: number; findings_upserted: number; skipped_gsc: boolean }>>; // job 専用
listFindings(f: { status: FindingStatus | "all"; cursor?: string }): Promise<Result<Paged<SeoFindingRow>>>;
updateFindingStatus(id: string, to: "open" | "done" | "dismissed"): Promise<Result<void>>; // 不正遷移 E745
```

### 画面
- /admin/seo タブ「改善チェック」: severity 別バッジ + finding 一覧 (DataTable)。各行に「済にする / 対象を開く / 無視」。content_gap 行には「FAQ を作る」導線 (§2.4 と同じ URL プリフィル)。手動実行ボタン (今すぐチェック)。

### 受入基準
- [ ] 週次 cron 定義が migration に含まれ、手動実行でも同一結果 (冪等 upsert)
- [ ] 意図的に壊した内部リンク 1 本が broken_internal_link (リンク元 URL 入り) で検出される
- [ ] description の無いページが missing_description で検出される
- [ ] GSC 接続済環境で low_ctr / striking_distance / content_gap が閾値どおり抽出される
- [ ] GSC 未接続でもヘルス系 finding だけで正常完了 (skipped_gsc=true)
- [ ] done にした finding は再検出で open に戻らず last_seen_at のみ更新、dismissed は一覧既定で非表示
- [ ] クロールは自ドメインのみ・上限 300 で必ず停止する

### テスト方針
- unit: HTML→title/description/リンク抽出、dedup_key 正規化、GSC 集計 SQL の閾値、E744/E745。
- 適用後: 本番 1 回実行し findings を execute_sql で確認。

## 2.6 #117 URL リダイレクト管理 (中・S)

### 目的
ページ改廃・slug 変更時に検索評価と被リンクを失わない。404 をユーザーが踏んだ時に正しい先へ 301。

### スコープ / 非スコープ
- スコープ: url_redirects CRUD、公開側での 301/302 適用、ヒット数記録、予約パス/ループ防止。
- 非スコープ: middleware 全リクエスト介入 (matcher は /admin,/edit のまま — src/middleware.ts:44-46 を触らない)、正規表現/ワイルドカードリダイレクト、works/posts slug 変更時の自動リダイレクト起票 (拡張余地としてコメントに記す。v1 は手動登録)。
- **設計限界の明示 (v1)**: catch-all は「どの既存ルートにもマッチしない」パスにしか落ちない。**改名/削除された作品・記事の旧 URL は `works/[slug]`・`blog/[slug]`・`notes/[slug]` の動的ルートにマッチして各 page の `notFound()` で終わるため、catch-all に到達せず手動登録リダイレクトも発火しない**。#117 の本命であるこれら SEO ページの slug 変更を救うには、各詳細ページの `notFound()` 直前に `resolveRedirect(currentPath)` を参照する 3 行フックが必要 — v1.1 拡張として各 page にコメントを残し、v1 の受入は「静的ルート外パスの転送」に限定する (Issue 本文に限界を明記)。

### 適用方式 (性能影響ゼロの not-found フック)
`src/app/(site)/[...missing]/page.tsx` (catch-all) を新設。既存の静的/動的ルートが常に優先されるため、**マッチしなかった URL だけ**がここに落ちる。server component で `SeoFacade.resolveRedirect(path)` を呼び、ヒットすれば `redirect()/permanentRedirect()`、無ければ `notFound()`。ヒット時は service client で hit_count/last_hit_at をベストエフォート更新 (失敗しても遷移は成功)。resolveRedirect は `unstable_cache` + tag `'seo-redirects'` (保存時に revalidateTag)。

### DDL (20260718000003_seo_core.sql の一部)
```sql
create table url_redirects (
  id uuid primary key default gen_random_uuid(),
  from_path text not null unique,   -- 正規化: 先頭 '/'、末尾スラ除去、クエリ/フラグメント禁止
  to_target text not null,          -- 内部パス ('/...') or 絶対 URL ('https://...')
  status_code int not null default 301 check (status_code in (301, 302)),
  enabled boolean not null default true,
  note text,
  hit_count bigint not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: anon select (enabled=true のみ。パスは公開情報) / authenticated 全権
```

### 契約
```ts
export const zRedirectInput = z.object({
  from_path: z.string().regex(/^\/[^?#\s]*$/).max(300),
  to_target: z.string().max(500).refine(v => v.startsWith("/") || v.startsWith("https://")),
  status_code: z.union([z.literal(301), z.literal(302)]).default(301),
  enabled: z.boolean().default(true),
  note: z.string().max(200).nullable(),
}).strict()
  .refine(v => normalize(v.from_path) !== normalize(v.to_target), "自己参照 (KMB-E742)")
  .refine(v => !RESERVED_PREFIXES.some(p => v.from_path.startsWith(p)), "予約パス (KMB-E742)");
// RESERVED_PREFIXES = ['/admin','/api','/edit','/print','/_next']
// facade: upsertRedirect (E742 検証 / E743 from_path 重複) / deleteRedirect / listRedirects / resolveRedirect
```
保存時にチェーン検知 (to_target が他行の from_path に一致したら E742 で拒否 — 2 段ループを型で防ぐ)。

### 画面
- /admin/seo タブ「リダイレクト」: 一覧 (from/to/301/ヒット数/最終ヒット) + 追加フォーム。ヒット数で「効いている転送」が見える。

### 受入基準
- [ ] 存在しないパスに登録した 301 が実際に転送される (curl -I で 308/301 系列を確認)
- [ ] 既存ページ (例 /works) はリダイレクト表を一切参照しない (catch-all に落ちない)
- [ ] /admin 系・自己参照・2 段ループは保存できない (E742/E743)
- [ ] 無効化 (enabled=false) で即 404 に戻る (revalidateTag 反映)
- [ ] ヒット数がインクリメントされ、更新失敗でも転送は成功する

### テスト方針
- unit: パス正規化・予約パス・ループ検知・zRedirectInput 境界。resolveRedirect のキャッシュキー。

## 2.7 #121 AEO (生成AI検索最適化) (高・M)

### 目的
「3Dプリント 塗装 どこに頼む」型のロングテール相談が AI 検索 (ChatGPT/Perplexity/AI Overviews) に流れている。AI が引用・推薦しやすい構造 (構造化データ・Q&A・llms.txt) を公開側に敷く。

### スコープ / 非スコープ
- スコープ: JSON-LD 拡充 (FAQPage/Service+OfferCatalog/HowTo/BreadcrumbList/sameAs)、/llms.txt 生成、robots.ts の AI クローラ明示許可、settings キー `aeo` (sameAs URL 管理)。
- 非スコープ: 外部 AEO 計測 SaaS、AI 検索での言及モニタリング (手動で足りる)、hreflang/多言語。

### 実装 (すべて app 層 — DDL 無し)
1. **JSON-LD ビルダー集約**: `src/app/_lib/structured-data.ts` を新設し既存 `buildLocalBusinessJsonLd` (src/app/(site)/layout.tsx:21) を移設・拡張:
   - LocalBusiness に `sameAs` (settings `aeo`.sameas_urls) と `knowsAbout`(3D プリント塗装/研磨等) を追加。
   - /service: `Service` (serviceType=3D プリント造形物の研磨・塗装代行, areaServed=JP 全国, provider=LocalBusiness 参照)。
   - /shop: `OfferCatalog` — pricing facade の公開グレード×サイズ価格 (page-body.tsx:151 SEC.01 で既に DB 駆動取得済みのデータを再利用) から `priceSpecification` を生成。
   - /process: `HowTo` (工程ステップ)。
   - /works/[slug], /blog/[slug], /notes/[slug]: `BreadcrumbList` (+ works は ImageObject)。
   - /faq: FAQPage (#96 で実装 — 本項目は依存として参照)。
2. **/llms.txt**: `src/app/llms.txt/route.ts` (route handler、revalidate 86400)。内容: 事業 1 段落 (settings company + seo_defaults.description + brand_voice.tagline があれば利用) / 主要ページの注釈付きリンク (service/shop/works/faq/contact) / published FAQ の Q&A ダイジェスト (上位 20 件) / 郵送受託・全国対応の明記。Markdown 形式 (llms.txt 慣行準拠)。
3. **robots.ts**: `rules` を配列化し `GPTBot / OAI-SearchBot / ClaudeBot / Claude-SearchBot / PerplexityBot / Google-Extended` を明示 allow (現状 `*` allow なので実質変化なしだが、将来 `*` を絞る時に AI 系を巻き込まない構造にする — src/app/robots.ts:8-15 改修)。
4. **settings キー追加** (DDL 不要):
```ts
export const zAeoSettings = z.object({
  sameas_urls: z.array(z.string().url().max(300)).max(10),  // X/IG/note/YouTube 等の公式プロフィール
}).strict();
// SETTINGS_SCHEMAS に aeo: zAeoSettings
```
   管理 UI は /admin/settings のサイト設定タブに sameAs URL リスト入力を追加。

### 受入基準
- [ ] リッチリザルトテストで LocalBusiness(sameAs 付)/Service/FAQPage/HowTo/BreadcrumbList が全て有効
- [ ] /llms.txt が 200 で返り、公開 FAQ の増減が 1 日以内に反映される
- [ ] OfferCatalog の価格が pricing の現行価格と一致する (ハードコードしない)
- [ ] robots.txt に AI クローラの明示 allow が出力される
- [ ] JSON-LD は published コンテンツのみから生成 (draft 混入なし)
- [ ] admin から sameAs URL を追加すると全ページの LocalBusiness に反映される

### テスト方針
- unit: 各ビルダーの schema.org 形状 (型スナップショット)、llms.txt の生成 (facade モック)。
- 手動: リッチリザルトテスト URL を受入チェックに記載。

## 2.8 #129 ブランドボイス/ブランドキット (中・S)

### 目的
チャネル別 style_profiles (トーン断片) の上位に**横断ブランド定義** (ミッション/トーン/NG ワード/推奨表記) を 1 箇所定義し、発信スタジオの全チャネル生成・FAQ 文面・llms.txt に注入する。「隈部塗装らしさ」が生成のたびにブレない。

### スコープ / 非スコープ
- スコープ: settings キー `brand_voice`、drafting プロンプトへの反映 (ai-studio が settingsFacade を直接 read)、llms.txt への反映、admin 編集フォーム。
- 非スコープ: ロゴ/カラーパレット管理 (branding.favicon_media_id と sales branding-assets が既にある — 重複させない)、チャネル別 style_profiles の置換 (併存: brand_voice=全チャネル共通の上位層、style_profiles=チャネル固有の下位層)。

### 契約 (settings/contracts.ts — DDL 不要)
```ts
export const zBrandVoiceSettings = z.object({
  tagline: z.string().max(60).nullable(),        // 例: 3Dプリントの造形を、作品に仕上げる
  mission: z.string().max(300).nullable(),
  tone: z.string().max(500).nullable(),          // 例: 丁寧・実直・誇張しない・専門用語は言い換える
  audience: z.string().max(300).nullable(),      // 造形作家/ガレキ塗装依頼者/BtoB 試作担当
  ng_words: z.array(zShortText(30)).max(50),     // 例: 「激安」「日本一」
  preferred_terms: z.array(z.object({ from: zShortText(30), to: zShortText(30) }).strict()).max(50),
}).strict();
// SETTINGS_SCHEMAS に brand_voice: zBrandVoiceSettings
```

### DDL

**なし**(設計変更 — 敵対レビュー Major-1/2 反映)。

- **当初案(ai_runs.brand_voice スナップショット列)は廃止する**。理由: (a) スナップショット方式を成立させるには `ai_run_acquire_lease` RPC の RETURNS TABLE 末尾列追加・`runOneStage` の row 型・`internal/lease.ts` 型・`RUN_SELECT`(repository.ts:154)・startRun 引数追加の 5 点改修が必要で(0036 が BLOCKER 修正として通った経路)、1 つでも落とすと「列はあるが cron 生成物に brand_voice が載らない」無音 degrade になる。(b) そもそも style_profiles が app 層合成+スナップショットになったのは **ai-studio→distribution が禁止依存だったため**であり、**ai-studio→settings は module-contracts §2 で許可済み・実コードも既に `settingsFacade` を import して ops_limits を読んでいる**(facade.ts:7, :298)。禁止でない依存に snapshot 迂回は不要。
- **採用方式: drafting 実行時に settingsFacade を直接読む**。`runOneStage`(cron ワーカー経路)と `regenerateDraft` の drafting 段で `settingsFacade.get('brand_voice')` を呼び、行未作成 (E901)・parse 失敗は `{}` に degrade(寛容読み取り `zBrandVoiceSettings.partial().catch({})` 相当。`{}` = 注入なしの正常系)。
- トレードオフ: run 内の一貫性(startRun 時点の凍結)は諦める — run 途中で brand_voice を変更すると以後の生成に即反映される。1人工房では「直したら次から効く」方が運用に合う、を裁定とする。

### 配線
- drafting プロンプト (ai-studio/internal/prompts.ts): brand_voice 非空時のみ「ブランドボイス」ブロックを BRAND_SYSTEM_PROMPT の直後に注入 (tone/ng_words/preferred_terms を箇条書き化)。取得は runOneStage / regenerateDraft の両経路で同じ degrade 付き read を通す。
- llms.txt (§2.7) は tagline/mission を利用 (null なら省略)。

### 画面
- /admin/channels (SNSの接続 — R6a) の style_profiles 編集の上部に「ブランドボイス (全チャネル共通)」カード (Surface + フォーム)。settings 楽観排他 (E103) は既存 settings フォームの型を流用。

### 受入基準
- [ ] brand_voice 保存後、**cron ワーカー経路 (runOneStage) で生成された draft のプロンプトにブランドボイスブロックが入る**(手動 regenerateDraft 経路も同様 — 無音 degrade 検知のため両経路を受入に含める)
- [ ] 未設定 (行なし/'{}') でも run が最後まで成功する (進行中 run 含め回帰なし)
- [ ] drafting 生成物に ng_words が出た場合レビューで検出できるようプロンプトに禁止指示が入る (プロンプト文字列の unit 検証)
- [ ] llms.txt に tagline が反映される
- [ ] 楽観排他: 2 画面同時編集で後勝ちにならず E103 が出る
- [ ] ai_runs テーブル・lease RPC に一切変更がない (migration 0 本)

### テスト方針
- unit: zBrandVoiceSettings 境界、寛容パース ('{}'/欠落キー/settings 行なし E901 degrade)、プロンプト注入の有無分岐 (runOneStage / regenerateDraft 両経路のモック)。

---

## 3. 横断事項

### 3.1 依存方向の遵守
- seo → platform/settings のみ。inquiry/crm/content へは依存しない。流入レポート (§2.1) とクエリ→FAQ 導線 (§2.4) は app 層合成 / URL プリフィルで境界を守る。
- ai-studio → settings は module-contracts §2 が明示的に許可する既存依存 (facade.ts:7 で import 済み・:298 で ops_limits を read 中)。brand_voice もこの依存で直接読む (§2.8) — 「settings 依存を作らない」という当初記述は事実誤認だったため撤回 (style_profiles の app 層合成は ai-studio→distribution **禁止**依存が理由であり、settings には当たらない)。

### 3.2 #100 メール統合との競合回避
- 本トラックは emails/email_attachments に触れず、E840-859 を使わない (seo は E740-759。E860-879=outreach / E880-899=dataio — 00-統合設計.md)。FAQ 化導線は将来 #100 の受信メールからも同じ URL プリフィルで繋げられる (依存は作らない)。

### 3.3 ディレクトリ計画
```
src/modules/seo/{contracts.ts, facade.ts, repository.ts, internal/{gsc-client.ts, health-crawler.ts, insights.ts}}
src/app/api/oauth/gsc/{start,callback}/route.ts
src/app/api/jobs/{seo-sync, seo-health}/route.ts
src/app/(site)/[...missing]/page.tsx
src/app/(site)/faq/{page.tsx, page-body.tsx}
src/app/llms.txt/route.ts
src/app/_lib/{structured-data.ts, track.ts}
src/app/admin/seo/{page.tsx, ...タブ実装}
src/app/admin/faqs/{page.tsx, new/, [id]/}
```

### 3.4 admin IA (裁定 J14 準拠)
- nav-items.ts「①お客さんを作る」items に `{ href: "/admin/seo", label: "検索とアクセス" }` を追加 (グループ内追加のみ — フラット追加禁止規約に適合)。
- /admin/seo は UnderlineTabs 4 タブ: 検索の見え方 (#127) / 改善チェック (#119/#124) / リダイレクト (#117) / 計測 (#18/#27)。
- /admin/faqs は「ホームページ更新」ハブの 6 番目タブ (SITE_TABS 追加)。
- ブランドボイスは /admin/channels 内 (#129)。sameAs は /admin/settings 内 (#121)。

### 3.5 nav-badges
- 追加しない。SEO findings は週次バッチ性の情報で「未対応件数を毎画面で誇示する」性質ではない (1人工房の認知負荷を増やさない)。

### 3.6 使用エラーコードまとめ
- 新設: KMB-E740〜E745 (seo)。既存共用: E101/E103/E201/E901/E902。content/inquiry/crm/settings への新規コード追加は無し。

---

## 4. Issue 分割案 (1 Issue = 1 PR)

| # | タイトル案 | 含む項目 | 依存 | 規模 |
|---|---|---|---|---|
| A | feat(growth): UTM/流入元トラッキング — attribution 取得・保存・crm 引き継ぎ・流入×成約レポート | #18 | なし | M |
| B | feat(growth): CV イベント送信 (GA4 generate_lead / シミュレータ完了) + Google 広告タグ設定 | #27 | A | S |
| C | feat(growth): FAQ/ナレッジベース — faqs テーブル・/faq 公開ページ (FAQPage JSON-LD)・admin タブ・問い合わせ FAQ 化 | #96 | なし | M |
| D | feat(growth): seo モジュール新設 + GSC 連携 — OAuth/日次同期/検索の見え方画面/FAQ 化導線 (module-contracts.md v2.10 改訂含む) | #127 (+E740 帯登録) | C (FAQ 化導線は soft — 未マージでもリンク先 404 になるだけ) | M |
| E | feat(growth): SEO 監査・ヘルスチェック — seo_findings/週次クロール/GSC 推奨/改善チェック画面 | #119 + #124 | D | M |
| F | feat(growth): URL リダイレクト管理 — url_redirects/catch-all 適用/admin タブ | #117 | D (seo モジュール骨格) | S |
| G | feat(growth): AEO — JSON-LD 拡充 (Service/OfferCatalog/HowTo/Breadcrumb/sameAs)・llms.txt・robots AI クローラ | #121 | C (FAQPage/llms.txt の FAQ 部) | M |
| H | feat(growth): ブランドボイス — settings キー・drafting での settingsFacade 直接 read・admin フォーム (migration なし) | #129 | なし (G の llms.txt 反映は G 側が吸収) | S |

- 実行順の推奨: **Wave 1**: A, C, H (相互独立・並列可) → **Wave 2**: B, D, G → **Wave 3**: E, F (F は D 直後なら Wave 2 末尾でも可)。
- migration 対応: A=20260718000001 / C=20260718000002 / D=20260718000003(の seo_connections+gsc_query_stats)+20260718000004(sync cron) / E=同 000003 の seo_findings+000004 の health cron / F=同 000003 の url_redirects / H=**migration なし**。**D/E/F が 000003 を分割コミットしないよう、000003 は D の PR で 4 テーブル全部を先行作成し、E/F はコード実装のみとする** (migration の後方分割は採番衝突の地雷になるため)。000004 の cron 2 本も D で先行作成してよい (ジョブ URL が 404 の間は net.http_post が失敗ログを残すだけで無害だが、気になる場合は E で schedule を有効化する 2 段構えを実装 Issue 内で判断)。
- 各 Issue には本書の該当節 (§2.x) と現状調査 (§0) の file:line を転記し、別スレッド/別 LLM でも実装可能な自己完結記述とする (MEMORY: 設計完了後の起票は承認不要・詳細度要件)。
