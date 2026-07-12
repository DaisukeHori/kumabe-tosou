import { NextResponse } from "next/server";
import { z } from "zod";

import { checkAndRecordRateLimit } from "@/components/contact/rate-limit.server";
import {
  extractClientIp,
  hashIp,
  isHoneypotFilled,
  isSubmittedTooFast,
  SHOP_LEAD_RATE_LIMIT_ROUTE,
} from "@/components/contact/spam-guard";
import { getRateLimitIpSalt } from "@/lib/env";
import type { SimEstimateSnapshot } from "@/modules/crm/contracts";
import { crmFacade } from "@/modules/crm/facade";
import type { InquiryInput } from "@/modules/inquiry/contracts";
import { inquiryFacade } from "@/modules/inquiry/facade";
import { createPricingFacade } from "@/modules/pricing/facade";
import { createSalesFacade } from "@/modules/sales/facade";

import { buildInquiryBody, buildSimEstimateSnapshot, zSimulatorLeadReq } from "./schema";
import type { SimulatorLeadResponse } from "./schema";

/**
 * POST /api/shop/lead — シミュレーター発リードの取込 (anon 起点)。
 * canonical: docs/design/crm-suite/06-simulator.md §6.1 (処理シーケンス) / §5.2 (facade 呼び出し全列挙)。
 *
 * app 層合成: InquiryFacade.submit → CrmFacade.intakeFromSimulator → SalesFacade.createDraftQuoteFromEstimate。
 * intakeFromSimulator / createDraftQuoteFromEstimate はいずれも ctx を取らないシグネチャで
 * 内部が常時 service client を生成する設計 (07-contracts-delta.md D8 裁定記録 #12。
 * sales/facade.ts L343-359 実測: createSalesFacade() を引数なしで呼んでも
 * `injectedClient ?? createSupabaseServiceClient()` で service client 相当になることを確認済み)。
 *
 * 不変条件 (00-overview §4.2 / 06-simulator §5.2): 手順 1 (問い合わせ保存) は必ず残す。
 * 手順 2 (crm 取込) / 手順 3 (見積原案) の失敗は巻き戻さず、ログのみで 200 のまま継続する。
 */

// maxDuration は既定のまま (facade 3 呼び出しは DB のみで高速 — 06-simulator §6.1)。

const INVALID_MESSAGE = "入力内容をご確認ください。";
const RATE_LIMITED_MESSAGE = "短時間に送信が集中しています。1時間ほど時間をおいてお試しください。";
const GENERIC_ERROR_MESSAGE =
  "送信に失敗しました。時間をおいて再度お試しいただくか、お問い合わせフォームをご利用ください。";

/** 価格表未取得・グレード/サイズ不一致時に body へ追記する注記 (06-simulator §4.4) */
const NOTE_UNVERIFIED =
  "※ 価格表未取得のため送信時の表示金額をそのまま記載（未検証）";
const NOTE_DIVERGED =
  "※ 送信時の表示金額と現行価格表に乖離があります（本文はサーバ再計算値）";

/**
 * 0-b stealth 前段判定用の緩いスキーマ (06-simulator §6.1)。honeypot / form_rendered_at の
 * 2 項のみを catch 付きで読み取り、型不正・欠落は bot 側に倒す (フル契約検証より必ず先に行う —
 * v1.0 の失敗 [strict parse が先で honeypot 充填 bot に 400+Zod詳細を返した] を再現しない)。
 */
const zStealthPrecheck = z
  .object({
    honeypot: z.string().catch("x"),
    form_rendered_at: z.number().int().positive().catch(0),
  })
  .passthrough();

