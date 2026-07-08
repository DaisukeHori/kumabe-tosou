import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getSessionAndClient } from "@/lib/supabase/session";
import { zCreateUploadUrlReq } from "@/modules/platform/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 設計書 §3.5: POST /api/upload-url (admin セッション必須)。
 * リクエスト型は契約書 §4.7 zCreateUploadUrlReq (kind: 'audio' | 'media' 共通)。
 *
 * kind='media' は media モジュールの署名付きアップロード URL 発行と同じ規約
 * (media-originals バケット、ファイル名の衝突回避に uuid プレフィックス)。
 * kind='audio' は ai-studio モジュール未実装 (Wave 1-A スコープ外) のため、
 * ここでは同型の署名付き URL 発行のみ行う汎用実装とする (audio バケットは
 * Wave 0 の migration で作成済み・RLS も admin 向けに設定済み)。
 */
export async function POST(request: Request) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json({ code: admin.code, message: info.message }, { status: admin.code === "KMB-E201" ? 401 : 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = zCreateUploadUrlReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { kind, filename } = parsed.data;
  const bucket = kind === "audio" ? "audio" : "media-originals";
  const safeName = filename
    .split(/[\\/]/)
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
  const storagePath = `${randomUUID()}-${safeName}`;

  try {
    const { supabase } = await getSessionAndClient();
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(storagePath);
    if (error || !data) {
      return NextResponse.json(
        { code: "KMB-E302", message: getErrorInfo("KMB-E302").message, detail: error?.message },
        { status: 400 },
      );
    }
    return NextResponse.json({ upload_url: data.signedUrl, storage_path: storagePath });
  } catch (err) {
    return NextResponse.json(
      {
        code: "KMB-E901",
        message: getErrorInfo("KMB-E901").message,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
