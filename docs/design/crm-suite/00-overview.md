# 隈部塗装 CRM スイート 全体アーキテクチャ設計書 (00-overview)

- 版: v1.2 (2026-07-11: 各モジュール書 v1.1 確定後の波及追随 — 角印 branding-assets 化 (07 §D5 v1.2)・sales 補助 3 テーブル・依存図 D2 v1.2 統一・§4.3 linking 順序・E821 一本化・/print 実消費ワンタイム・Phase 4 見積り改訂ほか。詳細は更新履歴)
- 旧版: v1.1 (2026-07-11: レビュー指摘反映 — site_settings 機微キーの anon 遮断 (0021)、/api/shop/lead の service 実行文脈明記、telephony worker 時間予算、deal ステージ遷移図の是正ほか) / v1.0 (2026-07-11: 初版 — 設計裁定 J1〜J12 準拠)
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **CRM スイート (crm / sales / scheduling / telephony / settings 拡張 / pricing 拡張) の全体設計の正**。モジュール個別の詳細は 01〜06 の各設計書が正。モジュール契約の追加差分は [07-contracts-delta.md](./07-contracts-delta.md) に集約し、統合時に docs/module-contracts.md v2.8 として 1 回適用する (並列衝突防止、裁定 J10)。
- 姉妹文書 (canonical 分担):
  - [docs/module-contracts.md](../../module-contracts.md) (v2.7 → v2.8) — モジュール境界・値契約 (Zod)・facade・イベント・依存方向・エラーコード所有・テーブル所有・結合シーケンスの正
  - [docs/design/cms-ai-pipeline.md](../cms-ai-pipeline.md) — 既存基盤 (CMS + AI パイプライン) の DDL・認可・状態の正
  - 本書 §3 — **M0 共通基盤 (migration 0021/0022・ExecutionContext・activities ハブ契約・エラーコード割当・共通 Zod スカラー) の canonical**
  - 01-crm.md / 02-sales.md / 03-scheduling.md / 04-telephony.md / 05-site-settings.md / 06-simulator.md — 各モジュールの DDL・画面・状態機械の正
- 入力資料: 設計ブリーフ (canonical 要求仕様)・設計裁定書 J1〜J12 (拘束条件)・調査 15 ファイル (repo-map / db-schema / design-conventions / ai-pipeline / simulator-archaeology / site-meta / admin-ui-auth / integrations / ext-twilio / ext-calendar / ext-hubspot-invoice / gap-prod-shop / gap-pdf / gap-prod-db / gapcheck)
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提: migration 0001〜0020 適用済み・本番 = migrations どおり (gap-prod-db 2026-07-11 確定)。新規 migration は **0021 から**

---

## 0. 業務シナリオ

塗装職人 (熊部さん) の一日を、受注前 → 受注・製作 → 納品・請求 → リピート の 4 部で描く。IT 用語は使わない。

### 0.1 受注前 — 「気づいたらお客さんが並んでいる」

ある晩、模型好きの会社員がスマホで隈部塗装の SHOP ページを開く。グレード・サイズ・個数を選ぶと、その場で概算が出る。「この内容で問い合わせる」を押して名前と連絡先を添えるだけで相談が届く。翌朝、熊部さんが管理画面を開くと「新しい相談」が 1 件。誰が・何を・いくらぐらいの話かが整理され、**見積書の下書きまで用意されている**。日中、現場作業中に電話が鳴る。手が離せなくても大丈夫 — 留守番電話が用件を預かり、昼休みに画面を見ると、通話の録音と「何を頼みたいのか」の要約、「折り返して寸法を確認する」というやることメモが自動で追加されている。発信番号から以前のお客さんだと分かれば、その人のページの履歴に並ぶ。

### 0.2 受注〜製作 — 「段取りが先に並ぶ」

見積書はボタンひとつで正式な書類になり、お客さんに送れる。承諾が来たら「受注」に切り替える。すると、その案件の中身から「研磨 3 時間・下地 2 時間・塗装 4 時間・乾燥待ち 1 日・検品 1 時間」という段取りが自動で提案され、カレンダーに置ける。乾燥待ちはカレンダーの場所は取るが「手が空く時間」として扱われる。だから「**今週あと何時間受けられるか**」が常に一目で分かり、次の問い合わせに納期を即答できる。予定はいつも使っているスマホのカレンダーにも写るので、現場でも二重入力なしで確認できる。

### 0.3 納品〜請求 — 「書き直しゼロ、控えは勝手に残る」

検品が終わったら納品書を発行する。中身は見積のときの明細がそのまま引き継がれるから書き直しはない。請求書も同じ。インボイスの決まりごと (登録番号・消費税のまとめ方・端数の丸め) は様式が面倒を見る。発行した書類の控えは自動で 7 年分保管され、あとから「いつ・誰に・いくら」で探せる。入金があったら金額を記録するだけで案件は「入金済み」になり、未回収の一覧から消える。

### 0.4 リピート — 「履歴が値付けを賢くする」

数ヶ月後、同じお客さんから電話。着信した瞬間に、前回の作業内容・かかった時間・請求額までの履歴が一列に並んで見える。「前回と同じ仕上げですね。リピートなので段取り費はかかりません」と即答できる。予定時間と実際にかかった時間の差も案件ごとに残っているから、「この種の仕事は次から 1 時間多めに見積もる」という改善が回る。熊部さんがやるのは、塗ることと、システムが用意した下書きに「よし」と言うことだけ。

### 0.5 スコープ外 (本スイート v1 で扱わないもの)

| 項目 | 理由・扱い |
|---|---|
| メール連携 (BCC ログ / 受信取り込み) | 裁定 J7。activity_type `'email'` を Phase 2 契約として予約のみ |
| リアルタイム AI 電話応対 (Media Streams / ConversationRelay) | WebSocket 常駐が必要で Vercel 不可 (ext-twilio §5.3)。Phase 2 として契約のみ予約 (J3) |
| クリックトゥコール発信 | 発信 2 レグ $0.185×2/min とコスト支配的 (ext-twilio §6)。v1 は着信のみ。`calls.direction='outbound'` を契約に予約 |
| 複数スタッフ・権限分離 (staff role) | 裁定 J1。認可マトリクスに「将来: staff」列を置き、各書の拡張章に差分を記載するのみ |
| EC カード決済 | 既存どおり銀行振込前払い (現行 /shop の表記を維持) |
| 多言語対応 | 対象外 |

### 0.6 印刷出力

**該当あり (本プロジェクト初の実装)**。見積書・受注書 (注文請書)・納品書・請求書の PDF 出力。方式は **方式 A で確定** (gap-pdf 2026-07-11 / 裁定 J5): 既存スクショ基盤 (`src/lib/screenshot/capture.ts` の launch 部) を流用した puppeteer-core + @sparticuz/chromium 147 の `page.pdf()`。Chromium 147 は CSS page margin boxes 対応済みのため headerTemplate 不使用・純 CSS でヘッダ/フッタ/ページ番号/改ページを書く。日本語はサイトの next/font (NotoSansJP webfont) がそのまま効きフォント配置作業ゼロ。印刷専用内部ルート `/print/documents/[id]` (モーション CSS なし・署名付きワンタイムトークン認証 — TTL 5 分、print_tokens 実消費で 1 回限り (v1.2 — 02-sales §7.3 v1.1)。§5.3) + `document.fonts.ready` 待ち + /tmp クリーンアップ + 同時実行 1。**帳票様式・レイアウト・電帳法保存の詳細仕様は 02-sales.md §印刷出力が正** (margin boxes + `counter(pages)` の 2 ページ超スモークテストをテスト戦略に含めること)。

---

## 1. ゴール像と全体アーキテクチャ

> 工数管理や販売管理機能を持った、ゴリゴリ AI で武装した HubSpot。どんな人でも簡単に使え、本業 (塗装) に集中でき、気づいたらお客さんが並んでいる状態を作り出すシステム。(発注者の言葉)

```
┌────────────────────────────── Vercel (hnd1) ───────────────────────────────┐
│ Next.js 15 App Router                                                        │
│ ├─ 公開サイト (site)      … /shop シミュレーター (修理+リード接続) / GA タグ │
│ ├─ /admin/**              … 顧客/案件/やること/帳票/カレンダー/通話 (+既存12)│
│ ├─ /print/documents/[id]  … 帳票印刷専用ルート (署名トークン、Chromium が開く)│
│ └─ Route Handlers                                                            │
│    ├─ /api/shop/lead                  … シミュレーター→リード (anon+rate limit)│
│    ├─ /api/telephony/{voice,status,recording-status} … Twilio webhook (署名) │
│    ├─ /api/oauth/{google-calendar,ms-calendar}/*     … カレンダー OAuth      │
│    └─ /api/jobs/{telephony,calendar-sync,calendar-maintenance,crm-digest}    │
│                                        … pg_cron 起床 worker (202+after())   │
└──────────────┬──────────────────────────────────────────┬───────────────────┘
               │                                          │
        ┌──────▼──────────────  Supabase  ────────────────▼──────┐
        │ Postgres (RLS) … 既存 30 + 新規 20 テーブル             │
        │ pg_cron … 既存 3 + 新規 4 ジョブ (毎分/5分/日次)         │
        │ Vault   … calendar_google_oauth / calendar_microsoft_oauth│
        │ Storage … 既存 5 + issued-documents / call-audio / branding-assets │
        └───┬──────────────┬───────────────┬──────────────┬───────┘
            │              │               │              │
     ┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼─────┐ ┌──────▼───────┐
     │ Twilio      │ │ Google      │ │ Microsoft  │ │ AI providers │
     │ 050 着信/録音│ │ Calendar API│ │ Graph      │ │ (既存 router) │
     └─────────────┘ └─────────────┘ └────────────┘ └──────────────┘
```

### 1.1 設計裁定の反映一覧 (J1〜J12 → 本書の対応箇所)

| 裁定 | 内容 (要点) | 反映箇所 |
|---|---|---|
| J1 | 単一 admin 維持・4 列認可マトリクス・外部接続は事業体で 1 接続 | §5 |
| J2 | バックグラウンド AI 実行基盤は M0 で解く (最重要) | §3.1 |
| J3 | Twilio 050・録音→事後転写型 (Phase 1) | §4.3 / 04-telephony.md |
| J4 | カレンダー polling 主軸・アプリ専用カレンダー方式 | §4.5 / 03-scheduling.md |
| J5 | 帳票スナップショット派生 + インボイス両対応 + 方式 A PDF + 電帳法 append-only | §0.6 / §4.4 / 02-sales.md |
| J6 | シミュレーター「復活」= 本番修理 + CRM 接続強化 | §4.2 / §11 Phase 0 / 06-simulator.md |
| J7 | メール連携 v1 スコープ外・'email' 予約 | §0.5 / §3.2.3 |
| J8 | 工数は単一リソース・非拘束ブロック・キャパ表示 | 03-scheduling.md (§3.2 に接点) |
| J9 | エラーコード帯 E6xx/E7xx/E8xx | §3.3 (個別コードまで具体化) |
| J10 | モジュール構成 (新規 4 + 既存拡張 2)、contracts 差分 1 箇所集約 | §2 / 07-contracts-delta.md |
| J11 | UI 全機能 /admin 配下・非 IT 用語ナビ | §2.4 / §5.3 |
| J12 | サイト設定 (analytics キー/seo 配線/favicon media_id/og 寸法是正) | 05-site-settings.md |

### 1.2 技術選定の根拠 (新規分)

