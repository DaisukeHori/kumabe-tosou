"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { crmFacade } from "@/modules/crm/facade";
import type { CustomerListItem } from "@/modules/crm/contracts";
import { platformFacade } from "@/modules/platform/facade";
import type { Paged, Result } from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164 } from "@/modules/platform/text";
import { zBusinessHoursSettings, zTelephonySettings } from "@/modules/settings/contracts";
import { telephonyFacade } from "@/modules/telephony/facade";

import { submitSettingsForm } from "@/app/admin/settings/actions";
import type { SettingsFormState } from "@/app/admin/settings/form-state";

/**
 * /admin/calls の Server Actions (04-telephony.md §7.4)。
 * 全アクション先頭で platformFacade.requireAdmin() を呼ぶ規約 (settings/actions.ts の
 * submitSettingsForm 内パターンを踏襲)。
 *
 * saveTelephonySettingsAction / saveBusinessHoursAction は canonical §7.4 の明記どおり本ファイルに
 * 実装する (計画書 issue-59.md 未解決点#1 のデフォルト方針)。フォーム描画は /admin/settings 配下
 * だが Server Action の import 元は Next.js の制約を受けない。
 */

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length === 0 ? null : s;
}

// ============================================================
// 通話ジョブ再実行
// ============================================================

const zRetryCallJobInput = z.object({ callJobId: z.string().uuid() }).strict();

export async function retryCallJobAction(input: { callJobId: string }): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zRetryCallJobInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  const result = await telephonyFacade.retryCallJob(parsed.data.callJobId);
  if (result.ok) {
    revalidatePath("/admin/calls");
  }
  return result;
}

const zRetryLatestFailedInput = z.object({ callId: z.string().uuid() }).strict();

/**
 * 一覧の `r` キー再実行 (§8.1 キーボード操作) 用ラッパー。
 *
 * 【判断根拠 — 計画書に無い実装時判断】canonical §4.13 の CallListItem (07-contracts-delta 一字一句
 * 写経) は job_status のみを持ち call_jobs.id を持たない。一覧行から直接 retryCallJobAction を
 * 呼ぶための callJobId が存在しないため、telephonyFacade.getCallDetail(callId) で jobs 一覧を取得し
 * (1 通話に複数 job があり得る — §10-15)、created_at が最も新しい failed ジョブを対象として
 * retryCallJob を呼ぶ。CallListItem 型を拡張して job_id を持たせる方が理想だが、canonical に
 * 明記された型を UI 都合で乖離させるのは契約 parity を損なうため避け、既存の契約メソッド
 * (getCallDetail + retryCallJob) の組み合わせで解決する (facade/repository への変更なし)。
 */
export async function retryLatestFailedCallJobAction(input: { callId: string }): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zRetryLatestFailedInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  const detail = await telephonyFacade.getCallDetail(parsed.data.callId);
  if (!detail.ok) return detail;

  const failedJobs = detail.value.jobs.filter((j) => j.status === "failed");
  if (failedJobs.length === 0) {
    return { ok: false, code: "KMB-E807", detail: "失敗状態のジョブが見つかりません" };
  }
  const latestFailed = failedJobs.reduce((latest, job) => (job.created_at > latest.created_at ? job : latest));

  const result = await telephonyFacade.retryCallJob(latestFailed.id);
  if (result.ok) {
    revalidatePath("/admin/calls");
    revalidatePath(`/admin/calls/${parsed.data.callId}`);
  }
  return result;
}

// ============================================================
// 録音再生 URL
// ============================================================

const zCreatePlaybackUrlInput = z.object({ recordingId: z.string().uuid() }).strict();

export async function createPlaybackUrlAction(
  input: { recordingId: string },
): Promise<Result<{ url: string; expires_at: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zCreatePlaybackUrlInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  return telephonyFacade.createRecordingPlaybackUrl(parsed.data.recordingId);
}

// ============================================================
// 顧客紐づけ
// ============================================================

