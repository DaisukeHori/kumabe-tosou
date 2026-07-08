/**
 * keyset ページネーション (created_at, id) のカーソル符号化 (cms-ai-pipeline.md §2.4)。
 * offset ではなく keyset を使う規約に従う。
 */
export type Cursor = { createdAt: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { createdAt?: unknown }).createdAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}
