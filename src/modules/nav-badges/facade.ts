import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSessionAndClient } from "@/lib/supabase/session";
import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";

import { NAV_BADGE_TIMEOUT_MS, type NavBadgeCounts, type NavBadgesFacade } from "./contracts";
import { countDueOrOverdueTasks, countReviewCalls, countUnhandledInquiries } from "./repository";

/**
 * nav-badges モジュールの公開 facade (R6c / #129)。管理サイドナビの未対応件数バッジの
 * 実データ源。詳細は contracts.ts / repository.ts のヘッダを参照。
 */

/** withTimeout の結果 — タイムアウト勝利 or 値の解決を型で区別する。 */
type TimeoutOutcome<T> = { timedOut: true } | { timedOut: false; value: T };

/**
 * admin セッションを確認して server client を返す (telephony/facade.ts requireAdminClient と
 * 同型)。calls 等の SELECT RLS は admin 限定だが、非 admin authenticated には permission denied
 * ではなく黙って 0 行を返すため、「権限なし」を「0 件」に化けさせないよう明示的に admin 判定する。
 */
async function requireAdminClient(): Promise<Result<SupabaseClient>> {
  const { supabase, user } = await getSessionAndClient();
  if (!user) return { ok: false, code: "KMB-E201" };
  const isAdmin = await platformFacade.isAdmin(user.id);
  if (!isAdmin) return { ok: false, code: "KMB-E202" };
  return { ok: true, value: supabase };
}

/**
 * `promise` が `ms` 以内に解決すれば `{timedOut:false, value}` を、超過すれば `{timedOut:true}` を
 * resolve する。`promise` が reject した場合はそのまま reject を伝播させ、呼び出し側 (facade の
 * try/catch) が KMB-E001 に丸める (タイムアウト KMB-E002 とは区別する)。タイムアウト後に遅れて
 * reject が来ても、reject ハンドラを付けてあるため未処理 rejection にはならない (settle 済みの
 * resolve/reject は no-op)。勝者確定時にタイマーを必ず解放する。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<TimeoutOutcome<T>> {
  return new Promise<TimeoutOutcome<T>>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 認可 (admin) → 3 count 集計を 1 本の非同期処理として実行し Result で返す。この関数**全体**を
 * withTimeout で括ることで、count だけでなく前段の認可 (requireAdminClient 内の auth.getUser +
 * プロファイル取得) が遅い場合もタイムアウト予算 (NAV_BADGE_TIMEOUT_MS) の対象になる
 * (#129 受入基準: layout 集計はタイムアウトで縮退必須)。認可**失敗** (E201/E202) はここで即座に
 * err Result を返し、タイムアウト (E002) とは別経路になる — E002 に吸収されるのは認可が
 * 「遅い (ハング)」場合のみ、という意味論。
 */
async function collectNavBadgeCounts(): Promise<Result<NavBadgeCounts>> {
  const adminResult = await requireAdminClient();
  if (!adminResult.ok) return adminResult;
  const client = adminResult.value;

  // 3 count を並列発行する (性能予算は呼び出し側 getNavBadgeCounts が本関数全体に掛ける)。
  const [inquiries, calls, tasks] = await Promise.all([
    countUnhandledInquiries(client),
    countReviewCalls(client),
    countDueOrOverdueTasks(client),
  ]);

  // 部分失敗は「全非表示」に倒す (#129 実装方針: 単純な方を選び挙動をテストで固定)。
  // どれか 1 つでも err なら集計全体を KMB-E001 として失敗させる (握り潰さない)。
  if (!inquiries.ok) return { ok: false, code: "KMB-E001", detail: inquiries.detail };
  if (!calls.ok) return { ok: false, code: "KMB-E001", detail: calls.detail };
  if (!tasks.ok) return { ok: false, code: "KMB-E001", detail: tasks.detail };

  const value: NavBadgeCounts = {
    inquiries: inquiries.value,
    calls: calls.value,
    tasks: tasks.value,
  };
  return { ok: true, value };
}

export const navBadgesFacade: NavBadgesFacade = {
  async getNavBadgeCounts() {
    try {
      // 認可 (requireAdminClient) + 3 count の**全体**をタイムアウト予算で括る。認可を budget 外へ
      // 出さないことで、Supabase Auth / プロファイル取得がハングしても全 admin ページの描画が
      // 無制限にブロックされず、E002 で縮退する (badge 非表示・レイアウトは継続描画)。
      // タイムアウト後に collectNavBadgeCounts が遅れて reject しても、withTimeout が
      // then(onFulfilled, onRejected) を同期アタッチ済みで settle 後の reject は no-op のため、
      // 未処理 rejection にはならない。
      const raced = await withTimeout(collectNavBadgeCounts(), NAV_BADGE_TIMEOUT_MS);

      if (raced.timedOut) {
        return {
          ok: false,
          code: "KMB-E002",
          detail: `ナビバッジ集計が ${NAV_BADGE_TIMEOUT_MS}ms を超過しました`,
        };
      }

      // 認可失敗 (E201/E202) / 部分失敗 (E001) / 成功のいずれも collectNavBadgeCounts が
      // Result で返す (タイムアウト E002 とは別経路)。
      return raced.value;
    } catch (err) {
      return { ok: false, code: "KMB-E001", detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
