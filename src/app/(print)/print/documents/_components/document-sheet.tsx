import type { TaxCategory } from "@/modules/platform/contracts";
import type { DocType, IssuerSnapshot, TaxSummary } from "@/modules/sales/contracts";
import { TAX_CATEGORY_ORDER } from "@/modules/sales/tax";

/**
 * canonical: docs/design/crm-suite/02-sales.md §10.1〜§10.7。
 *
 * 紙面は Server Component のみ・クライアント JS なし (§10.8。角印 <img> の onerror 最小
 * inline script のみ例外 — §10.6)。`<DocumentSheet>` 1 コンポーネントで doc_type (S1 見積 /
 * S2 受注・納品 / S3 請求) を分岐する (新規コンポーネント乱造禁止 — §8.4 と同じ規約)。
 *
 * 動的 margin box (継続ヘッダの書類名/doc_no) はこのコンポーネントがサーバ側で `<style>` を
 * 文字列生成して埋め込む (§10.2)。埋め込み値は書類名 (コード定数) と doc_no
 * (呼び出し側で zDocumentNo 検証済み、または「(未採番)」固定文字列) に限定し、
 * escapeForCssString で CSS 文字列リテラルとして安全にエスケープする — CSS injection の余地なし。
 */

export type DocumentSheetLine = {
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price_jpy: number;
  amount_jpy: number;
  tax_category: TaxCategory;
};

export type DocumentSheetProps = {
  docType: DocType;
  /** null = 未採番 (draft プレビュー、または発行フロー中で payload.doc_no も無いケース)。 */
  docNo: string | null;
  issueDate: string | null;
  transactionDate: string | null;
  validUntil: string | null;
  billingName: string;
  billingSuffix: "様" | "御中";
  billingAddress: string | null;
  siteName: string | null;
  siteAddress: string | null;
  notes: string | null;
  subtotalJpy: number;
  taxSummary: TaxSummary;
  totalJpy: number;
  issuer: IssuerSnapshot;
  /** server 側で解決済みの署名 URL (TTL 5 分)。null = 非印字 (未設定 or 解決失敗 — §10.6)。 */
  sealSignedUrl: string | null;
  lines: DocumentSheetLine[];
  /** true = 「下書き(未発行)」透かし表示 (§10.2 — draft かつ purpose='preview' のときのみ)。 */
  watermark: boolean;
};

const DOC_TITLE: Record<DocType, string> = {
  quote: "御見積書",
  order: "注文請書",
  delivery: "納品書",
  invoice: "請求書",
};

const DOC_GREETING: Record<DocType, string> = {
  quote: "下記のとおりお見積り申し上げます。",
  order: "下記のとおり、ご注文をお請けいたします。",
  delivery: "下記のとおり納品いたしました。",
  invoice: "下記のとおりご請求申し上げます。",
};

const AMOUNT_LABEL: Record<DocType, string> = {
  quote: "御見積金額",
  order: "御注文金額",
  delivery: "合計金額",
  invoice: "御請求金額",
};

const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  standard_10: "10%対象",
  reduced_8: "8%対象(軽減税率)",
  zero: "0%対象",
  exempt: "対象外",
};

