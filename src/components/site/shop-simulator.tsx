"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { textEditableAttrs } from "@/components/site/editable-attrs";
import { ShopLeadForm, type ShopLeadFormHandle } from "@/components/site/shop-lead-form";
import type { ResolvedTexts } from "@/modules/page-media/contracts";
import type { PriceOption, PriceTable } from "@/modules/pricing/contracts";
import { computeEstimate } from "@/modules/pricing/estimate";

/*
  legacy/js/main.js「v2.8 — SHOP 見積もりシミュレータ」の移植 → v2 で DB 駆動化。
  価格データ (グレード/サイズ/行列/数量値引き/オプション) は
  src/app/(site)/shop/page.tsx が PricingFacade.getActivePriceTable() で SSR fetch した
  PriceTable を props として受け取る (クライアント側での再フェッチはしない、設計書 §6.2)。
  計算そのものは @/modules/pricing/estimate の computeEstimate() (副作用なしの純関数) に委譲し、
  UI/UX・操作感は旧実装 (ハードコード PRICE_TABLE 版) と同一に保つ。

  問い合わせボタンの文言 (shop.simulator.cta) 等、この画面の静的文言は visual-text-editor 対象
  スロットだが、このコンポーネントは "use client" であり、facade.ts ("server-only") を
  import する <SlotText>/<SlotRichText> を直接使うとクライアントバンドルがビルド時に
  壊れる (docs/design/visual-text-editor.md §4.1 の SlotText は page-media/facade 経由で
  TEXT_REGISTRY を読む)。そのため、ShopPageBody から resolveAllTexts() 済みの
  `texts: ResolvedTexts` (全スロット分) と editMode を props で受け取り、"server-only" を
  持たない純関数 textEditableAttrs (editable-attrs.ts) だけを使って data-editable-text を
  手動で付与する (SlotText と同じ見た目・同じ data 属性契約を、import せずに再現する)。
  v2 Wave 1: GRADE/SIZE/QUANTITY 見出し・サイズ帯補足・内訳ラベル・フォールバック文言・
  注記等の残り全静的文言も同じ手動パターンで編集可能にする (DB駆動の
  grade.label/description・size.label は対象外)。

  Issue #60 (裁定 J6-(a)): 旧クリップボードコピー UX (handleOrder — クリップボード書き込み・
  1200ms 後の /contact 遷移・shop.simulator.toast.copied / .redirect) は廃止し、CTA は
  インライン展開型のリードフォーム (shop-lead-form.tsx、"use client") を開くだけにした。
  送信は shop-lead-form.tsx から /api/shop/lead への HTTP 境界越えで行う (書き込み facade は
  このコンポーネントからは import しない — 06-simulator.md §5.3)。
*/

export type Grade = string;

export const SHOP_SELECT_GRADE_EVENT = "kt:shop-select-grade";

