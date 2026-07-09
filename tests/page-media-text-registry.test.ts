import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EDITABLE_ROUTES, SLOT_REGISTRY } from "@/modules/page-media/registry";
import {
  TEXT_REGISTRY,
  TEXT_REGISTRY_HASH,
  isValidTextSlotKey,
  normalizeLineEndings,
  resolveMaxLineLen,
  textSlotByKey,
  textSlotsForRoute,
  validateSlotText,
  type PageTextSlot,
} from "@/modules/page-media/text-registry";

/**
 * canonical: docs/design/visual-text-editor.md §2 (TEXT_REGISTRY) / §5.3 (lines 制約) /
 * §8 (単体テスト戦略)。入力資料: docs/design/text-slots/PLAN.md §3.2 (Tier A 確定表)。
 *
 * 「defaultText が page-body の現行文言と一致」の検証は、T1 時点では page-body が
 * まだ SlotText に変換されていない (T2a 領分) ため、変換前の現行 JSX から書き起こした
 * 「frozen fixture」(下記 FROZEN_DEFAULT_TEXT) との厳密一致で担保する。コーディネーター
 * 指示 (v1.1) のとおり、実装後の JSX から再抽出する自己一致テストにはしない
 * (それだと転記ミスを検出できない — テストが常に registry と同じ値を再計算してしまう)。
 */

// PLAN.md §3.2 の確定 75 件から、下記 1 件を除いた 74 件が T1 時点の確定 A。
// story.message.body は本文 3 段落目に <strong> インライン装飾を含むため
// (src/app/(site)/story/page-body.tsx を実測)、SlotText の dangerouslySetInnerHTML 禁止
// 制約と両立できず、PLAN.md §3.2 自身が用意した退避条項 (「あれば B へ戻す」) に従って
// 本レジストリには含めない (text-registry.ts 冒頭コメント参照)。
const EXPECTED_COUNT = 74;

