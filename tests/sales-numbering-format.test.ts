import { describe, expect, it } from "vitest";

import { zDocumentNo } from "@/modules/platform/contracts";
import { DOC_NO_PREFIX, zDocType, type DocType } from "@/modules/sales/contracts";

/**
 * canonical: docs/design/crm-suite/00-overview.md §3.4 (document_number_next RPC の書類番号
 * format) / migration 20260711000022_document_numbering.sql (RPC 本体)。
 * DB 接続不要の静的検証 (§13.1 sales-numbering-format.test.ts)。
 *
 * zDocumentNo 自体は platform/contracts.ts の既存 export をそのまま再利用する (本 Issue で
 * 新規定義しない — 実装計画書 §5 の注記どおり)。DOC_NO_PREFIX ↔ RPC の case 式一致は
 * tests/contracts-ddl-parity.test.ts (sales-ddl-parity) 側で別途検証する。
 */

describe("DOC_NO_PREFIX (書類種別 → プレフィクス 4 種)", () => {
  it("quote=Q / order=J / delivery=D / invoice=I のちょうど 4 件", () => {
    expect(DOC_NO_PREFIX).toEqual({ quote: "Q", order: "J", delivery: "D", invoice: "I" });
  });

  it("zDocType の全選択肢を漏れなくカバーする (キー集合の 1:1)", () => {
    expect(Object.keys(DOC_NO_PREFIX).sort()).toEqual([...zDocType.options].sort());
  });

  it("プレフィクスは英大文字 1 文字で、互いに重複しない", () => {
    const values = Object.values(DOC_NO_PREFIX);
    expect(values.every((v) => /^[A-Z]$/.test(v))).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("zDocumentNo (RPC format 出力の受理 — DB 未接続の静的検証)", () => {
  it("4 種のプレフィクスすべてを受理する", () => {
    for (const docType of zDocType.options) {
      const prefix = DOC_NO_PREFIX[docType as DocType];
      expect(zDocumentNo.safeParse(`${prefix}-2026-0001`).success).toBe(true);
    }
  });

  it("4 桁 zero-pad (連番 1 → '0001') を受理する", () => {
    expect(zDocumentNo.safeParse("Q-2026-0001").success).toBe(true);
  });

  it("9999 → 10000 の桁増加 (lpad は切り詰めない — パターン 14) を受理する", () => {
    expect(zDocumentNo.safeParse("Q-2026-9999").success).toBe(true);
    expect(zDocumentNo.safeParse("Q-2026-10000").success).toBe(true);
    expect(zDocumentNo.safeParse("Q-2026-123456").success).toBe(true); // さらに桁が伸びても受理する
  });

  it("不正なプレフィクス (Q/J/D/I 以外) を拒否する", () => {
    expect(zDocumentNo.safeParse("O-2026-0001").success).toBe(false); // O は 0 と紛らわしいため不採用 (migration コメントどおり)
    expect(zDocumentNo.safeParse("X-2026-0001").success).toBe(false);
    expect(zDocumentNo.safeParse("q-2026-0001").success).toBe(false); // 小文字は不可
  });

  it("連番の桁不足 (4 桁未満) を拒否する", () => {
    expect(zDocumentNo.safeParse("Q-2026-1").success).toBe(false);
    expect(zDocumentNo.safeParse("Q-2026-001").success).toBe(false); // 3 桁
  });

  it("発行年部の桁数不正 (4 桁固定) を拒否する", () => {
    expect(zDocumentNo.safeParse("Q-26-0001").success).toBe(false); // 2 桁年
    expect(zDocumentNo.safeParse("Q-202-0001").success).toBe(false); // 3 桁年
  });

  it("区切り欠落・空文字を拒否する", () => {
    expect(zDocumentNo.safeParse("Q20260001").success).toBe(false);
    expect(zDocumentNo.safeParse("").success).toBe(false);
  });
});
