import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: 実装計画書 issue-61.md 成果物1/8 (00-overview §4.1 手順5〜6、§2.3、07-contracts-delta §7.7)。
 *
 * generateBlocksAction (src/app/admin/documents/actions.ts) は
 * SalesFacade.getDocumentLinesForBlocks (#50) → SchedulingFacade.generateBlocksFromLines (#52) を
 * app 層で合成する Server Action。sales⇄scheduling の相互 import はモジュール境界違反のため、
 * この種の合成は app 層からのみ許可される (00-overview §2.3)。
 *
 * tests/shop-lead-route.test.ts / tests/calls-actions.test.ts の確立パターン
 * (next/cache・platformFacade.requireAdmin・facade 群を vi.mock で最小フェイクに差し替え、
 * actions.ts のロジックのみ検証) を踏襲する。createSalesFacade/createSchedulingFacade は
 * ファクトリ関数のため、shop-lead-route.test.ts の
 * `vi.mock("@/modules/sales/facade", () => ({ createSalesFacade: () => ({...}) }))` パターンを使う。
 * 実 DB には一切触れない。
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

// generateBlocksAction 自体は crmFacade を呼ばないが、documents/actions.ts はモジュール先頭で
// crmFacade を import している (issueDocumentAction 等の他 Action が使う) ため、実モジュールを
// 読み込ませないようここでも最小モックに差し替える (shop-lead-route.test.ts と同じ理由付け)。
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    getDealRef: vi.fn(),
    updateDealStage: vi.fn(),
  },
}));

const getDocumentLinesForBlocksMock = vi.fn();
vi.mock("@/modules/sales/facade", () => ({
  createSalesFacade: () => ({
    getDocumentLinesForBlocks: (...args: unknown[]) => getDocumentLinesForBlocksMock(...args),
  }),
  // computeVersionDiff は generateBlocksAction では未使用 (computeVersionDiffAction 専用) だが、
  // 同一ファイル内の他 export の静的 import 解決のためダミーを供給しておく。
  computeVersionDiff: vi.fn(),
}));

const countBlocksBySourceDocumentMock = vi.fn();
const generateBlocksFromLinesMock = vi.fn();
vi.mock("@/modules/scheduling/facade", () => ({
  createSchedulingFacade: () => ({
    countBlocksBySourceDocument: (...args: unknown[]) => countBlocksBySourceDocumentMock(...args),
    generateBlocksFromLines: (...args: unknown[]) => generateBlocksFromLinesMock(...args),
  }),
}));

import { generateBlocksAction } from "@/app/admin/documents/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
// zod z.string().uuid() は third group が [1-8]、fourth group が [89abAB] 始まりを要求する
// (tests/calls-actions.test.ts の既存コメントと同じ実測に基づく形式)。
const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";
const DEAL_ID = "66666666-6666-4666-8666-666666666666";

const SAMPLE_LINES = [
  { description: "アクリルキーホルダー", work_type_key: "cutting", quantity: 10, grade_key: "standard", size_key: "m" },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
  countBlocksBySourceDocumentMock.mockResolvedValue({ ok: true, value: { count: 0 } });
  getDocumentLinesForBlocksMock.mockResolvedValue({ ok: true, value: SAMPLE_LINES });
  generateBlocksFromLinesMock.mockResolvedValue({
    ok: true,
    value: { block_ids: ["block-1"], skipped: [] },
  });
});

describe("generateBlocksAction — admin gating / Zod validation", () => {
  it("requireAdmin が失敗した場合はそのまま返し、いずれの facade も呼ばない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(countBlocksBySourceDocumentMock).not.toHaveBeenCalled();
    expect(getDocumentLinesForBlocksMock).not.toHaveBeenCalled();
    expect(generateBlocksFromLinesMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("documentId が uuid でない場合は KMB-E101 を返し facade を呼ばない", async () => {
    const result = await generateBlocksAction("not-a-uuid", DEAL_ID, false);

    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: expect.any(String) });
    expect(countBlocksBySourceDocumentMock).not.toHaveBeenCalled();
    expect(getDocumentLinesForBlocksMock).not.toHaveBeenCalled();
  });

  it("dealId が uuid でない場合も KMB-E101 を返し facade を呼ばない", async () => {
    const result = await generateBlocksAction(DOCUMENT_ID, "not-a-uuid", false);

    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: expect.any(String) });
    expect(countBlocksBySourceDocumentMock).not.toHaveBeenCalled();
    expect(getDocumentLinesForBlocksMock).not.toHaveBeenCalled();
  });
});

