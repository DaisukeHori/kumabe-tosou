/**
 * TwiML 生成純関数群 (canonical: docs/design/crm-suite/04-telephony.md §6.2)。
 *
 * ★実装方針の変更 (オーケストレーターへ報告済み): 04-telephony.md は `twilio` npm SDK の
 * `twiml.VoiceResponse` の利用を前提に書かれているが、本実装では twilio パッケージを
 * 一切追加・import しない (依存追加禁止の運用判断)。XML は文字列組み立て + 手書き
 * エスケープ (escapeXml) で生成する。要素・属性値は §6.2 の XML 例と 1:1 で一致させる。
 *
 * 全て入力を受け取って XML 文字列を返す純関数 (DB/env に触れない — 単体テスト対象)。
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/** XML エスケープ (設定文言に `<>&"'` が含まれる場合の対策 — 単体テスト対象)。 */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 既定文言 (04-telephony.md §6.2。settings 未設定/null 時のフォールバック)。 */
export const DEFAULT_CONSENT_TEXT = "品質向上のため、この通話は録音されます。";
export const DEFAULT_IN_HOURS_GREETING_TEXT =
  "ただいま作業中のため電話に出られません。ご用件を発信音のあとにお話しください。";
export const DEFAULT_AFTER_HOURS_GREETING_TEXT =
  "本日の営業は終了しました。ご用件を発信音のあとにお話しください。翌営業日にご連絡いたします。";
/** (c) dial_result 不成立フォールバック専用の固定文言 (settings では差替不可 — §6.2 (b)/(c) の差分)。 */
const DIAL_RESULT_FALLBACK_TEXT = "ただいま電話に出られません。ご用件を発信音のあとにお話しください。";
const RECORD_FAILURE_TEXT = "録音を確認できませんでした。失礼いたします。";
const RECORDED_ACK_TEXT = "ありがとうございました。失礼いたします。";
const GREETING_PREFIX = "お電話ありがとうございます。";

export type ForwardTwimlParams = {
  consentEnabled: boolean;
  consentText: string | null; // null → DEFAULT_CONSENT_TEXT
  forwardToE164: string;
  baseUrl: string; // NEXT_PUBLIC_SITE_URL (末尾スラッシュなし想定)
};

/** (a) 営業時間内 + 転送先あり (§6.2-a)。 */
export function buildForwardTwiml(params: ForwardTwimlParams): string {
  const consentSay = params.consentEnabled
    ? `<Say language="ja-JP">${escapeXml(GREETING_PREFIX + (params.consentText ?? DEFAULT_CONSENT_TEXT))}</Say>`
    : "";
  return (
    XML_HEADER +
    "<Response>" +
    consentSay +
    `<Dial record="record-from-answer-dual" recordingStatusCallback="${escapeXml(params.baseUrl)}/api/telephony/recording-status" recordingStatusCallbackEvent="completed" timeout="20" action="${escapeXml(params.baseUrl)}/api/telephony/voice?step=dial_result" method="POST">` +
    `<Number>${escapeXml(params.forwardToE164)}</Number>` +
    "</Dial>" +
    "</Response>"
  );
}

function renderRecordFlow(sayText: string, voicemailMaxSeconds: number, baseUrl: string): string {
  return (
    XML_HEADER +
    "<Response>" +
    `<Say language="ja-JP">${escapeXml(sayText)}</Say>` +
    `<Record maxLength="${voicemailMaxSeconds}" playBeep="true" finishOnKey="#" recordingStatusCallback="${escapeXml(baseUrl)}/api/telephony/recording-status" recordingStatusCallbackEvent="completed" action="${escapeXml(baseUrl)}/api/telephony/voice?step=recorded" method="POST"/>` +
    `<Say language="ja-JP">${escapeXml(RECORD_FAILURE_TEXT)}</Say>` +
    "</Response>"
  );
}

export type VoicemailTwimlParams = {
  greetingText: string | null; // null → DEFAULT_IN_HOURS_GREETING_TEXT (fromDialFallback=true 時は無視)
  consentEnabled: boolean;
  consentText: string | null;
  /** true = §6.2 (c) dial_result 不成立フォールバック (同意アナウンスを含めない — root で再生済み)。 */
  fromDialFallback: boolean;
  voicemailMaxSeconds: number;
  baseUrl: string;
};

/** (b) 営業時間内 + 転送先なし / (c) dial_result 不成立フォールバック (§6.2-b/c)。 */
export function buildVoicemailTwiml(params: VoicemailTwimlParams): string {
  const sayText = params.fromDialFallback
    ? DIAL_RESULT_FALLBACK_TEXT
    : GREETING_PREFIX +
      (params.consentEnabled ? (params.consentText ?? DEFAULT_CONSENT_TEXT) : "") +
      (params.greetingText ?? DEFAULT_IN_HOURS_GREETING_TEXT);
  return renderRecordFlow(sayText, params.voicemailMaxSeconds, params.baseUrl);
}

export type AfterHoursTwimlParams = {
  afterHoursGreetingText: string | null; // null → DEFAULT_AFTER_HOURS_GREETING_TEXT
  consentEnabled: boolean;
  consentText: string | null;
  voicemailMaxSeconds: number;
  baseUrl: string;
};

/** (d) 営業時間外 (§6.2-d)。(b) と同型で導入文言のみ差し替え。 */
export function buildAfterHoursTwiml(params: AfterHoursTwimlParams): string {
  const sayText =
    GREETING_PREFIX +
    (params.consentEnabled ? (params.consentText ?? DEFAULT_CONSENT_TEXT) : "") +
    (params.afterHoursGreetingText ?? DEFAULT_AFTER_HOURS_GREETING_TEXT);
  return renderRecordFlow(sayText, params.voicemailMaxSeconds, params.baseUrl);
}

/** dial_result: completed/answered (§6.1 表)。 */
export function buildHangupTwiml(): string {
  return `${XML_HEADER}<Response><Hangup/></Response>`;
}

/** step=recorded の応答 (§6.1 表)。 */
export function buildRecordedAckTwiml(): string {
  return `${XML_HEADER}<Response><Say language="ja-JP">${escapeXml(RECORDED_ACK_TEXT)}</Say><Hangup/></Response>`;
}

/** status callback の応答 (常に 200・空 TwiML — §7.3)。 */
export function buildEmptyTwiml(): string {
  return `${XML_HEADER}<Response/>`;
}
