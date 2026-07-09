import "server-only";

import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import type { KmbErrorCode, Result } from "@/modules/platform/contracts";

/**
 * 文字起こし (canonical: docs/design/cms-ai-pipeline.md §7.3)。
 * モデル: gpt-4o-transcribe ($0.006/分、品質優先方針)。
 * MediaRecorder の webm (Chrome) / mp4 (Safari) はいずれも変換不要 (調査確定)。
 * 上限: 25MB (OpenAI 制約、KMB-E303)。専門用語は prompt パラメータで注入 (精度対策)。
 *
 * P1 移行 (ai-studio-v2.md §1 受入条件・全量ルータ移行): 実際の API 呼び出し・キー選択/
 * フォールバック・usage 記録・予算ガードは ai-providers モジュール
 * (aiProvidersFacade.transcribe, feature='transcribe') に移管した。
 * キー解決は ai_provider_keys に openai キーの登録があればそれ、無ければ環境変数
 * OPENAI_API_KEY をフォールバック (既存動作の非退行)。
 */
const MODEL = "gpt-4o-transcribe" as const;
const MAX_BYTES = 25 * 1024 * 1024;

/** 隈部塗装の専門用語 (§7.3 精度対策)。誤認識訂正の補助として prompt に注入する。 */
const TERMINOLOGY_PROMPT =
  "隈部塗装、ソウルレッド、プライマー、耐候クリア、サフェーサー、コンパウンド、ガンコート";

export async function transcribeAudio(
  bytes: Buffer,
  filename: string,
): Promise<Result<{ text: string }>> {
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, code: "KMB-E303", detail: "25MB を超えています" };
  }

  const result = await aiProvidersFacade.transcribe({
    feature: "transcribe",
    filename,
    audioBase64: bytes.toString("base64"),
    prompt: TERMINOLOGY_PROMPT,
    model: MODEL,
  });
  if (!result.ok) {
    const code: KmbErrorCode = result.code === "KMB-E407" || result.code === "KMB-E408" ? result.code : "KMB-E405";
    return { ok: false, code, detail: result.detail };
  }
  return { ok: true, value: { text: result.value.text } };
}
