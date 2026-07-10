import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// materials (104, route: "/materials")
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): 既存9件 (hero/methods/matrix/why/
// intake/gallery/cta 見出し・CTA・リード文) はそのまま維持し、page-body.tsx の残り全静的
// テキスト (rich 3件含む) を追加。defaultText は現行描画テキストと1文字も違わない (非退行、
// npm run build の生成 HTML と現行を突き合わせて確認)。rich kind の語彙は mono(`text`) /
// strong(**text**) / link([text](url)) の3種のみ (§3.1)。METHOD 1〜3 の diff フィールドの
// み rich (「この工房での位置づけ」固定ラベルの strong + METHOD01 のみ #800/#1200 の mono)。
// SecLead / MapNote に埋め込まれるリード文・注記は、共通部品 (page-blocks.tsx、編集不可) が
// children を <p> へそのまま流し込むため、kind=multiline (root が div) を使うと `<p><div>`
// の不正 HTML になる。よって text kind で埋め込む (SlotText の既定 as="span" で inline 化)。
// SectionMark の `no` ("SEC. 01" 等) は shop.ts と同じ方針で本 wave のスコープ外 (noSlotKey
// は将来 wave で必要になれば配線するだけで良い)。PhotoFigure の figNo も同様 (構造的な連番
// 表記であり capJa/capEn/credit のみ対象)。
// ---------------------------------------------------------------------------
export const MATERIALS_TEXT_SLOTS: readonly PageTextSlot[] = [
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
  {
    key: "materials.hero.index",
    page: "materials",
    route: "/materials",
    label: "素材対応 / PageHead 連番表記",
    kind: "text",
    maxLen: 25,
    defaultText:
      "INDEX 06 — MATERIALS",
  },
  {
    key: "materials.hero.en",
    page: "materials",
    route: "/materials",
    label: "素材対応 / PageHead 英字サブラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "FDM / SLA / SLS",
  },
  {
    key: "materials.methods.sec.label",
    page: "materials",
    route: "/materials",
    label: "素材対応 / SEC.01 セクションラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "PRINTING METHODS",
  },
  {
    key: "materials.method.1.tag",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD01 タグ",
    kind: "text",
    maxLen: 15,
    defaultText:
      "METHOD 01",
  },
  {
    key: "materials.method.1.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD01 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "FDM / FFF方式",
  },
  {
    key: "materials.method.1.en",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD01 英字ラベル",
    kind: "text",
    maxLen: 35,
    defaultText:
      "FUSED DEPOSITION MODELING",
  },
  {
    key: "materials.method.1.desc",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD01 本文",
    kind: "multiline",
    maxLen: 90,
    defaultText:
      "熱で溶かした樹脂を層状に積み上げる方式。3方式の中で積層痕が最も目立ち、研磨とサーフェイサーによる下地づくりが仕上がりを大きく左右します。",
  },
  {
    key: "materials.method.1.diff",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD01 この工房での位置づけ (rich)",
    kind: "rich",
    maxLen: 105,
    defaultText:
      "**この工房での位置づけ** — 最も下地に手がかかる＝研磨の技術が最も活きる素材。`#800` で面出しし、厚膜プラサフで積層痕を埋め、`#1200` で仕上げます。",
  },
  {
    key: "materials.method.2.tag",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD02 タグ",
    kind: "text",
    maxLen: 15,
    defaultText:
      "METHOD 02",
  },
  {
    key: "materials.method.2.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD02 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "光造形方式（レジン）",
  },
  {
    key: "materials.method.2.en",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD02 英字ラベル",
    kind: "text",
    maxLen: 25,
    defaultText:
      "SLA / MSLA / DLP",
  },
  {
    key: "materials.method.2.desc",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD02 本文",
    kind: "multiline",
    maxLen: 110,
    defaultText:
      "液体樹脂を光で硬化させる方式。もともと積層痕が少なく滑らかですが、未硬化レジンの洗浄と二次硬化を済ませないと塗料が乗りません。レジンはアクリル系で、塗料との相性は良好です。",
  },
  {
    key: "materials.method.2.diff",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD02 この工房での位置づけ (rich)",
    kind: "rich",
    maxLen: 90,
    defaultText:
      "**この工房での位置づけ** — 洗浄・脱脂・二次硬化の状態を確認してから工程へ。滑らかなぶん下地は軽く、意匠塗装の美しさが素直に出ます。",
  },
  {
    key: "materials.method.3.tag",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD03 タグ",
    kind: "text",
    maxLen: 15,
    defaultText:
      "METHOD 03",
  },
  {
    key: "materials.method.3.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD03 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "SLS方式（粉末）",
  },
  {
    key: "materials.method.3.en",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD03 英字ラベル",
    kind: "text",
    maxLen: 35,
    defaultText:
      "SELECTIVE LASER SINTERING",
  },
  {
    key: "materials.method.3.desc",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD03 本文",
    kind: "multiline",
    maxLen: 85,
    defaultText:
      "ナイロン粉末をレーザーで焼結する方式。表面は多孔質で、ビーズブラストで均一化するのが一般的。塗装には粉末特有の下地づくりが必要です。",
  },
  {
    key: "materials.method.3.diff",
    page: "materials",
    route: "/materials",
    label: "素材対応 / METHOD03 この工房での位置づけ (rich)",
    kind: "rich",
    maxLen: 70,
    defaultText:
      "**この工房での位置づけ** — 要相談・テストピース確認を推奨。多孔質を活かした下地で、艶を作り込みます。",
  },
  {
    key: "materials.methods.1.photo.capja",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.01 日本語キャプション",
    kind: "text",
    maxLen: 15,
    defaultText:
      "FDMの造形",
  },
  {
    key: "materials.methods.1.photo.capen",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.01 英語キャプション",
    kind: "text",
    maxLen: 20,
    defaultText:
      "FDM PRINTING",
  },
  {
    key: "materials.methods.1.photo.credit",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.01 クレジット表記",
    kind: "text",
    maxLen: 35,
    defaultText:
      "Photo: zmorph3d / Unsplash",
  },
  {
    key: "materials.methods.2.photo.capja",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.02 日本語キャプション",
    kind: "text",
    maxLen: 15,
    defaultText:
      "精密な造形機械",
  },
  {
    key: "materials.methods.2.photo.capen",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.02 英語キャプション",
    kind: "text",
    maxLen: 25,
    defaultText:
      "PRECISION MACHINE",
  },
  {
    key: "materials.methods.2.photo.credit",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.02 クレジット表記",
    kind: "text",
    maxLen: 35,
    defaultText:
      "Photo: kadircelep / Unsplash",
  },
  {
    key: "materials.matrix.sec.label",
    page: "materials",
    route: "/materials",
    label: "素材対応 / SEC.02 セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "MATERIAL MATRIX",
  },
  {
    key: "materials.matrix.lead",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 75,
    defaultText:
      "代表的な樹脂ごとの下地処理・注意点・耐候性の目安です。ここに無い素材も、テストピースで相性を確認してからお受けできます。",
  },
  {
    key: "materials.matrix.col.1",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX 列見出し (素材)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "素材",
  },
  {
    key: "materials.matrix.col.2",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX 列見出し (造形方式)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "造形方式",
  },
  {
    key: "materials.matrix.col.3",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX 列見出し (下地の勘所)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "下地の勘所",
  },
  {
    key: "materials.matrix.col.4",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX 列見出し (耐候性の目安)",
    kind: "text",
    maxLen: 15,
    defaultText:
      "耐候性の目安",
  },
  {
    key: "materials.matrix.row.1.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行1 素材名 (PLA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "PLA",
  },
  {
    key: "materials.matrix.row.1.sub",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行1 補足 (PLA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "ポリ乳酸",
  },
  {
    key: "materials.matrix.row.1.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行1 造形方式 (PLA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "FDM",
  },
  {
    key: "materials.matrix.row.1.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行1 下地の勘所 (PLA)",
    kind: "multiline",
    maxLen: 60,
    defaultText:
      "アセトンは効かないため、研磨とスプレーパテで物理的に平滑化。サーフェイサーで密着を確保します。",
  },
  {
    key: "materials.matrix.row.1.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行1 耐候性 (PLA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "屋内向き",
  },
  {
    key: "materials.matrix.row.2.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行2 素材名 (PETG)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "PETG",
  },
  {
    key: "materials.matrix.row.2.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行2 造形方式 (PETG)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "FDM",
  },
  {
    key: "materials.matrix.row.2.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行2 下地の勘所 (PETG)",
    kind: "multiline",
    maxLen: 45,
    defaultText:
      "研磨・サーフェイサー・塗装が基本。密着のため脱脂を丁寧に行います。",
  },
  {
    key: "materials.matrix.row.2.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行2 耐候性 (PETG)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "UV安定",
  },
  {
    key: "materials.matrix.row.3.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行3 素材名 (ABS)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "ABS",
  },
  {
    key: "materials.matrix.row.3.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行3 造形方式 (ABS)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "FDM",
  },
  {
    key: "materials.matrix.row.3.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行3 下地の勘所 (ABS)",
    kind: "multiline",
    maxLen: 45,
    defaultText:
      "研磨に加え、アセトン蒸気処理で光沢化する手もあります。塗装前は必ず脱脂。",
  },
  {
    key: "materials.matrix.row.3.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行3 耐候性 (ABS)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "屋内向き",
  },
  {
    key: "materials.matrix.row.4.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行4 素材名 (ASA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "ASA",
  },
  {
    key: "materials.matrix.row.4.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行4 造形方式 (ASA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "FDM",
  },
  {
    key: "materials.matrix.row.4.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行4 下地の勘所 (ASA)",
    kind: "multiline",
    maxLen: 50,
    defaultText:
      "ABSに近い扱い。屋外用途に向く素材で、クリアのUVカットと相性良好です。",
  },
  {
    key: "materials.matrix.row.4.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行4 耐候性 (ASA)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "UV安定",
  },
  {
    key: "materials.matrix.row.5.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行5 素材名 (標準レジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "標準レジン",
  },
  {
    key: "materials.matrix.row.5.sub",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行5 補足 (標準レジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "アクリル系",
  },
  {
    key: "materials.matrix.row.5.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行5 造形方式 (標準レジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "光造形",
  },
  {
    key: "materials.matrix.row.5.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行5 下地の勘所 (標準レジン)",
    kind: "multiline",
    maxLen: 65,
    defaultText:
      "IPA洗浄とUV二次硬化を前提に。滑らかで下地は軽く、意匠塗装が映えます。黄変対策のクリアを推奨。",
  },
  {
    key: "materials.matrix.row.5.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行5 耐候性 (標準レジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "屋内向き",
  },
  {
    key: "materials.matrix.row.6.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行6 素材名 (タフレジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "タフレジン",
  },
  {
    key: "materials.matrix.row.6.sub",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行6 補足 (タフレジン)",
    kind: "text",
    maxLen: 15,
    defaultText:
      "ABSライク",
  },
  {
    key: "materials.matrix.row.6.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行6 造形方式 (タフレジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "光造形",
  },
  {
    key: "materials.matrix.row.6.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行6 下地の勘所 (タフレジン)",
    kind: "multiline",
    maxLen: 45,
    defaultText:
      "靭性が高く、割れにくい。標準レジン同様の下地で、扱いやすい素材です。",
  },
  {
    key: "materials.matrix.row.6.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行6 耐候性 (タフレジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "屋内向き",
  },
  {
    key: "materials.matrix.row.7.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行7 素材名 (クリアレジン)",
    kind: "text",
    maxLen: 15,
    defaultText:
      "クリアレジン",
  },
  {
    key: "materials.matrix.row.7.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行7 造形方式 (クリアレジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "光造形",
  },
  {
    key: "materials.matrix.row.7.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行7 下地の勘所 (クリアレジン)",
    kind: "multiline",
    maxLen: 45,
    defaultText:
      "段階研磨とクリアコートで透明感を出せます。透過部を活かした意匠にも対応。",
  },
  {
    key: "materials.matrix.row.7.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行7 耐候性 (クリアレジン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "屋内向き",
  },
  {
    key: "materials.matrix.row.8.name",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行8 素材名 (ナイロン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "ナイロン",
  },
  {
    key: "materials.matrix.row.8.sub",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行8 補足 (ナイロン)",
    kind: "text",
    maxLen: 20,
    defaultText:
      "PA12 / PA11",
  },
  {
    key: "materials.matrix.row.8.method",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行8 造形方式 (ナイロン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "SLS",
  },
  {
    key: "materials.matrix.row.8.point",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行8 下地の勘所 (ナイロン)",
    kind: "multiline",
    maxLen: 50,
    defaultText:
      "多孔質のため下地を作り込む。ブラスト後の均一な面に艶を重ねます。要テスト。",
  },
  {
    key: "materials.matrix.row.8.weather",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATRIX行8 耐候性 (ナイロン)",
    kind: "text",
    maxLen: 10,
    defaultText:
      "UV安定",
  },
  {
    key: "materials.matrix.note",
    page: "materials",
    route: "/materials",
    label: "素材対応 / MATERIAL MATRIX 注記 (MapNote内埋め込みのため text kind)",
    kind: "text",
    maxLen: 140,
    defaultText:
      "※ 耐候性は一般的な目安です。標準レジンは紫外線で黄変・脆化が進むため、屋外長期使用には向きません。撮影・展示・商談用の高品質仕上げとしての運用を前提にしています。屋外で長く使う想定がある場合は、素材段階からご相談ください。",
  },
  {
    key: "materials.why.sec.label",
    page: "materials",
    route: "/materials",
    label: "素材対応 / SEC.03 セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "WHY IT MATTERS",
  },
  {
    key: "materials.why.lead",
    page: "materials",
    route: "/materials",
    label: "素材対応 / WHY IT MATTERS リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 85,
    defaultText:
      "塗料の食いつき不良やムラは、塗装技術以前の「素地の準備」で起きることがほとんどです。だから、この工房は塗る前の工程に最も神経を使います。",
  },
  {
    key: "materials.cause.1.no",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE01 番号",
    kind: "text",
    maxLen: 15,
    defaultText:
      "CAUSE 01",
  },
  {
    key: "materials.cause.1.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE01 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "洗浄・脱脂の不足",
  },
  {
    key: "materials.cause.1.body",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE01 本文",
    kind: "multiline",
    maxLen: 130,
    defaultText:
      "造形物に残った離型剤・削りカス・指の脂は、塗料の密着を著しく下げます。研磨後に水洗いし、イソプロピルアルコールで脱脂、タッククロスで微粉を除いてから塗装に入ります。光造形品は未硬化レジンの洗浄も欠かせません。",
  },
  {
    key: "materials.cause.2.no",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE02 番号",
    kind: "text",
    maxLen: 15,
    defaultText:
      "CAUSE 02",
  },
  {
    key: "materials.cause.2.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE02 見出し",
    kind: "text",
    maxLen: 15,
    defaultText:
      "サーフェイサーの省略",
  },
  {
    key: "materials.cause.2.body",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE02 本文",
    kind: "multiline",
    maxLen: 120,
    defaultText:
      "下地のサーフェイサー（プラサフ）を省くと、密着も発色も落ちます。厚膜タイプで微細な段差を埋め、塗料が乗る土台をつくる——この一手間を飛ばさないことが、量産品のような均一な面につながります。",
  },
  {
    key: "materials.cause.3.no",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE03 番号",
    kind: "text",
    maxLen: 15,
    defaultText:
      "CAUSE 03",
  },
  {
    key: "materials.cause.3.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE03 見出し",
    kind: "text",
    maxLen: 20,
    defaultText:
      "厚塗りによる細部の潰れ",
  },
  {
    key: "materials.cause.3.body",
    page: "materials",
    route: "/materials",
    label: "素材対応 / CAUSE03 本文",
    kind: "multiline",
    maxLen: 110,
    defaultText:
      "一度に厚く吹くと、タレ・ゆず肌が出て、細かな造形ディテールも埋まります。塗る方向を層ごとに変えながら、薄く数回に分けて重ねる——地味ですが、これが仕上がりの質を決めます。",
  },
  {
    key: "materials.intake.sec.label",
    page: "materials",
    route: "/materials",
    label: "素材対応 / SEC.04 セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "DATA INTAKE",
  },
  {
    key: "materials.intake.lead",
    page: "materials",
    route: "/materials",
    label: "素材対応 / DATA INTAKE リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 95,
    defaultText:
      "完成した造形物を送っていただくのはもちろん、データ入稿 → 提携出力 → 工房直送の流れにも対応します。出力先と塗装先を別々に手配する手間を省けます。",
  },
  {
    key: "materials.intake.stl.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / STLボックス タイトル",
    kind: "text",
    maxLen: 10,
    defaultText:
      "STL",
  },
  {
    key: "materials.intake.stl.sub",
    page: "materials",
    route: "/materials",
    label: "素材対応 / STLボックス サブラベル",
    kind: "text",
    maxLen: 15,
    defaultText:
      "汎用フォーマット",
  },
  {
    key: "materials.intake.stl.body",
    page: "materials",
    route: "/materials",
    label: "素材対応 / STLボックス 本文",
    kind: "multiline",
    maxLen: 80,
    defaultText:
      "ほぼすべての3Dプリント環境で扱える標準形式。造形するだけなら、これで十分です。メッシュ（三角形の集合）でモデルを表現します。",
  },
  {
    key: "materials.intake.step.title",
    page: "materials",
    route: "/materials",
    label: "素材対応 / STEPボックス タイトル",
    kind: "text",
    maxLen: 10,
    defaultText:
      "STEP",
  },
  {
    key: "materials.intake.step.sub",
    page: "materials",
    route: "/materials",
    label: "素材対応 / STEPボックス サブラベル",
    kind: "text",
    maxLen: 15,
    defaultText:
      "精密フォーマット",
  },
  {
    key: "materials.intake.step.body",
    page: "materials",
    route: "/materials",
    label: "素材対応 / STEPボックス 本文",
    kind: "multiline",
    maxLen: 95,
    defaultText:
      "正確な形状を保持する形式（ISO 10303）。寸法精度が重要な場合や、任意の解像度で再メッシュしたい場合に向きます。精密案件ではこちらを推奨します。",
  },
  {
    key: "materials.intake.note",
    page: "materials",
    route: "/materials",
    label: "素材対応 / DATA INTAKE 注記 (MapNote内埋め込みのため text kind)",
    kind: "text",
    maxLen: 95,
    defaultText:
      "※ ご相談時に、造形方式・素材・希望色（カラーコード可）・希望納期をあわせてお知らせいただけると、概算が正確になります。未発表製品はNDA対応可。",
  },
  {
    key: "materials.gallery.sec.label",
    page: "materials",
    route: "/materials",
    label: "素材対応 / GALLERY セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText:
      "BEYOND MATERIAL",
  },
  {
    key: "materials.gallery.lead",
    page: "materials",
    route: "/materials",
    label: "素材対応 / GALLERY リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 35,
    defaultText:
      "素材ごとに手を変える。それが下地づくりの本質です。",
  },
  {
    key: "materials.gallery.1.photo.capja",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.03 日本語キャプション",
    kind: "text",
    maxLen: 10,
    defaultText:
      "質感",
  },
  {
    key: "materials.gallery.1.photo.capen",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.03 英語キャプション",
    kind: "text",
    maxLen: 15,
    defaultText:
      "TEXTURE",
  },
  {
    key: "materials.gallery.1.photo.credit",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.03 クレジット表記",
    kind: "text",
    maxLen: 40,
    defaultText:
      "Photo: apryan_cahyo / Unsplash",
  },
  {
    key: "materials.gallery.2.photo.capja",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.04 日本語キャプション",
    kind: "text",
    maxLen: 10,
    defaultText:
      "仕上がり",
  },
  {
    key: "materials.gallery.2.photo.capen",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.04 英語キャプション",
    kind: "text",
    maxLen: 15,
    defaultText:
      "THE FINISH",
  },
  {
    key: "materials.gallery.2.photo.credit",
    page: "materials",
    route: "/materials",
    label: "素材対応 / FIG.04 クレジット表記",
    kind: "text",
    maxLen: 40,
    defaultText:
      "Photo: avenir_visuals / Unsplash",
  },
];
