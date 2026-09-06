import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteIntegrationCredentials,
  getIntegrationStatus,
  hasRequiredCredentials,
  invalidateIntegrationCredentialsCache,
  isIntegrationConfigured,
  resolveIntegrationCredentials,
  saveIntegrationCredentials,
} from "@/lib/integration-credentials";

/**
 * integration_credentials テーブル + Vault RPC を最小限に模したフェイク client。
 * rows: provider → 行、vault: name → secret。
 */
function createFakeClient() {
  const rows = new Map<string, Record<string, unknown>>();
  const vault = new Map<string, string>();
  const calls: string[] = [];

  const client = {
    from(table: string) {
      expect(table).toBe("integration_credentials");
      return {
        select() {
          return {
            eq(_col: string, provider: string) {
              return {
                async maybeSingle() {
                  calls.push(`select:${provider}`);
                  return { data: rows.get(provider) ?? null, error: null };
                },
              };
            },
          };
        },
        async upsert(row: Record<string, unknown>) {
          calls.push(`upsert:${String(row.provider)}`);
          rows.set(String(row.provider), { ...row, updated_at: "2026-09-06T00:00:00Z" });
          return { error: null };
        },
        delete() {
          return {
            async eq(_col: string, provider: string) {
              calls.push(`delete:${provider}`);
              rows.delete(provider);
              return { error: null };
            },
          };
        },
      };
    },
    async rpc(name: string, args: Record<string, string>) {
      calls.push(`rpc:${name}:${args.p_name}`);
      if (name === "vault_upsert_secret") {
        vault.set(args.p_name, args.p_secret);
        return { data: null, error: null };
      }
      if (name === "vault_read_secret") {
        return { data: vault.get(args.p_name) ?? null, error: null };
      }
      if (name === "vault_delete_secret") {
        vault.delete(args.p_name);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return { client: client as never, rows, vault, calls };
}

const ENV_KEYS = [
  "OAUTH_ENABLED",
  "OAUTH_STATE_SECRET",
  "VERCEL_ENV",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "RESEND_API_KEY",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OAUTH_STATE_SECRET = "x".repeat(40);
  invalidateIntegrationCredentialsCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe("hasRequiredCredentials", () => {
  it("google_calendar は client_id と secret の両方が必須", () => {
    expect(hasRequiredCredentials("google_calendar", { publicId: "id", secret: null })).toBe(false);
    expect(hasRequiredCredentials("google_calendar", { publicId: "id", secret: "s" })).toBe(true);
  });
  it("x は secret 任意 (PKCE パブリッククライアント)", () => {
    expect(hasRequiredCredentials("x", { publicId: "id", secret: null })).toBe(true);
    expect(hasRequiredCredentials("x", { publicId: null, secret: "s" })).toBe(false);
  });
  it("resend は secret のみ必須", () => {
    expect(hasRequiredCredentials("resend", { publicId: null, secret: null })).toBe(false);
    expect(hasRequiredCredentials("resend", { publicId: null, secret: "re_x" })).toBe(true);
  });
});

describe("resolveIntegrationCredentials", () => {
  it("DB 行が無ければ env にフォールバックする (source=env)", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    const { client } = createFakeClient();
    const r = await resolveIntegrationCredentials("twilio", { client });
    expect(r).toEqual({ provider: "twilio", publicId: "AC123", secret: "tok", source: "env" });
  });

  it("DB 行があれば env より優先し、secret は Vault から読む (source=db)", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC-env";
    process.env.TWILIO_AUTH_TOKEN = "tok-env";
    const { client, rows, vault } = createFakeClient();
    rows.set("twilio", {
      provider: "twilio",
      public_id: "AC-db",
      secret_vault_name: "integration_twilio_secret",
      secret_last4: "k-db",
      updated_at: "2026-09-06T00:00:00Z",
    });
    vault.set("integration_twilio_secret", "tok-db");
    const r = await resolveIntegrationCredentials("twilio", { client });
    expect(r).toEqual({ provider: "twilio", publicId: "AC-db", secret: "tok-db", source: "db" });
  });

  it("どちらにも無ければ source=none", async () => {
    const { client } = createFakeClient();
    const r = await resolveIntegrationCredentials("resend", { client });
    expect(r.source).toBe("none");
    expect(r.secret).toBeNull();
  });

  it("30 秒キャッシュ: 2 回目は DB を読まない。invalidate 後は再読込", async () => {
    const { client, calls } = createFakeClient();
    await resolveIntegrationCredentials("x", { client });
    await resolveIntegrationCredentials("x", { client });
    expect(calls.filter((c) => c === "select:x")).toHaveLength(1);
    invalidateIntegrationCredentialsCache("x");
    await resolveIntegrationCredentials("x", { client });
    expect(calls.filter((c) => c === "select:x")).toHaveLength(2);
  });

  it("DB 読み取りが例外でも env にフォールバックし、例外を投げない", async () => {
    process.env.RESEND_API_KEY = "re_env";
    const broken = {
      from() {
        throw new Error("db down");
      },
    } as never;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await resolveIntegrationCredentials("resend", { client: broken });
    expect(r).toEqual({ provider: "resend", publicId: null, secret: "re_env", source: "env" });
    expect(warn).toHaveBeenCalled();
  });
});

describe("isIntegrationConfigured", () => {
  it("OAuth 系は OAUTH_STATE_SECRET 未設定なら値が揃っていても false", async () => {
    delete process.env.OAUTH_STATE_SECRET;
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "id";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "s";
    const { client } = createFakeClient();
    expect(await isIntegrationConfigured("google_calendar", { client })).toBe(false);
  });

  it("OAUTH_ENABLED が未設定でも (\"false\" でなければ) 有効", async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "id";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "s";
    const { client } = createFakeClient();
    expect(await isIntegrationConfigured("google_calendar", { client })).toBe(true);
  });

  it("OAUTH_ENABLED=false で明示的に止められる", async () => {
    process.env.OAUTH_ENABLED = "false";
    process.env.X_CLIENT_ID = "id";
    const { client } = createFakeClient();
    expect(await isIntegrationConfigured("x", { client })).toBe(false);
  });

  it("Vercel Preview 環境では OAuth 系は常に false", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.X_CLIENT_ID = "id";
    const { client } = createFakeClient();
    expect(await isIntegrationConfigured("x", { client })).toBe(false);
  });

  it("非 OAuth 系 (twilio / resend) は OAuth スイッチに影響されない", async () => {
    delete process.env.OAUTH_STATE_SECRET;
    process.env.RESEND_API_KEY = "re_x";
    const { client } = createFakeClient();
    expect(await isIntegrationConfigured("resend", { client })).toBe(true);
  });
});

