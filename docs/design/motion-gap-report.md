# 旧サイト vs 現行 Next.js 版 — 動き・装飾ギャップ調査レポート

- 作成: 2026-07-09(Sonnet 5 researcher 4 体並列調査 → Fable 5 統合)
- 調査方法: `legacy/`(旧 GitHub Pages 版ソース、main.js 546 行 + style.css 3,490 行 + 全 11 HTML)と現行 `src/` の**全量コード突合**。推測なし、全項目にファイル:行の根拠あり
- きっかけ: 堀さんの指摘「https://daisukehori.github.io/kumabe-tosou/ の方が全然動きあるよね?」→ **指摘は正しい**

## 0. 結論

旧サイトは **36 種の動きメカニズム**(JS 駆動 11 + CSS 宣言的 25)を持つが、現行版に移植されたのは **17 種相当、しかも大半が簡略版**。体感差の主因は次の 5 つ:

1. **サイト全体の「署名」演出が全部ない**: カスタムカーソル / 塗りプログレスバー / セクションインジケータ / ページ遷移フェード(View Transitions)
2. **スクロール駆動アニメ 6 種が丸ごとない**(`animation-timeline: view()`): 罫線が左から引かれる / 見出しパララックス / 写真が下からせり上がる / 色板が塗られて登場 など。現行の Reveal(単純フェード)はこれらのフォールバック相当でしかない
3. **hover 演出の全滅・弱体化**: ボタンの刷毛ストローク塗り(全ページ頻出) / 写真の grayscale→カラー+ズーム(10 ページ) / footer 巨大文字の塗り込み / 地図のカラー化 / ドローダウン浮上
4. **colors ページの中核体験(チルト+光沢追従、巨大透かし番号)が完全欠落**
5. **質感装飾の欠落**: 紙ノイズ / ヘッダー 8 色小口帯 / レジストレーションマーク / フッター目盛りティック

加えて現行版のバグ級問題を 3 件発見(§4)。

## 1. 共通基盤の欠落(1 回作れば全ページに効く)

| # | 欠落 | 旧実装 (根拠) | 現行 | 優先 |
|---|---|---|---|---|
| G1 | カスタムカーソル(ドット 1:1 追従 + リング lerp 0.18 追従、リンク hover 48px / drawdown hover 62px+VIEW ラベル) | main.js:101-160, css:1361-1419 | 無し | ★★★ |
| G2 | 塗りプログレスバー(ヘッダー下端、scaleX=scroll 比、rAF スロットル) | main.js:76-99, css:1224-1243 | 無し | ★★★ |
| G3 | セクションインジケータ(右端固定ドット、IO rootMargin -45%/-45%、sec-mark 2 個以上で自動生成) | main.js:267-336, css:1727-1774 | 無し | ★★★ |
| G4 | ナビ現在地ハイライト(is-current 赤下線)+ 下線スライド(scaleX 0→1、origin 左右反転 0.35s) | main.js:10-16, css:127-157,1330-1331 | hover 背景色のみ・現在地なし | ★★★ |
| G5 | ボタン刷毛ストローク hover(skewX(-14deg) 帯スライド 0.42s + 矢印 translateX(5px)) | css:254-283,1343-1359 | 色反転のみ | ★★★(頻出度最大) |
| G6 | View Transitions(旧 0.28s 退場 / 新 0.44s 入場、ヘッダー固定) | css:1187-1205 | 無し | ★★ |
| G7 | スクロール駆動 6 種(§2 参照) | css:1503-1550,1624-1636,2487-2500 | 無し | ★★★ |
| G8 | 写真 grayscale(0.9)→hover(0.1)+scale(1.04)(filter 0.7s / transform 1s 非対称) | css:2409-2424 | 常時カラー・ズーム無し | ★★★ |
| G9 | footer-giant「KUMABE TOSO」hover 塗り込み(background-clip:text 0→100% 1.1s) | css:1311-1318 | 静的透過文字 | ★★ |
| G10 | 紙ノイズ(body::before feTurbulence opacity 0.045) | css:1333-1341 | swatch 局所のみ | ★★ |
| G11 | 静的装飾 3 点: ヘッダー 8 色小口帯 / 罫線端の「+」レジマーク / フッター目盛りティック | css:1207-1222,1236-1256,1258-1269 | 無し | ★★ |
| G12 | ハンバーガー→X モーフィング(0.3s) | css:179-192 | 静止アイコン差し替え | ★ |
| G13 | scroll-behavior: smooth | (html 標準) | reduced-motion 側の auto だけ残存 = 死んだ防御コード | ★ |

