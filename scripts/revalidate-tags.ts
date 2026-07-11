/**
 * seed / スクリプト投入後に本番へ revalidate 信号を届かせる標準スクリプト
 * (docs/design/crm-suite/06-simulator.md §2.4 P3 / §6.3)。
 *
 * 使い方: npx tsx scripts/revalidate-tags.ts prices [tags...]
 *
 * 必要 env:
 *   - REVALIDATE_SECRET (必須。未設定は fail-closed で即エラー終了)
 *   - REVALIDATE_TARGET_URL (省略時 NEXT_PUBLIC_SITE_URL)
 *
 * 動作: POST {url}/api/revalidate に {tags} を送信し、HTTP status と応答 JSON を
 * 標準出力する。非 2xx は exit 1 (§6.3)。
 */

export function parseTagsArg(argv: string[]): string[] {
  if (argv.length === 0) {
    throw new Error(
      "revalidate 対象の tag を最低 1 つ指定してください (例: npx tsx scripts/revalidate-tags.ts prices)。",
    );
  }
  return argv;
}

/** REVALIDATE_SECRET 必須・未設定は fail-closed (§6.3)。エンドポイント側の 503 と対になる防御。 */
export function requireRevalidateSecret(secretEnv: string | undefined): string {
  if (!secretEnv) {
    throw new Error(
      "REVALIDATE_SECRET が未設定です。fail-closed のため実行を中止します (.env.local か実行時 env に設定してください)。",
    );
  }
  return secretEnv;
}

/** REVALIDATE_TARGET_URL 省略時は NEXT_PUBLIC_SITE_URL にフォールバックする (§6.3)。 */
export function resolveTargetUrl(env: {
  targetUrlEnv: string | undefined;
  siteUrlEnv: string | undefined;
}): string {
  const url = env.targetUrlEnv || env.siteUrlEnv;
  if (!url) {
    throw new Error(
      "REVALIDATE_TARGET_URL も NEXT_PUBLIC_SITE_URL も未設定です。いずれかを env に設定してください。",
    );
  }
  return url;
}

export function buildRevalidateRequestUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/revalidate`;
}

export function buildRevalidateHeaders(secret: string): Record<string, string> {
  return { "content-type": "application/json", "x-revalidate-secret": secret };
}

export function buildRevalidateBody(tags: string[]): { tags: string[] } {
  return { tags };
}

async function main() {
  const tags = parseTagsArg(process.argv.slice(2));
  const secret = requireRevalidateSecret(process.env.REVALIDATE_SECRET);
  const targetUrl = resolveTargetUrl({
    targetUrlEnv: process.env.REVALIDATE_TARGET_URL,
    siteUrlEnv: process.env.NEXT_PUBLIC_SITE_URL,
  });
  const requestUrl = buildRevalidateRequestUrl(targetUrl);

  console.log(`POST ${requestUrl} tags=${JSON.stringify(tags)}`);

  const res = await fetch(requestUrl, {
    method: "POST",
    headers: buildRevalidateHeaders(secret),
    body: JSON.stringify(buildRevalidateBody(tags)),
  });
  const bodyText = await res.text();
  console.log(`status=${res.status} body=${bodyText}`);

  if (!res.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("revalidate-tags に失敗しました:", err);
  process.exitCode = 1;
});
