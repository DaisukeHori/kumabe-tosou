import { describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §1.3 / §6.1 手順 4 / §12.1
 *   (tests/telephony-signature.test.ts の必須ケース一覧)。
 *
 * src/lib/telephony-signature.ts は twilio npm SDK を一切使わず (依存追加禁止の運用判断)、
 * Twilio 公式の署名アルゴリズムを node:crypto で直接実装したもの:
 *   signature = base64(HMAC-SHA1(url + sorted(params) の key+value 連結, authToken))
 * 比較は crypto.timingSafeEqual (定数時間比較)。本ファイルは以下を検証する:
 *   1. 正しい署名で verifyTwilioSignature が true を返す
 *   2. 改竄された署名 (不正な署名) は false を返す
 *   3. パラメータのソート順 (辞書順) の正しさ — 挿入順に依存せず同じ署名になる
 *   4. timingSafeEqual が実際に使われている (単純な `===` 比較ではない)
 *
 * timingSafeEqual の使用検証は 2 通りの方法を併用する:
 *   (a) node:crypto を部分モックし、timingSafeEqual の呼び出しをスパイで捕捉する (挙動検証)
 *   (b) ソースファイルのテキストを直接読み、`timingSafeEqual(` の呼び出しと import が
 *       存在することを静的に確認する (モックが何らかの理由で外れても検知できる保険)
 */

const { timingSafeEqualSpy } = vi.hoisted(() => ({ timingSafeEqualSpy: vi.fn() }));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    timingSafeEqual: (...args: Parameters<typeof actual.timingSafeEqual>) => {
      timingSafeEqualSpy(...args);
      return actual.timingSafeEqual(...args);
    },
  };
});

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { computeTwilioSignature, verifyTwilioSignature } from "@/lib/telephony-signature";

const AUTH_TOKEN = "__telephony_test__auth_token_1234567890";
const URL = "https://kumabe-tosou.example.com/api/telephony/voice";
const PARAMS: Record<string, string> = {
  CallSid: "CA00000000000000000000000000000001",
  From: "+819012345678",
  To: "+81501234567",
  CallStatus: "ringing",
};

/** テスト対象と独立に「Twilio の公式アルゴリズム定義」を直接計算する (自己参照検証を避けるため)。 */
function referenceSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

describe("computeTwilioSignature / verifyTwilioSignature", () => {
  it("Twilio 公式ドキュメント記載の既知サンプルベクタで正しい署名を計算する (実装が Twilio の公式アルゴリズムと一致することの独立検証)", () => {
    // https://www.twilio.com/docs/usage/security#validating-requests (「Validating X-Twilio-Signature」
    // の解説で使われている公開サンプル。多数の公式 SDK ラッパー (twilio-node 等) のテストにも
    // 同一の値が引用されている定番のテストベクタ)。
    const authToken = "12345";
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = {
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675309",
      Digits: "1234",
      From: "+14158675309",
      To: "+18005551212",
    };
    const expected = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";
    expect(computeTwilioSignature(authToken, url, params)).toBe(expected);
  });

  it("computeTwilioSignature が独立実装 (referenceSignature) と一致する", () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(referenceSignature(AUTH_TOKEN, URL, PARAMS));
  });

  it("正しい署名で verifyTwilioSignature が true を返す", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(verifyTwilioSignature(AUTH_TOKEN, signature, URL, PARAMS)).toBe(true);
  });

  it("パラメータの挿入順に依存せず同じ署名になる (辞書順ソートの正しさ)", () => {
    const sameParamsDifferentOrder: Record<string, string> = {
      To: PARAMS.To,
      CallStatus: PARAMS.CallStatus,
      CallSid: PARAMS.CallSid,
      From: PARAMS.From,
    };
    expect(Object.keys(sameParamsDifferentOrder)).not.toEqual(Object.keys(PARAMS)); // 挿入順が実際に違うこと
    expect(computeTwilioSignature(AUTH_TOKEN, URL, sameParamsDifferentOrder)).toBe(
      computeTwilioSignature(AUTH_TOKEN, URL, PARAMS),
    );
  });

  it("値が同じでもパラメータの並び (キー名) が異なれば署名も変わる (ソートが実際に効いていることの反証テスト)", () => {
    // sorted key 順を意図的に崩した (=ソートしない) 計算と比較して不一致になることを確認する
    const unsortedData = Object.keys(PARAMS).reduce((acc, key) => acc + key + PARAMS[key], URL);
    const unsortedSignature = createHmac("sha1", AUTH_TOKEN).update(unsortedData, "utf8").digest("base64");
    // PARAMS は元々 CallSid/From/To/CallStatus の順で定義されており、辞書順 (CallSid/CallStatus/From/To)
    // とは異なるため、ソート無し版とソート有り版の署名は一致しないはず
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).not.toBe(unsortedSignature);
  });

  it("空値パラメータを含んでいても署名計算に反映される (脱落しない)", () => {
    const withEmpty = { ...PARAMS, From: "" };
    const expected = referenceSignature(AUTH_TOKEN, URL, withEmpty);
    expect(computeTwilioSignature(AUTH_TOKEN, URL, withEmpty)).toBe(expected);
    // 空値の有無で署名が変わること (空値が単純に無視されていないことの確認)
    expect(computeTwilioSignature(AUTH_TOKEN, URL, withEmpty)).not.toBe(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS));
  });

  it("クエリ付き URL (?step=dial_result 等) は URL 文字列ごと署名対象になる", () => {
    const urlWithQuery = `${URL}?step=dial_result`;
    const expected = referenceSignature(AUTH_TOKEN, urlWithQuery, PARAMS);
    expect(computeTwilioSignature(AUTH_TOKEN, urlWithQuery, PARAMS)).toBe(expected);
    // クエリの有無で署名が変わること (URL がそのまま連結されている裏取り)
    expect(computeTwilioSignature(AUTH_TOKEN, urlWithQuery, PARAMS)).not.toBe(
      computeTwilioSignature(AUTH_TOKEN, URL, PARAMS),
    );
  });
});

