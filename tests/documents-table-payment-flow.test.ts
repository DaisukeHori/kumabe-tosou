import { beforeEach, describe, expect, it, vi } from "vitest";

import { openPaymentFlow, type OpenPaymentDeps } from "@/app/admin/documents/open-payment-flow";
import type { ListPaymentContext } from "@/app/admin/documents/list-payment-context-action";
import type { Result } from "@/modules/platform/contracts";
import type { DocumentListItem } from "@/modules/sales/contracts";

/**
 * [R4a 最終修正] 帳票一覧 (documents-table.tsx) の「入金」導線の可用性回帰テスト。
 *
 * 対象は documents-table.tsx から抽出した実制御フロー openPaymentFlow(). 抽出理由: 当リポジトリの
 * テスト基盤は vitest + `environment: "node"` で、@testing-library/react も jsdom も
 * react-test-renderer も存在しない (既存 .tsx テストは renderToStaticMarkup による静的描画のみで、
 * クリック→非同期 state→disabled 解除 の観測は不可能)。そのため可用性クリティカルな非同期制御を
 * DOM 非依存の純粋モジュールに切り出し、コンポーネントが実際に実行するのと同一のコードをここで固定する。
 * Server Action (getListPaymentContextAction) はこのフローの依存注入口 (deps.getContext) で差し替える
 * (= DI によるモック点)。
 *
 * 検証する可用性不変条件:
 *  - reject 時に loadingPaymentId が null に戻る (入金ボタンの disabled は `loadingPaymentId !== null`
 *    の全行共有判定なので、null に戻らないと一覧の全「入金」ボタンがリロードまで永久ロックされる)。
 *  - stale-guard / last-click-wins: 先着の解決/失敗が後着クリックの対象・ローディングを上書きしない。
 */

const DEAL_ID = "66666666-6666-4666-8666-666666666666";

function makeItem(id: string): DocumentListItem {
  return {
    id,
    doc_type: "invoice",
    status: "issued",
    doc_no: `INV-${id}`,
    billing_name: "テスト太郎",
    deal_id: DEAL_ID,
    deal_title: "テスト案件",
    total_jpy: 10000,
    issue_date: "2026-07-01",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    source_document_id: null,
  };
}

function ctxValue(tag: string): ListPaymentContext {
  return {
    document_id: `doc-${tag}`,
    deal_id: `deal-${tag}`,
    deal_updated_at: "2026-07-01T00:00:00.000Z",
    balance_jpy: 5000,
    doc_no: `INV-${tag}`,
    billing_name: `宛名-${tag}`,
  };
}

/** deps を組み立てる。latestRequestRef はコンポーネントの useRef と同様に呼び出し間で共有する。 */
function makeDeps(getContext: OpenPaymentDeps["getContext"]): {
  deps: OpenPaymentDeps;
  setLoadingPaymentId: ReturnType<typeof vi.fn>;
  setPaymentContext: ReturnType<typeof vi.fn>;
  setPaymentOpen: ReturnType<typeof vi.fn>;
  onBusinessError: ReturnType<typeof vi.fn>;
  onNetworkError: ReturnType<typeof vi.fn>;
} {
  const setLoadingPaymentId = vi.fn();
  const setPaymentContext = vi.fn();
  const setPaymentOpen = vi.fn();
  const onBusinessError = vi.fn();
  const onNetworkError = vi.fn();
  return {
    deps: {
      getContext,
      latestRequestRef: { current: null },
      setLoadingPaymentId,
      setPaymentContext,
      setPaymentOpen,
      onBusinessError,
      onNetworkError,
    },
    setLoadingPaymentId,
    setPaymentContext,
    setPaymentOpen,
    onBusinessError,
    onNetworkError,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openPaymentFlow — reject 時の解錠 (可用性最重要)", () => {
  it("getContext が reject したら loadingPaymentId を null に戻し (全行のボタン解錠) 通信エラーを出す", async () => {
    const getContext = vi.fn().mockRejectedValue(new Error("network down"));
    const h = makeDeps(getContext);

    await openPaymentFlow(makeItem("A"), h.deps);

    // まずクリック行でローディング ON → 最終的に null に戻る。disabled は loadingPaymentId!==null の
    // 全行共有判定なので、この最終 null がクリック行および他行すべての解錠を意味する。
    expect(h.setLoadingPaymentId).toHaveBeenNthCalledWith(1, "A");
    expect(h.setLoadingPaymentId).toHaveBeenLastCalledWith(null);
    expect(h.onNetworkError).toHaveBeenCalledTimes(1);
    // reject は業務エラーではないので業務トースト・ダイアログ確定は起きない。
    expect(h.onBusinessError).not.toHaveBeenCalled();
    expect(h.setPaymentContext).not.toHaveBeenCalled();
    expect(h.setPaymentOpen).not.toHaveBeenCalled();
  });
});

