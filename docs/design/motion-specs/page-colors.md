# M4 実装仕様 — colors ページ固有モーション(班: page-colors)

対象: チルト+光沢追従 / 巨大透かし番号 01-08 + スクロールパララックス / dd-edge 刷毛下端 / ホバー浮上。
正典: `docs/design/motion-gap-report.md` §5 + `legacy/js/main.js:163-195` + `legacy/css/style.css:287-341, 1271-1309, 1519-1528`。

## 0. 前提(重要 — worktree 状態の変化)

- **V2a worktree (`agent-a24a69628487d5f3e`) は 2026-07-09 に main へマージ済みで、ディレクトリ自体が削除されている。** 本仕様のパスはすべてリポジトリ本体 `/Users/horidaisuke/projects/kumabe-tosou/` 基準(`src/app/(site)/colors/page-body.tsx` は main に存在確認済み・319 行)。実装時は新しいブランチ/worktree を切って作業すること。
- 公開ページの SSG 非退行: `colors/page.tsx`(Server Component)と `page-body.tsx`(サーバーツリー)は "use client" 化しない。追加するクライアントコードは null を返すドライバ 1 個のみ。
- CSS は `src/app/globals.css` **末尾**に `/* === motion: page-colors === */` 区切りで追記(他班とのマージ衝突回避。既存行 1〜378 は一切変更しない)。

### 0.1 班間契約(実装前に必ず確認)

| 相手班 | 契約 |
|---|---|
| hover-suite (B1) | sheen スライドの transform ルールは hover-suite 班所有。**本班は sheen の CSS を一切書かない**。契約: hover-suite の修正後セレクタに `.kt-dd:hover .kt-swatch-sheen { transform: translateX(18%); }` 相当(本班が付与する `.kt-dd` クラスをフックにする)を含めること。統合時に `grep -n "kt-swatch-sheen" src/app/globals.css` で確認 |
| signature (カーソル) | カーソル VIEW 連携はイベント委譲 + `closest('[data-cursor]')` 契約。本班は Drawdown ルートに **`data-cursor="view"`** を付与するのみ。signature 班のリングが `is-view`(62px / 赤 rgba(168,15,34,0.92) / VIEW ラベル、legacy main.js:148-160 + css:1408-1417)に切り替わる |
| scroll-driven (M3, G7) | 色板の塗り登場(swatch-paint、legacy css:1530-1539)は M3 班所有。本班が付与する **`.kt-dd-swatch`** クラスをフックとして使ってもらう(クラス名を M3 班へ伝達)。tilt=transform / paint=clip-path でプロパティ非競合 |

## 1. 変更・新規ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `src/components/motion/tilt-math.ts` | 新規 | チルト計算の純関数(テスト対象) |
| `src/components/motion/colors-tilt.tsx` | 新規 | "use client" ドライバ(null render) |
| `src/app/(site)/colors/page-body.tsx` | 変更 | Drawdown 骨格変更 / ColorEntry・Section クラス追加 / ドライバ mount |
| `src/app/globals.css` | 変更 | 末尾に page-colors セクション追記 |
| `tests/colors-tilt-math.test.ts` | 新規 | vitest (node env) 単体テスト |

## 2. 新規コンポーネント

### 2.1 `src/components/motion/tilt-math.ts`(全文・貼り付け可)

```ts
/**
 * チルト+光沢追従の純関数部 (legacy/js/main.js:172-183 の計算部)。
 * px/py はカード内の正規化座標 (0..1)。
 * 正典 (docs/design/motion-gap-report.md §5):
 *   rx = (0.5 - py) * 6 [deg] — 上下 / ry = (px - 0.5) * 7 [deg] — 左右
 *   gx = px * 100 [%] / gy = py * 100 [%]
 */
export interface TiltValues {
  rxDeg: string;
  ryDeg: string;
  gx: string;
  gy: string;
}

export function computeTilt(px: number, py: number): TiltValues {
  return {
    rxDeg: ((0.5 - py) * 6).toFixed(2) + "deg",
    ryDeg: ((px - 0.5) * 7).toFixed(2) + "deg",
    gx: (px * 100).toFixed(1) + "%",
    gy: (py * 100).toFixed(1) + "%",
  };
}

/** mouseleave 時のリセット値 (legacy main.js:187-191) */
export const TILT_RESET = {
  rxDeg: "0deg",
  ryDeg: "0deg",
  gx: "30%",
  gy: "22%",
} as const;
```

