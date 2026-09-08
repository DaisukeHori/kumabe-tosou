import type { SubmitContactResult } from "./actions";

/**
 * contact フォーム送信の「結果 → 画面表示」判定 (純関数)。
 *
 * contact-form.tsx の onSubmit から分岐ロジックだけを切り出したもの。React に依存しない
 * ため tests/contact-form-outcome.test.ts で全分岐 (成功 / rate limit / invalid /
 * サーバ error / 例外 / 想定外の戻り値) を単体検証できる。
 *
 * 重要なのは「どの経路でも必ず何らかの outcome を返す」こと。Server Action の呼び出しが
 * 例外 (通信断 / 500 / デプロイ跨ぎで Action ID 不一致) になった場合も network エラーの
 * outcome を返し、画面が「押しても何も起きない」状態にならないようにする。
 */

/** onSubmit が Server Action を呼び出した結果。例外は ok:false で包んで渡す */
export type ContactSubmitAttempt =
  | { ok: true; result: SubmitContactResult }
  | { ok: false; thrown: unknown };

/** 表示に使うエラー文言の text slot key */
export type ContactErrorTextKey =
  | "contact.form.error.rateLimited"
  | "contact.form.error.invalid"
  | "contact.form.error.generic"
  | "contact.form.error.network";

export type ContactSubmitOutcome =
  | { kind: "success" }
  | {
      kind: "error";
      /** 画面に出す文言のスロットキー (文言そのものは registry から引く) */
      textKey: ContactErrorTextKey;
      /** react-hook-form の root エラーに載せるサーバ生メッセージ (invalid のみ) */
      rootMessage?: string;
    };

export function resolveSubmitOutcome(attempt: ContactSubmitAttempt): ContactSubmitOutcome {
  if (!attempt.ok) {
    return { kind: "error", textKey: "contact.form.error.network" };
  }

  const result = attempt.result;
  // 戻り値が想定外 (null / undefined / 未知の status) の場合も握りつぶさず、
  // 再読み込みを促す network 文言にフォールバックする。
  if (!result || typeof result !== "object" || typeof result.status !== "string") {
    return { kind: "error", textKey: "contact.form.error.network" };
  }

  switch (result.status) {
    case "success":
      return { kind: "success" };
    case "rate_limited":
      return { kind: "error", textKey: "contact.form.error.rateLimited" };
    case "invalid":
      return {
        kind: "error",
        textKey: "contact.form.error.invalid",
        rootMessage: result.message,
      };
    case "error":
      return { kind: "error", textKey: "contact.form.error.generic" };
    default:
      return { kind: "error", textKey: "contact.form.error.network" };
  }
}
