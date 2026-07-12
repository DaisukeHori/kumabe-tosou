// Vitest (プレーン Node 実行) 用の "next/font/google" no-op スタブ。
//
// root layout (src/app/layout.tsx — 変更不可) はモジュールスコープで Noto_Sans_JP /
// Archivo / Shippori_Antique_B1 / IBM_Plex_Mono を呼び出す。next/font/google は Next.js の
// ビルドパイプライン (フォントファイルのダウンロード・最適化) に強く依存しており、素の
// Vitest (Node 実行、Next.js ビルドを経由しない) では import 時に TypeError になる
// (05-site-settings.md §12.1 実測)。tests/mocks/server-only.ts と同じ手法 (vitest.config.ts の
// resolve.alias でテスト実行時のみ差し替え、本番ビルドには無影響) でスタブ化する。
//
// 各フォント関数は Next.js 実行時には `{ variable: string; className: string }` を返す
// オブジェクトを返却する (実際にはさらに `.style` 等も持つが、このリポジトリで使われているのは
// variable/className のみ — root layout L90 実測)。呼び出し引数 (axes/preload/weight/subsets 等)
// は無視してよい (スタブは常に同じ値を返す callable であればよい)。

type NextFontGoogleResult = { variable: string; className: string };

// 呼び出し引数 (axes/preload/weight/subsets 等) は無視してよいため、パラメータ自体を宣言しない
// (root layout はオプション付きで呼ぶが、JS は余剰引数を無視するのでそのまま素通りする)。
function stubFont(): NextFontGoogleResult {
  return { variable: "", className: "" };
}

export const Noto_Sans_JP = stubFont;
export const Archivo = stubFont;
export const Shippori_Antique_B1 = stubFont;
export const IBM_Plex_Mono = stubFont;
