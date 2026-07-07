"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/*
  legacy/js/main.js「v2.8 — SHOP 見積もりシミュレータ」の移植。
  価格テーブルは立ち上げ期の目安。正式価格の確定後は
  下記 PRICE_TABLE の数値だけを差し替えれば全体に反映される。
*/
const PRICE_TABLE: Record<Grade, Record<PricedSize, [number, number]>> = {
  base: { s: [7000, 10000], m: [10000, 14000], l: [15000, 20000] },
  standard: { s: [10000, 14000], m: [14000, 20000], l: [20000, 28000] },
  premium: { s: [15000, 20000], m: [20000, 28000], l: [28000, 35000] },
};

type Grade = "base" | "standard" | "premium";
type PricedSize = "s" | "m" | "l";
type Size = PricedSize | "xl";

const GRADE_LABEL: Record<Grade, string> = {
  base: "下地仕上げ",
  standard: "スタンダード",
  premium: "プレミアム",
};
const SIZE_LABEL: Record<Size, string> = {
  s: "〜100mm",
  m: "〜200mm",
  l: "〜350mm",
  xl: "それ以上（個別見積もり）",
};

const GRADE_OPTIONS: { value: Grade; label: string; sub: string }[] = [
  { value: "base", label: "下地仕上げ", sub: "PRIMER-READY" },
  { value: "standard", label: "スタンダード", sub: "SOLID + 2K CLEAR" },
  { value: "premium", label: "プレミアム", sub: "3-COAT PEARL" },
];
const SIZE_OPTIONS: { value: Size; label: string; sub: string }[] = [
  { value: "s", label: "〜100mm", sub: "手のひらサイズ" },
  { value: "m", label: "〜200mm", sub: "主戦場サイズ" },
  { value: "l", label: "〜350mm", sub: "大きめの造形" },
  { value: "xl", label: "それ以上", sub: "個別見積もり" },
];

function clampQty(n: number): number {
  if (Number.isNaN(n) || n < 1) return 1;
  if (n > 1000) return 1000;
  return n;
}

function yen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
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
      <span className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
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

export function ShopSimulator() {
  const router = useRouter();
  const [grade, setGrade] = useState<Grade>("standard");
  const [size, setSize] = useState<Size>("m");
  const [qty, setQty] = useState(1);
  const [rush, setRush] = useState(false);
  const [copied, setCopied] = useState("");

  const result = useMemo(() => {
    const discountRate = qty >= 30 ? 0.25 : qty >= 10 ? 0.15 : 0;
    if (size === "xl") {
      return {
        total: "個別見積もり",
        per: "350mmを超える造形は、形状を確認のうえ個別にお見積もりします",
        discountRate,
        text: "個別見積もり",
        perText: "",
      };
    }
    const range = PRICE_TABLE[grade][size];
    const factor = (1 - discountRate) * (rush ? 1.5 : 1);
    const perMin = range[0] * factor;
    const perMax = range[1] * factor;
    return {
      total: `${yen(perMin * qty)} 〜 ${yen(perMax * qty)}`,
      per: `1点あたり ${yen(perMin)} 〜 ${yen(perMax)}（税込・目安）`,
      discountRate,
      text: `${yen(perMin * qty)}〜${yen(perMax * qty)}`,
      perText: `${yen(perMin)}〜${yen(perMax)}`,
    };
  }, [grade, size, qty, rush]);

  const handleOrder = () => {
    const lines = [
      "【隈部塗装 SHOP — 注文・相談内容】",
      `グレード: ${GRADE_LABEL[grade]}`,
      `サイズ帯: ${SIZE_LABEL[size]}`,
      `個数: ${qty} 個`,
      `特急: ${rush ? "希望する（＋50%）" : "なし"}`,
      `概算: ${result.text}${result.perText ? `（1点あたり ${result.perText}）` : ""}`,
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
          options={GRADE_OPTIONS}
          value={grade}
          onChange={setGrade}
        />
        <OptGroup
          label="SIZE — 最長辺の目安"
          options={SIZE_OPTIONS}
          value={size}
          onChange={setSize}
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
        <label className="flex cursor-pointer items-center gap-3 text-sm tracking-wider">
          <input
            type="checkbox"
            checked={rush}
            onChange={(e) => setRush(e.target.checked)}
            className="size-4 accent-[var(--soul)]"
          />
          特急仕上げ（＋50%）を希望する
        </label>
      </div>

      <div
        aria-live="polite"
        className="flex flex-col border border-carbon bg-carbon p-6 text-paper sm:p-8"
      >
        <span className="font-mono text-[10px] tracking-[0.2em] text-paper/60">
          ESTIMATED TOTAL — 概算合計（税込・目安）
        </span>
        <p className="mt-4 text-[clamp(24px,3vw,34px)] font-bold leading-tight tracking-[0.02em]">
          {result.total}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-paper/70">{result.per}</p>
        <div className="mt-6 divide-y divide-paper/15 border-y border-paper/15 text-[13px]">
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">グレード</span>
            <span className="font-mono">{GRADE_LABEL[grade]}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">サイズ帯</span>
            <span className="font-mono">{SIZE_LABEL[size]}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">個数</span>
            <span className="font-mono">{qty} 個</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">数量スライド</span>
            <span className="font-mono">
              {result.discountRate > 0
                ? `−${Math.round(result.discountRate * 100)}%`
                : "適用なし（10個以上で−15%）"}
            </span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-paper/60">特急</span>
            <span className="font-mono">{rush ? "＋50%" : "なし"}</span>
          </div>
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
