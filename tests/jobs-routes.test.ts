import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/00-overview.md §3.1.3 (pg_cron → /api/jobs/* 新設ジョブ一覧)。
 *
 * 4 ルート (telephony/calendar-sync/calendar-maintenance/crm-digest) は
 * `src/app/api/jobs/publish/route.ts` と完全同型の骨格
 * (isJobsSecretConfigured() 未設定→503 / x-jobs-secret 不一致→401 / 一致→202+after()) を持つ。
 * 本ファイルはその 3 分岐を横並びで検証する。after() の中身は各モジュール facade 実装後の
 * TODO スタブ (no-op) のため、コールバック内部の副作用は検証しない
 * (「after()はno-opなので副作用アサート不要」— 呼ばれた/呼ばれなかったの発火有無のみ見る)。
 *
 * `after()` は Next.js のリクエストスコープ (AsyncLocalStorage) 外で呼ぶと
 * 「`after` was called outside a request scope」で同期的に throw する (plain Vitest には
 * その文脈が無い実測確認済み)。route 側の実装を変えずにテストするため、next/server の
 * `after` のみ no-op にモックし、NextResponse 等はそのまま実体を使う。
 */

const afterMock = vi.fn();
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (...args: unknown[]) => afterMock(...args) };
});

import { POST as telephonyPost } from "@/app/api/jobs/telephony/route";
import { POST as calendarSyncPost } from "@/app/api/jobs/calendar-sync/route";
import { POST as calendarMaintenancePost } from "@/app/api/jobs/calendar-maintenance/route";
import { POST as crmDigestPost } from "@/app/api/jobs/crm-digest/route";

type RouteHandler = (request: Request) => Promise<Response>;

const ROUTES: { name: string; post: RouteHandler }[] = [
  { name: "telephony", post: telephonyPost },
  { name: "calendar-sync", post: calendarSyncPost },
  { name: "calendar-maintenance", post: calendarMaintenancePost },
  { name: "crm-digest", post: crmDigestPost },
];

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/jobs/x", { method: "POST", headers });
}

describe.each(ROUTES)("/api/jobs/$name (pg_cron 起床 webhook — publish route と同型骨格)", ({ post }) => {
  const ORIGINAL_JOBS_SECRET = process.env.JOBS_SECRET;

  beforeEach(() => {
    afterMock.mockClear();
  });

  afterEach(() => {
    if (ORIGINAL_JOBS_SECRET === undefined) {
      delete process.env.JOBS_SECRET;
    } else {
      process.env.JOBS_SECRET = ORIGINAL_JOBS_SECRET;
    }
  });

  it("JOBS_SECRET 未設定なら 503 (KMB-E901) を返し、after() は起動しない", async () => {
    delete process.env.JOBS_SECRET;

    const res = await post(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ code: "KMB-E901" });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("x-jobs-secret ヘッダ未送信なら 401 (KMB-E201) を返し、after() は起動しない", async () => {
    process.env.JOBS_SECRET = "correct-secret";

    const res = await post(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: "KMB-E201" });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("x-jobs-secret ヘッダが不一致なら 401 (KMB-E201) を返し、after() は起動しない", async () => {
    process.env.JOBS_SECRET = "correct-secret";

    const res = await post(makeRequest({ "x-jobs-secret": "wrong-secret" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: "KMB-E201" });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("x-jobs-secret ヘッダが一致するなら 202 (accepted:true) を返し、after() が 1 回起動される", async () => {
    process.env.JOBS_SECRET = "correct-secret";

    const res = await post(makeRequest({ "x-jobs-secret": "correct-secret" }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ accepted: true });
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
