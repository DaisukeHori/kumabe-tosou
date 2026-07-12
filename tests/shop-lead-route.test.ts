import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/06-simulator.md §6.1 (処理シーケンス 0-a〜4) / §5.2 (facade 呼び出し全列挙)。
 * 計画書 issue-60.md「テスト戦略」節: POST /api/shop/lead の合成順序・巻き戻さないこと・
 * stealth 判定順序・サーバ再計算 (0-e)・rate limit route 引数化・status↔code 対応表を検証する。
 *
 * facade 4 本 (pricing/inquiry/crm/sales) + rate limit をすべてモジュールごとモックし、
 * DB/service client には一切触れない (docker 無し方針、計画書「結合(DB)」節どおり — 本ファイルの
 * モック注入のみで完結させ、新規結合 DB テストは追加しない)。
 */

const checkAndRecordRateLimitMock = vi.fn();
vi.mock("@/components/contact/rate-limit.server", () => ({
  checkAndRecordRateLimit: (...args: unknown[]) => checkAndRecordRateLimitMock(...args),
}));

const inquirySubmitMock = vi.fn();
vi.mock("@/modules/inquiry/facade", () => ({
  inquiryFacade: {
    submit: (...args: unknown[]) => inquirySubmitMock(...args),
  },
}));

const intakeFromSimulatorMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    intakeFromSimulator: (...args: unknown[]) => intakeFromSimulatorMock(...args),
  },
}));

const getActivePriceTableMock = vi.fn();
const estimateMock = vi.fn();
vi.mock("@/modules/pricing/facade", () => ({
  createPricingFacade: () => ({
    getActivePriceTable: (...args: unknown[]) => getActivePriceTableMock(...args),
    estimate: (...args: unknown[]) => estimateMock(...args),
  }),
}));

const createDraftQuoteFromEstimateMock = vi.fn();
vi.mock("@/modules/sales/facade", () => ({
  createSalesFacade: () => ({
    createDraftQuoteFromEstimate: (...args: unknown[]) => createDraftQuoteFromEstimateMock(...args),
  }),
}));

import { POST } from "@/app/api/shop/lead/route";
import type { SimulatorLeadReq, SimulatorLeadResponse } from "@/app/api/shop/lead/schema";
import type { PriceTable } from "@/modules/pricing/contracts";

const NOW_ISO = new Date().toISOString();

function buildPriceTable(): PriceTable {
  return {
    grades: [
      {
        id: "grade-standard",
        key: "standard",
        label: "スタンダード",
        description: "SOLID + 2K CLEAR",
        sort_order: 1,
        is_active: true,
        updated_at: NOW_ISO,
      },
    ],
    size_classes: [
      { key: "m", label: "〜200mm", max_mm: 200, quote_only: false, sort_order: 1 },
    ],
    matrix: [{ grade_key: "standard", size_key: "m", price_min: 14000, price_max: 20000 }],
    quantity_tiers: [],
    options: [
      {
        id: "opt-express",
        key: "express",
        label: "特急仕上げ",
        kind: "multiplier",
        value: 1.5,
        sort_order: 0,
        is_active: true,
        updated_at: NOW_ISO,
      },
    ],
  };
}

/** サーバ側 estimate() の「正しい」再計算結果 (クライアント申告と食い違わせるテストの正本値) */
const SERVER_ESTIMATE_RESULT = {
  quote_only: false as const,
  total_min: 14000,
  total_max: 20000,
  applied_tier: null,
  breakdown: [{ label: "スタンダード", factor: "〜200mm" }],
};