function jsonResponse(body: SimulatorLeadResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 0-a: JSON parse
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return jsonResponse({ ok: false, code: "KMB-E101", message: INVALID_MESSAGE }, 400);
    }

    // 0-b: stealth 前段判定 (strict parse より先)。
    // トップレベルの型自体が object でない (配列・文字列等) 場合も zStealthPrecheck.safeParse は
    // 失敗する。この場合も honeypot 同様スキーマ情報を一切返さず bot として静かに破棄する
    // (stealth の趣旨: 契約形状を bot に学習させない — 実装判断。地雷回避のため明記)。
    const precheck = zStealthPrecheck.safeParse(json);
    if (!precheck.success) {
      return jsonResponse({ ok: true }, 200);
    }
    const { honeypot, form_rendered_at } = precheck.data;
    const submittedAt = Date.now();
    if (
      isHoneypotFilled(honeypot) ||
      form_rendered_at === 0 ||
      isSubmittedTooFast({ formRenderedAt: form_rendered_at, submittedAt })
    ) {
      console.warn("[shop-lead] stealth 判定により送信を無視しました (spam 扱い)");
      return jsonResponse({ ok: true }, 200);
    }

    // 0-c: rate limit (route='shop_lead' — contact フォームとは独立集計)
    const requestHeaders = request.headers;
    const ip = extractClientIp(
      requestHeaders.get("x-forwarded-for"),
      requestHeaders.get("x-real-ip"),
    );
    const ipHash = hashIp(ip, getRateLimitIpSalt());
    const rateLimitResult = await checkAndRecordRateLimit(
      ipHash,
      new Date(submittedAt),
      SHOP_LEAD_RATE_LIMIT_ROUTE,
    );
    if (!rateLimitResult.ok) {
      return jsonResponse(
        { ok: false, code: "KMB-E105", message: RATE_LIMITED_MESSAGE },
        429,
      );
    }

    // 0-d: strict 契約検証 (Zod 詳細は応答に載せない)
    const parsedReq = zSimulatorLeadReq.safeParse(json);
    if (!parsedReq.success) {
      return jsonResponse({ ok: false, code: "KMB-E101", message: INVALID_MESSAGE }, 400);
    }
    const { contact, message, estimate: clientEstimate } = parsedReq.data;

    // 0-e: サーバ再計算 (正本 snapshot の組み立て — クライアント金額・ラベルを信頼しない)。
    let serverEstimate: SimEstimateSnapshot | null = null;
    let optionLabels: string[] = [];
    let unverified = false;
    let diverged = false;

    const pricing = createPricingFacade();
    const tableResult = await pricing.getActivePriceTable();
    if (!tableResult.ok) {
      // 表取得失敗 (KMB-E901) → 縮退: クライアント snapshot を「未検証」注記付きで
      // 手順 1 のみ実施し、手順 2/3 はスキップ (未検証金額で CRM を汚染しない — §5.2 手順 0)。
      unverified = true;
    } else {
      const table = tableResult.value;
      const estimateResult = pricing.estimate({
        grade_key: clientEstimate.grade_key,
        size_key: clientEstimate.size_key,
        quantity: clientEstimate.quantity,
        option_keys: clientEstimate.option_keys,
      });
      if (!estimateResult.ok) {
        // 契約上のみ発生しうる KMB-E101 (§5.2 手順 0 の全列挙どおり)。zSimEstimateSnapshot を
        // 通過済みのため実質発生しないが、発生時は 400 として扱う (E901 縮退とは区別)。
        return jsonResponse({ ok: false, code: "KMB-E101", message: INVALID_MESSAGE }, 400);
      }

      const grade = table.grades.find((g) => g.key === clientEstimate.grade_key);
      const size = table.size_classes.find((s) => s.key === clientEstimate.size_key);
      if (!grade || !size) {
        // 実装判断 (計画書「未解決点」に該当する未規定ケース。安全側の解釈):
        // 表は取得できたが、送信された grade_key/size_key が現行の価格表に存在しない
        // (改廃直後の古いタブ・不正な申告値)。ラベルを持つ実レコードが無いため
        // buildSimEstimateSnapshot に渡す PriceGrade/PriceSizeClass を構成できない。
        // 誤ったラベル・金額で CRM (customers/deals/activities) を汚染しないよう、
        // 価格表未取得時と同じ「未検証」縮退経路 (手順 1 のみ) に倒す。
        // 問い合わせ自体は必ず残す不変条件 (00-overview §4.2) を優先する。
        unverified = true;
      } else {
        const snapshot = buildSimEstimateSnapshot({
          grade,
          size,
          quantity: clientEstimate.quantity,
          optionKeys: clientEstimate.option_keys,
          result: estimateResult.value,
        });
        serverEstimate = snapshot;
        optionLabels = snapshot.option_keys
          .map((key) => table.options.find((o) => o.key === key)?.label)
          .filter((label): label is string => label !== undefined);
        diverged =
          clientEstimate.quote_only !== snapshot.quote_only ||
          clientEstimate.total_min !== snapshot.total_min ||
          clientEstimate.total_max !== snapshot.total_max;
      }
    }

    if (unverified) {
      // 未検証縮退: クライアント申告 snapshot をそのまま正本として手順 1 のみ実施する。
      serverEstimate = clientEstimate;
      // optionLabels は表が使えないため解決不能。生の option_keys をラベル代わりに使う
      // (実装判断: 表示の見栄えは落ちるが、問い合わせ本文から情報が消えることはない — 安全側)。
      optionLabels = clientEstimate.option_keys;
    }

    // この時点で serverEstimate は必ず非 null (unverified 経路 or verified 経路のいずれか)
    const finalEstimate = serverEstimate as SimEstimateSnapshot;

    let body = buildInquiryBody({ estimate: finalEstimate, optionLabels, message });
    if (unverified) {
      body = `${body}\n${NOTE_UNVERIFIED}`;
    } else if (diverged) {
      body = `${body}\n${NOTE_DIVERGED}`;
    }

    const item = `${finalEstimate.grade_label}/${finalEstimate.size_label}×${finalEstimate.quantity}`.slice(
      0,
      100,
    );

    const inquiryInput: InquiryInput = {
      name: contact.name,
      email: contact.email,
      tel: contact.tel,
      inquiry_type: "estimate",
      item,
      body,
      privacy_agreed: true,
    };

    // 1: 問い合わせ保存 (失敗 = 全体失敗。問い合わせ未保存のため 200 を返さない)
    // §5.2 手順 1 の全列挙: KMB-E101 (契約違反 — §4.2 通過後は原則発生しない) は 400、
    // それ以外 (実質 KMB-E901 の INSERT 失敗) は 500 として扱う。
    const submitResult = await inquiryFacade.submit(inquiryInput);
    if (!submitResult.ok) {
      console.error("[shop-lead] InquiryFacade.submit に失敗しました:", submitResult);
      if (submitResult.code === "KMB-E101") {
        return jsonResponse({ ok: false, code: "KMB-E101", message: INVALID_MESSAGE }, 400);
      }
      return jsonResponse({ ok: false, code: "KMB-E901", message: GENERIC_ERROR_MESSAGE }, 500);
    }
    const inquiryId = submitResult.value.id;

    if (unverified) {
      // 未検証縮退: 未検証金額で CRM を汚染しないため手順 2/3 はスキップする (§5.2 手順 0)。
      return jsonResponse({ ok: true }, 200);
    }

    // 2: crm 取込 (失敗しても巻き戻さない — 00-overview §4.2 の不変条件どおり)
    const intakeResult = await crmFacade.intakeFromSimulator({
      inquiry_id: inquiryId,
      contact: { name: contact.name, email: contact.email, tel: contact.tel },
      estimate: finalEstimate,
    });
    if (!intakeResult.ok) {
      console.error(
        `[shop-lead] intake 失敗 ${intakeResult.code} (inquiry_id=${inquiryId}):`,
        intakeResult.detail,
      );
      return jsonResponse({ ok: true }, 200);
    }

    // 3: 見積原案 (手順 2 成功時のみ。失敗しても巻き戻さない)
    const salesFacade = createSalesFacade();
    const draftResult = await salesFacade.createDraftQuoteFromEstimate({
      deal_id: intakeResult.value.deal_id,
      estimate: finalEstimate,
    });
    if (!draftResult.ok) {
      console.error(
        `[shop-lead] createDraftQuoteFromEstimate 失敗 ${draftResult.code} (deal_id=${intakeResult.value.deal_id}):`,
        draftResult.detail,
      );
    }

    // 4: 200
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    // 想定外の例外に対する最終防波堤 (facade は Result を返す設計のため通常到達しない)。
    // ここで握り潰さず 500 + ログを返す (エラーの無言変換禁止)。
    console.error("[shop-lead] 予期しない例外が発生しました:", err);
    return jsonResponse(
      { ok: false, code: "KMB-E901", message: GENERIC_ERROR_MESSAGE },
      500,
    );
  }
}