const FROZEN_DEFAULT_TEXT: Readonly<Record<string, string>> = {
  "shared.cta.consult": "相談する",
  "chrome.footer.tagline":
    "3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。",

  "home.statement.heading":
    "デザインモデルの品質は、\n表面処理で決まる。\nそれでも、表面処理を高い水準で\n内製できる会社は、多くない。\nその空白のために、この工房がある。",
  "home.craft.heading": "3つの技術を、ひとりで持つ。",
  "home.craft.card.1.title": "積層痕を消す研磨",
  "home.craft.card.2.title": "自動車グレードの艶",
  "home.craft.card.3.title": "3コートパールの意匠",
  "home.colorlineup.heading": "名車の象徴色で組んだ、\n8枚の技術証明。",
  "home.twoscenes.heading": "一点の勝負にも、千個の生産にも。",
  "home.twoscenes.scene.1.title": "プレミアムデザインモデルの一点仕上げ",
  "home.twoscenes.scene.2.title": "金型を作らない少量生産の外観仕上げ",
  "home.stats.heading": "工房の能力を、\n数字で。",
  "home.materials.heading": "FDMも、光造形も、SLSも。\n素材ごとに、手を変える。",
  "home.notes.heading": "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
  "home.gallery.heading": "工房の、手の記録。",
  "home.cta.heading": "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
  "home.cta.note": "造形データや写真があれば、より正確に概算をお出しできます。",

  "story.hero.heading": "なぜ、積層痕と\n戦うことにしたのか。",
  "story.hero.lead":
    "家電の量産塗装で長年腕を磨いた職人が、どうして3Dプリントの表面処理という、まだ名前もない仕事に専念することにしたのか。一本の相談から始まった、下地をめぐる物語です。",
  "story.message.heading": "「見えなくなる仕事」に、\n誇りを持っています。",
  "story.cta.heading": "物語の続きは、\nあなたの造形物で。",
  "story.cta.note": "「絶対に外せない一個」を、量産品の顔に。まずはお気軽にご相談ください。",

  "about.hero.heading": "下地の仕事は、\n見えなくなるからこそ。",
  "about.hero.lead":
    "仕上がった塗面に、研ぎの跡は残りません。それでも、艶の深さも、色の正確さも、すべては見えなくなった下地が決めています。隈部塗装は、その見えない工程に最も時間を割く工房です。",
  "about.why.heading": "「表面処理だけ頼みたい」に、\n応える工房が少なかった。",
  "about.facility.heading": "バンパー6本を、同時に塗れる。",
  "about.gallery.heading": "現場の、手ざわり。",
  "about.cta.heading": "工程と料金の詳細は、\nサービスページに。",
  "about.cta.note": "下地は全グレード共通。差分はトップコートの層数だけです。",

  "service.hero.heading": "下地は全グレード共通。\nだから品質が揺れない。",
  "service.hero.lead":
    "自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。",
  "service.process.aside.heading": "なぜ鏡面磨きをしないのか",
  "service.terms.heading": "正直に、先にお伝えします。",
  "service.qc.heading": "発送前に、8つの目で見る。",
  "service.gallery.heading": "工程の、その手。",
  "service.cta.heading": "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
  "service.cta.note": "造形データや写真があれば、より正確に概算をお出しできます。",

  "process.hero.heading": "一個が仕上がるまでの、\n9つの手。",
  "process.hero.lead":
    "3Dプリントの造形物が、量産品と見分けがつかない外観になるまでには、決まった順序があります。派手なのは色を吹く瞬間だけ。その前後にある地味な工程こそが、仕上がりを決めます。自動車補修の手順を、一手ずつ開きます。",
  "process.coating.heading": "塗装は、\n層でできている。",
  "process.steps.heading": "受け取ってから、\n送り出すまで。",
  "process.booth.heading": "きれいな空気でしか、\nきれいには塗れない。",
  "process.related.heading": "工程の、その先へ。",
  "process.gallery.heading": "工程を、支えるもの。",
  "process.cta.heading": "この9工程を、\nあなたの一個に。",
  "process.cta.note": "サイズ・個数・グレードが分かれば、概算をお出しできます。まずはご相談ください。",

  "materials.hero.heading": "素材を選ばない。\nただし、素材ごとに手を変える。",
  "materials.hero.lead":
    "3Dプリントは、造形方式によって積層痕の出方も、塗料の乗り方も、まったく違います。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む——同じ「下地」でも、素材ごとに手を変えます。ここでは対応方式と、素材別の考え方をまとめます。",
  "materials.methods.heading": "3つの造形方式、\nそれぞれの下地。",
  "materials.matrix.heading": "素材別の、対応と勘所。",
  "materials.why.heading": "失敗の多くは、\n塗る前に決まっている。",
  "materials.intake.heading": "造形から、任せてもいい。",
  "materials.gallery.heading": "素材の、その先。",
  "materials.cta.heading": "素材が決まっていなくても、\n用途から相談できます。",
  "materials.cta.note": "「屋外で使う」「撮影用」「触れる展示物」——用途に合う素材と仕上げをご提案します。",

  "colors.hero.heading": "名車の象徴色で組んだ、\n8枚の技術証明。",
  "colors.hero.lead":
    "見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。実物の色見本パネル（対辺70mmの六角形・裏面カラーコード刻印）は、郵送でお貸し出しできるよう準備中です。",
  "colors.cta.heading": "この8色以外も、\n色番号でご指定いただけます。",
  "colors.cta.note": "日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。",

  "shop.hero.heading": "仕上げを、\n通販のように買う。",
  "shop.hero.lead":
    "受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのまま注文のご相談へ。オンライン決済は現在準備中のため、いまは「注文の意思表示 → 相談 → 正式見積もり → お支払い」の流れでお受けしています。手のひらの造形物を送るだけで、量産品の顔になって還ってきます。",
  "shop.grades.heading": "3つのグレードから、\n選ぶ。",
  "shop.simulator.heading": "サイズ × 個数 × グレード。\n3つ選べば、概算が出る。",
  "shop.simulator.cta": "この内容で注文・相談する",
  "shop.products.heading": "手に取れる製品も、\nここに並びます。",
  "shop.flow.heading": "注文から、お届けまで。",
  "shop.cta.heading": "概算が出たら、\nあとは送るだけ。",
  "shop.cta.note": "シミュレータの内容をコピーして、そのまま貼り付けてご相談ください。",

  "notes.hero.heading": "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
  "notes.hero.lead": "工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。",
  "notes.cta.heading": "読んで気になったことは、\nそのまま聞いてください。",
  "notes.cta.note": "工程・色・素材の相性、どんな質問でも。",

  "contact.hero.heading": "見積もりは、\n3つの数字で。",
  "contact.hero.lead":
    "「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけシンプルです。造形データや写真、素材の種類がわかると、より正確になります。",
};

