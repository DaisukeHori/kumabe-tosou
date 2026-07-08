import type { Result } from "@/modules/platform/contracts";

import type { InquiryInput, InquiryStatus } from "./contracts";

/**
 * inquiry モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 1 以降。
 */
export interface InquiryFacade {
  /**
   * site-public から呼べる唯一の書き込み。DB 保存成功後に Resend で通知メール
   * (ベストエフォート — 送信失敗は KMB-E902 をログ記録するのみで Result は成功のまま。
   *  宛先は settings 'notifications'.inquiry_to、RESEND_API_KEY は Vercel env)
   */
  submit(input: InquiryInput): Promise<Result<{ id: string }>>;
  updateStatus(id: string, status: InquiryStatus): Promise<Result<void>>;
}