| 項目 | 選定 | 根拠 |
|---|---|---|
| 電話 | Twilio 050 番号 ($4.75/月) + 録音→事後転写 | J3。Voice Intelligence は日本語非対応 (確定)。リアルタイムは Vercel 不可で Phase 2 |
| 文字起こし | 既存 `aiProvidersFacade.transcribe` (gpt-4o-transcribe) | 既存 router に予算ガード/usage 記録内蔵。25MB/15分 制約はセグメント分割 (KMB-E822) |
| 議事録/タスク抽出 | `generateText` + responseSchema (runStructured パターン) | ai-studio の実証済みパターン (refusal→E403 / parse失敗→E404 の 4 点セット) を踏襲 |
| カレンダー同期 | polling 主軸 (pg_cron 5 分 + syncToken/deltaLink)・アプリ専用カレンダー | J4。push は「dirty→polling が拾う」で後付け可能な契約 |
| 帳票 PDF | puppeteer-core + @sparticuz/chromium 147 `page.pdf()` (方式 A) | J5 / gap-pdf。本番稼働中の同一バイナリ流用で未知リスク最小 |
| 帳票保存 | Storage `issued-documents` (INSERT のみ) + `issued_documents` 台帳 (append-only) | J5。電帳法: 真実性 (訂正削除不可) + 検索 3 項目 (DB 列) + 7 年 |
| 定期実行 | pg_cron → pg_net → /api/jobs/* (x-jobs-secret, 202+after()) | 既存確立パターン (migration 0011/0017)。Vercel Cron 不使用 |
| 外部 OAuth | 既存 `src/lib/oauth/` (PKCE + AES-256-GCM state cookie) 流用 | X/Meta の実証済み基盤。Google/Microsoft は同型の 2 ルート構成 |
| 金額 | 帳票/売上 = **JPY 整数 (円)**、AI コスト = **µUSD 整数** | 既存規約 (混在禁止)。消費税端数は書類×税率ごと 1 回 (J5) |

---

## 2. モジュール構成の確定 (裁定 J10)

### 2.1 モジュール一覧と責務

**crm (新規)** — 顧客 (個人/法人)・会社・案件 (パイプライン/ステージ)・**活動タイムライン (全モジュール共通ハブ)**・タスク・フォーム/シミュレーター/通話からのリード取込を所有する。HubSpot の本質 (オブジェクト + アソシエーション + タイムライン) を「1 人工房が本当に使う範囲」(ext-hubspot A-12) に絞って再現する。他モジュールがタイムラインへ書く唯一の経路は `CrmFacade.appendActivity` であり、activities テーブルへの直接 INSERT は所有者 (crm repository) 以外禁止。

**sales (新規)** — 見積 → 受注 → 納品 → 請求 → 入金消込 のドキュメントフロー、書類採番、インボイス対応の税計算 (書類×税率 1 回丸め)、PDF 生成 (方式 A)、電帳法の不変保存台帳を所有する。派生時は明細を複製スナップショットし (HubSpot line item 方式)、価格マスタの変更が過去書類に波及しない。deal のステージは直接更新せず、発行/入金イベントを戻り値で返し app 層が `CrmFacade.updateDealStage` を呼ぶ。

**scheduling (新規)** — 作業種別マスタ (色コード付き)・標準工数テンプレート (grade×size → ブロックセット)・作業ブロック (拘束/非拘束)・実績入力・週次キャパシティ・Google/Microsoft カレンダー双方向同期を所有する。リソースは 1 人固定 (J8、resources テーブルは作らない)。受注明細からのブロック原案生成は、app 層が SalesFacade から明細を取得して渡す合成パターン (scheduling → sales 依存は作らない)。

**telephony (新規)** — Twilio 番号設定・着信 webhook (TwiML/営業時間分岐/留守電)・録音・通話ジョブ (lease 型ステージ機械: ダウンロード→転写→AI 解析→CRM 連携)・通話一覧/再生 UI を所有する。AI 呼び出しは全量 `aiProvidersFacade` + `ExecutionContext {mode:'service'}` 経由 (§3.1)。顧客紐づけ・タスク起票・タイムライン掲載は CrmFacade 経由。

**settings (既存拡張)** — SETTINGS_SCHEMAS に `analytics` (GA4)・`branding` (favicon)・`invoice_issuer` (適格請求書発行者情報)・`business_hours` (構造化営業時間)・`work_capacity` (週間稼働時間)・`telephony` (電話運用 — 07-contracts-delta v1.1 裁定 #7 で Δ2 採用) の 6 キーを追加する。キーの Zod canonical は 07-contracts-delta §D5。**実装フェーズは分散する** (analytics/branding = 05 設計、invoice_issuer = sales フェーズ、business_hours・telephony = telephony フェーズ、work_capacity = scheduling フェーズ) が、所有は settings のまま。**認可の注意**: `invoice_issuer` (振込先口座) と `telephony` (転送先携帯番号) は機微値を含むため、site_settings の従来前提「公開情報のみ格納・全行 anon SELECT」(db-schema §RLS 注記「秘匿値を入れる場合はこの設計を変える必要あり」) を変更する — migration 0021 で anon SELECT ポリシーを公開キーの許可リストに置換する (§3.1.2c / §5.2。07-contracts-delta §D5 注記と同一 SQL — 既定 deny のため将来キーも許可リストに載せない限り anon から読めない)。

**pricing (既存拡張)** — シミュレーター修理 (本番 fallback 焼き付きの解消、J6-(0))・SEC.01 カード価格の DB 駆動化・`zEstimateInput.quantity` max 999→1000 是正・シミュレーター結果の構造化リード接続 (公開 UI → `/api/shop/lead` route → CrmFacade/SalesFacade の app 層合成)。**新テーブル・新マスタは作らない** (既存 5 テーブル行列を流用、J6)。

### 2.2 依存方向図

```
site-public ──→ content / media / pricing / settings / inquiry (read facade のみ、既存)
             └→ /api/shop/lead (route) ──→ inquiry + crm + sales (app 層合成)
admin UI    ──→ 各モジュール facade
crm         ──→ platform / settings (notifications の read — digest 宛先)
sales       ──→ crm (appendActivity/顧客参照)
                / settings (invoice_issuer・company の read — 発行者情報) / platform
scheduling  ──→ crm (appendActivity/deal 参照) / settings (work_capacity の read) / platform
telephony   ──→ crm (顧客マッチ/タスク/appendActivity) / ai-providers (transcribe/generateText)
                / settings (business_hours・telephony の read — voice webhook 15 秒制約内の分岐) / platform
settings    ──→ platform (既存どおり)
pricing     ──→ platform (既存どおり。crm へのリード作成は route の app 層合成で実現し、
                pricing モジュール自体には crm import を追加しない — J10 の「facade 経由」を
                依存を増やさない形で満たす)
すべて      ──→ platform (認証・Result・エラー定義・ExecutionContext)
```

settings への read 依存 4 本は 07-contracts-delta §D2 (v1.1 裁定 #5/#6) と同一。いずれも `SettingsFacade.get` の read のみで、settings キーの書込 (update) は各管理画面の Server Action (app 層) に限る。**v1.2 是正 (07 §D2 v1.2 追随 — 依存図の正は D2)**: crm→ai-providers 辺 (旧「AI 補助は将来」) と sales→pricing 辺 (旧「見積原案の変換入力は app 層経由」) は削除 — 実利用のない辺は張らない。createDraftQuoteFromEstimate の入力 `SimEstimateSnapshot` は crm 所有契約 (07 §4.10) の import で足り、AI 補助は実装する時点で 07 改訂として辺を追加する。

禁止 (既存規約 + 本設計の追加):

- 循環依存一切禁止。**sales ⇄ scheduling は相互参照禁止** — 受注→ブロック生成は app 層合成 (§4.1)
- `internal/**` の跨モジュール import 禁止
- **Twilio SDK (`twilio`) の直 import は telephony/internal のみ** (ESLint 追加)
- **`googleapis` / `@microsoft/microsoft-graph-client` は import 禁止** (カレンダー API は x-api.ts 前例に倣い薄い fetch ラッパを scheduling/internal に置く。SDK 依存を追加しない)
- AI SDK 直 import 禁止 (既存)。telephony の転写/議事録も必ず aiProvidersFacade 経由
- activities テーブルへの直接クエリは crm repository のみ。他モジュールは `CrmFacade.appendActivity`

**ESLint 追記対象 (`eslint.config.mjs`)**: `MODULES` 配列 (現行 10 要素、L18-29) に `"crm", "sales", "scheduling", "telephony"` を追加し、AI SDK 制限 (L44 以降) と同型で `twilio` → telephony/internal 限定・`googleapis`/`@microsoft/microsoft-graph-client` → 全面禁止のルールを追加する。各モジュール Issue の受入基準に「MODULES 追記済み」を含める (J10)。

### 2.3 app 層合成パターン (循環回避の定石)

契約書 §2 の既存定石 (DistributionFacade → AiStudioFacade の合成) を踏襲し、以下は **Server Action / Route Handler が両 facade を呼んで値を受け渡す**:

| 合成点 | 流れ | 理由 |
|---|---|---|
| 受注確定→ブロック生成 | `SalesFacade.getDocumentLinesForBlocks()` → `SchedulingFacade.generateBlocksFromLines()` | sales ⇄ scheduling の相互依存回避 |
| シミュレーター→リード+見積原案 | `InquiryFacade.submit` → `CrmFacade.intakeFromSimulator` → `SalesFacade.createDraftQuoteFromEstimate` | pricing に crm 依存を足さない |
| 帳票イベント→案件ステージ | `SalesFacade.issueDocument/recordPayment` の戻り値 → `CrmFacade.updateDealStage` | sales から deal.stage を隠れて書かない |

### 2.4 ナビゲーション追加 (`src/app/admin/nav-items.ts`、裁定 J11)

`ADMIN_NAV_ITEMS` の「ダッシュボード」直後に以下 6 項目を挿入する (非 IT 用語):

```ts
{ href: "/admin/customers", label: "顧客" },      // crm
{ href: "/admin/deals",     label: "案件" },      // crm
{ href: "/admin/tasks",     label: "やること" },  // crm
{ href: "/admin/documents", label: "帳票" },      // sales
{ href: "/admin/calendar",  label: "カレンダー" }, // scheduling
{ href: "/admin/calls",     label: "通話" },      // telephony
```

settings 拡張は既存「サイト設定」タブ内 (新ナビなし)。simulator は公開サイト側 (ナビ変更なし)。middleware matcher は `/admin/:path*` のまま変更不要 (J11)。shadcn CLI で `dropdown-menu` / `popover` / `calendar` / `date-picker` / `command` を追加する (各モジュール Issue に明記)。

---

## 3. M0 共通基盤の詳細設計 (本書の中核・canonical)

M0 は独立モジュールではなく、**platform / ai-providers への横断変更 + 共有 DDL (migration 0021/0022) + 共有契約** の束である。本節が canonical であり、01〜06 は本節を参照する (再定義しない)。

### 3.1 バックグラウンド AI 実行基盤 (裁定 J2)

#### 3.1.1 問題 (実測済み)

`src/modules/ai-providers/internal/router.ts` の `routeGenerateText` (L307) / `routeGenerateImages` (L415) / `routeTranscribe` (L518) は冒頭で `createSupabaseServerClient()` (cookie セッション) を固定生成し、予算 RPC (`ai_budget_reserve`/`ai_budget_settle`) は `is_admin()` (= auth.uid() が profiles に存在) 非成立時に raise exception する。**service_role クライアントでも auth.uid() = null のため通らない**。よって Twilio webhook / pg_cron 文脈から AI を呼べない (ai-pipeline §10 で確定)。

#### 3.1.2 解決 = ExecutionContext (クライアント注入経路) + RPC ガード緩和

**(a) 共通型 `ExecutionContext` を platform/contracts.ts に追加** (07-contracts-delta §D4 が canonical):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * facade 実行文脈 (M0 共通基盤、00-overview §3.1)。
 * - 省略時 = { mode: "session" }: 現行どおり cookie セッション (admin ログイン) で実行。完全後方互換。
 * - { mode: "service" }: webhook / pg_cron worker からの実行。DB アクセスは service_role client。
 *   client 省略時は facade 側が createSupabaseServiceClient() を生成する (注入はテスト用途)。
 */
export type ExecutionContext =
  | { mode: "session" }
  | { mode: "service"; client?: SupabaseClient };

export const DEFAULT_EXECUTION_CONTEXT: ExecutionContext = { mode: "session" };
```

**(b) router / facade のシグネチャ変更 (後方互換)**:

```ts
// ai-providers/facade.ts — 第 2 引数追加 (省略時は現行挙動と完全一致)
generateText(req: GenerateTextReq, ctx?: ExecutionContext): Promise<Result<TextResult>>;
generateImages(req: GenerateImageReq, ctx?: ExecutionContext): Promise<Result<ImageResult>>;
transcribe(req: TranscribeReq, ctx?: ExecutionContext): Promise<Result<TranscribeResult>>;

// internal/router.ts — 同型
export async function routeGenerateText(
  req: GenerateTextReq,
  ctx: ExecutionContext = DEFAULT_EXECUTION_CONTEXT,
): Promise<Result<TextResult>>;
```

router 内部の分岐は 1 箇所のみ: `ctx.mode === "service"` のとき `sessionClient` の代わりに `ctx.client ?? createSupabaseServiceClient()` を使う (キー一覧 SELECT・usage INSERT は RLS bypass で成立、予算 RPC は (c) の緩和で成立)。**cookie 経路のコードパスは一切変更しない** (既存 64 テストファイル・845 ケース (2026-07-11 実測) 無影響が受入条件 — §14.2 A3)。既存の他メソッド (listKeys 等の管理系) は session 専用のまま。

ai-providers 以外の facade で ctx を受けるメソッドの列挙と **optional / required の別は 07-contracts-delta §D8 が正** (本書では再列挙しない)。要点のみ: `CrmFacade.appendActivity` / `createTask` / `createCustomer` / `matchCustomerByPhone` は `ctx?` (省略時 session)、`SchedulingFacade.runCalendarSync` / `runCalendarMaintenance`・`TelephonyFacade.handleInboundCall` / `advanceCallJob` 等の worker/webhook 専用メソッドは `ctx` **必須** (省略時 session の危険を排除)。また `CrmFacade.intakeFromInquiry` / `intakeFromSimulator` / `SalesFacade.createDraftQuoteFromEstimate` は **ctx を取らず常に service 実行** (anon route /api/shop/lead から呼ばれるため内部で service client を生成/注入 — D8・v1.1 裁定 #12。SUPABASE_SERVICE_ROLE_KEY 未設定時は KMB-E901 degrade で問い合わせ保存のみ成立)。

**(c) 予算 RPC の service_role 緩和 — migration 0021 (M0 所有、本節が canonical DDL)**:

```sql
-- 20260711000021_background_ai_execution.sql
-- canonical: docs/design/crm-suite/00-overview.md §3.1 (裁定 J2)
-- 本 migration が行うこと:
--   1. is_admin_or_service() ヘルパ関数の新設
--   2. ai_budget_reserve / ai_budget_settle / ai_budget_get_current_month の
--      冒頭ガードを is_admin() → is_admin_or_service() に緩和 (create or replace)
--   3. site_settings の anon SELECT ポリシーを公開キー許可リストに置換 (§2.1 / §5.2 —
--      invoice_issuer の振込先口座等が anon 公開される事故の防止)
-- 本 migration が行わないこと: 関数本体のロジック変更 (0015 の現行定義を全文コピーし、
--   ガード節 1 箇所のみ置換する。ロジック差分ゼロを実装時に diff で確認すること)

