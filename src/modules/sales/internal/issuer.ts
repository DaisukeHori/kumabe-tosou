import "server-only";

import type { ExecutionContext, Result } from "@/modules/platform/contracts";

import { settingsFacade } from "@/modules/settings/facade";

import { zIssuerSnapshot, type IssuerSnapshot } from "../contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §6.1 issueDocument 手順 2、§13.1
 * (tests/sales-issuer-snapshot.test.ts の対象)。
 *
 * settings 'company' + 'invoice_issuer' から zIssuerSnapshot (documents.issuer_snapshot に
 * 発行時凍結される値、および draft プレビュー/発行フロー中の /print 描画に使う現在値) を合成する。
 *
 * 判断点 (実装計画書「地雷」記載分、オーケストレーターへ報告):
 * - **E901→E626 変換**: settingsFacade.get('invoice_issuer', ctx) が失敗 (未設定含む) した場合、
 *   その内部コード (通常 KMB-E901) をそのまま透過せず KMB-E626 (発行者情報未設定) に変換する
 *   (Issue #50 本文に明記の指示)。issuer_name が取得できても空文字の場合も同様に E626 とする
 *   (zShortText(80) は min(1) を持つため通常空文字は保存できないはずだが、二重の安全策として
 *   trim 後の長さを明示チェックする)。
 * - **company 設定の取得失敗は E626 にしない (安全側の判断)**: company (住所/電話) は帳票の
 *   任意項目であり、適格請求書 6 記載事項にも含まれない (§10.1 の対応表参照)。
 *   sales/facade.ts の resolveTaxRounding が invoice_issuer 未設定時に既定値へ縮退する
 *   確立済みパターン (facade.ts 内 JSDoc「地雷11」) と同型で、company 取得失敗時は
 *   address/tel を null 埋めして続行する (発行を止めない — 安全側 = 機能を壊さない)。
 *   この判断根拠は openIssues にも記載する。
 * - registration_number は settings 側 (zInvoiceIssuerSettings) の値をそのまま透過する
 *   (null = 免税モード判定値。正規化・上書きはしない — §10.5)。
 */
export async function buildIssuerSnapshot(ctx?: ExecutionContext): Promise<Result<IssuerSnapshot>> {
  const [companyResult, issuerResult] = await Promise.all([
    settingsFacade.get("company", ctx),
    settingsFacade.get("invoice_issuer", ctx),
  ]);

  if (!issuerResult.ok) {
    return {
      ok: false,
      code: "KMB-E626",
      detail: "請求書発行者の設定 (invoice_issuer) が見つかりません。サイト設定「請求書発行者」タブで保存してください。",
    };
  }
  if (issuerResult.value.issuer_name.trim().length === 0) {
    return { ok: false, code: "KMB-E626", detail: "発行者名 (issuer_name) が未設定です。" };
  }

  const company = companyResult.ok ? companyResult.value : null;

  const candidate: IssuerSnapshot = {
    issuer_name: issuerResult.value.issuer_name,
    registration_number: issuerResult.value.registration_number,
    address: company?.address ?? null,
    tel: company?.tel ?? null,
    email: company?.email ?? null,
    seal_storage_path: issuerResult.value.seal_storage_path,
    bank_account: issuerResult.value.bank_account,
    transfer_fee_note: issuerResult.value.transfer_fee_note,
  };

  const parsed = zIssuerSnapshot.safeParse(candidate);
  if (!parsed.success) {
    // ここに到達するのは settings 側スキーマと sales 側 zIssuerSnapshot の乖離のみ
    // (両者は構造的同型 — 07-contracts-delta §D5 参照)。地雷回避: 握り潰さず E901 で明示する。
    return { ok: false, code: "KMB-E901", detail: parsed.error.message };
  }
  return { ok: true, value: parsed.data };
}
