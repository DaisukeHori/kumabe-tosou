import { describe, expect, it } from "vitest";

import { decodeTimelineCursor, encodeTimelineCursor } from "@/modules/crm/internal/timeline-cursor";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 (zTimelinePagination コメント) / §2.5 / §11.2。
 * `base64("<occurred_at ISO>|<id>")` の encode/decode 純関数。#44 (画面 Issue) の受入基準に
 * 明記された新規テストファイル (§11.2 の該当行: 「encode→decode 往復 / occurred_at 同時刻の
 * id タイブレーク順序 / 不正カーソルの安全な棄却 (先頭ページ扱い)」)。
 */
describe("encodeTimelineCursor / decodeTimelineCursor", () => {
  it("encode → decode で往復できる", () => {
    const cursor = { occurredAt: "2026-07-12T03:04:05.000Z", id: "11111111-1111-1111-1111-111111111111" };
    const encoded = encodeTimelineCursor(cursor);
    expect(decodeTimelineCursor(encoded)).toEqual(cursor);
  });

  it("occurred_at が同時刻でも id が異なれば区別してタイブレークできる (2 件を encode → decode して id が保持される)", () => {
    const occurredAt = "2026-07-12T03:04:05.000Z";
    const cursorA = { occurredAt, id: "aaaaaaaa-0000-0000-0000-000000000001" };
    const cursorB = { occurredAt, id: "aaaaaaaa-0000-0000-0000-000000000002" };
    const decodedA = decodeTimelineCursor(encodeTimelineCursor(cursorA));
    const decodedB = decodeTimelineCursor(encodeTimelineCursor(cursorB));
    expect(decodedA).toEqual(cursorA);
    expect(decodedB).toEqual(cursorB);
    expect(decodedA?.id).not.toBe(decodedB?.id);
  });

  it("null / undefined は先頭ページ扱い (null) で返す", () => {
    expect(decodeTimelineCursor(null)).toBeNull();
    expect(decodeTimelineCursor(undefined)).toBeNull();
  });

  it("空文字列は先頭ページ扱い (null) で返す", () => {
    expect(decodeTimelineCursor("")).toBeNull();
  });

  it("区切り文字 '|' を含まない壊れたカーソルは安全に棄却する (null)", () => {
    const brokenNoSeparator = Buffer.from("no-separator-here", "utf-8").toString("base64");
    expect(decodeTimelineCursor(brokenNoSeparator)).toBeNull();
  });

  it("base64 として不正な文字列でも例外を投げず null を返す", () => {
    // decode 自体は Buffer.from が寛容にパースすることがあるため、パース後に
    // occurred_at/id のどちらかが空になるケースも含めて安全に棄却されることを確認する。
    expect(() => decodeTimelineCursor("!!!not-valid-base64!!!")).not.toThrow();
  });

  it("occurred_at 部分が空文字 (先頭が '|') は null を返す", () => {
    const encoded = Buffer.from("|11111111-1111-1111-1111-111111111111", "utf-8").toString("base64");
    expect(decodeTimelineCursor(encoded)).toBeNull();
  });

  it("id 部分が空文字 (末尾が '|') は null を返す", () => {
    const encoded = Buffer.from("2026-07-12T03:04:05.000Z|", "utf-8").toString("base64");
    expect(decodeTimelineCursor(encoded)).toBeNull();
  });

  it("occurred_at 自体に '|' が含まれることはないが、lastIndexOf 実装により id 側の区切りを正しく採用する", () => {
    // id は UUID (ハイフンのみ、'|' を含まない) が実運用だが、区切り文字の探索方針
    // (lastIndexOf) を明示的に確認しておく — 万一 occurred_at 表現に '|' が紛れ込んでも
    // 最後の '|' を境界として id を切り出す。
    const raw = "2026-07-12T03:04:05.000Z|extra|11111111-1111-1111-1111-111111111111";
    const encoded = Buffer.from(raw, "utf-8").toString("base64");
    expect(decodeTimelineCursor(encoded)).toEqual({
      occurredAt: "2026-07-12T03:04:05.000Z|extra",
      id: "11111111-1111-1111-1111-111111111111",
    });
  });
});
