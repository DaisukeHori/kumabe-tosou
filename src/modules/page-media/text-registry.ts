import { createHash } from "node:crypto";

/**
 * page-text (ビジュアルテキストエディタ) の canonical レジストリ。
 * canonical: docs/design/visual-text-editor.md §2 (TEXT_REGISTRY) / §5.3 (lines の行数・
 * 1 行文字数制約、v1.1 で maxLines/maxLineLen フィールドとして構造化) / §5 (v1.1 追加の
 * affectedRoutes/affectsAllRoutes)。入力資料: docs/design/text-slots/PLAN.md §3.2
 * (Tier A 75 スロットの確定表。本ファイルはこれを 1:1 で転記する canonical 実装)。
 *
 * page_media (registry.ts) と同居させる (§7 モジュール裁定: page_text は page-media
 * モジュールに同居。テーブル名・ファイル名を分けても facade/resolver/エディタ統合面が
 * 完全共通のため)。
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
 * 現状のハードコード JSX のまま維持される。
 * 結果として確定 A は **75 件ではなく 74 件**。件数アサーションのテスト
 * (tests/page-media-text-registry.test.ts) も実測の 74 に合わせている。
 */

export type TextKind = "text" | "lines" | "multiline";
// text      = 単一行 (改行禁止)
// lines     = 改行 (\n) 埋め込み見出し。表示側が行分割レンダー
// multiline = 段落テキスト (\n\n 区切り可)

export type PageTextSlot = {
  /** 'home.statement.heading' 等 (PLAN.md §1 命名規約)。page_text.slot_key と 1:1 */
  key: string;
  /** 'home' | 'story' | … | 擬似ページ 'shared' | 'chrome' */
  page: string;
  /** '/' | '/about' 等。iframe で開く実ルート (EDITABLE_ROUTES と同体系) */
  route: string;
  /** 管理画面表示用ラベル */
  label: string;
  kind: TextKind;
  /** 書記素クラスタ数ではなく string.length で判定 (Zod と同基準、§2) */
  maxLen: number;
  /** 現行ハードコード文言そのまま (V2a 画像と同じ「見た目非退行」の正) */
  defaultText: string;
  /**
   * kind="lines" は必須 (行数上限)。kind="multiline" は任意 (段落数上限、v1 は未使用)。
   * kind="text" では扱わない (常に単一行)。§5.3: 「行数上限 (原則2、statement は5)」。
   */
  maxLines?: number;
  /**
   * 1 行あたりの文字数上限。未指定は Math.floor(maxLen / maxLines) を既定とする
   * (resolveMaxLineLen 参照)。§3.3 の役割別標準 (PageHead heading ≤20 / statement ≤18) を
   * 明示的に上書きしたい場合のみ設定する。
   */
  maxLineLen?: number;
  /**
   * `route` 以外にも失効させる必要がある公開ルート (v1.1 追加)。例:
   * notes.cta.* は /notes 一覧と notes/[slug] 詳細の両方で同一キーを描画するため、
   * setSlotText の revalidatePath 対象に detail ルートも含める必要がある (T2b が使用)。
   */
  affectedRoutes?: string[];
  /**
   * shared.* / chrome.* 等、ほぼ全静的ルートに影響するスロット (v1.1 追加)。
   * true の場合、setSlotText は EDITABLE_ROUTES 全体を revalidate 対象とする (T2b が使用)。
   */
  affectsAllRoutes?: boolean;
};

// ---------------------------------------------------------------------------
// shared / chrome (2) — route 横断の共有スロット (PLAN.md §2.2)
// ---------------------------------------------------------------------------
const SHARED_CHROME_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "shared.cta.consult",
    page: "shared",
    route: "/",
    label: "共通 / 「相談する」ボタン",
    kind: "text",
    maxLen: 8,
    defaultText: "相談する",
    affectsAllRoutes: true,
  },
  {
    key: "chrome.footer.tagline",
    page: "chrome",
    route: "/",
    label: "共通 / フッター事業紹介文",
    kind: "multiline",
    maxLen: 80,
    defaultText:
      "3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。",
    affectsAllRoutes: true,
  },
];

