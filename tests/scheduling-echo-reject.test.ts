import { describe, expect, it } from "vitest";

import {
  computeWrittenHash,
  isSelfEcho,
  type EchoChangeSnapshot,
  type EchoLinkSnapshot,
} from "@/modules/scheduling/internal/echo";
import { ECHO_UPDATED_AT_MARGIN_MS } from "@/modules/scheduling/internal/lease";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §8.6 (自己エコー棄却)。
 * 実装計画書「テスト戦略」§scheduling-echo-reject.test.ts の必須ケース:
 *   etag一致 / hash+マージン一致 / マージン境界(5s丁度) / 非エコー通過 / removed判定 /
 *   時刻表記揺れの正規化 (offset付きISO vs 小数7桁+TZ別フィールドでhash一致)
 *
 * 【最重要地雷】(echo.ts 冒頭コメント): 時刻正規化を怠ると rule2 が常に不一致になり
 * 自己エコー棄却が機能しない → 無限 push ループになる。このテストが最終防衛線。
 */

function link(overrides: Partial<EchoLinkSnapshot> = {}): EchoLinkSnapshot {
  return {
    etag_or_change_key: "etag-v1",
    last_pushed_at: "2026-07-12T00:00:00.000Z",
    last_written_hash: computeWrittenHash({
      startsAt: "2026-07-12T00:00:00.000Z",
      endsAt: "2026-07-12T03:00:00.000Z",
      title: "研磨",
    }),
    ...overrides,
  };
}

function change(overrides: Partial<EchoChangeSnapshot> = {}): EchoChangeSnapshot {
  return {
    etagOrChangeKey: "etag-v1",
    externalUpdatedAt: "2026-07-12T00:00:00.000Z",
    startsAt: "2026-07-12T00:00:00.000Z",
    endsAt: "2026-07-12T03:00:00.000Z",
    title: "研磨",
    ...overrides,
  };
}

describe("computeWrittenHash: 時刻表記揺れの正規化 (offset付きISO / 小数7桁+TZ表記の吸収)", () => {
  it("同一時刻を異なる表記 (UTC 'Z' 表記 vs +09:00 offset 表記) で渡しても同じ hash になる", () => {
    const utcForm = computeWrittenHash({
      startsAt: "2026-07-11T15:00:00.000Z", // UTC 15:00 = JST 翌日 00:00
      endsAt: "2026-07-11T18:00:00.000Z",
      title: "研磨",
    });
    const jstForm = computeWrittenHash({
      startsAt: "2026-07-12T00:00:00+09:00",
      endsAt: "2026-07-12T03:00:00+09:00",
      title: "研磨",
    });
    expect(utcForm).toBe(jstForm);
  });

  it("Graph 風の小数7桁 + 別表記 (末尾 'Z') でも UTC 相当なら同じ hash になる", () => {
    const rfc3339 = computeWrittenHash({
      startsAt: "2026-07-12T00:00:00+09:00",
      endsAt: "2026-07-12T03:00:00+09:00",
      title: "研磨",
    });
    const graphStyle = computeWrittenHash({
      startsAt: "2026-07-11T15:00:00.0000000Z",
      endsAt: "2026-07-11T18:00:00.0000000Z",
      title: "研磨",
    });
    expect(rfc3339).toBe(graphStyle);
  });

  it("title の前後空白は trim されて同じ hash になる", () => {
    const a = computeWrittenHash({ startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z", title: "研磨" });
    const b = computeWrittenHash({ startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z", title: "  研磨  " });
    expect(a).toBe(b);
  });

  it("時刻が実際に異なれば hash も異なる (正規化のしすぎで誤検知にならないことの確認)", () => {
    const a = computeWrittenHash({ startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z", title: "研磨" });
    const b = computeWrittenHash({ startsAt: "2026-07-12T00:00:01Z", endsAt: "2026-07-12T03:00:00Z", title: "研磨" });
    expect(a).not.toBe(b);
  });
});

describe("isSelfEcho: rule1 (etag一致)", () => {
  it("change.etagOrChangeKey === link.etag_or_change_key ならエコー (他の条件が全て崩れていても true)", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: "etag-v1", externalUpdatedAt: null, startsAt: null, endsAt: null, title: null }),
      link({ etag_or_change_key: "etag-v1" }),
    );
    expect(result).toBe(true);
  });

  it("etag が異なればこの rule だけでは true にならない (rule2 も不成立なら false)", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: "etag-v2", externalUpdatedAt: null, startsAt: null, endsAt: null, title: null }),
      link({ etag_or_change_key: "etag-v1" }),
    );
    expect(result).toBe(false);
  });

  it("両方 null の場合は一致とみなさない (null === null での誤判定を避ける)", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: null, externalUpdatedAt: null, startsAt: null, endsAt: null, title: null }),
      link({ etag_or_change_key: null, last_pushed_at: null, last_written_hash: null }),
    );
    expect(result).toBe(false);
  });
});

