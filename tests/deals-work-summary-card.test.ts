import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// GenerateBlocksButton (子コンポーネント、issued/accepted の受注書がある場合に描画される) は
// useRouter() を呼ぶため、Next.js App Router のレンダーコンテキスト前提。bare
// renderToStaticMarkup では invariant エラーになるため最小スタブに差し替える
// (tests/page-body-text-editmode.test.ts の vi.mock 方式に倣う)。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { DealWorkSummaryCard } from "@/app/admin/deals/[id]/DealWorkSummaryCard";
import type { DealWorkSummary } from "@/modules/scheduling/contracts";
import type { DocumentListItem } from "@/modules/sales/contracts";

/**
 * Issue #96 §C-左4: 案件詳細ページの作業ブロックカード (実配線+生成導線)。
 * - issued/accepted の受注書がある場合のみ「作業ブロックを用意」ボタンを表示 (帳票が複数なら
 *   doc_no を添えて複数ボタン)
 * - 受注済みだが帳票未発行・ブロック0件は「受注書を発行すると...」の誘導文
 * - 未受注は「受注後に...」の誘導文
 * - Result を握り潰さず失敗時は code+detail を表示
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

const EMPTY_DOCS = { ok: true as const, value: { items: [] as DocumentListItem[], next_cursor: null } };

function makeSummary(overrides: Partial<DealWorkSummary> = {}): DealWorkSummary {
  return {
    deal_id: DEAL_ID,
    planned_total_hours: 0,
    actual_total_hours: 0,
    done_count: 0,
    open_count: 0,
    blocks: [],
    ...overrides,
  };
}

describe("DealWorkSummaryCard", () => {
  it("workSummary 取得失敗時は code/detail を表示する", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "ordered",
        workSummaryResult: { ok: false, code: "KMB-E901", detail: "db down" },
        documentsResult: EMPTY_DOCS,
      }),
    );
    expect(html).toContain("KMB-E901");
    expect(html).toContain("db down");
  });

  it("未受注 (inquiry) かつ帳票/ブロック0件は「受注後に」の誘導文のみ (ボタンは出さない)", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "inquiry",
        workSummaryResult: { ok: true, value: makeSummary() },
        documentsResult: EMPTY_DOCS,
      }),
    );
    expect(html).toContain("受注後に、受注書の明細から自動で用意できます。");
    expect(html).not.toContain("作業ブロックを用意");
  });

  it("受注済み (ordered) だが帳票/ブロック0件は「受注書を発行すると」の誘導文+作成リンク", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "ordered",
        workSummaryResult: { ok: true, value: makeSummary() },
        documentsResult: EMPTY_DOCS,
      }),
    );
    expect(html).toContain("受注書を発行すると");
    expect(html).toContain(`href="/admin/documents/new?deal_id=${DEAL_ID}"`);
  });

  it("issued の受注書が1件ある場合は「作業ブロックを用意」ボタンを1つ出す", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "ordered",
        workSummaryResult: { ok: true, value: makeSummary() },
        documentsResult: { ok: true, value: { items: [makeDoc()], next_cursor: null } },
      }),
    );
    expect(html).toContain("作業ブロックを用意");
    expect(html).not.toContain("受注後に");
    expect(html).not.toContain("受注書を発行すると");
  });

  it("issued/accepted の受注書が複数ある場合は doc_no を添えたボタンを複数出す", () => {
    const docs = [
      makeDoc({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", doc_no: "ORD-0001", status: "issued" }),
      makeDoc({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", doc_no: "ORD-0002", status: "accepted" }),
    ];
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "ordered",
        workSummaryResult: { ok: true, value: makeSummary() },
        documentsResult: { ok: true, value: { items: docs, next_cursor: null } },
      }),
    );
    expect(html).toContain("作業ブロックを用意 (ORD-0001)");
    expect(html).toContain("作業ブロックを用意 (ORD-0002)");
  });

  it("draft/voided の帳票は生成ボタン対象外 (canGenerateBlocks の判定を反映)", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "ordered",
        workSummaryResult: { ok: true, value: makeSummary() },
        documentsResult: { ok: true, value: { items: [makeDoc({ status: "draft" })], next_cursor: null } },
      }),
    );
    expect(html).not.toContain("作業ブロックを用意");
    expect(html).toContain("受注書を発行すると");
  });

  it("予定/実績/完了/未完了の統計値を表示する", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "in_production",
        workSummaryResult: {
          ok: true,
          value: makeSummary({ planned_total_hours: 12, actual_total_hours: 5, done_count: 2, open_count: 3 }),
        },
        documentsResult: EMPTY_DOCS,
      }),
    );
    const text = html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");
    expect(html).toContain("12h");
    expect(html).toContain("5h");
    expect(text).toContain("2 / 3"); // done_count / open_count (タグ除去後のプレーンテキストで検証)
  });

  it("ブロック一覧は上位5件のみ表示し、残りは「他N件→カレンダー」で折りたたむ", () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({
      id: `block-${i}`,
      work_type_label: `作業${i}`,
      status: "scheduled" as const,
      planned_hours: 1,
      actual_hours: null,
      performed_on: null,
    }));
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "in_production",
        workSummaryResult: { ok: true, value: makeSummary({ blocks, open_count: 7 }) },
        documentsResult: EMPTY_DOCS,
      }),
    );
    expect(html).toContain("作業0");
    expect(html).toContain("作業4");
    expect(html).not.toContain("作業5");
    expect(html).toContain("他 2 件");
  });

  it("フッタに「カレンダーで見る→」と create_deal_id 付きの「新規作成→」を出す", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkSummaryCard, {
        dealId: DEAL_ID,
        dealStage: "inquiry",
        workSummaryResult: { ok: true, value: makeSummary() },
        documentsResult: EMPTY_DOCS,
      }),
    );
    expect(html).toContain('href="/admin/calendar"');
    expect(html).toContain(`href="/admin/calendar?create_deal_id=${DEAL_ID}"`);
  });
});
