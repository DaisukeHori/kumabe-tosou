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
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