// ---------------------------------------------------------------------------
// home (15, route: "/")
// ---------------------------------------------------------------------------
const HOME_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "home.statement.heading",
    page: "home",
    route: "/",
    label: "トップ / STATEMENT 見出し",
    kind: "lines",
    maxLen: 90,
    defaultText:
      "デザインモデルの品質は、\n表面処理で決まる。\nそれでも、表面処理を高い水準で\n内製できる会社は、多くない。\nその空白のために、この工房がある。",
    maxLines: 5,
    maxLineLen: 18,
  },
  {
    key: "home.craft.heading",
    page: "home",
    route: "/",
    label: "トップ / CRAFT 見出し",
    kind: "text",
    maxLen: 24,
    defaultText: "3つの技術を、ひとりで持つ。",
  },
  {
    key: "home.craft.card.1.title",
    page: "home",
    route: "/",
    label: "トップ / CRAFTカード1 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "積層痕を消す研磨",
  },
  {
    key: "home.craft.card.2.title",
    page: "home",
    route: "/",
    label: "トップ / CRAFTカード2 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "自動車グレードの艶",
  },
  {
    key: "home.craft.card.3.title",
    page: "home",
    route: "/",
    label: "トップ / CRAFTカード3 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "3コートパールの意匠",
  },
  {
    key: "home.colorlineup.heading",
    page: "home",
    route: "/",
    label: "トップ / COLOR LINEUP 見出し",
    kind: "lines",
    maxLen: 30,
    defaultText: "名車の象徴色で組んだ、\n8枚の技術証明。",
    maxLines: 2,
  },
  {
    key: "home.twoscenes.heading",
    page: "home",
    route: "/",
    label: "トップ / TWO SCENES 見出し",
    kind: "text",
    maxLen: 26,
    defaultText: "一点の勝負にも、千個の生産にも。",
  },
  {
    key: "home.twoscenes.scene.1.title",
    page: "home",
    route: "/",
    label: "トップ / TWO SCENES シーン1 見出し",
    kind: "text",
    maxLen: 28,
    defaultText: "プレミアムデザインモデルの一点仕上げ",
  },
  {
    key: "home.twoscenes.scene.2.title",
    page: "home",
    route: "/",
    label: "トップ / TWO SCENES シーン2 見出し",
    kind: "text",
    maxLen: 28,
    defaultText: "金型を作らない少量生産の外観仕上げ",
  },
  {
    key: "home.stats.heading",
    page: "home",
    route: "/",
    label: "トップ / BY THE NUMBERS 見出し",
    kind: "lines",
    maxLen: 20,
    defaultText: "工房の能力を、\n数字で。",
    maxLines: 2,
  },
  {
    key: "home.materials.heading",
    page: "home",
    route: "/",
    label: "トップ / MATERIALS 導線見出し",
    kind: "lines",
    maxLen: 40,
    defaultText: "FDMも、光造形も、SLSも。\n素材ごとに、手を変える。",
    maxLines: 2,
  },
  {
    key: "home.notes.heading",
    page: "home",
    route: "/",
    label: "トップ / NOTES 導線見出し",
    kind: "lines",
    maxLen: 32,
    defaultText: "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
    maxLines: 2,
  },
  {
    key: "home.gallery.heading",
    page: "home",
    route: "/",
    label: "トップ / GALLERY 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "工房の、手の記録。",
  },
  {
    key: "home.cta.heading",
    page: "home",
    route: "/",
    label: "トップ / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
    maxLines: 2,
  },
  {
    key: "home.cta.note",
    page: "home",
    route: "/",
    label: "トップ / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "造形データや写真があれば、より正確に概算をお出しできます。",
  },
];

