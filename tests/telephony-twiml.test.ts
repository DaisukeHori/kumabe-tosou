import { describe, expect, it } from "vitest";

import {
  buildAfterHoursTwiml,
  buildEmptyTwiml,
  buildForwardTwiml,
  buildHangupTwiml,
  buildRecordedAckTwiml,
  buildVoicemailTwiml,
  DEFAULT_AFTER_HOURS_GREETING_TEXT,
  DEFAULT_CONSENT_TEXT,
  DEFAULT_IN_HOURS_GREETING_TEXT,
  escapeXml,
} from "@/modules/telephony/internal/twiml";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §6.2 (全パターン XML 例) / §12.1
 *   (tests/telephony-twiml.test.ts の必須ケース一覧)。
 *
 * internal/twiml.ts は twilio npm SDK (twiml.VoiceResponse) を使わず、文字列組み立て +
 * 手書き XML エスケープで生成する純関数群 (依存追加禁止の運用判断)。本ファイルは
 * (a) 営業時間内+転送先あり (forward) / (b) 営業時間内+転送先なし (voicemail) /
 * (c) dial_result 不成立フォールバック (voicemail, fromDialFallback=true) /
 * (d) 営業時間外 (after-hours) の 4 パターンと、consent 文言 ON/OFF・既定文言フォールバック・
 * XML エスケープを検証する。(b) と (c) は「同意アナウンスの有無」が最大の差分 (地雷) であり、
 * 重点的に検証する。
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const GREETING_PREFIX = "お電話ありがとうございます。";
// internal/twiml.ts 側では export されていない固定文言 (§6.2 の仕様上の固定値)。
// 実装の変更を検知するための golden 値としてここに複製する (import はしない — 非公開定数のため)。
const DIAL_RESULT_FALLBACK_TEXT = "ただいま電話に出られません。ご用件を発信音のあとにお話しください。";
const RECORD_FAILURE_TEXT = "録音を確認できませんでした。失礼いたします。";
const RECORDED_ACK_TEXT = "ありがとうございました。失礼いたします。";

const BASE_URL = "https://kumabe-tosou.example.com";

function expectedRecordFlow(sayText: string, voicemailMaxSeconds: number, baseUrl: string): string {
  return (
    XML_HEADER +
    "<Response>" +
    `<Say language="ja-JP">${escapeXml(sayText)}</Say>` +
    `<Record maxLength="${voicemailMaxSeconds}" playBeep="true" finishOnKey="#" recordingStatusCallback="${escapeXml(baseUrl)}/api/telephony/recording-status" recordingStatusCallbackEvent="completed" action="${escapeXml(baseUrl)}/api/telephony/voice?step=recorded" method="POST"/>` +
    `<Say language="ja-JP">${escapeXml(RECORD_FAILURE_TEXT)}</Say>` +
    "</Response>"
  );
}

