"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * 作業種別マスタの色 popover (03-scheduling.md §10.3)。type-editor.tsx にローカル定義されていた
 * ColorInput/COLOR_PRESETS (Issue #53) をここへ抽出し、選択状態表示・キーボード操作・hex 正規化を
 * 追加する (Issue #93)。src/app/admin/_ui/ 配下の共通 UI のため他の admin 画面からも再利用できる
 * (将来の resources テーブル等 — 03-scheduling.md §17 line 1880)。
 */
export type ColorPreset = { hex: string; name: string };

/**
 * work_types の既定 seed 色 (supabase/migrations/20260711000029_scheduling_core.sql L189-195:
 * sanding=#8d6e63 / primer=#78909c / painting=#a80f22 / drying=#bdbdbd / inspection=#2e7d32) を
 * 先頭 5 色として含め、施工業らしい配色 + 汎用色を混ぜた 12 色 (Issue #93 設計)。
 */
export const DEFAULT_COLOR_PRESETS: readonly ColorPreset[] = [
  { hex: "#a80f22", name: "えんじ" },
  { hex: "#8d6e63", name: "茶" },
  { hex: "#78909c", name: "青灰" },
  { hex: "#bdbdbd", name: "銀灰" },
  { hex: "#2e7d32", name: "緑" },
  { hex: "#1565c0", name: "青" },
  { hex: "#f9a825", name: "山吹" },
  { hex: "#6a1b9a", name: "紫" },
  { hex: "#00838f", name: "青緑" },
  { hex: "#c62828", name: "朱" },
  { hex: "#4e342e", name: "焦茶" },
  { hex: "#37474f", name: "墨" },
];

export const INVALID_HEX_MESSAGE = "16進数カラーコードを入力してください(例 #a80f22)";

const SHORT_HEX_RE = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/;
const FULL_HEX_RE = /^#[0-9a-f]{6}$/;

/**
 * hex 入力の正規化 (Issue #93): trim → 小文字化 → `#` 補完 → `#abc` → `#aabbcc` 展開。
 * zWorkTypeInput.color の regex `^#[0-9a-f]{6}$` (src/modules/scheduling/contracts.ts) に
 * 一致する形へ揃えた上でのみ非 null を返す。契約の regex 自体は変更しない (最終ガードとして不変)。
 */
export function normalizeHexColor(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (s.length === 0) return null;
  if (!s.startsWith("#")) s = `#${s}`;
  const short = SHORT_HEX_RE.exec(s);
  if (short) {
    const [, r, g, b] = short;
    s = `#${r}${r}${g}${g}${b}${b}`;
  }
  return FULL_HEX_RE.test(s) ? s : null;
}

const GRID_COLS = 6;

export function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_COLOR_PRESETS,
  id,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets?: readonly ColorPreset[];
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [draftError, setDraftError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const reactId = useId();
  const triggerId = id ?? reactId;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // popover を開くたびに draft を現在の form 値へ再同期する (前回セッションの入力エラーを残さない)
      setDraft(value);
      setDraftError(false);
      const idx = presets.findIndex((p) => p.hex === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }

  function selectPreset(hex: string) {
    onChange(hex);
    setDraft(hex);
    setDraftError(false);
    setOpen(false);
  }

  function commitDraft() {
    const normalized = normalizeHexColor(draft);
    if (normalized === null) {
      setDraftError(true);
      return;
    }
    setDraftError(false);
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  }

  function focusOption(index: number) {
    const clamped = Math.max(0, Math.min(index, presets.length - 1));
    setActiveIndex(clamped);
    optionRefs.current[clamped]?.focus();
  }

  function handleOptionKeyDown(e: React.KeyboardEvent<HTMLDivElement>, index: number, hex: string) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusOption(index + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusOption(index - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusOption(index + GRID_COLS);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusOption(index - GRID_COLS);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectPreset(hex);
        break;
      default:
        break;
    }
  }

  const previewColor = draftError ? null : normalizeHexColor(draft);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button type="button" id={triggerId} variant="outline" size="sm" className="gap-2">
            <span className="size-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: value }} />
            {value}
          </Button>
        }
      />
      <PopoverContent className="w-64">
        <div role="listbox" aria-label="色プリセット" className="grid grid-cols-6 gap-2">
          {presets.map((preset, index) => {
            const selected = preset.hex === value;
            return (
              <div
                key={preset.hex}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                role="option"
                aria-selected={selected}
                aria-label={`${preset.name} ${preset.hex}`}
                title={`${preset.name} ${preset.hex}`}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => selectPreset(preset.hex)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(e) => handleOptionKeyDown(e, index, preset.hex)}
                className={cn(
                  "size-6 cursor-pointer rounded-full border border-border outline-none",
                  selected && "ring-2 ring-ring ring-offset-2",
                )}
                style={{ backgroundColor: preset.hex }}
              />
            );
          })}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-6 shrink-0 rounded-full border border-border",
              previewColor === null && "border-dashed",
            )}
            style={{ backgroundColor: previewColor ?? "transparent" }}
          />
          <Input
            aria-label="16進数カラーコード"
            aria-invalid={draftError}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (draftError) setDraftError(false);
            }}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
            placeholder="#a80f22"
          />
        </div>
        {draftError && <p className="mt-1 text-xs text-destructive">{INVALID_HEX_MESSAGE}</p>}
      </PopoverContent>
    </Popover>
  );
}
