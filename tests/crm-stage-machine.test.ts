import { describe, expect, it } from "vitest";

import { DEAL_STAGE_REGISTRY, type DealStage } from "@/modules/crm/contracts";
import {
  canTransitionDealStage,
  shouldPromoteLifecycleOnWin,
  shouldRecordWonAt,
} from "@/modules/crm/internal/stage-machine";

/**
 * canonical: docs/design/crm-suite/01-crm.md §4.2 (deals.stage 状態機械)。
 * 9×9 全組合せの期待値: from===to の 9 セル = noop (終端同士含む) /
 * from∈{paid,lost} かつ from≠to の 16 セル = invalid /
 * from∉{paid,lost} かつ to='lost' の 7 セル = needs_reason / 残り 49 セル = ok。
 */

const ALL_STAGES = Object.keys(DEAL_STAGE_REGISTRY) as DealStage[];

describe("canTransitionDealStage (9×9 全組合せ)", () => {
  it("全 81 通りが期待どおりに分類される", () => {
    let noopCount = 0;
    let invalidCount = 0;
    let needsReasonCount = 0;
    let okCount = 0;

    for (const from of ALL_STAGES) {
      for (const to of ALL_STAGES) {
        const result = canTransitionDealStage(from, to);
        if (from === to) {
          expect(result, `${from}→${to} は from===to のため noop`).toEqual({ kind: "noop" });
          noopCount++;
          continue;
        }
        if (from === "paid" || from === "lost") {
          expect(result, `${from}→${to} は終端 from のため invalid`).toEqual({ kind: "invalid" });
          invalidCount++;
          continue;
        }
        if (to === "lost") {
          expect(result, `${from}→${to} は to='lost' のため needs_reason`).toEqual({ kind: "needs_reason" });
          needsReasonCount++;
          continue;
        }
        expect(result, `${from}→${to} は ok`).toEqual({ kind: "ok" });
        okCount++;
      }
    }

    expect(noopCount).toBe(9);
    expect(invalidCount).toBe(16);
    expect(needsReasonCount).toBe(7);
    expect(okCount).toBe(49);
    expect(noopCount + invalidCount + needsReasonCount + okCount).toBe(81);
  });

  it("(paid,paid) / (lost,lost) は終端同士でも noop が最優先 (invalid にならない)", () => {
    expect(canTransitionDealStage("paid", "paid")).toEqual({ kind: "noop" });
    expect(canTransitionDealStage("lost", "lost")).toEqual({ kind: "noop" });
  });

  it("前方ジャンプ (inquiry → in_production) は ok (P10: 電話一本で即受注相当)", () => {
    expect(canTransitionDealStage("inquiry", "in_production")).toEqual({ kind: "ok" });
  });

  it("後退遷移 (quote_sent → estimating) は ok (P11: 誤操作訂正)", () => {
    expect(canTransitionDealStage("quote_sent", "estimating")).toEqual({ kind: "ok" });
  });

  it("非終端から lost への遷移は needs_reason (updateDealStage 経由は常に E602 — markDealLost 専用)", () => {
    for (const from of ALL_STAGES) {
      if (from === "paid" || from === "lost") continue;
      expect(canTransitionDealStage(from, "lost")).toEqual({ kind: "needs_reason" });
    }
  });
});

describe("shouldRecordWonAt (won_at 初到達判定 — §4.2 不変条件1)", () => {
  const wonStages: DealStage[] = ["ordered", "in_production", "delivered", "invoiced", "paid"];
  const nonWonStages: DealStage[] = ["inquiry", "estimating", "quote_sent", "lost"];

  it("isWon 系ステージへの初到達 (existingWonAt===null) は true を返す (全 5 ステージ)", () => {
    for (const stage of wonStages) {
      expect(shouldRecordWonAt(stage, null), `${stage}: won_at 初到達`).toBe(true);
    }
  });

  it("既に won_at が記録済みなら再 won でも false (以後不変)", () => {
    for (const stage of wonStages) {
      expect(shouldRecordWonAt(stage, "2026-01-01T00:00:00.000Z"), `${stage}: won_at 既存`).toBe(false);
    }
  });

  it("isWon でないステージへの遷移は既存 won_at の有無に関わらず false", () => {
    for (const stage of nonWonStages) {
      expect(shouldRecordWonAt(stage, null)).toBe(false);
      expect(shouldRecordWonAt(stage, "2026-01-01T00:00:00.000Z")).toBe(false);
    }
  });

  it("変則ジャンプ (inquiry → in_production) でも初到達なら true", () => {
    expect(shouldRecordWonAt("in_production", null)).toBe(true);
  });
});

describe("shouldPromoteLifecycleOnWin (lifecycle 自動昇格判定 — §4.2 不変条件2)", () => {
  it("won 系ステージへの遷移かつ lifecycle==='lead' なら true", () => {
    expect(shouldPromoteLifecycleOnWin("ordered", "lead")).toBe(true);
    expect(shouldPromoteLifecycleOnWin("paid", "lead")).toBe(true);
  });

  it("lifecycle が既に 'customer' または 'archived' なら昇格対象ではない (false)", () => {
    expect(shouldPromoteLifecycleOnWin("ordered", "customer")).toBe(false);
    expect(shouldPromoteLifecycleOnWin("ordered", "archived")).toBe(false);
  });

  it("isWon でないステージへの遷移は lead でも false", () => {
    expect(shouldPromoteLifecycleOnWin("estimating", "lead")).toBe(false);
    expect(shouldPromoteLifecycleOnWin("lost", "lead")).toBe(false);
  });

  it("won 系遷移のたびに冪等判定できる (「初到達時のみ」ではない — 何度呼んでも lead なら true)", () => {
    expect(shouldPromoteLifecycleOnWin("in_production", "lead")).toBe(true);
    expect(shouldPromoteLifecycleOnWin("delivered", "lead")).toBe(true);
    expect(shouldPromoteLifecycleOnWin("invoiced", "lead")).toBe(true);
  });
});