### 2.2 `src/components/motion/colors-tilt.tsx`(全文・貼り付け可)

```tsx
"use client";

import { useEffect } from "react";

import { TILT_RESET, computeTilt } from "./tilt-math";

/**
 * colors ページ: ドローダウンのチルト+光沢追従ドライバ。
 * legacy/js/main.js:163-195 の移植。DOM 契約:
 *   - カード: [data-tilt] (globals.css の .kt-dd と同一要素)
 *   - グレア: カード内の [data-tilt-glare] (.kt-dd-glare)
 * pointer:fine かつ prefers-reduced-motion: no-preference のときだけ動く
 * (legacy main.js:164 の `fine && noMotionPref` ガード相当)。
 * render は null — Server Component ツリーを汚さない。
 */
export function ColorsTilt() {
  useEffect(() => {
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tilt]"),
    );
    const cleanups: Array<() => void> = [];

    cards.forEach((card) => {
      const glare = card.querySelector<HTMLElement>("[data-tilt-glare]");
      let rect: DOMRect | null = null;

      const onEnter = () => {
        rect = card.getBoundingClientRect();
        // 追従中は transform の transition を切る (.kt-dd.is-tilting)
        card.classList.add("is-tilting");
      };
      const onMove = (e: MouseEvent) => {
        if (!rect) rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width; /* 0..1 */
        const py = (e.clientY - rect.top) / rect.height; /* 0..1 */
        const v = computeTilt(px, py);
        card.style.setProperty("--rx", v.rxDeg);
        card.style.setProperty("--ry", v.ryDeg);
        if (glare) {
          glare.style.setProperty("--gx", v.gx);
          glare.style.setProperty("--gy", v.gy);
        }
      };
      const onLeave = () => {
        rect = null;
        // 先に is-tilting を外して transition を復活させてから 0 に戻す
        // → 0.45s var(--ease) でスムーズ復帰 (正典 §5「チルト reset 0.45s」)
        card.classList.remove("is-tilting");
        card.style.setProperty("--rx", TILT_RESET.rxDeg);
        card.style.setProperty("--ry", TILT_RESET.ryDeg);
        if (glare) {
          glare.style.setProperty("--gx", TILT_RESET.gx);
          glare.style.setProperty("--gy", TILT_RESET.gy);
        }
      };

      card.addEventListener("mouseenter", onEnter);
      card.addEventListener("mousemove", onMove, { passive: true });
      card.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        card.removeEventListener("mouseenter", onEnter);
        card.removeEventListener("mousemove", onMove);
        card.removeEventListener("mouseleave", onLeave);
        card.classList.remove("is-tilting");
        card.style.removeProperty("--rx");
        card.style.removeProperty("--ry");
        if (glare) {
          glare.style.removeProperty("--gx");
          glare.style.removeProperty("--gy");
        }
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
```

**設計判断(reset 0.45s)**: 旧実装は media query 内で `transition: box-shadow 0.45s` に上書きされるため実際は瞬時スナップバックだが(css:1300 が css:292 を上書き)、report §5 正典表の「reset 0.45s」を正とし、`is-tilting` クラス切替で「追従中=直接代入 / 離脱時=0.45s イーズ復帰」を実現する。パラメータ値は正典どおり。

## 3. `src/app/(site)/colors/page-body.tsx` の変更

### 3.1 import 追加(先頭の import 群に)

```tsx
import { ColorsTilt } from "@/components/motion/colors-tilt";
```

### 3.2 Drawdown 関数の全置換(現行 126-168 行 → 以下)

