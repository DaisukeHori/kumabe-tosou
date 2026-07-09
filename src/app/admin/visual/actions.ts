"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import type { z } from "zod";

import { contentFacade } from "@/modules/content/facade";
import {
  zSetContentCoverReq,
  zSetWorkImageReq,
  type AdminListParams,
  type PostKind,
} from "@/modules/content/contracts";
import {
  EDITABLE_ROUTES,
  pageMediaFacade,
  SLOT_REGISTRY,
  TEXT_REGISTRY,
  type PageTextSlot,
} from "@/modules/page-media/facade";
import { zSetSlotAltReq, zSetSlotReq, zSetTextReq } from "@/modules/page-media/contracts";
import type { PageSlotState } from "@/modules/page-media/contracts";
import type { KmbErrorCode, Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";

/**
 * /admin/visual の Server Actions (canonical: docs/design/visual-media-editor.md §5.5b / §6)。
 *
 * 実装契約 (§5.5b):
 * 1. Zod parse → requireAdmin() (settings actions と同じ「必ず requireAdmin を呼ぶ」パターン。
 *    works actions の「requireAdmin 未接続」実装差は踏襲しない)
 * 2. DB commit まで完了 (facade 呼び出し)
 * 3. DB commit 後、return 前に revalidatePath/revalidateTag を呼ぶ (同期 API。await 不要)
 * 4. Result を返す。KMB エラーコードの UI 文言写像はクライアント側 (visual-editor.tsx) の責務
 */

/**
 * data-editable-* から親 (visual-editor.tsx) が組み立てる保存対象の判別union (§6)。
 * - slot: page_media スロット (§1)。既定に戻す = mediaId=null。
 * - content: works/voices/posts の単一カバー画像 (§1)。oldMediaId は CAS 用の楽観排他期待値
 *   (data-editable-media のクリック時点の値)。
 * - work-image: work_images ギャラリー 1 行の置換 (§1/§6.1)。oldMediaId は識別子の一部
 *   (work_id, media_id) のうち置換対象の現 media_id。削除 = mediaId=null。
 */
export type EditableTarget =
  | { type: "slot"; slotKey: string }
  | { type: "content"; kind: "work" | "voice" | "post"; id: string; oldMediaId: string | null }
  | { type: "work-image"; workId: string; oldMediaId: string };

/** posts.kind → 公開一覧/詳細の path prefix。news (お知らせ) は専用の一覧/詳細ルートが無いため対象外 (§5.5b) */
const POST_KIND_PATH: Partial<Record<PostKind, string>> = {
  reading: "/notes",
  blog: "/blog",
};

function zodDetail(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" / ");
}

/**
 * zSetSlotReq / zSetSlotAltReq (slot_key を含む Zod スキーマ) の検証失敗を
 * KMB エラーコードへ写像する (修正3: docs/design/visual-media-editor.md §7)。
 * **slot_key フィールドの不正のみ KMB-E107**(存在しない slot_key)。
 * media_id / alt 等の他フィールドの不正は汎用の入力検証エラー KMB-E101 に写像する
 * (KMB-E107 を「registry 外の slot_key」以外の意味で使わない)。
 */
function mapSlotZodError(error: z.ZodError): KmbErrorCode {
  const hasSlotKeyIssue = error.issues.some((issue) => issue.path[0] === "slot_key");
  return hasSlotKeyIssue ? "KMB-E107" : "KMB-E101";
}

function revalidateSlotRoute(slotKey: string): void {
  const slot = SLOT_REGISTRY.find((s) => s.key === slotKey);
  if (slot) revalidatePath(slot.route);
  revalidateTag("page_media");
}

/** works.cover / work_images 保存共通の失効セット (§5.5b): 一覧 + 詳細 + tag */
async function revalidateWork(workId: string): Promise<void> {
  revalidatePath("/works");
  revalidateTag("works");
  const work = await contentFacade.getWorkAdmin(workId);
  if (work.ok && work.value) revalidatePath(`/works/${work.value.slug}`);
}

function revalidateVoices(): void {
  revalidatePath("/voices");
  revalidateTag("voices");
}