create or replace function public.is_admin_or_service()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_admin() or coalesce(auth.jwt()->>'role', '') = 'service_role'
$$;

revoke all on function public.is_admin_or_service() from public, anon;
grant execute on function public.is_admin_or_service() to authenticated;

-- ai_budget_reserve / ai_budget_settle / ai_budget_get_current_month を
-- create or replace で再定義。本体は 20260710000015_ai_providers.sql の現行定義を
-- 全文コピーし、冒頭の
--     if not public.is_admin() then
--       raise exception 'permission denied: ... requires admin';
--     end if;
-- を
--     if not public.is_admin_or_service() then
--       raise exception 'permission denied: ... requires admin or service_role';
--     end if;
-- に置換する (3 関数とも)。security definer / set search_path = public /
-- revoke from public, anon + grant to authenticated は 0015 のまま維持する
-- (service_role は revoke の影響を受けない — 0020 と同じ理屈)。

-- 3. site_settings: 従来の全行 SELECT ポリシー (0002 site_settings_anon_select using(true) —
--    anon/authenticated 共用) を廃し、公開キーの許可リストに置換する (07-contracts-delta §D5 注記と
--    同一 SQL。既定 deny — 新規キーは許可リストに載せない限り anon から読めない)。非公開キー
--    (ops_limits / notifications / invoice_issuer=振込先口座 / work_capacity=非公開運用値 /
--    telephony=転送先携帯番号) は admin セッション (下の admin_select) または service client のみ読取
--    (公開側 (site)/layout は anon client で公開キーのみ読む。service_role は RLS bypass で不変 —
--    voice webhook の business_hours/telephony read・sales の invoice_issuer read は影響なし)。
--    既存 anon 読取の同時是正: inquiry/internal/notify.ts の notifications read を service client へ
--    切替する (07-delta §D5 注記 — 通知メールが静かに止まる regression の防止)
drop policy site_settings_anon_select on site_settings;

create policy site_settings_public_select on site_settings
  for select
  using (key in ('company', 'hero', 'seo_defaults', 'analytics', 'branding', 'business_hours'));

create policy site_settings_admin_select on site_settings
  for select
  using (public.is_admin());
```

lease RPC について: **既存 `ai_run_acquire_lease` / `ai_run_commit_stage` は緩和しない** (ai-studio の admin UI 駆動専用のまま)。telephony は同型の専用 RPC (`call_job_acquire_lease` / `call_job_commit_stage`) を 0019 を雛形に**複製**し、ガードに `is_admin_or_service()` を使う (§3.1.4、DDL は 04-telephony.md 所有)。「新ドメインは新テーブル + 同型 RPC 複製」は 0019 (`ai_run_commit_image_stage` 増設) の確立前例。

#### 3.1.3 汎用ジョブ駆動 — pg_cron → /api/jobs/* 新設ジョブ一覧

既存パターン (`trigger_*_worker()` security definer + Vault `cron_site_url`/`cron_jobs_secret` + 未設定時 raise notice スキップ + `net.http_post` + route 側 x-jobs-secret 検証 + 202 + `after()`) を完全踏襲する。**人間がタブを開いている必要のある advance 連打方式は不採用** (J2)。

| jobname (kmb- prefix) | 周期 | 起床先 route | maxDuration | 内容 | 登録 migration (所有) |
|---|---|---|---|---|---|
| `kmb-telephony-worker` | `* * * * *` (毎分) | POST /api/jobs/telephony | 300 | 未完了 call_jobs を lease CAS で取得しステージ前進 (DL→転写→解析→CRM 連携)。1 起床あたり最大 2 ジョブ (直列・**起床毎の経過時間ガードつき** — §3.1.4-8) | telephony 帯 (0032〜) |
| `kmb-calendar-sync-worker` | `*/5 * * * *` | POST /api/jobs/calendar-sync | 60 | 接続済み provider の増分 pull (syncToken/deltaLink) + pending_push の outbox 送出 + 自己エコー棄却 | scheduling 帯 (0029〜) |
| `kmb-calendar-maintenance-worker` | `0 19 * * *` (JST 04:00) | POST /api/jobs/calendar-maintenance | 60 | トークン健全性チェック (失効→要再連携マーク)・Graph ローリングウィンドウ切り直し・整合性検査 | scheduling 帯 |
| `kmb-crm-digest-worker` | `0 22 * * *` (JST 07:00) | POST /api/jobs/crm-digest | 60 | 期日超過タスク・有効期限接近見積・未消込請求のダイジェスト (ダッシュボード集計 + Resend 通知はベストエフォート E902)。**quote の issued→expired 遷移の実行を含む** — route が app 層合成で `salesFacade.markExpiredQuotes({mode:'service'})` を呼ぶ (02-sales §7.5。route 骨格 = crm フェーズ / 配線有効化 = sales フェーズ — 07-delta 裁定 #9) | crm 帯 (0023〜) |

route 実装規約 (全ジョブ共通、`src/app/api/jobs/publish/route.ts` と同型): `isJobsSecretConfigured()` 未設定 503 / `x-jobs-secret` 不一致 401 / 202 即応 + `after()` で本体 / エラーは KMB-E901 で console.error。worker 本体は各モジュール facade を `ExecutionContext {mode:'service'}` で呼ぶ。

#### 3.1.4 lease/ステージ機構の複製規約 (telephony ほか将来の非同期ドメイン共通)

0019 の実障害教訓をそのまま規約化する。同型 RPC を複製する場合の必須要件:

1. **`#variable_conflict use_column` を関数本体冒頭に必須** (RETURNS TABLE の OUT 列名衝突で全実行失敗する本番障害の再発防止 — 0019 CRITICAL)
2. FOR UPDATE 行ロックで CAS 直列化 (**advisory lock 禁止** — pgbouncer transaction pooling)
3. lease TTL 90 秒 + heartbeat 20 秒 (定数は複製先モジュールの internal/lease.ts に置き単体テスト)。**heartbeat の主体はステージを実行中の worker 自身**: ai_runs はブラウザの admin セッション (advance 連打側) が打つが、telephony は 202+after() の同一 HTTP リクエスト内で worker が 20 秒毎に `lease_expires_at` を service client の直接 UPDATE で延長する (04-telephony §3.2/§6.5 の実装が正)。これにより 90 秒超のステージ処理中でも次の pg_cron 起床が「期限切れ」と誤判定して同一ステージを二重実行することはない (heartbeat が途絶した = worker 死亡の場合のみ次起床が失効 lease を回収する)
4. `stage_attempts >= 3` で failed (+ 専用エラーコード)。**commit 成功時のみ `stage_attempts = 0` リセット** (CAS 不一致の no-op 経路ではリセットしない — 0019 BLOCKER)
5. commit は「成果物 UPSERT + status 前進 + lease 解放 + attempts リセット」を単一 UPDATE (CAS `where status = p_expected_status`) で原子的に。不一致は冪等 no-op
6. ガードは `is_admin_or_service()` (§3.1.2)
7. 予算 (`ai_budget_reserve`) の TTL は 10 分 — 1 ステージを 10 分以内の AI 呼び出しに収める (長い録音はステージ内でセグメント直列処理し、セグメント毎に transcribe を呼ぶ = 予約もセグメント毎)
8. **時間予算 (関数打ち切り対策)**: worker 関数の maxDuration 300 秒 (Hobby+Fluid の上限 — ext-twilio §5.2) が起床 1 回の総予算。route は経過時間を計測し、残り予算が 1 ステージの最悪想定時間を下回るときは 2 件目のジョブを処理せず次起床へ持ち越す (**持ち越しは lease 取得前に判定し stage_attempts に計上しない**)。単独で 300 秒を超え得る可変長ステージ (transcribing のセグメント直列: 30 分デュアルチャネル録音 = 最大 6 セグメント ≈ 転写 180〜360 秒) は**セグメント単位のチェックポイント** (部分 transcript の保存 + 再開カーソル。lease 保持中の直接 UPDATE — heartbeat と同型) を持ち、予算内で処理できた分を保存して次起床で途中再開する。機構の詳細は 04-telephony.md §6.5.2 所掌。これがないと長時間通話 (仕様上 ≤30 分) が 3 回試行後に恒久 failed (E806) になり、settle 済み転写コストが試行毎に再発生する

### 3.2 CRM オブジェクトモデルの中核

#### 3.2.1 ER 概観 (crm 所有 6 テーブル。DDL 全文は 01-crm.md が正)

```
companies ◄──── customers (company_id nullable)      … 個人施主は会社なし (ext-hubspot A-4)
                   ▲    ▲
                   │    └──────────── deals (customer_id, company_id nullable)
                   │                    ▲
 activities ── activity_links ──────────┘   … 顧客/会社/案件のどれにでも紐づく (排他 1 対象/行)
     ▲              (customer_id | company_id | deal_id のうち厳密に 1 つ非 NULL + FK)
     │
   tasks (deal_id / customer_id nullable, source_activity_id nullable)
```

設計原則:

- **配列 FK は使わない** (既存規約)。ポリモーフィック参照は `activity_links` の 3 本の nullable FK + `check (num_nonnulls(customer_id, company_id, deal_id) = 1)` で実 FK 整合を効かせる
- 顧客 dedup は DB unique にしない (メールを持たない高齢施主・家族共用メールが実在するため)。repository が email / tel_e164 で事前検索し、一致候補ありは `KMB-E601` + 候補返却、`force: true` で強制作成 (01-crm.md §データパターン)
- 案件パイプラインは v1 単一 (`pipeline text not null default 'default' check (pipeline in ('default'))`)。ステージ意味論 (§6.1) は crm のコード registry (`DEAL_STAGE_REGISTRY`) が probability / is_won / is_lost を持ち、DB check はステージ key 集合のみ
- 既存 `contact_inquiries` は **inquiry 所有のまま**移管しない。crm は取込時に inquiry_id を activity payload に記録して参照する (所有境界を動かさない)

#### 3.2.2 アソシエーション設計

| 関係 | 実現 | 備考 |
|---|---|---|
| customer → company | `customers.company_id` (nullable FK) | primary company 1 社のみ (HubSpot の実用部分。ラベル付き多対多はやらない — ext-hubspot A-12「捨ててよいもの」) |
| deal → customer / company | `deals.customer_id` (not null FK) / `deals.company_id` (nullable FK) | 案件は必ず顧客に紐づく |
| activity → {customer, company, deal} | `activity_links` (1 行 1 対象、複数行可) | 1 つの activity を顧客と案件の両方に載せる場合は 2 行 |
| task → deal / customer | `tasks.deal_id` / `tasks.customer_id` (nullable FK) | タイムラインには task_event activity として載る |
| 帳票/ブロック/通話 → crm | 各所有テーブルの FK (`documents.deal_id`, `work_blocks.deal_id`, `calls.customer_id`) | DB の FK は跨モジュールで張ってよい (posts.source_run_id の前例)。**コードアクセスは facade 経由** |

#### 3.2.3 activities = 全モジュール共通タイムライン・ハブ (統合契約)

telephony の通話・sales の帳票発行・scheduling の作業実績・フォーム/シミュレーター送信が **全部 activity として一列に並ぶ**。これが本スイートの中核 UX (HubSpot のタイムラインに相当)。

**activity_type 全列挙** (DB check 制約と Zod enum を 1:1 に保つ):

| activity_type | 発生源 (書き手) | payload スキーマ | v1 |
|---|---|---|---|
| `note` | admin 手動 (crm UI) | `zNoteActivityPayload` (空 — 本文は activities.body) | ✅ |
| `call` | telephony (service) | `zCallActivityPayload` (call_id / direction / duration / has_recording / summary) | ✅ |
| `email` | — (Phase 2 予約、J7) | `zEmailActivityPayload` | 予約のみ (v1 挿入禁止) |
| `form_submission` | app 層 (contact / shop lead route) | `zFormSubmissionActivityPayload` (inquiry_id / inquiry_type / excerpt) | ✅ |
| `simulator_estimate` | app 層 (/api/shop/lead) | `zSimulatorEstimateActivityPayload` (入力+結果スナップショット、pricing 型の構造的同型) | ✅ |
| `document_event` | sales facade | `zDocumentEventActivityPayload` (document_id / doc_type / doc_no / event / total_jpy / version) | ✅ |
| `work_log` | scheduling facade | `zWorkLogActivityPayload` (work_block_id / 種別 / 予定h / 実績h / 実施日) | ✅ |
| `task_event` | crm facade (タスク作成/完了時に自動) | `zTaskEventActivityPayload` (task_id / event / origin) | ✅ |
| `system` | crm facade (取込・マージ等の内部イベント) | `zSystemActivityPayload` (code / detail) | ✅ |

