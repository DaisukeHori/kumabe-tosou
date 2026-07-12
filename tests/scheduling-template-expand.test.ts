import { describe, expect, it } from "vitest";

import { expandLinesToBlocks } from "@/modules/scheduling/internal/template-expand";
import type {
  TemplateExpandTemplate,
  TemplateExpandWorkType,
} from "@/modules/scheduling/internal/template-expand";
import type { GenerateBlocksInput } from "@/modules/scheduling/contracts";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §7.1 (テンプレート解決とブロック原案生成)。
 * §13.2 必須ケース (#3c-1 の受入基準): work_type_key 直行 / カスケード4段 / 無効種別除外 /
 * 数量非乗算 (P9) / 全滅→空blocks / 部分skip理由文言。
 * DB 接続不要の純関数テスト。
 */

type Line = GenerateBlocksInput["lines"][number];

function line(overrides: Partial<Line> = {}): Line {
  return {
    description: "テスト明細",
    work_type_key: null,
    quantity: 1,
    grade_key: null,
    size_key: null,
    ...overrides,
  };
}

function workType(overrides: Partial<TemplateExpandWorkType> = {}): TemplateExpandWorkType {
  return {
    id: "wt-sanding",
    key: "sanding",
    label: "研磨",
    default_hours: 3,
    consumes_capacity: true,
    is_active: true,
    ...overrides,
  };
}

const SANDING = workType();
const PRIMER = workType({
  id: "wt-primer",
  key: "primer",
  label: "下地",
  default_hours: 2,
  consumes_capacity: true,
});
const DRYING = workType({
  id: "wt-drying",
  key: "drying",
  label: "乾燥待ち",
  default_hours: 24,
  consumes_capacity: false,
});
const INACTIVE_TYPE = workType({
  id: "wt-inactive",
  key: "obsolete",
  label: "廃止済み",
  default_hours: 5,
  is_active: false,
});

function template(overrides: Partial<TemplateExpandTemplate> = {}): TemplateExpandTemplate {
  return {
    grade_key: null,
    size_key: null,
    is_active: true,
    items: [
      { work_type_id: SANDING.id, work_type_key: SANDING.key, work_type_label: SANDING.label,
        consumes_capacity: SANDING.consumes_capacity, hours: 3, sort_order: 10 },
      { work_type_id: PRIMER.id, work_type_key: PRIMER.key, work_type_label: PRIMER.label,
        consumes_capacity: PRIMER.consumes_capacity, hours: 2, sort_order: 20 },
    ],
    ...overrides,
  };
}

describe("expandLinesToBlocks (03-scheduling.md §7.1)", () => {
  it("work_type_key 直行: 種別一致で1ブロック、planned_hours = default_hours", () => {
    const result = expandLinesToBlocks(
      [line({ description: "研磨作業", work_type_key: "sanding", quantity: 2 })],
      [SANDING, PRIMER],
      [],
    );
    expect(result.skipped).toEqual([]);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toEqual({
      work_type_id: SANDING.id,
      title: "研磨: 研磨作業",
      planned_hours: 3,
      consumes_capacity: true,
      quantity: 2,
      memo: "数量 2",
    });
  });

  it("work_type_key 直行: default_hours が null なら planned_hours は 0 (?? 0 の裁定)", () => {
    const noDefault = workType({ id: "wt-no-default", key: "noop", default_hours: null });
    const result = expandLinesToBlocks(
      [line({ work_type_key: "noop" })],
      [noDefault],
      [],
    );
    expect(result.skipped).toEqual([]);
    expect(result.blocks[0].planned_hours).toBe(0);
  });

  it("title は description を先頭40字にトリムする", () => {
    const longDescription = "あ".repeat(60);
    const result = expandLinesToBlocks(
      [line({ description: longDescription, work_type_key: "sanding" })],
      [SANDING],
      [],
    );
    expect(result.blocks[0].title).toBe(`研磨: ${"あ".repeat(40)}`);
  });

  it("カスケード4段: (grade,size) 完全一致が最優先", () => {
    const exact = template({ grade_key: "premium", size_key: "s" });
    const gradeOnly = template({ grade_key: "premium", size_key: null });
    const sizeOnly = template({ grade_key: null, size_key: "s" });
    const wildcard = template({ grade_key: null, size_key: null });
    const result = expandLinesToBlocks(
      [line({ grade_key: "premium", size_key: "s" })],
      [SANDING, PRIMER],
      [wildcard, sizeOnly, gradeOnly, exact],
    );
    expect(result.skipped).toEqual([]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.map((b) => b.work_type_id)).toEqual([SANDING.id, PRIMER.id]);
  });

  it("カスケード4段: 完全一致なしなら (grade,NULL) にフォールバック", () => {
    const gradeOnly = template({ grade_key: "premium", size_key: null });
    const result = expandLinesToBlocks(
      [line({ grade_key: "premium", size_key: "s" })],
      [SANDING, PRIMER],
      [gradeOnly],
    );
    expect(result.skipped).toEqual([]);
    expect(result.blocks).toHaveLength(2);
  });

  it("カスケード4段: (grade,NULL) もなければ (NULL,size) にフォールバック", () => {
    const sizeOnly = template({ grade_key: null, size_key: "s" });
    const result = expandLinesToBlocks(
      [line({ grade_key: "premium", size_key: "s" })],
      [SANDING, PRIMER],
      [sizeOnly],
    );
    expect(result.skipped).toEqual([]);
    expect(result.blocks).toHaveLength(2);
  });

  it("カスケード4段: 最終フォールバックは (NULL,NULL) のワイルドカードテンプレ", () => {
    const wildcard = template({ grade_key: null, size_key: null });
    const result = expandLinesToBlocks(
      [line({ grade_key: "premium", size_key: "s" })],
      [SANDING, PRIMER],
      [wildcard],
    );
    expect(result.skipped).toEqual([]);
    expect(result.blocks).toHaveLength(2);
  });

  it("無効種別除外: work_type_key 直行で is_active=false の種別はスキップされる (skip 理由文言つき)", () => {
    const result = expandLinesToBlocks(
      [line({ description: "廃止対象", work_type_key: "obsolete" })],
      [INACTIVE_TYPE],
      [],
    );
    expect(result.blocks).toEqual([]);
    expect(result.skipped).toEqual([
      { description: "廃止対象", reason: "作業種別 'obsolete' が見つからないか無効です" },
    ]);
  });

  it("無効種別除外: is_active=false のテンプレートはカスケード解決の対象外になる", () => {
    const inactiveExact = template({ grade_key: "premium", size_key: "s", is_active: false });
    const result = expandLinesToBlocks(
      [line({ description: "無効テンプレ対象", grade_key: "premium", size_key: "s" })],
      [SANDING, PRIMER],
      [inactiveExact],
    );
    expect(result.blocks).toEqual([]);
    expect(result.skipped).toEqual([
      {
        description: "無効テンプレ対象",
        reason: "テンプレート未定義 (grade=premium × size=s)",
      },
    ]);
  });

  it("数量非乗算 (P9): quantity=3 でもテンプレの各アイテム時間はそのまま (乗算しない)。quantity 列とmemoに記録", () => {
    const wildcard = template({ grade_key: null, size_key: null });
    const result = expandLinesToBlocks(
      [line({ quantity: 3 })],
      [SANDING, PRIMER],
      [wildcard],
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].planned_hours).toBe(3); // SANDING item.hours (乗算前と同じ)
    expect(result.blocks[1].planned_hours).toBe(2); // PRIMER item.hours
    for (const block of result.blocks) {
      expect(block.quantity).toBe(3);
      expect(block.memo).toBe("数量 3");
    }
  });

  it("数量非乗算 (P9): work_type_key 直行でも quantity は乗算されない", () => {
    const result = expandLinesToBlocks(
      [line({ work_type_key: "sanding", quantity: 5 })],
      [SANDING],
      [],
    );
    expect(result.blocks[0].planned_hours).toBe(3); // default_hours のまま (5倍されない)
    expect(result.blocks[0].quantity).toBe(5);
  });

  it("全滅→空blocks: すべての行が解決不能なら blocks は空で skipped のみ返す", () => {
    const result = expandLinesToBlocks(
      [
        line({ description: "行1", work_type_key: "unknown" }),
        line({ description: "行2", grade_key: "nope", size_key: "nope" }),
      ],
      [SANDING],
      [],
    );
    expect(result.blocks).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].reason).toBe("作業種別 'unknown' が見つからないか無効です");
    expect(result.skipped[1].reason).toBe("テンプレート未定義 (grade=nope × size=nope)");
  });

  it("部分skip理由文言: 一部の行のみ解決不能なら該当行だけ skipped に理由文言つきで積まれ、他行は blocks 化される", () => {
    // テンプレートを一切渡さない (ワイルドカード (NULL,NULL) を含めると全行がそれにフォール
    // バックして「解決できない」状況を作れなくなるため — カスケード4段テストとは別の意図)。
    const result = expandLinesToBlocks(
      [
        line({ description: "解決できる行", work_type_key: "sanding", quantity: 1 }),
        line({ description: "解決できない行(種別)", work_type_key: "unknown" }),
        line({ description: "解決できない行(テンプレ)", grade_key: "x", size_key: "y" }),
      ],
      [SANDING],
      [],
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].work_type_id).toBe(SANDING.id);
    expect(result.skipped).toEqual([
      { description: "解決できない行(種別)", reason: "作業種別 'unknown' が見つからないか無効です" },
      {
        description: "解決できない行(テンプレ)",
        reason: "テンプレート未定義 (grade=x × size=y)",
      },
    ]);
  });

  it("grade/size が両方 null の行の理由文言はハイフン表記になる", () => {
    const result = expandLinesToBlocks(
      [line({ description: "無テンプレ" })],
      [SANDING],
      [],
    );
    expect(result.skipped).toEqual([
      { description: "無テンプレ", reason: "テンプレート未定義 (grade=- × size=-)" },
    ]);
  });

  it("テンプレート展開は items の sort_order 順になる (逆順で渡しても並べ替える)", () => {
    const reversedItems = template({
      items: [
        { work_type_id: PRIMER.id, work_type_key: PRIMER.key, work_type_label: PRIMER.label,
          consumes_capacity: PRIMER.consumes_capacity, hours: 2, sort_order: 20 },
        { work_type_id: SANDING.id, work_type_key: SANDING.key, work_type_label: SANDING.label,
          consumes_capacity: SANDING.consumes_capacity, hours: 3, sort_order: 10 },
      ],
    });
    const result = expandLinesToBlocks([line()], [SANDING, PRIMER], [reversedItems]);
    expect(result.blocks.map((b) => b.work_type_id)).toEqual([SANDING.id, PRIMER.id]);
  });

  it("非拘束種別 (consumes_capacity=false) のブロックはそのままスナップショットされる (乾燥待ち)", () => {
    const dryingTemplate = template({
      items: [
        { work_type_id: DRYING.id, work_type_key: DRYING.key, work_type_label: DRYING.label,
          consumes_capacity: DRYING.consumes_capacity, hours: 24, sort_order: 10 },
      ],
    });
    const result = expandLinesToBlocks([line()], [DRYING], [dryingTemplate]);
    expect(result.blocks[0].consumes_capacity).toBe(false);
  });

  it("複数行を渡した場合、行の順序どおりに blocks/skipped が積まれる", () => {
    const result = expandLinesToBlocks(
      [
        line({ description: "1行目", work_type_key: "sanding" }),
        line({ description: "2行目", work_type_key: "primer" }),
      ],
      [SANDING, PRIMER],
      [],
    );
    expect(result.blocks.map((b) => b.title)).toEqual(["研磨: 1行目", "下地: 2行目"]);
  });
});
