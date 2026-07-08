import type { AiStudioFacade } from "@/modules/ai-studio/facade";

/**
 * ai-studio モジュールは並列 agent が実装中で、facade.ts は現時点でインターフェース
 * (AiStudioFacade) のみが確定しており、値エクスポート (aiStudioFacade インスタンス) は
 * まだ存在しない可能性がある (オーケストレーター指示: 「インターフェース越しに import する
 * だけで、実装が未マージでも型が通ればよい」)。
 *
 * 型は通常の type-only import で契約書 §5 のシグネチャに対して検証する一方、実行時の値解決は
 * 動的 import + 名前付きエクスポート有無チェックで安全に行う。これにより:
 *   - 本 (distribution) モジュール側は ai-studio/facade.ts を一切変更せず (所有領域の尊重)、
 *   - ai-studio の実装がマージされ次第、追加の変更なしに自動的に動作するようになる。
 *
 * ai-studio 実装がまだ無い環境で呼び出すと KMB-E901 相当の Result を返す
 * (呼び出し元 facade メソッドが try/catch で処理する)。
 */
export async function resolveAiStudioFacade(): Promise<AiStudioFacade> {
  const mod = (await import("@/modules/ai-studio/facade")) as unknown as Partial<{
    aiStudioFacade: AiStudioFacade;
  }>;
  if (!mod.aiStudioFacade) {
    throw new Error(
      "ai-studio モジュールの facade 実装 (aiStudioFacade) がまだマージされていません。" +
        "承認済み draft の取得が必要な機能は ai-studio の実装完了後に動作します。",
    );
  }
  return mod.aiStudioFacade;
}

/**
 * watchdog (§7.6) の ai_runs lease 失効スイープは ai-studio モジュールの所有領域だが、
 * AiStudioFacade (契約書 §5) には現時点でこの用途のメソッドが定義されていない
 * (getApprovedDraft のみが確定契約)。ai-studio 側で `sweepStaleRuns()` 相当が実装され次第
 * 自動的に有効化されるよう、存在チェック付きの best-effort 呼び出しに留める
 * (オーケストレーターへ要確認事項として報告済み — 契約書 §5 に無いメソッド名を前提にしているため)。
 */
export async function tryResolveAiStudioWatchdogSweep(): Promise<(() => Promise<unknown>) | null> {
  try {
    const mod = (await import("@/modules/ai-studio/facade")) as unknown as Partial<{
      aiStudioFacade: { sweepStaleRuns?: () => Promise<unknown> };
    }>;
    const fn = mod.aiStudioFacade?.sweepStaleRuns;
    return typeof fn === "function" ? fn.bind(mod.aiStudioFacade) : null;
  } catch {
    return null;
  }
}