const zLinkCallToCustomerInput = z
  .object({
    callId: z.string().uuid(),
    customerId: z.string().uuid().nullable(),
    expectedUpdatedAt: z.string().min(1),
  })
  .strict();

export async function linkCallToCustomerAction(input: {
  callId: string;
  customerId: string | null;
  expectedUpdatedAt: string;
}): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zLinkCallToCustomerInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  const result = await telephonyFacade.linkCallToCustomer(
    parsed.data.callId,
    parsed.data.customerId,
    parsed.data.expectedUpdatedAt,
  );
  if (result.ok) {
    revalidatePath(`/admin/calls/${parsed.data.callId}`);
  }
  return result;
}

const zSearchCustomersInput = z.object({ query: z.string().max(80) }).strict();

/**
 * 顧客検索 (command パレット用 — §8.2 手動紐づけ/ambiguous 候補一覧)。
 * crm の契約外拡張 listCustomers を app 層 (telephony の calls/actions.ts) から利用する
 * (計画書の明示許容パターン — telephony/facade.ts / repository.ts からは呼ばない)。
 */
export async function searchCustomersForLinkAction(
  input: { query: string },
): Promise<Result<Paged<CustomerListItem>>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zSearchCustomersInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  return crmFacade.listCustomers(
    { q: parsed.data.query.length > 0 ? parsed.data.query : null, lifecycle: "active", include_merged: false },
    { cursor: null, limit: 20 },
  );
}

const zCreateCustomerForCallInput = z
  .object({
    name: z.string().min(1).max(80),
    telE164: z.string().nullable(),
  })
  .strict();

/**
 * ambiguous/no_number 分岐の「新しい顧客として作る」(§8.2-6)。
 * crm の契約メソッド (D8 canonical の 13 メソッドの1つ — 契約外拡張ではない) のため
 * 他モジュール app 層からの直接呼び出しは許容パターン。lifecycle='customer' 固定。作成後の
 * 紐づけは呼び出し元 (CustomerLinkSection) が続けて linkCallToCustomerAction を呼ぶ
 * (2 手順に分離し、どちらかが失敗しても片方の状態不整合を admin が視認できるようにする)。
 *
 * 【判断根拠 — レビュー指摘 (MAJOR) 是正】source は telE164 の有無で 'phone'/'manual' を
 * 出し分ける。crm/contracts.ts zCustomerInput は
 * `.refine(c => c.email !== null || c.tel_e164 !== null || c.source === "manual")`
 * (email/電話のどちらかが必須。source='manual' の手動作成のみ例外) を課すため、
 * 常に source:'phone'/email:null 固定だと no_number 通話 (match_status='no_number' は
 * 04-telephony.md の定義上 from_e164 が必ず null) の「新しい顧客として作る」が毎回
 * KMB-E101 で失敗していた。UI にメール入力欄を追加する案もあるが、telE164 が無い電話由来の
 * 手動作成は実質的に crm の「手動作成」と区別が付かない (どのみち電話番号もメールも無い状態で
 * admin が名前だけで顧客を起票する操作) ため、source を 'manual' に倒す方が最小の是正になる
 * (機能を欠落させない安全側の解釈。telE164 が非 null な既存経路の挙動・テストは変えない)。
 */
export async function createCustomerForCallAction(
  input: { name: string; telE164: string | null },
): Promise<Result<{ customer_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zCreateCustomerForCallInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  return crmFacade.createCustomer({
    kind: "person",
    name: parsed.data.name,
    name_kana: null,
    email: null,
    tel_e164: parsed.data.telE164,
    company_id: null,
    address: null,
    notes: null,
    lifecycle: "customer",
    source: parsed.data.telE164 === null ? "manual" : "phone",
  });
}

// ============================================================
// メモ欄
// ============================================================

const zSaveCallMemoInput = z
  .object({
    callId: z.string().uuid(),
    memo: z.string().max(5000).nullable(),
    expectedUpdatedAt: z.string().min(1),
  })
  .strict();