export function dispatchShopSelectGrade(grade: Grade) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Grade>(SHOP_SELECT_GRADE_EVENT, { detail: grade }));
}

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
  labelEditableAttrs,
  options,
  value,
  onChange,
}: {
  label: string;
  /** v2 Wave 1: label が UI 固定文言 (SIZE 帯等) のときだけ渡す。DB駆動ラベルには渡さない */
  labelEditableAttrs?: Record<string, string>;
  options: {
    value: T;
    label: string;
    sub: string;
    /** v2 Wave 1: sub が UI 固定文言 (SIZE_SUB 由来) のときだけ渡す。DB駆動 description には渡さない */
    subEditableAttrs?: Record<string, string>;
  }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span
        className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
        {...labelEditableAttrs}
      >
        {label}
      </span>
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
              {...opt.subEditableAttrs}
            >
              {opt.sub}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ShopSimulator({
  priceTable,
  texts,
  editMode,
}: {
  priceTable: PriceTable | null;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  const leadFormRef = useRef<ShopLeadFormHandle>(null);
  const ctaButtonRef = useRef<HTMLButtonElement>(null);

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
      <div
        className="border border-hair bg-paper p-8 text-center text-sm leading-7 text-carbon-mid sm:p-10"
        {...textEditableAttrs("shop.simulator.fallback", editMode)}
      >
        {texts["shop.simulator.fallback"].text}
      </div>
    );
  }

  const sizeIndex = sizes.findIndex((s) => s.key === size.key);
  const prevSize = sizeIndex > 0 ? sizes[sizeIndex - 1] : null;
  const quoteOnlyMessage = prevSize?.max_mm
    ? `${prevSize.max_mm}${texts["shop.simulator.quoteonly.withmax_suffix"].text}`
    : texts["shop.simulator.quoteonly.default"].text;

  const totalText = result.quote_only
    ? texts["shop.simulator.total.quoteonly"].text
    : `${yen(result.total_min)} 〜 ${yen(result.total_max)}`;
  const perText = result.quote_only
    ? quoteOnlyMessage
    : `${texts["shop.simulator.per.prefix"].text}${yen(result.total_min / qty)} 〜 ${yen(result.total_max / qty)}${texts["shop.simulator.per.suffix"].text}`;

  const firstTier = tiers[0] ?? null;
  const quantitySlideText = result.applied_tier
    ? `−${Math.round((tiers.find((t) => t.label === result.applied_tier)?.discount_rate ?? 0) * 100)}%`
    : firstTier
      ? `適用なし（${firstTier.label}）`
      : "適用なし";

  const toggleOption = (option: PriceOption, checked: boolean) => {
    setSelectedOptionKeys((prev) =>
      checked ? [...prev, option.key] : prev.filter((k) => k !== option.key),
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-8 border border-hair bg-paper p-6 sm:p-8">
        <OptGroup
          label={texts["shop.simulator.grade.optgroup.label"].text}
          labelEditableAttrs={textEditableAttrs("shop.simulator.grade.optgroup.label", editMode)}
          options={grades.map((g) => ({ value: g.key, label: g.label, sub: g.description }))}
          value={grade.key}
          onChange={setGradeKey}
        />
        <OptGroup
          label={texts["shop.simulator.size.optgroup.label"].text}
          labelEditableAttrs={textEditableAttrs("shop.simulator.size.optgroup.label", editMode)}
          options={sizes.map((s) => ({
            value: s.key,
            label: s.label,
            sub: texts[`shop.simulator.size.sub.${s.key}`]?.text ?? "",
            subEditableAttrs: texts[`shop.simulator.size.sub.${s.key}`]
              ? textEditableAttrs(`shop.simulator.size.sub.${s.key}`, editMode)
              : undefined,
          }))}
          value={size.key}
          onChange={setSizeKey}
        />
        <div>
          <span
            className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            {...textEditableAttrs("shop.simulator.qty.label", editMode)}
          >
            {texts["shop.simulator.qty.label"].text}
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
        <span
          className="font-mono text-[10px] tracking-[0.2em] text-paper/60"
          {...textEditableAttrs("shop.simulator.total.label", editMode)}
        >
          {texts["shop.simulator.total.label"].text}
        </span>
        <p
          className="mt-4 text-[clamp(24px,3vw,34px)] font-bold leading-tight tracking-[0.02em]"
          {...textEditableAttrs("shop.simulator.total.quoteonly", editMode)}
        >
          {totalText}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-paper/70">{perText}</p>
        <div className="mt-6 divide-y divide-paper/15 border-y border-paper/15 text-[13px]">
          <div className="flex justify-between py-2.5">
            <span
              className="text-paper/60"
              {...textEditableAttrs("shop.simulator.row.grade", editMode)}
            >
              {texts["shop.simulator.row.grade"].text}
            </span>
            <span className="font-mono">{grade.label}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span
              className="text-paper/60"
              {...textEditableAttrs("shop.simulator.row.size", editMode)}
            >
              {texts["shop.simulator.row.size"].text}
            </span>
            <span className="font-mono">{size.label}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span
              className="text-paper/60"
              {...textEditableAttrs("shop.simulator.row.qty", editMode)}
            >
              {texts["shop.simulator.row.qty"].text}
            </span>
            <span className="font-mono">{qty} 個</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span
              className="text-paper/60"
              {...textEditableAttrs("shop.simulator.row.slide", editMode)}
            >
              {texts["shop.simulator.row.slide"].text}
            </span>
            <span className="font-mono">{quantitySlideText}</span>
          </div>
          {options.map((opt) => (
            <div key={opt.key} className="flex justify-between py-2.5">
              <span className="text-paper/60">{opt.label}</span>
              <span
                className="font-mono"
                {...textEditableAttrs("shop.simulator.opt.none", editMode)}
              >
                {selectedOptionKeys.includes(opt.key)
                  ? opt.kind === "multiplier"
                    ? describeMultiplier(opt.value)
                    : `+¥${opt.value.toLocaleString("ja-JP")}`
                  : texts["shop.simulator.opt.none"].text}
              </span>
            </div>
          ))}
        </div>
        <p
          className="mt-5 text-[11px] leading-5 text-paper/50"
          {...textEditableAttrs("shop.simulator.footnote", editMode)}
        >
          {texts["shop.simulator.footnote"].text}
        </p>
        <button
          ref={ctaButtonRef}
          type="button"
          onClick={() => leadFormRef.current?.open()}
          className="mt-6 flex items-center justify-center gap-1 bg-paper py-3.5 text-sm font-medium tracking-[0.12em] text-carbon transition-colors hover:bg-paper/85"
          {...textEditableAttrs("shop.simulator.cta", editMode)}
        >
          {texts["shop.simulator.cta"].text}
          <span aria-hidden="true">→</span>
        </button>
        <ShopLeadForm
          ref={leadFormRef}
          grade={grade}
          size={size}
          quantity={qty}
          optionKeys={selectedOptionKeys}
          result={result}
          texts={texts}
          editMode={editMode}
          onRequestFocusCta={() => ctaButtonRef.current?.focus()}
        />
      </div>
    </div>
  );
}