## 2. スクロール駆動アニメーション 6 種(G7 の内訳)

すべて `@supports (animation-timeline: view())` ガード付き(非対応ブラウザは自然にフォールバック)。移植時も同じガードで安全に足せる。

| 名称 | 対象 | 動き | animation-range | 根拠 |
|---|---|---|---|---|
| 罫線描画 | .sec-mark .rule(7 ページ) | clip-path で左→右に線が伸びる | entry 0%–62% | css:1503-1517 |
| 見出しパララックス | .sec-title(7 ページ) | opacity 0.35→1 + translateY(26px→0) | entry 0%–55% | css:1541-1550 |
| 写真せり上がり | figure.photo img(10 ページ) | clip-path で下からせり上がる | entry 0%–45% | css:2487-2500 |
| 色板の塗り登場 | colors .dd-swatch | clip-path で下から上に塗られる | entry 6%–60% | css:1530-1539 |
| 透かし数字パララックス | colors .color-entry::after | translateY(48px→-48px) | cover 全区間 | css:1519-1528 |
| 数量バー伸長 | service .qty-fill | scaleX(0→1) | entry 10%–70% | css:1589,1624-1636 |

## 3. ページ固有の欠落

### home(index)
- ヒーロー見出しの **1 文字ずつ分割リビール**(span.char、0.72s、stagger 0.032s×文字通し番号、ロード時発火)— 現行は行単位に簡略化 (main.js:213-265, css:1429-1448)
- ヒーロー設計図グリッド + 寸法マーカー(.hero-grid/.hero-dim/.hero-cross)(index.html:45-51, css:1451-1501)
- **カラーストリップの横スクロール体験**: wheel 縦→横変換 + DRAG/SCROLL ヒント + scroll-timeline 進捗バー — 現行は静的 grid に置換 (index.html:163-210, main.js:197-210, css:1554-1587)

### colors(作り込みの象徴が全滅)
- **チルト+光沢追従**: mousemove で rotateX=(0.5-py)*6deg / rotateY=(px-0.5)*7deg + グレア位置 CSS 変数追従 (main.js:163-195, css:1296-1309)
- **巨大透かし番号 01-08**(CSS カウンタ、最大 150px アウトライン文字、右上)+ スクロールパララックス (css:1271-1294)
- dd-edge 刷毛の不規則下端(clip-path polygon)→ 現行は平坦バー (css:337-341)
- ホバー浮上(translateY(-6px) 0.45s)+ 光沢スライド(translateX(18%) 0.7s)(css:287-325)

### process
- **工程番号の巨大アウトライン数字**(clamp(40-62px)、-webkit-text-stroke、hover で赤塗り変化)— このページ最大のビジュアル。現行は小さいグレー数字 (css:2314-2327)

### story
- 章見出しの sticky 追従(top:100px、900px 未満解除)(css:2069,2135)
- ドロップキャップ(first-letter 3.6em)(css:2102-2111)/ 章区切り罫線 / quote 意匠縮小 / 代表メッセージの赤光暈 / portrait 斜めストライプ背景

### service
- qc-check の ✓ アイコン(赤枠)→ 現行グレー四角 (css:1911-1927)
- flow-cell 番号の赤 → グレー (css:831-838)
- qty-fill 斜め縞質感 + スクロール伸長 (css:1605-1636)

### about
- 地図 iframe grayscale→hover カラー化 (css:666-679)
- craftsman-block の比率(1.1fr/1fr)・下揃え・名前側 Reveal の欠落 (css:625-630, about.html:81)

### shop
- svc-photo grayscale→カラー+ズーム (css:2954-2961)
- featured カードの赤 radial-gradient (css:2978-2982)
- 製品カードの斜めストライプ+浮遊パネル+光沢 (css:3184-3210)
- MiniSwatch hover ポップ(translateY(-2px) scale(1.08))(css:3432)

### materials
- タイムラインの縦連結線 + 赤縁丸ノード (css:2021-2034)

### notes(構造変更を伴うため要判断)
- TOC アンカーナビ / 記事間写真バンド / article-no 2 段見出し / COMING SOON 告知(旧: 単一長文ページ、現行: 一覧+個別 — CMS 化は意図的なので**体験要素だけ再構成して移植**が現実的)

## 4. 現行版のバグ級発見(旧サイト比較の副産物)

