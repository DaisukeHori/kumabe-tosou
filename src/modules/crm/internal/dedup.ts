import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";

import {
  findDuplicateCandidates as findDuplicateCandidatesRepo,
  makeSupabaseMergePointerLookup,
  resolveMergedCustomerId,
  type CustomerDuplicateCandidate,
} from "../repository";

export type { CustomerDuplicateCandidate };

/**
 * dedup 利用点の共通判定 (01-crm.md §6.3)。createCustomer / matchCustomerByPhone / intake の
 * 3 利用点は同じ 0 件・1 件・2 件以上の分類を受け取り、各々異なる Result へ変換する
 * (分岐そのものは facade/intake.ts の責務 — 本ファイルは分類のみ)。
 */
export type DedupOutcome =
  | { kind: "none" }
  | { kind: "single"; candidate: CustomerDuplicateCandidate }
  | { kind: "multiple"; candidates: CustomerDuplicateCandidate[] };

/** 純関数 — 単体テスト対象 (tests/crm-dedup.test.ts は #42 スコープだが本関数もそこでカバーされる) */
export function classifyDedupCandidates(candidates: CustomerDuplicateCandidate[]): DedupOutcome {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "single", candidate: candidates[0] };
  return { kind: "multiple", candidates };
}

/**
 * repository.findDuplicateCandidates (§6.3 全文 — マージポインタ終端解決込み) を呼び出し、
 * 結果を classifyDedupCandidates で分類する。DB エラーはそのまま Result.ok=false で伝播する
 * (呼び出し元が候補 0 件と誤認しないよう、エラーを握り潰さない)。
 */
export async function resolveDuplicates(
  client: SupabaseClient,
  email: string | null,
  telE164: string | null,
): Promise<Result<DedupOutcome>> {
  const found = await findDuplicateCandidatesRepo(client, email, telE164);
  if (!found.ok) return found;
  return { ok: true, value: classifyDedupCandidates(found.value) };
}

/**
 * customer_id をマージポインタの終端 (勝者) まで解決する (§6.3 手順 3 と同一ロジック)。
 * getCustomerRef/getDealRef/matchCustomerByPhone が「旧 id で呼んでも勝者の現行値を返す」
 * ために使う共通ヘルパ (facade #43)。
 *
 * repository.makeSupabaseMergePointerLookup は DB エラー時に repository 内部専用の非公開
 * Error クラスを throw する (「終端 (転送ポインタなし)」への誤フォールバックを防ぐための印 —
 * repository.ts のコメント参照)。本ファイルからはそのクラスを import できないため、
 * catch 節では詳細なエラーコード復元はできず KMB-E901 に丸めるが、Result.ok=false で
 * 確実に呼び出し元へ伝播させる (エラーを握り潰して「終端解決できた」ことにはしない)。
 */
export async function resolveCustomerWinnerId(
  client: SupabaseClient,
  customerId: string,
): Promise<Result<string>> {
  try {
    const lookup = makeSupabaseMergePointerLookup(client);
    const resolved = await resolveMergedCustomerId(lookup, customerId);
    return { ok: true, value: resolved };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}