describe("openPaymentFlow — 業務エラー (result.ok === false) は既存文言を維持し解錠する", () => {
  it("detail があればそれをそのまま業務トーストに出す", async () => {
    const getContext = vi.fn<OpenPaymentDeps["getContext"]>().mockResolvedValue({
      ok: false,
      code: "KMB-E404",
      detail: "対象の帳票が見つかりません。",
    } satisfies Result<ListPaymentContext>);
    const h = makeDeps(getContext);

    await openPaymentFlow(makeItem("A"), h.deps);

    expect(h.setLoadingPaymentId).toHaveBeenLastCalledWith(null);
    expect(h.onBusinessError).toHaveBeenCalledWith("対象の帳票が見つかりません。");
    expect(h.onNetworkError).not.toHaveBeenCalled();
    expect(h.setPaymentOpen).not.toHaveBeenCalled();
  });

  it("detail が無ければ既存の合成文言 (code 付き) を出す", async () => {
    const getContext = vi.fn<OpenPaymentDeps["getContext"]>().mockResolvedValue({
      ok: false,
      code: "KMB-E901",
    } satisfies Result<ListPaymentContext>);
    const h = makeDeps(getContext);

    await openPaymentFlow(makeItem("A"), h.deps);

    expect(h.onBusinessError).toHaveBeenCalledWith("入金画面の準備に失敗しました (KMB-E901)");
    expect(h.setLoadingPaymentId).toHaveBeenLastCalledWith(null);
  });
});

describe("openPaymentFlow — 成功時は対象コンテキストを確定しダイアログを開く", () => {
  it("balance/deal_updated_at/docNo/targetName を PaymentDialog 用に組み立てる", async () => {
    const getContext = vi.fn<OpenPaymentDeps["getContext"]>().mockResolvedValue({
      ok: true,
      value: ctxValue("A"),
    } satisfies Result<ListPaymentContext>);
    const h = makeDeps(getContext);

    await openPaymentFlow(makeItem("A"), h.deps);

    expect(h.setLoadingPaymentId).toHaveBeenLastCalledWith(null);
    expect(h.setPaymentContext).toHaveBeenCalledWith({
      documentId: "doc-A",
      dealId: "deal-A",
      dealUpdatedAt: "2026-07-01T00:00:00.000Z",
      balanceJpy: 5000,
      docNo: "INV-A",
      targetName: "宛名-A",
    });
    expect(h.setPaymentOpen).toHaveBeenCalledWith(true);
  });
});

describe("openPaymentFlow — レース (last-click-wins)", () => {
  it("A→B 連続クリックで先着 A の解決は後着 B の対象を上書きしない", async () => {
    const dA = deferred<Result<ListPaymentContext>>();
    const dB = deferred<Result<ListPaymentContext>>();
    const getContext = vi
      .fn<OpenPaymentDeps["getContext"]>()
      .mockReturnValueOnce(dA.promise)
      .mockReturnValueOnce(dB.promise);
    const h = makeDeps(getContext);

    // A を開始 (await で中断) → 続けて B を開始。共有 ref は最終的に "B" を指す。
    const pA = openPaymentFlow(makeItem("A"), h.deps);
    const pB = openPaymentFlow(makeItem("B"), h.deps);

    // 先着 A が先に解決 — だが ref は "B" なので stale として破棄されなければならない。
    dA.resolve({ ok: true, value: ctxValue("A") });
    await pA;
    expect(h.setPaymentContext).not.toHaveBeenCalled();
    // stale の A はローディングを触らない (クリアは最新 B に委ねる)。
    expect(h.setLoadingPaymentId).not.toHaveBeenCalledWith(null);

    // 後着 B が解決 — こちらが勝ち、B の対象で確定しローディングを解錠する。
    dB.resolve({ ok: true, value: ctxValue("B") });
    await pB;
    expect(h.setPaymentContext).toHaveBeenCalledTimes(1);
    expect(h.setPaymentContext).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-B", targetName: "宛名-B" }),
    );
    expect(h.setPaymentOpen).toHaveBeenCalledWith(true);
    expect(h.setLoadingPaymentId).toHaveBeenLastCalledWith(null);
  });

  it("後着 B が進行中に先着 A が reject しても A はローディングを解錠しない (最新 B に委ねる)", async () => {
    const dA = deferred<Result<ListPaymentContext>>();
    const dB = deferred<Result<ListPaymentContext>>();
    const getContext = vi
      .fn<OpenPaymentDeps["getContext"]>()
      .mockReturnValueOnce(dA.promise)
      .mockReturnValueOnce(dB.promise);
    const h = makeDeps(getContext);

    const pA = openPaymentFlow(makeItem("A"), h.deps);
    const pB = openPaymentFlow(makeItem("B"), h.deps);

    // stale な A が reject: ref は "B" なので loadingPaymentId(null) は呼ばない
    // (B がまだ進行中なのに解錠すると誤って全行が有効化されるため)。
    dA.reject(new Error("late fail on superseded A"));
    await pA;
    expect(h.setLoadingPaymentId).not.toHaveBeenCalledWith(null);
    // stale な A の reject は通信エラートーストも出してはならない (B は正常進行中で偽陽性になるため)。
    expect(h.onNetworkError).not.toHaveBeenCalled();

    // 後着 B が正常解決すれば通常どおり解錠される。
    dB.resolve({ ok: true, value: ctxValue("B") });
    await pB;
    expect(h.setLoadingPaymentId).toHaveBeenLastCalledWith(null);
    expect(h.setPaymentContext).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-B" }),
    );
  });
});
