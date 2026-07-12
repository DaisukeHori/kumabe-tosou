import { z } from "zod";

import { zShortText } from "@/modules/platform/contracts";
import { zSimEstimateSnapshot } from "@/modules/crm/contracts";
import type { SimEstimateSnapshot } from "@/modules/crm/contracts";
import type { EstimateResult, PriceGrade, PriceSizeClass } from "@/modules/pricing/contracts";

/**
 * シミュレーター発リードの送信契約 (POST /api/shop/lead)。
 * canonical: docs/design/crm-suite/06-simulator.md §4.2〜§4.4 (裁定 J6-(a))。
 * 部品の canonical: zSimEstimateSnapshot = crm/contracts.ts (07-contracts-delta.md §D7)。
 *
 * app 層ローカル契約 (07-contracts-delta v1.1 裁定記録 #13):
 * platform / crm への昇格は却下済み — 単一 route とそのフォーム (shop-lead-form.tsx) のみが
 * 使用する。跨モジュール利用が生じた時点で昇格を検討する。
 *
 * zod のみ・server-only を含まない: クライアント (react-hook-form の zodResolver) と
 * サーバ (route.ts の 0-e サーバ再計算) の両方から import されるため。
 *
 * email 必須の根拠: contact_inquiries.email は not null (migration 0001) であり、
 * 既存 contact フォーム (zInquiryInput) と同一の要求水準に揃える。
 * 電話のみのお客様 (00-overview §7 パターン 1) の受け皿は telephony 経路 (04) が担う。
 */
export const zSimulatorLeadReq = z
  .object({
    contact: z
      .object({
        name: zShortText(50), // zInquiryInput.name と同上限
        email: z.string().email().max(120),
        tel: z
          .string()
          .regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/) // zInquiryInput.tel と同一 (国内番号の生入力)
          .nullable(),
      })
      .strict(),
    message: z.string().max(2000).nullable(), // 任意の補足。NFC 正規化は body 合成後の zInquiryInput が適用
    privacy_agreed: z.literal(true), // 同意なし送信は型レベルで不可 (zInquiryInput と同型)
    estimate: zSimEstimateSnapshot, // 入力+結果のスナップショット (07 §D7)。金額・ラベルはサーバが信頼せず再計算で上書き (§6.1 0-e — クライアント値は乖離検知のみ。v1.1)
    // --- スパムガード (既存 contact フォームの 3 点セットと同一) ---
    honeypot: z.string().max(200), // 値が入っていれば bot (stealth 扱い)
    form_rendered_at: z.number().int().positive(), // フォーム描画時刻 (epoch ms)。3 秒未満送信は bot
  })
  .strict();
export type SimulatorLeadReq = z.infer<typeof zSimulatorLeadReq>;

/** 応答契約 (JSON)。HTTP status との対応は 06-simulator.md §6.1 の表が正 */
export type SimulatorLeadResponse =
  | { ok: true }
  | { ok: false; code: "KMB-E101" | "KMB-E105" | "KMB-E901"; message: string };

/**
 * シミュレーター state + 計算結果 → zSimEstimateSnapshot。
 * クライアント (表示値の申告用) とサーバ (route が §6.1 0-e で正本 snapshot を組み立てる) の
 * 両方から呼ばれる純関数。
 *
 * D7 の上限 (grade_label 30 / size_label 30 / breakdown.label 50 / breakdown.factor 30
 * (v1.1 是正) / applied_tier 30 / option_keys 各 30・最大 10) へ防御的に切り詰める。
 * computeEstimate() の breakdown 先頭要素は factor = size.label (最大 30 字) であり、
 * D7 の breakdown[].factor は元々 max 20 だったため 07-contracts-delta v1.1 (裁定記録 #11) で
 * factor max 30 に改訂済み — 本関数の切り詰めは契約変更後も自衛として維持する。
 */
export function buildSimEstimateSnapshot(args: {
  grade: PriceGrade;
  size: PriceSizeClass;
  quantity: number;
  optionKeys: string[];
  result: EstimateResult;
}): SimEstimateSnapshot {
  return {
    grade_key: args.grade.key.slice(0, 30),
    grade_label: args.grade.label.slice(0, 30),
    size_key: args.size.key.slice(0, 10),
    size_label: args.size.label.slice(0, 30),
    quantity: args.quantity,
    option_keys: args.optionKeys.slice(0, 10).map((k) => k.slice(0, 30)),
    quote_only: args.result.quote_only,
    total_min: args.result.total_min,
    total_max: args.result.total_max,
    applied_tier: args.result.applied_tier === null ? null : args.result.applied_tier.slice(0, 30),
    breakdown: args.result.breakdown.slice(0, 20).map((b) => ({
      label: b.label.slice(0, 50),
      factor: b.factor.slice(0, 30), // D7 上限 30 (v1.1 是正 — size.label(≤30) が入る経路がある)。切り詰めは自衛として維持
    })),
  };
}

/**
 * 旧 UX のコピー文 (shop-simulator.tsx の handleOrder が組み立てていたクリップボード文面) と
 * 同じ情報密度を contact_inquiries.body に構造化テキストとして残す
 * (管理画面 /admin/inquiries でそのまま読める後方互換)。
 * 出力は zInquiryInput.body (zShortText(5000).pipe(min(10))) を必ず通るため
 * NFC 正規化は inquiry 側で適用される。
 */
export function buildInquiryBody(args: {
  estimate: SimEstimateSnapshot;
  // 選択オプションの表示ラベル — route がサーバ価格表 (table.options) から option_keys で解決する
  // (§6.1 0-e)。クライアントからは受け取らない (zSimulatorLeadReq に option_labels は存在しない — v1.1 是正)。
  optionLabels: string[];
  message: string | null;
}): string {
  const { estimate: e } = args;
  const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
  const lines = [
    "【隈部塗装 SHOP — シミュレーター経由の問い合わせ】",
    `グレード: ${e.grade_label}`,
    `サイズ帯: ${e.size_label}`,
    `個数: ${e.quantity} 個`,
    `オプション: ${args.optionLabels.length > 0 ? args.optionLabels.join(" / ") : "なし"}`,
    e.quote_only
      ? "概算: 個別見積もり（サイズ上限超過）"
      : `概算: ${yen(e.total_min)}〜${yen(e.total_max)}（税込・目安${e.applied_tier ? `・${e.applied_tier} 適用` : ""}）`,
    "※ シミュレーターの概算です。正式なお見積もりで確定します。",
  ];
  if (args.message !== null && args.message.trim().length > 0) {
    lines.push("", "--- お客様からのメッセージ ---", args.message.trim());
  }
  return lines.join("\n");
}
