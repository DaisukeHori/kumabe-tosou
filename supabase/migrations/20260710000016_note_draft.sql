-- =========================================================
-- AI スタジオ v2 P6: note 下書き自動化 (オプトイン、堀さん GO 済み)
-- canonical: docs/design/ai-studio-v2.md §8 (note 下書き自動化) / §10 (KMB-E409)
--            docs/research/ai-studio-v2/note-posting.md (非公式 API の実測仕様。厳密に従う)
--            docs/module-contracts.md v2.5 §1 (distribution 所有: channel_posts)
--
-- 本 migration が追加するもの:
--   1) channel_posts.note_draft_status ('none'|'creating'|'created'|'unknown'|'failed') + note_draft_url
--      (§8 MAJOR-3 の状態意味論。channel_posts.status (manual_required 等) とは独立の付加情報 —
--       既存の manual_required 人間照合フローはそのまま・note_draft_status は追加表示のみ)
--
-- Vault: note セッション Cookie (`_note_session_v5` 等を含む生の Cookie ヘッダ文字列) は
-- 既存の vault_upsert_secret / vault_read_secret RPC (20260708000004 / 20260708000010) を
-- そのまま流用する (専用テーブル・RPC の追加は不要)。vault_secret_name には
-- 'sns_note_session_cookie' を用い、channel_accounts.vault_secret_name (note 行) に保存する
-- (X/Instagram と同じ前例踏襲。src/modules/distribution/internal/vault-names.ts 参照)。
-- channel_accounts.meta (jsonb) に cookie_saved_at を追加するが、jsonb のため DDL 変更は不要
-- (zNoteAccountMeta の非破壊的スキーマ拡張。既存行は読み取り時に安全側でデフォルト null 扱い)。
--
-- RLS: channel_posts の既存ポリシー (admin SELECT 全権 / UPDATE は cancel 遷移のみ) は
-- 変更しない。note_draft_status/note_draft_url の書き込みは他の状態遷移列 (status 等) と
-- 同様に service client (DistributionFacade.createNoteDraft 内部) 経由のみで行う。
-- =========================================================

alter table channel_posts
  add column note_draft_status text not null default 'none'
    check (note_draft_status in ('none', 'creating', 'created', 'unknown', 'failed')),
  add column note_draft_url text;

comment on column channel_posts.note_draft_status is
  'note 下書き自動作成の状態 (§8 MAJOR-3)。channel_posts.status (manual_required 等) とは独立の付加情報。unknown はタイムアウト/応答不明を表し、次回実行前の note 下書き一覧との照合で created に昇格しうる (重複下書き防止)。';
comment on column channel_posts.note_draft_url is
  'note 下書きの編集 URL (note_draft_status=created のときのみ設定)。';
