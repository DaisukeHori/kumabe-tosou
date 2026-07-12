import "server-only";

import { getEnv } from "@/lib/env";
import type { Result } from "@/modules/platform/contracts";

/**
 * Twilio 録音 DL / 削除の薄い fetch ラッパー (canonical: docs/design/crm-suite/04-telephony.md
 * §6.5.1-2/5、§4.6、§1.2)。twilio SDK は使わない (素の fetch のみ — SDK に録音DL/削除の薄い
 * ラッパーが無いため元々 fetch で書く設計。twilio SDK 直 import は internal/twilio-signature.ts・
 * internal/twiml.ts のみ許可 — ESLint 強制、00-overview §2.2)。
 *
 * URL 組み立て: RecordingUrl (例 `https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx`)
 * の末尾に `.wav` / `.json` を素朴に文字列連結する (Twilio 公式仕様どおり)。
 *
 * 404 判定: `Result<{bytes,contentType}|{notFound:true}>` の判別共用体で返す。呼び出し側
 * (worker.ts の handleDownloading) が `detail` 文字列の `.includes('404')` のような脆い判定を
 * せずに済むようにするための設計 (04-telephony.md §6.5.1-2 実装者判断ポイント)。
 */

const RECORDING_REQUEST_TIMEOUT_MS = 60_000;

export type DownloadRecordingOutcome = { bytes: Uint8Array; contentType: string } | { notFound: true };

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

/**
 * TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN (getEnv() — env.ts に既定義。追加不要) の両方が
 * 設定済みであることを確認する。未設定は KMB-E802 (電話連携が未設定です) として返す
 * (worker がこの結果をそのまま不確定 return として扱う設計 — §6.5 共通則)。
 */
function resolveTwilioCredentials(): Result<{ accountSid: string; authToken: string }> {
  const env = getEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return {
      ok: false,
      code: "KMB-E802",
      detail: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN が未設定のため録音を取得できません",
    };
  }
  return { ok: true, value: { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN } };
}

/**
 * `GET {twilioUrl}.wav` (Basic 認証、AbortSignal.timeout(60_000))。
 * 404 は確定エラーにせず `{notFound:true}` (ok:true) で返す — 404 が「録音が存在しない (最終確定)」
 * なのか「Twilio 側の録音生成遅延で一時的にまだ無い」なのかは呼び出し側 (worker) が
 * `stage_attempts` を見て判断する (§6.5.1-2)。ネットワーク断・非 404 の異常系は KMB-E805
 * (録音の取得または保存に失敗しました) の ok:false で返す。
 */
export async function downloadRecording(twilioUrl: string): Promise<Result<DownloadRecordingOutcome>> {
  const credentials = resolveTwilioCredentials();
  if (!credentials.ok) return credentials;

  try {
    const res = await fetch(`${twilioUrl}.wav`, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(credentials.value.accountSid, credentials.value.authToken) },
      signal: AbortSignal.timeout(RECORDING_REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404) {
      return { ok: true, value: { notFound: true } };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        code: "KMB-E805",
        detail: `録音のダウンロードに失敗しました (status=${res.status}): ${detail}`,
      };
    }

    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "audio/wav";
    return { ok: true, value: { bytes: new Uint8Array(arrayBuffer), contentType } };
  } catch (err) {
    return { ok: false, code: "KMB-E805", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `DELETE {twilioUrl}.json` (Basic 認証、AbortSignal.timeout(60_000))。
 * ベストエフォート運用 (§6.5.1-5) — 成否を Result で正確に返す (握り潰さない)。
 * 失敗時に前進を諦めるかどうかは呼び出し側 (worker.ts) の判断であり、本関数は成否のみ返す。
 * 既に削除済み (404) は冪等に成功扱いとする (Twilio 側の DELETE は冪等 — §5.5「実行系」)。
 */
export async function deleteRecording(twilioUrl: string): Promise<Result<void>> {
  const credentials = resolveTwilioCredentials();
  if (!credentials.ok) return credentials;

  try {
    const res = await fetch(`${twilioUrl}.json`, {
      method: "DELETE",
      headers: { Authorization: basicAuthHeader(credentials.value.accountSid, credentials.value.authToken) },
      signal: AbortSignal.timeout(RECORDING_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        code: "KMB-E805",
        detail: `録音の削除に失敗しました (status=${res.status}): ${detail}`,
      };
    }
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, code: "KMB-E805", detail: err instanceof Error ? err.message : String(err) };
  }
}