describe("TEXT_REGISTRY", () => {
  it(`実測 ${EXPECTED_COUNT} 件 (PLAN.md 記載の 75 件から story.message.body を除外)`, () => {
    expect(TEXT_REGISTRY.length).toBe(EXPECTED_COUNT);
  });

  it("slot_key は一意である", () => {
    const keys = TEXT_REGISTRY.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("route はすべて非空文字列で、page-media EDITABLE_ROUTES の部分集合である", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(slot.route.length).toBeGreaterThan(0);
      expect(EDITABLE_ROUTES).toContain(slot.route);
    }
  });

  it("affectedRoutes を持つスロットは、その全ルートも EDITABLE_ROUTES に含まれる", () => {
    for (const slot of TEXT_REGISTRY) {
      for (const route of slot.affectedRoutes ?? []) {
        expect(EDITABLE_ROUTES).toContain(route);
      }
    }
  });

  it("kind は text | lines | multiline のいずれかである", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(["text", "lines", "multiline"]).toContain(slot.kind);
    }
  });

  it("maxLen は正の整数である", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(Number.isInteger(slot.maxLen)).toBe(true);
      expect(slot.maxLen).toBeGreaterThan(0);
    }
  });

  it("kind=lines のスロットは maxLines が必須設定されている (v1.1)", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "lines")) {
      expect(slot.maxLines, `${slot.key} に maxLines が未設定です`).toBeDefined();
      expect(slot.maxLines).toBeGreaterThan(0);
    }
  });

  it("kind=text のスロットは maxLines を持たない (単一行のため無関係)", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "text")) {
      expect(slot.maxLines).toBeUndefined();
    }
  });

  it("defaultText は自身の maxLen 以下である", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(slot.defaultText.length, `${slot.key} が maxLen を超過`).toBeLessThanOrEqual(
        slot.maxLen,
      );
    }
  });

  it("kind=text の defaultText は改行を含まない", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "text")) {
      expect(slot.defaultText.includes("\n")).toBe(false);
    }
  });

  it("defaultText は trim 後も非空である (v1.3: 空文字列拒否ルールとの整合)", () => {
    for (const slot of TEXT_REGISTRY) {
      expect(slot.defaultText.trim().length, `${slot.key} の defaultText が空`).toBeGreaterThan(0);
    }
  });

  it("kind=lines の defaultText は maxLines 行以内・各行が resolveMaxLineLen 以内である", () => {
    for (const slot of TEXT_REGISTRY.filter((s) => s.kind === "lines")) {
      const lines = slot.defaultText.split("\n");
      expect(lines.length, `${slot.key} の行数超過`).toBeLessThanOrEqual(slot.maxLines!);
      const maxLineLen = resolveMaxLineLen(slot);
      if (maxLineLen !== undefined) {
        for (const line of lines) {
          expect(line.length, `${slot.key} の行長超過: "${line}"`).toBeLessThanOrEqual(maxLineLen);
        }
      }
    }
  });

  it("home.statement.heading は 5 行・1 行 18 字までの特例 (§5.3)", () => {
    const slot = textSlotByKey("home.statement.heading")!;
    expect(slot.maxLines).toBe(5);
    expect(resolveMaxLineLen(slot)).toBe(18);
    expect(slot.defaultText.split("\n").length).toBe(5);
  });

  it("shared.cta.consult / chrome.footer.tagline は affectsAllRoutes=true", () => {
    expect(textSlotByKey("shared.cta.consult")?.affectsAllRoutes).toBe(true);
    expect(textSlotByKey("chrome.footer.tagline")?.affectsAllRoutes).toBe(true);
  });

  it("notes.cta.* は /notes と notes/[slug] を affectedRoutes に持つ (一覧・詳細で共有)", () => {
    for (const key of ["notes.cta.heading", "notes.cta.note"]) {
      const slot = textSlotByKey(key)!;
      expect(slot.affectedRoutes).toEqual(["/notes", "notes/[slug]"]);
    }
  });

  it("フローズンフィクスチャと defaultText が完全一致する (転記ミス検出、frozen fixture 方式)", () => {
    const registryKeys = new Set(TEXT_REGISTRY.map((s) => s.key));
    const fixtureKeys = new Set(Object.keys(FROZEN_DEFAULT_TEXT));
    // 双方向: フィクスチャにあって registry に無い/その逆を両方検出する
    expect(fixtureKeys).toEqual(registryKeys);

    for (const slot of TEXT_REGISTRY) {
      expect(slot.defaultText, `${slot.key} の defaultText がフィクスチャと不一致`).toBe(
        FROZEN_DEFAULT_TEXT[slot.key],
      );
    }
  });

  it("page_media SLOT_REGISTRY (画像) との key 交差はゼロである (PLAN.md §1.4)", () => {
    const imageKeys = new Set(SLOT_REGISTRY.map((s) => s.key));
    const textKeys = TEXT_REGISTRY.map((s) => s.key);
    const overlap = textKeys.filter((k) => imageKeys.has(k));
    expect(overlap).toEqual([]);
  });
});

