import type { Result } from "@/modules/platform/contracts";
import type { DocumentListItem } from "@/modules/sales/contracts";

import type { ListPaymentContext } from "./list-payment-context-action";

/** PaymentDialog へ渡す入金コンテキスト (documents-table.tsx の state 形状と一致)。 */
export type PaymentContext = {
  documentId: string;
  dealId: string;
  dealUpdatedAt: string;
  balanceJpy: number;
  docNo: string | null;
  targetName: string;
};

/**
 * openPaymentFlow の副作用注入口。documents-table.tsx から state 更新・toast・Server Action を
 * そのまま渡す。DOM を要さないプレーンな依存注入にしてあるため、可用性クリティカルな非同期制御
 * (stale-guard / reject 時の解錠 / last-click-wins) を Node 環境の単体テストで固定できる。
 */
export type OpenPaymentDeps = {
  getContext: (documentId: string) => Promise<Result<ListPaymentContext>>;
  /** 直近クリックの item.id を保持する ref。await 解決後にこの値と一致する時だけ確定する。 */
  latestRequestRef: { current: string | null };
  setLoadingPaymentId: (value: string | null) => void;
  setPaymentContext: (value: PaymentContext) => void;
  setPaymentOpen: (value: boolean) => void;
  /** 業務エラー (result.ok === false) 用トースト。文言は呼び出し元と同一の合成済み文字列を受ける。 */
  onBusinessError: (message: string) => void;
  /** Server Action が reject した (通信断・504・fetch 失敗等) 場合の通信エラー用トースト。 */
  onNetworkError: () => void;
};

/**
 * [R4a] 一覧行の「入金」ボタン押下 → 読み取り専用コンテキスト取得 → PaymentDialog を開く、の非同期制御。
 *
 * 可用性上の要点:
 * - 入金ボタンの disabled は `loadingPaymentId !== null`(全行無効)なので、reject 時に
 *   setLoadingPaymentId(null) へ到達しないと一覧の全ボタンがリロードまで永久ロックされる。
 *   そのため await を try/catch で囲み、reject 時も(最新リクエストなら)解錠する。
 * - stale-guard: より新しいクリックがあれば (ref が別 id を指していれば) この結果は破棄し、
 *   loadingPaymentId のクリアも新しい方に委ねる(古い結果が最新のローディング表示を消さない)。
 *   「最後のクリックが勝つ」意味論を維持する。
 */
export async function openPaymentFlow(item: DocumentListItem, deps: OpenPaymentDeps): Promise<void> {
  deps.latestRequestRef.current = item.id;
  deps.setLoadingPaymentId(item.id);
  try {
    const result = await deps.getContext(item.id);
    // より新しいクリックがあれば (ref が別 id を指していれば) この結果は破棄する。loadingPaymentId の
    // クリアも新しい方に委ね、ここでは触らない (古い結果が最新のローディング表示を消さないため)。
    if (deps.latestRequestRef.current !== item.id) return;
    deps.setLoadingPaymentId(null);
    if (!result.ok) {
      deps.onBusinessError(result.detail ?? `入金画面の準備に失敗しました (${result.code})`);
      return;
    }
    deps.setPaymentContext({
      documentId: result.value.document_id,
      dealId: result.value.deal_id,
      dealUpdatedAt: result.value.deal_updated_at,
      balanceJpy: result.value.balance_jpy,
      docNo: result.value.doc_no,
      targetName: result.value.billing_name,
    });
    deps.setPaymentOpen(true);
  } catch {
    // Server Action が真に reject した場合。最新リクエストならローディングを解除し全ボタンの
    // 永久ロックを防ぐ。stale (後続クリックが進行中) の場合はクリアを最新側に委ねる。
    if (deps.latestRequestRef.current === item.id) {
      deps.setLoadingPaymentId(null);
      deps.onNetworkError();
    }
  }
}
