# 引き継ぎ資料 — 隈部塗装 CMS

- 作成: 2026-07-09 (堀さんの指示で次の担当へ引き継ぎ)
- 状態: 本番稼働中。次の大物「ビジュアル画像エディタ」は設計 v1.2 段階で Codex 未 GO(BLOCKER 2 件残)
- 主エディタセッション: Opus 4.8(直接執筆) / 実装エージェント: Sonnet 5(user-level 規約)

## ⚠️ 最優先で読むもの
1. **本ファイル**(この HANDOFF.md)全部
2. `docs/design/cms-ai-pipeline.md`(全体設計 v3.4)
3. `docs/module-contracts.md`(モジュール契約 v2.2)
4. `docs/design/visual-media-editor.md`(v1.2、進行中)
5. **GitHub Issues**(既知課題・未着手・仕様確認事項をラベル付きで整理)

## 1. いま本番で動いているもの

| URL | 状態 |
|---|---|
| https://kumabe-tosou.vercel.app | 公開サイト(DB 駆動、seed 済み) |
| https://kumabe-tosou.vercel.app/admin/login | 管理画面ログイン |

**管理者アカウント(仮パスワード — 変更推奨)**
- email: `nvidia.homeftp.net@gmail.com`
- password: `12345678`
- Supabase Dashboard の Auth からのパスワード変更 or ここでの直接更新に加え、`.env.local` の `BOOTSTRAP_ADMIN_PASSWORD` も同期すること

**本番インフラ**
- Vercel: プロジェクト `kumabe-tosou`(daisukehori 個人スコープ)/ GitHub 連携済み(main push で自動デプロイ)/ Node 20 LTS
- Supabase: project_id `ixvfhxbfpdquwktsnmqy`(東京、$10/月 — 組織の無料枠使用済みのため)/ 22+ テーブル / RLS 全面適用 / Vault + pg_cron 稼働中
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

現時点で本番 DB に適用済み(`supabase/migrations/` の一覧):

```
0001 init_schema                       … 19 テーブル + trigger
0002 rls                                … is_admin() + 全テーブル RLS
0003 storage                            … 4 バケット + policy
0004 vault_rpc                          … vault_upsert_secret
0005 work_images_select                 … junction の SELECT policy
0006 security_advisor_fixes             … アドバイザ対応 (search_path 固定 / bucket 一覧列挙防止)
0007 pricing_v2                         … 価格行列モデル (size_classes/matrix/quantity_tiers)
0008 media_reference_summary            … 削除ガード用 view
0009 ai_run_commit_stage                … advance/lease RPC + research_enabled 列
0010 distribution_worker_support        … vault_read_secret + refresh lease + index
0011 pg_cron_jobs                       … publish(毎分) / watchdog(5分毎)
0012 admin_write_junction_tables        … work_images / seed_manifest への admin 書込許可
0013 media_reference_summary(view 更新)   … これは 0008 と同名だが別内容(admin セッション対応時に追加)
```

**注意**: v1.2 の設計書に載っている `page_media` テーブル用の migration はまだ書いていない。実装 GO が出たら 0014 として作成する。

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
- テスト 156 件 全 PASS(2026-07-09 現在)

### 4.2 進行中(引き継ぎで最優先)

**ビジュアル画像エディタ**(要望 = 全公開ページの写真を管理画面の実物ページ縮小 iframe 上でクリック → メニューで差し替え)

- 設計書: `docs/design/visual-media-editor.md` v1.2(commit `ed21e5a`)
- **Codex 外部レビュー結果**:
  - v1.0 → 12 件(BLOCKER 3 / MAJOR 8 / MINOR 1)
  - v1.1 → 6 件(BLOCKER 1 / MAJOR 4 / MINOR 1)
  - **v1.2 → 9 件残(BLOCKER 2 / MAJOR 4 / MINOR 3)** ← ここが最新、**まだ実装 GO ではない**
- v1.2 の残 BLOCKER:
  1. **Server Component で `cookies().set()` は不可**(Next.js 制約)。edit-token は Server Action か Route Handler(`/admin/visual/edit-session`)で発行する契約に修正必要
  2. **security_invoker view + base table に direct grant しない の矛盾**。呼び出しユーザーが両方の権限を持つ必要があるため、`page_media` は「公開メタデータ」と割り切って anon SELECT を明示 grant すべき

