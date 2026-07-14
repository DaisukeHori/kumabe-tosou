// scheduling/internal/echo.ts — 自己エコー棄却 (§8.6)。純関数のみ (node:crypto の sha256 のみ依存)。
// canonical: docs/design/crm-suite/03-scheduling.md §8.6
//
// 【最重要地雷】時刻正規化を怠ると rule2 が常に不一致になり自己エコー棄却が機能しない
// → 無限 push ループになる。push 側 (sync-engine.ts) と pull 側 (この判定) が同一の
// 正規化関数 (computeWrittenHash) を通すことが必須。
// - s/e (starts_at/ends_at) は UTC エポック ms へ正規化する: push は Asia/Tokyo 表記
//   (+09:00) で書き、pull は provider 依存の表記 (Google = offset 付き RFC3339 /
//   Graph = 小数 7 桁 + timeZone 別フィールド) で返るため、文字列のまま hash すると
//   同一時刻でも恒常的に不一致になる。
// - t (title) は trim 後。
import { createHash } from "node:crypto";

import { ECHO_UPDATED_AT_MARGIN_MS } from "./lease";

export type WrittenContent = {
  startsAt: string; // ISO (どんな表記でもよい — Date でパースして UTC エポック ms に正規化する)
  endsAt: string;
  title: string;
};

/** push 書込時・pull 判定時で共有する正規化 + sha256 の純関数 (§8.6)。 */
export function computeWrittenHash(content: WrittenContent): string {
  const normalized = {
    s: new Date(content.startsAt).getTime(),
    e: new Date(content.endsAt).getTime(),
    t: content.title.trim(),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/** isSelfEcho の判定に必要な link 側の最小情報。calendar_event_links の該当列と 1:1。 */
export type EchoLinkSnapshot = {
  etag_or_change_key: string | null;
  last_pushed_at: string | null;
  last_written_hash: string | null;
};

/** isSelfEcho の判定に必要な change 側の最小情報。ExternalEventChange の一部と 1:1。 */
export type EchoChangeSnapshot = {
  etagOrChangeKey: string | null;
  externalUpdatedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  title: string | null;
};

/**
 * pull した change がアプリ自身の直前 push の反響かどうかを 2 段で判定する (§8.6)。
 * (3 段目「removed かつ link 不在」は link がある前提のこの関数では扱わない — sync-engine 側で
 * 「link が既に削除済み = 自然に skip」として処理される)。
 *
 * rule1: change.etagOrChangeKey === link.etag_or_change_key (push 応答で保存した値と同一 = 変化なし)
 * rule2: change.externalUpdatedAt <= link.last_pushed_at + 5 秒マージン
 *        かつ sha256({s,e,t} 正規化後) === link.last_written_hash
 */
export function isSelfEcho(change: EchoChangeSnapshot, link: EchoLinkSnapshot): boolean {
  if (
    change.etagOrChangeKey !== null &&
    link.etag_or_change_key !== null &&
    change.etagOrChangeKey === link.etag_or_change_key
  ) {
    return true;
  }

  if (
    change.externalUpdatedAt !== null &&
    link.last_pushed_at !== null &&
    link.last_written_hash !== null &&
    change.startsAt !== null &&
    change.endsAt !== null &&
    change.title !== null
  ) {
    const externalUpdatedAtMs = new Date(change.externalUpdatedAt).getTime();
    const lastPushedAtMs = new Date(link.last_pushed_at).getTime();
    const withinMargin = externalUpdatedAtMs <= lastPushedAtMs + ECHO_UPDATED_AT_MARGIN_MS;
    if (withinMargin) {
      const changeHash = computeWrittenHash({
        startsAt: change.startsAt,
        endsAt: change.endsAt,
        title: change.title,
      });
      if (changeHash === link.last_written_hash) return true;
    }
  }

  return false;
}
