import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DealDocumentsCard } from "@/app/admin/deals/[id]/DealDocumentsCard";
import type { DocumentListItem } from "@/modules/sales/contracts";

/**
 * Issue #96 §C-左3: 案件詳細ページの帳票カード実配線。純粋な Server Component (hook 不使用) の
 * ため createElement + renderToStaticMarkup で直接テストできる。Result を握り潰していないこと
 * (失敗時に code+detail を表示すること) を主眼に検証する。
 */
const DEAL_ID = "66666666-6666-4666-8666-666666666666";

function makeDoc(overrides: Partial<DocumentListItem> = {}): DocumentListItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    doc_type: "order",
    status: "issued",
    doc_no: "ORD-0001",
    billing_name: "テスト太郎",
    deal_id: DEAL_ID,
    deal_title: "テスト案件",
    total_jpy: 12345,
    issue_date: "2026-07-01",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    source_document_id: null,
    ...overrides,
  };
}

describe("DealDocumentsCard", () => {
  it("失敗時は code/detail を表示し、空配列へ無言変換しない", () => {
    const html = renderToStaticMarkup(
      createElement(DealDocumentsCard, {
        dealId: DEAL_ID,
        documentsResult: { ok: false, code: "KMB-E901", detail: "db down" },
      }),
    );
    expect(html).toContain("KMB-E901");
    expect(html).toContain("db down");
    expect(html).toContain("取得に失敗しました");
  });

  it("0件時は空状態文言と新規帳票リンクを出す", () => {
    const html = renderToStaticMarkup(
      createElement(DealDocumentsCard, {
        dealId: DEAL_ID,
        documentsResult: { ok: true, value: { items: [], next_cursor: null } },
      }),
    );
    expect(html).toContain("まだ帳票がありません");
    expect(html).toContain(`href="/admin/documents/new?deal_id=${DEAL_ID}"`);
  });

  it("doc_no が null (下書き) は「下書き」表示、行クリックは /admin/documents/[id] へのリンク", () => {
    const html = renderToStaticMarkup(
      createElement(DealDocumentsCard, {
        dealId: DEAL_ID,
        documentsResult: { ok: true, value: { items: [makeDoc({ doc_no: null, status: "draft" })], next_cursor: null } },
      }),
    );
    expect(html).toContain("下書き");
    expect(html).toContain('href="/admin/documents/11111111-1111-4111-8111-111111111111"');
  });

  it("金額・発行日・種別バッジ・状態バッジを表示する", () => {
    const html = renderToStaticMarkup(
      createElement(DealDocumentsCard, {
        dealId: DEAL_ID,
        documentsResult: { ok: true, value: { items: [makeDoc()], next_cursor: null } },
      }),
    );
    expect(html).toContain("¥12,345");
    expect(html).toContain("2026-07-01");
    expect(html).toContain("受注");
    expect(html).toContain("発行済み");
  });

  it("ヘッダに新規帳票リンクを常に出す", () => {
    const html = renderToStaticMarkup(
      createElement(DealDocumentsCard, {
        dealId: DEAL_ID,
        documentsResult: { ok: true, value: { items: [makeDoc()], next_cursor: null } },
      }),
    );
    expect(html).toContain(`href="/admin/documents/new?deal_id=${DEAL_ID}"`);
  });
});
