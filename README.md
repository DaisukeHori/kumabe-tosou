# 隈部塗装 CMS

3D プリント表面処理(研磨・塗装)専門工房「隈部塗装」のコーポレートサイト + 自作 CMS + AI コンテンツパイプライン。

- 本番: https://kumabe-tosou.vercel.app
- 管理画面: https://kumabe-tosou.vercel.app/admin
- 代表: 隈部 信之(大分県豊後高田市、郵送受託・全国対応)

## 👉 新しく参加する人へ

**まず [`HANDOFF.md`](./HANDOFF.md) を読んでください。**
現状のインフラ・環境変数・ハマりポイント・進行中タスクを全部まとめてあります。

## 📋 現在のタスク

すべて GitHub Issues で管理:
- [全 Open Issue 一覧](https://github.com/DaisukeHori/kumabe-tosou/issues)
- 最優先: [Epic #1 ビジュアル画像エディタ](https://github.com/DaisukeHori/kumabe-tosou/issues/1)(要望済み・設計進行中)
- 運用系: `label:ops`(独自ドメイン / API キー / Pro 移行 等)
- セキュリティ: `label:security`(パスワード変更 / service_role キー)

## 📁 主要ドキュメント (canonical)

| ファイル | 内容 |
|---|---|
| [HANDOFF.md](./HANDOFF.md) | 引き継ぎ資料。**最初にこれ** |
| [docs/design/cms-ai-pipeline.md](./docs/design/cms-ai-pipeline.md) | 全体設計 v3.4(DDL / 認可 / 状態遷移 / 受入基準) |
| [docs/module-contracts.md](./docs/module-contracts.md) | モジュール契約 v2.2(Zod / facade / 依存方向 / 結合シーケンス) |
| [docs/design/visual-media-editor.md](./docs/design/visual-media-editor.md) | ビジュアル画像エディタ設計 v1.2 (**進行中**、Codex レビューで残 BLOCKER 2 件) |
| [docs/design/visual-media-editor-review-log.md](./docs/design/visual-media-editor-review-log.md) | Codex レビュー履歴(v1.0→v1.2) |
| [docs/mock-check.md](./docs/mock-check.md) | Phase 0 手動チェックリスト |

## 🛠 技術スタック

- **フロント**: Next.js 15 (App Router, TypeScript, Tailwind CSS v4, shadcn/ui base-ui 系)
- **バックエンド**: Supabase (Postgres, Auth, Storage, Vault, pg_cron)
- **AI**: Claude API (`claude-opus-4-8`) + OpenAI (`gpt-4o-transcribe`)
- **配信**: X API v2 (従量課金) / Instagram Graph API / note 半自動
- **メール**: Resend
- **ホスティング**: Vercel (Node 20 LTS, hnd1 東京リージョン)

## 🏗 アーキテクチャ

モジュラーモノリス。各モジュールは `src/modules/<name>/` に閉じ、`facade.ts` が公開契約、`repository.ts` が DB アクセス、`internal/` が内部実装。

```
platform    ─── 認証・エラー・共通型
content     ─── works / posts / voices の CRUD
media       ─── 画像アップロード / レンディション / 参照カウント
pricing     ─── 行列モデル + 見積もり計算 (legacy と 1 円単位で一致)
settings    ─── サイト設定 (会社情報 / ヒーロー / SEO / 運用上限 / 通知)
inquiry     ─── 問い合わせ + rate limit + Resend 通知
ai-studio   ─── 録音 → 整文 → 要旨抽出 → リサーチ → チャネル別生成 (advance/lease)
distribution─── X / Meta OAuth / 配信 worker (at-least-once + 人間照合)
```

依存方向とテーブル所有は [`docs/module-contracts.md`](./docs/module-contracts.md) §1・§2 が単一ソース。

## 🚀 セットアップ (次の担当者向け)

前提: Node 20 / npm / gh CLI / Vercel CLI / Supabase MCP (Claude Code 用) が入っていること。

```bash
git clone https://github.com/DaisukeHori/kumabe-tosou.git
cd kumabe-tosou
npm ci
# .env.local を作成 (詳細は HANDOFF.md §2)
# 特に SUPABASE_SERVICE_ROLE_KEY と BOOTSTRAP_ADMIN_* を入れる
npm run dev  # http://localhost:3000
```

### 主なコマンド

```bash
npm run dev              # dev server
npm run build            # 本番ビルド
npm run lint             # ESLint (境界ルール含む)
npm test                 # Vitest (156 件)
npx tsx scripts/seed-from-legacy.ts   # 初期コンテンツ投入 (冪等)
npx tsx scripts/rollback-seed.ts      # 逆順削除
npx tsx scripts/bootstrap-admin.ts    # 管理者作成 (冪等)
```

### Supabase migration の適用

Vercel の GitHub 連携は **コードのみ**。migration は Supabase MCP か Dashboard SQL Editor から**手動で apply**する運用。

- ローカルで開発する場合: `supabase start`(Docker 必須)
- 本番反映: Claude Code で MCP 経由 or Supabase Dashboard から

## 📜 開発ルール(要点)

詳細は [HANDOFF.md §6](./HANDOFF.md) を参照。

- サブエージェントは Sonnet 5(`model: "sonnet"`)、設計書は Opus 直接執筆
- 並列 implementer は `isolation: "worktree"` 必須
- モジュール開発は implementer + tester ペア、2 回連続 PASS で完了
- commit メッセージは日本語(Co-Authored-By なし)
- 設計書には Codex(`codex exec --sandbox read-only`)で外部レビュー
- 実装完了時は Chrome MCP で E2E 確認

## 📖 過去(旧静的サイト)

Phase 0 の Next.js 移行前は素の HTML/CSS/JS 静的サイトだった(11 ページ)。ソースは [`legacy/`](./legacy/) に退避してある。

- 元 URL: https://daisukehori.github.io/kumabe-tosou/ (GitHub Pages、Vercel 稼働後は使わない)
- 参照用のみで、公開・デプロイ対象ではない

## ⚖️ ライセンス

内部プロジェクト(未定)。

## 🙏 謝辞

Phase 0 → Wave 3 まで、Claude(Opus 4.8 / Sonnet 5) と Codex CLI(GPT-5) の協働で実装。設計書はメインセッション(Opus)が直接執筆、実装は Sonnet 5 の implementer/tester を並列 worktree で運用。
