# 08 メール対応システム(Phase2 要件定義) — ステータス: 要件定義ドラフト v1(2026-07-16)。未解決OQ(特にブロッカー5件)は実装着手前に堀さんの確認が必要

- 版: v1 (2026-07-16: 要件定義ドラフト確定版 — issue #100「受信メールのタイムライン統合と不明メールルーティング」の要件定義。実装は範囲外)
- 作成: Fable 5 (要件定義サブエージェント)
- 位置づけ: **issue #100 の要件定義の正**。本書は `docs/design/crm-suite/` シリーズの 08 として、00-overview〜07-contracts-delta に連なる。堀さん確認 3 点 (§9 OQ-1〜3) を含む**ブロッカー 5 件 (OQ-1〜5)** の回答とスコープ裁定 (J7 改訂) を経て、本書を DDL 詳細・画面ワイヤ・状態遷移網羅表まで肉付けした**設計確定版に改訂**する。上位 canonical は [00-overview.md](./00-overview.md) (エラーコード帯・所有割当・M0 基盤) / [01-crm.md](./01-crm.md) (activities ハブ・appendActivity 契約) / [04-telephony.md](./04-telephony.md) (不明ルーティング状態機械の参照モデル) / [02-sales.md](./02-sales.md) (outbound 帳票メール #101)
- 入力資料: issue #100 本文 (論点整理済み) / 現状調査 3 本 (既存メール送信インフラ・タイムライン統合モデル・不明コンタクト照合) / 実コード裏取り (`src/modules/crm/{contracts,facade,repository}.ts`、`src/modules/crm/internal/{dedup,intake}.ts`、`src/modules/sales/{facade.ts,internal/email.ts}`、`src/modules/telephony/internal/worker.ts`、`src/app/admin/calls/[id]/CustomerLinkSection.tsx`、migration 0023/0036)
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提・依存:
  - **#62/#63 (v1 ロードマップ) 完了後に着手** (issue #100 明記)
  - **独自ドメイン + MX/DNS 管理が絶対前提** (§9 OQ-5、#13 依存)。現本番 `kumabe-tosou.vercel.app` は MX 設定不可のため、受信基盤はドメイン取得なしには成立しない
  - `RESEND_API_KEY` は本番未払い出し (`.env.local` 空、HANDOFF.md「❌未取得」)。**outbound 含め Resend 自体が本番未稼働の可能性がある**状態からのスタート
  - 裁定 J7 (メール連携 v1 スコープ外・`'email'` 予約) は本 Phase 2 で**改訂対象** — inbound 解禁の新裁定 (仮称 J13) を堀さん回答後に確定する (§10)

---

## 0. 業務シナリオ

塗装職人 (熊部さん) のメールの一日を描く。IT 用語は使わない。電話 (04-telephony §0) と対になるシナリオ。

### 0.1 写真付きの相談メールが、勝手にお客さんの履歴に並ぶ

朝、以前パール仕上げを頼んでくれたお客さんから「前回と同じ仕上げで、今度は HG を 2 体お願いできますか」というメールが届く。キットの写真も 3 枚付いている。熊部さんは何も操作していないのに、管理画面のそのお客さんのページを開くと、履歴の一番上に「受信メール: HG 2 体の相談 (添付 3 件)」が並んでいる。前回の見積額も作業時間もすぐ下に見えるから、「同じ仕上げなら◯◯円、納期は 2 週間です」と、記憶に頼らず即答できる。

### 0.2 知らない人からのメールは「未処理」の箱で待っている

昼、見覚えのないアドレスから「ホームページを見ました。ジオラマの塗装もお願いできますか」というメールが届く。誰の履歴にも勝手には載らない。かわりに管理画面の「メール」に「未処理 1 件」のバッジが灯る。開くと本文と差出人が見えて、「新しい顧客として登録」を押せばリードとして履歴が始まるし、「この人は既存のあのお客さんだ」と分かれば検索して紐づけるだけ。メルマガや営業メールなら「無視」を押せば箱から消え、二度と邪魔をしない。

### 0.3 家族で同じメールアドレスを使っているお客さん

夕方、親子で別々に依頼をくれている高橋さん (共用アドレス) からメールが届く。システムは勝手にどちらかに決めつけず、「候補が 2 人います」と表示して熊部さんの判断を待つ。ワンタップでお父さんの方に紐づければ、以後の表示はその履歴に載る。**間違った履歴に自動で混ざることがない**のがこの箱の約束。

### 0.4 自分が送ったメールも、BCC ひとつで控えが残る

熊部さんはいつものメールソフトから見積の補足をお客さんに送るとき、宛先に加えて「控え用アドレス」を BCC に入れるだけ。送った内容がそのままお客さんの履歴に「送信メール」として並ぶ。半年後に「あのときどう説明したっけ」となっても、電話の録音・帳票と同じ一列で読み返せる。

### 0.5 スコープ外 (Phase 2 で扱わないもの)

| 項目 | 理由・扱い |
|---|---|
| 管理画面からのメール**返信・作成** (フルメールクライアント、issue 案 C) | 送信は既存メールソフト + BCC 控えで足りる。下書き AI 返信等は Phase 3 以降の別 issue |
| 帳票 PDF のメール送付 (outbound) | **実装済み** (#101 / PR #106、`document_emails` + `salesFacade.sendDocumentByEmail`)。本 Phase の対象外だが §3.4 でタイムライン表示を統一する |
| 問い合わせ通知・日次ダイジェスト等の一方向通知 | 既存どおり (`inquiry/internal/notify.ts` / `crm/internal/notify.ts`)。往復記録の対象にしない |
| メールからの自動顧客作成 (telephony `created` 相当) | **意図的に不採用** (§4.2)。スパム/メルマガ混入があるため、0 件一致は `unmatched` に落として人間が判断する |
| メールからのタスク自動起票・AI 要約 | v2 では未処理バッジで代替 (§4.6)。AI 議事録相当は将来拡張 |
| SMS / LINE 等の他チャネル | 対象外 |
| 複数メールアドレス台帳 (`customer_emails` テーブル) | §9 OQ-6。v2 では `customers.email` 単一カラムのまま |

### 0.6 印刷出力

**該当なし**。受信メールは帳票 (取引書類) ではない。ただし**添付ファイルが請求書・見積書等の取引情報を含む場合は電帳法の電子取引データ保存義務の対象になり得る** — 保存の期待水準は堀さん確認 ③ (§9 OQ-3) で裁定する。紙出力需要はゼロ、必要ならブラウザ印刷で足りる。

---

## 1. 目的とスコープ

### 1.1 目的

顧客との**受信メール (inbound) と送信控え (BCC)** を、電話 (`call`)・問い合わせ (`form_submission`)・帳票 (`document_event`) と同じ単一タイムライン (`activities` ハブ) に統合し、差出人不明のメールを電話の不明番号ルーティングと**同型の状態機械 + 手動割当 UI** で捌けるようにする。

### 1.2 対象 (issue #100 案 B ベースで確定)

1. **受信基盤**: inbound webhook (+BCC 控えアドレス) でメールを取り込み、`emails` / `email_attachments` に永続化する (§2)
2. **タイムライン統合**: 照合成立したメールを `appendActivity('email')` で顧客/案件タイムラインに載せる。KMB-E604 の inbound 一律拒否を解除する (§3)
3. **不明メールルーティング**: `emails.match_status` 状態機械 (pending/matched/ambiguous/unmatched/manual/ignored) + `/admin/emails` 一覧・詳細 + 手動割当 UI (§4)

### 1.3 非対象

§0.5 のとおり。特に**フル送受信クライアント (案 C) は明示的に不採用**、**手動転記フォームのみ (案 A) は案 B の前提が崩れた場合のフォールバック**として §8 に残す。

### 1.4 既存メール送信インフラとの関係

| 資産 (#101 で構築済み) | 本 Phase での扱い |
|---|---|
| `document_emails` テーブル (migration 0036、追記専用送信台帳) | **変更しない**。帳票送信の台帳として存続。`emails` とは目的が異なる (帳票送信の証跡 vs 汎用メール往復記録) ため統合しない |
| `sendDocumentEmail()` (`sales/internal/email.ts`、Resend SDK) | 変更しない。Resend アカウント・API キーは inbound と共用 |
| `zEmailActivityPayload` (outbound 専用フィールド) | **後方互換の拡張** (§3.2)。既存 outbound 行の payload parse を壊さない |
| `crmFacade.appendActivity` の inbound 拒否分岐 (KMB-E604、facade.ts L764-773) | **削除** (M1)。01-crm.md L1702 の「拒否分岐を外すだけ」という将来見通しどおり |
| `activity-timeline.tsx` の `case "email"` (direction 分岐実装済み) | 受信メール詳細 (`/admin/emails/[id]`) へのリンク追加のみ (§3.3) |
| `/api/telephony/shared.ts` の HMAC 署名検証パターン | inbound webhook 署名検証の踏襲元 (§2.4) |

---

## 2. 受信メール取り込み要件

### 2.1 取り込み方式の候補と選定観点

**技術検証が未了** (issue #100 論点 3)。以下を M0' (前提整備、§8) で裏取りした上で選定する。

| 候補 | 概要 | 利点 | 懸念 (要裏取り) |
|---|---|---|---|
| **B1: Resend Inbound** (第一候補) | 独自ドメインの MX を Resend に向け、受信を webhook (POST) で受ける | 送信側 (#101) と同一ベンダ・同一 API キー体系。webhook は Vercel route で受けられる (常駐プロセス不要)。署名検証 (Svix 方式) あり | 2025 年提供開始の新機能 — 成熟度・料金・添付サイズ上限・再送ポリシー・保持期間が未確認。**MX をまるごと Resend に向けると既存メールボックス受信と両立しない可能性** → 専用サブドメイン (例: `mail.<domain>` / `crm@in.<domain>`) 運用が現実解か |
| B2: Cloudflare Email Routing + Worker | CF でメール受信 → Worker で parse → 自 API へ POST | 無料枠が広い。既存アドレスへの転送と両取りできる | パース (MIME 分解・添付抽出) を自前実装。運用箇所が 1 つ増える |
| B3: 既存メールボックスからの自動転送 | Gmail 等の転送設定で inbound アドレスへ転写 | 業務メールボックスを移行しなくてよい (堀さん確認 ① 次第で最有力) | 転送時のヘッダ書き換えで元 From の判別に `X-Forwarded-For`/`Resent-From` 解析が必要。SPF/DKIM 検証結果が転送で壊れる |
| B4: IMAP ポーリング | pg_cron worker で IMAP 取得 | webhook 不要 | Vercel serverless で IMAP 長接続は不向き。認証情報管理 (Vault) が増える。非推奨 |

**選定観点** (優先順): (1) 業務メールボックスの実態との整合 (OQ-1)、(2) 送信側 Resend との運用一元化、(3) Vercel serverless で完結すること (常駐不可 — J3 と同じ制約)、(4) 署名検証・再送などの webhook 品質、(5) 料金。**BCC 控え (§0.4) は、選定方式が受ける同じ inbound アドレスを BCC 先に使う**ことで追加基盤なしに実現する。

### 2.2 パース要件

取り込み時に以下を構造化して保存する (原文は `raw` jsonb に全量保持し、再処理可能にする):

| 項目 | 要件 |
|---|---|
| From / To / Cc | 表示名とアドレスを分離。アドレスは **lowercase 正規化**した突合用カラム (`from_email` 等) を別途持つ (customers.email の `lower()` 部分インデックスと対で使う) |
| 件名 | そのまま保存。空件名は「(件名なし)」表示 (表示側の責務) |
| 本文 | `body_text` (text/plain) と `body_html` を両方保存。text/plain が無い場合は HTML から strip して生成。**snippet (先頭 ~140 字、タイムライン payload 用) は取り込み時に生成** |
| 添付 | ファイル名・MIME type・サイズを `email_attachments` に、実体を Storage バケット `email-attachments` に保存 (§5.3)。inline 画像 (cid:) も添付として扱う。**サイズ上限はプロバイダ制限の裏取り後に確定** (超過時は「添付は保存できませんでした」のメタデータのみ残し、メール本体の取り込みは失敗させない) |
| スレッドヘッダ | `Message-ID` / `In-Reply-To` / `References` を保存 (§3.5) |
| 認証結果 | プロバイダが付与する SPF / DKIM / DMARC 検証結果を保存 (§2.5) |
| 受信日時 | プロバイダのタイムスタンプを `occurred_at` の源にする (webhook 到達時刻ではなく) |

### 2.3 冪等性

- `emails.provider_message_id` (プロバイダ払い出し ID) に **unique index**。webhook 再送は `ON CONFLICT DO NOTHING` で吸収する
- タイムライン側は既存の `activities (activity_type, ref_table, ref_id)` 一意 index がそのまま効く: `ref_table='emails'`, `ref_id=emails.id` を冪等キーに使う (**新規実装不要** — telephony `calls` と同型)
- 添付保存は「emails INSERT 成功 → 添付 DL/保存 → email_attachments INSERT」の順とし、途中失敗はメール行の `ingest_status`/`error_detail` に記録して**リトライ可能**にする (webhook 15 秒級のタイムアウト制約がある場合、添付処理は telephony の pg_cron worker パターンに逃がす — 方式選定後の設計判断、§8)

### 2.4 セキュリティ — webhook 側

- **署名検証必須**。Resend の場合は Svix 方式 (svix-id / svix-timestamp / svix-signature、HMAC-SHA256 + タイムスタンプ許容窓によるリプレイ防止)。実装は `/api/telephony/shared.ts` の HMAC パターンを踏襲 (issue #100 で名指し済み)。検証失敗は 401 + **KMB-E840** (§6)
- 署名シークレットは新規 env `RESEND_INBOUND_WEBHOOK_SECRET` (仮称、方式確定後に命名)。既存どおり単純 env + `src/lib/env.ts` の zod optional で管理し、未設定時は `isInboundConfigured()` 判定で route が 503 を返す (E644 の `isResendConfigured()` と同型)
- route は `/api/mail/inbound` (仮)。処理は **ExecutionContext `{mode:'service'}`** で MailFacade を呼ぶ (telephony webhook と同型)

### 2.5 セキュリティ — なりすまし・コンテンツ

- **SPF/DKIM/DMARC の検証結果を保存し、DMARC fail (または SPF+DKIM 両 fail) のメールは自動 matched にしない** — From 詐称による他人の履歴への混入 (なりすまし紐付け) を防ぐ。該当メールは `unmatched` に落とし、詳細画面に「送信元認証に失敗しています」の警告を出す
- **HTML 本文はサニタイズしてから表示** (stored XSS 対策)。`/admin` は管理者専用だが、外部入力 HTML をそのまま render しない。sanitizer の選定 (DOMPurify + iframe sandbox 等) は設計判断
- 添付の実行可能ファイル等はダウンロード時に `Content-Disposition: attachment` 固定 (inline 実行させない)
- BCC 控え (outbound) の判定: **From が自ドメインの送信アドレスに一致する場合のみ** direction='outbound' として記録し、照合対象を To 側アドレスに切り替える (§4.3)。自ドメイン一致しないメールを outbound と誤認しない

---

## 3. タイムライン統合要件

### 3.1 接続方式 — 既存ハブに 1 エントリ追加するだけ

現行タイムライン統合モデル (単一 `activities` + `activity_links`、書き込みは `CrmFacade.appendActivity` のみ、`listTimeline` が payload を行単位 parse) に**追加インフラなしで**載せる。調査で確認済みのとおり、必要なのは次の 3 点のみ:

1. `crm/facade.ts` の **inbound 一律拒否分岐 (KMB-E604) の削除** — DB check 制約は migration 0023 時点で `'email'` 登録済み、migration 不要
2. `zEmailActivityPayload` の**後方互換拡張** (§3.2)
3. **`emails` テーブル (ref 先) と照合 (`matchCustomerByEmail`) の新設** (§4/§5)

### 3.2 契約改訂 (`zEmailActivityPayload`)

現行 (outbound 専用): `direction` + `subject` + `to` + `document_id` + `doc_no` + `version` + `provider_message_id`。

追加フィールド (**すべて optional — 既存 outbound 行の parse を壊さない**):

| フィールド | 型 | 用途 |
|---|---|---|
| `email_id` | uuid | `emails.id`。受信メール詳細 `/admin/emails/[id]` へのリンク元 |
| `from` | string (email) | 差出人 (inbound 時) |
| `snippet` | string (≤200 字目安) | タイムラインでの本文プレビュー。**本文全文は payload に入れない** (payload 肥大防止 — 全文は emails 側が正) |
| `has_attachments` / `attachment_count` | boolean / int | 添付バッジ表示 |

- `direction: 'inbound'` の必須フィールド組合せ (from + email_id 必須、to/document_id 系は不許可 or optional) を Zod refinement で定める — 詳細は本書の設計確定版改訂と 07-contracts-delta で確定
- BCC 控えは `direction: 'outbound'` + `email_id` あり (帳票メールは `document_id` あり・`email_id` なし) — **同じ 'outbound' でも出所が payload で判別できる**こと

### 3.3 表示要件

- `activity-timeline.tsx` の `case "email"` は direction 分岐実装済み (「送信」/「受信」)。追加要件: `email_id` があれば `/admin/emails/[id]` への逆リンク、snippet 表示、添付バッジ。call 行が `/admin/calls/[id]` へ逆リンクする現行 UX と対称にする
- 受信メール詳細画面自体は `ActivityTimeline` を再利用しない (通話詳細と同じ割り切りを踏襲)

### 3.4 リンク規約 (customer_id / deal_id)

- 01-crm.md §6.6 の設計原則「対象が判明している限り customer と deal の**両方**にリンク」に従う。ただし v2 の自動照合は **customer までしか解決しない** (§4.5 — deal 自動推定はしない)。手動割当 UI で deal を選んだ場合のみ deal にもリンクする
- `merged_into` 終端解決は appendActivity 内の既存ロジックをそのまま享受 (新規実装なし)
- リンク変更は telephony 同様 **`relinkActivity` 経由のみ** (mail 専用経路として許可、note 以外リンク不変の原則の例外を call と同列に拡げる — RLS/facade ガードの具体化は設計時)

### 3.5 スレッド化

- v2 は**専用 threads テーブルを作らない**。`Message-ID` / `In-Reply-To` / `References` を emails に保存し、詳細画面で「同スレッドの他メール」を `in_reply_to` / `references` 突合で**ベストエフォート表示**するのみ
- タイムライン上は 1 メール = 1 activity 行 (スレッド折り畳みはしない)。往復が増えて煩雑になったら Phase 3 でスレッド集約を検討 (§9 OQ-9)

---

## 4. 不明メールルーティング要件

### 4.1 状態機械 — `emails.match_status`

telephony `calls.match_status` (04-telephony §5.2.2) を参照モデルに、**`created` を除き `ignored` を加えた** 6 値:

```
pending ──(照合 single)──────▶ matched   … customer_id 確定、activity 作成
   │──(照合 multiple)────────▶ ambiguous … 自動確定しない。候補提示、activity なし
   │──(照合 none / 認証fail)─▶ unmatched … 自動顧客作成しない。activity なし
   │
matched / ambiguous / unmatched ──(手動 紐づけ/付け替え/解除)──▶ manual
pending / ambiguous / unmatched / manual ──(手動 無視)─────────▶ ignored
ignored ──(手動 取り消し)──▶ manual (customer_id null)
```

**不変条件** (telephony と同型):

| match_status | customer_id | activity | 備考 |
|---|---|---|---|
| pending | null | なし | webhook 受領直後の一瞬のみ |
| matched | **非 null** | あり | 自動照合 1 件一致 |
| ambiguous | null | なし | E601 → **E844** 変換 (§6)。候補 ID 列は emails 側に保持 |
| unmatched | null | なし | 0 件一致 or 送信元認証 fail (§2.5)。**telephony の `created` は踏襲しない** |
| manual | null / 非 null 両方あり得る | 紐づけ時あり | **自動処理に対する終端** — 以後 webhook/再照合が上書きしない (手動確定保護ガード、telephony と同一の不変条件) |
| ignored | null | なし | スパム/メルマガ。一覧の既定フィルタから除外 |

### 4.2 `created` 不採用の根拠 (issue #100 記載済み・本書で確定)

電話は誤発信が稀で「番号だけの lead」に価値があるが、メールはスパム・メルマガ・営業が常時混入するため、0 件一致での自動顧客作成は**顧客台帳をゴミで汚す**。`unmatched` に落とし、「新しい顧客として登録」ボタン (§4.6) で人間が 1 タップ昇格させる。家族共用メール (customers.email 非 unique の設計理由) により ambiguous も電話より多発する想定 — 自動確定しない原則を電話以上に厳守する。

### 4.3 照合規則 (`matchCustomerByEmail`)

- **`CrmFacade.matchCustomerByEmail` を新設**し、`matchCustomerByPhone` (crm/facade.ts L569-585) と対称構造にする: `none → {ok:true, value:null}` / `single → {customer_id}` / `multiple → KMB-E601`
- 突合の実体は既存 `dedup.ts` の 3 値分類 (`classifyDedupCandidates`) と `findDuplicateCandidates` の email 突合 (**`ilike` 完全一致・大小無視・エスケープ済み・`merged_into` 終端解決込み**) を再利用。部分一致・あいまい一致はしない
- インデックスは既存 `customers_email_idx on customers (lower(email)) where email is not null` を**そのまま利用、新規追加不要**
- 照合対象アドレス: inbound は From、BCC 控え (direction='outbound') は **To の先頭アドレス** (Cc へのフォールバックは v2 ではしない — 設計単純化)
- 呼び出し文脈: webhook (service) からの自動照合と、手動 UI の「候補を再検索」の両方から呼ぶ

### 4.4 telephony との一貫性 (差分表)

| 観点 | telephony (calls) | mail (emails) — 本要件 |
|---|---|---|
| 0 件一致 | `created` (lead 自動作成) | `unmatched` (自動作成しない) — 根拠 §4.2 |
| 複数一致 | `ambiguous` (E601→E823) | `ambiguous` (E601→**E844**) — 同型 |
| 識別子なし | `no_number` (非通知) | 該当ほぼなし。From 欠落/認証 fail は `unmatched` に吸収 |
| 手動終端 | `manual` (worker 上書き禁止) | `manual` — 同一不変条件 |
| 無視 | (該当なし) | `ignored` — メール固有 (スパム対策) |
| タスク自動起票 | ambiguous/no_number でも必ず起票 (折り返し漏れ対策) | **v2 では起票しない** (§4.6 — スパムでタスク汚染するため未処理バッジで代替)。裁定余地あり (§9 OQ-8) |

### 4.5 deal への自動紐付け

しない。自動照合は customer 解決まで。「open な deal が 1 件ならそこに載せる」等の推定は誤爆時の被害 (別案件の履歴汚染) が大きく、手動割当 UI で deal を選べれば足りる (§9 OQ-7 で将来判断)。

### 4.6 画面要件 (`/admin/emails`)

- **一覧**: 受信箱型。既定フィルタは「未処理 (ambiguous + unmatched)」、タブで all / matched / manual / ignored 切替。行 = 差出人・件名・snippet・受信日時・match_status バッジ・添付アイコン。ナビに未処理件数バッジ (J11 非 IT 用語 — 名称は「メール」)
- **詳細** (`/admin/emails/[id]`): 本文 (サニタイズ済み HTML / text 切替)・添付一覧 (DL)・認証結果警告 (§2.5)・スレッド関連メール (§3.5) + **手動割当セクション**
- **手動割当 UI は `CustomerLinkSection.tsx` + `linkCallToCustomerAction` + `relinkActivity` の 3 点セットをほぼそのまま移植** (issue #100 論点 5 既出):
  - 未紐づけ → `Command` パレット顧客検索 + 「新しい顧客として登録」(lead 作成 → 紐づけ) + 「無視」
  - ambiguous → 候補顧客をボタン提示 (emails 側に保持した候補 ID 列から) + 検索フォールバック
  - 紐づけ済み → 付け替え / 解除。付け替え時は `relinkActivity` で activity_links も張り替え
  - 楽観排他 `expectedUpdatedAt` (KMB-E103) — telephony と同型
- 顧客紐づけ成立時 (matched 化 or manual 紐づけ) に activity を作成。**deal も選択した場合は customer + deal 両方にリンク** (§3.4)

---

## 5. データモデル案 (骨子 — DDL 詳細は本書の設計確定版改訂で確定)

### 5.1 `emails` (新規、mail モジュール所有)

```
emails
  id                   uuid PK
  direction            text check ('inbound','outbound')      -- outbound = BCC 控え
  provider             text                                    -- 'resend' 等 (方式選定後に固定)
  provider_message_id  text UNIQUE                             -- webhook 冪等キー (§2.3)
  message_id           text                                    -- RFC 5322 Message-ID
  in_reply_to          text / references_ids text[]            -- スレッドヘッダ (§3.5)
  from_email           text NOT NULL  / from_name text         -- lowercase 正規化済み突合キー
  to_emails            text[] / cc_emails text[]
  subject              text
  body_text            text / body_html text                   -- html はサニタイズ前原文 (表示時に無害化)
  snippet              text                                    -- 取り込み時生成 ≤200 字
  raw                  jsonb                                   -- webhook payload 全量 (再処理・監査用)
  spf_result / dkim_result / dmarc_result  text                -- 認証結果 (§2.5)
  match_status         text check ('pending','matched','ambiguous','unmatched','manual','ignored')
  match_candidates     uuid[]                                  -- ambiguous 時の候補顧客 (提示用)
  customer_id          uuid FK customers null
  deal_id              uuid FK deals null                      -- 手動割当のみ (§4.5)
  ingest_status / error_detail                                 -- 添付処理等の失敗記録 (§2.3)
  occurred_at          timestamptz NOT NULL                    -- プロバイダ受信時刻
  created_at / updated_at
```

インデックス: `UNIQUE(provider_message_id)` / `(occurred_at desc, id desc)` (一覧順) / `(match_status) WHERE match_status IN ('ambiguous','unmatched')` (未処理バッジ用 partial) / `(customer_id) WHERE customer_id IS NOT NULL`。

### 5.2 `email_attachments` (新規)

```
email_attachments
  id uuid PK / email_id uuid FK emails NOT NULL
  filename text / content_type text / size_bytes bigint
  storage_path text NOT NULL      -- email-attachments バケット内 emails/<email_id>/<id>_<filename>
  is_inline boolean / content_id text   -- cid: inline 画像対応
  created_at
```

### 5.3 Storage

- 新規 private バケット **`email-attachments`**。署名 URL は admin 経路のみ払い出し。`Content-Disposition: attachment` 固定 (§2.5)

### 5.4 RLS・不変性

- `emails` / `email_attachments`: **admin SELECT のみ + emails は admin UPDATE をルーティング列に限って許可** (match_status / customer_id / deal_id / updated_at — 列限定は RLS では表現できないため trigger または facade ガードで担保、方式は設計判断)。INSERT は service (webhook) のみ。**DELETE ポリシーなし (append-only)** — `document_emails` と同思想 + 電帳法の真実性要件 (訂正削除防止) の候補担保
- **本文・添付・raw は不変** (受信記録の改竄防止)。可変なのはルーティング関連列のみ
- 保持期間・削除ポリシーは §9 OQ-10 (電帳法 7 年 vs スパム掃除の緊張関係)

### 5.5 既存テーブルへの変更

- **なし**。`activities` の check 制約は `'email'` 登録済み、`customers` も変更不要 (email 単一カラム維持 — §9 OQ-6)。migration は emails / email_attachments / バケット / RLS の新規のみ。**migration 番号帯は 00-overview §10 の帯管理に従い設計時に払い出す** (現時点の最新は 0036 以降)

---

## 6. エラーコード帯

既存帯: crm = KMB-E601〜E619 / sales = E62x〜E64x (E644/E645 使用中) / telephony = E801〜E839。**E840 以降は未予約** (00-overview 確認済み) のため、**mail モジュールに KMB-E840〜E859 を新帯として割当てる**ことを提案する (00-overview §3.3 への追記が必要)。

| コード | 意味 | 参照モデル |
|---|---|---|
| KMB-E840 | inbound webhook 署名検証失敗 | telephony の署名検証 |
| KMB-E841 | webhook payload parse 失敗 (構造不正) | E404 系→E821 変換の同型 |
| KMB-E842 | email が見つからない (詳細/割当操作) | E802 相当 |
| KMB-E843 | match_status 遷移違反 (不変条件違反の操作) | E823 隣接 |
| KMB-E844 | 照合 ambiguous — **E601 からのドメイン変換** | telephony E823 (E601→E823) と同型。issue #100 案どおり |
| KMB-E845 | 添付の保存/取得失敗 | — |
| KMB-E846 | inbound 未設定 (`isInboundConfigured()` false) | sales E644 (`isResendConfigured()`) と同型 |
| KMB-E847〜E859 | 予約 (未使用分は返上) | 帯運用は telephony 0032〜0034 の先例 |

- 楽観排他は platform 共通 **KMB-E103** を再利用 (telephony `linkCallToCustomer` と同じ)
- crm 所有の E601 (dedup multiple) / E604 (appendActivity email 方向) は所有変更しない。E604 は「inbound 一律拒否」から「payload 契約違反時のみ」に**意味を縮小改訂** (01-crm.md L1322 / L1525 の記述改訂が M1 に含まれる)

---

## 7. モジュール境界・連携

### 7.1 所有 — 新規 `mail` モジュール

**`src/modules/mail` を新設**し、telephony と対称の構造にする。crm への同居は不採用 (crm は外部 webhook 基盤を持たない設計であり、telephony が「外部チャネル → crm ハブへ書き込む衛星モジュール」の先例)。sales への同居も不採用 (`document_emails` は帳票送信台帳であり汎用メール記録と目的が異なる)。

```
所有: テーブル emails / email_attachments + Storage バケット email-attachments
      エラーコード KMB-E840〜E859 / 公開 facade MailFacade
      route /api/mail/inbound / 画面 /admin/emails/**

src/modules/mail/
  contracts.ts    … Zod 契約 (zEmail / zEmailAttachment / match_status enum / facade 入出力)
  facade.ts       … MailFacade (ingestInboundEmail / listEmails / getEmail /
                     linkEmailToCustomer / unlinkEmail / ignoreEmail / …)
  repository.ts   … emails / email_attachments への唯一の DB 経路 (ESLint 強制、00-overview §2.2)
  internal/
    signature.ts  … webhook 署名検証 (telephony/shared.ts の HMAC パターン踏襲)
    parse.ts      … payload → 構造化 (From 分解 / snippet 生成 / スレッドヘッダ)
    sanitize.ts   … HTML 無害化
    matching.ts   … 照合オーケストレーション (crmFacade.matchCustomerByEmail 呼び出し + 状態遷移)
```

### 7.2 依存方向と連携点

```
Resend (inbound webhook)
   │ POST + 署名
   ▼
/api/mail/inbound ── MailFacade.ingestInboundEmail ({mode:'service'})
   ▼
mail モジュール ── 依存: platform (Result / ExecutionContext / env)
                        crm (matchCustomerByEmail★新設 / appendActivity / relinkActivity)
                        storage (添付)
```

- **crm への書き込みは CrmFacade のみ** (activities 直接 INSERT 禁止 — 00-overview §3.2.3 を踏襲)。mail は `customers` / `activities` を一切直接触らない
- **全公開メソッドは `Result<T>`** を返し、facade 境界で E840 帯へドメイン変換 (E601→E844 等)
- sales とは依存なし (双方向とも)。将来「受信メールから帳票を開く」等が要る場合も payload 参照のみで facade 依存を作らない
- 通知 (新着未処理メール) を出す場合は crm 日次ダイジェスト (`crm/internal/notify.ts`) への追記が候補 — §9 OQ-11

### 7.3 契約改訂の集約

M1 の契約差分 (zEmailActivityPayload 拡張 / matchCustomerByEmail 追加 / E604 意味縮小 / E840 帯予約) は **07-contracts-delta.md への差分集約 → module-contracts.md 一回適用**の既存運用 (裁定 J10) に従う。

---

## 8. 段階的デリバリ (Phase 2 内の分割)

issue #100 の M1/M2/M3 構成を踏襲し、前提整備 M0' を先頭に置く。各段は独立に merge 可能で、**前段が本番で動かなくても後段の実装を止めない** (署名モック完走 — telephony の R1 と同じ方針)。

| 段 | 内容 | 完了条件 | 規模 |
|---|---|---|---|
| **M0'** 前提整備 | 独自ドメイン取得 (#13)・MX/DNS 設計・Resend Inbound 技術検証 (料金/添付上限/再送/サブドメイン受信可否)・`RESEND_API_KEY` 本番払い出し・堀さん確認 3 点の回答記録・スコープ裁定 (J7 改訂 = 仮 J13) | ブロッカー OQ-1〜5 が裁定済みで本書を設計確定版に改訂できる | 調査 + 手続き |
| **M1** 契約改訂 | zEmailActivityPayload 拡張 (§3.2)・inbound 拒否分岐削除 (E604 縮小)・`matchCustomerByEmail` 新設・E840 帯予約・07-delta/01-crm 改訂 | 契約テスト green。**この時点では inbound 挿入経路がまだ無いため挙動変化なし** (安全に先行 merge 可) | S |
| **M2** DDL + 取り込み基盤 | migration (emails / email_attachments / バケット / RLS / index)・`/api/mail/inbound` (署名検証)・parse・照合・activity 生成・冪等性 | webhook モックでの結合テスト green (docker 無し運用: 本番適用後 execute_sql 検証 — 既存ハーネス方針に従う)。タイムラインに受信メールが載る | M〜L |
| **M3** 画面 | `/admin/emails` 一覧/詳細・手動割当 UI (CustomerLinkSection 移植)・ignored/再割当・タイムラインレンダラの email_id リンク・未処理バッジ | §4.6 の操作が一通り可能 | M |

- 実装 issue は M1/M2/M3 を**別 issue として起票** (issue #100 受入基準)。各 issue は別スレッド/別 LLM でも実装可能な詳細度にする (運用方針メモ準拠)
- **フォールバック**: M0' で独自ドメインまたは inbound 方式が成立しない場合、案 A (手動転記フォーム: /admin/emails 相当の手入力 + appendActivity) に縮退する。M1 は案 A でもそのまま必要なため無駄にならない

---

## 9. 未解決論点 (Open Questions — 実装前にユーザー判断が要る)

全 12 件。うち **OQ-1〜OQ-5 の 5 件はブロッカー** — M0' (前提整備) の完了条件であり、堀さんの回答・裁定なしに M2 以降へ着手できない。OQ-6〜OQ-12 は推奨案で仮置き可能 (後続裁定で確定)。

| # | 論点 | 選択肢 / 判断材料 | ブロックする段 |
|---|---|---|---|
| **OQ-1** 【ブロッカー】 | **業務メールボックスの実態** (堀さん確認 ①): 現在顧客とどのアドレスでやりとりしているか。独自ドメイン/DNS 管理の有無 | Gmail 個人 → B3 (転送) が有力 / 独自ドメイン新設可 → B1 (Resend Inbound) が有力 | M0' 全体 |
| **OQ-2** 【ブロッカー】 | **BCC 運用の受容度** (堀さん確認 ②): 送信のたびに控えアドレスを BCC に入れる運用を受け入れられるか | 不可なら outbound 控え (§0.4) をスコープから落とす (inbound のみでも価値は成立) | M2 の direction='outbound' 分岐 |
| **OQ-3** 【ブロッカー】 | **電帳法対応の期待水準** (堀さん確認 ③): 添付に取引情報を含むメールについて、検索要件 (取引年月日・金額・取引先) まで満たすか、append-only 保存のみか | 検索要件まで → 取引メタデータ列の追加が必要 / 保存のみ → §5.4 の append-only で足りる | M2 DDL |
| **OQ-4** 【ブロッカー】 | **inbound 方式の選定** (issue 論点 3): Resend Inbound の成熟度・料金・添付上限・再送ポリシーの裏取り結果次第 | §2.1 の B1〜B4 比較。選定観点 5 項 | M0'→M2 |
| **OQ-5** 【ブロッカー】 | **独自ドメイン取得 (#13 依存)**: MX 設定可能なドメインが絶対前提。取得時期・DNS 管理者 | 未取得なら案 A 縮退 (§8) | M0' |
| OQ-6 | 複数メールアドレス対応: `customers.email` 単一カラムのまま v2 を出すか、`customer_emails` 台帳を先に作るか | 単一のままだと「同一人物の別アドレス」が毎回 unmatched になる。頻度が読めないため **v2 は単一 + 手動紐づけで開始し、unmatched の実績を見て判断**を推奨 | (M2 だが先送り可) |
| OQ-7 | deal への自動紐付け (§4.5): open deal 1 件時の自動リンクを許すか | 推奨は「しない」(誤爆被害 > 手間削減)。手動割当で deal 選択可能なら足りる | M3 |
| OQ-8 | 未処理メールのタスク自動起票 (§4.4): telephony は「折り返し漏れの方が重罪」で必ず起票するが、メールはスパム混入がある | 推奨は「v2 では起票せず未処理バッジで代替」。返信漏れが業務上重罪なら matched のみ起票の折衷案 | M2 |
| OQ-9 | スレッド表示の水準 (§3.5): ベストエフォート関連表示で足りるか | 往復頻度が読めないため v2 はヘッダ保存のみ + 表示ベストエフォートを推奨 | M3 |
| OQ-10 | 保持期間・削除ポリシー: append-only (電帳法 7 年) と ignored スパムの掃除の両立 | 推奨: v2 は削除なし (ignored は非表示のみ)。容量問題が出たら ignored のみ物理削除を後日裁定 | M2 RLS |
| OQ-11 | 新着未処理メールの通知: 都度通知 / 日次ダイジェスト統合 / なし (バッジのみ) | 推奨: v2 はバッジのみ、必要なら crm 日次ダイジェストに「未処理メール n 件」を 1 行追記 | M3 |
| OQ-12 | 自動 ignored (スパム自動判定): プロバイダのスパム判定/ドメインブロックリストを使うか | 推奨: v2 は手動 ignored のみ。誤判定で顧客メールを隠す事故の方が重い | M2 |

---

## 10. issue #100 受入基準との対応

| 受入基準 (issue #100) | 本書での充足 |
|---|---|
| 堀さんへの確認 3 点の回答記録 | §9 OQ-1〜3 として質問・選択肢・判断材料を確定 (回答は M0' で記録) |
| スコープ裁定 | 案 B ベースで §1 に確定案を明記。J7 改訂 (仮 J13) の裁定文起草は回答後 (§8 M0') |
| 設計書起草 | 本書 (08-email.md) がその実体。§2〜§7 が設計章構成に 1:1 で対応し、ブロッカー OQ-1〜5 裁定後に DDL 詳細・画面ワイヤ・状態遷移の網羅表を肉付けして設計確定版に改訂する |
| M1/M2/M3 実装 issue 起票 | §8 に各段の内容・完了条件・依存を確定。起票は裁定後 (起票自体は承認不要 — 運用方針メモ準拠) |

## 更新履歴

- v1 (2026-07-16): 確定版ドラフト。`docs/design/crm-suite/08-email.md` としてシリーズに収載。ブロッカー 5 件 (OQ-1〜5) を明示し、シリーズ内相対リンク・自己参照を整備。技術内容は v0.1 から変更なし
- v0.1 (2026-07-16): 初版。現状調査 3 本 (送信インフラ / タイムライン統合モデル / 不明コンタクト照合) を統合し、issue #100 の論点整理を要件として確定