export async function saveCallMemoAction(input: {
  callId: string;
  memo: string | null;
  expectedUpdatedAt: string;
}): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zSaveCallMemoInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: parsed.error.message };
  }

  const result = await telephonyFacade.saveCallMemo(
    parsed.data.callId,
    parsed.data.memo,
    parsed.data.expectedUpdatedAt,
  );
  if (result.ok) {
    revalidatePath(`/admin/calls/${parsed.data.callId}`);
  }
  return result;
}

// ============================================================
// サイト設定「電話・営業時間」タブ (04-telephony.md §7.4/§8.3)
// ============================================================

/**
 * 電話番号 2 欄は action 冒頭で normalizeJpPhoneToE164() を通してから zTelephonySettings へ渡す
 * (00-overview §M0 正規化規約。zTelE164 は +81 形式のみ受理のため国内表記を直 parse すると弾かれる)。
 * 正規化不能時は Zod parse エラーとは別に、フィールドエラーとして先に返す
 * (§7.4「正規化不能時は『0X0-XXXX-XXXX の形式で入力してください』のフィールドエラー」)。
 */
export async function saveTelephonySettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const rawPhoneNumber = emptyToNull(formData.get("phone_number_e164"));
  const rawForwardTo = emptyToNull(formData.get("forward_to_e164"));

  const phoneNumberE164 = rawPhoneNumber ? normalizeJpPhoneToE164(rawPhoneNumber) : null;
  if (rawPhoneNumber && phoneNumberE164 === null) {
    return {
      error: "電話番号は 0X0-XXXX-XXXX の形式で入力してください。",
      conflict: false,
      success: false,
    };
  }
  const forwardToE164 = rawForwardTo ? normalizeJpPhoneToE164(rawForwardTo) : null;
  if (rawForwardTo && forwardToE164 === null) {
    return {
      error: "転送先電話番号は 0X0-XXXX-XXXX の形式で入力してください。",
      conflict: false,
      success: false,
    };
  }

  const raw = {
    phone_number_e164: phoneNumberE164,
    twilio_number_sid: emptyToNull(formData.get("twilio_number_sid")),
    forward_to_e164: forwardToE164,
    consent_announcement_enabled: formData.get("consent_announcement_enabled") === "on",
    consent_announcement_text: emptyToNull(formData.get("consent_announcement_text")),
    in_hours_greeting_text: emptyToNull(formData.get("in_hours_greeting_text")),
    after_hours_greeting_text: emptyToNull(formData.get("after_hours_greeting_text")),
    voicemail_max_seconds: Number(formData.get("voicemail_max_seconds") ?? 120),
    delete_twilio_recording_after_download: formData.get("delete_twilio_recording_after_download") === "on",
    max_processing_minutes: Number(formData.get("max_processing_minutes") ?? 30),
  };

  return submitSettingsForm(
    "telephony",
    zTelephonySettings,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
}

function dayHoursFromForm(formData: FormData, day: string): { open: string; close: string } | null {
  const enabled = formData.get(`${day}_enabled`) === "on";
  if (!enabled) return null;
  return {
    open: String(formData.get(`${day}_open`) ?? "09:00"),
    close: String(formData.get(`${day}_close`) ?? "18:00"),
  };
}

export async function saveBusinessHoursAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const raw = {
    mon: dayHoursFromForm(formData, "mon"),
    tue: dayHoursFromForm(formData, "tue"),
    wed: dayHoursFromForm(formData, "wed"),
    thu: dayHoursFromForm(formData, "thu"),
    fri: dayHoursFromForm(formData, "fri"),
    sat: dayHoursFromForm(formData, "sat"),
    sun: dayHoursFromForm(formData, "sun"),
    holidays: formData.getAll("holidays").map((v) => String(v)),
  };

  return submitSettingsForm(
    "business_hours",
    zBusinessHoursSettings,
    raw,
    String(formData.get("expected_updated_at") ?? ""),
  );
}