function validPayload(overrides: Partial<SimulatorLeadReq> = {}): SimulatorLeadReq {
  return {
    contact: { name: "山田太郎", email: "yamada@example.com", tel: null },
    message: null,
    privacy_agreed: true,
    estimate: {
      grade_key: "standard",
      grade_label: "スタンダード",
      size_key: "m",
      size_label: "〜200mm",
      quantity: 10,
      option_keys: ["express"],
      quote_only: false,
      total_min: 14000,
      total_max: 20000,
      applied_tier: null,
      breakdown: [{ label: "スタンダード", factor: "〜200mm" }],
    },
    honeypot: "",
    // 十分に過去 (>3秒) の描画時刻。stealth のタイミング判定に確実に通過させる。
    form_rendered_at: Date.now() - 60_000,
    ...overrides,
  };
}

function makeJsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/shop/lead", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(rawBody: string): Request {
  return new Request("http://localhost/api/shop/lead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
}

async function readJson(res: Response): Promise<SimulatorLeadResponse> {
  return (await res.json()) as SimulatorLeadResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkAndRecordRateLimitMock.mockResolvedValue({ ok: true, value: undefined });
  inquirySubmitMock.mockResolvedValue({ ok: true, value: { id: "inquiry-1" } });
  getActivePriceTableMock.mockResolvedValue({ ok: true, value: buildPriceTable() });
  estimateMock.mockReturnValue({ ok: true, value: SERVER_ESTIMATE_RESULT });
  intakeFromSimulatorMock.mockResolvedValue({
    ok: true,
    value: { customer_id: "customer-1", deal_id: "deal-1" },
  });
  createDraftQuoteFromEstimateMock.mockResolvedValue({ ok: true, value: { document_id: "doc-1" } });
});

describe("POST /api/shop/lead — 正常系の合成順序 (0-e → 1 → 2 → 3)", () => {
  it("pricing→inquiry→crm→sales の順に1回ずつ呼ばれ、200 ok:true を返す", async () => {
    const callOrder: string[] = [];
    getActivePriceTableMock.mockImplementationOnce(async () => {
      callOrder.push("pricing.getActivePriceTable");
      return { ok: true, value: buildPriceTable() };
    });
    estimateMock.mockImplementationOnce(() => {
      callOrder.push("pricing.estimate");
      return { ok: true, value: SERVER_ESTIMATE_RESULT };
    });
    inquirySubmitMock.mockImplementationOnce(async () => {
      callOrder.push("inquiry.submit");
      return { ok: true, value: { id: "inquiry-1" } };
    });
    intakeFromSimulatorMock.mockImplementationOnce(async () => {
      callOrder.push("crm.intakeFromSimulator");
      return { ok: true, value: { customer_id: "customer-1", deal_id: "deal-1" } };
    });
    createDraftQuoteFromEstimateMock.mockImplementationOnce(async () => {
      callOrder.push("sales.createDraftQuoteFromEstimate");
      return { ok: true, value: { document_id: "doc-1" } };
    });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(callOrder).toEqual([
      "pricing.getActivePriceTable",
      "pricing.estimate",
      "inquiry.submit",
      "crm.intakeFromSimulator",
      "sales.createDraftQuoteFromEstimate",
    ]);
  });

  it("intakeFromSimulator には inquiry_id と contact/estimate が渡る", async () => {
    await POST(makeJsonRequest(validPayload()));
    expect(intakeFromSimulatorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inquiry_id: "inquiry-1",
        contact: { name: "山田太郎", email: "yamada@example.com", tel: null },
      }),
    );
  });

  it("createDraftQuoteFromEstimate には crm から返った deal_id が渡る", async () => {
    intakeFromSimulatorMock.mockResolvedValueOnce({
      ok: true,
      value: { customer_id: "customer-9", deal_id: "deal-9" },
    });
    await POST(makeJsonRequest(validPayload()));
    expect(createDraftQuoteFromEstimateMock).toHaveBeenCalledWith(
      expect.objectContaining({ deal_id: "deal-9" }),
    );
  });
});

