import { createHash } from "node:crypto";

/**
 * page-media モジュールの canonical レジストリ。
 * canonical: docs/design/visual-media-editor.md §3 (スロットレジストリ)。
 *
 * ここが slot_key・default_src・page・label・aspect の単一ソース。migration seed も
 * admin エディタの一覧もここから生成する (手書き重複禁止)。
 *
 * ---- 契約との既知の乖離 (オーケストレーターへ報告) ----
 * 設計書 §1/§3 は「41 既存写真 + 4 未来枠 = 45」と記載しているが、実際に
 * (site) の各 page.tsx を Read して転記した結果、既存の固定画像は **40 枚**しかない
 * (§3 の named 列挙 — home.hero(1) + home.craft(3) + home.gallery(3) + about.facility(3) +
 *  about.gallery(2) + colors.hero(1) + colors.band(3) + contact.hero(1) +
 *  materials.methods(2) + materials.gallery(2) + process.steps(3) + process.gallery(3) +
 *  service.process(2) + service.gallery(2) + story.chapter(5) + shop.hero(1) +
 *  shop.grade(3) — を実際に足すと 40 であり、設計書 §0.2 の「固定パス 40 箇所」とも
 *  一致する。§3/§1 の「41」「45」という数字自体が設計書側の集計誤りと判断した)。
 * 実ページに存在しない 41 枚目を発明することはできないため、本実装は
 * **40 既存 + 4 未来枠 (story.portrait / shop.product.1-3) = 44 スロット** で確定する。
 * 件数アサーションが必要なテスト (tests/page-media-registry.test.ts) も実測の 44 に
 * 合わせている。設計書側の数字修正が必要であれば要オーケストレーター判断。
 */

export type PageSlotAspect = "hero" | "card32" | "card34" | "square" | "band219";

export type PageSlot = {
  /** 'home.hero' 等。page_media.slot_key と 1:1 */
  key: string;
  /** 'home' | 'about' | … (公開ルートは routeFor(page) 相当で route フィールドに持たせる) */
  page: string;
  /** '/' | '/about' 等。iframe で開く実ルート (§5.3) */
  route: string;
  /** 管理画面表示用ラベル */
  label: string;
  /** 既定画像パス。null = 未来スロット (画像未設定) */
  defaultSrc: string | null;
  /** page_media 行が無い / alt_override も media も無いときの alt */
  altDefault: string;
  aspect: PageSlotAspect;
  /** home.hero のみ true (next/image priority) */
  priority?: boolean;
};

// ---------------------------------------------------------------------------
// home (route: "/")
// ---------------------------------------------------------------------------
const HOME_SLOTS: readonly PageSlot[] = [
  {
    key: "home.hero",
    page: "home",
    route: "/",
    label: "トップ / ヒーロー",
    defaultSrc: "/hero.jpg",
    altDefault: "深い艶で仕上げられた黒い車体",
    aspect: "hero",
    priority: true,
  },
  {
    key: "home.craft.1",
    page: "home",
    route: "/",
    label: "トップ / クラフト写真 1",
    defaultSrc: "/img/sanding.jpg",
    altDefault: "ベルトサンダーで研磨する手元",
    aspect: "card34",
  },
  {
    key: "home.craft.2",
    page: "home",
    route: "/",
    label: "トップ / クラフト写真 2",
    defaultSrc: "/img/spray-hold.jpg",
    altDefault: "塗料を吹き付けるスプレーガン",
    aspect: "card34",
  },
  {
    key: "home.craft.3",
    page: "home",
    route: "/",
    label: "トップ / クラフト写真 3",
    defaultSrc: "/img/car-detail.jpg",
    altDefault: "深い艶の車体クローズアップ",
    aspect: "card34",
  },
  {
    key: "home.gallery.1",
    page: "home",
    route: "/",
    label: "トップ / ギャラリー写真 1",
    defaultSrc: "/img/garage-work.jpg",
    altDefault: "ガレージで車体を仕上げる",
    aspect: "card34",
  },
  {
    key: "home.gallery.2",
    page: "home",
    route: "/",
    label: "トップ / ギャラリー写真 2",
    defaultSrc: "/img/tools-rack.jpg",
    altDefault: "整然と並ぶ工具",
    aspect: "card34",
  },
  {
    key: "home.gallery.3",
    page: "home",
    route: "/",
    label: "トップ / ギャラリー写真 3",
    defaultSrc: "/img/machine.jpg",
    altDefault: "工房の機械",
    aspect: "card34",
  },
];

