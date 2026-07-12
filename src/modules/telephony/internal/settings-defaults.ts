import "server-only";

import type { SettingsValue } from "@/modules/settings/contracts";

/**
 * telephony 設定値の型 + 未設定時デフォルト (canonical: 04-telephony.md §6.1 手順3 /
 * §6.5.1 手順5 / §6.5.2 手順2)。
 *
 * facade.ts (webhook 応答の degrade — resolveInboundSettings/handleDialResult) と
 * internal/worker.ts (downloading の delete_twilio_recording_after_download・transcribing の
 * max_processing_minutes) の両方から参照する単一の真実源。facade.ts → internal/worker.ts は
 * 既存の依存方向 (facade が worker の advanceCallJob を import する) のため、この定数を
 * facade.ts に置いたまま worker.ts から `../facade` を import すると facade↔worker の循環 import
 * になる (#58 実装時に発見)。共通の leaf ファイルとして本ファイルへ切り出すことで循環を避けつつ
 * 重複定義もしない (計画書 issue-58.md 成果物8「DEFAULT_TELEPHONY_SETTINGS を export して
 * worker.ts から import する」の実装 — export 先を facade.ts 自身ではなく本ファイルに変更)。
 */
export type TelephonySettings = SettingsValue<"telephony">;

/** 「ゼロ設定でも壊れない」既定値 (§6.1 手順3: 転送なし・同意 ON・既定文言・120秒・DL後削除ON・上限30分)。 */
export const DEFAULT_TELEPHONY_SETTINGS: TelephonySettings = {
  phone_number_e164: null,
  twilio_number_sid: null,
  forward_to_e164: null,
  consent_announcement_enabled: true,
  consent_announcement_text: null,
  in_hours_greeting_text: null,
  after_hours_greeting_text: null,
  voicemail_max_seconds: 120,
  delete_twilio_recording_after_download: true,
  max_processing_minutes: 30,
};