describe("generateBlocksAction — 合成順序 (countBlocksBySourceDocument → getDocumentLinesForBlocks → generateBlocksFromLines)", () => {
  it("confirmed=false かつ既存件数0件のときは3段すべてをこの順で1回ずつ呼び、成功時に revalidatePath する", async () => {
    const callOrder: string[] = [];
    countBlocksBySourceDocumentMock.mockImplementationOnce(async () => {
      callOrder.push("countBlocksBySourceDocument");
      return { ok: true, value: { count: 0 } };
    });
    getDocumentLinesForBlocksMock.mockImplementationOnce(async () => {
      callOrder.push("getDocumentLinesForBlocks");
      return { ok: true, value: SAMPLE_LINES };
    });
    generateBlocksFromLinesMock.mockImplementationOnce(async () => {
      callOrder.push("generateBlocksFromLines");
      return { ok: true, value: { block_ids: ["block-1"], skipped: [] } };
    });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({
      ok: true,
      value: { status: "done", block_ids: ["block-1"], skipped: [] },
    });
    expect(callOrder).toEqual([
      "countBlocksBySourceDocument",
      "getDocumentLinesForBlocks",
      "generateBlocksFromLines",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/documents");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/documents/${DOCUMENT_ID}`);
  });

  it("getDocumentLinesForBlocks には documentId のみを渡す", async () => {
    await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);
    expect(getDocumentLinesForBlocksMock).toHaveBeenCalledWith(DOCUMENT_ID);
  });

  it("generateBlocksFromLines には deal_id/source_document_id/lines を渡す", async () => {
    await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);
    expect(generateBlocksFromLinesMock).toHaveBeenCalledWith({
      deal_id: DEAL_ID,
      source_document_id: DOCUMENT_ID,
      lines: SAMPLE_LINES,
    });
  });
});

describe("generateBlocksAction — 二重実行ガード (confirmed フラグ)", () => {
  it("confirmed=false かつ既存件数≥1件なら confirm_required を返し、以降の facade を一切呼ばない", async () => {
    countBlocksBySourceDocumentMock.mockResolvedValue({ ok: true, value: { count: 3 } });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({ ok: true, value: { status: "confirm_required", existingCount: 3 } });
    expect(getDocumentLinesForBlocksMock).not.toHaveBeenCalled();
    expect(generateBlocksFromLinesMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("confirmed=true のときは countBlocksBySourceDocument を再確認せず即座に生成する (確認ダイアログで一度提示済みのため)", async () => {
    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, true);

    expect(countBlocksBySourceDocumentMock).not.toHaveBeenCalled();
    expect(getDocumentLinesForBlocksMock).toHaveBeenCalledTimes(1);
    expect(generateBlocksFromLinesMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  // 敵対レビュー MAJOR 回帰テスト: 初回チェック (count=0) → getDocumentLinesForBlocks の間に
  // 別セッションが同一 source_document_id へ生成を完了させた場合 (TOCTOU レース) を、
  // getDocumentLinesForBlocks 完了直後・generateBlocksFromLines 直前の再検証で検知できること。
  it("confirmed=false で初回チェック通過後、getDocumentLinesForBlocks の間に別セッションが生成済みになった場合は再検証で検知し confirm_required を返して generateBlocksFromLines を呼ばない", async () => {
    countBlocksBySourceDocumentMock
      .mockResolvedValueOnce({ ok: true, value: { count: 0 } })
      .mockResolvedValueOnce({ ok: true, value: { count: 1 } });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({ ok: true, value: { status: "confirm_required", existingCount: 1 } });
    expect(countBlocksBySourceDocumentMock).toHaveBeenCalledTimes(2);
    expect(getDocumentLinesForBlocksMock).toHaveBeenCalledTimes(1);
    expect(generateBlocksFromLinesMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("generateBlocksAction — エラー伝播 (握り潰さない)", () => {
  it("countBlocksBySourceDocument 自体の失敗 (E901等) はそのまま伝播し、後続の facade を呼ばない", async () => {
    countBlocksBySourceDocumentMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
    expect(getDocumentLinesForBlocksMock).not.toHaveBeenCalled();
    expect(generateBlocksFromLinesMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("getDocumentLinesForBlocks の失敗 (E621/E623等) はそのまま伝播し、generateBlocksFromLines を呼ばない", async () => {
    getDocumentLinesForBlocksMock.mockResolvedValue({ ok: false, code: "KMB-E623", detail: "doc_type不正" });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({ ok: false, code: "KMB-E623", detail: "doc_type不正" });
    expect(generateBlocksFromLinesMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("generateBlocksFromLines の全滅 (KMB-E704) はそのまま伝播し revalidatePath しない (呼び出し元UIが既存文言を表示する)", async () => {
    generateBlocksFromLinesMock.mockResolvedValue({
      ok: false,
      code: "KMB-E704",
      detail: "全明細が work_type_key 解決不能",
    });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({ ok: false, code: "KMB-E704", detail: "全明細が work_type_key 解決不能" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("generateBlocksAction — 部分 skip の透過", () => {
  it("一部明細が work_type_key 解決不能でも部分生成は成立し、skipped をそのまま返す", async () => {
    generateBlocksFromLinesMock.mockResolvedValue({
      ok: true,
      value: {
        block_ids: ["block-1", "block-2"],
        skipped: [{ description: "不明な作業", reason: "work_type_key 解決不能" }],
      },
    });

    const result = await generateBlocksAction(DOCUMENT_ID, DEAL_ID, false);

    expect(result).toEqual({
      ok: true,
      value: {
        status: "done",
        block_ids: ["block-1", "block-2"],
        skipped: [{ description: "不明な作業", reason: "work_type_key 解決不能" }],
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/calendar");
  });
});