// ---------------------------------------------------------------------------
// about (route: "/about")
// ---------------------------------------------------------------------------
const ABOUT_SLOTS: readonly PageSlot[] = [
  {
    key: "about.facility.1",
    page: "about",
    route: "/about",
    label: "会社案内 / 設備写真 1",
    defaultSrc: "/img/airbrush-dark.jpg",
    altDefault: "暗い作業台に置かれたスプレーガン",
    aspect: "card32",
  },
  {
    key: "about.facility.2",
    page: "about",
    route: "/about",
    label: "会社案内 / 設備写真 2",
    defaultSrc: "/img/tools-rack.jpg",
    altDefault: "工房の壁に整然と並ぶ工具",
    aspect: "card32",
  },
  {
    key: "about.facility.3",
    page: "about",
    route: "/about",
    label: "会社案内 / 設備写真 3",
    defaultSrc: "/img/machine.jpg",
    altDefault: "工房の産業機械",
    aspect: "card32",
  },
  {
    key: "about.gallery.1",
    page: "about",
    route: "/about",
    label: "会社案内 / ギャラリー写真 1",
    defaultSrc: "/img/metal-work.jpg",
    altDefault: "金属を加工する手元",
    aspect: "card32",
  },
  {
    key: "about.gallery.2",
    page: "about",
    route: "/about",
    label: "会社案内 / ギャラリー写真 2",
    defaultSrc: "/img/surface.jpg",
    altDefault: "塗装面の微細な質感",
    aspect: "card32",
  },
];

// ---------------------------------------------------------------------------
// colors (route: "/colors")
// ---------------------------------------------------------------------------
const COLORS_SLOTS: readonly PageSlot[] = [
  {
    key: "colors.hero",
    page: "colors",
    route: "/colors",
    label: "色見本 / ヒーロー",
    defaultSrc: "/img/car-night.jpg",
    altDefault: "夜に艶めく車体",
    aspect: "band219",
  },
  {
    key: "colors.band.1",
    page: "colors",
    route: "/colors",
    label: "色見本 / バンド写真 1",
    defaultSrc: "/img/black-car.jpg",
    altDefault: "深い艶のモノクロ車体",
    aspect: "band219",
  },
  {
    key: "colors.band.2",
    page: "colors",
    route: "/colors",
    label: "色見本 / バンド写真 2",
    defaultSrc: "/img/car-detail.jpg",
    altDefault: "車体の艶のクローズアップ",
    aspect: "band219",
  },
  {
    key: "colors.band.3",
    page: "colors",
    route: "/colors",
    label: "色見本 / バンド写真 3",
    defaultSrc: "/img/surface.jpg",
    altDefault: "塗装面の質感",
    aspect: "band219",
  },
];

// ---------------------------------------------------------------------------
// contact (route: "/contact")
// ---------------------------------------------------------------------------
const CONTACT_SLOTS: readonly PageSlot[] = [
  {
    key: "contact.hero",
    page: "contact",
    route: "/contact",
    label: "相談する / ヒーロー",
    defaultSrc: "/img/car-night.jpg",
    altDefault: "夜に艶めく仕上がりの車体",
    aspect: "band219",
  },
];

// ---------------------------------------------------------------------------
// materials (route: "/materials")
// ---------------------------------------------------------------------------
const MATERIALS_SLOTS: readonly PageSlot[] = [
  {
    key: "materials.methods.1",
    page: "materials",
    route: "/materials",
    label: "素材対応 / 造形方式写真 1",
    defaultSrc: "/img/printer-3d.jpg",
    altDefault: "稼働する3Dプリンター",
    aspect: "card32",
  },
  {
    key: "materials.methods.2",
    page: "materials",
    route: "/materials",
    label: "素材対応 / 造形方式写真 2",
    defaultSrc: "/img/machine.jpg",
    altDefault: "精密な造形機械",
    aspect: "card32",
  },
  {
    key: "materials.gallery.1",
    page: "materials",
    route: "/materials",
    label: "素材対応 / ギャラリー写真 1",
    defaultSrc: "/img/surface.jpg",
    altDefault: "素材表面の質感",
    aspect: "card32",
  },
  {
    key: "materials.gallery.2",
    page: "materials",
    route: "/materials",
    label: "素材対応 / ギャラリー写真 2",
    defaultSrc: "/img/car-detail.jpg",
    altDefault: "仕上がりの艶",
    aspect: "card32",
  },
];