function formatJstDate(dateOnly: string | null): string | null {
  if (!dateOnly) return null;
  const [y, m, d] = dateOnly.split("-");
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

function formatQuantity(quantity: number): string {
  // 小数第 2 位まで・末尾 0 除去 (§10.4: `12` / `3.5`)
  return Number(quantity.toFixed(2)).toString();
}

/** 金額は全欄 ¥ + 3 桁区切り (toLocaleString('ja-JP'))。負値は商慣行表記の ▲ を付ける (§10.4)。 */
function formatJpy(amountJpy: number): string {
  const abs = Math.abs(amountJpy).toLocaleString("ja-JP");
  return amountJpy < 0 ? `▲¥${abs}` : `¥${abs}`;
}

/** @top-right の content 文字列リテラル用エスケープ (バックスラッシュ・二重引用符のみ対象)。 */
function escapeForCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 角印 <img> の src 属性値埋め込み用 HTML エスケープ。紙面は Server Component のみ・
 * クライアント JS 禁止 (§10.8) のため、React 合成イベント (onError 関数 prop) は使えない
 * — Next.js の RSC シリアライザは "use client" の有無を問わず /^on[A-Z]/ にマッチする
 * 関数 prop をホスト要素に渡した時点で例外を投げる。代わりにネイティブ HTML の onerror
 * 属性を生文字列として埋め込む (紙面で唯一許可される inline script — §10.6)。埋め込み対象は
 * サーバ側で解決済みの署名 URL (sealSignedUrl) のみであり、`&` `"` `<` `>` をエスケープして
 * HTML 属性値として安全にする。
 */
function escapeForHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function DocumentSheet(props: DocumentSheetProps) {
  const {
    docType,
    docNo,
    issueDate,
    transactionDate,
    validUntil,
    billingName,
    billingSuffix,
    billingAddress,
    siteName,
    siteAddress,
    notes,
    subtotalJpy,
    taxSummary,
    totalJpy,
    issuer,
    sealSignedUrl,
    lines,
    watermark,
  } = props;

  const docNoLabel = docNo ?? "(未採番)";
  const continuationTitle = escapeForCssString(`${DOC_TITLE[docType]} ${docNoLabel}（続き）`);
  const isInvoice = docType === "invoice";
  const isQuote = docType === "quote";
  const isQualified = issuer.registration_number !== null;
  const taxLabel = isQualified ? "消費税" : "消費税相当額";
  const hasReducedRow = taxSummary.some((t) => t.tax_category === "reduced_8");
  const issueDateLabel = formatJstDate(issueDate) ?? "(発行時の日付)";
  // 取引日欄: transaction_date が issue_date と異なる場合のみ、S3 (請求書) に限り別行表示 (§10.3)。
  // null = issue_date と同日扱いのため常に非印字。
  const showTransactionDateRow = isInvoice && transactionDate !== null && transactionDate !== issueDate;

  return (
    <div className="sheet">
      {/* 動的 margin box: 継続ヘッダ (2 ページ目以降のみ)。埋め込み値はコード定数 + 検証済み doc_no のみ */}
      <style>{`
        @page { @top-right { content: "${continuationTitle}"; font-size: 8pt; color: #666; } }
        @page :first { @top-right { content: none; } }
      `}</style>

      {watermark ? <div className="watermark">下書き（未発行）</div> : null}

      <h1 className="sheet-title">{DOC_TITLE[docType]}</h1>

      <div className="meta-row">
        <span className="doc-no">No. {docNoLabel}</span>
        <span>発行日: {issueDateLabel}</span>
      </div>

      <div className="parties">
        <div className="billing-block">
          <div className="name">
            {billingName} {billingSuffix}
          </div>
          {billingAddress ? <div className="address">{billingAddress}</div> : null}
        </div>
        <div className="issuer-block">
          {sealSignedUrl ? (
            // 印刷専用紙面。next/image の最適化パイプラインは印刷 (page.pdf) の用途に合わないため
            // 素の <img> を使う。React 合成イベント (onError 関数 prop) は "use client" の無い
            // この Server Component ツリーでは RSC シリアライズ時に例外化するため使えない
            // (escapeForHtmlAttribute のコメント参照)。ネイティブ onerror 属性を dangerouslySetInnerHTML
            // で埋め込む — クライアント JS 実行なしで動作する。
            <span
              className="seal-wrap"
              dangerouslySetInnerHTML={{
                __html: `<img src="${escapeForHtmlAttribute(sealSignedUrl)}" alt="" class="seal" onerror="this.style.display='none'" />`,
              }}
            />
          ) : null}
          <div className="issuer-name">{issuer.issuer_name}</div>
          {issuer.registration_number ? (
            <div className="line">登録番号: {issuer.registration_number}</div>
          ) : null}
          {issuer.address ? <div className="line">{issuer.address}</div> : null}
          {issuer.tel || issuer.email ? (
            <div className="line">
              {issuer.tel ? `TEL ${issuer.tel}` : null}
              {issuer.tel && issuer.email ? " / " : null}
              {issuer.email ? issuer.email : null}
            </div>
          ) : null}
        </div>
      </div>

      {siteName || siteAddress ? (
        <div className="site-block">
          現場: {siteName ?? ""}
          {siteName && siteAddress ? "／" : ""}
          {siteAddress ?? ""}
        </div>
      ) : null}

      {showTransactionDateRow ? (
        <div className="sub-meta-row">取引日: {formatJstDate(transactionDate)}</div>
      ) : null}

      <p className="greeting">{DOC_GREETING[docType]}</p>

      <div className="amount-box">
        <span className="label">{AMOUNT_LABEL[docType]}</span>
        {formatJpy(totalJpy)}（税込）
      </div>

      {isQuote && validUntil ? (
        <div className="sub-meta-row">有効期限: {formatJstDate(validUntil)}</div>
      ) : null}

      {lines.length === 0 ? (
        <div className="no-lines">(明細未入力)</div>
      ) : (
        <>
          <table className="lines">
            <thead>
              <tr>
                <th className="col-no">No.</th>
                <th className="col-desc">品名</th>
                <th className="col-qty">数量</th>
                <th className="col-unit">単位</th>
                <th className="col-price">単価</th>
                <th className="col-amount">金額</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.position}>
                  <td className="col-no">{line.position + 1}</td>
                  <td className="col-desc">
                    {line.tax_category === "reduced_8" ? "※" : ""}
                    {line.description}
                  </td>
                  <td className="col-qty">{formatQuantity(line.quantity)}</td>
                  <td className="col-unit">{line.unit}</td>
                  <td className="col-price">{formatJpy(line.unit_price_jpy)}</td>
                  <td className="col-amount">{formatJpy(line.amount_jpy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="below-margin">以下余白</div>
        </>
      )}

      <div className="totals-block">
        <div className="row">
          <span>小計（税抜）</span>
          <span>{formatJpy(subtotalJpy)}</span>
        </div>
        {TAX_CATEGORY_ORDER.filter((category) => taxSummary.some((t) => t.tax_category === category)).map(
          (category) => {
            const entry = taxSummary.find((t) => t.tax_category === category);
            if (!entry) return null;
            return (
              <div className="row tax-line" key={category}>
                <span>
                  {TAX_CATEGORY_LABEL[category]} {formatJpy(entry.taxable_jpy)}
                </span>
                <span>
                  {taxLabel} {formatJpy(entry.tax_jpy)}
                </span>
              </div>
            );
          },
        )}
        <div className="row grand-total">
          <span>合計（税込）</span>
          <span>{formatJpy(totalJpy)}</span>
        </div>
      </div>

      {hasReducedRow ? <p className="reduced-note">※印は軽減税率(8%)対象品目</p> : null}

      {notes ? (
        <div className="notes-block">
          <div className="box">{notes}</div>
        </div>
      ) : null}

      {isInvoice && issuer.bank_account ? (
        <div className="bank-block">
          <span className="label">お振込先: </span>
          {issuer.bank_account.bank_name} {issuer.bank_account.branch_name}{" "}
          {issuer.bank_account.account_type === "ordinary" ? "普通" : "当座"}{" "}
          {issuer.bank_account.account_number} {issuer.bank_account.account_holder_kana}
          {issuer.transfer_fee_note ? <div>{issuer.transfer_fee_note}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
