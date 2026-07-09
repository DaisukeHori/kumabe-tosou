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

## v1.3 レビュー — 依頼中 (2026-07-09)

結果はこのファイルと Issue #1 に追記する。

## 実装 GO 判定の条件

Codex レビューで **BLOCKER 0** かつ設計書側で MAJOR も対応済み(MINOR は実装中対応可)であることを確認してから、V0/V1(基盤)実装に着手する。

## Codex への依頼テンプレ

再々レビュー依頼のコマンド例:

```bash
codex exec --sandbox read-only "docs/design/visual-media-editor.md v1.3 の再レビュー。v1.2 → v1.3 で BLOCKER 2 / MAJOR 4 / MINOR 3 を反映済み。特に以下を厳密に見て: (1) Route Handler での edit-token 発行が Server Component の制約を回避しているか、(2) page_media の grant 設計に矛盾がないか、(3) 他の項目も消し込めているか、(4) 新たな BLOCKER/MAJOR がないか。BLOCKER/MAJOR/MINOR で簡潔に、日本語、最後に総評3行と BLOCKER 0 なら実装 GO 明示。"
```
