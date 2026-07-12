import { NextResponse } from "next/server";

import { zCallStatusWebhook } from "@/modules/telephony/contracts";
import { telephonyFacade } from "@/modules/telephony/facade";

import { pickWithNullFill, verifyTelephonyWebhook } from "../shared";

/**
 * 通話終了 webhook (canonical: docs/design/crm-suite/04-telephony.md §6.3)。
 * Twilio の statusCallback (completed イベント) 向け。常に 200 (空 TwiML) を返す
 * (§7.3: 「業務エラーは吸収する。Twilio に 4xx/5xx を返しても意味がない」)。
 */
export const maxDuration = 30;

const EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

function emptyXmlResponse(status = 200): NextResponse {
  return new NextResponse(EMPTY_TWIML_RESPONSE, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const verification = await verifyTelephonyWebhook(request);
  if (!verification.ok) {
    // 503 (env 未設定) / 403 (署名不一致) はここのみ非 200 (Twilio 側の異常検知のため)。
    return NextResponse.json({ code: verification.code }, { status: verification.status });
  }

  const picked = pickWithNullFill(verification.params, ["CallSid", "CallStatus", "CallDuration"]);
  const parsed = zCallStatusWebhook.safeParse(picked);
  if (!parsed.success) {
    console.error("KMB-E803: /api/telephony/status のパラメータが契約と不一致です", parsed.error.issues);
    return emptyXmlResponse(200); // 200 で吸収 (§7.3)
  }

  const result = await telephonyFacade.handleCallStatus(parsed.data, { mode: "service" });
  if (!result.ok) {
    if (result.code === "KMB-E804") {
      console.warn(`KMB-E804: /api/telephony/status で対象の通話が見つかりません (CallSid=${parsed.data.CallSid})`);
    } else {
      console.error(`${result.code}: handleCallStatus に失敗しました`, result.detail);
    }
  }

  return emptyXmlResponse(200); // 常に 200 (§7.3)
}
