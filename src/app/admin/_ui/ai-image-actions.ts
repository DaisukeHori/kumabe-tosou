"use server";

import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import type { DetectedModel, GenerateImageCascadeInput, ImageCascadeResult } from "@/modules/ai-providers/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { settingsFacade } from "@/modules/settings/facade";

/**
 * MediaPicker の「AI で生成」タブ (ai-image-generator.tsx) 用 Server Action 群。
 * canonical: docs/design/ai-studio-v2.md §4。
 */

export type ListImageModelsResult = { models: DetectedModel[]; error: string | null };

export async function listImageModelsAction(): Promise<ListImageModelsResult> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { models: [], error: getErrorInfo(admin.code).message };

  const result = await aiProvidersFacade.listAvailableModels("image");
  if (!result.ok) return { models: [], error: result.detail ?? getErrorInfo(result.code).message };
  return { models: result.value, error: null };
}

export type GenerateImagesActionResult = { ok: true; value: ImageCascadeResult } | { ok: false; error: string };

export async function generateImagesAction(input: GenerateImageCascadeInput): Promise<GenerateImagesActionResult> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, error: getErrorInfo(admin.code).message };

  const result = await aiProvidersFacade.generateImageCascade(input);
  if (!result.ok) return { ok: false, error: result.detail ?? getErrorInfo(result.code).message };
  return { ok: true, value: result.value };
}

export async function selectGeneratedImageAction(generationId: string): Promise<{ ok: boolean; error: string | null }> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, error: getErrorInfo(admin.code).message };

  const result = await aiProvidersFacade.markImageSelected(generationId);
  if (!result.ok) return { ok: false, error: result.detail ?? getErrorInfo(result.code).message };
  return { ok: true, error: null };
}

/**
 * 「サイトの文脈を使う」トグル用の簡易コンテキスト構築 (判断点・オーケストレーターへ報告済み):
 * 設計書 §4 は P2 の buildSiteContextMd (page-media facade) の再利用を指示しているが、
 * P2 と P3 は並列実装 Wave のため本体の完成を前提にできない (「無ければ簡易版」の許容範囲)。
 * ai-providers はサイト構造を知らない設計 (依存方向 §2) のため、コンテキスト文字列の構築は
 * この admin UI 層 (Server Action) で行い、完成済みの文字列だけを facade に渡す。
 * 会社概要 + ヒーロー見出しのみの最小版。P2 が buildSiteContextMd を実装したら
 * ここを差し替える (契約破壊なし — 呼び出し元の型は string | null のまま)。
 */
export async function buildSimpleSiteContextAction(): Promise<{ context: string | null; error: string | null }> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { context: null, error: getErrorInfo(admin.code).message };

  const [company, hero] = await Promise.all([settingsFacade.get("company"), settingsFacade.get("hero")]);

  const lines: string[] = [];
  if (company.ok) {
    lines.push(`# ${company.value.name}`);
    if (company.value.address) lines.push(`所在地: ${company.value.address}`);
  }
  if (hero.ok) {
    lines.push(`## ${hero.value.heading}`);
    if (hero.value.subheading) lines.push(hero.value.subheading);
  }

  if (lines.length === 0) return { context: null, error: null };
  return { context: lines.join("\n"), error: null };
}