- v1.2 の残 MAJOR/MINOR は Issue に個別化(下記)

### 4.3 未着手(承認済みの方針)
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
│   │   ├── cms-ai-pipeline.md          … 全体設計 v3.4(canonical)
│   │   └── visual-media-editor.md      … 進行中 v1.2
│   ├── module-contracts.md             … モジュール契約 v2.2(Zod/facade/依存)
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
│   │   │   ├── _ui/                    … Surface/PageHeader/DataTable/StatusBadge/MediaPicker
│   │   │   ├── login/ dashboard/
│   │   │   ├── works|posts|voices|prices|media|inquiries|studio|channels|settings/
│   │   ├── api/                        … Route Handlers(revalidate, upload-url, ai/*, publish/*, jobs/*)
│   │   ├── _lib/                       … 公開 SSR 用の DB fetch helper
│   │   └── layout.tsx                  … html/body/フォント/globals のみ(SiteHeader は (site) に)
│   ├── middleware.ts                   … /admin/** 保護
│   ├── modules/                        … モジュラーモノリスの本体
│   │   ├── platform/ settings/ content/ pricing/ inquiry/ media/ ai-studio/ distribution/
│   │   └── page-media/                  … 未実装(V1 で追加予定)
│   ├── components/
│   │   ├── site/                       … 公開 UI(reveal/hero/gallery/simulator 等)
│   │   └── contact/                    … contact フォーム
│   └── lib/
│       ├── env.ts                      … 空文字→undefined 正規化(重要バグ回避)
│       └── supabase/{server,service,public}.ts
├── supabase/migrations/                … 0001〜0013 適用済み
├── scripts/
│   ├── bootstrap-admin.ts              … 管理者作成(admin セッション対応)
│   ├── seed-from-legacy.ts             … コンテンツ + 画像投入(冪等)
│   ├── rollback-seed.ts                … manifest 逆順削除
│   └── seed-data/*.ts                  … 転記ソース
├── tests/                              … Vitest(156 件 PASS)
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
   → 設計書 v1.2 で BLOCKER 指摘済
6. **`.env.local` の空文字プレースホルダは zod の optional() を通らない**。
   → `preprocess(emptyToUndefined, z.string().optional())` で対応済(src/lib/env.ts)
7. **React 19 の form は送信ごとに form.reset() を呼ぶ**。
   → 直前入力を保持したい場合は state に email/attempt を含める(login-form.tsx で対応済)
8. **usePathname はクライアントのみ**。サーバーの `headers()` からのパス判定だと soft navigation で更新されない。
   → サイドナビは Client Component で(admin-nav.tsx で対応済)
9. **loading="lazy" の img がキャッシュ済みだと onLoad 発火せずスケルトンが固着**。
   → `useEffect` で `img.complete` を初期化時にチェック(MediaThumbnail で対応済)
10. **並列 agent を isolation=worktree なしで起動すると cwd 共有事故**が起きる。
11. **Supabase migration は Vercel と別**。0001〜0013 を DB に手動 apply する運用は継続。

## 9. 「もし詰まったら」の連絡先・参考

- 全体設計の Q&A: `docs/design/cms-ai-pipeline.md` の該当節
- モジュール契約: `docs/module-contracts.md` の facade / 依存方向 / Zod
- 実装で「これは私の勝手判断?」の判定: 各モジュールの `facade.ts` 冒頭のコメント(拡張契約は明示注記)
- Supabase Dashboard: https://supabase.com/dashboard/project/ixvfhxbfpdquwktsnmqy
- Vercel: https://vercel.com/daisukehoris-projects/kumabe-tosou

## 10. 直近のセッションログ要点(2026-07-08 → 07-09)

- Wave 0 → Wave 2 まで並列実装で 1 日完遂
- 途中で発見した本番バグをすべて修正済み(楽観ロック誤爆 / 施工事例保存 / メディア UUID 手入力 / admin 背景コントラスト)
- ビジュアル画像エディタは要望を受けて設計中(v1.2)。Codex レビューで残 BLOCKER 2 件があるため、**v1.3 で潰してから実装 GO** の順序
- v1.2 → v1.3 の対応候補は Issue #(ビジュアル画像エディタ関連)にまとめた
