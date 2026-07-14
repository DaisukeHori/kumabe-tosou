// scheduling/internal/lease.ts
// canonical: docs/design/crm-suite/03-scheduling.md §2.3 コメント
// (token_refresh_lease_expires_at=CAS / sync_lease_expires_at=TTL 90 秒)。
// CAS リース TTL の定数集 (単体テスト対象 — 値そのものの回帰を検知する)。

/** calendar_connections.token_refresh_lease_expires_at の CAS リース TTL (§8.3)。
 *  distribution の X_REFRESH_LEASE_TTL_MS (30 秒) と同型。 */
export const TOKEN_REFRESH_LEASE_TTL_MS = 30_000;

/** calendar_connections.sync_lease_expires_at の CAS リース TTL (§8.5)。
 *  worker 多重起床対策。5 分周期の起床に対して十分な余裕を持たせつつ、
 *  死んだプロセスのリースを次起床までに回収できる長さ (90 秒)。 */
export const SYNC_LEASE_TTL_MS = 90_000;

/** token refresh の CAS が他プロセス保持中だった場合の待機時間 (§8.3 手順 2)。
 *  distribution/internal/worker.ts の 1.5 秒待機と同型。 */
export const TOKEN_REFRESH_LEASE_WAIT_MS = 1_500;

/** push 1 起床あたりの最大処理件数 (§8.4)。 */
export const PUSH_BATCH_LIMIT = 20;

/** push 確定エラーの最大試行回数。3 回目で conflict + KMB-E723 (§8.4)。 */
export const PUSH_MAX_ATTEMPTS = 3;

/** pull 1 起床あたりの最大ページ数 (§8.5)。超過は KMB-E725 安全弁。 */
export const PULL_MAX_PAGES = 20;

/** 自己エコー判定 (§8.6 rule2) の許容マージン。push 応答時刻と pull 観測時刻のずれを吸収する。 */
export const ECHO_UPDATED_AT_MARGIN_MS = 5_000;

/**
 * requestSyncNow (§6.2/§9.2「今すぐ同期」) の縮小上限。Server Action の実行時間内に収めるため
 * PUSH_BATCH_LIMIT/PULL_MAX_PAGES (5 分毎 worker 用) より小さい値を使う。残りは worker が継続する。
 */
export const MANUAL_SYNC_PUSH_LIMIT = 5;
export const MANUAL_SYNC_PULL_PAGES = 5;
