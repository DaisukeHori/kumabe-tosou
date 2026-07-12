import { DERIVATION_RULES, type DocType, type DocumentStatus } from "../contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §4.1 (documents.status 状態機械図) / §4.2
 * (状態 × 意味論表) / §4.4 (派生 deriveDocument の意味論)。
 *
 * §4.1 の状態機械図を 1:1 でエッジ列挙する (全 7 状態 draft/issued/accepted/declined/expired/
 * paid/voided × 全遷移)。図に描かれているエッジのみ true、それ以外は false という素直な実装
 * (実装計画書「未解決点1」の推奨解釈)。実際に session UPDATE で通る遷移 (accepted/declined/
 * expired/voided 関連) は facade がこの関数の結果のうち該当分のみを使う — draft→issued
 * (issueDocument RPC 経由) や paid⇔issued (payments trigger 専用) は本関数では true を返す
 * ものの、facade の session UPDATE 経路からは呼ばれない (§4.2「遷移の実行主体」参照)。
 *
 * ```
 *                                      ┌────────────► voided (終端)
 *                                      │ (発行後のみ。invoice は入金 0 件時のみ)
 * draft ──issue──► issued ─────────────┤
 *   │                │                 │
 *   │ (DELETE 可)    │ quote:          ├─► accepted ──────► voided
 *   │                ├─► declined (終端)│      ▲
 *   │                └─► expired ──────┼──────┘ (遅れ承諾)
 *   │                                  │
 *   └─(quote_only 原案は明細 0 行のまま滞留可 — 発行は E620 で阻止)
 * invoice のみ:      issued ◄──────► paid
 *                      (Σ入金=total で paid / 入金削除で issued に復帰 — trigger 維持)
 * ```
 */

type TransitionEdge = {
  from: DocumentStatus;
  to: DocumentStatus;
  /** "all" = 全種別対象。配列指定 = その doc_type のみ有効 (§4.2 の「対象種別」列) */
  docTypes: "all" | readonly DocType[];
};

/**
 * §4.1 図 / §4.2 表と 1:1 のエッジ列挙。voided/declined は `from` として一切登場しない
 * (完全終端 — §4.2「voided: 完全終端」「declined: 終端」)。
 */
const TRANSITION_EDGES: readonly TransitionEdge[] = [
  { from: "draft", to: "issued", docTypes: "all" },
  { from: "issued", to: "voided", docTypes: "all" },
  { from: "issued", to: "accepted", docTypes: ["quote"] },
  { from: "issued", to: "declined", docTypes: ["quote"] },
  { from: "issued", to: "expired", docTypes: ["quote"] },
  { from: "issued", to: "paid", docTypes: ["invoice"] },
  { from: "accepted", to: "voided", docTypes: ["quote"] },
  { from: "expired", to: "accepted", docTypes: ["quote"] }, // 遅れ承諾
  { from: "expired", to: "voided", docTypes: ["quote"] },
  { from: "paid", to: "issued", docTypes: ["invoice"] }, // 入金削除による自動復帰 (trigger 専用経路)
];

/**
 * §4.1/§4.2 の状態機械図が持つ全エッジを判定する純関数。DB 非依存。
 * `from === to` は図にエッジとして存在しないため常に false (noop はここでは扱わない — 呼び出し側の責務)。
 */
export function canTransition(docType: DocType, from: DocumentStatus, to: DocumentStatus): boolean {
  return TRANSITION_EDGES.some(
    (edge) =>
      edge.from === from &&
      edge.to === to &&
      (edge.docTypes === "all" || edge.docTypes.includes(docType)),
  );
}

/**
 * 派生可能先の算出 (§4.4): DERIVATION_RULES を `from === docType` に絞り、現在の書類状態が
 * 'issued' または 'accepted' のときのみ返す (draft/declined/expired/voided/paid からは派生不可 — E623)。
 */
export function computeDerivableTo(docType: DocType, status: DocumentStatus): DocType[] {
  if (status !== "issued" && status !== "accepted") return [];
  return DERIVATION_RULES.filter((rule) => rule.from === docType).map((rule) => rule.to);
}
