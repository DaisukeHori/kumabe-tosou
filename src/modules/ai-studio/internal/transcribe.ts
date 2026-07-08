import "server-only";

import OpenAI, { toFile } from "openai";

import type { KmbErrorCode, Result } from "@/modules/platform/contracts";

/**
 * 文字起こし (canonical: docs/design/cms-ai-pipeline.md §7.3)。
 * モデル: gpt-4o-transcribe ($0.006/分、品質優先方針)。
 * MediaRecorder の webm (Chrome) / mp4 (Safari) はいずれも変換不要 (調査確定)。
 * 上限: 25MB (OpenAI 制約、KMB-E303)。専門用語は prompt パラメータで注入 (精度対策)。
 */
const MODEL = "gpt-4o-transcribe" as const;
const MAX_BYTES = 25 * 1024 * 1024;

/** 隈部塗装の専門用語 (§7.3 精度対策)。誤認識訂正の補助として prompt に注入する。 */
const TERMINOLOGY_PROMPT =
  "隈部塗装、ソウルレッド、プライマー、耐候クリア、サフェーサー、コンパウンド、ガンコート";

let cachedClient: OpenAI | undefined;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が未設定です (AI スタジオは無効化されています)。");
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/** OPENAI_API_KEY が設定済みかどうか (graceful degradation 判定用) */
export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function transcribeAudio(
  bytes: Buffer,
  filename: string,
): Promise<Result<{ text: string }>> {
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, code: "KMB-E303", detail: "25MB を超えています" };
  }

  try {
    const client = getClient();
    const file = await toFile(bytes, filename);
    const transcription = await client.audio.transcriptions.create({
      file,
      model: MODEL,
      prompt: TERMINOLOGY_PROMPT,
    });
    return { ok: true, value: { text: transcription.text } };
  } catch (err) {
    const code: KmbErrorCode = "KMB-E405";
    return { ok: false, code, detail: err instanceof Error ? err.message : String(err) };
  }
}
