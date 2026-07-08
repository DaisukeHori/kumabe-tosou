"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { EstimateInput, PriceTable } from "@/modules/pricing/contracts";
import { computeEstimate } from "@/modules/pricing/estimate";

import { savePricingAction, type AdminGradeRow, type AdminOptionRow } from "./actions";

type DraftSize = {
  key: string;
  label: string;
  max_mm: number | null;
  quote_only: boolean;
  sort_order: number;
};

type DraftMatrixCell = {
  grade_key: string;
  size_key: string;
  price_min: number;
  price_max: number;
};

type DraftTier = { min_qty: number; discount_rate: number; label: string };

function toAdminGrades(table: PriceTable): AdminGradeRow[] {
  return table.grades.map((g) => ({
    id: g.id,
    expected_updated_at: g.updated_at,
    key: g.key,
    label: g.label,
    description: g.description,
    sort_order: g.sort_order,
    is_active: g.is_active,
  }));
}

function toAdminOptions(table: PriceTable): AdminOptionRow[] {
  return table.options.map((o) => ({
    id: o.id,
    key: o.key,
    label: o.label,
    kind: o.kind,
    value: o.value,
    sort_order: o.sort_order,
    is_active: o.is_active,
  }));
}

function yen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}

/** 保存前プレビュー用の代表 3 パターン (設計書 §5.2)。draft の内容から代表的な組み合わせを選ぶ */
function pickExampleInputs(table: PriceTable): { label: string; input: EstimateInput }[] {
  const grade =
    table.grades.find((g) => g.key === "standard" && g.is_active) ??
    table.grades.find((g) => g.is_active) ??
    table.grades[0];
  const size =
    table.size_classes.find((s) => s.key === "m" && !s.quote_only) ??
    table.size_classes.find((s) => !s.quote_only) ??
    table.size_classes[0];
  const expressKey =
    table.options.find((o) => o.key === "express" && o.is_active)?.key ??
    table.options.find((o) => o.is_active)?.key;

  if (!grade || !size) return [];

  return [
    {
      label: `${grade.label} / ${size.label} / 1個`,
      input: { grade_key: grade.key, size_key: size.key, quantity: 1, option_keys: [] },
    },
    {
      label: `${grade.label} / ${size.label} / 10個`,
      input: { grade_key: grade.key, size_key: size.key, quantity: 10, option_keys: [] },
    },
    {
      label: `${grade.label} / ${size.label} / 1個 + ${expressKey ? "オプション" : "(オプションなし)"}`,
      input: {
        grade_key: grade.key,
        size_key: size.key,
        quantity: 1,
        option_keys: expressKey ? [expressKey] : [],
      },
    },
  ];
}