**payload の Zod 方針**: `ACTIVITY_PAYLOAD_SCHEMAS` (discriminated map、SETTINGS_SCHEMAS と同型) を crm/contracts.ts に置く。全 payload は `.strict()`。読み書き両方で `ACTIVITY_PAYLOAD_SCHEMAS[activity_type].parse()` を通す (二段階 parse — 契約書 §4.7 zEditDraftReq の前例)。完全な Zod 定義は 07-contracts-delta §D7 が canonical。

**書き込み契約 (`CrmFacade.appendActivity`)** — 全モジュールが従う統合契約:

1. 他モジュールから activities への書き込みは `appendActivity(input, ctx?)` のみ (直接 INSERT 禁止。強制は ESLint (activities への跨モジュールクエリ制限) + コードレビュー — **RLS はロール/行しか判定できず「facade 経由か」は強制できない**。RLS の寄与は anon 遮断と note 限定 UPDATE/DELETE (§3.2.3-5) のみ)
2. **冪等**: `(activity_type, ref_table, ref_id)` の部分一意 index (ref_id 非 NULL 時)。同一 ref の再送 (webhook リトライ・worker 再実行) は既存行を返す `{ activity_id, created: false }` — エラーにしない
3. `ref_table`/`ref_id` は発生源レコードへの逆引き (ai_usage_log と同じ流儀)。call → `calls.id`、帳票 → 実レコードイベントは `issued_documents.id`/`payments.id`・実レコードを生まない状態遷移は合成 ref (`'documents/'+event`, ref_id=`documents.id` — 07-contracts-delta §7.9 v1.1 Δs2)、実績 → `work_blocks.id`、フォーム → `contact_inquiries.id`。逆引き実装は未知の ref_table 値を安全に無視 (リンクなし表示に degrade)
4. `occurred_at` は業務時刻 (通話開始時刻・発行日時)、`created_at` は記録時刻。タイムライン表示は occurred_at 降順 + keyset
5. 編集/削除は `activity_type='note'` のみ (RLS `activities_admin_update ... with check (is_admin() and activity_type='note')` — channel_posts_admin_cancel_update の前例)。システム生成 activity は不変
6. service 文脈 (telephony worker) からは `ctx: {mode:'service'}` で書く (RLS bypass だが facade を必ず通す)

### 3.3 エラーコード割当 (裁定 J9 の個別具体化・全表)

`src/modules/platform/errors.ts` (KMB_ERRORS as const map) に以下を追加登録する。実測 (2026-07-11): 既存登録 28 件、E6xx/E7xx/E8xx は完全未使用で衝突なし。**本表が採番の canonical** — 各モジュール設計書はメッセージ/recovery 文言を詳細化してよいがコード追加・変更は本表 (= 契約書) の改訂が先。

