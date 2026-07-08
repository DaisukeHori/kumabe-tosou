import type { NextConfig } from "next";

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
};

export default nextConfig;
