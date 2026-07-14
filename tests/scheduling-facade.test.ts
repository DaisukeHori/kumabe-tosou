import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §6.1 (契約メソッド) / §6.2 (契約外拡張)。
 * scheduling/facade.ts (createSchedulingFacade) の単体テスト。repository.ts をモックし、
 * 実 DB には接続しない (distribution-facade-schedule-posts.test.ts / ai-providers-router.test.ts
 * と同型の precedent — repository の型付き例外 (OptimisticLockError/UniqueViolationError/
 * ForeignKeyViolationError) は実体を importActual で残し、facade の catch 分岐を検証する)。
 *
 * 対象 (Issue #52 実装分のみ): generateBlocksFromLines / saveWorkType (楽観排他・key重複) /
 * deleteWorkType (E702) / saveWorkTemplate (combo重複・work_type_key解決不能) /
 * deleteWorkTemplate (E702) / listWorkTypes・listWorkTemplates (パススルー)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const listActiveWorkTypesForExpandMock = vi.fn();
const listActiveWorkTemplatesForExpandMock = vi.fn();
const insertWorkBlocksMock = vi.fn();
const listWorkTypesMock = vi.fn();
const upsertWorkTypeMock = vi.fn();
const deleteWorkTypeMock = vi.fn();
const listWorkTemplatesMock = vi.fn();
const upsertWorkTemplateMock = vi.fn();
const deleteWorkTemplateMock = vi.fn();
const getWorkTypeSnapshotMock = vi.fn();
const insertWorkBlockMock = vi.fn();
const getWorkBlockByIdMock = vi.fn();
const updateWorkBlockDetailMock = vi.fn();

vi.mock("@/modules/scheduling/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/scheduling/repository")>();
  return {
    ...actual,
    listActiveWorkTypesForExpand: (...args: unknown[]) => listActiveWorkTypesForExpandMock(...args),
    listActiveWorkTemplatesForExpand: (...args: unknown[]) => listActiveWorkTemplatesForExpandMock(...args),
    insertWorkBlocks: (...args: unknown[]) => insertWorkBlocksMock(...args),
    listWorkTypes: (...args: unknown[]) => listWorkTypesMock(...args),
    upsertWorkType: (...args: unknown[]) => upsertWorkTypeMock(...args),
    deleteWorkType: (...args: unknown[]) => deleteWorkTypeMock(...args),
    listWorkTemplates: (...args: unknown[]) => listWorkTemplatesMock(...args),
    upsertWorkTemplate: (...args: unknown[]) => upsertWorkTemplateMock(...args),
    deleteWorkTemplate: (...args: unknown[]) => deleteWorkTemplateMock(...args),
    getWorkTypeSnapshot: (...args: unknown[]) => getWorkTypeSnapshotMock(...args),
    insertWorkBlock: (...args: unknown[]) => insertWorkBlockMock(...args),
    getWorkBlockById: (...args: unknown[]) => getWorkBlockByIdMock(...args),
    updateWorkBlockDetail: (...args: unknown[]) => updateWorkBlockDetailMock(...args),
  };
});

import { createSchedulingFacade } from "@/modules/scheduling/facade";
import {
  ForeignKeyViolationError,
  OptimisticLockError,
  UniqueViolationError,
} from "@/modules/scheduling/repository";

const WORK_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-a222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-b333-333333333333";

function activeWorkType() {
  return {
    id: WORK_TYPE_ID,
    key: "sanding",
    label: "研磨",
    default_hours: 3,
    consumes_capacity: true,
    is_active: true,
  };
}