```tsx
function Drawdown({
  a,
  b,
  pearl,
  ddNo,
  ddName,
}: {
  a: string;
  b: string;
  pearl: boolean;
  ddNo: string;
  ddName: string;
}) {
  return (
    <div
      className="kt-dd border border-hair bg-paper p-2"
      data-tilt=""
      data-cursor="view"
    >
      <div
        className="kt-dd-swatch relative aspect-[4/3] w-full overflow-hidden"
        style={{ background: `linear-gradient(168deg, ${a}, ${b})` }}
        aria-hidden="true"
      >
        {/* 光沢追従グレア (legacy css:1304-1308 の radial-gradient 層を別レイヤ化) */}
        <span className="kt-dd-glare pointer-events-none" data-tilt-glare="" />
        {/* 塗料のムラ・粒子 (legacy .dd-swatch::before) */}
        <span className="kt-swatch-noise pointer-events-none" />
        {/* パール専用の虹彩 (legacy .dd-iris) */}
        {pearl ? <span className="kt-pearl-iris pointer-events-none" /> : null}
        {/* 光の面 (legacy .dd-swatch::after)。旧サイトの描画順 (::after は子要素より上、
            css:305-335) に合わせ iris より後に置く */}
        <span className="kt-swatch-sheen pointer-events-none" />
      </div>
      {/* 刷毛の終端 — 塗りの不規則な下端 (legacy .dd-edge css:337-341) */}
      <div
        className="kt-dd-edge w-full"
        style={{ background: `linear-gradient(168deg, ${a}, ${b})` }}
        aria-hidden="true"
      />
      <div className="flex items-baseline justify-between px-1 pb-1 pt-3">
        <span className="font-mono text-[9px] tracking-[0.16em] text-carbon-soft">
          {ddNo}
        </span>
        <span className="text-xs font-medium tracking-wider">{ddName}</span>
      </div>
    </div>
  );
}
```

変更点の要旨: (1) ルートに `kt-dd` + `data-tilt` + `data-cursor="view"`、(2) スウォッチに `kt-dd-swatch` クラス(M3 班フック兼用)、(3) グレア span を先頭に追加、(4) sheen span を最後尾へ移動(旧描画順の再現)、(5) 平坦バー `mt-1 h-2` + 90deg グラデを `kt-dd-edge` + **168deg** グラデ(legacy css:339)に置換。ラベル行は不変。

### 3.3 ColorEntry の className に 2 クラス追加(現行 175 行)

```tsx
      className="kt-color-entry relative grid scroll-mt-24 gap-8 border-t border-hair py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-14"
```

(`kt-color-entry` = counter + 透かし ::after のフック、`relative` = 透かしの absolute 基準。`id={sw.id}` / Reveal 構造は不変)

### 3.4 8 色を含む Section にカウンタリセット用クラス(現行 249 行)

```tsx
      <Section className="kt-color-entries">
```

(`Section` は `cn(..., className)` でマージするので素通しされる。間に挟まる FIG.01-03 の写真バンド div は `.kt-color-entry` でないためカウントされない → 01..08 が保たれる)

### 3.5 ドライバの mount(ColorsPageBody の return 直下、`<PageHead>` の前)

```tsx
      {/* チルト+光沢追従 (fine ポインタのみ)。/edit iframe ではホットスポット
          座標計測のノイズになるため editMode では載せない */}
      {editMode ? null : <ColorsTilt />}
```

## 4. `src/app/globals.css` 末尾への追記(全文・貼り付け可)