export function PriceTableEditor({ initialTable }: { initialTable: PriceTable }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [grades, setGrades] = useState<AdminGradeRow[]>(() => toAdminGrades(initialTable));
  const [sizes, setSizes] = useState<DraftSize[]>(() => initialTable.size_classes.map((s) => ({ ...s })));
  const [matrix, setMatrix] = useState<DraftMatrixCell[]>(() =>
    initialTable.matrix.map((c) => ({ ...c })),
  );
  const [tiers, setTiers] = useState<DraftTier[]>(() => initialTable.quantity_tiers.map((t) => ({ ...t })));
  const [options, setOptions] = useState<AdminOptionRow[]>(() => toAdminOptions(initialTable));

  // 保存成功後の router.refresh() で initialTable が更新されたら draft を再同期する
  // (grades.expected_updated_at を最新化しないと次回保存で E103 誤検知するため)。
  useEffect(() => {
    setGrades(toAdminGrades(initialTable));
    setSizes(initialTable.size_classes.map((s) => ({ ...s })));
    setMatrix(initialTable.matrix.map((c) => ({ ...c })));
    setTiers(initialTable.quantity_tiers.map((t) => ({ ...t })));
    setOptions(toAdminOptions(initialTable));
  }, [initialTable]);

  const draftTable = useMemo<PriceTable>(() => {
    const now = new Date().toISOString();
    return {
      grades: grades.map((g, i) => ({
        id: g.id ?? `draft-grade-${i}`,
        key: g.key,
        label: g.label,
        description: g.description,
        sort_order: g.sort_order,
        is_active: g.is_active,
        updated_at: g.expected_updated_at ?? now,
      })),
      size_classes: sizes.map((s) => ({ ...s })),
      matrix: matrix.map((c) => ({ ...c })),
      quantity_tiers: tiers.map((t) => ({ ...t })),
      options: options.map((o, i) => ({
        id: o.id ?? `draft-option-${i}`,
        key: o.key,
        label: o.label,
        kind: o.kind,
        value: o.value,
        sort_order: o.sort_order,
        is_active: o.is_active,
        updated_at: now,
      })),
    };
  }, [grades, sizes, matrix, tiers, options]);

  const examples = useMemo(() => pickExampleInputs(draftTable), [draftTable]);
  const previewRows = useMemo(
    () =>
      examples.map((ex) => ({
        ...ex,
        before: computeEstimate(initialTable, ex.input),
        after: computeEstimate(draftTable, ex.input),
      })),
    [examples, initialTable, draftTable],
  );

  const pricedSizes = sizes.filter((s) => !s.quote_only);

  function getCell(gradeKey: string, sizeKey: string): DraftMatrixCell {
    return (
      matrix.find((c) => c.grade_key === gradeKey && c.size_key === sizeKey) ?? {
        grade_key: gradeKey,
        size_key: sizeKey,
        price_min: 0,
        price_max: 0,
      }
    );
  }

  function setCell(gradeKey: string, sizeKey: string, patch: Partial<DraftMatrixCell>) {
    setMatrix((prev) => {
      const idx = prev.findIndex((c) => c.grade_key === gradeKey && c.size_key === sizeKey);
      if (idx === -1) {
        return [...prev, { grade_key: gradeKey, size_key: sizeKey, price_min: 0, price_max: 0, ...patch }];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await savePricingAction({ grades, sizes, matrix, tiers, options });
      if (result.ok) {
        setMessage({ type: "success", text: "保存しました。" });
        router.refresh();
      } else {
        setMessage({
          type: "error",
          text: `保存に失敗しました (${result.code})${result.detail ? `: ${result.detail}` : ""}`,
        });
      }
    });
  }

  return (
    <div className="space-y-10">
      {/* ---- グレード ---- */}
      <section className="space-y-3 rounded-xl border border-admin-card-border bg-card p-4 shadow-md">
        <h2 className="text-base font-semibold">グレード</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">key</th>
                <th className="p-2">表示名</th>
                <th className="p-2">説明</th>
                <th className="p-2">並び順</th>
                <th className="p-2">有効</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-2">
                    <Input
                      value={g.key}
                      onChange={(e) =>
                        setGrades((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, key: e.target.value } : row)),
                        )
                      }
                      className="w-28"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={g.label}
                      onChange={(e) =>
                        setGrades((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, label: e.target.value } : row)),
                        )
                      }
                      className="w-32"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={g.description}
                      onChange={(e) =>
                        setGrades((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, description: e.target.value } : row,
                          ),
                        )
                      }
                      className="w-40"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={g.sort_order}
                      onChange={(e) =>
                        setGrades((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, sort_order: Number(e.target.value) || 0 } : row,
                          ),
                        )
                      }
                      className="w-20"
                    />
                  </td>
                  <td className="p-2">
                    <Checkbox
                      checked={g.is_active}
                      onCheckedChange={(checked) =>
                        setGrades((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, is_active: checked === true } : row,
                          ),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setGrades((prev) => [
              ...prev,
              {
                id: null,
                expected_updated_at: null,
                key: "",
                label: "",
                description: "",
                sort_order: prev.length,
                is_active: true,
              },
            ])
          }
        >
          グレードを追加
        </Button>
        <p className="text-xs text-muted-foreground">
          ※ グレードは削除できません (is_active を外すことで非表示にします)。
        </p>
      </section>

      {/* ---- サイズ帯 ---- */}
      <section className="space-y-3 rounded-xl border border-admin-card-border bg-card p-4 shadow-md">
        <h2 className="text-base font-semibold">サイズ帯</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">key</th>
                <th className="p-2">表示名</th>
                <th className="p-2">上限(mm)</th>
                <th className="p-2">個別見積もり</th>
                <th className="p-2">並び順</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {sizes.map((s, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-2">
                    <Input
                      value={s.key}
                      onChange={(e) =>
                        setSizes((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, key: e.target.value } : row)),
                        )
                      }
                      className="w-20"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={s.label}
                      onChange={(e) =>
                        setSizes((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, label: e.target.value } : row)),
                        )
                      }
                      className="w-32"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={s.max_mm ?? ""}
                      placeholder="上限なし"
                      onChange={(e) =>
                        setSizes((prev) =>
                          prev.map((row, idx) =>
                            idx === i
                              ? { ...row, max_mm: e.target.value === "" ? null : Number(e.target.value) }
                              : row,
                          ),
                        )
                      }
                      className="w-24"
                    />
                  </td>
                  <td className="p-2">
                    <Checkbox
                      checked={s.quote_only}
                      onCheckedChange={(checked) =>
                        setSizes((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, quote_only: checked === true } : row,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={s.sort_order}
                      onChange={(e) =>
                        setSizes((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, sort_order: Number(e.target.value) || 0 } : row,
                          ),
                        )
                      }
                      className="w-20"
                    />
                  </td>
                  <td className="p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSizes((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setSizes((prev) => [
              ...prev,
              { key: "", label: "", max_mm: null, quote_only: false, sort_order: prev.length },
            ])
          }
        >
          サイズ帯を追加
        </Button>
      </section>

      {/* ---- 価格行列 (グレード × サイズ) ---- */}
      <section className="space-y-3 rounded-xl border border-admin-card-border bg-card p-4 shadow-md">
        <h2 className="text-base font-semibold">価格行列 (1点あたりの下限〜上限・円)</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">グレード ＼ サイズ帯</th>
                {pricedSizes.map((s) => (
                  <th key={s.key} className="p-2">
                    {s.label || s.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.key} className="border-t border-border">
                  <td className="p-2 font-medium">{g.label || g.key}</td>
                  {pricedSizes.map((s) => {
                    const cell = getCell(g.key, s.key);
                    return (
                      <td key={s.key} className="p-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={cell.price_min}
                            onChange={(e) =>
                              setCell(g.key, s.key, { price_min: Number(e.target.value) || 0 })
                            }
                            className="w-20"
                          />
                          <span className="text-muted-foreground">〜</span>
                          <Input
                            type="number"
                            value={cell.price_max}
                            onChange={(e) =>
                              setCell(g.key, s.key, { price_max: Number(e.target.value) || 0 })
                            }
                            className="w-20"
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          ※ 個別見積もり (quote_only) のサイズ帯は価格を持たないため一覧に出ません。
        </p>
      </section>

      {/* ---- 数量値引き ---- */}
      <section className="space-y-3 rounded-xl border border-admin-card-border bg-card p-4 shadow-md">
        <h2 className="text-base font-semibold">数量値引き (自動適用)</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">◯個以上</th>
                <th className="p-2">割引率</th>
                <th className="p-2">表示ラベル</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-2">
                    <Input
                      type="number"
                      value={t.min_qty}
                      onChange={(e) =>
                        setTiers((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, min_qty: Number(e.target.value) || 2 } : row,
                          ),
                        )
                      }
                      className="w-20"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      step="0.01"
                      value={t.discount_rate}
                      onChange={(e) =>
                        setTiers((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, discount_rate: Number(e.target.value) || 0 } : row,
                          ),
                        )
                      }
                      className="w-24"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={t.label}
                      onChange={(e) =>
                        setTiers((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, label: e.target.value } : row)),
                        )
                      }
                      className="w-40"
                    />
                  </td>
                  <td className="p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTiers((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setTiers((prev) => [...prev, { min_qty: 2, discount_rate: 0.1, label: "" }])
          }
        >
          値引き段階を追加
        </Button>
      </section>

      {/* ---- オプション ---- */}
      <section className="space-y-3 rounded-xl border border-admin-card-border bg-card p-4 shadow-md">
        <h2 className="text-base font-semibold">オプション</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">key</th>
                <th className="p-2">表示名</th>
                <th className="p-2">種別</th>
                <th className="p-2">値</th>
                <th className="p-2">並び順</th>
                <th className="p-2">有効</th>
              </tr>
            </thead>
            <tbody>
              {options.map((o, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-2">
                    <Input
                      value={o.key}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, key: e.target.value } : row)),
                        )
                      }
                      className="w-24"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={o.label}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((row, idx) => (idx === i ? { ...row, label: e.target.value } : row)),
                        )
                      }
                      className="w-28"
                    />
                  </td>
                  <td className="p-2">
                    <select
                      value={o.kind}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((row, idx) =>
                            idx === i
                              ? { ...row, kind: e.target.value as "multiplier" | "fixed" }
                              : row,
                          ),
                        )
                      }
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="multiplier">倍率</option>
                      <option value="fixed">固定額</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      step="0.01"
                      value={o.value}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, value: Number(e.target.value) || 0 } : row,
                          ),
                        )
                      }
                      className="w-24"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={o.sort_order}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, sort_order: Number(e.target.value) || 0 } : row,
                          ),
                        )
                      }
                      className="w-20"
                    />
                  </td>
                  <td className="p-2">
                    <Checkbox
                      checked={o.is_active}
                      onCheckedChange={(checked) =>
                        setOptions((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, is_active: checked === true } : row,
                          ),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setOptions((prev) => [
              ...prev,
              {
                id: null,
                key: "",
                label: "",
                kind: "multiplier",
                value: 1,
                sort_order: prev.length,
                is_active: true,
              },
            ])
          }
        >
          オプションを追加
        </Button>
        <p className="text-xs text-muted-foreground">
          ※ オプションは削除できません (is_active を外すことで非表示にします)。
        </p>
      </section>

      {/* ---- 保存前プレビュー (設計書 §5.2: 変更前後の見積り例 3 パターン並記) ---- */}
      <section className="space-y-3 rounded-xl border border-admin-card-border bg-card p-4 shadow-md">
        <h2 className="text-base font-semibold">保存前プレビュー — 変更前後の見積り例</h2>
        {previewRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            プレビュー対象のグレード/サイズ帯が見つかりません。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">パターン</th>
                  <th className="p-2">変更前</th>
                  <th className="p-2">変更後</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">{row.label}</td>
                    <td className="p-2 font-mono">
                      {row.before.quote_only
                        ? "個別見積もり"
                        : `${yen(row.before.total_min)} 〜 ${yen(row.before.total_max)}`}
                    </td>
                    <td className="p-2 font-mono">
                      {row.after.quote_only
                        ? "個別見積もり"
                        : `${yen(row.after.total_min)} 〜 ${yen(row.after.total_max)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center gap-4">
        <Button type="button" onClick={handleSave} disabled={isPending}>
          {isPending ? "保存中…" : "保存する"}
        </Button>
        {message ? (
          <p className={message.type === "error" ? "text-sm text-destructive" : "text-sm text-green-700"}>
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