// ---------------------------------------------------------------------------
// story (5 — PLAN.md 記載の 6 件から story.message.body を除外。冒頭コメント参照)
// route: "/story"
// ---------------------------------------------------------------------------
const STORY_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "story.hero.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / ヒーロー見出し",
    kind: "lines",
    maxLen: 28,
    defaultText: "なぜ、積層痕と\n戦うことにしたのか。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "story.hero.lead",
    page: "story",
    route: "/story",
    label: "ストーリー / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "家電の量産塗装で長年腕を磨いた職人が、どうして3Dプリントの表面処理という、まだ名前もない仕事に専念することにしたのか。一本の相談から始まった、下地をめぐる物語です。",
  },
  {
    key: "story.message.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "「見えなくなる仕事」に、\n誇りを持っています。",
    maxLines: 2,
  },
  {
    key: "story.cta.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "物語の続きは、\nあなたの造形物で。",
    maxLines: 2,
  },
  {
    key: "story.cta.note",
    page: "story",
    route: "/story",
    label: "ストーリー / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "「絶対に外せない一個」を、量産品の顔に。まずはお気軽にご相談ください。",
  },
];

// ---------------------------------------------------------------------------
// about (7, route: "/about")
// ---------------------------------------------------------------------------
const ABOUT_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "about.hero.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "下地の仕事は、\n見えなくなるからこそ。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "about.hero.lead",
    page: "about",
    route: "/about",
    label: "会社案内 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "仕上がった塗面に、研ぎの跡は残りません。それでも、艶の深さも、色の正確さも、すべては見えなくなった下地が決めています。隈部塗装は、その見えない工程に最も時間を割く工房です。",
  },
  {
    key: "about.why.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / WHY THIS WORKSHOP 見出し",
    kind: "lines",
    maxLen: 40,
    defaultText: "「表面処理だけ頼みたい」に、\n応える工房が少なかった。",
    maxLines: 2,
  },
  {
    key: "about.facility.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / FACILITY 見出し",
    kind: "text",
    maxLen: 24,
    defaultText: "バンパー6本を、同時に塗れる。",
  },
  {
    key: "about.gallery.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / GALLERY 見出し",
    kind: "text",
    maxLen: 18,
    defaultText: "現場の、手ざわり。",
  },
  {
    key: "about.cta.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "工程と料金の詳細は、\nサービスページに。",
    maxLines: 2,
  },
  {
    key: "about.cta.note",
    page: "about",
    route: "/about",
    label: "会社案内 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "下地は全グレード共通。差分はトップコートの層数だけです。",
  },
];

// ---------------------------------------------------------------------------
// service (8, route: "/service")
// ---------------------------------------------------------------------------
const SERVICE_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "service.hero.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "下地は全グレード共通。\nだから品質が揺れない。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "service.hero.lead",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。",
  },
  {
    key: "service.process.aside.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / 「なぜ鏡面磨きをしないのか」見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "なぜ鏡面磨きをしないのか",
  },
  {
    key: "service.terms.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / HONEST TERMS 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "正直に、先にお伝えします。",
  },
  {
    key: "service.qc.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUALITY CONTROL 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "発送前に、8つの目で見る。",
  },
  {
    key: "service.gallery.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GALLERY 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "工程の、その手。",
  },
  {
    key: "service.cta.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
    maxLines: 2,
  },
  {
    key: "service.cta.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "造形データや写真があれば、より正確に概算をお出しできます。",
  },
];

// ---------------------------------------------------------------------------
// process (9, route: "/process")
// ---------------------------------------------------------------------------
const PROCESS_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "process.hero.heading",
    page: "process",
    route: "/process",
    label: "工程 / ヒーロー見出し",
    kind: "lines",
    maxLen: 28,
    defaultText: "一個が仕上がるまでの、\n9つの手。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "process.hero.lead",
    page: "process",
    route: "/process",
    label: "工程 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "3Dプリントの造形物が、量産品と見分けがつかない外観になるまでには、決まった順序があります。派手なのは色を吹く瞬間だけ。その前後にある地味な工程こそが、仕上がりを決めます。自動車補修の手順を、一手ずつ開きます。",
  },
  {
    key: "process.coating.heading",
    page: "process",
    route: "/process",
    label: "工程 / COATING STRUCTURE 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "塗装は、\n層でできている。",
    maxLines: 2,
  },
  {
    key: "process.steps.heading",
    page: "process",
    route: "/process",
    label: "工程 / THE 9 STEPS 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "受け取ってから、\n送り出すまで。",
    maxLines: 2,
  },
  {
    key: "process.booth.heading",
    page: "process",
    route: "/process",
    label: "工程 / THE BOOTH 見出し",
    kind: "lines",
    maxLen: 28,
    defaultText: "きれいな空気でしか、\nきれいには塗れない。",
    maxLines: 2,
  },
  {
    key: "process.related.heading",
    page: "process",
    route: "/process",
    label: "工程 / RELATED 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "工程の、その先へ。",
  },
  {
    key: "process.gallery.heading",
    page: "process",
    route: "/process",
    label: "工程 / GALLERY 見出し",
    kind: "text",
    maxLen: 18,
    defaultText: "工程を、支えるもの。",
  },
  {
    key: "process.cta.heading",
    page: "process",
    route: "/process",
    label: "工程 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "この9工程を、\nあなたの一個に。",
    maxLines: 2,
  },
  {
    key: "process.cta.note",
    page: "process",
    route: "/process",
    label: "工程 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "サイズ・個数・グレードが分かれば、概算をお出しできます。まずはご相談ください。",
  },
];

