"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { getIntakeStatusAction, intakeInquiryAction } from "./actions";

type Status =
  | { kind: "loading" }
  | { kind: "error"; detail: string }
  | { kind: "none" }
  | { kind: "deal"; dealId: string }
  | { kind: "marker_only" };

/**
 * 「リード化」ボタン (01-crm.md §8.7)。済み判定は 2 段:
 * ① findDealByInquiry 非 null → 「リード化済み → 案件を開く」(活性、案件へ遷移)
 * ② null でも form_submission 冪等マーカーが存在 → 「取込済み (案件なし)」でボタン不活性
 *    (§12.1 の「deal なし取込」= 過去完了問い合わせの done 移行行。マーカーのみでは顧客 id を
 *    特定する経路が facade に無いため — 開発時点では「顧客を開く」への遷移までは実装しない。
 *    必要になれば hasIntakeMarker を拡張し customer_id も返す対応を追加する、と openIssues に明記)
 */
export function InquiryLeadButton({
  inquiryId,
  name,
  email,
  tel,
  inquiryType,
  body,
}: {
  inquiryId: string;
  name: string;
  email: string | null;
  tel: string | null;
  inquiryType: string;
  body: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getIntakeStatusAction(inquiryId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setStatus({ kind: "error", detail: result.detail ?? result.code });
        return;
      }
      if (result.value.dealId) setStatus({ kind: "deal", dealId: result.value.dealId });
      else if (result.value.hasMarker) setStatus({ kind: "marker_only" });
      else setStatus({ kind: "none" });
    });
    return () => {
      cancelled = true;
    };
  }, [inquiryId]);

  async function handleIntake() {
    setIsSubmitting(true);
    const result = await intakeInquiryAction({ inquiry_id: inquiryId, name, email, tel, inquiry_type: inquiryType, body });
    setIsSubmitting(false);
    if (!result.ok) {
      toast.error(result.detail ?? "リード化に失敗しました。");
      return;
    }
    toast.success("顧客と案件を作成しました。", {
      action: { label: "開く", onClick: () => router.push(`/admin/deals/${result.value.deal_id}`) },
    });
    setStatus({ kind: "deal", dealId: result.value.deal_id });
  }

  if (status.kind === "loading") {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        確認中...
      </Button>
    );
  }
  if (status.kind === "error") {
    return (
      <Button type="button" variant="outline" size="sm" disabled title={status.detail}>
        判定に失敗
      </Button>
    );
  }
  if (status.kind === "deal") {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => router.push(`/admin/deals/${status.dealId}`)}>
        リード化済み → 案件を開く
      </Button>
    );
  }
  if (status.kind === "marker_only") {
    return (
      <Button type="button" variant="ghost" size="sm" disabled>
        取込済み (案件なし)
      </Button>
    );
  }
  return (
    <Button type="button" size="sm" disabled={isSubmitting} onClick={() => void handleIntake()}>
      {isSubmitting ? "処理中..." : "リード化"}
    </Button>
  );
}
