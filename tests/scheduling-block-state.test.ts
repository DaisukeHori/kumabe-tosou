import { describe, expect, it } from "vitest";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §5.1 (work_blocks 状態機械 許可遷移表)。
 * scheduling/internal/block-state.ts (DB 非依存の純関数) の単体テスト。
 * 実装計画書 (worktree issue-53.md) §13.2 の必須ケース:
 *  - §5.1 遷移表 全セル 25 組 (5×5 総当たり、許可/禁止それぞれ期待値を明示)
 *  - E701 ペア検証 (zPlaceBlockInput.refine)
 *  - done 訂正許可 (done→done)
 *  - 削除ガード (backlog/cancelled 許可、scheduled/in_progress/done 拒否 +
 *    hasUndeletedExternalLink=true なら常に拒否)
 *  - createBlock の status 導出 (配置入力あり→scheduled、なし→backlog)
 */

import { zPlaceBlockInput } from "@/modules/scheduling/contracts";
import type { WorkBlockStatus } from "@/modules/scheduling/contracts";
import {
  assertDeletable,
  canPlaceBlock,
  canTransitionBlock,
  deriveCreateStatus,
  derivePlacementStatus,
} from "@/modules/scheduling/internal/block-state";

const ALL_STATUSES: WorkBlockStatus[] = ["backlog", "scheduled", "in_progress", "done", "cancelled"];

/**
 * §5.1 の許可遷移表の ✅ セル (10 エッジ)。block-state.ts の TRANSITION_EDGES と 1:1 対応する
 * 正解表 (テスト側で独立に列挙し、実装のコピペにならないようにする)。
 */
const ALLOWED_EDGES = new Set<string>([
  "backlog->scheduled",
  "backlog->cancelled",
  "scheduled->backlog",
  "scheduled->scheduled",
  "scheduled->in_progress",
  "scheduled->done",
  "scheduled->cancelled",
  "in_progress->done",
  "in_progress->cancelled",
  "done->done",
]);

describe("canTransitionBlock (§5.1 許可遷移表 5×5 総当たり)", () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const key = `${from}->${to}`;
      const expected = ALLOWED_EDGES.has(key);
      it(`${key} は ${expected ? "許可" : "禁止"}`, () => {
        expect(canTransitionBlock(from, to)).toBe(expected);
      });
    }
  }

  it("cancelled は from としてどこにも登場しない (完全終端 — 5 通り全て false)", () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionBlock("cancelled", to)).toBe(false);
    }
  });

  it("done→done (実績訂正) は自己ループとして明示的に許可される", () => {
    expect(canTransitionBlock("done", "done")).toBe(true);
  });

  it("backlog→backlog / in_progress→in_progress は対角線 (表では「—」) のため禁止", () => {
    expect(canTransitionBlock("backlog", "backlog")).toBe(false);
    expect(canTransitionBlock("in_progress", "in_progress")).toBe(false);
  });
});

describe("canPlaceBlock (placeBlock 配置可否 — in_progress 例外込み)", () => {
  it("backlog は配置可能 (→scheduled)", () => {
    expect(canPlaceBlock("backlog")).toBe(true);
  });
  it("scheduled は配置可能 (移動)", () => {
    expect(canPlaceBlock("scheduled")).toBe(true);
  });
  it("in_progress は配置可能 (時刻変更のみ、状態は維持 — 表では表現しきれない例外)", () => {
    expect(canPlaceBlock("in_progress")).toBe(true);
  });
  it("done は配置不可 (E703)", () => {
    expect(canPlaceBlock("done")).toBe(false);
  });
  it("cancelled は配置不可 (E703)", () => {
    expect(canPlaceBlock("cancelled")).toBe(false);
  });
});

describe("derivePlacementStatus (placeBlock 成功時の新 status 導出)", () => {
  it("backlog → scheduled", () => {
    expect(derivePlacementStatus("backlog")).toBe("scheduled");
  });
  it("scheduled → scheduled (現状維持)", () => {
    expect(derivePlacementStatus("scheduled")).toBe("scheduled");
  });
  it("in_progress → in_progress (現状維持、時刻だけ変わる)", () => {
    expect(derivePlacementStatus("in_progress")).toBe("in_progress");
  });
});

describe("assertDeletable (§5.1 不変条件 5 — 削除ガード)", () => {
  it("backlog かつ 外部未削除 link なし → 削除可", () => {
    expect(assertDeletable("backlog", false)).toBe(true);
  });
  it("cancelled かつ 外部未削除 link なし → 削除可", () => {
    expect(assertDeletable("cancelled", false)).toBe(true);
  });
  it("scheduled → 削除不可", () => {
    expect(assertDeletable("scheduled", false)).toBe(false);
  });
  it("in_progress → 削除不可", () => {
    expect(assertDeletable("in_progress", false)).toBe(false);
  });
  it("done → 削除不可", () => {
    expect(assertDeletable("done", false)).toBe(false);
  });
  it("backlog でも hasUndeletedExternalLink=true なら削除不可 (地雷2の分岐)", () => {
    expect(assertDeletable("backlog", true)).toBe(false);
  });
  it("cancelled でも hasUndeletedExternalLink=true なら削除不可 (地雷2の分岐)", () => {
    expect(assertDeletable("cancelled", true)).toBe(false);
  });
  it("scheduled かつ hasUndeletedExternalLink=true も当然削除不可", () => {
    expect(assertDeletable("scheduled", true)).toBe(false);
  });
});

describe("deriveCreateStatus (§5.1-6 createBlock の status 導出)", () => {
  it("配置入力あり (hasPlacement=true) → scheduled", () => {
    expect(deriveCreateStatus(true)).toBe("scheduled");
  });
  it("配置入力なし (hasPlacement=false) → backlog", () => {
    expect(deriveCreateStatus(false)).toBe("backlog");
  });
});

describe("zPlaceBlockInput (E701 ペア検証 — 開始<終了 refine)", () => {
  it("開始 < 終了 は成功する", () => {
    const result = zPlaceBlockInput.safeParse({
      starts_at: "2026-07-13T09:00:00+09:00",
      ends_at: "2026-07-13T12:00:00+09:00",
    });
    expect(result.success).toBe(true);
  });

  it("開始 == 終了 は refine 違反 (root-level issue, path.length===0 — facade の KMB-E701 昇格対象)", () => {
    const result = zPlaceBlockInput.safeParse({
      starts_at: "2026-07-13T09:00:00+09:00",
      ends_at: "2026-07-13T09:00:00+09:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.length === 0)).toBe(true);
    }
  });

  it("開始 > 終了 は refine 違反 (root-level issue)", () => {
    const result = zPlaceBlockInput.safeParse({
      starts_at: "2026-07-13T12:00:00+09:00",
      ends_at: "2026-07-13T09:00:00+09:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.length === 0)).toBe(true);
    }
  });

  it("starts_at がオフセット無し ISO 文字列はフィールド単位の検証違反 (root-level issue ではない)", () => {
    const result = zPlaceBlockInput.safeParse({
      starts_at: "2026-07-13T09:00:00", // offset 無し — zIsoDatetime({offset:true}) 違反
      ends_at: "2026-07-13T12:00:00+09:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.every((i) => i.path.length > 0)).toBe(true);
    }
  });
});