describe("saveIntegrationCredentials / deleteIntegrationCredentials", () => {
  it("保存: secret は Vault へ、テーブルには末尾 4 桁のみ。保存後は resolve が db 由来になる", async () => {
    const { client, rows, vault } = createFakeClient();
    const r = await saveIntegrationCredentials("meta", { publicId: "app-1", secret: "supersecret9876" }, "user-1", {
      client,
    });
    expect(r.ok).toBe(true);
    expect(vault.get("integration_meta_secret")).toBe("supersecret9876");
    const row = rows.get("meta");
    expect(row?.public_id).toBe("app-1");
    expect(row?.secret_last4).toBe("9876");
    expect(row?.updated_by).toBe("user-1");
    expect(JSON.stringify(row)).not.toContain("supersecret9876");

    const resolved = await resolveIntegrationCredentials("meta", { client });
    expect(resolved).toEqual({ provider: "meta", publicId: "app-1", secret: "supersecret9876", source: "db" });
  });

  it("secret 空で再保存すると既存の secret を維持し publicId だけ更新する", async () => {
    const { client, rows, vault } = createFakeClient();
    await saveIntegrationCredentials("meta", { publicId: "app-1", secret: "secret-A" }, null, { client });
    const r = await saveIntegrationCredentials("meta", { publicId: "app-2", secret: "" }, null, { client });
    expect(r.ok).toBe(true);
    expect(rows.get("meta")?.public_id).toBe("app-2");
    expect(vault.get("integration_meta_secret")).toBe("secret-A");
  });

  it("初回保存で必須 secret が空なら KMB-E101", async () => {
    const { client } = createFakeClient();
    const r = await saveIntegrationCredentials("meta", { publicId: "app-1", secret: null }, null, { client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("KMB-E101");
  });

  it("識別子が必須のプロバイダで publicId 空なら KMB-E101", async () => {
    const { client } = createFakeClient();
    const r = await saveIntegrationCredentials("twilio", { publicId: "", secret: "tok" }, null, { client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("KMB-E101");
  });

  it("x は secret 無しでも保存できる (PKCE)", async () => {
    const { client } = createFakeClient();
    const r = await saveIntegrationCredentials("x", { publicId: "cid", secret: null }, null, { client });
    expect(r.ok).toBe(true);
    expect(await isIntegrationConfigured("x", { client })).toBe(true);
  });

  it("resend は publicId を無視し secret のみ保存する", async () => {
    const { client, rows } = createFakeClient();
    const r = await saveIntegrationCredentials("resend", { publicId: "ignored", secret: "re_abcd" }, null, { client });
    expect(r.ok).toBe(true);
    expect(rows.get("resend")?.public_id).toBeNull();
  });

  it("削除: Vault と行を消し、以後は env フォールバックに戻る", async () => {
    process.env.RESEND_API_KEY = "re_env";
    const { client, rows, vault } = createFakeClient();
    await saveIntegrationCredentials("resend", { publicId: null, secret: "re_db" }, null, { client });
    expect((await resolveIntegrationCredentials("resend", { client })).secret).toBe("re_db");
    const r = await deleteIntegrationCredentials("resend", { client });
    expect(r.ok).toBe(true);
    expect(rows.has("resend")).toBe(false);
    expect(vault.has("integration_resend_secret")).toBe(false);
    expect((await resolveIntegrationCredentials("resend", { client })).source).toBe("env");
  });
});

describe("getIntegrationStatus", () => {
  it("DB 保存済みなら publicId / 末尾 4 桁 / 更新日時を返し secret は含めない", async () => {
    const { client } = createFakeClient();
    await saveIntegrationCredentials("twilio", { publicId: "AC1", secret: "token1234" }, null, { client });
    const s = await getIntegrationStatus("twilio", { client });
    expect(s).toMatchObject({ provider: "twilio", configured: true, source: "db", publicId: "AC1", secretSet: true, secretLast4: "1234" });
    expect(s.updatedAt).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain("token1234");
  });

  it("env 由来なら publicId は露出せず source=env で configured を返す", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC-env";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    const { client } = createFakeClient();
    const s = await getIntegrationStatus("twilio", { client });
    expect(s).toMatchObject({ configured: true, source: "env", publicId: null, secretSet: true, secretLast4: null });
  });

  it("OAuth 系は値が揃っていても OAuth スイッチが無効なら configured=false", async () => {
    delete process.env.OAUTH_STATE_SECRET;
    const { client } = createFakeClient();
    await saveIntegrationCredentials("meta", { publicId: "a", secret: "b" }, null, { client });
    const s = await getIntegrationStatus("meta", { client });
    expect(s.configured).toBe(false);
    expect(s.source).toBe("db");
  });
});