| # | 内容 | 根拠 |
|---|---|---|
| B1 | **/colors の sheen hover が死んでいる疑い**: globals.css:354 のセレクタが `a:hover .kt-swatch-sheen` だが、colors の Drawdown は div ラップで a 祖先が無い(home 側は Link で有効) | colors/page.tsx:154-182 |
| B2 | **/works 一覧カードに Reveal が無い**(import 自体無し)、**/voices は証言カードに hover もリビールも無い**(サイト内で動き最少)— 新設 DB ページへの演出適用漏れ | works/page.tsx, voices/page.tsx:78-104 |
| B3 | scroll-behavior: smooth 未設定(reduced-motion 側の auto だけが残る) | globals.css:360 |

## 5. 移植パラメータ正典(旧サイトの手触り再現用)

共通イージング: `--ease: cubic-bezier(0.22, 1, 0.36, 1)`(旧 css:41。現行 globals.css:170 に同値が既にある)

| 動き | duration | delay/stagger | その他 |
|---|---|---|---|
| 文字分割リビール | 0.72s | 0.032s × 文字通し番号 | translateY(115%)→0、ロード時発火 |
| 行リビール | 1s | 0.12s/行 | translateY(110%)→0 (現行実装済み・一致) |
| 塗りマーカー | 0.7s | 0.75s(分割時 1.05s) | scaleX(0)→1 |
| カーソルリング | rAF 連続 | — | lerp 係数 0.18、状態 32/48/62px、0.3s |
| チルト | 直接代入 | — | rx=(0.5-py)*6deg, ry=(px-0.5)*7deg、reset 0.45s |
| プログレスバー | 直接代入 | — | scaleX(scrollY/(scrollHeight-innerHeight)) rAF |
| セクションインジケータ | 0.3s/0.5s | — | IO -45%/-45%、dot scale 1→1.25 |
| ナビ下線 | 0.35s | — | scaleX、origin hover=left/leave=right |
| 刷毛ストローク | 0.42s (.btn)/0.38s (.nav-cta) | — | translateX(-104%) skewX(-14deg)→-16px |
| 写真 hover | filter 0.7s / transform 1s | — | grayscale 0.9→0.1、scale 1→1.04 |
| footer 塗り | 1.1s | — | background-size 0→100% |
| FAQ 回答 | 0.5s | — | opacity + translateY(-6px→0) |
| View Transitions | out 0.28s / in 0.44s | — | translateY(±14/16px) |
| マーキー | 32s/34s linear | — | 実装済み・一致 |
| カウントアップ | 1100ms | — | easeOutCubic 自前 — 実装済み・一致 |
| Reveal | 0.85s | — | IO -8%/0.06 — 実装済み・一致 |
| reduced-motion | — | — | 全メカニズムに一括キルスイッチ必須(旧 css:1130-1136 方式) |

**注意(死んだ CSS)**: 旧 style.css の `.shop-grid` `.work-card` `.trust-grid` `.legal-table` `.sim-wrap` `.sim-slip` はどの HTML からも未参照の残骸。移植対象に数えないこと。

## 6. 実装ロードマップ案

| Wave | 内容 | 効果範囲 |
|---|---|---|
| M1 | 共通基盤 A: G1 カーソル + G2 プログレスバー + G3 インジケータ + G4 ナビ現在地/下線 | 全ページ即効 |
| M2 | 共通基盤 B: G5 刷毛ボタン + G8 写真 hover + G9 footer 塗り + G6 View Transitions + G13 smooth + B1-B3 バグ修正 | 全ページ即効 |
| M3 | G7 スクロール駆動 6 種 + G10-G12 質感装飾 | 全ページの奥行き |
| M4 | ページ固有: home 文字分割/設計図/カラーストリップ → colors チルト/透かし番号 → process 番号 → story/service/about/shop/materials/notes | ページごと並列可 |

- 全 wave とも `prefers-reduced-motion` キルスイッチと SSG 非退行(公開ページに request-time API を持ち込まない)が受入条件。
- ビジュアル画像エディタ(visual-media-editor.md)の V2a と同じファイル群(公開ページ JSX)を触るため、**着手順序の調整が必要**(競合回避)。

## 7. 元データ

Sonnet 5 researcher 4 体の個別レポート(仕組み軸 2 + ページ軸 2)はセッション作業ディレクトリに保管。本レポートはその統合版で、全行番号は 2026-07-09 時点の main (commit 5e8d30d) と legacy/ に対して検証済み。
