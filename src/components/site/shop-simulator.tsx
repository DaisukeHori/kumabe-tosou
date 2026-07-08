"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { PriceOption, PriceTable } from "@/modules/pricing/contracts";
import { computeEstimate } from "@/modules/pricing/estimate";

/*
  legacy/js/main.js「v2.8 — SHOP 見積もりシミュレータ」の移植 → v2 で DB 駆動化。
  価格データ (グレード/サイズ/行列/数量値引き/オプション) は
  src/app/(site)/shop/page.tsx が PricingFacade.getActivePriceTable() で SSR fetch した
  PriceTable を props として受け取る (クライアント側での再フェッチはしない、設計書 §6.2)。
  計算そのものは @/modules/pricing/estimate の computeEstimate() (副作用なしの純関数) に委譲し、
  UI/UX・操作感は旧実装 (ハードコード PRICE_TABLE 版) と同一に保つ。
*/

export type Grade = string;

export const SHOP_SELECT_GRADE_EVENT = "kt:shop-select-grade";

export function dispatchShopSelectGrade(grade: Grade) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Grade>(SHOP_SELECT_GRADE_EVENT, { detail: grade }));
}

// 装飾用の補助テキスト (DB が持たない UI フレーバーのみ。価格データそのものは PriceTable が正)。
const SIZE_SUB: Record<string, string> = {
  s: "手のひらサイズ",
  m: "主戦場サイズ",
  l: "大きめの造形",
  xl: "個別見積もり",
};

function clampQty(n: number): number {
  if (Number.isNaN(n) || n < 1) return 1;
  if (n > 1000) return 1000;
  return n;
}

function yen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}

/** multiplier オプションの符号付きパーセント表記 ('＋50%' / '－15%') */
function describeMultiplier(value: number): string {
  const pct = Math.round((value - 1) * 100);
  return pct >= 0 ? `＋${pct}%` : `－${Math.abs(pct)}%`;
}

function OptGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; sub: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">{label}</span>
      <div role="group" aria-label={label} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`border px-3 py-3 text-left text-[13px] font-medium tracking-wider transition-colors ${
              value === opt.value
                ? "border-carbon bg-carbon text-paper"
                : "border-hair bg-paper text-carbon hover:border-carbon/40"
            }`}
          >
            {opt.label}
            <small
              className={`mt-1 block font-mono text-[9px] font-normal tracking-[0.14em] ${
                value === opt.value ? "text-paper/60" : "text-carbon-soft"
              }`}
            >
              {opt.sub}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ShopSimulator({ priceTable }: { priceTable: PriceTable | null }) {
  const router = useRouter();

  const grades = useMemo(
    () =>
      [...(priceTable?.grades ?? [])]
        .filter((g) => g.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [priceTable],
  );
  const sizes = useMemo(
    () => [...(priceTable?.size_classes ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [priceTable],
  );
  const options = useMemo(
    () =>
      [...(priceTable?.options ?? [])]
        .filter((o) => o.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [priceTable],
  );
  const tiers = useMemo(
    () => [...(priceTable?.quantity_tiers ?? [])].sort((a, b) => a.min_qty - b.min_qty),
    [priceTable],
  );

  const [gradeKey, setGradeKey] = useState(
    () => grades.find((g) => g.key === "standard")?.key ?? grades[0]?.key ?? "",
  );
  const [sizeKey, setSizeKey] = useState(
    () => sizes.find((s) => s.key === "m")?.key ?? sizes[0]?.key ?? "",
  );
  const [qty, setQty] = useState(1);
  const [selectedOptionKeys, setSelectedOptionKeys] = useState<string[]>([]);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Grade>).detail;
      if (detail) setGradeKey(detail);
    };
    window.addEventListener(SHOP_SELECT_GRADE_EVENT, handler);
    return () => window.removeEventListener(SHOP_SELECT_GRADE_EVENT, handler);
  }, []);

  const grade = grades.find((g) => g.key === gradeKey) ?? grades[0];
  const size = sizes.find((s) => s.key === sizeKey) ?? sizes[0];

  const result = useMemo(() => {
    if (!priceTable || !grade || !size) return null;
    return computeEstimate(priceTable, {
      grade_key: grade.key,
      size_key: size.key,
      quantity: qty,
      option_keys: selectedOptionKeys,
    });
  }, [priceTable, grade, size, qty, selectedOptionKeys]);

  if (!priceTable || grades.length === 0 || sizes.length === 0 || !grade || !size || !result) {
    return (
      <div className="border border-hair bg-paper p-8 text-center text-sm leading-7 text-carbon-mid sm:p-10">
        価格はお問い合わせください。
      </div>
    );
  }

  const sizeIndex = sizes.findIndex((s) => s.key === size.key);
  const prevSize = sizeIndex > 0 ? sizes[sizeIndex - 1] : null;
  const quoteOnlyMessage = prevSize?.max_mm
    ? `${prevSize.max_mm}mmを超える造形は、形状を確認のうえ個別にお見積もりします`
    : "この帯の造形は、形状を確認のうえ個別にお見積もりします";

  const totalText = result.quote_only
    ? "個別見積もり"
    : `${yen(result.total_min)} 〜 ${yen(result.total_max)}`;
  const perText = result.quote_only
    ? quoteOnlyMessage
    : `1点あたり ${yen(result.total_min / qty)} 〜 ${yen(result.total_max / qty)}（税込・目安）`;

  const firstTier = tiers[0] ?? null;
  const quantitySlideText = result.applied_tier
    ? `−${Math.round((tiers.find((t) => t.label === result.applied_tier)?.discount_rate ?? 0) * 100)}%`
    : firstTier
      ? `適用なし（${firstTier.label}）`
      : "適用なし";

  const optionLabelByKey = new Map(options.map((o) => [o.key, o] as const));
  const selectedOptionLabels = selectedOptionKeys
    .map((k) => optionLabelByKey.get(k)?.label)
    .filter((v): v is string => Boolean(v));

  const toggleOption = (option: PriceOption, checked: boolean) => {
    setSelectedOptionKeys((prev) =>
      checked ? [...prev, option.key] : prev.filter((k) => k !== option.key),
    );
  };

  const handleOrder = () => {
    const lines = [
      "【隈部塗装 SHOP — 注文・相談内容】",
      `グレード: ${grade.label}`,
      `サイズ帯: ${size.label}`,
      `個数: ${qty} 個`,
      `オプション: ${selectedOptionLabels.length > 0 ? selectedOptionLabels.join(" / ") : "なし"}`,
      `概算: ${totalText}${!result.quote_only ? `（1点あたり ${yen(result.total_min / qty)}〜${yen(result.total_max / qty)}）` : ""}`,
      "※ 上記はシミュレータの目安です。素材・色・形状を添えてご相談ください。",
    ];
    const text = lines.join("\n");
    const goContact = () => {
      window.setTimeout(() => {
        router.push("/contact");
      }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied("内容をコピーしました。相談ページへ移動します…");
          goContact();
        },
        () => {
          setCopied("相談ページへ移動します…");
          goContact();
        },
      );
    } else {
      setCopied("相談ページへ移動します…");
      goContact();
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-8 border border-hair bg-paper p-6 sm:p-8">
        <OptGroup
          label="GRADE — グレード"
          options={grades.map((g) => ({ value: g.key, label: g.label, sub: g.description }))}
          value={grade.key}
          onChange={setGradeKey}
        />
        <OptGroup
          label="SIZE — 最長辺の目安"
          options={sizes.map((s) => ({
            value: s.key,
            label: s.label,
            sub: SIZE_SUB[s.key] ?? "",
          }))}
          value={size.key}
          onChange={setSizeKey}
        />
        <div>
          <span className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
            QUANTITY — 個数（同一品）
          </span>
          <div className="mt-3 flex items-stretch">
            <button
              type="button"
              aria-label="個数を減らす"
              onClick={() => setQty((q) => clampQty(q - 1))}
              className="w-12 border border-hair bg-paper text-lg hover:border-carbon/40"
            >
              −
            </button>
            <input
              type="number"
              value={qty}
              min={1}
              max={1000}
              inputMode="numeric"
              aria-label="個数"
              onChange={(e) => setQty(clampQty(parseInt(e.target.value, 10)))}
              className="w-24 border-y border-hair bg-paper py-3 text-center font-mono text-lg [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="個数を増やす"
              onClick={() => setQty((q) => clampQty(q + 1))}
              className="w-12 border border-hair bg-paper text-lg hover:border-carbon/40"
            >
              ＋
            </button>
          </div>
        </div>
        {options.length > 0 ? (
          <div className="space-y-2">
            {options.map((opt) => (
              <label
                key={opt.key}
                className="flex cursor-pointer items-center gap-3 text-sm tracking-wider"
              >
                <input
                  type="checkbox"
                  checked={selectedOptionKeys.includes(opt.key)}
                  onChange={(e) => toggleOption(opt, e.target.checked)}
                  className="size-4 accent-[var(--soul)]"
                />
                {opt.label}
                （{opt.kind === "multiplier" ? describeMultiplier(opt.value) : `+¥${opt.value.toLocaleString("ja-JP")}`}
                ）を希望する
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div
        aria-live="polite"
        className="flex flex-col border border-carbon bg-carbon p-6 text-paper sm:p-8"
      >
        <span className="font-mono text-[10px] tracking-[0.2em] text-paper/60">
          ESTIMATED TOTAL — 概算合計（税込・目安）
        </span>
        <p className="mt-4 text-[clamp(24px,3vw,34px)] font-bold leading-tight tracking-[0.02em]">
          {totalText}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-paper/70">{perText}</p>
        <div className="mt-6 divide-y divide-paper/15 border-y border-paper/15 text-[13px]">
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">グレード</span>
            <span className="font-mono">{grade.label}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">サイズ帯</span>
            <span className="font-mono">{size.label}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">個数</span>
            <span className="font-mono">{qty} 個</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">数量スライド</span>
            <span className="font-mono">{quantitySlideText}</span>
          </div>
          {options.map((opt) => (
            <div key={opt.key} className="flex justify-between py-2.5">
              <span className="text-paper/60">{opt.label}</span>
              <span className="font-mono">
                {selectedOptionKeys.includes(opt.key)
                  ? opt.kind === "multiplier"
                    ? describeMultiplier(opt.value)
                    : `+¥${opt.value.toLocaleString("ja-JP")}`
                  : "なし"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[11px] leading-5 text-paper/50">
          ※
          立ち上げ期の概算目安です。形状の複雑さ・素材・色により変動します。初回のみ治具・段取り費を別途（リピート時免除）。送料は実費です。正式なお見積もりでご確定ください。
        </p>
        <button
          type="button"
          onClick={handleOrder}
          className="mt-6 flex items-center justify-center gap-1 bg-paper py-3.5 text-sm font-medium tracking-[0.12em] text-carbon transition-colors hover:bg-paper/85"
        >
          この内容で注文・相談する
          <span aria-hidden="true">→</span>
        </button>
        {copied ? (
          <p className="mt-3 text-center text-[12px] text-paper/70">{copied}</p>
        ) : null}
      </div>
    </div>
  );
}
