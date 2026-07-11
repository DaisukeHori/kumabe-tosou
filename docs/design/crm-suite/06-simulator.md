# 隈部塗装 CRM スイート — 通販シミュレーター設計書 (06-simulator)

- 版: v1.2 (2026-07-11: §17/§16 の「00 §13 Phase 4 合算 2,200 と整合」宣言を撤回し、00-overview v1.2 の改訂値 〜3,500 (05+06 合算) に追随)。旧: v1.1 (2026-07-11: レビュー指摘反映 — 末尾の更新履歴参照)。初版 v1.0 同日
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **pricing モジュール既存拡張の親設計** (裁定 J10)。所有テーブルの新設なし・migration なし・新規エラーコードなし (00-overview §10 の割当どおり)。本書は (0) 本番 /shop シミュレーター修理、(a) シミュレーター結果の構造化リード化、(b) SEC.01 カード価格の DB 駆動化、(c) zEstimateInput.quantity 999/1000 不整合是正、の 4 点の正。
- 上位 canonical: [00-overview.md](./00-overview.md) (M0 共通基盤・認可総表・エラーコード全表) / [07-contracts-delta.md](./07-contracts-delta.md) (値契約 — 特に §D6 quantity 是正、§D7 zSimEstimateSnapshot・activity payload、§D8 facade、§D9 lead.intake イベント)。**本書は canonical 契約を再定義しない (引用のみ)**。
- 姉妹文書: 01-crm.md (`CrmFacade.intakeFromSimulator` の実装が親)、02-sales.md (`SalesFacade.createDraftQuoteFromEstimate` の行組み立て・帳票様式が親)、05-site-settings.md (公開サイト設定系)
- 入力資料: 設計ブリーフ R6・裁定 J6・調査 (simulator-archaeology / gap-prod-shop / gap-prod-db / repo-map / design-conventions)。**本書の事実記述は 2026-07-11 の実コード Read で全件裏取り済み** (該当箇所に行番号を付す)
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提: migration 0001〜0020 適用済み・本番価格 seed 完全投入済み (gap-prod-db 確定: grades=3/sizes=4/matrix=9/tiers=2/options=1)。M0 (Phase 1) の E105 登録・crm (Phase 2)・sales (Phase 3s) が (a) のブロッカー。(0)(b)(c) は独立に着手可

---

## 0. 業務シナリオ

### 0.1 いま起きていること — 「前はあったのに、無くなった」

模型好きの会社員が、夜、スマホで隈部塗装の SHOP ページを開く。「サイズ × 個数 × グレード。3つ選べば、概算が出る。」と見出しは出ているのに、その下には**「価格はお問い合わせください。」の一行だけ**。選ぶボタンも金額も出ない。実は古いホームページ (引っ越し前のもの) が今も残っていて、そちらでは計算機がちゃんと動く。新しいページの奥には正しい価格表がきちんと入っているのに、**引っ越し初日に「まだ値札がありません」と印刷された案内板が、そのまま貼りっぱなし**になっている — それが今の状態である。

### 0.2 修理された日 — 「3つ選べば、概算が出る」

案内板を貼り替える合図をひとつ送ると、ページは倉庫の価格表を読み直し、グレード 3 択・サイズ 4 択・個数の増減ボタン・特急チェックが現れる。以後は、熊部さんが管理画面で価格を変えても、値札の書き替えを忘れても、**遅くとも 2 時間ほどでページが自分で読み直す** (二層キャッシュの失効が重なる最悪ケース。通常は即時〜1 時間 — §10.3)。案内板の貼りっぱなし事故は構造的に起きなくなる。

### 0.3 相談が「そのまま」届く — コピー&ペーストの廃止

これまでは概算を出した後、「注文する」を押すと内容が**クリップボードに写され、相談フォームに自分で貼り付ける**仕組みだった。貼り忘れれば内容は消える。これからは「この内容で問い合わせる」を押すと、名前と連絡先を添えるだけでそのまま届く。翌朝、熊部さんが管理画面を開くと「新しい相談」が 1 件 — 誰が・何を・何個・いくらぐらいの話かが整理され、**そのお客さんのページと案件、そして見積書の下書きまで自動で用意されている**。熊部さんは下書きを開いて金額を確かめ、「よし」と言うだけでよい。

### 0.4 値札が勝手に追いつく — カード表示と価格表の連動

SHOP の上段には「下地仕上げ ¥7,000〜」のようなカードが 3 枚並ぶ。これまでこの金額は**手書きの貼り紙**で、管理画面から価格を改定してもカードは古い金額のままだった。これからはカードの金額も価格表から直接読む。値上げしても値下げしても、シミュレーターとカードの金額が食い違うことはもうない。

---

## 1. スコープと確定裁定

### 1.1 スコープ (裁定 J6 との対応)

| # | 機能 | 裁定 | 本書の対応章 |
|---|---|---|---|
| (0) | 本番 /shop 修理: 原因切り分け (env → revalidateTag('prices') 実測) + 恒久策 (revalidate 設計是正 + seed 運用手順化) + 旧 GitHub Pages 残置の扱い | ✅ 最優先 (Phase 0) | §2 |
| (a) | シミュレーター結果 → 構造化リード化 (「この内容で問い合わせる」→ inquiry + 顧客 + 案件 + 見積原案)。クリップボードコピー UX は置換 | ✅ (Phase 4、crm/sales 依存) | §5〜§7 |
| (b) | shop.grade.N.price テキストスロットと price_matrix の非連動解消 (DB 駆動表示化) | ✅ | §4.5 / §7.2 |
| (c) | zEstimateInput.quantity max 999 → 1000 是正 | ✅ (canonical は 07 §D6) | §4.1 |

「復活」の実態確定 (simulator-archaeology + gap-prod-shop、2026-07-11): シミュレーターは消滅していない。DB 駆動版が `/shop` に実装・デプロイ済みで、**本番 SSR の `getActivePriceTable()` が有効な価格表を返さないために fallback 文言に置換されている** (shop-simulator.tsx L180-189 の early return を実 Read で確認)。よって本書のタスクは「復活」ではなく**「修理 + CRM 接続強化」**である。

### 1.2 スコープ外

| 項目 | 理由・扱い |
|---|---|
| 新テーブル・新品目マスタ | 裁定 J6 で禁止。pricing 既存 5 テーブル行列 (price_grades / price_size_classes / price_matrix / price_quantity_tiers / price_options) を流用 |
| 帳票の様式・PDF・発行フロー | 02-sales.md が正。本書は見積原案への**変換契約の入力側意味論**のみ (§5.4) |
| 顧客 dedup・deal 作成・activity 記録の実装 | 01-crm.md が正。本書は呼び出し契約の消費者 |
| EC カード決済・カート | 既存どおり銀行振込前払い (現行表記維持、00 §0.5) |
| SEC.03 (塗装済み製品) / SEC.04 (購入フロー) | 変更なし |
| 計算ロジックの変更 | `computeEstimate()` は legacy 完全互換 (ゴールデンテスト 24 件) のまま不変。演算順序・丸め位置に一切手を入れない |
| 旧 GitHub Pages の閉鎖・リダイレクト作業 | 堀さん確認事項 9 (§2.5)。本書は判断材料の整理のみ |

### 1.3 モジュール構成上の位置 (裁定 J10 遵守)

- **pricing (既存拡張)**: contracts の quantity 是正 (§4.1)、`price-display.ts` 純関数追加 (§4.5)、facade の unstable_cache オプション変更 (§2.4)。**pricing に crm / sales / inquiry への import は一切追加しない**
- **site-public (app 層)**: `/shop` ページ・`ShopSimulator`・新規リードフォーム・`POST /api/shop/lead` route。リード接続は route handler の **app 層合成** (`InquiryFacade` → `CrmFacade` → `SalesFacade`、00 §2.3 / 07 §7.8) — J10 の「facade 経由」を依存を増やさず満たす
- 所有テーブル: **なし** / migration: **なし** (00 §10 で「なし」割当 — 帯の消費ゼロ) / 新規エラーコード: **なし** (E101/E103/E105/E901 共用 + crm 所有 E607 の参照) / nav-items 追加: **なし** (公開サイト側)

依存方向 (00 §2.2 と 1:1):

```
site-public ──→ pricing / inquiry / page-media / settings (read facade、既存)
             └→ /api/shop/lead (route) ──→ InquiryFacade + CrmFacade + SalesFacade (app 層合成)
pricing     ──→ platform のみ (変更なし)
```

---

## 2. 本番修理 (J6-(0)) — 原因切り分けと恒久策

### 2.1 確定事実 (実コード裏取り済み)

| # | 事実 | 根拠 (2026-07-11 Read) |
|---|---|---|
| F1 | 本番 /shop の #sim は「価格はお問い合わせください。」fallback 表示 | gap-prod-shop 実測 + `shop-simulator.tsx` L180-189 の early return (`!priceTable || grades.length === 0 || ...`) |
| F2 | 本番 DB の価格 seed は完全投入済み (3/4/9/2/1 件、seed 期待値と全一致) | gap-prod-db §4 (anon REST 実測)。**「テーブル空」原因は棄却済み** |
| F3 | `/shop` ページに `export const revalidate` / `dynamic` 指定なし → 静的プリレンダ | `src/app/(site)/shop/page.tsx` 全 36 行 (指定なしを確認) |
| F4 | `getActivePriceTable()` は `unstable_cache(..., ["pricing-active-table"], { tags: ["prices"] })` — **revalidate TTL なし = 無期限** | `src/modules/pricing/facade.ts` L78-82 |
| F5 | seed 投入スクリプトは revalidate を一切呼ばない | `scripts/seed-from-legacy.ts` grep "revalidate" = 0 件 |
| F6 | admin 保存経路は `revalidateTag("prices")` + `revalidatePath("/shop")` を呼ぶ (正常) | `src/app/admin/prices/actions.ts` L141-143 |
| F7 | `POST /api/revalidate` が存在。認可 = `x-revalidate-secret` (REVALIDATE_SECRET、未設定時 503)。body = `zRevalidateReq` = `{ tags: string[] (1..20) }` | `src/app/api/revalidate/route.ts` 全文 + `platform/contracts.ts` L97 |
| F8 | REVALIDATE_SECRET は optional env (`isRevalidateSecretConfigured()`) | `src/lib/env.ts` L39/L102 |

### 2.2 障害メカニズム (最有力 = ③ Data Cache 焼き付き)

```
時系列 (推定・F1〜F6 と整合する唯一の説明):
1. 価格 seed 投入前のあるビルドで /shop がプリレンダされる
   → getPriceTable() が空配列を「正常返却」→ unstable_cache が空テーブルを
     tag='prices'・TTL 無期限で Vercel Data Cache に保存
   → fallback 文言の HTML が Full Route Cache (プリレンダ成果物) に焼き付く
2. その後 seed がスクリプトで投入される — が revalidateTag('prices') は発火しない (F5)
3. 以後の再デプロイでも直らない: Vercel Data Cache はデプロイを跨いで持続するため、
   ビルド時の getActivePriceTable() が手順 1 の空テーブルキャッシュを読み続け、
   毎回 fallback HTML を再生成する
4. /admin/prices から一度でも保存すれば F6 で直るはずだが、本番では価格改定操作が
   行われていない (page_text/page_media 0 行 = 管理画面カスタマイズ未実施、gap-prod-db §6 と整合)
```

対抗仮説 ②「Vercel 本番の Supabase env 未設定/不正」は、公開サイトの他の DB 駆動ページ (works 6 件等) が表示されている限り棄却できる。切り分けは §2.3 Step 3 で行う。