describe("escapeXml", () => {
  it("5 種の特殊文字 (& < > \" ') をすべてエスケープする", () => {
    expect(escapeXml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&apos;");
  });

  it("特殊文字を含まない文字列はそのまま返す (日本語含む)", () => {
    expect(escapeXml("品質向上のため、この通話は録音されます。")).toBe("品質向上のため、この通話は録音されます。");
  });

  it("& を含む文字列を他の記号と混在させても二重エスケープしない (処理順序の正しさ)", () => {
    // & を先にエスケープしても、後続の <>"' 置換が "&amp;" の中の文字を誤って再エスケープしないこと
    expect(escapeXml("A&B<C>D")).toBe("A&amp;B&lt;C&gt;D");
  });

  it("空文字はそのまま空文字を返す", () => {
    expect(escapeXml("")).toBe("");
  });
});

describe("buildForwardTwiml ((a) 営業時間内 + 転送先あり)", () => {
  const base = {
    forwardToE164: "+819012345678",
    baseUrl: BASE_URL,
  };

  it("consentEnabled=true, consentText=null → 既定文言 (DEFAULT_CONSENT_TEXT) で <Say> が先頭に入る", () => {
    const twiml = buildForwardTwiml({ ...base, consentEnabled: true, consentText: null });
    const expectedSay = `<Say language="ja-JP">${escapeXml(GREETING_PREFIX + DEFAULT_CONSENT_TEXT)}</Say>`;
    const expected =
      XML_HEADER +
      "<Response>" +
      expectedSay +
      `<Dial record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/telephony/recording-status" recordingStatusCallbackEvent="completed" timeout="20" action="${BASE_URL}/api/telephony/voice?step=dial_result" method="POST">` +
      `<Number>+819012345678</Number>` +
      "</Dial>" +
      "</Response>";
    expect(twiml).toBe(expected);
  });

  it("consentEnabled=true, consentText=カスタム文言 → 既定文言ではなくカスタム文言を使う", () => {
    const twiml = buildForwardTwiml({ ...base, consentEnabled: true, consentText: "この通話はテスト用に録音されます" });
    expect(twiml).toContain(escapeXml(GREETING_PREFIX + "この通話はテスト用に録音されます"));
    expect(twiml).not.toContain(DEFAULT_CONSENT_TEXT);
  });

  it("consentEnabled=false → <Say> (同意アナウンス) が一切出力されない", () => {
    const twiml = buildForwardTwiml({ ...base, consentEnabled: false, consentText: null });
    expect(twiml).not.toContain("<Say");
    expect(twiml).toBe(
      XML_HEADER +
        "<Response>" +
        `<Dial record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/telephony/recording-status" recordingStatusCallbackEvent="completed" timeout="20" action="${BASE_URL}/api/telephony/voice?step=dial_result" method="POST">` +
        `<Number>+819012345678</Number>` +
        "</Dial>" +
        "</Response>",
    );
  });

  it("Dial 要素の属性が仕様どおり (record=dual / timeout=20 / recordingStatusCallbackEvent=completed / action に ?step=dial_result)", () => {
    const twiml = buildForwardTwiml({ ...base, consentEnabled: false, consentText: null });
    expect(twiml).toContain('record="record-from-answer-dual"');
    expect(twiml).toContain('timeout="20"');
    expect(twiml).toContain('recordingStatusCallbackEvent="completed"');
    expect(twiml).toContain(`action="${BASE_URL}/api/telephony/voice?step=dial_result"`);
    expect(twiml).toContain(`recordingStatusCallback="${BASE_URL}/api/telephony/recording-status"`);
    expect(twiml).toContain('method="POST"');
  });

  it("baseUrl に XML 特殊文字が含まれる場合もエスケープされる (防御的)", () => {
    const twiml = buildForwardTwiml({ ...base, consentEnabled: false, consentText: null, baseUrl: "https://x.example.com?a=1&b=2" });
    expect(twiml).toContain("https://x.example.com?a=1&amp;b=2/api/telephony/recording-status");
  });
});

describe("buildVoicemailTwiml ((b) 営業時間内 + 転送先なし)", () => {
  const base = {
    fromDialFallback: false,
    voicemailMaxSeconds: 120,
    baseUrl: BASE_URL,
  };

  it("greetingText=null, consentEnabled=true, consentText=null → 既定同意文言 + 既定営業時間内挨拶が連結される", () => {
    const twiml = buildVoicemailTwiml({ ...base, greetingText: null, consentEnabled: true, consentText: null });
    const sayText = GREETING_PREFIX + DEFAULT_CONSENT_TEXT + DEFAULT_IN_HOURS_GREETING_TEXT;
    expect(twiml).toBe(expectedRecordFlow(sayText, 120, BASE_URL));
  });

  it("consentEnabled=false → 同意文言が連結されない (挨拶文言のみ)", () => {
    const twiml = buildVoicemailTwiml({ ...base, greetingText: null, consentEnabled: false, consentText: null });
    const sayText = GREETING_PREFIX + DEFAULT_IN_HOURS_GREETING_TEXT;
    expect(twiml).toBe(expectedRecordFlow(sayText, 120, BASE_URL));
    expect(twiml).not.toContain(DEFAULT_CONSENT_TEXT);
  });

  it("greetingText=カスタム → 既定挨拶ではなくカスタム文言を使う", () => {
    const twiml = buildVoicemailTwiml({
      ...base,
      greetingText: "ただいま留守にしております",
      consentEnabled: false,
      consentText: null,
    });
    expect(twiml).toContain(escapeXml(GREETING_PREFIX + "ただいま留守にしております"));
    expect(twiml).not.toContain(DEFAULT_IN_HOURS_GREETING_TEXT);
  });

  it("Record 要素の属性が仕様どおり (maxLength=voicemailMaxSeconds / playBeep=true / finishOnKey=# / action に ?step=recorded)", () => {
    const twiml = buildVoicemailTwiml({ ...base, greetingText: null, consentEnabled: false, consentText: null, voicemailMaxSeconds: 90 });
    expect(twiml).toContain('maxLength="90"');
    expect(twiml).toContain('playBeep="true"');
    expect(twiml).toContain('finishOnKey="#"');
    expect(twiml).toContain(`action="${BASE_URL}/api/telephony/voice?step=recorded"`);
    expect(twiml).toContain(`recordingStatusCallback="${BASE_URL}/api/telephony/recording-status"`);
  });

  it("Record が不成立だった場合の案内 (RECORD_FAILURE_TEXT) が末尾の <Say> に含まれる", () => {
    const twiml = buildVoicemailTwiml({ ...base, greetingText: null, consentEnabled: false, consentText: null });
    expect(twiml).toContain(escapeXml(RECORD_FAILURE_TEXT));
  });
});

describe("buildVoicemailTwiml ((c) dial_result 不成立フォールバック — fromDialFallback=true)", () => {
  it("同意アナウンス・挨拶文言を一切含まない固定文言のみになる (root で既に同意再生済みのため二重再生しない — 最重要地雷)", () => {
    const twiml = buildVoicemailTwiml({
      fromDialFallback: true,
      greetingText: "無視されるべき挨拶文言",
      consentEnabled: true,
      consentText: "無視されるべき同意文言",
      voicemailMaxSeconds: 120,
      baseUrl: BASE_URL,
    });
    expect(twiml).toBe(expectedRecordFlow(DIAL_RESULT_FALLBACK_TEXT, 120, BASE_URL));
    expect(twiml).not.toContain("無視されるべき挨拶文言");
    expect(twiml).not.toContain("無視されるべき同意文言");
    expect(twiml).not.toContain(GREETING_PREFIX);
  });

  it("consentEnabled=false・greetingText=null のとき ((b) の最小構成) と比べても (c) は同じ固定文言になる (パラメータに左右されない)", () => {
    const twimlAllUnset = buildVoicemailTwiml({
      fromDialFallback: true,
      greetingText: null,
      consentEnabled: false,
      consentText: null,
      voicemailMaxSeconds: 120,
      baseUrl: BASE_URL,
    });
    const twimlAllSet = buildVoicemailTwiml({
      fromDialFallback: true,
      greetingText: "カスタム挨拶",
      consentEnabled: true,
      consentText: "カスタム同意",
      voicemailMaxSeconds: 120,
      baseUrl: BASE_URL,
    });
    expect(twimlAllUnset).toBe(twimlAllSet);
  });

  it("(b) と (c) は同じ設定値でも異なる TwiML になる (fromDialFallback の分岐が実際に効いている)", () => {
    const settings = {
      greetingText: null as string | null,
      consentEnabled: true,
      consentText: null as string | null,
      voicemailMaxSeconds: 120,
      baseUrl: BASE_URL,
    };
    const bTwiml = buildVoicemailTwiml({ ...settings, fromDialFallback: false });
    const cTwiml = buildVoicemailTwiml({ ...settings, fromDialFallback: true });
    expect(bTwiml).not.toBe(cTwiml);
  });
});

describe("buildAfterHoursTwiml ((d) 営業時間外)", () => {
  const base = { voicemailMaxSeconds: 120, baseUrl: BASE_URL };

  it("afterHoursGreetingText=null → 既定の時間外文言 (DEFAULT_AFTER_HOURS_GREETING_TEXT) を使う", () => {
    const twiml = buildAfterHoursTwiml({ ...base, afterHoursGreetingText: null, consentEnabled: true, consentText: null });
    const sayText = GREETING_PREFIX + DEFAULT_CONSENT_TEXT + DEFAULT_AFTER_HOURS_GREETING_TEXT;
    expect(twiml).toBe(expectedRecordFlow(sayText, 120, BASE_URL));
  });

  it("consentEnabled=false → 同意文言が入らない", () => {
    const twiml = buildAfterHoursTwiml({ ...base, afterHoursGreetingText: null, consentEnabled: false, consentText: null });
    expect(twiml).not.toContain(DEFAULT_CONSENT_TEXT);
  });

  it("afterHoursGreetingText=カスタム → カスタム文言を使う", () => {
    const twiml = buildAfterHoursTwiml({
      ...base,
      afterHoursGreetingText: "本日は休業日です",
      consentEnabled: false,
      consentText: null,
    });
    expect(twiml).toContain(escapeXml(GREETING_PREFIX + "本日は休業日です"));
  });

  it("時間外 (d) の既定挨拶は営業時間内 (b) の既定挨拶と異なる文言である (営業時間内外の分岐が実際に別テキストへ落ちること)", () => {
    expect(DEFAULT_AFTER_HOURS_GREETING_TEXT).not.toBe(DEFAULT_IN_HOURS_GREETING_TEXT);
    const inHoursTwiml = buildVoicemailTwiml({
      fromDialFallback: false,
      greetingText: null,
      consentEnabled: false,
      consentText: null,
      voicemailMaxSeconds: 120,
      baseUrl: BASE_URL,
    });
    const afterHoursTwiml = buildAfterHoursTwiml({ ...base, afterHoursGreetingText: null, consentEnabled: false, consentText: null });
    expect(inHoursTwiml).not.toBe(afterHoursTwiml);
    expect(inHoursTwiml).toContain(escapeXml(DEFAULT_IN_HOURS_GREETING_TEXT));
    expect(afterHoursTwiml).toContain(escapeXml(DEFAULT_AFTER_HOURS_GREETING_TEXT));
  });
});

describe("buildHangupTwiml / buildRecordedAckTwiml / buildEmptyTwiml (固定 TwiML)", () => {
  it("buildHangupTwiml は <Hangup/> のみの応答を返す (dial_result 成立時)", () => {
    expect(buildHangupTwiml()).toBe(`${XML_HEADER}<Response><Hangup/></Response>`);
  });

  it("buildRecordedAckTwiml はお礼文言 + <Hangup/> を返す (step=recorded)", () => {
    expect(buildRecordedAckTwiml()).toBe(
      `${XML_HEADER}<Response><Say language="ja-JP">${escapeXml(RECORDED_ACK_TEXT)}</Say><Hangup/></Response>`,
    );
  });

  it("buildEmptyTwiml は空の <Response/> を返す (status callback 応答)", () => {
    expect(buildEmptyTwiml()).toBe(`${XML_HEADER}<Response/>`);
  });

  it("いずれも妥当な XML 宣言ヘッダで始まる", () => {
    for (const twiml of [buildHangupTwiml(), buildRecordedAckTwiml(), buildEmptyTwiml()]) {
      expect(twiml.startsWith(XML_HEADER)).toBe(true);
    }
  });
});

describe("XML エスケープの統合確認 (設定文言に特殊文字が含まれる場合)", () => {
  it("consentText に <>&\"' を含めても壊れた XML にならず全てエスケープされる", () => {
    const twiml = buildForwardTwiml({
      forwardToE164: "+819012345678",
      baseUrl: BASE_URL,
      consentEnabled: true,
      consentText: `録音<注意>&"必須"'`,
    });
    expect(twiml).toContain(escapeXml(GREETING_PREFIX + `録音<注意>&"必須"'`));
    expect(twiml).not.toContain("<注意>");
    expect(twiml).not.toContain('録音<');
  });

  it("greetingText に特殊文字を含めてもエスケープされる (voicemail)", () => {
    const twiml = buildVoicemailTwiml({
      fromDialFallback: false,
      greetingText: `<script>alert('x')</script>`,
      consentEnabled: false,
      consentText: null,
      voicemailMaxSeconds: 120,
      baseUrl: BASE_URL,
    });
    expect(twiml).not.toContain("<script>");
    expect(twiml).toContain(escapeXml(`<script>alert('x')</script>`));
  });
});
