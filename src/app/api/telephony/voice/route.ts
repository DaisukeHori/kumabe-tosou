import { NextResponse } from "next/server";

import { zDialResultWebhook, zInboundCallWebhook } from "@/modules/telephony/contracts";
import { telephonyFacade } from "@/modules/telephony/facade";

import { pickWithNullFill, verifyTelephonyWebhook } from "../shared";

/**
 * 着信 webhook (canonical: docs/design/crm-suite/04-telephony.md §6.1)。
 * 同期応答 (TwiML が応答本体のため after() は使わない)。15 秒制約 (§6.1 冒頭)。
 */
export const maxDuration = 30;

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" } as const;

function xmlResponse(twiml: string, status = 200): NextResponse {
  return new NextResponse(twiml, { status, headers: XML_HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  const verification = await verifyTelephonyWebhook(request);
  if (!verification.ok) {
    return NextResponse.json({ code: verification.code }, { status: verification.status });
  }
  const { params } = verification;

  const url = new URL(request.url);
  const step = url.searchParams.get("step");

  if (step === "dial_result") {
    const picked = pickWithNullFill(params, ["CallSid", "DialCallStatus", "DialCallDuration"]);
    const parsed = zDialResultWebhook.safeParse(picked);
    if (!parsed.success) {
      console.error(
        "KMB-E803: /api/telephony/voice?step=dial_result のパラメータが契約と不一致です",
        parsed.error.issues,
      );
      return xmlResponse("", 500); // Twilio が Fallback URL へ (§6.7)
    }

    const result = await telephonyFacade.handleDialResult(parsed.data, { mode: "service" });
    if (!result.ok) {
      console.error(`${result.code}: handleDialResult に失敗しました`, result.detail);
      return xmlResponse("", 500);
    }
    return xmlResponse(result.value.twiml);
  }

  if (step === "recorded") {
    const callSid = params.CallSid;
    if (!callSid) {
      console.error("KMB-E803: /api/telephony/voice?step=recorded に CallSid がありません");
      return xmlResponse("", 500);
    }

    const result = await telephonyFacade.handleRecorded({ CallSid: callSid }, { mode: "service" });
    if (!result.ok) {
      console.error(`${result.code}: handleRecorded に失敗しました`, result.detail);
      return xmlResponse("", 500);
    }
    return xmlResponse(result.value.twiml);
  }

  // root (着信直後)
  const picked = pickWithNullFill(params, ["CallSid", "From", "To", "CallStatus"]);
  const parsed = zInboundCallWebhook.safeParse(picked);
  if (!parsed.success) {
    console.error("KMB-E803: /api/telephony/voice のパラメータが契約と不一致です", parsed.error.issues);
    return xmlResponse("", 500);
  }

  const result = await telephonyFacade.handleInboundCall(parsed.data, { mode: "service" });
  if (!result.ok) {
    // 署名 OK 後の内部エラー (DB 断等) は 500 → Twilio が Fallback URL の静的 TwiML を再生する
    // (§6.1「失敗時の応答方針」)。
    console.error(`${result.code}: handleInboundCall に失敗しました`, result.detail);
    return xmlResponse("", 500);
  }
  return xmlResponse(result.value.twiml);
}