describe("isValidTextSlotKey / textSlotByKey / textSlotsForRoute", () => {
  it("isValidTextSlotKey: registry に存在するキーのみ true", () => {
    expect(isValidTextSlotKey("home.statement.heading")).toBe(true);
    expect(isValidTextSlotKey("home.nonexistent")).toBe(false);
  });

  it("textSlotByKey: 存在しないキーは undefined", () => {
    expect(textSlotByKey("home.statement.heading")?.key).toBe("home.statement.heading");
    expect(textSlotByKey("home.nonexistent")).toBeUndefined();
  });

  it("textSlotsForRoute: 指定した route のスロットのみ返す", () => {
    const homeSlots = textSlotsForRoute("/");
    expect(homeSlots.length).toBeGreaterThan(0);
    expect(homeSlots.every((s) => s.route === "/")).toBe(true);

    const shopSlots = textSlotsForRoute("/shop");
    expect(shopSlots.map((s) => s.key)).toContain("shop.simulator.cta");
  });

  it("textSlotsForRoute: 未知の route は空配列", () => {
    expect(textSlotsForRoute("/nonexistent")).toEqual([]);
  });
});

describe("TEXT_REGISTRY_HASH", () => {
  it("TEXT_REGISTRY の JSON 内容を sha1 したものと一致する (build 時計算の再現性)", () => {
    const recomputed = createHash("sha1").update(JSON.stringify(TEXT_REGISTRY)).digest("hex");
    expect(TEXT_REGISTRY_HASH).toBe(recomputed);
  });

  it("registry の内容が変われば、2 つの入力に対するハッシュは異なる", () => {
    const a = createHash("sha1").update(JSON.stringify(TEXT_REGISTRY)).digest("hex");
    const mutated = TEXT_REGISTRY.map((s, i) =>
      i === 0 ? { ...s, label: `${s.label} (mutated for test)` } : s,
    );
    const b = createHash("sha1").update(JSON.stringify(mutated)).digest("hex");
    expect(a).not.toBe(b);
  });
});

describe("resolveMaxLineLen", () => {
  it("maxLineLen が明示されていればそれを返す", () => {
    const slot: PageTextSlot = {
      key: "test.a",
      page: "test",
      route: "/",
      label: "test",
      kind: "lines",
      maxLen: 100,
      defaultText: "a\nb",
      maxLines: 2,
      maxLineLen: 30,
    };
    expect(resolveMaxLineLen(slot)).toBe(30);
  });

  it("maxLineLen 未指定なら Math.floor(maxLen / maxLines) を返す", () => {
    const slot: PageTextSlot = {
      key: "test.b",
      page: "test",
      route: "/",
      label: "test",
      kind: "lines",
      maxLen: 45,
      defaultText: "a\nb",
      maxLines: 2,
    };
    expect(resolveMaxLineLen(slot)).toBe(22);
  });

  it("maxLines も maxLineLen も未指定なら undefined (1 行制約なし)", () => {
    const slot: PageTextSlot = {
      key: "test.c",
      page: "test",
      route: "/",
      label: "test",
      kind: "text",
      maxLen: 20,
      defaultText: "a",
    };
    expect(resolveMaxLineLen(slot)).toBeUndefined();
  });
});