```css
/* === motion: page-colors === */
/* -------------------------------------------------------------
   M4 colors ページ固有モーション (班: page-colors)
   legacy 対応:
   - 巨大透かし番号 01-08 ........ legacy/css/style.css:1271-1294
   - 透かし番号パララックス ...... legacy/css/style.css:1519-1528
   - チルト+光沢追従 ............ legacy/js/main.js:163-195 + css:1296-1309
   - dd-edge 刷毛下端 ............ legacy/css/style.css:337-341
   - ホバー浮上 .................. legacy/css/style.css:287-297
   sheen スライド (legacy css:325) は hover-suite 班 B1 修正の所有。
   本班は .kt-dd フックを提供するのみで sheen の transform は書かない。
   ------------------------------------------------------------- */

/* ---------- 巨大透かし番号 01-08 (legacy css:1271-1294) ---------- */
.kt-color-entries {
  counter-reset: swatch;
}
.kt-color-entry {
  counter-increment: swatch;
}
.kt-color-entry::after {
  content: "0" counter(swatch);
  /* alt テキスト構文対応ブラウザではスクリーンリーダーから隠す
     (非対応ブラウザは前行の宣言にフォールバック — 2 段宣言を崩さないこと) */
  content: "0" counter(swatch) / "";
  position: absolute;
  top: clamp(24px, 4vw, 48px);
  right: 0;
  font-family: var(--font-wide);
  font-weight: 700;
  font-stretch: 125%;
  font-size: clamp(64px, 10vw, 150px);
  line-height: 1;
  letter-spacing: 0.02em;
  color: transparent;
  -webkit-text-stroke: 1px rgba(23, 25, 27, 0.13);
  pointer-events: none;
  user-select: none;
  z-index: 0;
}
/* 本文・色板を透かしより手前に (legacy css:1294) */
.kt-color-entry > * {
  position: relative;
  z-index: 1;
}

/* 透かし番号のスクロールパララックス (legacy css:1519-1528) */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .kt-color-entry::after {
      animation: kt-wm-parallax linear both;
      animation-timeline: view();
      animation-range: cover;
    }
  }
}
@keyframes kt-wm-parallax {
  from {
    transform: translateY(48px);
  }
  to {
    transform: translateY(-48px);
  }
}

/* ---------- dd-edge 刷毛の不規則下端 (legacy css:337-341) ---------- */
.kt-dd-edge {
  height: 14px;
  margin-top: -1px;
  clip-path: polygon(
    0 0, 100% 0, 100% 22%, 93% 78%, 86% 30%, 78% 88%, 70% 36%,
    61% 82%, 52% 28%, 43% 90%, 34% 40%, 25% 80%, 16% 30%, 8% 72%, 0 34%
  );
}

/* ---------- ドローダウン ホバー浮上 (legacy css:287-297) ---------- */
.kt-dd {
  transition:
    transform 0.45s var(--ease),
    box-shadow 0.45s var(--ease);
}
.kt-dd:hover {
  transform: translateY(-6px);
  box-shadow: 0 18px 40px -22px rgba(23, 25, 27, 0.35);
}

/* ---------- チルト+光沢追従 (main.js:163-195 / css:1296-1309) ---------- */
.kt-dd-glare {
  position: absolute;
  inset: 0;
}
@media (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .kt-dd {
    transform: perspective(950px) rotateX(var(--rx, 0deg))
      rotateY(var(--ry, 0deg));
    will-change: transform;
  }
  /* fine ポインタでは hover 浮上 translateY よりチルトが勝つ (legacy css:1303 相当。
     同一詳細度・後勝ちで上の .kt-dd:hover の transform を上書き) */
  .kt-dd:hover {
    transform: perspective(950px) rotateX(var(--rx, 0deg))
      rotateY(var(--ry, 0deg));
  }
  /* 追従中 (mouseenter〜mouseleave) は transform の transition を切って 1:1 直接代入。
     mouseleave で is-tilting が外れると .kt-dd の transition (0.45s var(--ease))
     で復帰 (正典 §5「チルト: 直接代入 / reset 0.45s」) */
  .kt-dd.is-tilting {
    transition: box-shadow 0.45s var(--ease);
  }
  /* 光沢グレア (legacy css:1304-1308 の radial-gradient 層。インライン style の
     linear-gradient を上書きできないため別レイヤとして合成 — 見た目は同一) */
  .kt-dd-glare {
    background: radial-gradient(
      260px circle at var(--gx, 30%) var(--gy, 22%),
      rgba(255, 255, 255, 0.38),
      rgba(255, 255, 255, 0) 62%
    );
  }
}

/* ---------- reduced-motion キルスイッチ (legacy css:1130-1136 方式) ---------- */
@media (prefers-reduced-motion: reduce) {
  .kt-color-entry::after {
    animation: none;
    transform: none;
  }
  .kt-dd,
  .kt-dd:hover {
    transform: none;
    transition: none;
  }
}
```