### 2.3 修理手順 (Phase 0 #0-1 の作業指示書)

| Step | 操作 | 判定 | 次アクション |
|---|---|---|---|
| 0 | Vercel 本番 env に `REVALIDATE_SECRET` が設定済みか確認 | 未設定 → /api/revalidate は 503 (F7/F8) | 堀さんが設定 (C2 の一部)。**設定後は redeploy が必須** (Vercel の env はデプロイ時に関数へ焼き込まれ、追加・変更は次のデプロイからのみ有効 — 公式仕様。Redeploy ボタン・ビルドキャッシュ利用で可)。なお redeploy で Full Route Cache は再生成されるが Data Cache (unstable_cache) はデプロイを跨いで残るため、**redeploy 後も Step 1 の revalidate は必要** |
| 1 | **第一手**: `curl -X POST https://kumabe-tosou.vercel.app/api/revalidate -H "x-revalidate-secret: $REVALIDATE_SECRET" -H "content-type: application/json" -d '{"tags":["prices"]}'` → 200 `{"revalidated":["prices"]}` を確認 | — | Step 2 へ |
| 2 | Chrome MCP で本番 `/shop` を **2 回** 開く (1 回目が再生成トリガ、2 回目で確定確認)。#sim にグレード 3 択・サイズ 4 択・個数ステッパー・合計金額が描画されるか実測 | 描画 OK → **原因 ③ 確定、修理完了** | §2.4 恒久策の実装へ。受入 S1 記録 |
| 3 | 描画 NG → env 切り分け: (i) 本番の他 DB 駆動ページ (/works 一覧) が DB 内容を表示しているか (ii) Vercel env の `NEXT_PUBLIC_SUPABASE_URL` が `https://ixvfhxbfpdquwktsnmqy.supabase.co` か・ANON_KEY が有効か (iii) Vercel runtime logs で `KMB-E901` (facade L98) の有無 | env 不正 → **原因 ②** | env 修正 → redeploy → Step 1 から再実行 |
| 4 | それでも NG → ローカルで本番 env を指して `getPriceTable({activeOnly:true})` を直接実行し、返る grades/sizes の件数と `is_active` を確認 (is_active=false 化などデータ状態の再点検) | — | 結果を持って再切り分け (想定外事象として記録) |

**どの原因でも直る**構成: Step 1 (キャッシュ破棄) + Step 3 (env) + §2.4 (再発防止) の 3 点で、gap-prod-shop の候補 ①(棄却済み)②③ すべてを網羅する。

### 2.4 恒久策 — /shop の revalidate 設計是正

方針: **タグ即時反映 (既存) + 時間ベース自己修復 (新設) の二重化**。SSG は維持する (公開性能・既存デザイントーンのまま。`dynamic = "force-dynamic"` は毎リクエスト DB 往復になるため不採用)。

| # | 変更 | 内容 |
|---|---|---|
| P1 | `src/app/(site)/shop/page.tsx` に `export const revalidate = 3600;` を追加 | ISR 安全網。revalidate 信号が一切来なくても自己修復する — ただし P2 の Data Cache TTL と独立に SWR 失効するため、実効上限は**約 2 時間 (2×TTL) + 次回アクセス** (§10.3)。ビルド時焼き付きの恒久防止 (プリレンダ成果物が TTL で陳腐化する) |
| P2 | `src/modules/pricing/facade.ts` の `unstable_cache` オプションを `{ tags: ["prices"], revalidate: 3600 }` に変更 | Data Cache 側の無期限エントリを廃止。P1 だけだと**ページは再生成されてもデータが古いまま**になるため両方必須。facade シグネチャ・契約は不変 (キャッシュ戦略は実装詳細) |
| P3 | `scripts/revalidate-tags.ts` 新設 (§6.3) + seed 運用手順化 | seed / スクリプト投入の直後に revalidate を届かせる標準手順。README「Supabase migration の適用」節の直後に「seed 投入後の反映」節を追加し、`npx tsx scripts/revalidate-tags.ts prices` を必須手順として明記 |
| P4 | admin 保存経路 (F6) | **変更なし** (revalidateTag + revalidatePath 済み。正しい実装) |

