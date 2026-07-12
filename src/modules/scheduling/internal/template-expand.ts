/**
 * 受注明細 → 作業ブロック原案の解決 (canonical: docs/design/crm-suite/03-scheduling.md §7.1)。
 * DB 非依存の純関数。呼び出し元 (repository/facade) が「アクティブな work_types」
 * 「アクティブな work_templates (+items)」を取得して渡す契約 (§7.1 冒頭)。
 * 本関数自身も defense-in-depth として is_active を再チェックする
 * (呼び出し元がフィルタし忘れても解決対象から漏れなく除外されるようにするため。
 *  §13.2 必須ケース「無効種別除外」はこの二重防御のどちらの層で検証してもよい設計)。
 *
 * 数量は乗算しない (P9 — quantity 列 + memo に記録するのみ。テンプレ時間は「1 案件分の
 * 段取り」であり数量比例しない、という §7.1 の裁定)。
 */

import type { GenerateBlocksInput } from "../contracts";

/** アクティブな work_types 一覧の要素 (repository が渡す — WorkTypeRow のサブセット + is_active) */
export type TemplateExpandWorkType = {
  id: string;
  key: string;
  label: string;
  default_hours: number | null;
  consumes_capacity: boolean;
  is_active: boolean;
};

/** アクティブな work_template の 1 明細 (work_type は repository が事前に JOIN 解決済み) */
export type TemplateExpandTemplateItem = {
  work_type_id: string;
  work_type_key: string;
  work_type_label: string;
  consumes_capacity: boolean;
  hours: number;
  sort_order: number;
};

/** アクティブな work_templates 一覧の要素 (items 込み。repository が渡す) */
export type TemplateExpandTemplate = {
  grade_key: string | null;
  size_key: string | null;
  is_active: boolean;
  items: TemplateExpandTemplateItem[];
};

/** ブロック原案 (INSERT 前。id はまだ無い — repository が work_blocks へ一括 INSERT する) */
export type BlockDraft = {
  work_type_id: string;
  title: string;
  planned_hours: number;
  consumes_capacity: boolean;
  quantity: number;
  memo: string | null;
};

export type SkippedLine = { description: string; reason: string };

export type TemplateExpandResult = { blocks: BlockDraft[]; skipped: SkippedLine[] };

const DESCRIPTION_TITLE_MAX = 40;

function titleFor(label: string, description: string): string {
  return `${label}: ${description.slice(0, DESCRIPTION_TITLE_MAX)}`;
}

/** §7.1 の 4 段カスケード (grade,size)→(grade,NULL)→(NULL,size)→(NULL,NULL)。最初に一致した 1 件を返す */
function resolveTemplate(
  templates: TemplateExpandTemplate[],
  gradeKey: string | null,
  sizeKey: string | null,
): TemplateExpandTemplate | null {
  const active = templates.filter((t) => t.is_active);
  const tiers: Array<[string | null, string | null]> = [
    [gradeKey, sizeKey],
    [gradeKey, null],
    [null, sizeKey],
    [null, null],
  ];
  for (const [g, s] of tiers) {
    const found = active.find((t) => t.grade_key === g && t.size_key === s);
    if (found) return found;
  }
  return null;
}

export function expandLinesToBlocks(
  lines: GenerateBlocksInput["lines"],
  activeWorkTypes: TemplateExpandWorkType[],
  activeWorkTemplates: TemplateExpandTemplate[],
): TemplateExpandResult {
  const workTypesByKey = new Map(
    activeWorkTypes.filter((t) => t.is_active).map((t) => [t.key, t]),
  );

  const blocks: BlockDraft[] = [];
  const skipped: SkippedLine[] = [];

  for (const line of lines) {
    if (line.work_type_key !== null) {
      // 1. work_type_key 直行 (§7.1 手順 1)
      const workType = workTypesByKey.get(line.work_type_key);
      if (!workType) {
        skipped.push({
          description: line.description,
          reason: `作業種別 '${line.work_type_key}' が見つからないか無効です`,
        });
        continue;
      }
      blocks.push({
        work_type_id: workType.id,
        title: titleFor(workType.label, line.description),
        planned_hours: workType.default_hours ?? 0,
        consumes_capacity: workType.consumes_capacity,
        quantity: line.quantity,
        memo: `数量 ${line.quantity}`,
      });
      continue;
    }

    // 2. テンプレートカスケード解決 (§7.1 手順 2)
    const template = resolveTemplate(activeWorkTemplates, line.grade_key, line.size_key);
    if (!template) {
      skipped.push({
        description: line.description,
        reason: `テンプレート未定義 (grade=${line.grade_key ?? "-"} × size=${line.size_key ?? "-"})`,
      });
      continue;
    }

    const items = [...template.items].sort((a, b) => a.sort_order - b.sort_order);
    for (const item of items) {
      blocks.push({
        work_type_id: item.work_type_id,
        title: titleFor(item.work_type_label, line.description),
        planned_hours: item.hours,
        consumes_capacity: item.consumes_capacity,
        quantity: line.quantity, // P9: 数量は乗算しない (item ごとに同じ line.quantity を記録するのみ)
        memo: `数量 ${line.quantity}`,
      });
    }
  }

  return { blocks, skipped };
}
