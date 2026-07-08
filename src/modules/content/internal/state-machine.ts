import type { Result } from "@/modules/platform/contracts";

import type { ContentStatus } from "../contracts";

/**
 * canonical: docs/design/cms-ai-pipeline.md §4.1 (コンテンツ状態遷移)
 *
 * ```
 * draft ──→ review ──→ published ──→ archived
 *   ▲          │            │
 *   └──────────┘            └──→ (published に戻す = 再公開可)
 * ```
 *
 * 不変条件: published_at は published へ遷移した最初の時刻を保持し、編集では変わらない。
 * archived → published の復帰では元の published_at を維持する。
 */
const ALLOWED_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["archived"],
  archived: ["published"],
};

export type TransitionInput = {
  currentStatus: ContentStatus;
  /** 更新対象行の現在の published_at (DB 値、ISO 文字列)。draft/review では通常 null */
  currentPublishedAt: string | null;
  to: ContentStatus;
  /** zStatusTransition.published_at (入力)。published への遷移時のみ意味を持つ */
  requestedPublishedAt: string | null;
  /** テスト用の時刻注入 (省略時は new Date()) */
  now?: Date;
};

export type TransitionOutcome = {
  status: ContentStatus;
  publishedAt: string | null;
};

/**
 * §4.1 の遷移図 + published_at 不変条件をガードする純関数。
 * repository はこの結果をそのまま UPDATE の SET 句に使う。
 */
export function guardTransition(input: TransitionInput): Result<TransitionOutcome> {
  const { currentStatus, currentPublishedAt, to, requestedPublishedAt } = input;
  const now = input.now ?? new Date();

  const allowedTargets = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowedTargets.includes(to)) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: `${currentStatus} から ${to} への遷移は許可されていません`,
    };
  }

  if (to === "published") {
    if (currentStatus === "archived") {
      // archived → published (復帰): 元の published_at を維持。入力での上書きは不可。
      if (requestedPublishedAt !== null) {
        return {
          ok: false,
          code: "KMB-E101",
          detail:
            "archived からの復帰では published_at を指定できません (元の公開日時を維持します)",
        };
      }
      return { ok: true, value: { status: "published", publishedAt: currentPublishedAt } };
    }

    // review → published (初回公開): 未来日時 = 予約公開。過去/未指定は即時 (now)。
    const requested = requestedPublishedAt ? new Date(requestedPublishedAt) : now;
    const effective = requested.getTime() > now.getTime() ? requested : now;
    return { ok: true, value: { status: "published", publishedAt: effective.toISOString() } };
  }

  if (to === "archived") {
    // published → archived: published_at は不変 (アーカイブしても保持する)
    if (requestedPublishedAt !== null) {
      return {
        ok: false,
        code: "KMB-E101",
        detail: "archived への遷移で published_at は指定できません",
      };
    }
    return { ok: true, value: { status: "archived", publishedAt: currentPublishedAt } };
  }

  // draft ⇄ review: published_at はまだ null のはずで変化しない
  if (requestedPublishedAt !== null) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: `${to} への遷移で published_at は指定できません`,
    };
  }
  return { ok: true, value: { status: to, publishedAt: currentPublishedAt } };
}
