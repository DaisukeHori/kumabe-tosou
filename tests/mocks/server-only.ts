// Vitest (プレーン Node 実行) 用の "server-only" no-op スタブ。
// 本番ビルド (Next.js) では package.json の "react-server" export 条件により
// node_modules/server-only/empty.js に解決されるため、この alias は影響しない
// (vitest.config.ts の resolve.alias でテスト実行時のみ差し替える)。
export {};