describe("POST /api/shop/lead — 巻き戻さない (手順2/3失敗時も200維持)", () => {
  it("crm 取込 (手順2) が失敗しても 200 を返し、手順1 (inquiry) は保持される。手順3 (sales) は呼ばれない", async () => {
    intakeFromSimulatorMock.mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "db down" });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(inquirySubmitMock).toHaveBeenCalledTimes(1);
    expect(createDraftQuoteFromEstimateMock).not.toHaveBeenCalled();
  });

  it("見積原案 (手順3) が失敗しても 200 を返す (手順1/2は成功済み)", async () => {
    createDraftQuoteFromEstimateMock.mockResolvedValueOnce({
      ok: false,
      code: "KMB-E901",
      detail: "draft failed",
    });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(inquirySubmitMock).toHaveBeenCalledTimes(1);
    expect(intakeFromSimulatorMock).toHaveBeenCalledTimes(1);
    expect(createDraftQuoteFromEstimateMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/shop/lead — stealth 判定 (0-b は 0-d strict parse より必ず先)", () => {
  it("honeypot 充填時は 200 を無言で返し、rate limit も inquiry も一切呼ばれない", async () => {
    const res = await POST(makeJsonRequest(validPayload({ honeypot: "http://spam.example" })));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("3秒未満の送信は 200 を無言で返し、rate limit も inquiry も一切呼ばれない", async () => {
    const res = await POST(makeJsonRequest(validPayload({ form_rendered_at: Date.now() - 500 })));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("honeypot 充填 かつ 契約違反 body (email欠落等) でも 400 の Zod 詳細を返さず 200 になる (v1.0 の再発防止)", async () => {
    const malformedBotBody = {
      contact: { name: "bot" }, // email 欠落・strict 契約違反
      honeypot: "spam",
      form_rendered_at: Date.now() - 60_000,
      extra_unexpected_key: true,
    };

    const res = await POST(makeJsonRequest(malformedBotBody));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
  });

  it("honeypot/form_rendered_at が型不正でも bot 側に倒され 200 になる (catch フォールバック)", async () => {
    const weirdBody = { honeypot: 12345, form_rendered_at: "not-a-number" };

    const res = await POST(makeJsonRequest(weirdBody));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/shop/lead — rate limit (route引数 'shop_lead' + 429 KMB-E105)", () => {
  it("checkAndRecordRateLimit は route='shop_lead' で呼ばれる", async () => {
    await POST(makeJsonRequest(validPayload()));
    expect(checkAndRecordRateLimitMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      "shop_lead",
    );
  });

  it("超過時は 429 + KMB-E105 を返し、以降 (strict parse 含む) は実行されない", async () => {
    checkAndRecordRateLimitMock.mockResolvedValueOnce({
      ok: false,
      code: "KMB-E105",
      detail: "rate_limit_exceeded",
    });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(429);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E105" });
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/shop/lead — 0-e サーバ再計算 (クライアント申告値を信頼しない)", () => {
  it("改ざんされた totals/labels はサーバ再計算値で上書きされ、乖離注記が本文に付与される", async () => {
    const tampered = validPayload({
      estimate: {
        grade_key: "standard",
        grade_label: "改ざんラベル",
        size_key: "m",
        size_label: "改ざんサイズ",
        quantity: 10,
        option_keys: ["express"],
        quote_only: false,
        total_min: 1, // 改ざん (サーバ正本は 14000)
        total_max: 2, // 改ざん (サーバ正本は 20000)
        applied_tier: null,
        breakdown: [],
      },
    });

    await POST(makeJsonRequest(tampered));

    expect(inquirySubmitMock).toHaveBeenCalledTimes(1);
    const submittedInput = inquirySubmitMock.mock.calls[0]?.[0] as { body: string; item: string };
    // サーバ正本 (グレード/サイズラベル) が使われ、改ざん値ではない
    expect(submittedInput.item).toContain("スタンダード");
    expect(submittedInput.item).not.toContain("改ざん");
    expect(submittedInput.body).toContain("¥14,000〜¥20,000");
    expect(submittedInput.body).not.toContain("¥1〜¥2");
    expect(submittedInput.body).toContain("送信時の表示金額と現行価格表に乖離があります");
  });

  it("クライアント申告値がサーバ再計算と一致するなら乖離注記は付与されない", async () => {
    await POST(makeJsonRequest(validPayload()));

    const submittedInput = inquirySubmitMock.mock.calls[0]?.[0] as { body: string };
    expect(submittedInput.body).not.toContain("乖離があります");
    expect(submittedInput.body).not.toContain("未検証");
  });

  it("価格表取得失敗 (E901) 時はクライアント申告値をそのまま使い「未検証」注記を付与し、crm/salesはスキップする", async () => {
    getActivePriceTableMock.mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "down" });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(inquirySubmitMock).toHaveBeenCalledTimes(1);
    const submittedInput = inquirySubmitMock.mock.calls[0]?.[0] as { body: string };
    expect(submittedInput.body).toContain("価格表未取得のため送信時の表示金額をそのまま記載（未検証）");
    expect(intakeFromSimulatorMock).not.toHaveBeenCalled();
    expect(createDraftQuoteFromEstimateMock).not.toHaveBeenCalled();
  });

  it("価格表は取得できたが grade_key/size_key が現行表に存在しない場合も「未検証」縮退にする (安全側)", async () => {
    const staleGradeKey = validPayload({
      estimate: {
        grade_key: "discontinued-grade",
        grade_label: "廃止グレード",
        size_key: "m",
        size_label: "〜200mm",
        quantity: 1,
        option_keys: [],
        quote_only: false,
        total_min: 1000,
        total_max: 2000,
        applied_tier: null,
        breakdown: [],
      },
    });

    const res = await POST(makeJsonRequest(staleGradeKey));

    expect(res.status).toBe(200);
    expect(inquirySubmitMock).toHaveBeenCalledTimes(1);
    const submittedInput = inquirySubmitMock.mock.calls[0]?.[0] as { body: string };
    expect(submittedInput.body).toContain("未検証");
    expect(intakeFromSimulatorMock).not.toHaveBeenCalled();
  });

  it("pricing.estimate() が契約違反 (KMB-E101) を返したら 400 として扱う", async () => {
    estimateMock.mockReturnValueOnce({ ok: false, code: "KMB-E101", detail: "invalid input" });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E101" });
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/shop/lead — status↔code 対応表 (§6.1)", () => {
  it("0-a: JSON parse 失敗 → 400 KMB-E101", async () => {
    const res = await POST(makeRawRequest("{not valid json"));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E101" });
  });

  it("0-d: strict 契約違反 (email 欠落) → 400 KMB-E101 (bot ではないので strict parse まで到達する)", async () => {
    const invalid = {
      contact: { name: "山田太郎", tel: null }, // email 欠落
      message: null,
      privacy_agreed: true,
      estimate: validPayload().estimate,
      honeypot: "",
      form_rendered_at: Date.now() - 60_000,
    };

    const res = await POST(makeJsonRequest(invalid));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E101" });
  });

  it("1: inquiryFacade.submit が KMB-E101 を返せば 400", async () => {
    inquirySubmitMock.mockResolvedValueOnce({ ok: false, code: "KMB-E101", detail: "invalid" });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E101" });
  });

  it("1: inquiryFacade.submit がそれ以外のエラーを返せば 500 KMB-E901", async () => {
    inquirySubmitMock.mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "insert failed" });

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(500);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E901" });
  });

  it("予期しない例外 (facade が reject) は握り潰さず 500 KMB-E901 を返す", async () => {
    inquirySubmitMock.mockRejectedValueOnce(new Error("unexpected throw"));

    const res = await POST(makeJsonRequest(validPayload()));

    expect(res.status).toBe(500);
    expect(await readJson(res)).toMatchObject({ ok: false, code: "KMB-E901" });
  });
});