// ---------------------------------------------------------------------------
// materials (9, route: "/materials")
// ---------------------------------------------------------------------------
const MATERIALS_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "materials.hero.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "素材を選ばない。\nただし、素材ごとに手を変える。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "materials.hero.lead",
    page: "materials",
    route: "/materials",
    label: "素材対応 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "3Dプリントは、造形方式によって積層痕の出方も、塗料の乗り方も、まったく違います。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む——同じ「下地」でも、素材ごとに手を変えます。ここでは対応方式と、素材別の考え方をまとめます。",
  },
  {
    key: "materials.methods.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / PRINTING METHODS 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "3つの造形方式、\nそれぞれの下地。",
    maxLines: 2,
  },
  {
    key: "materials.matrix.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX 見出し",
    kind: "text",
    maxLen: 18,
    defaultText: "素材別の、対応と勘所。",
  },
  {
    key: "materials.why.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / WHY IT MATTERS 見出し",
    kind: "lines",
    maxLen: 26,
    defaultText: "失敗の多くは、\n塗る前に決まっている。",
    maxLines: 2,
  },
  {
    key: "materials.intake.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / DATA INTAKE 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "造形から、任せてもいい。",
  },
  {
    key: "materials.gallery.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / GALLERY 見出し",
    kind: "text",
    maxLen: 14,
    defaultText: "素材の、その先。",
  },
  {
    key: "materials.cta.heading",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "素材が決まっていなくても、\n用途から相談できます。",
    maxLines: 2,
  },
  {
    key: "materials.cta.note",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "「屋外で使う」「撮影用」「触れる展示物」——用途に合う素材と仕上げをご提案します。",
  },
];

// ---------------------------------------------------------------------------
// colors (4, route: "/colors")
// ---------------------------------------------------------------------------
const COLORS_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "colors.hero.heading",
    page: "colors",
    route: "/colors",
    label: "色見本 / ヒーロー見出し (8枚 = SWATCHES.length と手動同期)",
    kind: "lines",
    maxLen: 36,
    defaultText: "名車の象徴色で組んだ、\n8枚の技術証明。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "colors.hero.lead",
    page: "colors",
    route: "/colors",
    label: "色見本 / ヒーローリード文 (8色中5色 = 手動同期)",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。実物の色見本パネル（対辺70mmの六角形・裏面カラーコード刻印）は、郵送でお貸し出しできるよう準備中です。",
  },
  {
    key: "colors.cta.heading",
    page: "colors",
    route: "/colors",
    label: "色見本 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "この8色以外も、\n色番号でご指定いただけます。",
    maxLines: 2,
  },
  {
    key: "colors.cta.note",
    page: "colors",
    route: "/colors",
    label: "色見本 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。",
  },
];