/** posts.cover 保存の失効セット (§5.5b): kind に応じた tag + path (news は tag のみ) */
async function revalidatePost(postId: string): Promise<void> {
  const post = await contentFacade.getPostAdmin(postId);
  if (!post.ok || !post.value) return;
  revalidateTag(`posts:${post.value.kind}`);
  const path = POST_KIND_PATH[post.value.kind];
  if (!path) return;
  revalidatePath(path);
  revalidatePath(`${path}/${post.value.slug}`);
}

async function setSlotImage(slotKey: string, mediaId: string | null): Promise<Result<void>> {
  const parsed = zSetSlotReq.safeParse({ slot_key: slotKey, media_id: mediaId });
  if (!parsed.success) {
    return { ok: false, code: mapSlotZodError(parsed.error), detail: zodDetail(parsed.error) };
  }

  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const result = await pageMediaFacade.setSlot(parsed.data.slot_key, parsed.data.media_id);
  if (!result.ok) return result;
  revalidateSlotRoute(parsed.data.slot_key);
  return result;
}

async function setContentImage(
  kind: "work" | "voice" | "post",
  id: string,
  oldMediaId: string | null,
  mediaId: string | null,
): Promise<Result<void>> {
  const parsed = zSetContentCoverReq.safeParse({
    kind,
    id,
    old_media_id: oldMediaId,
    new_media_id: mediaId,
  });
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: zodDetail(parsed.error) };
  }

  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const { id: contentId, old_media_id, new_media_id } = parsed.data;

  if (parsed.data.kind === "work") {
    const result = await contentFacade.setWorkCover(contentId, old_media_id, new_media_id);
    if (!result.ok) return result;
    await revalidateWork(contentId);
    return result;
  }
  if (parsed.data.kind === "voice") {
    const result = await contentFacade.setVoicePhoto(contentId, old_media_id, new_media_id);
    if (!result.ok) return result;
    revalidateVoices();
    return result;
  }
  const result = await contentFacade.setPostCover(contentId, old_media_id, new_media_id);
  if (!result.ok) return result;
  await revalidatePost(contentId);
  return result;
}

async function setWorkImageEntry(
  workId: string,
  oldMediaId: string,
  mediaId: string | null,
): Promise<Result<void>> {
  const parsed = zSetWorkImageReq.safeParse({
    work_id: workId,
    old_media_id: oldMediaId,
    new_media_id: mediaId,
  });
  if (!parsed.success) {
    return { ok: false, code: "KMB-E101", detail: zodDetail(parsed.error) };
  }

  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const result = await contentFacade.setWorkImage(
    parsed.data.work_id,
    parsed.data.old_media_id,
    parsed.data.new_media_id,
  );
  if (!result.ok) return result;
  await revalidateWork(parsed.data.work_id);
  return result;
}

/**
 * §6 の Server Action シグネチャそのもの。EditableTarget の discriminant で
 * 保存経路 (page_media / content cover CAS / work_images RPC) を振り分ける。
 * mediaId=null は「既定に戻す」(slot) / 「削除」(work-image) を意味する
 * (content は §5.1 のメニューに削除を出さないが、facade 自体は null を受け付ける)。
 */
export async function setImage(target: EditableTarget, mediaId: string | null): Promise<Result<void>> {
  if (target.type === "slot") return setSlotImage(target.slotKey, mediaId);
  if (target.type === "content") {
    return setContentImage(target.kind, target.id, target.oldMediaId, mediaId);
  }
  return setWorkImageEntry(target.workId, target.oldMediaId, mediaId);
}

/** slot の alt_override 編集 (§5.1 メニュー「alt 編集」。slot のみ、content 画像は対象外 §2.2) */
export async function setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>> {
  const parsed = zSetSlotAltReq.safeParse({ slot_key: slotKey, alt });
  if (!parsed.success) {
    return { ok: false, code: mapSlotZodError(parsed.error), detail: zodDetail(parsed.error) };
  }

  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const result = await pageMediaFacade.setSlotAlt(parsed.data.slot_key, parsed.data.alt);
  if (!result.ok) return result;
  revalidateSlotRoute(parsed.data.slot_key);
  return result;
}

// ---------------------------------------------------------------------------
// page-text (ビジュアルテキストエディタ、canonical: docs/design/visual-text-editor.md §5)
// ---------------------------------------------------------------------------