describe("validateSlotText", () => {
  const linesSlot: PageTextSlot = {
    key: "test.lines",
    page: "test",
    route: "/",
    label: "test",
    kind: "lines",
    maxLen: 20,
    defaultText: "aa\nbb",
    maxLines: 2,
    maxLineLen: 8,
  };
  const textSlot: PageTextSlot = {
    key: "test.text",
    page: "test",
    route: "/",
    label: "test",
    kind: "text",
    maxLen: 10,
    defaultText: "hello",
  };
  const multilineSlotWithCap: PageTextSlot = {
    key: "test.multiline",
    page: "test",
    route: "/",
    label: "test",
    kind: "multiline",
    maxLen: 100,
    defaultText: "para1",
    maxLines: 2, // 段落数上限 (v1 の registry では未使用だが機能としては検証する)
  };

  it("maxLen 以内・kind 違反なしなら issues は空", () => {
    expect(validateSlotText(textSlot, "hi")).toEqual([]);
    expect(validateSlotText(linesSlot, "a\nb")).toEqual([]);
  });

  it("maxLen 超過を検出する", () => {
    expect(validateSlotText(textSlot, "12345678901")).not.toEqual([]);
  });

  it("kind=text で改行を含めると拒否する", () => {
    expect(validateSlotText(textSlot, "a\nb")).not.toEqual([]);
  });

  it("kind=lines で行数超過を検出する", () => {
    expect(validateSlotText(linesSlot, "a\nb\nc")).not.toEqual([]);
  });

  it("kind=lines で 1 行文字数超過 (maxLineLen) を検出する", () => {
    expect(validateSlotText(linesSlot, "123456789\nb")).not.toEqual([]);
  });

  it("kind=lines で境界値 (maxLineLen ちょうど) は許可する", () => {
    expect(validateSlotText(linesSlot, "12345678\nb")).toEqual([]);
  });

  it("kind=multiline で maxLines (段落数) が設定されていれば段落数超過を検出する", () => {
    expect(validateSlotText(multilineSlotWithCap, "p1\n\np2\n\np3")).not.toEqual([]);
    expect(validateSlotText(multilineSlotWithCap, "p1\n\np2")).toEqual([]);
  });

  // v1.3 tester 検証ギャップ対応 (MEDIUM): 空文字列 / 空白のみは拒否する
  it("空文字列は kind によらず拒否する", () => {
    expect(validateSlotText(textSlot, "")).not.toEqual([]);
    expect(validateSlotText(linesSlot, "")).not.toEqual([]);
    expect(validateSlotText(multilineSlotWithCap, "")).not.toEqual([]);
  });

  it("空白のみ (trim 後に空、半角/全角スペース) は拒否する", () => {
    expect(validateSlotText(textSlot, "   ")).not.toEqual([]);
    expect(validateSlotText(textSlot, "　　　")).not.toEqual([]); // 全角スペースのみ
  });

  it("前後に空白を含むが trim 後に非空なら許可する (下限チェックのみの観点)", () => {
    expect(validateSlotText(textSlot, "  hi  ")).toEqual([]);
  });
});

describe("normalizeLineEndings (v1.3 tester 検証ギャップ対応: CRLF 正規化)", () => {
  it("\\r\\n (CRLF) を \\n (LF) に統一する", () => {
    expect(normalizeLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("単独の \\r (CR、旧 Mac 改行) も \\n に統一する", () => {
    expect(normalizeLineEndings("a\rb\rc")).toBe("a\nb\nc");
  });

  it("既に \\n のみのテキストは変化しない", () => {
    expect(normalizeLineEndings("a\nb\nc")).toBe("a\nb\nc");
  });

  it("改行を含まないテキストは変化しない", () => {
    expect(normalizeLineEndings("hello")).toBe("hello");
  });

  it("CRLF と単独 CR が混在していてもすべて \\n に統一する", () => {
    expect(normalizeLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