(チルト/グレアは pointer:fine + no-preference の media 内にしか存在しないため reduce/タッチでは自動停止。末尾ブロックは hover 浮上も止める保険)

## 5. 旧実装との対応表

| 新実装 | 旧実装 (行番号) | パラメータ (正典 §5) |
|---|---|---|
| `.kt-color-entries` / `.kt-color-entry(::after)` | css:1271-1294 | counter "0N"、clamp(64px,10vw,150px)、stroke 1px rgba(23,25,27,.13)、top clamp(24-48px)/right 0 |
| `@supports` + `kt-wm-parallax` | css:1519-1528 | translateY(48px→-48px)、timeline view()、range cover |
| `colors-tilt.tsx` + media 内 `.kt-dd` | main.js:163-195 + css:1296-1309 | rx=(0.5-py)*6deg / ry=(px-0.5)*7deg、perspective 950px、reset 0.45s、mouseenter で rect キャッシュ |
| `.kt-dd-glare` | css:1304-1308 (+ main.js:180-183, 189-191) | radial 260px circle at var(--gx,30%) var(--gy,22%)、white .38 → 0 62% |
| `.kt-dd-edge` | css:337-341 | height 14px、margin-top -1px、15 頂点 polygon、168deg グラデ |
| `.kt-dd` / `.kt-dd:hover` | css:287-297 | transform/box-shadow 0.45s var(--ease)、translateY(-6px)、0 18px 40px -22px rgba(23,25,27,.35) |
| `data-cursor="view"` | main.js:148-160 + css:1412-1417 | signature 班実装(リング 62px/赤/VIEW ラベル)。本班は属性付与のみ |
| (書かない) sheen translateX(18%) 0.7s | css:315-325 | hover-suite 班 B1。契約セレクタ `.kt-dd:hover .kt-swatch-sheen` |

## 6. 受入条件

1. **ビルド/静的性**: `npm run build` 成功。ルート一覧で `/colors` が prerender(Static)のまま。"use client" 追加は `colors-tilt.tsx` のみで、`page.tsx` / `page-body.tsx` はサーバーのまま(request-time API なし)。
2. **テスト**: `npm test`(vitest)で既存全件 + 新規 `tests/colors-tilt-math.test.ts` PASS。`npm run lint` PASS。
3. **チルト+グレア**(Chrome デスクトップ実機): drawdown hover で左上にカーソル→ 카드 が rotateX(+3deg)/rotateY(-3.5deg) 方向に傾く(computed transform が matrix3d 非単位行列)。グレアの明部がカーソルに追従(inline `--gx`/`--gy` が更新される)。カード離脱後 約0.45s かけて滑らかに水平へ戻る(スナップしない)。hover 中に影 `0 18px 40px -22px` が出る。
4. **透かし番号**: 各 entry 右上に 01〜08 のアウトライン数字(FIG バンドはカウントに影響しない)。Chrome でスクロール時に数字が ±48px 逆行パララックス。Safari/Firefox 等 animation-timeline 非対応環境では静的表示でエラーなし。
5. **dd-edge**: 色板下端がギザギザの刷毛跡(平坦バー消滅)、色板と同系 168deg グラデ。
6. **ガード**: DevTools Rendering → `prefers-reduced-motion: reduce` でチルト/パララックス/浮上が全停止(静的表示・レイアウト崩れなし)。タッチエミュレーション(pointer coarse)でチルト・グレアなし、hover 浮上のみ CSS フォールバック。
7. **エディタ共存**: `/edit/colors` が正常描画。`editMode=true` では ColorsTilt 非マウント(drawdown を mousemove しても `--rx` が変化しない・`is-tilting` が付かない)。`data-editable-*` 属性と PhotoFigure スロット編集(V2b ホットスポット)に影響なし。`kmb:reveal-done` イベント経路(reveal.tsx)不変。
8. **回帰**: アンカージャンプ(`/colors#c-46v` 等、scroll-mt-24)従来どおり。Tab 順・フォーカス到達に変化なし(drawdown は非フォーカス要素のまま)。ラベル行(DRAWDOWN 0N / 8 表記)の見た目不変。
9. **統合(hover-suite マージ後)**: drawdown hover で光の面(sheen)が右へ 18% スライドする(0.7s)。もし動かなければ hover-suite のセレクタに `.kt-dd:hover .kt-swatch-sheen` が入っているか確認。