// ---------------------------------------------------------------------------
// process (route: "/process")
// ---------------------------------------------------------------------------
const PROCESS_SLOTS: readonly PageSlot[] = [
  {
    key: "process.steps.1",
    page: "process",
    route: "/process",
    label: "工程 / ステップ写真 1",
    defaultSrc: "/img/sanding.jpg",
    altDefault: "ベルトサンダーで研磨する手元",
    aspect: "square",
  },
  {
    key: "process.steps.2",
    page: "process",
    route: "/process",
    label: "工程 / ステップ写真 2",
    defaultSrc: "/img/spray-hold.jpg",
    altDefault: "色を吹き付けるスプレーガン",
    aspect: "square",
  },
  {
    key: "process.steps.3",
    page: "process",
    route: "/process",
    label: "工程 / ステップ写真 3",
    defaultSrc: "/img/black-car.jpg",
    altDefault: "塗装が仕上がった車体",
    aspect: "square",
  },
  {
    key: "process.gallery.1",
    page: "process",
    route: "/process",
    label: "工程 / ギャラリー写真 1",
    defaultSrc: "/img/airbrush-dark.jpg",
    altDefault: "吹き付けの設備",
    aspect: "card32",
  },
  {
    key: "process.gallery.2",
    page: "process",
    route: "/process",
    label: "工程 / ギャラリー写真 2",
    defaultSrc: "/img/machine.jpg",
    altDefault: "精密な機械",
    aspect: "card32",
  },
  {
    key: "process.gallery.3",
    page: "process",
    route: "/process",
    label: "工程 / ギャラリー写真 3",
    defaultSrc: "/img/surface.jpg",
    altDefault: "塗装面の質感",
    aspect: "card32",
  },
];

// ---------------------------------------------------------------------------
// service (route: "/service")
// ---------------------------------------------------------------------------
const SERVICE_SLOTS: readonly PageSlot[] = [
  {
    key: "service.process.1",
    page: "service",
    route: "/service",
    label: "サービス / 工程写真 1",
    defaultSrc: "/img/spray-hold.jpg",
    altDefault: "塗料を吹き付けるスプレーガン",
    aspect: "card32",
  },
  {
    key: "service.process.2",
    page: "service",
    route: "/service",
    label: "サービス / 工程写真 2",
    defaultSrc: "/img/paint-cans.jpg",
    altDefault: "調色済みの補修塗料",
    aspect: "card32",
  },
  {
    key: "service.gallery.1",
    page: "service",
    route: "/service",
    label: "サービス / ギャラリー写真 1",
    defaultSrc: "/img/sanding.jpg",
    altDefault: "研磨の工程",
    aspect: "card32",
  },
  {
    key: "service.gallery.2",
    page: "service",
    route: "/service",
    label: "サービス / ギャラリー写真 2",
    defaultSrc: "/img/car-detail.jpg",
    altDefault: "仕上がりの艶",
    aspect: "card32",
  },
];

// ---------------------------------------------------------------------------
// story (route: "/story")
// ---------------------------------------------------------------------------
const STORY_SLOTS: readonly PageSlot[] = [
  {
    key: "story.chapter.1",
    page: "story",
    route: "/story",
    label: "ストーリー / 第1章写真",
    defaultSrc: "/img/black-car.jpg",
    altDefault: "均一な艶で仕上げられた車体",
    aspect: "band219",
  },
  {
    key: "story.chapter.2",
    page: "story",
    route: "/story",
    label: "ストーリー / 第2章写真",
    defaultSrc: "/img/garage-work.jpg",
    altDefault: "ガレージで車体を仕上げる作業",
    aspect: "band219",
  },
  {
    key: "story.chapter.3",
    page: "story",
    route: "/story",
    label: "ストーリー / 第3章写真",
    defaultSrc: "/img/sanding.jpg",
    altDefault: "研磨を繰り返す手元",
    aspect: "band219",
  },
  {
    key: "story.chapter.4",
    page: "story",
    route: "/story",
    label: "ストーリー / 第4章写真",
    defaultSrc: "/img/car-detail.jpg",
    altDefault: "見分けがつかない艶の車体",
    aspect: "band219",
  },
  {
    key: "story.chapter.5",
    page: "story",
    route: "/story",
    label: "ストーリー / 第5章写真",
    defaultSrc: "/img/car-night.jpg",
    altDefault: "夜に艶めく車体",
    aspect: "band219",
  },
  // 未来枠 (新規): 代表メッセージ節の「PORTRAIT — COMING SOON」プレースホルダ。
  // 現状は実写真ではなく装飾ボックス (aspect-[3/4]) のため defaultSrc は null。
  {
    key: "story.portrait",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表ポートレート (COMING SOON)",
    defaultSrc: null,
    altDefault: "代表・隈部信之のポートレート",
    aspect: "card34",
  },
];