/** TEXT_REGISTRY / EDITABLE_ROUTES の route 表記 ("notes/[slug]" 等、先頭 "/" 無し) を revalidatePath 用に正規化する */
function toRevalidatePath(route: string): string {
  return route.startsWith("/") ? route : `/${route}`;
}

/** 動的ルートパターン ([slug] を含む) は type="page" で失効する (§5 MAJOR-2) */
function revalidateOneTextRoute(route: string): void {
  const path = toRevalidatePath(route);
  if (path.includes("[")) {
    revalidatePath(path, "page");
  } else {
    revalidatePath(path);
  }
}

/**
 * setSlotText 保存後の失効セット (§5 MAJOR-2 の全展開):
 * - 基本: 当該スロットの route + tag "page_text"
 * - affectedRoutes: route 以外にも失効させる path (例: notes.cta.* → /notes 一覧 + notes/[slug] 詳細)
 * - affectsAllRoutes: shared.* / chrome.* は EDITABLE_ROUTES 全体
 *   (SLOT_REGISTRY の静的 route 全量 + works/notes/blog の [slug] 3 パターン) を失効
 */
function revalidateTextRoute(slotKey: string): void {
  revalidateTag("page_text");
  const slot = TEXT_REGISTRY.find((s) => s.key === slotKey);
  if (!slot) return;
  revalidateOneTextRoute(slot.route);
  slot.affectedRoutes?.forEach(revalidateOneTextRoute);
  if (slot.affectsAllRoutes) {
    EDITABLE_ROUTES.forEach(revalidateOneTextRoute);
  }
}

/**
 * kind=text/lines/multiline のテキストスロット編集 (§5 テキスト編集メニューの保存)。
 * text=null は「既定に戻す」(page_text 行削除)。text が defaultText と同一の場合も
 * facade.setText 側で削除に正規化される (§3 v1.1)。
 * Zod 検証 (registry 限定 + maxLen/kind/行数/1行文字数、CRLF 正規化) は zSetTextReq
 * (contracts.ts → text-registry.ts の validateSlotText) に委譲する。E107/E101 の写像は
 * setSlotImage/setSlotAlt と同じ mapSlotZodError の流儀を踏襲する (slot_key 不正のみ E107)。
 */
export async function setSlotText(slotKey: string, text: string | null): Promise<Result<void>> {
  const parsed = zSetTextReq.safeParse({ slot_key: slotKey, text });
  if (!parsed.success) {
    return { ok: false, code: mapSlotZodError(parsed.error), detail: zodDetail(parsed.error) };
  }

  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const result = await pageMediaFacade.setText(parsed.data.slot_key, parsed.data.text);
  if (!result.ok) return result;
  revalidateTextRoute(parsed.data.slot_key);
  return result;
}

// ---------------------------------------------------------------------------
// サイドパネル (§5.4 BLOCKER-3 対応): route ごとの slot 一覧 + 「DOM が無いコンテンツ画像」一覧
// ---------------------------------------------------------------------------

export type SlotPanelItem = {
  slotKey: string;
  label: string;
  state: PageSlotState["state"];
  mediaId: string | null;
  alt: string;
};

/** cover/photo が未設定 (null) の work/voice/post。公開ページに DOM が出ない (未公開 or プレースホルダのみ) ため
 *  iframe クリックだけでは到達できず、サイドパネルから直接 MediaPicker を開く導線が必要 (§5.4) */
export type ContentGapItem = {
  kind: "work" | "voice" | "post";
  id: string;
  title: string;
  status: string;
};

/** /works タブの2段ナビ (§5.1a): 公開済み施工事例の slug + タイトル。
 *  クリックで iframe を /edit/works/{slug} (詳細ページ) に切り替える導線に使う。 */
export type WorksNavItem = { slug: string; title: string };

/**
 * サイドパネル「テキスト」セクションの 1 行 (visual-text-editor.md §5)。
 * kind/maxLen/maxLines はテキスト編集メニュー (hotspot-menu.tsx) が Input/Textarea の
 * 出し分け・文字数カウンタ・保存可否判定に使う。state は画像と異なり default/custom の 2 値のみ
 * (page_text に「未設定」概念は無い、§1)。
 */