## 7. テスト方針

- **単体(vitest, 既存 node env / `tests/**/*.test.ts` include に適合)**: `tests/colors-tilt-math.test.ts` を新規作成。
  ```ts
  import { describe, expect, it } from "vitest";

  import { TILT_RESET, computeTilt } from "@/components/motion/tilt-math";

  describe("computeTilt (legacy main.js:172-183 正典)", () => {
    it("中心 (0.5, 0.5) は無回転・グレア中央", () => {
      expect(computeTilt(0.5, 0.5)).toEqual({
        rxDeg: "0.00deg",
        ryDeg: "0.00deg",
        gx: "50.0%",
        gy: "50.0%",
      });
    });
    it("左上 (0, 0) は rx=+3deg / ry=-3.5deg", () => {
      expect(computeTilt(0, 0)).toEqual({
        rxDeg: "3.00deg",
        ryDeg: "-3.50deg",
        gx: "0.0%",
        gy: "0.0%",
      });
    });
    it("右下 (1, 1) は rx=-3deg / ry=+3.5deg", () => {
      const v = computeTilt(1, 1);
      expect(v.rxDeg).toBe("-3.00deg");
      expect(v.ryDeg).toBe("3.50deg");
    });
    it("振れ幅は ±3deg / ±3.5deg (正典 6deg/7deg)", () => {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        expect(Math.abs(parseFloat(computeTilt(p, p).rxDeg))).toBeLessThanOrEqual(3);
        expect(Math.abs(parseFloat(computeTilt(p, p).ryDeg))).toBeLessThanOrEqual(3.5);
      }
    });
    it("リセット値は legacy mouseleave と同値", () => {
      expect(TILT_RESET).toEqual({
        rxDeg: "0deg",
        ryDeg: "0deg",
        gx: "30%",
        gy: "22%",
      });
    });
  });
  ```
  (DOM を伴うドライバ本体は jsdom 依存追加が必要になるため単体テスト対象外とし、計算部を純関数に分離してカバー。ドライバは下の実機 E2E で検証)
- **結合/E2E(実機、tester 班)**: `npm run dev` → Chrome/Playwright MCP で受入条件 3〜9 をチェックリスト実行。判定は (a) hover 中 `getComputedStyle(card).transform !== "none"` かつ matrix3d、(b) mouseleave 500ms 後に回転成分ほぼ 0、(c) `card.style.getPropertyValue("--rx")` の更新、(d) reduce/touch エミュレーションで (a) 不成立、を機械判定。透かし番号とdd-edge はスクリーンショットで legacy(`legacy/colors.html` をローカルで開く)と目視比較。
- **回帰**: `npm test` 全件 + `npm run build`。/edit ルートは `tests/edit-page-map.test.ts` が既存カバー(構造変更なしのため PASS 維持を確認)。
- **2 回連続 PASS ルール**: 修正が入った場合は単体+結合を通し直し、2 回連続グリーンで完了。


---

