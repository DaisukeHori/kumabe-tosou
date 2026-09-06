/**
 * スクショ撮影中の subresource SSRF 対策 (canonical: docs/design/ai-studio-v2.md §11)。
 *
 * routeKey → URL の検証 (route-key.ts) は「最初のナビゲーション先」を自オリジンに限定するが、
 * それだけでは遷移後のページが読み込む subresource (img/script/link/xhr/fetch 等) 経由で
 * 任意の外部・内部ホストへ Chromium にリクエストさせる SSRF 余地が残る
 * (§11 MAJOR-5: 「Puppeteer 側は request interception で自オリジン + Supabase Storage 以外の
 * 全 subresource をブロック、リダイレクトは同一オリジンのみ許可」)。
 *
 * capture.ts の puppeteer 依存 (chromium 起動・sharp 等) から切り離した純関数として
 * ここに実装し、実 Chromium・実ネットワークなしで単体テストできるようにする。
 */

export type SubresourceAllowlistOptions = {
  /** 自サイトのオリジン (NEXT_PUBLIC_SITE_URL の origin)。文書・自ホスト subresource を許可 */
  siteOrigin: string;
  /** Supabase Storage のオリジン (NEXT_PUBLIC_SUPABASE_URL の origin)。ai-context 等の画像を許可 */
  storageOrigin: string;
};

/**
 * subresource の URL を撮影対象ページに読み込ませて良いか判定する。
 *
 * 許可:
 * - オリジンが siteOrigin と一致する http(s) URL (自ホストの CSS/JS/フォント/画像等)
 * - オリジンが storageOrigin と一致する http(s) URL (Supabase Storage 上の画像等)
 * - `data:` スキーム — インラインデータであり、実ネットワークへの egress を発生させない
 *   (SSRF の攻撃対象になり得ない)
 * - `blob:` スキーム — 生成元コンテキストのメモリ内オブジェクトへの参照。URL 文字列中の
 *   オリジン部分 (`blob:<origin>/<uuid>`) を偽装しても、ブラウザの blob URL ストアは
 *   生成元コンテキストにスコープされるため別オリジンの実データを取得することはできず、
 *   ネットワーク越しの SSRF 経路にはならない
 *
 * 拒否:
 * - 上記以外の全て (siteOrigin/storageOrigin 以外の http(s) オリジン、file:/ftp: 等の
 *   その他スキーム、パース不能な URL) — fail-closed
 *
 * 注意: この関数はあくまで「document (最初のナビゲーション) 以外」の subresource 用の判定。
 * document (メインフレームのナビゲーション) は decideMainFrameDocumentRequest で判定する
 * (最初のホップは continue、リダイレクトホップは自オリジンのみ continue)。ナビゲーション
 * 完了後の最終 URL 検証 (isSameOriginAsSite) は最終防衛線として併用する。
 */
export function isAllowedSubresource(url: string, options: SubresourceAllowlistOptions): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === "data:" || parsed.protocol === "blob:") {
    return true;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  return parsed.origin === options.siteOrigin || parsed.origin === options.storageOrigin;
}

/**
 * メインフレームの document リクエストを continue するか abort するかを判定する
 * (§11「リダイレクトは同一オリジンのみ許可」を各ホップで適用する)。
 *
 * - 最初のナビゲーション (redirectChainLength === 0) は URL 検証済み (route-key.ts) のため continue。
 * - リダイレクトホップ (redirectChainLength > 0) は遷移先 URL が自オリジンのときだけ continue、
 *   別オリジン (外部・内部メタデータサーバー等) は abort する。旧実装は全ホップを無条件に
 *   continue し、撮影直前の page.url() 検証だけに頼っていたため、リダイレクト先への
 *   リクエスト自体 (= SSRF の egress) は発生してしまっていた。
 */
export function decideMainFrameDocumentRequest(
  url: string,
  redirectChainLength: number,
  siteOrigin: string,
): "continue" | "abort" {
  if (redirectChainLength <= 0) return "continue";
  return isSameOriginAsSite(url, siteOrigin) ? "continue" : "abort";
}

/**
 * ナビゲーション完了後の最終 URL (page.url()) が自オリジンと一致するかを確認する
 * (§11「リダイレクトは同一オリジンのみ許可」の実体。撮影前にこの関数で確認し、
 * 一致しなければ撮影せずエラーとする)。
 */
export function isSameOriginAsSite(finalUrl: string, siteOrigin: string): boolean {
  try {
    return new URL(finalUrl).origin === siteOrigin;
  } catch {
    return false;
  }
}
