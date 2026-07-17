# 引き継ぎ資料 — 隈部塗装 CMS

- 作成: 2026-07-09 (堀さんの指示で次の担当へ引き継ぎ)
- 最終同期: 2026-07-17 (#63 — CRM スイート Phase 0〜5 完了 + 管理画面リデザイン R0〜R6c 完了を反映)
- 状態: 本番稼働中。CMS + AI パイプライン + CRM スイート (顧客/見積・請求/カレンダー/電話) + ビジュアルエディタが全て本番反映済み。管理画面は業務フェーズ別 IA へリデザイン済み (R0〜R6c)
- 主エディタセッション: Opus 4.8(直接執筆) / 実装エージェント: Sonnet 5(user-level 規約)

## ⚠️ 最優先で読むもの
1. **本ファイル**(この HANDOFF.md)全部
2. `docs/design/cms-ai-pipeline.md`(全体設計 v3.5 — 既存 CMS の DDL 正 + crm-suite 参照台帳)
3. `docs/module-contracts.md`(モジュール契約 v2.8 — crm/sales/scheduling/telephony 含む)
4. `docs/design/crm-suite/00-overview.md`(CRM スイート全体設計。§10 が所有テーブルの正)
5. **GitHub Issues**(既知課題・未着手・仕様確認事項をラベル付きで整理)

## 1. いま本番で動いているもの

| URL | 状態 |
|---|---|
| https://kumabe-tosou.vercel.app | 公開サイト(DB 駆動、seed 済み) |
| https://kumabe-tosou.vercel.app/admin/login | 管理画面ログイン |

**本番稼働中のモジュール(CRM スイート Phase 0〜5 完了後の実態)**

CMS 単体構成から「顧客管理 (crm) / 見積・請求 (sales) / カレンダー・製造ブロック (scheduling) / 電話連携 (telephony)」を持つ業務システムへ拡張済み。全 4 モジュールが本番 DB に migration 適用済みで稼働している:

| モジュール | 管理画面 | 内容 |
|---|---|---|
| crm | /admin/customers, /admin/deals, /admin/tasks | 顧客/会社/案件/活動タイムライン/やること。問い合わせ・通話からのリード化。crm-digest (pg_cron) |
| sales | /admin/documents | 見積書/請求書 CRUD + 税計算 + 採番 + 発行 (append-only) + PDF + 入金記録 + 帳票メール送付 |
| scheduling | /admin/calendar | 製造ブロック/作業テンプレート/週次容量/カレンダー同期 (Google/Microsoft の薄い fetch ラッパ) |
| telephony | /admin/calls | 通話ログ/録音再生/文字起こしジョブ (ai-providers 経由) + 顧客マッチ |

外部 API キー未投入でも大半の画面は描画・保存可能 (telephony の Twilio / ai-providers の Anthropic/OpenAI は実キー投入後に有効化)。

**管理者アカウント(仮パスワード — 変更推奨)**
- email: `nvidia.homeftp.net@gmail.com`
- password: `12345678`
- Supabase Dashboard の Auth からのパスワード変更 or ここでの直接更新に加え、`.env.local` の `BOOTSTRAP_ADMIN_PASSWORD` も同期すること

**本番インフラ**
- Vercel: プロジェクト `kumabe-tosou`(daisukehori 個人スコープ)/ GitHub 連携済み(main push で自動デプロイ)/ Node 20 LTS
- Supabase: project_id `ixvfhxbfpdquwktsnmqy`(東京、$10/月 — 組織の無料枠使用済みのため)/ 既存 CMS 22 テーブル + crm-suite 新規 24 テーブル / RLS 全面適用 / Vault + pg_cron 稼働中
- Resend: 未設定(問い合わせ通知は未送信・graceful degradation)
- 独自ドメイン: 未取得

## 2. 環境変数(全量)

`.env.local` は git 管理外。ローカル運用に必要な値は下記(Vercel 本番にも同じ環境変数が入っている):

| 変数 | 用途 | 現況 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | canonical URL | ✅ 設定済 |
| `NEXT_PUBLIC_SUPABASE_URL` | 公開 API URL | ✅ 設定済 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key(公開可) | ✅ 設定済 |
| `SUPABASE_SERVICE_ROLE_KEY` | service role(絶対に公開不可) | ❌ **空**(Dashboard から取得して入れる必要あり) |
| `JOBS_SECRET` | pg_cron 起床 webhook 共有鍵 | ✅ 32 バイト自動生成済(Vercel + Supabase Vault `cron_jobs_secret` に同じ値) |
| `REVALIDATE_SECRET` | /api/revalidate 用 | ✅ 32 バイト自動生成済 |
| `OAUTH_STATE_SECRET` | X/Meta OAuth 用 | ✅ 32 バイト自動生成済 |
| `OAUTH_ENABLED` | `true` で OAuth 有効化 | `false`(Preview では常に false) |
| `RESEND_API_KEY` | 通知メール送信 | ❌ 未取得 |
| `ANTHROPIC_API_KEY` | AI スタジオ生成 | ❌ 未取得(AI スタジオはバナー表示・実行不可) |
| `OPENAI_API_KEY` | 音声文字起こし | ❌ 未取得(同上) |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X 投稿 | ❌ 未取得 |
| `META_APP_ID` / `META_APP_SECRET` | Instagram 投稿 | ❌ 未取得 |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | seed / admin セッション用スクリプト | ✅ 設定済 |

**service_role キーが空でも大半は動く**(admin セッション経由で回避)。seed の再実行は BOOTSTRAP_ADMIN で可(scripts/seed-from-legacy.ts が admin ログイン経由に切り替え済み)。

## 3. Supabase migration の適用状況

Vercel の GitHub 連携は **コードのみ**を扱う。**migration は自動適用されない** — 新しい migration ファイルを追加したら、**MCP または Supabase Dashboard の SQL Editor から手動で適用**する必要がある。

現時点で本番 DB に適用済み(`supabase/migrations/` の一覧 = 実ファイル **39 本**。番号は帯ごとに割当。crm 帯の 0025 は返上・未使用):

**既存 CMS 帯 (0001〜0020)**

```
0001 init_schema                       … 初期スキーマ + trigger
0002 rls                                … is_admin() + 全テーブル RLS
0003 storage                            … バケット + policy
0004 vault_rpc                          … vault_upsert_secret
0005 work_images_select                 … junction の SELECT policy
0006 security_advisor_fixes             … アドバイザ対応 (search_path 固定 / bucket 一覧列挙防止)
0007 pricing_v2                         … 価格行列モデル (size_classes/matrix/quantity_tiers)
0008 media_reference_summary            … 削除ガード用 view
0009 ai_run_commit_stage                … advance/lease RPC + research_enabled 列
0010 distribution_worker_support        … vault_read_secret + refresh lease + index
0011 pg_cron_jobs                       … publish(毎分) / watchdog(5分毎)
0012 admin_write_junction_tables        … work_images / seed_manifest への admin 書込許可
0013 page_media                         … 画像スロット (page_media) + view
0014 page_text                          … テキストスロット (page_text)
0015 ai_providers                       … ai-providers モジュール (鍵管理・run stage)
0016 note_draft                         … note 下書き列
0017 ai_draft_cleanup                   … AI 下書きメディアの掃除
0018 ai_context_storage                 … AI コンテキスト保存
0019 ai_runs_image_stage                … image_generation stage
0020 ai_budget_revoke_anon              … AI 予算 + anon 取消
```

**CRM スイート帯 (0021〜0035) — Phase 0〜5 で増築(#62 で本番全適用確認済み)**

| 帯 | 番号 | 内容 | 所有 |
|---|---|---|---|
| M0 | 0021 | RPC 緩和 (is_admin_or_service) + site_settings anon 許可リスト化 | 共通基盤 |
| M0 | 0022 | 採番 RPC + document_sequences (テーブル所有は sales) | 共通基盤 |
| crm | 0023 | crm コア DDL (companies/customers/deals/activities/activity_links/tasks) + RLS + crm_merge_customers | crm |
| crm | 0024 | crm-digest の pg_cron 登録 | crm |
| crm | **0025** | **返上 (未使用)** — 帯は固定のため他モジュールは詰めない | — |
| sales | 0026 | documents/document_lines/payments + RLS + trigger + RPC document_save_draft | sales |
| sales | 0027 | issued_documents (append-only) + bucket issued-documents + print_tokens/pdf_render_lock/document_revision_stagings + RPC 3 本 | sales |
| sales | 0028 | private bucket branding-assets (角印画像) | sales |
| scheduling | 0029 | work_types/work_templates/work_template_items/work_blocks + RLS | scheduling |
| scheduling | 0030 | calendar_connections/calendar_event_links (カレンダー同期) | scheduling |
| scheduling | 0031 | scheduling ジョブ (pg_cron) | scheduling |
| telephony | 0032 | calls/call_recordings/call_jobs + RLS + index + Storage (call-audio) | telephony |
| telephony | 0033 | lease/commit/retry RPC | telephony |
| telephony | 0034 | pg_cron ジョブ登録 | telephony |
| site-settings | 0035 | favicon の media 参照 3 点セット | site-settings |

**後日追記帯 (crm-suite 完了後の増分)**

| 日付 | ファイル | 内容 | 種別 |
|---|---|---|---|
| 2026-07-14 | `..036_ai_run_style_profiles` | ai_runs.style_profiles 列 + lease RPC 改 (#20) | 既存表 ALTER + RPC |
| 2026-07-14 | `..036_crm_deal_reopen` | deals 終端ステージのソフトロック化 + crm_reopen_deal RPC (#102) | RPC |
| 2026-07-14 | `..036_sales_document_emails` | **document_emails** テーブル新設 (帳票メール送付台帳・append-only。#101) | 新規テーブル |
| 2026-07-15 | `..0001_customers_custom_fields` | customers.custom_fields 列 + crm_merge_customers 改 (#98) | 既存表 ALTER + RPC |
| 2026-07-15 | `..0002_customers_billing_shipping` | customers.billing_info/shipping_info 列 + crm_merge_customers 改 | 既存表 ALTER + RPC |

**注意**:
- migration は **Vercel とは別に手動適用** (MCP or Dashboard SQL Editor)。上記 39 本は `ls supabase/migrations/ | wc -l` の実ファイル数と一致。**「0012 が最新」は旧記述 (是正済み)**。
- 2026-07-14 の 3 本は同一 seq (`..036`) で並列 Wave がそれぞれ採番したもの。以降は 2026-07-15 起点で日次カウンタが `..0001` からリスタートしている (番号順 ≠ 適用順の箇所がある点に注意)。
- crm-suite 新規テーブルの物理総数は **24** (00-overview.md §10 が正。document_emails を含む)。

## 4. 直近の設計・実装ステータス

### 4.1 完了(本番反映済み)
- Next.js 15 モックアップ移植 → 完全 DB 駆動化
- 管理画面 一式:
  - 認証(Supabase Auth cookie セッション)
  - サイドバーナビ(usePathname でアクティブ追従)
  - ダッシュボード
  - サイト設定(5 タブ、楽観排他は生文字列比較で修正済み)
  - 施工事例 / 記事 / お客様の声 CRUD(状態遷移込み)
  - 価格表(行列エディタ + 見積りゴールデンテスト 24 件)
  - メディアライブラリ(sharp レンディション生成 + スケルトン)
  - 問い合わせ(一覧 + status 変更 + Resend 通知配線 — キー未設定でも保存は成功)
  - AI スタジオ(バナー表示のみ、キー未設定)
  - チャネル管理(バナー表示のみ、OAuth 未接続)
- 公開サイト:
  - UI 忠実復元(reveal / マーキー / カウントアップ / STATEMENT / TWO SCENES / BY THE NUMBERS / GALLERY / NOTES PICK / Shippori Antique B1 フォント)
  - works / notes / voices / blog を DB 駆動化、詳細ページ新設
  - contact フォームを実送信化(rate limit + honeypot + 3 秒ガード + Resend 通知)
  - sitemap.xml / robots.txt を動的生成
- 配信基盤:
  - X / Meta OAuth 接続画面と worker(at-least-once + 人間照合 = E506 manual_required)
  - pg_cron が本番で毎分起床中(shared secret 401 で正常拒否確認済み)
  - 課金ガード(estimated_cost_cents 合算)
- **ビジュアルエディタ**(全公開ページの画像/テキストを `/edit/[[...path]]` 上でクリック差し替え。page-media モジュール + `/admin/visual`)。旧「進行中」から本番反映済みへ
- **CRM スイート (Phase 0〜5) — #41〜#63 完了**:
  - crm: 顧客/会社/案件/活動タイムライン/タスク。問い合わせ・通話からのリード化。crm-digest (pg_cron)
  - sales: 見積・請求書 CRUD + 税計算 + 採番 + 発行 (append-only) + PDF + 入金 + 帳票メール送付 (document_emails)
  - scheduling: 製造ブロック/作業テンプレ/週次容量/カレンダー同期 (Google/Microsoft 薄い fetch ラッパ)
  - telephony: 通話ログ/録音/文字起こしジョブ (ai-providers 経由) + 顧客マッチ
  - ai-providers モジュール新設 (AI SDK 直 import 禁止・本 facade のみ)
- **管理画面リデザイン R0〜R6c 完了 (#117〜#129)**:
  - `.admin-theme` の CSS トークン基盤を新設し全画面を再スタイル
  - 左ナビを「業務フェーズ別」6 グループ 14 項目へ再編 (`src/app/admin/nav-items.ts`)。**全ルートの href は不変**
  - content 系 5 ルート (works/posts/voices/media/visual) を URL 維持型タブハブ (SiteSecondaryTabs) へ統合
  - nav-badges モジュール新設 (ナビ/ダッシュボードの読み取り専用横断集計。KMB-E001/E002 帯。失敗時はバッジ非表示に縮退)
- テスト **2941 件 / 164 ファイル 全 PASS**(2026-07-17 現在)。`npm run lint`(リポジトリ全体)green / `npx tsc --noEmit` 0 エラー

### 4.2 残タスク(未着手・承認済みの方針)
- 独自ドメイン取得 → Vercel + Resend の SPF/DKIM
- Anthropic/OpenAI/X Developer/Meta App の実キー投入
- 写真素材の実写差し替え(現在は Unsplash 仮素材、is_placeholder=true が 8 枚)

## 5. GitHub Issue / PR の全体像

引き継ぎのために **既知の課題・未着手・仕様確認事項を Issue に切り出し、PR は現時点でなし**(すべてマージ済み or 未着手)。

Issue のラベル:
- `blocker`: 実装前に解決必要
- `spec`: 仕様確認・設計改善
- `feat`: 新機能
- `security`: セキュリティ関連
- `docs`: ドキュメント
- `ops`: 運用・環境変数など

各 Issue の詳細は GitHub の Issues タブを参照。**現在オープンな Issue = 引き継ぎで着手可能なタスクの全量**。

## 6. 開発ルール(user-level CLAUDE.md より要点)

これは私が守っていた規約。次の担当も踏襲を推奨:

1. **オーケストレーターは Task ツールでサブエージェントに委譲**(直接ファイル編集をなるべく避け、Opus は計画・検証・統合に専念)
2. **サブエージェントは Sonnet 5 を指定**(`model: "sonnet"`)。設計書は Opus 直接執筆
3. 並列 implementer は `isolation: "worktree"` 必須(cwd 共有事故を防ぐ)
4. モジュール開発は implementer + tester ペア、2 回連続 PASS で完了
5. commit メッセージは日本語(Co-Authored-By なし)、Conventional Commits prefix
6. main への push は基本可能。ただしリスクの高い操作(destructive git, `--force`)は事前確認
7. 設計書には Codex(`codex exec --sandbox read-only`)で外部レビューを回す
8. 実装完了時は Chrome MCP で本番/dev の E2E 確認

## 7. リポジトリ構造

```
kumabe-tosou/
├── docs/
│   ├── design/
│   │   ├── cms-ai-pipeline.md          … 全体設計 v3.5(既存 CMS の DDL 正 + crm-suite 参照台帳)
│   │   ├── crm-suite/                   … CRM スイート設計 00〜08(crm/sales/scheduling/telephony の DDL canonical)
│   │   ├── admin-redesign/             … 管理画面リデザイン設計モック(lint 対象外)
│   │   └── visual-media-editor.md      … ビジュアルエディタ設計 v1.3(実装済み)
│   ├── module-contracts.md             … モジュール契約 v2.8(Zod/facade/依存)
│   └── mock-check.md                   … Phase 0 手動チェックリスト
├── src/
│   ├── app/
│   │   ├── (site)/                     … 公開ページ(SiteHeader/Footer 適用)
│   │   │   ├── page.tsx                … トップ
│   │   │   ├── about|colors|contact|materials|notes|process|service|shop|story|tokushoho/
│   │   │   ├── works/[slug]/           … DB 詳細
│   │   │   ├── notes/[slug]/           … DB 詳細
│   │   │   └── blog/[slug]/            … DB 詳細
│   │   ├── admin/                      … 管理画面(独自 layout)
│   │   │   ├── _ui/                    … Surface/PageHeader/DataTable/StatusBadge/MediaPicker/timeline/entity-search
│   │   │   ├── login/ dashboard/ visual/ costs/
│   │   │   ├── works|posts|voices|prices|media|inquiries|studio|channels|settings/
│   │   │   ├── customers|deals|tasks/          … crm(顧客/案件/やること)
│   │   │   ├── documents/                        … sales(見積書・請求書)
│   │   │   ├── calendar/                         … scheduling(カレンダー・製造ブロック)
│   │   │   ├── calls/                            … telephony(通話)
│   │   │   ├── nav-items.ts                      … 左ナビ 6 グループ 14 項目(業務フェーズ別 IA。href 不変が正)
│   │   ├── api/                        … Route Handlers(revalidate, upload-url, ai/*, publish/*, jobs/*)
│   │   ├── _lib/                       … 公開 SSR 用の DB fetch helper
│   │   └── layout.tsx                  … html/body/フォント/globals のみ(SiteHeader は (site) に)
│   ├── middleware.ts                   … /admin/** 保護
│   ├── modules/                        … モジュラーモノリスの本体(facade 経由・境界は ESLint 強制)
│   │   ├── platform/ settings/ content/ pricing/ inquiry/ media/ ai-studio/ ai-providers/ distribution/ page-media/
│   │   ├── crm/ sales/ scheduling/ telephony/  … CRM スイート(Phase 0〜5 で増築)
│   │   └── nav-badges/                  … ナビ/ダッシュボードの読み取り専用横断集計(R6c/#129)
│   ├── components/
│   │   ├── site/                       … 公開 UI(reveal/hero/gallery/simulator 等)
│   │   └── contact/                    … contact フォーム
│   └── lib/
│       ├── env.ts                      … 空文字→undefined 正規化(重要バグ回避)
│       └── supabase/{server,service,public}.ts
├── supabase/migrations/                … 実 39 本適用済み(既存 0001〜0020 + crm-suite 0021〜0035 [0025 返上] + 後日 5 本。§3 台帳が正)
├── scripts/
│   ├── bootstrap-admin.ts              … 管理者作成(admin セッション対応)
│   ├── seed-from-legacy.ts             … コンテンツ + 画像投入(冪等)
│   ├── rollback-seed.ts                … manifest 逆順削除
│   └── seed-data/*.ts                  … 転記ソース
├── tests/                              … Vitest(2941 件 / 164 ファイル PASS)
└── HANDOFF.md                          … 本ファイル
```

## 8. ハマりポイント / 落とし穴集(過去に踏んだもの)

これは次の担当が同じ地雷を踏まないための実体験メモ:

1. **Date.toISOString() は ms 精度 / DB timestamptz は μs 精度**
   → 楽観排他で「常に競合」になる誤爆の原因。**必ず生文字列比較**。
2. **twitter-text は CJS**。ESM named import は build 通過するが runtime で TypeError。
   → namespace import + `next.config.ts` の `serverExternalPackages: ["twitter-text"]`
3. **zod v4 は zod-to-json-schema 非対応**。空スキーマを吐く。
   → zod v4 ネイティブの `z.toJSONSchema()` を使う
4. **@supabase/supabase-js は Node 20 で無条件 RealtimeClient 初期化**。native WebSocket が無くて即例外。
   → `ws` パッケージを `realtime.transport` に渡す(scripts/lib/service-client.ts に対応済み)
5. **Server Component で `cookies().set()` は不可**(Next.js 制約)。書き込みは Server Action / Route Handler。
   → 設計書 v1.3 で /edit ルート化により解消済
6. **`.env.local` の空文字プレースホルダは zod の optional() を通らない**。
   → `preprocess(emptyToUndefined, z.string().optional())` で対応済(src/lib/env.ts)
7. **React 19 の form は送信ごとに form.reset() を呼ぶ**。
   → 直前入力を保持したい場合は state に email/attempt を含める(login-form.tsx で対応済)
8. **usePathname はクライアントのみ**。サーバーの `headers()` からのパス判定だと soft navigation で更新されない。
   → サイドナビは Client Component で(admin-nav.tsx で対応済)
9. **loading="lazy" の img がキャッシュ済みだと onLoad 発火せずスケルトンが固着**。
   → `useEffect` で `img.complete` を初期化時にチェック(MediaThumbnail で対応済)
10. **並列 agent を isolation=worktree なしで起動すると cwd 共有事故**が起きる。
11. **Supabase migration は Vercel と別**。§3 の台帳(実 39 本)を DB に手動 apply する運用は継続。
12. **`"use server"` ファイルは async 関数と型しか export できない**(過去に 2 回本番ビルド全停止を起こした地雷)。`export const`/非 async の `export function`/非 async の `export default`/非 async 値の re-export を書くと Next.js のビルドが全停止する。`export type`/`export interface` は型消去されるため可。**追加時は必ず横展開チェック(§8.4)を回すこと。**

### 8.1 焼き付きリスク横展開点検一覧(07-contracts-delta 裁定 #17)

`/shop` で発覚した「ビルド時 Data Cache 焼き付き」(#38 `#0-1`)と同型の弱点が他ページにも潜む。**「`unstable_cache` に revalidate TTL 指定なし(`tags` のみ)+ 消費ページに `export const revalidate` なし」**の組み合わせを持つキャッシュ・ページの一覧(実コード再点検 2026-07-17):

| # | キャッシュ(ファイル・tag) | 消費ページ | 状態 |
|---|---|---|---|
| 1(対照・是正済み) | `pricing/facade.ts` `getCachedActivePriceTable`(tag `"prices"`) | `/shop` | P1(page revalidate=3600)+ P2(unstable_cache revalidate=3600)導入済み。**本一覧の基準点** |
| 2 | `_lib/public-content.ts` `cachedWorksList`/`cachedWorkBySlug`/`cachedWorkSlugs`(tag `"works"`) | `/works`, `/works/[slug]` | 同型・未是正 |
| 3 | `_lib/public-content.ts` `definePostQueries("blog")`(tag `"posts:blog"`) | `/blog`, `/blog/[slug]` | 同型・未是正 |
| 4 | `_lib/public-content.ts` `definePostQueries("reading")`(tag `"posts:reading"`) | `/notes`, `/notes/[slug]` | 同型・未是正 |
| 5 | `_lib/public-content.ts` `definePostQueries("news")`(tag `"posts:news"`) | 消費ページなし(未使用 kind) | デッドコード。将来利用時に顕在化するため記録のみ |
| 6 | `_lib/public-content.ts` `cachedVoicesList`(tag `"voices"`) | `/voices` | 同型・未是正 |
| 7 | `page-media/facade.ts` `getCachedResolvedSlots`(tag `"page_media"`) | ほぼ全 (site) ページ | 同型・未是正。**影響範囲が最大** |
| 8 | `page-media/facade.ts` `getCachedResolvedTexts`(tag `"page_text"`) | 同上 | 同型・未是正 |
| 9(再点検追加) | `settings/facade.ts` `getPublicValue`(tag `"site_settings"`) | 全 (site) ページの `generateMetadata`(`_lib/site-metadata.ts`) | 同型・未是正。**2026-07-17 の再点検で発見**(2026-07-11 版 B 表には未収録) |

補足:
- 各ページとも admin 保存経路(`admin/visual/actions.ts` 等)は当該タグへ `revalidateTag` を正しく呼んでおり健全。危険なのは**「ビルド前に空データで一度プリレンダされ、以後 admin 保存が一度も走らない」**という #38 と同一の初期条件に限られる。
- `scripts/seed-from-legacy.ts` は `works`/`voices`/`posts`/`price_*`/`site_settings` を投入するが revalidate を呼ばない。`scripts/revalidate-tags.ts` はタグ自体は任意指定可能(`parseTagsArg` はコード上の制限なく可変長引数を受理し、`/api/revalidate` の `zRevalidateReq` も任意文字列配列を受理する)。ただし運用手順(README の案内)が `prices` のみを例示しているため、seed 投入後に `works`/`voices`/`posts:*`/`page_media`/`page_text`/`site_settings` の revalidate 実行を忘れやすい。必要時は `npx tsx scripts/revalidate-tags.ts <tag...>` で任意タグを指定すること。
- 2026-07-17 実測: `src/app/(site)/**/page.tsx` に `export const revalidate` を持つのは **`/shop` のみ**(P1 の ISR 安全網は他ページに波及していない)。
- **本一覧は「点検・記録」が成果物**。2〜9 への P1/P2 是正の実装は本 Issue のスコープ外(裁定 #17 は「契約変更なし」)。**是正の要否は堀さんの判断事項**。対応時は seed/デプロイ手順に他タグの revalidate 実行を明記する運用整備と併せて別 Issue を起票する。

### 8.2 価格運用手順(R-S6 — 06-simulator §18)

**グレード(塗装コース)を `is_active=false`(提供終了)にしたら、`shop.grade.N.price` / `price.note` のテキストスロットを手で書き換えること。** `/shop` の SEC.01 カードは 3 枚固定(§7.2 の裁定で動的化しない)で、無効化しても該当カード・CTA は残り続け、価格表示は `formatGradeCardPrice` が null を返してフォールバック文言(既定は旧実額「¥7,000〜」等)に戻る。放置すると**廃番のはずのグレードが実売価格つきで案内され続ける**。無効化とスロット文言の手動更新は必ずセットで行う。

### 8.3 既知の技術的負債(要 migration の別 Issue 候補)

| # | 負債 | 所在 | 内容 | 是正案 |
|---|---|---|---|---|
| 1 | `work_blocks.source_document_id` の一意インデックス不在(#61 残課題)| `src/app/admin/documents/actions.ts` `generateBlocksAction`(L266〜)| ブロック再生成のガード(count)と INSERT の間に **check-then-act の TOCTOU ウィンドウ**が残る。現状は「INSERT 直前の再検証」で緩和しているが、DB 側に一意制約が無いため理論上ゼロにできない | `work_blocks(source_document_id)` の(部分)一意インデックスを migration で追加(別 Issue)|
| 2(コード対応済み・運用注意のみ) | seed 後の revalidate 実行忘れ | `scripts/revalidate-tags.ts` / README §「seed 投入後の反映」| タグ自体は任意指定可能(コード制限なし)だが、README の案内例が `prices` のみのため、seed 後に `works`/`voices`/`posts:*`/`page_media`/`page_text`/`site_settings` の revalidate 実行を忘れやすい(§8.1 の初期条件を作りやすい)| 運用手順の明記(別 Issue。#38 の後続)。`npx tsx scripts/revalidate-tags.ts <tag...>` で任意タグを指定可能|

### 8.4 横展開点検チェックリスト(次回リリース時に再点検)

リリース前に以下を機械的に回し、結果を本 §8 に追記していく:

- [ ] **`"use server"` の非 async export = 0**:
  `for f in $(grep -rlE '^\s*["'"'"']use server["'"'"']' src/); do grep -HnE '^\s*export (const|let|var|default|function [a-zA-Z])' "$f" | grep -vE 'export (type|interface)'; done`
  → 出力が空であること(2026-07-17 実測: 25 ファイル中 0 件。全 export が `async function` か `type` のみ)。
- [ ] **Data Cache 焼き付きの新規発生チェック**: `grep -rn "unstable_cache" src/` で新規キャッシュを洗い、`{ tags: [...] }` のみで `revalidate:` を持たないもの × 消費ページに `export const revalidate` 無し、の組を §8.1 の表へ追記する。
  → 2026-07-17 実測: §8.1 の 9 件(うち #1 のみ是正済み)。新規増加なし。
- [ ] **migration 台帳の実数突合**: `ls supabase/migrations/*.sql | wc -l` が §3 の記載本数と一致すること(2026-07-17: 39 本)。

## 9. 「もし詰まったら」の連絡先・参考

- 全体設計の Q&A: `docs/design/cms-ai-pipeline.md` の該当節
- モジュール契約: `docs/module-contracts.md` の facade / 依存方向 / Zod
- 実装で「これは私の勝手判断?」の判定: 各モジュールの `facade.ts` 冒頭のコメント(拡張契約は明示注記)
- Supabase Dashboard: https://supabase.com/dashboard/project/ixvfhxbfpdquwktsnmqy
- Vercel: https://vercel.com/daisukehoris-projects/kumabe-tosou

## 10. 直近のセッションログ要点(2026-07-08 → 07-09)

- Wave 0 → Wave 2 まで並列実装で 1 日完遂
- 途中で発見した本番バグをすべて修正済み(楽観ロック誤爆 / 施工事例保存 / メディア UUID 手入力 / admin 背景コントラスト)
- ビジュアル画像エディタは要望を受けて設計中(v1.3)。Codex 再々レビューで BLOCKER 0 を確認してから実装 GO の順序
- v1.2 → v1.3 の対応内容は設計書 §11.2 と Issue #2-#10 のコメントにまとめた
