// scheduling/internal/sync-state.ts
// canonical: docs/design/crm-suite/03-scheduling.md §5.3 (calendar_event_links 同期状態機械)。
// calendar_event_links.sync_status の遷移ガード純関数 (facade/sync-engine から呼ぶ)。
//
// §5.3 不変条件 (抜粋。本ファイルが機械的に守る分):
//   3. conflict + E724 の link は worker が自動処理しない (自動再開禁止 — E506 と同思想)。
//      解決は admin の「照合」操作のみ (§8.7)
//   (E721 は「次回 pull → pending_push 再送 (自動)」— worker が唯一自動遷移させてよい conflict)

export type SyncStatusSnapshot = {
  sync_status: "synced" | "pending_push" | "conflict" | "orphaned" | "deleted_externally";
  last_error_code: string | null;
};

/**
 * pull が「外部で時刻等が変わった」ことを観測したときに、conflict 状態の link を worker が
 * 自動的に pending_push へ戻してよいかどうか (§8.5「'conflict'(E721) だった場合 → 'pending_push'
 * に戻す」)。E721 (楽観排他競合。自動解決可) のみ true。E723 (確定エラー3回) / E724 (結果不明。
 * 自動再開禁止) は admin の明示操作でのみ解除できるため false — 時刻自体は §8.5 のフィールド
 * 所有権原則により work_blocks には反映してよいが、sync_status は据え置く (エラー状態を
 * 黙って消さない)。
 */
export function canAutoRevertConflictOnPull(link: SyncStatusSnapshot): boolean {
  return link.sync_status === "conflict" && link.last_error_code === "KMB-E721";
}

/** conflict + KMB-E724 (結果不明) は worker が自動処理しない (§5.3 不変条件 3)。 */
export function isAutoProcessLocked(link: SyncStatusSnapshot): boolean {
  return link.sync_status === "conflict" && link.last_error_code === "KMB-E724";
}

/** resolveExternalDeletion (§9.2) の対象になり得るか。deleted_externally のみ。 */
export function canResolveExternalDeletion(link: SyncStatusSnapshot): boolean {
  return link.sync_status === "deleted_externally";
}

/** reconcilePushUnknown (§8.7) の対象になり得るか。conflict + KMB-E724 専用。 */
export function canReconcilePushUnknown(link: SyncStatusSnapshot): boolean {
  return link.sync_status === "conflict" && link.last_error_code === "KMB-E724";
}

/** resendConflictedLink (§8.7) の対象になり得るか。conflict + KMB-E723 専用。 */
export function canResendConflictedLink(link: SyncStatusSnapshot): boolean {
  return link.sync_status === "conflict" && link.last_error_code === "KMB-E723";
}

/** resolveOrphanedLink (§9.2) の対象になり得るか。orphaned のみ。 */
export function canResolveOrphanedLink(link: SyncStatusSnapshot): boolean {
  return link.sync_status === "orphaned";
}