describe("isSelfEcho: rule2 (hash + マージン一致)", () => {
  it("etag が不一致でも externalUpdatedAt がマージン内 かつ hash が一致すればエコー", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: "etag-different", externalUpdatedAt: "2026-07-12T00:00:02.000Z" }),
      link({ etag_or_change_key: "etag-v1" }),
    );
    expect(result).toBe(true);
  });

  it("マージン境界 (ちょうど 5 秒 = ECHO_UPDATED_AT_MARGIN_MS) は許容 (<=)", () => {
    expect(ECHO_UPDATED_AT_MARGIN_MS).toBe(5_000);
    const result = isSelfEcho(
      change({ etagOrChangeKey: "etag-different", externalUpdatedAt: "2026-07-12T00:00:05.000Z" }),
      link({ etag_or_change_key: "etag-v1", last_pushed_at: "2026-07-12T00:00:00.000Z" }),
    );
    expect(result).toBe(true);
  });

  it("マージン境界を 1ms でも超えると (5001ms) エコーと判定しない", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: "etag-different", externalUpdatedAt: "2026-07-12T00:00:05.001Z" }),
      link({ etag_or_change_key: "etag-v1", last_pushed_at: "2026-07-12T00:00:00.000Z" }),
    );
    expect(result).toBe(false);
  });

  it("マージン内でも hash が一致しなければエコーではない (実際に外部で内容が変わった場合)", () => {
    const result = isSelfEcho(
      change({
        etagOrChangeKey: "etag-different",
        externalUpdatedAt: "2026-07-12T00:00:02.000Z",
        startsAt: "2026-07-12T05:00:00.000Z", // link の last_written_hash とは異なる時刻
      }),
      link({ etag_or_change_key: "etag-v1" }),
    );
    expect(result).toBe(false);
  });

  it("change 側の startsAt/endsAt/title のいずれかが null (removed 等) なら rule2 を評価しない", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: "etag-different", externalUpdatedAt: "2026-07-12T00:00:02.000Z", startsAt: null }),
      link({ etag_or_change_key: "etag-v1" }),
    );
    expect(result).toBe(false);
  });
});

describe("isSelfEcho: 非エコー (実際の外部変更) は素通りする", () => {
  it("etag 不一致 + マージン超過 + hash 不一致 の変更は自己エコーと判定しない", () => {
    const result = isSelfEcho(
      change({
        etagOrChangeKey: "etag-v9",
        externalUpdatedAt: "2026-07-13T00:00:00.000Z",
        startsAt: "2026-07-13T00:00:00.000Z",
        endsAt: "2026-07-13T03:00:00.000Z",
        title: "外部で変更されたタイトル",
      }),
      link(),
    );
    expect(result).toBe(false);
  });
});

describe("isSelfEcho: removed 判定 (link 側の情報のみで判定可能な場合の安全側動作)", () => {
  it("removed 相当 (startsAt/endsAt/title が全て null) の change は link.etag_or_change_key と一致しない限りエコー扱いにしない (sync-engine 側で別途 deleted_externally 処理される)", () => {
    const result = isSelfEcho(
      change({ etagOrChangeKey: null, externalUpdatedAt: "2026-07-12T00:00:00.000Z", startsAt: null, endsAt: null, title: null }),
      link(),
    );
    expect(result).toBe(false);
  });
});
