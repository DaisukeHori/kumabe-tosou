import "server-only";

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import type { Browser, Viewport } from "puppeteer-core";

/**
 * puppeteer-core + @sparticuz/chromium の起動を共通化する (canonical:
 * docs/design/crm-suite/02-sales.md §7.4-2)。従来は capture.ts (フルページスクショ基盤 —
 * docs/design/ai-studio-v2.md §5) がこの起動ロジックを直接持っていたが、sales の帳票 PDF 生成
 * (internal/pdf.ts — Issue #50) も同じ Chromium 起動を必要とするため、この 1 関数へ切り出した。
 *
 * **既存スクショの挙動不変がこのリファクタの受入条件** (実装計画書 §3 注意)。切り出したのは
 * `puppeteer.launch({...})` の呼び出しそのものだけであり、viewport/request interception/
 * SSRF ガード等のスクショ専用ロジックは capture.ts 側にそのまま残す (PDF 生成は
 * viewport を必要としない — page.pdf() は CSS `@page` が用紙サイズを決めるため。
 * 実装計画書「未解決点4」で言及される SSRF ガードも同じ理由で pdf.ts 側では使わない設計とした)。
 *
 * versioning は capture.ts の判断点コメントと同一 (exact pin — puppeteer-core 24.43.1 /
 * @sparticuz/chromium 147.0.0。node engines 制約との両立を確認済み)。
 */
export async function launchChromium(defaultViewport?: Viewport | null): Promise<Browser> {
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: defaultViewport ?? null,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