## リスク (班申告)
- V2a worktree (agent-a24a69628487d5f3e) は main にマージ済みで削除されている — 本仕様のパスは main 基準。実装時は新規ブランチ/worktree を切り、他班 (hover-suite/signature/scroll) と同一ベースか確認すること
- hover-suite 班 B1 のセレクタ契約不一致リスク: 修正後セレクタに `.kt-dd:hover .kt-swatch-sheen` が含まれないと colors の sheen スライドが死んだままになる。統合時に grep + 実機 hover で必ず確認 (受入条件 9)
- scroll-driven 班 (M3) の swatch-paint は `.kt-dd-swatch` をフックにする前提 — クラス名契約を M3 班へ伝達しないと二重フック or 未適用になる。tilt(transform) と paint(clip-path) はプロパティ非競合だが、will-change: transform との同時適用で合成レイヤが増えるため低スペック機で実測推奨
- --font-wide (Archivo) が next/font で未ロードのため、透かし番号は Helvetica Neue フォールバックで描画され font-stretch:125% が無効 — 旧サイトと字形が異なる (extras 1 で解消可能)
- 透かし番号の content alt 構文 (`"0" counter(swatch) / ""`) は 2 段宣言フォールバック必須 — 単一宣言にまとめると非対応ブラウザで透かしが消える
- animation-timeline: view() 非対応ブラウザ (Firefox 既定設定など) ではパララックスが静的フォールバック — 意図どおりだが QA で「動かない」誤報告に注意
- counter は `.kt-color-entries` 単位でリセット — 将来 8 色を複数 Section に分割すると番号が通しにならない (現在は単一 Section なので問題なし)
- ドライバは React 管理外の style/class をカード DOM に直接書く — 将来 `.kt-dd` の div に React の style prop を追加すると衝突する (現状 style prop なしで安全)。cleanup で全プロパティ除去済み

## EXTRA 提案 (原案)
- [EXTRA-1] Archivo 可変フォント導入で透かし番号を旧デザイン意図どおりに: next/font/google の Archivo (axes: ["wdth"], subsets: ["latin"]) を --font-archivo として注入し --font-wide を差し替え → font-stretch:125% が生きて legacy css:1282-1284 の「ワイドな図面数字」が復元される。使用グリフは数字 0-8 のみなので、手動 @font-face + unicode-range (U+0030-0038) でサブセット化すれば転送 ~5KB に抑制可。コスト: 実装 0.5h + フォント最適化 0.5h。全ページの --font-wide 参照 (home 設計図等) にも波及するため signature 班と共有推奨
- [EXTRA-2] 塗料の粘性イージング (paint viscosity): チルト復帰 (mouseleave) の timing-function を CSS `linear()` 関数による粘性カーブ (例: linear(0, 0.55 14%, 0.82 34%, 0.94 58%, 0.99 80%, 1)) に変更し、「濡れた塗膜が糸を引いてから水平に戻る」手触りを再現。duration 0.45s は正典維持・カーブのみ変更 (正典逸脱のため EXTRA 扱い)。追加依存ゼロ、`.kt-dd` の transition 1 行差し替えのみ、reduce ガード内。コスト: 0.5h (カーブ調整の目視込み)
- [EXTRA-3] グレアの色温度をスウォッチ固有色に連動: 白色ハイライト rgba(255,255,255,.38) を `color-mix(in oklab, #fff 78%, var(--a))` にして「塗膜に映る光がその塗料の色を帯びる」現象を再現 (ソウルレッドなら暖色の照り、ベイサイドブルーなら冷たい照り)。パール 3 コートは既存 kt-pearl-iris と重なり真珠光沢が増す。Drawdown に `style={{ "--dd-a": a }}` を 1 個追加 + CSS 1 行変更。コスト: 1h (8 色の目視回帰込み)
- [EXTRA-4] 透かし番号の hover 滲み: `.kt-color-entry:hover::after` で -webkit-text-stroke を rgba(168,15,34,0.28) に 0.45s var(--ease) で遷移させ、「色見本帳の章番号に指を置いた」フィードバックを付与。process 班の巨大工程番号 hover (legacy css:2314-2327 の赤変化) と意匠統一になる。コスト: 0.3h

## 対象ファイル
src/app/(site)/colors/page-body.tsx, src/app/globals.css, src/components/motion/tilt-math.ts, src/components/motion/colors-tilt.tsx, tests/colors-tilt-math.test.ts
