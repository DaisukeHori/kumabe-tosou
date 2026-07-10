"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { DetectedModel } from "@/modules/ai-providers/contracts";

import {
  buildSimpleSiteContextAction,
  generateImagesAction,
  listImageModelsAction,
  selectGeneratedImageAction,
} from "./ai-image-actions";
import type { PickerMediaItem } from "./media-picker-data";

type GeneratedNode = {
  id: string;
  mediaId: string;
  url: string;
  prompt: string;
};

type ReferenceImage = { mimeType: string; dataBase64: string; previewUrl: string };

type Props = {
  onUseImage: (item: PickerMediaItem) => void;
};

const MAX_REFERENCES = 4;

/**
 * MediaPicker の「AI で生成」タブ (docs/design/ai-studio-v2.md §4)。
 * プロンプト + 参照画像 (0-4 枚) + モデルで 4 枚生成 → グリッド表示 →
 * 「これを使う」/「これをベースにさらに…」(カスケード) / パンくず。
 * モデル一覧はタブ表示時にこのコンポーネント自身が取得する
 * (MediaPicker の呼び出し元 — WorkForm/PostForm 等 — 全箇所を変更しないため)。
 */
export function AiImageGenerator({ onUseImage }: Props) {
  const [models, setModels] = useState<DetectedModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [size, setSize] = useState("");
  const [useContext, setUseContext] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<GeneratedNode[]>([]);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const [grid, setGrid] = useState<GeneratedNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void listImageModelsAction().then((result) => {
      if (cancelled) return;
      setModels(result.models);
      setModelId((prev) => prev || (result.models[0]?.id ?? ""));
      if (result.error) setModelsError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function addReferenceFile(file: File) {
    if (references.length >= MAX_REFERENCES) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return;
      const base64 = result.split(",")[1] ?? "";
      setReferences((prev) => [...prev, { mimeType: file.type, dataBase64: base64, previewUrl: result }]);
    };
    reader.readAsDataURL(file);
  }

  function removeReference(index: number) {
    setReferences((prev) => prev.filter((_, i) => i !== index));
  }

  function generate() {
    if (!modelId) {
      setError("モデルを選択してください");
      return;
    }
    if (!prompt.trim()) {
      setError("プロンプトを入力してください");
      return;
    }
    setError(null);
    startTransition(async () => {
      let siteContext: string | null = null;
      if (useContext) {
        const ctx = await buildSimpleSiteContextAction();
        siteContext = ctx.context;
      }

      const result = await generateImagesAction({
        prompt,
        model: modelId,
        n: 4,
        size: size.trim() ? size.trim() : undefined,
        quality: undefined,
        parentId: activeParentId,
        sourceMediaIds: [],
        rawSourceImages: references.map((r) => ({ mimeType: r.mimeType, dataBase64: r.dataBase64 })),
        siteContext,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setGrid(
        result.value.images.map((img) => ({ id: img.id, mediaId: img.mediaId, url: img.url, prompt: img.prompt })),
      );
      setBreadcrumb(
        result.value.breadcrumb.map((n) => ({ id: n.id, mediaId: n.mediaId, url: n.url, prompt: n.prompt })),
      );
      setReferences([]);
      setPrompt("");
    });
  }

  function handleUseImage(node: GeneratedNode) {
    startTransition(async () => {
      await selectGeneratedImageAction(node.id);
    });
    onUseImage({ id: node.mediaId, url: node.url, alt: node.prompt.slice(0, 100), is_placeholder: false });
  }

  function cascadeFrom(node: GeneratedNode) {
    setActiveParentId(node.id);
    setBreadcrumb((prev) => [...prev, node]);
    setGrid([]);
    setError(null);
  }

  function jumpToBreadcrumb(node: GeneratedNode, index: number) {
    setActiveParentId(node.id);
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    setGrid([]);
    setError(null);
  }

  function resetToNewBatch() {
    setActiveParentId(null);
    setBreadcrumb([]);
    setGrid([]);
    setError(null);
  }

  return (
    <div className="space-y-4">
      {breadcrumb.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          <span className="text-muted-foreground">系譜:</span>
          <button type="button" onClick={resetToNewBatch} className="underline underline-offset-2">
            最初から
          </button>
          {breadcrumb.map((node, index) => (
            <span key={node.id} className="flex items-center gap-1">
              <span aria-hidden>→</span>
              <button
                type="button"
                onClick={() => jumpToBreadcrumb(node, index)}
                className={cn(
                  "flex items-center gap-1 rounded border border-border px-1.5 py-0.5",
                  node.id === activeParentId && "border-primary",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={node.url} alt="" className="h-5 w-5 rounded object-cover" />
                <span className="max-w-24 truncate">{node.prompt || "(無題)"}</span>
              </button>
            </span>
          ))}
        </div>
      )}

      {modelsError && (
        <p role="alert" className="text-sm text-destructive">
          {modelsError}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Field>
        <FieldLabel htmlFor="ai-image-prompt">
          {activeParentId ? "追加の指示 (この画像をベースに)" : "プロンプト"}
        </FieldLabel>
        <Textarea
          id="ai-image-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-20"
          placeholder="例: 白背景で商品を中央に配置し、柔らかい自然光で撮影したような質感に"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="ai-image-model">モデル</FieldLabel>
          <select
            id="ai-image-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            {models.length === 0 && <option value="">利用可能な画像モデルがありません</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-image-size">サイズ (任意)</FieldLabel>
          <Input id="ai-image-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="1024x1024" />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="ai-image-context"
          checked={useContext}
          onCheckedChange={(checked) => setUseContext(checked === true)}
        />
        <label htmlFor="ai-image-context" className="text-sm">
          サイトの文脈を使う (会社概要・見出しを参考情報として渡す)
        </label>
      </div>

      {!activeParentId && (
        <Field>
          <FieldLabel>参照画像 (0〜4枚、任意)</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {references.map((ref, index) => (
              <div key={index} className="relative h-16 w-16 overflow-hidden rounded border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeReference(index)}
                  aria-label="参照画像を削除"
                  className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-black/60 text-[10px] text-white"
                >
                  ×
                </button>
              </div>
            ))}
            {references.length < MAX_REFERENCES && (
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">
                追加
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) addReferenceFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <FieldDescription>参照画像 1 枚 + プロンプトで自然言語レタッチにも使えます。</FieldDescription>
        </Field>
      )}

      <Button type="button" onClick={generate} disabled={isPending || models.length === 0}>
        {isPending ? "生成中..." : activeParentId ? "この画像をベースに生成" : "4枚生成"}
      </Button>

      {grid.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {grid.map((node) => (
            <div key={node.id} className="space-y-1.5 rounded-xl border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={node.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
              <div className="flex flex-col gap-1">
                <Button type="button" size="sm" onClick={() => handleUseImage(node)}>
                  これを使う
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => cascadeFrom(node)}>
                  これをベースにさらに…
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