| コード | 所有 | 意味 |
|---|---|---|
| KMB-E601 | crm | 顧客の重複候補あり (email/電話一致。force 指定で強制作成可) |
| KMB-E602 | crm | 案件ステージ遷移が不正 (DEAL_STAGE_REGISTRY の許可遷移外) |
| KMB-E603 | crm | アソシエーション先が存在しない (customer/company/deal) |
| KMB-E604 | crm | activity payload が activity_type の契約と不一致 |
| KMB-E605 | crm | 編集不可の activity への変更操作 (note 以外は不変) |
| KMB-E606 | crm | タスク状態遷移が不正 (cancelled は終端) |
| KMB-E607 | crm | リード取込の連絡先欠落 (email も電話も無い) |
| KMB-E608 | crm | 顧客マージ不正 (自己マージ/マージ済み対象 — 01-crm §6.4。07-contracts-delta v1.1 裁定 #1 で承認) |
| KMB-E620 | sales | 明細 0 行のまま発行しようとした |
| KMB-E621 | sales | 帳票状態遷移が不正 |
| KMB-E622 | sales | 採番失敗 (document_number_next RPC エラー) |
| KMB-E623 | sales | 派生元帳票の種別/状態が派生条件外 |
| KMB-E624 | sales | 発行済み帳票の変更禁止 (明細/金額は issued 後 immutable) |
| KMB-E625 | sales | 入金額が請求残高を超過 |
| KMB-E626 | sales | 発行者情報 (invoice_issuer) 未設定で発行不可 |
| KMB-E627 | sales | 帳票版台帳 (issued_documents) との整合エラー (版/sha256 不一致) |
| KMB-E640 | sales | PDF 生成失敗 (Chromium 起動/レンダリング) |
| KMB-E641 | sales | PDF 保存失敗 (Storage 書込・同名パス重複) |
| KMB-E642 | sales | 印刷トークン不正または期限切れ |
| KMB-E643 | sales | PDF 生成の同時実行制限中 (実行中につき再試行) |
| KMB-E701 | scheduling | ブロック時間帯が不正 (開始 ≥ 終了 / 片側のみ NULL) |
| KMB-E702 | scheduling | 作業種別/テンプレートの参照不整合 (無効化済み等) |
| KMB-E703 | scheduling | ブロック状態遷移が不正 |
| KMB-E704 | scheduling | 明細→ブロック原案生成で対応テンプレート/種別が解決不能 |
| KMB-E705 | scheduling | 実績入力の対象状態が不正 (未配置ブロックへの実績等) |
| KMB-E720 | scheduling | カレンダー未接続または接続失効 (要再連携) |
| KMB-E721 | scheduling | 外部書込の競合 (etag/changeKey 不一致 → pull 後に再 push) |
| KMB-E722 | scheduling | 同期トークン失効 (410 Gone → フル再同期が必要) |
| KMB-E723 | scheduling | 外部カレンダー API の確定エラー |
| KMB-E724 | scheduling | 外部同期の結果不明 (timeout/接続断 → 手動照合、自動再開禁止) |
| KMB-E725 | scheduling | 同期ループ安全弁発動 (ページ上限/同一トークン再来検知) |
| KMB-E801 | telephony | Twilio webhook 署名検証失敗 (X-Twilio-Signature) |
| KMB-E802 | telephony | テレフォニー設定未完了 (番号/認証情報未設定 — degrade 表示) |
| KMB-E803 | telephony | webhook ペイロード不正 |
| KMB-E804 | telephony | 対象通話が見つからない (CallSid 不明) |
| KMB-E805 | telephony | 録音の取得/保存失敗 (Twilio DL / Storage) |
| KMB-E806 | telephony | 通話ジョブの試行回数枯渇 (3 回失敗 — E402 と同型) |
| KMB-E807 | telephony | 通話ジョブの再実行対象外 (retryCallJob は failed のみ — 04-telephony Δ3。07-contracts-delta v1.1 裁定 #2 で承認) |
| KMB-E820 | telephony | 文字起こし失敗 (セグメント分割後も) |
| KMB-E821 | telephony | 議事録/タスク抽出の AI 出力不正 (refusal / max_tokens 打ち切り / JSON/Zod 不一致 — E403/E404 相当を **E821 に一本化** (v1.2 — 04-telephony §9 の canonical 追記申請を反映)) |
| KMB-E822 | telephony | 録音が処理上限 (settings telephony.max_processing_minutes、既定 30 分) 超過、または分割不能 (未知フォーマット)。25MB/15 分の per-request 制約自体はセグメント分割 (600 秒窓) で解消される — 04-telephony §6.5 |
| KMB-E823 | telephony | 顧客自動紐づけの曖昧一致 (複数候補 → 手動確認へ) |

帯の予約: crm = E601〜E619 / sales = E620〜E639 (帳票・採番)・E640〜E649 (PDF) / scheduling = E701〜E719 (ブロック・テンプレート)・E720〜E739 (外部同期) / telephony = E801〜E819 (webhook・署名)・E820〜E839 (転写・議事録)。未割当番号は各モジュール設計書が帯内で追加してよい (契約書更新が先)。**housekeeping**: E105 (レート制限) が設計書定義済み・errors.ts 未登録のまま — M0 実装 Issue で登録して解消する。

### 3.4 採番 RPC (共通設計 — migration 0022、本節が canonical DDL。テーブル所有は sales)

書類番号は `Q-2026-0001` 形式 (書類種別プレフィクス + 発行年 (JST) + 4 桁連番)。**欠番許容の単調増加** — 採番後に帳票作成が失敗しても番号は戻さない (説明可能な欠番は実務上許容 — ext-hubspot B-8)。連番は (doc_type, 年) ごとに独立。

```sql
-- 20260711000022_document_numbering.sql
-- canonical: docs/design/crm-suite/00-overview.md §3.4 (裁定 J5)
-- 所有: sales モジュール (アクセスは sales/repository と本 RPC のみ)

create table document_sequences (
  doc_type text not null check (doc_type in ('quote', 'order', 'delivery', 'invoice')),
  fiscal_year int not null check (fiscal_year between 2000 and 2999),
  last_seq int not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now(),
  primary key (doc_type, fiscal_year)
);

comment on table document_sequences is
  '書類採番カウンタ (書類種別×年)。欠番許容の単調増加。直接アクセス禁止 (RPC 専用)';

create trigger handle_updated_at before update on document_sequences
  for each row execute function extensions.moddatetime(updated_at);

-- service 専用分類: RLS 有効 + ポリシーなし + 明示 revoke (0020 の教訓 — RLS だけでは
-- default privileges の grant が残る)
alter table document_sequences enable row level security;
revoke all on document_sequences from anon, authenticated;

create or replace function public.document_number_next(p_doc_type text, p_year int)
returns table (doc_no text, seq int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_prefix text;
  v_seq int;
begin
  if not public.is_admin_or_service() then
    raise exception 'permission denied: document_number_next requires admin or service_role';
  end if;
  if p_doc_type not in ('quote', 'order', 'delivery', 'invoice') then
    raise exception 'KMB-E622: 不正な書類種別です (%)', p_doc_type;
  end if;

  v_prefix := case p_doc_type
    when 'quote' then 'Q'
    when 'order' then 'J'      -- 受注 (Juchuu)。O は 0 と紛らわしいため不採用
    when 'delivery' then 'D'
    when 'invoice' then 'I'
  end;

  insert into document_sequences (doc_type, fiscal_year)
  values (p_doc_type, p_year)
  on conflict (doc_type, fiscal_year) do nothing;

  -- FOR UPDATE 行ロックで同時採番を直列化 (advisory lock 禁止 — pgbouncer)
  update document_sequences
    set last_seq = last_seq + 1
    where doc_type = p_doc_type and fiscal_year = p_year
    returning last_seq into v_seq;

  return query select
    format('%s-%s-%s', v_prefix, p_year, lpad(v_seq::text, 4, '0')),
    v_seq;
end;
$$;

revoke all on function public.document_number_next(text, int) from public, anon;
grant execute on function public.document_number_next(text, int) to authenticated;
```

利用規約: 呼び出しは `sales/repository.ts` のみ。`p_year` は **発行日の JST 年** (呼び出し側が Asia/Tokyo で解決して渡す — DB 側で now() から導かない)。返却された doc_no を `documents.doc_no` (unique) に保存。連番 9999 超は 5 桁に自然拡張 (lpad は切り詰めない)。プレフィクス表 (Q/J/D/I) はコード定数 (`sales/contracts.ts` の `DOC_NO_PREFIX`) と本 SQL の二重定義になるため、`contracts-ddl-parity.test.ts` に一致検証を追加する。

### 3.5 共通 Zod スカラー追加分 (platform/contracts.ts へ追加)

完全定義は 07-contracts-delta §D4 が canonical。追加するもの:

| スカラー | 定義要旨 | 用途 |
|---|---|---|
| `zTelE164` | `/^\+[1-9]\d{1,14}$/` | 顧客電話・通話 from/to の保存形式。入力は `normalizeJpPhoneToE164()` (0X0… → +81) で正規化してから検証 |
| `zJpyAmount` | int, 0〜9,999,999,999 | 帳票金額 (円整数)。µUSD と混在禁止 |
| `zJpySignedAmount` | int, ±9,999,999,999 | 値引き行・調整行 |
| `zTaxCategory` | enum `["standard_10","reduced_8","zero","exempt"]` | 明細行の税区分。税率換算表 `TAX_RATE_BY_CATEGORY` を併設 |
| `zTaxRounding` | enum `["floor","round","ceil"]` | 端数処理 (書類×税率ごと 1 回)。既定 floor (J5) |
| `zInvoiceRegistrationNumber` | `/^T\d{13}$/` | 適格請求書発行事業者登録番号 |
| `zDocumentNo` | `/^[QJDI]-\d{4}-\d{4,}$/` | 書類番号 (§3.4 と 1:1) |
| `zDateOnly` | `/^\d{4}-\d{2}-\d{2}$/` | JST 日付 (発行日・入金日・実施日)。DB は date 型 |
| `ExecutionContext` | §3.1.2 | facade 実行文脈 (型のみ、Zod 不要) |

### 3.6 M0 の実装物一覧 (Phase 1 の受入対象)

1. docs/module-contracts.md v2.8 統合 (07-contracts-delta を 1 回適用)
2. migration 0021 (§3.1.2c) + 0022 (§3.4) 作成・本番適用 (手動 apply、HANDOFF §3 の運用)
3. `platform/contracts.ts` 共通スカラー + ExecutionContext 追加、`normalizeJpPhoneToE164()` (platform/text.ts)
4. ai-providers router/facade の ctx 対応 (§3.1.2b。既存テスト全 PASS + service 経路の新規単体テスト)
5. `eslint.config.mjs` MODULES 4 件追加 + SDK 制限追加 (§2.2)
6. errors.ts に §3.3 全コード + E105 登録
7. `src/modules/{crm,sales,scheduling,telephony}/` の骨格 (contracts.ts / facade.ts / repository.ts / internal/) — 中身は各フェーズ
8. nav-items.ts 6 項目追加 (リンク先は未実装でも置く — 既存運用)

---

## 4. モジュール間結合シーケンス

### 4.1 受注確定 → 作業ブロック生成 (app 層合成)

```
admin: 見積詳細画面で「受注にする」
→ Server Action (app 層):
  1. SalesFacade.deriveDocument({source: 見積id, to_type: 'order'})   … 明細複製スナップショット
  2. SalesFacade.issueDocument(受注id, expectedUpdatedAt)             … 採番 J-2026-#### + PDF 生成
     + issued_documents 台帳 append (常に実施 — 07-delta D8。PDF 省略は不可)
     → 戻り値イベント {document_id, doc_no, total_jpy}
  3. CrmFacade.updateDealStage(dealId, 'ordered', expectedUpdatedAt)  … won 扱い (§6.1)
  4. CrmFacade.appendActivity(document_event: issued)                 … タイムライン掲載 (sales facade 内で実施済みなら省略)
  5. SalesFacade.getDocumentLinesForBlocks(受注id)                    … {description, work_type_key, quantity} []
  6. SchedulingFacade.generateBlocksFromLines({deal_id, source_document_id: 受注id, lines})
                                                                      … テンプレート解決 → work_blocks (status='backlog')
     - work_type_key が解決できない行は skip + 警告返却 (KMB-E704 は全滅時のみ)
→ UI: 「作業ブロックを N 件用意しました」→ /admin/calendar へ誘導 (ドラッグ配置 or 自動提案)
[異常] 6 で全滅 → 受注は成立のまま、ブロックは手動作成に誘導 (トースト + E704)
```

### 4.2 シミュレーター → リード + 見積原案 (J6)

```
公開 /shop: シミュレーター「この内容で問い合わせる」(現行クリップボードコピー UX を置換)
→ POST /api/shop/lead (anon。Zod: zSimulatorLeadReq = 連絡先 + zSimEstimateSnapshot)
  1. InquiryFacade.submit(...)                       … 既存 rate limit + contact_inquiries 保存 + 通知メール
  2. CrmFacade.intakeFromSimulator({inquiry_id, contact, estimate})
     - 顧客 UPSERT (email/tel dedup。一致→既存顧客、なければ lifecycle='lead' で新規)
     - deal 作成 (pipeline 'default', stage 'inquiry', amount_jpy = total_max, source='simulator')
     - activity 'form_submission' + 'simulator_estimate' を appendActivity (冪等キー = inquiry_id)
  3. SalesFacade.createDraftQuoteFromEstimate({deal_id, estimate})
     - EstimateResult.breakdown → document_lines スナップショット変換 (仮単価 = 数量値引き・
       オプション適用後 total_max の税抜換算 — 解釈の正は 06-simulator §5.4 T1、具体式・文言は
       02-sales §9.1。v1.2: 旧「セル price_max」は snapshot にセル生値が無く実現不能な略記のため撤回。
       備考にレンジ明記)
     - documents (doc_type='quote', status='draft'。採番しない — 発行時に採番)
→ 200 → UI「送信しました。折り返しご連絡します」
[実行文脈] 2/3 は anon route からの呼び出しのため **ctx 引数なしで常に service 実行**
  (07-delta §D8・v1.1 裁定 #12)。customers/deals/documents は anon 書込ポリシーを持たない
  (§5.2) ため cookie セッションでは成立しない — service client が必須。
  SUPABASE_SERVICE_ROLE_KEY 未設定時は E901 degrade (1 の問い合わせ保存のみ成立)
[異常] 2/3 の失敗は 1 (問い合わせ保存) を巻き戻さない — 問い合わせは必ず残す。失敗は
  KMB-E9xx ログ + ダッシュボード警告 (admin が手動でリード化できる)
```

### 4.3 着信 → 転写 → 議事録 → タスク → タイムライン (J2/J3)

```
着信 → Twilio → POST /api/telephony/voice (15 秒制約)
  - validateRequest (X-Twilio-Signature + BASE_URL 固定文字列)。失敗 → 403 (KMB-E801)
  - calls UPSERT (call_sid unique = 冪等)
  - settings 'business_hours' を JST 判定:
      営業時間内 → <Say>録音同意ガイダンス (設定 ON 時)</Say> + <Dial record="record-from-answer-dual"
                    recordingStatusCallback=... timeout="20">転送先</Dial> (転送先未設定なら留守電へ)
      時間外    → <Say>営業時間外アナウンス</Say> + <Record maxLength=... recordingStatusCallback=.../>
→ 通話終了 → POST /api/telephony/status … calls.duration/status 更新
→ 録音完了 → POST /api/telephony/recording-status (署名検証)
  - call_recordings INSERT (recording_sid unique = 冪等。conflict → 既存行)
  - call_jobs INSERT (status='pending')。**unique (recording_id) = 1 録音 1 ジョブ** — webhook 再配信は
    conflict → 既存 job を返し二重生成しない (AI 費用の二重発生なし。04-telephony §6.4 が正)。
    202 を即返す (転写はここでやらない)
→ pg_cron 毎分 → /api/jobs/telephony → TelephonyFacade.advanceCallJob(ctx: service)
  stage 1 downloading : Twilio から録音 DL (Basic 認証) → Storage 'call-audio' 保存 → Twilio 側削除 (設定)
  stage 2 transcribing: 25MB/15 分超はセグメント分割 → aiProvidersFacade.transcribe(
                        {feature:'call-transcribe', refTable:'call_jobs', refId}, {mode:'service'})
  stage 3 analyzing   : generateText + responseSchema (zCallAnalysis) → 議事録 + タスク案
                        (refusal・max_tokens 打ち切り・parse 失敗 → いずれも KMB-E821 —
                         v1.2: 04-telephony §9 の E821 一本化に統一。旧「refusal→E403 変換」は撤回)
  stage 4 linking     : CrmFacade.matchCustomerByPhone(from) → 一致: calls.customer_id 紐づけ
                        / なし: lifecycle='lead' の顧客を新規作成 (source='phone')
                        / 複数: E601 受領 → KMB-E823 に変換して手動確認へ
                        → CrmFacade.appendActivity('call', ref=calls.id)   … 冪等 (created:false でも links 補完)
                        → CrmFacade.createTask(origin='ai_call', source_activity_id=activity_id) × 抽出タスク
                          を**常に実行** (v1.2: 07 §7.5 canonical に統一 — appendActivity 先行 (source_activity_id
                          取得に必須) → createTask は created フラグでスキップしない。冪等は
                          (source_activity_id, title) 一意が担う。旧「createTask → appendActivity」の逆順は撤回)
  → done。各 stage は lease CAS (§3.1.4)、失敗 3 回で failed (KMB-E806) + ダッシュボード警告
→ admin /admin/calls: 音声再生 (署名 URL) + 全文 + 議事録 + 起票タスク。顧客ページの
  タイムラインに 'call' activity として時系列表示
```

### 4.4 見積 → 受注 → 納品 → 請求 → 入金 の派生 (J5)

```
quote (draft) ─issue→ quote (issued, Q-2026-0001, PDF v1 保存)
   │ 承諾 (accepted)                          │ 有効期限超過 → expired (自動: crm-digest が遷移実行 — §3.1.3)
   └─derive→ order (draft, 明細複製) ─issue→ order (issued, J-2026-0001)
                └─derive→ delivery (draft, 明細複製) ─issue→ delivery (issued, D-2026-0001)
                              └─derive→ invoice (draft, 明細複製) ─issue→ invoice (issued, I-2026-0001)
                                            └─ recordPayment × N → 残高 0 で paid
派生規則:
- 派生元は「直前種別の **issued または accepted**」(quote→order は accepted を推奨・issued も可 —
  口頭承諾の実務。expired→accepted の遅れ承諾経由も含む)。小口向けに quote→invoice
  直行も許可 (E623 の許可表は 02-sales.md §状態意味論が正)
- 派生時は document_lines を複製 (スナップショット)。派生後の編集は draft の間のみ (E624)
- 消費税は書類×税率ごと 1 回丸め (明細行に税額カラムなし — DDL レベルで禁止)。丸め方式は
  settings 'invoice_issuer'.tax_rounding (既定 floor)
- issue 時: 採番 (§3.4) → /print/documents/[id] を Chromium で PDF 化 → issued-documents バケットへ
  upsert:false 保存 → issued_documents 台帳 append (doc_no/version/sha256/取引年月日/取引先/金額)
  → activity 'document_event' 追記
- 訂正 = 新版発行 (version+1、旧版は台帳の新行が supersedes で旧行を参照。台帳は append-only の
  ため「旧行を UPDATE して superseded_by を書く」形は採らない — J5 の意味論を参照方向を逆にして実現)
- 入金: payments INSERT (invoice へ FK)。Σ入金 = total で paid、超過は KMB-E625
```

### 4.5 カレンダー双方向同期 (J4、概要 — 詳細は 03-scheduling.md)

```
pg_cron 5 分 → /api/jobs/calendar-sync → SchedulingFacade.runCalendarSync({mode:'service'})
  pull: syncToken (Google) / deltaLink (Graph) で増分取得
        → calendar_event_links 照合 → 自己エコー棄却 (etag/changeKey/last_written_hash 三点セット)
        → 外部で移動: work_blocks.starts_at/ends_at 更新 + 'work_log' ではなく sync ログ
        → 外部で削除: sync_status='deleted_externally' (即削除しない — 手動確認 UI)
  push: sync_status='pending_push' のブロックをアプリ専用カレンダーへ書込
        (本人の主カレンダーは free/busy 参照のみ — 自己エコー/ループ防止が構造的に楽)
        → 応答の etag/changeKey/updated を記録
  トークン: Vault (calendar_google_oauth / calendar_microsoft_oauth) + CAS リース refresh
        (channel_accounts.token_refresh_lease_expires_at と同型の列を calendar_connections に持つ)。
        MSA の refresh token ローテーション (毎回上書き保存) 必須
  410 Gone → KMB-E722 → フル再同期。ループ安全弁 (ページ上限/同一トークン検知) → KMB-E725
```

---

## 5. 認可マトリクス (総表、裁定 J1)

### 5.1 ロール定義

| ロール | 実体 | 変更 |
|---|---|---|
| anon | 未ログイン (公開サイト) | 変更なし |
| admin | `is_admin()` = profiles に行が存在 (単一管理者) | **変更なし** — profiles.role CHECK ('admin') / is_admin() とも v1 不変 (J1) |
| service | service_role キー (RLS bypass)。worker / webhook / RPC | RPC ガードに `is_admin_or_service()` を新設 (§3.1) |
| (将来: staff) | profiles.role 拡張 + `has_role()` 系関数 | v1 では実装しない。差分は各書の拡張章 (§5.5) |

### 5.2 新テーブル認可総表 (RLS。詳細ポリシー全文は各モジュール設計書の DDL が正)

分類は既存 3 分類 (公開 / admin / service 専用) + 明示 revoke 規約 (0015/0020 パターン: admin テーブルも `revoke all from anon` + `grant to authenticated` を migration に全文明示)。

| テーブル (所有) | anon | admin | service | 将来 staff (方針) | 備考 |
|---|---|---|---|---|---|
| customers (crm) | ✗ | SELECT/INSERT/UPDATE (DELETE なし — archived で論理) | ○ | R/W | |
| companies (crm) | ✗ | SELECT/INSERT/UPDATE (DELETE なし) | ○ | R/W | |
| deals (crm) | ✗ | SELECT/INSERT/UPDATE (DELETE なし) | ○ | R/W | ステージ遷移は repository 二重検証 |
| activities (crm) | ✗ | SELECT/INSERT + **UPDATE/DELETE は type='note' のみ** | ○ (facade 経由) | R + note W | §3.2.3-5 |
| activity_links (crm) | ✗ | SELECT/INSERT/DELETE (note の付け替えのみ) | ○ | R | |
| tasks (crm) | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ (AI 起票) | R/W | |
| documents (sales) | ✗ | SELECT/INSERT/UPDATE (**DELETE は status='draft' のみ**) | ○ | R | issued 後の明細不変は trigger (E624) |
| document_lines (sales) | ✗ | SELECT/INSERT/UPDATE/DELETE (親 draft 時のみ — trigger) | ○ | R | 税額カラムなし (J5) |
| payments (sales) | ✗ | SELECT/INSERT/DELETE (訂正 = 削除 + 再入力、activity 記録) | ○ | R | |
| document_sequences (sales) | ✗ | ✗ | RPC のみ | ✗ | §3.4。ポリシーなし + revoke |
| issued_documents (sales) | ✗ | SELECT のみ | INSERT は RPC 経由のみ | R | 電帳法 append-only 台帳。UPDATE/DELETE は append-only trigger (02-sales 0027) が **service_role 含む全ロール**で拒否 — revoke/ポリシー不在は RLS bypass の service_role を拘束しないため、真実性の実強制は trigger |
| work_types / work_templates / work_template_items (scheduling) | ✗ | 全権 (参照中の削除は E702 ガード) | ○ | R/W | |
| work_blocks (scheduling) | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ (同期の時刻更新) | R/W | |
| calendar_connections (scheduling) | ✗ | SELECT/INSERT/UPDATE/DELETE | ○ (token refresh/sync state) | ✗ | トークン実体は Vault のみ |
| calendar_event_links (scheduling) | ✗ | SELECT のみ | INSERT/UPDATE/DELETE (worker) | R | |
| calls (telephony) | ✗ | SELECT + UPDATE (**customer_id / match_status / memo の 3 列のみ** — v1.2: 04-telephony §4.2 canonical に更新。手動紐づけは customer_id と match_status='manual' の同時更新が必然) | INSERT/UPDATE (webhook) | R | 列レベル grant update (04 §4.2) |
| call_recordings (telephony) | ✗ | SELECT のみ | INSERT/UPDATE/DELETE | R | 再生は署名 URL |
| call_jobs (telephony) | ✗ | SELECT + 再実行操作は RPC 経由 | INSERT/UPDATE (worker/RPC) | R | lease/commit は RPC |
| site_settings (settings — 既存 + 新規 6 キー) | 公開キーのみ SELECT (許可リスト: company/hero/seo_defaults/analytics/branding/business_hours — 0021 §3.1.2c。**invoice_issuer/telephony/work_capacity/ops_limits/notifications は ✗**) | SELECT 全行 (0021 admin_select) + INSERT/UPDATE (既存。DELETE なし) | ○ (bypass) | R | 機微キーの anon 遮断は §2.1 / 07-delta §D5 注記 |

### 5.3 API エンドポイント認可 (追加分)

| エンドポイント | Method | 認可 | 主エラー |
|---|---|---|---|
| /api/shop/lead | POST | anon + rate limit (inquiry の rate_limits 流用) + Zod | E101 / E105 / E901 (v1.2 — 06-simulator §6.1 の正に統一。E607 は取込内部で E901 ログに縮退し応答コードには出ない) |
| /api/telephony/voice, /status, /recording-status | POST | **X-Twilio-Signature** (validateRequest + BASE_URL 固定文字列。form-urlencoded 全パラメータを変形なしで検証 — ext-twilio §5.1 の落とし穴) | E801 / E803 |
| /api/jobs/telephony, /calendar-sync, /calendar-maintenance, /crm-digest | POST | x-jobs-secret (JOBS_SECRET。未設定 503) | E201/E901 |
| /api/oauth/google-calendar/{start,callback} | GET | admin セッション + PKCE + 暗号化 state cookie (X 前例と同型) | E720 |
| /api/oauth/ms-calendar/{start,callback} | GET | 同上 | E720 |
| /print/documents/[id] | GET | **署名付きワンタイムトークン** (hmac = HMAC-SHA256(`${document_id}.${exp}`, PRINT_TOKEN_SECRET)、TTL 5 分 — 式・消費手順は 02-sales §7.3 v1.1 が正。v1.2 是正: doc_no は hmac 入力に含めず **print_tokens.payload** で渡す。**実消費のワンタイム**: 発行時に print_tokens へ登録し、検証は `UPDATE ... SET consumed_at = now() WHERE consumed_at IS NULL` の 0 行判定で 1 回で失効 (旧「実効ワンタイム (TTL 内再利用可)」は撤回)。Chromium と admin プレビューのみが取得) | E642 |
| /api/documents/[id]/pdf | GET | admin (issued-documents の署名 URL を発行して返す) | E201/E202 |

middleware matcher は変更不要。`robots.ts` に `/print` の disallow を追加 (05-site-settings.md の Issue に含める)。Server Actions は全て先頭 `requireAdmin()` + Zod parse (既存規約。works/actions.ts の歴史的例外は踏襲しない)。

### 5.4 Storage / Vault / env 追加分

| 対象 | 内容 |
|---|---|
| Storage `issued-documents` (新設, private) | **ポリシーなし** (直接アップロード経路を持たないため INSERT ポリシーも作らない — v1.2: 02-sales §2.3.2 v1.1 の安全側解釈に統一) + **storage.objects 不変 trigger** (UPDATE/DELETE を service_role 含む全ロールで拒否 — 電帳法 7 年不変保存)。アップロードは service + `upsert:false` 固定。パス `documents/{document_id}/v{n}-{sha256先頭8桁}.pdf` (J5) |
| Storage `call-audio` (新設, private) | service 書込。admin 再生は署名 URL (SELECT ポリシー作らない — 公開バケット列挙の教訓 0006) |
| Storage `branding-assets` (新設, private — sales 帯 0028。v1.2) | 角印画像 (invoice_issuer.seal_storage_path — 07-delta §D5 v1.2)。ポリシーなし: 書込は admin 設定タブの Server Action (service client)、読出は PDF 生成/print が server 側で解決する署名 URL のみ |
| Vault `calendar_google_oauth` / `calendar_microsoft_oauth` | snake_case 固定名 (J4)。JSON {access_token, refresh_token, expires_at}。読み書きは vault RPC 経由 (service) |
| env 追加 (すべて optional + `is*Configured()` + UI degrade) | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (毎着信の署名検証で使う定数につき Vault RPC の DB 往復を足さない実装簡潔性から env。既存 env 秘匿値の慣行と同列 — 15 秒予算自体は DB 1 往復追加でも破綻しない) / `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` / `MS_CALENDAR_CLIENT_ID` / `MS_CALENDAR_CLIENT_SECRET` / `PRINT_TOKEN_SECRET`。`src/lib/env.ts` の zod スキーマに追加 (空文字→undefined preprocess 継承) |

### 5.5 staff 拡張時の差分方針 (J1 — 各書の拡張章の共通骨子)

profiles.role CHECK に 'staff' 追加 → `has_role(text)` 関数新設 → RLS は is_admin() を残したまま staff 向けポリシーを**追加** (置換しない) → requireAdmin に `requireRole('staff')` 併設 → 上表「将来 staff」列の R/W を実装。カレンダー/電話の外部接続は staff 追加後も**事業体で 1 接続のまま** (per-user 接続にしない — J1)。

---

## 6. 状態意味論・ライフサイクル (全体レベル)

### 6.1 案件ステージ (canonical は 01-crm.md。ここでは全体整合規則のみ)

```
inquiry → estimating → quote_sent → ordered → in_production → delivered → invoiced → paid (終端)
   │           │            │          │            │             │           │
   └───────────┴────────────┴──────────┴────────────┴─────────────┴───────────┴──→ lost (終端。理由必須)

前方ジャンプ: 任意の前方ステージへ直行可 (例: quote_sent → invoiced — 小口の quote→invoice 直行 §4.4)
後退:        非終端ステージ間は自由 (誤操作訂正)
終端:        paid / lost からは一切遷移不可 (KMB-E602)
lost:        全非終端ステージから可。ただし markDealLost 専用経路のみ — updateDealStage の
             to='lost' は常に KMB-E602 (許可遷移集合は 01-crm §4.2 の stage-machine が正)
```

| ステージ | 意味論 | probability | is_won / is_lost |
|---|---|---|---|
| inquiry | 相談が届いた (取込直後) | 10 | — |
| estimating | 見積作成中 | 30 | — |
| quote_sent | 見積送付済み (quote issued) | 60 | — |
| ordered | 受注 (won 確定) | 100 | won |
| in_production | 製作中 (ブロック配置済み) | 100 | won |
| delivered | 納品済み | 100 | won |
| invoiced | 請求済み | 100 | won |
| paid | 入金済み (終端) | 100 | won |
| lost | 失注 (終端) | 0 | lost |

不変条件: won_at は won 系ステージ (isWon=true) への初到達時に 1 回だけ記録され以後不変 (前方ジャンプで ordered を経ない場合も成立 — 01-crm §4.2)。amount_jpy は受注時に見積 total で確定上書き。probability / is_won はコード registry (`DEAL_STAGE_REGISTRY`) が正で DB には持たない。

### 6.2 モジュール間の状態整合規則

| 規則 | 内容 |
|---|---|
| 帳票 → 案件 | 帳票発行/入金は deal.stage を**直接更新しない**。app 層が戻り値イベントで `updateDealStage` を呼ぶ (提案遷移: quote issued→quote_sent / order issued→ordered / delivery issued→delivered / invoice issued→invoiced / paid→paid)。**paid→paid のみ自動適用しない — 確認ダイアログで admin が確定する** (v1.2 — 02-sales §7.1-2 v1.1 整合: paid は遷移不可の終端で undo 不能のため。非終端 4 遷移は自動適用 + undo トースト)。admin が拒否/手動変更してもよい (帳票と案件のステージ乖離は許容し、ダッシュボードに乖離バッジ) |
| 案件 → ブロック | deal が lost になったら未着手ブロック (backlog/scheduled) を cancelled に一括提案 (自動では消さない) |
| 通話 → 顧客 | 顧客紐づけの曖昧一致 (同番号複数顧客) は自動確定しない (E823 → 手動確認 UI) |
| 外部カレンダー → ブロック | 外部削除は deleted_externally マークのみ (即削除禁止 — 誤操作復元余地、ext-calendar §3.3) |
| 実行系 (call_jobs) | at-least-once + 冪等 commit (§3.1.4)。結果不明の外部書込 (カレンダー push) は E724 で手動照合 (E506 と同思想) |

### 6.3 個別状態機械の委譲一覧

| 状態機械 | canonical |
|---|---|
| customers.lifecycle (lead/customer/archived)・deals.stage・tasks.status | 01-crm.md §状態意味論 |
| documents.status (draft/issued/accepted/declined/expired/paid/voided) + 派生許可表 | 02-sales.md §状態意味論 |
| work_blocks.status (backlog/scheduled/in_progress/done/cancelled)・calendar_event_links.sync_status | 03-scheduling.md §状態意味論 |
| calls / call_jobs (pending→downloading→transcribing→analyzing→linking→done/failed) | 04-telephony.md §状態意味論 |

---

## 7. 全データパターン (全体レベルの列挙。詳細は各書)

設計・テストで必ずカバーする現実パターン (ext-hubspot / 業務実態由来):

1. **メールなし電話のみの高齢施主** — customers.email NULL 可、dedup は tel_e164 第 2 キー (E601)
2. **法人 (工務店/元請) の担当者** — customer.company_id 紐づけ、帳票宛名は会社名+担当者
3. **個人施主 (会社なし)** — company_id NULL (主系)
4. **同一人物の再問い合わせ** — email/tel 一致で既存顧客に取込 (新規 deal のみ作成)
5. **家族共用メール** — dedup 候補提示 + force 作成 (DB unique にしない根拠)
6. **番号非通知/公衆電話からの着信** — calls.from_e164 NULL 許容、顧客マッチ skip
7. **見積のみで終わる案件 (失注)** — lost + 理由。見積 PDF は保存済みのまま (7 年)
8. **quote→invoice 直行の小口** — 派生許可表に明記 (E623)
9. **免税事業者モード** — invoice_issuer.registration_number NULL → 区分記載様式 + 「消費税相当額」表記 (J5 ★確認 2 がどちらでも壊れない)
10. **リピート案件** — 初回治具・段取り費の免除行 (見積標準項目、J5)。過去 deal の実績時間を見積画面に参考表示
11. **乾燥待ち (非拘束)** — consumes_capacity=false。キャパ計算から除外・期間は占有
12. **XL (個別見積り) のシミュレーター送信** — quote_only=true のリード (金額なし deal、見積原案は明細なしメモのみ)
13. **通話 15 分/25MB 超の長録音** — セグメント分割転写 (E822 は分割不能時のみ)
14. **webhook 重複配信** — call_sid/recording_sid unique + call_jobs unique(recording_id) + appendActivity 冪等キーで二重取込・二重ジョブ生成 (AI 二重課金) なし (04-telephony §6.1/§6.4)

---

## 8. 差分表示仕様 (全体レベル)

| 対象 | 仕様 | canonical |
|---|---|---|
| 帳票の版間差分 (v1 vs v2) | 訂正発行時に旧版/新版の明細・金額を並記表示 (既存 `diff` パッケージ流用)。台帳は両版とも保持 | 02-sales.md §差分表示 |
| 価格表変更のプレビュー | 既存 /admin/prices の before/after 見積り 3 例 (実装済み) を流用。変更なし | 06-simulator.md |
| 見積原案 vs シミュレーター入力 | 原案編集画面にシミュレーター時点のスナップショット (activity payload) を参考表示 | 02-sales.md |
| 議事録 vs 通話全文 | 全文/要約タブ切替 (差分ではなく併記)。転写原文は不変保存 | 04-telephony.md |
| その他 (crm/scheduling) | 該当なし — activity は不変 (note のみ編集可・履歴は持たない)、ブロックは現在値のみで版管理しない。理由: 1 人運用で監査需要がなく、電帳法対象は帳票のみ | — |

---

## 9. テスト戦略 (全体)

### 9.1 レイヤ表 (既存 §11 の枠組みを継承)

| レイヤ | 対象 | 手段 |
|---|---|---|
| 単体 (Vitest, 純関数切り出し) | 税計算 (書類×税率 1 回丸め×3 方式)・採番フォーマット・ステージ遷移ガード (deal/document/block/call_job)・キャパシティ計算・自己エコー棄却判定・E.164 正規化・テンプレート→ブロック展開・セグメント分割判定・TwiML 生成 (営業時間分岐) | 実 DB なし。RPC 生返り値の判別共用体変換をテスト (ai-studio-lease.test.ts 様式) |
| 契約 parity | 新テーブルの check 制約 ↔ Zod enum 一致 (activity_type / stage / status / doc_type / DOC_NO_PREFIX) | `contracts-ddl-parity.test.ts` に追加 |
| 結合 (DB) | RLS マトリクス §5.2 全セルを anon/admin/service 3 クライアントで検証。RPC (0021 緩和 / 0022 採番 / call_job lease) の CAS・冪等・ガード | supabase start |
| 結合 (API) | Twilio 署名検証 (正/負/パラメータ脱落)・/api/shop/lead の rate limit・/api/jobs/* の secret・OAuth callback (msw で外部 API モック) | 外部 API 実呼び出しは CI 禁止 (既存規約) |
| E2E (Playwright/Chrome MCP) | 顧客→案件→見積→受注→ブロック→納品→請求→入金の一気通貫 + **キーボード全項目 (↑↓/Tab/Enter/Esc/Cmd+S)** + PDF 2 ページ超の margin boxes/counter(pages) スモーク | 本番前に人が実行 |

### 9.2 モジュール×フェーズ×テストの対応 (implementer+tester ペア・2 回連続 PASS を可能にする粒度)

各子 Issue は「単体テストファイル名 + 結合テスト対象セル」を受入基準に明記する。命名は `tests/<module>-<対象>.test.ts`。最低ライン:

| モジュール | 必須単体 | 必須結合 |
|---|---|---|
| M0 | `platform-scalars` (E.164/金額/税区分), `ai-providers-router-service-ctx` (session 経路無変更 + service 経路) | 0021/0022 RPC (service/admin/anon の 3 ロール実行) |
| crm | `crm-dedup`, `crm-stage-machine`, `crm-activity-payloads` (全 type parse), `crm-intake` | activities 冪等 (同 ref 二重 append)・RLS (note のみ UPDATE) |
| sales | `sales-tax` (丸め 3 方式×税率混在×境界値), `sales-numbering-format`, `sales-derive-snapshot`, `sales-doc-state` | 採番同時実行・issued 後編集拒否 trigger・台帳 append-only・branding-assets バケット private 検証 (0028 — 角印は署名 URL のみで取得可。v1.2: 旧「seal の 3 点セット」は seal_media_id 廃止で差し替え) |
| scheduling | `scheduling-template-expand`, `scheduling-capacity`, `scheduling-echo-reject`, `scheduling-sync-state` | event_links CAS・410 フル再同期パス |
| telephony | `telephony-twiml` (営業時間/同意 ON-OFF), `telephony-signature`, `telephony-job-stage-machine`, `telephony-segmenter`, `telephony-time-budget` (30 分録音の時間予算: 2 件目持ち越し判定 + transcribing セグメントチェックポイント再開 — §3.1.4-8) | call_job lease RPC (acquired/held/exhausted/terminal)・webhook 冪等 |
| settings/simulator | `settings-new-keys` (6 キー parse/backfill — telephony キーの詳細境界は 04 telephony-contracts.test.ts 所掌), `pricing-estimate` (qty 1000 境界、既存ゴールデン 24 件維持) | favicon の media 参照 3 点セット (0035。v1.2: seal は media 参照ではなくなり 3 点セット対象外 — 07-delta §D5 v1.2) |

運用: implementer と tester を必ずペア配置、修正→再検証ループ、**2 回連続 PASS で完了** (全プロジェクト規約)。カバレッジ: 契約/計算/状態遷移ガードは分岐 100%、その他 80% 目安。

### 9.3 契約結合点の統合テスト (Phase 5)

- appendActivity 統合: sales/scheduling/telephony の各 facade 経由で同一 deal のタイムラインに 4 種の activity が occurred_at 順に並ぶ
- app 層合成 4.1/4.2 の Server Action 単位テスト (facade をモックせず supabase start 上で)
- ダッシュボード集計 (未対応リード/キャパ残/未消込/期日超過) の SQL 検証

---

## 10. 各モジュールへの割当表 (子設計書への発注仕様)

| モジュール | 設計書 | migration 番号帯 | エラーコード帯 | 所有テーブル (+Storage/view) | nav-items 追加 |
|---|---|---|---|---|---|
| M0 共通基盤 | 本書 §3 (canonical) | **0021 (RPC 緩和 + site_settings anon 許可リスト化 — §3.1.2c), 0022** | — (E105 登録 + §3.3 全表の errors.ts 反映) | document_sequences は sales 所有 (DDL canonical は §3.4) | — |
| crm | 01-crm.md | **0023〜0025** | KMB-E601〜E619 | customers, companies, deals, activities, activity_links, tasks | 顧客 / 案件 / やること |
| sales | 02-sales.md | **0026〜0028** | KMB-E620〜E649 | documents, document_lines, payments, document_sequences, issued_documents, print_tokens, pdf_render_lock, document_revision_stagings (v1.2 — 02-sales v1.1 §2.3.2 の service 専用補助 3 テーブル) (+bucket issued-documents, branding-assets) | 帳票 |
| scheduling | 03-scheduling.md | **0029〜0031** | KMB-E701〜E739 | work_types, work_templates, work_template_items, work_blocks, calendar_connections, calendar_event_links | カレンダー |
| telephony | 04-telephony.md | **0032〜0034** | KMB-E801〜E839 | calls, call_recordings, call_jobs (+bucket call-audio) | 通話 |
| site-settings | 05-site-settings.md | **0035** (favicon の media 参照 3 点セットのみ。settings キー自体は DDL 不要) | なし (E101/E103/E3xx 共用) | なし (site_settings 既存。キー追加のみ) | なし (既存「サイト設定」タブ拡張) |
| simulator | 06-simulator.md | **なし** (DDL 不要 — pricing 既存 5 テーブル流用、J6) | なし (E101/E103 共用。リード取込は crm E60x) | なし | なし (公開サイト側) |

割当規則:

- migration は帯内で実装順に採番し、**未使用分は返上** (次モジュールが詰めない — 帯は固定)。pg_cron ジョブ登録・RPC・RLS は各帯の migration に含める
- 角印画像は media を参照しない — **private バケット 'branding-assets' (sales 帯 0028 で作成) に保存し、invoice_issuer.seal_storage_path が指す** (v1.2 — 07-delta §D5 v1.2 で seal_media_id 廃止。旧「seal の media 参照 3 点セット更新を 0028 に含める」は撤回され、0028 の内容はバケット作成に置換 — 02-sales §2.3.3 v1.2)。media を参照する新列は favicon (branding.favicon_media_id) のみで、その **media 参照 3 点セット更新 (media_admin_delete / media_reference_summary / ai_draft_cleanup_run) は 0035** (view の DROP+CREATE 置換は 0008→0013→0015 の確立前例)
- settings キーの実装フェーズ分散: analytics/branding = 05 / invoice_issuer = sales フェーズ / business_hours・telephony = telephony フェーズ / work_capacity = scheduling フェーズ。**Zod canonical は全キーとも 07-contracts-delta §D5** (各書で再定義しない)
- 各書の必須 10 章: 本書が総表を持つ章 (認可/エラーコード/規模) も、各書は自分の所有分の詳細 (RLS 全文・recovery 文言・画面別見積り) を書く。「該当なし」は理由必須 (§0.3 前例)

---

## 11. 実装フェーズ計画 (親子 Issue 構成原案)

フェーズは日程ではなく依存順序と品質ゲート。依存が解けたフェーズは即並列 (既存 §13 の運用)。全子 Issue 共通受入: lint (MODULES 境界) PASS / 単体+結合テスト 2 回連続 PASS / contracts-ddl-parity PASS / 該当時 migration 本番適用記録。

```
親 Issue: CRM スイート実装ロードマップ (堀さん確認チェックリスト §12.2 を転記)
│
├─ Phase 0 (即時・他と独立)
│   ├─ #0-1 シミュレーター修理 (06 §修理): POST /api/revalidate (tag='prices') 実測 →
│   │      原因切り分け (env / Data Cache) → /shop の revalidate 設計是正 + seed 運用手順化。
│   │      受入: 本番 /shop でフォーム描画 + 概算表示 (実機)
│   └─ #0-2 外部手続き (user 主導): Twilio Regulatory Bundle 書類収集・本番 env 整備・
│          カレンダー環境確認 (§12)
│
├─ Phase 1: M0 共通基盤 (§3.6 の 8 項目) — 全フェーズのブロッカー
│   ├─ #1-1 契約統合 (module-contracts v2.8 適用 + ESLint + errors.ts + platform contracts)
│   └─ #1-2 migration 0021/0022 + router ExecutionContext + /api/jobs 骨格 + モジュール骨格
│       受入: 既存テスト全 PASS / service 文脈で generateText が実行可能 (結合テスト) /
│             採番 RPC 同時実行テスト PASS
│
├─ Phase 2: crm (01-crm.md) — sales/scheduling/telephony のブロッカー
│   ├─ #2-1 DDL 0023〜 + contracts + repository (+parity)
│   ├─ #2-2 facade (取込/dedup/appendActivity/タスク) + /api/jobs/crm-digest
│   └─ #2-3 画面 (顧客/案件/やること + タイムライン部品) + ダッシュボード KPI 拡張
│       受入: 冪等 append 結合テスト / キーボード操作チェックリスト / 既存 contact_inquiries
│             からの手動リード化操作
│
├─ Phase 3 (3 系統並列。implementer+tester ペア × 3、worktree 分離)
│   ├─ sales:      #3s-1 DDL+税計算+採番接続 → #3s-2 帳票 CRUD+派生+状態機械 →
│   │              #3s-3 PDF (/print ルート+方式 A)+電帳法保存 → #3s-4 入金消込+帳票画面
│   ├─ scheduling: #3c-1 DDL+種別/テンプレ → #3c-2 ブロック+キャパ+カレンダー画面 (shadcn 追加) →
│   │              #3c-3 Google 同期 (OAuth+pull/push+エコー棄却) → #3c-4 Microsoft 同期 (同一契約の第 2 実装)
│   └─ telephony:  #3t-1 DDL+webhook (署名検証+TwiML+留守電) → #3t-2 call_jobs ステージ機械
│   │              (lease RPC 複製) → #3t-3 転写/議事録/タスク起票 (service AI) → #3t-4 通話画面+再生
│       受入 (共通): §9.2 の必須テスト / 4.1〜4.4 の該当シーケンス実機確認
│       注: #3s-3 と #3t-3 は Phase 1 の 0021 適用が本番前提。#3c-3/#3c-4 は Google/MS の
│           アプリ登録 (user 作業) がブロッカー — 実装は msw モックで先行可
│
├─ Phase 4 (並列・小規模)
│   ├─ settings:  #4-1 analytics (GA タグ (site)/layout 注入) + seo_defaults 公開側配線 +
│   │             favicon (media_id 方式 + /icon Route Handler + 0035) + og 寸法是正
│   └─ simulator: #4-2 リード接続 (/api/shop/lead + コピー UX 置換) + SEC.01 カード価格 DB 駆動化 +
│                 qty 1000 是正 (crm/sales 依存 — Phase 2/3s 完了後)
│
└─ Phase 5: 結合・仕上げ
    ├─ #5-1 app 層合成の統合 (受注→ブロック生成 / ステージ提案配線) + ダッシュボード統合
    ├─ #5-2 E2E 一気通貫 (§9.1) + キーボード全 PASS + 本番 migration 全適用確認
    └─ #5-3 ドキュメント同期 (HANDOFF/README 追随、cms-ai-pipeline §2 への新テーブル追記)
```

並列性の要点: Phase 3 の 3 系統は所有テーブル・エラーコード帯・migration 帯が非重複のため衝突なし。契約変更が必要になった場合のみ 07-contracts-delta (v2.8) の改訂を経由する (直接 module-contracts.md を触らない)。

---

## 12. 前提条件と外部クリティカルパス

### 12.1 外部クリティカルパス (設計と独立に即時着手)

| # | 項目 | リードタイム | ブロックする範囲 |
|---|---|---|---|
| C1 | **Twilio Regulatory Bundle** (履歴事項全部証明書 6 ヶ月以内・代表者身分証・公共料金票・会社ドメインメール) | 審査 公称 2 営業日/実務 1 週間+ (ext-twilio §1.3) | telephony の本番疎通のみ (実装は署名モックで先行可) |
| C2 | 本番 env: **SUPABASE_SERVICE_ROLE_KEY** (ローカル .env.local では空を確認済み。本番 Vercel 側は Supabase MCP 未接続のため未確認 — user 確認事項。Vault 依存機能全部の前提 — gap-prod-db §7) / AI 運用キー / JOBS_SECRET / OAUTH_STATE_SECRET / 新規 §5.4 | user 作業 | M0 の本番動作・telephony/scheduling 全部 |
| C3 | Google OAuth 公開設定 (In production 化 — Testing のままだと refresh token 7 日失効。未審査警告の許容 or 審査 〜10 営業日) + Search Console ドメイン確認 | user 判断 + 最大 2 週 | scheduling Google 同期の本番 |
| C4 | Microsoft Entra アプリ登録 (アカウント種別の選択。個人 MSA なら同意可否の実機検証を早期に) | user 作業 | scheduling Microsoft 同期 |
| C5 | 独自ドメイン (Twilio 署名検証 URL・OAuth 審査・GA の共通前提。**無くても vercel.app で動く設計**にする — J 確認 6) | user 判断 | なし (品質向上のみ) |
| C6 | Supabase MCP 再接続 (gap-prod-db §7 の残 9 項目確認用) | user 操作 | 移行受入 A 系の完全確認 |

### 12.2 堀さん確認事項リスト (裁定書 ★ の転記 — 親 Issue にチェックリストとして掲載)

1. 隈部塗装の事業形態 (法人/個人) — **Twilio 日本番号は法人限定**。個人なら Twilio へ直接確認 (設計は番号非依存で吸収済み)
2. 適格請求書発行事業者か (T+13 桁の有無) — invoice_issuer.registration_number で分岐 (どちらでも動く)
3. 熊部さんのカレンダー環境 (Google / Outlook。Outlook なら M365 か個人 MSA か) — 実装順に影響 (設計は両対応)
4. 録音同意アナウンスの文言と要否 (既定 ON の設定項目)
5. 本番 env 整備 (§12.1 C2)
6. 独自ドメイン取得計画 (§12.1 C5)
7. 消費税端数処理の方式 (既定 = 切捨てで設計済み)
8. Vercel プランが Hobby か Pro か (pg_cron 方式のため必須ではない。記録のみ)
9. **旧 GitHub Pages サイトが今も完動状態で公開中** — 旧価格の独り歩き防止のため閉鎖 or Vercel へのリダイレクトの判断
10. ~~本番 price_* データ~~ → 確認済み: 完全投入済み (gap-prod-db)。残る切り分けは Vercel env と Data Cache revalidate (Phase 0-1)
11. Supabase Auth の公開サインアップ無効化 (disable_signup=false のまま — RLS は破れないが余剰面。ダッシュボード操作を推奨)

---

## 13. 規模見積り (総表)

| フェーズ | 新規テーブル | 新規画面/ルート | migration | 概算規模 (実装+テスト行数) |
|---|---|---|---|---|
| Phase 0 (修理) | 0 | 0 (是正のみ) | 0 | 〜400 |
| Phase 1 M0 | 1 (document_sequences) | /api/jobs 骨格 4 | 2 | 〜1,600 |
| Phase 2 crm | 6 | 画面 3 + タイムライン部品 + digest worker | 3 | 〜7,000 |
| Phase 3 sales | 4 (+bucket。document_sequences は M0 0022 で作成済み) | 帳票画面 2 + /print + PDF | 3 | 〜7,500 |
| Phase 3 scheduling | 6 | カレンダー画面 + OAuth 2 系統 + sync worker | 3 | 〜7,500 |
| Phase 3 telephony | 3 (+bucket) | webhook 3 + 通話画面 + worker | 3 | 〜5,000 |
| Phase 4 settings/simulator | 0 | GA/favicon/SEO 配線 + /api/shop/lead | 1 | 〜3,500 (v1.2 改訂 — 05 §14 の合算明示 (05 分 〜1,800 + 06 分 〜1,700) に追随。旧 〜2,200 は撤回) |
| Phase 5 結合 | 0 | ダッシュボード統合 + E2E | 0 | 〜1,800 |
| **合計** | **20 (+3 bucket — v1.2: branding-assets 追加)** | 画面 8 + ルート 15 前後 | **15 本 (0021〜0035)** | **〜34,300 (v1.2 — Phase 4 改訂分 +1,300)** |

ランニングコスト増分 (概算): Twilio 050 + 月 100 着信×5 分 + AI 転写/議事録 ≈ **$15/月 (¥2,300)** (転送を全通話に使うと +$92 — ext-twilio §6。転送先設定は任意)。Google/Microsoft カレンダー API は無料枠内。AI 議事録は既存月次予算 (ops_limits、既定 $50) の枠内で `feature` 別に可視化。

---

## 14. 移行計画と受入基準

### 14.1 移行手順

新機能は既存データの破壊的移行を伴わない (全テーブル新規)。唯一の移行は**既存 contact_inquiries の CRM 取込 (任意・推奨)**: 1 トランザクション + seed_manifest 記録 + 逆順ロールバックスクリプト (既存 §12.1 の定型)。email/tel dedup を通し、status='done' は lifecycle='customer'、その他は 'lead' で取込。冪等 (再実行は skip 報告)。

### 14.2 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| A1 | migration 0021 適用後、service_role で ai_budget_reserve/settle が成功し、anon では拒否される | 結合テスト (3 ロール) + 本番 SQL 実測 |
| A2 | 0022 採番が並行 10 呼び出しで欠番なく単調増加し、Q/J/D/I×年で独立採番される | 結合テスト |
| A3 | 既存 64 テストファイル (845 ケース、2026-07-11 実測 — §3.1.2b と同一基準) が全 PASS のまま (cookie 経路無変更の証明) | vitest run |
| A4 | contracts-ddl-parity が新テーブル全 check 制約で PASS | CI |
| A5 | 本番 /shop でシミュレーターが描画され概算が出る (Phase 0) | Chrome MCP 実機 |
| A6 | 着信→議事録→タスク→タイムラインが本番番号で一気通貫 (C1/C2 解消後) | 実機通話 |
| A7 | 請求書 PDF が適格請求書 6 記載事項を満たし、issued_documents から年月日/金額/取引先で検索できる | E2E + 台帳 SQL |
| A8 | 受注→ブロック生成→カレンダー配置→Google に反映→外部で移動→アプリに逆同期 (エコーなし) | 実機 (アプリ専用カレンダー) |
| A9 | 既存 inquiries 取込がロールバック可能 (seed_manifest 逆順) | ステージング実行 |

---

## 15. リスクと要確認事項

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | Twilio Bundle 審査遅延/個人事業で番号不可 | telephony 本番開始遅延 | 設計は番号非依存 (設定値)。実装・テストは署名モックで完走し、番号到着後に疎通のみ |
| R2 | MSA (個人 Outlook) の未確認アプリ同意がブロックされる | Microsoft 同期不可 | Google 先行 (J4)。MSA 実機検証を C4 で早期化。契約は provider 抽象で両対応 |
| R3 | Google Testing ステータスの refresh token 7 日失効 | 同期が週次で死ぬ | In production 化 (未審査警告許容) を既定運用に。C3 |
| R4 | Chromium 147 の margin boxes + counter(pages) が page.pdf() で不完全 | 帳票フッタ/頁番号 | 2 ページ超スモークテストを #3s-3 受入に含める (gap-pdf §8)。不備時は headerTemplate 代替へフォールバック |
| R5 | 長時間録音 (>15 分) の分割転写品質 | 議事録精度 | セグメント境界に 2 秒オーバーラップ。E822 で人間確認へ degrade |
| R6 | サービス role 緩和 (0021) の攻撃面拡大 | 予算 RPC の悪用 | service_role キーはサーバ専用 (server-only import 強制済み)。anon/authenticated の挙動は不変 (A1 で検証) |
| R7 | 単一 admin のまま利用者 (熊部さん) と開発者の操作が混在 | 誤操作 | 監査は activities (system) + issued_documents で担保。staff 分離は拡張章 |
| R8 | 帳票要件の税務解釈 (電帳法真実性・事務処理規程) | 法令適合 | 規程の備付けは堀さん側運用タスクとして Issue 化 (J5)。税理士確認を推奨事項に明記 |

---

## 16. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 | 詳細の委譲先 |
|---|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §5 (総表 4 列 + API + Storage/Vault + staff 差分方針) | 各書 §認可 (RLS ポリシー全文) |
| ② テスト戦略表 (単体+結合) | §9 (レイヤ表 + モジュール×テスト対応 + ペア 2 連続 PASS 粒度) | 各書 §テスト戦略 |
| ③ エラーコード表 | §3.3 (E601 個別レベルの全表 — 採番 canonical) | 各書 §エラーコード (recovery 文言) |
| ④ ライフサイクル | §6 (全体整合規則) + §4 (シーケンス) | 各書 §状態意味論 (ASCII 図 + 意味論表 + 不変条件) |
| ⑤ 全データパターン列挙 | §7 (14 パターン) | 各書 §データパターン |
| ⑥ 印刷出力仕様 | §0.6 (該当あり — 方式 A 確定・要点) | 02-sales.md §印刷出力 (様式・margin boxes・電帳法) |
| ⑦ 移行受入基準 | §14 (A1〜A9 + inquiries 取込 snapshot/rollback) | 各書 §受入基準 |
| ⑧ 規模見積り | §13 (総表 + ランニングコスト) | 各書 §規模見積り |
| ⑨ 状態意味論 | §6.1〜6.2 (deal ステージ canonical 概要 + 跨モジュール規則) | §6.3 の委譲一覧 |
| ⑩ 差分表示仕様 | §8 (該当箇所一覧。crm/scheduling は該当なし + 理由) | 02-sales.md §差分表示 |
| モジュール契約 (全プロジェクト規約) | §2 + 07-contracts-delta.md (v2.8 差分の完全本文) | docs/module-contracts.md (統合後) |
| 値契約 (Zod canonical) | §3.5 (共通スカラー) + 07-contracts-delta §D4〜D8 | 各書 (契約の再定義禁止・参照のみ) |
| 非機能要件 | §13 (コスト)・§3.1.3 (ジョブ周期/maxDuration)・§15 (リスク) | 各書 (性能目標) |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.2 | 2026-07-11 | **各モジュール書 v1.1 確定 (13:00 以降) の波及追随** (final-check V1/V3〜V12)。§10 sales 行 + §9.2: print_tokens / pdf_render_lock / document_revision_stagings (02-sales §2.3.2) と bucket branding-assets を追記、seal の「media 参照 3 点セット (0028)」記述を **branding-assets private バケット化 (07 §D5 v1.2 — seal_storage_path)** に置換 / §2.2: crm→ai-providers 辺・sales→pricing 辺を削除 (07 §D2 v1.2 が正) / §4.3: stage 3 の「refusal→E403」を **E821 一本化** (04 §9) に統一・stage 4 を **appendActivity 先行 → createTask 常時実行** (07 §7.5 canonical) に是正・E823 分岐追記 / §3.3 E821 の意味を refusal/max_tokens 込みに改訂 / §4.2 手順 3: 仮単価を 06 §5.4 T1 参照 (total_max 税抜換算) に改訂 / §5.2 calls 行: admin UPDATE を customer_id/match_status/memo の 3 列に更新 (04 §4.2) / §5.3: /print 行を print_tokens 実消費ワンタイム (02 §7.3 v1.1 — 「実効ワンタイム」撤回、§0.6 も同修正)・/api/shop/lead 主エラーを E101/E105/E901 (06 §6.1) に是正 / §5.4: issued-documents を「ポリシーなし + storage.objects 不変 trigger」に是正 (02 §17 波及 2)・branding-assets 行を追加 / §6.2: paid→paid の確認ダイアログ適用注記 (02 §7.1-2) / §13: Phase 4 を 〜3,500 (05 §14 合算) に改訂、合計 〜34,300・bucket 3 に更新 / §1 図の Storage に branding-assets |
| v1.1 | 2026-07-11 | レビュー指摘反映。§2.1/§3.1.2c/§5.2: site_settings 機微キーの anon 遮断を公開キー許可リスト + admin_select に確定 (0021。07-delta §D5 と SQL 統一・notify.ts の service 切替注記・総表に site_settings 行追加) / §3.1.2b・§4.2: /api/shop/lead 経路の常時 service 実行と D8 委譲 / §3.1.3・§3.1.4-3/-8: telephony worker の自己 heartbeat 主体と時間予算 (経過時間ガード + セグメントチェックポイント。§9.2 に telephony-time-budget 追加 — 機構詳細は 04-telephony §6.5.2 へ要反映) / §3.3 E822 意味改訂 / §4.3・§7-14: call_jobs unique(recording_id) の二重ジョブ防止 / §4.4: 派生元 issued または accepted・crm-digest の expired 遷移実行・PDF 必須化 / §5.2: issued_documents の append-only trigger 実強制を備考化 / §5.3: /print トークン式を 02-sales §7.3 に一致 (実効ワンタイム表記) / §5.4: TWILIO_AUTH_TOKEN の env 理由是正 / §6.1: ステージ遷移図を 01-crm §4.2 に整合 (全非終端→lost = markDealLost 専用・前方ジャンプ・won_at 意味論) / §9.2: seal 3 点セットを sales 行へ移動 / §12.1 C2: SERVICE_ROLE_KEY の確認範囲是正 / §14.2 A3: 既存テスト実測値 (64 ファイル 845 ケース) に統一 |
| v1.0 | 2026-07-11 | 初版。設計裁定 J1〜J12 準拠。M0 共通基盤 (ExecutionContext / 0021 / 0022 / activities ハブ / エラーコード全表 / 共通スカラー) を canonical 化。モジュール割当 (migration 0021〜0035・E6xx/E7xx/E8xx 帯・所有テーブル) を確定 |
