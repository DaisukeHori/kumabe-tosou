import { NextResponse } from "next/server";

import { zRecordingWebhook } from "@/modules/telephony/contracts";
import { telephonyFacade } from "@/modules/telephony/facade";

import { pickWithNullFill, verifyTelephonyWebhook } from "../shared";

/**
 * 録音完了 webhook (canonical: docs/design/crm-suite/04-telephony.md §6.4)。
 * 処理は 2 INSERT のみの同期応答 (202+after は不要 — §6.4 末尾)。
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const verification = await verifyTelephonyWebhook(request);
  if (!verification.ok) {
    return NextResponse.json({ code: verification.code }, { status: verification.status });
  }

  const picked = pickWithNullFill(verification.params, [
    "CallSid",
    "RecordingSid",
    "RecordingUrl",
    "RecordingDuration",
    "RecordingChannels",
  ]);
  const parsed = zRecordingWebhook.safeParse(picked);
  if (!parsed.success) {
    console.error(
      "KMB-E803: /api/telephony/recording-status のパラメータが契約と不一致です",
      parsed.error.issues,
    );
    return NextResponse.json({ code: "KMB-E803" }, { status: 500 });
  }

  const result = await telephonyFacade.registerRecording(parsed.data, { mode: "service" });
  if (!result.ok) {
    console.error(`${result.code}: registerRecording に失敗しました`, result.detail);
    return NextResponse.json({ code: result.code }, { status: 500 });
  }

  return NextResponse.json({ call_job_id: result.value.call_job_id }, { status: 200 });
}
