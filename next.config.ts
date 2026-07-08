import type { NextConfig } from "next";

/*
  Supabase Storage の公開バケット (media) 上の画像を next/image で配信するための許可設定
  (cms-ai-pipeline.md §6.2「hero.jpg / 各ページ画像 → media テーブル + Supabase Storage 公開 URL
  (next/image remotePatterns 追加)」)。NEXT_PUBLIC_SUPABASE_URL からホスト名を導出する
  (env 未設定時はビルドを壊さないよう安全側にフォールバックする)。
*/
function supabaseStorageHostname(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
}

const supabaseHostname = supabaseStorageHostname();

const nextConfig: NextConfig = {
  /**
   * twitter-text は CJS の `module.exports = exports.default` 再代入パターンのため、
   * webpack にバンドルされると named/namespace import どちらでも `extractUrls` 等の
   * プロパティが実行時に失われる (実測確認済み: `next start` で
   * "TypeError: extractUrls is not a function" が発生)。
   * serverExternalPackages 指定でサーバーバンドル対象から外し、Node の素の require()
   * (プレーン CJS 解決。全プロパティが揃うことを実測済み) に委ねることで解決する。
   */
  serverExternalPackages: ["twitter-text"],
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
