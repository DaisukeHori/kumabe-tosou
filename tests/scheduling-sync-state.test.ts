import { describe, expect, it } from "vitest";

import {
  canAutoRevertConflictOnPull,
  canReconcilePushUnknown,
  canResendConflictedLink,
  canResolveExternalDeletion,
  canResolveOrphanedLink,
  isAutoProcessLocked,
  type SyncStatusSnapshot,
} from "@/modules/scheduling/internal/sync-state";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §5.3 (calendar_event_links 同期状態機械)。
 * 実装計画書「テスト戦略」§scheduling-sync-state.test.ts の必須ケース:
 *   §5.3 遷移ガード全パス (E721自動復帰/E724自動処理禁止/deleted_externally 3択)
 *
 * 不変条件3 (最重要): conflict + KMB-E724 (結果不明) は worker が自動処理してはならない。
 * E721 (楽観排他競合) のみ worker が自動で pending_push に戻してよい唯一の conflict。
 */

function snap(overrides: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot {
  return { sync_status: "synced", last_error_code: null, ...overrides };
}

describe("canAutoRevertConflictOnPull: worker が自動的に pending_push へ戻してよいのは conflict+E721 のみ", () => {
  it("conflict + KMB-E721 は true (楽観排他競合。自動解決可)", () => {
    expect(canAutoRevertConflictOnPull(snap({ sync_status: "conflict", last_error_code: "KMB-E721" }))).toBe(true);
  });

  it("conflict + KMB-E723 (確定エラー3回) は false (admin 操作のみ)", () => {
    expect(canAutoRevertConflictOnPull(snap({ sync_status: "conflict", last_error_code: "KMB-E723" }))).toBe(false);
  });

  it("conflict + KMB-E724 (結果不明) は false (不変条件3: 自動再開禁止)", () => {
    expect(canAutoRevertConflictOnPull(snap({ sync_status: "conflict", last_error_code: "KMB-E724" }))).toBe(false);
  });

  it("conflict でも last_error_code が null なら false (E721 以外は全て false)", () => {
    expect(canAutoRevertConflictOnPull(snap({ sync_status: "conflict", last_error_code: null }))).toBe(false);
  });

  it("sync_status が conflict 以外 (synced 等) なら last_error_code に関わらず false", () => {
    expect(canAutoRevertConflictOnPull(snap({ sync_status: "synced", last_error_code: "KMB-E721" }))).toBe(false);
  });
});

describe("isAutoProcessLocked: conflict+E724 のみ worker の自動処理をロックする (不変条件3)", () => {
  it("conflict + KMB-E724 は true", () => {
    expect(isAutoProcessLocked(snap({ sync_status: "conflict", last_error_code: "KMB-E724" }))).toBe(true);
  });

  it("conflict + KMB-E721 / KMB-E723 は false (E724 以外はロック対象外)", () => {
    expect(isAutoProcessLocked(snap({ sync_status: "conflict", last_error_code: "KMB-E721" }))).toBe(false);
    expect(isAutoProcessLocked(snap({ sync_status: "conflict", last_error_code: "KMB-E723" }))).toBe(false);
  });

  it("sync_status が conflict 以外なら false", () => {
    expect(isAutoProcessLocked(snap({ sync_status: "orphaned", last_error_code: "KMB-E724" }))).toBe(false);
  });
});

describe("canResolveExternalDeletion: deleted_externally 状態の link のみ対象 (§9.2 3択)", () => {
  it("deleted_externally は true", () => {
    expect(canResolveExternalDeletion(snap({ sync_status: "deleted_externally" }))).toBe(true);
  });

  it.each<SyncStatusSnapshot["sync_status"]>(["synced", "pending_push", "conflict", "orphaned"])(
    "%s は false",
    (status) => {
      expect(canResolveExternalDeletion(snap({ sync_status: status }))).toBe(false);
    },
  );
});

describe("canReconcilePushUnknown: conflict+KMB-E724 専用 (§8.7 照合)", () => {
  it("conflict + KMB-E724 は true", () => {
    expect(canReconcilePushUnknown(snap({ sync_status: "conflict", last_error_code: "KMB-E724" }))).toBe(true);
  });

  it("conflict + KMB-E721 / KMB-E723 は false (E724 専用)", () => {
    expect(canReconcilePushUnknown(snap({ sync_status: "conflict", last_error_code: "KMB-E721" }))).toBe(false);
    expect(canReconcilePushUnknown(snap({ sync_status: "conflict", last_error_code: "KMB-E723" }))).toBe(false);
  });

  it("conflict 以外の sync_status は false", () => {
    expect(canReconcilePushUnknown(snap({ sync_status: "deleted_externally", last_error_code: "KMB-E724" }))).toBe(false);
  });
});

describe("canResendConflictedLink: conflict+KMB-E723 専用 (§8.7 再送)", () => {
  it("conflict + KMB-E723 は true", () => {
    expect(canResendConflictedLink(snap({ sync_status: "conflict", last_error_code: "KMB-E723" }))).toBe(true);
  });

  it("conflict + KMB-E721 / KMB-E724 は false (E723 専用 — E724 は照合、E721 は自動復帰)", () => {
    expect(canResendConflictedLink(snap({ sync_status: "conflict", last_error_code: "KMB-E721" }))).toBe(false);
    expect(canResendConflictedLink(snap({ sync_status: "conflict", last_error_code: "KMB-E724" }))).toBe(false);
  });
});

describe("canResolveOrphanedLink: orphaned 状態の link のみ対象", () => {
  it("orphaned は true", () => {
    expect(canResolveOrphanedLink(snap({ sync_status: "orphaned" }))).toBe(true);
  });

  it.each<SyncStatusSnapshot["sync_status"]>(["synced", "pending_push", "conflict", "deleted_externally"])(
    "%s は false",
    (status) => {
      expect(canResolveOrphanedLink(snap({ sync_status: status }))).toBe(false);
    },
  );
});

describe("状態の排他性 (相互に重複しないことの確認 — 誤った二重ガードの回帰検知)", () => {
  it("conflict+E724 は canReconcilePushUnknown のみ true で、canResendConflictedLink/canAutoRevertConflictOnPull は false", () => {
    const s = snap({ sync_status: "conflict", last_error_code: "KMB-E724" });
    expect(canReconcilePushUnknown(s)).toBe(true);
    expect(canResendConflictedLink(s)).toBe(false);
    expect(canAutoRevertConflictOnPull(s)).toBe(false);
    expect(isAutoProcessLocked(s)).toBe(true);
  });

  it("conflict+E721 は canAutoRevertConflictOnPull のみ true で、他の admin 操作ガードは false", () => {
    const s = snap({ sync_status: "conflict", last_error_code: "KMB-E721" });
    expect(canAutoRevertConflictOnPull(s)).toBe(true);
    expect(canReconcilePushUnknown(s)).toBe(false);
    expect(canResendConflictedLink(s)).toBe(false);
    expect(isAutoProcessLocked(s)).toBe(false);
  });
});
