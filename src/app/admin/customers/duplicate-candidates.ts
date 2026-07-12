export type DuplicateCandidate = { id: string; name: string };

/**
 * KMB-E601 (crm/facade.ts createCustomer) の detail を復元する共通ヘルパー。
 *
 * facade 側は detail を JSON 配列文字列 `[{"customer_id":...,"name":...}, ...]` で返す
 * (顧客名・会社名にカンマを含み得るため、単純なカンマ区切り文字列にすると分裂して壊れる —
 * 例: "ABC Trading, Inc." のような法人名で候補が誤分割され、壊れた id で
 * /admin/customers/${id} に遷移してしまう)。JSON.parse に失敗した場合や形の合わない要素は
 * 安全側 (誤った id/name を UI に渡さない) で無視し、空配列にフォールバックする。
 */
export function parseDuplicateCandidates(detail: string | undefined): DuplicateCandidate[] {
  if (!detail) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: DuplicateCandidate[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const { customer_id, name } = record;
    if (typeof customer_id !== "string" || typeof name !== "string") continue;
    result.push({ id: customer_id, name });
  }
  return result;
}