// ---------------------------------------------------------------------------
// shop (route: "/shop")
// ---------------------------------------------------------------------------
const SHOP_SLOTS: readonly PageSlot[] = [
  {
    key: "shop.hero",
    page: "shop",
    route: "/shop",
    label: "SHOP / ヒーロー",
    defaultSrc: "/img/black-car.jpg",
    altDefault: "深い艶で仕上げられた黒い車体",
    aspect: "band219",
  },
  {
    key: "shop.grade.1",
    page: "shop",
    route: "/shop",
    label: "SHOP / グレード1写真 (下地仕上げ)",
    defaultSrc: "/img/sanding.jpg",
    altDefault: "研磨で下地を整える工程",
    aspect: "card32",
  },
  {
    key: "shop.grade.2",
    page: "shop",
    route: "/shop",
    label: "SHOP / グレード2写真 (スタンダード)",
    defaultSrc: "/img/spray-hold.jpg",
    altDefault: "ソリッドカラーを吹き付ける工程",
    aspect: "card32",
  },
  {
    key: "shop.grade.3",
    page: "shop",
    route: "/shop",
    label: "SHOP / グレード3写真 (プレミアム)",
    defaultSrc: "/img/car-night.jpg",
    altDefault: "パールが夜に艶めく車体",
    aspect: "card32",
  },
  // 未来枠 (新規): SEC.03「塗装済み製品」の3カード。現状は CSS スウォッチ/装飾のみで
  // 実写真は無く、いずれも「COMING SOON」バッジ付き (defaultSrc は null)。
  {
    key: "shop.product.1",
    page: "shop",
    route: "/shop",
    label: "SHOP / 商品写真 (8色セット、COMING SOON)",
    defaultSrc: null,
    altDefault: "六角色見本パネル・8色セットの商品写真",
    aspect: "card32",
  },
  {
    key: "shop.product.2",
    page: "shop",
    route: "/shop",
    label: "SHOP / 商品写真 (単色、COMING SOON)",
    defaultSrc: null,
    altDefault: "六角色見本パネル・単色の商品写真",
    aspect: "card32",
  },
  {
    key: "shop.product.3",
    page: "shop",
    route: "/shop",
    label: "SHOP / 商品写真 (受注制作、COMING SOON)",
    defaultSrc: null,
    altDefault: "あなたの造形物・一点仕上げの商品写真",
    aspect: "card32",
  },
];

/**
 * 全スロットの canonical レジストリ。
 * 実測 44 件 (40 既存 + 4 未来枠。冒頭コメント参照。設計書の「45」とは 1 件差)。
 */
export const SLOT_REGISTRY: readonly PageSlot[] = [
  ...HOME_SLOTS,
  ...ABOUT_SLOTS,
  ...COLORS_SLOTS,
  ...CONTACT_SLOTS,
  ...MATERIALS_SLOTS,
  ...PROCESS_SLOTS,
  ...SERVICE_SLOTS,
  ...STORY_SLOTS,
  ...SHOP_SLOTS,
];

/**
 * registry 内容の sha1 (§4.1 BLOCKER-v1.4: unstable_cache の keyParts に含め、
 * registry のコード変更がキャッシュに残らないようにする)。build 時 (モジュール
 * トップレベル) に一度だけ計算する。
 */
export const REGISTRY_HASH: string = createHash("sha1")
  .update(JSON.stringify(SLOT_REGISTRY))
  .digest("hex");

const SLOT_KEY_SET: ReadonlySet<string> = new Set(SLOT_REGISTRY.map((s) => s.key));

/**
 * §5.3a: 編集対象ルートの全量。
 * 1) SLOT_REGISTRY の全 route (ページスロットを持つページ)
 * 2) コンテンツ画像を持つ一覧ページ (スロットは無いが data-editable-content が出る)
 * 3) 動的 detail パターン (page-map 側で slug 解決する)
 */
const SLOT_ROUTES: readonly string[] = Array.from(new Set(SLOT_REGISTRY.map((s) => s.route)));

export const EDITABLE_ROUTES: readonly string[] = [
  ...SLOT_ROUTES,
  "/works",
  "/voices",
  "/notes",
  "/blog",
  "/tokushoho",
  "/privacy",
  "works/[slug]",
  "notes/[slug]",
  "blog/[slug]",
];

/** route に紐づく PageSlot 一覧 (登場順) */
export function slotsForRoute(route: string): PageSlot[] {
  return SLOT_REGISTRY.filter((slot) => slot.route === route);
}

/** slot_key が registry に実在するか */
export function isValidSlotKey(key: string): boolean {
  return SLOT_KEY_SET.has(key);
}
