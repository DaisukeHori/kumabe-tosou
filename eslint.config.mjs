import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * モジュール境界の機械的強制 (docs/module-contracts.md §2)。
 * - internal/** は所有モジュール外から import 禁止。
 * - repository.ts は所有モジュール外から import 禁止 (他モジュールは facade 経由)。
 * モジュール一覧は docs/module-contracts.md §1 の所有マトリクスと 1:1。
 */
const MODULES = [
  "platform",
  "content",
  "media",
  "pricing",
  "inquiry",
  "settings",
  "ai-studio",
  "distribution",
  "page-media",
  "ai-providers",
];

function restrictedModuleImportPatterns(excludeModule) {
  return MODULES.filter((m) => m !== excludeModule).flatMap((m) => [
    {
      group: [`@/modules/${m}/internal/*`, `@/modules/${m}/internal/**`],
      message: `他モジュール (${m}) の internal/** は import できません。facade (@/modules/${m}/facade) 経由で参照してください (module-contracts.md §2)。`,
    },
    {
      group: [`@/modules/${m}/repository`],
      message: `他モジュール (${m}) の repository は import できません。facade (@/modules/${m}/facade) 経由で参照してください (module-contracts.md §2)。`,
    },
  ]);
}

/**
 * AI SDK 直 import の構造的禁止 (docs/module-contracts.md §2 / docs/design/ai-studio-v2.md §1):
 * 「AI SDK (@anthropic-ai/sdk / openai / @google/genai) の直 import は ai-providers/internal
 * のみ」。usage 記録の単一入口 (ルータ) を迂回した直接呼び出しを構造的に防ぐ。
 *
 * 注意 (実装上の落とし穴): no-restricted-imports の `group` は内部で `ignore` パッケージ
 * (gitignore 構文) を使う。"openai" のように "/" を含まない bare パターンは
 * **gitignore の basename マッチ規則により、パスのどの階層にある "openai" という
 * セグメントにも一致する** (実測確認済み: 何もエスケープしないと自モジュール自身の
 * `./internal/openai` という相対 import にまで誤って一致し、ai-providers/facade.ts が
 * 自分自身の internal/openai.ts を import できなくなるバグを引いた)。
 * 先頭に "/" を付けて root 相対に固定 (anchor) することで、パッケージ名そのものの
 * import (`import ... from "openai"` 等、相対パスを伴わない bare specifier) だけに
 * 限定して一致させる。
 */
const AI_SDK_PACKAGES = ["@anthropic-ai/sdk", "openai", "@google/genai"];

function restrictedAiSdkImportPatterns() {
  return AI_SDK_PACKAGES.flatMap((pkg) => [
    {
      group: [`/${pkg}`, `/${pkg}/**`],
      message: `AI SDK (${pkg}) の直 import は src/modules/ai-providers/internal/** からのみ許可されています。@/modules/ai-providers/facade 経由で呼び出してください (module-contracts.md §2)。`,
    },
  ]);
}

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Legacy static site (kept for reference during migration).
      "legacy/**",
      // Claude Code のエージェント worktree・セッション成果物 (lint 対象外)
      ".claude/**",
    ],
  },
  {
    // 既定: どのファイルからでも、全モジュールの internal/** と repository、
    // および AI SDK の直 import を禁止する。
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...restrictedModuleImportPatterns(null), ...restrictedAiSdkImportPatterns()] },
      ],
    },
  },
  // モジュール自身の内部からは、自モジュールの internal/**・repository の import を許可する
  // (他モジュール分のみ引き続き禁止)。AI SDK 制限はここでは維持する
  // (ai-providers モジュールでも facade.ts / repository.ts / contracts.ts からの直 import は
  // 禁止のまま。internal/** だけの例外は後続のより詳細なオーバーライドで解除する)。
  // tests/<module>-*.test.ts も対象に含める: internal/** の純関数 (例: 状態遷移ガード) は
  // モジュール自身の単体テストから直接検証する必要があるため (module-contracts.md の
  // 「内部実装のテストしやすさ」を損なわない範囲での例外。他モジュールの internal は
  // 引き続き import 不可)。
  ...MODULES.map((moduleName) => ({
    files: [`src/modules/${moduleName}/**/*.{ts,tsx}`, `tests/${moduleName}-*.test.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...restrictedModuleImportPatterns(moduleName), ...restrictedAiSdkImportPatterns()] },
      ],
    },
  })),
  // ai-providers/internal/** (+ 対応する単体テスト) のみ AI SDK 直 import を許可する
  // (module-contracts.md §2 の唯一の例外パス)。他モジュールの internal/** import 禁止は維持。
  {
    files: ["src/modules/ai-providers/internal/**/*.ts", "tests/ai-providers-*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: restrictedModuleImportPatterns("ai-providers") },
      ],
    },
  },
  // scripts/** (運用スクリプト) は tsx 直接実行のため "server-only" を経由できず
  // (scripts/lib/service-client.ts 参照)、repository.ts 等は引き続き import できない。
  // ただし media/internal/image-transform.ts は "server-only" 非依存の純粋な変換関数のみを
  // 置くファイルであり、scripts/seed-from-legacy.ts がレンディション生成ロジックを
  // 複製せず共用するために import する必要があるため、この 1 パスのみ例外的に許可する
  // (media/repository および他モジュールの internal/** は引き続き禁止)。
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...restrictedModuleImportPatterns(null).filter(
              (pattern) => !pattern.group.includes("@/modules/media/internal/*"),
            ),
            ...restrictedAiSdkImportPatterns(),
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
