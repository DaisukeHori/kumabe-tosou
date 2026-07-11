import { z } from "zod";

import type { KmbErrorCode } from "./errors";

export type { KmbErrorCode };

/**
 * canonical: docs/module-contracts.md §4.1 (共通スカラー)
 * 実装は本ファイルに写経し、乖離時は module-contracts.md を正とする。
 */

/**
 * 除去対象の制御文字コードポイント (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)。
 * 改行 (0x0A) / タブ (0x09) / CR (0x0D) は保持する。
 * (契約書 §4.1 の正規表現 `[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]` と同じ集合を
 *  コードポイント列挙で表現。ツール層でのエスケープ事故を避けるための実装上の工夫であり、
 *  除去対象の集合そのものは契約書と完全に一致する)
 */
const CONTROL_CHAR_CODES = new Set<number>([
  ...Array.from({ length: 9 }, (_, i) => i), // 0x00-0x08
  0x0b,
  0x0c,
  ...Array.from({ length: 18 }, (_, i) => 0x0e + i), // 0x0E-0x1F
  0x7f,
]);

/** NFC 正規化 + 制御文字 (改行タブ除く) 除去。全テキスト入力に適用 */
export const nfc = (s: string) => {
  const normalized = s.normalize("NFC");
  let out = "";
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? -1;
    if (!CONTROL_CHAR_CODES.has(code)) out += ch;
  }
  return out;
};

export const zSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "小文字英数とハイフンのみ")
  .min(3)
  .max(80);
export const zTitle = z.string().transform(nfc).pipe(z.string().min(1).max(120));
export const zExcerpt = z.string().transform(nfc).pipe(z.string().max(300));
export const zMarkdown = z.string().transform(nfc).pipe(z.string().max(100_000));
export const zShortText = (max: number) =>
  z.string().transform(nfc).pipe(z.string().min(1).max(max));
export const zMediaId = z.string().uuid();
// API 境界。DB は timestamptz (UTC)
export const zIsoDatetime = z.string().datetime({ offset: true });
export const zChannel = z.enum(["site_blog", "note", "x", "instagram"]);
export type Channel = z.infer<typeof zChannel>;

/** モジュール境界の戻り値。例外は境界を越えない */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: KmbErrorCode; detail?: string };

/**
 * §4.9 facade 補助型のうち、単一モジュールに属さない汎用型。
 * (task 指示に §4.9 の所属モジュールが明記されていないため、
 *  「共通・複数モジュール横断」の性質から platform に配置。乖離時は要 module-contracts.md 更新)
 */
export const zPagination = z
  .object({
    cursor: z.string().nullable(), // keyset カーソル (created_at + id を base64)
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type Pagination = z.infer<typeof zPagination>;
export type Paged<T> = { items: T[]; next_cursor: string | null };

/**
 * §4.7 のうち、単一モジュールに閉じない Route Handler 契約。
 * (zCreateUploadUrlReq は audio(ai-studio) / media(media) 両方の kind を扱うため、
 *  zRevalidateReq は content/settings 横断の webhook のため、platform に配置。
 *  これは task 指示に明示のない §4.7 契約の所属先を、契約書 §1 の「platform=共通」の
 *  精神に沿って判断したもの)
 */
export const zCreateUploadUrlReq = z
  .object({
    kind: z.enum(["audio", "media"]),
    filename: z.string().max(200),
    content_type: z.string().max(100),
    size_bytes: z.number().int().min(1),
  })
  .strict()
  .refine(
    (v) =>
      v.kind === "audio"
        ? v.size_bytes <= 50 * 1024 * 1024
        : v.size_bytes <= 10 * 1024 * 1024,
    "kind 別サイズ上限 (audio 50MB / media 10MB) を超えています",
  );
export type CreateUploadUrlInput = z.infer<typeof zCreateUploadUrlReq>;

export const zRevalidateReq = z.object({ tags: z.array(z.string()).min(1).max(20) }).strict();

// ---------- v2.8 追加 (CRM スイート M0 共通基盤 — docs/module-contracts.md §4.1、
// canonical: docs/design/crm-suite/00-overview.md §3.1/§3.3/§3.4/§3.5) ----------

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * facade 実行文脈 (M0 共通基盤 — 00-overview.md §3.1、裁定 J2)。
 * - 省略時 = { mode: "session" }: cookie セッション (admin ログイン)。現行挙動と完全一致。
 * - { mode: "service" }: webhook / pg_cron worker。DB アクセスは service_role client
 *   (client 省略時は facade 側が createSupabaseServiceClient() を生成。注入はテスト用途)。
 *   予算/採番/lease 系 RPC は is_admin_or_service() ガード (migration 0021) で通る。
 */
export type ExecutionContext =
  | { mode: "session" }
  | { mode: "service"; client?: SupabaseClient };

export const DEFAULT_EXECUTION_CONTEXT: ExecutionContext = { mode: "session" };

/** 電話番号 (E.164)。保存は常にこの形式。入力は normalizeJpPhoneToE164() (platform/text.ts)
 *  で正規化してから parse する。正規化の完全仕様は platform/text.ts の同関数コメントが canonical。 */
export const zTelE164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "E.164 形式 (+81...)");

/** 帳票・売上金額 (円整数)。AI コストの µUSD と混在禁止 (既存規約) */
export const zJpyAmount = z.number().int().min(0).max(9_999_999_999);
/** 符号付き金額 (値引き行・調整行用) */
export const zJpySignedAmount = z.number().int().min(-9_999_999_999).max(9_999_999_999);

/** 消費税区分 (明細行が持つのは区分のみ。税額は書類×税率ごとに 1 回だけ計算 — 裁定 J5) */
export const zTaxCategory = z.enum(["standard_10", "reduced_8", "zero", "exempt"]);
export type TaxCategory = z.infer<typeof zTaxCategory>;
export const TAX_RATE_BY_CATEGORY: Record<TaxCategory, number> = {
  standard_10: 10,
  reduced_8: 8,
  zero: 0,
  exempt: 0,
};

/** 端数処理方式 (書類×税率ごと 1 回)。既定 floor (裁定 J5) */
export const zTaxRounding = z.enum(["floor", "round", "ceil"]);

/** 適格請求書発行事業者登録番号 (T+13桁)。null = 免税/未登録 → 区分記載様式に分岐 */
export const zInvoiceRegistrationNumber = z.string().regex(/^T\d{13}$/);

/** 書類番号 (document_number_next RPC — 00-overview.md §3.4 と 1:1)。
 *  Q=見積 / J=受注 / D=納品 / I=請求。連番 9999 超は桁が自然増加する */
export const zDocumentNo = z.string().regex(/^[QJDI]-\d{4}-\d{4,}$/);

/** JST 日付 (発行日・入金日・実施日・holidays)。DB は date 型、表示/入力とも Asia/Tokyo。
 *  実在日検証を追加 — 2026-02-31 等を KMB-E101 で拒否する
 *  (regex のみだと DB date 型で初めて落ちて生 DB エラー (E901 系) になる) */
export const zDateOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, "実在する日付 (YYYY-MM-DD)");