// ---------------------------------------------------------------------------
// shop (9, route: "/shop")
// ---------------------------------------------------------------------------
const SHOP_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "shop.hero.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / ヒーロー見出し",
    kind: "lines",
    maxLen: 26,
    defaultText: "仕上げを、\n通販のように買う。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "shop.hero.lead",
    page: "shop",
    route: "/shop",
    label: "SHOP / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのまま注文のご相談へ。オンライン決済は現在準備中のため、いまは「注文の意思表示 → 相談 → 正式見積もり → お支払い」の流れでお受けしています。手のひらの造形物を送るだけで、量産品の顔になって還ってきます。",
  },
  {
    key: "shop.grades.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / FINISHING SERVICES 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "3つのグレードから、\n選ぶ。",
    maxLines: 2,
  },
  {
    key: "shop.simulator.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / ESTIMATE SIMULATOR 見出し",
    kind: "lines",
    maxLen: 30,
    defaultText: "サイズ × 個数 × グレード。\n3つ選べば、概算が出る。",
    maxLines: 2,
    maxLineLen: 16,
  },
  {
    key: "shop.simulator.cta",
    page: "shop",
    route: "/shop",
    label: "SHOP / シミュレータ注文ボタン (固定高+矢印、折返し厳禁)",
    kind: "text",
    maxLen: 16,
    defaultText: "この内容で注文・相談する",
  },
  {
    key: "shop.products.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / READY-MADE 見出し",
    kind: "lines",
    maxLen: 24,
    defaultText: "手に取れる製品も、\nここに並びます。",
    maxLines: 2,
  },
  {
    key: "shop.flow.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / HOW TO ORDER 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "注文から、お届けまで。",
  },
  {
    key: "shop.cta.heading",
    page: "shop",
    route: "/shop",
    label: "SHOP / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "概算が出たら、\nあとは送るだけ。",
    maxLines: 2,
  },
  {
    key: "shop.cta.note",
    page: "shop",
    route: "/shop",
    label: "SHOP / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "シミュレータの内容をコピーして、そのまま貼り付けてご相談ください。",
  },
];

// ---------------------------------------------------------------------------
// notes (4, route: "/notes") — notes.cta.* は notes/[slug] とも共有 (PLAN.md §5.8)
// ---------------------------------------------------------------------------
const NOTES_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "notes.hero.heading",
    page: "notes",
    route: "/notes",
    label: "読みもの / ヒーロー見出し",
    kind: "lines",
    maxLen: 34,
    defaultText: "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "notes.hero.lead",
    page: "notes",
    route: "/notes",
    label: "読みもの / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText: "工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。",
  },
  {
    key: "notes.cta.heading",
    page: "notes",
    route: "/notes",
    label: "読みもの / CTA帯 見出し (一覧・詳細で共有)",
    kind: "lines",
    maxLen: 44,
    defaultText: "読んで気になったことは、\nそのまま聞いてください。",
    maxLines: 2,
    affectedRoutes: ["/notes", "notes/[slug]"],
  },
  {
    key: "notes.cta.note",
    page: "notes",
    route: "/notes",
    label: "読みもの / CTA帯 補足 (一覧・詳細で共有)",
    kind: "text",
    maxLen: 60,
    defaultText: "工程・色・素材の相性、どんな質問でも。",
    affectedRoutes: ["/notes", "notes/[slug]"],
  },
];

// ---------------------------------------------------------------------------
// contact (2, route: "/contact")
// ---------------------------------------------------------------------------
const CONTACT_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "contact.hero.heading",
    page: "contact",
    route: "/contact",
    label: "相談する / ヒーロー見出し",
    kind: "lines",
    maxLen: 20,
    defaultText: "見積もりは、\n3つの数字で。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "contact.hero.lead",
    page: "contact",
    route: "/contact",
    label: "相談する / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけシンプルです。造形データや写真、素材の種類がわかると、より正確になります。",
  },
];

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

  if (slot.kind === "multiline" && slot.maxLines !== undefined) {
    const paragraphs = text.split("\n\n");
    if (paragraphs.length > slot.maxLines) {
      issues.push(`段落数が上限 (${slot.maxLines}) を超えています`);
    }
  }

  return issues;
}

// TEXT_REGISTRY の route はすべて EDITABLE_ROUTES (page-media/registry.ts) の部分集合
// であることをテスト側 (tests/page-media-text-registry.test.ts) で検証する。
