# ビジュアル画像エディタ — Codex 外部レビュー履歴

`docs/design/visual-media-editor.md` に対する外部レビュー(Codex CLI)の全文ログを時系列で保持する。次の担当が「何が指摘されて何を潰したか」を追跡できるようにするため。

- レビューア: Codex CLI (`codex exec --sandbox read-only`)
- タスク発行者: 主セッション(Opus 4.8)
- 目的: 実装 GO 判定を得るため、BLOCKER 0 になるまで往復する

## v1.0 レビュー (2026-07-08)

指摘 12 件: BLOCKER 3 / MAJOR 8 / MINOR 1。総評: 「実装前に hero 二重管理、work_images、空枠、cache 即時反映を潰さないと途中で詰まる。BLOCKER 0 ではないため、現版のまま実装 GO とは判断しません。」

**潰したもの (v1.1 で対応)**: 12 件全部を設計書 v1.1 に反映。

## v1.1 レビュー (2026-07-09)

指摘 6 件: BLOCKER 1 / MAJOR 4 / MINOR 1。総評: 「v1.1 は旧レビューの大半を設計項目として拾えていますが、RLS/RPC の整合だけは BLOCKER です。実装前に契約を詰めれば潰せる MAJOR です。BLOCKER 0 ではないため、現版のまま実装 GO とは判断しません。」

**潰したもの (v1.2 で対応)**: 6 件全部を設計書 v1.2 に反映。

## v1.2 レビュー (2026-07-09)

指摘 9 件: BLOCKER 2 / MAJOR 4 / MINOR 3。総評: 「v1.2 は方向性はかなり良く、hero 一本化、resolver 1 クエリ化、work_images の atomic RPC 化は概ね妥当です。ただし cookie 発行経路と `security_invoker` view の権限設計に実装不能/矛盾が残っています。BLOCKER 2 のため、現状は実装GOではありません。」

指摘は GitHub Issue #2〜#10 に個別化した。

**潰したもの (v1.3 で対応、2026-07-09)**: 9 件全部 + 独自発見 2 件(E404 コード衝突 → E109 採番、メディア URL 2 系統分裂 → V0 補修)。主要な設計変更:
- edit-token cookie 機構を**全廃** → 専用 `/edit/[[...path]]` 動的ルートに分離(#2/#4/#8/#10 を同時解消)
- page_media.updated_by 列を廃止して anon SELECT を明示許可(#3)
- 対応の全容は設計書 §11.2 の対応表を参照

## v1.3 レビュー (2026-07-09)

指摘 8 件: BLOCKER 1 / MAJOR 3 / MINOR 4。総評: 「/edit 分離と公開 SSG 維持の方向は正しい。ただし unstable_cache × Map は設計書のままだと壊れる。BLOCKER 1 のため、現 v1.3 はまだ実装 GO ではない。」

確認済み事項 (Codex 承認): /edit + force-dynamic + requireAdmin は Next 15.5 で実装可能 / 公開 SSG 維持は成立 (JSON-safe 条件付き) / RLS・view 設計の矛盾は解消。

**潰したもの (v1.4 で対応、2026-07-09)**: 8 件全部。
- BLOCKER: unstable_cache は JSON round-trip するため Map 契約が壊れる → Record 化 + JSON-safe 不変条件
- MAJOR: /edit の content freshness (public-content の fetch/cache 2 層化) / EDITABLE_ROUTES 全量テスト / cover の CAS 楽観排他 (old_media_id + is not distinct from)
- MINOR: DDL grant 明記 / seed 記述の事実訂正 / login next ホワイトリスト / preventDefault 受入条件拡張

**重大な副産物**: 本番 HTTP 実測で `storage_path` 直 URL = 400、`{id}.webp` = 200 を確認。**公開サイトの works/voices/posts 画像は現在壊れている実バグ**と判明し、V0 を hotfix + 検証スクリプトに再定義 (設計書 §2.3)。

## v1.4 レビュー (2026-07-09) — **BLOCKER 0 = 実装 GO** 🎉

**BLOCKER 0 / MAJOR 0 / MINOR 3**。総評: 「v1.4 は v1.3 指摘の設計反映として整っています。残りは CAS の Supabase 実装メモを補う程度です。BLOCKER 0。実装 GO。」

確認済み: §11.3 の対応は全節に反映 / Record + JSON-safe で unstable_cache 問題解消 (Next 15.5.20 実装で裏取り) / cover CAS は RLS/Supabase client で実装可能。

MINOR 3 件 (CAS の .select() チェーンと .is()/.eq() 分岐、§5.5b の content 素 fetch 再掲) は同日 v1.4 に反映済み。

**実装 GO (2026-07-09)**: V0 (hotfix、GO 前に先行着手済み) → V1 → V2a/V2b 並列 → V3 の順で実装フェーズへ。

## Codex への依頼テンプレ

再々レビュー依頼のコマンド例:

```bash
codex exec --sandbox read-only "docs/design/visual-media-editor.md v1.3 の再レビュー。v1.2 → v1.3 で BLOCKER 2 / MAJOR 4 / MINOR 3 を反映済み。特に以下を厳密に見て: (1) Route Handler での edit-token 発行が Server Component の制約を回避しているか、(2) page_media の grant 設計に矛盾がないか、(3) 他の項目も消し込めているか、(4) 新たな BLOCKER/MAJOR がないか。BLOCKER/MAJOR/MINOR で簡潔に、日本語、最後に総評3行と BLOCKER 0 なら実装 GO 明示。"
```