describe("verifyTwilioSignature: 不正な署名の拒否", () => {
  it("改竄された署名 (Base64 として妥当・長さも同じ) は false を返す", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    // 末尾 1 文字を別の Base64 文字に差し替える (長さは変えない — timingSafeEqual に到達させるため)
    const lastChar = signature.at(-1);
    const replacement = lastChar === "A" ? "B" : "A";
    const tampered = signature.slice(0, -1) + replacement;
    expect(tampered).not.toBe(signature);
    expect(tampered.length).toBe(signature.length);
    expect(verifyTwilioSignature(AUTH_TOKEN, tampered, URL, PARAMS)).toBe(false);
  });

  it("別の authToken で計算した署名は false を返す (authToken 不一致)", () => {
    const wrongSignature = computeTwilioSignature("__telephony_test__wrong_token", URL, PARAMS);
    expect(verifyTwilioSignature(AUTH_TOKEN, wrongSignature, URL, PARAMS)).toBe(false);
  });

  it("パラメータが改竄されている (署名計算時と内容が違う) と false を返す", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    const tamperedParams = { ...PARAMS, To: "+81501234568" }; // 1 桁だけ違う番号
    expect(verifyTwilioSignature(AUTH_TOKEN, signature, URL, tamperedParams)).toBe(false);
  });

  it("URL が改竄されている (署名計算時と違う) と false を返す", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(verifyTwilioSignature(AUTH_TOKEN, signature, `${URL}?step=dial_result`, PARAMS)).toBe(false);
  });

  it("長さが異なる署名 (例: 末尾切り詰め) は false を返す", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    const truncated = signature.slice(0, -4);
    expect(truncated.length).not.toBe(signature.length);
    expect(verifyTwilioSignature(AUTH_TOKEN, truncated, URL, PARAMS)).toBe(false);
  });

  it("署名ヘッダが null (ヘッダ欠落) のときは常に false を返す", () => {
    expect(verifyTwilioSignature(AUTH_TOKEN, null, URL, PARAMS)).toBe(false);
  });

  it("署名ヘッダが空文字のときも false を返す", () => {
    expect(verifyTwilioSignature(AUTH_TOKEN, "", URL, PARAMS)).toBe(false);
  });
});

describe("verifyTwilioSignature: timingSafeEqual の使用 (定数時間比較。単純な === は使わない)", () => {
  it("正しい署名の検証で timingSafeEqual が実際に呼ばれる", () => {
    timingSafeEqualSpy.mockClear();
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    const result = verifyTwilioSignature(AUTH_TOKEN, signature, URL, PARAMS);
    expect(result).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("同じ長さの改竄署名の検証でも timingSafeEqual が呼ばれる (長さ一致後に定数時間比較へ進む)", () => {
    timingSafeEqualSpy.mockClear();
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    const lastChar = signature.at(-1);
    const tampered = signature.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    const result = verifyTwilioSignature(AUTH_TOKEN, tampered, URL, PARAMS);
    expect(result).toBe(false);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("長さが異なる場合は timingSafeEqual を呼ばずに弾く (timingSafeEqual は長さ不一致で例外を投げるため、事前に長さ比較している設計の裏取り)", () => {
    timingSafeEqualSpy.mockClear();
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    const truncated = signature.slice(0, -4);
    const result = verifyTwilioSignature(AUTH_TOKEN, truncated, URL, PARAMS);
    expect(result).toBe(false);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });

  it("署名ヘッダが null のときは timingSafeEqual を呼ばずに弾く (早期 return)", () => {
    timingSafeEqualSpy.mockClear();
    verifyTwilioSignature(AUTH_TOKEN, null, URL, PARAMS);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });

  it("(静的検証・保険) ソースファイルが timingSafeEqual を node:crypto から import し、実際に呼び出していること。'===' による生の文字列比較 (タイミング攻撃に弱い実装への先祖返り) が無いこと", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/lib/telephony-signature.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s*\{[^}]*timingSafeEqual[^}]*\}\s*from\s*"node:crypto"/);
    expect(source).toMatch(/timingSafeEqual\(/);
    // 署名文字列同士を直接 === で比較していない (expected/provided の変数名は実装依存のため、
    // "Signature" を含む識別子同士の === 比較が無いことをゆるく検査する)
    expect(source).not.toMatch(/Signature\s*===\s*\w*[Ss]ignature/);
  });
});
