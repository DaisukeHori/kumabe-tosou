import { createHash } from "node:crypto";

import type { PageTextSlot } from "./types";
import { SHARED_CHROME_TEXT_SLOTS } from "./slots/shared-chrome";
import { HOME_TEXT_SLOTS } from "./slots/home";
import { STORY_TEXT_SLOTS } from "./slots/story";
import { ABOUT_TEXT_SLOTS } from "./slots/about";
import { SERVICE_TEXT_SLOTS } from "./slots/service";
import { PROCESS_TEXT_SLOTS } from "./slots/process";
import { MATERIALS_TEXT_SLOTS } from "./slots/materials";
import { COLORS_TEXT_SLOTS } from "./slots/colors";
import { SHOP_TEXT_SLOTS } from "./slots/shop";
import { NOTES_TEXT_SLOTS } from "./slots/notes";
import { CONTACT_TEXT_SLOTS } from "./slots/contact";
import { PRIVACY_TEXT_SLOTS } from "./slots/privacy";

/**
 * page-text (ビジュアルテキストエディタ) の canonical レジストリ。
 * canonical: docs/design/visual-text-editor.md §2 (TEXT_REGISTRY) / §5.3 (lines の行数・
 * 1 行文字数制約、v1.1 で maxLines/maxLineLen フィールドとして構造化) / §5 (v1.1 追加の
 * affectedRoutes/affectsAllRoutes)。docs/design/visual-text-editor-v2.md §5 Wave 0a
 * (text-registry.ts をディレクトリへ分割)。入力資料: docs/design/text-slots/PLAN.md §3.2
 * (Tier A 75 スロットの確定表。本ファイルはこれを 1:1 で転記する canonical 実装)。
 *
 * page_media (registry.ts) と同居させる (§7 モジュール裁定: page_text は page-media
 * モジュールに同居。テーブル名・ファイル名を分けても facade/resolver/エディタ統合面が
 * 完全共通のため)。
 *
 * v2 Wave 0a: 旧 text-registry.ts (単一ファイル) をこのディレクトリへ分割した。
 * types.ts (TextKind/PageTextSlot) + slots/<page>.ts (ページ別配列、1 ファイル 1 ページ) +
 * 本 index.ts (再エクスポート・TEXT_REGISTRY 構築・helper 群)。公開 API
 * (`@/modules/page-media/text-registry` から import できる名前) は分割前と完全に同じであり、
 * 内容・順序も一切変えていない (非退行)。
 *
 * ---- PLAN.md との既知の乖離 (オーケストレーターへ報告) ----
 * PLAN.md §3.2 は story (6) の内訳に `story.message.body` (multiline, 600) を含め
 * 「約370字4段落。インラインマークアップ有無を実装時に要確認、あれば B へ戻す」と
 * 明記している。実際に src/app/(site)/story/page-body.tsx (代表メッセージ 3 段落目) を
 * 確認したところ、当該テキストは
 *   「見えなくなるからこそ、そこに手を抜かない。」
 * を <strong> で囲むインライン装飾を含んでいた。SlotText (slot-text.tsx) は
 * dangerouslySetInnerHTML を禁止しており multiline は素のテキストしか表現できないため、
 * このスロットを A として登録すると T2a 変換時に太字装飾が失われる (非退行違反)。
 * PLAN.md 自身が用意した退避条項に従い、`story.message.body` は **B へ差し戻し** (本
 * レジストリに登録しない)。src/app/(site)/story/page-body.tsx の該当箇所は T2a でも
 * 現状のハードコード JSX のまま維持される (v2 Wave 1 で `rich` kind による再挑戦を検討する)。
 * 結果として確定 A は **75 件ではなく 74 件**。件数アサーションのテスト
 * (tests/page-media-text-registry.test.ts) も実測の 74 に合わせている。
 */

export type { TextKind, PageTextSlot } from "./types";

/**
 * 全テキストスロットの canonical レジストリ。
 * 実測 74 件 (PLAN.md 記載の 75 件から story.message.body を除外。冒頭コメント参照)。
 */
export const TEXT_REGISTRY: readonly PageTextSlot[] = [
  ...SHARED_CHROME_TEXT_SLOTS,
  ...HOME_TEXT_SLOTS,
  ...STORY_TEXT_SLOTS,
  ...ABOUT_TEXT_SLOTS,
  ...SERVICE_TEXT_SLOTS,
  ...PROCESS_TEXT_SLOTS,
  ...MATERIALS_TEXT_SLOTS,
  ...COLORS_TEXT_SLOTS,
  ...SHOP_TEXT_SLOTS,
  ...NOTES_TEXT_SLOTS,
  ...CONTACT_TEXT_SLOTS,
  ...PRIVACY_TEXT_SLOTS,
];

/**
 * TEXT_REGISTRY 内容の sha1 (REGISTRY_HASH と同方式。unstable_cache の keyParts に含め、
 * registry のコード変更がキャッシュに残らないようにする)。
 */
