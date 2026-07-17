"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AiKeyMeta, AiKeyStatus, Provider } from "@/modules/ai-providers/contracts";

import {
  deleteAiKeyAction,
  saveAiKeyAction,
  setAiEnabledModelsAction,
  setAiKeyPriorityAction,
  testAiKeyAction,
} from "./ai-actions";
import { updateAiBudgetAction } from "./actions";
import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";
import type { SettingsMetaFor } from "./settings-forms";

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

const STATUS_LABELS: Record<AiKeyStatus, string> = {
  untested: "未検証",
  ok: "正常",
  failed: "失敗",
  limited: "レート制限中",
};

// [#128 R6b] AI キー状態を R0 のステータス 5 系統へ意味写像する
// (旧: default(=primary 赤)/destructive/outline/secondary → success/urgent/warning/neutral)。
function statusBadgeVariant(status: AiKeyStatus): "success" | "urgent" | "warning" | "neutral" {
  if (status === "ok") return "success";
  if (status === "failed") return "urgent";
  if (status === "limited") return "warning";
  return "neutral";
}

/** キーごとのモデル管理パネル (検知済みモデルの有効化 + text 既定モデルのラジオ選択、§6-2) */
function KeyModelsPanel({ keyMeta }: { keyMeta: AiKeyMeta }) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(keyMeta.enabledModels));
  const [defaultModel, setDefaultModel] = useState<string | null>(keyMeta.defaultModel);
  const [isPending, startTransition] = useTransition();

  if (keyMeta.detectedModels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        検知済みモデルがありません。上の「テスト」ボタンでキーを検証すると一覧が表示されます。
      </p>
    );
  }

  function toggle(id: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (defaultModel === id) setDefaultModel(null);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setAiEnabledModelsAction(keyMeta.id, [...enabled], defaultModel);
      if (result.error) toast.error(result.error);
      else toast.success("モデル設定を保存しました。");
    });
  }

  const textModels = keyMeta.detectedModels.filter((m) => m.kind === "text");
  const imageModels = keyMeta.detectedModels.filter((m) => m.kind === "image");

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      {textModels.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">テキストモデル (既定は 1 つだけラジオ選択)</p>
          <div className="flex flex-col gap-1">
            {textModels.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={enabled.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                <span className="flex-1">{m.display}</span>
                {enabled.has(m.id) && (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name={`default-${keyMeta.id}`}
                      checked={defaultModel === m.id}
                      onChange={() => setDefaultModel(m.id)}
                    />
                    既定
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {imageModels.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">画像モデル</p>
          <div className="flex flex-col gap-1">
            {imageModels.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={enabled.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                <span className="flex-1">{m.display}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <Button size="xs" variant="outline" className="w-fit" onClick={save} disabled={isPending}>
        {isPending ? "保存中..." : "モデル設定を保存"}
      </Button>
    </div>
  );
}

function AiKeyRow({ keyMeta }: { keyMeta: AiKeyMeta }) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState(keyMeta.priority);

  function runTest() {
    startTransition(async () => {
      const result = await testAiKeyAction(keyMeta.id);
      if (result.error) toast.error(result.error);
      else toast.success(`疎通確認 OK (モデル ${result.modelCount} 件検知)`);
    });
  }

  function runDelete() {
    if (!window.confirm(`キー「${keyMeta.label}」を削除しますか?`)) return;
    startTransition(async () => {
      const result = await deleteAiKeyAction(keyMeta.id);
      if (result.error) toast.error(result.error);
      else toast.success("削除しました。");
    });
  }

  function savePriority() {
    startTransition(async () => {
      const result = await setAiKeyPriorityAction(keyMeta.id, priority);
      if (result.error) toast.error(result.error);
      else toast.success("優先順位を更新しました。");
    });
  }

  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell>{PROVIDER_LABELS[keyMeta.provider]}</TableCell>
        <TableCell>{keyMeta.label}</TableCell>
        <TableCell className="font-mono text-xs">****{keyMeta.keyLast4}</TableCell>
        <TableCell>
          <Input
            type="number"
            min={1}
            max={9999}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            onBlur={savePriority}
            className="w-20"
          />
        </TableCell>
        <TableCell>
          <Badge variant={statusBadgeVariant(keyMeta.status)}>{STATUS_LABELS[keyMeta.status]}</Badge>
        </TableCell>
        <TableCell className="flex flex-wrap gap-2">
          <Button size="xs" variant="outline" onClick={runTest} disabled={isPending}>
            テスト
          </Button>
          <Button size="xs" variant="outline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "モデル管理を閉じる" : "モデル管理"}
          </Button>
          <Button size="xs" variant="destructive" onClick={runDelete} disabled={isPending}>
            削除
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6}>
            <KeyModelsPanel keyMeta={keyMeta} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AddAiKeyForm() {
  const [state, action, isPending] = useActionState(saveAiKeyAction, SETTINGS_FORM_INITIAL_STATE);

  return (
    <form
      action={action}
      className="grid max-w-2xl grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_2fr_auto_auto]"
    >
      <Field>
        <FieldLabel htmlFor="ai-key-provider">プロバイダ</FieldLabel>
        <select
          id="ai-key-provider"
          name="provider"
          required
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="ai-key-label">ラベル</FieldLabel>
        <Input id="ai-key-label" name="label" required maxLength={50} placeholder="本番キー" />
      </Field>
      <Field>
        <FieldLabel htmlFor="ai-key-apiKey">API キー</FieldLabel>
        <Input id="ai-key-apiKey" name="apiKey" type="password" required minLength={8} autoComplete="off" />
      </Field>
      <Field>
        <FieldLabel htmlFor="ai-key-priority">優先度</FieldLabel>
        <Input id="ai-key-priority" name="priority" type="number" min={1} max={9999} defaultValue={100} className="w-24" />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "追加中..." : "キーを追加"}
        </Button>
      </div>
      <div className="col-span-full">
        <FieldError errors={state.error ? [{ message: state.error }] : undefined} />
      </div>
    </form>
  );
}

function AiBudgetForm({ data }: { data: SettingsMetaFor<"ops_limits"> }) {
  const [state, action, isPending] = useActionState<SettingsFormState, FormData>(
    updateAiBudgetAction,
    SETTINGS_FORM_INITIAL_STATE,
  );
  const v = data.value;
  const [budgetUsd, setBudgetUsd] = useState<string>(
    ((v?.ai_monthly_budget_micro_usd ?? 50_000_000) / 1_000_000).toString(),
  );
  // USD (人間が入力する単位) → µUSD 整数 (updateAiBudgetAction / zOpsLimits が要求する単位) への
  // 変換はここで行い、hidden field で µUSD をそのまま送信する (§1 MINOR-1: µUSD 整数統一)。
  const budgetMicroUsd = Math.round(Number(budgetUsd || "0") * 1_000_000);

  return (
    <form action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      {/* 運用上限タブが編集する x_monthly_post_limit は現在値のまま hidden で持ち回す */}
      <input type="hidden" name="x_monthly_post_limit" value={v?.x_monthly_post_limit ?? 100} />
      <input type="hidden" name="ai_monthly_budget_micro_usd" value={budgetMicroUsd} />
      <FieldGroup className="mt-2">
        <Field>
          <FieldLabel htmlFor="ai-budget-usd">月次予算 (USD)</FieldLabel>
          <Input
            id="ai-budget-usd"
            type="number"
            min={0}
            step="0.01"
            value={budgetUsd}
            onChange={(e) => setBudgetUsd(e.target.value)}
            required
          />
          <FieldDescription>
            µUSD 整数で保存されます (例: 50 → {budgetMicroUsd.toLocaleString("en-US")})。KMB-E407 の予算上限。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-image-limit">月次画像生成上限 (枚)</FieldLabel>
          <Input
            id="ai-image-limit"
            name="ai_monthly_image_limit"
            type="number"
            min={0}
            max={10_000}
            defaultValue={v?.ai_monthly_image_limit ?? 200}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-default-image-model">画像既定モデル ID (任意)</FieldLabel>
          <Input
            id="ai-default-image-model"
            name="ai_default_image_model"
            defaultValue={v?.ai_default_image_model ?? ""}
            placeholder="gpt-image-2 等"
          />
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "予算を保存"}
      </Button>
    </form>
  );
}

export function AiSettingsTab({
  keys,
  opsLimits,
}: {
  keys: AiKeyMeta[];
  opsLimits: SettingsMetaFor<"ops_limits">;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold">プロバイダキー管理</h3>
          <FieldDescription>
            OpenAI / Anthropic / Gemini の API キーを複数登録できます。優先度が小さいキーから順に試行し、
            レート制限・失効時は自動的に次のキーへフォールバックします (設定画面から接続テスト可能)。
          </FieldDescription>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>プロバイダ</TableHead>
                <TableHead>ラベル</TableHead>
                <TableHead>キー (末尾4桁)</TableHead>
                <TableHead>優先度</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    登録済みのキーはありません。下のフォームから追加してください。
                  </TableCell>
                </TableRow>
              )}
              {keys.map((k) => (
                <AiKeyRow key={k.id} keyMeta={k} />
              ))}
            </TableBody>
          </Table>
        </div>
        <AddAiKeyForm />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold">予算</h3>
          <FieldDescription>
            AI 従量課金の月次予算・画像生成の月次枚数上限を設定します。超過時は KMB-E407 として
            生成がブロックされます。
          </FieldDescription>
        </div>
        <AiBudgetForm data={opsLimits} />
      </section>
    </div>
  );
}