TTL 3600 秒の根拠: 価格は月次以下の低頻度更新であり、即時性は F6/P3 のタグ方式が担う。TTL は「信号が失われた場合の上限遅延」であり、P1 (ページ) と P2 (Data Cache) が独立に SWR 失効するため信号なし自己修復の最悪所要は**約 2×TTL + 次回アクセス** (§10.3) — 月次更新の価格に対して実害がない。他ページへの波及はない (本書のスコープは /shop のみ。同型の焼き付きリスクの横展開点検は 05-site-settings の受入に委ねず、Phase 5 #5-3 のドキュメント同期時に一覧化する — 07-contracts-delta v1.1「裁定記録」#17 で採用済み。Issue 起票時に #5-3 受入基準へ転記)。

### 2.5 旧 GitHub Pages 残置の扱い (堀さん確認事項 9)

事実: `https://daisukehori.github.io/kumabe-tosou/`(shop.html) は現在も完動状態で公開中 (gap-prod-shop §4)。ハードコード価格 (2026 年立ち上げ期の目安) が独り歩きするリスクがある。

| 選択肢 | 内容 | 備考 |
|---|---|---|
| A. リポジトリの Pages 無効化 | GitHub Settings → Pages → Disable。最速・確実 | リンク到達者には 404。推奨 (Vercel 版修理完了後) |
| B. リダイレクト | 旧全ページに `<meta http-equiv="refresh">` + canonical で Vercel へ誘導 | 旧 URL の被リンク/検索流入を引き継げる。静的ページ改修の手間あり |
| C. 現状維持 | — | 旧価格の独り歩きが続くため非推奨 |

**本書の裁定はしない** (裁定 J6 のとおり堀さん判断)。ただし順序制約のみ設計として固定する: **選択肢 A/B の実施は §2.3 の修理完了 (受入 S1) より後**。先に旧サイトを消すと、修理完了までの間シミュレーターがどこにも存在しない期間が生じる。

---

## 3. データモデル

### 3.1 所有テーブル — なし (理由付き宣言)

裁定 J6「新テーブル・新マスタ禁止」により、本モジュールは**テーブルを一切新設しない**。migration 番号帯も消費しない (00 §10: simulator = migration なし)。シミュレーター入力・結果はサーバに保存されず (無状態)、保存が必要になる時点 (リード送信) で inquiry / crm / sales の所有テーブルに facade 経由で書かれる。

quantity 999→1000 是正 (§4.1) も **DDL 変更ゼロ**: DB 規約「文字数上限・数値レンジ等の値制約は Zod が唯一の正 (DDL に重複定義しない)」(design-conventions §6.4) により、quantity の上限は DDL に存在しない。contracts の 1 行変更のみで完結する。

### 3.2 参照テーブル (所有モジュール経由のみ)

| テーブル | 所有 | 本書での用途 | アクセス経路 |
|---|---|---|---|
| price_grades / price_size_classes / price_matrix / price_quantity_tiers / price_options | pricing | シミュレーター表示・計算・SEC.01 カード価格導出 | `PricingFacade.getActivePriceTable()` (SSR、unstable_cache) |
| contact_inquiries | inquiry | リードの一次保存 (email **not null** — init_schema 実測。§4.2 の email 必須の根拠) | `InquiryFacade.submit()` |
| rate_limits | inquiry (隣接。service 専用: RLS ポリシーなし) | /api/shop/lead のレート制限 | site-public 層の `checkAndRecordRateLimit()` (service client、既存 contact と同経路 §6.1) |
| customers / deals / activities / activity_links | crm | リード取込の書き先 | `CrmFacade.intakeFromSimulator()` |
| documents / document_lines | sales | 見積原案 (draft) の書き先 | `SalesFacade.createDraftQuoteFromEstimate()` |

### 3.3 JSONB カラム ↔ 型契約対応表 (本書関連分)

| カラム | canonical スキーマ | 書き手 |
|---|---|---|
| activities.payload (type='simulator_estimate') | `zSimulatorEstimateActivityPayload` (07 §D7) — 中身は `zSimEstimateSnapshot` | crm facade (intakeFromSimulator 内) |
| activities.payload (type='form_submission') | `zFormSubmissionActivityPayload` (07 §D7) | crm facade (同上) |
| document_lines.source | `zDocumentLineInput.source` (07 §D7 §4.11: `{grade_key, size_key, option_keys}`) | sales facade (createDraftQuoteFromEstimate 内) |

---

## 4. 値契約 (Zod)

### 4.1 契約変更 (c): zEstimateInput.quantity max 1000 — canonical は 07 §D6

現状の不整合 (実測): UI clamp は 1〜1000 (`shop-simulator.tsx` L41-45 `clampQty`、input `max={1000}` L299)・legacy も 1〜1000、だが `zEstimateInput.quantity` は `max(999)` (`src/modules/pricing/contracts.ts` L82 / module-contracts.md §4.8 L476)。UI は `computeEstimate()` を Zod を通さず直呼びするため qty=1000 でも動くが、facade 経由 `estimate()` は 1000 を KMB-E101 で拒否する。

是正 (07 §D6 引用 — 本書はこの 1 行を写経するのみ):

```ts
  quantity: z.number().int().min(1).max(1000), // v2.8: UI clamp (1..1000) と統一 (legacy 互換。旧 999 は不整合)
```

変更ファイル: `src/modules/pricing/contracts.ts` (zEstimateInput 1 行) + `docs/module-contracts.md` §4.8 (v2.8 統合時に §D6 適用 — 本書は触らない)。**`computeEstimate()` 本体・ゴールデンテスト 24 件 (`tests/pricing-estimate.test.ts`: CASES 19 + 追加 5) は無変更で全 PASS 維持が受入条件** (S4)。境界テスト追加は §15。

整合確認: `zSimEstimateSnapshot.quantity` (07 §D7) は既に `max(1000)` で定義済み — 是正後に UI / pricing 契約 / crm スナップショット契約の 3 者が 1000 で一致する。

### 4.2 /api/shop/lead リクエスト契約 (新規・本書が正)

配置: `src/app/api/shop/lead/schema.ts` (**app 層ローカル契約**)。canonical 部品 (`zSimEstimateSnapshot` = crm/contracts) の合成のみで、新しいドメイン型を発明しない。クライアント (リードフォーム) も同ファイルを import して react-hook-form resolver に使う (zod のみのファイルで server-only を含まない)。platform / crm への昇格は**裁定で却下 — app 層ローカルのまま確定** (07-contracts-delta v1.1「裁定記録」#13: 単一 route とそのフォームのみが使用。跨モジュール利用が生じた時点で昇格)。

```ts
// src/app/api/shop/lead/schema.ts
// canonical: docs/design/crm-suite/06-simulator.md §4.2 (裁定 J6-(a))
// 部品の canonical: zSimEstimateSnapshot = crm/contracts.ts (07-contracts-delta §D7)
import { z } from "zod";

import { zShortText } from "@/modules/platform/contracts";
import { zSimEstimateSnapshot } from "@/modules/crm/contracts";

/**
 * シミュレーター発リードの送信契約 (POST /api/shop/lead)。
 * email 必須の根拠: contact_inquiries.email は not null (migration 0001) であり、
 * 既存 contact フォーム (zInquiryInput) と同一の要求水準に揃える。
 * 電話のみのお客様 (00 §7 パターン 1) の受け皿は telephony 経路 (04) が担う。
 */
export const zSimulatorLeadReq = z
  .object({
    contact: z
      .object({
        name: zShortText(50),                       // zInquiryInput.name と同上限
        email: z.string().email().max(120),
        tel: z
          .string()
          .regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/)    // zInquiryInput.tel と同一 (国内番号の生入力)
          .nullable(),
      })
      .strict(),
    message: z.string().max(2000).nullable(),       // 任意の補足。NFC 正規化は body 合成後の zInquiryInput が適用
    privacy_agreed: z.literal(true),                // 同意なし送信は型レベルで不可 (zInquiryInput と同型)
    estimate: zSimEstimateSnapshot,                 // 入力+結果のスナップショット (07 §D7)。金額・ラベルはサーバが信頼せず再計算で上書き (§6.1 0-e — クライアント値は乖離検知のみ。v1.1)
    // --- スパムガード (既存 contact フォームの 3 点セットと同一) ---
    honeypot: z.string().max(200),                  // 値が入っていれば bot (stealth 扱い)
    form_rendered_at: z.number().int().positive(),  // フォーム描画時刻 (epoch ms)。3 秒未満送信は bot
  })
  .strict();
export type SimulatorLeadReq = z.infer<typeof zSimulatorLeadReq>;

/** 応答契約 (JSON)。HTTP status との対応は §6.1 の表が正 */
export type SimulatorLeadResponse =
  | { ok: true }
  | { ok: false; code: "KMB-E101" | "KMB-E105" | "KMB-E901"; message: string };
```

### 4.3 スナップショット組み立て純関数 (クライアント・サーバ共用)

`ShopSimulator` の state (grade/size/qty/options) と `EstimateResult` から `zSimEstimateSnapshot` を組み立てる。本関数は**クライアント (表示値の申告用) とサーバ (route が §6.1 0-e で正本 snapshot を組み立てる) の両方**から呼ばれる (zod と型のみのファイルで server-only を含まないため双方 import 可 — v1.1)。**D7 の文字数上限に対する防御的切り詰めを一元化する** (発見事項: `computeEstimate()` の breakdown 先頭要素は `factor = size.label` であり size.label は最大 30 字、D7 の `breakdown[].factor` は max 20 だった — **裁定で採用済み**: 07-contracts-delta v1.1 (裁定記録 #11) で factor max 30 に改訂。防御的切り詰めは契約変更後も自衛として維持する)。

```ts
// src/app/api/shop/lead/schema.ts (続き)
import type { EstimateResult, PriceGrade, PriceSizeClass } from "@/modules/pricing/contracts";
import type { SimEstimateSnapshot } from "@/modules/crm/contracts";

/** シミュレーター state + 計算結果 → zSimEstimateSnapshot。
 *  D7 の上限 (grade_label 30 / size_label 30 / breakdown.label 50 / breakdown.factor 30 (v1.1 是正) /
 *  applied_tier 30 / option_keys 各 30・最大 10) へ防御的に切り詰める純関数 */
export function buildSimEstimateSnapshot(args: {
  grade: PriceGrade;
  size: PriceSizeClass;
  quantity: number;
  optionKeys: string[];
  result: EstimateResult;
}): SimEstimateSnapshot {
  return {
    grade_key: args.grade.key.slice(0, 30),
    grade_label: args.grade.label.slice(0, 30),
    size_key: args.size.key.slice(0, 10),
    size_label: args.size.label.slice(0, 30),
    quantity: args.quantity,
    option_keys: args.optionKeys.slice(0, 10).map((k) => k.slice(0, 30)),
    quote_only: args.result.quote_only,
    total_min: args.result.total_min,
    total_max: args.result.total_max,
    applied_tier: args.result.applied_tier === null ? null : args.result.applied_tier.slice(0, 30),
    breakdown: args.result.breakdown.slice(0, 20).map((b) => ({
      label: b.label.slice(0, 50),
      factor: b.factor.slice(0, 30), // D7 上限 30 (v1.1 是正 — size.label(≤30) が入る経路がある)。切り詰めは自衛として維持
    })),
  };
}
```

### 4.4 inquiry 本文の組み立て純関数 (旧クリップボード文面の構造化継承)

旧 UX のコピー文 (`shop-simulator.tsx` L222-231) と同じ情報密度を `contact_inquiries.body` に構造化テキストとして残す (管理画面 /admin/inquiries でそのまま読める後方互換)。出力は `zInquiryInput.body` (`zShortText(5000).pipe(min(10))`) を必ず通るため NFC 正規化は inquiry 側で適用される。

```ts
// src/app/api/shop/lead/schema.ts (続き)
export function buildInquiryBody(args: {
  estimate: SimEstimateSnapshot;
  optionLabels: string[];          // 選択オプションの表示ラベル — route がサーバ価格表 (table.options) から option_keys で解決 (§6.1 0-e)。クライアントからは受け取らない (zSimulatorLeadReq に option_labels は存在しない — v1.1 是正)
  message: string | null;
}): string {
  const { estimate: e } = args;
  const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
  const lines = [
    "【隈部塗装 SHOP — シミュレーター経由の問い合わせ】",
    `グレード: ${e.grade_label}`,
    `サイズ帯: ${e.size_label}`,
    `個数: ${e.quantity} 個`,
    `オプション: ${args.optionLabels.length > 0 ? args.optionLabels.join(" / ") : "なし"}`,
    e.quote_only
      ? "概算: 個別見積もり（サイズ上限超過）"
      : `概算: ${yen(e.total_min)}〜${yen(e.total_max)}（税込・目安${e.applied_tier ? `・${e.applied_tier} 適用` : ""}）`,
    "※ シミュレーターの概算です。正式なお見積もりで確定します。",
  ];
  if (args.message !== null && args.message.trim().length > 0) {
    lines.push("", "--- お客様からのメッセージ ---", args.message.trim());
  }
  return lines.join("\n");
}
```

`zInquiryInput` への詰め替え (route 内): `name/email/tel` = contact そのまま、`inquiry_type: "estimate"`、`item: "{grade_label}/{size_label}×{quantity}"` (100 字以内に切り詰め)、`body: buildInquiryBody(...)`、`privacy_agreed: true`。body の入力は**サーバ正本 snapshot** (§6.1 0-e)。クライアント送信値と total_min/max・quote_only が乖離した場合は body 末尾に「※ 送信時の表示金額と現行価格表に乖離があります（本文はサーバ再計算値）」、価格表が取得できず未検証の場合は「※ 価格表未取得のため送信時の表示金額をそのまま記載（未検証）」の注記 1 行を追記してから `zInquiryInput` に通す (v1.1)。

### 4.5 SEC.01 カード価格の導出契約 (b) — pricing 所有の純関数

```ts
// src/modules/pricing/price-display.ts (新規。副作用・IO なし)
// canonical: docs/design/crm-suite/06-simulator.md §4.5 / §7.2 (裁定 J6-(b))
import type { PriceTable } from "./contracts";

/**
 * SEC.01 グレードカードの価格表示 (「¥7,000〜」) を price_matrix から導出する。
 * 規則: 対象グレード (is_active=true) の、quote_only=false な全サイズ帯に対応する
 * matrix セルの price_min の最小値を「¥{min}〜」形式で返す (税込 — 行列の値は税込)。
 * グレード不在/非アクティブ/有効セルなし/table null は null を返し、
 * 呼び出し側がテキストスロット (フォールバック文言) に委ねる。
 */
export function formatGradeCardPrice(table: PriceTable | null, gradeKey: string): string | null {
  if (!table) return null;
  const grade = table.grades.find((g) => g.key === gradeKey && g.is_active);
  if (!grade) return null;
  const sellableSizeKeys = new Set(
    table.size_classes.filter((s) => !s.quote_only).map((s) => s.key),
  );
  const mins = table.matrix
    .filter((c) => c.grade_key === gradeKey && sellableSizeKeys.has(c.size_key))
    .map((c) => c.price_min);
  if (mins.length === 0) return null;
  return `¥${Math.min(...mins).toLocaleString("ja-JP")}〜`;
}
```

実装との対応 (v1.1 注記): `PriceTable` の実装型 (`src/modules/pricing/contracts.ts` L151-157、実 Read) のメンバ名は `size_classes` / `quantity_tiers` であり、本設計コードはそれに従う (既存の `computeEstimate` も同名を参照 — estimate.ts L19)。module-contracts.md §4.9 の記載 (`sizes` / `tiers`) は実装と乖離した旧記述であり、**07-contracts-delta 裁定 #18 (§D6-2) でドキュメント側を実装準拠に是正する** (コード変更なし — 実装のフィールド名改称は shop-simulator / facade / admin 価格画面へ波及するため行わない)。

表記統一の裁定: 現行スロット既定値は「¥7,000〜」「¥10,000〜」「¥15,000–35,000」(slots/shop.ts L330/L474 系列、実 Read 確認)。導出表示は **3 カードとも「¥{最安}〜」形式に統一**する。プレミアムの「–35,000」上限表記は落ちるが、(i) 併記スロット `shop.grade.N.price.note` (「1点あたり / サイズ別目安・税込」) がレンジ性の説明を担い、(ii) 上限まで含む正確なレンジは直下のシミュレーターが即答する、(iii) 上限併記形式は matrix 変更時に「どのセルの max を出すか」の追加裁定を要し導出規則が複雑化する、ため。表記変更は堀さん確認推奨事項として §18 R-S3 に記載。

### 4.6 canonical 契約の引用 (再定義ではない — 実装時は crm/contracts.ts が正)

本モジュールが書き手/読み手として従う canonical (07 §D7)。全文は 07-contracts-delta を参照。要点のみ再掲:

- `zSimEstimateSnapshot` — grade/size の key+label、quantity (1..1000)、option_keys、quote_only、total_min/max、applied_tier、breakdown (label≤50 / factor≤30 — v1.1 是正)。**pricing の zEstimateInput/zEstimateResult の構造的同型** (pricing→crm 循環を避けるため独立定義、契約書 §2 の定石)
- `zSimulatorEstimateActivityPayload` — `{ estimate: zSimEstimateSnapshot, price_note: string(200)|null }`。price_note は crm facade が取込時に付す注記 (本書は値を規定しない)
- `zFormSubmissionActivityPayload` — `{ inquiry_id: uuid, inquiry_type: enum, excerpt: string(300) }`
- `zIntakeFromSimulatorInput` — `{ inquiry_id, contact: zLeadContact, estimate }`。`zLeadContact` は email/tel いずれか必須 (E607) — 本 route は §4.2 により常に email 非 null で渡すため充足
- 冪等キー: activity は `(activity_type, ref_table, ref_id=inquiry_id)` (00 §3.2.3-2)

---

## 5. facade と app 層合成

### 5.1 PricingFacade — 契約変更なし

| メソッド | シグネチャ (現行維持) | エラー |
|---|---|---|
| getActivePriceTable | `(): Promise<Result<PriceTable>>` | KMB-E901 (取得失敗) |
| estimate | `(input: EstimateInput): Result<EstimateResult>` | KMB-E101 (検証 — quantity 1000 是正後の境界に注意) / KMB-E901 (表未取得) |
| (admin 拡張 6 本) | getFullPriceTable / savePriceGrade / savePriceOption / replacePriceSizeClasses / replacePriceMatrix / replacePriceQuantityTiers | E101 / E103 (楽観排他) / E901。**変更なし** |

実装内部の変更は §2.4 P2 (unstable_cache オプション) と `price-display.ts` の追加のみ。facade interface・module-contracts §5 は不変。

### 5.2 リード接続の app 層合成 (canonical: 00 §4.2 / 07 §7.8・§D8)

route が呼ぶ facade メソッドと、各 `Result<T>` エラーの**全列挙 + route の扱い**:

| 順 | 呼び出し | 成功値 | 失敗コード (全列挙) | route の扱い |
|---|---|---|---|---|
| 0 | `PricingFacade.getActivePriceTable()` → `estimate({grade_key, size_key, quantity, option_keys})` (§6.1 0-e サーバ再計算 — v1.1 新設) | PriceTable / EstimateResult | KMB-E901 (表取得失敗) / KMB-E101 (契約上のみ — zSimEstimateSnapshot 通過後は実質発生しない) | E901 = **縮退**: クライアント snapshot を「未検証」注記付き (§4.4) で手順 1 のみ実施し、手順 2/3 はスキップ (未検証金額で CRM を汚染しない)。E101 = 400 |
| 1 | `InquiryFacade.submit(zInquiryInput)` | `{ id: inquiry_id }` | KMB-E101 (契約違反 — §4.2 通過後は原則発生しない) / KMB-E901 (INSERT 失敗) | **失敗 = 全体失敗**。500 + `{ok:false, code:"KMB-E901"}` (E101 は 400)。通知メールは submit 内部のベストエフォート (E902 ログのみ) |
| 2 | `CrmFacade.intakeFromSimulator({inquiry_id, contact, estimate})` | `{ customer_id, deal_id }` | KMB-E601 (重複候補 — intake 内部で既存顧客に自動合流するため外部露出しない想定、01-crm が正) / KMB-E603 / KMB-E604 / KMB-E607 (連絡先欠落 — §4.2 により発生しない) / KMB-E901 | **失敗しても巻き戻さない** (00 §4.2 [異常])。`console.error` で KMB-E9xx ログ + 応答は 200 のまま。admin は /admin/inquiries から手動リード化 (01-crm の操作) |
| 3 | `SalesFacade.createDraftQuoteFromEstimate({deal_id, estimate})` (手順 2 成功時のみ) | `{ document_id }` | KMB-E620 系は draft 作成では発生しない (発行時ガード) / KMB-E101 / KMB-E603 (deal 不在 — 02-sales §6.1 の契約どおり。手順 2 成功直後のため通常発生しないが全列挙として明記 — v1.1) / KMB-E901 | 同上 — ログ + 200 のまま。見積原案は admin が /admin/deals から手動作成可能 |

不変条件 (00 §4.2 と 1:1): **問い合わせ (手順 1) は必ず残す**。手順 2/3 は「あれば嬉しい自動化」であり、その失敗が送信者の体験 (「送信しました」) を壊してはならない。

実行文脈の注記: 本 route は anon 文脈 (admin セッションなし) であり、customers/deals/activities/documents はいずれも anon 書込 ✗ (00 §5.2)。07 §D8 の `intakeFromSimulator` / `createDraftQuoteFromEstimate` は `ctx?: ExecutionContext` を取らないシグネチャのため、両メソッドは内部で service client を用いて動作する — **裁定で契約注記として確定済み** (07-contracts-delta v1.1「裁定記録」#12、D8 に明記): intake 系は内部で service client を生成 (01-crm §6.5)、createDraftQuoteFromEstimate は `createSalesFacade(client)` の service client 注入 (02-sales §6.1 注記)。`SUPABASE_SERVICE_ROLE_KEY` 未設定環境 (ローカル .env.local は空 — gap-prod-db §1 実測。**本番 Vercel の実設定は未確認 — 堀さん確認事項 5** (design-rulings 確認リスト)。v1.1: 本番確定事実であるかのような旧記述を是正) では手順 2/3 は E901 で degrade し、手順 1 のみ成立する — これは上記の不変条件どおりの正常な縮退。

### 5.3 依存方向の遵守

- pricing モジュールのソースには crm / sales / inquiry の import を**追加しない** (00 §2.2。ESLint MODULES 境界は M0 #1-1 で追加済み前提)
- `ShopSimulator` (site-public コンポーネント) から書き込み facade を import しない — 送信は `fetch("/api/shop/lead")` の HTTP 境界越え。型は `schema.ts` (zod のみ) を import
- route (`src/app/api/shop/lead/route.ts`) は app 層であり、3 facade の import は合成パターンとして正当 (契約書 §2 の定石)

### 5.4 見積原案への変換契約 (02-sales との分担境界)

`createDraftQuoteFromEstimate` の**入力意味論 (snapshot の読み方) は本節が正**、行組み立ての実装・単体テストは 02-sales.md が正。

| # | 規則 | 内容 |
|---|---|---|
| T1 | 仮単価の意味論 | D8 の「仮単価 = セル price_max」は、snapshot にセル生値が含まれないため「**数量値引き・オプション適用後の税込上限 (total_max) からの税抜換算**」として実現する (シミュレーター値は**税込**、帳票明細は**税抜**のため標準税率 10% で逆算)。**具体式・丸め位置は 02-sales §9.1 が正**: `unit_price_jpy = round(total_max ÷ quantity ÷ 1.1)` → `amount_jpy = round(unit_price × quantity)` (単価先行)。v1.0 の金額先行式 (`amount_jpy = round(total_max / 1.1)`) は 02-sales §9.1 と矛盾していたため撤回 — v1.1。`quantity = snapshot.quantity`、`unit = "個"`、`tax_category = "standard_10"` |
| T2 | 明細行数 | quote_only=false → **1 行**。値引き・オプションの行分解はしない (snapshot から金額分解を正確に復元できないため。breakdown は T4 の備考に転記)。**description の具体文言は 02-sales §9.1 が正** (`3Dプリント表面処理・塗装（{grade_label}／{size_label}）` — オプションは description に列挙せず notes へ転記。v1.0 の独自文言 `{grade_label}（{size_label}）表面仕上げ＋…` は撤回 — v1.1) |
| T3 | source スナップショット | `document_lines.source = { grade_key, size_key, option_keys }` (D7 §4.11)。受注時のブロック原案生成 (`zGenerateBlocksInput` が grade_key/size_key を持つ) へのヒントとなる。`work_type_key = null` |
| T4 | 備考 (documents.notes) | 本書の要求は意味論のみ: **レンジ明記必須 (D8) + applied_tier・breakdown の転記 + 「単価は概算上限からの税抜換算」の断り + 「正式なお見積もりで確定」の断り**。**具体文言は 02-sales §9.1 の共通 notes が正** (「数量スライドなし」表記等を含む。v1.0 の独自文言は撤回 — v1.1) |
| T5 | quote_only=true (XL) | 明細 **0 行** + notes に「個別見積もり（{size_label}・{quantity} 個）」(00 §7 パターン 12)。deal の amount_jpy は null (crm 側)。発行は KMB-E620 でブロックされる (明細追加が先) — draft の 0 行作成を許すのは本経路のみ (02-sales の createDraftQuoteFromEstimate 特例。zCreateDocumentInput の min(1) は一般作成経路の制約) |
| T6 | 丸め誤差の許容 | 02-sales §9.1 の単価先行丸め (丸めが単価段で入り quantity 倍に増幅される) により、発行時再計算 (書類×税率 1 回丸め、J5) 後の税込合計は total_max と**最大 ±0.5×quantity 円程度 (qty=1000 で数百円) ずれうる**。02-sales §9.2 のとおり**概算目安として許容** — 原案 (draft) は admin が発行前に必ず単価を確定する前提であり、一致保証・許容誤差の数値検証はしない。v1.0 の「±2 円以内」規定は単価先行式では数学的に成立しないため撤回 — v1.1。テストの canonical は `tests/sales-derive-snapshot.test.ts` (02-sales §13 — 逆算式・notes 文言・XL 0 行を検証。v1.0 記載の `sales-estimate-to-draft` は実在しないテスト名だった) |
| T7 | 採番・発行 | しない (draft のまま)。採番は admin の発行操作時 (00 §4.2 手順 3 の注記どおり) |

---

## 6. API route / Server Actions / ジョブ仕様

### 6.1 POST /api/shop/lead (新規)

| 項目 | 仕様 |
|---|---|
| 配置 | `src/app/api/shop/lead/route.ts` (+ `schema.ts` §4.2) |
| 認可 | **anon** (公開)。追加ガード: レート制限 + スパムガード 3 点セット (下記)。00 §5.3 の行と対応 — ただし**主エラー列挙は 00 側が旧記述 `E101 / E105 / E607` のままで誤り** (E607 は §4.2 の email 必須により本経路で発生しない — §14。inquiry INSERT 失敗の E901 が実在)。正は `E101 / E105 / E901` (§9.2)。**統合時に 00 §5.3 の当該行を是正する申し送り — v1.1** |
| Content-Type | application/json。parse 失敗 → 400 `{ok:false, code:"KMB-E101"}` |
| レート制限 | rate_limits 流用。`route = "shop_lead"` (定数 `SHOP_LEAD_RATE_LIMIT_ROUTE` を `spam-guard.ts` に追加)、IP salt 付き SHA-256 hash、**5 件/時** (contact と同値)。実装: 既存 `checkAndRecordRateLimit(ipHash, now)` に第 3 引数 `route: string = CONTACT_FORM_RATE_LIMIT_ROUTE` を追加して共用 (`src/components/contact/rate-limit.server.ts` の後方互換拡張)。**あわせて超過時返却の code リテラルを `"KMB-E101"` → `"KMB-E105"` に変更する** (rate-limit.server.ts L53 実測 — 現状 E101 ハードコードのままでは本 route の 429/E105 契約を満たせない。contact 側 actions.ts は `rateLimitResult.ok` の真偽のみで分岐しており (L76-78 実測) code 変更の副作用なし。E105 の errors.ts 登録 (M0 #1-1、§14) が先行条件 — v1.1)。service key 未設定時は fail-open (既存挙動踏襲 — スパム抑止であり認可境界ではない) |
| maxDuration | 既定 (facade 3 呼び出しは DB のみで高速。通知メールは submit 内の void 非同期)。応答目標 p95 < 3s |

処理シーケンス (番号 = §5.2 の表と対応):

```
POST /api/shop/lead
 0-a. body JSON parse (JSON として不正 → 400 {ok:false, code:"KMB-E101"})
 0-b. stealth 前段判定 — zSimulatorLeadReq のフル検証より**先**に行う (contact actions.ts の
      判定順序 honeypot→最小送信時間→rate limit→契約検証 を踏襲 — v1.1 是正。v1.0 は strict parse が
      先で、honeypot 充填 bot に 400 + Zod 詳細を返してしまい stealth 方針が破れていた):
      緩い前段スキーマ z.object({ honeypot: z.string().catch("x"),
      form_rendered_at: z.number().int().positive().catch(0) }).passthrough() で 2 項のみ読み取り、
      isHoneypotFilled(honeypot) || form_rendered_at === 0 || (Date.now() − form_rendered_at) < 3000ms
      → bot とみなし 200 {ok:true} を返して破棄 (stealth — 学習させない。catch により honeypot が
      文字列でない/長すぎる・form_rendered_at 欠落/型不正も bot 側に倒す)。
      余剰キー等それ以外の契約違反は 0-d の通常 400 (stealth 対象は既存 contact と同じ 2 シグナルのみ)
 0-c. checkAndRecordRateLimit(hashIp(ip, salt), now, "shop_lead")
      超過 → 429 {ok:false, code:"KMB-E105", message:"短時間に送信が集中しています。…"}
 0-d. zSimulatorLeadReq.safeParse (strict)
      失敗 → 400 {ok:false, code:"KMB-E101", message:"入力内容をご確認ください。"}
      (フィールド単位の Zod 詳細は応答に載せない — スキーマ形状を学習させない)
 0-e. サーバ再計算 (正本 snapshot の組み立て — クライアント金額・ラベルを信頼しない。v1.1 新設):
      getActivePriceTable() → computeEstimate(table, {grade_key, size_key, quantity, option_keys})
      → buildSimEstimateSnapshot (§4.3) で grade_label / size_label / applied_tier / breakdown /
      totals をすべてサーバの価格表から解決した**サーバ正本 snapshot** を組み立てる
      (optionLabels も table.options から解決 — §4.4)。以降の手順 1〜3 はこの正本 snapshot を使う。
      クライアント送信の totals/labels は乖離検知のみに使い、total_min/max・quote_only の乖離時は
      §4.4 の注記を body に追記 (価格改定前の古いタブからの送信を検知)。
      表取得失敗 (KMB-E901) → 縮退: クライアント snapshot を「未検証」注記付きで手順 1 のみ実施し
      手順 2/3 はスキップ (§5.2 手順 0 — 未検証金額で CRM を汚染しない)
 1.  zInquiryInput 詰め替え (§4.4) → InquiryFacade.submit
      失敗 → 500 {ok:false, code:"KMB-E901", message:"送信に失敗しました。…"} (問い合わせ未保存のため全体失敗)
 2.  CrmFacade.intakeFromSimulator({inquiry_id, contact:{name, email, tel}, estimate})
      失敗 → console.error("[shop-lead] intake 失敗 KMB-E9xx", …) して続行 (巻き戻さない)
 3.  (2 成功時) SalesFacade.createDraftQuoteFromEstimate({deal_id, estimate})
      失敗 → 同上ログして続行
 4.  200 {ok:true}
```

| HTTP | body.code | 発生条件 | ユーザー向け文言 (スロット §7.1) |
|---|---|---|---|
| 200 | — (`ok:true`) | 正常 / stealth (bot) / 手順 2・3 の縮退 | shop.simulator.lead.success |
| 400 | KMB-E101 | Zod 検証失敗 | shop.simulator.lead.error.invalid |
| 429 | KMB-E105 | レート制限超過 (5 件/時/IP) | shop.simulator.lead.error.rate_limited |
| 500 | KMB-E901 | inquiry 保存失敗 | shop.simulator.lead.error.generic |

冪等性: リトライ再送は新しい inquiry を作る (問い合わせの重複は admin が /admin/inquiries で status 変更して吸収 — 既存 contact フォームと同水準)。クライアント側は送信中ボタン disabled で二重送信を抑止 (§7.1)。crm 側の activity は inquiry_id 冪等キーにより、同一 inquiry の再 intake で二重記録されない (00 §3.2.3-2)。

依存: 手順 2/3 は crm (Phase 2)・sales (Phase 3s) 完了が前提。**実装フェーズ分割**: Phase 4 #4-2 で route を実装する際、crm/sales 未到達環境 (テスト時) では手順 2/3 が E901 縮退する設計のため段階投入が可能だが、本番リリースは Phase 2/3s 完了後 (00 §11 の依存注記どおり)。

### 6.2 POST /api/revalidate (既存流用 — 変更なし)

修理 (§2.3 Step 1) と seed 運用 (§6.3) の呼び先。仕様は実装済みのとおり: `x-revalidate-secret` 認可 (未設定 503 / 不一致 401)、body `zRevalidateReq {tags: string[] 1..20}`、`revalidateTag()` をタグごとに実行。**本書はコード変更を要求しない**。

### 6.3 scripts/revalidate-tags.ts (新規スクリプト)

| 項目 | 仕様 |
|---|---|
| 目的 | seed / スクリプト投入後に本番へ revalidate 信号を届かせる標準手段 (§2.4 P3)。恒久策の運用面 |
| 実行 | `npx tsx scripts/revalidate-tags.ts prices [tags...]` (可変長引数、省略時エラー) |
| 入力 env | `REVALIDATE_TARGET_URL` (省略時 `NEXT_PUBLIC_SITE_URL`)、`REVALIDATE_SECRET` (必須。未設定は即エラー終了 — fail-closed) |
| 動作 | `POST {url}/api/revalidate` に `{tags}` を送信し、HTTP status と応答 JSON を標準出力。非 2xx は exit 1 |
| 規模 | 〜60 行。単体テストは URL/ヘッダ組み立ての純関数部のみ (`tests/revalidate-tags.test.ts`) |
| 運用手順化 | README「Supabase migration の適用」節の直後に追記: 「価格・コンテンツを seed/スクリプトで投入した後は必ず `npx tsx scripts/revalidate-tags.ts prices` (対象タグ) を実行する」。`scripts/seed-from-legacy.ts` 末尾にも「revalidate を忘れずに」の console 案内を追加 (スクリプト自身は外部 URL に依存させない — オフライン seed を壊さない) |

### 6.4 Server Actions — なし

anon の書き込みは API route 経由とする裁定 (設計ブリーフ D6 / J6-(a)) により、公開側に Server Action は追加しない。admin 側の Server Action 追加もなし (/admin/prices の actions.ts は変更なし)。

### 6.5 ジョブ (pg_cron) — 該当なし

本モジュールに定期実行は不要 (シミュレーターは無状態、リード接続は同期、キャッシュ自己修復は ISR の TTL が担う)。00 §3.1.3 のジョブ表にも simulator 行はない。

---

## 7. 公開 UI 仕様 (既存デザイントーン維持)

### 7.1 リードフォーム — クリップボードコピー UX の置換 (a)

**廃止するもの** (shop-simulator.tsx L222-253 の `handleOrder` 一式): クリップボード書き込み・1200ms 後の `/contact` 遷移・`shop.simulator.toast.copied` / `shop.simulator.toast.redirect` スロットの使用 (スロット定義自体も registry から削除。page_text は本番 0 行のため孤児データは生じない — gap-prod-db §6)。

**新設**: 結果パネル (右カラム、bg-carbon) の CTA ボタン直下に**インライン展開型のリードフォーム** (`src/components/site/shop-lead-form.tsx`、"use client")。モーダルは使わない (既存 /shop にモーダル UI が存在せず、トーンを増やさないため)。

状態機械 (クライアント内):

```
idle ──CTA click──→ open ──送信──→ submitting ──2xx──→ done (成功文言に置換、フォーム消去)
  ▲                  │ Esc / 閉じる               └─4xx/5xx/network──→ open (エラー文言表示、入力保持)
  └──────────────────┘
done ──CTA 再 click──→ open (再問い合わせ — v1.1 で脱出遷移を追加)
```

done からの脱出 (v1.1 — v1.0 は done が終端でリロード以外に再送手段がなかった): 送信成功後も CTA ボタンとシミュレーター本体は操作可能なまま残す (非表示にしない)。お客様が条件を変えて再度問い合わせたいケース (§0.3 で自然に起きる) は **CTA 再クリックで done→open** — 成功文言をクリアし、連絡先の入力初期値は前回値を保持、`form_rendered_at` は open 時刻で再設定 (スパムガードの最小送信時間判定を正しく保つ)。シミュレーター入力の変更だけでは done を自動解除しない (成功文言は CTA 再クリックまで残る — 概算パネルの表示継続と同じ配慮)。パターンは §11.2 L12。

| 項目 | 仕様 |
|---|---|
| フォーム項目 | お名前* / メールアドレス* / お電話番号 (任意) / 補足メッセージ (任意、textarea) / プライバシーポリシー同意* (チェックボックス、/privacy へのリンク併記) + 不可視の honeypot テキスト + form_rendered_at (open 時刻を hidden 保持) |
| バリデーション | react-hook-form + `zSimulatorLeadReq` の contact/message/privacy_agreed 部分 (zodResolver)。エラーは各フィールド下に赤字 (既存 contact-form と同表現) |
| 送信 | `fetch("/api/shop/lead", {method:"POST"})`。payload は contact/message/privacy_agreed + `buildSimEstimateSnapshot` (§4.3) によるクライアント申告 snapshot + スパムガード 2 項 (§4.2 の全項)。**optionLabels はクライアントから送らない** (route が §6.1 0-e でサーバの table.options から解決 — v1.1 是正。v1.0 の「optionLabels をクライアントで解決」は §4.2 契約に該当フィールドがなく実装不能だった)。送信中はボタン disabled + 文言「送信中…」 |
| 成功 | フォーム領域を成功メッセージ (aria-live="polite") に置換。**ページ遷移しない** (旧 1200ms 遷移も廃止)。概算パネルは表示継続 (お客様が金額を控えられる) |
| 失敗 | §6.1 の code → スロット文言をフォーム上部に表示。入力値は保持。429 は再送信ボタンを**次の UTC 時境界まで** disable — レート制限は UTC 時単位 floor の固定 1 時間ウィンドウ 5 件 (spam-guard.ts `computeWindowStart` L32-35・`RATE_LIMIT_MAX_PER_HOUR` L12 実測) のため、クライアントで `3600000 − (Date.now() % 3600000)` ms を計算して disable する (v1.0 の「30 秒 disable」は同一ウィンドウ内の再送が高確率で再 429 になり「少し待てば送れる」誤期待を与えるため撤回 — v1.1)。文言側 (error.rate_limited) も待機目安「1 時間ほど」を伝える |
| quote_only (XL) | 送信可 (金額なしの相談として届く)。CTA 文言は同一 |
| デザイントーン | 既存クラス体系のみ使用: `border-hair` / `bg-paper` / `text-carbon*` / `font-mono text-[11px] tracking-[0.2em]` のラベル、`border px-3 py-3` の入力。**新規 shadcn 部品・新規色トークンは導入しない** (裁定「公開 UI は既存デザイントーン維持」) |

テキストスロット追加 (page-media text-registry `slots/shop.ts` へ追記。DDL 不要 — registry はコード定義):

| key | label | maxLen | defaultText |
|---|---|---|---|
| shop.simulator.cta (既存・defaultText と label のみ変更) | SHOP / シミュレータ問い合わせボタン (固定高+矢印、折返し厳禁) | 16 (**現状維持** — slots/shop.ts L150 実測。v1.0 の 30 は誤記: 折返し厳禁の固定高ボタンのため広げない。新 defaultText は 11 字で収まる — v1.1) | この内容で問い合わせる |
| shop.simulator.lead.name.label | SHOP / リード 氏名ラベル | 20 | お名前 |
| shop.simulator.lead.email.label | SHOP / リード メールラベル | 20 | メールアドレス |
| shop.simulator.lead.tel.label | SHOP / リード 電話ラベル | 25 | お電話番号（任意） |
| shop.simulator.lead.message.label | SHOP / リード メッセージラベル | 25 | 補足メッセージ（任意） |
| shop.simulator.lead.privacy.label | SHOP / リード 同意ラベル | 40 | プライバシーポリシーに同意する |
| shop.simulator.lead.submit | SHOP / リード 送信ボタン | 20 | この内容で送信する |
| shop.simulator.lead.success | SHOP / リード 成功文言 | 120 | 送信しました。内容を確認のうえ、折り返しご連絡いたします。 |
| shop.simulator.lead.error.invalid | SHOP / リード 入力エラー | 60 | 入力内容をご確認ください。 |
| shop.simulator.lead.error.rate_limited (v1.1: 待機目安を明示 — 制限ウィンドウは 1 時間固定のため。§7.1 失敗行) | SHOP / リード 頻度エラー | 80 | 短時間に送信が集中しています。1時間ほど時間をおいてお試しください。 |
| shop.simulator.lead.error.generic | SHOP / リード 一般エラー | 100 | 送信に失敗しました。時間をおいて再度お試しいただくか、お問い合わせフォームをご利用ください。 |
| (削除) shop.simulator.toast.copied / shop.simulator.toast.redirect | — | — | クリップボード UX 廃止に伴い registry から削除 |

`ShopSimulator` は "use client" で `<SlotText>` を使えないため、既存パターンどおり `texts` props + `textEditableAttrs()` の手動付与で editMode 編集可能性を維持する (shop-simulator.tsx 冒頭コメント L11-30 の確立手法を踏襲)。

### 7.2 SEC.01 カード価格の DB 駆動化 (b)

- `ShopPageBody` (server component) は既に `priceTable` を受け取っている (page-body.tsx で `<ShopSimulator priceTable={...}>` に注入済み)。各グレードカードの価格表示 (現在 `<SlotText slotKey="shop.grade.N.price">`、L337-350 実測) を次のロジックに置換する:

```
derived = formatGradeCardPrice(priceTable, GRADE_KEY_BY_CARD[n])   // §4.5
derived !== null → derived を表示 (DB 駆動)
derived === null → 既存スロット texts["shop.grade.N.price"] を表示 (フォールバック)
```

- カード → グレードの対応は既存 `ServiceSimLink` の grade prop と同一のハードコード (`1=base / 2=standard / 3=premium`、page-body.tsx L351 ほか実測)。**カード枚数の動的化はしない** (画面構造の発明をしない — SEC.01 は 3 枚固定の既存デザイン。グレードを 4 つ以上にする改定が来た時点で別途設計)
- `shop.grade.N.price` スロットは registry に**残す** (フォールバック用)。label を「SHOP / GRADE0N 価格 (フォールバック — 通常は価格表から自動表示)」に変更し、視覚エディタ上で役割が分かるようにする。`shop.grade.N.price.note` スロットは従来どおり常時表示 (変更なし)
- editMode (視覚エディタ) では derived 表示側に `data-editable-text` を付けない (DB 駆動値はエディタ編集対象外 — DB 駆動の grade.label 等と同じ既存方針)

### 7.3 キーボード操作チェックリスト (E2E 必須検証項目)

| キー | 文脈 | 期待動作 |
|---|---|---|
| Tab / Shift+Tab | シミュレーター全体 | グレード 3 ボタン → サイズ 4 ボタン → 個数 −/input/＋ → オプション checkbox → CTA → (open 時) フォーム各フィールド → 同意 → 送信 の論理順 |
| Enter / Space | グレード・サイズボタン | 選択 (button 要素の既定動作。aria-pressed 反転) |
| ↑ / ↓ | 個数 input (type=number) | 増減 (clamp 1..1000)。1000 で ↑ しても 1001 にならない |
| Enter | フォーム内 input | フォーム submit (textarea 内は改行) |
| Esc | フォーム open 時 | フォームを閉じて idle へ (入力値は保持)。フォーカスは CTA ボタンへ戻す |
| Space | 同意 checkbox | トグル |
| (フォーカス管理) | CTA click で open | 最初のフィールド (お名前) へフォーカス移動。done 時は成功文言コンテナ (tabindex=-1) へ |

### 7.4 アクセシビリティ

- 結果パネルは既存 `aria-live="polite"` (L338) を維持。成功/エラー文言も同 live region 内
- 全フィールドに `<label htmlFor>` を関連付け。エラーは `aria-describedby` で紐づけ
- honeypot は `aria-hidden="true"` + `tabIndex={-1}` + 視覚的隠蔽 (スクリーンリーダー・Tab 順に露出させない)

---

## 8. 管理画面 UI 仕様

**新規画面なし** (00 §10: nav-items 追加なし)。理由: 本モジュールの管理対象 (価格) は既存 /admin/prices が完備しており (行列インライン編集 + before/after プレビュー 3 例 + 楽観排他)、リードの管理は crm (01: /admin/customers, /admin/deals) と inquiry (既存 /admin/inquiries) の画面が担う。

既存画面への影響:

| 画面 | 変更 | 内容 |
|---|---|---|
| /admin/prices | **なし** (コード変更ゼロ) | 保存時の revalidateTag/Path は実装済み (F6)。SEC.01 カードが連動するようになる旨は README 追記のみ |
| /admin/inquiries | **なし** | シミュレーター発リードは inquiry_type='estimate' + 構造化 body (§4.4) で従来 UI にそのまま並ぶ |
| /admin/customers /admin/deals /admin/documents | 01-crm / 02-sales の設計が正 | シミュレーター取込の顧客/案件/見積原案・タイムライン (simulator_estimate activity) の表示は各書 §UI を参照 |

キーボード操作: 管理画面側の追加操作なし (該当なし — 上記のとおり画面変更ゼロ)。

---

## 9. 認可マトリクス (anon / admin / service / 将来 staff)

### 9.1 テーブル (本書関連分。RLS ポリシー全文は各所有モジュールの migration が正 — 本書は変更を加えない)

| テーブル (所有) | anon | admin | service | 将来 staff (方針) | 備考 |
|---|---|---|---|---|---|
| price_grades / price_options / price_size_classes / price_matrix / price_quantity_tiers (pricing) | SELECT のみ (0002/0007 実装済み) | 全権 (is_admin) | ○ (bypass) | **R のみ** (価格改定は admin 専権の方針) | 変更なし |
| contact_inquiries (inquiry) | INSERT のみ (status='new' 固定ポリシー、0002) | SELECT/UPDATE | ○ | R/W | 変更なし。/api/shop/lead は anon INSERT ポリシー経由 (facade.submit → anon client) |
| rate_limits (inquiry 隣接・service 専用) | ✗ (ポリシーなし) | ✗ | 全権 (bypass) | ✗ | 変更なし。route='shop_lead' 行が増えるのみ |
| customers / deals / activities / activity_links (crm)、documents / document_lines (sales) | ✗ | 00 §5.2 のとおり | ○ | 00 §5.2 | **本書は参照のみ**。anon route からの書込は facade 内部の service client (§5.2 注記) |

### 9.2 API エンドポイント (追加・関連分)

| エンドポイント | Method | 認可 | 主エラー | 将来 staff |
|---|---|---|---|---|
| /api/shop/lead (新設) | POST | anon + rate limit (rate_limits 'shop_lead' 5/h/IP) + honeypot + 最小送信時間 + Zod | E101 / E105 / E901 | 影響なし (公開) |
| /api/revalidate (既存) | POST | x-revalidate-secret (未設定 503 / 不一致 401) | 401 / 503 | 影響なし (機械間) |
| /shop (既存ページ) | GET | anon (公開、SSG + ISR 3600s) | — | 影響なし |

### 9.3 staff 拡張時の差分 (J1 — 00 §5.5 の共通骨子への追記)

本モジュールに staff 固有の差分はほぼない。唯一の方針: **価格マスタ (price_*) の書込は staff に開放しない** (誤改定が公開価格に直結するため admin 専権)。staff は /admin/prices を閲覧のみ (RLS に staff ポリシーを追加する際、price_* は SELECT のみ付与)。

---

## 10. ライフサイクルと状態意味論

### 10.1 シミュレーター本体 — 状態機械なし (該当なし + 理由)

シミュレーターは**無状態の純計算 UI** である: 入力 (grade/size/qty/options) はクライアント state のみでサーバ保存されず、`computeEstimate()` は副作用ゼロの純関数。永続化される状態が存在しないため、状態遷移図・不変条件は「該当なし」。リードフォームのクライアント内状態 (idle/open/submitting/done) は §7.1 に UI 仕様として記載済み (永続状態ではない)。

### 10.2 リードのライフサイクル (発生源としての整理 — 各状態の canonical は所有モジュール)

```
[公開 /shop]                       [inquiry]            [crm]                    [sales]
概算表示 → 送信 ──1──→ contact_inquiries(status='new')
                        │ 2 (失敗しても 1 は残る)
                        └────────→ customers(lifecycle='lead' or 既存に合流)
                                    deals(stage='inquiry', source='simulator',
                                          amount_jpy=total_max | null(XL))
                                    activities('form_submission' + 'simulator_estimate',
                                               冪等キー=inquiry_id)
                                    │ 3 (失敗しても 2 まで残る)
                                    └──────────────────→ documents(doc_type='quote',
                                                          status='draft', 採番なし)
以降: inquiry.status (new→in_progress→done) は既存 /admin/inquiries、deal.stage は 01-crm
      (inquiry→estimating→quote_sent→…)、document.status は 02-sales (draft→issued→…) の状態機械が正
```

部分成立パターンの検出と復旧 (縮退の意味論):

| 成立範囲 | 検出方法 | 復旧操作 |
|---|---|---|
| 1 のみ (crm 停止/service key 未設定) | route の KMB-E9xx ログ + crm-digest ダッシュボード警告 (00 §4.2) | admin が /admin/inquiries から手動リード化 (01-crm の操作) |
| 1+2 (sales 失敗) | 同上ログ | admin が /admin/deals の案件から見積を手動作成 (02-sales) |
| 再送信 (お客様が 2 回押した等) | inquiry は 2 件になる (仕様)。crm activity は inquiry_id 冪等で inquiry ごとに 1 組 | admin が inquiries 側で片方を done/spam に |

### 10.3 キャッシュのライフサイクル (修理対象の状態、§2.4 確定後)

```
[ビルド] プリレンダ (Data Cache 参照) ─→ [配信] Full Route Cache
   ↑                                        │ revalidateTag('prices') (admin 保存 / /api/revalidate)
   │                                        │ または TTL 3600s 経過
   └──── 次リクエストで再生成 ←─────────────┘
```

失効の 2 経路は挙動が異なる (v1.1 — v1.0 は両者を混同していた):

- **on-demand purge (`revalidateTag('prices')`)**: page と Data Cache の両タグエントリが即時無効化され、**次のリクエストはブロッキング MISS で新データを焼き込んで返す** (初回から新データ)。§2.3 Step 2 で「2 回開く」のは、1 回目で確定するはずの結果を再生成失敗 (stale-on-error — R-S2) の検出込みで確認する運用手順であり、キャッシュ意味論上の要請ではない
- **TTL 失効 (時間ベース)**: ISR (P1) / unstable_cache (P2) とも **stale-while-revalidate** — TTL 失効後の初回アクセスは古い内容を配信しつつ背景再生成する。P1 と P2 は独立に失効するため、信号なしのデータ変更が配信に届くまでの最悪ケースは「page TTL 失効 → 背景再生成 (この時点で Data Cache がまだ TTL 内なら**旧データを再度焼き込む**) → Data Cache TTL 失効 → 次のアクセスで再々生成」の**約 2×TTL (約 2 時間) + 次回アクセス** (低トラフィック時はリクエスト駆動のため、さらにアクセス到来まで延びる)。§0.2 / §2.4 P1 / §16.2 S3 の時間表現はこれに合わせてある

---

## 11. 全データパターン列挙

### 11.1 シミュレーター入力パターン (単体テスト・E2E の必須カバー)

| # | パターン | 期待挙動 |
|---|---|---|
| 1 | 全グレード × 全 sellable サイズ (3×3)、qty=1 | ゴールデン 24 件で担保済み (legacy 完全一致) |
| 2 | 数量境界 qty=9/10/29/30 | tier 適用の境界 (−0%/−15%/−15%/−25%)。担保済み |
| 3 | **qty=999/1000 (是正の境界)** | 両方 UI・`zEstimateInput`・snapshot で受理。1001 は clamp (UI) / E101 (契約) |
| 4 | XL (quote_only=true) | 金額 0・「個別見積もり」表示。リード送信可 (金額なし) |
| 5 | matrix セル欠落 (データ不整合) | 安全側で quote_only 扱い (estimate.ts L38-40 実装済み) |
| 6 | multiplier オプション (express ×1.5) / fixed オプション (+¥N) | breakdown に係数/加算が載る。fixed は legacy に無い新機能 (担保済み) |
| 7 | 非アクティブ grade / 未知 option_key | grades から除外表示 / 計算で無視 (担保済み) |
| 8 | priceTable null / grades 空 (取得失敗) | fallback 文言表示 (修理後は発生しないが分岐は維持)。SEC.01 はスロット文言へフォールバック |
| 9 | tier 0 件 / options 0 件の価格表 | 「適用なし」表示・オプション欄非表示 (実装済み分岐) |
| 10 | size.label が 31 字以上 (D7 factor 上限超え — v1.1 で上限 30 に是正済み) | `buildSimEstimateSnapshot` が 30 字に切り詰め、送信は成功する (§4.3)。size.label 自体は zPriceSizeClassInput で ≤30 のため通常は発生しない (防御線) |
| 11 | grade を is_active=false 化 (提供終了) — v1.1 追加 | シミュレーターの選択肢からは消える (#7) が、**SEC.01 カードは 3 枚固定 (§7.2) のため該当カードと CTA は表示され続け、価格表示は formatGradeCardPrice が null を返してテキストスロットのフォールバック文言 (既定は「¥7,000〜」等の実額) に戻る** — 提供終了を示す表示にはならない。無効化時はスロット文言の手動更新が運用上必須 (§18 R-S6) |

### 11.2 リード送信パターン

| # | パターン | 期待挙動 |
|---|---|---|
| L1 | email + tel あり | 全経路成立。顧客 dedup は email 第 1・tel 第 2 キー (01-crm) |
| L2 | email のみ (tel null) | 成立 (email 必須設計 §4.2) |
| L3 | 電話のみ希望のお客様 | フォームでは送信不可 (email 必須)。**電話チャネル (04-telephony) が受け皿** — フォーム脇の誘導文言は既存 /contact ページの電話案内に委ねる |
| L4 | 同意チェックなし / 本文なし送信 | 400 E101 (privacy_agreed は literal(true)) |
| L5 | honeypot 充填 / 3 秒未満送信 | 200 stealth (保存なし・学習させない) |
| L6 | 同一 IP 6 回目/時 | 429 E105 |
| L7 | service key 未設定環境 (現本番) | rate limit fail-open + inquiry 保存成立 + crm/sales 縮退 (E901 ログ)。応答 200 |
| L8 | crm のみ失敗 / sales のみ失敗 | §10.2 の部分成立パターン。inquiry は必ず残る |
| L9 | XL リード | 金額なし deal + 明細 0 行の原案 (T5)。00 §7 パターン 12 と 1:1 |
| L10 | 同一人物の再問い合わせ (email 一致) | 既存顧客に合流し deal のみ新規 (00 §7 パターン 4 — 01-crm の dedup が担う) |
| L11 | 二重クリック / リトライ再送 | ボタン disabled で抑止。すり抜けた場合は inquiry 2 件 (§10.2 表 3 行目) |
| L12 | 送信成功後に条件を変えて再問い合わせ (done→open — v1.1 追加) | CTA 再クリックで done を脱出 (§7.1 状態機械)。form_rendered_at は再設定されるため 2 通目もスパムガードを正しく通過し、inquiry は 2 件 (仕様 — §10.2 の再送パターンと同じ扱い) |

### 11.3 修理・キャッシュのパターン

| # | パターン | 期待挙動 |
|---|---|---|
| C1 | revalidateTag 後の初回/2 回目アクセス | on-demand purge のため**初回アクセスからブロッキング MISS で新データ** (§10.3)。手順としては 2 回開いて確定確認 (§2.3 Step 2 — stale-on-error 検出を兼ねる) |
| C2 | 価格改定 (admin 保存) → /shop と SEC.01 カード | 即時反映 (revalidateTag+Path 実装済み)。受入 S5 |
| C3 | seed スクリプト投入 → revalidate-tags.ts 実行 | 反映。実行忘れ時も TTL で自己修復 — 最悪 約 2×TTL + 次回アクセス (§10.3。受入 S3) |
| C4 | REVALIDATE_SECRET 未設定 | /api/revalidate 503 (F7)。修理手順 Step 0 で先に解消 |

---

## 12. 印刷出力仕様 — 該当なし (理由明記)

本モジュールは印刷物を生成しない。シミュレーター発の見積原案が帳票 (見積書 PDF) になるのは admin の発行操作時であり、その様式・margin boxes・電帳法保存はすべて **02-sales.md §印刷出力が正** (00 §0.6)。本書からの要求は 1 点のみ: 原案の備考 (T4) に転記されたシミュレーター内訳が、見積書様式の備考欄で欠落なく印字されること — **申し送り採用済み** (07-contracts-delta v1.1「裁定記録」#16: 02-sales §2.4 データパターン #21 として追加済み)。

---

## 13. 差分表示仕様

| 対象 | 仕様 | 状態 |
|---|---|---|
| 価格表変更のプレビュー | /admin/prices の before/after 見積り 3 例並記 (`computeEstimate` を新旧テーブル両方に適用) | **実装済み・変更なし** (price-table-editor.tsx。00 §8 の割当どおり) |
| SEC.01 カード価格 | 導出表示 (§7.2) のため版・差分の概念なし。改定即反映 | 該当なし + 理由: 表示は price_matrix の純関数像であり、履歴は /admin/prices 側の価格表が持つ |
| 見積原案 vs シミュレーター入力 | 原案編集画面にスナップショット (activity payload) を参考表示 | **02-sales.md §差分表示が正** (00 §8)。本書はデータ供給側 (snapshot の完全性 = §4.3) を担保 |

---

## 14. エラーコード表 (所有なし — 共用・参照の全列挙)

本モジュールはエラーコードを**新設しない** (00 §10)。使用コードと recovery 文言:

| コード | 所有 | 本書での発生点 | ユーザー/admin 向け recovery |
|---|---|---|---|
| KMB-E101 | (共用・入力検証) | zSimulatorLeadReq / zEstimateInput 検証失敗 | 入力内容の修正を促す (§7.1 error.invalid)。qty 1000 是正後は 1..1000 が正 |
| KMB-E103 | (共用・楽観排他) | /admin/prices 保存競合 (既存・変更なし) | 再読み込みして再編集 |
| KMB-E105 | inquiry (レート制限) | /api/shop/lead 5 件/時超過 | 時間を置いて再送 (§7.1 error.rate_limited)。**前提: M0 #1-1 で errors.ts に E105 を登録 (00 §3.3 housekeeping)。未登録のまま本 route を実装しない**。実装注意: 既存 rate-limit.server.ts の超過時返却は `KMB-E101` ハードコード (L53) — §6.1 のとおり E105 へ変更が必要 (v1.1) |
| KMB-E607 | crm | intakeFromSimulator の連絡先欠落 | §4.2 の email 必須により本経路では発生しない (契約上の防御線として参照) |
| KMB-E901 | (共用・システム) | 価格表取得失敗 / inquiry 保存失敗 / crm・sales 縮退ログ | 公開側は fallback/generic 文言。admin は Vercel logs + crm-digest 警告から §10.2 の復旧操作 |

---

## 15. テスト戦略 (implementer + tester ペア・2 回連続 PASS 粒度)

### 15.1 レイヤ × テストファイル対応 (00 §9.2 の「settings/simulator」行を simulator 分に具体化)

| レイヤ | ファイル (tests/) | 対象・合格条件 |
|---|---|---|
| 単体 | `pricing-estimate.test.ts` (既存拡張) | **既存 24 件を無変更で維持** + 追加: qty=999/1000/1001 の zEstimateInput parse 境界 3 件、qty=1000 の computeEstimate ゴールデン (legacyOracle 一致) 2 件 |
| 単体 | `pricing-price-display.test.ts` (新規) | formatGradeCardPrice: seed 値で base→"¥7,000〜" / standard→"¥10,000〜" / premium→"¥15,000〜"、null 系 (table null / 非アクティブ grade / セル 0 件 / 全サイズ quote_only)、min 選択 (複数セルの最小)、toLocaleString 桁区切り |
| 単体 | `shop-lead-contracts.test.ts` (新規) | zSimulatorLeadReq (正常/email 欠落/同意 false/honeypot 上限/strict 余剰キー拒否)、buildSimEstimateSnapshot (D7 上限切り詰め — 31 字 label / 31 字 factor (v1.1 で max 30 に改訂済み) / option 11 個)、buildInquiryBody (quote_only 分岐・message 有無・zInquiryInput.body を実際に parse して通ることまで検証) |
| 単体 | `contact-spam-guard.test.ts` (既存拡張) | spam-guard.ts の純関数群 (isHoneypotFilled / isSubmittedTooFast / computeWindowStart / isRateLimited / hashIp) の既存テスト無変更 PASS 維持 + `SHOP_LEAD_RATE_LIMIT_ROUTE` 定数追加の確認。**checkAndRecordRateLimit は server-only + service client 依存であり本ファイルの対象外** (v1.1 是正 — v1.0 の「route パラメータ化 (純関数部)」は対象の実装粒度が成立していなかった)。route 引数化 (既定 'contact_form' 後方互換 / 'shop_lead' 別集計) と超過時 E105 返却への変更は `shop-lead-route.test.ts` 側で検証 |
| 単体 | `revalidate-tags.test.ts` (新規) | スクリプトの URL/ヘッダ/ボディ組み立て純関数 + secret 未設定 fail-closed |
| 結合 (route) | `shop-lead-route.test.ts` (新規) | facade 4 本 (pricing 含む) + service client をモック注入し: 合成順序 (0-e→1→2→3)、手順 2/3 失敗時に 200 + 手順 1 結果保持 (**巻き戻さないことの検証が本丸**)、stealth 2 経路 + **stealth 前段が strict parse より先であること** (honeypot 充填かつ契約違反 body で 400 ではなく 200 — v1.1)、**0-e サーバ再計算** (改ざん totals/labels がサーバ値で上書きされ手順 1〜3 に載らない・乖離注記の付与・表取得失敗時の未検証縮退 — v1.1)、checkAndRecordRateLimit の route 引数 'shop_lead' + 超過時 KMB-E105 返却 (v1.1)、429/400/500 の status↔code 対応表 §6.1 全行 |
| 結合 (DB) | (crm 01 / inquiry 既存と分担) | intakeFromSimulator の inquiry_id 冪等 (同 ref 二重 append → created:false) は 01-crm の `crm-intake` が正。rate_limits 'shop_lead' 行の実 INSERT は supabase start で Phase 5 に実施 |
| 契約 parity | `contracts-ddl-parity.test.ts` | 追加なし (本モジュールは DDL を持たない)。quantity は DDL 制約なしのため parity 対象外であることをテストコメントに明記 |
| E2E (本番前・人が実行) | Chrome MCP | §2.3 の修理実測 (S1) / §7.3 キーボード全項目 / 送信→ /admin/inquiries・customers・deals・documents の 4 点確認 (S6) / SEC.01 連動 (S5) |

### 15.2 運用

implementer と tester をペア配置し、修正→再検証ループ、**2 回連続 PASS で完了** (全プロジェクト規約)。カバレッジ: 契約 (schema.ts) と純関数 (price-display / builder 2 本) は分岐 100%、route は主要 4 応答 + 縮退 2 経路で実質全分岐。既存ゴールデン 24 件の PASS 維持は毎ラウンドの必須ゲート。

---

## 16. 移行計画と受入基準

### 16.1 移行手順

データ移行は**なし** (新テーブルなし・既存データの変換なし)。デプロイ順序のみ規定する:

1. Phase 0 (#0-1): §2.3 の修理 (コード変更なしで実施可能) → §2.4 P1/P2/P3 のコード変更を PR → merge → 本番で S1〜S3 確認
2. Phase 4 (#4-2): §4.1 (c) + §4.5/§7.2 (b) + §4.2〜§4.4/§6.1/§7.1 (a) を実装。(a) の本番有効化は Phase 2 (crm) / Phase 3s (sales) の本番 migration 適用後
3. ロールバック: (a) は route 削除 + CTA を旧 handleOrder に戻す 1 revert で復旧可能 (DB 影響なし)。(b)(c) は表示/検証のみで revert 安全

### 16.2 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| S1 | 本番 /shop の #sim にフォーム一式が描画され概算が出る (00 §14 A5 と同一) | §2.3 Step 1-2 (Chrome MCP 実機、2 回アクセス) |
| S2 | /admin/prices で価格改定 → 保存 → /shop とSEC.01 カードに即時反映 (→ 元に戻す) | 本番実機 (改定→確認→復元の 3 手) |
| S3 | seed 系スクリプト投入 → `revalidate-tags.ts prices` → 反映。実行を忘れても**最長 約 2 時間 + 次回アクセス**で自己修復 (二層 TTL の独立 SWR 失効 — §10.3。v1.1: v1.0 の「1 時間以内」は過小表示だった) | ステージング (TTL は時計を待たず preview デプロイで確認可) + README 手順どおりの素振り |
| S4 | qty=1000 が UI・`PricingFacade.estimate`・/api/shop/lead の 3 経路で受理され、既存ゴールデン 24 件が無変更で全 PASS | vitest run + 実機 |
| S5 | price_matrix の base/s セルを変更すると SEC.01 カード 1 枚目の金額が追随する | S2 と同時に確認 |
| S6 | 「この内容で問い合わせる」1 送信で contact_inquiries + customers + deals + activities (form_submission / simulator_estimate) + documents(draft) が揃う | ステージング (supabase start または本番前検証環境) で SQL 確認 |
| S7 | crm/sales を意図的に失敗させても (service key 除去) 200 応答 + inquiry が残る + E9xx ログ | 結合テスト (`shop-lead-route.test.ts`) + ステージング |
| S8 | クリップボードコピー UX の残骸がない (`navigator.clipboard` / `toast.copied` / `toast.redirect` が /shop 系コードから消滅) | grep + 実機で送信フロー確認 |
| S9 | §7.3 キーボードチェックリスト全項目 PASS | E2E (本番前に人が実行 — 全プロジェクト規約) |

---

## 17. 規模見積り

| 作業 | 内容 | 概算規模 (実装+テスト行数) |
|---|---|---|
| Phase 0 #0-1 (修理) | P1/P2 (計 3 行) + revalidate-tags.ts (~60) + README 追記 + 実測手順の実施記録 | 〜150 (00 §13 の Phase 0 枠 400 の内数。残りは実測・記録作業) |
| (c) qty 是正 | contracts 1 行 + 境界テスト 5 件 | 〜60 |
| (b) SEC.01 DB 駆動化 | price-display.ts (~40) + page-body.tsx 差し替え 3 箇所 (~60) + registry label 変更 + テスト (~120) | 〜250 |
| (a) リード接続 | schema.ts (~140) + route.ts (~150) + shop-lead-form.tsx (~280) + shop-simulator.tsx CTA 置換 (~60) + rate-limit 拡張 (~15) + スロット追加 (~130) + テスト (~450) | 〜1,250 |
| **合計** | | **〜1,700** (00 §13 v1.2: Phase 4 settings/simulator 合算 **〜3,500** のうち simulator 分 — 05 §14 の合算明示に伴い 00 側が改訂済み。v1.2: 旧「合算 2,200 と整合」宣言は 05 分 〜1,800 との合算が 2,200 を超えるため撤回) |

新規ファイル 5 (schema.ts / route.ts / shop-lead-form.tsx / price-display.ts / revalidate-tags.ts)、変更ファイル 6 (pricing contracts / pricing facade / shop page.tsx / page-body.tsx / shop-simulator.tsx / slots/shop.ts + spam-guard・rate-limit)。migration 0。ランニングコスト増分ゼロ (AI 呼び出しなし・外部 API なし)。

---

## 18. リスクと要確認事項

| # | リスク / 確認 | 影響 | 対応 |
|---|---|---|---|
| R-S1 | revalidateTag で直らない (原因 ② env) | 修理遅延 | §2.3 Step 3 の切り分けを手順化済み。env は堀さん作業 (C2) |
| R-S2 | ISR 化 (revalidate=3600) によりビルド/再生成時の DB 到達が前提になる | 再生成失敗時は古い HTML を配信し続ける (Next.js の stale-on-error 挙動) — fallback 文言よりは安全側 | 監視は Vercel logs の KMB-E901。恒久対処不要と判断 |
| R-S3 | プレミアム価格表記が「¥15,000–35,000」→「¥15,000〜」に変わる (§4.5 裁定) | 見た目の情報量減 | 堀さん確認推奨。異議があれば price.note スロットに「〜¥35,000」を追記する運用で吸収可能 (コード変更不要) |
| R-S4 | email 必須により電話派のお客様がフォームから送れない | 機会損失は限定的 (L3) | telephony (04) が受け皿。/contact の電話案内も既存どおり |
| R-S5 | crm/sales 未完了期間に (a) を本番に出すと常時縮退ログが出る | ノイズ | Phase 4 #4-2 の本番リリースを Phase 2/3s 後に固定 (00 §11 と一致) |
| R-S6 (v1.1) | grade を is_active=false 化しても SEC.01 カードは 3 枚固定のまま残り、価格表示がフォールバック文言 (既定は旧実額「¥7,000〜」等) に戻る | 提供終了したはずのグレードが実売価格付きで案内され続ける (§11.1 #11) | **運用注意として明記**: グレード無効化の際は shop.grade.N.price / price.note スロットの手動更新をセットで行う (README の価格運用手順に追記)。カード枚数の動的化は §7.2 の裁定どおり行わない |
| 確認 9 | 旧 GitHub Pages の閉鎖 or リダイレクト | 旧価格の独り歩き | §2.5。**修理完了 (S1) 後に実施**の順序制約のみ本書が固定 |

---

## 19. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 |
|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §9 (テーブル 4 列 + API + staff 差分方針) |
| ② テスト戦略表 (単体+結合、ペア 2 連続 PASS 粒度) | §15 (ファイル名 + 合格条件 + 分担境界) |
| ③ エラーコード表 | §14 (所有なし — 共用/参照の全列挙 + recovery + E105 登録前提の明記)。採番 canonical は 00 §3.3 |
| ④ ライフサイクル | §10.2 (リード成立/縮退) + §10.3 (キャッシュ) |
| ⑤ 全データパターン列挙 | §11 (入力 10 + リード 11 + キャッシュ 4 パターン) |
| ⑥ 印刷出力仕様 | §12 — **該当なし + 理由** (帳票は 02-sales が正。備考転記の申し送りのみ) |
| ⑦ 移行受入基準 | §16 (S1〜S9 + デプロイ順序 + ロールバック) |
| ⑧ 規模見積り | §17 (〜1,700 行。00 §13 v1.2 の Phase 4 = 〜3,500 の内数) |
| ⑨ 状態意味論 | §10.1 — シミュレーター本体は**該当なし + 理由** (無状態)。リード側は所有モジュール canonical への参照 (§10.2) |
| ⑩ 差分表示仕様 | §13 (/admin/prices プレビュー流用・変更なし + 該当なし理由 + 02-sales への委譲) |
| モジュール契約 (全プロジェクト規約) | §1.3 / §5 — 契約変更は 07 §D6 のみ (本書は module-contracts.md を編集しない)。app 層ローカル契約は §4.2 |
| 値契約 (Zod canonical) | §4 (新規 = 完全記述 / canonical = 引用明示で再定義なし) |
| 非機能要件 | §2.4 (キャッシュ戦略・TTL 根拠) / §6.1 (p95 < 3s・rate limit) / §17 (コスト増ゼロ) |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.2 | 2026-07-11 | **§17 合計行 + §16 適合表⑧**: 「00 §13: Phase 4 合算 2,200 のうち simulator 分。整合」宣言を撤回 (05-site-settings §14 v1.1 が明示した 05+06 = 〜3,500 と矛盾していた — final-check V13)。00-overview v1.2 が Phase 4 行を 〜3,500 に改訂したことに追随し「〜3,500 の内数」へ更新。本書自体の見積り (〜1,700) は不変 |
| v1.1 | 2026-07-11 | レビュー指摘反映 (BLOCKER 1 / MAJOR 5 / MINOR 12 系統を裁定・統合)。**§6.1**: 0-e サーバ再計算を新設 (クライアント snapshot の金額・ラベルを信頼せず getActivePriceTable + computeEstimate で正本 snapshot を組み立て。乖離注記 §4.4)・stealth 前段判定を strict parse より先に移動 (contact actions.ts の順序に整合)・rate-limit.server.ts の超過時 code E101→E105 変更を明記・00 §5.3 主エラー行 (E607) の誤りを申し送り化。**§5.4 T1/T2/T4/T6**: 見積原案変換を 02-sales §9.1 に一本化 (金額先行式・独自 description/notes 文言・「±2 円」規定・実在しないテスト名 sales-estimate-to-draft を撤回)。**§5.2**: 手順 0 (サーバ再計算) 追加・手順 3 に E603 追記・本番 service key 記述を「ローカル実測 + 本番未確認 (確認事項 5)」に是正。**§4.2〜§4.4**: optionLabels のサーバ解決化 (契約に存在しないフィールドへの依存を解消)。**§4.5**: PriceTable フィールド名は実装準拠 (size_classes/quantity_tiers) — module-contracts §4.9 の旧記述是正は 07 裁定 #18。**§2.3 Step 0**: env 変更後 redeploy 必須に是正。**§0.2/§2.4/§10.3/§11.3/§16.2 S3**: 自己修復の時間保証を「最悪 約 2×TTL + 次回アクセス」に是正し on-demand purge (ブロッキング MISS) と TTL 失効 (SWR) を区別。**§7.1**: cta maxLen 16 現状維持 (30 は誤記)・done→open 脱出遷移追加・429 クールダウンをウィンドウ境界基準化 + rate_limited 文言に待機目安・送信 payload の記述是正。**§11**: パターン #11 (非アクティブ grade × SEC.01 カード)・L12 (成功後再送) 追加。**§14/§15.1/§18**: E105 実装注意・テスト対象の実装粒度是正 (checkAndRecordRateLimit は route 結合テスト側)・R-S6 追加 |
| v1.0 | 2026-07-11 | 初版。裁定 J6 (0)(a)(b)(c) 準拠。本番修理の切り分け手順と恒久策 (ISR+タグ二重化・seed 運用手順化)、リード接続の app 層合成 (facade 3 本のエラー全列挙 + 巻き戻さない縮退設計)、SEC.01 の DB 駆動化 (formatGradeCardPrice)、quantity 1000 是正 (07 §D6 引用) を確定。実コード裏取り: page.tsx / facade.ts / shop-simulator.tsx / estimate.ts / contracts.ts / revalidate route / inquiry 系 / rate-limit / slots/shop.ts / seed スクリプト / ゴールデンテスト |