export const TEXT_REGISTRY_HASH: string = createHash("sha1")
  .update(JSON.stringify(TEXT_REGISTRY))
  .digest("hex");

const TEXT_SLOT_KEY_SET: ReadonlySet<string> = new Set(TEXT_REGISTRY.map((s) => s.key));
const TEXT_SLOTS_BY_KEY: ReadonlyMap<string, PageTextSlot> = new Map(
  TEXT_REGISTRY.map((s) => [s.key, s]),
);

/** slot_key が registry に実在するか */
export function isValidTextSlotKey(key: string): boolean {
  return TEXT_SLOT_KEY_SET.has(key);
}

/** key から PageTextSlot を引く (存在しなければ undefined) */
export function textSlotByKey(key: string): PageTextSlot | undefined {
  return TEXT_SLOTS_BY_KEY.get(key);
}

/** route に紐づく PageTextSlot 一覧 (登場順) */
export function textSlotsForRoute(route: string): PageTextSlot[] {
  return TEXT_REGISTRY.filter((slot) => slot.route === route);
}

/**
 * 1 行あたりの文字数上限を解決する。
 * maxLineLen が明示されていればそれを、無ければ Math.floor(maxLen / maxLines) を返す
 * (maxLines 未設定なら undefined = 1 行制約なし)。
 */
export function resolveMaxLineLen(slot: PageTextSlot): number | undefined {
  if (slot.maxLineLen !== undefined) return slot.maxLineLen;
  if (slot.maxLines !== undefined && slot.maxLines > 0) {
    return Math.floor(slot.maxLen / slot.maxLines);
  }
  return undefined;
}

/**
 * 改行コードを正規化する: `\r\n` (CRLF) と単独の `\r` (CR) をすべて `\n` (LF) に統一する。
 * textarea 由来の入力は OS によって \r\n を含みうるため、保存前に必ずこの関数を通す
 * (v1.3 tester 検証ギャップ対応)。maxLines/maxLineLen/kind の検証は本関数適用後の
 * テキストに対して行う (zSetTextReq の text フィールド transform / facade.setText の
 * 両方から呼ばれ、検証と保存の対象が常に一致するようにする)。
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n|\r/g, "\n");
}

/**
 * slot の制約 (下限・maxLen / kind 別の改行・行数・行長・段落数) に対して text を検証し、
 * 違反メッセージの配列を返す (空配列 = 妥当)。zSetTextReq の superRefine から呼ばれる
 * (contracts.ts)。KMB-E101 (検証エラー) の詳細メッセージ生成に相当する。
 *
 * 呼び出し側は normalizeLineEndings 適用後の text を渡すこと (§ normalizeLineEndings)。
 *
 * v2 (docs/design/visual-text-editor-v2.md §3.3): kind="rich" は multiline と同じ下限/
 * maxLen (raw 長 = マークアップ記号込み) チェックのみを行う。改行・行数の強制はしない
 * (段落自由)。maxLines 指定時のみ multiline と同基準で段落数上限をチェックする。
 * マークアップ未対応マーカー (奇数個のバッククォート/`**`) はここではエラーにしない
 * (renderRichText がリテラル文字として安全に描画するため、保存を壊さない)。
 */
export function validateSlotText(slot: PageTextSlot, text: string): string[] {
  const issues: string[] = [];

  // v1.3 tester 検証ギャップ対応 (MEDIUM): 全 74 スロットは見出し/CTA 文言であり、
  // 空 (または空白のみ) は無意味。platform の zTitle 等が .min(1) を強制する規律と整合させる。
  if (text.trim().length === 0) {
    issues.push("空文字列 (または空白のみ) は保存できません");
  }

  if (text.length > slot.maxLen) {
    issues.push(`文字数が上限 (${slot.maxLen}) を超えています`);
  }

  if (slot.kind === "text" && text.includes("\n")) {
    issues.push("改行を含めることはできません");
  }

  if (slot.kind === "lines") {
    const lines = text.split("\n");
    if (slot.maxLines !== undefined && lines.length > slot.maxLines) {
      issues.push(`行数が上限 (${slot.maxLines} 行) を超えています`);
    }
    const maxLineLen = resolveMaxLineLen(slot);
    if (maxLineLen !== undefined && lines.some((line) => line.length > maxLineLen)) {
      issues.push(`1 行の文字数が上限 (${maxLineLen}) を超えています`);
    }
  }

  if ((slot.kind === "multiline" || slot.kind === "rich") && slot.maxLines !== undefined) {
    const paragraphs = text.split("\n\n");
    if (paragraphs.length > slot.maxLines) {
      issues.push(`段落数が上限 (${slot.maxLines}) を超えています`);
    }
  }

  return issues;
}

// TEXT_REGISTRY の route はすべて EDITABLE_ROUTES (page-media/registry.ts) の部分集合
// であることをテスト側 (tests/page-media-text-registry.test.ts) で検証する。