function genBlocksInput() {
  return {
    deal_id: DEAL_ID,
    source_document_id: DOCUMENT_ID,
    lines: [
      { description: "研磨作業", work_type_key: "sanding", quantity: 1, grade_key: null, size_key: null },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
});

describe("createSchedulingFacade().generateBlocksFromLines", () => {
  it("Zod parse 失敗 (deal_id が uuid でない) は KMB-E101 を返す", async () => {
    const facade = createSchedulingFacade();
    const result = await facade.generateBlocksFromLines({
      ...genBlocksInput(),
      deal_id: "not-a-uuid",
    } as unknown as Parameters<typeof facade.generateBlocksFromLines>[0]);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(listActiveWorkTypesForExpandMock).not.toHaveBeenCalled();
  });

  it("全滅 (全行 skip) のときは KMB-E704 を返し、work_blocks への INSERT は行わない", async () => {
    listActiveWorkTypesForExpandMock.mockResolvedValue([]); // sanding が存在しない扱い
    listActiveWorkTemplatesForExpandMock.mockResolvedValue([]);
    const facade = createSchedulingFacade();
    const result = await facade.generateBlocksFromLines(genBlocksInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E704");
    }
    expect(insertWorkBlocksMock).not.toHaveBeenCalled();
  });

  it("部分成功 (blocks 非空) は成功として blocks + skipped を返す (E704 にしない)", async () => {
    listActiveWorkTypesForExpandMock.mockResolvedValue([activeWorkType()]);
    listActiveWorkTemplatesForExpandMock.mockResolvedValue([]);
    insertWorkBlocksMock.mockResolvedValue(["block-1"]);
    const facade = createSchedulingFacade();
    const result = await facade.generateBlocksFromLines({
      ...genBlocksInput(),
      lines: [
        { description: "解決できる行", work_type_key: "sanding", quantity: 1, grade_key: null, size_key: null },
        { description: "解決できない行", work_type_key: "unknown", quantity: 1, grade_key: null, size_key: null },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.block_ids).toEqual(["block-1"]);
      expect(result.value.skipped).toEqual([
        { description: "解決できない行", reason: "作業種別 'unknown' が見つからないか無効です" },
      ]);
    }
    expect(insertWorkBlocksMock).toHaveBeenCalledWith(
      DEAL_ID,
      DOCUMENT_ID,
      expect.any(Array),
      "user-1",
    );
  });

  it("insertWorkBlocks が FK 違反を投げたら KMB-E702 に変換する (deal/種別の参照不整合)", async () => {
    listActiveWorkTypesForExpandMock.mockResolvedValue([activeWorkType()]);
    listActiveWorkTemplatesForExpandMock.mockResolvedValue([]);
    insertWorkBlocksMock.mockRejectedValue(new ForeignKeyViolationError("fk violation"));
    const facade = createSchedulingFacade();
    const result = await facade.generateBlocksFromLines(genBlocksInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E702" }));
  });

  it("想定外の例外は KMB-E901 に変換する", async () => {
    listActiveWorkTypesForExpandMock.mockRejectedValue(new Error("db down"));
    const facade = createSchedulingFacade();
    const result = await facade.generateBlocksFromLines(genBlocksInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });
});

describe("createSchedulingFacade().saveWorkType", () => {
  function workTypeInput() {
    return {
      key: "sanding",
      label: "研磨",
      color: "#8d6e63",
      consumes_capacity: true,
      default_hours: 3,
      sort_order: 10,
      is_active: true,
    };
  }

  it("Zod parse 失敗は KMB-E101 を返す", async () => {
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkType(
      { ...workTypeInput(), color: "not-a-hex-color" },
      null,
      null,
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(upsertWorkTypeMock).not.toHaveBeenCalled();
  });

  it("楽観排他違反 (OptimisticLockError) は KMB-E103 を返す", async () => {
    upsertWorkTypeMock.mockRejectedValue(new OptimisticLockError());
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkType(workTypeInput(), WORK_TYPE_ID, "2026-01-01T00:00:00.000Z");
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E103" }));
  });

  it("key 重複 (UniqueViolationError) は KMB-E101 (detail: 'key が重複しています') を返す", async () => {
    upsertWorkTypeMock.mockRejectedValue(new UniqueViolationError("duplicate key"));
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkType(workTypeInput(), null, null);
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "KMB-E101", detail: "key が重複しています" }),
    );
  });

  it("正常系: 新規作成成功で work_type_id を返す", async () => {
    upsertWorkTypeMock.mockResolvedValue({ id: WORK_TYPE_ID, updated_at: "2026-01-01T00:00:00.000Z" });
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkType(workTypeInput(), null, null);
    expect(result).toEqual({ ok: true, value: { work_type_id: WORK_TYPE_ID } });
  });
});

describe("createSchedulingFacade().deleteWorkType", () => {
  it("参照中 (FK違反) の削除は KMB-E702 を返す", async () => {
    deleteWorkTypeMock.mockRejectedValue(new ForeignKeyViolationError("referenced by work_template_items"));
    const facade = createSchedulingFacade();
    const result = await facade.deleteWorkType(WORK_TYPE_ID);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E702" }));
  });

  it("正常系: 削除成功で ok:true を返す", async () => {
    deleteWorkTypeMock.mockResolvedValue(undefined);
    const facade = createSchedulingFacade();
    const result = await facade.deleteWorkType(WORK_TYPE_ID);
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe("createSchedulingFacade().saveWorkTemplate", () => {
  function templateInput() {
    return {
      name: "標準",
      grade_key: "premium",
      size_key: "s",
      is_active: true,
      items: [{ work_type_key: "sanding", hours: 3, sort_order: 10 }],
    };
  }

  it("アクティブ combo 重複 (UniqueViolationError) は KMB-E101 を返す", async () => {
    upsertWorkTemplateMock.mockRejectedValue(new UniqueViolationError("duplicate combo"));
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkTemplate(templateInput(), null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toContain("グレード");
    }
  });

  it("work_type_key 解決不能 (ForeignKeyViolationError) は KMB-E702 を返す", async () => {
    upsertWorkTemplateMock.mockRejectedValue(new ForeignKeyViolationError("work_type_key not found"));
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkTemplate(templateInput(), null, null);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E702" }));
  });

  it("楽観排他違反は KMB-E103 を返す", async () => {
    upsertWorkTemplateMock.mockRejectedValue(new OptimisticLockError());
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkTemplate(
      templateInput(),
      "template-1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E103" }));
  });

  it("items が空配列 (min(1) 違反) は Zod parse 失敗として KMB-E101 を返す", async () => {
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkTemplate({ ...templateInput(), items: [] }, null, null);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(upsertWorkTemplateMock).not.toHaveBeenCalled();
  });

  it("正常系: 保存成功で template_id を返す", async () => {
    upsertWorkTemplateMock.mockResolvedValue({ id: "template-1", updated_at: "2026-01-01T00:00:00.000Z" });
    const facade = createSchedulingFacade();
    const result = await facade.saveWorkTemplate(templateInput(), null, null);
    expect(result).toEqual({ ok: true, value: { template_id: "template-1" } });
  });
});

describe("createSchedulingFacade().deleteWorkTemplate", () => {
  it("FK違反は KMB-E702 を返す", async () => {
    deleteWorkTemplateMock.mockRejectedValue(new ForeignKeyViolationError("referenced"));
    const facade = createSchedulingFacade();
    const result = await facade.deleteWorkTemplate("template-1");
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E702" }));
  });

  it("正常系: 削除成功で ok:true を返す", async () => {
    deleteWorkTemplateMock.mockResolvedValue(undefined);
    const facade = createSchedulingFacade();
    const result = await facade.deleteWorkTemplate("template-1");
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe("createSchedulingFacade().createBlock", () => {
  function blockInput() {
    return {
      deal_id: DEAL_ID,
      work_type_id: WORK_TYPE_ID,
      title: "研磨",
      starts_at: null,
      ends_at: null,
      planned_hours: 3,
      memo: null,
    };
  }

  it("work_type が不在または無効化済み (repository が null を返す) 場合は KMB-E702 を返す", async () => {
    // getWorkTypeSnapshot は repository 側で is_active=true も条件に含める (03-scheduling.md
    // §6.2 createBlock コメント「E702 (work_type 不在・無効)」) — ここでは null 返却として
    // その挙動 (不在/無効いずれも facade が KMB-E702 に変換する) を検証する。
    getWorkTypeSnapshotMock.mockResolvedValue(null);
    const facade = createSchedulingFacade();
    const result = await facade.createBlock(blockInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E702" }));
    expect(insertWorkBlockMock).not.toHaveBeenCalled();
  });

  it("正常系: consumes_capacity をスナップショットして作成し block_id を返す", async () => {
    getWorkTypeSnapshotMock.mockResolvedValue({ consumes_capacity: true });
    insertWorkBlockMock.mockResolvedValue({ id: "block-1", updated_at: "2026-01-01T00:00:00.000Z" });
    const facade = createSchedulingFacade();
    const result = await facade.createBlock(blockInput());
    expect(result).toEqual({ ok: true, value: { block_id: "block-1" } });
    expect(insertWorkBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ consumes_capacity: true }),
    );
  });
});

describe("createSchedulingFacade().updateBlock", () => {
  function updateInput() {
    return {
      work_type_id: WORK_TYPE_ID,
      title: "研磨",
      planned_hours: 3,
      memo: null,
      deal_id: DEAL_ID,
    };
  }

  function currentBlock(status: "scheduled" | "done" = "scheduled") {
    return {
      id: "block-1",
      deal_id: DEAL_ID,
      source_document_id: null,
      work_type_id: WORK_TYPE_ID,
      title: "研磨",
      status,
      starts_at: "2026-01-05T00:00:00.000Z",
      ends_at: "2026-01-05T03:00:00.000Z",
      planned_hours: 3,
      actual_hours: null,
      performed_on: null,
      consumes_capacity: true,
      quantity: null,
      memo: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      work_types: { key: "sanding", label: "研磨", color: "#8d6e63" },
    };
  }

  it("done への編集は KMB-E703 を返す (repository へは到達しない)", async () => {
    getWorkBlockByIdMock.mockResolvedValue(currentBlock("done"));
    const facade = createSchedulingFacade();
    const result = await facade.updateBlock("block-1", updateInput(), "2026-01-01T00:00:00.000Z");
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E703" }));
    expect(updateWorkBlockDetailMock).not.toHaveBeenCalled();
  });

  it("変更先 work_type_id が不在または無効化済み (ForeignKeyViolationError) は KMB-E702 を返す", async () => {
    // repository (updateWorkBlockDetail) 側の work_types SELECT が is_active=true も条件に含め、
    // 見つからない場合 ForeignKeyViolationError を投げる契約 — facade はそれを KMB-E702 に変換する。
    getWorkBlockByIdMock.mockResolvedValue(currentBlock());
    updateWorkBlockDetailMock.mockRejectedValue(
      new ForeignKeyViolationError("work_type_id ... が見つからないか無効です"),
    );
    const facade = createSchedulingFacade();
    const result = await facade.updateBlock("block-1", updateInput(), "2026-01-01T00:00:00.000Z");
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E702" }));
  });

  it("正常系: 更新成功で ok:true を返す", async () => {
    getWorkBlockByIdMock.mockResolvedValue(currentBlock());
    updateWorkBlockDetailMock.mockResolvedValue({ updated_at: "2026-01-02T00:00:00.000Z" });
    const facade = createSchedulingFacade();
    const result = await facade.updateBlock("block-1", updateInput(), "2026-01-01T00:00:00.000Z");
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe("createSchedulingFacade() 読み取り系のパススルー", () => {
  it("listWorkTypes は repository の戻り値をそのまま Result でラップする", async () => {
    listWorkTypesMock.mockResolvedValue([{ id: WORK_TYPE_ID, key: "sanding" }]);
    const facade = createSchedulingFacade();
    const result = await facade.listWorkTypes(true);
    expect(listWorkTypesMock).toHaveBeenCalledWith(true);
    expect(result).toEqual({ ok: true, value: [{ id: WORK_TYPE_ID, key: "sanding" }] });
  });

  it("listWorkTypes は includeInactive 省略時 false で repository を呼ぶ", async () => {
    listWorkTypesMock.mockResolvedValue([]);
    const facade = createSchedulingFacade();
    await facade.listWorkTypes();
    expect(listWorkTypesMock).toHaveBeenCalledWith(false);
  });

  it("listWorkTemplates は repository の戻り値をそのまま Result でラップする", async () => {
    listWorkTemplatesMock.mockResolvedValue([{ id: "template-1", items: [] }]);
    const facade = createSchedulingFacade();
    const result = await facade.listWorkTemplates(true);
    expect(result).toEqual({ ok: true, value: [{ id: "template-1", items: [] }] });
  });

  it("repository が例外を投げたら listWorkTypes は KMB-E901 を返す (エラーの無言変換禁止)", async () => {
    listWorkTypesMock.mockRejectedValue(new Error("connection lost"));
    const facade = createSchedulingFacade();
    const result = await facade.listWorkTypes();
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });
});
