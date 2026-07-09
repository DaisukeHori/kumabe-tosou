import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // repository.ts 等の "server-only" import は Next.js の "react-server" export
      // 条件下でのみ no-op になる。プレーン Node で動く Vitest ではそのままだと
      // 例外を投げるため、テスト実行時のみ no-op スタブに差し替える (本番ビルドには無影響)。
      "server-only": path.resolve(dirname, "./tests/mocks/server-only.ts"),
    },
  },
  // tsconfig.json の compilerOptions.jsx は Next.js の SWC が処理する前提で "preserve"
  // にしている (アプリのビルドには無関係、変更不可)。Vite 8 の既定トランスフォーマーは
  // oxc であり、tsconfig の jsx:"preserve" をそのまま読んでしまうと .tsx が変換されず
  // 構文エラーになるため、ここだけ oxc の JSX 変換を明示的に上書きする
  // (.tsx コンポーネントを renderToStaticMarkup で直接テストするために必要、修正1)。
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
