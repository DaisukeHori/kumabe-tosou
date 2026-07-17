# 詳細設計: 受託業務ループ (fulfillment-ops-loop)

トラック key: `fulfillment-ops-loop` / 依存: `intake-comms-foundation` (Track1 = 送信基盤・#100 メール統合の入口)
対象: P1' P2' P3' P4' P6' P8' P9' P10' P11' / #97 #147 #63 / P5' #90 #36 #58 #93 #140 #139
設計日: 2026-07-18 / 設計者: Fable (設計担当サブエージェント)

---

## 0. 現状調査 (file:line 根拠 — 全て実読)

### 0.1 データ基盤 (この設計の土台)

| 既存資産 | 根拠 (file:line) | 本トラックとの関係 |
|---|---|---|
| deals 9 ステージ (`inquiry…paid/lost`) + check 制約 | `supabase/migrations/20260711000023_crm_core.sql:74-77`, `src/modules/crm/contracts.ts:20-23` | 荷受け(ordered/in_production)・発送(delivered) がぶら下がる幹。**入荷/発送の概念は列に存在しない** |
| DEAL_STAGE_REGISTRY (label/probability/isWon) | `crm/contracts.ts:29-41` | ポータルの進捗表示ラベルに流用 |
| updateDealStage + lifecycle 自動昇格 (deal won → customer 昇格) が**実装済み** | `crm/facade.ts:682-742` | #36 の一部は既に存在。残りは「業務イベント→ステージ」方向のみ |
| reopenDeal (終端からの再開・理由必須) | `crm/contracts.ts:408-414`, `crm/facade.ts:205` | #93 アフター対応で「納品後の deal を触らない」ために不具合記録を別テーブルにする判断根拠 |
| 顧客 請求先/配送先ブロック (#113 済) | `crm/contracts.ts:326-357` (zCustomerAddressBlock), `504-505` (CustomerDetail), `282-283` (CustomerRef.billing/shipping) | P2' 発送はこの shipping_info を宛先として参照するだけ。**新規宛先構造は作らない** |
| 顧客カスタム項目 (#98 済、jsonb 配列 + silent-wipe 防止規約) | `crm/contracts.ts:307-315`, `339-357`, migration `20260715000001_customers_custom_fields.sql` | #58 (案件カスタムプロパティ) は deals へ同型移植するだけ |
| activities タイムライン・ハブ (9 type、冪等キー (type,ref_table,ref_id)) | `crm/contracts.ts:186-221`, `crm_core.sql:126-152` | 荷受け/発送/検品/進捗共有の全イベントは activities に合成イベントを残す (新テーブルが正、activities は表示用) |
| work_blocks (status 5 値 + 配置/完了の check 不変条件) | `20260711000029_scheduling_core.sql:94-142` | **検品結果・不合格理由・リワーク回数を持つ列は無い** (v2 レポート P8' 判定どおり) |
| work_types seed 5 種 (sanding/primer/painting/drying/inspection)、drying=consumes_capacity:false | `scheduling_core.sql:189-195` | P5' 残タスク = `receiving`(荷受け)/`packing`(梱包・発送) の seed 追加のみ |
| work_templates + expandLinesToBlocks + facade `generateBlocksFromLines` + UI ボタン | `scheduling/facade.ts:165-167`, `src/app/admin/documents/actions.ts:240-305` | P8' リワーク再展開はこの既存経路 (`createBlock`/`generateBlocksFromLines`) を呼ぶだけ |
| ブロック状態機械 (10 エッジ純関数 canTransitionBlock) | `scheduling/internal/block-state.ts:34-56` | P6' 進捗共有のトリガー点 = `transitionBlock`/`recordActual` の**呼び出し元 (app 層 action)** に置く |
| 週間キャパ (weekly_hours/booked_hours/remaining_hours) | `scheduling/contracts.ts:105-110`, facade `getWeeklyCapacity` (`facade.ts:175`) | P10' 納期算出の唯一の計算基盤。site_settings `work_capacity` は `scheduling_core.sql:201-203` でバックフィル済み |
| sales deriveDocument = **同一 deal 内**の quote→order→invoice 複製専用 (deal_id を source から引き継ぐ) | `sales/facade.ts:815-893` (特に 872 `deal_id: source.deal_id`) | P11' は「別 deal への複製」なので deriveDocument は流用不可 — v2 レポートの判定を実コードで確認 |
| 帳票メール送付 (#101 済): Resend 添付送信 + document_emails 送信台帳 (追記専用) | `src/modules/sales/internal/email.ts:79-103`, migration `20260714000036_sales_document_emails.sql` | P1'/P2'/P6' の顧客宛メールは**この実装パターン (internal/email.ts + 送信台帳 + E644 同型)** を fulfillment に複製する (跨モジュール internal import 禁止 — email.ts:12-13 の「許容された重複実装」規約) |
| print_tokens = service 専用トークン台帳 (token_hash sha256 PK, expires, consumed) | `20260711000027_sales_issuance.sql:100-112` | P6'/#97 ポータルの限定 URL トークンはこの前例の変形 (revocable・長寿命版) |
| Storage バケット + 署名付き URL 発行 route | `20260708000003_storage.sql:6-12`, `src/app/api/upload-url/route.ts:21-40` (kind: 'audio'\|'media') | #147 は新バケット + kind 追加で同型実装 |
| crm-digest cron (22:00 UTC = JST 朝 7 時, pg_cron→net.http_post→route) | `20260711000024_crm_digest_cron.sql:28-39` | P11' リマインドは新規ジョブを作らず **crm tasks + 既存 digest** に載せる。#140 webhook worker は同型の cron 起動 |
| nav-badges 横断 count facade (行を引かない count のみ) | `src/modules/nav-badges/facade.ts:57-93`, `docs/module-contracts.md:51` | #93 アフター不具合の未対応 count を足す時の前例 |
| simulator 見積スナップショット (grade×size×qty) | `crm/contracts.ts:132-152` | P11' 再注文の複製元 / P10' の標準時間解決キー (grade_key/size_key) と同語彙 |
| pricing 見積入力 = grade×size×qty の集計構造のみ | `src/modules/pricing/contracts.ts:78-86` | P3' パーツ台帳が「個体仕様」を持つ場所が無いことの確認 |
| admin ナビ 6 グループ (「製造・請求」= documents/calendar) | `src/app/admin/nav-items.ts:81-86` | 新 UI の置き場所の語彙 |
| deal 詳細のカード構成 (Overview/Documents/WorkSummary/StageBar) | `src/app/admin/deals/[id]/` 配下 (DealOverviewCard.tsx ほか) | 本トラックの UI は**カード追加**で入れる (画面新設を最小化) |
| admin 共通小物 (_ui): data-table / surface / page-header / status-badge / underline-tabs / pill-toggle / entity-picker / stage-progress / notice-panel / activity-timeline | `src/app/admin/_ui/` 一覧 | 新画面はこの語彙のみで組む |
| テスト: vitest (`npm run test` = `vitest run`)、tests/ にユニット多数 | `package.json:13`, `tests/` | テスト方針の前提。CI Actions 無し・Vercel ビルドのみ (memory: project-ci-quality-gates) |

### 0.2 エラーコード帯の使用状況 (grep 実測)

- crm 使用中: **E601-E611**(E611 = 住所自動補完失敗 — `src/modules/platform/errors.ts:224`、app 層 `customers/actions.ts` で使用中)→ 未使用 E612-E619(growth 統合で E612-E616 は他トラック割当済 — 00-統合設計.md 参照)
- sales 使用中: E620-E627(E622 含む)+ E640-E645(**E643 = PDF レンダーロックで使用中** — `errors.ts:286`, `sales/internal/pdf.ts:84`)→ 未使用 E628-E639, E646-E649(growth 統合で sfa/commerce に全枠割当済)
- scheduling 使用中: E701-E705, E720-E725 → **未使用 E706-E719, E726-E739**
- **E650-E700 はどのモジュールにも未割当**(sales は E649 まで、`docs/module-contracts.md:47`)。本トラック fulfillment は **E650-E679** を取り、並行トラックの engagement 新モジュールが **E680-E699** を取る(00-統合設計.md の全体割当で衝突解消済み)。E840-859 は #100 mail 予約済 (`docs/design/crm-suite/08-email.md:336`) — 本設計では**使用しない**

### 0.3 #100 (08-email.md v2) との競合確認

08-email.md は `emails`/`email_attachments` テーブル・`mail` モジュール新設・E840-859 を予約 (§5.1/§6/§7.1)。本トラックの顧客宛**送信** (荷受け通知/発送通知/進捗共有) は 08-email.md §1.4「既存メール送信インフラ」の側 (Resend 送信 + 自前送信台帳) であり受信取込とは非交差。将来 mail モジュールが入った際、BCC 取込 (§0.4) が本トラックの activities(email) 合成と同一送信を二重取込する恐れがある — **de-dup(照合・重複排除)は #100 側の実装責務**であることをここに申し送る(本設計は activities の ref/payload に shipments/progress_updates の識別子を残し、照合可能な形にしておく。emails テーブルには一切書かない)。

---

## 1. 全体アーキテクチャ方針

### 1.1 新モジュール `fulfillment` を 1 つだけ新設する

「モノの流れ」(荷受け→パーツ→検品→ロット→発送→ポータル→再注文) は crm/sales/scheduling のどれにも所有権が無い受託加工ドメイン。crm 帯 (E611-619 の残 9 個) に押し込むと帯が即枯渇し、scheduling は「時間」の所有者であって「物」の所有者ではない。08-email.md §7.1 の「衛星モジュール」前例 (telephony/mail) に倣い、**`src/modules/fulfillment` を新設**する。

- **所有テーブル**: `shipments`, `deal_parts`, `color_recipes`, `fulfillment_attachments`, `inspections`, `defects`, `deal_lots`, `progress_updates`, `portal_tokens`, `webhook_endpoints`, `webhook_deliveries` (+Storage bucket: `fulfillment-files`)
- **エラーコード帯**: **KMB-E650〜E679** (E680-E699 は予約のまま返上可。E840-859 には触れない)
- **依存方向**: fulfillment → crm (getDealRef/getCustomerRef/appendActivity/tasks) は可。crm/sales/scheduling → fulfillment は**禁止**。scheduling との連携 (リワークブロック生成・進捗トリガー) は **app 層合成** (§7.7 の sales⇄scheduling 前例と同型 — `docs/module-contracts.md:1814`)
- **module-contracts.md 改訂が先** (§8 手順 — `docs/module-contracts.md:1861-1865`): §1 所有マトリクスに fulfillment 行を追加、§4 に値契約、§5 に facade 署名を追記してから実装
- 構成は既存 3 モジュールと同一: `contracts.ts` / `facade.ts` / `repository.ts` / `internal/` (notify.ts = sales/internal/email.ts の同型複製)

### 1.2 モジュール別の担当割り

| 項目 | 所有 | 理由 |
|---|---|---|
| P1' P2' P3' P4' P8' P9' #147 #93 #140(#139) / P6'・#97 のデータ | fulfillment | 新ドメイン |
| P5' (work_type seed), P10' (納期算出) | scheduling | キャパ・工数の所有者。E706/E707 を新規採番 |
| #58 (deals.custom_fields) | crm | deals 所有者。#98 と同型のため crm 内で完結 |
| #63 (メールテンプレート) | settings (site_settings 新キー) | DDL 不要 (`docs/module-contracts.md:348`「キー追加は DDL 不要・seed もバックフィルもしない」)。差込レンダラは `src/lib/template-vars.ts` (純関数・共有 lib) |
| #90 #36 (ステージガード/自動遷移) | app 層合成 + fulfillment facade の判定関数 | crm→fulfillment 依存を作らないため。ガード判定 (`checkStageRequirements`) は fulfillment 所有 (E656) |
| P11' (再注文) | app 層合成 (crm.createDeal + fulfillment.copyParts) | deriveDocument (sales/facade.ts:815) が同一 deal 専用のため sales は触らない |

### 1.3 migration 採番

現行最新 `20260715000002`。日付ベース採番を踏襲し `202607DD0000NN_<name>.sql`。**注意**: `20260714000036` が 3 ファイルで重複している既存事故があるため、本トラックでは**同日内連番を必ずユニーク**にする (下記 Issue 表に個別ファイル名)。RLS は `scheduling_core.sql:149-183` の「4 ポリシー + revoke anon + grant authenticated」パターン、service 専用テーブルは `print_tokens` パターン (`sales_issuance.sql:111-112`) を踏襲。

---

## 2. 項目別詳細設計

### 2.1 P1' 荷受け・検品・入荷状態記録 + P2' 発送・返送管理 【高 / 1 テーブルで両方】

**目的**: 郵送受託の起点と終点。届いた瞬間の状態 (破損/積層/欠品) を写真付きで固定して「届いた時から割れていた」紛争を予防し、受領通知・発送通知メールで「無事着いた?」「いつ発送?」の問い合わせと手作業連絡を消す。

**スコープ**: 入出荷の記録 (`shipments`)・受領/発送通知メール・追跡番号保持・deal 詳細のカード UI。**非スコープ**: ヤマト B2 クラウド/佐川 e 飛伝 API 連携 (後段 — #140 webhook が最小の外部接続点)、送り状 PDF 印字、運賃計算。

**DDL** (`20260718000002_fulfillment_shipments.sql`):

```sql
create table shipments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete restrict,
  direction text not null check (direction in ('inbound','outbound')),
  purpose text not null default 'delivery'
    check (purpose in ('intake','delivery','return','other')),   -- intake=預かり入荷, delivery=完成品発送, return=未加工返送
  carrier text,                       -- ヤマト/佐川/ゆうパック/その他 (自由文字列。値制約は Zod)
  tracking_no text,
  occurred_on date not null,          -- 入荷日 / 発送日
  item_count int check (item_count is null or item_count > 0),
  condition text check (condition in ('ok','damaged','partial','other')),  -- inbound のみ意味を持つ
  condition_note text,
  lot_id uuid,                        -- P9' で FK を後付け (deal_lots が後発のため。20260722000001_deal_lots.sql = F12 で ALTER)
  notified_at timestamptz,            -- 顧客通知メール送信済み時刻 (NULL=未通知)
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_direction_purpose check (
    (direction = 'inbound'  and purpose = 'intake') or
    (direction = 'outbound' and purpose in ('delivery','return','other'))
  ),
  constraint shipments_inbound_condition check (direction <> 'inbound' or condition is not null)
);
create index shipments_deal_idx on shipments (deal_id, occurred_on desc);
-- RLS: admin 4 ポリシー + revoke anon + grant authenticated (0029 パターン)
```

通知メールの送信台帳は `document_emails` の前例どおり**独立追記テーブルにせず**、shipments.notified_at + activities(email) 合成 + `notification_log` は持たない (1 荷 1 通知が原則。再送は notified_at 上書き + activities に 2 行目 — 冪等キーは ref_table='shipments/notice-'+n)。

**契約 (fulfillment/contracts.ts 抜粋)**:

```ts
export const zShipmentDirection = z.enum(["inbound", "outbound"]);
export const zShipmentInput = z.object({
  deal_id: z.string().uuid(),
  direction: zShipmentDirection,
  purpose: z.enum(["intake", "delivery", "return", "other"]),
  carrier: zShortText(30).nullable(),
  tracking_no: z.string().max(40).regex(/^[0-9A-Za-z-]*$/).nullable(),
  occurred_on: zDateOnly,
  item_count: z.number().int().min(1).max(9999).nullable(),
  condition: z.enum(["ok", "damaged", "partial", "other"]).nullable(),
  condition_note: z.string().max(2000).nullable(),
  lot_id: z.string().uuid().nullable(),
  memo: z.string().max(1000).nullable(),
}).strict().refine(v => v.direction !== "inbound" || v.condition !== null,
  "入荷記録には状態評価が必要です (KMB-E651)");
```

**facade**:
- `recordShipment(input: ShipmentInput): Promise<Result<{ shipment_id: string }>>` — INSERT + crm.appendActivity(system, code='shipment.recorded', ref=shipments/id, link=deal)
- `updateShipment(id, input, expectedUpdatedAt): Promise<Result<void>>` (E103 楽観排他)
- `listShipmentsForDeal(dealId): Promise<Result<ShipmentView[]>>`
- `sendShipmentNotice(shipmentId, input: { to: string; subject: string; body: string }): Promise<Result<void>>` — internal/notify.ts (Resend、sales/internal/email.ts:79-103 同型・添付なし)。成功で notified_at 更新 + activities(email, outbound) 合成 (`crm/contracts.ts:114-122` の zEmailActivityPayload に適合 — document_id/doc_no/version は null)。宛先未定 (顧客 email null) は **E653**、送信失敗 **E652**
- `deleteShipment(id): Promise<Result<void>>` — notified_at 非 NULL は削除拒否 (E664、記録保全)

**エラーコード**: E650 (shipment/対象不在), E651 (入力不整合), E652 (通知送信失敗), E653 (通知先メール未設定)。**削除拒否は横断で E664、状態遷移違反は横断で E665**(E651 の多義化を避ける — 帯内 E664/E665 を追加採番)。

**UI**: `/admin/deals/[id]` に **DealShipmentsCard** (DealDocumentsCard と同型の Surface + 行テーブル)。行アクション: 「受領連絡」「発送連絡」ボタン → メール文面ダイアログ (#63 テンプレを初期文面に差込 — §2.6)。追跡番号はコピーボタン + 追跡 URL リンク (carrier 既知 3 社は URL パターンをフロント定数で持つ)。inbound 記録フォームには condition ラジオ + 写真添付 (#147 の attachments を shipment に紐付け)。

**ジョブ**: なし (全て同期 action)。

**受入基準**:
- [ ] inbound 記録は condition 必須、outbound は tracking_no 入力可で保存できる (E651 検証)
- [ ] 「発送連絡」で顧客 email 宛に Resend 送信され、notified_at が立ち、deal タイムラインに email activity が 1 行載る
- [ ] 顧客 email が無い場合 E653 がトースト表示され、通知なしでも記録自体は残せる
- [ ] 通知済み shipment の削除は拒否される
- [ ] deal 詳細カードに入荷→発送が時系列で並ぶ

**テスト**: zShipmentInput の refine 境界 (vitest 純関数)。notify.ts は Resend をモックし E652/E653 経路。repository は既存規約どおり結合テスト無し (docker 無し — memory: feedback-crm-db-harness。本番適用後 execute_sql 検証)。

---

### 2.2 P5' 工程テンプレ残タスク (work_type 追加) 【中 / S — P1'/P2' と同 PR】

`scheduling_core.sql:189-195` の seed 5 種に追加する冪等 seed のみ (同 migration 20260718000002 に同居可だが所有は scheduling — コメントで明示):

```sql
insert into work_types (key, label, color, consumes_capacity, default_hours, sort_order) values
  ('receiving', '荷受け・検品', '#5c6bc0', true, 0.5, 5),
  ('packing',   '梱包・発送',   '#00897b', true, 1,  60)
on conflict (key) do nothing;
```

既存 work_templates への自動追加はしない (admin がテンプレ編集画面で足す — 全置換保存 `scheduling/facade.ts:192-196` 既存)。**受入基準**: [ ] seed 後、テンプレ編集の work_type 選択肢に 2 種が出る。[ ] 既存テンプレは無変更。

---

### 2.3 P3' 対象物 (パーツ) マスタ + #58 案件カスタムプロパティ 【高+中】

**目的**: 「前回のシリーズと同じ仕様で」に即答する台帳。見積の grade×size×qty 集計 (`pricing/contracts.ts:78-86`) では持てない**個体仕様** (材質・実測サイズ・色番・仕上げ) を deal 配下に持つ。P4' レシピ・P9' ロット・P11' 再注文の参照先。#58 は報告書どおり「本命は P3'」 — 台帳に載らない雑多な案件属性だけ deals.custom_fields (jsonb) で受ける。

**DDL** (`20260719000001_deal_parts.sql` + `20260719000002_crm_deal_custom_fields.sql`):

```sql
create table deal_parts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  name text not null,                    -- 「フィギュア本体」「バンパー右」
  material text,                         -- PLA/PETG/ABS/ASA/レジン/ナイロン/他 (自由入力+UI サジェスト)
  dimensions_note text,                  -- 実測サイズ (自由書式 "H180×W95mm")
  size_key text,                         -- pricing の size クラス文字列参照 (FK なし — work_templates と同規約 0029:62-65)
  grade_key text,
  quantity int not null default 1 check (quantity > 0),
  finish_spec text,                      -- 仕上げ仕様 (半光沢クリア 等)
  color_recipe_id uuid,                  -- P4' 後付け FK (20260720000001_color_recipes.sql = F5 で ALTER)
  color_note text,                       -- レシピ化前の色メモ
  copied_from_part_id uuid references deal_parts(id) on delete set null,  -- P11' 複製の来歴
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deal_parts_deal_idx on deal_parts (deal_id, sort_order);

-- crm 側 (#58): customers_custom_fields (20260715000001) と同型
alter table deals add column custom_fields jsonb not null default '[]'::jsonb;
alter table deals add constraint deals_custom_fields_is_array
  check (jsonb_typeof(custom_fields) = 'array');
```

**契約**: `zDealPartInput` (上記列の Zod 化、name=zShortText(80)、material max30、quantity 1..9999)。#58 は `crm/contracts.ts` の zCustomerCustomFields (`crm/contracts.ts:309-315`) を**そのまま流用**して `zDealUpdateInput` に `custom_fields: zCustomerCustomFields` を必須追加 (silent-wipe 防止規約 `crm/contracts.ts:349-352` を踏襲)。DealDetail 型 (`crm/contracts.ts:544-550`) に `custom_fields` を追加。

**facade (fulfillment)**: `listPartsForDeal(dealId)` / `savePart(input, id|null, expectedUpdatedAt|null)` / `deletePart(id)` / `copyPartsToDeal(fromDealId, toDealId): Result<{ copied: number }>` (P11' 用 — copied_from_part_id を刻む)。part 不在 E650、参照中 (lots/inspections から) の削除は E664。

**UI**: deal 詳細に **DealPartsCard** (行内編集シート — customers の編集 Sheet と同型)。material はサジェスト付き自由入力 (datalist)。#58 は DealOverviewCard の編集フォーム末尾に「カスタム項目」(customers 編集画面の同機能と同一コンポーネント流用)。

**受入基準**:
- [ ] 案件にパーツを複数登録・並べ替え・編集・削除できる
- [ ] deals.custom_fields が顧客カスタム項目と同じ UI/検証 (重複 label 拒否・max50) で編集できる
- [ ] 旧クライアント (custom_fields 未送信) の保存は E101 で拒否される (wipe しない)
- [ ] copyPartsToDeal で複製された行に copied_from_part_id が入る

**テスト**: zDealPartInput 境界。zDealUpdateInput の custom_fields 必須化で既存テストの入力 fixture 更新。copyParts の複製属性一覧 (レシピ ID を含む) の写像テスト。

---

### 2.4 P4' 実車カラーコード・調色レシピ管理 【高】

**目的**: 「トヨタ 202 ブラック再現」等の調色ノウハウを検索可能な資産にする。同色リピートの品質安定 + 調色時間短縮。パーツ (P3') と案件から参照。

**スコープ**: レシピ台帳 CRUD・検索 (メーカー/コード/名前)・パーツへの紐付け・実績写真 (#147 添付流用)・使用履歴 (どの deal で使ったか = deal_parts 逆引き)。**非スコープ**: 塗料在庫管理、配合の数値計算/計量連携、公開ページ掲載 (P7' 系は別トラック)。

**DDL** (`20260720000001_color_recipes.sql`):

```sql
create table color_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,                  -- 「トヨタ 202 ブラック (艶あり)」
  maker text,                          -- トヨタ/ホンダ/ガイア/クレオス…
  color_code text,                     -- '202' 'H-2' 等
  base_paints text,                    -- 使用塗料 (自由書式・改行区切り)
  formula text,                        -- 配合 (自由書式 — 数値構造化はしない。1人工房の記録実態はメモ)
  clear_spec text,                     -- クリア仕様
  process_note text,                   -- 下地条件・注意点
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index color_recipes_search_idx on color_recipes (maker, color_code);
-- 同 migration (20260720000001 = F5) 内で FK を一括後付け:
alter table deal_parts add constraint deal_parts_recipe_fk
  foreign key (color_recipe_id) references color_recipes(id) on delete set null;
alter table fulfillment_attachments add constraint attachments_recipe_fk
  foreign key (color_recipe_id) references color_recipes(id) on delete set null;
```

**契約**: `zColorRecipeInput` (name 必須 zShortText(60)、他 nullable、formula max4000)。読み取りビュー `ColorRecipeView` に `usage_count` (deal_parts count) と `last_used_deal: {id,title}|null` を合成。

**facade**: `listColorRecipes(filter: { q: string|null; include_inactive: boolean })` / `saveColorRecipe(input, id|null, expectedUpdatedAt|null)` / `getColorRecipe(id)` (使用 deal 一覧つき) / `deleteColorRecipe(id)` (使用中は is_active=false を促す E664)。

**UI**: 新ページ `/admin/recipes` (ナビ「製造・請求」グループに追加 — `nav-items.ts:81-86`)。DataTable + 検索 + 編集 Sheet。詳細に「使った案件」リスト + 写真 (fulfillment_attachments where color_recipe_id)。deal_parts 編集シートに EntityPicker (既存 `_ui/entity-picker.tsx`) でレシピ選択。

**受入基準**:
- [ ] メーカー/コード/名前で部分一致検索できる
- [ ] パーツにレシピを紐付け、レシピ詳細から使用案件へ辿れる
- [ ] 使用中レシピの削除は拒否され、無効化はできる
- [ ] 写真を添付・閲覧できる (#147 依存)

**テスト**: 検索フィルタの query 構築純関数、usage_count 合成の写像。

---

### 2.5 #147 案件添付ファイル管理 【高 / 本トラックの土台 — 最初に敷く】

**目的**: 参考画像・塗装指示書・入荷写真・検品写真・完成写真を案件 (+レシピ) に紐付けて一元管理。P1'/P8'/#97 の写真面の土台。

**スコープ**: 非公開バケット + 添付台帳 + 署名付き URL アップロード/閲覧 + kind タグ + ポータル公開フラグ。**非スコープ**: 3D データのプレビュー、画像加工、works 事例への転用ワンクリック (P7' — 別トラック)、メール添付の自動取込 (#100 mail の領分)。

**DDL** (`20260718000001_fulfillment_core.sql` — モジュール初回 migration):

```sql
insert into storage.buckets (id, name, public) values ('fulfillment-files','fulfillment-files', false)
  on conflict (id) do nothing;
-- storage.objects ポリシー: admin SELECT/INSERT (0003 の media-originals パターン)

create table fulfillment_attachments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete restrict,
  color_recipe_id uuid,                          -- FK は 20260720000001_color_recipes.sql (F5) で後付け
  shipment_id uuid,                              -- 文脈タグ。FK は 20260718000002_fulfillment_shipments.sql (F2) で後付け。NULL 可
  inspection_id uuid,                            -- FK は 20260721000001_inspections.sql (F6) で後付け
  kind text not null check (kind in
    ('reference','instruction','intake_photo','inspection_photo','work_photo','shipping_photo','recipe_photo','other')),
  storage_path text not null unique,             -- fulfillment-files/<uuid>_<safe-name>
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  caption text,
  visible_on_portal boolean not null default false,   -- #97: 顧客に見せる写真だけ true
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint attachments_one_root check (num_nonnulls(deal_id, color_recipe_id) = 1)  -- activity_links 前例 (crm_core.sql:165)
);
create index fulfillment_attachments_deal_idx on fulfillment_attachments (deal_id, created_at desc);
```

**アップロード経路**: `/api/upload-url` (route.ts:21-40) の `kind` enum に `'attachment'` を追加 (platform 契約 `zCreateUploadUrlReq` の enum 拡張 — module-contracts §4.7 改訂) → bucket `fulfillment-files`。アップロード完了後に `registerAttachment(input)` で台帳 INSERT (storage 実体の存在確認は service client で head)。

**契約/facade**: `zAttachmentInput` (kind/deal_id|recipe_id/file_name max200/content_type は image/*, application/pdf のみ許可 — 逸脱 **E655**、size ≤ 25MB)。`registerAttachment` / `listAttachments(target: {deal_id}|{color_recipe_id}, kind?)` / `getAttachmentUrl(id)` (署名付き URL 10 分 — 失敗 **E654**) / `updateAttachment(id, {caption, kind, visible_on_portal})` / `deleteAttachment(id)` (storage 実体も削除、失敗時は台帳残しで E654)。

**UI**: deal 詳細 **DealAttachmentsCard** (kind フィルタ pill-toggle + サムネイルグリッド + ドロップゾーン — `_ui/empty-drop-zone.tsx` 流用)。shipment/検品フォームからは kind と文脈 ID を固定した同コンポーネントを再利用。

**受入基準**:
- [ ] 画像/PDF を案件へドラッグアップロードでき、一覧・拡大・削除できる
- [ ] 25MB 超/不許可 MIME は E655 で拒否される
- [ ] visible_on_portal を付けた写真だけが #97 ポータルに出る
- [ ] レシピにも同じ仕組みで添付できる (deal_id/recipe_id は排他)

**テスト**: MIME/サイズ検証の純関数、safe-name 生成 (upload-url 既存関数流用)、one_root 排他の Zod refine。

---

### 2.6 #63 営業メールテンプレート 【高 / S】

**目的**: 見積送付・納期回答・荷受け連絡・発送通知・進捗共有の定型文で返信時間を削る。P1'/P2'/P6'/P10' の全送信ダイアログの初期文面源。

**設計**: **DDL なし**。site_settings 新キー `sales_email_templates` (settings 所有 — `docs/module-contracts.md:348` の「新規キーは seed もバックフィルもしない」規約どおり、admin 初回保存で行生成・行なしは既定テンプレ配列へ degrade)。

```ts
// settings/contracts.ts 追記 (module-contracts §4.2 改訂)
export const zEmailTemplate = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/),   // 'quote_send' | 'lead_time_reply' | 'intake_notice' | 'ship_notice' | 'progress_update' | 自由追加
  name: zShortText(30),
  subject: zShortText(120),
  body: z.string().max(4000),
}).strict();
export const zSalesEmailTemplates = z.array(zEmailTemplate).max(30)
  .refine(ts => new Set(ts.map(t => t.key)).size === ts.length, "key が重複しています");
```

**差込変数**: `src/lib/template-vars.ts` (純関数 `renderTemplate(text, vars: Record<string,string>)` — `{{customer_name}} {{deal_title}} {{tracking_no}} {{carrier}} {{ship_date}} {{eta_date}} {{doc_no}} {{total_jpy}} {{portal_url}}` を置換、未解決変数は空文字ではなく `{{…}}` のまま残して送信前に人が気づける)。sales の帳票送付ダイアログ (#101 実装済 UI) と fulfillment の通知ダイアログ両方から import (共有 lib のためモジュール境界違反なし — `src/lib/env.ts` 前例)。

**UI**: `/admin/settings` 配下にテンプレート編集タブ (settings ハブ化済み — R4b)。各送信ダイアログに「テンプレートから挿入」セレクト。

**受入基準**:
- [ ] 既定 5 テンプレが未設定時でも選べる (degrade)
- [ ] 変数が実データで差し込まれ、未解決変数は原文のまま残る
- [ ] 帳票メール送付ダイアログ (#101) と発送通知ダイアログの両方で使える

**テスト**: renderTemplate の置換/未解決/エスケープ境界 (vitest)。

---

### 2.7 P8' 検品記録・リワーク管理 + #93 チケット管理 【高+中】

**目的**: ブリッジ生産の原価/納期のブレ最大要因 (検品と手直し) を記録し、価格改定の根拠を作る。#93 は同じ不具合記録を納品後 (アフター) まで延長したもの — 別機能にせず 1 つの仕組みで持つ。

**スコープ**: 検品実施記録 (`inspections`)・不具合記録 (`defects`、phase=production/after_sales)・リワークブロックの再展開 (app 層合成で scheduling.createBlock)・検品写真 (#147)。**非スコープ**: チェックリストのマスタ管理 (jsonb 自由項目で開始)、統計ダッシュボード (listで代替)、顧客向け不具合公開。

**DDL** (`20260721000001_inspections.sql`):

```sql
create table inspections (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete restrict,
  lot_id uuid,                                   -- P9' 後付け FK
  work_block_id uuid references work_blocks(id) on delete set null,  -- 検品ブロックとの対応 (任意)
  inspected_on date not null,
  checked_count int not null check (checked_count > 0),
  passed_count int not null check (passed_count >= 0),
  failed_count int not null check (failed_count >= 0),
  checklist jsonb not null default '[]'::jsonb,  -- [{label, ok:boolean, note}] — Zod が正
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspections_count_sum check (passed_count + failed_count <= checked_count)
);
create table defects (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete restrict,
  inspection_id uuid references inspections(id) on delete set null,
  part_id uuid references deal_parts(id) on delete set null,
  lot_id uuid,
  phase text not null check (phase in ('production','after_sales')),   -- after_sales = #93 チケット
  category text not null check (category in
    ('layer_line','pinhole','dust','run','color_mismatch','damage','adhesion','missing','other')),
    -- 積層痕残り/ピンホール/ゴミ噛み/垂れ/色ブレ/破損/密着不良/欠品/他
  severity text not null default 'minor' check (severity in ('minor','major')),
  description text,
  status text not null default 'open' check (status in ('open','reworking','resolved','wont_fix')),
  rework_count int not null default 0 check (rework_count >= 0),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint defects_resolved_at check (status not in ('resolved','wont_fix') or resolved_at is not null)
);
create index defects_open_idx on defects (status, phase) where status in ('open','reworking');
```

**契約/facade**: `zInspectionInput` / `zDefectInput` (上記 Zod 化。数量整合 refine → **E663**)。`recordInspection` (INSERT + activities(system, 'inspection.recorded') 合成。lot 加算を伴う場合は §2.8 の単一 RPC 経由) / `listInspectionsForDeal` / `saveDefect` / `listDefects(filter: {phase, status, deal_id?})` / `transitionDefect(id, to, expectedUpdatedAt)` (open→reworking→resolved / open→wont_fix。表外遷移 **E665**)。リワーク展開は **app 層 action** `createReworkBlocksAction(defectId)`: fulfillment.getDefect → scheduling.createBlock (work_type= 元不良カテゴリに応じ sanding/painting、planned_hours=work_types.default_hours) → 成功で defect.rework_count+1 & status='reworking'。scheduling 側失敗は **E658** に変換して返す。

**#93**: 納品後の不具合は同じ defects に phase='after_sales' で記録 (deal は delivered/paid のまま触らない — reopenDeal `crm/facade.ts:205` は「再製作を受注し直す」時だけ人が使う)。一覧 `/admin/deals` 配下ではなく `/admin/quality` は**作らない** (過剰設計)。deal 詳細 **DealQualityCard** + tasks 連携: after_sales defect 作成時に crm.createTask (origin='system', title='アフター対応: …') を自動起票 → 既存タスク一覧/digest/nav-badge (`nav-badges/facade.ts:71-73` の countDueOrOverdueTasks) に自然に載る。**nav-badges 改修不要**。

**受入基準**:
- [ ] 検品記録が数量整合 (pass+fail≤checked) で保存され、タイムラインに載る
- [ ] 不良を分類付きで記録し、「リワークブロック作成」で backlog にブロックが生まれ rework_count が増える
- [ ] 納品後案件にも不具合 (phase=after_sales) を記録でき、システムタスクが自動起票される
- [ ] defect の解決で resolved_at が立つ。表外遷移は E665

**テスト**: 数量 refine 境界、defect 遷移表 (block-state.ts:34-56 と同型の純関数 canTransitionDefect)、リワーク action の scheduling モック合成。

---

### 2.8 P9' ロット管理 【高 / L】

**目的**: 30〜1,000 点のブリッジ生産で「1 案件 1 進捗」の限界を超える。サブロット分割・良品/不良数・分納出荷を可視化。

**スコープ**: `deal_lots` (数量の入れ物) + shipments/inspections/defects への lot_id FK 後付け + deal 詳細のロット表。**非スコープ**: ロット別の work_blocks 生成 (カレンダーがロット数で爆発する — 1 人工房ではブロックは工程単位のまま、ロットは**数の管理**に徹する)、個体シリアル管理、バーコード。

**DDL** (`20260722000001_deal_lots.sql`):

```sql
create table deal_lots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete restrict,
  lot_no int not null check (lot_no > 0),
  label text,                                    -- 「第1便」「色A」
  part_id uuid references deal_parts(id) on delete set null,
  quantity int not null check (quantity > 0),
  good_count int not null default 0 check (good_count >= 0),
  defect_count int not null default 0 check (defect_count >= 0),
  status text not null default 'open'
    check (status in ('open','in_progress','inspecting','ready','shipped','closed')),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, lot_no),
  constraint deal_lots_counts check (good_count + defect_count <= quantity)
);
alter table shipments   add constraint shipments_lot_fk   foreign key (lot_id) references deal_lots(id) on delete set null;
alter table inspections add constraint inspections_lot_fk foreign key (lot_id) references deal_lots(id) on delete set null;
alter table defects     add constraint defects_lot_fk     foreign key (lot_id) references deal_lots(id) on delete set null;
```

**契約/facade**: `zLotInput`。`splitDealIntoLots(dealId, lots: Array<{quantity, label?, part_id?}>)` (一括作成 — Σqty がパーツ総数を超えると **E659**) / `saveLot` / `transitionLot` (表外遷移 **E665**) / `getDealLotSummary(dealId): Result<{ lots: LotView[]; totals: {quantity, good, defect, shipped} }>`。検品記録 (inspections) に lot_id を渡すと good/defect_count をロットへ加算 — **PostgREST 経由の 2 段 UPDATE は原子的でない(INSERT 成功→加算失敗でドリフト)ため、検品 INSERT とロット加算は単一 RPC `fulfillment_record_inspection`(security definer — `crm_reopen_deal` RPC の前例)で同一トランザクション実行する**(整合違反は E663)。shipment (outbound) に lot_id を渡すと lot.status='shipped' へ (分納)。

**UI**: DealPartsCard の下に **DealLotsCard**: ロット表 (lot_no/qty/good/defect/status/出荷日) + 「ロット分割」ダイアログ + meter-bar (`_ui/meter-bar.tsx`) で全体進捗 (shipped/total)。#97 ポータルにも同集計を表示 (分納の既送/残数が顧客に見える)。

**受入基準**:
- [ ] 数量を複数ロットへ分割でき、Σqty 超過は E659
- [ ] ロット指定の検品で良品/不良数がロットに積み上がる
- [ ] ロット指定の発送でロットが shipped になり、deal 全体の分納状況が meter 表示される
- [ ] ロット未使用の小口案件では従来 UI が一切変わらない (カードは 0 件時 CTA のみ)

**テスト**: 分割数量検証・加算写像・ロット遷移表の純関数。

---

### 2.9 P10' 納期回答・キャパ管理 【高】

**目的**: 「今受けると◯月◯日発送」を即答する。1 人工房の最重要経営変数 (受けられるか) を、勘でなく weekly capacity + テンプレ標準時間から出す。過積載も防ぐ。

**スコープ**: scheduling facade に納期算出を追加・deal/新規見積画面のウィジェット・admin ダッシュボードの「今の納期目安」・受付停止フラグ (公開サイト表示)。**非スコープ**: 自動のブロック仮押さえ (提案配置 `proposeBlockPlacement` は既存 — 予約はしない)、顧客ごとの優先度、複数リソース。

**設計 (scheduling 所有 — E706/E707 新規採番)**:

```ts
// scheduling/contracts.ts 追記
export const zLeadTimeQuery = z.object({
  grade_key: z.string().min(1).max(30).nullable(),  // null = 既定テンプレ (ワイルドカード解決 — §7.1 と同カスケード)
  size_key: z.string().min(1).max(10).nullable(),
  quantity: z.number().int().min(1).max(1000),
  from: zDateOnly.nullable(),                        // null = 今日 (JST)
}).strict();
export type LeadTimeEstimate = {
  ship_on: string;                 // 発送可能予測日 (zDateOnly)
  work_hours: number;              // 拘束工数合計 (テンプレ解決結果)
  drying_hours: number;            // 非拘束 (consumes_capacity=false) の合計
  weeks_scanned: number;
  breakdown: Array<{ week_start: string; free_hours: number; allocated_hours: number }>;
};
// facade (契約外拡張): estimateLeadTime(q: LeadTimeQuery): Promise<Result<LeadTimeEstimate>>
```

**アルゴリズム** (internal/lead-time.ts 純関数 + repository 読み): テンプレ解決 (P5'の§7.1 カスケードを `listActiveWorkTemplatesForExpand` で流用) → 拘束工数 Σhours (数量はテンプレ時間に乗算しない既存裁定 J8 `scheduling_core.sql:134` を踏襲。quantity>10 に掛ける `ceil(quantity/10)` 係数は**納期見積という新規 read 計算専用の近似であり、ブロック生成の工数計算 — J8 の対象 — には一切適用しない**と契約コメントに明記する。係数は v1 定数、将来 settings 化) → 今週から `getWeeklyCapacity` (facade.ts:175) を週送りで走査し remaining_hours に工数を詰める → 最終割当週の末 + drying_hours (暦時間) + packing 1 日 = ship_on。テンプレ解決不能は **E706**、52 週走査しても収まらない場合 **E707**。

**受付停止 (settings 新キー)**: `intake_status` = `{ mode: 'open'|'paused', message: string|null }` (zod は settings/contracts.ts、module-contracts §4.2 改訂。DDL 不要)。公開側 (simulator ページ / 問い合わせフォーム上部) に mode='paused' でメッセージ帯を表示。公開表示は server component で service client → `estimateLeadTime` を `unstable_cache` 600 秒 (cron 不要)。表示文言: 「現在の納期目安: 約◯週間 (◯月◯日頃発送)」。

**UI**: admin ダッシュボード (dashboard-cards.tsx) に「今受けたら」カード (標準グレード基準の ship_on)。deal 詳細/帳票新規に「納期を計算」ボタン → grade/size/qty を入れて即答 → 「この納期を返信」ボタンで #63 テンプレ `lead_time_reply` に `{{eta_date}}` 差込済み文面のメールダイアログを開く。

**受入基準**:
- [ ] grade×size×qty から発送予測日が出る (乾燥待ちは非拘束で暦日加算 — `scheduling/contracts.ts:17` の J8 裁定を破らない)
- [ ] 既存ブロックで埋まった週を飛ばして割り当てる (booked_hours 反映)
- [ ] テンプレ未定義は E706、受け切れない場合 E707 のメッセージが出る
- [ ] intake_status=paused で公開サイトに停止帯が出て、シミュレータは動くが「現在新規受付停止中」を明示
- [ ] 納期回答メールがテンプレ差込で 2 クリックで送れる

**テスト**: lead-time.ts 純関数 (週跨ぎ/満杯週スキップ/乾燥暦日/境界: remaining 負値 `scheduling/contracts.ts:109`)。settings degrade (キー無し → mode:'open')。

---

### 2.10 P6' 工程進捗の顧客共有 + #97 顧客セルフサービスポータル 【高 / 二段構え】

**目的**: 「大切な原型を郵送で預けた」不安を消す。P6' = ブロック状態の節目に顧客へメール共有。#97 = 同じデータを限定 URL の進捗ページ (ログイン不要・トークン URL) で常時見せる。「今どうなってますか」問い合わせを消す最大の差別化。

**方針 (1 人工房の裁定)**: ブロック遷移ごとの**自動送信はしない** (研磨→下地→塗装で毎回メールが飛ぶと事故る。乾燥待ち 24h で無音にもなる)。**「共有する」は常にワンクリックの手動**、ポータルは**常時最新の自動**という分担にする。ログイン機構 (Supabase Auth の顧客ロール) は**非スコープ** — トークン URL 方式 (print_tokens 前例 `sales_issuance.sql:100-112`) で全需要を満たす。

**DDL** (`20260723000001_portal.sql`):

```sql
create table progress_updates (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete restrict,
  work_block_id uuid references work_blocks(id) on delete set null,
  title text not null,                    -- 「研磨が完了しました」
  body text,                              -- 顧客向け文章 (社内メモは書かない前提の UI 注記)
  attachment_ids uuid[] not null default '{}',   -- visible_on_portal=true の添付のみ許可 (facade 検証)
  emailed_to text,                        -- 送った宛先 (NULL=ポータル掲載のみ)
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index progress_updates_deal_idx on progress_updates (deal_id, created_at desc);

create table portal_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),  -- sha256 hex (print_tokens 同型)
  deal_id uuid not null references deals(id) on delete cascade,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index portal_tokens_active_deal_uidx on portal_tokens (deal_id) where revoked_at is null;
alter table portal_tokens enable row level security;
revoke all on portal_tokens from anon, authenticated;   -- ポリシーなし = service 専用 (print_tokens 規約)
```

**契約/facade**:
- `issuePortalToken(dealId): Result<{ url: string }>` — 既存 active があれば再利用。`regeneratePortalToken(dealId)` で旧 revoke + 新発行。`revokePortalToken(dealId)`。トークン原文は 32byte random hex、保存はハッシュのみ (**E657** = 無効/失効)
- `postProgressUpdate(input: { deal_id; title; body; attachment_ids; work_block_id|null; email: { to; subject; body } | null })` — INSERT + (email 指定時) internal/notify 送信 + activities(email) 合成。visible_on_portal でない添付指定は **E655**
- `resolvePortalToken(tokenPlain): Result<{ deal_id: string }>` + `getPortalCore(dealId, ctx): Result<PortalCore>` — **service client 専用**。fulfillment が返すのは**自所有データのみ**: progress_updates (title/body/写真) / shipments (direction/carrier/tracking_no/occurred_on) / lots 集計 (P9' 導入後) / visible_on_portal=true の添付。アクセス時 last_accessed_at 更新
- **工程ステップは scheduling 所有のまま scheduling に返させる**(L61 の「fulfillment は work_blocks を直読しない」規約の遵守): scheduling facade に **service 注入型の新 read `getPortalWorkSteps(dealId, ctx): Result<Array<{ work_type_key; label; status: "todo"|"doing"|"done" }>>`** を追加する(sync worker と同じ service client 引数注入。既存 `getDealWorkSummary`(`scheduling/facade.ts:218`)は admin セッション前提のため公開ポータルからは呼ばない)。work_blocks を work_type 単位に集約し backlog→未着手 / in_progress→作業中 / done→完了 に写像。**社内 memo・工数・金額は返さない**
- deal title / stage ラベル(DEAL_STAGE_REGISTRY.label — `crm/contracts.ts:29-41`)は `crmFacade.getDealRef`(fulfillment→crm は許可依存だが、合成は route で行う)
- **公開 route(app 層)が三者を合成する**: `/portal/[token]` page が fulfillment.resolvePortalToken → { fulfillment.getPortalCore + crm.getDealRef + scheduling.getPortalWorkSteps } を service 文脈で合成(§7.7 の sales⇄scheduling app 層合成前例と同型)。**単一 facade メソッドで全モジュール横断データを返す形にはしない**

**公開ページ**: `src/app/(portal)/portal/[token]/page.tsx` (route group 新設 — (print) の前例)。noindex、OGP なし、モバイル前提の 1 カラム: ステップ表示 (stage-progress の公開版を新規実装 — admin の `.admin-theme` トークンは使わず site 側スタイル)、進捗フィード、発送情報。Server Component + service client、`revalidate = 0` (常に最新)。

**UI (admin)**: deal 詳細 **DealPortalCard**: ポータル URL 表示/コピー/再発行/停止。カレンダーのブロック完了ダイアログ (recordActual 後) に「お客さんに進捗を共有」ボタン → postProgressUpdate ダイアログ (テンプレ `progress_update` 差込、visible 添付の選択、送信 or ポータル掲載のみ)。

**受入基準 (P6')**:
- [ ] ブロック完了後 2 クリックで「研磨が完了し、下地に入りました」メールが送れる (テンプレ差込)
- [ ] メールに portal_url が差し込まれる
- [ ] 共有履歴が deal タイムラインとポータル両方に載る
**受入基準 (#97)**:
- [ ] トークン URL で誰でも (ログインなし) 進捗ページが見える。revoke で即 404 相当 (E657 画面)
- [ ] 工程ステップに社内メモ・金額・工数が**露出しない** (PortalView 射影テスト)
- [ ] 発送後は追跡番号が出る。visible_on_portal=true の写真だけ出る
- [ ] token 総当たり耐性: 256bit ランダム + ハッシュ保存 + アクセスログ (last_accessed_at)

**テスト**: PortalCore と getPortalWorkSteps の射影から除外フィールド (memo/工数/金額) が漏れない網羅テスト (最重要)、token hash/照合純関数、work_blocks→ステップ集約写像 (scheduling 側 unit)。

---

### 2.11 P11' リピートオーダー導線 【高 / S〜M】

**目的**: シリーズ物作家・BtoB 量産移行の再注文の摩擦をゼロへ。deriveDocument が同一 deal 専用 (`sales/facade.ts:872`) である穴を app 層合成で埋める。

**設計 (新テーブルなし・app 層 action)**: `createRepeatDealAction(sourceDealId)`:
1. crm.getDealRef (customer 解決 — merged 終端解決込み `crm/facade.ts:606`)
2. crm.createDeal ({ title: `${元title} (リピート)`, customer_id, company_id, stage: 'estimating', source: 'manual', amount_jpy: 元 deal の額, notes: 元 deal 参照行を自動記載 })
3. fulfillment.copyPartsToDeal(source, new) (§2.3 — レシピ紐付けごと複製。**E662** = 複製失敗時に deal だけ残った旨を detail に含めて返す)
4. crm.appendActivity(system, code='repeat.created', 両 deal に link — links 配列は `crm/contracts.ts:213-220` の複数リンク仕様で 1 回で書ける)
5. simulator スナップショットが元 deal にあれば `simulator_estimate` activity を新 deal に複製 (payload 同一・ref 合成キー 'deals/repeat-'+sourceId)

**リマインド (時間経過トリガーの再商談化)**: 新ジョブは作らない。発送記録 (P2') の保存ダイアログに「◯ヶ月後にフォロータスクを作る」チェック (既定 off、3/6/12 ヶ月) → crm.createTask (origin='system', due_on=+Nヶ月, title='次弾フォロー: {deal}') 。期日が来れば既存 crm-digest (7:00 JST メール — `20260711000024_crm_digest_cron.sql:39`) と nav バッジに自然に載る。

**UI**: deal 詳細ヘッダ (DealHeaderActions.tsx) に「この案件をもとに再注文」。顧客詳細の案件リスト行にも同アクション。

**受入基準**:
- [ ] 過去案件 (paid/delivered 含む任意ステージ) から 1 クリックで新 deal がパーツ・レシピ・見積スナップショット込みで生成される
- [ ] 両案件のタイムラインに相互参照が残る
- [ ] 発送時にフォロータスクを 1 チェックで仕込め、digest に載る

**テスト**: action の合成順序 (crm/fulfillment モック)、部分失敗時 (parts 複製失敗) のユーザー向けメッセージ、simulator payload 複製の冪等キー。

---

### 2.12 #90 ステージ移動時の必須項目強制 + #36 ライフサイクル自動遷移 【中 / セット】

**現状**: lifecycle 自動昇格 (won→customer) は実装済み (`crm/facade.ts:682-742`)。ステージガードは E602 の遷移マトリクスのみで**業務データ条件は無い**。sales には「入金完済→stage 'paid' 提案」の提案適用パターンが既にある (`docs/module-contracts.md:1809`、DealRef.updated_at `crm/contracts.ts:289`)。**さらに重要な既存事実: ステージは帳票発行によって既に app 層で前進駆動されている** — `src/app/admin/documents/actions.ts:57` の doc_type→stage マップ(quote→quote_sent / order→ordered / delivery→'delivered' / invoice→invoiced)+ `:181` の `crmFacade.updateDealStage(...)`(module-contracts §7.6)。つまり現状でも納品書を発行すれば shipment 記録なしで stage='delivered' になる。#90/#36 はこの経路を取りこぼしてはならない。

**#90 設計 (fulfillment facade + app 層ゲート)**:

```ts
// fulfillment facade
checkStageRequirements(dealId: string, to: DealStage):
  Promise<Result<{ ok: true } | { ok: false; violations: Array<{ rule: string; message: string }> }>>;
```

v1 ルール (コード内定数 `STAGE_REQUIREMENTS` — 設定画面は作らない):
- `to='in_production'`: inbound shipment (purpose='intake') が 1 件以上 → 無ければ違反「荷受け記録がありません」
- `to='delivered'`: outbound shipment (purpose='delivery') かつ tracking_no 非 NULL が 1 件以上 → 「発送記録 (追跡番号) がありません」

deals の stage 変更 action (`src/app/admin/deals/actions.ts` の updateDealStage 呼び出し前) で checkStageRequirements → 違反時は確認ダイアログ「不足: … / それでも移動 (理由必須)」→ 強行時は理由を activities(system, 'stage.forced') に記録して updateDealStage 実行。ハードブロックにしない (1 人工房で自分を止めすぎない)。facade が返す違反は **E656** ではなく ok:false 構造で返し、E656 は「強行理由なしの強行要求」のみに使う。

**ゲートの結線範囲(迂回防止)**: checkStageRequirements は deals のステージ変更 action だけでなく、**帳票発行経由のステージ前進(`documents/actions.ts:181`)にも共通の薄い app 層ラッパ `guardedUpdateDealStage(dealId, to, updatedAt, force?)` として結線する**。全ステージ変更入口がこのラッパを通る。納品書発行→delivered の経路でも発送記録(追跡番号)が無ければ不足理由ダイアログが出る。**'delivered' の駆動源の裁定**: 発送記録(物理)を正とし、納品書発行による前進は「帳票整合の副次遷移」としてゲート付きで存続させる(二重駆動の意味を固定 — どちらの経路でも同一ゲートを通るため矛盾しない)。

**#36 設計 (業務イベント→ステージの前向き自動化・app 層)**:
- `recordShipment(outbound, purpose='delivery')` 成功後、action が deal.stage を確認し in_production なら**その場で** crm.updateDealStage(deal,'delivered',updated_at) を実行 (E602/E103 失敗はトーストで「手動で移動してください」に degrade — 自動化は best-effort、記録自体は成功扱い)
- ブロック transitionBlock(to='in_progress') 成功後、deal.stage='ordered' なら「製作中へ移動しますか」の 1 クリック提案バー (sales の入金→paid 提案と同型 UX)
- inbound shipment 記録後、stage='ordered' のままなら同様に in_production を提案
- lifecycle (顧客) 側は既実装のため触らない

**受入基準**:
- [ ] 発送記録なしで delivered へ動かすと不足理由が表示され、理由入力で強行できる (理由がタイムラインに残る)
- [ ] **納品書発行経由の delivered 前進にも同じゲートが効く**(発送記録なしなら不足理由が出て、強行/中断を選べる)
- [ ] 発送記録 (delivery) を保存すると in_production の案件が自動で delivered になり、タイムラインに stage 遷移が残る
- [ ] 自動遷移失敗 (楽観排他) でも発送記録は失われない
- [ ] 提案バーは無視しても再表示されるだけで強制しない

**テスト**: STAGE_REQUIREMENTS 判定純関数 (shipments fixture)、強行経路の activity 記録、自動遷移 best-effort の失敗系 (updateDealStage モック E103)。

---

### 2.13 #140 アウトバウンド Webhook + #139 マーケットプレイス代替 【中】

**目的**: 配送業者連携・Zapier 的外部連携の最小手段。**#139 は独自マーケットプレイス/OAuth アプリ基盤を作らない** — 「#140 webhook + 受信側 (Zapier/Make/自作 GAS) で実質代替」を設計上の正式立場とする (v2 レポート 243 行の判定どおり)。API キー発行・公開 REST API は本トラック**非スコープ** (需要が出た時に別 Issue — 1 人工房に外部開発者はまだ居ない)。

**DDL** (`20260724000001_webhooks.sql`):

```sql
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,                      -- https のみ (Zod)
  secret text not null,                   -- HMAC-SHA256 署名鍵 (表示は末尾4桁のみ)
  events text[] not null,                 -- 購読イベント key 配列
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivering','delivered','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status_code int,
  last_error text,
  created_at timestamptz not null default now()
);
create index webhook_deliveries_pending_idx on webhook_deliveries (next_attempt_at) where status in ('pending','failed');
-- deliveries は service 書込 + admin select (telephony call_jobs の RLS 前例)
```

**イベント (v1 固定 6 種)**: `deal.stage_changed` / `shipment.recorded` / `shipment.notified` / `inspection.recorded` / `defect.opened` / `progress.posted`。発火は fulfillment facade / deals action の成功パス末尾で `enqueueWebhookEvent(eventKey, payload)` (INSERT のみ・失敗は console.warn の best-effort — 主操作を落とさない)。

**配送方式(段階導入 — 過剰設計ガード)**: 外部開発者・受信側がまだ居ない現状に対し pg_cron worker + lease + backoff 一式は重いため、**v1 は fire-and-forget**とする: enqueue(webhook_deliveries INSERT)直後、同一の action/after() 内で単発 POST を 1 回試行(headers: `X-KMB-Event`, `X-KMB-Delivery-Id`, `X-KMB-Signature: sha256=hex(hmac(secret, body))`, timeout 10s)し、成否を deliveries 行に記録するだけ。リトライ・lease・pg_cron は作らない。URL/secret 検証不正は **E660**、送信失敗は status='failed' + last_error(**E661**)。
**v2 昇格条件**: 具体的な受信側(Zapier/Make/GAS 等)が現れ、取りこぼしが実害になった時点で、pg_cron 5 分毎 worker(`kmb-webhook-worker` — `crm_digest_cron.sql:28-39` 同型)+ pending 20 件 lease + backoff (1m/15m/2h)・3 回 failed へ昇格する(webhook_deliveries のスキーマは v2 前提の列 — attempts/next_attempt_at — を最初から持つため昇格時に migration 不要)。

**UI**: `/admin/settings` に「外部連携 (Webhook)」タブ: エンドポイント CRUD + イベントのチェックボックス + 「テスト送信」ボタン (`{event:'ping'}`) + 直近配送 20 件の状態表。

**受入基準**:
- [ ] 発送記録で購読エンドポイントに署名付き JSON が届く (受信側で HMAC 検証可能)
- [ ] 受信側 500 の場合 failed として記録され一覧で見える (自動リトライは v2 昇格時 — v1 は手動再送ボタン)
- [ ] webhook 障害が本体操作 (発送記録等) を一切阻害しない
- [ ] テスト送信で疎通確認できる

**テスト**: HMAC 署名生成純関数、backoff 計算、lease/リトライ状態遷移 (repository モック)。

---

## 3. Issue 分割案 (1 Issue = 1 PR)

依存グラフ: F1 → {F2, F4} → 以降。F3/F9 は独立で並行可。Track1 (intake-comms-foundation) への依存は F2/F6/F8 のメール送信部が「文面テンプレ (#63)」を使う点のみで、Resend 送信自体は既存資産のため**ブロックしない** (F3 未完なら既定文面で動く)。

| # | タイトル案 | 含む項目 | 依存 | 規模 | 主な成果物 |
|---|---|---|---|---|---|
| F1 | fulfillment モジュール新設 + 案件添付ファイル (#147) | #147、モジュール骨格、E650-679 帯、bucket、module-contracts v2.10 改訂 | なし | M | `20260718000001_fulfillment_core.sql`、contracts/facade/repository、DealAttachmentsCard、upload-url kind 拡張 |
| F2 | 荷受け・発送記録と通知メール (P1'+P2'+P5') | P1' P2' P5' | F1 | M | `20260718000002_fulfillment_shipments.sql` (shipments + work_type seed + fulfillment_attachments.shipment_id FK 後付け)、DealShipmentsCard、notify.ts、受領/発送メール |
| F3 | 営業メールテンプレート (#63) | #63 | なし | S | settings キー zSalesEmailTemplates、`src/lib/template-vars.ts`、設定タブ、送付ダイアログ組込 (sales #101 UI 改修含む) |
| F4 | パーツ台帳 + 案件カスタム項目 (P3'+#58) | P3' #58 | F1 | M | `20260719000001_deal_parts.sql`、`20260719000002_crm_deal_custom_fields.sql`、DealPartsCard、DealOverviewCard 拡張 |
| F5 | 調色レシピ管理 (P4') | P4' | F1, F4 | M | `20260720000001_color_recipes.sql` (+deal_parts FK+fulfillment_attachments FK 後付け)、/admin/recipes、ナビ追加、レシピ添付 |
| F6 | 検品記録・リワーク (P8') | P8' (defects は phase='production' まで) | F1, F2 | M | `20260721000001_inspections.sql` (+fulfillment_attachments.inspection_id FK 後付け+`fulfillment_record_inspection` RPC)、DealQualityCard、リワークブロック生成 action |
| F7 | アフター不具合チケット (#93) | #93 | F6 | S | defects phase='after_sales' の UI/一覧タブ/システムタスク自動起票 |
| F8 | 進捗共有とポータル最小版 (P6') | P6' + portal_tokens + /portal/[token] 骨格 | F1, F3(soft) | M | `20260723000001_portal.sql`、DealPortalCard、進捗共有ダイアログ、公開ページ (app 層合成)、**scheduling.getPortalWorkSteps (service-read) 追加** |
| F9 | 納期回答・受付停止 (P10') | P10' | なし (scheduling 単独) | M | scheduling contracts/facade 拡張 (E706/E707)、internal/lead-time.ts、ダッシュボードカード、intake_status キー、公開表示 |
| F10 | ステージガードと自動遷移 (#90+#36) | #90 #36 | F2 | S〜M | checkStageRequirements (E656)、**guardedUpdateDealStage ラッパを deals action と documents 発行 action の全入口に結線**、強行理由、発送→delivered 自動遷移、提案バー |
| F11 | リピートオーダー導線 (P11') | P11' | F4 | S〜M | createRepeatDealAction、フォロータスク仕込み、deal/顧客 UI 導線 |
| F12 | ロット管理・分納 (P9') | P9' | F2, F6 | L | `20260722000001_deal_lots.sql` (+3 FK 後付け)、DealLotsCard、検品/発送のロット連動、ポータル分納表示 |
| F13 | ポータル拡充 (#97) | #97 (発送・写真・ロット表示、E657 画面、再発行/停止運用) | F8, F2 (F12 soft) | M | PortalCore/合成ビュー拡張 (app 層合成維持)、射影テスト、アクセス記録 |
| F14 | アウトバウンド Webhook (#140、#139 は代替宣言) | #140 #139 | F2 (イベント発火元) | S〜M | `20260724000001_webhooks.sql`、**v1 fire-and-forget 送信 (pg_cron/リトライは昇格条件付き)**、設定タブ、テスト送信 |

**計 14 Issue** (S:3 / S〜M:2 / M:8 / L:1)。推奨着手順: **F1 → F2 → F3 → F9 → F10 → F4 → F8 → F6 → F11 → F5 → F7 → F13 → F12 → F14**。F1〜F3+F9〜F10 で「荷受け連絡・発送通知・納期即答・ステージ整合」という日次の手作業削減が先に立ち、その後に台帳系 (F4-F7)・顧客体験系 (F8/F13)・スケール系 (F12/F14) を積む。

## 4. 横断の受入基準・テスト方針

- [ ] 全新規テーブルが RLS (admin 4 ポリシー + revoke anon) または service 専用 (portal_tokens/webhook_deliveries) — 0029/print_tokens パターン踏襲
- [ ] エラーコードは fulfillment=E650-679、scheduling 追加=E706/E707 のみ。**E840-859 (#100 予約) 不使用**、crm/sales の既存コード意味変更なし
- [ ] module-contracts.md を各 Issue の先頭コミットで改訂 (§8 手順: 本書→DDL→contracts.ts の 3 点一致)
- [ ] 顧客宛メールは全て「送信台帳 or notified_at + activities(email) 合成」の二重記録 (#101 パターン) — #100 mail 導入時に BCC 取込へ移行可能な形
- テスト: vitest 純関数 (状態遷移表/数量整合/差込/署名/納期計算/PortalView 射影) を各 Issue に必須で付ける。DB 結合はハーネス無し (memory 方針) のため repository は本番適用後 execute_sql 検証。E2E は行わない (CI Actions 無し)
- 過剰設計ガード: 担当者/ロール/権限分岐は全 Issue で凍結。設定画面化 (STAGE_REQUIREMENTS・リワークカテゴリ→工程対応・納期係数) はコード内定数で開始し、変更要求が 2 回起きるまで昇格しない