export type TextPanelItem = {
  slotKey: string;
  label: string;
  kind: PageTextSlot["kind"];
  maxLen: number;
  maxLines: number | null;
  state: "default" | "custom";
  text: string;
};

export type SidePanelData = {
  slots: SlotPanelItem[];
  texts: TextPanelItem[];
  contentGaps: ContentGapItem[];
  /** route === "/works" のときのみ非空 (§5.1a)。それ以外の route では常に空配列。 */
  works: WorksNavItem[];
};

const GAP_SCAN_PARAMS: AdminListParams = { cursor: null, limit: 100 };

async function listContentGapsForRoute(route: string): Promise<ContentGapItem[]> {
  if (route === "/works") {
    const result = await contentFacade.listWorksAdmin(GAP_SCAN_PARAMS);
    if (!result.ok) return [];
    return result.value.items
      .filter((w) => w.cover_media_id === null)
      .map((w) => ({ kind: "work" as const, id: w.id, title: w.title, status: w.status }));
  }
  if (route === "/voices") {
    const result = await contentFacade.listVoicesAdmin(GAP_SCAN_PARAMS);
    if (!result.ok) return [];
    return result.value.items
      .filter((v) => v.photo_media_id === null)
      .map((v) => ({
        kind: "voice" as const,
        id: v.id,
        title: `${v.customer_initial} (${v.region})`,
        status: v.status,
      }));
  }
  // "/notes" (公開 route) は posts.kind="reading" (§4.1 の public-content マッピングと同一)
  if (route === "/notes") {
    const result = await contentFacade.listPostsAdmin("reading", GAP_SCAN_PARAMS);
    if (!result.ok) return [];
    return result.value.items
      .filter((p) => p.cover_media_id === null)
      .map((p) => ({ kind: "post" as const, id: p.id, title: p.title, status: p.status }));
  }
  if (route === "/blog") {
    const result = await contentFacade.listPostsAdmin("blog", GAP_SCAN_PARAMS);
    if (!result.ok) return [];
    return result.value.items
      .filter((p) => p.cover_media_id === null)
      .map((p) => ({ kind: "post" as const, id: p.id, title: p.title, status: p.status }));
  }
  return [];
}

/**
 * /works タブ選択時のみ呼ぶ、公開済み施工事例の一覧 (§5.1a 2段ナビ)。
 * work_images (ギャラリー) は施工事例詳細ページにしか出ないため、一覧ページ (page_media
 * スロットを持たない) からは到達できない — サイドパネルにこの一覧を出し、クリックで
 * iframe を /edit/works/{slug} に切り替えることで詳細ページのホットスポット編集に導く。
 * contentFacade.listPublished は canonical API (module-contracts.md §5) のためこのまま使う
 * (facade 拡張不要)。
 */
async function listPublishedWorksNav(): Promise<WorksNavItem[]> {
  const result = await contentFacade.listPublished("work", { cursor: null, limit: 100 });
  if (!result.ok) return [];
  return result.value.items.map((w) => ({ slug: w.slug, title: w.title }));
}

/** ページ選択タブ切り替えごとに呼ぶ、サイドパネル用の読み取り専用 Action */
export async function listSidePanel(route: string): Promise<Result<SidePanelData>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const slotsResult = await pageMediaFacade.listForAdmin(route);
  if (!slotsResult.ok) return slotsResult;

  const textsResult = await pageMediaFacade.listTextsForAdmin(route);
  if (!textsResult.ok) return textsResult;

  const slots: SlotPanelItem[] = slotsResult.value.map((item) => ({
    slotKey: item.slot.key,
    label: item.slot.label,
    state: item.state,
    mediaId: item.mediaId,
    alt: item.alt,
  }));

  const texts: TextPanelItem[] = textsResult.value.map((item) => ({
    slotKey: item.slot.key,
    label: item.slot.label,
    kind: item.slot.kind,
    maxLen: item.slot.maxLen,
    maxLines: item.slot.maxLines ?? null,
    state: item.isDefault ? "default" : "custom",
    text: item.text,
  }));

  const contentGaps = await listContentGapsForRoute(route);
  const works = route === "/works" ? await listPublishedWorksNav() : [];
  return { ok: true, value: { slots, texts, contentGaps, works } };
}
