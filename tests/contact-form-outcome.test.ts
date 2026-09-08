import { describe, expect, it } from "vitest";

import { resolveSubmitOutcome } from "@/components/contact/submit-outcome";
import type { ContactSubmitAttempt } from "@/components/contact/submit-outcome";

/**
 * contact フォーム onSubmit の「結果 → 表示」分岐 (純関数) の単体テスト。
 *
 * 目的は「どの経路でも必ず何かを表示する」ことの担保。特に Server Action の呼び出しが
 * 例外 (500 / デプロイ跨ぎの Action ID 不一致 / 通信断) になった場合に、画面が無反応に
 * ならず再読み込み案内 (contact.form.error.network) が出ることを固定する。
 */

describe("resolveSubmitOutcome — 正常な戻り値", () => {
  it("success はそのまま成功表示", () => {
    expect(resolveSubmitOutcome({ ok: true, result: { status: "success" } })).toEqual({
      kind: "success",
    });
  });

  it("rate_limited は送信回数上限の文言", () => {
    expect(resolveSubmitOutcome({ ok: true, result: { status: "rate_limited" } })).toEqual({
      kind: "error",
      textKey: "contact.form.error.rateLimited",
    });
  });

  it("invalid は invalid 文言 + サーバ生メッセージ (root エラー用)", () => {
    expect(
      resolveSubmitOutcome({
        ok: true,
        result: { status: "invalid", message: "入力内容をご確認ください。" },
      }),
    ).toEqual({
      kind: "error",
      textKey: "contact.form.error.invalid",
      rootMessage: "入力内容をご確認ください。",
    });
  });

  it("error は汎用送信失敗の文言", () => {
    expect(resolveSubmitOutcome({ ok: true, result: { status: "error" } })).toEqual({
      kind: "error",
      textKey: "contact.form.error.generic",
    });
  });
});

describe("resolveSubmitOutcome — 例外・想定外の戻り値 (無反応にしない)", () => {
  it("Server Action が例外 (500 / 通信断) なら再読み込み案内を出す", () => {
    expect(
      resolveSubmitOutcome({ ok: false, thrown: new Error("Internal Server Error") }),
    ).toEqual({ kind: "error", textKey: "contact.form.error.network" });
  });

  it("デプロイ跨ぎの Action ID 不一致 (Server Action was not found) も再読み込み案内", () => {
    expect(
      resolveSubmitOutcome({
        ok: false,
        thrown: new Error('Server Action "0000" was not found on the server'),
      }),
    ).toEqual({ kind: "error", textKey: "contact.form.error.network" });
  });

  it("throw された値が Error でなくても (文字列 / undefined) 表示は出る", () => {
    expect(resolveSubmitOutcome({ ok: false, thrown: "boom" }).kind).toBe("error");
    expect(resolveSubmitOutcome({ ok: false, thrown: undefined }).kind).toBe("error");
  });

  it("戻り値が undefined / null / 未知の status でも黙って無反応にはならない", () => {
    const cases: ContactSubmitAttempt[] = [
      { ok: true, result: undefined as never },
      { ok: true, result: null as never },
      { ok: true, result: { status: "who-knows" } as never },
    ];
    for (const attempt of cases) {
      expect(resolveSubmitOutcome(attempt)).toEqual({
        kind: "error",
        textKey: "contact.form.error.network",
      });
    }
  });
});
