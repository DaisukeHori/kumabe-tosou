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
 * telephony は #57 で after() の中身 (runTelephonyJobBatch 起動) を実装したため、下記
 * describe.each の後に telephony 専用の追加 describe ブロックで after() コールバック内部の
 * 呼び出しまで検証する (他 3 ルートは引き続き TODO no-op のまま — 追加検証の対象外)。
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

/**
 * telephony 専用の追加検証 (AC#8: `/api/jobs/telephony` が 202 を返しつつ due job を最大
 * TELEPHONY_WORKER_MAX_JOBS_PER_WAKE 件処理する) 用に facade の runTelephonyJobBatch のみを
 * 差し替える。他 3 ルート (calendar-sync/calendar-maintenance/crm-digest) は telephony facade を
 * import していないため無関係 (route.ts 側の TODO no-op のまま)。
 * due job の選定 limit・残余予算ガード・acquire 分岐の網羅的な検証自体は
 * tests/telephony-worker.test.ts が internal/worker.ts (runTelephonyJobBatch/advanceCallJob) を
 * 直接 (repository をモックして) 検証する — module-contracts.md §2 の ESLint 境界により、
 * telephony/internal・telephony/repository は tests/telephony-*.test.ts からのみ import 可能で
 * 本ファイルからは import できないため、この分担にしている。
 */
const runTelephonyJobBatchMock = vi.fn();
vi.mock("@/modules/telephony/facade", () => ({
  runTelephonyJobBatch: (...args: unknown[]) => runTelephonyJobBatchMock(...args),
}));

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

/**
 * AC#8 (#57 受入基準): `/api/jobs/telephony` が 202 を返しつつ、after() 内で
 * telephony facade の runTelephonyJobBatch (internal/worker.ts、due job 最大
 * TELEPHONY_WORKER_MAX_JOBS_PER_WAKE(2) 件を created_at 昇順で直列処理 — §7.3) を実際に起動する
 * ことを検証する。due job 選定 limit・残余予算ガード・acquire 分岐の網羅は
 * tests/telephony-worker.test.ts (internal/worker.ts を直接検証) が担う。
 */
describe("/api/jobs/telephony (§7.3 AC#8): after() で telephony facade の runTelephonyJobBatch が起動される", () => {
  const ORIGINAL_JOBS_SECRET = process.env.JOBS_SECRET;

  beforeEach(() => {
    afterMock.mockClear();
    runTelephonyJobBatchMock.mockReset();
    process.env.JOBS_SECRET = "correct-secret";
  });

  afterEach(() => {
    if (ORIGINAL_JOBS_SECRET === undefined) {
      delete process.env.JOBS_SECRET;
    } else {
      process.env.JOBS_SECRET = ORIGINAL_JOBS_SECRET;
    }
  });

  it("202 を返し、after() コールバックを実行すると runTelephonyJobBatch が 1 回だけ引数無しで呼ばれる。処理件数はそのまま console.log に記録される (2 件処理された場合の裏取り)", async () => {
    runTelephonyJobBatchMock.mockResolvedValue({ processed: 2 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await telephonyPost(makeRequest({ "x-jobs-secret": "correct-secret" }));

    expect(res.status).toBe(202);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(runTelephonyJobBatchMock).not.toHaveBeenCalled(); // after() 自体はまだ実行されていない (202 は先行応答)

    const callback = afterMock.mock.calls[0][0] as () => Promise<void>;
    await callback();

    expect(runTelephonyJobBatchMock).toHaveBeenCalledTimes(1);
    expect(runTelephonyJobBatchMock).toHaveBeenCalledWith();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("2 件処理しました"));

    logSpy.mockRestore();
  });

  it("runTelephonyJobBatch が例外を投げても after() 内の try/catch に握り潰され、202 応答自体・後続処理に影響しない (エラーは console.error に記録)", async () => {
    runTelephonyJobBatchMock.mockRejectedValue(new Error("batch boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await telephonyPost(makeRequest({ "x-jobs-secret": "correct-secret" }));
    expect(res.status).toBe(202);

    const callback = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(callback()).resolves.toBeUndefined();

    expect(runTelephonyJobBatchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("KMB-E901"),
      "batch boom",
    );

    errorSpy.mockRestore();
  });
});
