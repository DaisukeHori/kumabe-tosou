/**
 * プロバイダ呼び出し (openai.ts / anthropic.ts / gemini.ts) が共通で返すエラー分類。
 * router.ts はこの分類だけを見てキー選択のフォールバック方針を決める
 * (canonical: docs/design/ai-studio-v2.md §1 MAJOR-1)。
 *
 * - auth: 401/403 (キー無効・org 権限不足) → 当該キーを status='failed' に落として次のキーへ
 * - rate_limit: 429 → Retry-After を尊重して cooldown_until 設定 (status='limited')、次のキーへ
 * - model_not_found: 404/400 の model not found → 次のキーへ (ログのみ、status は変えない)
 * - network: ネットワーク/5xx → 1 回リトライ後に次のキーへ
 * - refusal: Anthropic の stop_reason==='refusal' 相当 (呼び出し自体は成功しているが
 *   出力を拒否された状態。ai-studio 側の KMB-E403 に相当するため router はこれを
 *   キー起因の失敗として扱わない — 呼び出し元にそのまま返す)
 * - other: 上記以外
 */
export type ProviderCallError =
  | { kind: "auth"; message: string }
  | { kind: "rate_limit"; message: string; retryAfterSeconds: number | null }
  | { kind: "model_not_found"; message: string }
  | { kind: "network"; message: string }
  | { kind: "refusal"; message: string }
  | { kind: "other"; message: string };

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: ProviderCallError };

export function providerErrorDetail(error: ProviderCallError): string {
  return `[${error.kind}] ${error.message}`;
}
